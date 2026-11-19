/**
 * Tiện ích dùng chung.
 */
const crypto = require('crypto');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const LINK_TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LINK_TOKEN_LENGTH = 64;

/** Date object đã dịch sang giờ VN (UTC+7). */
function vnNow() {
    return new Date(Date.now() + VN_OFFSET_MS);
}

/** Chuỗi ngày YYYY-MM-DD theo giờ VN. */
function getTodayString(date = vnNow()) {
    return date.toISOString().split('T')[0];
}

/** Sinh token 64 ký tự (chữ hoa + chữ thường + số), đảm bảo có đủ cả 3 loại. */
function generateLinkToken() {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const chars = [];
    const pick = (set) => set[crypto.randomInt(0, set.length)];
    chars.push(pick(upper), pick(lower), pick(digits));
    while (chars.length < LINK_TOKEN_LENGTH) chars.push(pick(LINK_TOKEN_ALPHABET));
    // Fisher–Yates với nguồn ngẫu nhiên an toàn
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

/** Sinh token chưa tồn tại trong DB (tối đa 10 lần thử). */
async function generateUniqueLinkToken(db) {
    for (let i = 0; i < 10; i++) {
        const token = generateLinkToken();
        const existing = await db.getWebUserByLinkToken(token);
        if (!existing) return token;
    }
    throw new Error('Không sinh được token duy nhất, thử lại sau.');
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomId() {
    return crypto.randomUUID();
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
    try {
        const [scheme, salt, hash] = String(stored).split('$');
        if (scheme !== 'scrypt' || !salt || !hash) return false;
        const derived = crypto.scryptSync(String(password), salt, 64);
        const expected = Buffer.from(hash, 'hex');
        return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch (e) {
        return false;
    }
}

module.exports = {
    VN_OFFSET_MS,
    LINK_TOKEN_LENGTH,
    vnNow,
    getTodayString,
    generateLinkToken,
    generateUniqueLinkToken,
    sha256,
    randomId,
    hashPassword,
    verifyPassword,
};
