/* Bussmann CRM – Frontend (ohne Build-Schritt, reines JavaScript) */
'use strict';

// ======================= Hilfsfunktionen =======================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => fmtISO(new Date());
const nowLocal = () => { const d = new Date(); return `${fmtISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const parseISO = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return fmtISO(d); };
const deDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const deDateTime = (s) => (s ? `${deDate(s)}, ${s.slice(11, 16)} Uhr` : '');
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function relDay(s) {
  const t = todayISO();
  if (s === t) return 'Heute';
  if (s === addDays(t, 1)) return 'Morgen';
  if (s === addDays(t, -1)) return 'Gestern';
  const d = parseISO(s);
  return `${WD[d.getDay()]}, ${deDate(s)}`;
}
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const custName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || '–';
const taskCust = (t) => (t.customer_id ? [t.c_first, t.c_last].filter(Boolean).join(' ') + (t.c_company ? ` (${t.c_company})` : '') : '');
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const telHref = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

const TYPES = ['Kommune', 'Privat', 'Landwirt', 'Forst', 'Gewerbe'];
const INTERVALS = { '': 'Kein Intervall', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfyearly: 'Halbjährlich', yearly: 'Jährlich' };
const TASK_KINDS = { anruf: 'Anruf', termin: 'Termin', besuch: 'Besuch', angebot: 'Angebot', aufgabe: 'Aufgabe' };
const ENTRY_KINDS = { besuch: 'Besuch', telefonat: 'Telefonat', email: 'E-Mail', termin: 'Termin', notiz: 'Notiz', sonstiges: 'Sonstiges' };

// Icons (Linien-Icons, 24er Raster)
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  tasks: '<rect x="3.5" y="4" width="17" height="17" rx="2.5"/><path d="m8 12 3 3 5-6"/><path d="M8 2.5v3M16 2.5v3"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 6.5 9 6.5 9-6.5"/>',
  phone: '<path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mobile: '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M11 18.5h2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  cake: '<path d="M4 21v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M4 16c2 0 2 1.5 4 1.5S10 16 12 16s2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 21h20M12 11V7"/><path d="M12 7c-1 0-1.5-.8-1.5-1.6S12 3 12 3s1.5 1.6 1.5 2.4S13 7 12 7z"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/><path d="M5 12h14"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  offer: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9.5 15.5c.5.6 1.2 1 2.2 1 1.3 0 2.1-.7 2.1-1.6 0-2-4.2-1.2-4.2-3.3 0-.9.8-1.6 2-1.6.9 0 1.6.4 2 1M12 9v1M12 16.5v1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`;
const ENTRY_ICON = { besuch: 'car', telefonat: 'phone', email: 'mail', termin: 'cal', notiz: 'note', sonstiges: 'dot', system: 'info' };
const TASK_ICON = { anruf: 'phone', termin: 'cal', besuch: 'car', angebot: 'offer', aufgabe: 'tasks' };

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    if (opts.raw) { o.body = opts.body; Object.assign(o.headers, opts.headers || {}); }
    else { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch('/api' + path, o);
  if (res.status === 401 && !opts.allow401) { state.me = null; renderLogin(); throw new Error('Bitte anmelden'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), err ? 5000 : 2600);
}
const fail = (e) => toast(e.message || String(e), true);

const openModals = new Set();
function modal({ title, body, foot = '', wide = false, onClose }) {
  const root = $('#modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon" data-close title="Schließen">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(bg);
  const close = () => { if (!bg.isConnected) return; bg.remove(); document.removeEventListener('keydown', onKey); openModals.delete(close); onClose && onClose(); };
  openModals.add(close);
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === bg) close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.dataset.down = '1'; });
  bg.addEventListener('mouseup', (e) => { if (e.target === bg && bg.dataset.down) close(); delete bg.dataset.down; });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  const first = $('input:not([type=checkbox]):not([type=hidden]), textarea, select', bg);
  if (first && window.innerWidth > 860) setTimeout(() => first.focus(), 30);
  return { el: bg, close };
}
function confirmBox(text, okLabel = 'Löschen') {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({ title: 'Bitte bestätigen', body: `<p>${text}</p>`, foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="cb-ok">${okLabel}</button>`, onClose: () => resolve(ok) });
    $('#cb-ok', m.el).onclick = () => { ok = true; m.close(); };
  });
}
const formData = (form) => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value;
  }
  return o;
};
const userOptions = (selected, { empty } = {}) => (empty ? `<option value="">${empty}</option>` : '') +
  state.users.filter((u) => u.active || u.id === Number(selected)).map((u) => `<option value="${u.id}" ${Number(selected) === u.id ? 'selected' : ''}>${esc(u.name)}${u.id === state.me.id ? ' (ich)' : ''}</option>`).join('');
const userColor = (id) => state.users.find((u) => u.id === id)?.color || '#6a6d6e';
const avatar = (name, id, cls = '') => `<span class="avatar ${cls}" style="background:${esc(userColor(id))}" title="${esc(name || '')}">${esc(initials(name))}</span>`;

// ======================= Bilder & Dateien an Aufgaben =======================
/** Große Fotos (z. B. vom Handy) vor dem Hochladen auf max. 2000 px verkleinern. */
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6 || !window.createImageBitmap) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
async function uploadTaskFiles(taskId, files) {
  let n = 0;
  for (const f of files) {
    const file = await shrinkImage(f);
    try {
      await api(`/tasks/${taskId}/files`, { method: 'POST', raw: true, body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } });
      n++;
    } catch (e) { fail(e); }
  }
  return n;
}
const isImg = (f) => /^image\//.test(f.mime || '');
const fileInputHtml = (attrs = '') => `<label class="btn sm">${icon('upload')} Bilder / Dateien<input type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple hidden ${attrs}></label>`;
function pickedList(input, out) {
  input.addEventListener('change', () => { out.textContent = input.files.length ? `${input.files.length} Datei${input.files.length > 1 ? 'en' : ''} ausgewählt: ${[...input.files].map((f) => f.name).join(', ')}` : ''; });
}
function showImage(f, list) {
  const imgs = list.filter(isImg); let i = imgs.findIndex((x) => x.id === f.id);
  const m = modal({ title: esc(f.filename), wide: true, body: `<div style="text-align:center"><img id="lb-img" src="/api/task-files/${f.id}" style="max-width:100%;max-height:75vh;border-radius:6px" alt=""></div>`,
    foot: `<span class="left">${imgs.length > 1 ? `<button class="btn" id="lb-prev">${icon('left')}</button><button class="btn" id="lb-next">${icon('right')}</button>` : ''}</span><a class="btn" id="lb-dl" href="/api/task-files/${f.id}?download=1">${icon('download')} Herunterladen</a>` });
  const show = () => { const x = imgs[i]; $('#lb-img', m.el).src = `/api/task-files/${x.id}`; $('.modal-head h2', m.el).textContent = x.filename; $('#lb-dl', m.el).href = `/api/task-files/${x.id}?download=1`; };
  if (imgs.length > 1) { $('#lb-prev', m.el).onclick = () => { i = (i - 1 + imgs.length) % imgs.length; show(); }; $('#lb-next', m.el).onclick = () => { i = (i + 1) % imgs.length; show(); }; }
}

// ======================= Zustand & Router =======================
const state = { me: null, users: [], mailEnabled: false, unread: 0, dashScope: localStorage.getItem('dashScope') || 'mine', dashWeek: null };

function route() {
  if (!state.me) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [p0, p1] = hash.split('/');
  $$('.nav a, .mobile-nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === (p0 || 'start')));
  [...openModals].forEach((c) => c());
  const main = $('#main');
  main.innerHTML = '<div class="empty">Lädt …</div>';
  window.scrollTo(0, 0);
  const views = { '': viewDashboard, start: viewDashboard, kunden: p1 ? () => viewCustomer(Number(p1)) : viewCustomers, aufgaben: viewTasks, kalender: viewCalendar, einstellungen: viewSettings };
  (views[p0] || viewDashboard)(main).catch(fail);
  if (p0 === 'aufgaben' && p1) openTask(Number(p1));
}
window.addEventListener('hashchange', route);

async function boot() {
  try {
    const me = await api('/me', { allow401: true });
    state.me = me.user; state.mailEnabled = me.mailEnabled; state.unread = me.unread;
    state.users = await api('/users');
    renderShell();
    route();
    setInterval(refreshUnread, 60000);
  } catch {
    const s = await fetch('/api/setup').then((r) => r.json()).catch(() => ({}));
    s.needsSetup ? renderSetup() : renderLogin();
  }
}

async function refreshUnread() {
  try { const me = await api('/me'); state.unread = me.unread; const b = $('#bell-badge'); if (b) { b.textContent = me.unread; b.classList.toggle('hidden', !me.unread); } } catch { /* offline */ }
}

// ======================= Login / Einrichtung =======================
function renderLogin() {
  $('#modal-root').innerHTML = '';
  $('#app').innerHTML = `<div class="login"><div class="box">
    <div class="logo"><img src="img/logo.png" alt="Bussmann Land- & Gartentechnik"><div class="slogan">Kundenverwaltung</div></div>
    <form class="card" id="login-form"><div class="card-body">
      <h2>Anmelden</h2>
      <div class="field"><label>E-Mail</label><input type="email" name="email" autocomplete="username" required></div>
      <div class="field"><label>Passwort</label><input type="password" name="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit">Anmelden</button>
    </div></form></div></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/login', { method: 'POST', body: formData(e.target), allow401: true }); boot(); } catch (err) { fail(err); }
  };
  $('#login-form input').focus();
}
function renderSetup() {
  $('#app').innerHTML = `<div class="login"><div class="box">
    <div class="logo"><img src="img/logo.png" alt="Bussmann Land- & Gartentechnik"><div class="slogan">Ersteinrichtung</div></div>
    <form class="card" id="setup-form"><div class="card-body">
      <h2>Administrator anlegen</h2>
      <p class="muted small" style="margin:0">Dies ist der erste Zugang. Weitere Kollegen legen Sie danach unter Einstellungen an.</p>
      <div class="field"><label>Name</label><input type="text" name="name" required></div>
      <div class="field"><label>E-Mail</label><input type="email" name="email" required></div>
      <div class="field"><label>Passwort (mind. 8 Zeichen)</label><input type="password" name="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Einrichten</button>
    </div></form></div></div>`;
  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/setup', { method: 'POST', body: formData(e.target) }); location.hash = ''; boot(); } catch (err) { fail(err); }
  };
}

