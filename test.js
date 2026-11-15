// test.js
const apiKey = '6af930bcf82ce8e88007a5c7'; // Sửa lại API Key của bạn ở đây
const urlToShorten = 'https://google.com';
const apiUrl = `https://link4m.co/api-shorten/v2?api=${apiKey}&url=${encodeURIComponent(urlToShorten)}`;

async function testFetch() {
    console.log("⏳ Đang gửi request bằng fetch...");
    try {
        // Gọi giống hệt trong bot
        const res = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        console.log(`📡 Status Code: ${res.status}`);
        
        const text = await res.text();
        
        // Thử parse JSON
        try {
            const data = JSON.parse(text);
            console.log("✅ KẾT QUẢ JSON HỢP LỆ:");
            console.log(data);
        } catch (e) {
            console.log("❌ LỖI: Server trả về HTML (không phải JSON)");
            console.log("Đoạn HTML nhận được (100 ký tự đầu):");
            console.log(text.substring(0, 100) + "...");
        }

    } catch (error) {
        console.error("❌ Lỗi mạng:", error.message);
    }
}

testFetch();
