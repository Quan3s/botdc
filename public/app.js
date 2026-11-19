/* ASYNCTAS dashboard — vanilla JS */
'use strict';

const state = {
  user: null,
  view: 'dashboard',
  shop: [],
  lbTab: 'coins',
};

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
  if (!res.ok) throw new Error((data && data.error) || `Lỗi ${res.status}`);
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
  const isLogin = tab.dataset.tab === 'login';
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
}));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-username').value, password: $('#login-password').value }),
    });
    await enterApp(data.user);
  } catch (err) { toast(err.message, 'error'); }
});

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

function applyUser() {
  const u = state.user;
  if (!u) return;
  $('#top-balance').textContent = num(u.balance);
  $('#hero-balance').textContent = num(u.balance);
  $('#hero-name').textContent = u.username;
  $('#user-name').textContent = u.username;
  $('#user-initial').textContent = (u.username[0] || 'U').toUpperCase();
  $('#sidebar-user').innerHTML = `<span class="dot"></span> ${esc(u.username)}`;
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
  tasks: 'Nhiệm vụ',
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
  loadView(view);
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
$$('[data-goto]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.goto)));
$('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

function loadView(view) {
  if (view === 'dashboard') refreshDashboard();
  else if (view === 'shop') loadShop();
  else if (view === 'tasks') loadTasks();
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
    const daily = (tasks.daily.link4m || 0) + (tasks.daily.layma || 0);
    $('#stat-weekly').textContent = num(tasks.weeklyCount);
    $('#stat-daily').textContent = `${daily}/${tasks.dailyMax * 2}`;
    $('#stat-purchases').textContent = num(purchases.purchases.length);
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

// ==================== TASKS ====================
async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    $('#task-daily').innerHTML = `
      <span class="pill">Link4M: ${data.daily.link4m || 0}/${data.dailyMax}</span>
      <span class="pill">LayMa: ${data.daily.layma || 0}/${data.dailyMax}</span>
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
    box.innerHTML = `✅ Đã tạo link nhiệm vụ (còn ${data.remaining} lượt hôm nay):<br>
      <a href="${esc(data.url)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">${esc(data.url)}</a>`;
    box.classList.remove('hidden');
    loadTasks();
  } catch (err) {
    box.className = 'result-box error';
    box.textContent = `❌ ${err.message}`;
    box.classList.remove('hidden');
  } finally { btn.disabled = false; }
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
  root.innerHTML = '<div class="empty">Đang tải...</div>';
  try {
    if (state.lbTab === 'coins') {
      $('#lb-rewards').classList.add('hidden');
      const data = await api('/api/leaderboard/coins');
      renderLb(root, data.leaderboard, 'xu');
    } else {
      const data = await api('/api/leaderboard/links');
      const labels = ['Top 1', 'Top 2', 'Top 3', 'Top 4', 'Top 5', 'Top 6', 'Top 7', 'Top 8', 'Top 9', 'Top 10'];
      const banner = $('#lb-rewards');
      banner.classList.remove('hidden');
      banner.innerHTML = (data.rewards || []).slice(0, 10)
        .map((r, i) => `<span class="reward-chip">${labels[i]}: +${num(r)} coin</span>`).join('');
      renderLb(root, data.leaderboard, 'link');
    }
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
    await Promise.all([loadAdminItems(), loadAdminUsers()]);
  } catch (err) { toast(err.message, 'error'); }
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
