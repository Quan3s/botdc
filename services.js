/**
 * Các dịch vụ mua/đăng ký tài khoản (dùng chung cho bot Discord và web).
 */
const crypto = require('crypto');
const nodeFetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');
const db = require('./database');
const github = require('./github');
const gistStore = require('./gist-store');

const HANAMI_URL = 'https://hanaminikata.com/dev/buy_device_cloud';
const CLOUD_NAMES = { UG: 'UGPhone', VM: 'VMOS', VS: 'VSPhone' };

// Chỉ cụm NÀY (xuất hiện trong JSON hoặc response) mới được coi là hết máy.
// Mọi lỗi khác là lỗi tạm thời khi thực hiện lệnh -> gửi lại, giữ nguyên tài khoản test.
const HANAMI_OUT_OF_STOCK = 'Vui lòng đăng nhập vào acc và sử dụng lại câu lệnh. Nếu đăng nhập rồi mà vẫn gặp lỗi này thì có thể gói trial đang tạm thời hết hàng, vui lòng thử lại sau.';
// Lỗi "Đã có lỗi xảy ra khi thực hiện câu lệnh." là lỗi nhất thời: thử lại sau 1s.
const HANAMI_COMMAND_ERROR_MS = 1000;
const HANAMI_COMMAND_ERROR_RETRIES = 1;
const HANAMI_PROBE_TTL_MS = 5 * 60 * 1000;
const HANAMI_PROBE_KV = 'hanami_cloud_probe';
const HANAMI_TEST_ACCOUNTS_KV = 'hanami_test_accounts';
const REG_COST = 10; // giữ alias cũ; giá thật đọc từ economy.js

// Giá mặc định mới (admin chỉnh trong Admin Hub → Kinh tế).
const DEVICE_COSTS = { VM: 60, VS: 100, VSVIP: 150, UG: 490 };

// Dịch vụ mua nhanh qua Meows — cookie được admin lưu trong bảng kv
const MEOWS_COOKIE_KEY = 'meows_cookie';
const MEOWS_COSTS = { UG: 490, VSVIP: 150 };
const MEOWS_NAMES = { UG: 'UGPhone', VSVIP: 'VSPhone VIP' };
const DEVICE_LOGOS = {
  UG: 'https://img.utdstc.com/icon/48f/fcd/48ffcdcfb167f38e517727e184da795d34418c94094af934298aacc64fceddb6:600',
  VS: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_g3u538-aiEWP_68-48toiD36I5eBqhVWVI6V0U0uww&s=10',
  VM: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSnEz_zC4ZHJBI8GYKBKoLB4OArt8V9lVet6fX5Ndv83w&s=10',
};
const MEOWS_UA = 'Mozilla/5.0 (Linux; Android 10; S28 Ultra Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.52 Mobile Safari/537.36';

// VMOS Cloud Status dùng API chính chủ, không probe Hanami.
// Chỉ đọc tồn TRIAL: getCloudGoodList là SKU trả phí nên không dùng cho status nữa.
// API rất nhẹ nên cache 5s; user gọi là tự làm mới khi quá hạn.
const VMOS_API_BASE = 'https://api.vmoscloud.com';
const VMOS_CLOUD_GOODS_PATH = '/vcpcloud/api/padApi/getCloudGoodList';
const VMOS_TRIAL_AVAILABILITY_PATH = '/vcpcloud/api/padApi/realMachineTrialAvailability';
const VMOS_CLOUD_ANDROID_VERSION = '13';
const VMOS_API_TIMEOUT_MS = 10000;
const VMOS_CLOUD_SOURCE = 'vmoscloud';

// VSPhone: API chính chủ bên dưới chỉ đọc tồn PAID nên KHÔNG dùng cho Cloud Status nữa.
// Status VSPhone lấy Meows như cũ. VSPHONE_API_KEY chỉ dùng cho mua nhanh.
const VSPHONE_API_BASE = 'https://api.vsphone.com';
const VSPHONE_CLOUD_GOODS_PATH = '/vsphone/api/padApi/getCloudGoodList';
const VSPHONE_CLOUD_ANDROID_VERSION = '13';
const VSPHONE_API_TIMEOUT_MS = 10000;
const VSPHONE_CLOUD_SOURCE = 'vsphone';
// Portal thực tế yêu cầu chữ ký V4 (Authorization), dù doc V2 nói dùng X-Sign.
const VSPHONE_API_HOST = 'api.vsphone.com';
const VSPHONE_CONTENT_TYPE = 'application/json;charset=UTF-8';

function vsphoneReady() {
    return !!(process.env.VSPHONE_API_URL && process.env.VSPHONE_API_KEY);
}

/** Key API chính chủ VSPhone (khác với VSPHONE_API_KEY dùng cho mua nhanh). */
function vsphoneOfficialReady() {
    return !!(process.env.VSPHONE_ACCESS_KEY && process.env.VSPHONE_SECRET_KEY);
}

/** Gom mọi chuỗi trong JSON (kể cả nested) để nhận diện thông báo hết máy. */
function collectStrings(node, out = [], depth = 0) {
    if (depth > 8 || node == null) return out;
    if (typeof node === 'string') {
        if (node) out.push(node);
        return out;
    }
    if (Array.isArray(node)) {
        for (const item of node) collectStrings(item, out, depth + 1);
        return out;
    }
    if (typeof node === 'object') {
        for (const value of Object.values(node)) collectStrings(value, out, depth + 1);
    }
    return out;
}

const normalizeSpaces = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** CHỈ cụm thông báo chính xác này mới là hết máy; các lỗi khác phải retry. */
function isHanamiOutOfStock(...values) {
    const needle = normalizeSpaces(HANAMI_OUT_OF_STOCK);
    return values.some(value => normalizeSpaces(value).includes(needle))
        || collectStrings(values).some(text => normalizeSpaces(text).includes(needle));
}

