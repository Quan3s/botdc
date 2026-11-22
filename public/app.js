/* ASYNCTAS dashboard — vanilla JS, i18n + SVG icons (contract-aligned). */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const t = (key, vars) => (window.t ? window.t(key, vars) : key);
const icon = (name, size) => (window.icons && window.icons.icon ? window.icons.icon(name, size) : '');
const getLanguage = () => (window.getLanguage ? window.getLanguage() : 'vi');
const setLanguage = lang => (window.setLanguage ? window.setLanguage(lang) : lang);

const state = {
  user: null,
  view: 'dashboard',
  shop: [],
  lbTab: 'coins',
  adminTab: 'user',
  plugins: [],
  orders: [],
  skipLangRefresh: false,
  seller: { revenue: 'week', data: null },
  userShop: { q: '', filter: 'recommended', page: 1, detail: null },
  chat: { contacts: [], with: null, messages: [], poll: null, unread: 0, open: false },
  adminReviews: [],
};

let cloudStatusTimer = null;
let deviceIdCache = null;

const DEVICE_LOGOS = {
  vmos: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSnEz_zC4ZHJBI8GYKBKoLB4OArt8V9lVet6fX5Ndv83w&s=10',
  vsphone: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_g3u538-aiEWP_68-48toiD36I5eBqhVWVI6V0U0uww&s=10',
  ugphone: 'https://img.utdstc.com/icon/48f/fcd/48ffcdcfb167f38e517727e184da795d34418c94094af934298aacc64fceddb6:600',
};

// ==================== HELPERS ====================
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value) { return Number(value || 0).toLocaleString('en-US'); }

/** Gán text an toàn: không throw nếu element đã bị i18n/CSS thay thế. */
function setText(sel, value, root = document) {
  const el = typeof sel === 'string' ? $(sel, root) : sel;
  if (el) el.textContent = value == null ? '' : String(value);
  return el;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.innerHTML = icon(type === 'error' ? 'warning' : 'checkCircle', 15) + '<span></span>';
  const label = el.querySelector('span');
  if (label) setText(label, message);
  else setText(el, message);
  const host = $('#toasts') || document.body;
  if (host) host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'all .3s ease';
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

function getDeviceId() {
  if (deviceIdCache) return deviceIdCache;
  try { deviceIdCache = localStorage.getItem('asynctas_device_id') || ''; } catch (e) { deviceIdCache = ''; }
  if (!deviceIdCache) {
    deviceIdCache = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem('asynctas_device_id', deviceIdCache); } catch (e) { /* ignore */ }
  }
  return deviceIdCache;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Device-ID': getDeviceId(), ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${t('common.error')} ${res.status}`);
    err.data = data || {};
    err.status = res.status;
    throw err;
  }
  return data;
}

function isAuthError(err) {
  return err && (err.status === 401 || /đăng nhập|login|unauthorized/i.test(err.message || ''));
}

function renderIcons(root = document) {
  $$('[data-icon]', root).forEach(el => {
    const size = Number(el.dataset.size) || 18;
    el.innerHTML = icon(el.dataset.icon, size);
    el.removeAttribute('data-icon');
  });
}

function renderProviderLogos(root = document) {
  $$('[data-provider-logo]', root).forEach(el => {
    const src = DEVICE_LOGOS[el.dataset.providerLogo];
    if (!src || el.querySelector('.provider-logo')) return;
    const img = document.createElement('img');
    img.className = 'provider-logo';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    el.insertBefore(img, el.firstChild);
  });
}

function labelButton(btn, key, vars) {
  if (!btn) return;
  // Không bao giờ gán data-i18n vào thẻ chứa icon: applyTranslations() dùng
  // textContent và sẽ xoá mất các span icon bên trong.
  btn.removeAttribute('data-i18n');
  let label = btn.querySelector('[data-i18n], span:last-child');
  if (!label || label === btn) {
    label = document.createElement('span');
    btn.appendChild(label);
  }
  setText(label, t(key, vars));
  label.setAttribute('data-i18n', key);
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (e) {
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
    setText(btn, t('auth.copied'));
    setTimeout(() => setText(btn, old), 1500);
  }
  toast(t('auth.copyDone'));
}

function openModal({ title, body, actions }) {
  const root = $('#modal-root');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const h = document.createElement('h3');
  setText(h, title);
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
    setText(btn, action.label);
    btn.onclick = () => action.onClick ? action.onClick(btn) : closeModal();
    actionsEl.appendChild(btn);
  });
  modal.appendChild(actionsEl);
  root.appendChild(modal);
  renderIcons(modal);
  root.onclick = e => { if (e.target === root) closeModal(); };
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
}

function priceLabel(price, currency, priceText) {
  const cur = String(currency || '').toLowerCase();
  const text = String(priceText == null ? '' : priceText);
  if (cur === 'acoin' || text.trim().charAt(0) === '$') {
    const value = text.trim().charAt(0) === '$' ? text.trim() : `$${num(price)}`;
    return `${value} ACOIN`;
  }
  return `${num(price)} ${t('topbar.coinShort')}`;
}

function statusLabel(status) {
  const key = ({
    pending: 'userShop.pending', completed: 'orders.completed', complete: 'orders.completed',
    complaint: 'orders.complain', complained: 'orders.complain', appealed: 'userShop.appealed',
    approved: 'userShop.approved', rejected: 'userShop.rejected', returned: 'orders.return',
    active: 'seller.status.active', suspended: 'seller.status.suspended', none: 'seller.status.none',
  })[String(status || '').toLowerCase()];
  return key ? t(key) : (status || '—');
}

function renderStars(value, appealed = false) {
  const n = Math.max(0, Math.min(5, Number(value) || 0));
  let out = '<span class="stars' + (appealed ? ' appealed' : '') + '">';
  for (let i = 1; i <= 5; i++) out += icon(i <= n ? 'star-filled' : 'star', 14);
  return out + '</span>';
}

// ==================== AUTH ====================
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  closeChatPanel();
  closeSidebar();
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderIcons(document);
}

$$('.auth-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.auth-tab').forEach(x => x.classList.remove('active'));
  tab.classList.add('active');
  const name = tab.dataset.tab;
  $('#login-form').classList.toggle('hidden', name !== 'login');
  $('#register-form').classList.toggle('hidden', name !== 'register');
  $('#token-form').classList.toggle('hidden', name !== 'token');
}));

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-username').value, password: $('#login-password').value }),
    });
    await enterApp(data.user);
  } catch (err) {
    if (err.data && err.data.requiresUsernameChange) promptUsernameChange(err.data, { password: $('#login-password').value });
    else toast(err.message, 'error');
  }
});

$('#token-form').addEventListener('submit', async e => {
  e.preventDefault();
  const token = $('#token-login-token').value.trim();
  try {
    const data = await api('/api/auth/discord-token', { method: 'POST', body: JSON.stringify({ token }) });
    await enterApp(data.user);
  } catch (err) {
    if (err.data && err.data.requiresUsernameChange) promptUsernameChange({ ...err.data, token }, {});
    else toast(err.message, 'error');
  }
});

function promptUsernameChange(info, credentials) {
  const wrap = document.createElement('div');
  const isToken = Boolean(info.token);
  const passwordField = isToken
    ? `<p class="muted">${esc(t('auth.tokenRenameInfo'))}</p>`
    : `<label>${esc(t('auth.currentPassword'))}<input id="rename-password" type="password" value="${esc(credentials.password || '')}" /></label>`;
  wrap.innerHTML = `
    <p class="muted">${esc(t('auth.renameDesc', { name: info.currentUsername }))}</p>
    ${passwordField}
    <label>${esc(t('auth.newUsername'))}<input id="rename-username" data-i18n-placeholder="auth.newUsernamePlaceholder" placeholder="${esc(t('auth.newUsernamePlaceholder'))}" /></label>`;
  openModal({
    title: t('auth.renameTitle'),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('auth.renameAction'), className: 'btn-primary', onClick: async btn => {
          const newUsername = wrap.querySelector('#rename-username').value.trim();
          if (!/^[a-zA-Z0-9_]{3,24}$/.test(newUsername) || !/[A-Za-z]/.test(newUsername)) {
            toast(t('auth.renameInvalid'), 'error');
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
            toast(t('auth.renameSuccess'));
            await enterApp(data.user);
          } catch (err) {
            btn.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
    ],
  });
  $('#modal-root').onclick = null;
}

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#reg-username').value,
        password: $('#reg-password').value,
        deviceId: getDeviceId(),
      }),
    });
    toast(t('auth.registerSuccess'));
    await enterApp(data.user);
  } catch (err) { toast(err.message, 'error'); }
});

function logout() {
  stopChatPolling();
  closeAvatarMenu();
  closeChatPanel();
  api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  state.orders = [];
  showAuth();
}

$('#logout-btn').addEventListener('click', logout);
$('#avatar-logout').addEventListener('click', logout);

async function enterApp(user) {
  state.user = user;
  showApp();
  syncLanguageFromUser(user && user.language);
  applyUser();
  switchView('dashboard');
  refreshDashboard();
}

// ==================== THEME / LANGUAGE / USER ====================
function applyTheme(theme) {
  const value = theme === 'classic' ? 'classic' : 'bubble';
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('asynctas_theme', value); } catch (e) { /* ignore */ }
  $$('[data-theme-choice]').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === value));
  const label = $('#theme-current');
  if (label) setText(label, value === 'bubble' ? 'Bubble' : 'Classic');
}

function applyBackground(url) {
  const value = url ? `url("${String(url).replace(/"/g, '%22').replace(/\n/g, '')}")` : 'none';
  document.documentElement.style.setProperty('--wallpaper', value);
  try { localStorage.setItem('asynctas_background', String(url || '')); } catch (e) { /* ignore */ }
}

function updateLanguageChrome() {
  setText('#lang-label', getLanguage() === 'en' ? 'EN' : 'VI');
  document.documentElement.lang = getLanguage();
  $$('[data-language-choice]').forEach(b => b.classList.toggle('active', b.dataset.languageChoice === getLanguage()));
}

function syncLanguageFromUser(lang) {
  const next = String(lang || '').toLowerCase().indexOf('en') === 0 ? 'en' : 'vi';
  if (next === getLanguage()) { updateLanguageChrome(); return; }
  state.skipLangRefresh = true;
  setLanguage(next);
  state.skipLangRefresh = false;
  updateLanguageChrome();
}

async function changeLanguage(lang) {
  const next = String(lang || '').toLowerCase().indexOf('en') === 0 ? 'en' : 'vi';
  setLanguage(next);
  updateLanguageChrome();
  try {
    const data = await api('/api/profile/language', { method: 'POST', body: JSON.stringify({ language: next }) });
    if (state.user) state.user.language = data.language || next;
    toast(t('profile.languageSaved', { language: next === 'vi' ? 'Tiếng Việt' : 'English' }));
  } catch (err) { toast(err.message, 'error'); }
}

function setUnreadCount(count) {
  const value = Math.max(0, Number(count) || 0);
  state.chat.unread = value;
  if (state.user) state.user.unreadMessages = value;
  const badge = $('#chat-unread-badge');
  if (!badge) return;
  setText(badge, value > 99 ? '99+' : num(value));
  badge.classList.toggle('hidden', value === 0);
}

