/**
 * Các dịch vụ mua/đăng ký tài khoản (dùng chung cho bot Discord và web).
 */
const crypto = require('crypto');
const nodeFetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');
const db = require('./database');

const HANAMI_URL = 'https://hanaminikata.com/dev/buy_device_cloud';
const CLOUD_NAMES = { UG: 'UGPhone', VM: 'VMOS', VS: 'VSPhone' };
const REG_COST = 10;

// Dịch vụ mua nhanh qua Meows — cookie được admin lưu trong bảng kv
const MEOWS_COOKIE_KEY = 'meows_cookie';
const MEOWS_COSTS = { UG: 49, VSVIP: 15 };
const MEOWS_NAMES = { UG: 'UGPhone', VSVIP: 'VSPhone VIP' };
const DEVICE_LOGOS = {
  UG: 'https://img.utdstc.com/icon/48f/fcd/48ffcdcfb167f38e517727e184da795d34418c94094af934298aacc64fceddb6:600',
  VS: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_g3u538-aiEWP_68-48toiD36I5eBqhVWVI6V0U0uww&s=10',
  VM: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSnEz_zC4ZHJBI8GYKBKoLB4OArt8V9lVet6fX5Ndv83w&s=10',
};
const MEOWS_UA = 'Mozilla/5.0 (Linux; Android 10; S28 Ultra Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.52 Mobile Safari/537.36';

function vsphoneReady() {
    return !!(process.env.VSPHONE_API_URL && process.env.VSPHONE_API_KEY);
}

