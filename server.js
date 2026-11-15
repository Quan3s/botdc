require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

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

        console.log(`[WEB] User ${user_id} vượt link ${provider}. +50 xu. Số dư: ${newBalance}`);

        res.send(`
            <body style="background:#080d0b; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif; margin:0;">
                <div style="background:#101a14; padding:30px; border-radius:16px; border:1px solid #39f58a; text-align:center; max-width:400px; width:100%;">
                    <h2 style="color:#39f58a;">✅ VƯỢT LINK THÀNH CÔNG!</h2>
                    <p style="font-size:16px; margin-bottom:20px;">Bạn đã nhận được <b style="color:#ffc107;">+50 xu</b>.</p>
                    <p style="color:#91a096; font-size:14px; margin-bottom:20px;">Số dư hiện tại: <b style="color:#39f58a;">${newBalance} xu</b></p>
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

// ==========================================
// PHẦN 2: DISCORD BOT
// ==========================================
client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder().setName('getlink').setDescription('Lấy link nhiệm vụ để nhận 50 xu (Tối đa 2 lần/ngày)')
            .addStringOption(opt => opt.setName('provider').setDescription('Chọn dịch vụ rút gọn link').addChoices(
                { name: 'Link4M', value: 'link4m' },
                { name: 'LayMa', value: 'layma' }
            ).setRequired(false)),
        new SlashCommandBuilder().setName('reg').setDescription('Lấy mail|pass (Tốn 10 xu)'),
        new SlashCommandBuilder().setName('vi').setDescription('Xem số dư xu của bạn'),
        new SlashCommandBuilder().setName('code').setDescription('Nhập Gift Code để nhận xu')
            .addStringOption(o => o.setName('gift_code').setDescription('Mã quà tặng').setRequired(true)),
        new SlashCommandBuilder().setName('buycloud').setDescription('Mua VMOS (Miễn phí)')
            .addStringOption(o => o.setName('account').setDescription('Nhập email|password').setRequired(true)),
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
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const adminIds = getAdminIds();
    const userId = interaction.user.id;

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

    // LỆNH /reg
    if (interaction.commandName === 'reg') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const currentCoins = await db.getCoins(userId);
            if (currentCoins < 10) {
                return await interaction.editReply({ content: `❌ Bạn không đủ xu (Cần 10 xu). Số dư: **${currentCoins} xu**.` });
            }

            const response = await fetch('https://wxygtmfttyidwnhjdwdw.supabase.co/functions/v1/get-key', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': process.env.APIKEY },
                body: JSON.stringify({ clientId: crypto.randomUUID() })
            });
            const data = await response.json();
            if (!data.content) throw new Error("Không lấy được dữ liệu.");

            const newBalance = await db.updateCoins(userId, -10);
            const [mail, ...passParts] = data.content.split('|');
            
            await interaction.editReply({ 
                content: `✅ Mua thành công! (Đã trừ 10 xu)\n📧 \`${mail}\`\n🔑 \`${passParts.join('|')}\`\n💰 Số dư còn lại: **${newBalance} xu**` 
            });
        } catch (error) { 
            console.error('[reg] lỗi:', error, error.cause);
            await interaction.editReply({ content: `❌ ${error.message}${error.cause ? ' - ' + (error.cause.code || error.cause.message) : ''} (Chưa bị trừ xu).` }); 
        }
    }

    // LỆNH /buycloud
    if (interaction.commandName === 'buycloud') {
        const accountInfo = interaction.options.getString('account').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (!accountInfo.includes('|')) {
                return await interaction.editReply({ content: '❌ Sai định dạng. Vui lòng nhập theo dạng: `email|password`' });
            }

            const response = await fetch('https://kingdev.shop/api/v2/buy-vmos.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: process.env.KINGDEV_API_KEY, account: accountInfo })
            });
            const data = await response.json();

            if (data.success === true) {
                await interaction.editReply({ 
                    content: `✅ **Mua VMOS thành công!**\n🆔 Mã đơn hàng: \`${data.data.order_id}\`\n📧 Tài khoản: \`${data.data.credential}\``
                });
            } else {
                await interaction.editReply({ content: `❌ Lỗi từ KingDev: ${data.message || 'Không rõ'}` });
            }
        } catch (error) {
            await interaction.editReply({ content: `❌ Lỗi kết nối: ${error.message}` });
        }
    }

    // LỆNH /gen
    if (interaction.commandName === 'gen') {
        if (!adminIds.includes(userId)) {
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
        if (!adminIds.includes(userId)) {
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

client.login(process.env.DISCORD_TOKEN);
