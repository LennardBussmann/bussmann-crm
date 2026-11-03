'use strict';
process.env.TZ = process.env.TZ || 'Europe/Berlin';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { get, all, run, tx, getSetting, setSetting, DATA_DIR } = require('./lib/db');
const U = require('./lib/util');
const L = require('./lib/logic');
const { sendMail, mailEnabled, appUrl } = require('./lib/mail');
const { buildFeed } = require('./lib/ical');
const importer = require('./lib/importer');
const geo = require('./lib/geo');

const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 30;
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use('/api', express.json({ limit: '5mb' }));

// ---------- Auth ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(req, res, tok, maxAgeSec) {
  const secure = req.secure || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
function publicUser(u) { return u && { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, color: u.color, notify_email: !!u.notify_email }; }

app.use('/api', (req, res, next) => {
  const sid = parseCookies(req).sid;
  if (sid) {
    const s = get('SELECT * FROM sessions WHERE token=? AND expires_at>?', sid, Date.now());
    if (s) {
      const u = get('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
      if (u) req.user = u;
    }
  }
  // Einfacher CSRF-Schutz: schreibende Anfragen nur als JSON bzw. mit eigenem Header
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json') && req.get('X-Requested-With') !== 'crm') {
    return res.status(415).json({ error: 'Ungültige Anfrage' });
  }
  next();
});
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Bitte anmelden' }));
const admin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Nur für Administratoren' }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg) => res.status(400).json({ error: msg });

const loginAttempts = new Map();
app.get('/api/setup', (req, res) => res.json({ needsSetup: !get('SELECT id FROM users LIMIT 1') }));
app.post('/api/setup', (req, res) => {
  if (get('SELECT id FROM users LIMIT 1')) return res.status(403).json({ error: 'Bereits eingerichtet' });
  const { name, email, password } = req.body || {};
  if (!U.str(name) || !/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) return bad(res, 'Name, gültige E-Mail und Passwort (mind. 8 Zeichen) angeben');
  const r = run('INSERT INTO users(name,email,password_hash,role,ical_token,color) VALUES(?,?,?,?,?,?)', U.str(name, 100), email.trim(), U.hashPassword(password), 'admin', U.token(24), '#c0292f');
  const tok = U.token();
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', tok, r.lastInsertRowid, Date.now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, tok, SESSION_DAYS * 86400);
  res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Zu viele Versuche. Bitte 15 Minuten warten.' });
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email=? AND active=1', String(email || '').trim());
  if (!u || !U.verifyPassword(password, u.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
  }
  loginAttempts.delete(ip);
  const tok = U.token();
  run('DELETE FROM sessions WHERE expires_at<?', Date.now());
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', tok, u.id, Date.now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, tok, SESSION_DAYS * 86400);
  res.json({ user: publicUser(u) });
});
app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) run('DELETE FROM sessions WHERE token=?', sid);
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    mailEnabled: mailEnabled(),
    unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user.id).n,
  });
});
app.put('/api/me', auth, (req, res) => {
  const { name, notify_email, color, current_password, new_password } = req.body || {};
  if (new_password !== undefined && new_password !== '') {
    if (!U.verifyPassword(current_password, req.user.password_hash)) return bad(res, 'Aktuelles Passwort ist falsch');
    if (String(new_password).length < 8) return bad(res, 'Neues Passwort muss mind. 8 Zeichen haben');
    run('UPDATE users SET password_hash=? WHERE id=?', U.hashPassword(new_password), req.user.id);
    run('DELETE FROM sessions WHERE user_id=? AND token<>?', req.user.id, parseCookies(req).sid);
  }
  run('UPDATE users SET name=COALESCE(?,name), notify_email=COALESCE(?,notify_email), color=COALESCE(?,color) WHERE id=?',
    U.str(name, 100), notify_email === undefined ? null : (notify_email ? 1 : 0), /^#[0-9a-f]{6}$/i.test(color || '') ? color : null, req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id=?', req.user.id)) });
});

function icalUrls(u, req) {
  const base = appUrl() || `${req.protocol}://${req.get('host')}`;
  const https = `${base}/ical/${u.ical_token}.ics`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}
app.get('/api/me/ical', auth, (req, res) => {
  if (!req.user.ical_token) { req.user.ical_token = U.token(24); run('UPDATE users SET ical_token=? WHERE id=?', req.user.ical_token, req.user.id); }
  res.json(icalUrls(req.user, req));
});
app.post('/api/me/ical/reset', auth, (req, res) => {
  req.user.ical_token = U.token(24);
  run('UPDATE users SET ical_token=? WHERE id=?', req.user.ical_token, req.user.id);
  res.json(icalUrls(req.user, req));
});

// ---------- Benutzer ----------
app.get('/api/users', auth, (req, res) => {
  const rows = all('SELECT * FROM users ORDER BY active DESC, name').map(publicUser);
  res.json(req.user.role === 'admin' ? rows : rows.filter((u) => u.active));
});
app.post('/api/users', auth, admin, (req, res) => {
  const { name, email, password, role, color } = req.body || {};
  if (!U.str(name) || !/^\S+@\S+\.\S+$/.test(email || '')) return bad(res, 'Name und gültige E-Mail angeben');
  if (String(password || '').length < 8) return bad(res, 'Passwort muss mind. 8 Zeichen haben');
  if (get('SELECT id FROM users WHERE email=?', email.trim())) return bad(res, 'Diese E-Mail ist bereits vergeben');
  const r = run('INSERT INTO users(name,email,password_hash,role,ical_token,color) VALUES(?,?,?,?,?,?)',
    U.str(name, 100), email.trim(), U.hashPassword(password), role === 'admin' ? 'admin' : 'user', U.token(24), /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#6a6d6e');
  res.json(publicUser(get('SELECT * FROM users WHERE id=?', r.lastInsertRowid)));
});
app.put('/api/users/:id', auth, admin, (req, res) => {
  const u = get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!u) return res.status(404).json({ error: 'Nicht gefunden' });
  const { name, email, password, role, active, color } = req.body || {};
  if (u.id === req.user.id && (role === 'user' || active === false)) return bad(res, 'Sie können sich nicht selbst die Admin-Rechte entziehen oder sich deaktivieren');
  if (email && email.trim().toLowerCase() !== u.email.toLowerCase() && get('SELECT id FROM users WHERE email=?', email.trim())) return bad(res, 'Diese E-Mail ist bereits vergeben');
  if (password) {
    if (String(password).length < 8) return bad(res, 'Passwort muss mind. 8 Zeichen haben');
    run('UPDATE users SET password_hash=? WHERE id=?', U.hashPassword(password), u.id);
    run('DELETE FROM sessions WHERE user_id=?', u.id);
  }
  run('UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), role=COALESCE(?,role), active=COALESCE(?,active), color=COALESCE(?,color) WHERE id=?',
    U.str(name, 100), /^\S+@\S+\.\S+$/.test(email || '') ? email.trim() : null, ['admin', 'user'].includes(role) ? role : null,
    active === undefined ? null : (active ? 1 : 0), /^#[0-9a-f]{6}$/i.test(color || '') ? color : null, u.id);
  if (active === false) run('DELETE FROM sessions WHERE user_id=?', u.id);
  res.json(publicUser(get('SELECT * FROM users WHERE id=?', u.id)));
});

// ---------- Einstellungen (SMTP) ----------
const SETTING_KEYS = ['app_url', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from'];
app.get('/api/settings', auth, admin, (req, res) => {
  const o = {}; for (const k of SETTING_KEYS) o[k] = getSetting(k);
  o.smtp_pass_set = !!getSetting('smtp_pass');
  o.env_override = !!process.env.SMTP_HOST;
  res.json(o);
});
app.put('/api/settings', auth, admin, (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]).trim());
  if (b.smtp_pass) setSetting('smtp_pass', b.smtp_pass);
  if (b.smtp_pass_clear) setSetting('smtp_pass', '');
  res.json({ ok: true, mailEnabled: mailEnabled() });
});
app.post('/api/settings/testmail', auth, admin, wrap(async (req, res) => {
  if (!mailEnabled()) return bad(res, 'SMTP ist noch nicht eingerichtet');
  try {
    await sendMail({ to: req.user.email, subject: 'Testnachricht vom Bussmann CRM', html: '<p>Der E-Mail-Versand funktioniert. 👍</p>', text: 'Der E-Mail-Versand funktioniert.' });
    res.json({ ok: true, to: req.user.email });
  } catch (e) { bad(res, 'Versand fehlgeschlagen: ' + e.message); }
}));

