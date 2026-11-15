require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const Redis = require('ioredis');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

// ==========================================
// KHỞI TẠO CHUNG
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Hàm sinh Token (48 ký tự, không tiền tố)
function generateSecureToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const bytes = crypto.randomBytes(48);
    for (let i = 0; i < 48; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

// Lấy ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD)
function getTodayString() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return vnTime.toISOString().split('T')[0];
}

// Lấy danh sách Admin từ .env
function getAdminIds() {
    return (process.env.ADMIN_DISCORD_ID || '').split(',').map(id => id.trim()).filter(id => id);
}

// ==========================================
// PHẦN 1: WEB SERVER (NHẬN TOKEN)
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
        const sessionValid = await redis.getdel(`session_${sid}`); 
        if (!sessionValid) return renderError("Link này đã được sử dụng hoặc đã hết hạn.");

        const newToken = generateSecureToken();
        await redis.set(newToken, '1', 'EX', 30 * 24 * 60 * 60);

        console.log(`[WEB] Cấp Token mới: ${newToken} (Từ session: ${sid})`);

        res.send(`
            <body style="background:#080d0b; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; margin:0;">
                <div style="background:#101a14; padding:30px; border-radius:16px; border:1px solid #39f58a; text-align:center; max-width:400px; width:100%;">
                    <h2 style="color:#39f58a;">✅ LẤY TOKEN THÀNH CÔNG</h2>
                    <div style="background:#0a0e14; padding:15px; border-radius:8px; font-family:monospace; font-size:16px; word-break:break-all; margin:20px 0; border:1px dashed #1f3428; color:#39f58a; user-select:all;">
                        ${newToken}
                    </div>
                    <p style="color:#91a096; font-size:13px;">Quay lại Discord và dùng lệnh:<br><b style="color:#fff">/reg ${newToken}</b></p>
                </div>
            </body>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send("Lỗi Server.");
    }
});

app.listen(PORT, () => console.log(`\n✅ Web Server đang chạy: http://localhost:${PORT}`));

// ==========================================
// PHẦN 2: DISCORD BOT
// ==========================================
client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('getlink')
            .setDescription('Lấy link nhiệm vụ để nhận Token (Tối đa 2 lần/ngày)')
            .addStringOption(opt => 
                opt.setName('provider')
                   .setDescription('Chọn dịch vụ rút gọn link')
                   .addChoices(
                       { name: 'Link4M', value: 'link4m' },
                       { name: 'LayMa', value: 'layma' }
                   )
                   .setRequired(false)
            ),
        new SlashCommandBuilder().setName('reg').setDescription('Lấy mail|pass')
            .addStringOption(o => o.setName('token').setDescription('Token của bạn').setRequired(true)),
        new SlashCommandBuilder().setName('gen').setDescription('Tạo token (Admin)')
            .addIntegerOption(o => o.setName('soluong').setDescription('Số lượng').setRequired(true)),
        
        // LỆNH MỚI: /clear (Admin)
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
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const adminIds = getAdminIds();

    // ==========================================
    // LỆNH /getlink
    // ==========================================
    if (interaction.commandName === 'getlink') {
        const userId = interaction.user.id;
        const provider = interaction.options.getString('provider') || 'link4m';
        const today = getTodayString();
        const limitKey = `limit_${userId}_${provider}_${today}`;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const currentCount = await redis.get(limitKey) || 0;
            if (parseInt(currentCount) >= 2) {
                return await interaction.editReply({ 
                    content: `❌ Bạn đã đạt giới hạn **2 lần/ngày** cho dịch vụ **${provider === 'link4m' ? 'Link4M' : 'LayMa'}**. Vui lòng quay lại vào ngày mai!` 
                });
            }

            const sessionId = crypto.randomBytes(16).toString('hex');
            await redis.set(`session_${sessionId}`, '1', 'EX', 300);

            const targetUrl = `${process.env.RENDER_DOMAIN}/redeem?sid=${sessionId}`;
            let finalUrl = '';
            let providerName = '';

            if (provider === 'link4m') {
                providerName = 'Link4M';
                const apiUrl = `https://link4m.co/api-shorten/v2?api=${process.env.LINK4M_API_KEY}&url=${encodeURIComponent(targetUrl)}`;
                const res = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    }
                });
                const text = await res.text();
                try {
                    const data = JSON.parse(text);
                    if (data.status === "success" && data.shortenedUrl) finalUrl = data.shortenedUrl;
                    else throw new Error(data.message || 'Lỗi từ Link4M');
                } catch (e) { throw new Error("Link4M từ chối yêu cầu hoặc lỗi định dạng."); }

            } else if (provider === 'layma') {
                providerName = 'LayMa';
                const apiUrl = `https://api.layma.net/api/admin/shortlink/quicklink?tokenUser=${process.env.LAYMA_TOKEN}&format=json&url=${encodeURIComponent(targetUrl)}`;
                const res = await fetch(apiUrl);
                const data = await res.json();
                if (data.success === true && data.html) finalUrl = data.html;
                else throw new Error(data.message || 'Lỗi từ LayMa');
            }

            await redis.incr(limitKey);
            const now = new Date();
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            const secondsUntilEndOfDay = Math.floor((endOfDay - now) / 1000);
            await redis.expire(limitKey, secondsUntilEndOfDay);

            const embed = new EmbedBuilder()
                .setColor(provider === 'link4m' ? 0xffc107 : 0x8b5cf6)
                .setTitle(`🔗 LINK NHẬN TOKEN (${providerName})`)
                .setDescription(`Bấm vào link dưới đây để vượt nhiệm vụ. Bạn còn **${2 - (parseInt(currentCount) + 1)}** lượt cho hôm nay.`)
                .addFields({ name: 'Link nhiệm vụ', value: finalUrl });
            await interaction.editReply({ embeds: [embed] });

        } catch (e) {
            console.error(`Lỗi /getlink [${provider}]:`, e.message);
            await interaction.editReply({ content: `❌ Lỗi từ ${provider === 'link4m' ? 'Link4M' : 'LayMa'}: ${e.message}` });
        }
    }

    // ==========================================
    // LỆNH /reg
    // ==========================================
    if (interaction.commandName === 'reg') {
        const token = interaction.options.getString('token').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const tokenValue = await redis.getdel(token);
            if (!tokenValue) return await interaction.editReply({ content: '❌ Token không hợp lệ hoặc đã dùng.' });

            const response = await fetch('https://wxygtmfttyidwnhjdwdw.supabase.co/functions/v1/get-key', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': process.env.APIKEY },
                body: JSON.stringify({ clientId: crypto.randomUUID() })
            });
            const data = await response.json();
            if (!data.content) throw new Error("Không lấy được dữ liệu.");

            const [mail, ...passParts] = data.content.split('|');
            await interaction.editReply({ content: `✅ Thành công!\n📧 \`${mail}\`\n🔑 \`${passParts.join('|')}\`` });
        } catch (error) { await interaction.editReply({ content: `❌ ${error.message}` }); }
    }

    // ==========================================
    // LỆNH /gen (Admin)
    // ==========================================
    if (interaction.commandName === 'gen') {
        if (!adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }
        const count = interaction.options.getInteger('soluong');
        if (count <= 0 || count > 100) {
            return interaction.reply({ content: '❌ Số lượng từ 1 đến 100.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const tokens = [];
            for (let i = 0; i < count; i++) {
                const t = generateSecureToken();
                tokens.push(t);
                await redis.set(t, '1', 'EX', 30 * 24 * 60 * 60);
            }
            await interaction.editReply({
                content: `✅ Đã tạo **${count}** token:`,
                files: [{ attachment: Buffer.from(tokens.join('\n')), name: `tokens_${count}.txt` }]
            });
        } catch (error) {
            await interaction.editReply({ content: '❌ Lỗi tạo token.' });
        }
    }

    // ==========================================
    // LỆNH /clear (Admin - Xóa tin nhắn bot > 2h)
    // ==========================================
    if (interaction.commandName === 'clear') {
        if (!adminIds.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ Không có quyền.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = interaction.channel;
            let deletedCount = 0;
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);

            // Lấy 100 tin nhắn gần nhất
            const messages = await channel.messages.fetch({ limit: 100 });
            
            // Lọc các tin nhắn của bot và cũ hơn 2 giờ
            const messagesToDelete = messages.filter(msg => 
                msg.author.id === client.user.id && msg.createdTimestamp < twoHoursAgo
            );

            if (messagesToDelete.size === 0) {
                return await interaction.editReply({ content: 'ℹ️ Không có tin nhắn nào của Bot cũ hơn 2 giờ để xóa.' });
            }

            // Xóa tin nhắn
            await channel.bulkDelete(messagesToDelete, true);
            deletedCount = messagesToDelete.size;

            await interaction.editReply({ content: `✅ Đã xóa thành công **${deletedCount}** tin nhắn của Bot cũ hơn 2 giờ.` });

        } catch (error) {
            console.error('Lỗi /clear:', error);
            await interaction.editReply({ content: `❌ Lỗi: ${error.message}` });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