async function buyHanami(cloudId, server, inputData) {
    const body = { token: process.env.HANAMI_TOKEN, cloud_id: cloudId, input_data: inputData };
    if (server) body.server = server;
    const result = await requestWithFallback(HANAMI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(body),
        timeout: 60000,
    }, { includeWww: false, useProxy: process.env.HANAMI_USE_PROXY === '1' });
    const raw = result.raw;
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`[buycloud] Hanami trả về không phải JSON (HTTP ${result.status}):`, raw.slice(0, 300));
        const snippet = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return { ok: false, message: `Hanami trả về HTML thay vì JSON (HTTP ${result.status}): ${snippet.replace(/`/g, "'")}`, source: result.source };
    }
    return { ok: data.code === 0, message: data.message || 'Không rõ', source: result.source };
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

/** JSON có thể nằm trong markdown/backtick hoặc bị bọc bởi text ("Nội dung chính: {...}"). */
function parseLooseJson(value) {
    if (typeof value !== 'string') return value;
    let text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(text); } catch (e) { /* thử cắt giữa {} */ }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* không phải JSON */ }
    }
    return null;
}

const UG_CONTENT_KEY = /^(?:nội\s*dung\s*chính|noi\s*dung\s*chinh|content|contents|data|result|info|device|payload|storage|local-?storage|ugphone)/i;

function looksLikeUgPhone(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    return Object.keys(obj).some(key => /^(?:UGPHONE-|ugPhone|ugBrowserId|hadAgreePolicy)/i.test(key));
}

/** Tìm object Local Storage UGPhone thật, bỏ các field tracking/_gcl_ls/fbapc_* của Meows. */
function parseUgPhonePayload(node, depth = 0) {
    if (depth > 6 || node === null || node === undefined) return null;
    const parsed = parseLooseJson(node);
    if (parsed && parsed !== node && parsed && typeof parsed === 'object') {
        return parseUgPhonePayload(parsed, depth + 1);
    }
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = parseUgPhonePayload(item, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (typeof node !== 'object') return null;
    if (looksLikeUgPhone(node)) return node;
    for (const [key, value] of Object.entries(node)) {
        if (UG_CONTENT_KEY.test(key.replace(/[_-]+/g, ' ').trim())) {
            const found = parseUgPhonePayload(value, depth + 1);
            if (found) return found;
        }
    }
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            const found = parseUgPhonePayload(value, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

/** Tách field cần dùng từ Local Storage UGPhone để FE/Bot hiển thị gọn. */
function ugPhoneInfo(payload) {
    const pick = (keys, source) => {
        for (const key of keys) {
            const value = source && source[key];
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return null;
    };
    const mqtt = parseLooseJson(payload['UGPHONE-MQTT'] || payload.ugPhoneMqtt) || {};
    const id = pick(['UGPHONE-ID', 'UGPHONE-Id', 'ugPhoneId', 'userId'], payload);
    const token = pick(['UGPHONE-Token', 'ugPhoneToken', 'accessToken'], payload);
    const browserId = pick(['ugBrowserId', 'UGPHONE-browserId', 'UGPHONE-BrowserId'], payload);
    const publicKey = pick(['UGPHONE-PUBLICKEY', 'UGPHONE-publicKey'], payload) || pick(['public_key'], mqtt);
    const fields = [
        { key: 'UGPHONE-ID', label: 'UGPHONE-ID', value: String(id || '') },
        { key: 'UGPHONE-Token', label: 'UGPHONE-Token', value: String(token || '') },
        { key: 'ugBrowserId', label: 'ugBrowserId', value: String(browserId || '') },
    ];
    for (const key of [
        'client_id', 'login_id', 'access_key', 'access_secret',
        'mqtt_url', 'mqtt_ssl_url', 'mqtt_ws_url', 'mqtt_wss_url',
        'mqtt_topic', 'mqtt_username', 'mqtt_password', 'ws_url',
    ]) {
        const value = mqtt[key];
        if (value !== undefined && value !== null && value !== '') {
            fields.push({ key: `UGPHONE-MQTT.${key}`, label: `MQTT ${key}`, value: String(value) });
        }
    }
    if (publicKey) {
        fields.push({ key: 'UGPHONE-PUBLICKEY', label: 'UGPHONE-PUBLICKEY', value: String(publicKey), long: true });
    }
    // Bỏ field tracking (_gcl_ls, fbapc_*) của Meows, giữ đủ key UGPhone cần import.
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
        if (/^_/.test(key) || /^fbapc_/i.test(key)) continue;
        clean[key] = value;
    }
    return {
        id: id ? String(id) : null,
        token: token ? String(token) : null,
        browserId: browserId ? String(browserId) : null,
        publicKey: publicKey ? String(publicKey) : null,
        fields,
        copyText: JSON.stringify(clean, null, 2),
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

    const result = await requestWithFallback(config.url, {
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
        timeout: 60000,
    }, { includeWww: false });
    const response = { ok: result.ok, status: result.status };
    const raw = result.raw;
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* giữ raw để báo lỗi */ }

    const error = meowsApiError(response, data, raw);
    if (error) {
        const detail = raw ? ` (body: ${raw.replace(/\s+/g, ' ').slice(0, 200)})` : '';
        const chain = result.failures && result.failures.length ? ` · đã thử: ${result.failures.join('; ')}` : '';
        throw new Error(`${error}${detail} [nguồn: ${result.source}]${chain}`);
    }

    // UGPhone trả Local Storage trong "Nội dung chính" — tách riêng, không đổ cả raw JSON.
    if (key === 'UG') {
        const payload = parseUgPhonePayload(data || raw);
        if (payload) {
            const ug = ugPhoneInfo(payload);
            return {
                ok: true,
                kind: 'ugphone',
                account: ug.id,
                password: ug.token,
                token: ug.token,
                userId: ug.id,
                copyText: ug.copyText,
                fields: ug.fields,
                details: payload,
                message: (data && (data.message || data.msg)) || 'Mua thành công',
                source: result.source,
            };
        }
    }

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
        source: result.source,
    };
}

// ==================== CLOUDPHONE STATUS (public) ====================
const CLOUD_STATUS_TTL_MS = 60 * 1000;
let cloudStatusCache = null;
let cloudStatusPromise = null;

function normalizeMeowsDevice(entry) {
    const raw = String((entry && entry.status) || '').toLowerCase();
    const online = ['online', 'available', 'active', 'ready', 'ok', 'instock', 'in_stock', 'true'].includes(raw);
    return {
        status: online ? 'online' : 'offline',
        message: String((entry && entry.message) || ''),
        lastBuyAt: Number((entry && entry.lastBuyAt) || 0) || null,
    };
}

function parseMeowsStatus(raw) {
    const text = String(raw || '').trim();
    try { return JSON.parse(text); } catch (e) { /* thử các dạng khác */ }
    const marker = text.indexOf('Markdown Content:');
    if (marker >= 0) {
        const part = text.slice(marker + 'Markdown Content:'.length).trim();
        try { return JSON.parse(part); } catch (e) { /* cắt giữa {} */ }
        const start = part.indexOf('{');
        const end = part.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try { return JSON.parse(part.slice(start, end + 1)); } catch (e) { /* bỏ qua */ }
        }
    }
    return null;
}

/** Chấp nhận `socks5h://host:port`, `socks5://host:port` hoặc chỉ `host:port` (WARP mặc định 127.0.0.1:40000). */
function normalizeStatusProxy(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || /^socks/i.test(raw)) return raw;
    return `socks5h://${raw.replace(/^\/+/, '')}`;
}