/** Bỏ dấu để nhận cả "Đã có lỗi xảy ra khi thực hiện câu lệnh." và các biến thể không dấu. */
function normalizeHanamiText(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** CHỈ cụm lỗi thực hiện câu lệnh mới được auto retry; không đụng vào cụm hết máy. */
function isHanamiCommandError(...values) {
    const pattern = /\bco loi( xay ra)? khi thuc hien cau lenh\b/;
    return collectStrings(values).some(text => pattern.test(normalizeHanamiText(text)));
}

function hanamiLooksSuccess(data, raw) {
    if (isHanamiOutOfStock(data, raw)) return false;
    if (!data || typeof data !== 'object') return false;
    if (data.success === true || data.ok === true || data.status === 'success') return true;
    if (data.code === 0 || data.code === '0') return true;
    return !!(data.data && (data.data.account || data.data.email || data.data.device || data.data.machine));
}

/** Một lần gọi Hanami (không retry). Dùng trực tiếp cho probe vì probe tự quản lý retry. */
async function buyHanamiOnce(cloudId, server, inputData) {
    const body = { token: process.env.HANAMI_TOKEN, cloud_id: cloudId, input_data: inputData };
    if (server) body.server = server;
    const result = await requestWithFallback(HANAMI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(body),
        timeout: 60000,
    }, { includeWww: false, useProxy: process.env.HANAMI_USE_PROXY === '1' });
    const raw = String(result.raw || '');
    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`[buycloud] Hanami trả về không phải JSON (HTTP ${result.status}):`, raw.slice(0, 300));
        const snippet = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        const message = `Hanami trả về HTML thay vì JSON (HTTP ${result.status}): ${snippet.replace(/`/g, "'")}`;
        return { ok: false, message, raw, data: null, source: result.source, outOfStock: false, retryable: true, attempts: 1 };
    }
    const outOfStock = isHanamiOutOfStock(data, raw);
    const ok = result.ok && hanamiLooksSuccess(data, raw);
    const message = collectStrings(data).join(' · ').slice(0, 500) || (outOfStock ? HANAMI_OUT_OF_STOCK : 'Không rõ');
    return {
        ok,
        message,
        raw,
        data,
        source: result.source,
        outOfStock,
        // code !== 0 / HTTP lỗi / HTML / mạng đều là lỗi khi thực hiện lệnh -> gửi lại.
        retryable: !ok && !outOfStock,
        attempts: 1,
    };
}

/**
 * Mua cloud qua Hanami. Với cụm "Đã có lỗi xảy ra khi thực hiện câu lệnh."
 * thì tự gọi lại sau 1s (dùng cho cả web/bot khi user mua và plugin).
 * Không retry khi đã thành công, hết máy hay lỗi khác để tránh mua trùng.
 */
async function buyHanami(cloudId, server, inputData, { autoRetry = true, retries = HANAMI_COMMAND_ERROR_RETRIES, delayMs = HANAMI_COMMAND_ERROR_MS } = {}) {
    let result = await buyHanamiOnce(cloudId, server, inputData);
    const needsRetry = value => !value.ok && !value.outOfStock && isHanamiCommandError(value.message, value.data, value.raw);
    const times = Math.max(0, Number(retries) || 0);
    for (let i = 0; i < times && autoRetry && needsRetry(result); i++) {
        await waitMs(Math.max(0, Number(delayMs) || 0));
        result = await buyHanamiOnce(cloudId, server, inputData);
        result.attempts = i + 2;
        result.autoRetried = true;
    }
    return result;
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
    const account = {
        account: data.email,
        password: data.password,
        token: data.token || null,
        userId: data.userId || data.user_id || data.userid || null,
    };
    return { ...account, copyText: accountCopyText(account) };
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
    const token = pick(['token', 'Token', 'accessToken', 'access_token', 'authToken', 'auth_token']);
    const userId = pick(['userid', 'userID', 'userId', 'user_id', 'uid', 'id', 'deviceId']);
    let copyText = pick(['copyText', 'copy', 'text']);

    const content = pick(['content', 'data', 'result', 'info', 'device']);
    if (!copyText && typeof content === 'string' && content.includes('|')) copyText = content;
    if (!copyText && account && password) copyText = `${account}|${password}`;

    let found = null;
    for (const nested of [content, node.data, node.result, node.info, node.device, node.response]) {
        // API có khi trả data/result dưới dạng chuỗi JSON (vd. full response Fast-buy).
        const parsedString = typeof nested === 'string' ? parseLooseJson(nested) : null;
        const child = parsedString && typeof parsedString === 'object' ? parsedString : nested;
        if (child && typeof child === 'object') {
            found = extractMeowsInfo(child, depth + 1);
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

/** Sinh script nạp localStorage UGPhone: gist thật + base64 thật + link social từ cấu hình. */
async function buildUgInjectSnippet(ug) {
    const readSocial = async (key, envKey, fallback) => {
        try { return (await db.getKv(key)) || process.env[envKey] || fallback; }
        catch (e) { return process.env[envKey] || fallback; }
    };
    const [youtubeUrl, discordUrl] = await Promise.all([
        readSocial('youtube_url', 'YOUTUBE_URL', 'https://youtube.com'),
        readSocial('discord_url', 'DISCORD_URL', 'https://discord.com'),
    ]);
    const dataJson = (ug.copyText && String(ug.copyText).trim()) ? ug.copyText : '{}';
    const content = [
        `const data = ${dataJson};`,
        '',
        '// Xóa toàn bộ localStorage hiện tại',
        'localStorage.clear();',
        '',
        '// Set dữ liệu mới',
        'for (const key in data) {',
        '  if (Object.prototype.hasOwnProperty.call(data, key)) {',
        '    localStorage.setItem(key, data[key]);',
        '  }',
        '}',
        '',
        'console.log(',
        '  `%c🤑 Đã xóa và nhập localStorage! 🌸 \\n%cBây giờ bạn chỉ cần reload trang Ugphone Cloud là xong!\\n\\n%cYouTube: ' + youtubeUrl + '\\nDiscord: ' + discordUrl + '`,',
        "  'color: #4c00ffff; font-size: 16px; font-weight: bold;',",
        "  'color: #ff8c00; font-size: 15px; font-weight: bold;',",
        "  'color: #ffffff; font-size: 10px;'",
        ');',
    ].join('\n');

    // Mỗi lần mua tạo 1 gist secret mới chứa đúng script của lần đó.
    const filename = `asynctas-ugphone-${crypto.randomBytes(6).toString('hex')}.js`;
    let rawUrl = null;
    let error = null;
    try {
        const gist = await github.createGist(filename, content, 'ASYNCTAS UGPhone localStorage import');
        const gistFile = gist.filename || filename;
        rawUrl = `${String(gist.url || '').replace('https://gist.github.com/', 'https://gist.githubusercontent.com/').replace(/\/$/, '')}/raw/${gistFile}`;
    } catch (e) {
        error = e.message;
        // Thử lại lần 2 với tên file/description đơn giản (GitHub đôi khi trả 422 Validation Failed).
        try {
            const gist = await github.createGist('asynctas-ugphone.js', content, 'ASYNCTAS UGPhone');
            rawUrl = `${String(gist.url || '').replace('https://gist.github.com/', 'https://gist.githubusercontent.com/').replace(/\/$/, '')}/raw/${gist.filename || 'asynctas-ugphone.js'}`;
            error = null;
        } catch (e2) {
            error = `${error} | retry: ${e2.message}`;
        }
    }

    if (rawUrl) {
        return {
            snippet: `fetch(atob('${Buffer.from(rawUrl).toString('base64')}')).then(r => r.text()).then(eval);`,
            rawUrl,
            youtubeUrl,
            discordUrl,
        };
    }

    // Vẫn trả script để có nút Copy ngay cả khi GitHub đang lỗi.
    return {
        snippet: `eval(atob('${Buffer.from(content).toString('base64')}'));`,
        rawUrl: null,
        error,
        fallback: true,
        youtubeUrl,
        discordUrl,
    };
}

/** Nhận chuỗi đã copy: email|mật khẩu|token:...|userid:... */
function parseVsphonePipe(raw) {
    const text = String(raw || '').trim();
    if (!text.includes('|')) return null;
    const parts = text.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const email = parts[0];
    const password = parts[1].replace(/^password\s*:\s*/i, '');
    let token = null;
    let userId = null;
    for (const part of parts.slice(2)) {
        const m = /^(token|userid|user_id|user\s*id)\s*:\s*(.+)$/i.exec(part);
        if (!m) continue;
        if (/^token/i.test(m[1])) token = m[2].trim();
        else userId = m[2].trim();
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || !token || !userId) return null;
    return { email, password, token, userId, orderId: null, devices: [] };
}

/** Đọc full response VSPhone Fast-buy mà user dán vào (có thể kèm markdown/~ $). */
function parseVsphoneFastResponse(raw) {
    const piped = parseVsphonePipe(raw);
    if (piped) return piped;
    const parsed = parseLooseJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    let data = parsed.data || parsed.result || parsed.info || parsed;
    if (typeof data === 'string') data = parseLooseJson(data) || data;
    if (!data || typeof data !== 'object') return null;
    const pick = (keys) => {
        for (const key of keys) {
            const value = data[key];
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return null;
    };
    const email = pick(['email', 'account', 'username']);
    const password = pick(['password', 'pass', 'matKhau']);
    const token = pick(['token', 'accessToken', 'access_token']);
    const userId = pick(['userid', 'user_id', 'userId', 'id']);
    if (!email || !password || !token || !userId) return null;
    return {
        ...data,
        email: String(email),
        password: String(password),
        token: String(token),
        userId: String(userId),
        orderId: pick(['orderId', 'order_id']) || null,
        devices: Array.isArray(data.devices) ? data.devices : [],
    };
}

function field(label, value) {
    return { label, value: value === undefined || value === null ? '' : String(value) };
}

/** Copy đầy đủ: email|mật khẩu|token|userid — không làm rơi token/user id. */
function accountCopyText(info = {}) {
    const account = info.account !== undefined && info.account !== null ? info.account : info.email;
    const password = info.password !== undefined && info.password !== null ? info.password : info.pass;
    const parts = [account, password].filter(v => v !== undefined && v !== null && String(v) !== '').map(String);
    if (info.token !== undefined && info.token !== null && String(info.token) !== '') parts.push(`token:${info.token}`);
    if (info.userId !== undefined && info.userId !== null && String(info.userId) !== '') parts.push(`userid:${info.userId}`);
    return parts.join('|');
}

/** Tạo share link VSPhone qua Meows, trả đủ field của tài khoản + response getss-uid. */
async function getVsphoneShareLink(rawInput) {
    const input = parseVsphoneFastResponse(rawInput);
    if (!input) {
        return { ok: false, message: 'Dán đúng full response VSPhone Fast (cần email/password/token/userid).' };
    }
    const cookie = await getMeowsCookie();
    if (!cookie) return { ok: false, message: 'Admin chưa lưu cookie dịch vụ nhanh (Quản trị → Cookie).' };

    const result = await requestWithFallback('https://meows.vn/api/vsphone/getss-uid', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: 'https://meows.vn',
            Referer: 'https://meows.vn/client/cloud-manager',
            'User-Agent': MEOWS_UA,
            Cookie: cookie,
        },
        body: JSON.stringify({
            token: input.token,
            user_id: input.userId,
            email: input.email,
            pass: input.password,
            cloud: 'vsphone',
        }),
        signal: AbortSignal.timeout(60000),
        timeout: 60000,
    }, { includeWww: false });

    const response = { ok: result.ok, status: result.status };
    let data = null;
    try { data = JSON.parse(result.raw); } catch (e) { /* giữ raw để báo lỗi */ }
    const error = meowsApiError(response, data, result.raw);
    if (error) {
        const detail = result.raw ? ` (body: ${result.raw.replace(/\s+/g, ' ').slice(0, 200)})` : '';
        return { ok: false, message: `${error}${detail}`, source: result.source };
    }

    const share = data || {};
    const pad = share.pad || {};
    const fields = [
        field('orderId', input.orderId),
        field('email', input.email),
        field('password', input.password),
        field('token', input.token),
        field('userid', input.userId),
    ];
    input.devices.forEach((device, index) => {
        const prefix = input.devices.length > 1 ? `device${index + 1}.` : 'device.';
        for (const key of [
            'equipmentId', 'padCode', 'configName', 'countryCode', 'padName',
            'expireTime', 'androidVersion', 'status', 'signExpirationTime',
        ]) {
            if (device[key] !== undefined && device[key] !== null && device[key] !== '') {
                fields.push(field(`${prefix}${key}`, device[key]));
            }
        }
    });
    fields.push(field('shareToken', share.shareToken));
    if (share.shareToken) {
        fields.push(field('shareUrl', `https://cloud.vsphone.com/screen/share/${share.shareToken}`));
    }
    for (const key of ['padCode', 'equipmentId', 'configName', 'countryCode', 'padName', 'expireTime']) {
        if (pad[key] !== undefined && pad[key] !== null && pad[key] !== '') {
            fields.push(field(`pad.${key}`, pad[key]));
        }
    }

    return {
        ok: true,
        source: result.source,
        account: input.email,
        password: input.password,
        token: input.token,
        userId: input.userId,
        orderId: input.orderId,
        shareToken: share.shareToken || null,
        shareUrl: share.shareToken ? `https://cloud.vsphone.com/screen/share/${share.shareToken}` : null,
        pad,
        fields,
        copyText: fields.map(f => `${f.label}: ${f.value}`).join('\n'),
        rawResponse: result.raw,
        data: share,
        message: share.message || 'Lấy link thành công',
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

    // VSPhone Fast trả full response có token/userid — parse riêng để không mất 2 field này.
    if (key === 'VSVIP') {
        const vsp = parseVsphoneFastResponse(data || raw);
        if (vsp) {
            const fields = [
                field('email', vsp.email),
                field('password', vsp.password),
                field('token', vsp.token),
                field('userid', vsp.userId),
            ];
            if (vsp.orderId) fields.unshift(field('orderId', vsp.orderId));
            return {
                ok: true,
                kind: 'vsphone-vip',
                account: vsp.email,
                password: vsp.password,
                token: vsp.token,
                userId: vsp.userId,
                orderId: vsp.orderId,
                copyText: accountCopyText(vsp),
                fields,
                details: data || raw,
                message: (data && (data.message || data.msg)) || 'Mua thành công',
                source: result.source,
            };
        }
    }

    // UGPhone trả Local Storage trong "Nội dung chính" — tách riêng, không đổ cả raw JSON.
    if (key === 'UG') {
        const payload = parseUgPhonePayload(data || raw);
        const ug = payload ? ugPhoneInfo(payload) : null;
        // Dù API đổi format vẫn trả kind=ugphone + script để FE luôn có nút Copy.
        const copyText = ug
            ? ug.copyText
            : (data ? JSON.stringify(data, null, 2) : String(raw || ''));
        const inject = await buildUgInjectSnippet({ copyText });
        return {
            ok: true,
            kind: 'ugphone',
            account: ug ? ug.id : null,
            password: ug ? ug.token : null,
            token: ug ? ug.token : null,
            userId: ug ? ug.id : null,
            copyText,
            fields: ug ? ug.fields : [],
            injectSnippet: inject.snippet,
            injectRawUrl: inject.rawUrl || null,
            injectError: inject.error || (payload ? null : 'Không tách được Local Storage UGPhone từ response'),
            injectFallback: !!inject.fallback,
            youtubeUrl: inject.youtubeUrl,
            discordUrl: inject.discordUrl,
            details: payload || data || raw,
            message: (data && (data.message || data.msg)) || 'Mua thành công',
            source: result.source,
        };
    }

    const info = extractMeowsInfo(data) || {};
    const rawText = data ? JSON.stringify(data) : raw;
    const hasAccount = info.account !== null || info.password !== null;
    return {
        ok: true,
        account: info.account,
        password: info.password,
        token: info.token,
        userId: info.userId,
        copyText: hasAccount ? accountCopyText(info) : (info.copyText || rawText),
        details: data || raw,
        message: (data && (data.message || data.msg)) || 'Mua thành công',
        source: result.source,
    };
}