// ---------- Kunden ----------
const CUSTOMER_FIELDS = ['salutation', 'first_name', 'last_name', 'company', 'street', 'zip', 'city', 'customer_type', 'birthday', 'email', 'mobile', 'phone', 'visit_interval', 'owner_id', 'is_buyer', 'tags'];
const FIELD_LABEL = { salutation: 'Anrede', first_name: 'Vorname', last_name: 'Nachname', company: 'Firma', street: 'Straße', zip: 'PLZ', city: 'Ort', customer_type: 'Kundenart', birthday: 'Geburtsdatum', email: 'E-Mail', mobile: 'Handynummer', phone: 'Festnetznummer', visit_interval: 'Besuchsintervall', owner_id: 'Betreuer', is_buyer: 'Kaufender Kunde', tags: 'Schlagworte', info: 'Infofeld' };

function cleanCustomer(b) {
  const c = {
    salutation: U.str(b.salutation, 30), first_name: U.str(b.first_name, 100), last_name: U.str(b.last_name, 100),
    company: U.str(b.company, 200), street: U.str(b.street, 200), zip: U.str(b.zip, 10), city: U.str(b.city, 100),
    customer_type: U.CUSTOMER_TYPES.includes(b.customer_type) ? b.customer_type : null,
    birthday: U.isDate(b.birthday) ? b.birthday : null,
    email: U.str(b.email, 200), mobile: U.str(b.mobile, 60), phone: U.str(b.phone, 60),
    visit_interval: U.INTERVAL_MONTHS[b.visit_interval] ? b.visit_interval : '',
    owner_id: b.owner_id && get('SELECT id FROM users WHERE id=?', b.owner_id) ? Number(b.owner_id) : null,
    is_buyer: [true, 1, '1', 'true', 'on'].includes(b.is_buyer) ? 1 : 0,
    tags: U.tagsStore(U.tagsFrom(b.tags)),
  };
  if (!c.last_name) return { error: 'Nachname ist ein Pflichtfeld' };
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return { error: 'E-Mail-Adresse ist ungültig' };
  return { c };
}

const CUSTOMER_LIST_SQL = `SELECT c.*, o.name owner_name,
  (SELECT COUNT(*) FROM tasks t WHERE t.customer_id=c.id AND t.status='open') open_tasks,
  (SELECT MAX(happened_at) FROM entries e WHERE e.customer_id=c.id AND e.kind<>'system') last_contact
  FROM customers c LEFT JOIN users o ON o.id=c.owner_id`;

// Letzter Kontakt: Reiter-Grenzen (exklusiv: bis 1 Monat, 1–3, 3–6, über 6 Monate / nie)
function contactBounds() {
  const t = U.today();
  return { m1: U.addMonths(t, -1), m3: U.addMonths(t, -3), m6: U.addMonths(t, -6) };
}
const CONTACT_COND = {
  m1: 'c.last_contact >= :m1',
  m3: 'c.last_contact < :m1 AND c.last_contact >= :m3',
  m6: 'c.last_contact < :m3 AND c.last_contact >= :m6',
  old: '(c.last_contact IS NULL OR c.last_contact < :m6)',
};
function customerQuery(q, { withContact = true } = {}) {
  const where = []; const params = [];
  if (q.q) {
    for (const term of String(q.q).trim().split(/\s+/).slice(0, 5)) {
      const like = `%${term}%`;
      where.push(`(c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ? OR c.city LIKE ? OR c.zip LIKE ? OR c.street LIKE ? OR c.email LIKE ? OR replace(c.mobile,' ','') LIKE ? OR replace(c.phone,' ','') LIKE ? OR c.info LIKE ? OR c.tags LIKE ?
        OR EXISTS (SELECT 1 FROM machines mm WHERE mm.customer_id=c.id AND (mm.brand LIKE ? OR mm.model LIKE ? OR mm.serial LIKE ? OR mm.category LIKE ?)))`);
      const digits = `%${term.replace(/\s/g, '')}%`;
      params.push(like, like, like, like, like, like, like, digits, digits, like, like, like, like, like, like);
    }
  }
  if (q.type === 'none') where.push("(c.customer_type IS NULL OR c.customer_type='')");
  else if (U.CUSTOMER_TYPES.includes(q.type)) { where.push('c.customer_type=?'); params.push(q.type); }
  if (q.status === 'buyer') where.push('c.is_buyer=1');
  if (q.status === 'lead') where.push('c.is_buyer=0');
  if (q.owner === 'me') { where.push('c.owner_id=?'); params.push(q.userId); }
  else if (q.owner === 'none') where.push('c.owner_id IS NULL');
  else if (/^\d+$/.test(q.owner || '')) { where.push('c.owner_id=?'); params.push(Number(q.owner)); }
  if (q.interval) { where.push(q.interval === 'none' ? "c.visit_interval=''" : q.interval === 'any' ? "c.visit_interval<>''" : 'c.visit_interval=?'); if (!['none', 'any'].includes(q.interval)) params.push(q.interval); }
  const t = U.today();
  if (q.tag) { where.push(`c.tags LIKE ?`); params.push(`%|${String(q.tag).replace(/[%_|]/g, '')}|%`); }
  if (q.extra === 'service_due') { where.push(`EXISTS (SELECT 1 FROM machines mm WHERE mm.customer_id=c.id AND mm.next_service IS NOT NULL AND mm.next_service<=?)`); params.push(U.addDays(t, 30)); }
  if (q.extra === 'machines') where.push('EXISTS (SELECT 1 FROM machines mm WHERE mm.customer_id=c.id)');
  if (q.extra === 'no_geo') where.push(`c.geo_status='fail'`);
  if (q.extra === 'open_tasks') where.push('c.open_tasks>0');
  if (q.extra === 'no_tasks') where.push('c.open_tasks=0');
  if (q.extra === 'visit_due') { where.push(`EXISTS (SELECT 1 FROM tasks vt WHERE vt.customer_id=c.id AND vt.kind='besuch' AND vt.status='open' AND vt.due_date<=?)`); params.push(t); }
  if (q.extra === 'bday_month') { where.push(`c.birthday IS NOT NULL AND substr(c.birthday,6,2)=?`); params.push(t.slice(5, 7)); }
  if (q.extra === 'no_phone') where.push(`IFNULL(c.mobile,'')='' AND IFNULL(c.phone,'')=''`);
  if (q.extra === 'no_email') where.push(`IFNULL(c.email,'')=''`);
  if (q.extra === 'new30') { where.push('c.created_at>=?'); params.push(U.addDays(t, -30)); }
  if (withContact && CONTACT_COND[q.contact]) {
    const b = contactBounds();
    where.push(CONTACT_COND[q.contact].replace(/:m\d/g, (m) => `'${b[m.slice(1)]}'`));
  }
  const sorts = { name: 'c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE', city: 'c.city COLLATE NOCASE, c.last_name', newest: 'c.created_at DESC', contact: 'c.last_contact IS NULL, c.last_contact DESC', contact_old: 'c.last_contact IS NOT NULL, c.last_contact ASC', zip: 'c.zip, c.city COLLATE NOCASE, c.last_name' };
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return { sql: `SELECT * FROM (${CUSTOMER_LIST_SQL}) c ${whereSql} ORDER BY ${sorts[q.sort] || sorts.name}`, whereSql, params };
}

