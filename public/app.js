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

const TYPES = ['Landwirt', 'Gartenbau', 'Forst', 'Kommune', 'Gewerbe', 'Verein', 'Privat'];
const INTERVALS = { '': 'Kein Intervall', monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfyearly: 'Halbjährlich', yearly: 'Jährlich' };
const TASK_KINDS = { anruf: 'Anruf', termin: 'Termin', besuch: 'Besuch', angebot: 'Angebot', wartung: 'Wartung', aufgabe: 'Aufgabe' };
const ABSENCE_KINDS = { urlaub: ['Urlaub', '🏖'], privat: ['Privat / geblockt', '🔒'], krank: ['Krank', '🤒'], schulung: ['Schulung / Messe', '🎓'], sonstiges: ['Abwesend', '⛔'] };
const absOn = (list, day) => (list || []).filter((a) => a.start_date <= day && a.end_date >= day);
function absHtml(a, showWho = true) {
  const [label, emo] = ABSENCE_KINDS[a.kind] || ['Abwesend', '⛔'];
  const mine = a.user_id === state.me.id;
  return `<div class="ev absence k-abs-${a.kind}" data-abs="${a.id}" title="${esc((showWho || !mine ? a.user_name + ': ' : '') + label + (a.note ? ' – ' + a.note : ''))}">
    <div class="ttl">${emo} ${showWho || !mine ? esc(a.user_name.split(' ')[0]) + ' · ' : ''}${label}</div>${a.start_time ? `<div class="t">${a.start_time}–${a.end_time}</div>` : ''}</div>`;
}
function openAbsenceForm(a = {}, reload) {
  const isEdit = !!a.id;
  const canEdit = !isEdit || a.user_id === state.me.id || state.me.role === 'admin';
  const adm = state.me.role === 'admin';
  const m = modal({
    title: isEdit ? (canEdit ? 'Abwesenheit bearbeiten' : 'Abwesenheit') : 'Abwesenheit eintragen',
    body: !canEdit ? `<div class="kv"><span class="k">Mitarbeiter</span><span>${esc(a.user_name)}</span><span class="k">Art</span><span>${ABSENCE_KINDS[a.kind]?.[1] || ''} ${esc(ABSENCE_KINDS[a.kind]?.[0] || '')}</span>
        <span class="k">Zeitraum</span><span>${deDate(a.start_date)}${a.end_date !== a.start_date ? ' – ' + deDate(a.end_date) : ''}${a.start_time ? `, ${a.start_time}–${a.end_time} Uhr` : ''}</span></div>`
      : `<form id="af"><div class="form-grid">
      ${adm ? `<div class="field"><label>Mitarbeiter</label><select name="user_id">${userOptions(a.user_id || state.me.id)}</select></div>` : ''}
      <div class="field ${adm ? '' : 'full'}"><label>Art</label><div class="seg" id="af-kind">${Object.entries(ABSENCE_KINDS).map(([k, [l, e]]) => `<button type="button" data-k="${k}" class="${(a.kind || 'urlaub') === k ? 'on' : ''}">${e} ${l}</button>`).join('')}</div></div>
      <div class="field"><label>Von <span class="req">*</span></label><input type="date" name="start_date" value="${esc(a.start_date || todayISO())}" required></div>
      <div class="field"><label>Bis</label><input type="date" name="end_date" value="${esc(a.end_date || a.start_date || todayISO())}"></div>
      <div class="field full"><label class="check"><input type="checkbox" id="af-part" ${a.start_time ? 'checked' : ''}> Nur ein paar Stunden (z. B. Arzttermin)</label></div>
      <div class="field af-time"><label>Von Uhrzeit</label><input type="time" name="start_time" value="${esc(a.start_time || '08:00')}"></div>
      <div class="field af-time"><label>Bis Uhrzeit</label><input type="time" name="end_time" value="${esc(a.end_time || '12:00')}"></div>
      <div class="field full"><label>Notiz <span class="muted">(sehen nur Sie${adm ? '' : ' und der Administrator'})</span></label><input type="text" name="note" value="${esc(a.note || '')}" placeholder="z. B. Familienurlaub, Zahnarzt …"></div>
      <div class="full callout info small">${icon('info')} Kollegen sehen im Kalender nur <b>wer</b> und <b>was</b> (z. B. „Urlaub“), keine Notiz. Wer an diesem Tag einen Termin für Sie plant, bekommt einen Hinweis.</div>
    </div></form>`,
    foot: canEdit ? `<span class="left">${isEdit ? `<button class="btn danger" id="af-del">${icon('trash')} Löschen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="af-save">Speichern</button>` : '<span class="left"></span><button class="btn" data-close>Schließen</button>',
  });
  if (!canEdit) return;
  let kind = a.kind || 'urlaub';
  $$('#af-kind button', m.el).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$('#af-kind button', m.el).forEach((x) => x.classList.toggle('on', x === b)); });
  const part = $('#af-part', m.el); const start = $('[name=start_date]', m.el); const end = $('[name=end_date]', m.el);
  const syncPart = () => { $$('.af-time', m.el).forEach((el) => el.classList.toggle('hidden', !part.checked)); if (part.checked) end.value = start.value; end.disabled = part.checked; };
  part.onchange = syncPart; syncPart();
  start.onchange = () => { if (!end.value || end.value < start.value || part.checked) end.value = start.value; };
  $('#af-save', m.el).onclick = async () => {
    const body = { ...formData($('#af', m.el)), kind, end_date: end.value };
    if (!part.checked) { body.start_time = ''; body.end_time = ''; }
    try {
      if (isEdit) await api('/absences/' + a.id, { method: 'PUT', body }); else await api('/absences', { method: 'POST', body });
      m.close(); toast('Abwesenheit gespeichert'); reload && reload();
    } catch (e) { fail(e); }
  };
  if (isEdit) $('#af-del', m.el).onclick = async () => {
    if (!(await confirmBox('Diese Abwesenheit löschen?'))) return;
    try { await api('/absences/' + a.id, { method: 'DELETE' }); m.close(); toast('Gelöscht'); reload && reload(); } catch (e) { fail(e); }
  };
}
/** Hinweis im Terminformular, wenn Zuständiger/Teilnehmer an dem Tag abwesend ist */
function bindAbsenceWarning(root, getUsers, dateEl, timeEl, out) {
  const check = debounce(async () => {
    const ids = getUsers(); const date = dateEl.value;
    if (!date || !ids.length) { out.innerHTML = ''; return; }
    const hits = await api(`/absences/check?date=${date}&time=${timeEl?.value || ''}&users=${ids.join(',')}`).catch(() => []);
    out.innerHTML = hits.length ? `<div class="callout warn small">${icon('info')} ${hits.map((h) => `<b>${esc(h.user_id === state.me.id ? 'Sie sind' : h.user_name + ' ist')}</b> an diesem Tag abwesend (${esc(h.label)}${h.start_time ? `, ${h.start_time}–${h.end_time} Uhr` : ''})`).join('<br>')}. Termin trotzdem speichern?</div>` : '';
  }, 250);
  root.addEventListener('change', check); root.addEventListener('click', (e) => { if (e.target.closest('[data-parts]')) check(); });
  check();
}
const MACHINE_CATS = ['Traktor', 'Rasentraktor', 'Aufsitzmäher', 'Rasenmäher', 'Mähroboter', 'Motorsäge', 'Freischneider', 'Heckenschere', 'Laubbläser', 'Kehrmaschine', 'Kommunaltraktor', 'Mähwerk', 'Mulcher', 'Anhänger', 'Holzspalter', 'Sonstiges'];
const tagList = (s) => String(s || '').split('|').filter(Boolean);
const tagChips = (s, cls = '') => tagList(s).map((t) => `<span class="chip tagchip ${cls}">${icon('tag')} ${esc(t)}</span>`).join(' ');
async function loadMeta() { try { state.meta = await api('/meta'); } catch { state.meta = state.meta || { tags: [], brands: [], categories: [] }; } return state.meta; }
let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  return leafletP ||= new Promise((resolve, reject) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/leaflet/leaflet.css'; document.head.append(l);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L); s.onerror = () => { leafletP = null; reject(new Error('Karte konnte nicht geladen werden')); };
    document.head.append(s);
  });
}
const OSM = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }];
const HOME_VIEW = [[51.92, 7.25], 10]; // Münsterland
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
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
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
  euro: '<path d="M17.5 6.2A7 7 0 1 0 17.5 17.8"/><path d="M4 10h9M4 14h9"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`;
const ENTRY_ICON = { besuch: 'car', telefonat: 'phone', email: 'mail', termin: 'cal', notiz: 'note', sonstiges: 'dot', system: 'info' };
const TASK_ICON = { anruf: 'phone', termin: 'cal', besuch: 'car', angebot: 'offer', wartung: 'tool', aufgabe: 'tasks' };

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
/** Auswahl weiterer Teilnehmer (Kollegen, die zum Termin mitkommen / eingeladen werden) */
const participantsHtml = (selected = []) => {
  const users = state.users.filter((u) => u.active || selected.includes(u.id));
  if (users.length < 2) return '<div class="muted small">Weitere Mitarbeiter können eingeladen werden, sobald es mehrere Benutzer gibt.</div>';
  return `<div class="parts" data-parts>${users.map((u) => `<label class="pchip"><input type="checkbox" value="${u.id}" ${selected.includes(u.id) ? 'checked' : ''}><span class="avatar xs" style="background:${esc(u.color || '#6a6d6e')}">${esc(initials(u.name))}</span>${esc(u.name)}${u.id === state.me.id ? ' (ich)' : ''}</label>`).join('')}</div>`;
};
const readParticipants = (root) => $$('[data-parts] input:checked', root).map((i) => Number(i.value));
/** Zuständigen in der Teilnehmerliste ausblenden */
function bindParticipants(root, assignSel) {
  const sync = () => $$('[data-parts] .pchip', root).forEach((l) => {
    const isLead = $('input', l).value === assignSel.value;
    l.classList.toggle('hidden', isLead);
    if (isLead) $('input', l).checked = false;
  });
  assignSel.addEventListener('change', sync); sync();
}
const partIds = (t) => (t.participant_ids ? String(t.participant_ids).split(',').map(Number) : []);
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
  const views = { '': viewDashboard, start: viewDashboard, kunden: p1 ? () => viewCustomer(Number(p1)) : viewCustomers, aufgaben: viewTasks, kalender: viewCalendar, karte: viewMap, verkaeufe: viewSales, projekte: viewProjects, einstellungen: viewSettings };
  (views[p0] || viewDashboard)(main).catch(fail);
  if (p0 === 'aufgaben' && p1) openTask(Number(p1));
}
window.addEventListener('hashchange', route);

/** Erkennt eine neu eingespielte Version und bietet Neuladen an (kein Strg+F5 nötig) */
async function watchVersion() {
  const get = () => fetch('/api/version', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const first = await get();
  if (!first) return;
  state.version = first;
  const check = async () => {
    const v = await get();
    if (!v || v.commit === first.commit || $('#update-bar')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="update-bar" class="update-bar">${icon('repeat')} <span>Eine neue Version des CRM ist da${v.subject ? `: <b>${esc(v.subject.split(/[,;]/)[0])}</b>` : ''}.</span> <button class="btn primary sm" id="update-reload">Jetzt neu laden</button></div>`);
    $('#update-reload').onclick = () => location.reload();
  };
  setInterval(check, 3 * 60000);
  window.addEventListener('focus', check);
}

async function boot() {
  try {
    const me = await api('/me', { allow401: true });
    state.me = me.user; state.mailEnabled = me.mailEnabled; state.unread = me.unread;
    state.users = await api('/users');
    renderShell();
    route();
    setInterval(refreshUnread, 60000);
    watchVersion();
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
  const nav = [['start', 'home', 'Übersicht'], ['kunden', 'users', 'Kunden'], ['karte', 'map', 'Karte'], ['aufgaben', 'tasks', 'Aufgaben'], ['kalender', 'cal', 'Kalender'], ['projekte', 'target', 'Projekte'], ['verkaeufe', 'euro', 'Verkäufe'], ['einstellungen', 'gear', 'Einstellungen']];
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
    <nav class="mobile-nav">${nav.filter(([r]) => !['karte', 'verkaeufe'].includes(r)).map(([r, i, l]) => `<a href="#/${r === 'start' ? '' : r}" data-r="${r}">${icon(i, 'lg')}${l === 'Einstellungen' ? 'Mehr' : l}</a>`).join('')}</nav>
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
        ${t.participant_names ? `<span title="Weitere Teilnehmer: ${esc(t.participant_names)}">${icon('users')} ${partIds(t).includes(state.me.id) && t.assigned_to !== state.me.id ? 'eingeladen · ' : ''}mit ${esc(t.participant_names)}</span>` : ''}
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
      ${t.participant_names ? `<span class="k">Teilnehmer</span><span>${esc(t.participant_names)}</span>` : ''}
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

function customerPicker(container, initial, onChange) {
  let selected = initial;
  const render = () => {
    container.innerHTML = selected
      ? `<div class="selected-cust">${icon('user')}<a href="#/kunden/${selected.id}" target="_blank">${esc(selected.name)}</a><button type="button" class="btn ghost sm" data-clear>${icon('x')}</button></div>`
      : `<input type="search" placeholder="Kunde suchen (optional)" data-q autocomplete="off"><div class="picker-results hidden" data-res></div>`;
    if (selected) { $('[data-clear]', container).onclick = () => { selected = null; render(); onChange && onChange(null); }; return; }
    const q = $('[data-q]', container); const res = $('[data-res]', container);
    q.oninput = debounce(async () => {
      if (!q.value.trim()) { res.classList.add('hidden'); return; }
      const rows = await api('/search?q=' + encodeURIComponent(q.value));
      res.innerHTML = rows.map((c) => `<div data-id="${c.id}" data-name="${esc(custName(c))}">${esc(custName(c))} <span class="muted small">${esc(c.city || '')}</span></div>`).join('') || '<div class="muted">Kein Treffer</div>';
      res.classList.remove('hidden');
      $$('[data-id]', res).forEach((d) => d.onclick = () => { selected = { id: Number(d.dataset.id), name: d.dataset.name }; render(); onChange && onChange(selected); });
    }, 200);
  };
  render();
  return { get: () => (selected ? selected.id : null), set: (c) => { selected = c; render(); onChange && onChange(c); } };
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
    <div class="field full"><label>Weitere Teilnehmer <span class="muted">(werden eingeladen, bekommen eine E-Mail und sehen den Termin in ihrem Kalender)</span></label>${participantsHtml(partIds(t))}</div>
    ${prefix ? '' : '<div class="full" id="tf-abs"></div>'}
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
  bindParticipants(m.el, $('[name=assigned_to]', m.el));
  bindAbsenceWarning(m.el, () => [Number($('[name=assigned_to]', m.el).value), ...readParticipants(m.el)], $('[name=due_date]', m.el), $('[name=due_time]', m.el), $('#tf-abs', m.el));
  $('#tf-save', m.el).onclick = async () => {
    const f = $('#tf', m.el);
    if (!f.reportValidity()) return;
    const body = { ...formData(f), customer_id: picker.get(), participants: readParticipants(m.el) };
    try {
      let taskId = t.id;
      if (isEdit) await api('/tasks/' + t.id, { method: 'PUT', body });
      else taskId = (await api('/tasks', { method: 'POST', body })).id;
      const files = [...$('#tf-files', m.el).files];
      if (files.length) { $('#tf-save', m.el).disabled = true; $('#tf-save', m.el).textContent = 'Lädt hoch …'; await uploadTaskFiles(taskId, files); }
      m.close();
      const invited = body.participants.filter((id) => id !== state.me.id && !partIds(t).includes(id)).length;
      const other = (Number(body.assigned_to) !== state.me.id ? ` – ${state.users.find((u) => u.id === Number(body.assigned_to))?.name} wurde benachrichtigt` : '')
        + (invited ? ` – ${invited} Teilnehmer eingeladen` : '');
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
                ${absOn(d.absences, day).map((a) => absHtml(a, state.dashScope !== 'mine')).join('')}
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
    $$('.ev[data-abs]', main).forEach((el) => el.onclick = () => openAbsenceForm(d.absences.find((a) => a.id === Number(el.dataset.abs)), load));
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
    ${showWho && t.assignee ? `<div class="who">${esc(t.assignee)}${t.participant_names ? ' + ' + esc(t.participant_names) : ''}</div>` : (t.participant_names ? `<div class="who">${icon('users')} +${partIds(t).length}</div>` : '')}
  </div>`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y) / 864e5 + 1) / 7);
}

// ======================= Kundenliste =======================
const CONTACT_TABS = [
  ['', 'Alle Kunden', 'all'],
  ['m1', 'Kontakt im letzten Monat', 'm1'],
  ['m3', 'vor 1–3 Monaten', 'm3'],
  ['m6', 'vor 3–6 Monaten', 'm6'],
  ['old', 'länger als 6 Monate / nie', 'old'],
];
const CUST_DEFAULTS = { q: '', type: '', status: '', sort: 'name', owner: '', interval: '', extra: '', contact: '', tag: '' };
async function viewCustomers(main) {
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem('custFilter') || '{}'); } catch { /* egal */ }
  const st = { ...CUST_DEFAULTS, ...saved };
  if (sessionStorage.getItem('custQ')) { st.q = sessionStorage.getItem('custQ'); sessionStorage.removeItem('custQ'); }
  const save = () => { try { sessionStorage.setItem('custFilter', JSON.stringify(st)); } catch { /* egal */ } };
  const others = state.users.filter((u) => u.active && u.id !== state.me.id);
  const meta = await loadMeta();
  main.innerHTML = `
    <div class="page-head"><h1>Kunden</h1>
      <button class="btn" id="c-import">${icon('upload')} Excel-Import</button>
      <button class="btn" id="c-mimport">${icon('tool')} Maschinen-Import</button>
      <button class="btn" id="c-export" title="Exportiert die aktuell gefilterte Liste">${icon('download')} Export</button>
      <button class="btn primary" id="c-new">${icon('plus')} Kunde anlegen</button></div>
    <div class="card" style="margin-bottom:14px"><div class="tabs ctabs" id="c-contact">${CONTACT_TABS.map(([k, l]) => `<button data-c="${k}" class="${st.contact === k ? 'on' : ''}">${l} <span class="badge grey" data-cnt="${k || 'all'}"></span></button>`).join('')}</div></div>
    <div class="toolbar">
      <div class="grow"><span class="ico">${icon('search')}</span><input type="search" id="c-q" placeholder="Suchen nach Name, Ort, PLZ, Straße, E-Mail, Telefon, Info …" value="${esc(st.q)}"></div>
      <select id="c-sort" title="Sortierung"><option value="name">Sortierung: Name</option><option value="city">Ort</option><option value="zip">PLZ</option><option value="contact">Letzter Kontakt (neueste)</option><option value="contact_old">Letzter Kontakt (am längsten her)</option><option value="newest">Neu angelegt</option></select>
    </div>
    <div class="filters">
      <div class="seg" id="c-status"><button data-s="">Alle</button><button data-s="buyer">${icon('check')} Kaufende Kunden</button><button data-s="lead" class="lead-btn">Interessenten</button></div>
      <select id="c-type" title="Kundenart"><option value="">Alle Kundenarten</option>${TYPES.map((t) => `<option>${t}</option>`).join('')}<option value="none">ohne Kundenart</option></select>
      <select id="c-owner" title="Betreuer"><option value="">Alle Betreuer</option><option value="me">Meine Kunden</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}<option value="none">ohne Betreuer</option></select>
      <select id="c-interval" title="Besuchsintervall"><option value="">Alle Intervalle</option><option value="any">mit Besuchsintervall</option>${Object.entries(INTERVALS).filter(([k]) => k).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="none">ohne Intervall</option></select>
      <select id="c-tag" title="Schlagwort"><option value="">Alle Schlagworte</option>${meta.tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`).join('')}</select>
      <select id="c-extra" title="Weitere Filter"><option value="">Weitere Filter …</option><option value="visit_due">Besuch fällig / überfällig</option><option value="service_due">Wartung fällig (nächste 30 Tage)</option><option value="machines">mit erfassten Maschinen</option><option value="open_tasks">mit offenen Aufgaben</option><option value="no_tasks">ohne offene Aufgaben</option><option value="bday_month">Geburtstag diesen Monat</option><option value="new30">in den letzten 30 Tagen angelegt</option><option value="no_phone">ohne Telefonnummer</option><option value="no_email">ohne E-Mail</option><option value="no_geo">Adresse auf Karte nicht gefunden</option></select>
      <button class="btn ghost sm hidden" id="c-reset">${icon('x')} Filter zurücksetzen</button>
    </div>
    <div class="card"><div class="table-wrap" id="c-table"></div></div>`;
  const syncControls = () => {
    $('#c-sort').value = st.sort; $('#c-type').value = st.type; $('#c-tag').value = st.tag; $('#c-owner').value = st.owner; $('#c-interval').value = st.interval; $('#c-extra').value = st.extra;
    $$('#c-status button').forEach((b) => b.classList.toggle('on', b.dataset.s === st.status));
    $$('#c-contact button').forEach((b) => b.classList.toggle('on', b.dataset.c === st.contact));
    const active = ['type', 'status', 'owner', 'interval', 'extra', 'tag', 'q'].some((k) => st[k]);
    $('#c-reset').classList.toggle('hidden', !active);
    ['c-type', 'c-owner', 'c-interval', 'c-extra', 'c-tag'].forEach((id) => $('#' + id).classList.toggle('active', !!$('#' + id).value));
  };
  const load = async () => {
    save(); syncControls();
    const data = await api('/customers?' + new URLSearchParams(st));
    for (const [k, v] of Object.entries(data.counts || {})) { const el = $(`[data-cnt="${k}"]`); if (el) el.textContent = v; }
    const adm = state.me.role === 'admin';
    $('#c-table').innerHTML = data.rows.length ? `<div class="bulkbar hidden" id="c-bulk"><span id="c-bulk-n"></span>
        <button class="btn sm" data-bulk="buyer">${icon('check')} Als kaufender Kunde</button>
        <button class="btn sm" data-bulk="lead">Als Interessent</button>
        <select id="c-bulk-type" class="sm" style="width:auto"><option value="">Kundenart setzen …</option>${TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
        <select id="c-bulk-owner" class="sm" style="width:auto"><option value="">Betreuer setzen …</option>${userOptions(null)}</select>
        <button class="btn sm" id="c-bulk-tag">${icon('tag')} Schlagwort …</button>
        ${adm ? `<button class="btn danger sm" id="c-bulk-del">${icon('trash')} Löschen</button>` : ''}</div>
      <div class="legend"><span class="sw lead"></span> grün = Interessent (noch kein kaufender Kunde) · <span>${data.counts?.buyers ?? 0} kaufende Kunden, ${(data.counts?.all ?? 0) - (data.counts?.buyers ?? 0)} Interessenten in dieser Auswahl</span></div>
      <table class="list"><thead><tr><th style="width:36px"><input type="checkbox" id="c-all" title="Alle auswählen"></th><th>Name</th><th>Ort</th><th class="hide-m">Kundenart</th><th class="hide-m">E-Mail</th><th>Telefon</th><th class="hide-m">Betreuer</th><th class="hide-m">Letzter Kontakt</th></tr></thead><tbody>
      ${data.rows.map((c) => `<tr data-id="${c.id}" class="${c.is_buyer ? '' : 'lead'}"><td onclick="event.stopPropagation()"><input type="checkbox" class="c-sel" value="${c.id}"></td>
        <td class="name">${esc(custName(c))}${c.is_buyer ? '' : ' <span class="chip lead">Interessent</span>'}${c.company && c.company !== c.last_name ? `<div class="muted small" style="font-weight:400">${esc(c.company)}</div>` : ''}${c.tags ? `<div class="tagrow">${tagChips(c.tags, 'xs')}</div>` : ''}</td>
        <td>${esc([c.zip, c.city].filter(Boolean).join(' '))}</td>
        <td class="hide-m">${c.customer_type ? `<span class="chip t-${c.customer_type}">${c.customer_type}</span>` : ''}</td>
        <td class="hide-m">${c.email ? `<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>` : ''}</td>
        <td class="nowrap">${[c.mobile, c.phone].filter(Boolean).map((n) => `<a href="${telHref(n)}" onclick="event.stopPropagation()">${esc(n)}</a>`).join('<br>')}</td>
        <td class="hide-m">${c.owner_name ? `${avatar(c.owner_name, c.owner_id, 'xs')} ${esc(c.owner_name)}` : ''}</td>
        <td class="hide-m nowrap">${c.last_contact ? `${deDate(c.last_contact)} <span class="muted small">${agoText(c.last_contact)}</span>` : '<span class="muted">noch kein Kontakt</span>'}${c.open_tasks ? ` <span class="badge grey" title="offene Aufgaben">${c.open_tasks}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table>
      <div class="list-foot"><span>${data.rows.length}${data.more ? '+' : ''} von ${data.total} Kunden</span><span>Klick auf eine Zeile öffnet den Kunden</span></div>`
      : `<div class="empty">${data.total ? 'Keine Kunden für diese Auswahl.' : 'Noch keine Kunden. Legen Sie den ersten Kunden an oder importieren Sie eine Excel-Liste.'}</div>`;
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/kunden/' + tr.dataset.id; });
    if (data.rows.length) {
      const sel = () => $$('.c-sel:checked').map((cb) => Number(cb.value));
      const upd = () => { const n = sel().length; $('#c-bulk').classList.toggle('hidden', !n); $('#c-bulk-n').textContent = `${n} ausgewählt`; };
      $$('.c-sel').forEach((cb) => cb.onchange = upd);
      $('#c-all').onchange = (e) => { $$('.c-sel').forEach((cb) => { cb.checked = e.target.checked; }); upd(); };
      const bulk = async (body, msg) => { try { const r = await api('/customers/bulk-update', { method: 'POST', body: { ids: sel(), ...body } }); toast(`${r.updated} Kunden ${msg}`); load(); } catch (e) { fail(e); } };
      $$('[data-bulk]').forEach((b) => b.onclick = () => bulk({ is_buyer: b.dataset.bulk === 'buyer' }, b.dataset.bulk === 'buyer' ? 'als kaufende Kunden markiert' : 'als Interessenten markiert'));
      $('#c-bulk-type').onchange = (e) => e.target.value && bulk({ customer_type: e.target.value }, `auf „${e.target.value}“ gesetzt`);
      $('#c-bulk-owner').onchange = (e) => e.target.value && bulk({ owner_id: Number(e.target.value) }, 'neuem Betreuer zugeordnet');
      $('#c-bulk-tag').onclick = () => {
        const m = modal({
          title: `Schlagwort für ${sel().length} Kunden`,
          body: `<div class="field"><label>Schlagwort</label><input type="text" id="bt-tag" list="bt-list" placeholder="z. B. Messe 2026"><datalist id="bt-list">${meta.tags.map((t) => `<option value="${esc(t.tag)}">`).join('')}</datalist></div>`,
          foot: `<span class="left"><button class="btn" id="bt-rm">Entfernen</button></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="bt-add">Hinzufügen</button>`,
        });
        const go = (k) => { const v = $('#bt-tag', m.el).value.trim(); if (!v) return $('#bt-tag', m.el).focus(); m.close(); bulk({ [k]: v }, k === 'add_tag' ? `mit „${v}“ markiert` : `– „${v}“ entfernt`).then(loadMeta); };
        $('#bt-add', m.el).onclick = () => go('add_tag'); $('#bt-rm', m.el).onclick = () => go('remove_tag');
        $('#bt-tag', m.el).focus();
      };
      if (adm) $('#c-bulk-del').onclick = async () => {
        const ids = sel();
        if (!(await confirmBox(`<b>${ids.length} Kunden</b> mit allen Einträgen, Aufgaben und Dateien endgültig löschen?`))) return;
        try { const r = await api('/customers/bulk-delete', { method: 'POST', body: { ids } }); toast(`${r.deleted} Kunden gelöscht`); load(); } catch (e) { fail(e); }
      };
    }
  };
  $('#c-q').oninput = debounce((e) => { st.q = e.target.value; load(); }, 200);
  $('#c-sort').onchange = (e) => { st.sort = e.target.value; load(); };
  [['c-type', 'type'], ['c-owner', 'owner'], ['c-interval', 'interval'], ['c-extra', 'extra'], ['c-tag', 'tag']].forEach(([id, k]) => { $('#' + id).onchange = (e) => { st[k] = e.target.value; load(); }; });
  $$('#c-status button').forEach((b) => b.onclick = () => { st.status = b.dataset.s; load(); });
  $$('#c-contact button').forEach((b) => b.onclick = () => {
    st.contact = b.dataset.c;
    if (st.contact && st.sort === 'name') st.sort = st.contact === 'm1' ? 'contact' : 'contact_old';
    load();
  });
  $('#c-reset').onclick = () => { Object.assign(st, { ...CUST_DEFAULTS, contact: st.contact, sort: st.sort }); $('#c-q').value = ''; load(); };
  $('#c-new').onclick = () => openCustomerForm({}, (id) => { location.hash = '#/kunden/' + id; });
  $('#c-import').onclick = () => openImport(load);
  $('#c-mimport').onclick = () => openMachineImport(load);
  $('#c-export').onclick = () => { location.href = '/api/customers/export.xlsx?' + new URLSearchParams(st); };
  if (window.innerWidth > 860) $('#c-q').focus();
  await load();
}
function agoText(s) {
  const days = Math.round((parseISO(todayISO()) - parseISO(s)) / 864e5);
  if (days <= 0) return '(heute)';
  if (days === 1) return '(gestern)';
  if (days < 31) return `(vor ${days} Tagen)`;
  const m = Math.round(days / 30.4);
  return m < 12 ? `(vor ${m} Mon.)` : `(vor ${Math.floor(days / 365)} J.)`;
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
      <div class="field"><label>Betreuer (Hauptzuständiger)</label><select name="owner_id">${userOptions(c.owner_id || state.me.id)}</select></div>
      <div class="field full"><label>Schlagworte <span class="muted">(mit Komma trennen)</span></label><input type="text" name="tags" id="cf-tags" value="${esc(tagList(c.tags).join(', '))}" placeholder="z. B. Messe 2026, Interesse Mähroboter" autocomplete="off"><div class="tag-suggest" id="cf-tag-sug"></div></div>
      <div class="field full"><label class="check buyer-check"><input type="checkbox" name="is_buyer" ${c.is_buyer ? 'checked' : ''}> <b>Kaufender Kunde</b> <span class="muted">– hat bereits bei uns gekauft (ohne Haken = Interessent, in der Liste grün)</span></label></div>
      ${isEdit ? '' : '<div class="field full"><label>Infofeld (wichtige Infos, stehen immer oben)</label><textarea name="info" rows="3"></textarea></div>'}
      <div class="full callout info small">${icon('repeat')} Mit Besuchsintervall legt das CRM automatisch eine Besuchsaufgabe an (fällig: letzter Besuch + Intervall) und erinnert einen Tag vorher.</div>
    </div></form>`,
    foot: `<span class="left">${isEdit && state.me.role === 'admin' ? `<button class="btn danger" id="cf-del">${icon('trash')} Kunde löschen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="cf-save">Speichern</button>`,
  });
  (state.meta ? Promise.resolve(state.meta) : loadMeta()).then((meta) => {
    const box = $('#cf-tag-sug', m.el); const inp = $('#cf-tags', m.el);
    const draw = () => {
      const have = inp.value.split(',').map((x) => x.trim().toLowerCase());
      box.innerHTML = meta.tags.filter((t) => !have.includes(t.tag.toLowerCase())).slice(0, 15).map((t) => `<button type="button" class="chip tagchip" data-t="${esc(t.tag)}">+ ${esc(t.tag)}</button>`).join('');
      $$('[data-t]', box).forEach((b) => b.onclick = () => { inp.value = [...inp.value.split(',').map((x) => x.trim()).filter(Boolean), b.dataset.t].join(', '); draw(); });
    };
    inp.oninput = draw; draw();
  });
  $('#cf-save', m.el).onclick = async () => {
    const f = $('#cf', m.el);
    if (!f.reportValidity()) return;
    try {
      const body = formData(f);
      let id = c.id;
      if (isEdit) await api('/customers/' + c.id, { method: 'PUT', body });
      else id = (await api('/customers', { method: 'POST', body })).id;
      m.close(); toast(isEdit ? 'Kunde gespeichert' : 'Kunde angelegt'); loadMeta();
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

// ======================= Maschinen-Import =======================
const MI_FIELDS = [['', '– ignorieren –'], ['category', 'Art / Gerätetyp'], ['brand', 'Marke / Hersteller'], ['model', 'Modell / Typ'], ['serial', 'Seriennummer'], ['year', 'Baujahr'], ['purchase_date', 'Kaufdatum'], ['sold_by_us', 'Bei uns gekauft (ja/nein)'], ['service_interval', 'Wartungsintervall'], ['last_service', 'Letzte Wartung'], ['next_service', 'Nächste Wartung'], ['hours', 'Betriebsstunden'], ['notes', 'Bemerkung'],
  ['customer_no', 'Kunde: Kundennr.'], ['customer_name', 'Kunde: Name (Vor- und Nachname)'], ['first_name', 'Kunde: Vorname'], ['last_name', 'Kunde: Nachname'], ['company', 'Kunde: Firma'], ['street', 'Kunde: Straße'], ['zip', 'Kunde: PLZ'], ['city', 'Kunde: Ort'], ['email', 'Kunde: E-Mail'], ['mobile', 'Kunde: Handy'], ['phone', 'Kunde: Telefon']];
function openMachineImport(reload) {
  const m = modal({
    title: 'Maschinen aus Excel importieren', wide: true,
    body: `<div>
      <p>Jede Zeile = eine Maschine. Das CRM ordnet sie automatisch dem passenden Kunden zu – über <b>Kundennr.</b> (aus dem CRM-Export), <b>E-Mail</b>, <b>Telefon</b> oder <b>Name</b> (bei gleichen Namen zusätzlich PLZ/Ort). Erkannte Spalten u. a.: <i>Art, Marke/Hersteller, Modell/Typ, Seriennummer, Baujahr, Kaufdatum, Bei uns gekauft, Wartungsintervall, Letzte/Nächste Wartung, Betriebsstunden, Bemerkung</i>.</p>
      <p><a href="/api/import/machines-template.xlsx">${icon('download')} Vorlage herunterladen</a></p>
      <div id="mi-dups"></div>
      <label class="files-drop" id="mi-drop" style="display:block;margin:16px 0">${icon('upload', 'lg')}<br>Excel-Datei hierher ziehen oder <u>auswählen</u><input type="file" id="mi-file" accept=".xlsx,.xls,.csv,.ods" hidden></label>
      <div id="mi-preview"></div></div>`,
    foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="mi-go" disabled>Importieren</button>`,
  });
  let rows = []; let fileBuf = null; let overrides = {};
  const checkDups = async () => {
    const d = await api('/machines/duplicates').catch(() => null);
    const box = $('#mi-dups', m.el); if (!box) return;
    if (!d || !d.machines) { box.innerHTML = ''; return; }
    const adm = state.me.role === 'admin';
    box.innerHTML = `<div class="callout warn" style="margin:10px 0"><b>${d.machines} doppelte Maschine${d.machines > 1 ? 'n' : ''}</b> bei ${d.groups} Kunden gefunden, z. B. ${d.examples.map(esc).join('; ')}.
      ${adm ? `<div style="margin-top:8px"><button class="btn sm primary" id="mi-dedupe">${icon('check')} Jetzt zusammenführen</button> <span class="muted small">Die Angaben werden zusammengelegt (z. B. Gerätetyp aus der neuen, Wartung aus der alten Zeile), dann bleibt je Maschine ein Eintrag.</span></div>` : '<div class="small" style="margin-top:6px">Ein Administrator kann sie hier zusammenführen.</div>'}</div>`;
    if (adm) $('#mi-dedupe', m.el).onclick = async () => {
      if (!(await confirmBox(`<b>${d.machines} doppelte Maschinen</b> zusammenführen? Von jeder Maschine bleibt ein Eintrag mit allen Angaben übrig.`, 'Zusammenführen'))) return;
      try { const r = await api('/machines/dedupe', { method: 'POST', body: {} }); toast(`${r.removed} doppelte Maschinen zusammengeführt`); checkDups(); reload && reload(); } catch (e) { fail(e); }
    };
  };
  checkDups();
  const draw = (mapping) => {
    const ok = rows.filter((r) => !r._error);
    const matched = ok.filter((r) => r.customer_id);
    const amb = ok.filter((r) => !r.customer_id && r._candidates);
    const none = ok.filter((r) => !r.customer_id && !r._candidates);
    const unmapped = (mapping || []).filter((x) => !x.field).map((x) => x.column);
    const status = (r, i) => r._error ? `<span class="chip red">${r._error}</span>`
      : r.customer_id ? `<span class="chip ok" title="erkannt über ${esc(r._via || 'Auswahl')}">${icon('check')} ${esc(r._customer_name || '')}</span>${r._existing ? ' <span class="chip warn" title="Gleiche Seriennummer schon beim Kunden – wird nur ergänzt">vorhanden</span>' : ''} <button class="btn ghost sm" data-pick="${i}" title="anderen Kunden wählen">${icon('edit')}</button>`
        : r._candidates ? `<select data-cand="${i}" class="sm" style="width:auto;max-width:240px"><option value="">${r._candidates.length} Kunden passen – bitte wählen</option>${r._candidates.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.city)}</option>`).join('')}</select>`
          : `<span class="chip red">kein Kunde gefunden</span> <button class="btn ghost sm" data-pick="${i}">zuordnen …</button>`;
    $('#mi-preview', m.el).innerHTML = `
      <div class="callout ${none.length || amb.length ? 'warn' : 'info'}"><b>${rows.length}</b> Zeilen gelesen: <b>${matched.length}</b> Maschinen einem Kunden zugeordnet${amb.length ? `, <b>${amb.length}</b> mit mehreren möglichen Kunden (bitte auswählen)` : ''}${none.length ? `, <b>${none.length}</b> ohne passenden Kunden` : ''}.
        ${unmapped.length ? `<br>Nicht erkannte Spalten (werden ignoriert): ${unmapped.map(esc).join(', ')}` : ''}</div>
      <details class="mi-map" ${unmapped.length ? 'open' : ''}><summary>${icon('edit')} Spalten-Zuordnung prüfen${unmapped.length ? ` – <b>${unmapped.length} Spalte${unmapped.length > 1 ? 'n' : ''} nicht erkannt</b>` : ''}</summary>
        <div class="mi-map-grid">${(mapping || []).map((x) => `<label><span title="${esc(x.column)}">${esc(x.column)}</span><select data-col="${x.index}" class="${x.field ? '' : 'unmapped'}">${MI_FIELDS.map(([k, l]) => `<option value="${k}" ${(x.field || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div></details>
      ${none.length ? `<label class="check" style="margin:10px 0"><input type="checkbox" id="mi-create"> <span>Nicht gefundene Kunden <b>neu anlegen</b> (sonst werden diese Zeilen übersprungen)</span></label>` : ''}
      <div class="table-wrap" style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:6px;margin-top:10px"><table class="list"><thead><tr><th>Kunde in der Datei</th><th>Zugeordnet zu</th><th>Art</th><th>Marke</th><th>Modell</th><th>Seriennr.</th><th>Baujahr</th><th>Kauf</th><th>Nächste Wartung</th></tr></thead><tbody>
      ${rows.slice(0, 500).map((r, i) => `<tr style="cursor:default"><td>${esc(r._label)}</td><td class="nowrap">${status(r, i)}</td><td>${esc(r.category)}</td><td>${esc(r.brand)}</td><td>${esc(r.model)}</td><td>${esc(r.serial)}</td><td>${r.year || ''}</td><td>${deDate(r.purchase_date)}</td><td>${deDate(r.next_service)}${r.service_interval ? ` <span class="muted small">${INTERVALS[r.service_interval]}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${rows.length > 500 ? '<p class="muted small">Vorschau zeigt die ersten 500 Zeilen.</p>' : ''}`;
    $$('[data-col]', m.el).forEach((s) => s.onchange = () => { overrides[s.dataset.col] = s.value; preview(); });
    $$('[data-cand]', m.el).forEach((s) => s.onchange = () => {
      const r = rows[Number(s.dataset.cand)]; const c = r._candidates.find((x) => x.id === Number(s.value));
      if (c) { r.customer_id = c.id; r._customer_name = `${c.name} (${c.city})`; r._via = 'Auswahl'; draw(mapping); }
    });
    $$('[data-pick]', m.el).forEach((b) => b.onclick = () => {
      const r = rows[Number(b.dataset.pick)];
      const pm = modal({ title: `Kunde für „${esc([r.brand, r.model].filter(Boolean).join(' ') || r.category)}“ wählen`, body: `<p class="muted small">In der Datei: ${esc(r._label || '–')}</p><div id="mi-pick"></div>`, foot: '<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="mi-pick-ok">Übernehmen</button>' });
      const picker = customerPicker($('#mi-pick', pm.el), null);
      setTimeout(() => $('#mi-pick input', pm.el)?.focus(), 50);
      $('#mi-pick-ok', pm.el).onclick = () => {
        const id = picker.get(); if (!id) return;
        r.customer_id = id; r._customer_name = $('#mi-pick a', pm.el)?.textContent || 'gewählt'; r._via = 'Auswahl'; pm.close(); draw(mapping);
      };
    });
    const cr = $('#mi-create', m.el);
    const upd = () => { $('#mi-go', m.el).disabled = !(matched.length || (cr && cr.checked)); $('#mi-go', m.el).textContent = `${matched.length + (cr && cr.checked ? none.length : 0)} Maschinen importieren`; };
    if (cr) cr.onchange = upd;
    upd();
  };
  const preview = async () => {
    try {
      const res = await api('/import/machines/preview?map=' + encodeURIComponent(JSON.stringify(overrides)), { method: 'POST', raw: true, body: fileBuf, headers: { 'Content-Type': 'application/octet-stream' } });
      rows = res.rows; draw(res.mapping);
    } catch (e) { fail(e); }
  };
  const handle = async (file) => {
    if (!file) return;
    fileBuf = await file.arrayBuffer(); overrides = {};
    preview();
  };
  $('#mi-file', m.el).onchange = (e) => handle(e.target.files[0]);
  const drop = $('#mi-drop', m.el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  $('#mi-go', m.el).onclick = async () => {
    const createMissing = !!$('#mi-create', m.el)?.checked;
    const list = rows.filter((r) => !r._error && (r.customer_id || (createMissing && !r._candidates)));
    $('#mi-go', m.el).disabled = true;
    try {
      const res = await api('/import/machines/commit', { method: 'POST', body: { rows: list, createMissing } });
      m.close();
      toast(`${res.created} Maschinen importiert${res.updated ? `, ${res.updated} vorhandene ergänzt` : ''}${res.newCustomers ? `, ${res.newCustomers} Kunden neu angelegt` : ''}${res.skipped.length ? `, ${res.skipped.length} übersprungen` : ''}`);
      loadMeta(); reload && reload();
    } catch (e) { fail(e); $('#mi-go', m.el).disabled = false; }
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
        <h1>${esc([c.salutation && c.salutation !== 'Firma' ? c.salutation : '', c.first_name, c.last_name].filter(Boolean).join(' '))} ${c.customer_type ? `<span class="chip t-${c.customer_type}">${c.customer_type}</span>` : ''}
          <button class="chip ${c.is_buyer ? 'ok' : 'lead'} chip-btn" id="cu-buyer" title="Klicken zum Umschalten">${c.is_buyer ? `${icon('check')} Kaufender Kunde` : 'Interessent'}</button> ${tagChips(c.tags)}</h1>
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
          <li>${icon('tag')}<div><span class="k">Kundenart</span>${esc(c.customer_type || '–')} · ${c.is_buyer ? 'kaufender Kunde' : 'Interessent'}</div></li>
          <li>${icon('clock')}<div><span class="k">Letzter Kontakt</span>${c.last_contact ? `${deDate(c.last_contact)} <span class="muted">${agoText(c.last_contact)}</span>` : 'noch keiner'}</div></li>
          <li>${icon('repeat')}<div><span class="k">Besuchsintervall</span>${c.visit_interval ? INTERVALS[c.visit_interval] : 'keins'}</div></li>
          <li>${icon('user')}<div><span class="k">Betreuer (Hauptzuständiger)</span>${esc(c.owner_name || '–')}</div></li>
        </ul>
        <div class="section-title">Lage</div>
        <div id="cmap-box"></div>
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
            <button data-tab="maschinen" class="${curTab === 'maschinen' ? 'on' : ''}">Maschinen ${d.machines.length ? `<span class="badge grey">${d.machines.length}</span>` : ''}</button>
            <button data-tab="projekte" class="${curTab === 'projekte' ? 'on' : ''}">Projekte ${d.projects.filter((p) => !p.closed).length ? `<span class="badge grey">${d.projects.filter((p) => !p.closed).length}</span>` : ''}</button>
            <button data-tab="dateien" class="${curTab === 'dateien' ? 'on' : ''}">Dateien ${d.files.length ? `<span class="badge grey">${d.files.length}</span>` : ''}</button>
          </div>
          <div id="tab-body"></div>
        </div>
      </div>
    </div>`;

  $('#cu-edit').onclick = () => openCustomerForm(c, () => reload());
  $('#cu-buyer').onclick = async () => {
    const to = !c.is_buyer;
    if (!(await confirmBox(to ? `<b>${esc(custName(c))}</b> als kaufenden Kunden markieren?` : `<b>${esc(custName(c))}</b> wieder als Interessent führen?`, 'Ja, umstellen'))) return;
    try { await api('/customers/' + c.id, { method: 'PUT', body: { is_buyer: to } }); toast(to ? 'Als kaufender Kunde markiert' : 'Als Interessent markiert'); reload(); } catch (e) { fail(e); }
  };
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
    } else if (t === 'maschinen') renderMachines(body, d, reload);
    else if (t === 'projekte') renderCustomerProjects(body, d, reload);
    else renderFiles(body, d, reload);
  };
  renderCustomerMap($('#cmap-box'), c, reload);
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
    <div class="field" style="margin-top:10px"><label>Weitere Teilnehmer (optional)</label>${participantsHtml([])}</div><div data-abs-out style="margin-top:8px"></div>
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
    bindParticipants(el, $('[data-k=assigned_to]', el));
    bindAbsenceWarning(el, () => [Number($('[data-k=assigned_to]', el).value), ...readParticipants(el)], $('[data-k=due_date]', el), $('[data-k=due_time]', el), $('[data-abs-out]', el));
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
      const o = {}; $$('[data-k]', el).forEach((i) => { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; }); o.participants = readParticipants(el); return o;
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

// ======================= Maschinen beim Kunden =======================
function serviceState(m) {
  if (!m.next_service) return '';
  const t = todayISO();
  if (m.next_service < t) return 'over';
  if (m.next_service <= addDays(t, 30)) return 'soon';
  return '';
}
function renderMachines(body, d, reload) {
  const ms = d.machines;
  body.innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center"><button class="btn primary sm" id="m-new">${icon('plus')} Maschine hinzufügen</button><span class="muted small">Mit „Nächste Wartung“ erinnert das CRM automatisch (Aufgabe + Kalender).</span></div>
    ${ms.length ? `<div class="machines">${ms.map((m) => `<div class="machine" data-mid="${m.id}">
      <div class="mi">${icon('tool', 'lg')}</div>
      <div class="mb">
        <div class="mt">${esc([m.brand, m.model].filter(Boolean).join(' ') || m.category)} ${m.category && (m.brand || m.model) ? `<span class="chip">${esc(m.category)}</span>` : ''} ${m.sold_by_us ? '<span class="chip ok">von uns verkauft</span>' : ''}</div>
        <div class="meta">${[m.serial ? `Seriennr. <b>${esc(m.serial)}</b>` : '', m.year ? `Baujahr ${m.year}` : '', m.purchase_date ? `gekauft ${deDate(m.purchase_date)}` : ''].filter(Boolean).join(' · ') || '<span class="muted">keine weiteren Angaben</span>'}</div>
        <div class="meta">${m.last_service ? `Letzte Wartung ${deDate(m.last_service)}` : ''}${m.next_service ? `${m.last_service ? ' · ' : ''}<span class="svc ${serviceState(m)}">${icon('clock')} Nächste Wartung ${deDate(m.next_service)}</span>` : ''}${m.service_interval ? ` · ${INTERVALS[m.service_interval]}` : ''}</div>
        ${m.notes ? `<div class="pre small" style="margin-top:6px">${esc(m.notes)}</div>` : ''}
      </div>
      <div class="ma"><button class="btn ghost icon sm" data-medit="${m.id}" title="Bearbeiten">${icon('edit')}</button></div>
    </div>`).join('')}</div>` : '<div class="empty">Noch keine Maschinen erfasst</div>'}`;
  $('#m-new', body).onclick = () => openMachineForm({ customer_id: d.customer.id }, () => reload('maschinen'));
  $$('[data-mid]', body).forEach((el) => el.onclick = () => openMachineForm(ms.find((m) => m.id === Number(el.dataset.mid)), () => reload('maschinen')));
}
async function openMachineForm(m, onSaved) {
  const isEdit = !!m.id;
  const meta = state.meta || await loadMeta();
  const cats = [...new Set([...MACHINE_CATS, ...meta.categories])];
  const md = modal({
    title: isEdit ? 'Maschine bearbeiten' : 'Maschine hinzufügen',
    body: `<form id="mf"><div class="form-grid">
      <div class="field"><label>Art</label><input type="text" name="category" list="mf-cats" value="${esc(m.category || '')}" placeholder="z. B. Rasentraktor"><datalist id="mf-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Marke / Hersteller</label><input type="text" name="brand" list="mf-brands" value="${esc(m.brand || '')}" placeholder="z. B. Husqvarna"><datalist id="mf-brands">${meta.brands.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Modell / Typ</label><input type="text" name="model" value="${esc(m.model || '')}"></div>
      <div class="field"><label>Seriennummer</label><input type="text" name="serial" value="${esc(m.serial || '')}"></div>
      <div class="field"><label>Baujahr</label><input type="number" name="year" min="1950" max="2100" value="${esc(m.year || '')}"></div>
      <div class="field"><label>Kaufdatum</label><input type="date" name="purchase_date" value="${esc(m.purchase_date || '')}"></div>
      <div class="field full"><label class="check"><input type="checkbox" name="sold_by_us" ${m.sold_by_us ? 'checked' : ''}> Bei uns gekauft</label></div>
      <div class="field"><label>Wartungsintervall</label><select name="service_interval">${Object.entries(INTERVALS).map(([k, v]) => `<option value="${k}" ${(m.service_interval || '') === k ? 'selected' : ''}>${k ? v : 'kein Intervall'}</option>`).join('')}</select></div>
      <div class="field"><label>Letzte Wartung</label><input type="date" name="last_service" value="${esc(m.last_service || '')}"></div>
      <div class="field"><label>Nächste Wartung <span class="muted">(leer = aus Intervall)</span></label><input type="date" name="next_service" value="${esc(m.next_service || '')}"></div>
      <div class="field full"><label>Notizen</label><textarea name="notes" rows="3" placeholder="z. B. Betriebsstunden, Zubehör, Besonderheiten">${esc(m.notes || '')}</textarea></div>
      <div class="full callout info small">${icon('tool')} Bei „Nächste Wartung“ legt das CRM eine Wartungsaufgabe für den Betreuer an und erinnert einen Tag vorher. Wird sie erledigt, wird die nächste Wartung automatisch nach dem Intervall geplant.</div>
    </div></form>`,
    foot: `<span class="left">${isEdit ? `<button class="btn danger" id="mf-del">${icon('trash')} Entfernen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="mf-save">Speichern</button>`,
  });
  $('#mf-save', md.el).onclick = async () => {
    try {
      const body = formData($('#mf', md.el));
      if (isEdit) await api('/machines/' + m.id, { method: 'PUT', body });
      else await api(`/customers/${m.customer_id}/machines`, { method: 'POST', body });
      md.close(); toast('Maschine gespeichert'); loadMeta(); onSaved && onSaved();
    } catch (e) { fail(e); }
  };
  if (isEdit) $('#mf-del', md.el).onclick = async () => {
    if (!(await confirmBox('Diese Maschine beim Kunden entfernen? Offene Wartungsaufgaben werden mit gelöscht.', 'Entfernen'))) return;
    try { await api('/machines/' + m.id, { method: 'DELETE' }); md.close(); toast('Maschine entfernt'); onSaved && onSaved(); } catch (e) { fail(e); }
  };
}

// ======================= Verkaufsprojekte =======================
const PROJ_BRANDS = ['Weidemann', 'Massey Ferguson', 'Fendt', 'Kubota', 'TAFE', 'Kandi', 'Husqvarna', 'Stihl'];
const PROJ_TYPES_BY = {
  Weidemann: ['Hoftrac', 'eHoftrac (elektrisch)', 'Radlader', 'Teleskopradlader', 'Teleskoplader'],
  'Massey Ferguson': ['Traktor', 'Kompakttraktor', 'Teleskoplader', 'Mähdrescher', 'Presse', 'Mähwerk', 'Schwader', 'Wender'],
  Fendt: ['Traktor', 'Mähdrescher', 'Feldhäcksler', 'Presse', 'Mähwerk', 'Schwader'],
  Kubota: ['Kompakttraktor', 'Traktor', 'Aufsitzmäher', 'Minibagger', 'Utility Vehicle'],
  TAFE: ['Kompakttraktor', 'Traktor'],
  Husqvarna: ['Aufsitzmäher', 'Rasentraktor', 'Mähroboter', 'Motorsäge'],
  Stihl: ['Mähroboter', 'Motorsäge', 'Freischneider', 'Akku-Geräte'],
};
const projTypes = (brand) => [...new Set([...(PROJ_TYPES_BY[brand] || []), 'Traktor', 'Kompakttraktor', 'Hoftrac', 'Radlader', 'Teleskoplader', 'Gebrauchtmaschine', 'Sonstiges'])];
const PROJ_STATUS_CLS = { Gewonnen: 'won', Verloren: 'lost', Verhandlung: 'hot', 'Angebot erstellt': 'hot', Zurückgestellt: 'paused' };
const ampel = (p) => (p.ampel ? `<span class="ampel ${p.ampel}" title="${{ rot: 'Wiedervorlage überfällig', gelb: 'fällig in den nächsten 7 Tagen', gruen: 'Wiedervorlage später' }[p.ampel]}"></span>` : '<span class="ampel"></span>');
const eur0 = (n) => (n == null ? '' : Math.round(n).toLocaleString('de-DE') + ' €');
let projMeta = null;
const projMetaLoad = async () => (projMeta ||= await api('/projects?meta=1'));

function projRow(p, { showCust = true } = {}) {
  return `<tr data-pid="${p.id}" class="${p.status === 'Verloren' ? 'p-lost' : p.status === 'Gewonnen' ? 'p-won' : ''}">
    <td class="hide-m muted">${p.id}</td>
    ${showCust ? `<td class="hide-m"><b>${esc(p.kunde_name)}</b><div class="muted small">${esc(p.ort_name || '')}</div><div class="muted small hide-l-only">${esc(p.ansprech)}${p.telefon ? ' · ' + esc(p.telefon) : ''}</div></td>` : ''}
    <td class="hide-l">${esc(p.ansprech)}<div class="muted small">${esc(p.telefon)}</div></td>
    <td>${showCust ? `<div class="show-m-only"><b>${esc(p.kunde_name)}</b> <span class="muted small">${esc(p.ort_name || '')}</span></div>` : ''}<span class="brand-tag">${esc(p.brand)}</span> ${esc([p.typ, p.modell].filter(Boolean).join(' '))}<div class="muted small">${esc(p.ausstattung)}</div><div class="show-m-only"><span class="pstat ${PROJ_STATUS_CLS[p.status] || ''}">${esc(p.status)}</span> ${p.preis ? eur0(p.preis) : ''}</div></td>
    <td class="hide-m"><span class="pstat ${PROJ_STATUS_CLS[p.status] || ''}">${esc(p.status)}</span><div class="muted small">${Math.round(p.prob * 100)} %${p.finanzierung && p.finanzierung !== 'Offen' ? ' · ' + esc(p.finanzierung) : ''}</div></td>
    <td class="nowrap">${ampel(p)} ${deDate(p.faellig)}<div class="muted small hide-m wrap">${esc(p.naechster)}</div></td>
    <td class="num nowrap hide-m">${eur0(p.preis)}${p.preis ? `<div class="muted small">gew. ${eur0(p.preis * p.prob)}</div>` : ''}</td>
    <td class="num nowrap hide-m">${eur0(p.inz_wert)}<div class="muted small wrap">${esc(p.inzahlung)}</div></td>
    <td class="nowrap hide-l">${deDate(p.abschluss)}</td>
    <td class="nowrap hide-l">${deDate(p.liefer)}</td>
    <td class="hide-m">${p.user_name ? `${avatar(p.user_name, p.user_id, 'xs')} ${esc(p.user_name.split(' ')[0])}` : ''}</td>
  </tr>`;
}
const projHead = (showCust = true) => `<thead><tr><th class="hide-m" data-k="id">Nr.</th>${showCust ? '<th class="hide-m" data-k="kunde_name">Kunde / Ort</th>' : ''}<th class="hide-l" data-k="ansprech">Ansprechpartner</th><th data-k="modell">Maschine</th><th class="hide-m" data-k="prob">Status</th><th data-k="faellig">Wiedervorlage</th><th class="num hide-m" data-k="preis">Angebot netto</th><th class="num hide-m" data-k="inz_wert">Inzahlungn.</th><th class="hide-l" data-k="abschluss">Abschluss</th><th class="hide-l" data-k="liefer">Lieferung</th><th class="hide-m" data-k="user_name">Verkäufer</th></tr></thead>`;

async function viewProjects(main) {
  const st = { status: '', user: sessionStorage.getItem('pUser') || 'all', q: '', brand: '', sortK: 'faellig', dir: 1 };
  const meta = await projMetaLoad();
  main.innerHTML = `
    <div class="page-head"><h1>Verkaufsprojekte</h1><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" id="p-pdf" target="_blank" rel="noopener">${icon('file')} Als PDF</a><button class="btn primary" id="p-new">${icon('plus')} Neues Projekt</button></div></div>
    <div id="p-kpis" class="kpis"></div>
    <div class="toolbar">
      <div class="grow"><span class="ico">${icon('search')}</span><input type="search" id="p-q" placeholder="Suchen: Kunde, Ort, Modell, Notiz …"></div>
      <select id="p-status" style="width:auto"><option value="">Alle offenen</option><option value="*">Alle Projekte</option>${meta.statuses.map(([s, pr]) => `<option value="${esc(s)}">${esc(s)} (${Math.round(pr * 100)} %)</option>`).join('')}</select>
      <select id="p-brand" style="width:auto"><option value="">Alle Marken</option>${[...new Set([...PROJ_BRANDS, ...meta.brands])].map((b) => `<option>${esc(b)}</option>`).join('')}</select>
      <select id="p-user" style="width:auto"><option value="all">Alle Verkäufer</option>${userOptions(st.user === 'all' ? null : st.user)}</select>
    </div>
    <div class="card"><div class="table-wrap" id="p-list"></div></div>
    <div class="legend" style="margin-top:10px">Wiedervorlage: ${ampel({ ampel: 'rot' })} überfällig · ${ampel({ ampel: 'gelb' })} in den nächsten 7 Tagen · ${ampel({ ampel: 'gruen' })} später — jede Wiedervorlage steht auch als Aufgabe im Kalender des Verkäufers.</div>`;
  $('#p-user').value = st.user;
  const load = async () => {
    const qs = new URLSearchParams({ status: st.status, user: st.user, q: st.q, brand: st.brand });
    $('#p-pdf').href = '/api/projects/report.html?' + qs;
    const d = await api('/projects?' + qs);
    const s = d.stats;
    $('#p-kpis').innerHTML = [['Offene Projekte', s.open], ['Angebotsvolumen offen', eur0(s.volume) || '0 €'], ['Gewichtete Pipeline', eur0(s.weighted) || '0 €'], ['Gewonnen', `${s.won} · ${eur0(s.won_volume) || '0 €'}`],
      ['Abschlussquote', s.quote == null ? '–' : s.quote + ' %'], ['Wiedervorlage überfällig', s.overdue, s.overdue > 0], ['Fällig in 7 Tagen', s.soon]]
      .map(([l, v, a]) => `<div class="kpi ${a ? 'alert' : ''}"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    const k = st.sortK;
    const rows = d.rows.sort((a, b) => { const x = a[k]; const y = b[k]; const ex = x == null || x === ''; const ey = y == null || y === ''; if (ex && ey) return 0; if (ex) return 1; if (ey) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de')) * st.dir; });
    $('#p-list').innerHTML = rows.length ? `<table class="list projects">${projHead()}<tbody>${rows.map((p) => projRow(p)).join('')}</tbody></table>`
      : `<div class="empty">${st.q || st.status || st.brand || st.user !== 'all' ? 'Keine Projekte für diesen Filter.' : 'Noch keine Projekte – leg mit „Neues Projekt“ los.'}</div>`;
    $$('#p-list th[data-k]').forEach((th) => { if (th.dataset.k === k) th.textContent += st.dir > 0 ? ' ▲' : ' ▼'; th.onclick = () => { if (st.sortK === th.dataset.k) st.dir *= -1; else { st.sortK = th.dataset.k; st.dir = 1; } load(); }; });
    $$('#p-list tr[data-pid]').forEach((tr) => tr.onclick = async () => openProjectForm(await api('/projects/' + tr.dataset.pid), load));
  };
  $('#p-q').oninput = debounce((e) => { st.q = e.target.value; load(); });
  $('#p-status').onchange = (e) => { st.status = e.target.value; load(); };
  $('#p-brand').onchange = (e) => { st.brand = e.target.value; load(); };
  $('#p-user').onchange = (e) => { st.user = e.target.value; sessionStorage.setItem('pUser', st.user); load(); };
  $('#p-new').onclick = () => openProjectForm({ brand: st.brand || localStorage.getItem('pBrand') || '' }, load);
  await load();
}

function renderCustomerProjects(body, d, reload) {
  const c = d.customer;
  body.innerHTML = `<div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center"><button class="btn primary sm" id="cp-new">${icon('plus')} Neues Verkaufsprojekt</button><a href="#/projekte" class="small">Alle Projekte</a></div>
    ${d.projects.length ? `<div class="table-wrap"><table class="list projects">${projHead(false)}<tbody>${d.projects.map((p) => projRow(p, { showCust: false })).join('')}</tbody></table></div>` : '<div class="empty">Noch keine Verkaufsprojekte für diesen Kunden.</div>'}`;
  $('#cp-new', body).onclick = () => openProjectForm({ customer_id: c.id, kunde_name: custName(c), ansprech: [c.first_name, c.last_name].filter(Boolean).join(' '), telefon: c.mobile || c.phone || '' }, () => reload('projekte'));
  $$('tr[data-pid]', body).forEach((tr) => tr.onclick = async () => openProjectForm(await api('/projects/' + tr.dataset.pid), () => reload('projekte')));
}

async function openProjectForm(p, onSaved) {
  const isEdit = !!p.id;
  const meta = await projMetaLoad();
  const sel = (name, list, val) => `<select name="${name}">${list.map((v) => `<option ${v === val ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const money = (n) => (n == null ? '' : eur2(n));
  const md = modal({
    title: isEdit ? `Projekt Nr. ${p.id} bearbeiten` : 'Neues Verkaufsprojekt', wide: true,
    body: `<form id="pf"><div class="form-grid">
      <div class="full offer-drop" id="pf-offer" tabindex="0" role="button">
        <input type="file" accept="application/pdf,image/*" hidden>
        <div class="offer-ico">${icon('file', 'lg')}</div>
        <div><b>${isEdit ? 'Neues Angebot hochladen' : 'Angebot hochladen'}</b> <span class="muted">(PDF oder Foto)</span>
          <div class="small muted">Kunde, Maschine, Preis und Ausstattung werden automatisch ausgelesen und unten eingetragen. Das Angebot wird am Projekt und beim Kunden abgelegt.</div></div>
      </div>
      <div class="full" id="pf-offer-msg">${p.offer_name ? `<div class="small">${icon('file')} Gespeichertes Angebot: <a href="/api/projects/${p.id}/offer" target="_blank" rel="noopener">${esc(p.offer_name)}</a></div>` : ''}</div>
      <div class="sec full">Kunde</div>
      <div class="field full"><label>Kunde aus dem CRM</label><div id="pf-cust"></div></div>
      <div class="field pf-free"><label>… oder Kunde / Betrieb <span class="muted">(noch nicht im CRM)</span></label><input type="text" name="kunde" value="${esc(p.customer_id ? '' : p.kunde || '')}"></div>
      <div class="field pf-free"><label>Ort</label><input type="text" name="ort" value="${esc(p.customer_id ? '' : p.ort || '')}"></div>
      <div class="field"><label>Ansprechpartner</label><input type="text" name="ansprech" value="${esc(p.ansprech || '')}"></div>
      <div class="field"><label>Telefon</label><input type="tel" name="telefon" value="${esc(p.telefon || '')}"></div>
      <div class="sec full">Maschine</div>
      <div class="field"><label>Marke <span class="req">*</span></label><select id="pf-brand-sel">${(() => { const list = [...new Set([...PROJ_BRANDS, ...meta.brands])]; const cur = p.brand || ''; return `<option value="" ${cur ? '' : 'selected'} disabled>– Marke wählen –</option>` + list.map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('') + `<option value="__other" ${cur && !list.includes(cur) ? 'selected' : ''}>Andere Marke …</option>`; })()}</select>
        <input type="text" name="brand" value="${esc(p.brand || '')}" placeholder="Marke eintragen" style="margin-top:6px;display:none"></div>
      <div class="field"><label>Maschinentyp</label><input type="text" name="typ" list="pf-types" value="${esc(p.typ || '')}"><datalist id="pf-types"></datalist></div>
      <div class="field"><label>Modell</label><input type="text" name="modell" value="${esc(p.modell || '')}" placeholder="z. B. 1390, 4080T"></div>
      <div class="field"><label>Ausstattung / Anbaugeräte</label><input type="text" name="ausstattung" value="${esc(p.ausstattung || '')}"></div>
      <div class="sec full">Angebot</div>
      <div class="field"><label>Status <span class="muted" id="pf-prob"></span></label>${sel('status', meta.statuses.map((s) => s[0]), p.status || 'Lead / Interesse')}</div>
      <div class="field"><label>Angebot netto</label><div class="money"><input type="text" inputmode="decimal" name="preis" value="${money(p.preis)}" placeholder="0,00"><span>€</span></div></div>
      <div class="field"><label>Angebot vom</label><input type="date" name="angebot_vom" value="${esc(p.angebot_vom || '')}"></div>
      <div class="field"><label>Finanzierung</label>${sel('finanzierung', meta.financing, p.finanzierung || 'Offen')}</div>
      <div class="field"><label>Inzahlungnahme</label><input type="text" name="inzahlung" value="${esc(p.inzahlung || '')}" placeholder="Maschine, Baujahr"></div>
      <div class="field"><label>Wert Inzahlungnahme</label><div class="money"><input type="text" inputmode="decimal" name="inz_wert" value="${money(p.inz_wert)}" placeholder="0,00"><span>€</span></div></div>
      <div class="sec full">Termine</div>
      <div class="field full"><label>Nächster Schritt</label><input type="text" name="naechster" value="${esc(p.naechster || '')}" placeholder="z. B. Vorführung vereinbaren, Angebot nachfassen"></div>
      <div class="field"><label>Wiedervorlage am <span class="muted">(kommt als Aufgabe in den Kalender)</span></label><input type="date" name="faellig" value="${esc(p.faellig || '')}"></div>
      <div class="field"><label>Verkäufer</label><select name="user_id">${userOptions(p.user_id || state.me.id)}</select></div>
      <div class="field"><label>Abschluss geplant</label><input type="date" name="abschluss" value="${esc(p.abschluss || '')}"></div>
      <div class="field"><label>Liefertermin</label><input type="date" name="liefer" value="${esc(p.liefer || '')}"></div>
      <div class="field full"><label>Notizen</label><textarea name="notizen" rows="3">${esc(p.notizen || '')}</textarea></div>
      <div class="full" id="pf-won"></div>
    </div></form>`,
    foot: `<span class="left">${isEdit ? `<button class="btn danger" id="pf-del">${icon('trash')} Löschen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="pf-save">Speichern</button>`,
  });
  const f = $('#pf', md.el);
  const free = () => $$('.pf-free', md.el).forEach((el) => { el.style.display = picker.get() ? 'none' : ''; });
  const picker = customerPicker($('#pf-cust', md.el), p.customer_id ? { id: p.customer_id, name: p.kunde_name || 'Kunde' } : null, async (c) => {
    free();
    if (!c) return;
    try {
      const cu = (await api('/customers/' + c.id)).customer;
      if (!f.ansprech.value) f.ansprech.value = [cu.first_name, cu.last_name].filter(Boolean).join(' ');
      if (!f.telefon.value) f.telefon.value = cu.mobile || cu.phone || '';
    } catch { /* egal */ }
  });
  free();
  const bSel = $('#pf-brand-sel', md.el);
  const brandUpd = () => {
    const other = bSel.value === '__other';
    f.brand.style.display = other ? '' : 'none';
    if (!other) f.brand.value = bSel.value;
    $('#pf-types', md.el).innerHTML = projTypes(f.brand.value).map((t) => `<option value="${esc(t)}">`).join('');
    if (!isEdit && !f.typ.value && PROJ_TYPES_BY[f.brand.value]) f.typ.placeholder = 'z. B. ' + PROJ_TYPES_BY[f.brand.value][0];
  };
  bSel.onchange = () => { brandUpd(); if (bSel.value === '__other') { f.brand.value = ''; f.brand.focus(); } };
  f.brand.oninput = () => { $('#pf-types', md.el).innerHTML = projTypes(f.brand.value).map((t) => `<option value="${esc(t)}">`).join(''); };
  brandUpd();
  const probs = Object.fromEntries(meta.statuses);
  const upd = () => {
    $('#pf-prob', md.el).textContent = `· Wahrscheinlichkeit ${Math.round((probs[f.status.value] ?? 0) * 100)} %`;
    $('#pf-won', md.el).innerHTML = f.status.value === 'Gewonnen'
      ? (p.sale_id
        ? `<div class="callout ok">${icon('check')} Gewonnen – steht unter „Verkäufe“. <button type="button" class="btn sm primary" id="pf-sale" style="margin-left:8px">${icon('euro')} Verkauf öffnen</button><div class="small muted" style="margin-top:6px">Dort noch den Einkaufspreis eintragen, damit der Deckungsbeitrag berechnet wird.</div></div>`
        : `<div class="callout ok">${icon('check')} Beim Speichern wird der Verkauf automatisch unter „Verkäufe“ eingetragen${f.inzahlung.value || f.inz_wert.value ? ', die Inzahlungnahme als Einkauf (Lager)' : ''}${picker.get() ? ' und die Maschine beim Kunden' : ''}. Danach dort nur noch den Einkaufspreis ergänzen.</div>`)
      : (p.sale_id ? `<div class="callout warn">${icon('info')} Wenn das Projekt nicht mehr „Gewonnen“ ist, wird der automatisch angelegte Verkauf wieder entfernt.</div>` : '');
    const s1 = $('#pf-sale', md.el);
    if (s1) s1.onclick = async () => { md.close(); openSaleForm(await api('/sales/' + p.sale_id), onSaved); };
  };
  f.status.onchange = upd; upd();

  // ---- Angebot hochladen und auswerten ----
  let offerFile = null;
  const drop = $('#pf-offer', md.el); const fileIn = $('input[type=file]', drop); const omsg = $('#pf-offer-msg', md.el);
  const mark = (el) => { el.classList.add('ai-filled'); el.addEventListener('input', () => el.classList.remove('ai-filled'), { once: true }); };
  const setF = (name, v, force) => {
    const el = f[name]; if (!el || v == null || v === '') return false;
    if (!force && isEdit && el.value) return false;
    el.value = v; mark(el); return true;
  };
  const custLabel = (a) => [...new Set([a.company, [a.first_name, a.last_name].filter(Boolean).join(' ')].filter(Boolean))].join(' – ');
  const applyOffer = (r) => {
    const x = r.fields; const filled = [];
    if (x.brand && (!isEdit || !f.brand.value)) {
      const opt = [...bSel.options].find((o) => o.value.toLowerCase() === x.brand.toLowerCase());
      bSel.value = opt ? opt.value : '__other'; brandUpd(); if (!opt) f.brand.value = x.brand; mark(bSel); filled.push('Marke');
    }
    if (setF('typ', x.typ)) filled.push('Typ');
    if (setF('modell', x.modell)) filled.push('Modell');
    if (setF('ausstattung', x.ausstattung)) filled.push('Ausstattung');
    if (setF('preis', x.preis != null ? eur2(x.preis) : '', true)) filled.push('Preis');
    if (setF('angebot_vom', x.angebot_vom, true)) filled.push('Angebotsdatum');
    if (setF('inzahlung', x.inzahlung)) filled.push('Inzahlungnahme');
    setF('inz_wert', x.inz_wert != null ? eur2(x.inz_wert) : '');
    if (x.finanzierung && f.finanzierung.value === 'Offen') { f.finanzierung.value = x.finanzierung; mark(f.finanzierung); }
    setF('liefer', x.liefer);
    setF('ansprech', x.ansprech); setF('telefon', x.telefon);
    if (x.notizen) { f.notizen.value = f.notizen.value ? f.notizen.value + '\n' + x.notizen : x.notizen; mark(f.notizen); }
    if ((probs[f.status.value] ?? 0) < 0.5 && !['Verloren', 'Zurückgestellt'].includes(f.status.value)) { f.status.value = 'Angebot erstellt'; mark(f.status); upd(); }
    if (!f.faellig.value) { const d = addDays(x.angebot_vom || todayISO(), 7); f.faellig.value = d <= todayISO() ? addDays(todayISO(), 1) : d; mark(f.faellig); }
    if (!f.naechster.value) { f.naechster.value = 'Angebot nachfassen'; mark(f.naechster); }
    // Kunde zuordnen
    let cust = '';
    if (!picker.get()) {
      const m = r.matches || [];
      if (m.length && (m.length === 1 || m[0].score >= m[1].score + 3)) {
        picker.set({ id: m[0].id, name: m[0].name });
        cust = `<div class="small">${icon('user')} Kunde im CRM gefunden: <b>${esc(m[0].name)}</b>${m[0].city ? ', ' + esc(m[0].city) : ''} – bitte prüfen.</div>`;
        filled.unshift('Kunde');
      } else {
        setF('kunde', x.kunde); setF('ort', x.ort);
        const a = r.address || {};
        const canNew = a.company || a.last_name;
        cust = (m.length ? `<div class="small" style="margin-bottom:6px">Welcher Kunde ist es?</div><div class="more-links" id="pf-mlist">${m.map((c) => `<button type="button" class="btn sm" data-mcust="${c.id}" data-name="${esc(c.name)}">${icon('user')} ${esc(c.name)}${c.city ? ' · ' + esc(c.city) : ''}</button>`).join('')}</div>` : '')
          + (canNew ? `<div class="small" id="pf-nc-wrap" style="margin-top:6px">${m.length ? 'Oder: ' : 'Der Kunde ist noch nicht im CRM. '}<button type="button" class="btn sm" id="pf-newcust">${icon('plus')} ${esc(custLabel(a))}${a.city ? ', ' + esc(a.city) : ''} als Kunde anlegen</button></div>` : '');
        if (x.kunde) filled.unshift('Kunde');
      }
    }
    omsg.innerHTML = `<div class="callout ok">${icon('check')} Angebot ausgelesen${filled.length ? ': ' + esc(filled.join(', ')) : ''}. Die gelb markierten Felder bitte kurz prüfen, dann speichern.${cust ? '<div style="margin-top:8px">' + cust + '</div>' : ''}</div>`;
    const chosen = (name) => { f.kunde.value = ''; f.ort.value = ''; $('#pf-mlist', omsg)?.remove(); const w = $('#pf-nc-wrap', omsg); if (w) w.remove(); const box = $('.callout', omsg); box.insertAdjacentHTML('beforeend', `<div class="small" style="margin-top:8px">${icon('user')} Kunde: <b>${esc(name)}</b></div>`); };
    $$('[data-mcust]', omsg).forEach((b) => b.onclick = () => { picker.set({ id: Number(b.dataset.mcust), name: b.dataset.name }); chosen(b.dataset.name); });
    const nc = $('#pf-newcust', omsg);
    if (nc) nc.onclick = async () => {
      try {
        const a = r.address; const tel = (a.phone || '').replace(/\s/g, '');
        const { id } = await api('/customers', { method: 'POST', body: { company: a.company, first_name: a.first_name, last_name: a.last_name || a.company, street: a.street, zip: a.zip, city: a.city, email: a.email, [/^(\+49|0049|0)1/.test(tel) ? 'mobile' : 'phone']: a.phone } });
        picker.set({ id, name: custLabel(a) }); chosen(custLabel(a) + ' (neu angelegt)');
        toast('Kunde angelegt');
      } catch (e) { fail(e); }
    };
  };
  const handleOffer = async (file) => {
    if (!file) return;
    if (!/^(application\/pdf|image\/)/.test(file.type)) { toast('Bitte ein PDF oder Foto auswählen', true); return; }
    const up = await shrinkImage(file);
    drop.classList.add('busy');
    omsg.innerHTML = `<div class="callout info"><span class="spin"></span> „${esc(file.name)}“ wird ausgewertet …${meta.ai && !/pdf/.test(file.type) ? ' das kann eine halbe Minute dauern.' : ''}</div>`;
    try {
      const r = await api('/projects/parse-offer', { method: 'POST', raw: true, body: up, headers: { 'Content-Type': up.type, 'X-Filename': encodeURIComponent(up.name) } });
      offerFile = r.file;
      if (r.fields) applyOffer(r);
      else if (r.error && r.error !== 'not_recognized') omsg.innerHTML = `<div class="callout warn">${icon('info')} ${esc(r.error)}<div class="small" style="margin-top:4px">Das Angebot wird trotzdem beim Speichern am Projekt abgelegt.</div></div>`;
      else omsg.innerHTML = `<div class="callout warn">${icon('info')} Die Angaben konnten nicht automatisch ausgelesen werden – bitte die Felder von Hand ausfüllen. „${esc(r.file.name)}“ wird beim Speichern trotzdem am Projekt abgelegt.${!r.ai && state.me.role === 'admin' ? '<div class="small" style="margin-top:4px">Fotos und Angebote anderer Firmen kann die KI-Auswertung lesen: <a href="#/einstellungen">Einstellungen → KI-Auswertung</a>.</div>' : ''}</div>`;
    } catch (e) { omsg.innerHTML = ''; fail(e); } finally { drop.classList.remove('busy'); fileIn.value = ''; }
  };
  drop.onclick = (e) => { if (e.target === fileIn || drop.classList.contains('busy')) return; fileIn.click(); };
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
  fileIn.onchange = () => handleOffer(fileIn.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleOffer(e.dataTransfer.files[0]); };

  $('#pf-save', md.el).onclick = async () => {
    const body = { ...formData(f), customer_id: picker.get(), offer_file: offerFile };
    if (!body.brand.trim()) { toast('Bitte die Marke auswählen', true); bSel.focus(); return; }
    localStorage.setItem('pBrand', body.brand);
    try {
      if (isEdit) await api('/projects/' + p.id, { method: 'PUT', body });
      else await api('/projects', { method: 'POST', body });
      md.close(); toast(body.status === 'Gewonnen' && !p.sale_id ? 'Gewonnen! Der Verkauf steht jetzt unter „Verkäufe“ – bitte dort den Einkaufspreis ergänzen' : body.faellig && !['Gewonnen', 'Verloren', 'Zurückgestellt'].includes(body.status) ? 'Gespeichert – Wiedervorlage steht im Kalender' : 'Gespeichert');
      projMeta = null; onSaved && onSaved();
    } catch (e) { fail(e); }
  };
  if (isEdit) $('#pf-del', md.el).onclick = async () => {
    if (!(await confirmBox(`Projekt Nr. ${p.id} (${esc(p.kunde_name)}) endgültig löschen?`))) return;
    try { await api('/projects/' + p.id, { method: 'DELETE' }); md.close(); toast('Projekt gelöscht'); onSaved && onSaved(); } catch (e) { fail(e); }
  };
}

// ======================= Verkäufe & Einkäufe =======================
const SALE_COND = { neu: 'Neu', gebraucht: 'Gebraucht', vorfuehr: 'Vorführmaschine' };
const pad2 = (n) => String(n).padStart(2, '0');
const eur = (n) => (n == null ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }));
const eur2 = (n) => (n == null ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const parseEur = (v) => { let s = String(v ?? '').replace(/[€\s]/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); const n = Number(s); return Number.isFinite(n) ? n : null; };
const saleMachine = (r) => [r.brand, r.model].filter(Boolean).join(' ') || r.category || 'Maschine';
const pctCls = (p) => (p == null ? '' : p < 5 ? 'neg' : p < 12 ? 'mid' : 'pos');

async function viewSales(main) {
  const adm = state.me.role === 'admin';
  const now = todayISO();
  const st = { mode: sessionStorage.getItem('sMode') || 'month', y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)), user: 'all', tab: 'all', q: '' };
  main.innerHTML = `
    <div class="page-head"><h1>Verkäufe</h1><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="s-buy">${icon('box')} Einkauf erfassen</button><button class="btn primary" id="s-new">${icon('plus')} Verkauf erfassen</button></div></div>
    <div class="toolbar">
      <div class="period"><button class="btn icon" id="s-prev" title="Zurück">${icon('left')}</button><b id="s-label"></b><button class="btn icon" id="s-next" title="Weiter">${icon('right')}</button></div>
      <div class="btn-group"><button class="btn" data-mode="month">Monat</button><button class="btn" data-mode="year">Jahr</button></div>
      ${adm ? `<select id="s-user" style="width:auto"><option value="all">Alle Verkäufer</option>${userOptions(null)}</select>` : ''}
      <div class="grow"><span class="ico">${icon('search')}</span><input type="search" id="s-q" placeholder="Maschine, Seriennr., Kunde …"></div>
      <a class="btn" id="s-pdf" target="_blank" rel="noopener">${icon('file')} PDF</a><a class="btn" id="s-xlsx">${icon('download')} Excel</a>
    </div>
    <div id="s-body"></div>`;
  const range = () => (st.mode === 'year' ? [`${st.y}-01-01`, `${st.y}-12-31`] : [`${st.y}-${pad2(st.m)}-01`, addDays(`${st.m === 12 ? st.y + 1 : st.y}-${pad2(st.m === 12 ? 1 : st.m + 1)}-01`, -1)]);
  const load = async () => {
    const [from, to] = range();
    $('#s-label').textContent = st.mode === 'year' ? String(st.y) : `${MONTHS[st.m - 1]} ${st.y}`;
    $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    const qs = new URLSearchParams({ from, to, user: st.user, q: st.q });
    $('#s-xlsx').href = '/api/sales/export.xlsx?' + qs;
    $('#s-pdf').href = '/api/sales/report.html?' + qs;
    const d = await api('/sales?' + qs);
    const s = d.summary;
    const rows = st.tab === 'lager' ? d.stock : d.rows.filter((r) => st.tab === 'all' || r.kind === st.tab);
    const lbl = st.mode === 'year' ? `im Jahr ${st.y}` : `im ${MONTHS[st.m - 1]}`;
    $('#s-body').innerHTML = `
      <div class="stats">
        <div class="card stat" data-tab="verkauf"><div class="ic">${icon('euro', 'lg')}</div><div><div class="num">${s.sales}</div><div class="lbl">Verkäufe ${lbl}</div></div></div>
        <div class="card stat" data-tab="verkauf"><div class="ic">${icon('offer', 'lg')}</div><div><div class="num">${eur(s.revenue)}</div><div class="lbl">Umsatz netto</div></div></div>
        <div class="card stat good" data-tab="verkauf"><div class="ic">${icon('check', 'lg')}</div><div><div class="num">${eur(s.margin)}</div><div class="lbl">Deckungsbeitrag${s.margin_pct != null ? ` · ${String(s.margin_pct).replace('.', ',')} %` : ''}</div></div></div>
        <div class="card stat" data-tab="lager"><div class="ic">${icon('box', 'lg')}</div><div><div class="num">${d.stock.length}</div><div class="lbl">Im Lager · ${eur(d.stock_value)} EK</div></div></div>
      </div>
      ${s.missing_ek ? `<div class="callout warn" style="margin-bottom:14px">${icon('info')} Bei ${s.missing_ek} Verkauf${s.missing_ek > 1 ? 'en' : ''} fehlt der Einkaufspreis – dort kann kein Deckungsbeitrag berechnet werden.</div>` : ''}
      ${adm && d.byUser.length > 1 ? `<div class="card" style="margin-bottom:14px"><div class="card-head"><h2>Nach Verkäufer</h2></div><div class="table-wrap"><table class="list plain"><thead><tr><th>Verkäufer</th><th class="num">Verkäufe</th><th class="num hide-m">Umsatz</th><th class="num">Deckungsbeitrag</th><th class="num hide-m">DB %</th><th class="num hide-m">Einkäufe</th></tr></thead><tbody>
        ${d.byUser.map((u) => `<tr data-user="${u.user_id || ''}"><td>${avatar(u.name, u.user_id, 'xs')} ${esc(u.name)}</td><td class="num">${u.sales}</td><td class="num hide-m">${eur(u.revenue)}</td><td class="num"><b>${eur(u.margin)}</b></td><td class="num hide-m"><span class="pct ${pctCls(u.margin_pct)}">${u.margin_pct != null ? String(u.margin_pct).replace('.', ',') + ' %' : '–'}</span></td><td class="num hide-m">${u.purchases ? `${u.purchases} · ${eur(u.purchase_sum)}` : '–'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="card">
        <div class="card-head" style="gap:10px;flex-wrap:wrap"><div class="btn-group">${[['all', 'Alle'], ['verkauf', `Verkäufe (${s.sales})`], ['einkauf', `Einkäufe (${s.purchases})`], ['lager', `Lager (${d.stock.length})`]].map(([k, l]) => `<button class="btn sm ${st.tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
          ${st.tab === 'lager' ? '<span class="muted small">Eingekaufte Maschinen, die noch nicht verkauft sind (unabhängig vom Zeitraum)</span>' : ''}</div>
        ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th class="hide-m">Datum</th><th>Maschine</th><th class="hide-m">Kunde / Lieferant</th>${adm ? '<th class="hide-m">Verkäufer</th>' : ''}<th class="num hide-m">EK</th><th class="num hide-m">VK</th><th class="num">DB</th></tr></thead><tbody>
          ${rows.map((r) => `<tr data-sid="${r.id}">
            <td class="nowrap hide-m">${deDate(r.date)}<div>${r.kind === 'verkauf' ? '<span class="chip sale">Verkauf</span>' : `<span class="chip buy">Einkauf</span>${r.sold_by_sale ? ' <span class="chip">verkauft</span>' : ''}`}</div></td>
            <td><div class="show-m-only small muted">${deDate(r.date)} · ${r.kind === 'verkauf' ? 'Verkauf' : 'Einkauf'}${r.customer_name || r.party ? ' · ' + esc(r.customer_name || r.party) : ''}</div><b>${esc(saleMachine(r))}</b>${r.category && (r.brand || r.model) ? ` <span class="chip">${esc(r.category)}</span>` : ''}<div class="muted small">${[SALE_COND[r.condition], r.serial ? 'Nr. ' + esc(r.serial) : '', r.year ? 'Bj. ' + r.year : ''].filter(Boolean).join(' · ')}</div></td>
            <td class="hide-m">${r.customer_id ? `<a href="#/kunden/${r.customer_id}" onclick="event.stopPropagation()">${esc(r.customer_name || 'Kunde')}</a>` : esc(r.party || '')}${r.customer_city ? `<div class="muted small">${esc(r.customer_city)}</div>` : ''}</td>
            ${adm ? `<td class="hide-m">${r.user_name ? `${avatar(r.user_name, r.user_id, 'xs')} ${esc(r.user_name)}` : ''}</td>` : ''}
            <td class="num nowrap hide-m">${eur(r.purchase_price)}${r.extra_costs ? `<div class="muted small">+ ${eur(r.extra_costs)} NK</div>` : ''}</td>
            <td class="num nowrap hide-m">${r.kind === 'verkauf' ? eur(r.sale_price) : ''}</td>
            <td class="num nowrap">${r.kind === 'verkauf' ? (r.margin != null ? `<b>${eur(r.margin)}</b><span class="show-m-only muted small">von ${eur(r.sale_price)}</span> <span class="pct ${pctCls(r.margin_pct)}">${String(r.margin_pct).replace('.', ',')} %</span>` : '<span class="muted small">EK fehlt</span>') : ''}</td>
          </tr>`).join('')}</tbody>
          ${st.tab !== 'lager' && st.tab !== 'einkauf' && s.sales ? `<tfoot><tr><td class="hide-m"></td><td><b>Summe Verkäufe</b></td><td class="hide-m" colspan="${adm ? 3 : 2}"></td><td class="num nowrap hide-m"><b>${eur(s.revenue)}</b></td><td class="num nowrap"><b>${eur(s.margin)}</b></td></tr></tfoot>` : ''}</table></div>`
          : `<div class="empty">${st.tab === 'lager' ? 'Keine Maschinen im Lager. Mit „Einkauf erfassen“ legen Sie eingekaufte Maschinen an.' : `Keine Einträge ${lbl}. Mit „Verkauf erfassen“ geht es los.`}</div>`}
      </div>`;
    $$('[data-t]').forEach((b) => b.onclick = () => { st.tab = b.dataset.t; load(); });
    $$('.stat[data-tab]').forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; load(); });
    $$('tr[data-user]').forEach((tr) => tr.onclick = () => { if (!tr.dataset.user) return; st.user = tr.dataset.user; $('#s-user').value = st.user; load(); });
    $$('tr[data-sid]').forEach((tr) => tr.onclick = async () => openSaleForm(await api('/sales/' + tr.dataset.sid), load));
  };
  const shift = (n) => { if (st.mode === 'year') st.y += n; else { st.m += n; if (st.m < 1) { st.m = 12; st.y--; } if (st.m > 12) { st.m = 1; st.y++; } } load(); };
  $('#s-prev').onclick = () => shift(-1); $('#s-next').onclick = () => shift(1);
  $$('[data-mode]').forEach((b) => b.onclick = () => { st.mode = b.dataset.mode; sessionStorage.setItem('sMode', st.mode); load(); });
  if (adm) $('#s-user').onchange = (e) => { st.user = e.target.value; load(); };
  $('#s-q').oninput = debounce((e) => { st.q = e.target.value; load(); });
  $('#s-new').onclick = () => openSaleForm({ kind: 'verkauf' }, load);
  $('#s-buy').onclick = () => openSaleForm({ kind: 'einkauf' }, load);
  await load();
}

async function openSaleForm(s, onSaved) {
  const isEdit = !!s.id; const adm = state.me.role === 'admin';
  const meta = state.meta || await loadMeta();
  const cats = [...new Set([...MACHINE_CATS, ...meta.categories])];
  let stock = [];
  try { stock = (await api('/sales?from=1900-01-01&to=1900-01-01')).stock; } catch { /* egal */ }
  const md = modal({
    title: isEdit ? (s.kind === 'einkauf' ? 'Einkauf bearbeiten' : 'Verkauf bearbeiten') : (s.kind === 'einkauf' ? 'Einkauf erfassen' : 'Verkauf erfassen'),
    wide: true,
    body: `<form id="sf"><div class="form-grid">
      <div class="field"><label>Art</label><div class="btn-group" id="sf-kind"><button type="button" class="btn" data-k="verkauf">Verkauf</button><button type="button" class="btn" data-k="einkauf">Einkauf</button></div></div>
      <div class="field"><label>Datum <span class="req">*</span></label><input type="date" name="date" value="${esc(s.date || todayISO())}" required></div>
      <div class="field"><label data-v="Verkäufer" data-e="Eingekauft von (Mitarbeiter)">Verkäufer</label>${adm ? `<select name="user_id">${userOptions(s.user_id || state.me.id)}</select>` : `<input type="text" value="${esc(s.user_name || state.me.name)}" disabled>`}</div>
      <div class="field"><label>Zustand</label><select name="condition">${Object.entries(SALE_COND).map(([k, v]) => `<option value="${k}" ${(s.condition || 'neu') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field full"><label data-v="Kunde (Käufer)" data-e="Gekauft von (Kunde oder Lieferant)">Kunde</label><div id="sf-cust"></div>
        <input type="text" name="party" value="${esc(s.party || '')}" placeholder="… oder Name eintragen, wenn nicht im CRM (z. B. Händler, Hersteller)" style="margin-top:6px"></div>
      <div class="field full only-v" ${stock.length ? '' : 'hidden'}><label>Aus dem Lager <span class="muted">(eigener Einkauf – übernimmt Maschine und EK)</span></label><select name="purchase_id"><option value="">– nicht aus dem Lager –</option>${stock.concat(s.purchase_id && !stock.some((x) => x.id === s.purchase_id) ? [{ id: s.purchase_id, brand: 'bisheriger Einkauf', date: '' }] : []).map((x) => `<option value="${x.id}" ${s.purchase_id === x.id ? 'selected' : ''}>${esc(saleMachine(x))}${x.serial ? ' · Nr. ' + esc(x.serial) : ''}${x.purchase_price != null ? ' · EK ' + eur(x.purchase_price) : ''}${x.date ? ' · ' + deDate(x.date) : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Maschinenart</label><input type="text" name="category" list="sf-cats" value="${esc(s.category || '')}" placeholder="z. B. Traktor"><datalist id="sf-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Marke / Hersteller</label><input type="text" name="brand" list="sf-brands" value="${esc(s.brand || '')}"><datalist id="sf-brands">${meta.brands.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Modell / Typ</label><input type="text" name="model" value="${esc(s.model || '')}"></div>
      <div class="field"><label>Seriennummer</label><input type="text" name="serial" value="${esc(s.serial || '')}"></div>
      <div class="field"><label>Baujahr</label><input type="number" name="year" min="1950" max="2100" value="${esc(s.year || '')}"></div>
      <div class="field"></div>
      <div class="field"><label>Einkaufspreis netto (EK)<span class="req only-e"> *</span></label><div class="money"><input type="text" inputmode="decimal" name="purchase_price" value="${eur2(s.purchase_price)}" placeholder="0,00"><span>€</span></div></div>
      <div class="field only-v"><label>Nebenkosten <span class="muted">(Überführung, Aufbereitung …)</span></label><div class="money"><input type="text" inputmode="decimal" name="extra_costs" value="${s.extra_costs ? eur2(s.extra_costs) : ''}" placeholder="0,00"><span>€</span></div></div>
      <div class="field only-v"><label>Verkaufspreis netto (VK) <span class="req">*</span></label><div class="money"><input type="text" inputmode="decimal" name="sale_price" value="${eur2(s.sale_price)}" placeholder="0,00"><span>€</span></div></div>
      <div class="field only-v"><label>Deckungsbeitrag</label><div class="db-box" id="sf-db">–</div></div>
      <div class="field full"><label>Notizen</label><textarea name="notes" rows="2" placeholder="z. B. Inzahlungnahme, Finanzierung, Zubehör">${esc(s.notes || '')}</textarea></div>
      ${s.machine_id ? '' : `<div class="field full only-v"><label class="check"><input type="checkbox" name="add_machine" ${isEdit ? '' : 'checked'}> Maschine beim Kunden unter „Maschinen“ eintragen (als „bei uns gekauft“, Kunde wird kaufender Kunde)</label></div>`}
    </div></form>`,
    foot: `<span class="left">${isEdit ? `<button class="btn danger" id="sf-del">${icon('trash')} Löschen</button>` : ''}</span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="sf-save">Speichern</button>`,
  });
  let kind = s.kind || 'verkauf';
  const f = $('#sf', md.el);
  const picker = customerPicker($('#sf-cust', md.el), s.customer_id ? { id: s.customer_id, name: s.customer_name || 'Kunde' } : null);
  const calc = () => {
    const ek = parseEur(f.purchase_price.value); const vk = parseEur(f.sale_price.value); const nk = parseEur(f.extra_costs.value) || 0;
    const box = $('#sf-db', md.el);
    if (ek == null || vk == null) { box.innerHTML = '<span class="muted">EK und VK eintragen</span>'; return; }
    const db = vk - ek - nk; const p = vk ? Math.round((db / vk) * 1000) / 10 : null;
    box.innerHTML = `<b class="${db < 0 ? 'neg' : ''}">${eur(db)}</b>${p != null ? ` <span class="pct ${pctCls(p)}">${String(p).replace('.', ',')} %</span>` : ''}`;
  };
  const setKind = (k) => {
    kind = k;
    $$('[data-k]', md.el).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    $$('.only-v', md.el).forEach((el) => { el.style.display = k === 'verkauf' && !(el.hasAttribute('hidden')) ? '' : 'none'; });
    $$('.only-e', md.el).forEach((el) => { el.style.display = k === 'einkauf' ? '' : 'none'; });
    $$('label[data-v]', md.el).forEach((l) => { l.textContent = k === 'verkauf' ? l.dataset.v : l.dataset.e; });
    $('.modal-head h2', md.el).textContent = `${k === 'einkauf' ? 'Einkauf' : 'Verkauf'} ${isEdit ? 'bearbeiten' : 'erfassen'}`;
  };
  $$('[data-k]', md.el).forEach((b) => b.onclick = () => setKind(b.dataset.k));
  setKind(kind);
  ['purchase_price', 'sale_price', 'extra_costs'].forEach((n) => f[n].addEventListener('input', calc)); calc();
  f.purchase_id.onchange = () => {
    const x = stock.find((y) => y.id === Number(f.purchase_id.value)); if (!x) return;
    for (const k of ['category', 'brand', 'model', 'serial', 'year']) if (x[k]) f[k].value = x[k];
    if (x.purchase_price != null) f.purchase_price.value = eur2(x.purchase_price);
    if (x.condition) f.condition.value = x.condition === 'neu' ? 'neu' : x.condition;
    calc();
  };
  $('#sf-save', md.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const body = { ...formData(f), kind, customer_id: picker.get() };
    if (body.add_machine === undefined) body.add_machine = false;
    try {
      if (isEdit) await api('/sales/' + s.id, { method: 'PUT', body });
      else await api('/sales', { method: 'POST', body });
      md.close(); toast(kind === 'einkauf' ? 'Einkauf gespeichert' : 'Verkauf gespeichert'); onSaved && onSaved();
    } catch (e) { fail(e); }
  };
  if (isEdit) $('#sf-del', md.el).onclick = async () => {
    if (!(await confirmBox('Diesen Eintrag löschen? Eine beim Kunden eingetragene Maschine bleibt bestehen.'))) return;
    try { await api('/sales/' + s.id, { method: 'DELETE' }); md.close(); toast('Gelöscht'); onSaved && onSaved(); } catch (e) { fail(e); }
  };
}

// ======================= Lage des Kunden (Mini-Karte) =======================
async function renderCustomerMap(box, c, reload) {
  const hasAddr = c.city || c.zip;
  const note = c.lat != null
    ? (c.geo_status === 'approx' ? 'Nur der Ort wurde gefunden – Pin auf den Hof ziehen, um die Lage zu korrigieren.' : 'Pin verschieben, falls die Lage nicht stimmt.')
    : !hasAddr ? 'Keine Adresse hinterlegt. Auf die Karte klicken, um die Lage zu setzen.'
      : c.geo_status === 'fail' ? 'Adresse wurde nicht gefunden. Auf die Karte klicken, um die Lage zu setzen.'
        : 'Lage wird gerade ermittelt … (dauert einen Moment)';
  box.innerHTML = `<div class="cmap" id="cmap"></div><div class="small muted" style="margin:6px 0 14px">${note}</div>`;
  let Lf;
  try { Lf = await loadLeaflet(); } catch (e) { box.innerHTML = `<div class="small muted">${esc(e.message)}</div>`; return; }
  if (!document.body.contains(box)) return;
  const map = Lf.map($('#cmap', box), { scrollWheelZoom: false, attributionControl: true });
  Lf.tileLayer(...OSM).addTo(map);
  const save = async (ll) => {
    try { await api(`/customers/${c.id}/geo`, { method: 'PUT', body: { lat: ll.lat, lng: ll.lng } }); toast('Lage gespeichert'); } catch (e) { fail(e); }
  };
  if (c.lat != null) {
    map.setView([c.lat, c.lng], c.geo_status === 'approx' ? 13 : 16);
    const mk = Lf.marker([c.lat, c.lng], { draggable: true }).addTo(map);
    mk.on('dragend', () => save(mk.getLatLng()));
  } else {
    map.setView(...HOME_VIEW);
    map.once('click', (e) => { Lf.marker(e.latlng).addTo(map); save(e.latlng).then(() => reload()); });
  }
  setTimeout(() => map.invalidateSize(), 50);
}

// ======================= Karte =======================
const CONTACT_COLORS = { m1: '#2e9b4a', m3: '#9bbf2f', m6: '#e39a12', old: '#c0292f' };
const TYPE_COLORS = { Landwirt: '#3f6b22', Gartenbau: '#8fb33a', Forst: '#22573d', Kommune: '#2a5a8a', Gewerbe: '#8a5420', Verein: '#b8860b', Privat: '#7a4fb0' };
function contactBucket(lc) {
  if (!lc) return 'old';
  const d = lc.slice(0, 10); const t = todayISO();
  const mAgo = (n) => { const x = parseISO(t); x.setMonth(x.getMonth() - n); return fmtISO(x); };
  if (d >= mAgo(1)) return 'm1'; if (d >= mAgo(3)) return 'm3'; if (d >= mAgo(6)) return 'm6'; return 'old';
}
async function viewMap(main) {
  let savedF = {};
  try { savedF = JSON.parse(sessionStorage.getItem('mapFilter') || '{}'); } catch { /* egal */ }
  const st = { q: '', status: '', type: '', owner: '', contact: '', tag: '', extra: '', color: 'status', ...savedF };
  let tour = [];
  try { tour = JSON.parse(sessionStorage.getItem('tour') || '[]'); } catch { /* egal */ }
  let cur = null; // geladene, gespeicherte Tour {id, name}
  try { cur = JSON.parse(sessionStorage.getItem('tourCur') || 'null'); } catch { /* egal */ }
  let tUser = Number(sessionStorage.getItem('tourUser')) || null; // zuerst Benutzer wählen
  const canEdit = () => tUser && (state.me.role === 'admin' || tUser === state.me.id);
  let saved = [];
  let savedSig = ''; // Stationen der geladenen Tour, um Änderungen zu erkennen
  const meta = await loadMeta();
  const others = state.users.filter((u) => u.active && u.id !== state.me.id);
  main.innerHTML = `
    <div class="page-head"><h1>Karte</h1><span class="muted small" id="mp-info"></span></div>
    <div class="filters">
      <div class="grow-s"><input type="search" id="mp-q" placeholder="Suchen …" value="${esc(st.q)}"></div>
      <select id="mp-status"><option value="">Kunden &amp; Interessenten</option><option value="buyer">nur kaufende Kunden</option><option value="lead">nur Interessenten</option></select>
      <select id="mp-type"><option value="">Alle Kundenarten</option>${TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      <select id="mp-owner"><option value="">Alle Betreuer</option><option value="me">Meine Kunden</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select id="mp-contact"><option value="">Jeder letzte Kontakt</option><option value="m1">Kontakt im letzten Monat</option><option value="m3">vor 1–3 Monaten</option><option value="m6">vor 3–6 Monaten</option><option value="old">länger als 6 Monate / nie</option></select>
      <select id="mp-tag"><option value="">Alle Schlagworte</option>${meta.tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)}</option>`).join('')}</select>
      <select id="mp-extra"><option value="">Weitere Filter …</option><option value="visit_due">Besuch fällig</option><option value="service_due">Wartung fällig</option><option value="open_tasks">mit offenen Aufgaben</option></select>
      <select id="mp-color" title="Farbe der Punkte"><option value="status">Farbe: Kunde / Interessent</option><option value="contact">Farbe: letzter Kontakt</option><option value="type">Farbe: Kundenart</option></select>
    </div>
    <div class="mapwrap">
      <div class="card mapcard"><div id="bigmap"></div><div class="map-legend" id="mp-legend"></div></div>
      <aside class="card tour"><div class="card-head"><h2>${icon('car')} <span id="tour-title">Tour</span></h2><span class="badge grey" id="tour-n">0</span></div>
        <div class="tour-saved"><label class="small muted">Benutzer</label><select id="tour-user"><option value="">– Benutzer wählen –</option>${state.users.filter((u) => u.active || u.id === state.me.id).map((u) => `<option value="${u.id}">${esc(u.name)}${u.id === state.me.id ? ' (ich)' : ''}</option>`).join('')}</select>
          <label class="small muted" style="margin-top:6px">Touren</label><select id="tour-sel" title="Gespeicherte Touren"></select></div>
        <div id="tour-list"></div>
        <div class="tour-foot"><a class="btn primary sm" id="tour-go" target="_blank" rel="noopener">${icon('pin')} Route in Google Maps</a><button class="btn sm" id="tour-save">${icon('check')} Speichern</button><button class="btn sm" id="tour-more" title="Weitere Aktionen">…</button></div>
      </aside>
    </div>`;
  ['status', 'type', 'owner', 'contact', 'tag', 'extra', 'color'].forEach((k) => { $('#mp-' + k).value = st[k]; });
  let Lf;
  try { Lf = await loadLeaflet(); } catch (e) { $('#bigmap').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const map = Lf.map('bigmap', { preferCanvas: true }).setView(...HOME_VIEW);
  Lf.tileLayer(...OSM).addTo(map);
  const layer = Lf.layerGroup().addTo(map);
  const tourLayer = Lf.layerGroup().addTo(map); // Tour-Stationen: nummerierte Markierung über dem Punkt
  let drawMarks = null;
  let firstFit = true; let timer = null; let lastPoints = [];
  const addrOf = (p) => [p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const sig = (list) => list.map((t) => t.id).join(',');
  const toStop = (c) => ({ id: c.id, name: custName(c), addr: addrOf(c), lat: c.lat, lng: c.lng });
  const drawSaved = () => {
    $('#tour-user').value = tUser || '';
    $('#tour-user').classList.toggle('ai-filled', !tUser);
    $('#tour-sel').disabled = !tUser;
    $('#tour-save').disabled = !canEdit(); $('#tour-more').disabled = !tUser;
    if (!tUser) { $('#tour-sel').innerHTML = '<option value="">Erst oben den Benutzer wählen</option>'; return; }
    $('#tour-sel').innerHTML = `<option value="">${saved.length ? `Gespeicherte Touren (${saved.length}) …` : 'Noch keine gespeicherten Touren'}</option>`
      + saved.map((t) => `<option value="${t.id}" ${cur && cur.id === t.id ? 'selected' : ''}>${esc(t.name)} (${t.stops.length})</option>`).join('');
  };
  const loadSaved = async () => { saved = []; if (tUser) { try { saved = await api('/tours?user=' + tUser); } catch { saved = []; } } if (cur && !saved.some((t) => t.id === cur.id)) { cur = null; savedSig = ''; } drawSaved(); };
  $('#tour-user').onchange = async () => {
    tUser = Number($('#tour-user').value) || null;
    try { sessionStorage.setItem('tourUser', tUser || ''); } catch { /* egal */ }
    await loadSaved(); drawTour();
  };
  const askName = (title, val) => new Promise((resolve) => {
    let out = null;
    const m = modal({ title, body: `<form id="tn"><div class="field"><label>Name der Tour</label><input type="text" name="name" maxlength="100" value="${esc(val || '')}" placeholder="z. B. Dienstag Billerbeck / Darup" required></div></form>`,
      foot: `<span class="left"></span><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="tn-ok">Speichern</button>`, onClose: () => resolve(out) });
    const ok = () => { const v = $('#tn', m.el).name.value.trim(); if (!v) return; out = v; m.close(); };
    $('#tn-ok', m.el).onclick = ok; $('#tn', m.el).onsubmit = (e) => { e.preventDefault(); ok(); };
  });
  const saveAs = async () => {
    if (!tUser) { toast('Bitte zuerst den Benutzer wählen', true); $('#tour-user').focus(); return; }
    if (!canEdit()) { toast('Touren für andere Benutzer kann nur ein Administrator speichern', true); return; }
    if (!tour.length) { toast('Erst Kunden zur Tour hinzufügen', true); return; }
    const name = await askName('Tour speichern', cur ? cur.name + ' (Kopie)' : '');
    if (!name) return;
    try { const t = await api('/tours', { method: 'POST', body: { name, stops: tour.map((x) => x.id), user_id: tUser } }); cur = { id: t.id, name: t.name }; savedSig = sig(tour); toast('Tour gespeichert'); await loadSaved(); drawTour(); } catch (e) { fail(e); }
  };
  $('#tour-save').onclick = async () => {
    if (!cur) return saveAs();
    if (!tour.length) { toast('Die Tour ist leer', true); return; }
    try { await api('/tours/' + cur.id, { method: 'PUT', body: { stops: tour.map((x) => x.id) } }); savedSig = sig(tour); toast(`„${cur.name}“ gespeichert`); await loadSaved(); drawTour(); } catch (e) { fail(e); }
  };
  $('#tour-sel').onchange = async () => {
    const t = saved.find((x) => x.id === Number($('#tour-sel').value));
    if (!t) return;
    if (tour.length && sig(tour) !== savedSig && !(await confirmBox('Die aktuelle Tour ist nicht gespeichert. Trotzdem die andere Tour laden?', 'Laden'))) { drawSaved(); return; }
    cur = { id: t.id, name: t.name }; tour = t.stops.map(toStop); savedSig = sig(tour); drawTour();
    const pts = t.stops.filter((c) => c.lat != null);
    if (pts.length) map.fitBounds(pts.map((c) => [c.lat, c.lng]), { padding: [40, 40], maxZoom: 13 });
  };
  $('#tour-more').onclick = (e) => {
    e.stopPropagation();
    $('.tour-menu')?.remove();
    const menu = document.createElement('div'); menu.className = 'tour-menu card';
    menu.innerHTML = `<button data-a="new">${icon('plus')} Neue Tour beginnen</button>` + (canEdit() ? `<button data-a="saveas">${icon('check')} Speichern unter …</button>` : '')
      + (cur && canEdit() ? `<button data-a="rename">${icon('edit')} „${esc(cur.name)}“ umbenennen</button><button data-a="del" class="danger">${icon('trash')} „${esc(cur.name)}“ löschen</button>` : '');
    $('.tour').appendChild(menu);
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
    menu.onclick = async (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
      menu.remove(); document.removeEventListener('click', off);
      if (a === 'new') { if (tour.length && sig(tour) !== savedSig && !(await confirmBox('Die aktuelle Tour ist nicht gespeichert. Trotzdem neu beginnen?', 'Neu beginnen'))) return; tour = []; cur = null; savedSig = ''; drawSaved(); drawTour(); }
      if (a === 'saveas') saveAs();
      if (a === 'rename') { const n = await askName('Tour umbenennen', cur.name); if (!n) return; try { await api('/tours/' + cur.id, { method: 'PUT', body: { name: n } }); cur.name = n; await loadSaved(); drawTour(); } catch (err) { fail(err); } }
      if (a === 'del') { if (!(await confirmBox(`Tour „${esc(cur.name)}“ löschen? Die Kunden bleiben natürlich erhalten.`))) return; try { await api('/tours/' + cur.id, { method: 'DELETE' }); toast('Tour gelöscht'); cur = null; savedSig = ''; await loadSaved(); drawTour(); } catch (err) { fail(err); } }
    };
  };
  const drawTour = () => {
    try { sessionStorage.setItem('tour', JSON.stringify(tour)); sessionStorage.setItem('tourCur', JSON.stringify(cur)); } catch { /* egal */ }
    $('#tour-n').textContent = tour.length;
    if (drawMarks) drawMarks();
    const dirty = cur && sig(tour) !== savedSig;
    $('#tour-title').innerHTML = cur ? `${esc(cur.name)}${dirty ? ' <span class="small muted">· geändert</span>' : ''}` : 'Tour';
    $('#tour-save').classList.toggle('primary-soft', !!dirty || (!cur && tour.length > 0));
    $('#tour-list').innerHTML = tour.length ? `<ol class="tourlist">${tour.map((t, i) => `<li><div><b>${esc(t.name)}</b><div class="small muted">${esc(t.addr)}</div></div>
      <span class="acts">${i ? `<button class="btn ghost icon sm" data-up="${i}" title="nach oben">${icon('left')}</button>` : ''}<button class="btn ghost icon sm" data-rm="${i}" title="entfernen">${icon('x')}</button></span></li>`).join('')}</ol>`
      : '<div class="empty small">Auf einen Punkt klicken und „Zur Tour“ wählen. Die Reihenfolge ist die Fahrreihenfolge.</div>';
    const stops = tour.map((t) => t.addr || `${t.lat},${t.lng}`);
    const go = $('#tour-go');
    if (stops.length) {
      go.href = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(stops[stops.length - 1])}${stops.length > 1 ? '&waypoints=' + encodeURIComponent(stops.slice(0, -1).join('|')) : ''}`;
      go.classList.remove('disabled');
    } else { go.removeAttribute('href'); go.classList.add('disabled'); }
    $$('[data-rm]').forEach((b) => b.onclick = () => { tour.splice(Number(b.dataset.rm), 1); drawTour(); });
    $$('[data-up]').forEach((b) => b.onclick = () => { const i = Number(b.dataset.up); [tour[i - 1], tour[i]] = [tour[i], tour[i - 1]]; drawTour(); });
  };
  await loadSaved();
  if (cur) { const t = saved.find((x) => x.id === cur.id); if (t) savedSig = sig(t.stops); }
  drawTour();
  const colorOf = (p) => (st.color === 'contact' ? CONTACT_COLORS[contactBucket(p.last_contact)]
    : st.color === 'type' ? (TYPE_COLORS[p.customer_type] || '#6a6d6e')
      : (p.is_buyer ? '#c0292f' : '#4caf50'));
  const legend = () => {
    const items = st.color === 'contact' ? [['m1', 'Kontakt < 1 Monat'], ['m3', '1–3 Monate'], ['m6', '3–6 Monate'], ['old', '> 6 Monate / nie']].map(([k, l]) => [CONTACT_COLORS[k], l])
      : st.color === 'type' ? [...TYPES.map((t) => [TYPE_COLORS[t], t]), ['#6a6d6e', 'ohne Kundenart']]
        : [['#c0292f', 'kaufender Kunde'], ['#4caf50', 'Interessent']];
    $('#mp-legend').innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('');
  };
  drawMarks = () => {
    tourLayer.clearLayers();
    const byId = new Map(lastPoints.map((p) => [p.id, p]));
    tour.forEach((t, i) => {
      if (t.lat == null || t.lng == null) return;
      const p = byId.get(t.id);
      const col = p ? colorOf(p) : '#6a6d6e';
      Lf.marker([t.lat, t.lng], { interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: Lf.divIcon({ className: 'tour-mark', iconSize: [26, 26], iconAnchor: [13, 13], html: `<span style="background:${esc(col)}">${i + 1}</span>` }) }).addTo(tourLayer);
    });
  };
  const load = async () => {
    try { sessionStorage.setItem('mapFilter', JSON.stringify(st)); } catch { /* egal */ }
    const qs = new URLSearchParams({ q: st.q, status: st.status, type: st.type, owner: st.owner, contact: st.contact, tag: st.tag, extra: st.extra });
    const data = await api('/map?' + qs);
    if (!document.body.contains($('#bigmap'))) return;
    lastPoints = data.points;
    layer.clearLayers(); legend();
    for (const p of data.points) {
      const mk = Lf.circleMarker([p.lat, p.lng], { radius: 8, weight: 2, color: '#fff', fillColor: colorOf(p), fillOpacity: 0.95 });
      mk.bindTooltip(esc(custName(p)));
      mk.bindPopup(() => `<div class="mpop"><b>${esc(custName(p))}</b>${p.is_buyer ? '' : ' <span class="chip lead">Interessent</span>'}${p.customer_type ? ` <span class="chip t-${p.customer_type}">${p.customer_type}</span>` : ''}
        <div>${esc(addrOf(p))}${p.geo === 'approx' ? ' <span class="muted">(Lage ungefähr)</span>' : ''}</div>
        ${p.mobile || p.phone ? `<div><a href="${telHref(p.mobile || p.phone)}">${esc(p.mobile || p.phone)}</a></div>` : ''}
        <div class="muted">Letzter Kontakt: ${p.last_contact ? deDate(p.last_contact) + ' ' + agoText(p.last_contact) : 'noch keiner'}${p.open_tasks ? ` · ${p.open_tasks} offene Aufgabe${p.open_tasks > 1 ? 'n' : ''}` : ''}</div>
        ${p.tags ? `<div style="margin-top:4px">${tagChips(p.tags, 'xs')}</div>` : ''}
        <div class="mpop-acts"><a class="btn sm" href="#/kunden/${p.id}">Öffnen</a><button class="btn sm primary" data-tour="${p.id}"></button></div></div>`);
      mk.on('popupopen', (e) => {
        const b = e.popup.getElement().querySelector('[data-tour]');
        if (!b) return;
        const lbl = () => { const i = tour.findIndex((t) => t.id === p.id); b.textContent = i >= 0 ? `Station ${i + 1} · aus Tour entfernen` : '+ Zur Tour'; b.classList.toggle('primary', i < 0); };
        lbl();
        b.onclick = () => {
          const i = tour.findIndex((t) => t.id === p.id);
          if (i >= 0) tour.splice(i, 1); else tour.push({ id: p.id, name: custName(p), addr: addrOf(p), lat: p.lat, lng: p.lng });
          drawTour(); lbl();
        };
      });
      mk.addTo(layer);
    }
    drawMarks();
    if (data.points.length && firstFit) { map.fitBounds(Lf.latLngBounds(data.points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 13 }); firstFit = false; }
    $('#mp-info').innerHTML = `${data.points.length} von ${data.total} Kunden auf der Karte${data.pending ? ` · ${data.pending} werden gerade verortet …` : ''}${data.failed ? ` · <a href="#/kunden" id="mp-failed">${data.failed} Adressen nicht gefunden</a>` : ''}${data.noAddress ? ` · ${data.noAddress} ohne Adresse` : ''}`;
    const fl = $('#mp-failed');
    if (fl) fl.onclick = () => { try { sessionStorage.setItem('custFilter', JSON.stringify({ ...CUST_DEFAULTS, extra: 'no_geo' })); } catch { /* egal */ } };
    clearTimeout(timer);
    if (data.pending) timer = setTimeout(() => { if (location.hash.startsWith('#/karte')) load().catch(() => {}); }, 15000);
  };
  const refit = () => { firstFit = true; return load(); };
  $('#mp-q').oninput = debounce((e) => { st.q = e.target.value; refit(); }, 300);
  ['status', 'type', 'owner', 'contact', 'tag', 'extra'].forEach((k) => { $('#mp-' + k).onchange = (e) => { st[k] = e.target.value; refit(); }; });
  $('#mp-color').onchange = (e) => { st.color = e.target.value; load(); };
  setTimeout(() => map.invalidateSize(), 50);
  await load();
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
      <select id="t-scope"><option value="mine">Meine (zuständig oder eingeladen)</option><option value="created">Von mir delegiert</option><option value="all">Alle Mitarbeiter</option>${state.users.filter((u) => u.active && u.id !== state.me.id).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
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
        <button class="btn" id="cal-abs">🏖 Abwesenheit</button>
        <button class="btn primary" id="cal-new">${icon('plus')} Termin</button></div>
      <p class="muted small" style="margin-top:-8px">Tipp: Auf einen Tag klicken, um dort einen Termin anzulegen. Urlaub oder private Termine über „Abwesenheit“ blocken. Abo für Outlook &amp; iPhone unter <a href="#/einstellungen">Einstellungen</a>.</p>
      <div class="card"><div class="month">
        ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div class="dow">${w}</div>`).join('')}
        ${days.map((day) => {
          const items = data.tasks.filter((t) => t.due_date === day);
          const bd = data.birthdays.filter((b) => b.date === day);
          const abs = absOn(data.absences, day);
          const all = [...abs.map((a) => absHtml(a, showWho)), ...bd.map((b) => `<div class="ev bday" data-cust="${b.id}"><div class="ttl">🎂 ${esc(custName(b))}</div></div>`), ...items.map((t) => evHtml(t, showWho))];
          const meAway = abs.some((a) => a.user_id === state.me.id && !a.start_time);
          return `<div class="cell ${day.slice(0, 7) !== st.month ? 'other' : ''} ${day === todayISO() ? 'today' : ''} ${meAway && !showWho ? 'away' : ''}" data-day="${day}"><span class="num">${parseISO(day).getDate()}</span>${all.slice(0, 4).join('')}${all.length > 4 ? `<span class="more">+${all.length - 4} weitere</span>` : ''}</div>`;
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
    $$('.ev[data-abs]', main).forEach((el) => el.onclick = (e) => { e.stopPropagation(); openAbsenceForm(data.absences.find((a) => a.id === Number(el.dataset.abs)), load); });
    $('#cal-abs').onclick = () => openAbsenceForm({}, load);
    $$('.cell', main).forEach((el) => el.onclick = (e) => { if (e.target.closest('.more')) { showDay(el.dataset.day, data, load); return; } openTaskForm({ kind: 'termin', due_date: el.dataset.day }, load); });
  };
  await load();
}
function showDay(day, data, reload) {
  const items = data.tasks.filter((t) => t.due_date === day);
  const abs = absOn(data.absences, day);
  const m = modal({ title: `${WD_LONG[parseISO(day).getDay()]}, ${deDate(day)}`, body: `${abs.length ? `<div style="display:grid;gap:4px;margin-bottom:10px">${abs.map((a) => absHtml(a, true)).join('')}</div>` : ''}<ul class="tasklist">${items.map((t) => taskItem(t)).join('')}</ul>` });
  bindTaskList(m.el, () => { m.close(); reload(); });
}

// ======================= Einstellungen =======================
async function viewSettings(main) {
  const ical = await api('/me/ical');
  const isAdmin = state.me.role === 'admin';
  main.innerHTML = `
    <div class="page-head"><h1>Einstellungen</h1>${state.version && state.version.commit !== 'dev' ? `<span class="muted small" title="${esc(state.version.subject)}">Version ${esc(state.version.commit)} vom ${esc(state.version.date)} · automatische Updates aktiv</span>` : ''}</div>
    <div style="display:grid;gap:18px;max-width:900px">
      <div class="card show-m-only"><div class="card-body more-links"><a class="btn" href="#/karte">${icon('map')} Karte</a><a class="btn" href="#/verkaeufe">${icon('euro')} Verkäufe</a></div></div>
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

      <div class="card"><div class="card-head"><h2>${icon('mail', 'lg')} E-Mail-Versand (SMTP)</h2><span class="chip ${state.mailEnabled ? 'ok' : 'warn'}">${state.mailEnabled ? 'aktiv' : 'nicht eingerichtet'}</span></div><div class="card-body" id="smtp-body">Lädt …</div></div>
      <div class="card"><div class="card-head"><h2>${icon('file', 'lg')} KI-Auswertung von Angeboten</h2><span class="chip" id="ai-chip"></span></div><div class="card-body" id="ai-body">Lädt …</div></div>` : ''}
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
  $('#ai-chip').className = 'chip ' + (s.ai_key_set || s.ai_env ? 'ok' : 'warn');
  $('#ai-chip').textContent = s.ai_key_set || s.ai_env ? 'aktiv' : 'aus';
  $('#ai-body').innerHTML = `
    <p class="small" style="margin-top:0">Angebote aus eurer Warenwirtschaft (PDF) werden immer automatisch ausgelesen – kostenlos. Für <b>Fotos</b> und <b>Angebote anderer Firmen</b> kann zusätzlich die KI von Anthropic (Claude) eingesetzt werden. Kosten: etwa 2–5 Cent pro Angebot, abgerechnet über euer Anthropic-Konto.</p>
    ${s.ai_env ? '<p class="callout info small">Der Schlüssel ist auf dem Server hinterlegt (ANTHROPIC_API_KEY).</p>' : `
    <form id="ai-form" class="form-grid">
      <div class="field full"><label>API-Schlüssel ${s.ai_key_set ? '<span class="muted">(gespeichert – leer lassen zum Beibehalten)</span>' : '<span class="muted">(von console.anthropic.com → API Keys)</span>'}</label><input type="password" name="ai_key" autocomplete="off" placeholder="sk-ant-…"></div>
      <div class="full" style="display:flex;gap:8px"><button class="btn primary" type="submit">Speichern</button>${s.ai_key_set ? '<button class="btn" type="button" id="ai-clear">Schlüssel entfernen</button>' : ''}</div>
    </form>`}`;
  const aiF = $('#ai-form');
  if (aiF) {
    aiF.onsubmit = async (e) => { e.preventDefault(); const k = aiF.ai_key.value.trim(); if (!k) return; try { await api('/settings', { method: 'PUT', body: { ai_key: k } }); projMeta = null; toast('KI-Auswertung eingeschaltet'); viewSettings(main); } catch (err) { fail(err); } };
    const cl = $('#ai-clear'); if (cl) cl.onclick = async () => { try { await api('/settings', { method: 'PUT', body: { ai_key_clear: true } }); projMeta = null; toast('Schlüssel entfernt'); viewSettings(main); } catch (err) { fail(err); } };
  }
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