function proxyKeyHeaders() {
    const key = String(process.env.MEOWS_PROXY_KEY || '').trim();
    return key ? { 'x-proxy-key': key } : {};
}

async function getProxyUrl() {
    const fromEnv = normalizeStatusProxy(process.env.MEOWS_API_PROXY || process.env.MEOWS_STATUS_PROXY);
    if (fromEnv) return fromEnv;
    try {
        return normalizeStatusProxy(await db.getKv('meows_status_proxy'));
    } catch (e) {
        return '';
    }
}

/** Cùng thứ tự nguồn với Cloud Status. `www` chỉ dùng cho GET/status (API mua không có trên www). */
async function getRequestSources({ includeReader = false, includeWww = true, useProxy = true } = {}) {
    // useProxy=false dùng cho dịch vụ không phải Meows (vd Hanami) — WARP chỉ áp dụng cho Meows.
    const proxyUrl = useProxy ? await getProxyUrl() : '';
    const sources = [];
    if (proxyUrl) {
        if (/^https?:\/\//i.test(proxyUrl)) {
            sources.push({ name: 'worker', kind: 'worker', url: proxyUrl });
        } else {
            sources.push({ name: 'warp', kind: 'socks', proxyUrl });
            // Nếu người dùng dán nhầm "host:port" của HTTP proxy (không có http://),
            // normalizeStatusProxy sẽ ra socks5h://... → thử thêm dạng http:// cùng địa chỉ.
            try {
                const httpUrl = new URL(proxyUrl.replace(/^socks5h?:\/\//i, 'http://'));
                httpUrl.username = '';
                httpUrl.password = '';
                sources.push({ name: 'proxy', kind: 'worker', url: httpUrl.toString() });
            } catch (e) { /* bỏ qua */ }
        }
    }
    sources.push({ name: 'direct', kind: 'direct' });
    if (includeWww) sources.push({ name: 'www', kind: 'www' });
    if (includeReader) sources.push({ name: 'proxy', kind: 'reader' });
    return sources;
}

function isBlockedResponse(response, raw, source) {
    if (response.status === 403) return true;
    if (source.kind === 'worker' && response.status === 404) return true; // Worker cũ/sai route
    return /Just a moment|cf-challenge|cloudflare/i.test(String(raw || '').slice(0, 500));
}

async function requestFromSource(source, targetUrl, options) {
    const headers = { ...(options.headers || {}) };
    let url = targetUrl;

    if (source.kind === 'worker') {
        const u = new URL(source.url);
        u.searchParams.set('url', targetUrl);
        url = u.toString();
        Object.assign(headers, proxyKeyHeaders());
    } else if (source.kind === 'www') {
        url = targetUrl.replace('https://meows.vn', 'https://www.meows.vn');
    } else if (source.kind === 'reader') {
        url = `https://r.jina.ai/${targetUrl}`;
        delete headers.Cookie;
        delete headers.cookie;
    } else if (source.kind === 'socks') {
        const nodeOptions = { ...options, headers };
        delete nodeOptions.signal; // node-fetch v2 dùng timeout thay vì AbortSignal.timeout
        return nodeFetch(targetUrl, {
            ...nodeOptions,
            agent: new SocksProxyAgent(source.proxyUrl),
            timeout: Number(nodeOptions.timeout) || 60000,
        });
    }

    return fetch(url, { ...options, headers, redirect: 'manual' });
}

/**
 * Gọi API theo chain của status. Chỉ retry khi bị chặn (403/Cloudflare) hoặc lỗi mạng.
 * Với mua hàng KHÔNG retry sau khi API đã trả response, để tránh mua trùng/trừ coin trùng.
 */
async function requestWithFallback(targetUrl, options = {}, { includeReader = false, includeWww = true, useProxy = true, parse = null } = {}) {
    const sources = await getRequestSources({ includeReader, includeWww, useProxy });
    const failures = [];

    for (const source of sources) {
        let response;
        let raw;
        try {
            response = await requestFromSource(source, targetUrl, options);
            raw = await response.text();
        } catch (e) {
            failures.push(`${source.name}: ${e.message}`);
            continue;
        }

        if (isBlockedResponse(response, raw, source)) {
            const challenge = /Just a moment/i.test(raw);
            failures.push(`${source.name}: HTTP ${response.status}${challenge ? ' (Cloudflare challenge)' : ''}`);
            continue;
        }
        const parsed = parse ? parse(raw) : null;
        if (!response.ok || (parse && (!parsed || parsed.success === false))) {
            return { raw, status: response.status, ok: false, source: source.name, parsed: null, failures };
        }
        return { raw, status: response.status, ok: true, source: source.name, parsed, failures };
    }
    throw new Error(failures.join(' · ') || 'Không gọi được API');
}

/** Trạng thái cloudphone từ Meows. Cache 60s để tránh spam API. */
async function getCloudStatus({ force = false } = {}) {
    const now = Date.now();
    if (!force && cloudStatusCache && now - cloudStatusCache.at < CLOUD_STATUS_TTL_MS) {
        return cloudStatusCache.value;
    }
    if (cloudStatusPromise) return cloudStatusPromise;

    cloudStatusPromise = (async () => {
        let result = null;
        let lastError = null;
        try {
            result = await requestWithFallback('https://meows.vn/api/cloud-status', {
                headers: {
                    Accept: 'application/json',
                    Origin: 'https://meows.vn',
                    Referer: 'https://meows.vn/client/cloud-manager',
                    'User-Agent': MEOWS_UA,
                },
                signal: AbortSignal.timeout(15000),
                timeout: 15000,
            }, { includeReader: true, parse: parseMeowsStatus });
        } catch (e) {
            lastError = e;
        }

        const errors = [];
        let meows;
        let source = null;
        if (result && result.ok && result.parsed) {
            const data = result.parsed;
            source = result.source;
            meows = {
                vmos: normalizeMeowsDevice(data.vmos),
                vsphone: normalizeMeowsDevice(data.vsphone),
                ts: Number(data.ts) || null,
            };
        } else {
            const reason = lastError
                ? lastError.message
                : (result && result.parsed && (result.parsed.message || result.parsed.error)) || 'API không trả dữ liệu';
            errors.push(`Meows: ${reason}`);
            meows = {
                vmos: { status: 'offline', message: reason, lastBuyAt: null },
                vsphone: { status: 'offline', message: reason, lastBuyAt: null },
                ts: null,
            };
        }

        const value = {
            checkedAt: new Date().toISOString(),
            source,
            sourceTs: meows.ts,
            vmos: meows.vmos,
            vsphone: meows.vsphone,
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
    DEVICE_LOGOS,
    vsphoneReady,
    buyHanami,
    regVmosAccount,
    regVsphoneAccount,
    normalizeMeowsCookie,
    getMeowsCookie,
    parseLooseJson,
    parseUgPhonePayload,
    ugPhoneInfo,
    buyMeows,
    normalizeStatusProxy,
    getCloudStatus,
    probeMeowsPost,
};

/** Test POST qua đúng chain đang dùng, tới endpoint KHÔNG mua máy. Trả về status/nguồn để biết 403 ở đâu. */
async function probeMeowsPost() {
    const cookie = await getMeowsCookie();
    const result = await requestWithFallback('https://meows.vn/api/cloud-status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: 'https://meows.vn',
            Referer: 'https://meows.vn/client/cloud-manager',
            'User-Agent': MEOWS_UA,
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: '{}',
        signal: AbortSignal.timeout(15000),
        timeout: 15000,
    }, { includeWww: false });
    return {
        ok: result.ok,
        status: result.status,
        source: result.source,
        failures: result.failures,
        body: String(result.raw || '').replace(/\s+/g, ' ').slice(0, 200),
        cookieSet: !!cookie,
    };
}
