const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase Error: ${res.statusText} - ${err}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

module.exports = {
    // Lấy số dư xu
    async getCoins(userId) {
        const res = await supabaseFetch(`user_coins?user_id=eq.${userId}`);
        return res.length > 0 ? res[0].balance : 0;
    },

    // Cộng/Trừ xu
    async updateCoins(userId, amount) {
        const rows = await supabaseFetch(`user_coins?user_id=eq.${userId}`);
        const current = rows.length > 0 ? rows[0].balance : 0;
        const newBalance = current + amount;
        if (rows.length === 0) {
            await supabaseFetch('user_coins', 'POST', { user_id: userId, balance: newBalance });
        } else {
            await supabaseFetch(`user_coins?user_id=eq.${userId}`, 'PATCH', { balance: newBalance });
        }
        return newBalance;
    },

    // Lấy session (và xóa để chống dùng lại)
    async getAndDeleteSession(sid) {
        const res = await supabaseFetch(`sessions?id=eq.${sid}`);
        if (res.length === 0) return null;
        await supabaseFetch(`sessions?id=eq.${sid}`, 'DELETE');
        return res[0];
    },

    // Tạo session
    async createSession(sid, userId, provider) {
        await supabaseFetch('sessions', 'POST', { id: sid, user_id: userId, provider });
    },

    // Lấy và đánh dấu Gift Code đã dùng
    async redeemGiftCode(code) {
        const res = await supabaseFetch(`gift_codes?code=eq.${code}&is_used=eq.false`);
        if (res.length === 0) return null;
        await supabaseFetch(`gift_codes?code=eq.${code}`, 'PATCH', { is_used: true });
        return res[0].amount;
    },

    // Tạo Gift Code
    async createGiftCode(code, amount) {
        await supabaseFetch('gift_codes', 'POST', { code, amount });
    },

    // Kiểm tra giới hạn ngày
    async checkDailyLimit(userId, provider, dateStr) {
        const res = await supabaseFetch(`daily_limits?user_id=eq.${userId}&provider=eq.${provider}&date_str=eq.${dateStr}`);
        return res.length > 0 ? res[0].count : 0;
    },

    // Tăng lượt đếm ngày
    async increaseDailyLimit(userId, provider, dateStr) {
        const current = await this.checkDailyLimit(userId, provider, dateStr);
        if (current === 0) {
            await supabaseFetch('daily_limits', 'POST', { user_id: userId, provider, date_str: dateStr, count: 1 });
        } else {
            await supabaseFetch(`daily_limits?user_id=eq.${userId}&provider=eq.${provider}&date_str=eq.${dateStr}`, 'PATCH', { count: current + 1 });
        }
    },

    // Bảng xếp hạng coin
    async getTopCoins(limit = 10) {
        return await supabaseFetch(`user_coins?select=user_id,balance&balance=gt.0&order=balance.desc&limit=${parseInt(limit, 10) || 10}`);
    },

    // Admin lưu trong DB (bảng admins)
    async isAdmin(userId) {
        const res = await supabaseFetch(`admins?user_id=eq.${encodeURIComponent(userId)}`);
        return res.length > 0;
    },
    async addAdmin(userId, addedBy) {
        await supabaseFetch('admins', 'POST', { user_id: userId, added_by: addedBy });
    },
    async removeAdmin(userId) {
        await supabaseFetch(`admins?user_id=eq.${encodeURIComponent(userId)}`, 'DELETE');
    },

    // Lưu cặp key-value nhỏ (bảng kv)
    async getKv(key) {
        const res = await supabaseFetch(`kv?key=eq.${encodeURIComponent(key)}`);
        return res.length > 0 ? res[0].value : null;
    },
    async setKv(key, value) {
        const res = await supabaseFetch(`kv?key=eq.${encodeURIComponent(key)}`);
        if (res.length === 0) await supabaseFetch('kv', 'POST', { key, value });
        else await supabaseFetch(`kv?key=eq.${encodeURIComponent(key)}`, 'PATCH', { value });
    }
};
