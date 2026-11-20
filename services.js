/**
 * Các dịch vụ mua/đăng ký tài khoản (dùng chung cho bot Discord và web).
 */
const crypto = require('crypto');
const db = require('./database');

const HANAMI_URL = 'https://hanaminikata.com/dev/buy_device_cloud';
const CLOUD_NAMES = { UG: 'UGPhone', VM: 'VMOS', VS: 'VSPhone' };
const REG_COST = 10;

// Dịch vụ mua nhanh qua Meows — cookie được admin lưu trong bảng kv
const MEOWS_COOKIE_KEY = 'meows_cookie';
const MEOWS_COSTS = { UG: 49, VSVIP: 15 };
const MEOWS_NAMES = { UG: 'UGPhone', VSVIP: 'VSPhone VIP' };
const MEOWS_UA = 'Mozilla/5.0 (Linux; Android 10; S28 Ultra Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.52 Mobile Safari/537.36';

function vsphoneReady() {
    return !!(process.env.VSPHONE_API_URL && process.env.VSPHONE_API_KEY);
}

async function buyHanami(cloudId, server, inputData) {
    const body = { token: process.env.HANAMI_TOKEN, cloud_id: cloudId, input_data: inputData };
    if (server) body.server = server;
    const response = await fetch(HANAMI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`[buycloud] Hanami trả về không phải JSON (HTTP ${response.status}):`, raw.slice(0, 300));
        const snippet = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return { ok: false, message: `Hanami trả về HTML thay vì JSON (HTTP ${response.status}): ${snippet.replace(/`/g, "'")}` };
    }
    return { ok: data.code === 0, message: data.message || 'Không rõ' };
}

/** Đăng ký 1 tài khoản VMOS. Trả về { account, mail, password }. */
async function regVmosAccount() {
    const response = await fetch('https://wxygtmfttyidwnhjdwdw.supabase.co/functions/v1/get-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.APIKEY },
        body: JSON.stringify({ clientId: crypto.randomUUID() }),
    });
    const data = await response.json();
    if (!data.content) throw new Error('Không lấy được dữ liệu.');
    const [mail, ...passParts] = data.content.split('|');
    return { account: mail, password: passParts.join('|'), copyText: data.content };
}

/** Đăng ký 1 tài khoản VSPhone. Trả về { account, password, token, userId, copyText }. */
async function regVsphoneAccount() {
    if (!vsphoneReady()) throw new Error('VSPhone chưa được cấu hình (thiếu VSPHONE_API_URL / VSPHONE_API_KEY).');
    const response = await fetch(process.env.VSPHONE_API_URL, {
        headers: { 'x-api-key': process.env.VSPHONE_API_KEY },
        signal: AbortSignal.timeout(90000),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error(`API VSPhone không trả JSON (HTTP ${response.status})`); }
    if (!data.ok || !data.email || !data.password) {
        throw new Error(data.error || data.message || `API VSPhone trả lỗi (HTTP ${response.status})`);
    }
    return {
        account: data.email,
        password: data.password,
        token: data.token || null,
        userId: data.userId || null,
        copyText: `${data.email}|${data.password}`,
    };
}

// ==================== MEOWS (UGPhone / VSPhone VIP) ====================

/** Chấp nhận token thường, `.COOKIESECURITY=...` hoặc cả header Cookie đầy đủ. */
function normalizeMeowsCookie(value) {
    let raw = String(value || '').trim().replace(/^Cookie\s*:\s*/i, '');
    if (!raw) return '';
    const match = /(?:^|;\s*)\.COOKIESECURITY\s*=\s*([^;]+)/i.exec(raw);
    const token = match
        ? match[1].trim()
        : raw.replace(/^\.COOKIESECURITY\s*=\s*/i, '').trim();
    return token ? `.COOKIESECURITY=${token}` : '';
}

async function getMeowsCookie() {
    return String((await db.getKv(MEOWS_COOKIE_KEY)) || '').trim();
}

function extractMeowsInfo(node, depth = 0) {
    if (!node || depth > 6) return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = extractMeowsInfo(item, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (typeof node !== 'object') return null;

    const pick = (keys) => {
        for (const key of keys) {
            const value = node[key];
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return null;
    };

    const account = pick(['account', 'email', 'username', 'user', 'login', 'phone', 'taiKhoan', 'tenTaiKhoan']);
    const password = pick(['password', 'pass', 'pwd', 'matKhau']);
    const token = pick(['token', 'accessToken', 'access_token', 'authToken']);
    const userId = pick(['userId', 'user_id', 'id', 'deviceId']);
    let copyText = pick(['copyText', 'copy', 'text']);

    const content = pick(['content', 'data', 'result', 'info', 'device']);
    if (!copyText && typeof content === 'string' && content.includes('|')) copyText = content;
    if (!copyText && account && password) copyText = `${account}|${password}`;

    let found = null;
    for (const nested of [content, node.data, node.result, node.info, node.device, node.response]) {
        if (nested && typeof nested === 'object') {
            found = extractMeowsInfo(nested, depth + 1);
            if (found) break;
        }
    }

    return {
        account: account || (found && found.account) || null,
        password: password || (found && found.password) || null,
        token: token || (found && found.token) || null,
        userId: userId || (found && found.userId) || null,
        copyText: copyText || (found && found.copyText) || null,
    };
}

function meowsApiError(response, data, raw) {
    if (!response.ok) return `API trả HTTP ${response.status}`;
    if (data && (data.success === false || data.ok === false)) {
        return data.message || data.msg || data.error || 'API báo lỗi';
    }
    if (data && data.error && typeof data.error !== 'number' && String(data.error) !== '0') {
        return String(data.error);
    }
    const code = data && (data.code !== undefined ? data.code : data.status);
    const okCodes = [0, 1, 200, '0', '1', '200', 'success', 'ok', 'true'];
    if (code !== undefined && !okCodes.includes(String(code).toLowerCase())) {
        return data.message || data.msg || `API trả mã ${code}`;
    }
    if (!data && /^\s*</.test(raw)) return 'API trả về HTML thay vì JSON (cookie có thể hết hạn)';
    return null;
}

/** Mua device qua Meows. Trả { account, password, token, userId, copyText, details, message }. */
async function buyMeows(provider) {
    const key = String(provider || '').toUpperCase();
    const config = key === 'UG'
        ? {
            url: 'https://meows.vn/api/ugphone/redeem/buy',
            referer: 'https://meows.vn/client/ugphone-trial',
            body: {},
        }
        : key === 'VSVIP'
            ? {
                url: 'https://meows.vn/api/vsphone/fast-buy',
                referer: 'https://meows.vn/client/cloud-manager',
                body: { sourceId: 'vsphone_fast' },
            }
            : null;
    if (!config) throw new Error('Provider không hợp lệ.');

    const cookie = await getMeowsCookie();
    if (!cookie) throw new Error('Admin chưa lưu cookie dịch vụ nhanh (Quản trị → Cookie).');

    const response = await fetch(config.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: 'https://meows.vn',
            Referer: config.referer,
            'User-Agent': MEOWS_UA,
            Cookie: cookie,
        },
        body: JSON.stringify(config.body),
        signal: AbortSignal.timeout(60000),
    });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* giữ raw để báo lỗi */ }

    const error = meowsApiError(response, data, raw);
    if (error) throw new Error(`${error}${raw && !data ? ` (${raw.slice(0, 160)})` : ''}`);

    const info = extractMeowsInfo(data) || {};
    const rawText = data ? JSON.stringify(data) : raw;
    return {
        ok: true,
        account: info.account,
        password: info.password,
        token: info.token,
        userId: info.userId,
        copyText: info.copyText || rawText,
        details: data || raw,
        message: (data && (data.message || data.msg)) || 'Mua thành công',
    };
}

// ==================== CLOUDPHONE STATUS (public) ====================
const CLOUD_STATUS_TTL_MS = 60 * 1000;
let cloudStatusCache = null;
let cloudStatusPromise = null;

function normalizeRegions(data) {
    const out = {};
    for (const [name, value] of Object.entries(data || {})) {
        out[name] = value === true || value === 1 || String(value).toLowerCase() === 'true';
    }
    return out;
}

function normalizeMeowsDevice(entry) {
    const raw = String((entry && entry.status) || '').toLowerCase();
    const online = ['online', 'available', 'active', 'ready', 'ok', 'instock', 'in_stock', 'true'].includes(raw);
    return {
        status: online ? 'online' : 'offline',
        message: String((entry && entry.message) || ''),
        lastBuyAt: Number((entry && entry.lastBuyAt) || 0) || null,
    };
}

async function fetchHanamiStatus(path) {
    const token = process.env.HANAMI_TOKEN;
    if (!token) return { ok: false, error: 'Chưa cấu hình HANAMI_TOKEN', regions: null, message: '' };
    try {
        const response = await fetch(`https://hanaminikata.com${path}?token=${encodeURIComponent(token)}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(15000),
        });
        const raw = await response.text();
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { /* giữ raw */ }
        if (!response.ok || !data || Number(data.code) !== 0) {
            return {
                ok: false,
                error: (data && (data.message || data.error)) || `HTTP ${response.status}`,
                regions: null,
                message: '',
            };
        }
        return { ok: true, error: null, regions: normalizeRegions(data.data), message: data.message || '' };
    } catch (e) {
        return { ok: false, error: e.message, regions: null, message: '' };
    }
}

