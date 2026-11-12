'use strict';
/**
 * Saison-Aktionen (z. B. Frühjahrs-Check Rasenmäher, Winterdienst).
 * Jede Aktion hat einen Zeitraum im Jahr und eine Zielgruppe. Rechtzeitig vorher legt das CRM
 * jedes Jahr eine Aufgabe „Aktion vorbereiten“ an; die passende Adressliste gibt es als Excel.
 */
const XLSX = require('xlsx');
const { get, all, run, tx, getSetting, setSetting } = require('./db');
const U = require('./util');
const L = require('./logic');

const GARDEN = ['Rasenmäher', 'Aufsitzmäher', 'Rasentraktor', 'Mähroboter', 'Motorsäge', 'Freischneider', 'Heckenschere', 'Laubbläser'];
const DEFAULTS = [
  { name: 'Frühjahrs-Check Rasenmäher & Gartengeräte', start_md: '03-01', end_md: '04-30', lead_days: 28, types: [], tags: [], cats: GARDEN,
    description: 'Inspektion vor der Saison anbieten (Rasenmäher, Aufsitzmäher, Motorsägen …). Flyer mit Frühjahrs-Check-Preis und Hol- und Bringservice.' },
  { name: 'Saisonstart Rasen: Mähroboter, Vertikutierer & Neuheiten', start_md: '03-15', end_md: '05-31', lead_days: 28, types: ['Privat', 'Gartenbau', 'Verein'], tags: [], cats: [],
    description: 'Neue Rasenmäher, Mähroboter und Vertikutierer vorstellen, Aktionspreise und Vorführung anbieten.' },
  { name: 'Herbst & Laub', start_md: '09-01', end_md: '10-31', lead_days: 28, types: ['Kommune', 'Gartenbau', 'Verein'], tags: [], cats: ['Laubbläser', 'Kehrmaschine'],
    description: 'Laubbläser, Laubsauger und Kehrmaschinen anbieten.' },
  { name: 'Winterdienst', start_md: '09-15', end_md: '11-30', lead_days: 35, types: ['Kommune', 'Gewerbe'], tags: [], cats: ['Kommunaltraktor', 'Kehrmaschine'],
    description: 'Streuer, Schneeschilde und Kehrmaschinen anbieten, Winterdienst-Check der Kommunalgeräte vor dem ersten Schnee.' },
  { name: 'Winter-Inspektion', start_md: '11-01', end_md: '02-28', lead_days: 21, types: [], tags: [], cats: GARDEN,
    description: 'Wintercheck in der ruhigen Zeit anbieten (z. B. mit Winterrabatt), damit die Geräte im Frühjahr startklar sind.' },
];
const CHANNELS = { post: 'Per Post (mit Adresse)', email: 'Per E-Mail', alle: 'Alle' };

const pipe = (arr) => (arr.length ? '|' + arr.join('|') + '|' : '');
const unpipe = (s) => String(s || '').split('|').filter(Boolean);
const isMd = (s) => typeof s === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
/** Datum im Jahr y (29.02. in Nicht-Schaltjahren -> 28.02.) */
const mdDate = (y, md) => { const [m, d] = md.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };
const period = (c, y) => ({ start: mdDate(y, c.start_md), end: mdDate(c.end_md < c.start_md ? y + 1 : y, c.end_md) });
const remindDate = (c, y) => U.addDays(period(c, y).start, -c.lead_days);

function out(c) {
  return { ...c, types: unpipe(c.types), tags: unpipe(c.tags), cats: unpipe(c.cats), active: !!c.active };
}

/** Zielgruppe: Kunden, auf die mindestens eins zutrifft (Kundenart, Schlagwort oder Maschine). Ohne Angabe: alle. */
function targetSql(c, channel) {
  const or = []; const p = [];
  const types = unpipe(c.types); const tags = unpipe(c.tags); const cats = unpipe(c.cats);
  if (types.length) { or.push(`c.customer_type IN (${types.map(() => '?').join(',')})`); p.push(...types); }
  for (const t of tags) { or.push('c.tags LIKE ?'); p.push(`%|${t}|%`); }
  if (cats.length) { or.push(`EXISTS (SELECT 1 FROM machines m WHERE m.customer_id=c.id AND m.category COLLATE NOCASE IN (${cats.map(() => '?').join(',')}))`); p.push(...cats); }
  const where = [];
  if (or.length) where.push(`(${or.join(' OR ')})`);
  if (c.only_buyers) where.push('c.is_buyer=1');
  if (channel === 'post') where.push("IFNULL(c.street,'')<>'' AND IFNULL(c.city,'')<>''");
  if (channel === 'email') where.push("IFNULL(c.email,'')<>''");
  return { sql: `SELECT c.* FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.zip, c.last_name, c.first_name`, p };
}
const targets = (c, channel) => { const { sql, p } = targetSql(c, channel); return all(sql, ...p); };
const countTargets = (c, channel) => { const { sql, p } = targetSql(c, channel); return get(`SELECT COUNT(*) n FROM (${sql})`, ...p).n; };

