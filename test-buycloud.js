// test-buycloud.js - chạy riêng logic gọi API của lệnh /buycloud
// Dùng: KINGDEV_API_KEY=xxx node test-buycloud.js [account]
// Mặc định gửi account sai định dạng để KHÔNG mua máy thật.
try { require('dotenv').config(); } catch {}

const apiKey = process.env.KINGDEV_API_KEY;
const account = process.argv[2] || 'khongphaiaccount';

async function main() {
    if (!apiKey) return console.log('❌ Thiếu KINGDEV_API_KEY');
    console.log('⏳ Gọi KingDev...  (key:', apiKey.slice(0, 4) + '***, account:', account + ')');

    // === Y HỆT logic trong server.js ===
    const response = await fetch('https://kingdev.shop/api/v2/buy-vmos.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ api_key: apiKey, account })
    });
    const raw = await response.text();
    // ===================================

    console.log('📡 HTTP', response.status, '|', response.headers.get('content-type'));
    try {
        const data = JSON.parse(raw);
        console.log('✅ JSON hợp lệ:', data);
    } catch {
        console.log('❌ KHÔNG phải JSON. 300 ký tự đầu:\n' + raw.slice(0, 300));
    }
}

main().catch(e => console.log('❌ Lỗi:', e.message, e.cause ? '| cause: ' + (e.cause.code || e.cause.message) : ''));
