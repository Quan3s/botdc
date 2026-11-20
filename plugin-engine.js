/**
 * Plugin engine — cho phép thêm logic/API mới mà không deploy lại.
 *
 * Admin dán link raw script trong mục Admin → Plugin. Script được tải về,
 * lưu thành 1 GitHub Gist (secret) và gist_id được ghi vào DB. Mỗi lần reload
 * (hoặc lúc khởi động), engine đọc LẠI từ gist rồi thực thi trong VM sandbox.
 *
 * Script mẫu:
 *   api.get('/hello', (req, res) => res.json({ ok: true, msg: 'Hello' }));
 *   api.command('ping', async ({ interaction }) => interaction.editReply('pong'));
 *
 * Web route: /plugin/<plugin-id>/hello
 * Discord:   /plugin name:ping
 *
 * LƯU Ý: VM sandbox ở đây để hạn chế, KHÔNG phải hàng rào bảo mật tuyệt đối.
 * Chỉ admin mới được thêm plugin, và chỉ dùng nguồn script tin cậy.
 */
const vm = require('vm');
const express = require('express');
const crypto = require('crypto');
const db = require('./database');
const github = require('./github');

const loaded = new Map(); // pluginId -> { id, name, router, commands, meta }

function safeRequire(name) {
    const allowed = ['crypto', 'path', 'url', 'util', 'querystring'];
    if (!allowed.includes(String(name))) {
        throw new Error(`Module "${name}" không được phép trong plugin.`);
    }
    return require(name);
}

