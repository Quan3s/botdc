/* ASYNCTAS dashboard — vanilla JS */
'use strict';

const state = {
  user: null,
  view: 'dashboard',
  shop: [],
  lbTab: 'coins',
  adminTab: 'user',
  plugins: [],
};

let cloudStatusTimer = null;

// ==================== HELPERS ====================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'all .3s ease';
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Lỗi ${res.status}`);
    err.data = data || {};
    err.status = res.status;
    throw err;
  }
  return data;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = 'Đã copy ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  }
  toast('Đã copy vào clipboard');
}

function openModal({ title, body, actions }) {
  const root = $('#modal-root');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const h = document.createElement('h3');
  h.textContent = title;
  modal.appendChild(h);
  const bodyEl = document.createElement('div');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  modal.appendChild(bodyEl);
  const actionsEl = document.createElement('div');
  actionsEl.className = 'modal-actions';
  (actions || []).forEach(action => {
    const btn = document.createElement('button');
    btn.className = `btn ${action.className || 'btn-soft'}`;
    btn.textContent = action.label;
    btn.onclick = () => action.onClick ? action.onClick(btn) : closeModal();
    actionsEl.appendChild(btn);
  });
  modal.appendChild(actionsEl);
  root.appendChild(modal);
  root.onclick = (e) => { if (e.target === root) closeModal(); };
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
}

// ==================== AUTH ====================
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$$('.auth-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.auth-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const tabName = tab.dataset.tab;
  $('#login-form').classList.toggle('hidden', tabName !== 'login');
  $('#register-form').classList.toggle('hidden', tabName !== 'register');
  $('#token-form').classList.toggle('hidden', tabName !== 'token');
}));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-username').value, password: $('#login-password').value }),
    });
    await enterApp(data.user);
  } catch (err) {
    if (err.data && err.data.requiresUsernameChange) {
      promptUsernameChange(err.data, { password: $('#login-password').value });
    } else toast(err.message, 'error');
  }
});

$('#token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#token-login-token').value.trim();
  try {
    const data = await api('/api/auth/discord-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    await enterApp(data.user);
  } catch (err) {
    if (err.data && err.data.requiresUsernameChange) {
      promptUsernameChange({ ...err.data, token }, {});
    } else toast(err.message, 'error');
  }
});

function promptUsernameChange(info, credentials) {
  const wrap = document.createElement('div');
  const isToken = Boolean(info.token);
  const passwordField = isToken
    ? '<p class="muted">Đang xác thực bằng token Discord, không cần mật khẩu.</p>'
    : '<label>Mật khẩu hiện tại<input id="rename-password" type="password" value="' + esc(credentials.password || '') + '" /></label>';
  wrap.innerHTML = `
    <p class="muted">Tài khoản cũ <b>${esc(info.currentUsername)}</b> chỉ có số. Đặt tên mới có ít nhất <b>1 chữ cái</b> để tiếp tục.</p>
    ${passwordField}
    <label>Tên mới<input id="rename-username" placeholder="VD: gamer123" value="" /></label>`;
  openModal({
    title: '⚠️ Đổi tên tài khoản',
    body: wrap,
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Đổi tên & đăng nhập', className: 'btn-primary', onClick: async (btn) => {
          const newUsername = wrap.querySelector('#rename-username').value.trim();
          if (!/^[a-zA-Z0-9_]{3,24}$/.test(newUsername) || !/[A-Za-z]/.test(newUsername)) {
            toast('Tên mới phải 3-24 ký tự, có ít nhất 1 chữ cái.', 'error');
            return;
          }
          btn.disabled = true;
          try {
            const data = await api('/api/auth/claim-username', {
              method: 'POST',
              body: JSON.stringify({
                currentUsername: info.currentUsername,
                newUsername,
                password: isToken ? '' : (wrap.querySelector('#rename-password')?.value || ''),
                token: isToken ? info.token : '',
              }),
            });
            closeModal();
            toast('Đổi tên thành công!');
            await enterApp(data.user);
          } catch (err) {
            btn.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
    ],
  });
  $('#modal-root').onclick = null; // bắt buộc phải đổi tên mới thoát được
}

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: $('#reg-username').value, password: $('#reg-password').value }),
    });
    toast('Tạo tài khoản thành công!');
    await enterApp(data.user);
  } catch (err) { toast(err.message, 'error'); }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  state.user = null;
  showAuth();
});

async function enterApp(user) {
  state.user = user;
  showApp();
  applyUser();
  switchView('dashboard');
  refreshDashboard();
}

function applyTheme(theme) {
  const t = theme === 'classic' ? 'classic' : 'bubble';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('asynctas_theme', t); } catch (e) { /* bỏ qua */ }
  $$('[data-theme-choice]').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === t));
  const label = $('#theme-current');
  if (label) label.textContent = t === 'bubble' ? 'Bubble' : 'Classic';
}

function applyBackground(url) {
  const value = url ? `url("${String(url).replace(/"/g, '%22').replace(/\n/g, '')}")` : 'none';
  document.documentElement.style.setProperty('--wallpaper', value);
  try { localStorage.setItem('asynctas_background', String(url || '')); } catch (e) { /* bỏ qua */ }
}