function taskText(c, y) {
  const pr = period(c, y);
  const who = [unpipe(c.types).join(', '), unpipe(c.tags).map((t) => '#' + t).join(' '), unpipe(c.cats).length ? 'Besitzer von ' + unpipe(c.cats).join(', ') : ''].filter(Boolean).join(' · ') || 'alle Kunden';
  return {
    title: `Aktion vorbereiten: ${c.name}`,
    description: `${c.description ? c.description + '\n\n' : ''}Aktionszeitraum: ${pr.start.split('-').reverse().join('.')} – ${pr.end.split('-').reverse().join('.')}\nZielgruppe: ${who}${c.only_buyers ? ' (nur kaufende Kunden)' : ''}\n\nFlyer / Infos vorbereiten. Die Adressliste gibt es im CRM unter „Aktionen“ → „Adressliste (Excel)“.`,
  };
}
const defaultUser = () => (get("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1") || get('SELECT id FROM users WHERE active=1 ORDER BY id LIMIT 1') || {}).id || null;

/** Sorgt dafür, dass jede aktive Aktion eine Erinnerungs-Aufgabe für den nächsten Durchgang hat. force = Aufgabe an geänderte Aktion anpassen */
function syncTasks(onlyId, force) {
  const today = U.today(); const Y = Number(today.slice(0, 4));
  for (const c of all(`SELECT * FROM campaigns${onlyId ? ' WHERE id=?' : ''}`, ...(onlyId ? [onlyId] : []))) {
    if (!c.active) { run(`DELETE FROM tasks WHERE campaign_id=? AND status='open'`, c.id); continue; }
    const uid = c.user_id || defaultUser();
    if (!uid) continue;
    for (const y of [Y - 1, Y, Y + 1]) {
      if (period(c, y).end < today) continue;
      const t = get('SELECT * FROM tasks WHERE campaign_id=? AND campaign_year=? ORDER BY id DESC LIMIT 1', c.id, y);
      if (t && t.status === 'done') continue;
      const due = remindDate(c, y) < today ? today : remindDate(c, y);
      const tt = taskText(c, y);
      if (!t) {
        run(`INSERT INTO tasks(kind, title, description, due_date, assigned_to, remind_day_before, campaign_id, campaign_year) VALUES('aufgabe',?,?,?,?,1,?,?)`, tt.title, tt.description, due, uid, c.id, y);
      } else if (force) {
        run(`UPDATE tasks SET title=?, description=?, due_date=?, assigned_to=?, reminder_sent=CASE WHEN due_date<>? THEN 0 ELSE reminder_sent END, updated_at=datetime('now','localtime') WHERE id=?`, tt.title, tt.description, due, uid, due, t.id);
      }
      break;
    }
  }
}

function seed() {
  if (getSetting('campaigns_seeded')) return;
  if (!get('SELECT COUNT(*) n FROM campaigns').n) {
    const uid = defaultUser();
    for (const d of DEFAULTS) run('INSERT INTO campaigns(name, description, start_md, end_md, lead_days, types, tags, cats, only_buyers, user_id, active) VALUES(?,?,?,?,?,?,?,?,0,?,1)',
      d.name, d.description, d.start_md, d.end_md, d.lead_days, pipe(d.types), pipe(d.tags), pipe(d.cats), uid);
  }
  setSetting('campaigns_seeded', '1');
}

function clean(b) {
  const list = (v, max) => [...new Set((Array.isArray(v) ? v : []).map((x) => U.str(x, 60)).filter(Boolean).map((x) => x.replace(/\|/g, '')))].slice(0, max);
  const c = {
    name: U.str(b.name, 150), description: U.str(b.description, 5000) || '',
    start_md: isMd(b.start_md) ? b.start_md : null, end_md: isMd(b.end_md) ? b.end_md : null,
    lead_days: Math.max(0, Math.min(180, Number(b.lead_days) || 28)),
    types: pipe(list(b.types, 20).filter((t) => U.CUSTOMER_TYPES.includes(t))), tags: pipe(list(b.tags, 30)), cats: pipe(list(b.cats, 40)),
    only_buyers: b.only_buyers ? 1 : 0, active: b.active === false || b.active === 0 ? 0 : 1,
    user_id: b.user_id && get('SELECT id FROM users WHERE id=? AND active=1', b.user_id) ? Number(b.user_id) : null,
  };
  if (!c.name) return { error: 'Bitte einen Namen eingeben' };
  if (!c.start_md || !c.end_md) return { error: 'Bitte den Zeitraum (von / bis) angeben' };
  return { c };
}
const FIELDS = ['name', 'description', 'start_md', 'end_md', 'lead_days', 'types', 'tags', 'cats', 'only_buyers', 'active', 'user_id'];

