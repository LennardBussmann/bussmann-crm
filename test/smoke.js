'use strict';
// Schnelltest der API: startet den Server mit leerer Test-Datenbank und spielt die wichtigsten Abläufe durch.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATA_DIR = dir;
process.env.TZ = 'Europe/Berlin';
const app = require('../server');
const XLSX = require('xlsx');
const L = require('../lib/logic');
const U = require('../lib/util');

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jars = {};
  const call = async (who, method, p, body, raw) => {
    const headers = { 'X-Requested-With': 'crm' };
    if (jars[who]) headers.Cookie = jars[who];
    let b;
    if (raw) { b = body; headers['Content-Type'] = 'application/octet-stream'; } else if (body !== undefined) { b = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers, body: b });
    const sc = r.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await call('a', 'POST', '/api/setup', { name: 'Lennard Bussmann', email: 'admin@test.de', password: 'geheim123' });
    const me = await call('a', 'GET', '/api/me');
    assert.equal(me.user.role, 'admin');
    const kollege = await call('a', 'POST', '/api/users', { name: 'Kai Kollege', email: 'kai@test.de', password: 'geheim123' });
    await call('k', 'POST', '/api/login', { email: 'kai@test.de', password: 'geheim123' });

    const bday = `1980-${U.today().slice(5)}`;
    const { id } = await call('a', 'POST', '/api/customers', { first_name: 'Daniel', last_name: 'Dircks', street: 'Aulendorfer Weg 13', zip: '48727', city: 'Billerbeck', customer_type: 'Landwirt', birthday: bday, email: 'd@example.de', mobile: '0151 14620134', visit_interval: 'quarterly' });
    let d = await call('a', 'GET', `/api/customers/${id}`);
    const visit = d.tasks.find((t) => t.auto_visit);
    assert.ok(visit, 'automatische Besuchsaufgabe fehlt');
    assert.equal(visit.due_date, U.addMonths(U.today(), 3));

    // Besuch mit Folgeaufgabe an Kollegen
    await call('a', 'POST', `/api/customers/${id}/entries`, { kind: 'besuch', text: 'Hofbesuch, Interesse an Mähwerk', happened_at: U.nowLocal(), tasks: [{ kind: 'angebot', title: 'Angebot Mähwerk', due_date: U.addDays(U.today(), 1), assigned_to: kollege.id }] });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.equal(d.entries.filter((e) => e.kind === 'besuch').length, 1);
    const offer = d.tasks.find((t) => t.kind === 'angebot');
    assert.equal(offer.assigned_to, kollege.id);
    const notes = await call('k', 'GET', '/api/notifications');
    assert.ok(notes.some((n) => n.text.includes('Angebot Mähwerk')), 'Kollege nicht benachrichtigt');
    const kTasks = await call('k', 'GET', '/api/tasks?scope=mine&status=open');
    assert.equal(kTasks.length, 1);

    // Erinnerung einen Tag vorher
    await L.runReminders();
    const notes2 = await call('k', 'GET', '/api/notifications');
    assert.ok(notes2.some((n) => n.text.startsWith('Erinnerung')), 'Erinnerung fehlt');

    // Bild an Aufgabe
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await call('k', 'POST', `/api/tasks/${offer.id}/files`, png, true);
    let td = await call('a', 'GET', `/api/tasks/${offer.id}`);
    assert.equal(td.files.length, 1);
    assert.equal((await call('a', 'GET', '/api/tasks?scope=all&status=open')).find((x) => x.id === offer.id).file_count, 1);
    const img = await fetch(`${base}/api/task-files/${up.id}`, { headers: { Cookie: jars.a } });
    assert.equal(img.status, 200);
    await call('a', 'DELETE', `/api/task-files/${up.id}`);
    td = await call('a', 'GET', `/api/tasks/${offer.id}`);
    assert.equal(td.files.length, 0);

    // Infofeld
    await call('a', 'PUT', `/api/customers/${id}/info`, { info: 'Zahlt immer bar' });
    // Erledigen -> Zeitleiste
    await call('k', 'POST', `/api/tasks/${offer.id}/done`, { note: 'Per Mail verschickt' });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.equal(d.customer.info, 'Zahlt immer bar');
    assert.ok(d.entries.some((e) => e.text.includes('Per Mail verschickt')));
    // Änderungsprotokoll
    await call('k', 'PUT', `/api/customers/${id}`, { phone: '02543 1234' });
    d = await call('a', 'GET', `/api/customers/${id}`);
    assert.ok(d.entries.some((e) => e.kind === 'system' && e.text.includes('Festnetznummer') && e.author === 'Kai Kollege'));

    // Dashboard + Geburtstag
    const dash = await call('a', 'GET', '/api/dashboard?scope=all');
    assert.ok(dash.birthdaysUpcoming.some((b) => b.id === id), 'Geburtstag fehlt');
    assert.ok(dash.week.length >= 0);

    // Suche
    assert.equal((await call('a', 'GET', '/api/customers?q=billerbeck')).rows.length, 1);
    assert.equal((await call('a', 'GET', '/api/customers?q=0151146')).rows.length, 1);
    assert.equal((await call('a', 'GET', '/api/customers?q=xyz')).rows.length, 0);

    // Excel-Import
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Vorname', 'Nachname', 'Straße und Hausnummer', 'PLZ', 'Ort', 'Kundenart', 'Geburtsdatum', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Besuchsintervall'],
      ['Anna', 'Schulte', 'Dorfstr. 2', 48727, 'Billerbeck', 'Forst', '03.04.1975', 'anna@x.de', '0170 111', '02541 222', 'Jährlich'],
      ['Gemeinde', 'Nottuln', '', '48301', 'Nottuln', 'Kommune', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['Daniel', 'Dircks', '', '48727', '', '', '', '', '', '', ''],
      ['ohne', '', '', '', '', '', '', '', '', '', ''],
    ]), 'Kunden');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const prev = await call('a', 'POST', '/api/import/preview', buf, true);
    assert.equal(prev.rows.length, 4);
    assert.equal(prev.rows[0].birthday, '1975-04-03');
    assert.equal(prev.rows[0].visit_interval, 'yearly');
    assert.equal(prev.rows[0].zip, '48727');
    assert.ok(prev.rows[2]._duplicate, 'Dublette nicht erkannt');
    assert.equal(prev.rows[3]._error, 'Nachname fehlt');
    const imp = await call('a', 'POST', '/api/import/commit', { rows: prev.rows.filter((r) => !r._error && !r._duplicate) });
    assert.equal(imp.created, 2);

    // iCal
    const ical = await call('a', 'GET', '/api/me/ical');
    const feed = await (await fetch(base + new URL(ical.https).pathname)).text();
    assert.ok(feed.startsWith('BEGIN:VCALENDAR'));
    assert.ok(feed.includes('BEGIN:VALARM'));
    assert.ok(feed.includes('Geburtstag Daniel Dircks'));
    assert.ok(!feed.split('\r\n').some((l) => Buffer.byteLength(l) > 75), 'Zeilen nicht gefaltet');

    // Rechte
    await assert.rejects(call('k', 'DELETE', `/api/customers/${id}`), /403/);
    await assert.rejects(call('x', 'GET', '/api/customers'), /401/);

    console.log('✓ Alle Tests bestanden');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('✗', e); process.exit(1); });