function applyUser() {
  const u = state.user;
  if (!u) return;
  applyTheme(u.theme);
  applyBackground(u.background);
  $('#top-balance').textContent = num(u.balance);
  $('#hero-balance').textContent = num(u.balance);
  $('#hero-name').textContent = u.username;
  $('#user-name').textContent = u.username;
  $('#user-initial').textContent = (u.username[0] || 'U').toUpperCase();
  const avatar = $('#user-avatar');
  if (u.avatar) {
    avatar.src = u.avatar;
    avatar.classList.remove('hidden');
    $('#user-initial').classList.add('hidden');
  } else {
    avatar.classList.add('hidden');
    $('#user-initial').classList.remove('hidden');
  }
  avatar.onerror = () => {
    avatar.classList.add('hidden');
    $('#user-initial').classList.remove('hidden');
  };
  const short = esc((u.username[0] || 'U').toUpperCase());
  $('#sidebar-user').innerHTML = `<span class="sidebar-avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" />` : short}</span><span>${esc(u.username)}</span>`;
  $('#profile-username').textContent = u.username;
  $('#profile-balance').textContent = `${num(u.balance)} xu`;
  $('#profile-discord').textContent = u.linked ? `Đã liên kết (${u.discordId})` : 'Chưa liên kết';
  $('#profile-role').textContent = u.isAdmin ? 'Admin 🛡️' : 'Thành viên';
  $('#link-token').textContent = u.linkToken || '—';
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !u.isAdmin));
  $('#link-box').classList.toggle('hidden', !!u.linked);
  $('#regen-token-btn').classList.toggle('hidden', !!u.linked);
  $('#linked-note').classList.toggle('hidden', !u.linked);
}

$$('[data-theme-choice]').forEach(btn => btn.addEventListener('click', async () => {
  const theme = btn.dataset.themeChoice;
  applyTheme(theme); // đổi ngay, không đợi server
  try {
    const data = await api('/api/profile/theme', { method: 'POST', body: JSON.stringify({ theme }) });
    if (state.user) state.user.theme = data.theme;
    toast(data.theme === 'bubble' ? 'Đã dùng Bubble Interface.' : 'Đã dùng giao diện Classic.');
  } catch (err) {
    toast(err.message, 'error');
  }
}));

async function refreshUser() {
  const data = await api('/api/me');
  if (!data.user) { showAuth(); return; }
  state.user = data.user;
  applyUser();
}

// ==================== NAVIGATION ====================
const VIEW_TITLES = {
  dashboard: 'Tổng quan',
  shop: 'Shop',
  buydevice: 'Buy Device',
  cloudstatus: 'Cloud Status',
  tasks: 'Nhiệm vụ',
  giftcode: 'Giftcode',
  leaderboard: 'Bảng xếp hạng',
  transfer: 'Chuyển tiền',
  profile: 'Hồ sơ',
  admin: 'Quản trị',
};

function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  $('#view-title').textContent = VIEW_TITLES[view] || 'Dashboard';
  $('.sidebar').classList.remove('open');
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'cloudstatus') startCloudStatusPolling();
  else stopCloudStatusPolling();
  loadView(view);
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
$$('[data-goto]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.goto)));
$('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

function loadView(view) {
  if (view === 'dashboard') refreshDashboard();
  else if (view === 'shop') loadShop();
  else if (view === 'cloudstatus') loadCloudStatus();
  else if (view === 'tasks') loadTasks();
  else if (view === 'giftcode') $('#giftcode-input').focus();
  else if (view === 'leaderboard') loadLeaderboard();
  else if (view === 'transfer') loadTransfers();
  else if (view === 'admin') loadAdmin();
}

// ==================== DASHBOARD ====================
async function refreshDashboard() {
  try {
    await refreshUser();
    const [tasks, purchases] = await Promise.all([
      api('/api/tasks'),
      api('/api/purchases'),
    ]);
    const providerList = tasks.providers || [];
    const daily = providerList.reduce((sum, p) => sum + Number(p.used || tasks.daily[p.id] || 0), 0);
    const dailyTotal = providerList.reduce((sum, p) => sum + Number(p.dailyMax || 0), 0);
    $('#stat-weekly').textContent = num(tasks.weeklyCount);
    $('#stat-daily').textContent = `${daily}/${dailyTotal || tasks.dailyMax * 2}`;
    $('#stat-purchases').textContent = num(purchases.purchases.length);
    updateDailyCard(tasks);
    const lb = await api('/api/leaderboard/links');
    const me = state.user;
    const idx = lb.leaderboard.findIndex(r => r.userId === (me.discordId || `web_${me.id}`));
    $('#stat-rank').textContent = idx >= 0 ? `#${idx + 1}` : '—';
    renderRecentPurchases(purchases.purchases.slice(0, 3));
  } catch (err) {
    if (/đăng nhập/i.test(err.message)) return showAuth();
    toast(err.message, 'error');
  }
}

function renderRecentPurchases(list) {
  const root = $('#recent-purchases');
  if (!list.length) { root.innerHTML = '<div class="empty">Chưa mua gì. Ghé shop nhé!</div>'; return; }
  root.innerHTML = list.map(p => `
    <div class="mini-row">
      <span>📦 ${esc(p.itemName)} ×${p.quantity}</span>
      <b>${num(p.totalPrice)} xu</b>
    </div>`).join('');
}

function updateDailyCard(tasks) {
  const claimed = !!tasks.dailyClaimed;
  const freeClaimed = !!tasks.freeVmosClaimed;
  const unlocked = Number(tasks.linkCountAllTime || 0) > 0;
  $('#daily-date').textContent = tasks.date || '—';

  const claimBtn = $('#daily-claim-btn');
  claimBtn.disabled = claimed;
  claimBtn.textContent = claimed ? '✅ Đã nhận hôm nay' : '🎁 Claim 1–20 xu';
  $('#daily-claim-status').textContent = claimed ? 'Quà xu: đã nhận' : 'Quà xu: chưa nhận';

  const vmosBtn = $('#daily-vmos-btn');
  vmosBtn.disabled = freeClaimed || !unlocked;
  vmosBtn.textContent = freeClaimed ? '✅ Đã lấy hôm nay' : '🆓 Lấy VMOS free';
  $('#daily-vmos-status').textContent = freeClaimed
    ? 'VMOS free: đã lấy'
    : unlocked ? 'VMOS free: khả dụng' : 'VMOS free: cần ≥ 1 link';
}

