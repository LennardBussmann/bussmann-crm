'use strict';
// Urlaubskonto: gesetzliche Feiertage je Bundesland und Zählung der Urlaubstage.
const U = require('./util');

const STATES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland',
  SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

/** Ostersonntag (Gauß / Meeus) */
function easter(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Gesetzliche Feiertage eines Jahres: { 'YYYY-MM-DD': 'Name' } */
function holidays(year, state = 'NW') {
  const y = Number(year); const e = easter(y); const out = {};
  const add = (d, n, only) => { if (!only || only.includes(state)) out[d] = n; };
  add(`${y}-01-01`, 'Neujahr');
  add(`${y}-01-06`, 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
  add(`${y}-03-08`, 'Frauentag', ['BE', 'MV']);
  add(U.addDays(e, -2), 'Karfreitag');
  add(e, 'Ostersonntag', ['BB']);
  add(U.addDays(e, 1), 'Ostermontag');
  add(`${y}-05-01`, 'Tag der Arbeit');
  add(U.addDays(e, 39), 'Christi Himmelfahrt');
  add(U.addDays(e, 49), 'Pfingstsonntag', ['BB']);
  add(U.addDays(e, 50), 'Pfingstmontag');
  add(U.addDays(e, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  add(`${y}-08-15`, 'Mariä Himmelfahrt', ['SL']);
  add(`${y}-09-20`, 'Weltkindertag', ['TH']);
  add(`${y}-10-03`, 'Tag der Deutschen Einheit');
  add(`${y}-10-31`, 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  add(`${y}-11-01`, 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
  if (state === 'SN') { // Buß- und Bettag: Mittwoch vor dem 23. November
    const d = U.parseDate(`${y}-11-22`); while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    add(U.fmtDate(d), 'Buß- und Bettag');
  }
  add(`${y}-12-25`, '1. Weihnachtstag');
  add(`${y}-12-26`, '2. Weihnachtstag');
  return out;
}
function holidaysBetween(from, to, state) {
  const out = {};
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const [d, n] of Object.entries(holidays(y, state))) if (d >= from && d <= to) out[d] = n;
  }
  return out;
}

const isoDow = (day) => { const g = U.parseDate(day).getDay(); return g === 0 ? 7 : g; };

/**
 * Arbeitstage einer Abwesenheit innerhalb [from, to] (ohne Feiertage, nur die Arbeitstage des Mitarbeiters).
 * Stundenweise Abwesenheit zählt als halber Tag.
 */
function countDays(a, from, to, workdays = '12345', hol = {}) {
  const s = a.start_date > from ? a.start_date : from;
  const e = a.end_date < to ? a.end_date : to;
  let n = 0;
  for (let d = s; d <= e; d = U.addDays(d, 1)) {
    if (!String(workdays).includes(String(isoDow(d))) || hol[d]) continue;
    n += 1;
  }
  return a.start_time ? n * 0.5 : n;
}

module.exports = { STATES, easter, holidays, holidaysBetween, countDays };
