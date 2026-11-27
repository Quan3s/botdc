/**
 * Card2K API v3 (REST) — gửi thẻ đổi xu + lấy mã nạp ngân hàng.
 * Không gọi check, không mua thẻ. Webhook là nguồn cộng xu chính.
 * Key nằm hoàn toàn ở server: CARD2K_API_KEY.
 */
const crypto = require('crypto');

const BASE_URL = 'https://card2k.net';
const EXCHANGE_PATH = '/api/v3/card-exchanges';
const DEPOSIT_PATH = '/api/v3/deposits';
const TELCOS = ['VIETTEL', 'VINAPHONE', 'MOBIFONE', 'VIETNAMOBILE', 'ZING', 'GARENA', 'GATE', 'VCOIN', 'APPOTA', 'CAROT'];

function apiKey() {
    return String(process.env.CARD2K_API_KEY || '').trim();
}

function configured() {
    return !!apiKey();
}

function normalizeTelco(value) {
    const raw = String(value || '').trim().toUpperCase();
    const alias = { MOBI: 'MOBIFONE', VINA: 'VINAPHONE', VMOBILE: 'VIETNAMOBILE' };
    const telco = alias[raw] || raw;
    return TELCOS.includes(telco) ? telco : null;
}

/** Mã tham chiếu của mình, gửi lại cùng thẻ để Card2K chặn trùng. */
function newReference() {
    return `at${crypto.randomBytes(12).toString('hex')}`; // 26 ký tự
}

function sign(raw, key = apiKey()) {
    return `sha256=${crypto.createHmac('sha256', key).update(raw).digest('hex')}`;
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

/** Verify webhook V2: HMAC-SHA256(timestamp + "." + rawBody, api_key). */
function verifyWebhook(req) {
    const key = apiKey();
    if (!key) return false;
    const timestamp = String(req.get('x-webhook-timestamp') || '');
    const raw = req.rawBody != null ? String(req.rawBody) : JSON.stringify(req.body || {});
    const signature = String(req.get('x-signature-v2') || req.get('x-signature') || '');
    if (!timestamp || !signature) return false;
    const drift = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(drift) || drift > 5 * 60) return false;
    const expected = signature.startsWith('sha256=')
        ? sign(`${timestamp}.${raw}`, key)
        : sign(`${timestamp}.${raw}`, key).slice(7);
    return safeEqual(signature, expected);
}

/**
 * Gửi thẻ qua REST. Card2K trả HTTP 201 + status pending; kết quả gửi qua webhook.
 * Trả { ok, data } hoặc { ok:false, code, message }.
 */
async function submitExchange({ telco, amount, serial, code, reference }) {
    if (!configured()) return { ok: false, code: 'not_configured', message: 'Card2K chưa được cấu hình (CARD2K_API_KEY).' };
    const cleanTelco = normalizeTelco(telco);
    if (!cleanTelco) return { ok: false, code: 'invalid_telco', message: 'Nhà mạng không hợp lệ.' };
    const value = parseInt(amount, 10);
    if (!Number.isFinite(value) || value < 10000) return { ok: false, code: 'invalid_amount', message: 'Mệnh giá tối thiểu 10.000đ.' };

    let res;
    try {
        res = await fetch(`${BASE_URL}${EXCHANGE_PATH}`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey()}`,
            },
            body: JSON.stringify({
                telco: cleanTelco,
                value,
                serial: String(serial || '').trim(),
                code: String(code || '').trim(),
                reference: String(reference || newReference()),
            }),
            signal: AbortSignal.timeout(20000),
        });
    } catch (e) {
        return { ok: false, code: 'network_error', message: `Không kết nối được Card2K: ${e.message}` };
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* xử lý bên dưới */ }
    if (res.ok && json && json.data) return { ok: true, data: json.data, status: res.status };
    const error = (json && json.error) || {};
    return {
        ok: false,
        status: res.status,
        code: error.code || `http_${res.status}`,
        message: error.message || (json && json.message) || `Card2K trả lỗi (HTTP ${res.status}).`,
    };
}

/** Gọi API ví: POST /deposits (mã đang hiện hoặc mã mới), GET /deposits/{code}. */
async function callDepositApi(path, method = 'GET') {
    if (!configured()) return { ok: false, code: 'not_configured', message: 'Card2K chưa được cấu hình (CARD2K_API_KEY).' };
    let res;
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey()}` },
            signal: AbortSignal.timeout(20000),
        });
    } catch (e) {
        return { ok: false, code: 'network_error', message: `Không kết nối được Card2K: ${e.message}` };
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* xử lý bên dưới */ }
    if (res.ok && json && json.data) return { ok: true, data: json.data, status: res.status };
    const error = (json && json.error) || {};
    return {
        ok: false,
        status: res.status,
        code: error.code || `http_${res.status}`,
        message: error.message || (json && json.message) || `Card2K trả lỗi (HTTP ${res.status}).`,
    };
}

function requestDeposit() {
    return callDepositApi(DEPOSIT_PATH, 'POST');
}

function getDeposit(code) {
    const clean = String(code || '').trim();
    if (!clean) return Promise.resolve({ ok: false, code: 'invalid_deposit', message: 'Mã nạp không hợp lệ.' });
    return callDepositApi(`${DEPOSIT_PATH}/${encodeURIComponent(clean)}`, 'GET');
}

module.exports = {
    BASE_URL,
    EXCHANGE_PATH,
    DEPOSIT_PATH,
    TELCOS,
    apiKey,
    configured,
    normalizeTelco,
    newReference,
    sign,
    verifyWebhook,
    submitExchange,
    requestDeposit,
    getDeposit,
};