module.exports = function campaigns(app, { auth }) {
  seed();
  syncTasks();
  const bad = (res, msg) => res.status(400).json({ error: msg });

  app.get('/api/campaigns', auth, (req, res) => {
    const today = U.today(); const Y = Number(today.slice(0, 4));
    const rows = all('SELECT k.*, u.name user_name FROM campaigns k LEFT JOIN users u ON u.id=k.user_id').map((c) => {
      const y = [Y - 1, Y, Y + 1].find((yy) => period(c, yy).end >= today);
      const pr = period(c, y);
      const task = get('SELECT id, due_date, status FROM tasks WHERE campaign_id=? ORDER BY campaign_year DESC, id DESC LIMIT 1', c.id);
      const lastRun = get('SELECT r.*, u.name user_name FROM campaign_runs r LEFT JOIN users u ON u.id=r.user_id WHERE r.campaign_id=? ORDER BY r.id DESC LIMIT 1', c.id);
      return { ...out(c), next_start: pr.start, next_end: pr.end, remind: remindDate(c, y), running: pr.start <= today,
        count: countTargets(c, 'alle'), count_post: countTargets(c, 'post'), count_email: countTargets(c, 'email'), task, last_run: lastRun || null,
        user_name: c.user_name || (get('SELECT name FROM users WHERE id=?', defaultUser()) || {}).name || '' };
    }).sort((a, b) => (a.active === b.active ? a.next_start.localeCompare(b.next_start) : a.active ? -1 : 1));
    res.json({ rows, channels: CHANNELS });
  });
  app.post('/api/campaigns', auth, (req, res) => {
    const { c, error } = clean(req.body || {});
    if (error) return bad(res, error);
    const id = Number(run(`INSERT INTO campaigns(${FIELDS.join(',')}, created_by) VALUES(${FIELDS.map(() => '?').join(',')}, ?)`, ...FIELDS.map((f) => c[f]), req.user.id).lastInsertRowid);
    syncTasks(id, true);
    res.json({ id });
  });
  app.put('/api/campaigns/:id', auth, (req, res) => {
    const old = get('SELECT * FROM campaigns WHERE id=?', req.params.id);
    if (!old) return res.status(404).json({ error: 'Aktion nicht gefunden' });
    const { c, error } = clean({ ...out(old), ...req.body });
    if (error) return bad(res, error);
    run(`UPDATE campaigns SET ${FIELDS.map((f) => f + '=?').join(',')}, updated_at=datetime('now','localtime') WHERE id=?`, ...FIELDS.map((f) => c[f]), old.id);
    syncTasks(old.id, true);
    res.json({ ok: true });
  });
  app.delete('/api/campaigns/:id', auth, (req, res) => {
    const old = get('SELECT * FROM campaigns WHERE id=?', req.params.id);
    if (!old) return res.status(404).json({ error: 'Aktion nicht gefunden' });
    tx(() => { run(`DELETE FROM tasks WHERE campaign_id=? AND status='open'`, old.id); run('DELETE FROM campaigns WHERE id=?', old.id); });
    res.json({ ok: true });
  });
  app.get('/api/campaigns/:id/customers.xlsx', auth, (req, res) => {
    const c = get('SELECT * FROM campaigns WHERE id=?', req.params.id);
    if (!c) return res.status(404).json({ error: 'Aktion nicht gefunden' });
    const channel = CHANNELS[req.query.channel] ? req.query.channel : 'post';
    const list = targets(c, channel);
    const ws = XLSX.utils.aoa_to_sheet([
      ['Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße und Hausnummer', 'PLZ', 'Ort', 'E-Mail', 'Handy', 'Festnetz', 'Kundenart', 'Kundennr.'],
      ...list.map((x) => [x.salutation || '', x.first_name || '', x.company && x.last_name === x.company ? '' : x.last_name, x.company || '', x.street || '', x.zip || '', x.city || '', x.email || '', x.mobile || '', x.phone || '', x.customer_type || '', x.id]),
    ]);
    ws['!cols'] = [8, 14, 18, 26, 28, 7, 16, 28, 16, 16, 12, 9].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Adressen');
    const fname = `Aktion_${c.name.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '_').replace(/^_|_$/g, '')}_${U.today()}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fname).replace(/%2F/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });
  /** Versand vermerken: Eintrag in der Kundenhistorie + Protokoll an der Aktion */
  app.post('/api/campaigns/:id/sent', auth, (req, res) => {
    const c = get('SELECT * FROM campaigns WHERE id=?', req.params.id);
    if (!c) return res.status(404).json({ error: 'Aktion nicht gefunden' });
    const channel = CHANNELS[(req.body || {}).channel] ? req.body.channel : 'post';
    const list = targets(c, channel);
    if (!list.length) return bad(res, 'Zu dieser Zielgruppe gibt es keine Kunden');
    const how = channel === 'email' ? 'per E-Mail' : channel === 'post' ? 'per Post' : '';
    tx(() => {
      for (const x of list) L.systemEntry(x.id, req.user.id, `Aktion „${c.name}“: Flyer / Info ${how} verschickt`.replace('  ', ' '));
      run('INSERT INTO campaign_runs(campaign_id, year, channel, count, user_id) VALUES(?,?,?,?,?)', c.id, Number(U.today().slice(0, 4)), channel, list.length, req.user.id);
    });
    res.json({ ok: true, count: list.length });
  });
};
module.exports.syncTasks = syncTasks;
module.exports.period = period;