// ==================== CLOUDPHONE STATUS (public) ====================
const CLOUD_STATUS_TTL_MS = 5 * 1000;
const CLOUD_STATUS_JOB_KV = 'hanami_cloud_status_job'; // tên KV cũ, giữ nguyên để không đổi schema
const CLOUD_STATUS_STALE_MS = 30 * 1000;
const VMOS_STATUS_TTL_MS = 5 * 1000;
const VSPHONE_STATUS_TTL_MS = 5 * 1000;
let cloudStatusCache = null;
let cloudStatusPromise = null;
let cloudStatusJobPromise = null;
let cloudStatusTimer = null;
let vmosOfficialCache = null;
let vmosOfficialPromise = null;
let vsphoneOfficialCache = null;
let vsphoneOfficialPromise = null;

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

/** Chỉ lấy VSPhone từ Meows; VMOS giờ đọc từ gist do job nền ghi. */
async function fetchMeowsCloudStatus() {
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
        errors.push(`ASYNCTAS: ${reason}`);
        meows = {
            vmos: { status: 'offline', message: reason, lastBuyAt: null },
            vsphone: { status: 'offline', message: reason, lastBuyAt: null },
            ts: null,
        };
    }
    return { meows, source, errors };
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} quá thời gian chờ`)), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** Chữ ký API VMOS Cloud V2: SHA256(secretKey + timestamp + path + query/body). */
function vmosApiSign(secretKey, timestamp, path, queryOrBody) {
    return crypto.createHash('sha256')
        .update(`${secretKey}${timestamp}${path}${queryOrBody || ''}`)
        .digest('hex');
}

/**
 * Gọi API chính chủ VMOS Cloud để đọc tồn kho máy.
 * Không tạo máy, không dùng tài khoản Hanami. Chỉ đọc getCloudGoodList.
 */
async function fetchVmosCloudStock({
    fetcher = (url, options) => fetch(url, options),
    accessKey = process.env.VMOS_ACCESS_KEY,
    secretKey = process.env.VMOS_SECRET_KEY,
    androidVersion = VMOS_CLOUD_ANDROID_VERSION,
} = {}) {
    if (!accessKey || !secretKey) {
        throw new Error('Chưa cấu hình VMOS_ACCESS_KEY / VMOS_SECRET_KEY.');
    }
    const path = VMOS_CLOUD_GOODS_PATH;
    const query = `androidVersion=${encodeURIComponent(androidVersion)}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = vmosApiSign(secretKey, timestamp, path, query);
    const url = `${VMOS_API_BASE}${path}?${query}`;

    let response;
    let raw;
    try {
        response = await fetcher(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Access-Key': accessKey,
                'X-Timestamp': timestamp,
                'X-Sign': sign,
                'User-Agent': 'ASYNCTAS-CloudStatus/1.0',
            },
            signal: AbortSignal.timeout(VMOS_API_TIMEOUT_MS),
            timeout: VMOS_API_TIMEOUT_MS,
        });
        raw = await response.text();
    } catch (e) {
        throw new Error(`Không gọi được VMOS Cloud API: ${String(e.message || e).slice(0, 160)}`);
    }

    let payload;
    try {
        payload = raw ? JSON.parse(raw) : null;
    } catch (e) {
        throw new Error(`VMOS Cloud API trả dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }
    if (payload && Number(payload.code) !== 200) {
        const code = payload.code === undefined ? response.status : payload.code;
        throw new Error(`VMOS Cloud API lỗi ${code}: ${String(payload.msg || payload.message || '').slice(0, 160)}`);
    }
    if (!payload || Number(payload.code) !== 200) {
        throw new Error(`VMOS Cloud API trả HTTP ${response.status} không phải JSON hợp lệ.`);
    }

    const configs = Array.isArray(payload.data && payload.data.configs) ? payload.data.configs : [];
    if (!configs.length) throw new Error('VMOS Cloud API không trả cấu hình máy nào.');

    let availableConfigs = 0;
    let soldOutConfigs = 0;
    let countryCount = 0;
    let availableCountryCount = 0;
    let vietnamAvailable = false;
    const countries = new Set();
    const availableCountries = new Set();

    for (const config of configs) {
        if (config.sellOutFlag) {
            soldOutConfigs++;
            continue;
        }
        availableConfigs++;
        for (const country of (Array.isArray(config.countryList) ? config.countryList : [])) {
            const code = country.armCountryCode;
            if (!code) continue;
            countries.add(code);
            if (!country.sellOutFlag) {
                availableCountries.add(code);
                if (code === 'VN') vietnamAvailable = true;
            }
        }
    }

    return {
        totalConfigs: configs.length,
        availableConfigs,
        soldOutConfigs,
        countryCount: countries.size,
        availableCountryCount: availableCountries.size,
        vietnamAvailable,
        androidVersion,
        checkedAt: new Date().toISOString(),
    };
}

function vmosStockToState(stock) {
    const total = Number(stock.totalConfigs) || 0;
    const available = Number(stock.availableConfigs) || 0;
    const hasMachine = available > 0;
    return {
        source: VMOS_CLOUD_SOURCE,
        status: hasMachine ? 'online' : 'offline',
        message: hasMachine
            ? `Có máy — VMOS Cloud API: ${available}/${total} cấu hình, ${Number(stock.availableCountryCount) || 0}/${Number(stock.countryCount) || 0} quốc gia còn sẵn.`
            : `VMOS Cloud API: ${total} cấu hình đang hết máy.`,
        hasMachine,
        retryable: false,
        outOfStock: !hasMachine,
        checkedAt: stock.checkedAt || new Date().toISOString(),
        totalConfigs: total,
        availableConfigs: available,
        soldOutConfigs: Number(stock.soldOutConfigs) || 0,
        countryCount: Number(stock.countryCount) || 0,
        availableCountryCount: Number(stock.availableCountryCount) || 0,
        vietnamAvailable: !!stock.vietnamAvailable,
        androidVersion: stock.androidVersion || VMOS_CLOUD_ANDROID_VERSION,
        account: '',
        accountIndex: 0,
        nextAccountIndex: 0,
        accountCount: 0,
        accountMode: 'api',
        lastBuyAt: null,
        stale: false,
        refreshing: false,
    };
}

/**
 * Đọc tồn kho TRIAL của VMOS: GET realMachineTrialAvailability (read-only, không cấp account).
 * Khác với getCloudGoodList ở trên — endpoint đó là cloud trả phí.
 */
async function fetchVmosTrialAvailability({
    fetcher = (url, options) => fetch(url, options),
    accessKey = process.env.VMOS_ACCESS_KEY,
    secretKey = process.env.VMOS_SECRET_KEY,
} = {}) {
    if (!accessKey || !secretKey) {
        throw new Error('Chưa cấu hình VMOS_ACCESS_KEY / VMOS_SECRET_KEY.');
    }
    const path = VMOS_TRIAL_AVAILABILITY_PATH;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = vmosApiSign(secretKey, timestamp, path, '');
    const url = `${VMOS_API_BASE}${path}`;

    let response;
    let raw;
    try {
        response = await fetcher(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Access-Key': accessKey,
                'X-Timestamp': timestamp,
                'X-Sign': sign,
                'User-Agent': 'ASYNCTAS-CloudStatus/1.0',
            },
            signal: AbortSignal.timeout(VMOS_API_TIMEOUT_MS),
            timeout: VMOS_API_TIMEOUT_MS,
        });
        raw = await response.text();
    } catch (e) {
        throw new Error(`Không gọi được VMOS Cloud API (trial): ${String(e.message || e).slice(0, 160)}`);
    }

    let payload;
    try {
        payload = raw ? JSON.parse(raw) : null;
    } catch (e) {
        throw new Error(`VMOS Cloud API (trial) trả dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }
    if (!payload || Number(payload.code) !== 200) {
        const code = payload && payload.code !== undefined ? payload.code : response.status;
        throw new Error(`VMOS Cloud API (trial) lỗi ${code}: ${String((payload && (payload.msg || payload.message)) || '').slice(0, 160)}`);
    }

    const rows = Array.isArray(payload.data) ? payload.data : [];
    let availableModels = 0;
    const availableTemplateIds = [];
    for (const row of rows) {
        const value = row && row.available;
        const available = value === true || value === 1 || String(value).toLowerCase() === 'true';
        if (available) {
            availableModels++;
            if (row.templateId != null) availableTemplateIds.push(row.templateId);
        }
    }

    return {
        totalModels: rows.length,
        availableModels,
        soldOutModels: rows.length - availableModels,
        availableTemplateIds,
        checkedAt: new Date().toISOString(),
    };
}

/** Chuyển tồn trial thành trạng thái hiển thị. Có ít nhất 1 model available mới coi là có máy. */
function vmosTrialToState(trial) {
    const total = Number(trial.totalModels) || 0;
    const available = Number(trial.availableModels) || 0;
    const hasMachine = available > 0;
    return {
        source: VMOS_CLOUD_SOURCE,
        status: hasMachine ? 'online' : 'offline',
        message: hasMachine
            ? `Có máy trial — VMOS Cloud API: ${available}/${total} model trial còn sẵn.`
            : `VMOS Cloud API: ${total} model trial đang hết máy.`,
        hasMachine,
        retryable: false,
        outOfStock: !hasMachine,
        checkedAt: trial.checkedAt || new Date().toISOString(),
        stockType: 'trial',
        totalModels: total,
        availableModels: available,
        soldOutModels: Number(trial.soldOutModels) || 0,
        account: '',
        accountIndex: 0,
        nextAccountIndex: 0,
        accountCount: 0,
        accountMode: 'api',
        lastBuyAt: null,
        stale: false,
        refreshing: false,
    };
}

function vmosErrorState(error, saved = null) {
    const base = vmosStateFromGist(saved, { stale: true });
    return {
        ...base,
        source: VMOS_CLOUD_SOURCE,
        status: base.hasMachine ? 'online' : 'offline',
        message: `Lỗi VMOS Cloud API (trial): ${String(error && error.message || error).slice(0, 160)} — sẽ thử lại sau 5 giây.`,
        hasMachine: base.hasMachine,
        retryable: true,
        outOfStock: false,
        stale: true,
        refreshing: false,
    };
}

/**
 * Trạng thái VMOS lấy từ API trial chính chủ, cache 5s (single-flight).
 * force=1 hoặc user gọi sau 5s -> fetch lại ngay; không đụng vào Hanami/tồn paid.
 */