function applyUser() {
  const u = state.user;
  if (!u) return;
  applyTheme(u.theme);
  applyBackground(u.background);
  updateLanguageChrome();
  setText('#top-balance', num(u.balance));
  setText('#top-acoin', num(u.acoin));
  setText('#hero-balance', num(u.balance));
  setText('#hero-name', u.username);
  setText('#user-name', u.username);
  setText('#user-initial', (u.username[0] || 'U').toUpperCase());

  const heroAcoin = $('#hero-acoin');
  heroAcoin.removeAttribute('data-i18n');
  heroAcoin.innerHTML = icon('acoin', 15) + '<span></span>';
  setText(heroAcoin.querySelector('span'), t('dashboard.acoinBalance', { value: num(u.acoin) }));
  const rate = $('#exchange-rate');
  rate.removeAttribute('data-i18n');
  setText(rate, t('dashboard.exchangeRate', { rate: num(u.exchangeRate || 5) }));

  $('#youtube-link').href = u.youtubeUrl || 'https://youtube.com';
  $('#discord-link').href = u.discordUrl || 'https://discord.com';

  const avatar = $('#user-avatar');
  if (u.avatar) {
    avatar.src = u.avatar;
    avatar.classList.remove('hidden');
    $('#user-initial').classList.add('hidden');
  } else {
    avatar.classList.add('hidden');
    $('#user-initial').classList.remove('hidden');
  }
  avatar.onerror = () => { avatar.classList.add('hidden'); $('#user-initial').classList.remove('hidden'); };
  const short = esc((u.username[0] || 'U').toUpperCase());
  $('#sidebar-user').innerHTML = `<span class="sidebar-avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" />` : short}</span><span>${esc(u.username)}</span>`;
  setText('#profile-username', u.username);
  setText('#profile-balance', t('profile.coinUnit', { amount: num(u.balance) }));
  setText('#profile-discord', u.linked ? t('profile.linked', { id: u.discordId }) : t('profile.notLinked'));
  setText('#profile-role', u.isAdmin ? `${t('profile.admin')} / ${t('nav.admin')}` : t('profile.member'));
  setText('#link-token', u.linkToken || '—');
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !u.isAdmin));
  updateSellerChrome();
  $('#link-box').classList.toggle('hidden', !!u.linked);
  $('#regen-token-btn').classList.toggle('hidden', !!u.linked);
  $('#linked-note').classList.toggle('hidden', !u.linked);
  setUnreadCount(u.unreadMessages != null ? u.unreadMessages : state.chat.unread);
}

function isSeller() { return !!(state.user && (state.user.isSeller || state.user.sellerStatus === 'active')); }

/** Sidebar + menu avatar phải đổi chung một trạng thái seller. */
function updateSellerChrome() {
  const seller = isSeller();
  $$('.seller-only').forEach(el => el.classList.toggle('hidden', !seller));
  const avatarSeller = $('#avatar-seller');
  if (avatarSeller) labelButton(avatarSeller, seller ? 'nav.seller' : 'topbar.sellerRequest');
}

async function refreshUser() {
  const data = await api('/api/me');
  const user = data.user || data;
  if (!user) { showAuth(); return; }
  state.user = user;
  applyUser();
}

$$('[data-theme-choice]').forEach(btn => btn.addEventListener('click', async () => {
  const theme = btn.dataset.themeChoice;
  applyTheme(theme);
  try {
    const data = await api('/api/profile/theme', { method: 'POST', body: JSON.stringify({ theme }) });
    if (state.user) state.user.theme = data.theme;
    toast(t(data.theme === 'bubble' ? 'profile.themeBubbleToast' : 'profile.themeClassicToast'));
  } catch (err) { toast(err.message, 'error'); }
}));

$$('[data-language-choice]').forEach(btn => btn.addEventListener('click', () => changeLanguage(btn.dataset.languageChoice)));
$('#lang-toggle').addEventListener('click', () => changeLanguage(getLanguage() === 'vi' ? 'en' : 'vi'));

window.addEventListener('asynctas:languagechange', () => {
  updateLanguageChrome();
  if (state.skipLangRefresh) return;
  renderIcons(document);
  if (state.user) {
    applyUser();
    loadView(state.view);
  }
  renderChatContacts();
  renderChatMessages();
  renderOrders();
});

// ==================== NAVIGATION / SIDEBAR / AVATAR MENU ====================
const VIEW_TITLE_KEYS = {
  dashboard: 'nav.dashboard', shop: 'nav.shop', 'user-shop': 'nav.userShop',
  buydevice: 'nav.buydevice', cloudstatus: 'nav.cloudstatus', tasks: 'nav.tasks',
  giftcode: 'nav.giftcode', leaderboard: 'nav.leaderboard', transfer: 'nav.transfer',
  orders: 'nav.orders', seller: 'nav.seller', profile: 'nav.profile',
  admin: 'nav.admin', messages: 'chat.title',
};

function openSidebar() {
  $('.sidebar').classList.add('open');
  $('#sidebar-overlay').classList.remove('hidden');
  $('#menu-toggle').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  $('.sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.add('hidden');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

$('#menu-toggle').addEventListener('click', () => {
  if ($('.sidebar').classList.contains('open')) closeSidebar(); else openSidebar();
});
$('#sidebar-close').addEventListener('click', closeSidebar);
$('#sidebar-overlay').addEventListener('click', closeSidebar);

function closeAvatarMenu() {
  $('#avatar-dropdown').classList.add('hidden');
  $('#avatar-menu-btn').setAttribute('aria-expanded', 'false');
}

function toggleAvatarMenu() {
  const hidden = $('#avatar-dropdown').classList.toggle('hidden');
  $('#avatar-menu-btn').setAttribute('aria-expanded', String(!hidden));
  if (!hidden) closeChatPanel();
}

$('#avatar-menu-btn').addEventListener('click', e => { e.stopPropagation(); toggleAvatarMenu(); });
document.addEventListener('click', e => {
  if (!e.target.closest('.avatar-menu-wrap')) closeAvatarMenu();
});

$('#avatar-profile').addEventListener('click', () => { closeAvatarMenu(); switchView('profile'); });
$('#avatar-orders').addEventListener('click', () => { closeAvatarMenu(); switchView('orders'); });
$('#avatar-seller').addEventListener('click', () => {
  closeAvatarMenu();
  if (isSeller()) switchView('seller');
  else requestSeller();
});

function switchView(view) {
  if (!VIEW_TITLE_KEYS[view]) view = 'dashboard';
  state.view = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  setText('#view-title', t(VIEW_TITLE_KEYS[view]));
  closeSidebar();
  closeAvatarMenu();
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'cloudstatus') startCloudStatusPolling(); else stopCloudStatusPolling();
  loadView(view);
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => switchView(item.dataset.view)));
$$('[data-goto]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.goto)));
$$('[data-scroll-to]').forEach(btn => btn.addEventListener('click', () => {
  const target = $(btn.dataset.scrollTo);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}));

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeSidebar();
  closeAvatarMenu();
  if (state.chat.open) closeChatPanel();
});

function loadView(view) {
  if (!state.user) return;
  if (view === 'dashboard') refreshDashboard();
  else if (view === 'shop') loadShop();
  else if (view === 'user-shop') loadUserShop();
  else if (view === 'orders') loadOrders();
  else if (view === 'seller') loadSeller();
  else if (view === 'cloudstatus') loadCloudStatus();
  else if (view === 'tasks') loadTasks();
  else if (view === 'giftcode') $('#giftcode-input').focus();
  else if (view === 'leaderboard') loadLeaderboard();
  else if (view === 'transfer') loadTransfers();
  else if (view === 'admin') loadAdmin();
  else if (view === 'messages') { /* panel được mở từ nút chat trên topbar */ }
}

$('#messages-open-chat').addEventListener('click', () => openChatPanel());

// ==================== DASHBOARD / EXCHANGE ====================
async function refreshDashboard() {
  try {
    await refreshUser();
    const [tasks, purchases] = await Promise.all([api('/api/tasks'), api('/api/purchases')]);
    const providers = tasks.providers || [];
    const daily = providers.reduce((sum, p) => sum + Number(p.used || tasks.daily[p.id] || 0), 0);
    const dailyTotal = providers.reduce((sum, p) => sum + Number(p.dailyMax || 0), 0);
    setText('#stat-weekly', num(tasks.weeklyCount));
    setText('#stat-daily', `${daily}/${dailyTotal || tasks.dailyMax * 2}`);
    setText('#stat-purchases', num(purchases.purchases.length));
    updateDailyCard(tasks);
    const lb = await api('/api/leaderboard/links');
    const me = state.user;
    const idx = lb.leaderboard.findIndex(r => r.userId === (me.discordId || `web_${me.id}`));
    setText('#stat-rank', idx >= 0 ? `#${idx + 1}` : '—');
    renderRecentPurchases(purchases.purchases.slice(0, 3));
  } catch (err) {
    if (isAuthError(err)) return showAuth();
    toast(err.message, 'error');
  }
}

function renderRecentPurchases(list) {
  const root = $('#recent-purchases');
  if (!list.length) { root.innerHTML = `<div class="empty">${esc(t('dashboard.noPurchases'))}</div>`; return; }
  root.innerHTML = list.map(p => `
    <div class="mini-row">
      <span>${icon('package', 15)} ${esc(p.itemName)} ×${p.quantity}</span>
      <b>${num(p.totalPrice)} ${t('topbar.coinShort')}</b>
    </div>`).join('');
  renderIcons(root);
}

function updateDailyCard(tasks) {
  const claimed = !!tasks.dailyClaimed;
  const freeClaimed = !!tasks.freeVmosClaimed;
  const unlocked = Number(tasks.linkCountAllTime || 0) > 0;
  setText('#daily-date', tasks.date || '—');
  const claimBtn = $('#daily-claim-btn');
  claimBtn.disabled = claimed;
  labelButton(claimBtn, claimed ? 'dashboard.claimedToday' : 'dashboard.claim');
  setText('#daily-claim-status', t(claimed ? 'dashboard.coinGiftClaimed' : 'dashboard.coinGiftPending'));
  const vmosBtn = $('#daily-vmos-btn');
  vmosBtn.disabled = freeClaimed || !unlocked;
  labelButton(vmosBtn, freeClaimed ? 'dashboard.takenToday' : 'dashboard.getVmos');
  setText('#daily-vmos-status', t(freeClaimed ? 'dashboard.vmosTaken' : unlocked ? 'dashboard.vmosAvailable' : 'dashboard.vmosLocked'));
}

$('#daily-claim-btn').addEventListener('click', async () => {
  const btn = $('#daily-claim-btn');
  const box = $('#daily-result');
  btn.disabled = true;
  try {
    const data = await api('/api/daily/claim', { method: 'POST' });
    box.className = 'result-box';
    setText(box, t('dashboard.dailyReward', { amount: num(data.reward), balance: num(data.newBalance) }));
    box.classList.remove('hidden');
    await refreshDashboard();
  } catch (err) {
    box.className = 'result-box error';
    setText(box, err.message);
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
    box.innerHTML = `<div>${esc(t('dashboard.freeVmos', { count: num(data.linkCount) }))}</div>
      <div class="accounts-box">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="free-vmos-copy">${icon('copy', 14)}<span>${esc(t('shop.copyAll'))}</span></button></div>`;
    box.classList.remove('hidden');
    renderIcons(box);
    $('#free-vmos-copy').addEventListener('click', ev => copyText(data.copyText, ev.currentTarget));
    await refreshDashboard();
  } catch (err) {
    box.className = 'result-box error';
    setText(box, err.message);
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

$('#exchange-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const amount = Math.floor(Number($('#exchange-amount').value) || 0);
  if (amount <= 0) { toast(t('dashboard.exchangeAmount'), 'error'); btn.disabled = false; return; }
  try {
    const data = await api('/api/exchange', {
      method: 'POST',
      body: JSON.stringify({ from: $('#exchange-from').value, amount }),
    });
    if (state.user) {
      state.user.balance = data.coin != null ? data.coin : data.newCoin;
      state.user.acoin = data.acoin != null ? data.acoin : data.newAcoin;
    }
    applyUser();
    toast(t('dashboard.exchangeSuccess', { coin: num(state.user.balance), acoin: num(state.user.acoin) }));
    if (state.view !== 'dashboard') loadView(state.view);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
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
  if (!items.length) { grid.innerHTML = `<div class="card empty">${esc(t('shop.empty'))}</div>`; return; }
  grid.innerHTML = items.map(item => {
    const logo = /^https?:\/\//i.test(item.logoUrl)
      ? `<img class="product-logo" src="${esc(item.logoUrl)}" alt="${esc(item.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'product-logo placeholder',innerHTML:window.icons.icon('package',42)}))" />`
      : `<div class="product-logo placeholder">${icon('package', 42)}</div>`;
    return `
      <div class="product">
        ${logo}
        <div class="product-body">
          <h4>${esc(item.name)}</h4>
          <p>${esc(item.description || t('shop.noDescription'))}</p>
          <div class="product-foot">
            <span class="price">${priceLabel(item.price, item.currency, item.priceText)}</span>
            <span class="stock-badge">${esc(t('shop.stock', { count: num(item.stock) }))}</span>
          </div>
          <button class="btn btn-primary btn-block btn-sm" data-buy="${esc(item.id)}" ${item.stock < 1 ? 'disabled' : ''}>
            ${icon(item.stock < 1 ? 'warning' : 'cart', 15)}<span>${esc(t(item.stock < 1 ? 'shop.outOfStock' : 'shop.buy'))}</span>
          </button>
        </div>
      </div>`;
  }).join('');
  $$('[data-buy]', grid).forEach(btn => btn.addEventListener('click', () => buyItem(btn.dataset.buy)));
}

function renderPurchases(list) {
  const root = $('#purchases-list');
  if (!list.length) { root.innerHTML = `<div class="empty">${esc(t('shop.noPurchases'))}</div>`; return; }
  root.innerHTML = list.map(p => `
    <div class="purchase-card">
      <div class="purchase-head">
        <span>${icon('package', 15)} ${esc(p.itemName)} ×${p.quantity}</span>
        <b>${num(p.totalPrice)} ${t('topbar.coinShort')}</b>
      </div>
      <div class="accounts-box">${esc((p.accounts || []).join('\n'))}</div>
      <div class="copy-row">
        <button class="btn btn-soft btn-sm" data-copy-acc="${esc(p.id)}">${icon('copy', 14)}<span>${esc(t('shop.copyAll'))}</span></button>
      </div>
    </div>`).join('');
  $$('[data-copy-acc]', root).forEach(btn => btn.addEventListener('click', () => {
    const p = list.find(x => x.id === btn.dataset.copyAcc);
    if (p) copyText((p.accounts || []).join('\n'), btn);
  }));
}

function buyItem(itemId) {
  const item = state.shop.find(i => i.id === itemId);
  if (!item) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="muted">${esc(item.name)} — <b class="price">${esc(priceLabel(item.price, item.currency, item.priceText))}</b> · ${esc(t('shop.stock', { count: num(item.stock) }))}</p>
    <label style="margin-top:14px">${esc(t('shop.quantity'))}<input id="buy-qty" type="number" min="1" max="${item.stock}" value="1" /></label>
    <div class="fee-preview" id="buy-total"></div>`;
  const price = Number(item.price) || 0;
  const currency = item.currency;
  const totalEl = wrap.querySelector('#buy-total');
  const updateTotal = () => {
    const q = Math.max(1, Math.min(item.stock, parseInt(wrap.querySelector('#buy-qty').value, 10) || 1));
    setText(totalEl, t('shop.total', { total: priceLabel(price * q, currency, item.priceText) }));
  };
  updateTotal();
  wrap.querySelector('#buy-qty').addEventListener('input', updateTotal);
  openModal({
    title: t('shop.confirm'),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('dashboard.buyNow'), className: 'btn-primary', onClick: async btn => {
          const quantity = Math.max(1, Math.min(item.stock, parseInt(wrap.querySelector('#buy-qty').value, 10) || 1));
          btn.disabled = true;
          try {
            const data = await api('/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId, quantity }) });
            closeModal();
            toast(t('shop.success', { count: num(quantity) }));
            showAccountsModal(item.name, data.accounts || []);
            await refreshUser();
            loadShop();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function showAccountsModal(title, accounts) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">${esc(t('shop.accountsDesc'))}</p>
    <div class="accounts-box">${esc((accounts || []).join('\n'))}</div>`;
  openModal({
    title: `${t('shop.accountsTitle')} — ${title}`,
    body: wrap,
    actions: [
      { label: t('shop.copyAll'), onClick: btn => copyText((accounts || []).join('\n'), btn) },
      { label: t('shop.close'), className: 'btn-primary', onClick: closeModal },
    ],
  });
}

// ==================== USER SHOP ====================
$('#user-shop-search-btn').addEventListener('click', () => {
  state.userShop.q = $('#user-shop-q').value.trim();
  state.userShop.page = 1;
  loadUserShop();
});
$('#user-shop-q').addEventListener('keydown', e => { if (e.key === 'Enter') $('#user-shop-search-btn').click(); });
$('#user-shop-filter').addEventListener('change', e => {
  state.userShop.filter = e.target.value;
  state.userShop.page = 1;
  loadUserShop();
});
$('#user-shop-back').addEventListener('click', () => {
  state.userShop.detail = null;
  $('#user-shop-detail').classList.add('hidden');
  $('#user-shop-list').classList.remove('hidden');
  loadUserShop();
});

async function loadUserShop() {
  const grid = $('#user-shop-grid');
  grid.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
  try {
    const params = new URLSearchParams({ q: state.userShop.q, filter: state.userShop.filter, page: String(state.userShop.page) });
    const data = await api(`/api/user-shop?${params}`);
    state.userShop.page = data.page || 1;
    renderUserShopCards(data.shops || []);
    setText('#user-shop-total', t('userShop.total', { count: num(data.total || 0) }));
    renderPagination(data.page || 1, data.totalPages || 1);
    $('#user-shop-filter').value = data.filter || state.userShop.filter;
  } catch (err) {
    grid.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    setText('#user-shop-total', '');
    $('#user-shop-pagination').innerHTML = '';
  }
}

function renderUserShopCards(shops) {
  const grid = $('#user-shop-grid');
  if (!shops.length) { grid.innerHTML = `<div class="empty">${esc(t('userShop.empty'))}</div>`; return; }
  grid.innerHTML = shops.map(shop => `
    <button class="product shop-card" data-shop="${esc(shop.id)}" type="button">
      <div class="shop-cover" style="${shop.backgroundUrl ? `background-image:url('${esc(shop.backgroundUrl)}')` : ''}">
        ${shop.logoUrl ? `<img class="shop-logo" src="${esc(shop.logoUrl)}" alt="${esc(shop.name)}" onerror="this.style.display='none'" />` : `<span class="shop-logo placeholder">${icon('store', 26)}</span>`}
      </div>
      <div class="product-body">
        <h4>${esc(shop.name)}</h4>
        <p>${esc(shop.description || t('shop.noDescription'))}</p>
        <div class="shop-meta">
          <span>${renderStars(shop.rating)} <small>${num(shop.rating)}</small></span>
          <span>${esc(t('userShop.reviewCount', { count: num(shop.reviewCount) }))}</span>
        </div>
        <div class="product-foot">
          <span class="price">${esc(t('userShop.fromPrice', { price: priceLabel(shop.minPrice, shop.currency) }))}</span>
          <span class="stock-badge">${esc(t('userShop.sales', { count: num(shop.sales) }))}</span>
        </div>
      </div>
    </button>`).join('');
  $$('[data-shop]', grid).forEach(card => card.addEventListener('click', () => openUserShop(card.dataset.shop)));
}

function renderPagination(page, totalPages) {
  const root = $('#user-shop-pagination');
  if (!totalPages || totalPages <= 1) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('chevron', 14)}<span>${esc(t('userShop.prev'))}</span></button>
    <span class="pill">${esc(t('userShop.page', { page: num(page), total: num(totalPages) }))}</span>
    <button class="btn btn-ghost btn-sm" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}><span>${esc(t('userShop.next'))}</span>${icon('chevron', 14)}</button>`;
  $$('[data-page]', root).forEach(btn => btn.addEventListener('click', () => {
    state.userShop.page = Number(btn.dataset.page);
    loadUserShop();
    $('.content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

async function openUserShop(id) {
  try {
    const data = await api(`/api/user-shop/${encodeURIComponent(id)}`);
    state.userShop.detail = data;
    $('#user-shop-list').classList.add('hidden');
    $('#user-shop-detail').classList.remove('hidden');
    renderUserShopDetail();
    $('.content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { toast(err.message, 'error'); }
}

function renderUserShopDetail() {
  const d = state.userShop.detail;
  if (!d) return;
  const shop = d.shop || {};
  const seller = d.seller || {};
  const sellerId = seller.userId || seller.id || seller.discordId;
  const head = $('#user-shop-detail-head');
  head.innerHTML = `
    <div class="shop-detail-cover" style="${shop.backgroundUrl ? `background-image:url('${esc(shop.backgroundUrl)}')` : ''}">
      ${shop.logoUrl ? `<img class="shop-detail-logo" src="${esc(shop.logoUrl)}" alt="${esc(shop.name)}" onerror="this.style.display='none'" />` : `<span class="shop-detail-logo placeholder">${icon('store', 36)}</span>`}
      <div class="shop-detail-info">
        <h3>${esc(shop.name)}</h3>
        <p class="muted">${esc(shop.description || t('shop.noDescription'))}</p>
        <div class="shop-meta">
          <span>${renderStars(shop.rating)} <small>${num(shop.rating)}</small></span>
          <span>${esc(t('userShop.reviewCount', { count: num(shop.reviewCount || (d.reviews || []).length) }))}</span>
          <span>${esc(t('userShop.sales', { count: num(shop.sales) }))}</span>
        </div>
      </div>
      <button class="btn btn-soft" id="shop-message-seller">${icon('chat', 16)}<span>${esc(t('userShop.messageSeller'))}</span></button>
    </div>`;
  $('#shop-message-seller').addEventListener('click', () => openChatWith(sellerId, seller.display || seller.username || shop.name));

  const products = d.products || [];
  const productRoot = $('#user-shop-products');
  productRoot.innerHTML = products.length ? products.map(p => `
    <div class="product">
      <div class="product-body">
        <h4>${esc(p.name)}</h4>
        <p>${esc(p.description || t('shop.noDescription'))}</p>
        <div class="product-foot">
          <span class="price">${esc(priceLabel(p.price, p.currency, p.priceText))}</span>
          <span class="stock-badge">${esc(t('userShop.stock', { count: num(p.stock) }))}</span>
        </div>
        <button class="btn btn-primary btn-sm" data-buy-user-shop="${esc(p.id)}" ${Number(p.stock) < 1 ? 'disabled' : ''}>${icon('cart', 15)}<span>${esc(t('userShop.buy'))}</span></button>
      </div>
    </div>`).join('') : `<div class="empty">${esc(t('userShop.noProducts'))}</div>`;
  $$('[data-buy-user-shop]', productRoot).forEach(btn => btn.addEventListener('click', () => buyUserShopProduct(btn.dataset.buyUserShop)));

  renderShopReviews(d, shop, sellerId);
}

function renderShopReviews(d, shop, sellerId) {
  const root = $('#user-shop-reviews');
  const reviews = d.reviews || [];
  if (state.user && state.user.isAdmin) {
    state.adminReviews = state.adminReviews.filter(r => !reviews.some(x => x.id === r.id));
    state.adminReviews.push(...reviews.filter(r => r.status === 'pending' || r.appealed || r.status === 'appealed').map(r => ({ ...r, shopId: shop.id })));
  }
  root.innerHTML = reviews.length ? reviews.map(r => {
    const appealed = !!r.appealed || r.status === 'appealed';
    const canManage = state.user && (state.user.isAdmin || (isSeller() && String(sellerId) === String(state.user.id)));
    const actions = canManage ? `
      <div class="review-actions">
        <button class="btn btn-ghost btn-sm" data-review-reply="${esc(r.id)}">${icon('reply', 13)}<span>${esc(t('userShop.reply'))}</span></button>
        ${state.user.isAdmin ? `
          <button class="btn btn-soft btn-sm" data-review-decision="${esc(r.id)}" data-approve="1">${icon('check', 13)}<span>${esc(t('admin.approve'))}</span></button>
          <button class="btn btn-danger btn-sm" data-review-decision="${esc(r.id)}" data-approve="0">${icon('close', 13)}<span>${esc(t('admin.reject'))}</span></button>` : ''}
        ${!appealed && isSeller() ? `<button class="btn btn-ghost btn-sm" data-review-appeal="${esc(r.id)}">${icon('appeal', 13)}<span>${esc(t('userShop.appeal'))}</span></button>` : ''}
      </div>` : '';
    return `
      <div class="review-card${appealed ? ' appealed' : ''}">
        <div class="review-head">
          ${renderStars(r.stars, appealed)}
          <b>${esc(r.buyer || t('profile.member'))}</b>
          <span class="pill${appealed ? ' appealed-pill' : ''}">${esc(appealed ? t('userShop.appealed') : statusLabel(r.status))}</span>
        </div>
        <p>${esc(r.content)}</p>
        ${r.adminReply ? `<p class="muted">${icon('replyAll', 14)} ${esc(t('userShop.adminReply', { reply: r.adminReply }))}</p>` : ''}
        ${actions}
      </div>`;
  }).join('') : `<div class="empty">${esc(t('userShop.noReviews'))}</div>`;

  $$('[data-review-reply]', root).forEach(btn => btn.addEventListener('click', () => promptReviewText(t('userShop.replyTitle'), content => api(`/api/user-shop/${encodeURIComponent(shop.id)}/review/${encodeURIComponent(btn.dataset.reviewReply)}/reply`, { method: 'POST', body: JSON.stringify({ content }) }).then(() => { toast(t('userShop.replySent')); openUserShop(shop.id); }))));
  $$('[data-review-appeal]', root).forEach(btn => btn.addEventListener('click', () => promptReviewText(t('userShop.appealTitle'), reason => api(`/api/user-shop/${encodeURIComponent(shop.id)}/review/${encodeURIComponent(btn.dataset.reviewAppeal)}/appeal`, { method: 'POST', body: JSON.stringify({ reason }) }).then(() => { toast(t('userShop.appealSent')); openUserShop(shop.id); }))));
  $$('[data-review-decision]', root).forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/admin/reviews/${encodeURIComponent(btn.dataset.reviewDecision)}/decision`, {
        method: 'POST', body: JSON.stringify({ approve: btn.dataset.approve === '1' }),
      });
      toast(t('admin.approved'));
      openUserShop(shop.id);
    } catch (err) { toast(err.message, 'error'); }
  }));

  renderReviewForm(shop, d.products || []);
}

