'use strict';
/**
 * Firmendaten (Name, Adresse, Logo, Farbe) – einstellbar unter Einstellungen → Firma.
 * Damit lässt sich das CRM auch für andere Betriebe installieren.
 * Bestehende Installation (schon Benutzer angelegt, aber noch keine Firmendaten):
 * es werden einmalig die bisherigen Bussmann-Angaben übernommen, damit sich nichts ändert.
 */
const fs = require('fs');
const path = require('path');
const { get, getSetting, setSetting, DATA_DIR } = require('./db');

const FIELDS = ['name', 'app_name', 'street', 'zip_city', 'phone', 'email', 'website', 'slogan', 'color'];
const NEUTRAL = { name: 'Mein Betrieb', app_name: 'CRM', street: '', zip_city: '', phone: '', email: '', website: '', slogan: '', color: '#c0292f' };
const BUSSMANN = {
  name: 'Bussmann Land- & Gartentechnik', app_name: 'Bussmann CRM', street: 'Hauptstraße 5', zip_city: '48329 Havixbeck',
  phone: '02507 1294', email: 'info@bussmann-havixbeck.de', website: '', slogan: 'Wenn Sie Qualität und Service schätzen!', color: '#c0292f',
};
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BUILTIN_LOGO = path.join(__dirname, '..', 'public', 'img', 'logo.png');

// einmalige Übernahme für die bestehende Bussmann-Installation
if (!getSetting('company_name') && get('SELECT id FROM users LIMIT 1')) {
  for (const k of FIELDS) setSetting('company_' + k, BUSSMANN[k]);
  setSetting('company_logo', 'builtin');
}

function company() {
  const c = {};
  for (const k of FIELDS) c[k] = getSetting('company_' + k) || NEUTRAL[k];
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) c.color = NEUTRAL.color;
  c.logo = getSetting('company_logo') || '';
  c.logo_v = getSetting('company_logo_v') || '1';
  c.logo_url = c.logo ? `/firma/logo?v=${c.logo_v}` : '';
  return c;
}

function save(b) {
  for (const k of FIELDS) {
    if (b[k] === undefined) continue;
    let v = String(b[k] ?? '').trim().slice(0, k === 'slogan' ? 200 : 120);
    if (k === 'color' && !/^#[0-9a-f]{6}$/i.test(v)) continue;
    if (k === 'name' && !v) continue;
    if (k === 'website' && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    setSetting('company_' + k, v);
  }
  if (b.name && !getSetting('company_app_name')) setSetting('company_app_name', String(b.name).trim().split(/\s+/)[0] + ' CRM');
}

function logoFile() {
  const l = getSetting('company_logo');
  if (l === 'builtin') return { file: BUILTIN_LOGO, type: 'image/png' };
  if (!l) return null;
  const ext = l.split('.').pop();
  const type = Object.keys(LOGO_TYPES).find((t) => LOGO_TYPES[t] === ext);
  const file = path.join(DATA_DIR, l);
  return type && fs.existsSync(file) ? { file, type } : null;
}

function setLogo(buffer, mime) {
  const ext = LOGO_TYPES[mime];
  if (!ext) throw new Error('Bitte das Logo als PNG, JPG oder WebP hochladen');
  const old = getSetting('company_logo');
  const name = `company-logo.${ext}`;
  fs.writeFileSync(path.join(DATA_DIR, name), buffer);
  if (old && old !== 'builtin' && old !== name) { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch { /* egal */ } }
  setSetting('company_logo', name);
  setSetting('company_logo_v', String(Date.now()));
}
function clearLogo() {
  const old = getSetting('company_logo');
  if (old && old !== 'builtin') { try { fs.unlinkSync(path.join(DATA_DIR, old)); } catch { /* egal */ } }
  setSetting('company_logo', '');
  setSetting('company_logo_v', String(Date.now()));
}

/** Kontaktzeile für Fußzeilen: Name · Straße · Ort · Telefon (leere Teile fallen weg) */
const contactLine = (c = company()) => [c.name, c.street, c.zip_city, c.phone].filter(Boolean).join(' · ');

module.exports = { company, save, logoFile, setLogo, clearLogo, contactLine, FIELDS, LOGO_TYPES, BUSSMANN };