$('#daily-claim-btn').addEventListener('click', async () => {
  const btn = $('#daily-claim-btn');
  const box = $('#daily-result');
  btn.disabled = true;
  try {
    const data = await api('/api/daily/claim', { method: 'POST' });
    box.className = 'result-box';
    box.innerHTML = `🎉 Bạn nhận được <b>${num(data.reward)} xu</b>! Số dư mới: <b>${num(data.newBalance)} xu</b>.`;
    box.classList.remove('hidden');
    await refreshDashboard();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

$('#daily-vmos-btn').addEventListener('click', async () => {
  const btn = $('#daily-vmos-btn');
  const box = $('#daily-result');
  btn.disabled = true;
  try {
    const data = await api('/api/device/vmos-free', { method: 'POST' });
    box.className = 'result-box';
    box.innerHTML = `
      <div>🆓 VMOS miễn phí hôm nay (đã vượt ${num(data.linkCount)} link):</div>
      <div class="accounts-box" id="free-vmos-acc">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="free-vmos-copy">📋 Copy acc|pass</button></div>`;
    box.classList.remove('hidden');
    $('#free-vmos-copy').addEventListener('click', ev => copyText(data.copyText, ev.target));
    await refreshDashboard();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

// ==================== SHOP ====================
async function loadShop() {
  try {
    const [shopData, purchases] = await Promise.all([api('/api/shop'), api('/api/purchases')]);
    state.shop = shopData.items;
    renderShop(shopData.items);
    renderPurchases(purchases.purchases);
  } catch (err) { toast(err.message, 'error'); }
}

function renderShop(items) {
  const grid = $('#shop-grid');
  if (!items.length) { grid.innerHTML = '<div class="card empty">Shop chưa có sản phẩm nào.</div>'; return; }
  grid.innerHTML = items.map(item => {
    const logo = /^https?:\/\//i.test(item.logoUrl)
      ? `<img class="product-logo" src="${esc(item.logoUrl)}" alt="${esc(item.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'product-logo placeholder',textContent:'📦'}))" />`
      : `<div class="product-logo placeholder">📦</div>`;
    return `
      <div class="product">
        ${logo}
        <div class="product-body">
          <h4>${esc(item.name)}</h4>
          <p>${esc(item.description || 'Không có mô tả.')}</p>
          <div class="product-foot">
            <span class="price">${num(item.price)} xu</span>
            <span class="stock-badge">Kho: ${num(item.stock)}</span>
          </div>
          <button class="btn btn-primary btn-block btn-sm" data-buy="${esc(item.id)}" ${item.stock < 1 ? 'disabled' : ''}>
            ${item.stock < 1 ? 'Hết hàng' : '🛒 Mua'}
          </button>
        </div>
      </div>`;
  }).join('');
  $$('[data-buy]').forEach(btn => btn.addEventListener('click', () => buyItem(btn.dataset.buy)));
}

function renderPurchases(list) {
  const root = $('#purchases-list');
  if (!list.length) { root.innerHTML = '<div class="empty">Bạn chưa mua sản phẩm nào.</div>'; return; }
  root.innerHTML = list.map(p => `
    <div class="purchase-card">
      <div class="purchase-head">
        <span>📦 ${esc(p.itemName)} ×${p.quantity}</span>
        <b>${num(p.totalPrice)} xu</b>
      </div>
      <div class="accounts-box">${esc(p.accounts.join('\n'))}</div>
      <div class="copy-row">
        <button class="btn btn-soft btn-sm" data-copy-acc="${esc(p.id)}">📋 Copy tất cả</button>
      </div>
    </div>`).join('');
  $$('[data-copy-acc]').forEach(btn => btn.addEventListener('click', () => {
    const p = list.find(x => x.id === btn.dataset.copyAcc);
    if (p) copyText(p.accounts.join('\n'), btn);
  }));
}

function buyItem(itemId) {
  const item = state.shop.find(i => i.id === itemId);
  if (!item) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="muted">${esc(item.name)} — <b class="price">${num(item.price)} xu</b>/cái · Kho: ${num(item.stock)}</p>
    <label style="margin-top:14px">Số lượng<input id="buy-qty" type="number" min="1" max="${item.stock}" value="1" /></label>
    <div class="fee-preview">Tổng: <b id="buy-total">${num(item.price)} xu</b></div>`;
  const input = wrap.querySelector('#buy-qty');
  input.addEventListener('input', () => {
    const q = Math.max(1, Math.min(item.stock, parseInt(input.value, 10) || 1));
    wrap.querySelector('#buy-total').textContent = `${num(item.price * q)} xu`;
  });
  openModal({
    title: 'Xác nhận mua',
    body: wrap,
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Mua ngay',
        className: 'btn-primary',
        onClick: async (btn) => {
          const quantity = Math.max(1, Math.min(item.stock, parseInt(input.value, 10) || 1));
          btn.disabled = true;
          try {
            const data = await api('/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId, quantity }) });
            closeModal();
            toast(`Mua thành công ${quantity} sản phẩm!`);
            showAccountsModal(item.name, data.accounts);
            await refreshUser();
            loadShop();
          } catch (err) {
            btn.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
    ],
  });
}

function showAccountsModal(title, accounts) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">Tài khoản của bạn (đã trừ coin).</p>
    <div class="accounts-box" id="acc-box">${esc(accounts.join('\n'))}</div>`;
  openModal({
    title: `✅ ${title}`,
    body: wrap,
    actions: [
      { label: '📋 Copy tất cả', onClick: (btn) => copyText(accounts.join('\n'), btn) },
      { label: 'Đóng', className: 'btn-primary', onClick: closeModal },
    ],
  });
}

// ==================== BUY DEVICE ====================
$('#cloud-provider').addEventListener('change', () => {
  $('#cloud-server-wrap').classList.toggle('hidden', $('#cloud-provider').value !== 'UG');
});

$('#cloud-buy-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const box = $('#cloud-result');
  try {
    const data = await api('/api/device/buycloud', {
      method: 'POST',
      body: JSON.stringify({
        provider: $('#cloud-provider').value,
        server: $('#cloud-server').value,
        inputData: $('#cloud-input').value,
      }),
    });
    box.className = 'result-box';
    box.textContent = `✅ Mua ${data.provider} thành công!\n${data.message}`;
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
  } finally {
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

$$('[data-reg]').forEach(btn => btn.addEventListener('click', async () => {
  const box = $('#reg-result');
  btn.disabled = true;
  try {
    const data = await api('/api/device/reg', { method: 'POST', body: JSON.stringify({ service: btn.dataset.reg }) });
    box.className = 'result-box';
    box.innerHTML = `
      <div>✅ Tạo <b>${esc(data.service.toUpperCase())}</b> thành công! (Đã trừ 10 xu)</div>
      <div class="accounts-box" id="reg-acc">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="reg-copy">📋 Copy acc|pass</button></div>`;
    box.classList.remove('hidden');
    $('#reg-copy').addEventListener('click', (ev) => copyText(data.copyText, ev.target));
    await refreshUser();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}));

// ==================== MEOWS DEVICE ====================
$$('[data-meows]').forEach(btn => btn.addEventListener('click', async () => {
  const provider = btn.dataset.meows;
  const box = $('#meows-result');
  const cost = provider === 'UG' ? 49 : 15;
  if (!confirm(`Xác nhận mua ${provider === 'UG' ? 'UGPhone' : 'VSPhone VIP'} với ${cost} xu?`)) return;
  btn.disabled = true;
  try {
    const data = await api('/api/device/meows', { method: 'POST', body: JSON.stringify({ provider }) });
    box.className = 'result-box';
    box.innerHTML = `
      <div>✅ Mua <b>${esc(data.provider)}</b> thành công! Đã trừ <b>${num(data.cost)} xu</b>.</div>
      ${data.account ? `<div>📧 ${esc(data.account)}</div>` : ''}
      ${data.password ? `<div>🔑 ${esc(data.password)}</div>` : ''}
      <div class="accounts-box" id="meows-acc">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="meows-copy">📋 Copy thông tin</button></div>
      <div class="muted" style="margin-top:8px">Số dư mới: <b>${num(data.newBalance)} xu</b></div>`;
    box.classList.remove('hidden');
    $('#meows-copy').addEventListener('click', (ev) => copyText(data.copyText, ev.target));
    await refreshUser();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally { btn.disabled = false; }
}));

// ==================== TASKS ====================
async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    const providers = data.providers || [];
    const select = $('#task-provider');
    const selected = select.value;
    if (providers.length) {
      select.innerHTML = providers.map(p => {
        const used = Number(p.used || data.daily[p.id] || 0);
        const label = `${p.name} — ${p.reward} xu (${used}/${p.dailyMax})`;
        return `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(label)}</option>`;
      }).join('');
      const hint = providers.map(p => `${p.name}: <b>${p.reward} xu</b> (${p.dailyMax} lượt/ngày)`).join('. ');
      const hintEl = $('#task-hint');
      if (hintEl) hintEl.innerHTML = hint + '.';
    }
    $('#task-daily').innerHTML = `
      ${providers.map(p => {
        const used = Number(p.used || data.daily[p.id] || 0);
        return `<span class="pill">${esc(p.name)}: ${used}/${p.dailyMax} · +${p.reward} xu</span>`;
      }).join('')}
      <span class="pill">Tuần này: ${num(data.weeklyCount)} link</span>`;
    $('#task-period').textContent = data.period;
    const rewards = data.rewards || [];
    const labels = ['Top 1', 'Top 2', 'Top 3', 'Top 4', 'Top 5', 'Top 6', 'Top 7', 'Top 8', 'Top 9', 'Top 10'];
    $('#reward-list').innerHTML = rewards.map((r, i) => `<li><span>${labels[i] || `#${i + 1}`}</span><b>+${num(r)} coin</b></li>`).join('');
  } catch (err) { toast(err.message, 'error'); }
}

$('#task-get-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const box = $('#task-result');
  try {
    const data = await api('/api/tasks/link', { method: 'POST', body: JSON.stringify({ provider: $('#task-provider').value }) });
    box.className = 'result-box';
    box.innerHTML = `✅ Đã tạo link nhiệm vụ${data.reward ? ` (+${data.reward} xu)` : ''} (còn ${data.remaining} lượt hôm nay):<br>
      <a href="${esc(data.url)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">${esc(data.url)}</a>`;
    box.classList.remove('hidden');
    loadTasks();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

// ==================== CLOUD STATUS ====================
function startCloudStatusPolling() {
  if (cloudStatusTimer) return;
  cloudStatusTimer = setInterval(() => {
    if (state.view === 'cloudstatus') loadCloudStatus(true).catch(() => {});
  }, 60000);
}

function stopCloudStatusPolling() {
  if (!cloudStatusTimer) return;
  clearInterval(cloudStatusTimer);
  cloudStatusTimer = null;
}

function setDeviceStatus(sel, msgSel, device) {
  const online = device && device.status === 'online';
  const el = $(sel);
  el.className = `status-badge ${online ? 'online' : ''}`;
  el.textContent = online ? 'Có máy' : 'Hết máy';
  const parts = [];
  if (device && device.message) parts.push(device.message);
  if (device && device.lastBuyAt) parts.push(`Lần mua cuối: ${new Date(device.lastBuyAt).toLocaleString('vi-VN')}`);
  $(msgSel).textContent = parts.join(' · ');
}

async function loadCloudStatus(force = false) {
  try {
    const data = await api(`/api/status/cloud${force ? '?force=1' : ''}`);
    const sourceLabel = { direct: '', www: 'www', proxy: 'proxy' }[data.source] || '';
    $('#cloud-status-time').textContent = `Cập nhật: ${new Date(data.checkedAt).toLocaleTimeString('vi-VN')}${sourceLabel ? ` · ${sourceLabel}` : ''}`;
    setDeviceStatus('#status-meows-vmos', '#status-meows-vmos-msg', data.vmos);
    setDeviceStatus('#status-meows-vsphone', '#status-meows-vsphone-msg', data.vsphone);
    const errorBox = $('#cloud-status-errors');
    if (data.errors && data.errors.length) {
      errorBox.textContent = `⚠️ ${data.errors.join(' · ')}`;
      errorBox.classList.remove('hidden');
    } else errorBox.classList.add('hidden');
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#cloud-status-refresh').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { await loadCloudStatus(true); toast('Đã cập nhật trạng thái.'); }
  catch (err) { toast(err.message, 'error'); }
  finally { e.target.disabled = false; }
});

// ==================== GIFTCODE ====================
$('#giftcode-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  const box = $('#giftcode-result');
  const code = $('#giftcode-input').value.trim();
  if (!code) { toast('Nhập mã gift code.', 'error'); return; }
  btn.disabled = true;
  try {
    const data = await api('/api/giftcode', { method: 'POST', body: JSON.stringify({ code }) });
    box.className = 'result-box';
    box.innerHTML = `✅ Nhập mã <b>${esc(code)}</b> thành công! Nhận <b>${num(data.amount)} xu</b>.<br>Số dư mới: <b>${num(data.newBalance)} xu</b>`;
    $('#giftcode-input').value = '';
    await refreshUser();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
  } finally {
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

// ==================== LEADERBOARD ====================
$$('[data-lb]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-lb]').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  state.lbTab = tab.dataset.lb;
  loadLeaderboard();
}));

async function loadLeaderboard() {
  const root = $('#lb-list');
  const note = $('#lb-note');
  const banner = $('#lb-rewards');
  root.innerHTML = '<div class="empty">Đang tải...</div>';
  note.classList.add('hidden');
  banner.classList.add('hidden');
  try {
    if (state.lbTab === 'coins') {
      const data = await api('/api/leaderboard/coins');
      renderLb(root, data.leaderboard, 'xu');
      return;
    }

    if (state.lbTab === 'week') {
      const data = await api('/api/leaderboard/links/week');
      note.textContent = `🔄 Kỳ 7 ngày hiện tại: ${data.period || '—'} · Reset sau mỗi kỳ thanh toán.`;
      note.classList.remove('hidden');
      const labels = ['Top 1', 'Top 2', 'Top 3', 'Top 4', 'Top 5', 'Top 6', 'Top 7', 'Top 8', 'Top 9', 'Top 10'];
      banner.innerHTML = (data.rewards || []).slice(0, 10)
        .map((r, i) => `<span class="reward-chip">${labels[i]}: +${num(r)} coin</span>`).join('');
      if ((data.rewards || []).length) banner.classList.remove('hidden');
      renderLb(root, data.leaderboard, 'link');
      return;
    }

    const data = await api('/api/leaderboard/links/all');
    note.textContent = '🏅 Tổng số link vượt từ trước đến nay · chỉ để vinh danh, không có thưởng.';
    note.classList.remove('hidden');
    renderLb(root, data.leaderboard, 'link');
  } catch (err) {
    root.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderLb(root, rows, unit) {
  if (!rows.length) { root.innerHTML = '<div class="empty">Chưa có dữ liệu xếp hạng.</div>'; return; }
  const medals = ['🥇', '🥈', '🥉'];
  root.innerHTML = rows.map(r => `
    <div class="lb-row ${r.rank <= 3 ? `top${r.rank}` : ''}">
      <span class="lb-rank">${medals[r.rank - 1] || r.rank}</span>
      <span class="lb-name">${esc(r.display)}</span>
      <span class="lb-value">${num(r.value)} ${unit}</span>
    </div>`).join('');
}

// ==================== TRANSFER ====================
function updateFeePreview() {
  const amount = parseInt($('#transfer-amount').value, 10) || 0;
  const fee = Math.ceil(amount * 0.05);
  $('#transfer-fee').innerHTML = amount >= 10
    ? `Người nhận thực nhận: <b>${num(amount - fee)} xu</b> (phí ${num(fee)} xu)`
    : 'Tối thiểu 10 xu.';
}
$('#transfer-amount').addEventListener('input', updateFeePreview);

$('#transfer-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  try {
    const data = await api('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ to: $('#transfer-to').value, amount: parseInt($('#transfer-amount').value, 10) || 0 }),
    });
    toast(`Đã chuyển cho ${data.to}. Số dư: ${num(data.newBalance)} xu`);
    $('#transfer-to').value = '';
    await refreshUser();
    loadTransfers();
  } catch (err) {
    toast(err.message, 'error');
  } finally { btn.disabled = false; }
});

async function loadTransfers() {
  updateFeePreview();
  try {
    const data = await api('/api/transfers');
    const root = $('#transfer-history');
    root.innerHTML = data.transfers.length
      ? data.transfers.map(t => `
        <div class="mini-row">
          <span>➡️ ${esc(t.to_label)}</span>
          <span>${num(t.amount)} xu <small class="muted">(phí ${num(t.fee)})</small></span>
        </div>`).join('')
      : '<div class="empty">Chưa có giao dịch nào.</div>';
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== PROFILE ====================
$('#copy-token-btn').addEventListener('click', (e) => copyText(state.user.linkToken || '', e.target));

$('#regen-token-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const data = await api('/api/profile/token', { method: 'POST' });
    state.user.linkToken = data.linkToken;
    $('#link-token').textContent = data.linkToken;
    toast('Đã tạo token mới.');
  } catch (err) { toast(err.message, 'error'); }
  finally { e.target.disabled = false; }
});

$('#pw-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    await api('/api/profile/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value }),
    });
    $('#pw-current').value = '';
    $('#pw-new').value = '';
    toast('Đổi mật khẩu thành công.');
  } catch (err) { toast(err.message, 'error'); }
  finally { e.target.disabled = false; }
});

// ==================== ADMIN ====================
async function loadAdmin() {
  try {
    const data = await api('/api/admin/overview');
    const s = data.stats;
    $('#admin-stats').innerHTML = `
      <div class="card stat"><span class="stat-ico">👥</span><div><b>${num(s.users)}</b><small>Người dùng (${num(s.linked)} đã liên kết)</small></div></div>
      <div class="card stat"><span class="stat-ico">🛍️</span><div><b>${num(s.items)}</b><small>Sản phẩm</small></div></div>
      <div class="card stat"><span class="stat-ico">🧾</span><div><b>${num(s.purchases)}</b><small>Đơn hàng</small></div></div>
      <div class="card stat"><span class="stat-ico">💰</span><div><b>${num(s.revenue)}</b><small>Coin đã bán (${s.gistEnabled ? 'Gist ✓' : 'Local'})</small></div></div>`;
    $('#admin-purchases').innerHTML = data.recentPurchases.length
      ? data.recentPurchases.map(p => `<div class="mini-row"><span>${esc(p.itemName)} ×${p.quantity}</span><b>${num(p.totalPrice)} xu</b></div>`).join('')
      : '<div class="empty">Chưa có đơn hàng.</div>';
    $('#admin-payouts').innerHTML = data.payouts.length
      ? data.payouts.map(p => `<div class="mini-row"><span>Kỳ ${esc(p.period)}</span><b>${num(p.total)} coin</b></div>`).join('')
      : '<div class="empty">Chưa trả thưởng lần nào.</div>';
    await Promise.all([loadAdminItems(), loadAdminUsers(), loadAdminPlugins(), loadMeowsCookie(), loadAdminBackground()]);
  } catch (err) { toast(err.message, 'error'); }
}

$$('.admin-tabs .tab').forEach(tab => tab.addEventListener('click', () => switchAdminTab(tab.dataset.admin)));

function switchAdminTab(tabName) {
  state.adminTab = tabName;
  $$('.admin-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.admin === tabName));
  $$('.admin-sub').forEach(el => el.classList.toggle('hidden', el.id !== `admin-sub-${tabName}`));
  if (tabName === 'shop') loadAdminItems();
  else if (tabName === 'user') loadAdminUsers().catch(() => {});
  else if (tabName === 'plugin') loadAdminPlugins();
  else if (tabName === 'meows') loadMeowsCookie();
  else if (tabName === 'appearance') loadAdminBackground();
}

async function loadAdminItems() {
  const data = await api('/api/admin/items');
  const root = $('#admin-items');
  root.innerHTML = data.items.length ? data.items.map(item => `
    <div class="admin-item">
      ${/^https?:\/\//i.test(item.logoUrl) ? `<img src="${esc(item.logoUrl)}" alt="" onerror="this.style.display='none'" />` : '<img alt="" />'}
      <div class="info">
        <b>${esc(item.name)} ${item.active ? '' : '<span class="muted">(ẩn)</span>'}</b>
        <small>${num(item.price)} xu · Kho: ${num(item.stock)} · ${esc(item.category)}</small>
      </div>
      <div class="actions">
        <button class="btn btn-soft btn-sm" data-addstock="${esc(item.id)}">+ Kho</button>
        <button class="btn btn-ghost btn-sm" data-edititem="${esc(item.id)}">Sửa</button>
        <button class="btn btn-danger btn-sm" data-delitem="${esc(item.id)}">Xoá</button>
      </div>
    </div>`).join('') : '<div class="empty">Chưa có sản phẩm.</div>';

  $$('[data-addstock]').forEach(b => b.addEventListener('click', () => addStockModal(b.dataset.addstock, data.items.find(i => i.id === b.dataset.addstock))));
  $$('[data-edititem]').forEach(b => b.addEventListener('click', () => editItemModal(data.items.find(i => i.id === b.dataset.edititem))));
  $$('[data-delitem]').forEach(b => b.addEventListener('click', () => deleteItem(b.dataset.delitem)));
}

async function loadAdminUsers() {
  const data = await api('/api/admin/users');
  $('#admin-users').innerHTML = data.users.length ? data.users.map(u => `
    <div class="mini-row">
      <span>${esc(u.username)} ${u.isAdmin ? '🛡️' : ''} ${u.linked ? '<small class="muted">Discord ✓</small>' : ''}</span>
      <span><b>${num(u.balance)} xu</b> <button class="btn btn-ghost btn-sm" data-coins="${esc(u.username)}">Sửa</button></span>
    </div>`).join('') : '<div class="empty">Chưa có người dùng.</div>';
  $$('[data-coins]').forEach(b => b.addEventListener('click', () => coinsModal(b.dataset.coins)));
}

// ==================== ADMIN: GIAO DIỆN ====================
async function loadAdminBackground() {
  const data = await api('/api/admin/background');
  $('#admin-background-url').value = data.url || '';
  const preview = $('#admin-background-preview');
  preview.style.backgroundImage = data.url ? `url("${data.url.replace(/"/g, '%22')}")` : 'none';
  preview.title = data.url || '';
}

$('#admin-background-save-btn').addEventListener('click', async () => {
  const box = $('#admin-background-result');
  try {
    const url = $('#admin-background-url').value.trim();
    const data = await api('/api/admin/background', { method: 'POST', body: JSON.stringify({ url }) });
    applyBackground(data.url);
    await loadAdminBackground();
    box.className = 'result-box';
    box.textContent = '✅ Đã lưu ảnh nền. Cập nhật ngay trên toàn dashboard.';
    box.classList.remove('hidden');
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  }
});

$('#admin-background-default-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/background', { method: 'DELETE' });
    applyBackground(data.url);
    await loadAdminBackground();
    toast('Đã dùng ảnh nền mặc định.');
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== ADMIN: MEOWS ====================
async function loadMeowsCookie() {
  const data = await api('/api/admin/meows/cookie');
  $('#admin-meows-cookie').value = data.cookie || '';
  const status = $('#meows-status');
  status.textContent = data.configured ? '✅ Đã lưu' : '⚠️ Chưa có cookie';
  status.title = data.updatedAt ? `Cập nhật: ${data.updatedAt}` : '';
  await loadStatusProxy();
}

async function loadStatusProxy() {
  const data = await api('/api/admin/status-proxy');
  $('#admin-status-proxy').value = data.proxy || '';
  const pill = $('#status-proxy-source');
  const active = data.envProxy || data.proxy;
  pill.textContent = active ? `✅ ${active}` : '⚠️ Chưa có proxy';
}

$('#admin-meows-save-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  const box = $('#admin-meows-result');
  btn.disabled = true;
  try {
    await api('/api/admin/meows/cookie', {
      method: 'POST',
      body: JSON.stringify({ cookie: $('#admin-meows-cookie').value }),
    });
    box.className = 'result-box';
    box.textContent = '✅ Đã lưu cookie vào database. Có thể đổi bất cứ lúc nào.';
    box.classList.remove('hidden');
    await loadMeowsCookie();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

$('#admin-meows-clear-btn').addEventListener('click', async (e) => {
  if (!confirm('Xoá cookie? Các lệnh mua nhanh sẽ không chạy cho đến khi lưu cookie mới.')) return;
  const btn = e.target;
  btn.disabled = true;
  try {
    await api('/api/admin/meows/cookie', { method: 'DELETE' });
    toast('Đã xoá cookie.');
    await loadMeowsCookie();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

$('#admin-status-proxy-save-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  const box = $('#admin-status-proxy-result');
  btn.disabled = true;
  try {
    await api('/api/admin/status-proxy', {
      method: 'POST',
      body: JSON.stringify({ proxy: $('#admin-status-proxy').value }),
    });
    box.className = 'result-box';
    box.textContent = '✅ Đã lưu proxy. Cloud Status sẽ ưu tiên dùng nguồn này.';
    box.classList.remove('hidden');
    await loadStatusProxy();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

$('#admin-status-proxy-clear-btn').addEventListener('click', async (e) => {
  if (!confirm('Xoá proxy status? Hệ thống sẽ quay lại gọi trực tiếp Meows.')) return;
  const btn = e.target;
  btn.disabled = true;
  try {
    await api('/api/admin/status-proxy', { method: 'DELETE' });
    toast('Đã xoá proxy status.');
    await loadStatusProxy();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

// ==================== ADMIN: PLUGIN ====================
async function loadAdminPlugins() {
  const data = await api('/api/admin/plugins');
  state.plugins = data.plugins;
  const root = $('#admin-plugins');
  root.innerHTML = data.plugins.length ? data.plugins.map(p => {
    const runtime = p.runtime || {};
    const routes = (runtime.routes || []).map(r => `${r.method} ${r.path}`).join(', ') || '—';
    const cmds = (runtime.commands || []).map(c => c.name).join(', ') || '—';
    return `
      <div class="admin-item plugin-row">
        <div class="info">
          <b>${esc(p.name)} ${p.enabled ? '' : '<span class="muted">(đang tắt)</span>'}</b>
          <div class="plugin-meta">
            ID: <code>${esc(p.id)}</code><br/>
            ${p.gistUrl ? `<a href="${esc(p.gistUrl)}" target="_blank" rel="noopener">Gist</a> · ` : ''}Nguồn: ${esc(p.sourceUrl || '—')}<br/>
            Routes: ${esc(routes)}<br/>
            Discord commands: ${esc(cmds)}<br/>
            Load lần cuối: ${esc(p.lastLoadedAt || '—')}
          </div>
          ${p.error ? `<div class="plugin-error">⚠️ ${esc(p.error)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn btn-soft btn-sm" data-plugin-reload="${esc(p.id)}">Reload</button>
          <button class="btn btn-ghost btn-sm" data-plugin-source="${esc(p.id)}">Đổi link</button>
          <button class="btn btn-ghost btn-sm" data-plugin-toggle="${esc(p.id)}">${p.enabled ? 'Tắt' : 'Bật'}</button>
          <button class="btn btn-danger btn-sm" data-plugin-del="${esc(p.id)}">Xoá</button>
        </div>
      </div>`;
  }).join('') : '<div class="empty">Chưa có plugin nào.</div>';

  $$('[data-plugin-reload]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await api(`/api/admin/plugins/${encodeURIComponent(b.dataset.pluginReload)}/reload`, { method: 'POST' });
      toast(`Reload thành công: ${(res.runtime.routes || []).length} route, ${(res.runtime.commands || []).length} lệnh.`);
      loadAdminPlugins();
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  }));

  $$('[data-plugin-source]').forEach(b => b.addEventListener('click', () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginSource);
    if (!plugin) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>Link raw script mới<input id="plugin-source-url" value="${esc(plugin.sourceUrl)}" /></label>
      <p class="muted">Script sẽ được ghi đè vào Gist hiện tại rồi load lại ngay.</p>`;
    openModal({
      title: `Đổi source: ${plugin.name}`,
      body: wrap,
      actions: [
        { label: 'Huỷ', onClick: closeModal },
        {
          label: 'Lưu & reload', className: 'btn-primary', onClick: async (btn) => {
            btn.disabled = true;
            try {
              await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}/source`, {
                method: 'POST',
                body: JSON.stringify({ url: wrap.querySelector('#plugin-source-url').value.trim() }),
              });
              closeModal();
              toast('Đã cập nhật source.');
              loadAdminPlugins();
            } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
          },
        },
      ],
    });
  }));

  $$('[data-plugin-toggle]').forEach(b => b.addEventListener('click', async () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginToggle);
    if (!plugin) return;
    b.disabled = true;
    try {
      await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !plugin.enabled }),
      });
      toast(plugin.enabled ? 'Đã tắt plugin.' : 'Đã bật plugin.');
      loadAdminPlugins();
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  }));

  $$('[data-plugin-del]').forEach(b => b.addEventListener('click', () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginDel);
    if (!plugin) return;
    openModal({
      title: `Xoá plugin ${plugin.name}?`,
      body: '<p class="muted">Gist chứa script cũng sẽ bị xoá. Plugin sẽ ngừng hoạt động ngay.</p>',
      actions: [
        { label: 'Huỷ', onClick: closeModal },
        {
          label: 'Xoá', className: 'btn-danger', onClick: async (btn) => {
            btn.disabled = true;
            try {
              await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, { method: 'DELETE' });
              closeModal();
              toast('Đã xoá plugin.');
              loadAdminPlugins();
            } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
          },
        },
      ],
    });
  }));
}

$('#admin-plugin-create-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  const box = $('#admin-plugin-result');
  btn.disabled = true;
  try {
    const data = await api('/api/admin/plugins', {
      method: 'POST',
      body: JSON.stringify({ name: $('#admin-plugin-name').value.trim(), url: $('#admin-plugin-url').value.trim() }),
    });
    box.className = 'result-box';
    box.innerHTML = `✅ Đã lưu script vào <a href="${esc(data.plugin.gistUrl)}" target="_blank" rel="noopener">Gist</a> và kích hoạt plugin <b>${esc(data.plugin.name)}</b>.<br/>
      Routes: ${(data.runtime.routes || []).map(r => esc(`${r.method} /plugin/${data.plugin.id}${r.path}`)).join(', ') || '—'}<br/>
      Lệnh Discord: ${(data.runtime.commands || []).map(c => esc(c.name)).join(', ') || '—'}`;
    $('#admin-plugin-name').value = '';
    $('#admin-plugin-url').value = '';
    loadAdminPlugins();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
  } finally {
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

$('#admin-plugin-refresh').addEventListener('click', () => loadAdminPlugins().catch(err => toast(err.message, 'error')));

$('#admin-create-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    await api('/api/admin/items', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#admin-item-name').value,
        price: parseInt($('#admin-item-price').value, 10) || 0,
        logoUrl: $('#admin-item-logo').value,
        category: $('#admin-item-category').value,
        description: $('#admin-item-desc').value,
        accounts: $('#admin-item-accounts').value,
      }),
    });
    toast('Đã tạo sản phẩm & upload kho.');
    ['#admin-item-name', '#admin-item-logo', '#admin-item-desc', '#admin-item-accounts'].forEach(s => { $(s).value = ''; });
    loadAdmin();
  } catch (err) { toast(err.message, 'error'); }
  finally { e.target.disabled = false; }
});

$('#admin-refresh').addEventListener('click', loadAdminItems);

$('#admin-payout-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const data = await api('/api/admin/payout', { method: 'POST' });
    toast(`Đã trả thưởng: ${data.result.details ? data.result.details.length : 0} người.`);
    loadAdmin();
  } catch (err) { toast(err.message, 'error'); }
  finally { e.target.disabled = false; }
});

function addStockModal(itemId, item) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">Thêm tài khoản vào <b>${esc(item ? item.name : '')}</b> (mỗi dòng 1 tài khoản).</p>
    <textarea id="addstock-text" rows="6" placeholder="mail|pass"></textarea>`;
  openModal({
    title: '+ Thêm kho',
    body: wrap,
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Thêm', className: 'btn-primary', onClick: async (btn) => {
          btn.disabled = true;
          try {
            await api(`/api/admin/items/${itemId}/stock`, { method: 'POST', body: JSON.stringify({ accounts: wrap.querySelector('#addstock-text').value }) });
            closeModal();
            toast('Đã thêm kho.');
            loadAdminItems();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function editItemModal(item) {
  if (!item) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label>Tên<input id="edit-name" value="${esc(item.name)}" /></label>
    <label>Giá (xu)<input id="edit-price" type="number" min="1" value="${item.price}" /></label>
    <label>Logo<input id="edit-logo" value="${esc(item.logoUrl)}" /></label>
    <label>Mô tả<input id="edit-desc" value="${esc(item.description)}" /></label>
    <label>Hiển thị<select id="edit-active"><option value="1" ${item.active ? 'selected' : ''}>Có</option><option value="0" ${!item.active ? 'selected' : ''}>Ẩn</option></select></label>`;
  openModal({
    title: 'Sửa sản phẩm',
    body: wrap,
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Lưu', className: 'btn-primary', onClick: async (btn) => {
          btn.disabled = true;
          try {
            await api(`/api/admin/items/${item.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name: wrap.querySelector('#edit-name').value,
                price: parseInt(wrap.querySelector('#edit-price').value, 10) || 0,
                logoUrl: wrap.querySelector('#edit-logo').value,
                description: wrap.querySelector('#edit-desc').value,
                active: wrap.querySelector('#edit-active').value === '1',
              }),
            });
            closeModal();
            toast('Đã lưu.');
            loadAdminItems();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function deleteItem(id) {
  openModal({
    title: 'Xoá sản phẩm?',
    body: '<p class="muted">Sản phẩm sẽ bị xoá khỏi shop (kho trên gist vẫn được giữ).</p>',
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Xoá', className: 'btn-danger', onClick: async (btn) => {
          btn.disabled = true;
          try { await api(`/api/admin/items/${id}`, { method: 'DELETE' }); closeModal(); toast('Đã xoá.'); loadAdminItems(); }
          catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function coinsModal(target) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label>Hành động<select id="coins-action"><option value="cong">Cộng</option><option value="tru">Trừ</option><option value="set">Đặt bằng</option></select></label>
    <label>Số coin<input id="coins-amount" type="number" min="0" value="100" /></label>`;
  openModal({
    title: `Sửa coin: ${target}`,
    body: wrap,
    actions: [
      { label: 'Huỷ', onClick: closeModal },
      {
        label: 'Áp dụng', className: 'btn-primary', onClick: async (btn) => {
          btn.disabled = true;
          try {
            const data = await api('/api/admin/coins', {
              method: 'POST',
              body: JSON.stringify({
                target,
                action: wrap.querySelector('#coins-action').value,
                amount: parseInt(wrap.querySelector('#coins-amount').value, 10) || 0,
              }),
            });
            closeModal();
            toast(`Số dư mới: ${num(data.newBalance)} xu`);
            loadAdmin();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

// ==================== INIT ====================
(async function init() {
  try {
    const data = await api('/api/me');
    if (data.user) {
      await enterApp(data.user);
      const hash = location.hash.replace('#', '');
      if (VIEW_TITLES[hash]) switchView(hash);
    } else {
      showAuth();
    }
  } catch (e) {
    showAuth();
  }
})();

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (VIEW_TITLES[hash] && state.user) switchView(hash);
});
