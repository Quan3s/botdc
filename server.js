require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const services = require('./services');
const web = require('./web');
const weekly = require('./weekly');
const pluginEngine = require('./plugin-engine');
const { generateUniqueLinkToken, randomId, hashPassword } = require('./utils');
const { HANAMI_URL, CLOUD_NAMES, REG_COST, MEOWS_COSTS, MEOWS_NAMES, vsphoneReady, buyHanami, regVmosAccount, regVsphoneAccount } = services;
const PAY_MIN = 10;          // số xu tối thiểu mỗi lần /pay
const PAY_FEE_RATE = 0.05;   // phí chuyển 5%
const LEADERBOARD_INTERVAL_MS = 10 * 60 * 1000; // cập nhật bảng xếp hạng mỗi 10 phút
const WEEKLY_PAYOUT_INTERVAL_MS = 10 * 60 * 1000; // kiểm tra trả thưởng tuần mỗi 10 phút
const busyUsers = new Set();
const pendingStarUsers = new Set(); // userId đang chờ admin duyệt nhiệm vụ /star
const STAR_REWARD = 10;
const STAR_DAILY_MAX = 3;
 // chặn bấm lệnh đồng thời (tránh nhận/chuyển xu 2 lần)

const app = express();
const PORT = process.env.PORT || 3000;

// Dashboard web + API
app.use(express.static(path.join(__dirname, 'public')));
app.use(web.router);

// Plugin mount động: /plugin/<id>/... (script được load từ Gist)
app.use('/plugin', pluginEngine.dispatcher);

// Load lại plugin từ Gist lúc khởi động (không cần deploy lại khi đổi script)
pluginEngine.reloadAll().catch(e => console.error('[plugin] reloadAll lỗi:', e.message));

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    rest: { timeout: 15000, retries: 5 },
});
// heartbeat watchdog: nếu bot im lặng quá 2 phút -> relogin
const HEARTBEAT_TIMEOUT = 2 * 60 * 1000;
let _heartbeatTimer = null;
function resetHeartbeat() {
    if (_heartbeatTimer) clearTimeout(_heartbeatTimer);
    _heartbeatTimer = setTimeout(() => {
        console.warn('[BOT] Heartbeat timeout — bot có thể offline, relogin...');
        safeRelogin();
    }, HEARTBEAT_TIMEOUT);
}


// Hàm sinh Gift Code (8 ký tự bao gồm ký tự đặc biệt)
function generateGiftCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let result = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

// Lấy danh sách Admin từ .env
function getAdminIds() {
    return (process.env.ADMIN_DISCORD_ID || '').split(',').map(id => id.trim()).filter(id => id);
}

// Lấy ngày hiện tại (UTC+7)
function getTodayString() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return vnTime.toISOString().split('T')[0];
}