// ======================= Grundgerüst =======================
function renderShell() {
  const nav = [['start', 'home', 'Übersicht'], ['kunden', 'users', 'Kunden'], ['aufgaben', 'tasks', 'Aufgaben'], ['kalender', 'cal', 'Kalender'], ['einstellungen', 'gear', 'Einstellungen']];
  $('#app').innerHTML = `<div class="shell">
    <header class="topbar">
      <a class="brand" href="#/"><img src="img/logo.png" alt="Bussmann Land- & Gartentechnik"></a>
      <div class="search">
        <span class="ico">${icon('search')}</span>
        <input type="search" id="gsearch" placeholder="Kunde suchen (Name, Ort, Telefon …)" autocomplete="off">
        <div class="search-results hidden" id="gsearch-res"></div>
      </div>
      <div class="spacer"></div>
      <button class="btn primary sm" id="quick-task">${icon('plus')}<span class="hide-m">Aufgabe</span></button>
      <div class="rel">
        <button class="btn ghost icon" id="bell" title="Hinweise">${icon('bell', 'lg')}<span class="badge ${state.unread ? '' : 'hidden'}" id="bell-badge" style="position:absolute;top:-2px;right:-4px">${state.unread}</span></button>
      </div>
      <div class="user">${avatar(state.me.name, state.me.id)}<span class="uname"><b>${esc(state.me.name)}</b></span>
        <button class="btn ghost icon" id="logout" title="Abmelden">${icon('logout')}</button></div>
    </header>
    <aside class="sidebar"><nav class="nav">${nav.map(([r, i, l]) => `<a href="#/${r === 'start' ? '' : r}" data-r="${r}">${icon(i, 'lg')}${l}</a>`).join('')}</nav>
      <div class="foot">Bussmann Land- &amp; Gartentechnik<br>Wenn Sie Qualität und Service schätzen!</div></aside>
    <main class="main" id="main"></main>
    <nav class="mobile-nav">${nav.map(([r, i, l]) => `<a href="#/${r === 'start' ? '' : r}" data-r="${r}">${icon(i, 'lg')}${l === 'Einstellungen' ? 'Mehr' : l}</a>`).join('')}</nav>
  </div>`;
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST', body: {} }); state.me = null; location.hash = ''; renderLogin(); };
  $('#quick-task').onclick = () => openTaskForm({});
  $('#bell').onclick = toggleNotifications;
  setupGlobalSearch();
}

function setupGlobalSearch() {
  const inp = $('#gsearch'); const box = $('#gsearch-res');
  let sel = -1;
  const run = debounce(async () => {
    const q = inp.value.trim();
    if (!q) { box.classList.add('hidden'); return; }
    const rows = await api('/search?q=' + encodeURIComponent(q));
    sel = -1;
    box.innerHTML = rows.length ? rows.map((c) => `<a href="#/kunden/${c.id}"><b>${esc(custName(c))}</b>${c.company && c.last_name !== c.company ? ` · ${esc(c.company)}` : ''} <span class="muted small">${esc(c.city || '')}</span></a>`).join('') + `<a href="#/kunden" data-all class="small muted">Alle Treffer in der Kundenliste …</a>` : '<div class="empty small">Kein Kunde gefunden</div>';
    box.classList.remove('hidden');
    $$('a', box).forEach((a) => a.addEventListener('click', () => { if (a.dataset.all !== undefined) sessionStorage.setItem('custQ', q); inp.value = ''; box.classList.add('hidden'); }));
  }, 200);
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (e) => {
    const links = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(links.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); links.forEach((l, i) => l.classList.toggle('active', i === sel)); }
    if (e.key === 'Enter' && links.length) { (links[sel] || links[0]).click(); location.hash = (links[sel] || links[0]).getAttribute('href'); }
    if (e.key === 'Escape') { box.classList.add('hidden'); inp.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.classList.add('hidden'); });
}

async function toggleNotifications(e) {
  e.stopPropagation();
  const old = $('#notif-dd'); if (old) { old.remove(); return; }
  const list = await api('/notifications');
  const dd = document.createElement('div');
  dd.className = 'dropdown'; dd.id = 'notif-dd';
  dd.innerHTML = `<div class="card-head" style="display:flex;padding:10px 14px;border-bottom:1px solid var(--line)"><b style="margin-right:auto">Hinweise</b><button class="btn ghost sm" id="mark-all">Alle gelesen</button></div>` +
    (list.length ? list.map((n) => `<div class="item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-task="${n.task_id || ''}" data-cust="${n.customer_id || ''}">${esc(n.text)}<div class="muted small">${deDateTime(n.created_at.replace(' ', 'T'))}</div></div>`).join('') : '<div class="empty">Keine Hinweise</div>');
  $('#bell').parentElement.appendChild(dd);
  $('#mark-all', dd).onclick = async (ev) => { ev.stopPropagation(); await api('/notifications/read', { method: 'POST', body: {} }); dd.remove(); refreshUnread(); };
  $$('.item', dd).forEach((it) => it.onclick = async () => {
    await api('/notifications/read', { method: 'POST', body: { id: Number(it.dataset.id) } });
    dd.remove(); refreshUnread();
    if (it.dataset.task) openTask(Number(it.dataset.task)); else if (it.dataset.cust) location.hash = '#/kunden/' + it.dataset.cust;
  });
  const close = (ev) => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close));
}

// ======================= Bausteine: Aufgaben =======================
function dueClass(t) {
  if (t.status === 'done') return '';
  if (t.due_date < todayISO()) return 'over';
  if (t.due_date === todayISO()) return 'today';
  return '';
}
function taskItem(t, { showAssignee = true, showCustomer = true } = {}) {
  const cust = taskCust(t);
  return `<li data-task="${t.id}">
    <button class="tick ${t.status === 'done' ? 'done' : ''}" data-tick="${t.id}" title="${t.status === 'done' ? 'Erledigt' : 'Als erledigt markieren'}">${icon('check')}</button>
    <div class="body">
      <div class="ttl">${esc(t.title)}</div>
      <div class="meta">
        <span class="due ${dueClass(t)}">${icon('clock')} ${relDay(t.due_date)}${t.due_time ? ' ' + t.due_time : ''}</span>
        <span>${icon(TASK_ICON[t.kind])} ${TASK_KINDS[t.kind]}</span>
        ${showCustomer && cust ? `<span>${icon('user')} ${esc(cust)}</span>` : ''}
        ${showAssignee && t.assignee ? `<span title="Zuständig">${avatar(t.assignee, t.assigned_to, 'xs')} ${esc(t.assignee)}</span>` : ''}
        ${t.auto_visit ? '<span class="chip">Besuchsintervall</span>' : ''}
        ${t.file_count ? `<span title="Bilder/Dateien">${icon('link')} ${t.file_count}</span>` : ''}
      </div>
    </div></li>`;
}
function bindTaskList(root, reload) {
  $$('[data-task]', root).forEach((li) => li.addEventListener('click', (e) => {
    if (e.target.closest('[data-tick]')) return;
    openTask(Number(li.dataset.task), reload);
  }));
  $$('[data-tick]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (b.classList.contains('done')) return openTask(Number(b.dataset.tick), reload);
    completeTask(Number(b.dataset.tick), reload);
  }));
}
function completeTask(id, reload) {
  const m = modal({
    title: 'Aufgabe erledigen',
    body: `<div class="field"><label>Notiz / Ergebnis (optional, erscheint in der Zeitleiste des Kunden)</label><textarea id="done-note" placeholder="z. B. Angebot per Mail verschickt, Kunde meldet sich nächste Woche"></textarea></div>`,
    foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn ok" id="done-ok">${icon('check')} Erledigt</button>`,
  });
  $('#done-ok', m.el).onclick = async () => {
    try { await api(`/tasks/${id}/done`, { method: 'POST', body: { note: $('#done-note', m.el).value } }); m.close(); toast('Aufgabe erledigt ✓'); reload && reload(); } catch (e) { fail(e); }
  };
}

async function openTask(id, reload) {
  let t;
  try { t = await api('/tasks/' + id); } catch (e) { return fail(e); }
  const cust = taskCust(t);
  const done = t.status === 'done';
  const m = modal({
    title: `${icon(TASK_ICON[t.kind], 'lg')} ${esc(t.title)}`,
    body: `<div class="kv">
      <span class="k">Art</span><span>${TASK_KINDS[t.kind]}${t.auto_visit ? ' <span class="chip">automatisch aus Besuchsintervall</span>' : ''}</span>
      <span class="k">Fällig</span><span class="${dueClass(t) === 'over' ? 'chip red' : ''}">${WD_LONG[parseISO(t.due_date).getDay()]}, ${deDate(t.due_date)}${t.due_time ? `, ${t.due_time} Uhr (${t.duration_min} Min.)` : ' (ganztägig)'}</span>
      <span class="k">Status</span><span>${done ? `<span class="chip ok">Erledigt</span> ${esc(t.done_by_name || '')} am ${deDateTime(t.done_at)}` : '<span class="chip warn">Offen</span>'}</span>
      ${cust ? `<span class="k">Kunde</span><span><a href="#/kunden/${t.customer_id}" data-close>${esc(cust)}</a>${t.c_city ? ` · ${esc(t.c_city)}` : ''}</span>` : ''}
      ${t.c_mobile || t.c_phone ? `<span class="k">Telefon</span><span>${[t.c_mobile, t.c_phone].filter(Boolean).map((n) => `<a href="${telHref(n)}">${esc(n)}</a>`).join(' · ')}</span>` : ''}
      ${t.location ? `<span class="k">Ort</span><span>${esc(t.location)}</span>` : ''}
      <span class="k">Zuständig</span><span>${esc(t.assignee || '–')}</span>
      <span class="k">Erstellt von</span><span>${esc(t.creator || 'System')} am ${deDateTime(t.created_at.replace(' ', 'T'))}</span>
      <span class="k">Erinnerung</span><span>${t.remind_day_before ? 'Einen Tag vorher' : 'Keine'}</span>
    </div>
    ${t.description ? `<div class="section-title" style="margin-top:16px">Beschreibung</div><div class="pre">${esc(t.description)}</div>` : ''}
    ${t.done_note ? `<div class="section-title" style="margin-top:16px">Ergebnis</div><div class="pre">${esc(t.done_note)}</div>` : ''}
    <div class="section-title" style="margin-top:16px;display:flex;align-items:center;gap:10px">Bilder &amp; Dateien ${t.files.length ? `(${t.files.length})` : ''}<span style="flex:1"></span>${fileInputHtml('id="t-files"')}</div>
    ${t.files.length ? `<div class="thumbs">${t.files.map((f) => `<div class="thumb" data-fid="${f.id}" title="${esc(f.filename)} · ${esc(f.uploader || '')}">
        ${isImg(f) ? `<img src="/api/task-files/${f.id}" alt="${esc(f.filename)}" loading="lazy">` : `<div class="doc">${icon('file', 'lg')}<span>${esc(f.filename)}</span></div>`}
        <button class="del" data-fdel="${f.id}" title="Löschen">${icon('x')}</button></div>`).join('')}</div>` : '<div class="muted small">Noch keine Bilder. Mit dem Handy kannst du direkt ein Foto aufnehmen.</div>'}
    ${t.entry ? `<div class="section-title" style="margin-top:16px">Entstanden aus ${ENTRY_KINDS[t.entry.kind] || 'Eintrag'} vom ${deDateTime(t.entry.happened_at)} (${esc(t.entry.author || '')})</div><div class="callout pre">${esc(t.entry.text)}</div>` : ''}`,
    foot: `<span class="left"><button class="btn danger" id="t-del">${icon('trash')} Löschen</button></span>
      <button class="btn" id="t-edit">${icon('edit')} Bearbeiten</button>
      ${done ? '<button class="btn" id="t-reopen">Wieder öffnen</button>' : `<button class="btn ok" id="t-done">${icon('check')} Erledigt</button>`}`,
    onClose: () => { if (location.hash.startsWith('#/aufgaben/')) history.replaceState(null, '', '#/aufgaben'); },
  });
  const after = () => { m.close(); reload ? reload() : route(); };
  const refresh = () => { m.close(); openTask(id, reload); };
  $('#t-files', m.el).onchange = async (e) => {
    const n = await uploadTaskFiles(id, [...e.target.files]);
    if (n) toast(`${n} Datei${n > 1 ? 'en' : ''} hinzugefügt`);
    refresh(); reload && reload();
  };
  $$('[data-fid]', m.el).forEach((el) => el.onclick = (e) => {
    if (e.target.closest('[data-fdel]')) return;
    const f = t.files.find((x) => x.id === Number(el.dataset.fid));
    if (isImg(f)) showImage(f, t.files); else window.open(`/api/task-files/${f.id}`, '_blank');
  });
  $$('[data-fdel]', m.el).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    if (!(await confirmBox('Diese Datei löschen?'))) return;
    try { await api('/task-files/' + b.dataset.fdel, { method: 'DELETE' }); toast('Gelöscht'); refresh(); } catch (err) { fail(err); }
  });
  $('#t-del', m.el).onclick = async () => { if (await confirmBox('Diese Aufgabe wirklich löschen?')) { try { await api('/tasks/' + id, { method: 'DELETE' }); toast('Aufgabe gelöscht'); after(); } catch (e) { fail(e); } } };
  $('#t-edit', m.el).onclick = () => { m.close(); openTaskForm(t, reload); };
  if (done) $('#t-reopen', m.el).onclick = async () => { await api(`/tasks/${id}/reopen`, { method: 'POST', body: {} }); toast('Wieder geöffnet'); after(); };
  else $('#t-done', m.el).onclick = () => { m.close(); completeTask(id, reload || route); };
}