function contactCounts(q) {
  const { whereSql, params } = customerQuery(q, { withContact: false });
  const b = contactBounds();
  const cond = (k) => CONTACT_COND[k].replace(/:m\d/g, (m) => `'${b[m.slice(1)]}'`);
  return get(`SELECT COUNT(*) all_, ${Object.keys(CONTACT_COND).map((k) => `SUM(CASE WHEN ${cond(k)} THEN 1 ELSE 0 END) ${k}`).join(', ')},
    SUM(CASE WHEN c.is_buyer=1 THEN 1 ELSE 0 END) buyers FROM (${CUSTOMER_LIST_SQL}) c ${whereSql}`, ...params);
}

app.get('/api/customers', auth, (req, res) => {
  const { sql, params } = customerQuery({ ...req.query, userId: req.user.id });
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const rows = all(sql + ` LIMIT ${limit + 1}`, ...params);
  const k = contactCounts({ ...req.query, userId: req.user.id });
  res.json({ rows: rows.slice(0, limit), more: rows.length > limit, total: get('SELECT COUNT(*) n FROM customers').n,
    counts: { all: k.all_ || 0, m1: k.m1 || 0, m3: k.m3 || 0, m6: k.m6 || 0, old: k.old || 0, buyers: k.buyers || 0 } });
});

app.get('/api/customers/export.xlsx', auth, (req, res) => {
  const { sql, params } = customerQuery({ ...req.query, userId: req.user.id });
  const buf = importer.exportCustomers(all(sql, ...params));
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Kunden_${U.today()}.xlsx"`);
  res.send(buf);
});

app.post('/api/customers', auth, (req, res) => {
  const { c, error } = cleanCustomer(req.body || {});
  if (error) return bad(res, error);
  const id = tx(() => {
    const r = run(`INSERT INTO customers(${CUSTOMER_FIELDS.join(',')}, info, created_by, updated_by) VALUES(${CUSTOMER_FIELDS.map(() => '?').join(',')}, ?, ?, ?)`,
      ...CUSTOMER_FIELDS.map((f) => c[f] ?? (f === 'visit_interval' ? '' : null)), U.str(req.body.info, 20000) || '', req.user.id, req.user.id);
    const id = Number(r.lastInsertRowid);
    if (!c.owner_id) run('UPDATE customers SET owner_id=? WHERE id=?', req.user.id, id);
    L.systemEntry(id, req.user.id, 'Kunde angelegt');
    L.syncVisitTask(id);
    return id;
  });
  res.json({ id });
});

app.get('/api/customers/:id', auth, (req, res) => {
  const c = get(`${CUSTOMER_LIST_SQL} WHERE c.id=?`, req.params.id);
  if (!c) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  c.created_by_name = get('SELECT name FROM users WHERE id=?', c.created_by)?.name;
  c.updated_by_name = get('SELECT name FROM users WHERE id=?', c.updated_by)?.name;
  const entries = all(`SELECT e.*, u.name author FROM entries e LEFT JOIN users u ON u.id=e.created_by WHERE e.customer_id=? ORDER BY e.happened_at DESC, e.id DESC`, c.id);
  const tasks = all(`SELECT t.*, a.name assignee, cb.name creator, db.name done_by_name, ${PARTICIPANT_COLS} FROM tasks t LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users cb ON cb.id=t.created_by LEFT JOIN users db ON db.id=t.done_by
    WHERE t.customer_id=? ORDER BY t.status='done', CASE WHEN t.status='open' THEN t.due_date END ASC, t.done_at DESC`, c.id);
  const files = all('SELECT f.id, f.filename, f.mime, f.size, f.created_at, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.customer_id=? ORDER BY f.created_at DESC', c.id);
  const machines = all(`SELECT m.*, u.name updated_by_name FROM machines m LEFT JOIN users u ON u.id=m.updated_by WHERE m.customer_id=? ORDER BY m.category COLLATE NOCASE, m.brand COLLATE NOCASE, m.id`, c.id);
  const ids = all('SELECT id FROM customers ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE').map((r) => r.id);
  const i = ids.indexOf(c.id);
  res.json({ customer: c, entries, tasks, files, machines, prev: ids[i - 1] || null, next: ids[i + 1] || null });
});