async function getVmosCloudOfficialState({
    force = false,
    stockFetcher = fetchVmosTrialAvailability,
    toState = vmosTrialToState,
    ttlMs = VMOS_STATUS_TTL_MS,
    store = gistStore,
} = {}) {
    const now = Date.now();
    if (!force && vmosOfficialCache && now - vmosOfficialCache.at < ttlMs) {
        return vmosOfficialCache.value;
    }
    if (vmosOfficialPromise) return vmosOfficialPromise;

    vmosOfficialPromise = (async () => {
        let value;
        try {
            value = toState(await stockFetcher());
        } catch (e) {
            let saved = null;
            try {
                saved = await withTimeout(store.readCloudStatus(), 3000, 'Đọc gist VMOS');
            } catch (readError) { /* không làm hỏng status vì lỗi gist */ }
            value = vmosErrorState(e, saved);
        }
        vmosOfficialCache = { at: Date.now(), value };
        cloudStatusCache = null; // bắt buộc getCloudStatus trả kết quả mới sau khi API vừa đổi
        return value;
    })();

    try {
        return await vmosOfficialPromise;
    } finally {
        vmosOfficialPromise = null;
    }
}

/** Dùng cho scheduler: luôn gọi lại API chính chủ mỗi tick 5s. */
function refreshVmosCloudStatus(options = {}) {
    return getVmosCloudOfficialState({ ...options, force: true });
}