function promptReviewText(title, onConfirm, defaultValue = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<label>${esc(t('orders.reason'))}<textarea id="dialog-text" rows="3" data-i18n-placeholder="userShop.replyPlaceholder" placeholder="${esc(t('userShop.replyPlaceholder'))}">${esc(defaultValue)}</textarea></label>`;
  openModal({
    title,
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('common.save'), className: 'btn-primary', onClick: async btn => {
          const text = wrap.querySelector('#dialog-text').value.trim();
          if (!text) { toast(t('orders.reasonRequired'), 'error'); return; }
          btn.disabled = true;
          try { await onConfirm(text); closeModal(); }
          catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function renderReviewForm(shop, products) {
  const root = $('#user-shop-review-form');
  const completed = state.orders.filter(o => String(o.shopName || '') === String(shop.name || '') && /complete/i.test(String(o.status || '')));
  if (!completed.length) { root.classList.add('hidden'); root.innerHTML = ''; return; }
  root.classList.remove('hidden');
  root.innerHTML = `
    <h4>${esc(t('userShop.reviewTitle'))}</h4>
    <p class="muted">${esc(t('userShop.reviewDesc'))}</p>
    <div class="grid two-col">
      <label>${esc(t('userShop.selectProduct'))}<select id="review-product">${products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>${esc(t('userShop.selectOrder'))}<select id="review-order">${completed.map(o => `<option value="${esc(o.id)}">${esc(o.itemName)} · ${esc(o.id)}</option>`).join('')}</select></label>
    </div>
    <label>${esc(t('userShop.stars'))}<select id="review-stars"><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label>
    <label>${esc(t('userShop.reviewContent'))}<textarea id="review-content" rows="3" data-i18n-placeholder="userShop.reviewPlaceholder" placeholder="${esc(t('userShop.reviewPlaceholder'))}"></textarea></label>
    <button id="review-submit" class="btn btn-primary">${icon('check', 15)}<span>${esc(t('userShop.submitReview'))}</span></button>`;
  $('#review-submit').addEventListener('click', async e => {
    const productId = $('#review-product').value;
    const orderId = $('#review-order').value;
    const stars = Number($('#review-stars').value);
    const content = $('#review-content').value.trim();
    if (!productId || !orderId || !stars || !content) { toast(t('userShop.reviewRequired'), 'error'); return; }
    e.currentTarget.disabled = true;
    try {
      await api(`/api/user-shop/${encodeURIComponent(shop.id)}/review`, {
        method: 'POST', body: JSON.stringify({ productId, orderId, stars, content }),
      });
      toast(t('userShop.reviewSent'));
      openUserShop(shop.id);
    } catch (err) { e.currentTarget.disabled = false; toast(err.message, 'error'); }
  });
}

function buyUserShopProduct(productId) {
  const d = state.userShop.detail;
  if (!d) return;
  const product = (d.products || []).find(p => p.id === productId);
  if (!product) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="muted">${esc(t('userShop.buyDesc', { name: product.name, price: priceLabel(product.price, product.currency, product.priceText) }))}</p>
    <label>${esc(t('shop.quantity'))}<input id="us-qty" type="number" min="1" max="${Number(product.stock) || 1}" value="1" /></label>`;
  openModal({
    title: t('userShop.buyTitle'),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('userShop.buy'), className: 'btn-primary', onClick: async btn => {
          const quantity = Math.max(1, Number(wrap.querySelector('#us-qty').value) || 1);
          btn.disabled = true;
          try {
            await api(`/api/user-shop/${encodeURIComponent(d.shop.id)}/buy`, {
              method: 'POST', body: JSON.stringify({ productId, quantity }),
            });
            closeModal();
            toast(t('userShop.buySuccess'));
            await Promise.all([refreshUser(), loadOrders()]);
            openUserShop(d.shop.id);
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

// ==================== ORDERS ====================
$('#orders-refresh').addEventListener('click', () => loadOrders());

async function loadOrders() {
  const root = $('#orders-list');
  if (!root) return;
  root.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
  try {
    const data = await api('/api/orders/history');
    state.orders = data.orders || [];
    renderOrders();
  } catch (err) {
    root.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderOrders() {
  const root = $('#orders-list');
  if (!root) return;
  if (!state.orders.length) { root.innerHTML = `<div class="empty">${esc(t('orders.empty'))}</div>`; return; }
  root.innerHTML = state.orders.map(o => {
    const status = String(o.status || '');
    const isComplaint = /complain|appeal/i.test(status);
    return `
      <div class="order-card">
        <div class="order-head">
          <span>${icon('package', 16)} ${esc(o.itemName)} ×${num(o.quantity)}</span>
          <b>${esc(priceLabel(o.total, o.currency))}</b>
        </div>
        <div class="order-meta">
          <span>${icon('store', 13)} ${esc(o.shopName || '—')}</span>
          <span class="pill">${esc(statusLabel(status))}</span>
          <span class="muted">${esc(o.createdAt ? new Date(o.createdAt).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'vi-VN') : '—')}</span>
        </div>
        <div class="order-actions">
          ${/pending/i.test(status) ? `<button class="btn btn-soft btn-sm" data-order-action="complete" data-id="${esc(o.id)}">${icon('check', 14)}<span>${esc(t('orders.complete'))}</span></button>` : ''}
          <button class="btn btn-ghost btn-sm" data-order-action="view" data-id="${esc(o.id)}">${icon('eye', 14)}<span>${esc(t('orders.view'))}</span></button>
          ${/pending/i.test(status) ? `<button class="btn btn-soft btn-sm" data-order-action="complain" data-id="${esc(o.id)}">${icon('complaint', 14)}<span>${esc(t('orders.complain'))}</span></button>` : ''}
          ${/pending/i.test(status) ? `<button class="btn btn-danger btn-sm" data-order-action="return" data-id="${esc(o.id)}">${icon('refund', 14)}<span>${esc(t('orders.return'))}</span></button>` : ''}
          ${isComplaint && isSeller() ? `<button class="btn btn-soft btn-sm" data-order-action="appeal" data-id="${esc(o.id)}">${icon('appeal', 14)}<span>${esc(t('orders.appeal'))}</span></button>` : ''}
        </div>
      </div>`;
  }).join('');
  $$('[data-order-action]', root).forEach(btn => btn.addEventListener('click', () => handleOrderAction(btn.dataset.orderAction, btn.dataset.id)));
}

async function handleOrderAction(action, id) {
  const order = state.orders.find(o => o.id === id) || {};
  if (action === 'view') {
    openModal({
      title: t('orders.viewTitle'),
      body: `<pre class="accounts-box">${esc(t('orders.viewBody', {
        id, item: order.itemName || '—', shop: order.shopName || '—', qty: num(order.quantity),
        total: priceLabel(order.total, order.currency), status: statusLabel(order.status),
      }))}</pre>`,
      actions: [{ label: t('shop.close'), className: 'btn-primary', onClick: closeModal }],
    });
    api(`/api/orders/${encodeURIComponent(id)}/view`, { method: 'POST' }).catch(() => {});
    return;
  }
  if (action === 'complain' || action === 'appeal') {
    promptReviewText(action === 'appeal' ? t('orders.appeal') : t('orders.complain'), async reason => {
      await api(`/api/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });
      toast(t('orders.actionDone'));
      await loadOrders();
    });
    return;
  }
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    toast(t('orders.actionDone'));
    await Promise.all([loadOrders(), refreshUser()]);
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== SELLER ====================
async function requestSeller() {
  try {
    const data = await api('/api/seller/request', { method: 'POST' });
    if (state.user) state.user.sellerStatus = data.status || 'pending';
    updateSellerChrome();
    toast(t('seller.requestSent'));
    if (state.view === 'seller') loadSeller();
  } catch (err) { toast(err.message, 'error'); }
}

$('#seller-request-btn').addEventListener('click', requestSeller);
$('#seller-refresh').addEventListener('click', () => loadSeller());
$$('#seller-revenue-tabs .tab').forEach(btn => btn.addEventListener('click', () => {
  state.seller.revenue = btn.dataset.revenue;
  $$('#seller-revenue-tabs .tab').forEach(x => x.classList.toggle('active', x === btn));
  if (state.seller.data) renderSellerDashboard(state.seller.data);
}));

async function loadSeller() {
  if (!state.user) return;
  const status = state.user.sellerStatus || 'none';
  const active = isSeller();
  const requestCard = $('#seller-request-card');
  const pending = $('#seller-pending-note');
  const content = $('#seller-dashboard-content');
  requestCard.classList.toggle('hidden', active);
  pending.classList.toggle('hidden', active || status !== 'pending');
  content.classList.toggle('hidden', !active);
  setText('#seller-status-pill', t(`seller.status.${status}`) || status);
  if (!active) return;
  try {
    const data = await api('/api/seller/dashboard');
    state.seller.data = data;
    renderSellerDashboard(data);
  } catch (err) {
    if (err.status === 403) {
      requestCard.classList.remove('hidden');
      pending.classList.remove('hidden');
      content.classList.add('hidden');
    } else toast(err.message, 'error');
  }
}

const SELLER_STATUS_KEYS = {
  pending: 'seller.statusPending', completed: 'seller.statusCompleted',
  complained: 'seller.statusComplained', returned: 'seller.statusReturned',
};

function sellerKpi(iconName, label, value, foot, tone) {
  return `<div class="card seller-kpi ${tone || ''}">
    <div class="seller-kpi-head"><span class="ico">${icon(iconName, 18)}</span><span>${esc(label)}</span></div>
    <div class="seller-kpi-value">${value}</div>
    ${foot ? `<div class="seller-kpi-foot">${foot}</div>` : ''}
  </div>`;
}

function renderSellerDashboard(data) {
  const stats = data.stats || {};
  const orders = data.orders || {};
  const coin = `<small>${esc(t('topbar.coinShort'))}</small>`;
  const root = $('#seller-stats');
  if (root) root.innerHTML = [
    sellerKpi('wallet', t('seller.received'), `${num(stats.processedCoin)} ${coin}`,
      `${esc(t('seller.afterFee'))} · ${esc(t('seller.gross'))}: ${num(stats.grossReceived)} ${coin}`, 'kpi-green'),
    sellerKpi('pending', t('seller.pendingPayout'), `${num(stats.pendingCoin)} ${coin}`,
      `${esc(t('seller.payoutHold'))} · ${esc(t('seller.gross'))}: ${num(stats.grossPending)} ${coin}`, 'kpi-gold'),
    sellerKpi('receipt', t('seller.totalOrders'), num(stats.totalOrders),
      `${num(stats.pendingOrders)} ${esc(t('seller.pendingOrders'))}`),
    sellerKpi('package', t('seller.activeProducts'), num(stats.activeProducts),
      `${num(stats.inactiveProducts)} ${esc(t('seller.inactiveProducts'))}`),
    sellerKpi('store', t('seller.totalShops'), num(stats.shops), esc(t('seller.allActive'))),
    sellerKpi('users', t('seller.stat.accountsImported'), num(stats.accountsImported)),
  ].join('');
  setText('#seller-orders-summary', t('seller.ordersSummary', { total: num(orders.total), pending: num(orders.pending) }));
  renderRevenueChart(data.revenue || {}, state.seller.revenue);
  renderSellerStatusChart(orders.statusCounts || {});
  renderSellerLegacyStats(stats);
  renderSellerRecentOrders(orders.recent || []);
  renderSellerShops(data.shops || []);
}

/** Giữ lại đủ 6 chỉ số thống kê cũ của Seller Dashboard. */
function renderSellerLegacyStats(stats) {
  const root = $('#seller-legacy-stats');
  if (!root) return;
  const keys = ['complainants', 'complaintPercent', 'completedOrders', 'completedPercent', 'returns', 'returnPercent'];
  root.innerHTML = keys.map(key => `<div class="seller-mini-stat">
    <b>${esc(stats[key] == null ? '0' : stats[key])}</b><small>${esc(t(`seller.stat.${key}`))}</small>
  </div>`).join('');
}

function renderRevenueChart(revenue, period) {
  const root = $('#seller-revenue-chart');
  if (!root) return;
  const rows = Array.isArray(revenue[period]) ? revenue[period] : [];
  if (!rows.length) { root.innerHTML = `<div class="empty">${esc(t('userShop.empty'))}</div>`; return; }
  const grossValues = rows.map(r => Number(r.value) || 0);
  const netValues = rows.map(r => Number(r.net) || 0);
  const max = Math.max(...grossValues, ...netValues, 1);
  const step = rows.length > 1 ? 520 / (rows.length - 1) : 0;
  const x = i => 40 + i * step;
  const y = v => 148 - (v / max) * 118;
  const line = values => values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));
  const labels = rows.map((r, i) => (i % labelStep === 0 || i === rows.length - 1)
    ? `<text x="${x(i)}" y="174" text-anchor="middle">${esc(r.label)}</text>` : '').join('');
  const dots = grossValues.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3"><title>${esc(rows[i].label)}: ${num(v)}</title></circle>`).join('');
  root.innerHTML = `
    <svg viewBox="0 0 600 185" class="revenue-svg" role="img" aria-label="${esc(t('seller.revenueTitle'))}">
      <line x1="40" y1="148" x2="560" y2="148" class="chart-axis" />
      <polyline points="${line(grossValues)}" class="chart-line chart-gross" fill="none" />
      <polyline points="${line(netValues)}" class="chart-line chart-net" fill="none" />
      ${dots}${labels}
    </svg>`;
}

function renderSellerStatusChart(counts) {
  const root = $('#seller-status-chart');
  if (!root) return;
  const keys = ['pending', 'completed', 'complained', 'returned'];
  const values = keys.map(k => Number(counts[k]) || 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) { root.innerHTML = `<div class="empty">${esc(t('seller.noOrders'))}</div>`; return; }
  const circumference = 2 * Math.PI * 70;
  let offset = 0;
  const segments = keys.map((k, i) => {
    const length = (values[i] / total) * circumference;
    const seg = `<circle class="status-seg seg-${i}" cx="90" cy="90" r="70" fill="none" stroke-width="18"
      stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 90 90)"><title>${esc(t(SELLER_STATUS_KEYS[k]))}: ${values[i]}</title></circle>`;
    offset += length;
    return seg;
  }).join('');
  const legend = keys.map((k, i) => `<div class="status-legend-row"><i class="legend-dot seg-${i}"></i>
    <span>${esc(t(SELLER_STATUS_KEYS[k]))}</span><b>${num(values[i])}</b></div>`).join('');
  root.innerHTML = `<div class="donut-wrap">
    <svg viewBox="0 0 180 180" class="donut-svg" role="img" aria-label="${esc(t('seller.statusTitle'))}">
      <circle cx="90" cy="90" r="70" fill="none" class="donut-track" stroke-width="18" />
      ${segments}
      <text x="90" y="88" text-anchor="middle" class="donut-total">${num(total)}</text>
      <text x="90" y="106" text-anchor="middle" class="donut-caption">${esc(t('orders.total'))}</text>
    </svg>
    <div class="status-legend">${legend}</div>
  </div>`;
}

function renderSellerRecentOrders(list) {
  const root = $('#seller-recent-orders');
  if (!root) return;
  if (!list.length) { root.innerHTML = `<div class="empty">${esc(t('seller.noOrders'))}</div>`; return; }
  const rows = list.map(o => `<tr>
    <td>#${esc(String(o.id || '').slice(0, 6))}</td>
    <td>${esc(o.itemName)}</td>
    <td>${esc(o.buyer)}</td>
    <td><b>${num(o.total)}</b> ${esc(t('topbar.coinShort'))}</td>
    <td><span class="pill ${esc(o.status)}">${esc(t(SELLER_STATUS_KEYS[o.status] || o.status))}</span></td>
  </tr>`).join('');
  root.innerHTML = `<table class="seller-table"><thead><tr>
    <th>ID</th><th>${esc(t('seller.productName'))}</th><th>${esc(t('seller.buyer'))}</th>
    <th>${esc(t('orders.total'))}</th><th>${esc(t('orders.status'))}</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSellerShops(shops) {
  const root = $('#seller-shops');
  const select = $('#seller-product-shop');
  const previous = select.value;
  select.innerHTML = shops.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if (previous && shops.some(s => s.id === previous)) select.value = previous;
  if (!shops.length) { root.innerHTML = `<div class="empty">${esc(t('seller.noShops'))}</div>`; return; }
  root.innerHTML = shops.map(s => `
    <div class="mini-row shop-row">
      <span>${s.logoUrl ? `<img class="shop-mini-logo" src="${esc(s.logoUrl)}" alt="" onerror="this.style.display='none'" />` : icon('store', 16)} <b>${esc(s.name)}</b></span>
      <span class="shop-row-actions">
        <button class="btn btn-ghost btn-sm" data-shop-products="${esc(s.id)}">${icon('eye', 13)}<span>${esc(t('seller.viewProducts'))}</span></button>
        <button class="btn btn-soft btn-sm" data-shop-edit="${esc(s.id)}">${icon('settings', 13)}<span>${esc(t('admin.edit'))}</span></button>
      </span>
    </div>`).join('');
  $$('[data-shop-products]', root).forEach(btn => btn.addEventListener('click', () => showSellerProducts(btn.dataset.shopProducts)));
  $$('[data-shop-edit]', root).forEach(btn => btn.addEventListener('click', () => {
    const shop = shops.find(s => s.id === btn.dataset.shopEdit);
    if (!shop) return;
    $('#seller-shop-id').value = shop.id;
    $('#seller-shop-name').value = shop.name || '';
    $('#seller-shop-desc').value = shop.description || '';
    $('#seller-shop-logo').value = shop.logoUrl || '';
    $('#seller-shop-bg').value = shop.backgroundUrl || '';
    labelButton($('#seller-shop-submit'), 'seller.saveShopBtn');
    labelButton($('#seller-shop-form-title'), 'seller.editShop');
    $('#seller-shop-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

async function showSellerProducts(shopId) {
  try {
    const data = await api(`/api/seller/shop/${encodeURIComponent(shopId)}/products`);
    const wrap = document.createElement('div');
    const products = data.products || [];
    wrap.innerHTML = products.length ? products.map(p => `
      <div class="mini-row"><span>${icon('package', 15)} ${esc(p.name)}</span><b>${esc(priceLabel(p.price, p.currency, p.priceText))}</b></div>`).join('')
      : `<div class="empty">${esc(t('seller.productEmpty'))}</div>`;
    openModal({
      title: t('seller.shopProducts', { name: (state.seller.data?.shops || []).find(s => s.id === shopId)?.name || '' }),
      body: wrap,
      actions: [{ label: t('shop.close'), className: 'btn-primary', onClick: closeModal }],
    });
  } catch (err) { toast(err.message, 'error'); }
}

$('#seller-shop-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#seller-shop-id').value;
  const shops = (state.seller.data && state.seller.data.shops) || [];
  if (!id && shops.length >= 3) { toast(t('seller.shopLimit'), 'error'); return; }
  const payload = {
    name: $('#seller-shop-name').value.trim(),
    description: $('#seller-shop-desc').value.trim(),
    logoUrl: $('#seller-shop-logo').value.trim(),
    backgroundUrl: $('#seller-shop-bg').value.trim(),
  };
  if (!payload.name) return;
  const btn = $('#seller-shop-submit');
  btn.disabled = true;
  try {
    await api(id ? `/api/seller/shop/${encodeURIComponent(id)}` : '/api/seller/shop', {
      method: 'POST', body: JSON.stringify(payload),
    });
    toast(t(id ? 'seller.shopUpdated' : 'seller.shopCreated'));
    e.target.reset();
    $('#seller-shop-id').value = '';
    labelButton($('#seller-shop-submit'), 'seller.createShopBtn');
    labelButton($('#seller-shop-form-title'), 'seller.createShop');
    loadSeller();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

$('#seller-product-accounts').addEventListener('input', updateSellerLinesCount);
$('#seller-product-maxlines').addEventListener('input', updateSellerLinesCount);

function updateSellerLinesCount() {
  const lines = $('#seller-product-accounts').value.split('\n').filter(x => x.trim()).length;
  const max = Math.min(2000, Math.max(1, Number($('#seller-product-maxlines').value) || 2000));
  setText('#seller-lines-count', t('seller.linesCount', { count: num(lines), max: num(max) }));
}

$('#seller-product-form').addEventListener('submit', async e => {
  e.preventDefault();
  const shopId = $('#seller-product-shop').value;
  const accountsText = $('#seller-product-accounts').value;
  const lines = accountsText.split('\n').filter(x => x.trim()).length;
  const maxLines = Math.min(2000, Math.max(1, Number($('#seller-product-maxlines').value) || 2000));
  if (!lines) { toast(t('seller.noAccounts'), 'error'); return; }
  if (lines > maxLines) { toast(t('seller.tooManyLines', { max: num(maxLines) }), 'error'); return; }
  const btn = $('#seller-product-submit');
  btn.disabled = true;
  try {
    await api(`/api/seller/shop/${encodeURIComponent(shopId)}/product`, {
      method: 'POST',
      body: JSON.stringify({
        name: $('#seller-product-name').value.trim(),
        description: $('#seller-product-desc').value.trim(),
        priceText: $('#seller-product-price').value.trim(),
        accountsText,
        maxLines,
      }),
    });
    toast(t('seller.productCreated'));
    $('#seller-product-name').value = '';
    $('#seller-product-desc').value = '';
    $('#seller-product-price').value = '';
    $('#seller-product-accounts').value = '';
    updateSellerLinesCount();
    loadSeller();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

// ==================== BUY DEVICE / TASKS / STATUS / GIFTS / LB / TRANSFER ====================
$('#cloud-provider').addEventListener('change', () => {
  $('#cloud-server-wrap').classList.toggle('hidden', $('#cloud-provider').value !== 'UG');
});

$('#cloud-buy-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const box = $('#cloud-result');
  try {
    const data = await api('/api/device/buycloud', {
      method: 'POST',
      body: JSON.stringify({ provider: $('#cloud-provider').value, server: $('#cloud-server').value, inputData: $('#cloud-input').value }),
    });
    box.className = 'result-box';
    setText(box, t('device.success', { provider: data.provider, message: data.message }));
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); }
  finally { box.classList.remove('hidden'); btn.disabled = false; }
});

$$('[data-reg]').forEach(btn => btn.addEventListener('click', async () => {
  const box = $('#reg-result');
  btn.disabled = true;
  try {
    const data = await api('/api/device/reg', { method: 'POST', body: JSON.stringify({ service: btn.dataset.reg }) });
    box.className = 'result-box';
    box.innerHTML = `
      <div>${esc(data.service.toUpperCase())} · ${esc(t('topbar.coinShort'))} 10 ${esc(t('common.yes'))}</div>
      <div class="accounts-box">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="reg-copy">${icon('copy', 14)}<span>${esc(t('shop.copyAll'))}</span></button></div>`;
    box.classList.remove('hidden');
    $('#reg-copy').addEventListener('click', ev => copyText(data.copyText, ev.currentTarget));
    await refreshUser();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
  finally { btn.disabled = false; }
}));

$$('[data-meows]').forEach(btn => btn.addEventListener('click', async () => {
  const provider = btn.dataset.meows;
  const box = $('#meows-result');
  const cost = provider === 'UG' ? 49 : 15;
  const name = provider === 'UG' ? 'UGPhone' : 'VSPhone VIP';
  if (!window.confirm(t('device.confirmQuick', { name, cost: num(cost) }))) return;
  btn.disabled = true;
  try {
    const data = await api('/api/device/meows', { method: 'POST', body: JSON.stringify({ provider }) });
    box.className = 'result-box';
    box.innerHTML = `
      <div>${esc(name)} · ${esc(t('device.newBalance', { amount: num(data.newBalance) }))}</div>
      ${data.account ? `<div>${esc(data.account)}</div>` : ''}
      ${data.password ? `<div>${esc(data.password)}</div>` : ''}
      <div class="accounts-box">${esc(data.copyText)}</div>
      <div class="copy-row"><button class="btn btn-soft btn-sm" id="meows-copy">${icon('copy', 14)}<span>${esc(t('shop.copyAll'))}</span></button></div>`;
    box.classList.remove('hidden');
    $('#meows-copy').addEventListener('click', ev => copyText(data.copyText, ev.currentTarget));
    await refreshUser();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
  finally { btn.disabled = false; }
}));

async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    const providers = data.providers || [];
    const daily = data.daily || {};
    const select = $('#task-provider');
    if (select) {
      const selected = select.value;
      if (providers.length) {
        select.innerHTML = providers.map(p => {
          const used = Number(p.used || daily[p.id] || 0);
          const label = `${p.name} — ${p.reward} xu (${used}/${p.dailyMax})`;
          return `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(label)}</option>`;
        }).join('');
      }
    }
    if (providers.length) {
      setText('#task-hint', providers.map(p => `${p.name}: ${p.reward} xu (${p.dailyMax}/day)`).join('. ') + '.');
    }
    const dailyBox = $('#task-daily');
    if (dailyBox) {
      dailyBox.innerHTML = providers.map(p => {
        const used = Number(p.used || daily[p.id] || 0);
        return `<span class="pill">${esc(p.name)}: ${used}/${p.dailyMax} · +${p.reward} xu</span>`;
      }).join('') + `<span class="pill">${esc(t('tasks.weekly', { count: num(data.weeklyCount) }))}</span>`;
    }
    const periodEl = $('#task-period') || $('.period-box[data-i18n="tasks.period"]');
    if (periodEl) {
      periodEl.id = 'task-period';
      periodEl.setAttribute('data-vars', JSON.stringify({ period: data.period || '—' }));
      if (typeof applyTranslations === 'function') applyTranslations(periodEl);
      else setText(periodEl, t('tasks.period', { period: data.period || '—' }));
    }
    const rewardList = $('#reward-list');
    if (rewardList) {
      const labels = Array.from({ length: 10 }, (_, i) => `Top ${i + 1}`);
      rewardList.innerHTML = (data.rewards || []).map((r, i) => `<li><span>${labels[i] || `#${i + 1}`}</span><b>+${num(r)} coin</b></li>`).join('');
    }
  } catch (err) { toast(err.message, 'error'); }
}

const taskGetBtn = $('#task-get-btn');
if (taskGetBtn) taskGetBtn.addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const box = $('#task-result');
  try {
    const select = $('#task-provider');
    const data = await api('/api/tasks/link', { method: 'POST', body: JSON.stringify({ provider: select ? select.value : 'link4m' }) });
    if (box) {
      box.className = 'result-box';
      box.innerHTML = `${icon('check', 15)} ${esc(t('tasks.created', { reward: num(data.reward), remaining: num(data.remaining) }))}<br>
        <a href="${esc(data.url)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">${esc(data.url)}</a>`;
      box.classList.remove('hidden');
    }
    loadTasks();
  } catch (err) {
    if (box) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
    else toast(err.message, 'error');
  }
  finally { btn.disabled = false; }
});

function startCloudStatusPolling() {
  if (cloudStatusTimer) return;
  cloudStatusTimer = setInterval(() => { if (state.view === 'cloudstatus') loadCloudStatus(true).catch(() => {}); }, 60000);
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
  el.innerHTML = icon(online ? 'dot-online' : 'dot-offline', 12) + `<span>${esc(t(online ? 'status.hasMachine' : 'status.noMachine'))}</span>`;
  const parts = [];
  if (device && device.message) parts.push(device.message);
  if (device && device.lastBuyAt) parts.push(t('status.lastBuy', { time: new Date(device.lastBuyAt).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'vi-VN') }));
  setText(msgSel, parts.join(' · '));
}

async function loadCloudStatus(force = false) {
  try {
    const data = await api(`/api/status/cloud${force ? '?force=1' : ''}`);
    const sourceLabel = { direct: '', www: 'www', proxy: 'proxy' }[data.source] || '';
    setText('#cloud-status-time', t('status.updated', { time: new Date(data.checkedAt).toLocaleTimeString(getLanguage() === 'en' ? 'en-US' : 'vi-VN') }) + (sourceLabel ? ` · ${sourceLabel}` : ''));
    setDeviceStatus('#status-meows-vmos', '#status-meows-vmos-msg', data.vmos);
    setDeviceStatus('#status-meows-vsphone', '#status-meows-vsphone-msg', data.vsphone);
    const errorBox = $('#cloud-status-errors');
    if (data.errors && data.errors.length) { setText(errorBox, data.errors.join(' · ')); errorBox.classList.remove('hidden'); }
    else errorBox.classList.add('hidden');
  } catch (err) { toast(err.message, 'error'); }
}

$('#cloud-status-refresh').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try { await loadCloudStatus(true); toast(t('status.refreshed')); }
  catch (err) { toast(err.message, 'error'); }
  finally { e.currentTarget.disabled = false; }
});

$('#giftcode-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const box = $('#giftcode-result');
  const code = $('#giftcode-input').value.trim();
  if (!code) { toast(t('giftcode.empty'), 'error'); return; }
  btn.disabled = true;
  try {
    const data = await api('/api/giftcode', { method: 'POST', body: JSON.stringify({ code }) });
    box.className = 'result-box';
    setText(box, t('giftcode.success', { code, amount: num(data.amount), balance: num(data.newBalance) }));
    $('#giftcode-input').value = '';
    await refreshUser();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); }
  finally { box.classList.remove('hidden'); btn.disabled = false; }
});

$$('[data-lb]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-lb]').forEach(x => x.classList.remove('active'));
  tab.classList.add('active');
  state.lbTab = tab.dataset.lb;
  loadLeaderboard();
}));

async function loadLeaderboard() {
  const root = $('#lb-list');
  const note = $('#lb-note');
  const banner = $('#lb-rewards');
  root.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
  note.classList.add('hidden');
  banner.classList.add('hidden');
  try {
    if (state.lbTab === 'coins') { const data = await api('/api/leaderboard/coins'); renderLb(root, data.leaderboard, t('lb.coins')); return; }
    if (state.lbTab === 'week') {
      const data = await api('/api/leaderboard/links/week');
      setText(note, t('tasks.weekPeriod', { period: data.period || '—' }));
      note.classList.remove('hidden');
      banner.innerHTML = (data.rewards || []).slice(0, 10).map((r, i) => `<span class="reward-chip">Top ${i + 1}: +${num(r)} coin</span>`).join('');
      if ((data.rewards || []).length) banner.classList.remove('hidden');
      renderLb(root, data.leaderboard, t('nav.tasks'));
      return;
    }
    const data = await api('/api/leaderboard/links/all');
    setText(note, t('tasks.allNote'));
    note.classList.remove('hidden');
    renderLb(root, data.leaderboard, t('nav.tasks'));
  } catch (err) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function renderLb(root, rows, unit) {
  if (!rows || !rows.length) { root.innerHTML = `<div class="empty">${esc(t('lb.empty'))}</div>`; return; }
  root.innerHTML = rows.map(r => `
    <div class="lb-row ${r.rank <= 3 ? `top${r.rank}` : ''}">
      <span class="lb-rank">${num(r.rank)}</span>
      <span class="lb-name">${esc(r.display)}</span>
      <span class="lb-value">${num(r.value)} ${esc(unit)}</span>
    </div>`).join('');
}

function updateFeePreview() {
  const amount = parseInt($('#transfer-amount').value, 10) || 0;
  const fee = Math.ceil(amount * 0.05);
  setText('#transfer-fee', amount >= 10
    ? t('transfer.preview', { amount: num(amount - fee), fee: num(fee) })
    : t('transfer.min'));
}
$('#transfer-amount').addEventListener('input', updateFeePreview);

$('#transfer-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const data = await api('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ to: $('#transfer-to').value, amount: parseInt($('#transfer-amount').value, 10) || 0 }),
    });
    toast(t('transfer.success', { to: data.to, balance: num(data.newBalance) }));
    $('#transfer-to').value = '';
    await refreshUser();
    loadTransfers();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

async function loadTransfers() {
  updateFeePreview();
  try {
    const data = await api('/api/transfers');
    const root = $('#transfer-history');
    root.innerHTML = data.transfers.length
      ? data.transfers.map(x => `
        <div class="mini-row">
          <span>${icon('transfer', 14)} ${esc(x.to_label)}</span>
          <span>${num(x.amount)} xu <small class="muted">(${esc(t('transfer.fee', { fee: num(x.fee) }))})</small></span>
        </div>`).join('')
      : `<div class="empty">${esc(t('transfer.empty'))}</div>`;
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== PROFILE ====================
$('#copy-token-btn').addEventListener('click', e => copyText(state.user?.linkToken || '', e.currentTarget));
$('#regen-token-btn').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try {
    const data = await api('/api/profile/token', { method: 'POST' });
    if (state.user) state.user.linkToken = data.linkToken;
    setText('#link-token', data.linkToken);
    toast(t('profile.regenerated'));
  } catch (err) { toast(err.message, 'error'); }
  finally { e.currentTarget.disabled = false; }
});
$('#pw-btn').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try {
    await api('/api/profile/password', {
      method: 'POST', body: JSON.stringify({ currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value }),
    });
    $('#pw-current').value = '';
    $('#pw-new').value = '';
    toast(t('profile.passwordSuccess'));
  } catch (err) { toast(err.message, 'error'); }
  finally { e.currentTarget.disabled = false; }
});

// ==================== ADMIN ====================
async function loadAdmin() {
  try {
    const data = await api('/api/admin/overview');
    const s = data.stats;
    $('#admin-stats').innerHTML = `
      <div class="card stat">${icon('users', 20)}<div><b>${num(s.users)}</b><small>${esc(t('admin.userCount', { count: num(s.linked) }))}</small></div></div>
      <div class="card stat">${icon('shop', 20)}<div><b>${num(s.items)}</b><small>${esc(t('admin.products'))}</small></div></div>
      <div class="card stat">${icon('orders', 20)}<div><b>${num(s.purchases)}</b><small>${esc(t('admin.orders'))}</small></div></div>
      <div class="card stat">${icon('coin', 20)}<div><b>${num(s.revenue)}</b><small>${esc(t('admin.coinSold', { source: s.gistEnabled ? 'Gist' : 'Local' }))}</small></div></div>`;
    $('#admin-purchases').innerHTML = data.recentPurchases.length
      ? data.recentPurchases.map(p => `<div class="mini-row"><span>${esc(p.itemName)} ×${p.quantity}</span><b>${num(p.totalPrice)} xu</b></div>`).join('')
      : `<div class="empty">${esc(t('admin.noOrders'))}</div>`;
    $('#admin-payouts').innerHTML = data.payouts.length
      ? data.payouts.map(p => `<div class="mini-row"><span>${esc(t('admin.period', { period: p.period }))}</span><b>${num(p.total)} coin</b></div>`).join('')
      : `<div class="empty">${esc(t('admin.noPayouts'))}</div>`;
    await Promise.all([loadAdminItems(), loadAdminUsers(), loadAdminPlugins(), loadMeowsCookie(), loadAdminBackground(), loadAdminSocial()]);
    if (state.adminTab === 'market') loadAdminMarket();
  } catch (err) { toast(err.message, 'error'); }
}

$$('.admin-tabs .tab').forEach(tab => tab.addEventListener('click', () => switchAdminTab(tab.dataset.admin)));

function switchAdminTab(tabName) {
  state.adminTab = tabName;
  $$('.admin-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.admin === tabName));
  $$('.admin-sub').forEach(el => el.classList.toggle('hidden', el.id !== `admin-sub-${tabName}`));
  if (tabName === 'shop') loadAdminItems();
  else if (tabName === 'user') loadAdminUsers().catch(() => {});
  else if (tabName === 'plugin') loadAdminPlugins();
  else if (tabName === 'meows') loadMeowsCookie();
  else if (tabName === 'market') loadAdminMarket();
  else if (tabName === 'appearance') { loadAdminBackground(); loadAdminSocial(); }
}

async function loadAdminItems() {
  const data = await api('/api/admin/items');
  const root = $('#admin-items');
  root.innerHTML = data.items.length ? data.items.map(item => `
    <div class="admin-item">
      ${/^https?:\/\//i.test(item.logoUrl) ? `<img src="${esc(item.logoUrl)}" alt="" onerror="this.style.display='none'" />` : `<span class="ico">${icon('package', 24)}</span>`}
      <div class="info">
        <b>${esc(item.name)} ${item.active ? '' : `<small class="muted">(${esc(t('admin.hide'))})</small>`}</b>
        <small>${num(item.price)} xu · ${esc(t('shop.stock', { count: num(item.stock) }))} · ${esc(item.category)}</small>
      </div>
      <div class="actions">
        <button class="btn btn-soft btn-sm" data-addstock="${esc(item.id)}">${icon('plus', 13)}<span>${esc(t('admin.addStock'))}</span></button>
        <button class="btn btn-ghost btn-sm" data-edititem="${esc(item.id)}">${icon('settings', 13)}<span>${esc(t('admin.edit'))}</span></button>
        <button class="btn btn-danger btn-sm" data-delitem="${esc(item.id)}">${icon('close', 13)}<span>${esc(t('admin.delete'))}</span></button>
      </div>
    </div>`).join('') : `<div class="empty">${esc(t('admin.noPending'))}</div>`;
  $$('[data-addstock]', root).forEach(b => b.addEventListener('click', () => addStockModal(b.dataset.addstock, data.items.find(i => i.id === b.dataset.addstock))));
  $$('[data-edititem]', root).forEach(b => b.addEventListener('click', () => editItemModal(data.items.find(i => i.id === b.dataset.edititem))));
  $$('[data-delitem]', root).forEach(b => b.addEventListener('click', () => deleteItem(b.dataset.delitem)));
}

async function loadAdminUsers() {
  const data = await api('/api/admin/users');
  $('#admin-users').innerHTML = data.users.length ? data.users.map(u => `
    <div class="mini-row">
      <span>${esc(u.username)} ${u.isAdmin ? icon('admin', 13) : ''} ${u.linked ? `<small class="muted">Discord ${icon('check', 12)}</small>` : ''}</span>
      <span><b>${num(u.balance)} xu</b> <button class="btn btn-ghost btn-sm" data-coins="${esc(u.username)}">${esc(t('admin.edit'))}</button></span>
    </div>`).join('') : `<div class="empty">${esc(t('admin.noPending'))}</div>`;
  $$('[data-coins]').forEach(b => b.addEventListener('click', () => coinsModal(b.dataset.coins)));
}

async function loadAdminExchangeRate() {
  try {
    const data = await api('/api/admin/exchange-rate');
    $('#admin-exchange-rate').value = data.coinPerAcoin || 5;
  } catch (err) { /* giữ giá trị mặc định nếu route chưa sẵn */ }
}

$('#admin-exchange-rate-save').addEventListener('click', async e => {
  const box = $('#admin-exchange-rate-result');
  const coinPerAcoin = Math.max(1, Number($('#admin-exchange-rate').value) || 5);
  e.currentTarget.disabled = true;
  try {
    const data = await api('/api/admin/exchange-rate', {
      method: 'POST', body: JSON.stringify({ coinPerAcoin }),
    });
    if (state.user) state.user.exchangeRate = data.coinPerAcoin;
    applyUser();
    box.className = 'result-box';
    setText(box, t('admin.rateSaved', { rate: num(data.coinPerAcoin) }));
    box.classList.remove('hidden');
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
  finally { e.currentTarget.disabled = false; }
});

async function loadAdminMarket() {
  loadAdminExchangeRate().catch(() => {});
  const sellersRoot = $('#admin-sellers');
  const reviewsRoot = $('#admin-reviews');
  const complaintsRoot = $('#admin-complaints');
  sellersRoot.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
  try {
    const data = await api('/api/admin/sellers');
    const sellers = data.sellers || [];
    sellersRoot.innerHTML = sellers.length ? sellers.map(s => `
      <div class="mini-row">
        <span>${icon('seller', 14)} ${esc(s.display || s.username || s.userId || s.id)} <span class="pill">${esc(statusLabel(s.status))}</span></span>
        ${s.status === 'pending' ? `<button class="btn btn-soft btn-sm" data-approve-seller="${esc(s.id || s.userId || s.discordId)}">${icon('check', 13)}<span>${esc(t('admin.approve'))}</span></button>` : ''}
      </div>`).join('') : `<div class="empty">${esc(t('admin.noPending'))}</div>`;
    $$('[data-approve-seller]', sellersRoot).forEach(btn => btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/sellers/${encodeURIComponent(btn.dataset.approveSeller)}/approve`, { method: 'POST' });
        toast(t('admin.approved'));
        loadAdminMarket();
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { sellersRoot.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }

  reviewsRoot.innerHTML = state.adminReviews.length ? state.adminReviews.map(r => `
    <div class="mini-row">
      <span>${icon('star', 13)} ${esc(r.buyer || r.content || r.id)}</span>
      <span><button class="btn btn-soft btn-sm" data-admin-review="${esc(r.id)}" data-approve="1">${icon('check', 13)}</button>
      <button class="btn btn-danger btn-sm" data-admin-review="${esc(r.id)}" data-approve="0">${icon('close', 13)}</button></span>
    </div>`).join('') : `<div class="empty">${esc(t('admin.noPending'))}</div>`;
  $$('[data-admin-review]', reviewsRoot).forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/admin/reviews/${encodeURIComponent(btn.dataset.adminReview)}/decision`, {
        method: 'POST', body: JSON.stringify({ approve: btn.dataset.approve === '1' }),
      });
      state.adminReviews = state.adminReviews.filter(r => r.id !== btn.dataset.adminReview);
      toast(t('admin.approved'));
      loadAdminMarket();
    } catch (err) { toast(err.message, 'error'); }
  }));
  complaintsRoot.innerHTML = `<div class="empty">${esc(t('admin.noPending'))}</div>`;
}

async function loadAdminBackground() {
  const data = await api('/api/admin/background');
  $('#admin-background-url').value = data.url || '';
  const preview = $('#admin-background-preview');
  preview.style.backgroundImage = data.url ? `url("${data.url.replace(/"/g, '%22')}")` : 'none';
  preview.title = data.url || '';
}

async function loadAdminSocial() {
  const data = await api('/api/admin/social-links');
  $('#admin-youtube-url').value = data.youtubeUrl === data.defaultYoutubeUrl ? '' : data.youtubeUrl;
  $('#admin-discord-url').value = data.discordUrl === data.defaultDiscordUrl ? '' : data.discordUrl;
  $('#admin-youtube-url').placeholder = data.defaultYoutubeUrl;
  $('#admin-discord-url').placeholder = data.defaultDiscordUrl;
}

function applySocialLinks(youtubeUrl, discordUrl) {
  if (!state.user) return;
  state.user.youtubeUrl = youtubeUrl;
  state.user.discordUrl = discordUrl;
  applyUser(state.user);
}

$('#admin-social-save-btn').addEventListener('click', async () => {
  const box = $('#admin-social-result');
  try {
    const youtubeUrl = $('#admin-youtube-url').value.trim();
    const discordUrl = $('#admin-discord-url').value.trim();
    const data = await api('/api/admin/social-links', { method: 'POST', body: JSON.stringify({ youtubeUrl, discordUrl }) });
    applySocialLinks(data.youtubeUrl, data.discordUrl);
    await loadAdminSocial();
    box.className = 'result-box';
    setText(box, t('admin.socialSaved'));
    box.classList.remove('hidden');
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
});

$('#admin-social-default-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/social-links', { method: 'DELETE' });
    applySocialLinks(data.youtubeUrl, data.discordUrl);
    await loadAdminSocial();
    toast(t('admin.socialDefault'));
  } catch (err) { toast(err.message, 'error'); }
});

$('#admin-background-save-btn').addEventListener('click', async () => {
  const box = $('#admin-background-result');
  try {
    const url = $('#admin-background-url').value.trim();
    const data = await api('/api/admin/background', { method: 'POST', body: JSON.stringify({ url }) });
    applyBackground(data.url);
    await loadAdminBackground();
    box.className = 'result-box';
    setText(box, t('admin.backgroundSaved'));
    box.classList.remove('hidden');
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
});

$('#admin-background-default-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/background', { method: 'DELETE' });
    applyBackground(data.url);
    await loadAdminBackground();
    toast(t('admin.backgroundDefault'));
  } catch (err) { toast(err.message, 'error'); }
});

async function loadMeowsCookie() {
  const data = await api('/api/admin/meows/cookie');
  $('#admin-meows-cookie').value = data.cookie || '';
  const status = $('#meows-status');
  setText(status, data.configured ? t('admin.savedCookie') : t('admin.noCookie'));
  status.title = data.updatedAt ? `${t('status.updated')} ${data.updatedAt}` : '';
  await loadStatusProxy();
}

async function loadStatusProxy() {
  const data = await api('/api/admin/status-proxy');
  $('#admin-status-proxy').value = data.proxy || '';
  const pill = $('#status-proxy-source');
  const active = data.envProxy || data.proxy;
  setText(pill, active ? active : t('admin.noProxy'));
}

$('#admin-meows-save-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const box = $('#admin-meows-result');
  btn.disabled = true;
  try {
    await api('/api/admin/meows/cookie', { method: 'POST', body: JSON.stringify({ cookie: $('#admin-meows-cookie').value }) });
    box.className = 'result-box';
    setText(box, t('admin.cookieSaved'));
    box.classList.remove('hidden');
    await loadMeowsCookie();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
  finally { btn.disabled = false; }
});

$('#admin-meows-clear-btn').addEventListener('click', async e => {
  if (!window.confirm(t('admin.cookieConfirm'))) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await api('/api/admin/meows/cookie', { method: 'DELETE' }); toast(t('admin.cookieCleared')); await loadMeowsCookie(); }
  catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

$('#admin-status-proxy-save-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const box = $('#admin-status-proxy-result');
  btn.disabled = true;
  try {
    await api('/api/admin/status-proxy', { method: 'POST', body: JSON.stringify({ proxy: $('#admin-status-proxy').value }) });
    box.className = 'result-box';
    setText(box, t('admin.proxySaved'));
    box.classList.remove('hidden');
    await loadStatusProxy();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); box.classList.remove('hidden'); }
  finally { btn.disabled = false; }
});

$('#admin-status-proxy-clear-btn').addEventListener('click', async e => {
  if (!window.confirm(t('admin.proxyConfirm'))) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await api('/api/admin/status-proxy', { method: 'DELETE' }); toast(t('admin.proxyCleared')); await loadStatusProxy(); }
  catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

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
          <b>${esc(p.name)} ${p.enabled ? '' : `<small class="muted">(${esc(t('admin.pluginOffLabel'))})</small>`}</b>
          <div class="plugin-meta">
            ID: <code>${esc(p.id)}</code><br/>
            ${p.gistUrl ? `<a href="${esc(p.gistUrl)}" target="_blank" rel="noopener">Gist</a> · ` : ''}${esc(t('admin.pluginUrl'))}: ${esc(p.sourceUrl || '—')}<br/>
            Routes: ${esc(routes)}<br/>
            Discord commands: ${esc(cmds)}<br/>
            ${esc(t('admin.pluginLastLoaded'))}: ${esc(p.lastLoadedAt || '—')}
          </div>
          ${p.error ? `<div class="plugin-error">${icon('warning', 13)} ${esc(p.error)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn btn-soft btn-sm" data-plugin-reload="${esc(p.id)}">${icon('refresh', 13)}<span>${esc(t('admin.pluginReload'))}</span></button>
          <button class="btn btn-ghost btn-sm" data-plugin-source="${esc(p.id)}">${icon('link', 13)}<span>${esc(t('admin.pluginSource'))}</span></button>
          <button class="btn btn-ghost btn-sm" data-plugin-toggle="${esc(p.id)}">${esc(t(p.enabled ? 'admin.pluginOff' : 'admin.pluginOn'))}</button>
          <button class="btn btn-danger btn-sm" data-plugin-del="${esc(p.id)}">${icon('close', 13)}<span>${esc(t('admin.delete'))}</span></button>
        </div>
      </div>`;
  }).join('') : `<div class="empty">${esc(t('admin.pluginEmpty'))}</div>`;

  $$('[data-plugin-reload]', root).forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await api(`/api/admin/plugins/${encodeURIComponent(b.dataset.pluginReload)}/reload`, { method: 'POST' });
      toast(t('admin.pluginReloaded', { routes: num((res.runtime.routes || []).length), commands: num((res.runtime.commands || []).length) }));
      loadAdminPlugins();
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  }));

  $$('[data-plugin-source]', root).forEach(b => b.addEventListener('click', () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginSource);
    if (!plugin) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>${esc(t('admin.pluginUrl'))}<input id="plugin-source-url" value="${esc(plugin.sourceUrl)}" /></label>
      <p class="muted">${esc(t('admin.pluginSourceDesc'))}</p>`;
    openModal({
      title: t('admin.pluginSourceTitle', { name: plugin.name }),
      body: wrap,
      actions: [
        { label: t('auth.cancel'), onClick: closeModal },
        {
          label: t('admin.pluginSaveReload'), className: 'btn-primary', onClick: async btn => {
            btn.disabled = true;
            try {
              await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}/source`, {
                method: 'POST', body: JSON.stringify({ url: wrap.querySelector('#plugin-source-url').value.trim() }),
              });
              closeModal();
              toast(t('admin.pluginSourceSaved'));
              loadAdminPlugins();
            } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
          },
        },
      ],
    });
  }));

  $$('[data-plugin-toggle]', root).forEach(b => b.addEventListener('click', async () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginToggle);
    if (!plugin) return;
    b.disabled = true;
    try {
      await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !plugin.enabled }) });
      toast(t(plugin.enabled ? 'admin.pluginDisabled' : 'admin.pluginEnabled'));
      loadAdminPlugins();
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  }));

  $$('[data-plugin-del]', root).forEach(b => b.addEventListener('click', () => {
    const plugin = state.plugins.find(p => p.id === b.dataset.pluginDel);
    if (!plugin) return;
    openModal({
      title: t('admin.pluginDelete', { name: plugin.name }),
      body: `<p class="muted">${esc(t('admin.pluginDeleteDesc'))}</p>`,
      actions: [
        { label: t('auth.cancel'), onClick: closeModal },
        {
          label: t('admin.delete'), className: 'btn-danger', onClick: async btn => {
            btn.disabled = true;
            try {
              await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, { method: 'DELETE' });
              closeModal(); toast(t('admin.deleted')); loadAdminPlugins();
            } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
          },
        },
      ],
    });
  }));
}

