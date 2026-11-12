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
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); // OSM-Kacheln brauchen die Herkunft
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
  o.ai_key_set = !!getSetting('ai_key'); o.ai_env = !!process.env.ANTHROPIC_API_KEY;
  o.env_override = !!process.env.SMTP_HOST;
  res.json(o);
});
app.put('/api/settings', auth, admin, (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]).trim());
  if (b.smtp_pass) setSetting('smtp_pass', b.smtp_pass);
  if (b.smtp_pass_clear) setSetting('smtp_pass', '');
  if (b.ai_key) setSetting('ai_key', String(b.ai_key).trim());
  if (b.ai_key_clear) setSetting('ai_key', '');
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
  (SELECT MAX(d) FROM (
    SELECT happened_at d FROM entries e WHERE e.customer_id=c.id AND e.kind<>'system'
    UNION ALL SELECT substr(replace(t.done_at,' ','T'),1,16) FROM tasks t WHERE t.customer_id=c.id AND t.status='done' AND t.done_at IS NOT NULL
    UNION ALL SELECT substr(replace(t.created_at,' ','T'),1,16) FROM tasks t WHERE t.customer_id=c.id AND t.auto_visit=0 AND t.machine_id IS NULL
  )) last_contact
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
  const projects = all(`${PROJECT_SQL} WHERE p.customer_id=? ORDER BY ${PROJ_CLOSED_SQL}, p.faellig IS NULL, p.faellig`, c.id).map(projCalc);
  const ids = all('SELECT id FROM customers ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE').map((r) => r.id);
  const i = ids.indexOf(c.id);
  res.json({ customer: c, entries, tasks, files, machines, projects, prev: ids[i - 1] || null, next: ids[i + 1] || null });
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
// ---------- Gespeicherte Touren (je Benutzer) ----------
function tourOut(t) {
  let ids = [];
  try { ids = JSON.parse(t.stops).map(Number).filter(Number.isInteger); } catch { /* leer */ }
  const byId = new Map(ids.length ? all(`SELECT id, first_name, last_name, company, street, zip, city, lat, lng FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((c) => [c.id, c]) : []);
  return { id: t.id, name: t.name, updated_at: t.updated_at, stops: ids.map((i) => byId.get(i)).filter(Boolean) };
}
function cleanTour(b) {
  const name = U.str(b.name, 100);
  if (!name) return { error: 'Bitte einen Namen für die Tour eingeben' };
  const ids = [...new Set((Array.isArray(b.stops) ? b.stops : []).map(Number).filter(Number.isInteger))].slice(0, 300);
  if (!ids.length) return { error: 'Die Tour hat noch keine Stationen' };
  return { name, stops: JSON.stringify(ids) };
}
/** Touren sehen alle; ändern darf der Benutzer selbst oder ein Administrator */
const canTour = (req, userId) => req.user.role === 'admin' || Number(userId) === req.user.id;
const myTour = (req) => { const t = get('SELECT * FROM tours WHERE id=?', req.params.id); return t && canTour(req, t.user_id) ? t : null; };
/** Namensliste (z. B. alte Kalendertour) mit den Kunden abgleichen */
app.post('/api/tours/match', auth, (req, res) => {
  const text = String((req.body || {}).text || '');
  if (!text.trim()) return bad(res, 'Bitte die Liste einfügen');
  const customers = all('SELECT id, first_name, last_name, company, street, zip, city, lat, lng FROM customers');
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rows = require('./lib/tour-match').matchList(text, customers).map((r) => ({
    ...r, candidates: r.candidates.map((k) => { const c = byId.get(k.id); return { id: c.id, score: k.score, first_name: c.first_name, last_name: c.last_name, company: c.company, street: c.street, zip: c.zip, city: c.city }; }),
  }));
  res.json({ rows });
});
app.get('/api/tours', auth, (req, res) => {
  const uid = Number(req.query.user) || req.user.id;
  res.json(all('SELECT * FROM tours WHERE user_id=? ORDER BY lower(name)', uid).map(tourOut));
});
app.post('/api/tours', auth, (req, res) => {
  const t = cleanTour(req.body || {});
  if (t.error) return bad(res, t.error);
  const uid = Number(req.body.user_id) || req.user.id;
  if (!get('SELECT id FROM users WHERE id=?', uid)) return bad(res, 'Benutzer nicht gefunden');
  if (!canTour(req, uid)) return res.status(403).json({ error: 'Touren für andere Benutzer kann nur ein Administrator anlegen' });
  const id = Number(run('INSERT INTO tours(user_id, name, stops) VALUES(?,?,?)', uid, t.name, t.stops).lastInsertRowid);
  res.json(tourOut(get('SELECT * FROM tours WHERE id=?', id)));
});
app.put('/api/tours/:id', auth, (req, res) => {
  const old = myTour(req);
  if (!old) return res.status(404).json({ error: 'Tour nicht gefunden' });
  const t = cleanTour({ name: old.name, stops: JSON.parse(old.stops), ...req.body });
  if (t.error) return bad(res, t.error);
  run(`UPDATE tours SET name=?, stops=?, updated_at=datetime('now','localtime') WHERE id=?`, t.name, t.stops, old.id);
  res.json(tourOut(get('SELECT * FROM tours WHERE id=?', old.id)));
});
app.delete('/api/tours/:id', auth, (req, res) => {
  const old = myTour(req);
  if (!old) return res.status(404).json({ error: 'Tour nicht gefunden' });
  run('DELETE FROM tours WHERE id=?', old.id);
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
    run('UPDATE customers SET is_buyer=1 WHERE id=?', c.id); // Kunde mit Maschine = kaufender Kunde
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

// ---------- Verkaufsprojekte (alle Marken) ----------
/** Anzeigename eines Kunden (Alias c): „Firma – Vorname Nachname“, ohne Dopplung wenn Nachname = Firma */
const CUST_PERSON_SQL = `TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))`;
const CUST_LABEL_SQL = `NULLIF(TRIM(COALESCE(c.company,'') || CASE WHEN COALESCE(c.company,'')<>'' AND ${CUST_PERSON_SQL}<>'' AND ${CUST_PERSON_SQL}<>TRIM(c.company) THEN ' – ' || ${CUST_PERSON_SQL} WHEN COALESCE(c.company,'')='' THEN ${CUST_PERSON_SQL} ELSE '' END), '')`;
const PROJ_STATUS = [['Lead / Interesse', 0.10], ['Bedarf geklärt', 0.25], ['Vorführung', 0.40], ['Angebot erstellt', 0.50], ['Verhandlung', 0.75], ['Gewonnen', 1], ['Verloren', 0], ['Zurückgestellt', 0.05]];
const PROJ_PROB = Object.fromEntries(PROJ_STATUS);
const PROJ_CLOSED = ['Gewonnen', 'Verloren', 'Zurückgestellt'];
const PROJ_CLOSED_SQL = `p.status IN (${PROJ_CLOSED.map((s) => `'${s}'`).join(',')})`;
const PROJ_FIN = ['Offen', 'Bar / Überweisung', 'Finanzierung', 'Leasing', 'Miete / Mietkauf'];
const PROJECT_SQL = `SELECT p.*, u.name user_name,
  (SELECT s.id FROM sales s WHERE s.project_id=p.id AND s.kind='verkauf' LIMIT 1) sale_id,
  COALESCE(${CUST_LABEL_SQL}, p.kunde) kunde_name,
  COALESCE(NULLIF(c.city,''), p.ort) ort_name
  FROM projects p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN customers c ON c.id=p.customer_id`;
/** Ampel der Wiedervorlage: rot = überfällig, gelb = in 7 Tagen, grün = später, '' = ohne Termin/abgeschlossen */
function projAmpel(p) {
  if (!p.faellig || PROJ_CLOSED.includes(p.status)) return '';
  const t = U.today();
  if (p.faellig < t) return 'rot';
  return p.faellig <= U.addDays(t, 7) ? 'gelb' : 'gruen';
}
const projCalc = (p) => ({ ...p, prob: PROJ_PROB[p.status] ?? 0, closed: PROJ_CLOSED.includes(p.status), ampel: projAmpel(p) });
const PROJ_FIELDS = ['customer_id', 'kunde', 'ort', 'ansprech', 'telefon', 'brand', 'typ', 'modell', 'ausstattung', 'status', 'preis', 'angebot_vom', 'finanzierung', 'inzahlung', 'inz_wert', 'naechster', 'faellig', 'abschluss', 'liefer', 'user_id', 'notizen'];
function cleanProject(b, user) {
  const d = (v) => (U.isDate(v) ? v : null);
  const p = {
    customer_id: b.customer_id && get('SELECT id FROM customers WHERE id=?', b.customer_id) ? Number(b.customer_id) : null,
    kunde: U.str(b.kunde, 200) || '', ort: U.str(b.ort, 100) || '', ansprech: U.str(b.ansprech, 120) || '', telefon: U.str(b.telefon, 60) || '',
    brand: U.str(b.brand, 60) || '', typ: U.str(b.typ, 60) || '', modell: U.str(b.modell, 100) || '', ausstattung: U.str(b.ausstattung, 500) || '',
    status: PROJ_PROB[b.status] !== undefined ? b.status : 'Lead / Interesse',
    preis: money(b.preis), angebot_vom: d(b.angebot_vom), finanzierung: PROJ_FIN.includes(b.finanzierung) ? b.finanzierung : 'Offen',
    inzahlung: U.str(b.inzahlung, 300) || '', inz_wert: money(b.inz_wert),
    naechster: U.str(b.naechster, 300) || '', faellig: d(b.faellig), abschluss: d(b.abschluss), liefer: d(b.liefer),
    user_id: b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : user.id,
    notizen: U.str(b.notizen, 5000) || '',
  };
  if (Number.isNaN(p.preis) || Number.isNaN(p.inz_wert)) return { error: 'Bitte Beträge als Zahl eingeben' };
  if (!p.customer_id && !p.kunde) return { error: 'Bitte einen Kunden auswählen oder den Namen eintragen' };
  if (!p.brand) return { error: 'Bitte die Marke auswählen' };
  return { p };
}
/** Wiedervorlage als Aufgabe (Kalender, Erinnerung) für den Verkäufer */
function syncProjectTask(id) {
  const p = get(`${PROJECT_SQL} WHERE p.id=?`, id);
  if (!p) return;
  const open = get(`SELECT * FROM tasks WHERE project_id=? AND status='open'`, id);
  if (!p.faellig || PROJ_CLOSED.includes(p.status)) { if (open) run('DELETE FROM tasks WHERE id=?', open.id); return; }
  const title = `Wiedervorlage: ${p.naechster || 'Verkaufsprojekt'} – ${[p.brand, p.modell].filter(Boolean).join(' ')} – ${p.kunde_name}`.slice(0, 200);
  const description = [`Verkaufsprojekt Nr. ${p.id} · ${p.status}`, p.preis != null ? `Angebot ${p.preis.toLocaleString('de-DE')} € netto` : '', p.inzahlung ? `Inzahlungnahme: ${p.inzahlung}` : '', p.ansprech ? `Ansprechpartner: ${p.ansprech}${p.telefon ? ' (' + p.telefon + ')' : ''}` : ''].filter(Boolean).join('\n');
  if (open) {
    run(`UPDATE tasks SET due_date=?, title=?, description=?, assigned_to=?, customer_id=?, reminder_sent=CASE WHEN due_date=? THEN reminder_sent ELSE 0 END, updated_at=datetime('now','localtime') WHERE id=?`,
      p.faellig, title, description, p.user_id, p.customer_id, p.faellig, open.id);
  } else if (!get(`SELECT 1 FROM tasks WHERE project_id=? AND status='done' AND due_date=?`, id, p.faellig)) { // erledigte Wiedervorlage nicht neu anlegen
    run(`INSERT INTO tasks(customer_id, project_id, kind, title, description, due_date, assigned_to, created_by, remind_day_before) VALUES(?,?,?,?,?,?,?,?,1)`,
      p.customer_id, id, 'angebot', title, description, p.faellig, p.user_id, null);
  }
}
/** Gewonnen -> automatisch Verkauf (und Inzahlungnahme als Einkauf) unter „Verkäufe“; zurückgesetzt -> wieder entfernen */
function syncProjectSale(id, oldStatus, userId) {
  const p = get(`${PROJECT_SQL} WHERE p.id=?`, id);
  if (!p) return;
  const linked = all('SELECT * FROM sales WHERE project_id=?', id);
  if (p.status === 'Gewonnen' && !linked.length) {
    const date = U.today();
    const base = { date, user_id: p.user_id, customer_id: p.customer_id, party: p.customer_id ? '' : [p.kunde, p.ort].filter(Boolean).join(', '), condition: 'neu', category: p.typ || null, brand: p.brand || null, model: p.modell || null, serial: null, year: null, extra_costs: 0, purchase_id: null };
    const ins = (s) => Number(run(`INSERT INTO sales(${SALE_FIELDS.join(',')}, project_id, created_by) VALUES(${SALE_FIELDS.map(() => '?').join(',')}, ?, ?)`, ...SALE_FIELDS.map((f) => s[f] ?? null), id, userId).lastInsertRowid);
    const sid = ins({ ...base, kind: 'verkauf', purchase_price: null, sale_price: p.preis ?? 0,
      notes: [`Aus Verkaufsprojekt Nr. ${p.id}`, p.ausstattung ? `Ausstattung: ${p.ausstattung}` : '', p.finanzierung !== 'Offen' ? `Finanzierung: ${p.finanzierung}` : '', p.inzahlung ? `Inzahlungnahme: ${p.inzahlung}${p.inz_wert != null ? ' (' + p.inz_wert.toLocaleString('de-DE') + ' €)' : ''}` : ''].filter(Boolean).join('\n') });
    const mid = machineFromSale({ ...base, kind: 'verkauf' }, userId);
    if (mid) run('UPDATE sales SET machine_id=? WHERE id=?', mid, sid);
    if (p.inzahlung || p.inz_wert != null) {
      const eid = ins({ ...base, kind: 'einkauf', condition: 'gebraucht', category: null, brand: null, model: p.inzahlung || 'Inzahlungnahme', purchase_price: p.inz_wert ?? 0, sale_price: null, notes: `Inzahlungnahme aus Verkaufsprojekt Nr. ${p.id}` });
      usedFromPurchase(eid, userId);
    }
  } else if (oldStatus === 'Gewonnen' && p.status !== 'Gewonnen' && linked.length) {
    // Projekt doch nicht gewonnen: automatisch angelegte Einträge wieder entfernen (Maschine beim Kunden bleibt)
    run('UPDATE sales SET purchase_id=NULL WHERE purchase_id IN (SELECT id FROM sales WHERE project_id=?)', id);
    run(`DELETE FROM used_machines WHERE status='verfuegbar' AND purchase_id IN (SELECT id FROM sales WHERE project_id=?) AND NOT EXISTS (SELECT 1 FROM used_photos f WHERE f.used_id=used_machines.id)`, id);
    run('DELETE FROM sales WHERE project_id=?', id);
  }
}
function projectsQuery(q) {
  const where = []; const params = [];
  if (!q.status) where.push(`NOT ${PROJ_CLOSED_SQL}`);
  else if (q.status !== '*' && PROJ_PROB[q.status] !== undefined) { where.push('p.status=?'); params.push(q.status); }
  if (q.user && q.user !== 'all') { where.push('p.user_id=?'); params.push(Number(q.user)); }
  if (q.brand) { where.push('p.brand=?'); params.push(q.brand); }
  if (q.q) { where.push(`(COALESCE(c.last_name,'') || ' ' || COALESCE(c.first_name,'') || ' ' || COALESCE(c.company,'') || ' ' || COALESCE(c.city,'') || ' ' || p.kunde || ' ' || p.ort || ' ' || p.ansprech || ' ' || p.typ || ' ' || p.modell || ' ' || p.ausstattung || ' ' || p.naechster || ' ' || p.notizen || ' ' || p.inzahlung) LIKE ?`); params.push('%' + q.q + '%'); }
  if (q.meta) return [];
  return all(`${PROJECT_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.faellig IS NULL, p.faellig, p.id`, ...params).map(projCalc);
}
function projectStats(user) {
  const all_ = all(`${PROJECT_SQL} ${user && user !== 'all' ? 'WHERE p.user_id=?' : ''}`, ...(user && user !== 'all' ? [Number(user)] : [])).map(projCalc);
  const open = all_.filter((p) => !p.closed); const won = all_.filter((p) => p.status === 'Gewonnen'); const lost = all_.filter((p) => p.status === 'Verloren');
  const s = (a, f) => a.reduce((n, p) => n + (p[f] || 0), 0);
  return { open: open.length, volume: s(open, 'preis'), weighted: Math.round(open.reduce((n, p) => n + (p.preis || 0) * p.prob, 0)), won: won.length, won_volume: s(won, 'preis'),
    quote: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    overdue: all_.filter((p) => p.ampel === 'rot').length, soon: all_.filter((p) => p.ampel === 'gelb').length, trade_in: s(open, 'inz_wert') };
}
app.get('/api/projects', auth, (req, res) => {
  res.json({ rows: projectsQuery(req.query), stats: projectStats(req.query.user), statuses: PROJ_STATUS, financing: PROJ_FIN, ai: !!aiKey(), pdftext: offerText.available(),
    brands: all("SELECT DISTINCT brand FROM projects WHERE brand<>'' ORDER BY brand").map((r) => r.brand) });
});
app.get('/api/projects/report.html', auth, (req, res) => {
  const rows = projectsQuery(req.query); const st = projectStats(req.query.user);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => (n == null ? '' : Math.round(n).toLocaleString('de-DE') + ' €');
  const de = (d) => (d ? d.split('-').reverse().join('.') : '');
  const filt = !req.query.status ? 'Offene Projekte' : req.query.status === '*' ? 'Alle Projekte' : 'Status: ' + req.query.status;
  const who = req.query.user && req.query.user !== 'all' ? ' · ' + (get('SELECT name FROM users WHERE id=?', req.query.user)?.name || '') : '';
  const brand = req.query.brand ? req.query.brand + ' ' : '';
  const AMP = { rot: '#c0292f', gelb: '#e8a800', gruen: '#3f8f2e' };
  res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${h(brand)}Verkaufsprojekte ${de(U.today())}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wdth,wght@6..12,75..100,400..900&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 10mm 10mm 12mm; }
* { box-sizing: border-box; } body { font-family: 'Nunito Sans', Arial, sans-serif; color: #2b2d2e; font-size: 8.8pt; margin: 0; padding: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #c0292f; padding-bottom: 8px; margin-bottom: 10px; }
header img { height: 42px; } h1 { margin: 0; font-size: 17pt; font-stretch: 87.5%; } .sub { color: #6a6d6e; font-weight: 700; text-align: right; }
.kpis { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 10px; }
.kpi { border: 1px solid #ddd; border-left: 4px solid #c0292f; padding: 5px 8px; } .kpi .n { font-size: 12.5pt; font-weight: 900; font-stretch: 87.5%; } .kpi .l { color: #6a6d6e; font-size: 7pt; font-weight: 700; text-transform: uppercase; }
.kpi.a .n { color: #c0292f; }
table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; background: #2b2d2e; color: #fff; padding: 5px; }
td { padding: 4px 5px; border-bottom: 1px solid #e4e4e4; vertical-align: top; } tr { page-break-inside: avoid; } tbody tr:nth-child(even) td { background: #fafafa; }
.r { text-align: right; white-space: nowrap; } .m { color: #6a6d6e; font-size: 7.5pt; display: block; } .nowrap { white-space: nowrap; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
tr.won td { background: #eaf3e3 !important; } tr.lost td { color: #999; }
footer { margin-top: 12px; color: #8a8d8e; font-size: 7.5pt; display: flex; justify-content: space-between; }
.bar { position: fixed; top: 10px; right: 10px; } .bar button { font: inherit; font-weight: 700; padding: 8px 14px; border-radius: 6px; border: 0; background: #c0292f; color: #fff; cursor: pointer; }
@media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Drucken / als PDF speichern</button></div>
<header><img src="/img/logo.png" alt=""><div><h1>${h(brand)}Verkaufsprojekte</h1><div class="sub">${h(filt)}${h(who)} · Stand ${de(U.today())}</div></div></header>
<div class="kpis">
  <div class="kpi"><div class="n">${st.open}</div><div class="l">Offene Projekte</div></div>
  <div class="kpi"><div class="n">${eur(st.volume) || '0 €'}</div><div class="l">Angebotsvolumen offen</div></div>
  <div class="kpi"><div class="n">${eur(st.weighted) || '0 €'}</div><div class="l">Gewichtete Pipeline</div></div>
  <div class="kpi"><div class="n">${st.won} · ${eur(st.won_volume) || '0 €'}</div><div class="l">Gewonnen</div></div>
  <div class="kpi"><div class="n">${st.quote == null ? '–' : st.quote + ' %'}</div><div class="l">Abschlussquote</div></div>
  <div class="kpi ${st.overdue ? 'a' : ''}"><div class="n">${st.overdue}</div><div class="l">Wiedervorlage überfällig</div></div>
  <div class="kpi"><div class="n">${st.soon}</div><div class="l">Fällig in 7 Tagen</div></div>
</div>
<table><thead><tr><th>Nr.</th><th>Kunde / Ort</th><th>Ansprechpartner</th><th>Maschine</th><th>Status</th><th class="r">Wahrsch.</th><th class="r">Angebot netto</th><th class="r">Inzahlungn.</th><th>Nächster Schritt</th><th>Fällig</th><th>Abschluss</th><th>Lieferung</th><th>Verkäufer</th></tr></thead><tbody>
${rows.map((p) => `<tr class="${p.status === 'Gewonnen' ? 'won' : p.status === 'Verloren' ? 'lost' : ''}"><td>${p.id}</td><td><b>${h(p.kunde_name)}</b><span class="m">${h(p.ort_name)}</span></td><td>${h(p.ansprech)}<span class="m">${h(p.telefon)}</span></td>
<td><b>${h(p.brand)}</b> ${h([p.typ, p.modell].filter(Boolean).join(' '))}<span class="m">${h(p.ausstattung)}</span></td>
<td>${h(p.status)}<span class="m">${p.finanzierung !== 'Offen' ? h(p.finanzierung) : ''}</span></td><td class="r">${Math.round(p.prob * 100)} %</td>
<td class="r">${eur(p.preis)}${p.preis ? `<span class="m">gew. ${eur(p.preis * p.prob)}</span>` : ''}</td><td class="r">${eur(p.inz_wert)}<span class="m">${h(p.inzahlung)}</span></td>
<td>${h(p.naechster)}</td><td class="nowrap">${p.ampel ? `<span class="dot" style="background:${AMP[p.ampel]}"></span>` : ''}${de(p.faellig)}</td><td>${de(p.abschluss)}</td><td>${de(p.liefer)}</td><td>${h(p.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="13">Keine Projekte für diesen Filter.</td></tr>'}
</tbody></table>
<footer><span>Bussmann Land- &amp; Gartentechnik · Hauptstraße 5 · 48329 Havixbeck · 02507 1294</span><span>Ampel: rot = Wiedervorlage überfällig · gelb = in 7 Tagen · grün = später</span></footer>
<script>document.fonts && document.fonts.ready.then(() => setTimeout(() => window.print(), 300));</script>
</body></html>`);
});
app.get('/api/projects/:id', auth, (req, res) => {
  const p = get(`${PROJECT_SQL} WHERE p.id=?`, req.params.id);
  if (!p) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  res.json(projCalc(p));
});
app.post('/api/projects', auth, (req, res) => {
  const { p, error } = cleanProject(req.body || {}, req.user);
  if (error) return bad(res, error);
  const id = tx(() => {
    const id = Number(run(`INSERT INTO projects(${PROJ_FIELDS.join(',')}, created_by) VALUES(${PROJ_FIELDS.map(() => '?').join(',')}, ?)`, ...PROJ_FIELDS.map((f) => p[f]), req.user.id).lastInsertRowid);
    if (p.customer_id) L.systemEntry(p.customer_id, req.user.id, `Verkaufsprojekt angelegt: ${[p.brand, p.typ, p.modell].filter(Boolean).join(' ')} (${p.status})`);
    attachOffer(id, req.body && req.body.offer_file, req.user.id);
    syncProjectTask(id);
    syncProjectSale(id, null, req.user.id);
    return id;
  });
  res.json({ id });
});
app.put('/api/projects/:id', auth, (req, res) => {
  const old = get('SELECT * FROM projects WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const { p, error } = cleanProject({ ...old, ...req.body }, req.user);
  if (error) return bad(res, error);
  tx(() => {
    run(`UPDATE projects SET ${PROJ_FIELDS.map((f) => f + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`, ...PROJ_FIELDS.map((f) => p[f]), old.id);
    if (p.customer_id && old.status !== p.status) L.systemEntry(p.customer_id, req.user.id, `Verkaufsprojekt ${[p.brand, p.modell].filter(Boolean).join(' ')}: Status „${p.status}“`);
    attachOffer(old.id, req.body && req.body.offer_file, req.user.id);
    syncProjectTask(old.id);
    syncProjectSale(old.id, old.status, req.user.id);
  });
  res.json({ ok: true });
});
app.delete('/api/projects/:id', auth, (req, res) => {
  const old = get('SELECT * FROM projects WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  if (req.user.role !== 'admin' && old.created_by !== req.user.id && old.user_id !== req.user.id) return res.status(403).json({ error: 'Nur der Verkäufer oder ein Administrator kann das Projekt löschen' });
  tx(() => { run(`DELETE FROM tasks WHERE project_id=? AND status='open'`, old.id); run('UPDATE tasks SET project_id=NULL WHERE project_id=?', old.id); run('DELETE FROM projects WHERE id=?', old.id); });
  if (old.offer_stored) { try { fs.rmSync(path.join(DATA_DIR, 'files', old.offer_stored)); } catch { /* egal */ } }
  res.json({ ok: true });
});

// ---------- Angebot hochladen und automatisch auswerten ----------
const offer = require('./lib/offer');
const offerText = require('./lib/offer-text');
const aiKey = () => process.env.ANTHROPIC_API_KEY || getSetting('ai_key') || '';
const OFFER_RE = /^offer_[A-Za-z0-9_-]{8,40}$/;
const OFFER_TYPES = ['application/pdf', ...offer.IMAGE_TYPES];
/** Hochgeladene, aber nie gespeicherte Angebote nach einem Tag wegräumen */
function cleanupOffers() {
  const dir = path.join(DATA_DIR, 'files');
  const used = new Set(all('SELECT offer_stored s FROM projects WHERE offer_stored IS NOT NULL').map((r) => r.s));
  for (const n of fs.readdirSync(dir)) {
    if (!n.startsWith('offer_') || used.has(n)) continue;
    try { if (Date.now() - fs.statSync(path.join(dir, n)).mtimeMs > 864e5) fs.rmSync(path.join(dir, n)); } catch { /* egal */ }
  }
}
/** Angebotsdatei ans Projekt hängen (und beim Kunden unter „Dateien“ ablegen) */
function attachOffer(id, of, userId) {
  if (!of || !OFFER_RE.test(String(of.token || ''))) return;
  const src = path.join(DATA_DIR, 'files', of.token);
  if (!fs.existsSync(src)) return;
  const old = get('SELECT * FROM projects WHERE id=?', id);
  if (old.offer_stored === of.token) return;
  const name = U.str(of.name, 200)?.replace(/[\\/\0]/g, '_') || 'Angebot.pdf';
  const mime = OFFER_TYPES.includes(of.mime) ? of.mime : 'application/octet-stream';
  run('UPDATE projects SET offer_stored=?, offer_name=?, offer_mime=? WHERE id=?', of.token, name, mime, id);
  if (old.offer_stored && old.offer_stored !== of.token) fs.rm(path.join(DATA_DIR, 'files', old.offer_stored), () => {});
  if (old.customer_id) { // Kopie in die Kundenakte
    const stored = `${old.customer_id}_${U.token(12)}`;
    fs.copyFileSync(src, path.join(DATA_DIR, 'files', stored));
    run('INSERT INTO files(customer_id, filename, stored_name, mime, size, uploaded_by) VALUES(?,?,?,?,?,?)', old.customer_id, name, stored, mime, fs.statSync(src).size, userId);
    L.systemEntry(old.customer_id, userId, `Angebot hochgeladen: ${name}`);
  }
}
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^49/, '0');
/** passende Kunden im CRM zum ausgelesenen Angebot */
function matchCustomers(x) {
  const lc = (s) => String(s || '').trim().toLowerCase();
  const firma = lc(x.firma), nach = lc(x.nachname), vor = lc(x.vorname), ort = lc(x.ort), plz = String(x.plz || '').trim(), mail = lc(x.email), tel = digits(x.telefon);
  if (!firma && !nach && !mail && tel.length < 6) return [];
  const rows = all(`SELECT id, company, first_name, last_name, zip, city, email, mobile, phone FROM customers
    WHERE (?<>'' AND lower(company) LIKE ?) OR (?<>'' AND lower(last_name)=?) OR (?<>'' AND lower(email)=?)`,
  firma, `%${firma}%`, nach, nach, mail, mail);
  const scored = rows.map((c) => {
    let s = 0;
    if (firma && lc(c.company) === firma) s += 5; else if (firma && lc(c.company).includes(firma)) s += 3;
    if (nach && lc(c.last_name) === nach) s += 3;
    if (vor && lc(c.first_name) === vor) s += 2;
    if (plz && c.zip === plz) s += 2;
    if (ort && lc(c.city) === ort) s += 1;
    if (mail && lc(c.email) === mail) s += 4;
    if (tel.length >= 6 && [c.mobile, c.phone].some((t) => digits(t) === tel)) s += 4;
    return { id: c.id, name: [...new Set([c.company, [c.first_name, c.last_name].filter(Boolean).join(' ')].filter(Boolean))].join(' – '), city: c.city || '', score: s };
  }).filter((c) => c.score >= 3).sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}
const PROJ_TYPE_HINTS = ['Traktor', 'Kompakttraktor', 'Hoftrac', 'Radlader', 'Teleskopradlader', 'Teleskoplader', 'Mähdrescher', 'Presse', 'Aufsitzmäher', 'Mähroboter', 'Minibagger'];
const PROJ_BRAND_HINTS = ['Weidemann', 'Massey Ferguson', 'Fendt', 'Kubota', 'TAFE', 'Kandi', 'Husqvarna', 'Stihl'];
app.post('/api/projects/parse-offer', auth, express.raw({ type: () => true, limit: '25mb' }), wrap(async (req, res) => {
  if (!req.body || !req.body.length) return bad(res, 'Leere Datei');
  const mime = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!OFFER_TYPES.includes(mime)) return bad(res, 'Bitte das Angebot als PDF oder Foto (JPG/PNG) hochladen');
  const name = U.str(decodeURIComponent(req.get('X-Filename') || 'Angebot.pdf'), 200).replace(/[\\/\0]/g, '_');
  try { cleanupOffers(); } catch { /* egal */ }
  const token = `offer_${U.token(16)}`;
  fs.writeFileSync(path.join(DATA_DIR, 'files', token), req.body);
  const file = { token, name, mime, size: req.body.length };
  // 1. Angebote aus der Warenwirtschaft (PDF mit Text) direkt auslesen – kostenlos und sofort
  let x = null; let source = null; let error = null;
  if (mime === 'application/pdf') {
    try { x = offerText.parseText(await offerText.pdfText(req.body)); } catch { x = null; }
    if (x && x.preis_netto != null && (x.marke || x.modell)) source = 'text'; else x = null;
  }
  // 2. sonst (Foto, fremdes Angebot) mit der KI, wenn eingerichtet
  const key = aiKey();
  if (!x && key) {
    try {
      const brands = [...new Set([...PROJ_BRAND_HINTS, ...all("SELECT DISTINCT brand FROM projects WHERE brand<>''").map((r) => r.brand)])];
      x = await offer.parseOffer({ buffer: req.body, mime, apiKey: key, brands, types: PROJ_TYPE_HINTS, financing: PROJ_FIN.filter((f) => f !== 'Offen') });
      source = 'ai';
    } catch (e) {
      if (!(e instanceof offer.OfferError)) throw e;
      error = e.message;
    }
  }
  if (!x) return res.json({ file, ai: !!key, error: error || (key ? null : 'not_recognized') });
  const d = (v) => (U.isDate(v) ? v : null);
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const person = [x.vorname, x.nachname].filter(Boolean).join(' ');
  const fields = {
    kunde: [x.firma, person].filter(Boolean).join(' – '), ort: x.ort || '',
    ansprech: x.ansprechpartner || (x.firma ? person : '') || '', telefon: x.telefon || '',
    brand: x.marke || '', typ: x.maschinentyp || '', modell: x.modell || '', ausstattung: (x.ausstattung || '').slice(0, 500),
    preis: n(x.preis_netto), angebot_vom: d(x.angebot_datum), liefer: d(x.liefertermin),
    inzahlung: x.inzahlung || '', inz_wert: n(x.inzahlung_wert),
    finanzierung: PROJ_FIN.includes(x.finanzierung) ? x.finanzierung : '',
    notizen: [x.angebot_nr ? `Angebot Nr. ${x.angebot_nr}` : '', x.gueltig_bis && U.isDate(x.gueltig_bis) ? `gültig bis ${x.gueltig_bis.split('-').reverse().join('.')}` : '', x.hinweise || ''].filter(Boolean).join(' · ').slice(0, 1000),
  };
  const address = { company: x.firma || '', first_name: x.vorname || '', last_name: x.nachname || '', street: x.strasse || '', zip: x.plz || '', city: x.ort || '', email: x.email || '', phone: x.telefon || '' };
  res.json({ file, source, fields, address, matches: matchCustomers(x) });
}));
app.get('/api/projects/:id/offer', auth, (req, res) => {
  const p = get('SELECT offer_stored, offer_name, offer_mime FROM projects WHERE id=?', req.params.id);
  if (!p || !p.offer_stored) return res.status(404).end();
  const inline = OFFER_TYPES.includes(p.offer_mime) && req.query.download !== '1';
  res.set('Content-Type', inline ? p.offer_mime : 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(p.offer_name || 'Angebot')}`);
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(path.join(DATA_DIR, 'files', p.offer_stored));
});

// ---------- Verkäufe & Einkäufe (Deckungsbeitrag) ----------
const XLSX = require('xlsx');
/** "12.500,50 €" / "12500.5" / 12500 -> 12500.5 ; leer -> null */
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v).replace(/[€\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const SALE_COND = { neu: 'Neu', gebraucht: 'Gebraucht', vorfuehr: 'Vorführmaschine' };
const SALE_SQL = `SELECT s.*, u.name user_name,
  ${CUST_LABEL_SQL} customer_name,
  c.city customer_city,
  (SELECT v.id FROM sales v WHERE v.purchase_id=s.id AND v.kind='verkauf' LIMIT 1) sold_by_sale
  FROM sales s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id`;
const saleCalc = (s) => {
  if (s.kind !== 'verkauf') return { ...s, margin: null, margin_pct: null };
  const margin = s.sale_price != null && s.purchase_price != null ? Math.round((s.sale_price - s.purchase_price - (s.extra_costs || 0)) * 100) / 100 : null;
  return { ...s, margin, margin_pct: margin != null && s.sale_price ? Math.round((margin / s.sale_price) * 1000) / 10 : null };
};
const canSale = (u, s) => u.role === 'admin' || s.user_id === u.id || s.created_by === u.id;

function cleanSale(b, user) {
  const kind = b.kind === 'einkauf' ? 'einkauf' : 'verkauf';
  const year = Number(b.year);
  const s = {
    kind, date: U.isDate(b.date) ? b.date : U.today(),
    user_id: user.role === 'admin' && b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : user.id,
    customer_id: b.customer_id && get('SELECT id FROM customers WHERE id=?', b.customer_id) ? Number(b.customer_id) : null,
    party: U.str(b.party, 200) || '',
    condition: SALE_COND[b.condition] ? b.condition : 'neu',
    category: U.str(b.category, 60), brand: U.str(b.brand, 60), model: U.str(b.model, 100), serial: U.str(b.serial, 100),
    year: Number.isInteger(year) && year > 1900 && year < 2200 ? year : null,
    purchase_price: money(b.purchase_price), sale_price: kind === 'verkauf' ? money(b.sale_price) : null,
    extra_costs: money(b.extra_costs) || 0,
    purchase_id: kind === 'verkauf' && b.purchase_id ? Number(b.purchase_id) || null : null,
    notes: U.str(b.notes, 5000) || '',
  };
  for (const [f, l] of [['purchase_price', 'Einkaufspreis'], ['sale_price', 'Verkaufspreis'], ['extra_costs', 'Nebenkosten']]) if (Number.isNaN(s[f])) return { error: `${l} ist keine gültige Zahl` };
  if (!s.category && !s.brand && !s.model) return { error: 'Bitte mindestens Art, Marke oder Modell der Maschine angeben' };
  if (kind === 'verkauf' && s.sale_price == null) return { error: 'Bitte den Verkaufspreis angeben' };
  if (kind === 'einkauf' && s.purchase_price == null) return { error: 'Bitte den Einkaufspreis angeben' };
  if (s.purchase_id) {
    const p = get("SELECT * FROM sales WHERE id=? AND kind='einkauf'", s.purchase_id);
    if (!p) s.purchase_id = null;
    else if (s.purchase_price == null) s.purchase_price = p.purchase_price; // EK aus dem Einkauf übernehmen
  }
  return { s };
}
const SALE_FIELDS = ['kind', 'date', 'user_id', 'customer_id', 'party', 'condition', 'category', 'brand', 'model', 'serial', 'year', 'purchase_price', 'sale_price', 'extra_costs', 'purchase_id', 'notes'];

function salesQuery(q, user) {
  const where = []; const p = [];
  if (U.isDate(q.from)) { where.push('s.date>=?'); p.push(q.from); }
  if (U.isDate(q.to)) { where.push('s.date<=?'); p.push(q.to); }
  const uid = user.role === 'admin' ? (q.user && q.user !== 'all' ? Number(q.user) : null) : user.id;
  if (uid) { where.push('(s.user_id=? OR s.created_by=?)'); p.push(uid, uid); }
  if (q.kind === 'verkauf' || q.kind === 'einkauf') { where.push('s.kind=?'); p.push(q.kind); }
  if (q.q) { where.push("(s.brand || ' ' || s.model || ' ' || COALESCE(s.category,'') || ' ' || COALESCE(s.serial,'') || ' ' || s.party || ' ' || COALESCE(c.last_name,'') || ' ' || COALESCE(c.company,'')) LIKE ?"); p.push('%' + q.q + '%'); }
  return { rows: all(`${SALE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.date DESC, s.id DESC`, ...p).map(saleCalc), uid };
}
function salesSummary(rows) {
  const v = rows.filter((r) => r.kind === 'verkauf'); const e = rows.filter((r) => r.kind === 'einkauf');
  const sum = (a, f) => Math.round(a.reduce((n, r) => n + (r[f] || 0), 0) * 100) / 100;
  const withMargin = v.filter((r) => r.margin != null);
  const revenue = sum(v, 'sale_price'); const margin = sum(withMargin, 'margin');
  const revM = sum(withMargin, 'sale_price');
  return { sales: v.length, revenue, margin, margin_pct: revM ? Math.round((margin / revM) * 1000) / 10 : null, missing_ek: v.length - withMargin.length,
    purchases: e.length, purchase_sum: sum(e, 'purchase_price') };
}
app.get('/api/sales', auth, (req, res) => {
  const { rows, uid } = salesQuery(req.query, req.user);
  const byUser = [];
  if (!uid) {
    const m = new Map();
    for (const r of rows) { const k = r.user_id || 0; if (!m.has(k)) m.set(k, { user_id: r.user_id, name: r.user_name || '–', rows: [] }); m.get(k).rows.push(r); }
    for (const x of m.values()) byUser.push({ user_id: x.user_id, name: x.name, ...salesSummary(x.rows) });
    byUser.sort((a, b) => b.margin - a.margin);
  }
  // Lager: eigene Einkäufe, die noch nicht verkauft sind (unabhängig vom Zeitraum)
  const stock = all(`${SALE_SQL} WHERE s.kind='einkauf' AND NOT EXISTS (SELECT 1 FROM sales v WHERE v.purchase_id=s.id AND v.kind='verkauf') ORDER BY s.date`).map(saleCalc);
  res.json({ rows, summary: salesSummary(rows), byUser, stock, stock_value: Math.round(stock.reduce((n, r) => n + (r.purchase_price || 0), 0) * 100) / 100 });
});
app.get('/api/sales/export.xlsx', auth, (req, res) => {
  const { rows } = salesQuery(req.query, req.user);
  const head = ['Datum', 'Art', 'Verkäufer', 'Kunde / Lieferant', 'Ort', 'Maschinenart', 'Marke', 'Modell', 'Seriennummer', 'Baujahr', 'Zustand', 'EK netto', 'Nebenkosten', 'VK netto', 'Deckungsbeitrag', 'DB %', 'Notizen'];
  const data = rows.map((r) => [r.date.split('-').reverse().join('.'), r.kind === 'verkauf' ? 'Verkauf' : 'Einkauf', r.user_name || '', r.customer_name || r.party || '', r.customer_city || '', r.category || '', r.brand || '', r.model || '', r.serial || '', r.year || '', SALE_COND[r.condition] || '',
    r.purchase_price, r.kind === 'verkauf' ? r.extra_costs : null, r.sale_price, r.margin, r.margin_pct, r.notes]);
  const s = salesSummary(rows);
  data.push([], ['Summe Verkäufe', s.sales, '', '', '', '', '', '', '', '', '', '', '', s.revenue, s.margin, s.margin_pct], ['Summe Einkäufe', s.purchases, '', '', '', '', '', '', '', '', '', s.purchase_sum]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
  ws['!cols'] = head.map((h, i) => ({ wch: [10, 9, 16, 26, 14, 16, 14, 16, 16, 8, 12, 12, 12, 12, 15, 7, 30][i] }));
  for (let r = 1; r <= data.length; r++) for (const c of [11, 12, 13, 14]) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0.00 €'; }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Verkäufe');
  const name = `verkaeufe_${req.query.from || ''}_${req.query.to || ''}.xlsx`.replace(/_+\.xlsx$/, '.xlsx');
  res.set('Content-Disposition', `attachment; filename="${name}"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});
/** Monatsbericht als druckfertige Seite (im Browser „Als PDF speichern“) */
app.get('/api/sales/report.html', auth, (req, res) => {
  const { rows, uid } = salesQuery(req.query, req.user);
  const sum = salesSummary(rows);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => (n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
  const pct = (p) => (p == null ? '–' : String(p).replace('.', ',') + ' %');
  const de = (d) => (d ? d.split('-').reverse().join('.') : '');
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const from = U.isDate(req.query.from) ? req.query.from : ''; const to = U.isDate(req.query.to) ? req.query.to : '';
  let period = `${de(from)} – ${de(to)}`;
  if (from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01')) period = `${MON[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  else if (from && to && from.endsWith('-01-01') && to === from.slice(0, 4) + '-12-31') period = `Jahr ${from.slice(0, 4)}`;
  const who = uid ? (get('SELECT name FROM users WHERE id=?', uid)?.name || '') : 'alle Verkäufer';
  const byUser = [];
  if (!uid) {
    const m = new Map();
    for (const r of rows) { const k = r.user_id || 0; if (!m.has(k)) m.set(k, { name: r.user_name || '–', rows: [] }); m.get(k).rows.push(r); }
    for (const x of m.values()) byUser.push({ name: x.name, ...salesSummary(x.rows) });
    byUser.sort((a, b) => b.margin - a.margin);
  }
  const sales = rows.filter((r) => r.kind === 'verkauf').sort((a, b) => a.date.localeCompare(b.date));
  const buys = rows.filter((r) => r.kind === 'einkauf').sort((a, b) => a.date.localeCompare(b.date));
  const mach = (r) => `<b>${h([r.brand, r.model].filter(Boolean).join(' ') || r.category || 'Maschine')}</b>${r.category && (r.brand || r.model) ? ` <span class="m">${h(r.category)}</span>` : ''}<div class="m">${h([SALE_COND[r.condition], r.serial ? 'Nr. ' + r.serial : '', r.year ? 'Bj. ' + r.year : ''].filter(Boolean).join(' · '))}</div>`;
  const party = (r) => h(r.customer_name || r.party || '') + (r.customer_city ? `<div class="m">${h(r.customer_city)}</div>` : '');
  res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Verkaufsbericht ${h(period)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wdth,wght@6..12,75..100,400..900&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 12mm 12mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Nunito Sans', Arial, sans-serif; color: #2b2d2e; font-size: 10.5pt; margin: 0; padding: 18px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #c0292f; padding-bottom: 10px; margin-bottom: 14px; }
header img { height: 46px; } h1 { margin: 0; font-size: 20pt; font-stretch: 87.5%; } .sub { color: #6a6d6e; font-weight: 700; text-align: right; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.kpi { border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; } .kpi .n { font-size: 16pt; font-weight: 900; font-stretch: 87.5%; } .kpi .l { color: #6a6d6e; font-size: 9pt; font-weight: 700; }
.kpi.g { border-color: #9cc48a; background: #f3f9ef; }
h2 { font-size: 12pt; margin: 16px 0 6px; color: #c0292f; break-after: avoid; page-break-after: avoid; }
thead { display: table-header-group; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8.5pt; text-transform: uppercase; color: #6a6d6e; border-bottom: 1.5px solid #6a6d6e; padding: 4px 6px; }
td { padding: 5px 6px; border-bottom: 1px solid #e4e4e4; vertical-align: top; } tr { page-break-inside: avoid; }
.r { text-align: right; white-space: nowrap; } .m { color: #6a6d6e; font-size: 8.5pt; font-weight: 400; }
tfoot td { border-top: 1.5px solid #6a6d6e; border-bottom: 0; font-weight: 800; }
.neg { color: #a51e24; } footer { margin-top: 18px; color: #8a8d8e; font-size: 8pt; display: flex; justify-content: space-between; }
.bar { position: fixed; top: 10px; right: 10px; } .bar button { font: inherit; font-weight: 700; padding: 8px 14px; border-radius: 6px; border: 0; background: #c0292f; color: #fff; cursor: pointer; }
@media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Drucken / als PDF speichern</button></div>
<header><img src="/img/logo.png" alt=""><div><h1>Verkaufsbericht ${h(period)}</h1><div class="sub">${h(who)} · erstellt am ${de(U.today())} von ${h(req.user.name)}</div></div></header>
<div class="kpis">
  <div class="kpi"><div class="n">${sum.sales}</div><div class="l">Verkäufe</div></div>
  <div class="kpi"><div class="n">${eur(sum.revenue)}</div><div class="l">Umsatz netto</div></div>
  <div class="kpi g"><div class="n">${eur(sum.margin)}</div><div class="l">Deckungsbeitrag · ${pct(sum.margin_pct)}</div></div>
  <div class="kpi"><div class="n">${sum.purchases} · ${eur(sum.purchase_sum)}</div><div class="l">Einkäufe (EK netto)</div></div>
</div>
${sum.missing_ek ? `<p class="m">Hinweis: Bei ${sum.missing_ek} ${sum.missing_ek > 1 ? 'Verkäufen' : 'Verkauf'} fehlt der Einkaufspreis – ${sum.missing_ek > 1 ? 'diese sind' : 'dieser ist'} im Deckungsbeitrag nicht enthalten.</p>` : ''}
${byUser.length > 1 ? `<h2>Nach Verkäufer</h2><table><thead><tr><th>Verkäufer</th><th class="r">Verkäufe</th><th class="r">Umsatz</th><th class="r">Deckungsbeitrag</th><th class="r">DB %</th><th class="r">Einkäufe</th></tr></thead><tbody>
${byUser.map((u) => `<tr><td>${h(u.name)}</td><td class="r">${u.sales}</td><td class="r">${eur(u.revenue)}</td><td class="r"><b>${eur(u.margin)}</b></td><td class="r">${pct(u.margin_pct)}</td><td class="r">${u.purchases ? `${u.purchases} · ${eur(u.purchase_sum)}` : '–'}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>Verkäufe (${sales.length})</h2>
${sales.length ? `<table><thead><tr><th>Datum</th><th>Maschine</th><th>Kunde</th>${uid ? '' : '<th>Verkäufer</th>'}<th class="r">EK</th><th class="r">Nebenkosten</th><th class="r">VK</th><th class="r">Deckungsbeitrag</th><th class="r">DB %</th></tr></thead><tbody>
${sales.map((r) => `<tr><td>${de(r.date)}</td><td>${mach(r)}</td><td>${party(r)}</td>${uid ? '' : `<td>${h(r.user_name || '')}</td>`}<td class="r">${eur(r.purchase_price)}</td><td class="r">${r.extra_costs ? eur(r.extra_costs) : ''}</td><td class="r">${eur(r.sale_price)}</td><td class="r ${r.margin < 0 ? 'neg' : ''}"><b>${eur(r.margin)}</b></td><td class="r">${pct(r.margin_pct)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="${uid ? 3 : 4}">Summe</td><td></td><td></td><td class="r">${eur(sum.revenue)}</td><td class="r">${eur(sum.margin)}</td><td class="r">${pct(sum.margin_pct)}</td></tr></tfoot></table>` : '<p class="m">Keine Verkäufe in diesem Zeitraum.</p>'}
${buys.length ? `<h2>Einkäufe (${buys.length})</h2><table><thead><tr><th>Datum</th><th>Maschine</th><th>Gekauft von</th>${uid ? '' : '<th>Mitarbeiter</th>'}<th class="r">EK netto</th><th>Status</th></tr></thead><tbody>
${buys.map((r) => `<tr><td>${de(r.date)}</td><td>${mach(r)}</td><td>${party(r)}</td>${uid ? '' : `<td>${h(r.user_name || '')}</td>`}<td class="r">${eur(r.purchase_price)}</td><td>${r.sold_by_sale ? 'verkauft' : 'im Lager'}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="${uid ? 3 : 4}">Summe</td><td class="r">${eur(sum.purchase_sum)}</td><td></td></tr></tfoot></table>` : ''}
<footer><span>Bussmann Land- &amp; Gartentechnik · alle Beträge netto</span><span>vertraulich – nur für den internen Gebrauch</span></footer>
<script>document.fonts && document.fonts.ready.then(() => setTimeout(() => window.print(), 300));</script>
</body></html>`);
});
app.get('/api/sales/:id', auth, (req, res) => {
  const s = get(`${SALE_SQL} WHERE s.id=?`, req.params.id);
  if (!s || !canSale(req.user, s)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(saleCalc(s));
});
/** Verkauf an einen Kunden: Maschine beim Kunden anlegen (bzw. vorhandene ergänzen), Kunde wird kaufender Kunde */
function machineFromSale(s, userId) {
  if (s.kind !== 'verkauf' || !s.customer_id) return null;
  const m = { category: s.category, brand: s.brand, model: s.model, serial: s.serial, year: s.year, purchase_date: s.date, sold_by_us: 1 };
  const ex = s.serial ? all('SELECT * FROM machines WHERE customer_id=?', s.customer_id).find((x) => ns(x.serial) && ns(x.serial) === ns(s.serial)) : null;
  run('UPDATE customers SET is_buyer=1 WHERE id=?', s.customer_id);
  if (ex) { run("UPDATE machines SET sold_by_us=1, purchase_date=COALESCE(purchase_date, ?), updated_at=datetime('now','localtime') WHERE id=?", s.date, ex.id); return ex.id; }
  const r = run(`INSERT INTO machines(customer_id, category, brand, model, serial, year, purchase_date, sold_by_us, created_by, updated_by) VALUES(?,?,?,?,?,?,?,1,?,?)`,
    s.customer_id, m.category, m.brand, m.model, m.serial, m.year, m.purchase_date, userId, userId);
  L.systemEntry(s.customer_id, userId, `Maschine verkauft: ${L.machineName(m)}${m.serial ? ' (Nr. ' + m.serial + ')' : ''}`);
  return Number(r.lastInsertRowid);
}
app.post('/api/sales', auth, (req, res) => {
  const { s, error } = cleanSale(req.body || {}, req.user);
  if (error) return bad(res, error);
  const id = tx(() => {
    const r = run(`INSERT INTO sales(${SALE_FIELDS.join(',')}, created_by) VALUES(${SALE_FIELDS.map(() => '?').join(',')}, ?)`, ...SALE_FIELDS.map((f) => s[f]), req.user.id);
    const id = Number(r.lastInsertRowid);
    if (req.body.add_machine !== false) { const mid = machineFromSale(s, req.user.id); if (mid) run('UPDATE sales SET machine_id=? WHERE id=?', mid, id); }
    if (s.kind === 'einkauf' && s.condition !== 'neu' && req.body.to_stock !== false) usedFromPurchase(id, req.user.id);
    if (s.kind === 'verkauf') {
      const u = req.body.used_id ? get('SELECT * FROM used_machines WHERE id=?', req.body.used_id) : s.purchase_id ? get('SELECT * FROM used_machines WHERE purchase_id=?', s.purchase_id) : null;
      if (u && u.status !== 'verkauft') run(`UPDATE used_machines SET status='verkauft', sold_date=?, sale_id=?, updated_at=datetime('now','localtime') WHERE id=?`, s.date, id, u.id);
    }
    return id;
  });
  res.json({ id });
});
app.put('/api/sales/:id', auth, (req, res) => {
  const old = get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!old || !canSale(req.user, old)) return res.status(404).json({ error: 'Nicht gefunden' });
  const { s, error } = cleanSale({ user_id: old.user_id, ...req.body }, req.user);
  if (error) return bad(res, error);
  if (req.user.role !== 'admin') s.user_id = old.user_id;
  if (s.purchase_id === old.id) s.purchase_id = null;
  tx(() => {
    run(`UPDATE sales SET ${SALE_FIELDS.map((f) => f + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`, ...SALE_FIELDS.map((f) => s[f]), old.id);
    if (!old.machine_id && req.body.add_machine) { const mid = machineFromSale(s, req.user.id); if (mid) run('UPDATE sales SET machine_id=? WHERE id=?', mid, old.id); }
  });
  res.json({ ok: true });
});
app.delete('/api/sales/:id', auth, (req, res) => {
  const old = get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!old || !canSale(req.user, old)) return res.status(404).json({ error: 'Nicht gefunden' });
  run(`UPDATE used_machines SET status='verfuegbar', sold_date=NULL, sale_id=NULL WHERE sale_id=?`, old.id); // Verkauf gelöscht -> wieder im Lager
  run('DELETE FROM sales WHERE id=?', old.id); // Maschine beim Kunden bleibt bestehen
  res.json({ ok: true });
});

// ---------- Gebrauchtmaschinen-Lager & Suchaufträge ----------
const USED_STATUS = { verfuegbar: 'Verfügbar', reserviert: 'Reserviert', verkauft: 'Verkauft' };
const USED_FIELDS = ['category', 'brand', 'model', 'serial', 'year', 'hours', 'condition', 'equipment', 'description', 'purchase_price', 'asking_price', 'location', 'status', 'in_date', 'origin', 'customer_id', 'user_id', 'notes'];
const USED_SQL = `SELECT m.*, u.name user_name, ${CUST_LABEL_SQL} customer_name,
  (SELECT id FROM used_photos f WHERE f.used_id=m.id ORDER BY sort, id LIMIT 1) photo_id,
  (SELECT COUNT(*) FROM used_photos f WHERE f.used_id=m.id) photo_count
  FROM used_machines m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN customers c ON c.id=m.customer_id`;
const usedCalc = (m) => {
  const end = m.status === 'verkauft' && m.sold_date ? m.sold_date : U.today();
  const days = m.in_date ? Math.max(0, Math.round((new Date(end) - new Date(m.in_date)) / 864e5)) : null;
  const margin = m.asking_price != null && m.purchase_price != null ? Math.round((m.asking_price - m.purchase_price) * 100) / 100 : null;
  return { ...m, days, margin, title: [m.brand, m.model].filter(Boolean).join(' ') || m.category || 'Maschine' };
};
const intOrNull = (v, lo, hi) => { const n = Number(String(v ?? '').replace(/\./g, '')); return v !== '' && v != null && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
function cleanUsed(b, user) {
  const m = {
    category: U.str(b.category, 60) || null, brand: U.str(b.brand, 60) || null, model: U.str(b.model, 100) || null, serial: U.str(b.serial, 100) || null,
    year: intOrNull(b.year, 1900, 2200), hours: intOrNull(b.hours, 0, 1000000),
    condition: b.condition === 'vorfuehr' ? 'vorfuehr' : 'gebraucht',
    equipment: U.str(b.equipment, 3000) || '', description: U.str(b.description, 5000) || '',
    purchase_price: money(b.purchase_price), asking_price: money(b.asking_price), location: U.str(b.location, 100) || '',
    status: USED_STATUS[b.status] ? b.status : 'verfuegbar',
    in_date: U.isDate(b.in_date) ? b.in_date : U.today(), origin: U.str(b.origin, 300) || '',
    customer_id: b.customer_id && get('SELECT id FROM customers WHERE id=?', b.customer_id) ? Number(b.customer_id) : null,
    user_id: b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : user.id,
    notes: U.str(b.notes, 5000) || '',
  };
  if (Number.isNaN(m.purchase_price) || Number.isNaN(m.asking_price)) return { error: 'Bitte Preise als Zahl eingeben' };
  if (!m.category && !m.brand && !m.model) return { error: 'Bitte mindestens Art, Marke oder Modell angeben' };
  return { m };
}
/** Gebrauchter Einkauf (z. B. Inzahlungnahme) kommt automatisch ins Gebrauchtmaschinen-Lager */
function usedFromPurchase(saleId, userId) {
  const s = get('SELECT * FROM sales WHERE id=?', saleId);
  if (!s || s.kind !== 'einkauf' || get('SELECT 1 FROM used_machines WHERE purchase_id=?', s.id)) return null;
  const origin = s.customer_id ? 'Inzahlungnahme / Ankauf' : (s.party ? 'Ankauf von ' + s.party : 'Ankauf');
  const id = Number(run(`INSERT INTO used_machines(category, brand, model, serial, year, condition, purchase_price, in_date, origin, customer_id, purchase_id, user_id, notes, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, s.category, s.brand, s.model, s.serial, s.year, s.condition === 'vorfuehr' ? 'vorfuehr' : 'gebraucht', s.purchase_price, s.date, origin, s.customer_id, s.id, s.user_id, s.notes || '', userId).lastInsertRowid);
  checkUsedHits(id, userId);
  return id;
}
const nrm = (s) => String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
/** passt die Maschine zum Suchauftrag? Unbekannte Werte (z. B. Baujahr fehlt) schließen nicht aus. */
function searchMatches(s, m) {
  if (m.status === 'verkauft' || s.status !== 'offen') return false;
  if (s.brand && nrm(s.brand) !== nrm(m.brand)) return false;
  if (s.category) { const a = nrm(s.category); const b = nrm(m.category); if (!b || !(a.includes(b) || b.includes(a))) return false; }
  if (s.model && !nrm(`${m.model} ${m.brand}`).includes(nrm(s.model))) return false;
  if (s.max_price != null && m.asking_price != null && m.asking_price > s.max_price) return false;
  if (s.min_year != null && m.year != null && m.year < s.min_year) return false;
  if (s.max_hours != null && m.hours != null && m.hours > s.max_hours) return false;
  return true;
}
const SEARCH_SQL = `SELECT s.*, u.name user_name, COALESCE(${CUST_LABEL_SQL}, s.kunde) kunde_name, c.city kunde_ort, COALESCE(NULLIF(c.mobile,''), NULLIF(c.phone,''), s.telefon) kunde_tel
  FROM searches s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id`;
const searchTitle = (s) => [s.category, s.brand, s.model].filter(Boolean).join(' ') || 'Maschine';
/** Neue/geänderte Maschine gegen alle offenen Suchaufträge prüfen und den Verkäufer informieren */
function checkUsedHits(usedId, actorId) {
  const m = usedCalc(get(`${USED_SQL} WHERE m.id=?`, usedId));
  if (!m || m.status === 'verkauft') return 0;
  let n = 0;
  for (const s of all(`${SEARCH_SQL} WHERE s.status='offen'`)) {
    if (!searchMatches(s, m) || get('SELECT 1 FROM search_hits WHERE search_id=? AND used_id=?', s.id, m.id)) continue;
    run('INSERT INTO search_hits(search_id, used_id) VALUES(?,?)', s.id, m.id);
    n++;
    const who = s.user_id || s.created_by;
    if (!who) continue;
    const text = `Passende Maschine für ${s.kunde_name}: ${m.title}${m.year ? ' Bj. ' + m.year : ''}${m.asking_price != null ? ' für ' + m.asking_price.toLocaleString('de-DE') + ' €' : ''} (Suchauftrag: ${searchTitle(s)})`;
    const tid = Number(run(`INSERT INTO tasks(customer_id, kind, title, description, due_date, assigned_to, created_by) VALUES(?,?,?,?,?,?,?)`,
      s.customer_id, 'anruf', `Kunde informieren: ${m.title} passt zum Suchauftrag`.slice(0, 200),
      `${text}\n${s.kunde_tel ? 'Telefon: ' + s.kunde_tel + '\n' : ''}Maschine im CRM: Gebrauchte → Nr. ${m.id}`, U.today(), who, actorId || null).lastInsertRowid);
    L.notify(who, text, tid, s.customer_id, `#/gebrauchte/${m.id}`);
  }
  return n;
}
function usedQuery(q) {
  const where = []; const p = [];
  if (!q.status) where.push("m.status<>'verkauft'"); else if (q.status !== '*') { where.push('m.status=?'); p.push(q.status); }
  if (q.category) { where.push('m.category=?'); p.push(q.category); }
  if (q.q) { where.push("(m.brand || ' ' || COALESCE(m.model,'') || ' ' || COALESCE(m.category,'') || ' ' || COALESCE(m.serial,'') || ' ' || m.equipment || ' ' || m.location) LIKE ?"); p.push(`%${q.q}%`); }
  const rows = all(`${USED_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.in_date, m.id`, ...p).map(usedCalc);
  const open = all(`${SEARCH_SQL} WHERE s.status='offen'`);
  for (const r of rows) r.matches = open.filter((s) => searchMatches(s, r)).length;
  return rows;
}
app.get('/api/used', auth, (req, res) => {
  const rows = usedQuery(req.query);
  const stock = all(`SELECT * FROM used_machines WHERE status<>'verkauft'`).map(usedCalc);
  const sum = (k) => stock.reduce((a, r) => a + (r[k] || 0), 0);
  res.json({
    rows, statuses: USED_STATUS,
    categories: all("SELECT DISTINCT category FROM used_machines WHERE category IS NOT NULL AND category<>'' ORDER BY category").map((r) => r.category),
    stats: { count: stock.length, ek: sum('purchase_price'), vk: sum('asking_price'), avg_days: stock.length ? Math.round(sum('days') / stock.length) : null, old: stock.filter((r) => r.days > 180).length, searches: get("SELECT COUNT(*) n FROM searches WHERE status='offen'").n },
  });
});
app.get('/api/used/:id', auth, (req, res) => {
  const m = get(`${USED_SQL} WHERE m.id=?`, req.params.id);
  if (!m) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  const r = usedCalc(m);
  r.photos = all('SELECT id FROM used_photos WHERE used_id=? ORDER BY sort, id', m.id).map((f) => f.id);
  r.searches = all(`${SEARCH_SQL} WHERE s.status='offen'`).filter((s) => searchMatches(s, r)).map((s) => ({ id: s.id, kunde_name: s.kunde_name, kunde_ort: s.kunde_ort, kunde_tel: s.kunde_tel, customer_id: s.customer_id, title: searchTitle(s), max_price: s.max_price, user_name: s.user_name }));
  res.json(r);
});
app.post('/api/used', auth, (req, res) => {
  const { m, error } = cleanUsed(req.body || {}, req.user);
  if (error) return bad(res, error);
  const id = Number(run(`INSERT INTO used_machines(${USED_FIELDS.join(',')}, created_by) VALUES(${USED_FIELDS.map(() => '?').join(',')}, ?)`, ...USED_FIELDS.map((f) => m[f]), req.user.id).lastInsertRowid);
  const hits = checkUsedHits(id, req.user.id);
  res.json({ id, hits });
});
app.put('/api/used/:id', auth, (req, res) => {
  const old = get('SELECT * FROM used_machines WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  const { m, error } = cleanUsed({ ...old, ...req.body }, req.user);
  if (error) return bad(res, error);
  if (m.status !== 'verkauft' && old.status === 'verkauft') { m.sold_date = null; }
  run(`UPDATE used_machines SET ${USED_FIELDS.map((f) => f + '=?').join(',')}, sold_date=CASE WHEN ?='verkauft' THEN COALESCE(sold_date, ?) ELSE NULL END, updated_at=datetime('now','localtime') WHERE id=?`, ...USED_FIELDS.map((f) => m[f]), m.status, U.today(), old.id);
  const hits = checkUsedHits(old.id, req.user.id);
  res.json({ ok: true, hits });
});
app.delete('/api/used/:id', auth, (req, res) => {
  const old = get('SELECT * FROM used_machines WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  if (req.user.role !== 'admin' && old.created_by !== req.user.id && old.user_id !== req.user.id) return res.status(403).json({ error: 'Nur der Zuständige oder ein Administrator kann die Maschine löschen' });
  const photos = all('SELECT stored_name FROM used_photos WHERE used_id=?', old.id);
  run('DELETE FROM used_machines WHERE id=?', old.id);
  for (const f of photos) fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
  res.json({ ok: true });
});
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
app.post('/api/used/:id/photos', auth, express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const m = get('SELECT id FROM used_machines WHERE id=?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Maschine nicht gefunden' });
  const mime = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!PHOTO_TYPES.includes(mime)) return bad(res, 'Bitte ein Foto (JPG/PNG) hochladen');
  if (!req.body || !req.body.length) return bad(res, 'Leere Datei');
  if (get('SELECT COUNT(*) n FROM used_photos WHERE used_id=?', m.id).n >= 30) return bad(res, 'Maximal 30 Fotos pro Maschine');
  const stored = `used${m.id}_${U.token(12)}`;
  fs.writeFileSync(path.join(DATA_DIR, 'files', stored), req.body);
  const sort = get('SELECT COALESCE(MAX(sort),0)+1 n FROM used_photos WHERE used_id=?', m.id).n;
  const r = run('INSERT INTO used_photos(used_id, stored_name, mime, sort) VALUES(?,?,?,?)', m.id, stored, mime, sort);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.get('/api/used-photos/:id', auth, (req, res) => {
  const f = get('SELECT * FROM used_photos WHERE id=?', req.params.id);
  if (!f) return res.status(404).end();
  res.set('Content-Type', PHOTO_TYPES.includes(f.mime) ? f.mime : 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(DATA_DIR, 'files', f.stored_name));
});
app.delete('/api/used-photos/:id', auth, (req, res) => {
  const f = get('SELECT * FROM used_photos WHERE id=?', req.params.id);
  if (!f) return res.status(404).json({ error: 'Foto nicht gefunden' });
  run('DELETE FROM used_photos WHERE id=?', f.id);
  fs.rm(path.join(DATA_DIR, 'files', f.stored_name), () => {});
  res.json({ ok: true });
});
app.post('/api/used-photos/:id/first', auth, (req, res) => { // als Titelbild
  const f = get('SELECT * FROM used_photos WHERE id=?', req.params.id);
  if (!f) return res.status(404).json({ error: 'Foto nicht gefunden' });
  run('UPDATE used_photos SET sort=sort+1 WHERE used_id=?', f.used_id); run('UPDATE used_photos SET sort=0 WHERE id=?', f.id);
  res.json({ ok: true });
});
/** Exposé zum Drucken / als PDF speichern */
app.get('/api/used/:id/expose.html', auth, (req, res) => {
  const m0 = get(`${USED_SQL} WHERE m.id=?`, req.params.id);
  if (!m0) return res.status(404).send('Nicht gefunden');
  const m = usedCalc(m0);
  const photos = all('SELECT id FROM used_photos WHERE used_id=? ORDER BY sort, id', m.id).map((f) => f.id);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const e0 = (n) => Math.round(n).toLocaleString('de-DE') + ' €';
  const showPrice = req.query.price !== '0';
  const seller = get('SELECT name, email FROM users WHERE id=?', m.user_id);
  const specs = [['Hersteller', m.brand], ['Modell', m.model], ['Maschinenart', m.category], ['Baujahr', m.year], ['Betriebsstunden', m.hours != null ? m.hours.toLocaleString('de-DE') + ' h' : ''], ['Zustand', m.condition === 'vorfuehr' ? 'Vorführmaschine' : 'Gebraucht'], ['Seriennummer', req.query.serial === '1' ? m.serial : ''], ['Standort', m.location || 'Havixbeck']].filter(([, v]) => v);
  const eq = String(m.equipment || '').split(/\n|,(?=\s)(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  res.set('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'");
  res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Exposé ${h(m.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap">
<style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:'Nunito Sans',Arial,sans-serif;color:#222;margin:0;font-size:12.5px}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #c0292f;padding-bottom:8px}.top img{height:54px}.top .c{text-align:right;color:#6a6d6e;font-size:11px;line-height:1.4}
h1{font-size:26px;margin:14px 0 2px;font-weight:800}.sub{color:#6a6d6e;font-size:14px;margin-bottom:10px}
.ph{display:grid;grid-template-columns:2fr 1fr;gap:6px;margin:10px 0}.ph img{width:100%;object-fit:cover;border-radius:4px;display:block}.ph .main{height:300px}.ph .side{display:grid;gap:6px;grid-auto-rows:97px}.ph .side img{height:97px}
.ph.one{grid-template-columns:1fr}.ph.one .main{height:340px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:8px}table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px solid #e3e3e3;vertical-align:top}td:first-child{color:#6a6d6e;width:42%}
h2{font-size:14px;color:#c0292f;text-transform:uppercase;letter-spacing:.04em;margin:12px 0 6px}ul{margin:0;padding-left:18px}li{margin:2px 0}
.price{background:#c0292f;color:#fff;border-radius:6px;padding:12px 16px;margin-top:12px}.price b{font-size:24px;display:block}.price span{font-size:11.5px;opacity:.9}
.desc{white-space:pre-wrap;line-height:1.45}.foot{margin-top:16px;border-top:1px solid #ddd;padding-top:8px;color:#6a6d6e;font-size:10.5px;display:flex;justify-content:space-between;gap:10px}
.contact{background:#f4f4f4;border-radius:6px;padding:10px 14px;margin-top:12px;line-height:1.5}
@media screen{body{max-width:820px;margin:20px auto;padding:0 16px}}</style></head><body>
<div class="top"><img src="/img/logo.png" alt="Bussmann Land- &amp; Gartentechnik"><div class="c">Bussmann Land- &amp; Gartentechnik<br>Hauptstraße 5 · 48329 Havixbeck<br>Tel. 02507 1294 · info@bussmann-havixbeck.de</div></div>
<h1>${h(m.title)}</h1><div class="sub">${h([m.category, m.year ? 'Baujahr ' + m.year : '', m.hours != null ? m.hours.toLocaleString('de-DE') + ' Betriebsstunden' : ''].filter(Boolean).join(' · '))}</div>
${photos.length ? `<div class="ph ${photos.length === 1 ? 'one' : ''}"><img class="main" src="/api/used-photos/${photos[0]}" alt="">${photos.length > 1 ? `<div class="side">${photos.slice(1, 4).map((p) => `<img src="/api/used-photos/${p}" alt="">`).join('')}</div>` : ''}</div>` : ''}
<div class="cols"><div><h2>Technische Daten</h2><table>${specs.map(([k, v]) => `<tr><td>${h(k)}</td><td><b>${h(v)}</b></td></tr>`).join('')}</table>
${showPrice ? `<div class="price">${m.asking_price != null ? `<b>${e0(m.asking_price)}</b><span>zzgl. 19 % MwSt. (${e0(m.asking_price * 1.19)} inkl. MwSt.) · Finanzierung und Leasing möglich</span>` : '<b>Preis auf Anfrage</b><span>Finanzierung und Leasing möglich</span>'}</div>` : ''}
<div class="contact"><b>Ihr Ansprechpartner</b><br>${h(seller ? seller.name : 'Bussmann Land- & Gartentechnik')}<br>Telefon 02507 1294${seller && seller.email ? '<br>' + h(seller.email) : ''}</div></div>
<div>${eq.length ? `<h2>Ausstattung</h2><ul>${eq.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}${m.description ? `<h2>Beschreibung</h2><div class="desc">${h(m.description)}</div>` : ''}</div></div>
${photos.length > 4 ? `<div class="ph" style="grid-template-columns:repeat(4,1fr)">${photos.slice(4, 12).map((p) => `<img src="/api/used-photos/${p}" style="height:110px" alt="">`).join('')}</div>` : ''}
<div class="foot"><span>Angebot freibleibend, Zwischenverkauf und Irrtümer vorbehalten. Stand ${U.today().split('-').reverse().join('.')}</span><span>Nr. G-${m.id}</span></div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script></body></html>`);
});
// Suchaufträge
const SEARCH_FIELDS = ['customer_id', 'kunde', 'telefon', 'user_id', 'category', 'brand', 'model', 'max_price', 'min_year', 'max_hours', 'notes', 'status'];
function cleanSearch(b, user) {
  const s = {
    customer_id: b.customer_id && get('SELECT id FROM customers WHERE id=?', b.customer_id) ? Number(b.customer_id) : null,
    kunde: U.str(b.kunde, 200) || '', telefon: U.str(b.telefon, 60) || '',
    user_id: b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : user.id,
    category: U.str(b.category, 60) || '', brand: U.str(b.brand, 60) || '', model: U.str(b.model, 100) || '',
    max_price: money(b.max_price), min_year: intOrNull(b.min_year, 1900, 2200), max_hours: intOrNull(b.max_hours, 0, 1000000),
    notes: U.str(b.notes, 3000) || '', status: b.status === 'erledigt' ? 'erledigt' : 'offen',
  };
  if (Number.isNaN(s.max_price)) return { error: 'Bitte den Preis als Zahl eingeben' };
  if (!s.customer_id && !s.kunde) return { error: 'Bitte einen Kunden auswählen oder den Namen eintragen' };
  if (!s.category && !s.brand && !s.model) return { error: 'Bitte angeben, was gesucht wird (Art, Marke oder Modell)' };
  return { s };
}
const searchOut = (s, stock) => ({ ...s, title: searchTitle(s), matches: stock.filter((m) => searchMatches(s, m)).map((m) => ({ id: m.id, title: m.title, year: m.year, hours: m.hours, asking_price: m.asking_price, status: m.status, photo_id: m.photo_id })) });
app.get('/api/searches', auth, (req, res) => {
  const stock = all(`${USED_SQL} WHERE m.status<>'verkauft'`).map(usedCalc);
  const st = req.query.status === '*' ? '' : req.query.status === 'erledigt' ? "WHERE s.status='erledigt'" : "WHERE s.status='offen'";
  const where = req.query.customer ? `${st ? st + ' AND' : 'WHERE'} s.customer_id=${Number(req.query.customer) || 0}` : st;
  res.json(all(`${SEARCH_SQL} ${where} ORDER BY s.created_at DESC`).map((s) => searchOut(s, stock)));
});
app.get('/api/searches/:id', auth, (req, res) => {
  const s = get(`${SEARCH_SQL} WHERE s.id=?`, req.params.id);
  if (!s) return res.status(404).json({ error: 'Suchauftrag nicht gefunden' });
  res.json(searchOut(s, all(`${USED_SQL} WHERE m.status<>'verkauft'`).map(usedCalc)));
});
app.post('/api/searches', auth, (req, res) => {
  const { s, error } = cleanSearch(req.body || {}, req.user);
  if (error) return bad(res, error);
  const id = Number(run(`INSERT INTO searches(${SEARCH_FIELDS.join(',')}, created_by) VALUES(${SEARCH_FIELDS.map(() => '?').join(',')}, ?)`, ...SEARCH_FIELDS.map((f) => s[f]), req.user.id).lastInsertRowid);
  if (s.customer_id) L.systemEntry(s.customer_id, req.user.id, `Suchauftrag angelegt: ${searchTitle(s)}${s.max_price != null ? ' bis ' + s.max_price.toLocaleString('de-DE') + ' €' : ''}`);
  const out = searchOut(get(`${SEARCH_SQL} WHERE s.id=?`, id), all(`${USED_SQL} WHERE m.status<>'verkauft'`).map(usedCalc));
  for (const m of out.matches) run('INSERT OR IGNORE INTO search_hits(search_id, used_id) VALUES(?,?)', id, m.id); // schon bekannt, keine Meldung nötig
  res.json(out);
});
app.put('/api/searches/:id', auth, (req, res) => {
  const old = get('SELECT * FROM searches WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Suchauftrag nicht gefunden' });
  const { s, error } = cleanSearch({ ...old, ...req.body }, req.user);
  if (error) return bad(res, error);
  run(`UPDATE searches SET ${SEARCH_FIELDS.map((f) => f + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`, ...SEARCH_FIELDS.map((f) => s[f]), old.id);
  if (s.customer_id && old.status !== s.status) L.systemEntry(s.customer_id, req.user.id, `Suchauftrag ${searchTitle(s)}: ${s.status === 'erledigt' ? 'erledigt' : 'wieder offen'}`);
  const out = searchOut(get(`${SEARCH_SQL} WHERE s.id=?`, old.id), all(`${USED_SQL} WHERE m.status<>'verkauft'`).map(usedCalc));
  for (const m of out.matches) run('INSERT OR IGNORE INTO search_hits(search_id, used_id) VALUES(?,?)', old.id, m.id);
  res.json(out);
});
app.delete('/api/searches/:id', auth, (req, res) => {
  const old = get('SELECT * FROM searches WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Suchauftrag nicht gefunden' });
  run('DELETE FROM searches WHERE id=?', old.id);
  res.json({ ok: true });
});

// ---------- Doppelte Maschinen ----------
const ns = (s) => importer.normSerial(s);
/** Gleiche Maschine? Seriennummer gleich – oder ohne Seriennummer: gleiche Marke + Modell (+ Art/Baujahr, wenn beide gesetzt) */
function sameMachine(a, b) {
  if (ns(a.serial) && ns(b.serial)) return ns(a.serial) === ns(b.serial);
  if (ns(a.serial) || ns(b.serial)) {
    // eine Seite ohne Nummer: nur gleich, wenn Marke+Modell gleich und nicht leer
    if (!ns(a.model) && !ns(a.brand)) return false;
  }
  if (!ns(a.brand) && !ns(a.model)) return ns(a.category) !== '' && ns(a.category) === ns(b.category) && !ns(b.brand) && !ns(b.model);
  if (ns(a.brand) !== ns(b.brand) || ns(a.model) !== ns(b.model)) return false;
  if (ns(a.category) && ns(b.category) && ns(a.category) !== ns(b.category)) return false;
  if (a.year && b.year && Number(a.year) !== Number(b.year)) return false;
  return true;
}
function findMachineDuplicates() {
  const groups = [];
  const byCustomer = new Map();
  for (const m of all('SELECT * FROM machines ORDER BY customer_id, id')) {
    if (!byCustomer.has(m.customer_id)) byCustomer.set(m.customer_id, []);
    byCustomer.get(m.customer_id).push(m);
  }
  for (const list of byCustomer.values()) {
    const same = (x, y) => sameMachine(x, y) && sameMachine(y, x);
    const matches = new Map(list.map((x) => [x.id, list.filter((y) => y.id !== x.id && same(x, y)).map((y) => y.id)]));
    const used = new Set();
    for (const a of list) {
      if (used.has(a.id) || !matches.get(a.id).length) continue;
      const ids = [a.id, ...matches.get(a.id)];
      // nur zusammenführen, wenn die Gruppe eindeutig ist: jedes Mitglied passt genau zu den anderen der Gruppe
      // (z. B. "nur Marke" passt zu zwei verschiedenen Maschinen dieser Marke -> unklar, nichts tun)
      if (ids.some((id) => used.has(id) || matches.get(id).length !== ids.length - 1 || matches.get(id).some((o) => !ids.includes(o)))) continue;
      ids.forEach((id) => used.add(id));
      groups.push({ keep: a, drop: list.filter((x) => ids.includes(x.id) && x.id !== a.id) });
    }
  }
  return groups;
}
app.get('/api/machines/duplicates', auth, (req, res) => {
  const g = findMachineDuplicates();
  res.json({ groups: g.length, machines: g.reduce((n, x) => n + x.drop.length, 0),
    examples: g.slice(0, 5).map((x) => { const c = get('SELECT first_name, last_name FROM customers WHERE id=?', x.keep.customer_id); return `${[c?.first_name, c?.last_name].filter(Boolean).join(' ')}: ${L.machineName(x.keep)} (${x.drop.length + 1}×)`; }) });
});
app.post('/api/machines/dedupe', auth, admin, (req, res) => {
  const groups = findMachineDuplicates();
  let removed = 0;
  tx(() => {
    for (const { keep, drop } of groups) {
      // Angaben zusammenführen: leere Felder der ältesten Maschine aus den Doppelten füllen
      const merged = { ...keep };
      for (const d of drop) {
        for (const f of MACHINE_FIELDS) {
          if ((merged[f] == null || merged[f] === '' || (f === 'sold_by_us' && !merged[f])) && d[f] != null && d[f] !== '') merged[f] = d[f];
        }
        if (d.notes && merged.notes && !merged.notes.includes(d.notes)) merged.notes += '\n' + d.notes;
      }
      run(`UPDATE machines SET ${MACHINE_FIELDS.map((f) => f + '=?').join(',')}, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`, ...MACHINE_FIELDS.map((f) => merged[f]), req.user.id, keep.id);
      for (const d of drop) {
        run(`DELETE FROM tasks WHERE machine_id=? AND status='open'`, d.id);
        run('UPDATE tasks SET machine_id=? WHERE machine_id=?', keep.id, d.id);
        run('DELETE FROM machines WHERE id=?', d.id);
        removed++;
      }
      L.syncMachineTask(keep.id);
      L.systemEntry(keep.customer_id, req.user.id, `Doppelte Maschine zusammengeführt: ${L.machineName(merged)}`);
    }
  });
  res.json({ removed, groups: groups.length });
});

// ---------- Maschinen-Import ----------
app.get('/api/import/machines-template.xlsx', auth, (req, res) => {
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="Maschinen_Importvorlage.xlsx"');
  res.send(importer.machineTemplate());
});
app.post('/api/import/machines/preview', auth, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  try {
    const customers = all('SELECT id, first_name, last_name, company, zip, city, email, mobile, phone FROM customers');
    let overrides = {};
    try { overrides = JSON.parse(req.query.map || '{}') || {}; } catch { /* ungültig -> automatisch */ }
    const { rows, mapping } = importer.parseMachines(req.body, customers, overrides);
    // schon vorhandene Maschinen (gleiche Seriennummer beim Kunden) markieren
    for (const r of rows) {
      if (!r.customer_id || !r.serial) continue;
      const ex = all('SELECT id, serial FROM machines WHERE customer_id=?', r.customer_id).find((x) => importer.normSerial(x.serial) === importer.normSerial(r.serial));
      if (ex) r._existing = ex.id;
    }
    res.json({ rows, mapping });
  } catch (e) { bad(res, e.message || 'Datei konnte nicht gelesen werden'); }
});
app.post('/api/import/machines/commit', auth, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 20000) : [];
  const createMissing = !!req.body?.createMissing;
  let created = 0; let updated = 0; let newCustomers = 0; const skipped = [];
  const maxBefore = get('SELECT IFNULL(MAX(id),0) n FROM machines').n; // nur mit vorher vorhandenen Maschinen abgleichen
  tx(() => {
    const newCust = new Map(); // gleicher unbekannter Kunde in mehreren Zeilen -> nur einmal anlegen
    rows.forEach((row, i) => {
      let cid = Number(row.customer_id) || null;
      if (cid && !get('SELECT id FROM customers WHERE id=?', cid)) cid = null;
      if (!cid && createMissing && row._cust && (row._cust.last_name || row._cust.company)) {
        const key = JSON.stringify([row._cust.first_name, row._cust.last_name, row._cust.company, row._cust.zip]).toLowerCase();
        if (newCust.has(key)) cid = newCust.get(key);
        else {
          const { c, error } = cleanCustomer({ ...row._cust, last_name: row._cust.last_name || row._cust.company, owner_id: req.user.id, is_buyer: true });
          if (!error) {
            const r = run(`INSERT INTO customers(${CUSTOMER_FIELDS.join(',')}, info, created_by, updated_by) VALUES(${CUSTOMER_FIELDS.map(() => '?').join(',')}, '', ?, ?)`,
              ...CUSTOMER_FIELDS.map((f) => c[f] ?? (f === 'visit_interval' ? '' : null)), req.user.id, req.user.id);
            cid = Number(r.lastInsertRowid); newCust.set(key, cid); newCustomers++;
            L.systemEntry(cid, req.user.id, 'Kunde beim Maschinen-Import angelegt');
          }
        }
      }
      if (!cid) { skipped.push({ row: i + 1, error: 'kein Kunde zugeordnet' }); return; }
      const { m, error } = cleanMachine(row);
      if (error) { skipped.push({ row: i + 1, error }); return; }
      if (row.sold_by_us == null) m.sold_by_us = 0;
      // gleiche Seriennummer: immer derselbe Eintrag (auch innerhalb derselben Datei); ohne Nummer nur mit vorher vorhandenen abgleichen
      const ex = all('SELECT * FROM machines WHERE customer_id=?', cid).find((x) => (ns(x.serial) && ns(m.serial)) ? ns(x.serial) === ns(m.serial) : (x.id <= maxBefore && sameMachine(x, m)));
      if (ex) {
        // vorhandene Maschine nur ergänzen, nichts überschreiben
        const fill = MACHINE_FIELDS.filter((f) => (ex[f] == null || ex[f] === '' || (f === 'sold_by_us' && !ex[f])) && m[f] != null && m[f] !== '' && m[f] !== 0);
        if (m.notes && ex.notes && !ex.notes.includes(m.notes)) { m.notes = ex.notes + '\n' + m.notes; fill.push('notes'); }
        if (!fill.length) return;
        run(`UPDATE machines SET ${fill.map((f) => f + '=?').join(',')}, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`, ...fill.map((f) => m[f]), req.user.id, ex.id);
        L.syncMachineTask(ex.id);
        updated++;
        return;
      }
      const r = run(`INSERT INTO machines(customer_id, ${MACHINE_FIELDS.join(',')}, created_by, updated_by) VALUES(?, ${MACHINE_FIELDS.map(() => '?').join(',')}, ?, ?)`,
        cid, ...MACHINE_FIELDS.map((f) => m[f]), req.user.id, req.user.id);
      run('UPDATE customers SET is_buyer=1 WHERE id=?', cid); // Kunde mit Maschine = kaufender Kunde
      L.systemEntry(cid, req.user.id, `Maschine per Import hinzugefügt: ${L.machineName(m)}${m.serial ? ' (Nr. ' + m.serial + ')' : ''}`);
      L.syncMachineTask(Number(r.lastInsertRowid));
      created++;
    });
  });
  res.json({ created, updated, newCustomers, skipped });
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
    absences: absencesBetween(monday, sunday, scope === 'all' ? null : whoId, req.user),
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
    absences: absencesBetween(req.query.from, req.query.to, scope === 'all' ? null : scope, req.user),
  });
});

// ---------- Abwesenheiten (Urlaub, privat geblockt …) ----------
/** Notizen sieht nur der Mitarbeiter selbst (und Admins) */
function absencesBetween(from, to, userId, viewer) {
  return all(`SELECT a.*, u.name user_name, u.color user_color FROM absences a JOIN users u ON u.id=a.user_id
    WHERE a.start_date<=? AND a.end_date>=? ${userId ? 'AND a.user_id=?' : ''} ORDER BY a.start_date, u.name`, to, from, ...(userId ? [userId] : []))
    .map((a) => (a.user_id === viewer.id || viewer.role === 'admin' ? a : { ...a, note: '' }));
}
function cleanAbsence(b, req) {
  const a = {
    user_id: req.user.role === 'admin' && b.user_id && get('SELECT id FROM users WHERE id=?', b.user_id) ? Number(b.user_id) : req.user.id,
    kind: U.ABSENCE_KINDS[b.kind] ? b.kind : 'urlaub',
    start_date: U.isDate(b.start_date) ? b.start_date : null,
    end_date: U.isDate(b.end_date) ? b.end_date : (U.isDate(b.start_date) ? b.start_date : null),
    start_time: U.isTime(b.start_time) ? b.start_time : null,
    end_time: U.isTime(b.end_time) ? b.end_time : null,
    note: U.str(b.note, 1000) || '',
  };
  if (!a.start_date) return { error: 'Bitte ein Datum angeben' };
  if (a.end_date < a.start_date) return { error: 'Das Enddatum liegt vor dem Startdatum' };
  if (!a.start_time || !a.end_time || a.start_date !== a.end_date) { a.start_time = a.start_date === a.end_date ? a.start_time : null; a.end_time = a.start_date === a.end_date ? a.end_time : null; }
  if (!a.start_time || !a.end_time) { a.start_time = null; a.end_time = null; }
  if (a.start_time && a.end_time <= a.start_time) return { error: 'Die Endzeit liegt vor der Startzeit' };
  return { a };
}
app.get('/api/absences', auth, (req, res) => {
  const from = U.isDate(req.query.from) ? req.query.from : U.today();
  const to = U.isDate(req.query.to) ? req.query.to : U.addMonths(from, 12);
  const uid = /^\d+$/.test(req.query.user || '') ? Number(req.query.user) : null;
  res.json(absencesBetween(from, to, uid, req.user));
});
/** Prüft, wer an einem Tag abwesend ist (Warnung beim Planen von Terminen) */
app.get('/api/absences/check', auth, (req, res) => {
  if (!U.isDate(req.query.date)) return res.json([]);
  const ids = String(req.query.users || '').split(',').map(Number).filter(Number.isInteger);
  if (!ids.length) return res.json([]);
  const time = U.isTime(req.query.time) ? req.query.time : null;
  res.json(absencesBetween(req.query.date, req.query.date, null, req.user)
    .filter((a) => ids.includes(a.user_id))
    .filter((a) => !a.start_time || !time || (time >= a.start_time && time < a.end_time))
    .map((a) => ({ user_id: a.user_id, user_name: a.user_name, kind: a.kind, label: U.ABSENCE_KINDS[a.kind], start_time: a.start_time, end_time: a.end_time })));
});
app.post('/api/absences', auth, (req, res) => {
  const { a, error } = cleanAbsence(req.body || {}, req);
  if (error) return bad(res, error);
  const r = run('INSERT INTO absences(user_id, kind, start_date, end_date, start_time, end_time, note, created_by) VALUES(?,?,?,?,?,?,?,?)',
    a.user_id, a.kind, a.start_date, a.end_date, a.start_time, a.end_time, a.note, req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/absences/:id', auth, (req, res) => {
  const old = get('SELECT * FROM absences WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
  if (old.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Nur der Mitarbeiter selbst kann das ändern' });
  const { a, error } = cleanAbsence({ ...old, ...req.body, user_id: req.body.user_id ?? old.user_id }, req);
  if (error) return bad(res, error);
  run('UPDATE absences SET user_id=?, kind=?, start_date=?, end_date=?, start_time=?, end_time=?, note=? WHERE id=?',
    req.user.role === 'admin' ? a.user_id : old.user_id, a.kind, a.start_date, a.end_date, a.start_time, a.end_time, a.note, old.id);
  res.json({ ok: true });
});
app.delete('/api/absences/:id', auth, (req, res) => {
  const old = get('SELECT * FROM absences WHERE id=?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Nicht gefunden' });
  if (old.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Nur der Mitarbeiter selbst kann das löschen' });
  run('DELETE FROM absences WHERE id=?', old.id);
  res.json({ ok: true });
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
app.get('/api/version', (req, res) => {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'version.json'), 'utf8')); } catch { /* lokal / alte Installation */ }
  res.set('Cache-Control', 'no-store').json({ commit: v.commit || 'dev', subject: v.subject || '', date: v.date || '', installed: v.installed || '' });
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