/** Helper V2 cũ (docs cũ). Giữ lại để test/đối chiếu; luồng status dùng V4 bên dưới. */
function vsphoneApiSign(secretKey, timestamp, path, queryOrBody) {
    return crypto.createHash('sha256')
        .update(`${secretKey}${timestamp}${path}${queryOrBody || ''}`)
        .digest('hex');
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key, value) {
    return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * Chữ ký VSPhone V4 (Authorization) theo example Node/Go trong docs chính chủ.
 * GET ký raw query string; PUT/POST ký raw body. Ở đây chỉ cần GET tồn kho.
 */
function vsphoneV4Headers({ accessKey, secretKey, query = '', body = null, now = new Date() } = {}) {
    if (!accessKey || !secretKey) throw new Error('Thiếu accessKey/secretKey VSPhone.');
    const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const shortDate = xDate.slice(0, 8);
    const service = 'armcloud-paas';
    const credentialScope = `${shortDate}/${service}/request`;
    const payload = body != null ? String(body) : String(query || '');
    const payloadHash = sha256Hex(payload);
    const canonical = [
        `host:${VSPHONE_API_HOST}`,
        `x-date:${xDate}`,
        `content-type:${VSPHONE_CONTENT_TYPE}`,
        'signedHeaders:content-type;host;x-content-sha256;x-date',
        `x-content-sha256:${payloadHash}`,
    ].join('\n');
    const stringToSign = [
        'HMAC-SHA256',
        xDate,
        credentialScope,
        sha256Hex(canonical),
    ].join('\n');
    const kDate = hmacSha256(secretKey, shortDate);
    const kService = hmacSha256(kDate, service);
    const signingKey = hmacSha256(kService, 'request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, `
        + 'SignedHeaders=content-type;host;x-content-sha256;x-date, '
        + `Signature=${signature}`;

    return {
        'content-type': VSPHONE_CONTENT_TYPE,
        'x-date': xDate,
        'x-host': VSPHONE_API_HOST,
        authorization,
    };
}

function vsphoneFlagTrue(value) {
    if (typeof value === 'string') return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
    return value === true || Number(value) === 1;
}

/** VSPhone trả data[] -> cloudGoodsInfo.configs[]; một số bản trả data.configs[]. */
function collectVsphoneConfigs(payload) {
    const data = payload && payload.data;
    const groups = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
    const configs = [];
    for (const group of groups) {
        if (!group || typeof group !== 'object') continue;
        const goods = group.cloudGoodsInfo && typeof group.cloudGoodsInfo === 'object' ? group.cloudGoodsInfo : null;
        const candidates = [goods && goods.configs, group.configs, goods && goods.goods];
        for (const list of candidates) {
            if (!Array.isArray(list)) continue;
            configs.push(...list.filter(item => item && typeof item === 'object'));
            break;
        }
    }
    return configs;
}

function collectVsphoneCountries(config, group) {
    const goods = group && group.cloudGoodsInfo && typeof group.cloudGoodsInfo === 'object' ? group.cloudGoodsInfo : null;
    const lists = [config && config.countryList, goods && goods.countryList, group && group.countryList];
    const rows = [];
    for (const list of lists) {
        if (Array.isArray(list)) {
            rows.push(...list.filter(item => item && typeof item === 'object'));
            break;
        }
    }
    return rows.map(row => ({
        code: String(row.armCountryCode || row.countryCode || row.code || '').toUpperCase(),
        soldOut: vsphoneFlagTrue(row.sellOutFlag) || vsphoneFlagTrue(row.soldOut),
    })).filter(row => row.code);
}

function vsphoneConfigSoldOut(config) {
    if (!config || typeof config !== 'object') return true;
    if (vsphoneFlagTrue(config.sellOutFlag) || vsphoneFlagTrue(config.soldOut)) return true;
    // Một số response không có sellOutFlag nhưng goodTimes rỗng = hết khung giờ.
    if (Array.isArray(config.goodTimes) && config.goodTimes.length === 0) return true;
    return false;
}

/**
 * Gọi API chính chủ VSPhone Cloud để đọc tồn kho máy.
 * Không dùng VSPHONE_API_KEY (chỉ dùng cho mua nhanh) và không đụng Hanami.
 */
async function fetchVsphoneCloudStock({
    fetcher = (url, options) => fetch(url, options),
    accessKey = process.env.VSPHONE_ACCESS_KEY,
    secretKey = process.env.VSPHONE_SECRET_KEY,
    androidVersion = VSPHONE_CLOUD_ANDROID_VERSION,
    now = new Date(),
} = {}) {
    if (!accessKey || !secretKey) {
        throw new Error('Chưa cấu hình VSPHONE_ACCESS_KEY / VSPHONE_SECRET_KEY.');
    }
    const path = VSPHONE_CLOUD_GOODS_PATH;
    const query = `androidVersion=${encodeURIComponent(androidVersion)}`;
    const url = `${VSPHONE_API_BASE}${path}?${query}`;

    let response;
    let raw;
    try {
        response = await fetcher(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                ...vsphoneV4Headers({ accessKey, secretKey, query, now }),
                'User-Agent': 'ASYNCTAS-CloudStatus/1.0',
            },
            signal: AbortSignal.timeout(VSPHONE_API_TIMEOUT_MS),
            timeout: VSPHONE_API_TIMEOUT_MS,
        });
        raw = await response.text();
    } catch (e) {
        throw new Error(`Không gọi được VSPhone Cloud API: ${String(e.message || e).slice(0, 160)}`);
    }

    let payload;
    try {
        payload = raw ? JSON.parse(raw) : null;
    } catch (e) {
        throw new Error(`VSPhone Cloud API trả dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }
    if (!payload || Number(payload.code) !== 200) {
        const code = payload && payload.code !== undefined ? payload.code : response.status;
        const detail = String((payload && (payload.msg || payload.message)) || '').slice(0, 160);
        const authHint = [2019, 2031, 2032, 2033].includes(Number(code))
            ? ' (kiểm tra VSPHONE_ACCESS_KEY / VSPHONE_SECRET_KEY, thời gian hệ thống và IP whitelist)' : '';
        throw new Error(`VSPhone Cloud API lỗi ${code}: ${detail}${authHint}`);
    }

    const data = payload.data;
    const groups = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
    const configs = collectVsphoneConfigs(payload);
    if (!groups.length || !configs.length) throw new Error('VSPhone Cloud API không trả cấu hình máy nào.');

    let availableConfigs = 0;
    let soldOutConfigs = 0;
    let countryCount = 0;
    let availableCountryCount = 0;
    let vietnamAvailable = false;
    const countries = new Set();
    const availableCountries = new Set();

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const goods = group && group.cloudGoodsInfo && typeof group.cloudGoodsInfo === 'object' ? group.cloudGoodsInfo : null;
        const candidates = [goods && goods.configs, group && group.configs, goods && goods.goods];
        const list = candidates.find(item => Array.isArray(item)) || [];
        for (const config of list) {
            const configCountries = collectVsphoneCountries(config, group);
            for (const country of configCountries) countries.add(country.code);

            if (vsphoneConfigSoldOut(config)) {
                soldOutConfigs++;
                continue;
            }
            availableConfigs++;
            for (const country of configCountries) {
                if (country.soldOut) continue;
                availableCountries.add(country.code);
                if (country.code === 'VN') vietnamAvailable = true;
            }
        }
    }

    return {
        totalConfigs: configs.length,
        availableConfigs,
        soldOutConfigs,
        countryCount: countries.size,
        availableCountryCount: availableCountries.size,
        vietnamAvailable,
        androidVersion,
        checkedAt: new Date().toISOString(),
    };
}

function vsphoneStockToState(stock) {
    const total = Number(stock.totalConfigs) || 0;
    const available = Number(stock.availableConfigs) || 0;
    const hasMachine = available > 0;
    return {
        source: VSPHONE_CLOUD_SOURCE,
        status: hasMachine ? 'online' : 'offline',
        message: hasMachine
            ? `Có máy — VSPhone Cloud API: ${available}/${total} cấu hình, ${Number(stock.availableCountryCount) || 0}/${Number(stock.countryCount) || 0} quốc gia còn sẵn.`
            : `VSPhone Cloud API: ${total} cấu hình đang hết máy.`,
        hasMachine,
        retryable: false,
        outOfStock: !hasMachine,
        checkedAt: stock.checkedAt || new Date().toISOString(),
        totalConfigs: total,
        availableConfigs: available,
        soldOutConfigs: Number(stock.soldOutConfigs) || 0,
        countryCount: Number(stock.countryCount) || 0,
        availableCountryCount: Number(stock.availableCountryCount) || 0,
        vietnamAvailable: !!stock.vietnamAvailable,
        androidVersion: stock.androidVersion || VSPHONE_CLOUD_ANDROID_VERSION,
        account: '',
        accountIndex: 0,
        nextAccountIndex: 0,
        accountCount: 0,
        accountMode: 'api',
        lastBuyAt: null,
        stale: false,
        refreshing: false,
    };
}

/** Fallback VSPhone nằm trong field `vsphone` của gist cloud-status (VMOS vẫn là top-level). */
function vsphoneStateFromGist(saved, { stale = false, refreshing = false } = {}) {
    const fallback = saved && saved.vsphone && typeof saved.vsphone === 'object'
        ? saved.vsphone
        : (saved && saved.source === VSPHONE_CLOUD_SOURCE ? saved : null);
    if (!fallback) {
        return {
            source: VSPHONE_CLOUD_SOURCE,
            status: 'offline',
            message: 'Đang chờ kết quả kiểm tra VSPhone Cloud API (mỗi 5 giây)...',
            hasMachine: false,
            retryable: true,
            outOfStock: false,
            lastBuyAt: null,
            checkedAt: null,
            stale: true,
            refreshing,
        };
    }
    const checkedAt = fallback.checkedAt || fallback.savedAt || null;
    return {
        source: fallback.source || VSPHONE_CLOUD_SOURCE,
        status: fallback.status || (fallback.hasMachine ? 'online' : 'offline'),
        message: String(fallback.message || ''),
        hasMachine: !!fallback.hasMachine,
        retryable: !!fallback.retryable,
        outOfStock: !!fallback.outOfStock,
        lastBuyAt: Number(fallback.lastBuyAt) || null,
        account: String(fallback.account || ''),
        accountIndex: Number(fallback.accountIndex) || 0,
        nextAccountIndex: Number.isInteger(fallback.nextAccountIndex) ? fallback.nextAccountIndex : 0,
        accountCount: Number(fallback.accountCount) || 0,
        accountMode: fallback.accountMode || 'api',
        totalConfigs: Number(fallback.totalConfigs) || 0,
        availableConfigs: Number(fallback.availableConfigs) || 0,
        soldOutConfigs: Number(fallback.soldOutConfigs) || 0,
        countryCount: Number(fallback.countryCount) || 0,
        availableCountryCount: Number(fallback.availableCountryCount) || 0,
        vietnamAvailable: !!fallback.vietnamAvailable,
        androidVersion: fallback.androidVersion || VSPHONE_CLOUD_ANDROID_VERSION,
        checkedAt,
        stale,
        refreshing,
    };
}

function vsphoneErrorState(error, saved = null) {
    const base = vsphoneStateFromGist(saved, { stale: true });
    return {
        ...base,
        source: VSPHONE_CLOUD_SOURCE,
        status: base.hasMachine ? 'online' : 'offline',
        message: `Lỗi VSPhone Cloud API: ${String(error && error.message || error).slice(0, 160)} — sẽ thử lại sau 5 giây.`,
        hasMachine: !!base.hasMachine,
        retryable: true,
        outOfStock: false,
        stale: true,
        refreshing: false,
    };
}

/**
 * Trạng thái VSPhone lấy từ API chính chủ, cache 5s (single-flight).
 * Không có AK/SK thì trả null để getCloudStatus giữ nguyên nguồn Meows cũ.
 */
async function getVsphoneCloudOfficialState({
    force = false,
    stockFetcher = fetchVsphoneCloudStock,
    ttlMs = VSPHONE_STATUS_TTL_MS,
    store = gistStore,
    enabled = vsphoneOfficialReady(),
} = {}) {
    if (!enabled) return null;
    const now = Date.now();
    if (!force && vsphoneOfficialCache && now - vsphoneOfficialCache.at < ttlMs) {
        return vsphoneOfficialCache.value;
    }
    if (vsphoneOfficialPromise) return vsphoneOfficialPromise;

    vsphoneOfficialPromise = (async () => {
        let value;
        try {
            value = vsphoneStockToState(await stockFetcher());
        } catch (e) {
            let saved = null;
            try {
                saved = await withTimeout(store.readCloudStatus(), 3000, 'Đọc gist VSPhone');
            } catch (readError) { /* không làm hỏng status vì lỗi gist */ }
            value = vsphoneErrorState(e, saved);
        }
        vsphoneOfficialCache = { at: Date.now(), value };
        cloudStatusCache = null; // bắt buộc getCloudStatus trả kết quả mới sau khi API vừa đổi
        return value;
    })();

    try {
        return await vsphoneOfficialPromise;
    } finally {
        vsphoneOfficialPromise = null;
    }
}

/** Dùng cho scheduler: luôn gọi lại API chính chủ VSPhone mỗi tick 5s. */
function refreshVsphoneCloudStatus(options = {}) {
    return getVsphoneCloudOfficialState({ ...options, force: true });
}

/** Đưa trạng thái lưu trong gist về đúng shape mà web/bot đang dùng (chỉ làm fallback khi API lỗi). */
function vmosStateFromGist(saved, { stale = false, refreshing = false } = {}) {
    if (!saved || typeof saved !== 'object') {
        return {
            source: VMOS_CLOUD_SOURCE,
            status: 'offline',
            message: 'Đang chờ kết quả kiểm tra VMOS Cloud API (mỗi 5 giây)...',
            hasMachine: false,
            retryable: true,
            outOfStock: false,
            lastBuyAt: null,
            checkedAt: null,
            stale: true,
            refreshing,
        };
    }
    const checkedAt = saved.checkedAt || saved.savedAt || null;
    // Gist cũ lưu tồn paid (không có stockType) -> không được báo "có máy" cho quà trial.
    const hasMachine = saved.stockType === 'trial' ? !!saved.hasMachine : false;
    return {
        source: saved.source || VMOS_CLOUD_SOURCE,
        status: hasMachine ? 'online' : 'offline',
        message: String(saved.message || ''),
        hasMachine,
        retryable: !!saved.retryable,
        outOfStock: saved.stockType === 'trial' ? !!saved.outOfStock : false,
        lastBuyAt: Number(saved.lastBuyAt) || null,
        account: String(saved.account || ''),
        accountIndex: Number(saved.accountIndex) || 0,
        nextAccountIndex: Number.isInteger(saved.nextAccountIndex) ? saved.nextAccountIndex : 0,
        accountCount: Number(saved.accountCount) || 0,
        accountMode: saved.accountMode || 'api',
        stockType: 'trial',
        totalModels: Number(saved.totalModels) || 0,
        availableModels: Number(saved.availableModels) || 0,
        soldOutModels: Number(saved.soldOutModels) || 0,
        checkedAt,
        stale,
        refreshing,
    };
}

/**
 * Trạng thái cloudphone public: VMOS lấy tồn trial từ API chính chủ; VSPhone giữ nguồn Meows.
 * Cache 5s: user gọi lại sau 5s tự fetch; force=1 fetch ngay. Không dùng Hanami hay tồn paid.
 * Gist chỉ là fallback khi API VMOS lỗi.
 */
async function getCloudStatus({
    force = false,
    statusFetcher = fetchMeowsCloudStatus,
    vmosFetcher = fetchVmosTrialAvailability,
    vmosStateFetcher = getVmosCloudOfficialState,
    store = gistStore,
    ttlMs = VMOS_STATUS_TTL_MS,
} = {}) {
    const now = Date.now();
    if (!force && cloudStatusCache && now - cloudStatusCache.at < CLOUD_STATUS_TTL_MS) {
        return cloudStatusCache.value;
    }
    if (cloudStatusPromise) return cloudStatusPromise;

    cloudStatusPromise = (async () => {
        const [{ meows, source, errors }, vmos] = await Promise.all([
            statusFetcher(),
            vmosStateFetcher({ force, stockFetcher: vmosFetcher, ttlMs, store }),
        ]);

        meows.vmos = { ...meows.vmos, ...vmos, refreshing: !!force };
        // VSPhone giữ nguyên dữ liệu do Meows trả về (không có API trial chính chủ).
        if (meows.vmos.retryable && meows.vmos.message) errors.push(`VMOS Cloud API: ${meows.vmos.message}`);

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

/** Job nền: đọc tồn trial VMOS từ API chính chủ rồi lưu gist (secret). Gist vẫn ghi 5p/lần. */
async function runCloudStatusProbeJob({
    minIntervalMs = 4 * 60 * 1000,
    force = true,
    fetcher = fetchVmosTrialAvailability,
    stateFetcher = getVmosCloudOfficialState,
    store = gistStore,
    dbLayer = db,
} = {}) {
    if (cloudStatusJobPromise) return cloudStatusJobPromise;

    const now = Date.now();
    if (minIntervalMs > 0) {
        try {
            const raw = await dbLayer.getKv(CLOUD_STATUS_JOB_KV);
            if (now - (Number(raw) || 0) < minIntervalMs) return { skipped: true, reason: 'recent' };
        } catch (e) { /* không chặn job vì lỗi KV */ }
    }
    try { await dbLayer.setKv(CLOUD_STATUS_JOB_KV, String(now)); } catch (e) { /* bỏ qua */ }

    cloudStatusJobPromise = (async () => {
        let state;
        try {
            state = await stateFetcher({ force, stockFetcher: fetcher, store });
        } catch (e) {
            state = vmosErrorState(e);
        }

        let saved = null;
        try {
            saved = await withTimeout(store.readCloudStatus(), 3000, 'Đọc gist cloud-status');
        } catch (e) { /* không làm hỏng job vì lỗi gist */ }

        const savedAt = new Date().toISOString();
        const value = {
            ...(state && typeof state === 'object' ? state : {}),
            source: VMOS_CLOUD_SOURCE,
            checkedAt: (state && state.checkedAt) || savedAt,
            savedAt,
        };
        // VSPhone lấy trực tiếp từ Meows; giữ lại field cũ trong gist chỉ để tương thích.
        if (saved && saved.vsphone) value.vsphone = saved.vsphone;
        try {
            await store.writeCloudStatus(value);
            cloudStatusCache = null; // job vừa ghi gist: lần xem tiếp theo lấy kết quả mới
        } catch (e) {
            console.error('[cloud-status] ghi gist lỗi:', e.message);
        }
        return value;
    })();

    try {
        return await cloudStatusJobPromise;
    } finally {
        cloudStatusJobPromise = null;
    }
}

/** Chạy ngay lúc khởi động, fetch tồn trial VMOS mỗi 5s; gist vẫn ghi mỗi 5p. */
function startVmosCloudStatusScheduler({
    intervalMs = 5 * 1000,
    fetcher = fetchVmosTrialAvailability,
    run = runCloudStatusProbeJob,
    refresh = refreshVmosCloudStatus,
} = {}) {
    if (cloudStatusTimer) return { started: false, reason: 'already_running' };
    const execute = () => Promise.resolve()
        .then(() => refresh({ stockFetcher: fetcher }))
        .then(() => run({ force: false, fetcher, minIntervalMs: 4 * 60 * 1000 }))
        .catch(e => console.error('[cloud-status] làm mới nền lỗi:', e.message));
    execute();
    cloudStatusTimer = setInterval(execute, intervalMs);
    if (cloudStatusTimer.unref) cloudStatusTimer.unref();
    return { started: true, intervalMs };
}

function stopVmosCloudStatusScheduler() {
    if (!cloudStatusTimer) return false;
    clearInterval(cloudStatusTimer);
    cloudStatusTimer = null;
    return true;
}

// ==================== HANAMI PROBE CŨ (chỉ giữ cho luồng mua/test, KHÔNG dùng cho status) ====================
let hanamiProbeCache = null;
let hanamiProbePromise = null;

function parseHanamiAccount(entry) {
    if (typeof entry === 'string') {
        const text = entry.trim();
        if (!text) return null;
        const [account, password, server] = text.split('|').map(x => x.trim());
        if (!account || !password) return null;
        return { inputData: `${account}|${password}`, label: account, server: server || null };
    }
    if (!entry || typeof entry !== 'object') return null;
    const inputData = String(entry.inputData || entry.input_data || '').trim();
    const account = String(entry.account || entry.email || entry.username || (inputData ? inputData.split('|')[0] : '')).trim();
    const password = String(entry.password || entry.pass || '').trim();
    if (!inputData && (!account || !password)) return null;
    return {
        inputData: inputData || `${account}|${password}`,
        label: String(entry.label || account).trim(),
        server: entry.server ? String(entry.server).trim() : null,
    };
}

/** Kho test: ưu tiên env HANAMI_TEST_ACCOUNTS, sau đó KV hanami_test_accounts. */
function parseHanamiAccounts(raw) {
    if (!raw) return [];
    let parsed = raw;
    if (typeof raw === 'string') {
        const text = raw.trim();
        if (!text) return [];
        try { parsed = JSON.parse(text); } catch (e) { parsed = text.split(/\r?\n/); }
    }
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.accounts)) parsed = parsed.accounts;
    if (!Array.isArray(parsed)) parsed = [parsed];
    const out = [];
    for (const entry of parsed) {
        const acc = parseHanamiAccount(entry);
        if (acc && !out.some(x => x.inputData === acc.inputData)) out.push(acc);
    }
    return out;
}

async function getHanamiTestAccounts() {
    const out = parseHanamiAccounts(process.env.HANAMI_TEST_ACCOUNTS || process.env.HANAMI_TEST_ACCOUNT);
    let fromKv = [];
    try { fromKv = parseHanamiAccounts(await db.getKv(HANAMI_TEST_ACCOUNTS_KV)); } catch (e) { /* bỏ qua */ }
    for (const acc of fromKv) {
        if (!out.some(x => x.inputData === acc.inputData)) out.push(acc);
    }
    return out;
}

async function readHanamiProbeState() {
    try {
        const raw = await db.getKv(HANAMI_PROBE_KV);
        const state = raw ? JSON.parse(raw) : null;
        return state && typeof state === 'object' ? state : {};
    } catch (e) {
        return {};
    }
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Thử mua VM bằng 1 tài khoản trong kho test. Chỉ sang tài khoản tiếp theo SAU khi mua thành công.
 * Lỗi thường (kể cả "lỗi khi thực hiện câu lệnh") -> gửi lại cùng tài khoản, KHÔNG đánh dấu hết máy.
 * Chỉ cụm HANAMI_OUT_OF_STOCK mới đánh dấu offline/hết máy. Mỗi lần probe cách nhau 5 phút.
 */
async function probeVmosCloudStatus({ force = false, buy = buyHanami, fetchAccount = regVmosAccount } = {}) {
    const now = Date.now();
    if (!force && hanamiProbeCache && now - hanamiProbeCache.at < HANAMI_PROBE_TTL_MS) {
        return hanamiProbeCache.value;
    }
    if (hanamiProbePromise) return hanamiProbePromise;

    hanamiProbePromise = (async () => {
        // Kho tự động: Hanami gọi API get-key (cùng luồng Buy Device → VMOS).
        // env/KV chỉ là override tay, để trống thì dùng auto.
        const manualAccounts = await getHanamiTestAccounts();
        const state = await readHanamiProbeState();
        const manual = manualAccounts.length > 0;
        const accountIndex = manual && Number.isInteger(state.accountIndex)
            ? ((state.accountIndex % manualAccounts.length) + manualAccounts.length) % manualAccounts.length
            : 0;
        const base = {
            source: 'hanami',
            checkedAt: new Date().toISOString(),
            accountIndex,
            nextAccountIndex: accountIndex,
            accountCount: manual ? manualAccounts.length : 0,
            accountMode: manual ? 'manual' : 'auto',
            hasMachine: !!state.hasMachine,
            lastBuyAt: Number(state.lastBuyAt) || null,
            status: state.hasMachine ? 'online' : 'offline',
            message: '',
            retryable: false,
            outOfStock: false,
        };

        let autoAccount = null;
        let autoFetchError = null;
        if (!manual) {
            if (state.accountInputData) {
                // Lỗi trước đó: giữ nguyên tài khoản này cho đến khi mua thành công.
                autoAccount = {
                    inputData: state.accountInputData,
                    label: String(state.accountLabel || state.accountInputData.split('|')[0] || 'Hanami'),
                    server: state.accountServer || null,
                    auto: true,
                };
            } else {
                for (let i = 0; i < 3; i++) {
                    try {
                        const fetched = await fetchAccount();
                        const inputData = String(fetched?.copyText || (fetched?.account && fetched?.password
                            ? `${fetched.account}|${fetched.password}` : '')).trim();
                        if (!inputData) throw new Error('API get-key không trả tài khoản.');
                        if (inputData === state.lastAccountInputData && i < 2) continue; // sau success phải sang acc khác
                        autoAccount = {
                            inputData,
                            label: String(fetched.account || inputData.split('|')[0]),
                            server: null,
                            auto: true,
                        };
                        break;
                    } catch (e) {
                        autoFetchError = e;
                        break;
                    }
                }
            }
            base.accountCount = autoAccount ? 1 : 0;
        }

        const saveValue = async (patch, { clearAutoAccount = false } = {}) => {
            const value = { ...base, ...patch };
            hanamiProbeCache = { at: Date.now(), value };
            try {
                await db.setKv(HANAMI_PROBE_KV, JSON.stringify({
                    ...state,
                    accountIndex: value.nextAccountIndex,
                    hasMachine: value.hasMachine,
                    lastBuyAt: value.lastBuyAt,
                    lastAttemptAt: Date.now(),
                    lastMessage: value.message,
                    accountInputData: clearAutoAccount ? null : (autoAccount ? autoAccount.inputData : (state.accountInputData || null)),
                    accountLabel: clearAutoAccount ? null : (autoAccount ? autoAccount.label : (state.accountLabel || null)),
                    accountServer: clearAutoAccount ? null : (autoAccount ? autoAccount.server : (state.accountServer || null)),
                    lastAccountInputData: value.lastAccountInputData || state.lastAccountInputData || null,
                }));
            } catch (e) { /* không làm hỏng status vì lỗi KV */ }
            return value;
        };

        if (!manual && !autoAccount) {
            return await saveValue({
                status: 'offline',
                message: autoFetchError
                    ? `Không lấy được tài khoản Hanami tự động: ${String(autoFetchError.message || autoFetchError).slice(0, 160)}`
                    : 'Không lấy được tài khoản test Hanami từ API get-key.',
                retryable: true,
            });
        }
        if (!process.env.HANAMI_TOKEN) {
            return await saveValue({ status: 'offline', message: 'Bot chưa cấu hình HANAMI_TOKEN.' });
        }

        const account = manual ? manualAccounts[accountIndex] : autoAccount;
        let result = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                // Probe tự retry ở dưới, nên tắt auto retry bên trong buyHanami để không gọi trùng.
                result = await buy('VM', account.server, account.inputData, { autoRetry: false });
            } catch (e) {
                result = { ok: false, message: e.message, outOfStock: false, retryable: true };
            }
            if (result.ok || result.outOfStock) break;
            if (attempt === 0) await waitMs(HANAMI_COMMAND_ERROR_MS); // lỗi khi thực hiện lệnh -> gửi lại sau 1s cùng tài khoản
        }

        if (result.ok) {
            return await saveValue({
                status: 'online',
                message: 'Có máy — Hanami mua VM thành công. Đang chuyển sang tài khoản test tiếp theo.',
                hasMachine: true,
                retryable: false,
                outOfStock: false,
                lastBuyAt: Date.now(),
                account: account.label,
                nextAccountIndex: manual ? (accountIndex + 1) % manualAccounts.length : accountIndex,
                lastAccountInputData: manual ? state.lastAccountInputData : account.inputData,
            }, { clearAutoAccount: !manual });
        }
        if (result.outOfStock) {
            return await saveValue({
                status: 'offline',
                message: HANAMI_OUT_OF_STOCK,
                hasMachine: false,
                retryable: false,
                outOfStock: true,
                account: account.label,
            });
        }
        // Mọi lỗi khác: retry, giữ nguyên tài khoản cho đến khi mua thành công.
        return await saveValue({
            status: state.hasMachine ? 'online' : 'offline',
            message: `Lỗi khi thực hiện lệnh Hanami (${String(result.message || '').slice(0, 180)}) — giữ tài khoản này, sẽ thử lại.`,
            retryable: true,
            outOfStock: false,
            account: account.label,
        });
    })();

    try {
        return await hanamiProbePromise;
    } finally {
        hanamiProbePromise = null;
    }
}

function resetHanamiProbe() {
    hanamiProbeCache = null;
    hanamiProbePromise = null;
    return db.setKv(HANAMI_PROBE_KV, JSON.stringify({}));
}

module.exports = {
    HANAMI_URL,
    HANAMI_OUT_OF_STOCK,
    CLOUD_NAMES,
    REG_COST,
    DEVICE_COSTS,
    MEOWS_COOKIE_KEY,
    MEOWS_COSTS,
    MEOWS_NAMES,
    DEVICE_LOGOS,
    vsphoneReady,
    buyHanami,
    buyHanamiOnce,
    isHanamiCommandError,
    regVmosAccount,
    regVsphoneAccount,
    normalizeMeowsCookie,
    getMeowsCookie,
    parseLooseJson,
    parseUgPhonePayload,
    ugPhoneInfo,
    buyMeows,
    parseVsphoneFastResponse,
    parseVsphonePipe,
    accountCopyText,
    buildUgInjectSnippet,
    extractMeowsInfo,
    getVsphoneShareLink,
    normalizeStatusProxy,
    VMOS_API_BASE,
    VMOS_CLOUD_GOODS_PATH,
    VMOS_TRIAL_AVAILABILITY_PATH,
    VMOS_CLOUD_ANDROID_VERSION,
    VMOS_CLOUD_SOURCE,
    vmosApiSign,
    fetchVmosCloudStock,
    vmosStockToState,
    fetchVmosTrialAvailability,
    vmosTrialToState,
    getVmosCloudOfficialState,
    refreshVmosCloudStatus,
    VSPHONE_API_BASE,
    VSPHONE_CLOUD_GOODS_PATH,
    VSPHONE_CLOUD_ANDROID_VERSION,
    VSPHONE_CLOUD_SOURCE,
    VSPHONE_API_HOST,
    VSPHONE_CONTENT_TYPE,
    vsphoneOfficialReady,
    vsphoneApiSign,
    vsphoneV4Headers,
    fetchVsphoneCloudStock,
    vsphoneStockToState,
    getVsphoneCloudOfficialState,
    refreshVsphoneCloudStatus,
    vsphoneStateFromGist,
    getCloudStatus,
    probeVmosCloudStatus,
    runCloudStatusProbeJob,
    startVmosCloudStatusScheduler,
    stopVmosCloudStatusScheduler,
    vmosStateFromGist,
    resetHanamiProbe,
    getHanamiTestAccounts,
    parseHanamiAccounts,
    isHanamiOutOfStock,
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
