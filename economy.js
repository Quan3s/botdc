/**
 * Cấu hình kinh tế dùng chung cho web, bot và admin.
 * Admin đổi tại Admin Hub → Kinh tế, lưu vào KV `economy_config`.
 * Mọi module đọc qua snapshot() (đồng bộ) sau khi load()/refresh() chạy.
 */
const db = require('./database');

const CONFIG_KEY = 'economy_config';
const RATE_KEY = 'exchange_coin_per_acoin';

const DEFAULTS = Object.freeze({
    linkRewards: Object.freeze({ link4m: 409, layma: 450, bbmkts: 259 }),
    deviceCosts: Object.freeze({ VM: 60, VS: 100, VSVIP: 150, UG: 490 }),
    topupCoins: Object.freeze({
        '10000': 8000,
        '20000': 16000,
        '30000': 24000,
        '50000': 40000,
        '100000': 80000,
        '200000': 160000,
        '500000': 400000,
        '1000000': 800000,
    }),
    coinPerAcoin: 1000,
});

let cache = clone(DEFAULTS);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalize(raw = {}) {
    const out = clone(DEFAULTS);
    for (const [id, fallback] of Object.entries(DEFAULTS.linkRewards)) {
        out.linkRewards[id] = positiveInt(raw.linkRewards && raw.linkRewards[id], fallback);
    }
    for (const [id, fallback] of Object.entries(DEFAULTS.deviceCosts)) {
        out.deviceCosts[id] = positiveInt(raw.deviceCosts && raw.deviceCosts[id], fallback);
    }
    for (const [amount, fallback] of Object.entries(DEFAULTS.topupCoins)) {
        out.topupCoins[amount] = positiveInt(raw.topupCoins && raw.topupCoins[amount], fallback);
    }
    if (raw.coinPerAcoin != null) out.coinPerAcoin = positiveInt(raw.coinPerAcoin, DEFAULTS.coinPerAcoin);
    return out;
}

/** Đọc KV và cập nhật cache dùng chung. Gọi lúc startup và sau khi admin lưu. */
async function load() {
    try {
        const stored = await db.getKv(CONFIG_KEY);
        cache = stored ? normalize(JSON.parse(stored)) : clone(DEFAULTS);
        // Đồng bộ tỷ giá ACOIN với key cũ để marketplace/bot không cần đổi nhiều chỗ.
        try {
            const legacyRate = await db.getKv(RATE_KEY);
            if (legacyRate && positiveInt(legacyRate, 0) !== cache.coinPerAcoin) {
                cache.coinPerAcoin = positiveInt(legacyRate, DEFAULTS.coinPerAcoin);
            }
        } catch (e) { /* bỏ qua */ }
    } catch (e) {
        console.error('[economy] không đọc được cấu hình, dùng mặc định:', e.message);
        cache = clone(DEFAULTS);
    }
    applyToProviders();
    return clone(cache);
}

async function save(patch = {}) {
    cache = normalize({ ...clone(cache), ...(patch || {}) });
    await db.setKv(CONFIG_KEY, JSON.stringify(cache));
    await db.setKv(RATE_KEY, String(cache.coinPerAcoin));
    applyToProviders();
    return clone(cache);
}

async function reset() {
    cache = clone(DEFAULTS);
    await db.setKv(CONFIG_KEY, JSON.stringify(cache));
    await db.setKv(RATE_KEY, String(cache.coinPerAcoin));
    applyToProviders();
    return clone(cache);
}

function snapshot() {
    return clone(cache);
}

function coinsForAmount(amount) {
    const key = String(parseInt(amount, 10) || 0);
    return positiveInt(cache.topupCoins[key], 0);
}

/** Giữ các module sync (bot/web) đọc reward mới mà không cần await. */
function applyToProviders() {
    try {
        const providers = require('./link-providers');
        for (const [id, reward] of Object.entries(cache.linkRewards)) {
            const provider = providers.get(id);
            if (provider) provider.reward = reward;
        }
    } catch (e) { /* bỏ qua khi module chưa sẵn */ }
}

module.exports = {
    CONFIG_KEY,
    RATE_KEY,
    DEFAULTS,
    load,
    save,
    reset,
    snapshot,
    coinsForAmount,
    applyToProviders,
};
