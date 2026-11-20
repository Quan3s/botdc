/**
 * Web dashboard: API + phục vụ giao diện tĩnh.
 *
 * Đăng ký / đăng nhập tài khoản web riêng, liên kết Discord bằng token 64 ký tự,
 * shop (kho lưu trên GitHub Gist), mua device, nhiệm vụ vượt link, bảng xếp hạng,
 * chuyển coin, hồ sơ và trang admin.
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const db = require('./database');
const services = require('./services');
const shop = require('./shop');
const github = require('./github');
const weekly = require('./weekly');
const pluginEngine = require('./plugin-engine');
const { getTodayString, generateUniqueLinkToken, sha256, randomId, hashPassword, verifyPassword } = require('./utils');

const router = express.Router();
const COOKIE_NAME = 'asynctas_session';
const SESSION_DAYS = 30;
const LINK_REWARD = 50;
const LINK_DAILY_MAX = 2;
const PAY_MIN = 10;
const PAY_FEE_RATE = 0.05;
const REG_COST = services.REG_COST;
const busyUsers = new Set();

// ==================== TIỆN ÍCH ====================
function ah(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    }
    return out;
}

function envAdminIds() {
    return (process.env.ADMIN_DISCORD_ID || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function isDiscordAdmin(discordId) {
    if (!discordId) return false;
    if (envAdminIds().includes(String(discordId))) return true;
    try { return await db.isAdmin(discordId); } catch (e) { return false; }
}

function balanceKey(user) {
    return user.discord_id ? String(user.discord_id) : `web_${user.id}`;
}

async function publicUser(user) {
    const balance = await db.getCoins(balanceKey(user));
    const admin = await isDiscordAdmin(user.discord_id);
    return {
        id: user.id,
        username: user.username,
        discordId: user.discord_id || null,
        linked: !!user.discord_id,
        isAdmin: admin,
        balance,
        linkToken: user.link_token,
        createdAt: user.created_at,
    };
}

function setSessionCookie(req, res, rawToken) {
    const secure = process.env.COOKIE_SECURE === '1' || req.secure;
    const maxAge = SESSION_DAYS * 24 * 60 * 60;
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

async function createSession(req, res, userId) {
    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.createWebSession(sha256(raw), userId, expiresAt);
    setSessionCookie(req, res, raw);
    return sha256(raw);
}

async function refreshSessionUser(req) {
    if (req.webUser) req.webUser = await db.getWebUserById(req.webUser.id);
}

// rate limit đơn giản trong bộ nhớ
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
        rateBuckets.set(key, { count: 1, reset: now + windowMs });
        return true;
    }
    if (bucket.count >= max) return false;
    bucket.count++;
    return true;
}

router.use(express.json({ limit: '2mb' }));
router.use(express.urlencoded({ extended: true }));

// nạp user từ cookie cho mọi request
router.use(ah(async (req, res, next) => {
    req.webUser = null;
    req.sessionId = null;
    const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (raw) {
        const session = await db.getWebSession(sha256(raw));
        if (session) {
            const user = await db.getWebUserById(session.user_id);
            if (user) {
                req.webUser = user;
                req.sessionId = sha256(raw);
            }
        }
    }
    next();
}));

function requireAuth(req, res, next) {
    if (!req.webUser) return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
    next();
}

async function requireAdmin(req, res, next) {
    if (!req.webUser) return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
    if (!(await isDiscordAdmin(req.webUser.discord_id))) {
        return res.status(403).json({ error: 'Chỉ admin (đã liên kết Discord) mới truy cập được.' });
    }
    next();
}

function toInt(value, fallback = 0) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function validHttpUrl(value) {
    try {
        const u = new URL(String(value));
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

// Tên đăng nhập phải có ít nhất 1 chữ cái
function usernameHasLetter(value) {
    return /[A-Za-z]/.test(String(value || ''));
}

// Lấy tên Discord thật để hiển thị BXH (cache trong RAM)
const discordNameCache = new Map();
async function discordUsername(id) {
    const key = String(id || '');
    if (!/^\d{15,25}$/.test(key)) return null;
    if (discordNameCache.has(key)) return discordNameCache.get(key);
    const token = process.env.DISCORD_TOKEN;
    if (!token) return null;
    try {
        const res = await fetch(`https://discord.com/api/v10/users/${key}`, {
            headers: { Authorization: `Bot ${token}` },
            signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) { discordNameCache.set(key, null); return null; }
        const data = await res.json();
        const name = data.global_name || data.username || null;
        discordNameCache.set(key, name);
        return name;
    } catch (e) {
        return null;
    }
}

// ==================== AUTH ====================
router.post('/api/auth/register', ah(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`reg:${ip}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng đợi.' });

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        return res.status(400).json({ error: 'Tên đăng nhập 3-24 ký tự, chỉ gồm chữ, số và dấu gạch dưới.' });
    }
    if (!usernameHasLetter(username)) {
        return res.status(400).json({ error: 'Tên đăng nhập phải có ít nhất 1 chữ cái.' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });

    const existing = await db.getWebUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });

    const linkToken = await generateUniqueLinkToken(db);
    const user = await db.createWebUser({
        id: randomId(),
        username,
        password_hash: hashPassword(password),
        link_token: linkToken,
    });
    await createSession(req, res, user.id);
    res.json({ user: await publicUser(user) });
}));

router.post('/api/auth/login', ah(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`login:${ip}`, 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng đợi.' });

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await db.getWebUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
    }
    if (!usernameHasLetter(user.username)) {
        return res.status(403).json({
            error: 'Tên đăng nhập của bạn chỉ có số. Hãy đổi tên trước khi tiếp tục.',
            requiresUsernameChange: true,
            currentUsername: user.username,
        });
    }
    await createSession(req, res, user.id);
    res.json({ user: await publicUser(user) });
}));

// Đổi tên cho tài khoản cũ chỉ toàn số (chưa cần session, dùng mật khẩu để xác thực)
router.post('/api/auth/claim-username', ah(async (req, res) => {
    const currentUsername = String(req.body.currentUsername || '').trim();
    const newUsername = String(req.body.newUsername || '').trim();
    const password = String(req.body.password || '');
    const token = String(req.body.token || '').trim();

    const user = await db.getWebUserByUsername(currentUsername);
    if (!user) return res.status(401).json({ error: 'Thông tin xác thực không đúng.' });
    const tokenUser = token ? await db.getWebUserByLinkToken(token) : null;
    if (!verifyPassword(password, user.password_hash) && !(tokenUser && tokenUser.id === user.id)) {
        return res.status(401).json({ error: 'Thông tin xác thực không đúng.' });
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(newUsername) || !usernameHasLetter(newUsername)) {
        return res.status(400).json({ error: 'Tên mới 3-24 ký tự, có ít nhất 1 chữ cái.' });
    }
    const exists = await db.getWebUserByUsername(newUsername);
    if (exists && exists.id !== user.id) return res.status(409).json({ error: 'Tên này đã được dùng.' });

    await db.updateWebUser(user.id, { username: newUsername, username_lower: newUsername.toLowerCase() });
    user.username = newUsername;
    user.username_lower = newUsername.toLowerCase();
    await createSession(req, res, user.id);
    res.json({ user: await publicUser(user) });
}));

// Đăng nhập bằng token Discord (token cố định = link_token trên web)
router.post('/api/auth/discord-token', ah(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`tok:${ip}`, 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng đợi.' });

    const token = String(req.body.token || '').trim();
    if (!/^[A-Za-z0-9]{64}$/.test(token)) {
        return res.status(400).json({ error: 'Token phải đúng 64 ký tự chữ và số.' });
    }
    const user = await db.getWebUserByLinkToken(token);
    if (!user) return res.status(401).json({ error: 'Token không hợp lệ.' });
    if (!usernameHasLetter(user.username)) {
        return res.status(403).json({
            error: 'Tên đăng nhập của bạn chỉ có số. Hãy đổi tên trước khi tiếp tục.',
            requiresUsernameChange: true,
            currentUsername: user.username,
            token,
        });
    }
    await createSession(req, res, user.id);
    res.json({ user: await publicUser(user) });
}));

router.post('/api/auth/logout', ah(async (req, res) => {
    if (req.sessionId) await db.deleteWebSession(req.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
}));

router.get('/api/me', ah(async (req, res) => {
    if (!req.webUser) return res.json({ user: null });
    res.json({ user: await publicUser(req.webUser) });
}));

// ==================== HỒ SƠ ====================
router.post('/api/profile/password', requireAuth, ah(async (req, res) => {
    const current = String(req.body.currentPassword || '');
    const next = String(req.body.newPassword || '');
    if (!verifyPassword(current, req.webUser.password_hash)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
    if (next.length < 6) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 6 ký tự.' });
    await db.updateWebUser(req.webUser.id, { password_hash: hashPassword(next) });
    await db.deleteWebSessionsForUser(req.webUser.id, req.sessionId);
    res.json({ ok: true });
}));

router.post('/api/profile/token', requireAuth, ah(async (req, res) => {
    if (req.webUser.discord_id) return res.status(400).json({ error: 'Tài khoản đã liên kết Discord, không cần token nữa.' });
    const token = await generateUniqueLinkToken(db);
    const updated = await db.updateWebUser(req.webUser.id, { link_token: token });
    res.json({ linkToken: updated.link_token });
}));

router.post('/api/profile/username', requireAuth, ah(async (req, res) => {
    const newUsername = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!verifyPassword(password, req.webUser.password_hash)) return res.status(400).json({ error: 'Mật khẩu không đúng.' });
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(newUsername) || !usernameHasLetter(newUsername)) {
        return res.status(400).json({ error: 'Tên mới 3-24 ký tự, có ít nhất 1 chữ cái.' });
    }
    const exists = await db.getWebUserByUsername(newUsername);
    if (exists && exists.id !== req.webUser.id) return res.status(409).json({ error: 'Tên này đã được dùng.' });
    await db.updateWebUser(req.webUser.id, { username: newUsername, username_lower: newUsername.toLowerCase() });
    await refreshSessionUser(req);
    res.json({ ok: true, username: newUsername });
}));

// ==================== CHUYỂN COIN ====================
async function resolveTarget(to, selfUser) {
    const raw = String(to || '').trim();
    if (!raw) throw new Error('Nhập người nhận.');
    if (/^\d{15,25}$/.test(raw)) {
        if (selfUser.discord_id && selfUser.discord_id === raw) throw new Error('Không thể tự chuyển cho chính mình.');
        return { key: raw, label: `Discord ${raw}` };
    }
    const target = await db.getWebUserByUsername(raw);
    if (!target) throw new Error('Không tìm thấy người nhận (nhập username web hoặc ID Discord).');
    if (target.id === selfUser.id) throw new Error('Không thể tự chuyển cho chính mình.');
    return { key: balanceKey(target), label: target.username };
}

router.post('/api/transfers', requireAuth, ah(async (req, res) => {
    const amount = toInt(req.body.amount, 0);
    if (amount < PAY_MIN) return res.status(400).json({ error: `Số coin tối thiểu mỗi lần chuyển là ${PAY_MIN}.` });

    let target;
    try { target = await resolveTarget(req.body.to, req.webUser); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const fromKey = balanceKey(req.webUser);
    const balance = await db.getCoins(fromKey);
    if (balance < amount) return res.status(400).json({ error: `Bạn không đủ coin. Số dư: ${balance}.` });

    const fee = Math.ceil(amount * PAY_FEE_RATE);
    const received = amount - fee;

    const newBalance = await db.updateCoins(fromKey, -amount);
    try {
        await db.updateCoins(target.key, received);
    } catch (e) {
        await db.updateCoins(fromKey, amount).catch(() => {});
        throw e;
    }
    await db.createTransfer({
        id: randomId(),
        from_user_id: req.webUser.id,
        from_label: req.webUser.username,
        to_label: target.label,
        to_balance_key: target.key,
        amount,
        fee,
    });
    res.json({ ok: true, newBalance, fee, received, to: target.label });
}));

router.get('/api/transfers', requireAuth, ah(async (req, res) => {
    const list = await db.getTransfersByUser(req.webUser.id, 50);
    res.json({ transfers: list });
}));

// ==================== GIFT CODE ====================
router.post('/api/giftcode', requireAuth, ah(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`gift:${ip}`, 30, 15 * 60 * 1000)) return res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng đợi.' });

    const code = String(req.body.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Nhập mã gift code.' });
    const amount = await db.redeemGiftCode(code);
    if (!amount) return res.status(400).json({ error: 'Gift code không hợp lệ hoặc đã được dùng.' });

    const newBalance = await db.updateCoins(balanceKey(req.webUser), amount);
    res.json({ ok: true, amount, newBalance });
}));

// ==================== SHOP ====================
function publicItem(item) {
    return {
        id: item.id,
        name: item.name,
        description: item.description || '',
        price: Number(item.price) || 0,
        logoUrl: item.logo_url || '',
        category: item.category || 'shop',
        stock: Number(item.stock) || 0,
        active: item.active !== false,
    };
}

router.get('/api/shop', requireAuth, ah(async (req, res) => {
    const items = await db.getShopItems(true);
    res.json({ items: items.map(publicItem), gistEnabled: shop.useGist() });
}));

router.post('/api/shop/buy', requireAuth, ah(async (req, res) => {
    const itemId = String(req.body.itemId || '');
    const quantity = toInt(req.body.quantity, 1);
    if (quantity < 1 || quantity > 50) return res.status(400).json({ error: 'Số lượng từ 1-50.' });

    const item = await db.getShopItem(itemId);
    if (!item || item.active === false) return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    if (Number(item.stock) < quantity) return res.status(400).json({ error: `Kho chỉ còn ${item.stock} sản phẩm.` });

    const total = Number(item.price) * quantity;
    const key = balanceKey(req.webUser);
    const balance = await db.getCoins(key);
    if (balance < total) return res.status(400).json({ error: `Bạn không đủ coin (cần ${total}). Số dư: ${balance}.` });

    const newBalance = await db.updateCoins(key, -total);
    let taken;
    try {
        taken = await shop.takeStock(item, quantity);
    } catch (e) {
        await db.updateCoins(key, total).catch(() => {});
        return res.status(400).json({ error: e.message });
    }
    await shop.persistStock(item, taken.stockFields);
    const purchase = await db.createPurchase({
        id: randomId(),
        web_user_id: req.webUser.id,
        item_id: item.id,
        item_name: item.name,
        quantity,
        unit_price: Number(item.price),
        total_price: total,
        accounts: taken.accounts.join('\n'),
    });
    res.json({
        ok: true,
        purchaseId: purchase.id,
        accounts: taken.accounts,
        remaining: taken.remaining,
        total,
        newBalance,
    });
}));

router.get('/api/purchases', requireAuth, ah(async (req, res) => {
    const purchases = await db.getPurchasesByUser(req.webUser.id, 100);
    res.json({
        purchases: purchases.map(p => ({
            id: p.id,
            itemName: p.item_name,
            quantity: Number(p.quantity) || 0,
            unitPrice: Number(p.unit_price) || 0,
            totalPrice: Number(p.total_price) || 0,
            accounts: String(p.accounts || '').split('\n').filter(Boolean),
            createdAt: p.created_at,
        })),
    });
}));

// ==================== CLOUDPHONE STATUS (public) ====================
router.get('/api/status/cloud', ah(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`cloud:${ip}`, 30, 60 * 1000)) return res.status(429).json({ error: 'Quá nhiều lần kiểm tra, vui lòng đợi.' });
    const data = await services.getCloudStatus({ force: req.query.force === '1' });
    res.json(data);
}));

// ==================== DEVICE ====================
router.post('/api/device/buycloud', requireAuth, ah(async (req, res) => {
    const provider = String(req.body.provider || '').toUpperCase();
    const server = req.body.server ? String(req.body.server).toUpperCase() : null;
    const inputData = String(req.body.inputData || '').trim();

    if (!['UG', 'VM', 'VS'].includes(provider)) return res.status(400).json({ error: 'Provider không hợp lệ.' });
    if (provider === 'UG' && !server) return res.status(400).json({ error: 'UGPhone cần chọn server.' });
    if (!inputData) return res.status(400).json({ error: 'Nhập dữ liệu (tài khoản|mật khẩu hoặc Local Storage).' });
    if (provider === 'VM' && !inputData.includes('|')) return res.status(400).json({ error: 'Định dạng: tài khoản|mật khẩu' });

    const result = await services.buyHanami(provider, server, inputData);
    if (!result.ok) return res.status(400).json({ error: result.message });
    res.json({ ok: true, message: result.message, provider: services.CLOUD_NAMES[provider], server });
}));

router.post('/api/device/reg', requireAuth, ah(async (req, res) => {
    const service = String(req.body.service || '').toLowerCase();
    if (!['vmos', 'vsphone'].includes(service)) return res.status(400).json({ error: 'Dịch vụ không hợp lệ.' });

    const key = balanceKey(req.webUser);
    if (busyUsers.has(key)) return res.status(409).json({ error: 'Bạn đang có thao tác khác, thử lại sau.' });

    const balance = await db.getCoins(key);
    if (balance < REG_COST) return res.status(400).json({ error: `Bạn không đủ coin (cần ${REG_COST}). Số dư: ${balance}.` });

    busyUsers.add(key);
    try {
        const result = service === 'vmos' ? await services.regVmosAccount() : await services.regVsphoneAccount();
        const newBalance = await db.updateCoins(key, -REG_COST);
        res.json({
            ok: true,
            service,
            account: result.account,
            password: result.password,
            token: result.token || null,
            userId: result.userId || null,
            copyText: result.copyText,
            newBalance,
        });
    } finally {
        busyUsers.delete(key);
    }
}));

// Mua device qua Meows (UGPhone 49 xu / VSPhone VIP 15 xu)
router.post('/api/device/meows', requireAuth, ah(async (req, res) => {
    const provider = String(req.body.provider || '').toUpperCase();
    const cost = services.MEOWS_COSTS[provider];
    if (!cost) return res.status(400).json({ error: 'Dịch vụ không hợp lệ.' });

    const key = balanceKey(req.webUser);
    if (busyUsers.has(key)) return res.status(409).json({ error: 'Bạn đang có thao tác khác, thử lại sau.' });

    const balance = await db.getCoins(key);
    if (balance < cost) return res.status(400).json({ error: `Bạn không đủ coin (cần ${cost}). Số dư: ${balance}.` });

    busyUsers.add(key);
    try {
        const result = await services.buyMeows(provider);
        const newBalance = await db.updateCoins(key, -cost);
        res.json({
            ok: true,
            provider: services.MEOWS_NAMES[provider],
            cost,
            account: result.account,
            password: result.password,
            token: result.token || null,
            userId: result.userId || null,
            copyText: result.copyText,
            details: result.details,
            message: result.message,
            source: result.source,
            newBalance,
        });
    } finally {
        busyUsers.delete(key);
    }
}));

// ==================== NHIỆM VỤ VƯỢT LINK ====================
router.get('/api/tasks', requireAuth, ah(async (req, res) => {
    const key = balanceKey(req.webUser);
    const today = getTodayString();
    const period = await weekly.getLinkPeriod();
    const [link4m, layma, star, weeklyCount] = await Promise.all([
        db.checkDailyLimit(key, 'link4m', today),
        db.checkDailyLimit(key, 'layma', today),
        db.checkDailyLimit(key, 'star', today),
        db.getLinkCount(key, period),
    ]);
    res.json({
        reward: LINK_REWARD,
        dailyMax: LINK_DAILY_MAX,
        daily: { link4m, layma },
        weeklyCount,
        period,
        star,
        rewards: weekly.REWARDS,
        link4mReady: !!process.env.LINK4M_API_KEY,
        laymaReady: !!process.env.LAYMA_TOKEN,
    });
}));

router.post('/api/tasks/link', requireAuth, ah(async (req, res) => {
    const provider = String(req.body.provider || 'link4m').toLowerCase();
    if (!['link4m', 'layma'].includes(provider)) return res.status(400).json({ error: 'Dịch vụ không hợp lệ.' });

    const key = balanceKey(req.webUser);
    const today = getTodayString();
    const count = await db.checkDailyLimit(key, provider, today);
    if (count >= LINK_DAILY_MAX) return res.status(400).json({ error: 'Bạn đã đạt giới hạn 2 lần/ngày cho dịch vụ này.' });

    const sid = crypto.randomBytes(16).toString('hex');
    await db.createSession(sid, key, provider);
    const base = (process.env.RENDER_DOMAIN || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const targetUrl = `${base}/redeem?sid=${sid}`;

    let finalUrl = targetUrl;
    if (provider === 'link4m' && process.env.LINK4M_API_KEY) {
        const apiUrl = `https://link4m.co/api-shorten/v2?api=${process.env.LINK4M_API_KEY}&url=${encodeURIComponent(targetUrl)}`;
        const r = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
        const data = await r.json();
        if (data.status === 'success' && data.shortenedUrl) finalUrl = data.shortenedUrl;
        else throw new Error('Lỗi từ Link4M.');
    } else if (provider === 'layma' && process.env.LAYMA_TOKEN) {
        const apiUrl = `https://api.layma.net/api/admin/shortlink/quicklink?tokenUser=${process.env.LAYMA_TOKEN}&format=json&url=${encodeURIComponent(targetUrl)}`;
        const r = await fetch(apiUrl);
        const data = await r.json();
        if (data.success === true && data.html) finalUrl = data.html;
        else throw new Error('Lỗi từ LayMa.');
    }

    await db.increaseDailyLimit(key, provider, today);
    res.json({ ok: true, url: finalUrl, provider, remaining: LINK_DAILY_MAX - count - 1 });
}));

// ==================== BẢNG XẾP HẠNG ====================
async function decorate(rows, valueKey) {
    const keys = rows.map(r => String(r.user_id));
    const discordIds = keys.filter(k => !k.startsWith('web_'));
    const webIds = keys.filter(k => k.startsWith('web_')).map(k => k.slice(4));
    const [byDiscord, byId] = await Promise.all([
        db.getWebUsersByDiscordIds(discordIds),
        db.getWebUsersByIds(webIds),
    ]);
    const map = new Map();
    byDiscord.forEach(u => map.set(String(u.discord_id), u.username));
    byId.forEach(u => map.set(`web_${u.id}`, u.username));

    // Discord chưa liên kết web -> lấy username thật qua Discord API
    const unresolved = discordIds.filter(id => !map.has(id));
    if (unresolved.length) {
        const names = await Promise.all(unresolved.map(id => discordUsername(id)));
        names.forEach((name, i) => { if (name) map.set(unresolved[i], name); });
    }

    return rows.map((r, i) => ({
        rank: i + 1,
        userId: String(r.user_id),
        display: map.get(String(r.user_id)) || (String(r.user_id).startsWith('web_') ? 'Người dùng web' : `Discord ${r.user_id}`),
        value: Number(r[valueKey]) || 0,
    }));
}

router.get('/api/leaderboard/coins', requireAuth, ah(async (req, res) => {
    const top = await db.getTopCoins(10);
    res.json({ leaderboard: await decorate(top, 'balance') });
}));

router.get('/api/leaderboard/links', requireAuth, ah(async (req, res) => {
    const period = await weekly.getLinkPeriod();
    const top = await db.getLinkLeaderboard(period, 10);
    res.json({ leaderboard: await decorate(top, 'count'), period, rewards: weekly.REWARDS });
}));

// Bảng vượt link 7 ngày (có thưởng, reset sau mỗi kỳ thanh toán)
router.get('/api/leaderboard/links/week', requireAuth, ah(async (req, res) => {
    const period = await weekly.getLinkPeriod();
    const top = await db.getLinkLeaderboard(period, 10);
    res.json({ leaderboard: await decorate(top, 'count'), period, rewards: weekly.REWARDS });
}));

// Bảng vượt link tổng (không có thưởng)
router.get('/api/leaderboard/links/all', requireAuth, ah(async (req, res) => {
    const top = await db.getAllTimeLinkLeaderboard(10);
    res.json({ leaderboard: await decorate(top, 'count'), rewards: null });
}));

// ==================== ADMIN ====================
router.get('/api/admin/overview', requireAdmin, ah(async (req, res) => {
    const [users, items, purchases, payouts] = await Promise.all([
        db.listWebUsers(1000),
        db.getShopItems(false),
        db.getAllPurchases(200),
        db.getPayouts(20),
    ]);
    const revenue = purchases.reduce((s, p) => s + (Number(p.total_price) || 0), 0);
    const coins = await Promise.all(users.map(u => db.getCoins(balanceKey(u))));
    const totalCoins = coins.reduce((s, c) => s + (Number(c) || 0), 0);
    res.json({
        stats: {
            users: users.length,
            linked: users.filter(u => u.discord_id).length,
            items: items.filter(i => i.active !== false).length,
            purchases: purchases.length,
            revenue,
            totalCoins,
            gistEnabled: shop.useGist(),
        },
        recentPurchases: purchases.slice(0, 10).map(p => ({
            itemName: p.item_name, quantity: Number(p.quantity), totalPrice: Number(p.total_price), createdAt: p.created_at,
        })),
        payouts: payouts.map(p => ({ period: p.period, total: Number(p.total), createdAt: p.created_at, details: JSON.parse(p.details || '[]') })),
    });
}));

router.get('/api/admin/items', requireAdmin, ah(async (req, res) => {
    const items = await db.getShopItems(false);
    res.json({ items: items.map(publicItem) });
}));

router.post('/api/admin/items', requireAdmin, ah(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const price = toInt(req.body.price, 0);
    const logoUrl = String(req.body.logoUrl || '').trim();
    const category = ['shop', 'device'].includes(req.body.category) ? req.body.category : 'shop';
    const accounts = String(req.body.accounts || '');

    if (name.length < 2) return res.status(400).json({ error: 'Tên sản phẩm tối thiểu 2 ký tự.' });
    if (price < 1) return res.status(400).json({ error: 'Giá phải lớn hơn 0.' });
    if (logoUrl && !validHttpUrl(logoUrl)) return res.status(400).json({ error: 'Logo phải là link http(s).' });

    const stockInfo = await shop.createStock(name, accounts);
    const item = await db.createShopItem({
        id: randomId(),
        name,
        description,
        price,
        logo_url: logoUrl,
        category,
        created_by: req.webUser.id,
        ...stockInfo,
    });
    res.json({ ok: true, item: publicItem(item) });
}));

router.post('/api/admin/items/:id/stock', requireAdmin, ah(async (req, res) => {
    const item = await db.getShopItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    const accounts = String(req.body.accounts || '');
    const info = await shop.addStock(item, accounts);
    const updated = await db.updateShopItem(item.id, info);
    res.json({ ok: true, item: publicItem(updated) });
}));

router.patch('/api/admin/items/:id', requireAdmin, ah(async (req, res) => {
    const item = await db.getShopItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy sản phẩm.' });
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.description !== undefined) patch.description = String(req.body.description).trim();
    if (req.body.price !== undefined) {
        const price = toInt(req.body.price, 0);
        if (price < 1) return res.status(400).json({ error: 'Giá phải lớn hơn 0.' });
        patch.price = price;
    }
    if (req.body.logoUrl !== undefined) {
        const logoUrl = String(req.body.logoUrl).trim();
        if (logoUrl && !validHttpUrl(logoUrl)) return res.status(400).json({ error: 'Logo phải là link http(s).' });
        patch.logo_url = logoUrl;
    }
    if (req.body.category !== undefined) patch.category = ['shop', 'device'].includes(req.body.category) ? req.body.category : 'shop';
    if (req.body.active !== undefined) patch.active = Boolean(req.body.active);
    const updated = await db.updateShopItem(item.id, patch);
    res.json({ ok: true, item: publicItem(updated) });
}));

router.delete('/api/admin/items/:id', requireAdmin, ah(async (req, res) => {
    await db.deleteShopItem(req.params.id);
    res.json({ ok: true });
}));

router.get('/api/admin/users', requireAdmin, ah(async (req, res) => {
    const users = await db.listWebUsers(1000);
    const out = [];
    for (const u of users) {
        out.push({
            id: u.id,
            username: u.username,
            discordId: u.discord_id || null,
            balance: await db.getCoins(balanceKey(u)),
            isAdmin: await isDiscordAdmin(u.discord_id),
            createdAt: u.created_at,
        });
    }
    res.json({ users: out });
}));

router.post('/api/admin/coins', requireAdmin, ah(async (req, res) => {
    const action = String(req.body.action || 'cong');
    const amount = toInt(req.body.amount, 0);
    const target = String(req.body.target || '').trim();
    if (!['set', 'cong', 'tru'].includes(action)) return res.status(400).json({ error: 'Hành động không hợp lệ.' });
    if (action !== 'set' && amount < 1) return res.status(400).json({ error: 'Số coin phải > 0.' });

    let key;
    if (/^\d{15,25}$/.test(target)) key = target;
    else {
        const u = await db.getWebUserByUsername(target);
        if (!u) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
        key = balanceKey(u);
    }
    const current = await db.getCoins(key);
    let delta;
    if (action === 'set') delta = amount - current;
    else if (action === 'cong') delta = amount;
    else delta = -Math.min(amount, current);
    const newBalance = delta === 0 ? current : await db.updateCoins(key, delta);
    res.json({ ok: true, current, newBalance });
}));

router.get('/api/admin/purchases', requireAdmin, ah(async (req, res) => {
    const purchases = await db.getAllPurchases(200);
    res.json({
        purchases: purchases.map(p => ({
            id: p.id,
            itemName: p.item_name,
            quantity: Number(p.quantity),
            totalPrice: Number(p.total_price),
            accounts: String(p.accounts || '').split('\n').filter(Boolean),
            createdAt: p.created_at,
        })),
    });
}));

router.get('/api/admin/payouts', requireAdmin, ah(async (req, res) => {
    const payouts = await db.getPayouts(50);
    res.json({ payouts: payouts.map(p => ({ period: p.period, total: Number(p.total), createdAt: p.created_at, details: JSON.parse(p.details || '[]') })) });
}));

router.post('/api/admin/payout', requireAdmin, ah(async (req, res) => {
    const result = await weekly.runWeeklyPayout({ force: true });
    res.json({ ok: true, result });
}));

// ==================== ADMIN: MEOWS COOKIE ====================
router.get('/api/admin/meows/cookie', requireAdmin, ah(async (req, res) => {
    const cookie = await db.getKv(services.MEOWS_COOKIE_KEY);
    res.json({
        cookie: cookie || '',
        configured: Boolean(cookie),
        updatedAt: (await db.getKv('meows_cookie_updated_at')) || null,
        format: '.COOKIESECURITY=<cookie>',
    });
}));

router.post('/api/admin/meows/cookie', requireAdmin, ah(async (req, res) => {
    const cookie = services.normalizeMeowsCookie(req.body.cookie);
    if (!cookie) return res.status(400).json({ error: 'Nhập cookie (có thể dán cả .COOKIESECURITY=...).' });
    await db.setKv(services.MEOWS_COOKIE_KEY, cookie);
    const updatedAt = new Date().toISOString();
    await db.setKv('meows_cookie_updated_at', updatedAt);
    res.json({ ok: true, cookie, configured: true, updatedAt });
}));

router.delete('/api/admin/meows/cookie', requireAdmin, ah(async (req, res) => {
    await db.setKv(services.MEOWS_COOKIE_KEY, '');
    await db.setKv('meows_cookie_updated_at', new Date().toISOString());
    res.json({ ok: true, configured: false });
}));

// Proxy SOCKS5 cho Cloud Status (WARP). Env MEOWS_STATUS_PROXY có ưu tiên cao hơn.
router.get('/api/admin/status-proxy', requireAdmin, ah(async (req, res) => {
    res.json({
        proxy: (await db.getKv('meows_status_proxy')) || '',
        envProxy: services.normalizeStatusProxy(process.env.MEOWS_STATUS_PROXY),
        example: 'socks5h://user:pass@host:1080 · https://worker.example.com/status (xem cloudflare-proxy-worker.js)',
    });
}));

router.post('/api/admin/status-proxy', requireAdmin, ah(async (req, res) => {
    const proxy = services.normalizeStatusProxy(req.body.proxy);
    if (!proxy) return res.status(400).json({ error: 'Nhập địa chỉ SOCKS5 (VD: 127.0.0.1:40000).' });
    await db.setKv('meows_status_proxy', proxy);
    res.json({ ok: true, proxy });
}));

router.delete('/api/admin/status-proxy', requireAdmin, ah(async (req, res) => {
    await db.setKv('meows_status_proxy', '');
    res.json({ ok: true, proxy: '' });
}));

// ==================== ADMIN: PLUGIN ====================
router.get('/api/admin/plugins', requireAdmin, ah(async (req, res) => {
    const rows = await db.getPlugins();
    const runtime = new Map(pluginEngine.list().map(p => [String(p.id), p]));
    res.json({
        plugins: rows.map(p => ({
            id: p.id,
            name: p.name,
            sourceUrl: p.source_url,
            gistId: p.gist_id,
            gistUrl: p.gist_id ? `https://gist.github.com/${p.gist_id}` : null,
            enabled: p.enabled !== false,
            error: p.error || null,
            lastLoadedAt: p.last_loaded_at || null,
            runtime: runtime.get(String(p.id)) || null,
        })),
    });
}));

router.post('/api/admin/plugins', requireAdmin, ah(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const sourceUrl = String(req.body.url || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Tên plugin tối thiểu 2 ký tự.' });

    const code = await pluginEngine.fetchScript(sourceUrl);
    const filename = github.safeFilename(`${name}-plugin`);
    const gist = await github.createGist(filename, code, `ASYNCTAS plugin • ${name}`);
    const row = await db.createPlugin({
        id: randomId(),
        name,
        source_url: sourceUrl,
        gist_id: gist.id,
        gist_filename: gist.filename,
        enabled: true,
    });
    const meta = await pluginEngine.loadPlugin(row);
    res.json({ ok: true, plugin: { id: row.id, name: row.name, gistUrl: gist.url }, runtime: meta });
}));

router.post('/api/admin/plugins/:id/reload', requireAdmin, ah(async (req, res) => {
    const row = await db.getPlugin(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy plugin.' });
    if (row.enabled === false) return res.status(400).json({ error: 'Plugin đang bị tắt.' });
    const meta = await pluginEngine.loadPlugin(row);
    res.json({ ok: true, runtime: meta });
}));

router.post('/api/admin/plugins/:id/source', requireAdmin, ah(async (req, res) => {
    const row = await db.getPlugin(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy plugin.' });
    const sourceUrl = String(req.body.url || row.source_url || '').trim();
    const code = await pluginEngine.fetchScript(sourceUrl);
    if (row.gist_id) {
        await github.writeGistFile(row.gist_id, row.gist_filename, code);
    } else {
        const gist = await github.createGist(github.safeFilename(`${row.name}-plugin`), code, `ASYNCTAS plugin • ${row.name}`);
        row.gist_id = gist.id;
        row.gist_filename = gist.filename;
    }
    await db.updatePlugin(row.id, { source_url: sourceUrl, gist_id: row.gist_id, gist_filename: row.gist_filename });
    const meta = await pluginEngine.loadPlugin({ ...row, source_url: sourceUrl });
    res.json({ ok: true, runtime: meta });
}));

router.patch('/api/admin/plugins/:id', requireAdmin, ah(async (req, res) => {
    const row = await db.getPlugin(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy plugin.' });
    const enabled = req.body.enabled === undefined ? row.enabled !== false : Boolean(req.body.enabled);
    await db.updatePlugin(row.id, { enabled });
    if (!enabled) pluginEngine.unload(row.id);
    else await pluginEngine.loadPlugin({ ...row, enabled: true });
    res.json({ ok: true, enabled });
}));

router.delete('/api/admin/plugins/:id', requireAdmin, ah(async (req, res) => {
    await pluginEngine.remove(req.params.id);
    res.json({ ok: true });
}));

// ==================== LỖI ====================
router.use((err, req, res, next) => {
    console.error('[web] lỗi:', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || 'Lỗi server.' });
});

module.exports = { router, isDiscordAdmin, balanceKey, COOKIE_NAME };