app.put('/api/customers/:id', auth, (req, res) => {
  const old = get('SELECT * FROM customers WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const { c, error } = cleanCustomer({ ...old, ...req.body });
  if (error) return bad(res, error);
  const changed = CUSTOMER_FIELDS.filter((f) => (old[f] ?? null) !== (c[f] ?? null) && !(f === 'visit_interval' && !old[f] && !c[f]));
  tx(() => {
    run(`UPDATE customers SET ${CUSTOMER_FIELDS.map((f) => f + '=?').join(',')}, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`,
      ...CUSTOMER_FIELDS.map((f) => c[f] ?? (f === 'visit_interval' ? '' : null)), req.user.id, old.id);
    if (changed.length) L.systemEntry(old.id, req.user.id, `${changed.length === 1 ? 'Feld' : changed.length + ' Felder'} aktualisiert: ${changed.map((f) => FIELD_LABEL[f]).join(', ')}`);
    if (['street', 'zip', 'city'].some((f) => changed.includes(f))) run(`UPDATE customers SET lat=NULL, lng=NULL, geo_status='' WHERE id=?`, old.id);
    if (changed.includes('visit_interval') || changed.includes('owner_id')) {
      if (changed.includes('owner_id')) run(`UPDATE tasks SET assigned_to=? WHERE customer_id=? AND auto_visit=1 AND status='open'`, c.owner_id, old.id);
      L.syncVisitTask(old.id);
    }
    if (changed.includes('first_name') || changed.includes('last_name') || changed.includes('company')) L.syncVisitTask(old.id);
  });
  res.json({ ok: true });
});

app.put('/api/customers/:id/info', auth, (req, res) => {
  const old = get('SELECT * FROM customers WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  run(`UPDATE customers SET info=?, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`, String(req.body.info ?? '').slice(0, 20000), req.user.id, old.id);
  res.json({ ok: true });
});

function deleteCustomer(id) {
  const files = [...all('SELECT stored_name FROM files WHERE customer_id=?', id),
    ...all('SELECT tf.stored_name FROM task_files tf JOIN tasks t ON t.id=tf.task_id WHERE t.customer_id=?', id)];
  run('DELETE FROM customers WHERE id=?', id);
  for (const f of files) fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
}
app.delete('/api/customers/:id', auth, admin, (req, res) => {
  deleteCustomer(Number(req.params.id));
  res.json({ ok: true });
});
app.post('/api/customers/bulk-delete', auth, admin, (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  tx(() => ids.forEach(deleteCustomer));
  res.json({ deleted: ids.length });
});

app.post('/api/customers/bulk-update', auth, (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  const b = req.body || {};
  const sets = []; const p = []; const label = [];
  if (b.is_buyer !== undefined) { sets.push('is_buyer=?'); p.push(b.is_buyer ? 1 : 0); label.push(b.is_buyer ? 'als kaufender Kunde markiert' : 'als Interessent markiert'); }
  if (b.customer_type !== undefined && (U.CUSTOMER_TYPES.includes(b.customer_type) || b.customer_type === '')) { sets.push('customer_type=?'); p.push(b.customer_type || null); label.push(`Kundenart: ${b.customer_type || '–'}`); }
  if (b.owner_id !== undefined && get('SELECT id FROM users WHERE id=?', b.owner_id)) { sets.push('owner_id=?'); p.push(Number(b.owner_id)); label.push(`Betreuer: ${get('SELECT name FROM users WHERE id=?', b.owner_id).name}`); }
  const addTag = U.tagsFrom(b.add_tag)[0]; const removeTag = U.tagsFrom(b.remove_tag)[0];
  if (addTag) label.push(`Schlagwort „${addTag}“ hinzugefügt`);
  if (removeTag) label.push(`Schlagwort „${removeTag}“ entfernt`);
  if ((!sets.length && !addTag && !removeTag) || !ids.length) return bad(res, 'Nichts zu ändern');
  tx(() => {
    for (const id of ids) {
      const cur = get('SELECT id, tags FROM customers WHERE id=?', id);
      if (!cur) continue;
      let tags = U.tagsFrom(cur.tags);
      if (addTag) tags = U.tagsFrom([...tags, addTag]);
      if (removeTag) tags = tags.filter((x) => x.toLowerCase() !== removeTag.toLowerCase());
      run(`UPDATE customers SET ${[...sets, 'tags=?'].join(',')}, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`, ...p, U.tagsStore(tags), req.user.id, id);
      if (b.owner_id !== undefined) run(`UPDATE tasks SET assigned_to=? WHERE customer_id=? AND auto_visit=1 AND status='open'`, Number(b.owner_id), id);
      L.systemEntry(id, req.user.id, `Sammeländerung: ${label.join(', ')}`);
    }
  });
  res.json({ updated: ids.length });
});

// ---------- Position (Karte) ----------
app.put('/api/customers/:id/geo', auth, (req, res) => {
  const c = get('SELECT id FROM customers WHERE id=?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const lat = Number(req.body?.lat); const lng = Number(req.body?.lng);
  if (req.body?.reset) { run(`UPDATE customers SET lat=NULL, lng=NULL, geo_status='' WHERE id=?`, c.id); return res.json({ ok: true }); }
  if (!(lat > -90 && lat < 90 && lng > -180 && lng < 180)) return bad(res, 'Ungültige Position');
  run(`UPDATE customers SET lat=?, lng=?, geo_status='manual' WHERE id=?`, lat, lng, c.id);
  L.systemEntry(c.id, req.user.id, 'Position auf der Karte korrigiert');
  res.json({ ok: true });
});
app.get('/api/map', auth, (req, res) => {
  const { sql, params } = customerQuery({ ...req.query, userId: req.user.id });
  const rows = all(sql, ...params);
  const pts = rows.filter((c) => c.lat != null && c.lng != null).slice(0, 10000).map((c) => ({
    id: c.id, first_name: c.first_name, last_name: c.last_name, company: c.company, street: c.street, zip: c.zip, city: c.city,
    lat: c.lat, lng: c.lng, geo: c.geo_status, is_buyer: c.is_buyer, customer_type: c.customer_type, last_contact: c.last_contact,
    mobile: c.mobile, phone: c.phone, open_tasks: c.open_tasks, owner_name: c.owner_name, tags: c.tags,
  }));
  res.json({
    points: pts, total: rows.length,
    pending: rows.filter((c) => !c.geo_status && (c.city || c.zip)).length,
    failed: rows.filter((c) => c.geo_status === 'fail').length,
    noAddress: rows.filter((c) => !c.city && !c.zip).length,
  });
});
app.get('/api/meta', auth, (req, res) => {
  const counts = {};
  for (const r of all(`SELECT tags FROM customers WHERE IFNULL(tags,'')<>''`)) for (const t of U.tagsFrom(r.tags)) counts[t] = (counts[t] || 0) + 1;
  res.json({
    tags: Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([tag, n]) => ({ tag, n })),
    brands: all(`SELECT brand, COUNT(*) n FROM machines WHERE IFNULL(brand,'')<>'' GROUP BY brand COLLATE NOCASE ORDER BY n DESC LIMIT 50`).map((r) => r.brand),
    categories: all(`SELECT category FROM machines WHERE IFNULL(category,'')<>'' GROUP BY category COLLATE NOCASE ORDER BY COUNT(*) DESC LIMIT 50`).map((r) => r.category),
  });
});

// ---------- Maschinen ----------
function cleanMachine(b) {
  const year = Number(b.year);
  const m = {
    category: U.str(b.category, 60), brand: U.str(b.brand, 60), model: U.str(b.model, 100), serial: U.str(b.serial, 100),
    year: Number.isInteger(year) && year > 1900 && year < 2200 ? year : null,
    purchase_date: U.isDate(b.purchase_date) ? b.purchase_date : null,
    sold_by_us: [true, 1, '1', 'true', 'on'].includes(b.sold_by_us) ? 1 : 0,
    service_interval: U.INTERVAL_MONTHS[b.service_interval] ? b.service_interval : '',
    last_service: U.isDate(b.last_service) ? b.last_service : null,
    next_service: U.isDate(b.next_service) ? b.next_service : null,
    notes: U.str(b.notes, 5000) || '',
  };
  if (!m.category && !m.brand && !m.model) return { error: 'Bitte mindestens Art, Marke oder Modell angeben' };
  // Intervall gesetzt, aber kein Termin -> aus letzter Wartung/Kauf berechnen
  if (!m.next_service && m.service_interval) {
    const base = m.last_service || m.purchase_date;
    if (base) { let d = U.addMonths(base, U.INTERVAL_MONTHS[m.service_interval]); while (d < U.today()) d = U.addMonths(d, U.INTERVAL_MONTHS[m.service_interval]); m.next_service = d; }
  }
  return { m };
}
const MACHINE_FIELDS = ['category', 'brand', 'model', 'serial', 'year', 'purchase_date', 'sold_by_us', 'service_interval', 'last_service', 'next_service', 'notes'];
app.post('/api/customers/:id/machines', auth, (req, res) => {
  const c = get('SELECT id FROM customers WHERE id=?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const { m, error } = cleanMachine(req.body || {});
  if (error) return bad(res, error);
  const id = tx(() => {
    const r = run(`INSERT INTO machines(customer_id, ${MACHINE_FIELDS.join(',')}, created_by, updated_by) VALUES(?, ${MACHINE_FIELDS.map(() => '?').join(',')}, ?, ?)`,
      c.id, ...MACHINE_FIELDS.map((f) => m[f]), req.user.id, req.user.id);
    const id = Number(r.lastInsertRowid);
    L.systemEntry(c.id, req.user.id, `Maschine hinzugefügt: ${L.machineName(m)}${m.serial ? ' (Nr. ' + m.serial + ')' : ''}`);
    L.syncMachineTask(id);
    return id;
  });
  res.json({ id });
});
app.put('/api/machines/:id', auth, (req, res) => {
  const old = get('SELECT * FROM machines WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  const { m, error } = cleanMachine({ ...old, ...req.body });
  if (error) return bad(res, error);
  tx(() => {
    run(`UPDATE machines SET ${MACHINE_FIELDS.map((f) => f + '=?').join(',')}, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`, ...MACHINE_FIELDS.map((f) => m[f]), req.user.id, old.id);
    L.systemEntry(old.customer_id, req.user.id, `Maschine geändert: ${L.machineName(m)}`);
    L.syncMachineTask(old.id);
  });
  res.json({ ok: true });
});
app.delete('/api/machines/:id', auth, (req, res) => {
  const old = get('SELECT * FROM machines WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  tx(() => {
    run(`DELETE FROM tasks WHERE machine_id=? AND status='open'`, old.id);
    run('UPDATE tasks SET machine_id=NULL WHERE machine_id=?', old.id);
    run('DELETE FROM machines WHERE id=?', old.id);
    L.systemEntry(old.customer_id, req.user.id, `Maschine entfernt: ${L.machineName(old)}`);
  });
  res.json({ ok: true });
});

// ---------- Zeitleiste ----------
function cleanTask(b, fallbackCustomerId) {
  const t = {
    kind: U.TASK_KINDS[b.kind] ? b.kind : 'aufgabe',
    title: U.str(b.title, 300),
    description: U.str(b.description, 10000) || '',
    due_date: U.isDate(b.due_date) ? b.due_date : null,
    due_time: U.isTime(b.due_time) ? b.due_time : null,
    duration_min: Math.max(5, Math.min(24 * 60, Number(b.duration_min) || 60)),
    location: U.str(b.location, 300),
    assigned_to: b.assigned_to && get('SELECT id FROM users WHERE id=? AND active=1', b.assigned_to) ? Number(b.assigned_to) : null,
    remind_day_before: b.remind_day_before === false || b.remind_day_before === 0 ? 0 : 1,
    customer_id: b.customer_id === undefined ? fallbackCustomerId ?? null : (b.customer_id ? Number(b.customer_id) : null),
    participants: Array.isArray(b.participants)
      ? [...new Set(b.participants.map(Number))].filter((id) => Number.isInteger(id) && get('SELECT id FROM users WHERE id=? AND active=1', id)).slice(0, 30)
      : undefined,
  };
  if (t.customer_id && !get('SELECT id FROM customers WHERE id=?', t.customer_id)) return { error: 'Kunde nicht gefunden' };
  if (!t.title) t.title = U.TASK_KINDS[t.kind];
  if (!t.due_date) return { error: 'Bitte ein Fälligkeitsdatum angeben' };
  return { t };
}
function insertTask(t, userId, entryId) {
  const r = run(`INSERT INTO tasks(customer_id, entry_id, kind, title, description, due_date, due_time, duration_min, location, assigned_to, created_by, remind_day_before)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, t.customer_id, entryId ?? null, t.kind, t.title, t.description, t.due_date, t.due_time, t.duration_min, t.location, t.assigned_to ?? userId, userId, t.remind_day_before);
  const id = Number(r.lastInsertRowid);
  setParticipants(id, t.participants || [], t.assigned_to ?? userId);
  return id;
}
/** Setzt die weiteren Teilnehmer; gibt die neu hinzugekommenen zurück. */
function setParticipants(taskId, ids, assignedTo) {
  const before = all('SELECT user_id FROM task_participants WHERE task_id=?', taskId).map((r) => r.user_id);
  const want = ids.filter((id) => id !== assignedTo);
  run('DELETE FROM task_participants WHERE task_id=?', taskId);
  for (const id of want) run('INSERT OR IGNORE INTO task_participants(task_id, user_id) VALUES(?,?)', taskId, id);
  return want.filter((id) => !before.includes(id));
}
// Aufgabe betrifft einen Mitarbeiter (zuständig oder eingeladen) – braucht 2 Parameter
const INVOLVES = '(t.assigned_to=? OR EXISTS (SELECT 1 FROM task_participants tp WHERE tp.task_id=t.id AND tp.user_id=?))';
const PARTICIPANT_COLS = `(SELECT group_concat(pu.name, ', ') FROM task_participants tp JOIN users pu ON pu.id=tp.user_id WHERE tp.task_id=t.id) participant_names,
  (SELECT group_concat(tp.user_id) FROM task_participants tp WHERE tp.task_id=t.id) participant_ids`;

app.post('/api/customers/:id/entries', auth, wrap(async (req, res) => {
  const c = get('SELECT * FROM customers WHERE id=?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const b = req.body || {};
  const kind = U.ENTRY_KINDS[b.kind] && b.kind !== 'system' ? b.kind : 'notiz';
  const text = String(b.text ?? '').trim().slice(0, 20000);
  const happened = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.happened_at || '') ? b.happened_at : U.nowLocal();
  if (!text) return bad(res, 'Bitte einen Text eingeben');
  const tasks = [];
  for (const tb of Array.isArray(b.tasks) ? b.tasks.slice(0, 10) : []) {
    const { t, error } = cleanTask(tb, c.id);
    if (error) return bad(res, error);
    tasks.push(t);
  }
  const taskIds = tx(() => {
    const r = run('INSERT INTO entries(customer_id, kind, happened_at, text, created_by) VALUES(?,?,?,?,?)', c.id, kind, happened, text, req.user.id);
    const ids = tasks.map((t) => insertTask(t, req.user.id, Number(r.lastInsertRowid)));
    if (kind === 'besuch') L.syncVisitTask(c.id);
    return ids;
  });
  for (const id of taskIds) {
    await L.notifyAssignment(id, req.user.id);
    await L.notifyParticipants(id, req.user.id, all('SELECT user_id FROM task_participants WHERE task_id=?', id).map((r) => r.user_id));
  }
  res.json({ ok: true, taskIds });
}));

app.put('/api/entries/:id', auth, (req, res) => {
  const e = get('SELECT * FROM entries WHERE id=?', req.params.id);
  if (!e || e.kind === 'system') return res.status(404).json({ error: 'Eintrag nicht gefunden' });
  if (e.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Nur der Verfasser kann den Eintrag ändern' });
  const b = req.body || {};
  const text = String(b.text ?? e.text).trim().slice(0, 20000);
  if (!text) return bad(res, 'Bitte einen Text eingeben');
  run(`UPDATE entries SET text=?, kind=?, happened_at=?, updated_at=datetime('now','localtime') WHERE id=?`, text,
    U.ENTRY_KINDS[b.kind] && b.kind !== 'system' ? b.kind : e.kind,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.happened_at || '') ? b.happened_at : e.happened_at, e.id);
  L.syncVisitTask(e.customer_id);
  res.json({ ok: true });
});
app.delete('/api/entries/:id', auth, (req, res) => {
  const e = get('SELECT * FROM entries WHERE id=?', req.params.id);
  if (!e || e.kind === 'system') return res.status(404).json({ error: 'Eintrag nicht gefunden' });
  if (e.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Nur der Verfasser kann den Eintrag löschen' });
  run('DELETE FROM entries WHERE id=?', e.id);
  L.syncVisitTask(e.customer_id);
  res.json({ ok: true });
});

// ---------- Aufgaben ----------
const TASK_SQL = `SELECT t.*, a.name assignee, a.color assignee_color, cb.name creator, db.name done_by_name, ${PARTICIPANT_COLS},
  (SELECT COUNT(*) FROM task_files tf WHERE tf.task_id=t.id) file_count,
  c.first_name c_first, c.last_name c_last, c.company c_company, c.city c_city, c.mobile c_mobile, c.phone c_phone, c.street c_street, c.zip c_zip
  FROM tasks t LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users cb ON cb.id=t.created_by LEFT JOIN users db ON db.id=t.done_by LEFT JOIN customers c ON c.id=t.customer_id`;

app.get('/api/tasks', auth, (req, res) => {
  const where = []; const p = [];
  const scope = req.query.scope || 'mine';
  if (scope === 'mine') { where.push(INVOLVES); p.push(req.user.id, req.user.id); }
  else if (scope === 'created') { where.push('t.created_by=? AND t.assigned_to<>?'); p.push(req.user.id, req.user.id); }
  else if (/^\d+$/.test(scope)) { where.push(INVOLVES); p.push(Number(scope), Number(scope)); }
  if (req.query.status === 'open' || req.query.status === 'done') { where.push('t.status=?'); p.push(req.query.status); }
  if (U.isDate(req.query.from)) { where.push('t.due_date>=?'); p.push(req.query.from); }
  if (U.isDate(req.query.to)) { where.push('t.due_date<=?'); p.push(req.query.to); }
  if (U.TASK_KINDS[req.query.kind]) { where.push('t.kind=?'); p.push(req.query.kind); }
  if (req.query.q) { where.push('(t.title LIKE ? OR t.description LIKE ? OR c.last_name LIKE ? OR c.first_name LIKE ? OR c.company LIKE ?)'); const l = `%${req.query.q}%`; p.push(l, l, l, l, l); }
  const order = req.query.status === 'done' ? 't.done_at DESC' : 't.due_date, t.due_time IS NOT NULL, t.due_time';
  res.json(all(`${TASK_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 1000`, ...p));
});
app.get('/api/tasks/:id', auth, (req, res) => {
  const t = get(`${TASK_SQL} WHERE t.id=?`, req.params.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  if (t.entry_id) t.entry = get('SELECT e.*, u.name author FROM entries e LEFT JOIN users u ON u.id=e.created_by WHERE e.id=?', t.entry_id);
  t.files = all('SELECT f.id, f.filename, f.mime, f.size, f.created_at, f.uploaded_by, u.name uploader FROM task_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.task_id=? ORDER BY f.id', t.id);
  res.json(t);
});
app.post('/api/tasks', auth, wrap(async (req, res) => {
  const { t, error } = cleanTask(req.body || {}, null);
  if (error) return bad(res, error);
  const id = insertTask(t, req.user.id, null);
  if (t.customer_id) L.systemEntry(t.customer_id, req.user.id, `${U.TASK_KINDS[t.kind]} angelegt: ${t.title}`);
  await L.notifyAssignment(id, req.user.id);
  await L.notifyParticipants(id, req.user.id, all('SELECT user_id FROM task_participants WHERE task_id=?', id).map((r) => r.user_id));
  res.json({ id });
}));
app.put('/api/tasks/:id', auth, wrap(async (req, res) => {
  const old = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  const { t, error } = cleanTask({ ...old, ...req.body, customer_id: req.body.customer_id === undefined ? old.customer_id : req.body.customer_id }, old.customer_id);
  if (error) return bad(res, error);
  const resetReminder = old.due_date !== t.due_date;
  run(`UPDATE tasks SET customer_id=?, kind=?, title=?, description=?, due_date=?, due_time=?, duration_min=?, location=?, assigned_to=?, remind_day_before=?,
       reminder_sent=CASE WHEN ? THEN 0 ELSE reminder_sent END, auto_visit=CASE WHEN ? THEN 0 ELSE auto_visit END, updated_at=datetime('now','localtime') WHERE id=?`,
  t.customer_id, t.kind, t.title, t.description, t.due_date, t.due_time, t.duration_min, t.location, t.assigned_to ?? old.assigned_to, t.remind_day_before,
  resetReminder ? 1 : 0, (old.auto_visit && (resetReminder || old.title !== t.title)) ? 1 : 0, old.id);
  if (old.machine_id && old.status === 'open' && old.due_date !== t.due_date) run(`UPDATE machines SET next_service=? WHERE id=?`, t.due_date, old.machine_id);
  const added = t.participants ? setParticipants(old.id, t.participants, t.assigned_to ?? old.assigned_to) : [];
  if (t.assigned_to && t.assigned_to !== old.assigned_to) {
    run('DELETE FROM task_participants WHERE task_id=? AND user_id=?', old.id, t.assigned_to);
    await L.notifyAssignment(old.id, req.user.id);
  }
  await L.notifyParticipants(old.id, req.user.id, added);
  res.json({ ok: true });
}));
app.post('/api/tasks/:id/done', auth, (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  if (t.status === 'done') return res.json({ ok: true });
  const note = U.str(req.body?.note, 10000);
  tx(() => {
    run(`UPDATE tasks SET status='done', done_at=?, done_by=?, done_note=?, updated_at=datetime('now','localtime') WHERE id=?`, U.nowLocal(), req.user.id, note, t.id);
    if (t.customer_id) {
      const kindMap = { besuch: 'besuch', anruf: 'telefonat', termin: 'termin', wartung: 'sonstiges' };
      if (note || kindMap[t.kind]) {
        run('INSERT INTO entries(customer_id, kind, happened_at, text, created_by) VALUES(?,?,?,?,?)', t.customer_id, kindMap[t.kind] || 'notiz', U.nowLocal(),
          `${U.TASK_KINDS[t.kind]} erledigt: ${t.title}${note ? '\n\n' + note : ''}`, req.user.id);
      } else {
        L.systemEntry(t.customer_id, req.user.id, `${U.TASK_KINDS[t.kind]} erledigt: ${t.title}`);
      }
      L.syncVisitTask(t.customer_id);
    }
    if (t.machine_id) L.machineServiced(t.machine_id, U.today());
  });
  if (t.created_by && t.created_by !== req.user.id) L.notify(t.created_by, `${req.user.name} hat „${t.title}“ erledigt`, t.id, t.customer_id);
  res.json({ ok: true });
});
app.post('/api/tasks/:id/reopen', auth, (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  run(`UPDATE tasks SET status='open', done_at=NULL, done_by=NULL, auto_visit=0, updated_at=datetime('now','localtime') WHERE id=?`, t.id);
  res.json({ ok: true });
});
app.delete('/api/tasks/:id', auth, (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  if (t.created_by && t.created_by !== req.user.id && t.assigned_to !== req.user.id && req.user.role !== 'admin'
    && !get('SELECT 1 FROM task_participants WHERE task_id=? AND user_id=?', t.id, req.user.id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const tfiles = all('SELECT stored_name FROM task_files WHERE task_id=?', t.id);
  run('DELETE FROM tasks WHERE id=?', t.id);
  for (const f of tfiles) fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
  if (t.machine_id && t.status === 'open') run('UPDATE machines SET next_service=NULL WHERE id=?', t.machine_id);
  if (t.auto_visit && t.customer_id) {
    // Automatische Besuchsaufgabe gelöscht -> Intervall bleibt, nächste wird neu berechnet
    L.syncVisitTask(t.customer_id);
  }
  res.json({ ok: true });
});

// ---------- Dashboard ----------
function birthdaysBetween(from, to) {
  // from/to: YYYY-MM-DD, Zeitraum max. 1 Jahr
  const rows = all(`SELECT id, first_name, last_name, company, birthday, city, mobile, phone FROM customers WHERE birthday IS NOT NULL AND birthday<>''`);
  const out = [];
  const fy = Number(from.slice(0, 4));
  for (const c of rows) {
    for (const y of [fy, fy + 1]) {
      let md = c.birthday.slice(5);
      if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) md = '02-28';
      const d = `${y}-${md}`;
      if (d >= from && d <= to) { out.push({ ...c, date: d, age: y - Number(c.birthday.slice(0, 4)) }); break; }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

app.get('/api/dashboard', auth, (req, res) => {
  const start = U.isDate(req.query.week) ? req.query.week : U.today();
  const d = U.parseDate(start); const dow = (d.getDay() + 6) % 7;
  const monday = U.addDays(start, -dow); const sunday = U.addDays(monday, 6);
  const scope = req.query.scope === 'all' ? 'all' : (/^\d+$/.test(req.query.scope || '') ? Number(req.query.scope) : 'mine');
  const who = scope === 'all' ? '' : `AND ${INVOLVES}`;
  const whoId = scope === 'mine' ? req.user.id : scope;
  const whoP = scope === 'all' ? [] : [whoId, whoId];
  res.json({
    monday, sunday, today: U.today(),
    week: all(`${TASK_SQL} WHERE t.due_date BETWEEN ? AND ? ${who} ORDER BY t.due_date, t.due_time IS NOT NULL, t.due_time`, monday, sunday, ...whoP),
    open: all(`${TASK_SQL} WHERE t.status='open' ${who} ORDER BY t.due_date, t.due_time IS NOT NULL, t.due_time LIMIT 300`, ...whoP),
    birthdaysWeek: birthdaysBetween(monday, sunday),
    birthdaysUpcoming: birthdaysBetween(U.today(), U.addDays(U.today(), 30)),
    delegated: all(`${TASK_SQL} WHERE t.status='open' AND t.created_by=? AND t.assigned_to<>? ORDER BY t.due_date LIMIT 50`, req.user.id, req.user.id),
    stats: {
      customers: get('SELECT COUNT(*) n FROM customers').n,
      overdue: get(`SELECT COUNT(*) n FROM tasks t WHERE status='open' AND due_date<? ${who}`, U.today(), ...whoP).n,
      dueToday: get(`SELECT COUNT(*) n FROM tasks t WHERE status='open' AND due_date=? ${who}`, U.today(), ...whoP).n,
      dueTomorrow: get(`SELECT COUNT(*) n FROM tasks t WHERE status='open' AND due_date=? ${who}`, U.addDays(U.today(), 1), ...whoP).n,
    },
  });
});

app.get('/api/calendar', auth, (req, res) => {
  if (!U.isDate(req.query.from) || !U.isDate(req.query.to)) return bad(res, 'Zeitraum fehlt');
  const scope = req.query.scope === 'all' ? 'all' : (/^\d+$/.test(req.query.scope || '') ? Number(req.query.scope) : req.user.id);
  const who = scope === 'all' ? '' : `AND ${INVOLVES}`;
  res.json({
    tasks: all(`${TASK_SQL} WHERE t.due_date BETWEEN ? AND ? ${who} ORDER BY t.due_date, t.due_time IS NOT NULL, t.due_time`, req.query.from, req.query.to, ...(scope === 'all' ? [] : [scope, scope])),
    birthdays: birthdaysBetween(req.query.from, req.query.to),
  });
});

// ---------- Hinweise ----------
app.get('/api/notifications', auth, (req, res) => {
  res.json(all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', req.user.id));
});
app.post('/api/notifications/read', auth, (req, res) => {
  if (req.body?.id) run('UPDATE notifications SET read=1 WHERE user_id=? AND id=?', req.user.id, req.body.id);
  else run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id);
  res.json({ ok: true });
});

// ---------- Suche (global) ----------
app.get('/api/search', auth, (req, res) => {
  const { sql, params } = customerQuery({ q: req.query.q || '' });
  res.json(all(sql + ' LIMIT 8', ...params).map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, company: c.company, city: c.city })));
});

// ---------- Import ----------
app.get('/api/import/template.xlsx', auth, (req, res) => {
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="Kunden_Importvorlage.xlsx"');
  res.send(importer.template());
});
app.post('/api/import/preview', auth, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  try {
    const { rows, mapping } = importer.parseWorkbook(req.body);
    const existing = all('SELECT id, first_name, last_name, zip, email, mobile FROM customers');
    const merged = importer.dedupe(rows, existing);
    res.json({ rows: merged, mapping, total: rows.length });
  } catch (e) { bad(res, e.message || 'Datei konnte nicht gelesen werden'); }
});
app.post('/api/import/commit', auth, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 20000) : [];
  const dupMode = ['merge', 'skip', 'create'].includes(req.body?.dupMode) ? req.body.dupMode : 'merge';
  let created = 0; let updated = 0; const skipped = [];
  tx(() => {
    rows.forEach((row, i) => {
      const dupId = Number(row._duplicate) || null;
      const old = dupId ? get('SELECT * FROM customers WHERE id=?', dupId) : null;
      if (old && dupMode === 'skip') { skipped.push({ row: i + 1, error: 'bereits vorhanden' }); return; }
      if (old && dupMode === 'merge') {
        const { c: incoming, error } = cleanCustomer({ ...row, owner_id: old.owner_id });
        if (error) { skipped.push({ row: i + 1, error }); return; }
        incoming.info = U.str(row.info, 20000) || '';
        const target = { ...old };
        const changed = importer.mergeInto(target, incoming);
        if (!changed.length) return;
        run(`UPDATE customers SET ${importer.MERGE_FIELDS.map((f) => f + '=?').join(',')}, info=?, is_buyer=?, tags=?, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`,
          ...importer.MERGE_FIELDS.map((f) => target[f] ?? (f === 'visit_interval' ? '' : null)), target.info || '', target.is_buyer ? 1 : 0, U.tagsStore(U.tagsFrom(target.tags)), req.user.id, old.id);
        L.systemEntry(old.id, req.user.id, `Per Import ergänzt: ${changed.map((f) => FIELD_LABEL[f] || f).join(', ')}`);
        if (['street', 'zip', 'city'].some((f) => changed.includes(f))) run(`UPDATE customers SET lat=NULL, lng=NULL, geo_status='' WHERE id=?`, old.id);
        if (changed.includes('visit_interval')) L.syncVisitTask(old.id);
        updated++;
        return;
      }
      const { c, error } = cleanCustomer({ ...row, owner_id: row.owner_id || req.user.id });
      if (error) { skipped.push({ row: i + 1, error }); return; }
      const r = run(`INSERT INTO customers(${CUSTOMER_FIELDS.join(',')}, info, created_by, updated_by) VALUES(${CUSTOMER_FIELDS.map(() => '?').join(',')}, ?, ?, ?)`,
        ...CUSTOMER_FIELDS.map((f) => c[f] ?? (f === 'visit_interval' ? '' : null)), U.str(row.info, 20000) || '', req.user.id, req.user.id);
      const n = Number(row._count) > 1 ? ` (aus ${Number(row._count)} Zeilen zusammengefasst)` : '';
      L.systemEntry(Number(r.lastInsertRowid), req.user.id, 'Kunde per Excel-Import angelegt' + n);
      L.syncVisitTask(Number(r.lastInsertRowid));
      created++;
    });
  });
  res.json({ created, updated, skipped });
});

// ---------- Dateien ----------
app.post('/api/customers/:id/files', auth, express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const c = get('SELECT id FROM customers WHERE id=?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const name = U.str(decodeURIComponent(req.get('X-Filename') || 'datei'), 200).replace(/[\\/\0]/g, '_');
  if (!req.body || !req.body.length) return bad(res, 'Leere Datei');
  const stored = `${c.id}_${U.token(12)}`;
  fs.writeFileSync(path.join(DATA_DIR, 'files', stored), req.body);
  run('INSERT INTO files(customer_id, filename, stored_name, mime, size, uploaded_by) VALUES(?,?,?,?,?,?)', c.id, name, stored, String(req.get('Content-Type') || 'application/octet-stream').slice(0, 100), req.body.length, req.user.id);
  L.systemEntry(c.id, req.user.id, `Datei hochgeladen: ${name}`);
  res.json({ ok: true });
});
app.get('/api/files/:id', auth, (req, res) => {
  const f = get('SELECT * FROM files WHERE id=?', req.params.id);
  if (!f) return res.status(404).end();
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime || '') && req.query.download !== '1';
  res.set('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(path.join(DATA_DIR, 'files', f.stored_name));
});
app.delete('/api/files/:id', auth, (req, res) => {
  const f = get('SELECT * FROM files WHERE id=?', req.params.id);
  if (!f) return res.status(404).json({ error: 'Datei nicht gefunden' });
  if (f.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Keine Berechtigung' });
  run('DELETE FROM files WHERE id=?', f.id);
  fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
  L.systemEntry(f.customer_id, req.user.id, `Datei gelöscht: ${f.filename}`);
  res.json({ ok: true });
});

// ---------- Bilder & Dateien an Aufgaben ----------
app.post('/api/tasks/:id/files', auth, express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const t = get('SELECT id FROM tasks WHERE id=?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  if (!req.body || !req.body.length) return bad(res, 'Leere Datei');
  if (get('SELECT COUNT(*) n FROM task_files WHERE task_id=?', t.id).n >= 30) return bad(res, 'Maximal 30 Dateien pro Aufgabe');
  const name = U.str(decodeURIComponent(req.get('X-Filename') || 'bild.jpg'), 200).replace(/[\\/\0]/g, '_');
  const stored = `task${t.id}_${U.token(12)}`;
  fs.writeFileSync(path.join(DATA_DIR, 'files', stored), req.body);
  const r = run('INSERT INTO task_files(task_id, filename, stored_name, mime, size, uploaded_by) VALUES(?,?,?,?,?,?)', t.id, name, stored, String(req.get('Content-Type') || 'application/octet-stream').slice(0, 100), req.body.length, req.user.id);
  run(`UPDATE tasks SET updated_at=datetime('now','localtime') WHERE id=?`, t.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.get('/api/task-files/:id', auth, (req, res) => {
  const f = get('SELECT * FROM task_files WHERE id=?', req.params.id);
  if (!f) return res.status(404).end();
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime || '') && req.query.download !== '1';
  res.set('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(DATA_DIR, 'files', f.stored_name));
});
app.delete('/api/task-files/:id', auth, (req, res) => {
  const f = get('SELECT f.*, t.created_by task_creator, t.assigned_to FROM task_files f JOIN tasks t ON t.id=f.task_id WHERE f.id=?', req.params.id);
  if (!f) return res.status(404).json({ error: 'Datei nicht gefunden' });
  if (![f.uploaded_by, f.task_creator, f.assigned_to].includes(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Keine Berechtigung' });
  run('DELETE FROM task_files WHERE id=?', f.id);
  fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
  res.json({ ok: true });
});

// ---------- Kalender-Abo (iCal) ----------
app.get('/ical/:token.ics', (req, res) => {
  const u = get('SELECT * FROM users WHERE ical_token=? AND active=1', req.params.token);
  if (!u) return res.status(404).send('Not found');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="bussmann-crm.ics"');
  res.set('Cache-Control', 'no-cache');
  res.send(buildFeed(u, { birthdays: req.query.birthdays !== '0' }));
});

// ---------- Frontend ----------
app.get('/favicon.ico', (req, res) => res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(__dirname, 'public', 'img', 'favicon.ico')));
// Desktop-Verknüpfung für Windows (.url-Datei mit Bussmann-Symbol)
app.get('/Bussmann-CRM.url', (req, res) => {
  const base = appUrl() || `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="Bussmann CRM.url"');
  res.send(`[InternetShortcut]\r\nURL=${base}/\r\nIconFile=${base}/favicon.ico\r\nIconIndex=0\r\n`);
});
app.get('/healthz', (req, res) => res.json({ ok: true }));
// HTML/JS/CSS immer neu prüfen (ETag), damit Updates sofort ankommen
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', setHeaders: (res, p) => res.set('Cache-Control', /\.(png|ico)$/.test(p) ? 'public, max-age=86400' : 'no-cache') }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Datei zu groß' });
  res.status(500).json({ error: 'Interner Fehler' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Bussmann CRM läuft auf http://localhost:${PORT}`);
    L.startScheduler();
    geo.startGeocoder();
  });
}
module.exports = app;