function customerPicker(container, initial) {
  let selected = initial;
  const render = () => {
    container.innerHTML = selected
      ? `<div class="selected-cust">${icon('user')}<a href="#/kunden/${selected.id}" target="_blank">${esc(selected.name)}</a><button type="button" class="btn ghost sm" data-clear>${icon('x')}</button></div>`
      : `<input type="search" placeholder="Kunde suchen (optional)" data-q autocomplete="off"><div class="picker-results hidden" data-res></div>`;
    if (selected) { $('[data-clear]', container).onclick = () => { selected = null; render(); }; return; }
    const q = $('[data-q]', container); const res = $('[data-res]', container);
    q.oninput = debounce(async () => {
      if (!q.value.trim()) { res.classList.add('hidden'); return; }
      const rows = await api('/search?q=' + encodeURIComponent(q.value));
      res.innerHTML = rows.map((c) => `<div data-id="${c.id}" data-name="${esc(custName(c))}">${esc(custName(c))} <span class="muted small">${esc(c.city || '')}</span></div>`).join('') || '<div class="muted">Kein Treffer</div>';
      res.classList.remove('hidden');
      $$('[data-id]', res).forEach((d) => d.onclick = () => { selected = { id: Number(d.dataset.id), name: d.dataset.name }; render(); });
    }, 200);
  };
  render();
  return { get: () => (selected ? selected.id : null) };
}

function taskFields(t = {}, prefix = '') {
  return `<div class="form-grid">
    <div class="field"><label>Art</label><select name="${prefix}kind">${Object.entries(TASK_KINDS).map(([k, v]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Zuständig</label><select name="${prefix}assigned_to">${userOptions(t.assigned_to || state.me.id)}</select></div>
    <div class="field full"><label>Titel <span class="req">*</span></label><input type="text" name="${prefix}title" value="${esc(t.title || '')}" placeholder="z. B. Angebot Rasentraktor erstellen" required></div>
    <div class="field"><label>Datum <span class="req">*</span></label><input type="date" name="${prefix}due_date" value="${esc(t.due_date || addDays(todayISO(), 1))}" required></div>
    <div class="field"><label>Uhrzeit <span class="muted">(leer = ganztägig)</span></label><input type="time" name="${prefix}due_time" value="${esc(t.due_time || '')}"></div>
    <div class="field"><label>Dauer</label><select name="${prefix}duration_min">${[15, 30, 45, 60, 90, 120, 180, 240, 480].map((n) => `<option value="${n}" ${Number(t.duration_min || 60) === n ? 'selected' : ''}>${n < 60 ? n + ' Min.' : n / 60 + ' Std.'}</option>`).join('')}</select></div>
    <div class="field"><label>Ort / Treffpunkt</label><input type="text" name="${prefix}location" value="${esc(t.location || '')}" placeholder="leer = Kundenadresse"></div>
    <div class="field full"><label>Beschreibung</label><textarea name="${prefix}description" rows="3">${esc(t.description || '')}</textarea></div>
    ${prefix ? '' : `<div class="field full"><label>Bilder / Dateien</label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${fileInputHtml('id="tf-files"')}<span class="muted small" id="tf-files-out"></span></div></div>`}
    <div class="field full"><label class="check"><input type="checkbox" name="${prefix}remind_day_before" ${t.remind_day_before === 0 ? '' : 'checked'}> Einen Tag vorher erinnern (in der App${state.mailEnabled ? ', per E-Mail' : ''} und im Kalender-Abo)</label></div>
  </div>`;
}

