'use strict';
const crypto = require('crypto');

const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtDateTime(d) { return `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function today() { return fmtDate(new Date()); }
function nowLocal() { return fmtDateTime(new Date()); }
function parseDate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
function addMonths(s, n) {
  const d = parseDate(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return fmtDate(d);
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s)); }
function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

const INTERVAL_MONTHS = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
const INTERVAL_LABEL = { monthly: 'Monatlich', quarterly: 'Vierteljährlich', halfyearly: 'Halbjährlich', yearly: 'Jährlich' };
const CUSTOMER_TYPES = ['Landwirt', 'Gartenbau', 'Forst', 'Kommune', 'Gewerbe', 'Privat'];
const TASK_KINDS = { anruf: 'Anruf', termin: 'Termin', besuch: 'Besuch', angebot: 'Angebot', aufgabe: 'Aufgabe' };
const ENTRY_KINDS = { besuch: 'Besuch', telefonat: 'Telefonat', email: 'E-Mail', termin: 'Termin', notiz: 'Notiz', sonstiges: 'Sonstiges', system: 'System' };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split('$');
    const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

function str(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}

module.exports = {
  pad, fmtDate, fmtDateTime, today, nowLocal, parseDate, addDays, addMonths, isDate, isTime,
  INTERVAL_MONTHS, INTERVAL_LABEL, CUSTOMER_TYPES, TASK_KINDS, ENTRY_KINDS,
  hashPassword, verifyPassword, token, str,
};