// ==========================================
// PHẦN 1: WEB SERVER (NHẬN XU)
// ==========================================
app.get('/redeem', async (req, res) => {
    const { sid } = req.query;
    const renderError = (msg) => res.status(403).send(`
        <body style="background:#080d0b; color:#ff6b81; text-align:center; padding-top:100px; font-family:sans-serif;">
            <h1>❌ LỖI TRUY CẬP</h1>
            <p style="color:#fff">${msg}</p>
            <a href="https://discord.com/app" style="color:#39f58a;">Quay lại Discord</a>
        </body>
    `);

    if (!sid) return renderError("Bạn phải lấy link từ lệnh /getlink trên Discord.");

    try {
        const sessionData = await db.getAndDeleteSession(sid);
        if (!sessionData) return renderError("Link này đã được sử dụng hoặc đã hết hạn.");

        const { user_id, provider } = sessionData;
        const newBalance = await db.updateCoins(user_id, 50);
        let weeklyCount = 0;
        try {
            const period = await weekly.getLinkPeriod();
            weeklyCount = await db.incrementLinkCount(user_id, period);
        } catch (e) {
            console.error('[WEB] không cập nhật được BXH vượt link:', e.message);
        }

        console.log(`[WEB] User ${user_id} vượt link ${provider}. +50 xu. Số dư: ${newBalance} | tuần này: ${weeklyCount}`);

        res.send(`
            <body style="background:#080d0b; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; margin:0;">
                <div style="background:#101a14; padding:30px; border-radius:16px; border:1px solid #39f58a; text-align:center; max-width:400px; width:100%;">
                    <h2 style="color:#39f58a;">✅ VƯỢT LINK THÀNH CÔNG!</h2>
                    <p style="font-size:16px; margin-bottom:20px;">Bạn đã nhận được <b style="color:#ffc107;">+50 xu</b>.</p>
                    <p style="color:#91a096; font-size:14px; margin-bottom:6px;">Số dư hiện tại: <b style="color:#39f58a;">${newBalance} xu</b></p>
                    <p style="color:#91a096; font-size:14px; margin-bottom:20px;">Vượt link tuần này: <b style="color:#ffc107;">${weeklyCount}</b></p>
                    <a href="https://discord.com/app" style="background:#39f58a; color:#000; text-decoration:none; padding:10px 20px; border-radius:8px; font-weight:bold; display:inline-block;">Quay lại Discord</a>
                </div>
            </body>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi Server.");
    }
});

app.listen(PORT, () => console.log(`\n✅ Web Server đang chạy: http://localhost:${PORT}`));

// Trả thưởng bảng xếp hạng vượt link tự động vào Chủ nhật hàng tuần (giờ VN)
setInterval(() => {
    weekly.runWeeklyPayout().catch(e => console.error('[weekly] lỗi:', e.message));
}, WEEKLY_PAYOUT_INTERVAL_MS);
weekly.runWeeklyPayout().catch(e => console.error('[weekly] lỗi:', e.message));

// In IP outbound mỗi lần khởi động (để đưa vào whitelist) + thử xem KingDev có bị Cloudflare chặn không
(async () => {
    try {
        const ip = await (await fetch('https://api.ipify.org?format=json')).json();
        console.log(`[IP] IP outbound hiện tại: ${ip.ip}`);
    } catch (e) { console.log('[IP] Không lấy được IP:', e.message); }
    try {
        const r = await fetch(HANAMI_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ token: 'probe', cloud_id: 'VM', input_data: 'probe' })
        });
        const t = await r.text();
        console.log(`[IP] Thử Hanami: HTTP ${r.status} - ${t.trim().startsWith('{') ? 'JSON (không bị chặn)' : 'HTML (bị Cloudflare chặn)'}`);
    } catch (e) { console.log('[IP] Thử Hanami lỗi:', e.message); }
})();

// ==========================================
// PHẦN 2: DISCORD BOT
// ==========================================
// ===== ADMIN: Owner (env ADMIN_DISCORD_ID) + admin cấp bằng /op (bảng admins) =====
async function isAdmin(userId) {
    if (getAdminIds().includes(userId)) return true;
    try { return await db.isAdmin(userId); } catch (e) { console.error('[admin] không đọc được bảng admins:', e.message); return false; }
}

// ===== BẢNG XẾP HẠNG COIN QUA WEBHOOK =====
async function updateLeaderboard() {
    const url = process.env.LEADERBOARD_WEBHOOK_URL;
    if (!url) return;
    try {
        const top = await db.getTopCoins(10);
        const medals = ['🥇', '🥈', '🥉'];
        const lines = top.length
            ? top.map((u, i) => `${medals[i] || `**${i + 1}.**`} <@${u.user_id}> — **${Number(u.balance).toLocaleString('en-US')}** xu`)
            : ['Chưa có ai trong bảng xếp hạng.'];
        const payload = {
            allowed_mentions: { parse: [] },
            embeds: [{
                title: '🏆 Bảng xếp hạng Coin',
                description: lines.join('\n'),
                color: 0xF1C40F,
                footer: { text: 'Cập nhật mỗi 10 phút' },
                timestamp: new Date().toISOString()
            }]
        };
        const headers = { 'Content-Type': 'application/json' };
        let msgId = null;
        try { msgId = await db.getKv('leaderboard_message_id'); } catch (e) { console.error('[BXH] không đọc được bảng kv:', e.message); }

        if (msgId) {
            const res = await fetch(`${url}/messages/${msgId}`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
            if (res.ok) return;
            if (res.status !== 404) return console.error(`[BXH] sửa tin nhắn lỗi HTTP ${res.status}`);
        }
        const res = await fetch(`${url}?wait=true`, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!res.ok) return console.error(`[BXH] gửi webhook lỗi HTTP ${res.status}`);
        const msg = await res.json();
        try { await db.setKv('leaderboard_message_id', msg.id); } catch (e) { console.error('[BXH] không lưu được message id (bảng kv):', e.message); }
    } catch (e) {
        console.error('[BXH] lỗi cập nhật bảng xếp hạng:', e.message);
    }
}

client.on('shardReady', () => resetHeartbeat());
client.on('shardResume', (id, r) => { console.log(`[BOT] Shard ${id} resume OK (${r} events).`); resetHeartbeat(); });
client.on('interactionCreate', () => resetHeartbeat());
client.on('messageCreate', () => resetHeartbeat());

client.once('ready', async () => {
    resetHeartbeat(); // bắt đầu watchdog ngay khi bot sẵn sàng
    const commands = [
        new SlashCommandBuilder().setName('getlink').setDescription('Lấy link nhiệm vụ để nhận 50 xu (Tối đa 2 lần/ngày)')
            .addStringOption(opt => opt.setName('provider').setDescription('Chọn dịch vụ rút gọn link').addChoices(
                { name: 'Link4M', value: 'link4m' },
                { name: 'LayMa', value: 'layma' }
            ).setRequired(false)),
        new SlashCommandBuilder().setName('reg').setDescription('Tạo tài khoản cloud nhanh (Panel chọn dịch vụ)'),
        new SlashCommandBuilder().setName('vi').setDescription('Xem số dư xu của bạn'),
        new SlashCommandBuilder().setName('code').setDescription('Nhập Gift Code để nhận xu')
            .addStringOption(o => o.setName('gift_code').setDescription('Mã quà tặng').setRequired(true)),
        new SlashCommandBuilder().setName('buycloud').setDescription('Mua máy Cloud (Miễn phí)')
            .addStringOption(o => o.setName('provider').setDescription('Loại cloud').setRequired(true)
                .addChoices({ name: 'UGPhone', value: 'UG' }, { name: 'VMOS', value: 'VM' }, { name: 'VSPhone', value: 'VS' }))
            .addStringOption(o => o.setName('server').setDescription('Khu vực (bắt buộc với UGPhone)').setRequired(false)
                .addChoices({ name: 'Singapore', value: 'SG' }, { name: 'Hong Kong', value: 'HK' }, { name: 'Japan', value: 'JP' }, { name: 'Germany', value: 'DE' }, { name: 'US', value: 'US' })),
        new SlashCommandBuilder().setName('meows').setDescription('Mua device nhanh qua Meows (UGPhone 49 xu / VSPhone VIP 15 xu)')
            .addStringOption(o => o.setName('provider').setDescription('Chọn dịch vụ').setRequired(true)
                .addChoices(
                    { name: 'UGPhone — 49 xu', value: 'UG' },
                    { name: 'VSPhone VIP — 15 xu', value: 'VSVIP' }
                )),
        new SlashCommandBuilder().setName('shop').setDescription('Xem danh sách hàng hoá và giá trong shop'),
        new SlashCommandBuilder().setName('connect').setDescription('Liên kết tài khoản web với Discord để đồng bộ coin')
            .addStringOption(o => o.setName('token').setDescription('Token 64 ký tự lấy trong mục Hồ sơ trên web').setRequired(true)),
        new SlashCommandBuilder().setName('token').setDescription('Lấy token đăng nhập web cố định của tài khoản Discord này'),
        new SlashCommandBuilder().setName('plugin').setDescription('Gọi lệnh của plugin đã cài (Admin hoặc mọi user tuỳ plugin)')
            .addStringOption(o => o.setName('lenh').setDescription('Tên plugin:lệnh, ví dụ hello:ping').setRequired(true)),
        new SlashCommandBuilder().setName('star').setDescription('Nhận nhiệm vụ đăng ký kênh YouTube để nhận xu'),
        new SlashCommandBuilder().setName('sdone').setDescription('(Admin) Xác nhận user hoàn thành nhiệm vụ /star')
            .addUserOption(o => o.setName('user').setDescription('Chọn người dùng').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Hoặc nhập ID Discord').setRequired(false)),
        new SlashCommandBuilder().setName('adcoin').setDescription('Chỉnh số xu của người dùng (Admin)')
            .addStringOption(o => o.setName('hanhdong').setDescription('Hành động').setRequired(true)
                .addChoices({ name: 'set (đặt bằng)', value: 'set' }, { name: 'cộng', value: 'cong' }, { name: 'trừ', value: 'tru' }))
            .addIntegerOption(o => o.setName('sotien').setDescription('Số xu').setRequired(true).setMinValue(0))
            .addUserOption(o => o.setName('user').setDescription('Chọn người dùng').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Hoặc nhập ID Discord').setRequired(false)),
        new SlashCommandBuilder().setName('daily').setDescription('Nhận quà hàng ngày (ngẫu nhiên 1-20 xu)'),
        new SlashCommandBuilder().setName('pay').setDescription('Chuyển xu cho người khác (phí 5%)')
            .addUserOption(o => o.setName('nguoinhan').setDescription('Người nhận').setRequired(true))
            .addIntegerOption(o => o.setName('sotien').setDescription(`Số xu muốn chuyển (tối thiểu ${PAY_MIN})`).setRequired(true).setMinValue(PAY_MIN)),
        new SlashCommandBuilder().setName('op').setDescription('Cấp quyền admin (Owner)')
            .addUserOption(o => o.setName('user').setDescription('Chọn người dùng').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Hoặc nhập ID Discord').setRequired(false)),
        new SlashCommandBuilder().setName('unop').setDescription('Thu hồi quyền admin (Owner)')
            .addUserOption(o => o.setName('user').setDescription('Chọn người dùng').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Hoặc nhập ID Discord').setRequired(false)),
        new SlashCommandBuilder().setName('gen').setDescription('Tạo Gift Code (Admin)')
            .addIntegerOption(o => o.setName('soluong').setDescription('Số lượng code').setRequired(true))
            .addIntegerOption(o => o.setName('xuthuong').setDescription('Số xu mỗi code').setRequired(true)),
        new SlashCommandBuilder().setName('clear').setDescription('Xóa tin nhắn của Bot cũ hơn 2 giờ (Admin)')
    ].map(c => c.toJSON());

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Bot online: ${client.user.tag}`);
        console.log(`✅ Đã đăng ký lệnh Slash!`);
    } catch (error) {
        console.error('Lỗi đăng ký lệnh:', error);
    }

    if (process.env.LEADERBOARD_WEBHOOK_URL) {
        updateLeaderboard();
        setInterval(updateLeaderboard, LEADERBOARD_INTERVAL_MS);
    }
});

// ===== MUA CLOUD QUA HANAMI (dùng services.buyHanami) =====

async function handleBuycloudModal(interaction) {
    const [, cloudId, serverRaw] = interaction.customId.split(':');
    const server = serverRaw === '-' ? null : serverRaw;
    const inputData = interaction.fields.getTextInputValue('input_data').trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (!process.env.HANAMI_TOKEN) return await interaction.editReply({ content: '❌ Bot chưa cấu hình HANAMI_TOKEN.' });
        if (cloudId !== 'UG' && cloudId !== 'VS' && !inputData.includes('|')) {
            return await interaction.editReply({ content: '❌ Sai định dạng. Nhập theo dạng: `tài khoản|mật khẩu`' });
        }
        const result = await buyHanami(cloudId, server, inputData);
        if (result.ok) {
            await interaction.editReply({ content: `✅ **Mua ${CLOUD_NAMES[cloudId]} thành công!**${server ? ` (${server})` : ''}\n${result.message}` });
        } else {
            await interaction.editReply({ content: `❌ Lỗi từ Hanami: ${result.message}`.slice(0, 1900) });
        }
    } catch (error) {
        console.error('[buycloud] lỗi:', error, error.cause);
        await interaction.editReply({ content: `❌ Lỗi kết nối: ${error.message}${error.cause ? ' - ' + (error.cause.code || error.cause.message) : ''}` });
    }
}

// ===== /reg PANEL (VMOS / VSPhone / UGPhone) =====

// Logo nút: đặt ID emoji (Developer Portal -> Emojis) hoặc <:ten:id> vào env; không có thì dùng emoji mặc định
function regEmoji(envName, fallback) {
    const v = (process.env[envName] || '').trim();
    if (/^\d{15,25}$/.test(v)) return { id: v, name: 'logo' };
    if (/^<a?:\w+:\d+>$/.test(v)) return v;
    return fallback;
}
function regButton(customId, label, style, envName, fallbackEmoji, disabled) {
    const btn = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
    try { btn.setEmoji(regEmoji(envName, fallbackEmoji)); } catch (e) { btn.setEmoji(fallbackEmoji); }
    return btn;
}
function buildRegPanel(ownerId) {
    const vsReady = vsphoneReady();
    const embed = new EmbedBuilder()
        .setTitle('📋 Reg Panel')
        .setDescription([
            'Chọn dịch vụ bên dưới để tạo tài khoản nhanh gọn.',
            '',
            '**Dịch vụ cloud**',
            '• 🌐 VMOS Cloud — Đang hoạt động',
            `• 🥽 VSPhone — ${vsReady ? 'Đang hoạt động' : 'Sắp có'}`,
            '• 🔴 UGPhone — Sắp có',
            '',
            `💰 Phí: **${REG_COST} xu** mỗi lần (chỉ trừ khi tạo thành công)`,
            '',
            '*Panel chỉ dùng được bởi người đã mở lệnh.*'
        ].join('\n'))
        .setColor(0x00B0F4)
        .setFooter({ text: 'ASYNCTAS • Reg System' });
    const row = new ActionRowBuilder().addComponents(
        regButton(`reg:vmos:${ownerId}`, 'VMOS Cloud', ButtonStyle.Success, 'REG_EMOJI_VMOS', '🌐', false),
        regButton(`reg:vsphone:${ownerId}`, vsReady ? 'VSPhone' : 'VSPhone • Sắp có', vsReady ? ButtonStyle.Success : ButtonStyle.Secondary, 'REG_EMOJI_VSPHONE', '🥽', !vsReady),
        regButton(`reg:ugphone:${ownerId}`, 'UGPhone • Sắp có', ButtonStyle.Secondary, 'REG_EMOJI_UGPHONE', '🔴', true)
    );
    return { embeds: [embed], components: [row] };
}

// Lưu tài khoản tạm vào KV để nút "Copy" gửi lại đúng định dạng account|password
async function sendAccountWithCopy(interaction, { header, copyText, lines }) {
    const copyId = crypto.randomBytes(8).toString('hex');
    try {
        await db.setKv(`copyacc:${copyId}`, JSON.stringify({ text: copyText, exp: Date.now() + 24 * 60 * 60 * 1000 }));
    } catch (e) {
        console.error('[copy] không lưu được dữ liệu copy:', e.message);
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`copy:${copyId}`)
            .setLabel('Copy acc|pass')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋')
    );
    return interaction.editReply({ content: [`✅ ${header}`, ...lines].join('\n'), components: [row] });
}

async function regVmos(interaction, userId) {
    const currentCoins = await db.getCoins(userId);
    if (currentCoins < REG_COST) {
        return interaction.editReply({ content: `❌ Bạn không đủ xu (Cần ${REG_COST} xu). Số dư: **${currentCoins} xu**.` });
    }
    const result = await regVmosAccount();
    const newBalance = await db.updateCoins(userId, -REG_COST);
    return sendAccountWithCopy(interaction, {
        header: `Tạo VMOS thành công! (Đã trừ ${REG_COST} xu)`,
        copyText: result.copyText,
        lines: [
            `📧 \`${result.account}\``,
            `🔑 \`${result.password}\``,
            `💰 Số dư còn lại: **${newBalance} xu**`,
        ],
    });
}

async function regVsphone(interaction, userId) {
    if (!vsphoneReady()) {
        return interaction.editReply({ content: '❌ VSPhone chưa được cấu hình (thiếu VSPHONE_API_URL / VSPHONE_API_KEY).' });
    }
    const currentCoins = await db.getCoins(userId);
    if (currentCoins < REG_COST) {
        return interaction.editReply({ content: `❌ Bạn không đủ xu (Cần ${REG_COST} xu). Số dư: **${currentCoins} xu**.` });
    }
    const result = await regVsphoneAccount();
    const newBalance = await db.updateCoins(userId, -REG_COST);
    const lines = [
        `📧 \`${result.account}\``,
        `🔑 \`${result.password}\``,
    ];
    if (result.token) lines.push(`🎫 Token: \`${result.token}\``);
    if (result.userId) lines.push(`🆔 User ID: \`${result.userId}\``);
    lines.push(`💰 Số dư còn lại: **${newBalance} xu**`);
    return sendAccountWithCopy(interaction, {
        header: `Tạo VSPhone thành công! (Đã trừ ${REG_COST} xu)`,
        copyText: result.copyText,
        lines,
    });
}

// Xử lý nút Copy acc|pass
async function handleCopyButton(interaction) {
    const id = interaction.customId.split(':')[1];
    let data = null;
    try {
        const raw = await db.getKv(`copyacc:${id}`);
        if (raw) data = JSON.parse(raw);
    } catch (e) {
        console.error('[copy] lỗi đọc dữ liệu:', e.message);
    }
    if (!data || !data.text || (data.exp && data.exp < Date.now())) {
        return interaction.reply({ content: '❌ Dữ liệu copy đã hết hạn. Hãy tạo lại.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
        content: `📋 **Tài khoản của bạn** (bấm giữ / Ctrl+C để copy):\n\`\`\`\n${data.text}\n\`\`\``,
        flags: MessageFlags.Ephemeral,
    });
}

async function handleRegButton(interaction) {
    const [, service, ownerId] = interaction.customId.split(':');
    const userId = interaction.user.id;
    if (userId !== ownerId) {
        return interaction.reply({ content: '❌ Panel này không phải của bạn. Dùng `/reg` để mở panel riêng.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (busyUsers.has(userId)) {
        return interaction.editReply({ content: '⏳ Bạn đang có thao tác khác, thử lại sau giây lát.' });
    }
    busyUsers.add(userId);
    try {
        if (service === 'vmos') await regVmos(interaction, userId);
        else if (service === 'vsphone') await regVsphone(interaction, userId);
        else await interaction.editReply({ content: '🚧 Dịch vụ này sắp có.' });
    } catch (error) {
        console.error(`[reg:${service}] lỗi:`, error, error.cause);
        await interaction.editReply({ content: `❌ ${error.message}${error.cause ? ' - ' + (error.cause.code || error.cause.message) : ''} (Chưa bị trừ xu).` }).catch(() => {});
    } finally {
        busyUsers.delete(userId);
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('buycloud:')) return handleBuycloudModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('reg:')) return handleRegButton(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('copy:')) return handleCopyButton(interaction);
    if (!interaction.isChatInputCommand()) return;
    const adminIds = getAdminIds();
    const userId = interaction.user.id;

    // LỆNH /shop
    if (interaction.commandName === 'shop') {
        await interaction.deferReply();
        try {
            const items = (await db.getShopItems(true)).filter(i => i.active !== false);
            const base = (process.env.RENDER_DOMAIN || `http://localhost:${PORT}`).replace(/\/$/, '');
            if (!items.length) {
                return interaction.editReply({ content: `🛒 Shop hiện chưa có sản phẩm nào. Quay lại sau nhé!\n👉 Mở dashboard: ${base}` });
            }
            const embeds = items.slice(0, 10).map(item => {
                const e = new EmbedBuilder()
                    .setTitle(`${item.name} — ${Number(item.price).toLocaleString('en-US')} xu`)
                    .setDescription((item.description || 'Không có mô tả.').slice(0, 300))
                    .addFields({ name: '📦 Kho', value: `${Number(item.stock) || 0} sản phẩm`, inline: true });
                const logo = String(item.logo_url || '');
                if (/^https?:\/\//i.test(logo)) {
                    try { e.setThumbnail(logo); } catch (err) { /* logo không hợp lệ */ }
                }
                return e;
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Mua trên Web').setStyle(ButtonStyle.Link).setURL(`${base}/#shop`).setEmoji('🛒')
            );
            return interaction.editReply({ embeds, components: [row] });
        } catch (error) {
            console.error('[shop] lỗi:', error);
            return interaction.editReply({ content: `❌ Lỗi tải shop: ${error.message}`.slice(0, 1900) });
        }
    }

    // LỆNH /connect <token>
    if (interaction.commandName === 'connect') {
        const token = interaction.options.getString('token').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (!/^[A-Za-z0-9]{64}$/.test(token)) {
                return interaction.editReply({ content: '❌ Token phải gồm đúng 64 ký tự chữ và số.' });
            }
            const webUser = await db.getWebUserByLinkToken(token);
            if (!webUser) return interaction.editReply({ content: '❌ Token không tồn tại. Hãy kiểm tra lại trong mục Hồ sơ trên web.' });
            if (webUser.discord_id && String(webUser.discord_id) !== userId) {
                return interaction.editReply({ content: '❌ Token này đã được liên kết với một tài khoản Discord khác.' });
            }
            const existingLink = await db.getWebUserByDiscordId(userId);
            if (existingLink && existingLink.id !== webUser.id) {
                return interaction.editReply({ content: '❌ Tài khoản Discord này đã liên kết với một tài khoản web khác.' });
            }
            if (String(webUser.discord_id) === userId) {
                return interaction.editReply({ content: `✅ Tài khoản web **${webUser.username}** đã liên kết với Discord này rồi.` });
            }

            // Gộp coin: coin web (web_<id>) + coin Discord -> coin Discord
            const webKey = `web_${webUser.id}`;
            const webBalance = await db.getCoins(webKey);
            let newBalance = await db.getCoins(userId);
            if (webBalance > 0) {
                newBalance = await db.updateCoins(userId, webBalance);
                await db.updateCoins(webKey, -webBalance);
            }
            await db.updateWebUser(webUser.id, { discord_id: userId });

            // Gộp số link đã vượt của tài khoản web vào Discord trong kỳ hiện tại
            try {
                const period = await weekly.getLinkPeriod();
                await db.mergeLinkStats(`web_${webUser.id}`, userId, period);
            } catch (e) {
                console.error('[connect] không gộp được BXH vượt link:', e.message);
            }

            const adminNote = (await isAdmin(userId)) ? '\n🛡️ Bạn là **admin**, mục Quản trị đã mở trên web.' : '';
            return interaction.editReply({
                content: `✅ Liên kết thành công với tài khoản web **${webUser.username}**!\n💰 Coin đã đồng bộ: **${newBalance} xu**${adminNote}`
            });
        } catch (error) {
            console.error('[connect] lỗi:', error);
            return interaction.editReply({ content: `❌ Lỗi liên kết: ${error.message}`.slice(0, 1900) });
        }
    }

    // LỆNH /token — lấy token web cố định (cùng link_token dùng cho /connect)
    if (interaction.commandName === 'token') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            let user = await db.getWebUserByDiscordId(userId);
            if (!user) {
                let username;
                do {
                    username = `disc_${String(userId).slice(-6)}${crypto.randomBytes(2).toString('hex')}`;
                } while (await db.getWebUserByUsername(username));
                user = await db.createWebUser({
                    id: randomId(),
                    username,
                    password_hash: hashPassword(crypto.randomBytes(24).toString('hex')),
                    link_token: await generateUniqueLinkToken(db),
                    discord_id: userId,
                });
            } else if (!user.link_token) {
                const token = await generateUniqueLinkToken(db);
                user = (await db.updateWebUser(user.id, { link_token: token })) || { ...user, link_token: token };
            }

            const sync = await db.getCoins(userId);
            const needRename = !/[A-Za-z]/.test(String(user.username || ''));
            return interaction.editReply({
                content: [
                    '🔑 **Token đăng nhập web của bạn** (cố định, dùng cả cho `/connect`):',
                    `\`\`\`${user.link_token}\`\`\``,
                    `👤 Tài khoản web: **${user.username}**`,
                    `💰 Số dư Discord: **${sync} xu**`,
                    needRename ? '⚠️ Tên tài khoản hiện chỉ có số. Khi đăng nhập web bạn sẽ được yêu cầu đổi tên.' : '',
                    '🌐 Dán token ở tab **Token Discord** trên web để đăng nhập.',
                ].filter(Boolean).join('\n'),
            });
        } catch (error) {
            console.error('[token] lỗi:', error);
            return interaction.editReply({ content: `❌ Lỗi lấy token: ${error.message}`.slice(0, 1900) });
        }
    }

    // LỆNH /plugin <ten>:<lenh> — gọi lệnh do plugin đăng ký
    if (interaction.commandName === 'plugin') {
        const raw = String(interaction.options.getString('lenh') || '').trim();
        const idx = raw.indexOf(':');
        const pluginName = idx === -1 ? raw : raw.slice(0, idx).trim();
        const commandName = idx === -1 ? raw : raw.slice(idx + 1).trim();
        if (!pluginName || !commandName) {
            return interaction.reply({ content: '❌ Dùng định dạng `/plugin tên:lệnh`, ví dụ `/plugin hello:ping`.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const cmd = pluginEngine.getCommand(commandName, pluginName);
            if (!cmd) {
                const available = pluginEngine.list()
                    .map(p => `${p.name}: ${p.commands.map(c => c.name).join(', ') || '(không có lệnh)'}`)
                    .join('\n') || '(chưa có plugin nào)';
                return interaction.editReply({ content: `❌ Không tìm thấy lệnh \`${commandName}\` trong plugin \`${pluginName}\`.\n\nLệnh có sẵn:\n${available}`.slice(0, 1900) });
            }
            await cmd.execute({ interaction, db, api: pluginEngine.apiFor(cmd.pluginId) });
        } catch (error) {
            console.error(`[plugin:${commandName}] lỗi:`, error);
            const msg = `❌ Lỗi plugin: ${error.message}`.slice(0, 1900);
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg }).catch(() => {});
            else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    // LỆNH /getlink
    if (interaction.commandName === 'getlink') {
        const provider = interaction.options.getString('provider') || 'link4m';
        const today = getTodayString();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const currentCount = await db.checkDailyLimit(userId, provider, today);
            if (currentCount >= 2) {
                return await interaction.editReply({ content: `❌ Bạn đã đạt giới hạn **2 lần/ngày** cho dịch vụ này.` });
            }

            const sessionId = crypto.randomBytes(16).toString('hex');
            await db.createSession(sessionId, userId, provider);

            const targetUrl = `${process.env.RENDER_DOMAIN}/redeem?sid=${sessionId}`;
            let finalUrl = '';
            let providerName = '';

            if (provider === 'link4m') {
                providerName = 'Link4M';
                const apiUrl = `https://link4m.co/api-shorten/v2?api=${process.env.LINK4M_API_KEY}&url=${encodeURIComponent(targetUrl)}`;
                const res = await fetch(apiUrl, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
                const data = await res.json();
                if (data.status === "success" && data.shortenedUrl) finalUrl = data.shortenedUrl;
                else throw new Error("Lỗi từ Link4M");
            } else if (provider === 'layma') {
                providerName = 'LayMa';
                const apiUrl = `https://api.layma.net/api/admin/shortlink/quicklink?tokenUser=${process.env.LAYMA_TOKEN}&format=json&url=${encodeURIComponent(targetUrl)}`;
                const res = await fetch(apiUrl);
                const data = await res.json();
                if (data.success === true && data.html) finalUrl = data.html;
                else throw new Error("Lỗi từ LayMa");
            }

            await db.increaseDailyLimit(userId, provider, today);

            const embed = new EmbedBuilder()
                .setColor(provider === 'link4m' ? 0xffc107 : 0x8b5cf6)
                .setTitle(`🔗 LINK NHẬN XU (${providerName})`)
                .setDescription(`Bấm vào link để vượt nhiệm vụ và nhận **50 xu**.\nBạn còn **${1 - currentCount}** lượt cho hôm nay.`)
                .addFields({ name: 'Link nhiệm vụ', value: finalUrl });
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            await interaction.editReply({ content: `❌ ${e.message}` });
        }
    }

    // LỆNH /vi
    if (interaction.commandName === 'vi') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const coins = await db.getCoins(userId);
            await interaction.editReply({ content: `💰 Số dư của bạn: **${coins} xu**` });
        } catch (error) {
            await interaction.editReply({ content: `❌ Lỗi khi lấy số dư.` });
        }
    }

    // LỆNH /code
    if (interaction.commandName === 'code') {
        const giftCode = interaction.options.getString('gift_code').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const amount = await db.redeemGiftCode(giftCode);
            if (!amount) return await interaction.editReply({ content: `❌ Gift Code không hợp lệ hoặc đã được sử dụng.` });

            const newBalance = await db.updateCoins(userId, amount);
            await interaction.editReply({ content: `✅ Nhập code thành công! Bạn nhận được **${amount} xu**.\n💰 Số dư mới: **${newBalance} xu**` });
        } catch (error) {
            await interaction.editReply({ content: `❌ Lỗi khi nhập code.` });
        }
    }

    // LỆNH /meows — mua UGPhone / VSPhone VIP qua API Meows
    if (interaction.commandName === 'meows') {
        const provider = String(interaction.options.getString('provider') || '').toUpperCase();
        const cost = MEOWS_COSTS[provider];
        if (!cost) return interaction.reply({ content: '❌ Dịch vụ không hợp lệ.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (busyUsers.has(userId)) {
            return interaction.editReply({ content: '⏳ Bạn đang có thao tác khác, thử lại sau giây lát.' });
        }
        const balance = await db.getCoins(userId);
        if (balance < cost) {
            return interaction.editReply({ content: `❌ Bạn không đủ xu (cần ${cost} xu). Số dư: **${balance} xu**.` });
        }
        busyUsers.add(userId);
        try {
            const result = await services.buyMeows(provider);
            const newBalance = await db.updateCoins(userId, -cost);
            const lines = [
                `🎯 Dịch vụ: **${MEOWS_NAMES[provider]}**`,
                `💰 Đã trừ: **${cost} xu** · Số dư: **${newBalance} xu**`,
            ];
            if (result.account) lines.push(`📧 \`${result.account}\``);
            if (result.password) lines.push(`🔑 \`${result.password}\``);
            if (result.token) lines.push(`🎫 Token: \`${result.token}\``);
            if (!result.account && !result.password) lines.push(`📄 Dữ liệu: \`\`\`${String(result.copyText).slice(0, 600)}\`\`\``);
            return await sendAccountWithCopy(interaction, {
                header: `Mua ${MEOWS_NAMES[provider]} thành công!`,
                copyText: result.copyText,
                lines,
            });
        } catch (error) {
            console.error(`[meows:${provider}] lỗi:`, error);
            return interaction.editReply({ content: `❌ ${error.message}`.slice(0, 1900) });
        } finally {
            busyUsers.delete(userId);
        }
    }

    // LỆNH /reg - mở panel chọn dịch vụ
    if (interaction.commandName === 'reg') {
        return interaction.reply({ ...buildRegPanel(userId), flags: MessageFlags.Ephemeral });
    }

    // LỆNH /buycloud (mở bảng nhập dữ liệu)
    if (interaction.commandName === 'buycloud') {
        const cloudId = interaction.options.getString('provider');
        const server = interaction.options.getString('server');
        if (cloudId === 'UG' && !server) {
            return interaction.reply({ content: '❌ UGPhone cần chọn thêm **server** (khu vực).', flags: MessageFlags.Ephemeral });
        }
        const isUG = cloudId === 'UG';
        const isVS = cloudId === 'VS';
        const usesLocalStorage = isUG || isVS;
        const input = new TextInputBuilder()
            .setCustomId('input_data')
            .setLabel(usesLocalStorage ? `Local Storage (cookie) của ${CLOUD_NAMES[cloudId]}` : 'Tài khoản|Mật khẩu')
            .setStyle(usesLocalStorage ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setPlaceholder(usesLocalStorage ? 'Dán chuỗi Local Storage vào đây' : 'mail|matkhau hoặc user|matkhau')
            .setRequired(true)
            .setMaxLength(4000);
        const modal = new ModalBuilder()
            .setCustomId(`buycloud:${cloudId}:${usesLocalStorage ? (server || '-') : '-'}`)
            .setTitle(`Mua ${CLOUD_NAMES[cloudId]}${usesLocalStorage && server ? ' - ' + server : ''}`)
            .addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    // LỆNH /daily
    if (interaction.commandName === 'daily') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (busyUsers.has(userId)) return interaction.editReply({ content: '⏳ Bạn đang có thao tác khác, thử lại sau giây lát.' });
        busyUsers.add(userId);
        try {
            const today = getTodayString();
            const claimed = await db.checkDailyLimit(userId, 'daily', today);
            if (claimed > 0) {
                return await interaction.editReply({ content: '⏰ Hôm nay bạn đã nhận quà rồi. Quay lại vào ngày mai (sau 0h giờ VN) nhé!' });
            }
            const reward = crypto.randomInt(1, 21); // 1-20
            await db.increaseDailyLimit(userId, 'daily', today); // đánh dấu đã nhận trước để chống nhận 2 lần
            const newBalance = await db.updateCoins(userId, reward);
            await interaction.editReply({ content: `🎁 Quà hàng ngày: bạn nhận được **${reward} xu**!\n💰 Số dư: **${newBalance} xu**` });
        } catch (error) {
            console.error('[daily] lỗi:', error);
            await interaction.editReply({ content: '❌ Lỗi khi nhận quà hàng ngày.' });
        } finally {
            busyUsers.delete(userId);
        }
    }

    // LỆNH /pay (phí 5%, người gửi bị trừ đủ số xu, người nhận được số xu sau khi trừ phí)
    if (interaction.commandName === 'pay') {
        const target = interaction.options.getUser('nguoinhan');
        const amount = interaction.options.getInteger('sotien');
        if (target.bot) return interaction.reply({ content: '❌ Không thể chuyển xu cho bot.', flags: MessageFlags.Ephemeral });
        if (target.id === userId) return interaction.reply({ content: '❌ Bạn không thể tự chuyển xu cho chính mình.', flags: MessageFlags.Ephemeral });
        if (amount < PAY_MIN) return interaction.reply({ content: `❌ Số xu tối thiểu mỗi lần chuyển là **${PAY_MIN}**.`, flags: MessageFlags.Ephemeral });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (busyUsers.has(userId) || busyUsers.has(target.id)) {
            return interaction.editReply({ content: '⏳ Một trong hai người đang có giao dịch khác, thử lại sau giây lát.' });
        }
        busyUsers.add(userId); busyUsers.add(target.id);
        try {
            const balance = await db.getCoins(userId);
            if (balance < amount) {
                return await interaction.editReply({ content: `❌ Bạn không đủ xu. Số dư: **${balance} xu**.` });
            }
            const fee = Math.ceil(amount * PAY_FEE_RATE);
            const received = amount - fee;
            const newBalance = await db.updateCoins(userId, -amount);
            try {
                await db.updateCoins(target.id, received);
            } catch (e) {
                await db.updateCoins(userId, amount).catch(() => {}); // hoàn xu nếu cộng cho người nhận thất bại
                throw e;
            }
            await interaction.editReply({ content: `✅ Đã chuyển **${amount} xu** (phí ${fee} xu).\n💰 Số dư còn lại: **${newBalance} xu**` });
            await interaction.followUp({ content: `💸 <@${userId}> đã chuyển cho <@${target.id}> **${received} xu** (phí 5%: ${fee} xu).` }).catch(() => {});
        } catch (error) {
            console.error('[pay] lỗi:', error);
            await interaction.editReply({ content: '❌ Lỗi khi chuyển xu, giao dịch đã được hủy.' });
        } finally {
            busyUsers.delete(userId); busyUsers.delete(target.id);
        }
    }

    // LỆNH /op và /unop (chỉ Owner trong ADMIN_DISCORD_ID)
    if (interaction.commandName === 'op' || interaction.commandName === 'unop') {
        if (!adminIds.includes(userId)) {
            return interaction.reply({ content: '❌ Chỉ Owner mới dùng được lệnh này.', flags: MessageFlags.Ephemeral });
        }
        const pickedUser = interaction.options.getUser('user');
        const targetId = pickedUser ? pickedUser.id : (interaction.options.getString('id') || '').trim();
        if (!/^\d{15,25}$/.test(targetId)) {
            return interaction.reply({ content: '❌ Hãy chọn user hoặc nhập ID Discord hợp lệ (chỉ gồm số).', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (adminIds.includes(targetId)) {
                return await interaction.editReply({ content: `❗ <@${targetId}> là Owner (cấu hình ở ADMIN_DISCORD_ID), không đổi được bằng lệnh này.` });
            }
            const already = await db.isAdmin(targetId);
            if (interaction.commandName === 'op') {
                if (already) return await interaction.editReply({ content: `❗ <@${targetId}> đã là admin rồi.` });
                await db.addAdmin(targetId, userId);
                await interaction.editReply({ content: `✅ Đã cấp quyền admin cho <@${targetId}>.` });
            } else {
                if (!already) return await interaction.editReply({ content: `❗ <@${targetId}> không phải admin.` });
                await db.removeAdmin(targetId);
                await interaction.editReply({ content: `✅ Đã thu hồi quyền admin của <@${targetId}>.` });
            }
        } catch (error) {
            console.error('[op/unop] lỗi:', error);
            await interaction.editReply({ content: `❌ Lỗi: ${error.message}`.slice(0, 1900) });
        }
    }

    // LỆNH /star - nhận nhiệm vụ đăng ký kênh YouTube
    if (interaction.commandName === 'star') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const today = getTodayString();
            const done = await db.checkDailyLimit(userId, 'star', today);
            if (done >= STAR_DAILY_MAX) {
                return await interaction.editReply({ content: `⏰ Hôm nay bạn đã hoàn thành tối đa **${STAR_DAILY_MAX} nhiệm vụ** rồi. Quay lại vào ngày mai nhé!` });
            }
            if (pendingStarUsers.has(userId)) {
                return await interaction.editReply({ content: '⏳ Bạn đang có nhiệm vụ chờ duyệt. Hãy đợi admin xác nhận trước khi nhận thêm.' });
            }
            const ytbUrl = process.env.YTB_CHANNEL_URL || 'https://youtube.com';
            pendingStarUsers.add(userId);
            await interaction.editReply({
                content: [
                    `📋 **NHIỆM VỤ: Đăng ký kênh YouTube**`,
                    ``,
                    `**Bước 1:** Truy cập kênh YouTube: ${ytbUrl}`,
                    `**Bước 2:** Bấm nút **Đăng ký** (Subscribe) 🔔`,
                    `**Bước 3:** Chụp màn hình xác nhận đã đăng ký`,
                    `**Bước 4:** Gửi ảnh chụp vào kênh **#${process.env.STAR_CHANNEL_NAME || 'star'}** để admin duyệt`,
                    ``,
                    `💰 Phần thưởng: **${STAR_REWARD} xu** sau khi admin xác nhận`,
                    `📆 Hạn mức: **${STAR_DAILY_MAX - done} lần** còn lại hôm nay`,
                    ``,
                    `⚠️ **Cảnh báo:** Gian lận (ảnh fake/chỉnh sửa) sẽ bị **trừ 20 xu** và hủy nhiệm vụ.`,
                ].join('\n')
            });
        } catch (error) {
            console.error('[star] lỗi:', error);
            pendingStarUsers.delete(userId);
            await interaction.editReply({ content: '❌ Lỗi khi nhận nhiệm vụ.' });
        }
    }

    // LỆNH /sdone - admin xác nhận hoàn thành nhiệm vụ /star
    if (interaction.commandName === 'sdone') {
        if (!(await isAdmin(userId))) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }
        const pickedUser = interaction.options.getUser('user');
        const targetId = pickedUser ? pickedUser.id : (interaction.options.getString('id') || '').trim();
        if (!/^\d{15,25}$/.test(targetId)) {
            return interaction.reply({ content: '❌ Hãy chọn user hoặc nhập ID Discord hợp lệ.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (busyUsers.has(targetId)) {
            return interaction.editReply({ content: '⏳ Người này đang có giao dịch khác, thử lại sau giây lát.' });
        }
        busyUsers.add(targetId);
        try {
            if (!pendingStarUsers.has(targetId)) {
                return await interaction.editReply({ content: `❗ <@${targetId}> không có nhiệm vụ nào đang chờ duyệt.` });
            }
            const today = getTodayString();
            const done = await db.checkDailyLimit(targetId, 'star', today);
            if (done >= STAR_DAILY_MAX) {
                pendingStarUsers.delete(targetId);
                return await interaction.editReply({ content: `❗ <@${targetId}> đã đạt giới hạn **${STAR_DAILY_MAX} nhiệm vụ** hôm nay.` });
            }
            await db.increaseDailyLimit(targetId, 'star', today);
            const newBalance = await db.updateCoins(targetId, STAR_REWARD);
            pendingStarUsers.delete(targetId);
            console.log(`[sdone] ${userId} duyệt ${targetId} (+${STAR_REWARD} xu, hôm nay: ${done + 1}/${STAR_DAILY_MAX})`);
            await interaction.editReply({ content: `✅ Đã xác nhận nhiệm vụ cho <@${targetId}>. Cộng **${STAR_REWARD} xu**. (Hôm nay: ${done + 1}/${STAR_DAILY_MAX})` });
            await interaction.followUp({
                content: `🎉 <@${targetId}> đã hoàn thành nhiệm vụ đăng ký kênh YouTube! Nhận **${STAR_REWARD} xu**. 💰 Số dư: **${newBalance} xu**`
            }).catch(() => {});
        } catch (error) {
            console.error('[sdone] lỗi:', error);
            await interaction.editReply({ content: `❌ Lỗi: ${error.message}`.slice(0, 1900) });
        } finally {
            busyUsers.delete(targetId);
        }
    }

    // LỆNH /adcoin <set|cong|tru> <số> (Admin)
    if (interaction.commandName === 'adcoin') {
        if (!(await isAdmin(userId))) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }
        const action = interaction.options.getString('hanhdong');
        const amount = interaction.options.getInteger('sotien');
        const pickedUser = interaction.options.getUser('user');
        const targetId = pickedUser ? pickedUser.id : (interaction.options.getString('id') || '').trim();
        if (!/^\d{15,25}$/.test(targetId)) {
            return interaction.reply({ content: '❌ Hãy chọn user hoặc nhập ID Discord hợp lệ (chỉ gồm số).', flags: MessageFlags.Ephemeral });
        }
        if (action !== 'set' && amount < 1) {
            return interaction.reply({ content: '❌ Số xu phải lớn hơn 0.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (busyUsers.has(targetId)) {
            return interaction.editReply({ content: '⏳ Người này đang có giao dịch khác, thử lại sau giây lát.' });
        }
        busyUsers.add(targetId);
        try {
            const current = await db.getCoins(targetId);
            let delta;
            if (action === 'set') delta = amount - current;
            else if (action === 'cong') delta = amount;
            else delta = -Math.min(amount, current); // trừ không xuống dưới 0
            const newBalance = delta === 0 ? current : await db.updateCoins(targetId, delta);
            console.log(`[ADMIN] ${userId} ${action} ${amount} -> ${targetId} (${current} => ${newBalance})`);
            const verb = action === 'set' ? 'Đặt' : (action === 'cong' ? 'Cộng' : 'Trừ');
            await interaction.editReply({ content: `✅ ${verb} **${action === 'set' ? amount : Math.abs(delta)} xu** cho <@${targetId}>.\n💰 Số dư: **${current} → ${newBalance} xu**` });
        } catch (error) {
            console.error('[adcoin] lỗi:', error);
            await interaction.editReply({ content: `❌ Lỗi: ${error.message}`.slice(0, 1900) });
        } finally {
            busyUsers.delete(targetId);
        }
    }

    // LỆNH /gen
    if (interaction.commandName === 'gen') {
        if (!(await isAdmin(userId))) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }
        const count = interaction.options.getInteger('soluong');
        const coinAmount = interaction.options.getInteger('xuthuong');

        if (count <= 0 || count > 50 || coinAmount <= 0) {
            return interaction.reply({ content: '❌ Số lượng từ 1-50, số xu > 0.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const giftCodes = [];
            for (let i = 0; i < count; i++) {
                const code = generateGiftCode();
                giftCodes.push(`${code} (${coinAmount} xu)`);
                await db.createGiftCode(code, coinAmount);
            }
            await interaction.editReply({
                content: `✅ Đã tạo **${count}** Gift Code (Mỗi code ${coinAmount} xu):`,
                files: [{ attachment: Buffer.from(giftCodes.join('\n')), name: `giftcodes_${count}.txt` }]
            });
        } catch (error) {
            console.error('[gen] lỗi:', error, error.cause);
            await interaction.editReply({ content: `❌ Lỗi tạo code: ${error.message}${error.cause ? ' - ' + (error.cause.code || error.cause.message) : ''}`.slice(0, 1800) });
        }
    }

    // LỆNH /clear
    if (interaction.commandName === 'clear') {
        if (!(await isAdmin(userId))) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const channel = interaction.channel;
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(msg => msg.author.id === client.user.id && msg.createdTimestamp < twoHoursAgo);

            if (messagesToDelete.size === 0) {
                return await interaction.editReply({ content: 'ℹ️ Không có tin nhắn nào của Bot cũ hơn 2 giờ.' });
            }
            await channel.bulkDelete(messagesToDelete, true);
            await interaction.editReply({ content: `✅ Đã xóa **${messagesToDelete.size}** tin nhắn.` });
        } catch (error) {
            await interaction.editReply({ content: `❌ Lỗi: ${error.message}` });
        }
    }
});

if (process.env.DISABLE_BOT === '1') {
    console.log('[BOT] DISABLE_BOT=1 — bỏ qua đăng nhập Discord (chỉ chạy web).');
} else {
    client.login(process.env.DISCORD_TOKEN);
}


// ==========================================
// AUTO REJOIN — tự reconnect khi bị disconnect
// ==========================================
client.on('disconnect', () => {
    console.warn('[BOT] Bị disconnect. Đang thử reconnect...');
});

client.on('shardDisconnect', (event, shardId) => {
    console.warn(`[BOT] Shard ${shardId} disconnect (code ${event.code}). Đang thử reconnect...`);
});

client.on('shardReconnecting', (shardId) => {
    console.log(`[BOT] Shard ${shardId} đang reconnect...`);
});

client.on('shardResume', (shardId, replayedEvents) => {
    console.log(`[BOT] Shard ${shardId} resume OK (${replayedEvents} events replayed).`);
});

client.on('error', (err) => {
    console.error('[BOT] Lỗi client:', err.message);
});

// fallback: nếu ws chết hoàn toàn thì destroy + login lại
async function safeRelogin(attempt = 1) {
    const MAX = 10;
    const delay = Math.min(5000 * attempt, 60000); // 5s, 10s, ... tối đa 60s
    console.log(`[BOT] Thử relogin lần ${attempt}/${MAX} sau ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
    try {
        await client.destroy();
        await client.login(process.env.DISCORD_TOKEN);
        console.log('[BOT] Relogin thành công.');
    } catch (err) {
        console.error(`[BOT] Relogin thất bại (lần ${attempt}):`, err.message);
        if (attempt < MAX) return safeRelogin(attempt + 1);
        console.error('[BOT] Hết lần thử, dừng relogin.');
    }
}

client.ws.on('INVALIDATED', () => {
    console.error('[BOT] Session bị invalidate — relogin...');
    safeRelogin();
});

// bắt unhandledRejection để bot không crash
process.on('unhandledRejection', (err) => {
    console.error('[BOT] unhandledRejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('[BOT] uncaughtException:', err?.message || err);
});