function openTaskForm(t = {}, reload, presetCustomer) {
  const isEdit = !!t.id;
  const m = modal({
    title: isEdit ? 'Aufgabe bearbeiten' : 'Neue Aufgabe / Termin',
    body: `<form id="tf"><div class="field" style="margin-bottom:12px"><label>Kunde</label><div id="tf-cust"></div></div>${taskFields(t)}</form>`,
    foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="tf-save">Speichern</button>`,
  });
  const initCust = presetCustomer || (t.customer_id ? { id: t.customer_id, name: taskCust(t) } : null);
  const picker = customerPicker($('#tf-cust', m.el), initCust);
  pickedList($('#tf-files', m.el), $('#tf-files-out', m.el));
  $('#tf-save', m.el).onclick = async () => {
    const f = $('#tf', m.el);
    if (!f.reportValidity()) return;
    const body = { ...formData(f), customer_id: picker.get() };
    try {
      let taskId = t.id;
      if (isEdit) await api('/tasks/' + t.id, { method: 'PUT', body });
      else taskId = (await api('/tasks', { method: 'POST', body })).id;
      const files = [...$('#tf-files', m.el).files];
      if (files.length) { $('#tf-save', m.el).disabled = true; $('#tf-save', m.el).textContent = 'Lädt hoch …'; await uploadTaskFiles(taskId, files); }
      m.close();
      const other = Number(body.assigned_to) !== state.me.id ? ` – ${state.users.find((u) => u.id === Number(body.assigned_to))?.name} wurde benachrichtigt` : '';
      toast((isEdit ? 'Gespeichert' : 'Aufgabe angelegt') + other);
      reload ? reload() : route();
    } catch (e) { fail(e); }
  };
}

// ======================= Übersicht (Dashboard) =======================
async function viewDashboard(main) {
  const load = async () => {
    const week = state.dashWeek || todayISO();
    const d = await api(`/dashboard?week=${week}&scope=${state.dashScope}`);
    const days = Array.from({ length: 7 }, (_, i) => addDays(d.monday, i));
    const mon = parseISO(d.monday); const sun = parseISO(d.sunday);
    const kw = isoWeek(mon);
    const overdue = d.open.filter((t) => t.due_date < d.today);
    const todays = d.open.filter((t) => t.due_date === d.today);
    const later = d.open.filter((t) => t.due_date > d.today);
    const scopeSel = `<select id="dash-scope" style="width:auto"><option value="mine" ${state.dashScope === 'mine' ? 'selected' : ''}>Meine</option><option value="all" ${state.dashScope === 'all' ? 'selected' : ''}>Alle Mitarbeiter</option>${state.users.filter((u) => u.active && u.id !== state.me.id).map((u) => `<option value="${u.id}" ${state.dashScope === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
    const hour = new Date().getHours();
    main.innerHTML = `
      <div class="page-head"><h1>${hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'}, ${esc(state.me.name.split(' ')[0])}</h1>${scopeSel}</div>
      <div class="stats">
        <div class="card stat ${d.stats.overdue ? 'alert' : ''}" data-jump="open"><div class="ic">${icon('clock', 'lg')}</div><div><div class="num">${d.stats.overdue}</div><div class="lbl">Überfällig</div></div></div>
        <div class="card stat" data-jump="open"><div class="ic">${icon('tasks', 'lg')}</div><div><div class="num">${d.stats.dueToday}</div><div class="lbl">Heute fällig</div></div></div>
        <div class="card stat" data-jump="open"><div class="ic">${icon('bell', 'lg')}</div><div><div class="num">${d.stats.dueTomorrow}</div><div class="lbl">Morgen fällig</div></div></div>
        <div class="card stat" onclick="location.hash='#/kunden'"><div class="ic">${icon('users', 'lg')}</div><div><div class="num">${d.stats.customers}</div><div class="lbl">Kunden</div></div></div>
      </div>
      <div class="dash">
        <div class="card">
          <div class="card-head"><h2>KW ${kw} · ${mon.getDate()}. ${MONTHS[mon.getMonth()]} – ${sun.getDate()}. ${MONTHS[sun.getMonth()]} ${sun.getFullYear()}</h2>
            <div class="btn-group"><button class="btn sm" id="wk-prev" title="Vorherige Woche">${icon('left')}</button><button class="btn sm" id="wk-today">Heute</button><button class="btn sm" id="wk-next" title="Nächste Woche">${icon('right')}</button></div>
          </div>
          <div class="week">${days.map((day) => {
            const dt = parseISO(day);
            const items = d.week.filter((t) => t.due_date === day);
            const bd = d.birthdaysWeek.filter((b) => b.date === day);
            return `<div class="day ${day === d.today ? 'today' : ''} ${dt.getDay() % 6 === 0 ? 'weekend' : ''}">
              <div class="day-head"><div class="dn">${WD[dt.getDay()]}</div><div class="dd">${dt.getDate()}.${dt.getMonth() + 1}.</div></div>
              <div class="day-body" data-day="${day}">
                ${bd.map((b) => `<div class="ev bday" data-cust="${b.id}"><div class="ttl">🎂 ${esc(custName(b))}</div><div class="who">${b.age}. Geburtstag</div></div>`).join('')}
                ${items.map((t) => evHtml(t, state.dashScope !== 'mine')).join('')}
              </div></div>`;
          }).join('')}</div>
        </div>
        <div class="side">
          <div class="card" id="open-card">
            <div class="card-head"><h2>Offene Aufgaben</h2><span class="badge ${d.open.length ? '' : 'grey'}">${d.open.length}</span></div>
            ${d.open.length ? `
              ${overdue.length ? `<div class="group-title red">Überfällig (${overdue.length})</div><ul class="tasklist">${overdue.map((t) => taskItem(t, { showAssignee: state.dashScope !== 'mine' })).join('')}</ul>` : ''}
              ${todays.length ? `<div class="group-title">Heute (${todays.length})</div><ul class="tasklist">${todays.map((t) => taskItem(t, { showAssignee: state.dashScope !== 'mine' })).join('')}</ul>` : ''}
              ${later.length ? `<div class="group-title">Demnächst (${later.length})</div><ul class="tasklist">${later.slice(0, 25).map((t) => taskItem(t, { showAssignee: state.dashScope !== 'mine' })).join('')}</ul>${later.length > 25 ? `<div class="list-foot"><a href="#/aufgaben">Alle ${later.length} anzeigen …</a></div>` : ''}` : ''}
            ` : '<div class="empty">Alles erledigt 👍</div>'}
          </div>
          <div class="card">
            <div class="card-head"><h2>🎂 Geburtstage</h2><span class="muted small">nächste 30 Tage</span></div>
            ${d.birthdaysUpcoming.length ? `<ul class="tasklist bdays">${d.birthdaysUpcoming.map((b) => `<li data-cust="${b.id}"><div class="bday-ico">🎂</div><div class="body"><div class="ttl">${esc(custName(b))}</div>
              <div class="meta"><span class="${b.date === d.today ? 'due today' : ''}">${relDay(b.date)}</span><span>wird ${b.age}</span>${b.city ? `<span>${esc(b.city)}</span>` : ''}${b.mobile || b.phone ? `<a href="${telHref(b.mobile || b.phone)}" onclick="event.stopPropagation()">${icon('phone')} anrufen</a>` : ''}</div></div></li>`).join('')}</ul>` : '<div class="empty">Keine Geburtstage in den nächsten 30 Tagen</div>'}
          </div>
          ${d.delegated.length ? `<div class="card"><div class="card-head"><h2>Von mir delegiert</h2><span class="badge grey">${d.delegated.length}</span></div><ul class="tasklist">${d.delegated.map((t) => taskItem(t)).join('')}</ul></div>` : ''}
        </div>
      </div>`;
    $('#dash-scope').onchange = (e) => { state.dashScope = e.target.value; localStorage.setItem('dashScope', state.dashScope); load(); };
    $('#wk-prev').onclick = () => { state.dashWeek = addDays(d.monday, -7); load(); };
    $('#wk-next').onclick = () => { state.dashWeek = addDays(d.monday, 7); load(); };
    $('#wk-today').onclick = () => { state.dashWeek = null; load(); };
    $$('[data-jump]').forEach((el) => el.onclick = () => $('#open-card').scrollIntoView({ behavior: 'smooth' }));
    $$('[data-cust]', main).forEach((el) => el.onclick = () => { location.hash = '#/kunden/' + el.dataset.cust; });
    $$('.ev[data-ev]', main).forEach((el) => el.onclick = () => openTask(Number(el.dataset.ev), load));
    $$('.day-body', main).forEach((el) => el.addEventListener('dblclick', (e) => { if (e.target === el) openTaskForm({ due_date: el.dataset.day, kind: 'termin' }, load); }));
    bindTaskList($('.side', main), load);
  };
  await load();
}
function evHtml(t, showWho) {
  const over = t.status === 'open' && t.due_date < todayISO();
  const cust = taskCust(t);
  return `<div class="ev k-${t.kind} ${t.status === 'done' ? 'done' : ''} ${over ? 'overdue' : ''}" data-ev="${t.id}" title="${esc(TASK_KINDS[t.kind] + ': ' + t.title + (cust ? ' – ' + cust : ''))}">
    <div class="t">${t.due_time ? t.due_time : 'ganztägig'} · ${TASK_KINDS[t.kind]}</div>
    <div class="ttl">${esc(t.title)}</div>
    ${showWho && t.assignee ? `<div class="who">${esc(t.assignee)}</div>` : ''}
  </div>`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y) / 864e5 + 1) / 7);
}

// ======================= Kundenliste =======================
async function viewCustomers(main) {
  const st = { q: sessionStorage.getItem('custQ') || '', type: '', sort: 'name', owner: '' };
  sessionStorage.removeItem('custQ');
  main.innerHTML = `
    <div class="page-head"><h1>Kunden</h1>
      <button class="btn" id="c-import">${icon('upload')} Excel-Import</button>
      <button class="btn" id="c-export">${icon('download')} Export</button>
      <button class="btn primary" id="c-new">${icon('plus')} Kunde anlegen</button></div>
    <div class="toolbar">
      <div class="grow"><span class="ico">${icon('search')}</span><input type="search" id="c-q" placeholder="Suchen nach Name, Ort, PLZ, Straße, E-Mail, Telefon, Info …" value="${esc(st.q)}"></div>
      <select id="c-sort"><option value="name">Sortierung: Name</option><option value="city">Ort</option><option value="contact">Letzter Kontakt</option><option value="newest">Neueste zuerst</option></select>
      <select id="c-owner"><option value="">Alle Betreuer</option><option value="me">Nur meine Kunden</option></select>
    </div>
    <div class="seg" id="c-types" style="margin-bottom:14px"><button class="on" data-t="">Alle</button>${TYPES.map((t) => `<button data-t="${t}">${t}</button>`).join('')}</div>
    <div class="card"><div class="table-wrap" id="c-table"></div></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ q: st.q, type: st.type, sort: st.sort, owner: st.owner });
    const data = await api('/customers?' + qs);
    const adm = state.me.role === 'admin';
    $('#c-table').innerHTML = data.rows.length ? `${adm ? `<div class="bulkbar hidden" id="c-bulk"><span id="c-bulk-n"></span><button class="btn danger sm" id="c-bulk-del">${icon('trash')} Ausgewählte löschen</button></div>` : ''}<table class="list"><thead><tr>${adm ? '<th style="width:36px"><input type="checkbox" id="c-all" title="Alle auswählen"></th>' : ''}<th>Name</th><th>Ort</th><th class="hide-m">Kundenart</th><th class="hide-m">E-Mail</th><th>Telefon</th><th class="hide-m">Betreuer</th><th class="hide-m">Letzter Kontakt</th></tr></thead><tbody>
      ${data.rows.map((c) => `<tr data-id="${c.id}">${adm ? `<td onclick="event.stopPropagation()"><input type="checkbox" class="c-sel" value="${c.id}"></td>` : ''}
        <td class="name">${esc(custName(c))}${c.company && c.company !== c.last_name ? `<div class="muted small" style="font-weight:400">${esc(c.company)}</div>` : ''}</td>
        <td>${esc([c.zip, c.city].filter(Boolean).join(' '))}</td>
        <td class="hide-m">${c.customer_type ? `<span class="chip t-${c.customer_type}">${c.customer_type}</span>` : ''}</td>
        <td class="hide-m">${c.email ? `<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>` : ''}</td>
        <td class="nowrap">${[c.mobile, c.phone].filter(Boolean).map((n) => `<a href="${telHref(n)}" onclick="event.stopPropagation()">${esc(n)}</a>`).join('<br>')}</td>
        <td class="hide-m">${c.owner_name ? `${avatar(c.owner_name, c.owner_id, 'xs')} ${esc(c.owner_name)}` : ''}</td>
        <td class="hide-m nowrap">${c.last_contact ? deDate(c.last_contact) : '<span class="muted">–</span>'}${c.open_tasks ? ` <span class="badge grey" title="offene Aufgaben">${c.open_tasks}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table>
      <div class="list-foot"><span>${data.rows.length}${data.more ? '+' : ''} von ${data.total} Kunden</span><span>Klick auf eine Zeile öffnet den Kunden</span></div>`
      : `<div class="empty">${data.total ? 'Keine Kunden gefunden.' : 'Noch keine Kunden. Legen Sie den ersten Kunden an oder importieren Sie eine Excel-Liste.'}</div>`;
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/kunden/' + tr.dataset.id; });
    if (adm && data.rows.length) {
      const upd = () => { const n = $$('.c-sel:checked').length; $('#c-bulk').classList.toggle('hidden', !n); $('#c-bulk-n').textContent = `${n} Kunde${n === 1 ? '' : 'n'} ausgewählt`; };
      $$('.c-sel').forEach((cb) => cb.onchange = upd);
      $('#c-all').onchange = (e) => { $$('.c-sel').forEach((cb) => { cb.checked = e.target.checked; }); upd(); };
      $('#c-bulk-del').onclick = async () => {
        const ids = $$('.c-sel:checked').map((cb) => Number(cb.value));
        if (!(await confirmBox(`<b>${ids.length} Kunden</b> mit allen Einträgen, Aufgaben und Dateien endgültig löschen?`))) return;
        try { const r = await api('/customers/bulk-delete', { method: 'POST', body: { ids } }); toast(`${r.deleted} Kunden gelöscht`); load(); } catch (e) { fail(e); }
      };
    }
  };
  $('#c-q').oninput = debounce((e) => { st.q = e.target.value; load(); }, 200);
  $('#c-sort').onchange = (e) => { st.sort = e.target.value; load(); };
  $('#c-owner').onchange = (e) => { st.owner = e.target.value; load(); };
  $$('#c-types button').forEach((b) => b.onclick = () => { $$('#c-types button').forEach((x) => x.classList.toggle('on', x === b)); st.type = b.dataset.t; load(); });
  $('#c-new').onclick = () => openCustomerForm({}, (id) => { location.hash = '#/kunden/' + id; });
  $('#c-import').onclick = () => openImport(load);
  $('#c-export').onclick = () => { location.href = '/api/customers/export.xlsx?' + new URLSearchParams({ q: st.q, type: st.type, sort: st.sort, owner: st.owner }); };
  if (window.innerWidth > 860) $('#c-q').focus();
  await load();
}

function openCustomerForm(c = {}, onSaved) {
  const isEdit = !!c.id;
  const m = modal({
    title: isEdit ? 'Kunde bearbeiten' : 'Kunde anlegen',
    wide: true,
    body: `<form id="cf"><div class="form-grid">
      <div class="field"><label>Anrede</label><select name="salutation">${['', 'Herr', 'Frau', 'Familie', 'Firma'].map((s) => `<option ${c.salutation === s ? 'selected' : ''} value="${s}">${s || '–'}</option>`).join('')}</select></div>
      <div class="field"><label>Kundenart</label><select name="customer_type"><option value="">– bitte wählen –</option>${TYPES.map((t) => `<option ${c.customer_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Vorname</label><input type="text" name="first_name" value="${esc(c.first_name || '')}"></div>
      <div class="field"><label>Nachname <span class="req">*</span></label><input type="text" name="last_name" value="${esc(c.last_name || '')}" required></div>
      <div class="field full"><label>Firma / Betrieb / Kommune</label><input type="text" name="company" value="${esc(c.company || '')}"></div>
      <div class="field full"><label>Straße und Hausnummer</label><input type="text" name="street" value="${esc(c.street || '')}"></div>
      <div class="field"><label>PLZ</label><input type="text" name="zip" value="${esc(c.zip || '')}" inputmode="numeric" maxlength="10"></div>
      <div class="field"><label>Ort</label><input type="text" name="city" value="${esc(c.city || '')}"></div>
      <div class="field"><label>Geburtsdatum</label><input type="date" name="birthday" value="${esc(c.birthday || '')}"></div>
      <div class="field"><label>E-Mail</label><input type="email" name="email" value="${esc(c.email || '')}"></div>
      <div class="field"><label>Handynummer</label><input type="tel" name="mobile" value="${esc(c.mobile || '')}"></div>
      <div class="field"><label>Festnetznummer</label><input type="tel" name="phone" value="${esc(c.phone || '')}"></div>
      <div class="field"><label>Besuchsintervall</label><select name="visit_interval">${Object.entries(INTERVALS).map(([k, v]) => `<option value="${k}" ${(c.visit_interval || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Betreuer</label><select name="owner_id">${userOptions(c.owner_id || state.me.id)}</select></div>
      ${isEdit ? '' : '<div class="field full"><label>Infofeld (wichtige Infos, stehen immer oben)</label><textarea name="info" rows="3"></textarea></div>'}
      <div class="full callout info small">${icon('repeat')} Mit Besuchsintervall legt das CRM automatisch eine Besuchsaufgabe an (fällig: letzter Besuch + Intervall) und erinnert einen Tag vorher.</div>
    </div></form>`,
    foot: `<span class="left">${isEdit && state.me.role === 'admin' ? `<button class="btn danger" id="cf-del">${icon('trash')} Kunde löschen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="cf-save">Speichern</button>`,
  });
  $('#cf-save', m.el).onclick = async () => {
    const f = $('#cf', m.el);
    if (!f.reportValidity()) return;
    try {
      const body = formData(f);
      let id = c.id;
      if (isEdit) await api('/customers/' + c.id, { method: 'PUT', body });
      else id = (await api('/customers', { method: 'POST', body })).id;
      m.close(); toast(isEdit ? 'Kunde gespeichert' : 'Kunde angelegt');
      onSaved && onSaved(id);
    } catch (e) { fail(e); }
  };
  if (isEdit && $('#cf-del', m.el)) $('#cf-del', m.el).onclick = async () => {
    if (!(await confirmBox(`Kunde <b>${esc(custName(c))}</b> mit allen Einträgen, Aufgaben und Dateien endgültig löschen?`))) return;
    try { await api('/customers/' + c.id, { method: 'DELETE' }); m.close(); toast('Kunde gelöscht'); location.hash = '#/kunden'; } catch (e) { fail(e); }
  };
}

// ======================= Excel-Import =======================
function openImport(reload) {
  const m = modal({
    title: 'Kunden aus Excel importieren', wide: true,
    body: `<div id="imp">
      <p>Laden Sie eine Excel-Datei (.xlsx, .xls) oder CSV hoch. Die erste Zeile muss Spaltenüberschriften enthalten, z. B. <i>Vorname, Nachname, Straße und Hausnummer, PLZ, Ort, Kundenart, Geburtsdatum, E-Mail, Handynummer, Festnetznummer, Besuchsintervall, Info</i>. Ein Export aus Zoho Bigin wird ebenfalls erkannt.</p>
      <p><a href="/api/import/template.xlsx">${icon('download')} Importvorlage herunterladen</a></p>
      <label class="files-drop" id="imp-drop" style="display:block;margin:16px 0">${icon('upload', 'lg')}<br>Excel-Datei hierher ziehen oder <u>auswählen</u><input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.ods" hidden></label>
      <div id="imp-preview"></div></div>`,
    foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="imp-go" disabled>Importieren</button>`,
  });
  let rows = [];
  const handle = async (file) => {
    if (!file) return;
    try {
      const res = await api('/import/preview', { method: 'POST', raw: true, body: await file.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream' } });
      rows = res.rows;
      const ok = rows.filter((r) => !r._error);
      const dups = ok.filter((r) => r._duplicate);
      const mergedRows = ok.filter((r) => r._count > 1);
      const unmapped = res.mapping.filter((x) => !x.field).map((x) => x.column);
      const errCount = rows.filter((r) => r._error).length;
      const status = (r) => r._error ? `<span class="chip red">${r._error}</span>`
        : `${r._duplicate ? `<span class="chip warn" title="Bereits vorhanden: ${esc(r._duplicate_name || '')}">vorhanden</span> ` : ''}${r._count > 1 ? `<span class="chip" title="Doppelte Zeilen in der Datei">${r._count} Zeilen → 1</span>` : ''}${!r._duplicate && r._count === 1 ? '<span class="chip ok">neu</span>' : ''}`;
      $('#imp-preview', m.el).innerHTML = `
        <div class="callout ${errCount ? 'warn' : 'info'}"><b>${res.total}</b> Zeilen gelesen → <b>${ok.length}</b> Kunden${mergedRows.length ? `, davon <b>${mergedRows.length}</b> aus doppelten Zeilen zusammengefasst` : ''}.
          ${errCount ? `<br>${errCount} Zeilen ohne Nachname werden übersprungen.` : ''}
          ${unmapped.length ? `<br>Nicht zugeordnete Spalten (werden ignoriert): ${unmapped.map(esc).join(', ')}` : ''}</div>
        ${dups.length ? `<div class="callout" style="margin-top:10px"><b>${dups.length} Kunden gibt es schon im CRM.</b> Was soll mit ihnen passieren?
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
            <label class="check"><input type="radio" name="imp-dup" value="merge" checked> <span><b>Zusammenführen</b> – fehlende Angaben beim vorhandenen Kunden ergänzen (nichts wird überschrieben, abweichende Telefonnummern/E-Mails landen im Infofeld)</span></label>
            <label class="check"><input type="radio" name="imp-dup" value="skip"> <span><b>Überspringen</b> – vorhandene Kunden nicht anfassen</span></label>
            <label class="check"><input type="radio" name="imp-dup" value="create"> <span><b>Trotzdem neu anlegen</b></span></label>
          </div></div>` : ''}
        <div class="field" style="margin:12px 0;max-width:320px"><label>Betreuer für neue Kunden</label><select id="imp-owner">${userOptions(state.me.id)}</select></div>
        <div class="table-wrap" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:6px"><table class="list"><thead><tr><th>Status</th><th>Vorname</th><th>Nachname</th><th>Firma</th><th>Straße</th><th>PLZ</th><th>Ort</th><th>Art</th><th>Geburtsdatum</th><th>E-Mail</th><th>Handy</th><th>Festnetz</th><th>Intervall</th><th>Info</th></tr></thead><tbody>
        ${rows.slice(0, 300).map((r) => `<tr style="cursor:default"><td class="nowrap">${status(r)}</td>
          <td>${esc(r.first_name)}</td><td>${esc(r.last_name)}</td><td>${esc(r.company)}</td><td>${esc(r.street)}</td><td>${esc(r.zip)}</td><td>${esc(r.city)}</td><td>${esc(r.customer_type)}</td><td>${deDate(r.birthday)}</td><td>${esc(r.email)}</td><td>${esc(r.mobile)}</td><td>${esc(r.phone)}</td><td>${r.visit_interval ? INTERVALS[r.visit_interval] : ''}</td><td class="small pre">${esc(r.info)}</td></tr>`).join('')}
        </tbody></table></div>${rows.length > 300 ? `<p class="muted small">Vorschau zeigt die ersten 300 Kunden.</p>` : ''}`;
      $('#imp-go', m.el).disabled = !ok.length;
    } catch (e) { fail(e); }
  };
  $('#imp-file', m.el).onchange = (e) => handle(e.target.files[0]);
  const drop = $('#imp-drop', m.el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  $('#imp-go', m.el).onclick = async () => {
    const dupMode = $('input[name=imp-dup]:checked', m.el)?.value || 'merge';
    const owner = $('#imp-owner', m.el).value;
    const list = rows.filter((r) => !r._error).map((r) => ({ ...r, owner_id: owner }));
    $('#imp-go', m.el).disabled = true;
    try {
      const res = await api('/import/commit', { method: 'POST', body: { rows: list, dupMode } });
      m.close(); toast(`${res.created} Kunden neu angelegt${res.updated ? `, ${res.updated} vorhandene ergänzt` : ''}${res.skipped.length ? `, ${res.skipped.length} übersprungen` : ''}`);
      reload && reload();
    } catch (e) { fail(e); $('#imp-go', m.el).disabled = false; }
  };
}

// ======================= Kundenakte =======================
async function viewCustomer(id, tab) {
  const main = $('#main');
  const d = await api('/customers/' + id);
  const c = d.customer;
  const curTab = tab || sessionStorage.getItem('custTab') || 'zeitleiste';
  const openTasks = d.tasks.filter((t) => t.status === 'open');
  const age = c.birthday ? (() => { const b = parseISO(c.birthday); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--; return a; })() : null;
  const addr = [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const reload = (t) => viewCustomer(id, t || sessionStorage.getItem('custTab'));
  main.innerHTML = `
    <div class="cust-head">
      <a class="btn ghost icon" href="#/kunden" title="Zurück zur Liste">${icon('back', 'lg')}</a>
      <span class="avatar lg" style="background:var(--red)">${esc(initials(custName(c)))}</span>
      <div class="title">
        <h1>${esc([c.salutation && c.salutation !== 'Firma' ? c.salutation : '', c.first_name, c.last_name].filter(Boolean).join(' '))} ${c.customer_type ? `<span class="chip t-${c.customer_type}">${c.customer_type}</span>` : ''}</h1>
        <div class="muted">${esc([c.company, c.city].filter(Boolean).join(' · '))}${openTasks.length ? ` · <span style="color:var(--red);font-weight:700">${openTasks.length} offene Aufgabe${openTasks.length > 1 ? 'n' : ''}</span>` : ''}</div>
      </div>
      ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon('mail')}<span class="hide-m">E-Mail</span></a>` : ''}
      ${c.mobile || c.phone ? `<a class="btn" href="${telHref(c.mobile || c.phone)}">${icon('phone')}<span class="hide-m">Anrufen</span></a>` : ''}
      <button class="btn" id="cu-edit">${icon('edit')}<span class="hide-m">Bearbeiten</span></button>
      <div class="btn-group hide-m">
        <button class="btn icon" ${d.prev ? `onclick="location.hash='#/kunden/${d.prev}'"` : 'disabled'} title="Vorheriger Kunde">${icon('left')}</button>
        <button class="btn icon" ${d.next ? `onclick="location.hash='#/kunden/${d.next}'"` : 'disabled'} title="Nächster Kunde">${icon('right')}</button>
      </div>
    </div>
    <div class="cust">
      <div class="card"><div class="card-body">
        <div class="section-title">Kontaktdaten</div>
        <ul class="facts">
          <li>${icon('mail')}<div><span class="k">E-Mail</span>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '–'}</div></li>
          <li>${icon('mobile')}<div><span class="k">Handy</span>${c.mobile ? `<a href="${telHref(c.mobile)}">${esc(c.mobile)}</a>` : '–'}</div></li>
          <li>${icon('phone')}<div><span class="k">Festnetz</span>${c.phone ? `<a href="${telHref(c.phone)}">${esc(c.phone)}</a>` : '–'}</div></li>
          <li>${icon('pin')}<div><span class="k">Adresse</span>${addr ? `${esc(c.street || '')}<br>${esc([c.zip, c.city].filter(Boolean).join(' '))}<br><a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">Route planen</a>` : '–'}</div></li>
        </ul>
        <div class="section-title">Weitere Angaben</div>
        <ul class="facts">
          <li>${icon('cake')}<div><span class="k">Geburtsdatum</span>${c.birthday ? `${deDate(c.birthday)} <span class="muted">(${age} Jahre)</span>` : '–'}</div></li>
          <li>${icon('tag')}<div><span class="k">Kundenart</span>${esc(c.customer_type || '–')}</div></li>
          <li>${icon('repeat')}<div><span class="k">Besuchsintervall</span>${c.visit_interval ? INTERVALS[c.visit_interval] : 'keins'}</div></li>
          <li>${icon('user')}<div><span class="k">Betreuer</span>${esc(c.owner_name || '–')}</div></li>
        </ul>
        <div class="section-title">Verlauf</div>
        <div class="small muted">Angelegt am ${deDateTime(c.created_at.replace(' ', 'T'))}${c.created_by_name ? ` von <b>${esc(c.created_by_name)}</b>` : ''}<br>
        Zuletzt geändert am ${deDateTime(c.updated_at.replace(' ', 'T'))}${c.updated_by_name ? ` von <b>${esc(c.updated_by_name)}</b>` : ''}</div>
      </div></div>
      <div>
        <div class="infobox" id="infobox">
          <div class="card-head"><h3>${icon('info')} Wichtige Infos</h3><button class="btn ghost sm" id="info-edit">${icon('edit')} Bearbeiten</button></div>
          <div class="view ${c.info ? '' : 'empty-note'}" id="info-view">${c.info ? esc(c.info) : 'Noch keine Infos. Hier stehen wichtige Notizen, die immer oben bleiben (z. B. Maschinenpark, Vorlieben, Zahlungsweise).'}</div>
        </div>
        <div class="card">
          <div class="tabs">
            <button data-tab="zeitleiste" class="${curTab === 'zeitleiste' ? 'on' : ''}">Zeitleiste</button>
            <button data-tab="aufgaben" class="${curTab === 'aufgaben' ? 'on' : ''}">Aufgaben ${openTasks.length ? `<span class="badge">${openTasks.length}</span>` : ''}</button>
            <button data-tab="dateien" class="${curTab === 'dateien' ? 'on' : ''}">Dateien ${d.files.length ? `<span class="badge grey">${d.files.length}</span>` : ''}</button>
          </div>
          <div id="tab-body"></div>
        </div>
      </div>
    </div>`;

  $('#cu-edit').onclick = () => openCustomerForm(c, () => reload());
  // Infofeld
  const infoBox = $('#infobox');
  const startInfoEdit = () => {
    const view = $('#info-view');
    if (!view) return;
    view.outerHTML = `<textarea id="info-text" placeholder="Wichtige Informationen zum Kunden …">${esc(c.info)}</textarea>`;
    $('#info-edit').outerHTML = `<span class="small muted" id="info-hint">Strg+Enter speichert</span><button class="btn sm" id="info-cancel">Abbrechen</button><button class="btn primary sm" id="info-save">Speichern</button>`;
    const ta = $('#info-text'); ta.focus(); ta.style.height = Math.max(120, ta.scrollHeight + 4) + 'px';
    const save = async () => { try { await api(`/customers/${id}/info`, { method: 'PUT', body: { info: ta.value } }); toast('Infos gespeichert'); reload(); } catch (e) { fail(e); } };
    $('#info-save').onclick = save;
    $('#info-cancel').onclick = () => reload();
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); };
  };
  $('#info-edit').onclick = startInfoEdit;
  $('#info-view').ondblclick = startInfoEdit;
  infoBox.querySelector('.view').addEventListener('click', () => { if (!c.info) startInfoEdit(); });

  const showTab = (t) => {
    sessionStorage.setItem('custTab', t);
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    const body = $('#tab-body');
    if (t === 'zeitleiste') renderTimeline(body, d, reload);
    else if (t === 'aufgaben') {
      body.innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px"><button class="btn primary sm" id="cu-task">${icon('plus')} Aufgabe / Termin</button></div>
        ${openTasks.length ? `<div class="group-title">Offen</div><ul class="tasklist">${openTasks.map((x) => taskItem({ ...x }, { showCustomer: false })).join('')}</ul>` : '<div class="empty">Keine offenen Aufgaben</div>'}
        ${d.tasks.some((x) => x.status === 'done') ? `<div class="group-title">Erledigt</div><ul class="tasklist">${d.tasks.filter((x) => x.status === 'done').map((x) => taskItem(x, { showCustomer: false })).join('')}</ul>` : ''}`;
      $('#cu-task').onclick = () => openTaskForm({}, () => reload('aufgaben'), { id: c.id, name: custName(c) });
      bindTaskList(body, () => reload('aufgaben'));
    } else renderFiles(body, d, reload);
  };
  $$('.tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  showTab(curTab);
}

function followupHtml(i, kind = 'anruf') {
  const defaults = { anruf: 'Kunde anrufen', termin: 'Termin', besuch: 'Besuch', angebot: 'Angebot erstellen', aufgabe: '' };
  return `<div class="followup" data-fu="${i}">
    <button type="button" class="btn ghost icon sm x" data-fu-del title="Entfernen">${icon('x')}</button>
    <div class="grid">
      <div class="field"><label>Art</label><select data-k="kind">${Object.entries(TASK_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Titel</label><input type="text" data-k="title" value="${esc(defaults[kind])}"></div>
      <div class="field"><label>Datum</label><input type="date" data-k="due_date" value="${addDays(todayISO(), kind === 'anruf' ? 7 : 14)}"></div>
      <div class="field"><label>Uhrzeit</label><input type="time" data-k="due_time"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Zuständig</label><select data-k="assigned_to">${userOptions(state.me.id)}</select></div>
      <label class="check" style="margin-top:22px"><input type="checkbox" data-k="remind_day_before" checked> 1 Tag vorher erinnern</label>
    </div>
    <div class="field" style="margin-top:10px"><label>Notiz zur Aufgabe (optional)</label><input type="text" data-k="description" placeholder="z. B. Angebot für Aufsitzmäher, Budget ca. 5.000 €"></div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">${fileInputHtml('data-files')}<span class="muted small" data-files-out></span></div>
  </div>`;
}

function renderTimeline(body, d, reload) {
  const c = d.customer;
  let kind = 'besuch';
  let fuCount = 0;
  let filter = sessionStorage.getItem('tlFilter') || 'all';
  body.innerHTML = `
    <div class="composer">
      <div class="row"><div class="seg" id="tl-kind">${Object.entries(ENTRY_KINDS).map(([k, v]) => `<button type="button" data-k="${k}" class="${k === kind ? 'on' : ''}">${icon(ENTRY_ICON[k])} ${v}</button>`).join('')}</div></div>
      <div class="row"><input type="datetime-local" id="tl-when" value="${nowLocal()}" style="width:auto"><span class="muted small">Zeitpunkt des Besuchs / Gesprächs</span></div>
      <textarea id="tl-text" placeholder="Was wurde besprochen? z. B. Besuch auf dem Hof, Interesse an neuem Mähwerk …"></textarea>
      <div class="followups" id="tl-fus"></div>
      <div class="row" style="margin:10px 0 0">
        <button type="button" class="btn sm" id="tl-addfu">${icon('plus')} Folgeaufgabe / Termin</button>
        <span style="flex:1"></span>
        <button type="button" class="btn primary" id="tl-save">Eintrag speichern</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px 0"><h3>Verlauf</h3>
      <select id="tl-filter" style="width:auto"><option value="all">Alle Einträge</option><option value="manual">Nur Besuche, Telefonate &amp; Notizen</option></select></div>
    <ul class="timeline" id="tl-list"></ul>`;
  $$('#tl-kind button', body).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$('#tl-kind button', body).forEach((x) => x.classList.toggle('on', x === b)); });
  const addFu = (k) => {
    $('#tl-fus', body).insertAdjacentHTML('beforeend', followupHtml(fuCount++, k));
    const el = $('#tl-fus', body).lastElementChild;
    $('[data-fu-del]', el).onclick = () => el.remove();
    pickedList($('[data-files]', el), $('[data-files-out]', el));
    $('[data-k=kind]', el).onchange = (e) => {
      const t = $('[data-k=title]', el);
      const defaults = { anruf: 'Kunde anrufen', termin: 'Termin', besuch: 'Besuch', angebot: 'Angebot erstellen', aufgabe: '' };
      if (!t.value || Object.values(defaults).includes(t.value)) t.value = defaults[e.target.value];
    };
  };
  $('#tl-addfu', body).onclick = () => addFu('anruf');
  $('#tl-save', body).onclick = async () => {
    const text = $('#tl-text', body).value.trim();
    if (!text) { $('#tl-text', body).focus(); return toast('Bitte einen Text eingeben', true); }
    const tasks = $$('.followup', body).map((el) => {
      const o = {}; $$('[data-k]', el).forEach((i) => { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; }); return o;
    });
    const fuFiles = $$('.followup', body).map((el) => [...$('[data-files]', el).files]);
    for (const t of tasks) if (!t.due_date) return toast('Bitte für jede Folgeaufgabe ein Datum angeben', true);
    try {
      $('#tl-save', body).disabled = true;
      const res = await api(`/customers/${c.id}/entries`, { method: 'POST', body: { kind, text, happened_at: $('#tl-when', body).value, tasks } });
      for (let i = 0; i < (res.taskIds || []).length; i++) if (fuFiles[i]?.length) await uploadTaskFiles(res.taskIds[i], fuFiles[i]);
      const others = tasks.filter((t) => Number(t.assigned_to) !== state.me.id).length;
      toast(`Eintrag gespeichert${tasks.length ? ` · ${tasks.length} Aufgabe${tasks.length > 1 ? 'n' : ''} angelegt` : ''}${others ? ' · Kollegen benachrichtigt' : ''}`);
      reload('zeitleiste');
    } catch (e) { fail(e); $('#tl-save', body).disabled = false; }
  };
  const tasksByEntry = {};
  for (const t of d.tasks) if (t.entry_id) (tasksByEntry[t.entry_id] ||= []).push(t);
  const drawList = () => {
    const list = d.entries.filter((e) => filter === 'all' || e.kind !== 'system');
    let lastDay = '';
    $('#tl-list', body).innerHTML = list.length ? list.map((e) => {
      const day = e.happened_at.slice(0, 10);
      const sep = day !== lastDay ? `<li class="day-sep">${relDay(day)}${day !== todayISO() && day !== addDays(todayISO(), -1) ? '' : ` · ${deDate(day)}`}</li>` : '';
      lastDay = day;
      const mine = e.created_by === state.me.id || state.me.role === 'admin';
      const linked = tasksByEntry[e.id] || [];
      if (e.kind === 'system') {
        return `${sep}<li class="it k-system"><div class="dot">${icon('info')}</div><div class="box">${e.happened_at.slice(11, 16)} · ${esc(e.text)}${e.author ? ` – <b>${esc(e.author)}</b>` : ''}</div></li>`;
      }
      return `${sep}<li class="it k-${e.kind}"><div class="dot">${icon(ENTRY_ICON[e.kind] || 'note')}</div><div class="box">
        <div class="hd"><b>${ENTRY_KINDS[e.kind] || e.kind}</b><span>${e.happened_at.slice(11, 16)} Uhr</span><span>·</span>${avatar(e.author, e.created_by, 'xs')}<span>${esc(e.author || 'Unbekannt')}</span>${e.updated_at ? '<span class="small">(bearbeitet)</span>' : ''}
          ${mine ? `<span class="acts"><button class="btn ghost icon sm" data-edit="${e.id}" title="Bearbeiten">${icon('edit')}</button><button class="btn ghost icon sm" data-del="${e.id}" title="Löschen">${icon('trash')}</button></span>` : ''}</div>
        <div class="pre">${esc(e.text)}</div>
        ${linked.length ? `<div class="linked">${linked.map((t) => `<a href="javascript:void 0" data-open-task="${t.id}">${icon(TASK_ICON[t.kind])} ${esc(TASK_KINDS[t.kind])}: ${esc(t.title)} · ${deDate(t.due_date)}${t.due_time ? ' ' + t.due_time : ''} · ${esc(t.assignee || '')} ${t.status === 'done' ? '<span class="chip ok">erledigt</span>' : ''}</a>`).join('')}</div>` : ''}
      </div></li>`;
    }).join('') : '<li class="empty">Noch keine Einträge</li>';
    $$('[data-open-task]', body).forEach((a) => a.onclick = () => openTask(Number(a.dataset.openTask), () => reload('zeitleiste')));
    $$('[data-del]', body).forEach((b) => b.onclick = async () => {
      if (!(await confirmBox('Diesen Eintrag löschen? Verknüpfte Aufgaben bleiben erhalten.'))) return;
      try { await api('/entries/' + b.dataset.del, { method: 'DELETE' }); toast('Eintrag gelöscht'); reload('zeitleiste'); } catch (e) { fail(e); }
    });
    $$('[data-edit]', body).forEach((b) => b.onclick = () => {
      const e = d.entries.find((x) => x.id === Number(b.dataset.edit));
      const m = modal({
        title: 'Eintrag bearbeiten',
        body: `<form id="ef"><div class="form-grid"><div class="field"><label>Art</label><select name="kind">${Object.entries(ENTRY_KINDS).map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Zeitpunkt</label><input type="datetime-local" name="happened_at" value="${esc(e.happened_at)}"></div>
          <div class="field full"><label>Text</label><textarea name="text" rows="6">${esc(e.text)}</textarea></div></div></form>`,
        foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="ef-save">Speichern</button>`,
      });
      $('#ef-save', m.el).onclick = async () => { try { await api('/entries/' + e.id, { method: 'PUT', body: formData($('#ef', m.el)) }); m.close(); toast('Gespeichert'); reload('zeitleiste'); } catch (err) { fail(err); } };
    });
  };
  $('#tl-filter', body).value = filter;
  $('#tl-filter', body).onchange = (e) => { filter = e.target.value; sessionStorage.setItem('tlFilter', filter); drawList(); };
  drawList();
}

function renderFiles(body, d, reload) {
  const c = d.customer;
  body.innerHTML = `<label class="files-drop" id="f-drop">${icon('upload', 'lg')}<br>Dateien hierher ziehen oder <u>auswählen</u> (Angebote, Fotos, Rechnungen … max. 25 MB)<input type="file" id="f-input" multiple hidden></label>
    ${d.files.length ? `<table class="list"><thead><tr><th>Datei</th><th class="hide-m">Größe</th><th class="hide-m">Hochgeladen</th><th></th></tr></thead><tbody>
      ${d.files.map((f) => `<tr style="cursor:default"><td><a href="/api/files/${f.id}" target="_blank" rel="noopener">${icon('file')} ${esc(f.filename)}</a></td><td class="hide-m">${fmtSize(f.size)}</td><td class="hide-m small">${deDateTime(f.created_at.replace(' ', 'T'))} · ${esc(f.uploader || '')}</td>
        <td class="nowrap" style="text-align:right"><a class="btn ghost icon sm" href="/api/files/${f.id}?download=1" title="Herunterladen">${icon('download')}</a><button class="btn ghost icon sm" data-fdel="${f.id}" title="Löschen">${icon('trash')}</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Bei diesem Kunden gibt es noch keine Dateien.</div>'}`;
  const upload = async (files) => {
    for (const file of files) {
      try {
        await api(`/customers/${c.id}/files`, { method: 'POST', raw: true, body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } });
      } catch (e) { fail(e); }
    }
    toast('Hochgeladen'); reload('dateien');
  };
  $('#f-input', body).onchange = (e) => upload([...e.target.files]);
  const drop = $('#f-drop', body);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); };
  $$('[data-fdel]', body).forEach((b) => b.onclick = async () => {
    if (!(await confirmBox('Datei löschen?'))) return;
    try { await api('/files/' + b.dataset.fdel, { method: 'DELETE' }); reload('dateien'); } catch (e) { fail(e); }
  });
}

// ======================= Aufgaben =======================
async function viewTasks(main) {
  const st = { scope: sessionStorage.getItem('tScope') || 'mine', status: 'open', kind: '', q: '' };
  main.innerHTML = `
    <div class="page-head"><h1>Aufgaben</h1><button class="btn primary" id="t-new">${icon('plus')} Neue Aufgabe</button></div>
    <div class="toolbar">
      <div class="grow"><span class="ico">${icon('search')}</span><input type="search" id="t-q" placeholder="Aufgaben oder Kunden suchen …"></div>
      <select id="t-scope"><option value="mine">Mir zugewiesen</option><option value="created">Von mir delegiert</option><option value="all">Alle Mitarbeiter</option>${state.users.filter((u) => u.active && u.id !== state.me.id).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select id="t-kind"><option value="">Alle Arten</option>${Object.entries(TASK_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <div class="btn-group"><button class="btn on" data-s="open">Offen</button><button class="btn" data-s="done">Erledigt</button></div>
    </div>
    <div class="card" id="t-list"></div>`;
  $('#t-scope').value = st.scope;
  const load = async () => {
    const rows = await api('/tasks?' + new URLSearchParams(st));
    const showA = st.scope !== 'mine';
    let html = '';
    if (st.status === 'open') {
      const t = todayISO(); const tm = addDays(t, 1); const wk = addDays(t, 7);
      const groups = [['Überfällig', rows.filter((r) => r.due_date < t), 'red'], ['Heute', rows.filter((r) => r.due_date === t)], ['Morgen', rows.filter((r) => r.due_date === tm)], ['Nächste 7 Tage', rows.filter((r) => r.due_date > tm && r.due_date <= wk)], ['Später', rows.filter((r) => r.due_date > wk)]];
      html = groups.filter((g) => g[1].length).map(([n, list, cls]) => `<div class="group-title ${cls || ''}">${n} (${list.length})</div><ul class="tasklist">${list.map((r) => taskItem(r, { showAssignee: showA })).join('')}</ul>`).join('');
    } else html = rows.length ? `<ul class="tasklist">${rows.map((r) => taskItem(r, { showAssignee: showA })).join('')}</ul>` : '';
    $('#t-list').innerHTML = html || '<div class="empty">Keine Aufgaben gefunden</div>';
    bindTaskList($('#t-list'), load);
  };
  $('#t-q').oninput = debounce((e) => { st.q = e.target.value; load(); });
  $('#t-scope').onchange = (e) => { st.scope = e.target.value; sessionStorage.setItem('tScope', st.scope); load(); };
  $('#t-kind').onchange = (e) => { st.kind = e.target.value; load(); };
  $$('[data-s]').forEach((b) => b.onclick = () => { $$('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); st.status = b.dataset.s; load(); });
  $('#t-new').onclick = () => openTaskForm({}, load);
  await load();
}

// ======================= Kalender =======================
async function viewCalendar(main) {
  const st = { month: (sessionStorage.getItem('calMonth') || todayISO().slice(0, 7)), scope: sessionStorage.getItem('calScope') || 'mine' };
  const load = async () => {
    const [y, mo] = st.month.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const start = addDays(fmtISO(first), -((first.getDay() + 6) % 7));
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const data = await api(`/calendar?from=${days[0]}&to=${days[41]}&scope=${st.scope}`);
    const showWho = st.scope !== 'mine';
    main.innerHTML = `
      <div class="page-head"><h1>${MONTHS[mo - 1]} ${y}</h1>
        <select id="cal-scope" style="width:auto"><option value="mine">Mein Kalender</option><option value="all">Alle Mitarbeiter</option>${state.users.filter((u) => u.active && u.id !== state.me.id).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        <div class="btn-group"><button class="btn" id="m-prev">${icon('left')}</button><button class="btn" id="m-today">Heute</button><button class="btn" id="m-next">${icon('right')}</button></div>
        <button class="btn primary" id="cal-new">${icon('plus')} Termin</button></div>
      <p class="muted small" style="margin-top:-8px">Tipp: Auf einen Tag klicken, um dort einen Termin anzulegen. Abo für Outlook &amp; iPhone unter <a href="#/einstellungen">Einstellungen</a>.</p>
      <div class="card"><div class="month">
        ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div class="dow">${w}</div>`).join('')}
        ${days.map((day) => {
          const items = data.tasks.filter((t) => t.due_date === day);
          const bd = data.birthdays.filter((b) => b.date === day);
          const all = [...bd.map((b) => `<div class="ev bday" data-cust="${b.id}"><div class="ttl">🎂 ${esc(custName(b))}</div></div>`), ...items.map((t) => evHtml(t, showWho))];
          return `<div class="cell ${day.slice(0, 7) !== st.month ? 'other' : ''} ${day === todayISO() ? 'today' : ''}" data-day="${day}"><span class="num">${parseISO(day).getDate()}</span>${all.slice(0, 4).join('')}${all.length > 4 ? `<span class="more">+${all.length - 4} weitere</span>` : ''}</div>`;
        }).join('')}
      </div></div>`;
    $('#cal-scope').value = st.scope;
    $('#cal-scope').onchange = (e) => { st.scope = e.target.value; sessionStorage.setItem('calScope', st.scope); load(); };
    const shift = (n) => { const d = new Date(y, mo - 1 + n, 1); st.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; sessionStorage.setItem('calMonth', st.month); load(); };
    $('#m-prev').onclick = () => shift(-1);
    $('#m-next').onclick = () => shift(1);
    $('#m-today').onclick = () => { st.month = todayISO().slice(0, 7); sessionStorage.removeItem('calMonth'); load(); };
    $('#cal-new').onclick = () => openTaskForm({ kind: 'termin', due_date: todayISO() }, load);
    $$('.ev[data-ev]', main).forEach((el) => el.onclick = (e) => { e.stopPropagation(); openTask(Number(el.dataset.ev), load); });
    $$('.ev.bday', main).forEach((el) => el.onclick = (e) => { e.stopPropagation(); location.hash = '#/kunden/' + el.dataset.cust; });
    $$('.cell', main).forEach((el) => el.onclick = (e) => { if (e.target.closest('.more')) { showDay(el.dataset.day, data, load); return; } openTaskForm({ kind: 'termin', due_date: el.dataset.day }, load); });
  };
  await load();
}
function showDay(day, data, reload) {
  const items = data.tasks.filter((t) => t.due_date === day);
  const m = modal({ title: `${WD_LONG[parseISO(day).getDay()]}, ${deDate(day)}`, body: `<ul class="tasklist">${items.map((t) => taskItem(t)).join('')}</ul>` });
  bindTaskList(m.el, () => { m.close(); reload(); });
}

// ======================= Einstellungen =======================
async function viewSettings(main) {
  const ical = await api('/me/ical');
  const isAdmin = state.me.role === 'admin';
  main.innerHTML = `
    <div class="page-head"><h1>Einstellungen</h1></div>
    <div style="display:grid;gap:18px;max-width:900px">
      <div class="card"><div class="card-head"><h2>${icon('cal', 'lg')} Kalender mit Outlook &amp; iPhone verbinden</h2></div><div class="card-body">
        <p style="margin-top:0">Ihre Termine und Aufgaben aus dem CRM erscheinen als abonnierter Kalender in Outlook und auf dem iPhone (inkl. Kundengeburtstagen). Neue Einträge werden automatisch übernommen – Outlook aktualisiert je nach Version alle paar Stunden, das iPhone je nach Einstellung alle 15 Minuten bis stündlich.</p>
        <div class="field"><label>Ihre persönliche Abo-Adresse</label><code class="url" id="ical-url">${esc(ical.https)}</code></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 16px">
          <button class="btn" id="ical-copy">${icon('link')} Adresse kopieren</button>
          <a class="btn primary" href="${esc(ical.webcal)}">${icon('cal')} Auf diesem Gerät abonnieren</a>
          <button class="btn danger" id="ical-reset">Neue Adresse erzeugen</button>
        </div>
        <div class="form-grid">
          <div><b>iPhone</b><ol class="steps"><li>Diese Seite auf dem iPhone öffnen und <i>„Auf diesem Gerät abonnieren“</i> tippen – oder:</li><li>Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → <i>Kalenderabo hinzufügen</i></li><li>Adresse einfügen → Weiter → Sichern</li></ol></div>
          <div><b>Outlook</b><ol class="steps"><li><b>Outlook (neu) / Web:</b> Kalender → Kalender hinzufügen → <i>Aus dem Internet abonnieren</i> → Adresse einfügen</li><li><b>Outlook klassisch:</b> Kalender → Kalender hinzufügen → <i>Aus dem Internet…</i> → Adresse einfügen → Ja</li></ol></div>
        </div>
        <p class="callout info small" style="margin-bottom:0">Die Adresse ist wie ein Passwort: Wer sie kennt, sieht Ihre Termine. Bei Verlust einfach „Neue Adresse erzeugen“ – die alte wird dann ungültig. Das Abo zeigt Termine aus dem CRM an; Termine, die direkt in Outlook angelegt werden, fließen nicht zurück ins CRM.</p>
      </div></div>

      <div class="card"><div class="card-head"><h2>${icon('home', 'lg')} Symbol auf dem Desktop / Handy</h2></div><div class="card-body">
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <img src="img/app-192.png" alt="" width="72" height="72" style="border-radius:16px;box-shadow:var(--shadow)">
          <div style="flex:1;min-width:240px">
            <button class="btn primary ${installPrompt ? '' : 'hidden'}" id="app-install">${icon('download')} Als App installieren</button>
            <a class="btn" href="/Bussmann-CRM.url" download>${icon('link')} Desktop-Verknüpfung herunterladen</a>
          </div>
        </div>
        <div class="form-grid" style="margin-top:14px">
          <div><b>Windows (Edge oder Chrome)</b><ol class="steps"><li>„Als App installieren“ klicken – oder in Edge: Menü <b>…</b> → Apps → <i>Diese Website als App installieren</i>, in Chrome: Menü <b>⋮</b> → Streamen, speichern und teilen → <i>Seite als App installieren</i>.</li><li>Das CRM öffnet sich dann in einem eigenen Fenster mit Bussmann-Symbol auf dem Desktop und in der Taskleiste.</li></ol></div>
          <div><b>iPhone / iPad</b><ol class="steps"><li>Seite in Safari öffnen.</li><li>Teilen-Symbol (Quadrat mit Pfeil) → <i>Zum Home-Bildschirm</i>.</li></ol><b>Android</b><ol class="steps"><li>In Chrome Menü ⋮ → <i>App installieren</i>.</li></ol></div>
        </div>
      </div></div>

      <div class="card"><div class="card-head"><h2>${icon('user', 'lg')} Mein Profil</h2></div><div class="card-body">
        <form id="me-form" class="form-grid">
          <div class="field"><label>Name</label><input type="text" name="name" value="${esc(state.me.name)}"></div>
          <div class="field"><label>Farbe im Kalender</label><input type="color" name="color" value="${esc(state.me.color || '#6a6d6e')}" style="height:38px;width:80px;padding:2px"></div>
          <div class="field full"><label class="check"><input type="checkbox" name="notify_email" ${state.me.notify_email ? 'checked' : ''}> E-Mail an ${esc(state.me.email)} bei neuen Aufgaben von Kollegen und als Erinnerung einen Tag vorher</label></div>
          <div class="field"><label>Aktuelles Passwort</label><input type="password" name="current_password" autocomplete="current-password"></div>
          <div class="field"><label>Neues Passwort</label><input type="password" name="new_password" autocomplete="new-password" minlength="8"></div>
          <div class="full"><button class="btn primary" type="submit">Speichern</button></div>
        </form>
      </div></div>

      ${isAdmin ? `
      <div class="card"><div class="card-head"><h2>${icon('users', 'lg')} Benutzer</h2><button class="btn primary sm" id="u-new">${icon('plus')} Benutzer anlegen</button></div>
        <table class="list"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th></th></tr></thead><tbody>
        ${state.users.map((u) => `<tr style="cursor:default"><td>${avatar(u.name, u.id, 'xs')} <b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrator' : 'Mitarbeiter'}</td><td>${u.active ? '<span class="chip ok">aktiv</span>' : '<span class="chip">deaktiviert</span>'}</td><td style="text-align:right"><button class="btn sm" data-uedit="${u.id}">${icon('edit')} Bearbeiten</button></td></tr>`).join('')}
        </tbody></table></div>

      <div class="card"><div class="card-head"><h2>${icon('mail', 'lg')} E-Mail-Versand (SMTP)</h2><span class="chip ${state.mailEnabled ? 'ok' : 'warn'}">${state.mailEnabled ? 'aktiv' : 'nicht eingerichtet'}</span></div><div class="card-body" id="smtp-body">Lädt …</div></div>` : ''}
    </div>`;

  $('#app-install').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === 'accepted') toast('Bussmann CRM wurde installiert'); installPrompt = null; $('#app-install').classList.add('hidden'); };
  $('#ical-copy').onclick = async () => { try { await navigator.clipboard.writeText(ical.https); toast('Adresse kopiert'); } catch { toast('Bitte manuell markieren und kopieren', true); } };
  $('#ical-reset').onclick = async () => { if (await confirmBox('Neue Abo-Adresse erzeugen? Bestehende Abos in Outlook/iPhone funktionieren dann nicht mehr und müssen neu eingerichtet werden.', 'Neu erzeugen')) { await api('/me/ical/reset', { method: 'POST', body: {} }); viewSettings(main); } };
  $('#me-form').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/me', { method: 'PUT', body: formData(e.target) }); state.me = r.user; state.users = await api('/users'); toast('Profil gespeichert'); renderShell(); route(); } catch (err) { fail(err); }
  };
  if (!isAdmin) return;
  $('#u-new').onclick = () => openUserForm();
  $$('[data-uedit]').forEach((b) => b.onclick = () => openUserForm(state.users.find((u) => u.id === Number(b.dataset.uedit))));
  const s = await api('/settings');
  $('#smtp-body').innerHTML = `
    ${s.env_override ? '<p class="callout warn small">SMTP wird über Umgebungsvariablen gesteuert; die Werte hier werden ignoriert.</p>' : ''}
    <form id="smtp-form" class="form-grid">
      <div class="field full"><label>Adresse der Anwendung (für Links in E-Mails und das Kalender-Abo)</label><input type="url" name="app_url" value="${esc(s.app_url)}" placeholder="https://crm.landtechnik-bussmann.de"></div>
      <div class="field"><label>SMTP-Server</label><input type="text" name="smtp_host" value="${esc(s.smtp_host)}" placeholder="z. B. smtp.office365.com"></div>
      <div class="field"><label>Port</label><input type="number" name="smtp_port" value="${esc(s.smtp_port || '587')}"></div>
      <div class="field"><label>Benutzername</label><input type="text" name="smtp_user" value="${esc(s.smtp_user)}" autocomplete="off"></div>
      <div class="field"><label>Passwort ${s.smtp_pass_set ? '<span class="muted">(gespeichert – leer lassen zum Beibehalten)</span>' : ''}</label><input type="password" name="smtp_pass" autocomplete="new-password"></div>
      <div class="field"><label>Absender</label><input type="text" name="smtp_from" value="${esc(s.smtp_from)}" placeholder="Bussmann CRM <crm@landtechnik-bussmann.de>"></div>
      <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="smtp_secure_cb" ${s.smtp_secure === '1' ? 'checked' : ''}> SSL/TLS direkt (Port 465)</label></div>
      <div class="full" style="display:flex;gap:8px"><button class="btn primary" type="submit">Speichern</button><button class="btn" type="button" id="smtp-test">Testmail an mich senden</button></div>
    </form>`;
  $('#smtp-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target); b.smtp_secure = b.smtp_secure_cb ? '1' : '0'; delete b.smtp_secure_cb;
    if (!b.smtp_pass) delete b.smtp_pass;
    try { const r = await api('/settings', { method: 'PUT', body: b }); state.mailEnabled = r.mailEnabled; toast('Gespeichert'); viewSettings(main); } catch (err) { fail(err); }
  };
  $('#smtp-test').onclick = async () => { try { const r = await api('/settings/testmail', { method: 'POST', body: {} }); toast('Testmail gesendet an ' + r.to); } catch (e) { fail(e); } };
}

function openUserForm(u) {
  const isEdit = !!u;
  const m = modal({
    title: isEdit ? 'Benutzer bearbeiten' : 'Benutzer anlegen',
    body: `<form id="uf" class="form-grid">
      <div class="field"><label>Name <span class="req">*</span></label><input type="text" name="name" value="${esc(u?.name || '')}" required></div>
      <div class="field"><label>E-Mail (Login) <span class="req">*</span></label><input type="email" name="email" value="${esc(u?.email || '')}" required></div>
      <div class="field"><label>${isEdit ? 'Neues Passwort (optional)' : 'Passwort'} ${isEdit ? '' : '<span class="req">*</span>'}</label><input type="text" name="password" minlength="8" ${isEdit ? '' : 'required'} autocomplete="off" placeholder="mind. 8 Zeichen"></div>
      <div class="field"><label>Rolle</label><select name="role"><option value="user" ${u?.role === 'user' ? 'selected' : ''}>Mitarbeiter</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrator</option></select></div>
      <div class="field"><label>Farbe</label><input type="color" name="color" value="${esc(u?.color || '#6a6d6e')}" style="height:38px;width:80px;padding:2px"></div>
      ${isEdit ? `<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Zugang aktiv</label></div>` : ''}
      <p class="full muted small" style="margin:0">Teilen Sie dem Kollegen Adresse, E-Mail und Passwort mit. Das Passwort kann er danach unter Einstellungen selbst ändern.</p>
    </form>`,
    foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="uf-save">Speichern</button>`,
  });
  $('#uf-save', m.el).onclick = async () => {
    const f = $('#uf', m.el); if (!f.reportValidity()) return;
    const b = formData(f); if (isEdit && !b.password) delete b.password;
    try {
      if (isEdit) await api('/users/' + u.id, { method: 'PUT', body: b }); else await api('/users', { method: 'POST', body: b });
      state.users = await api('/users'); m.close(); toast('Gespeichert'); route();
    } catch (e) { fail(e); }
  };
}

// App-Installation (Desktop-Symbol) vorbereiten
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; const b = $('#app-install'); if (b) b.classList.remove('hidden'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot();
