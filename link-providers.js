/**
 * Cấu hình chung cho các dịch vụ rút gọn link ở cả web và Discord bot.
 * Mỗi provider có reward + số lượt/ngày riêng. /redeem đọc reward từ đây
 * nên web và bot luồng đồng nhất.
 */
const PROVIDERS = {
    link4m: {
        id: 'link4m',
        name: 'Link4M',
        reward: 50,
        dailyMax: 2,
        color: 0xffc107,
    },
    '2ktraffic': {
        id: '2ktraffic',
        name: '2ktraffic',
        reward: 38,
        dailyMax: 4,
        color: 0xf97316,
    },
    bbmkts: {
        id: 'bbmkts',
        name: 'bbmkts',
        reward: 25,
        dailyMax: 1,
        color: 0x22c55e,
    },
};

// Cookie httpOnly do admin đặt qua /api/admin/link-api-key; env là dự phòng.
const API_KEY_COOKIE = 'asynctas_2k_key';
const DEFAULT_2K_KEY = '2kt_4f97b69261c932afa33d194e2431f9db12c39cd98f606370';

function cookieValue(req, name) {
    const raw = req && req.headers && req.headers.cookie;
    if (!raw) return '';
    for (const part of String(raw).split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return '';
}

function get(id) {
    return PROVIDERS[String(id || '').toLowerCase()] || null;
}

function rewardFor(id) {
    const p = get(id);
    return p ? p.reward : 50;
}

function dailyMaxFor(id) {
    const p = get(id);
    return p ? p.dailyMax : 2;
}

function tokenFor(id, req) {
    switch (String(id)) {
        case 'bbmkts':
            return process.env.BBMKTS_API_TOKEN || process.env.VUOTNHANH_API_TOKEN || '';
        case 'link4m':
            return process.env.LINK4M_API_KEY || '';
        case '2ktraffic':
            return cookieValue(req, API_KEY_COOKIE) || process.env.TWOKTRAFFIC_API_KEY || DEFAULT_2K_KEY;
        default:
            return '';
    }
}

function ready(id, req) {
    return !!tokenFor(id, req);
}

/** Rút gọn targetUrl. Ném lỗi nếu provider chưa cấu hình hoặc API trả về rỗng. */
async function shorten(id, longUrl, req) {
    const provider = get(id);
    if (!provider) throw new Error('Dịch vụ không hợp lệ.');
    const target = String(longUrl || '');
    if (!target) throw new Error('Thiếu URL cần rút gọn.');

    if (provider.id === 'bbmkts') {
        const token = tokenFor('bbmkts');
        if (!token) throw new Error('bbmkts chưa được cấu hình (BBMKTS_API_TOKEN).');
        const apiUrl = `https://bbmkts.com/dapi?token=${encodeURIComponent(token)}&longurl=${encodeURIComponent(target)}&format=text`;
        const res = await fetch(apiUrl, {
            headers: { 'User-Agent': 'ASYNCTAS-link', Accept: 'text/plain, application/json' },
            signal: AbortSignal.timeout(15000),
        });
        const raw = (await res.text()).trim();
        if (!res.ok || !raw) throw new Error('Lỗi từ bbmkts.');

        // API có thể trả TEXT hoặc JSON tuỳ bản; hỗ trợ cả hai.
        try {
            const data = JSON.parse(raw);
            if (data.status === 'success' && data.bbmktsUrl && /^https?:\/\//i.test(String(data.bbmktsUrl))) {
                return String(data.bbmktsUrl);
            }
        } catch (e) { /* giữ nguyên raw */ }
        if (/^https?:\/\//i.test(raw)) return raw;
        throw new Error('Lỗi từ bbmkts.');
    }

    if (provider.id === 'link4m') {
        const token = tokenFor('link4m');
        if (!token) throw new Error('Link4M chưa được cấu hình (LINK4M_API_KEY).');
        const apiUrl = `https://link4m.co/api-shorten/v2?api=${encodeURIComponent(token)}&url=${encodeURIComponent(target)}`;
        const res = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (data.status === 'success' && data.shortenedUrl) return data.shortenedUrl;
        throw new Error('Lỗi từ Link4M.');
    }

    // 2ktraffic: GET /api/quicklink/api -> { status, shortenedUrl, slug, destination }
    const token = tokenFor('2ktraffic', req);
    if (!token) throw new Error('2ktraffic chưa được cấu hình (cookie admin hoặc TWOKTRAFFIC_API_KEY).');
    const apiUrl = `https://2ktraffic.com/api/quicklink/api?api=${encodeURIComponent(token)}&url=${encodeURIComponent(target)}`;
    const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'ASYNCTAS-link', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* xử lý bên dưới */ }
    const reason = data && (data.message || data.error || data.status)
        ? (data.message || data.error || data.status)
        : text.slice(0, 120);
    // 401/403 thường là key sai hoặc nguồn chưa được duyệt: phải đưa lý do provider lên FE.
    if (!res.ok) throw new Error(`Lỗi từ 2ktraffic (${res.status}): ${reason}`);
    if (data && data.status === 'success' && data.shortenedUrl) return String(data.shortenedUrl);
    throw new Error(`Lỗi từ 2ktraffic: ${reason}`);
}

module.exports = {
    PROVIDERS,
    API_KEY_COOKIE,
    get,
    rewardFor,
    dailyMaxFor,
    tokenFor,
    ready,
    shorten,
};