$('#admin-plugin-create-btn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const box = $('#admin-plugin-result');
  btn.disabled = true;
  try {
    const data = await api('/api/admin/plugins', {
      method: 'POST', body: JSON.stringify({ name: $('#admin-plugin-name').value.trim(), url: $('#admin-plugin-url').value.trim() }),
    });
    box.className = 'result-box';
    setText(box, t('admin.pluginInstalled', { name: data.plugin.name }));
    $('#admin-plugin-name').value = '';
    $('#admin-plugin-url').value = '';
    loadAdminPlugins();
  } catch (err) { box.className = 'result-box error'; setText(box, err.message); }
  finally { box.classList.remove('hidden'); btn.disabled = false; }
});

$('#admin-plugin-refresh').addEventListener('click', () => loadAdminPlugins().catch(err => toast(err.message, 'error')));

$('#admin-create-btn').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try {
    await api('/api/admin/items', {
      method: 'POST', body: JSON.stringify({
        name: $('#admin-item-name').value,
        price: parseInt($('#admin-item-price').value, 10) || 0,
        logoUrl: $('#admin-item-logo').value,
        category: $('#admin-item-category').value,
        description: $('#admin-item-desc').value,
        accounts: $('#admin-item-accounts').value,
      }),
    });
    toast(t('admin.createUpload'));
    ['#admin-item-name', '#admin-item-logo', '#admin-item-desc', '#admin-item-accounts'].forEach(s => { $(s).value = ''; });
    loadAdmin();
  } catch (err) { toast(err.message, 'error'); }
  finally { e.currentTarget.disabled = false; }
});

