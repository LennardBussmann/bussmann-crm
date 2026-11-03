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

    // Doppelte Zeilen zusammenführen + vorhandene ergänzen
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
      ['Vorname', 'Nachname', 'PLZ', 'Ort', 'E-Mail', 'Handynummer', 'Festnetznummer', 'Info'],
      ['Karl', 'Müller', '48727', 'Billerbeck', '', '0171 555', '', 'Fendt 211'],
      ['Karl', 'Mueller', '48727', '', 'karl@x.de', '+49 171 555', '02543 9', ''],
      ['', 'Weber', '', '', 'karl@x.de', '', '', ''],
      ['Daniel', 'Dircks', '48727', '', 'neu@dircks.de', '', '', 'Hat Hund'],
    ]), 'K');
    const prev2 = await call('a', 'POST', '/api/import/preview', XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }), true);
    assert.equal(prev2.total, 4);
    assert.equal(prev2.rows.length, 3, 'Zeilen falsch zusammengefasst');
    assert.equal(prev2.rows[0]._count, 2);
    assert.equal(prev2.rows[1].last_name, 'Weber');
    assert.equal(prev2.rows[0].city, 'Billerbeck');
    assert.equal(prev2.rows[0].email, 'karl@x.de');
    assert.equal(prev2.rows[0].phone, '02543 9');
    assert.equal(prev2.rows[2]._duplicate, id);
    const r2 = await call('a', 'POST', '/api/import/commit', { rows: prev2.rows, dupMode: 'merge' });
    assert.equal(r2.created, 2); assert.equal(r2.updated, 1);
    const dd = (await call('a', 'GET', `/api/customers/${id}`)).customer;
    assert.equal(dd.email, 'd@example.de', 'vorhandene E-Mail überschrieben');
    assert.ok(dd.info.includes('Hat Hund') && dd.info.includes('neu@dircks.de'));
    assert.equal((await call('a', 'GET', '/api/customers?q=' + encodeURIComponent('Karl Müller'))).rows.length, 1);

    // CSV aus Excel (Windows-1252, Semikolon)
    const csv = Buffer.from('Vorname;Nachname;Ort\r\nJ\xfcrgen;M\xfcller;L\xfcnen\r\n', 'latin1');
    const pc = await call('a', 'POST', '/api/import/preview', csv, true);
    assert.equal(pc.rows[0].first_name, 'Jürgen');
    assert.equal(pc.rows[0].city, 'Lünen');
    // Mehrfach löschen
    const ids = (await call('a', 'GET', '/api/customers?q=schulte')).rows.map((r) => r.id);
    assert.equal((await call('a', 'POST', '/api/customers/bulk-delete', { ids })).deleted, ids.length);
    await assert.rejects(call('k', 'POST', '/api/customers/bulk-delete', { ids: [id] }), /403/);

    // Kaufender Kunde / Interessent, Filter, Kontakt-Reiter
    const lead = (await call('a', 'POST', '/api/customers', { first_name: 'Ina', last_name: 'Interessent', city: 'Coesfeld', customer_type: 'Gartenbau' })).id;
    const buyer = (await call('a', 'POST', '/api/customers', { first_name: 'Karl', last_name: 'Käufer', city: 'Coesfeld', customer_type: 'Landwirt', is_buyer: true })).id;
    let cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=lead');
    assert.deepEqual(cl.rows.map((r) => r.id), [lead]);
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=buyer');
    assert.deepEqual(cl.rows.map((r) => r.id), [buyer]);
    assert.equal((await call('a', 'GET', '/api/customers?q=Coesfeld&type=Gartenbau')).rows.length, 1);
    await call('a', 'PUT', `/api/customers/${lead}`, { is_buyer: true });
    assert.equal((await call('a', 'GET', '/api/customers?q=Coesfeld&status=buyer')).rows.length, 2);
    await call('k', 'POST', '/api/customers/bulk-update', { ids: [lead, buyer], is_buyer: false, customer_type: 'Forst' });
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&status=lead&type=Forst');
    assert.equal(cl.rows.length, 2);
    // Kontakt: Karl vor 2 Monaten, Ina nie
    await call('a', 'POST', `/api/customers/${buyer}/entries`, { kind: 'telefonat', text: 'Telefonat', happened_at: U.addMonths(U.today(), -2) + 'T10:00' });
    cl = await call('a', 'GET', '/api/customers?q=Coesfeld&contact=m3');
    assert.deepEqual(cl.rows.map((r) => r.id), [buyer]);
    assert.equal(cl.counts.all, 2); assert.equal(cl.counts.m3, 1); assert.equal(cl.counts.old, 1); assert.equal(cl.counts.m1, 0);
    assert.deepEqual((await call('a', 'GET', '/api/customers?q=Coesfeld&contact=old')).rows.map((r) => r.id), [lead]);
    // Import mit Status-Spalte
    const ws3 = XLSX.utils.aoa_to_sheet([['Vorname', 'Nachname', 'Ort', 'Kundenart', 'Status'], ['Gerd', 'Gärtner', 'Nottuln', 'GaLaBau', 'Kunde'], ['Lea', 'Leer', 'Nottuln', '', 'Interessent']]);
    const wb3 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb3, ws3, "K");
    const pv3 = await call('a', 'POST', '/api/import/preview', XLSX.write(wb3, { type: 'buffer', bookType: 'xlsx' }), true);
    assert.equal(pv3.rows[0].is_buyer, 1); assert.equal(pv3.rows[0].customer_type, 'Gartenbau'); assert.equal(pv3.rows[1].is_buyer, 0);

    // Termin mit weiteren Teilnehmern
    const third = await call('a', 'POST', '/api/users', { name: 'Tina Dritte', email: 'tina@test.de', password: 'geheim123' });
    await call('t', 'POST', '/api/login', { email: 'tina@test.de', password: 'geheim123' });
    const tid = (await call('a', 'POST', '/api/tasks', { kind: 'termin', title: 'Vorführung Mähwerk', due_date: U.addDays(U.today(), 3), due_time: '10:00', customer_id: buyer, participants: [kollege.id, third.id, me.user.id] })).id;
    let tk = await call('a', 'GET', `/api/tasks/${tid}`);
    assert.equal(tk.assigned_to, me.user.id);
    assert.deepEqual(tk.participant_ids.split(',').map(Number).sort(), [kollege.id, third.id].sort(), 'Zuständiger darf nicht doppelt Teilnehmer sein');
    assert.ok((await call('t', 'GET', '/api/notifications')).some((n) => n.text.includes('eingeladen') && n.text.includes('Vorführung')));
    assert.ok((await call('t', 'GET', '/api/tasks?scope=mine&status=open')).some((t) => t.id === tid), 'Teilnehmer sieht Termin nicht');
    const tcal = await call('t', 'GET', `/api/calendar?from=${U.today()}&to=${U.addDays(U.today(), 7)}`);
    assert.ok(tcal.tasks.some((t) => t.id === tid));
    const tdash = await call('t', 'GET', '/api/dashboard');
    assert.ok(tdash.open.some((t) => t.id === tid));
    const tFeed = await (await fetch(base + new URL((await call('t', 'GET', '/api/me/ical')).https).pathname)).text();
    assert.ok(tFeed.includes('Vorführung Mähwerk'), 'Teilnehmer-Kalender fehlt Termin');
    await call('a', 'PUT', `/api/tasks/${tid}`, { participants: [third.id] });
    tk = await call('a', 'GET', `/api/tasks/${tid}`);
    assert.equal(tk.participant_ids, String(third.id));
    assert.ok(!(await call('k', 'GET', '/api/tasks?scope=mine&status=open')).some((t) => t.id === tid));
    // Folgeaufgabe aus Zeitleiste mit Teilnehmer
    const fu = await call('a', 'POST', `/api/customers/${buyer}/entries`, { kind: 'besuch', text: 'Besuch', tasks: [{ kind: 'besuch', title: 'Zweiter Besuch', due_date: U.addDays(U.today(), 9), assigned_to: kollege.id, participants: [third.id] }] });
    assert.equal((await call('t', 'GET', `/api/tasks/${fu.taskIds[0]}`)).participant_names, 'Tina Dritte');

    // Schlagworte
    await call('a', 'PUT', `/api/customers/${buyer}`, { tags: 'Messe 2026, Mähroboter' });
    assert.deepEqual((await call('a', 'GET', '/api/customers?tag=' + encodeURIComponent('Messe 2026'))).rows.map((r) => r.id), [buyer]);
    await call('a', 'POST', '/api/customers/bulk-update', { ids: [lead, buyer], add_tag: 'Messe 2026' });
    assert.equal((await call('a', 'GET', '/api/customers?tag=' + encodeURIComponent('messe 2026'))).rows.length, 2);
    await call('a', 'POST', '/api/customers/bulk-update', { ids: [buyer], remove_tag: 'Mähroboter' });
    const meta = await call('a', 'GET', '/api/meta');
    assert.deepEqual(meta.tags, [{ tag: 'Messe 2026', n: 2 }]);

    // Maschinen + Wartungserinnerung
    const mid = (await call('a', 'POST', `/api/customers/${buyer}/machines`, { category: 'Rasentraktor', brand: 'Husqvarna', model: 'TS 142', serial: 'HQ-4711', year: 2021, sold_by_us: true, service_interval: 'yearly', next_service: U.addDays(U.today(), 1) })).id;
    let cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.machines.length, 1);
    const svc = cd.tasks.find((t) => t.kind === 'wartung' && t.status === 'open');
    assert.ok(svc && svc.due_date === U.addDays(U.today(), 1) && svc.machine_id === mid, 'Wartungsaufgabe fehlt');
    assert.equal((await call('a', 'GET', '/api/customers?q=HQ-4711')).rows[0].id, buyer, 'Suche nach Seriennummer');
    assert.ok((await call('a', 'GET', '/api/customers?extra=service_due')).rows.some((r) => r.id === buyer));
    await call('a', 'POST', `/api/tasks/${svc.id}/done`, { note: 'Messer geschliffen' });
    cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.machines[0].last_service, U.today());
    assert.equal(cd.machines[0].next_service, U.addMonths(U.today(), 12));
    assert.equal(cd.tasks.filter((t) => t.kind === 'wartung' && t.status === 'open').length, 1, 'nächste Wartung nicht geplant');
    await call('a', 'PUT', `/api/machines/${mid}`, { next_service: '', service_interval: '' });
    cd = await call('a', 'GET', `/api/customers/${buyer}`);
    assert.equal(cd.tasks.filter((t) => t.kind === 'wartung' && t.status === 'open').length, 0);
    await call('a', 'DELETE', `/api/machines/${mid}`);
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).machines.length, 0);

    // Karte / Verortung (Geocoder simuliert)
    const geo = require('../lib/geo');
    const fakeFetch = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('street=') ? [] : [{ lat: '51.97', lon: '7.17' }]) });
    for (let i = 0; i < 50 && await geo.geocodeNext(fakeFetch); i++);
    const mp = await call('a', 'GET', '/api/map?q=Coesfeld');
    assert.equal(mp.points.length, 2); assert.equal(mp.points[0].geo, 'approx'); assert.equal(mp.pending, 0);
    await call('a', 'PUT', `/api/customers/${buyer}/geo`, { lat: 51.98, lng: 7.2 });
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).customer.geo_status, 'manual');
    await call('a', 'PUT', `/api/customers/${buyer}`, { street: 'Neue Straße 1' });
    assert.equal((await call('a', 'GET', `/api/customers/${buyer}`)).customer.geo_status, '', 'Adressänderung muss neu verorten');

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
