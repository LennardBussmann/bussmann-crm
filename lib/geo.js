'use strict';
/**
 * Adressen im Hintergrund in Koordinaten umwandeln (OpenStreetMap Nominatim).
 * Nominatim erlaubt höchstens 1 Anfrage pro Sekunde -> es wird immer nur ein Kunde nach dem anderen verortet.
 */
const { get, run } = require('./db');
const { appUrl } = require('./mail');

const ENDPOINT = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
let busy = false;
let pauseUntil = 0;

async function lookup(params, fetchImpl) {
  const host = (appUrl() || 'bussmann-crm').replace(/^https?:\/\//, '');
  const r = await fetchImpl(`${ENDPOINT}?${new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'de,nl', ...params })}`, {
    headers: { 'User-Agent': `Bussmann-CRM/1.0 (${host})`, 'Accept-Language': 'de' },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('Geocoder ' + r.status), { retry: true });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j) && j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
}

/** Verortet den nächsten offenen Kunden. Gibt true zurück, wenn etwas getan wurde. */
async function geocodeNext(fetchImpl = fetch) {
  if (busy || process.env.GEOCODER === 'off' || Date.now() < pauseUntil) return false;
  busy = true;
  try {
    const c = get(`SELECT id, street, zip, city FROM customers WHERE IFNULL(geo_status,'')='' AND (IFNULL(city,'')<>'' OR IFNULL(zip,'')<>'') ORDER BY id LIMIT 1`);
    if (!c) return false;
    const base = { postalcode: c.zip || '', city: c.city || '' };
    let hit = c.street ? await lookup({ ...base, street: c.street }, fetchImpl) : null;
    let status = 'ok';
    if (!hit) { hit = await lookup(base, fetchImpl); status = 'approx'; } // nur Ort gefunden
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
      run('UPDATE customers SET lat=?, lng=?, geo_status=? WHERE id=? AND IFNULL(geo_status,\'\')=\'\'', hit.lat, hit.lng, status, c.id);
    } else {
      run(`UPDATE customers SET geo_status='fail' WHERE id=? AND IFNULL(geo_status,'')=''`, c.id);
    }
    return true;
  } catch (e) {
    // Netzwerkproblem oder Limit: 10 Minuten Pause, dann weiter
    pauseUntil = Date.now() + 10 * 60 * 1000;
    console.error('[geo]', e.message);
    return false;
  } finally { busy = false; }
}

function startGeocoder() {
  setInterval(() => { geocodeNext().catch(() => {}); }, 1500);
}

module.exports = { geocodeNext, startGeocoder };