async function fetchScript(url) {
    const value = String(url || '').trim();
    let parsed;
    try { parsed = new URL(value); } catch (e) { throw new Error('Link script không hợp lệ.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Chỉ hỗ trợ link http/https.');

    const res = await fetch(value, {
        headers: { 'User-Agent': 'ASYNCTAS-plugin-loader' },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Không tải được script (HTTP ${res.status}).`);
    const text = await res.text();
    if (text.length > 200 * 1024) throw new Error('Script quá lớn (tối đa 200KB).');
    if (!text.trim()) throw new Error('Script rỗng.');
    return text;
}

async function loadPlugin(row) {
    const pluginId = String(row.id);
    let code;
    try {
        code = row.gist_id
            ? await github.readGistFile(row.gist_id, row.gist_filename)
            : await fetchScript(row.source_url);
    } catch (e) {
        await db.updatePlugin(pluginId, { error: e.message }).catch(() => {});
        loaded.delete(pluginId);
        throw e;
    }

    const router = express.Router();
    const commands = new Map();

    const api = {
        db,
        crypto,
        get: (path, handler) => router.get(path, wrap(handler)),
        post: (path, handler) => router.post(path, wrap(handler)),
        put: (path, handler) => router.put(path, wrap(handler)),
        patch: (path, handler) => router.patch(path, wrap(handler)),
        delete: (path, handler) => router.delete(path, wrap(handler)),
        route: (method, path, handler) => router[String(method).toLowerCase()](path, wrap(handler)),
        command: (name, execute, description = '') => {
            commands.set(String(name), { name: String(name), execute, description, pluginId });
        },
        log: (...args) => console.log(`[plugin:${row.name}]`, ...args),
        kv: async (key, value) => {
            const full = `plugin:${pluginId}:${key}`;
            if (value === undefined) return db.getKv(full);
            await db.setKv(full, value);
            return value;
        },
        webhook: async (payload) => {
            const url = process.env.LEADERBOARD_WEBHOOK_URL;
            if (!url) return false;
            const res = await fetch(`${url}?wait=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            return res.ok;
        },
    };

    function wrap(handler) {
        return (req, res, next) => {
            Promise.resolve(handler(req, res, next, { db, api, plugin: row })).catch(next);
        };
    }

    const sandbox = {
        console: {
            log: (...a) => console.log(`[plugin:${row.name}]`, ...a),
            warn: (...a) => console.warn(`[plugin:${row.name}]`, ...a),
            error: (...a) => console.error(`[plugin:${row.name}]`, ...a),
        },
        module: { exports: {} },
        exports: {},
        require: safeRequire,
        api,
        db,
        crypto,
        fetch,
        URL,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    };
    sandbox.exports = sandbox.module.exports;

    try {
        const context = vm.createContext(sandbox, { name: `plugin:${row.name}` });
        vm.runInContext(code, context, { timeout: 5000, filename: `${row.name}.plugin.js` });
        // Cho phép script exports sẵn function register(api) thay vì gọi trực tiếp
        if (typeof sandbox.module.exports === 'function') {
            await sandbox.module.exports(api);
        } else if (sandbox.module.exports && typeof sandbox.module.exports.register === 'function') {
            await sandbox.module.exports.register(api);
        }
    } catch (e) {
        await db.updatePlugin(pluginId, { error: e.message }).catch(() => {});
        loaded.delete(pluginId);
        throw e;
    }

    loaded.set(pluginId, {
        id: pluginId,
        name: row.name,
        router,
        commands,
        api,
        meta: {
            id: pluginId,
            name: row.name,
            routes: router.stack.filter(l => l.route).map(l => ({
                method: Object.keys(l.route.methods)[0].toUpperCase(),
                path: l.route.path,
            })),
            commands: [...commands.values()].map(c => ({ name: c.name, description: c.description })),
        },
    });
    await db.updatePlugin(pluginId, { error: null, last_loaded_at: new Date().toISOString() }).catch(() => {});
    return loaded.get(pluginId).meta;
}

async function reloadAll() {
    const plugins = await db.getPlugins();
    let ok = 0;
    for (const p of plugins) {
        if (p.enabled === false) { loaded.delete(String(p.id)); continue; }
        try { await loadPlugin(p); ok++; }
        catch (e) { console.error(`[plugin] ${p.name}: ${e.message}`); }
    }
    console.log(`[plugin] Đã load ${ok}/${plugins.length} plugin.`);
}

function dispatcher(req, res, next) {
    const match = /^\/([^/?]+)(.*)$/.exec(req.url || '');
    if (!match) return res.status(400).json({ error: 'Thiếu plugin id.' });
    const id = decodeURIComponent(match[1]);
    const entry = loaded.get(id);
    if (!entry) return res.status(404).json({ error: 'Plugin không tồn tại hoặc chưa được load.' });

    const originalUrl = req.url;
    const originalBase = req.baseUrl;
    req.url = match[2] || '/';
    if (!req.url.startsWith('/')) req.url = `/${req.url}`;
    req.baseUrl = `${originalBase || ''}/plugin/${id}`;
    return entry.router(req, res, (err) => {
        req.url = originalUrl;
        req.baseUrl = originalBase;
        next(err);
    });
}

function getCommand(name, pluginName) {
    const key = String(name || '').trim();
    const filter = String(pluginName || '').trim().toLowerCase();
    for (const entry of loaded.values()) {
        if (filter && entry.name.toLowerCase() !== filter && entry.id.toLowerCase() !== filter) continue;
        const cmd = entry.commands.get(key);
        if (cmd) return cmd;
    }
    return null;
}

function list() {
    return [...loaded.entries()].map(([id, entry]) => ({ id, ...entry.meta }));
}

function apiFor(pluginId) {
    const entry = loaded.get(String(pluginId));
    return entry ? entry.api : null;
}

function unload(id) {
    loaded.delete(String(id));
}

async function remove(id) {
    const pluginId = String(id);
    unload(pluginId);
    const row = await db.getPlugin(pluginId);
    if (row && row.gist_id) await github.deleteGist(row.gist_id);
    await db.deletePlugin(pluginId);
}

module.exports = {
    loaded,
    loadPlugin,
    reloadAll,
    dispatcher,
    getCommand,
    list,
    apiFor,
    unload,
    remove,
    fetchScript,
};
