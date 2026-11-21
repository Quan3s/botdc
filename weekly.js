/**
 * Thưởng bảng xếp hạng "vượt link" hàng tuần.
 *
 * Giải thưởng:
 *   Top 1     : 300 coin
 *   Top 2     : 150 coin
 *   Top 3     :  75 coin
 *   Top 4-10  :  40 coin
 *
 * Tự động chạy vào Chủ nhật hằng tuần (giờ VN). Sau khi trả thưởng, kỳ mới
 * được bắt đầu (bộ đếm vượt link reset theo kỳ).
 */
const crypto = require('crypto');
const db = require('./database');
const gistStore = require('./gist-store');
const { vnNow, getTodayString } = require('./utils');

const REWARDS = [300, 150, 75, 40, 40, 40, 40, 40, 40, 40];
/** Tối thiểu 5 link trong kỳ mới được lên BXH tuần / nhận thưởng. */
const MIN_WEEKLY_LINKS = 5;
const PERIOD_KEY = 'link_period_start';
const LAST_PAYOUT_KEY = 'link_last_payout';

async function getLinkPeriod() {
    const stored = await db.getKv(PERIOD_KEY);
    return stored || getTodayString();
}

/**
 * BXH tuần = DB + Gist 7 ngày. Gist là bản sao đề phòng deploy làm mất local DB;
 * lấy max để không cộng đôi số đã có trong DB.
 */
async function mergedLeaderboard(period, limit = 10, minCount = 0) {
    const n = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const min = Math.max(0, parseInt(minCount, 10) || 0);
    const [dbRows, gistRows] = await Promise.all([
        db.getLinkLeaderboard(period, n, minCount),
        gistStore.aggregateLinkCounts(period).catch(() => []),
    ]);
    const map = new Map();
    (dbRows || []).forEach(r => map.set(String(r.user_id), Number(r.count) || 0));
    (gistRows || []).forEach(r => {
        const id = String(r.user_id);
        map.set(id, Math.max(map.get(id) || 0, Number(r.count) || 0));
    });
    return [...map]
        .filter(([, count]) => count >= min)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([user_id, count]) => ({ user_id, period: String(period), count }));
}

/** Số link của 1 user trong kỳ, ưu tiên bản lớn hơn giữa DB và Gist. */
async function userLinkCount(userId, period) {
    const [dbCount, gistCount] = await Promise.all([
        db.getLinkCount(userId, period).catch(() => 0),
        gistStore.userLinkCount(userId, period).catch(() => 0),
    ]);
    return Math.max(Number(dbCount) || 0, Number(gistCount) || 0);
}

function isSundayVn() {
    return vnNow().getUTCDay() === 0;
}

async function notifyWebhook(lines) {
    const url = process.env.LEADERBOARD_WEBHOOK_URL;
    if (!url) return;
    try {
        await fetch(`${url}?wait=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                allowed_mentions: { parse: [] },
                embeds: [{
                    title: '🏆 Thưởng bảng xếp hạng vượt link',
                    description: lines.join('\n') || 'Chưa có ai trong bảng xếp hạng tuần này.',
                    color: 0xF1C40F,
                    timestamp: new Date().toISOString(),
                }],
            }),
        });
    } catch (e) {
        console.error('[weekly] gửi webhook lỗi:', e.message);
    }
}

async function runWeeklyPayout({ force = false } = {}) {
    const today = getTodayString();

    if (!force && !isSundayVn()) return { skipped: 'not-sunday' };

    const lastPayout = await db.getKv(LAST_PAYOUT_KEY);
    if (!force && lastPayout === today) return { skipped: 'already-paid' };

    const period = await getLinkPeriod();
    const top = (await mergedLeaderboard(period, 10, MIN_WEEKLY_LINKS))
        .filter(row => Number(row.count) >= MIN_WEEKLY_LINKS);
    const details = [];

    for (let i = 0; i < top.length; i++) {
        const reward = REWARDS[i] || 0;
        if (reward <= 0) continue;
        let userId = top[i].user_id;
        // Nếu user đã liên kết Discord thì cộng vào coin Discord (key = discord id)
        if (String(userId).startsWith('web_')) {
            try {
                const webUser = await db.getWebUserById(String(userId).slice(4));
                if (webUser && webUser.discord_id) userId = String(webUser.discord_id);
            } catch (e) { /* giữ nguyên key web */ }
        }
        const newBalance = await db.updateCoins(userId, reward);
        details.push({ rank: i + 1, user_id: userId, count: Number(top[i].count), reward, balance: newBalance });
    }

    const total = details.reduce((sum, d) => sum + d.reward, 0);
    await db.createPayout({ id: crypto.randomUUID(), period, total, details });
    await db.setKv(PERIOD_KEY, today);
    await db.setKv(LAST_PAYOUT_KEY, today);

    const lines = details.length
        ? details.map(d => `#${d.rank} — ${d.user_id} — **${d.count}** link — +${d.reward} coin`)
        : ['Chưa có ai trong bảng xếp hạng tuần này.'];
    await notifyWebhook([`Kỳ: **${period}** → **${today}**`, ...lines]);

    console.log(`[weekly] Đã trả thưởng kỳ ${period}: ${details.length} người, tổng ${total} coin.`);
    return { period, date: today, total, details };
}

module.exports = {
    REWARDS, MIN_WEEKLY_LINKS, getLinkPeriod, runWeeklyPayout, isSundayVn,
    mergedLeaderboard, userLinkCount,
};
