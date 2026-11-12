'use strict';
/**
 * Wiederkehrende Termine/Aufgaben.
 * Jede Wiederholung ist eine ganz normale Aufgabe (Kalender, Erinnerung, iCal funktionieren dadurch
 * unverändert). Die Serie (task_series) merkt sich Regel, Ende und bis wann schon angelegt wurde.
 * Ohne Enddatum wird laufend ein Stück in die Zukunft nachgelegt (Zeitplan alle 10 Minuten).
 */
const { get, all, run } = require('./db');
const U = require('./util');

const REPEATS = {
  daily: 'Täglich', weekdays: 'Werktags (Mo–Fr)', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wochen',
  monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfyearly: 'Halbjährlich', yearly: 'Jährlich',
};
const MONTHS = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
const DAYS = { daily: 1, weekly: 7, biweekly: 14 };
const MAX_PER_RUN = 200;

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const parse = (s) => new Date(s + 'T00:00:00Z');
function addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
/** Monate addieren, Tag am Monatsende kappen (31.01. + 1 Monat = 28./29.02.) */
function addMonths(s, n) {
  const d = parse(s); const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return iso(t);
}
/** nächster Termin nach prev (start = erster Termin der Serie, bestimmt z. B. den Monatstag) */
function nextDate(start, freq, prev) {
  if (DAYS[freq]) return addDays(prev, DAYS[freq]);
  if (freq === 'weekdays') { let d = addDays(prev, 1); while ([0, 6].includes(parse(d).getUTCDay())) d = addDays(d, 1); return d; }
  const step = MONTHS[freq];
  const a = parse(start); const p = parse(prev);
  let k = (p.getUTCFullYear() - a.getUTCFullYear()) * 12 + (p.getUTCMonth() - a.getUTCMonth());
  k = Math.floor(k / step) * step + step;
  return addMonths(start, k);
}
// wie weit im Voraus angelegt wird (genug für Kalender und Kalender-Abo, ohne die Aufgabenliste zu fluten)
const horizonFor = (freq) => addDays(U.today(), { daily: 31, weekdays: 31, weekly: 91, biweekly: 91, monthly: 366 }[freq] || 731);

/** Kopie einer Aufgabe als weitere Wiederholung am Datum `date` */
function copyTask(templateId, date, seriesId) {
  const r = run(`INSERT INTO tasks(customer_id, kind, title, description, due_date, due_time, duration_min, location, assigned_to, created_by, remind_day_before, series_id)
    SELECT customer_id, kind, title, description, ?, due_time, duration_min, location, assigned_to, created_by, remind_day_before, ? FROM tasks WHERE id=?`, date, seriesId, templateId);
  const id = Number(r.lastInsertRowid);
  run('INSERT OR IGNORE INTO task_participants(task_id, user_id) SELECT ?, user_id FROM task_participants WHERE task_id=?', id, templateId);
  return id;
}

/** Serie bis zum Horizont bzw. Enddatum auffüllen. Gibt die Zahl neuer Termine zurück. */
function extend(seriesId) {
  const s = get('SELECT * FROM task_series WHERE id=?', seriesId);
  if (!s) return 0;
  const tpl = get('SELECT id FROM tasks WHERE series_id=? ORDER BY due_date DESC, id DESC LIMIT 1', s.id);
  if (!tpl) { run('DELETE FROM task_series WHERE id=?', s.id); return 0; }
  const horizon = s.until && s.until < horizonFor(s.freq) ? s.until : horizonFor(s.freq);
  let last = s.last_date; let n = 0;
  for (let d = nextDate(s.start_date, s.freq, last); d <= horizon && n < MAX_PER_RUN; d = nextDate(s.start_date, s.freq, d)) {
    copyTask(tpl.id, d, s.id); last = d; n++;
  }
  if (n) run('UPDATE task_series SET last_date=? WHERE id=?', last, s.id);
  return n;
}

/** Neue Serie ab einer vorhandenen Aufgabe starten */
function start(taskId, freq, until) {
  const t = get('SELECT * FROM tasks WHERE id=?', taskId);
  if (!t || !REPEATS[freq]) return null;
  const u = U.isDate(until) && until >= t.due_date ? until : null;
  const id = Number(run('INSERT INTO task_series(freq, until, start_date, last_date) VALUES(?,?,?,?)', freq, u, t.due_date, t.due_date).lastInsertRowid);
  run('UPDATE tasks SET series_id=? WHERE id=?', id, taskId);
  extend(id);
  return id;
}

/** Serie ab einer Aufgabe beenden: alle späteren offenen Wiederholungen löschen, Serie endet davor */
function cutFrom(task, inclusive) {
  if (!task.series_id) return;
  run(`DELETE FROM tasks WHERE series_id=? AND status='open' AND (due_date>? OR (due_date=? AND id>?))${inclusive ? ' OR id=?' : ''}`,
    task.series_id, task.due_date, task.due_date, task.id, ...(inclusive ? [task.id] : []));
  run('UPDATE task_series SET until=? WHERE id=?', addDays(task.due_date, inclusive ? -1 : 0), task.series_id);
  if (!get('SELECT 1 FROM tasks WHERE series_id=?', task.series_id)) run('DELETE FROM task_series WHERE id=?', task.series_id);
}

function extendAll() {
  let n = 0;
  for (const s of all(`SELECT id FROM task_series WHERE until IS NULL OR until>last_date`)) n += extend(s.id);
  return n;
}

module.exports = { REPEATS, nextDate, addMonths, start, extend, extendAll, cutFrom };
