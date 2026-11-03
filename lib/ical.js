'use strict';
const { all, get } = require('./db');
const U = require('./util');
const { customerName } = require('./logic');
const { appUrl } = require('./mail');

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const escText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: Zeilen > 75 Oktette falten
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const out = []; let cur = ''; let curLen = 0; let limit = 75;
  for (const ch of line) {
    const l = Buffer.byteLength(ch);
    if (curLen + l > limit) { out.push(cur); cur = ''; curLen = 0; limit = 74; }
    cur += ch; curLen += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const d8 = (date) => date.replace(/-/g, '');
const stamp = (s) => s.replace(/[-:]/g, '').replace(' ', 'T').slice(0, 15);

function buildFeed(user, { birthdays = true } = {}) {
  const host = (appUrl().replace(/^https?:\/\//, '') || 'bussmann-crm').replace(/[/:].*$/, '');
  const from = U.addMonths(U.today(), -3);
  const tasks = all(`SELECT t.*, (SELECT name FROM users WHERE id=t.assigned_to) assignee,
      (SELECT group_concat(u.name, ', ') FROM task_participants tp JOIN users u ON u.id=tp.user_id WHERE tp.task_id=t.id) participant_names
    FROM tasks t WHERE (t.assigned_to=? OR EXISTS (SELECT 1 FROM task_participants tp WHERE tp.task_id=t.id AND tp.user_id=?))
      AND (t.status='open' OR t.due_date>=?) ORDER BY t.due_date`, user.id, user.id, from);
  const now = stamp(U.nowLocal().replace('T', ' ') + ':00');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bussmann Land- & Gartentechnik//CRM//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText('Bussmann CRM – ' + user.name)}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M', ...VTIMEZONE];

  for (const t of tasks) {
    const c = t.customer_id ? get('SELECT * FROM customers WHERE id=?', t.customer_id) : null;
    const kind = U.TASK_KINDS[t.kind] || 'Aufgabe';
    const done = t.status === 'done';
    const desc = [
      c ? `Kunde: ${customerName(c)}` : null,
      c && (c.mobile || c.phone) ? `Tel.: ${[c.mobile, c.phone].filter(Boolean).join(' / ')}` : null,
      t.participant_names ? `Zuständig: ${t.assignee || '–'} · Teilnehmer: ${t.participant_names}` : null,
      t.description || null,
      appUrl() ? `${appUrl()}/#/aufgaben/${t.id}` : null,
    ].filter(Boolean).join('\n');
    const loc = t.location || (c ? [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');
    L.push('BEGIN:VEVENT', `UID:task-${t.id}@${host}`, `DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(t.updated_at)}`);
    if (t.due_time) {
      const start = new Date(`${t.due_date}T${t.due_time}:00`);
      const end = new Date(start.getTime() + (t.duration_min || 60) * 60000);
      L.push(`DTSTART;TZID=Europe/Berlin:${d8(t.due_date)}T${t.due_time.replace(':', '')}00`,
        `DTEND;TZID=Europe/Berlin:${d8(U.fmtDate(end))}T${U.pad(end.getHours())}${U.pad(end.getMinutes())}00`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${d8(t.due_date)}`, `DTEND;VALUE=DATE:${d8(U.addDays(t.due_date, 1))}`, 'TRANSP:TRANSPARENT');
    }
    L.push(`SUMMARY:${escText((done ? '✓ ' : '') + kind + ': ' + t.title)}`);
    if (desc) L.push(`DESCRIPTION:${escText(desc)}`);
    if (loc) L.push(`LOCATION:${escText(loc)}`);
    L.push(`CATEGORIES:${escText(kind)}`, `STATUS:${done ? 'CANCELLED' : 'CONFIRMED'}`);
    if (!done && t.remind_day_before) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(t.title)}`, t.due_time ? 'TRIGGER:-P1D' : 'TRIGGER:-PT15H', 'END:VALARM');
    }
    L.push('END:VEVENT');
  }

  if (birthdays) {
    for (const c of all(`SELECT * FROM customers WHERE birthday IS NOT NULL AND birthday <> ''`)) {
      L.push('BEGIN:VEVENT', `UID:bday-${c.id}@${host}`, `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${d8(c.birthday)}`, `DTEND;VALUE=DATE:${d8(U.addDays(c.birthday, 1))}`,
        'RRULE:FREQ=YEARLY', 'TRANSP:TRANSPARENT', `SUMMARY:${escText('🎂 Geburtstag ' + customerName(c))}`, 'CATEGORIES:Geburtstag', 'END:VEVENT');
    }
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildFeed };
