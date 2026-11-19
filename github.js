/**
 * GitHub Gist helper — dùng để lưu kho hàng của shop.
 *
 * Mỗi sản phẩm = 1 gist (secret) chứa 1 file text, mỗi dòng là 1 tài khoản.
 * Khi có người mua, server lấy ra N dòng đầu rồi ghi lại gist với phần còn lại.
 *
 * Cần biến môi trường: GITHUB_TOKEN (fine-grained / classic có scope `gist`).
 */
const API = 'https://api.github.com';

function getToken() {
    return (process.env.GITHUB_TOKEN || '').trim();
}

function hasToken() {
    return getToken().length > 0;
}

async function gh(pathname, options = {}) {
    const token = getToken();
    if (!token) throw new Error('Chưa cấu hình GITHUB_TOKEN nên không dùng được gist.');
    const res = await fetch(`${API}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'asynctas-shop',
            ...(options.headers || {}),
        },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
        const msg = (data && (data.message || data.error)) || text.slice(0, 200) || res.statusText;
        throw new Error(`GitHub API lỗi (${res.status}): ${msg}`);
    }
    return data;
}

function safeFilename(name) {
    const cleaned = String(name || 'stock')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${cleaned || 'stock'}.txt`;
}

async function createGist(filename, content, description) {
    const data = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
            description: description || 'ASYNCTAS shop stock',
            public: false,
            files: { [filename]: { content: content || '' } },
        }),
    });
    return { id: data.id, url: data.html_url, filename };
}

/** Đọc nội dung 1 file trong gist (xử lý cả trường hợp bị truncate). */
async function readGistFile(gistId, filename) {
    const gist = await gh(`/gists/${gistId}`);
    const file = gist.files && gist.files[filename];
    if (!file) throw new Error(`Không tìm thấy file "${filename}" trong gist.`);
    if (file.truncated && file.raw_url) {
        const res = await fetch(file.raw_url, { headers: { 'User-Agent': 'asynctas-shop' } });
        if (!res.ok) throw new Error('Không đọc được nội dung gist (raw).');
        return await res.text();
    }
    return file.content || '';
}

async function writeGistFile(gistId, filename, content) {
    await gh(`/gists/${gistId}`, {
        method: 'PATCH',
        body: JSON.stringify({ files: { [filename]: { content: content || '' } } }),
    });
}

async function deleteGist(gistId) {
    try { await gh(`/gists/${gistId}`, { method: 'DELETE' }); } catch (e) { /* bỏ qua */ }
}

function parseLines(content) {
    return String(content || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

module.exports = { hasToken, safeFilename, createGist, readGistFile, writeGistFile, deleteGist, parseLines };