/** Trạng thái cloudphone từ Meows + Hanami. Cache 60s để tránh spam API. */
async function getCloudStatus({ force = false } = {}) {
    const now = Date.now();
    if (!force && cloudStatusCache && now - cloudStatusCache.at < CLOUD_STATUS_TTL_MS) {
        return cloudStatusCache.value;
    }
    if (cloudStatusPromise) return cloudStatusPromise;

    cloudStatusPromise = (async () => {
        const [meowsRes, ugRes, vmosRes] = await Promise.allSettled([
            (async () => {
                const response = await fetch('https://meows.vn/api/cloud-status', {
                    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(15000),
                });
                if (!response.ok) throw new Error(`Meows trả HTTP ${response.status}`);
                const data = await response.json();
                if (data && data.success === false) throw new Error(data.message || 'Meows báo lỗi');
                return {
                    vmos: normalizeMeowsDevice(data && data.vmos),
                    vsphone: normalizeMeowsDevice(data && data.vsphone),
                    ts: Number((data && data.ts) || 0) || null,
                };
            })(),
            fetchHanamiStatus('/dev/check_status_ugphone'),
            fetchHanamiStatus('/dev/check_status_vmos'),
        ]);

        const errors = [];
        const meows = meowsRes.status === 'fulfilled'
            ? meowsRes.value
            : {
                vmos: { status: 'offline', message: meowsRes.reason.message, lastBuyAt: null },
                vsphone: { status: 'offline', message: meowsRes.reason.message, lastBuyAt: null },
                ts: null,
            };
        if (meowsRes.status === 'rejected') errors.push(`Meows: ${meowsRes.reason.message}`);

        const ugphone = ugRes.status === 'fulfilled' ? ugRes.value : { ok: false, error: ugRes.reason.message, regions: null, message: '' };
        const hanamiVmos = vmosRes.status === 'fulfilled' ? vmosRes.value : { ok: false, error: vmosRes.reason.message, regions: null, message: '' };
        if (ugphone.error) errors.push(`UGPhone: ${ugphone.error}`);
        if (hanamiVmos.error) errors.push(`VMOS: ${hanamiVmos.error}`);

        const value = {
            checkedAt: new Date().toISOString(),
            vmos: meows.vmos,
            vsphone: meows.vsphone,
            ugphoneRegions: ugphone.regions,
            hanamiVmosRegions: hanamiVmos.regions,
            ugphoneMessage: ugphone.message || '',
            hanamiVmosMessage: hanamiVmos.message || '',
            errors,
        };
        cloudStatusCache = { at: Date.now(), value };
        return value;
    })();

    try {
        return await cloudStatusPromise;
    } finally {
        cloudStatusPromise = null;
    }
}

module.exports = {
    HANAMI_URL,
    CLOUD_NAMES,
    REG_COST,
    MEOWS_COOKIE_KEY,
    MEOWS_COSTS,
    MEOWS_NAMES,
    vsphoneReady,
    buyHanami,
    regVmosAccount,
    regVsphoneAccount,
    normalizeMeowsCookie,
    getMeowsCookie,
    buyMeows,
    getCloudStatus,
};