$('#admin-refresh').addEventListener('click', loadAdminItems);
$('#admin-payout-btn').addEventListener('click', async e => {
  e.currentTarget.disabled = true;
  try {
    const data = await api('/api/admin/payout', { method: 'POST' });
    toast(t('admin.payoutDone', { count: num(data.result.details ? data.result.details.length : 0) }));
    loadAdmin();
  } catch (err) { toast(err.message, 'error'); }
  finally { e.currentTarget.disabled = false; }
});

function addStockModal(itemId, item) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">${esc(t('admin.stockDesc', { name: item ? item.name : '' }))}</p>
    <textarea id="addstock-text" rows="6" placeholder="mail|pass"></textarea>`;
  openModal({
    title: t('admin.stockTitle'),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('admin.add'), className: 'btn-primary', onClick: async btn => {
          btn.disabled = true;
          try {
            await api(`/api/admin/items/${itemId}/stock`, { method: 'POST', body: JSON.stringify({ accounts: wrap.querySelector('#addstock-text').value }) });
            closeModal(); toast(t('admin.stockAdded')); loadAdminItems();
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
    <label>${esc(t('common.name'))}<input id="edit-name" value="${esc(item.name)}" /></label>
    <label>${esc(t('admin.priceCoin'))}<input id="edit-price" type="number" min="1" value="${item.price}" /></label>
    <label>${esc(t('admin.logo'))}<input id="edit-logo" value="${esc(item.logoUrl)}" /></label>
    <label>${esc(t('admin.description'))}<input id="edit-desc" value="${esc(item.description)}" /></label>
    <label>${esc(t('admin.visible'))}<select id="edit-active"><option value="1" ${item.active ? 'selected' : ''}>${esc(t('admin.show'))}</option><option value="0" ${!item.active ? 'selected' : ''}>${esc(t('admin.hidden'))}</option></select></label>`;
  openModal({
    title: t('admin.editProduct'),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('admin.save'), className: 'btn-primary', onClick: async btn => {
          btn.disabled = true;
          try {
            await api(`/api/admin/items/${item.id}`, {
              method: 'PATCH', body: JSON.stringify({
                name: wrap.querySelector('#edit-name').value,
                price: parseInt(wrap.querySelector('#edit-price').value, 10) || 0,
                logoUrl: wrap.querySelector('#edit-logo').value,
                description: wrap.querySelector('#edit-desc').value,
                active: wrap.querySelector('#edit-active').value === '1',
              }),
            });
            closeModal(); toast(t('admin.saved')); loadAdminItems();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function deleteItem(id) {
  openModal({
    title: t('admin.deleteProduct'),
    body: `<p class="muted">${esc(t('admin.deleteProductDesc'))}</p>`,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('admin.delete'), className: 'btn-danger', onClick: async btn => {
          btn.disabled = true;
          try { await api(`/api/admin/items/${id}`, { method: 'DELETE' }); closeModal(); toast(t('admin.deleted')); loadAdminItems(); }
          catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

function coinsModal(target) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label>${esc(t('admin.action'))}<select id="coins-action">
      <option value="cong">${esc(t('admin.coinAdd'))}</option>
      <option value="tru">${esc(t('admin.coinSub'))}</option>
      <option value="set">${esc(t('admin.coinSet'))}</option>
    </select></label>
    <label>${esc(t('transfer.amount'))}<input id="coins-amount" type="number" min="0" value="100" /></label>`;
  openModal({
    title: t('admin.coins', { target }),
    body: wrap,
    actions: [
      { label: t('auth.cancel'), onClick: closeModal },
      {
        label: t('admin.apply'), className: 'btn-primary', onClick: async btn => {
          btn.disabled = true;
          try {
            const data = await api('/api/admin/coins', {
              method: 'POST', body: JSON.stringify({
                target,
                action: wrap.querySelector('#coins-action').value,
                amount: parseInt(wrap.querySelector('#coins-amount').value, 10) || 0,
              }),
            });
            closeModal();
            toast(t('profile.coinUnit', { amount: num(data.newBalance) }));
            loadAdmin();
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      },
    ],
  });
}

// ==================== CHAT ====================
$('#chat-toggle').addEventListener('click', e => { e.stopPropagation(); closeAvatarMenu(); toggleChatPanel(); });
$('#chat-close').addEventListener('click', closeChatPanel);
$('#chat-back').addEventListener('click', () => {
  state.chat.with = null;
  $('#chat-conversation-view').classList.add('hidden');
  $('#chat-contacts-view').classList.remove('hidden');
  renderChatContacts();
});
$('#chat-contact-search').addEventListener('input', renderChatContacts);
$('#chat-form').addEventListener('submit', e => { e.preventDefault(); sendChatMessage(); });

function toggleChatPanel() { if (state.chat.open) closeChatPanel(); else openChatPanel(); }

function openChatPanel() {
  state.chat.open = true;
  $('#chat-panel').classList.remove('hidden');
  loadChatContacts();
  startChatPolling();
  setTimeout(() => $('#chat-input').focus(), 50);
}

function closeChatPanel() {
  state.chat.open = false;
  $('#chat-panel').classList.add('hidden');
  stopChatPolling();
}

function startChatPolling() {
  if (state.chat.poll) return;
  state.chat.poll = setInterval(() => {
    if (!state.chat.open || !state.user) return;
    loadChatContacts(true);
    if (state.chat.with) loadChatMessages(true);
  }, 10000);
}

function stopChatPolling() {
  if (!state.chat.poll) return;
  clearInterval(state.chat.poll);
  state.chat.poll = null;
}

async function loadChatContacts(silent = false) {
  try {
    const data = await api('/api/messages/contacts');
    state.chat.contacts = data.contacts || [];
    const sum = state.chat.contacts.reduce((n, c) => n + Number(c.unread || 0), 0);
    const count = state.chat.contacts.length ? sum : (state.user && state.user.unreadMessages) || 0;
    setUnreadCount(count);
    renderChatContacts();
  } catch (err) { if (!silent) toast(err.message, 'error'); }
}

function renderChatContacts() {
  const root = $('#chat-contacts');
  if (!root) return;
  const q = ($('#chat-contact-search').value || '').toLowerCase();
  const list = state.chat.contacts.filter(c => String(c.display || c.userId).toLowerCase().includes(q));
  if (!list.length) { root.innerHTML = `<div class="empty">${esc(t('chat.noContacts'))}</div>`; return; }
  root.innerHTML = list.map(c => `
    <button class="chat-contact${state.chat.with === c.userId ? ' active' : ''}" data-chat-user="${esc(c.userId)}" type="button">
      <span class="chat-avatar">${icon('user', 18)}</span>
      <span class="chat-contact-info">
        <b>${esc(c.display || c.userId)}</b>
        <small>${esc(c.lastMessage || '')}</small>
      </span>
      ${Number(c.unread) > 0 ? `<span class="contact-unread">${num(c.unread)}</span>` : ''}
    </button>`).join('');
  $$('[data-chat-user]', root).forEach(btn => btn.addEventListener('click', () => {
    const c = list.find(x => x.userId === btn.dataset.chatUser);
    openChatWith(c.userId, c.display || c.userId);
  }));
}

function openChatWith(userId, display) {
  if (!userId) { toast(t('chat.noContacts'), 'error'); return; }
  state.chat.with = userId;
  state.chat.display = display || userId;
  setText('#chat-with-label', state.chat.display);
  $('#chat-contacts-view').classList.add('hidden');
  $('#chat-conversation-view').classList.remove('hidden');
  openChatPanel();
  loadChatMessages();
}

async function loadChatMessages(silent = false) {
  if (!state.chat.with) return;
  const root = $('#chat-messages');
  root.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
  try {
    const data = await api(`/api/messages?with=${encodeURIComponent(state.chat.with)}`);
    state.chat.messages = data.messages || [];
    renderChatMessages();
    root.scrollTop = root.scrollHeight;
  } catch (err) { if (!silent) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; toast(err.message, 'error'); } }
}

function isOwnMessage(msg) {
  const me = state.user || {};
  return [me.id, me.userId, me.username, me.discordId].some(v => v != null && String(v) === String(msg.from));
}

function renderChatMessages() {
  const root = $('#chat-messages');
  if (!root) return;
  if (!state.chat.messages.length) { root.innerHTML = `<div class="empty">${esc(t('chat.empty'))}</div>`; return; }
  root.innerHTML = state.chat.messages.map(m => `
    <div class="chat-bubble${isOwnMessage(m) ? ' own' : ''}">
      <div>${esc(m.content)}</div>
      <small>${m.createdAt ? new Date(m.createdAt).toLocaleTimeString(getLanguage() === 'en' ? 'en-US' : 'vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}</small>
    </div>`).join('');
  root.scrollTop = root.scrollHeight;
}

async function sendChatMessage() {
  const input = $('#chat-input');
  const content = input.value.trim();
  if (!content || !state.chat.with) { toast(t('chat.emptyMessage'), 'error'); return; }
  const btn = $('#chat-send');
  btn.disabled = true;
  try {
    const data = await api('/api/messages', { method: 'POST', body: JSON.stringify({ to: state.chat.with, content }) });
    // Badge chỉ giảm khi thực sự gửi tin nhắn, không giảm khi chỉ mở xem.
    const contact = state.chat.contacts.find(c => c.userId === state.chat.with);
    const cleared = Number(contact?.unread || 0);
    if (contact) {
      contact.unread = 0;
      contact.lastMessage = content;
      contact.updatedAt = new Date().toISOString();
    }
    setUnreadCount(Math.max(0, state.chat.unread - cleared));
    input.value = '';
    if (data.message) state.chat.messages.push(data.message);
    else state.chat.messages.push({ id: `local-${Date.now()}`, from: state.user.id, to: state.chat.with, content, createdAt: new Date().toISOString() });
    renderChatMessages();
    renderChatContacts();
  } catch (err) { toast(err.message || t('chat.sendFailed'), 'error'); }
  finally { btn.disabled = false; input.focus(); }
}

// ==================== INIT ====================
(async function init() {
  renderIcons(document);
  renderProviderLogos(document);
  updateLanguageChrome();
  updateSellerLinesCount();
  try {
    const data = await api('/api/me');
    const user = data.user || data;
    if (user) {
      await enterApp(user);
      const hash = location.hash.replace('#', '');
      if (VIEW_TITLE_KEYS[hash]) switchView(hash);
    } else showAuth();
  } catch (e) { showAuth(); }
})();

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (VIEW_TITLE_KEYS[hash] && state.user) switchView(hash);
});
