'use strict';
/**
 * Eingangsrechnungen (Lieferant -> Händler) für das Maschinen-Lager auslesen – mit der Claude-API.
 * Liefert Maschine, Ausstattung, Einkaufspreis und Zusatzkosten (Fracht, Zubehör, Montage …).
 * Rechnungen sehen bei jedem Hersteller anders aus; ohne KI-Schlüssel ist die Auswertung aus.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { OfferError, IMAGE_TYPES, MODEL } = require('./offer');

const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const int = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const SCHEMA = (() => {
  const cost = { type: 'object', properties: { bezeichnung: { type: 'string' }, betrag_netto: { type: 'number' } }, required: ['bezeichnung', 'betrag_netto'], additionalProperties: false };
  const props = {
    lieferant: str, rechnung_nr: str, rechnung_datum: str,
    maschinentyp: str, marke: str, modell: str, seriennummer: str, baujahr: int, betriebsstunden: int,
    zustand: { anyOf: [{ type: 'string', enum: ['neu', 'vorfuehr', 'gebraucht'] }, { type: 'null' }] },
    ausstattung: { type: 'array', items: { type: 'string' } },
    preis_maschine_netto: num,
    zusatzkosten: { type: 'array', items: cost },
    summe_netto: num,
    hinweise: str,
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
})();

const PROMPT = (dealer, brands, types) => `Das Dokument ist eine Eingangsrechnung (oder Lieferschein / Auftragsbestätigung) eines Herstellers oder Lieferanten an den Landtechnik-Händler ${dealer}. Der Händler hat damit eine Maschine eingekauft und nimmt sie ins Lager auf. Übertrage die Daten in das Lager-CRM.

Felder:
- lieferant: Firma, die die Rechnung gestellt hat (nicht der Händler selbst).
- rechnung_nr, rechnung_datum (JJJJ-MM-TT).
- maschinentyp: Art der Hauptmaschine auf Deutsch, z. B. ${types.join(', ')}.
- marke: Hersteller der Hauptmaschine. Bekannte Marken: ${brands.join(', ')}. Schreibweise genau so übernehmen, wenn es eine davon ist.
- modell: Modellbezeichnung ohne Marke. seriennummer: Serien-/Fahrgestell-/Maschinennummer (FIN), falls genannt.
- baujahr, betriebsstunden: nur wenn genannt. zustand: "neu" bei Neumaschinen, "vorfuehr" bei Vorführmaschinen, "gebraucht" bei Gebrauchten.
- ausstattung: Ausstattung, Optionen, Zubehör und Anbaugeräte der Maschine als Liste, ein Eintrag pro Merkmal, kurz und verständlich (z. B. "Kabine mit Heizung", "Palettengabel 1.200 mm", "3. Steuerkreis"). Ohne Preise, ohne Artikelnummern, ohne Fracht/Montage.
- preis_maschine_netto: Einkaufspreis der Hauptmaschine netto in Euro inklusive ab Werk eingebauter Ausstattung/Optionen, nach Rabatten und Nachlässen.
- zusatzkosten: alles, was zusätzlich zur Maschine berechnet wird, jeweils netto nach Rabatt: Fracht/Transport/Überführung, Montage/Aufbau, separat berechnetes Zubehör und Anbaugeräte, Aufbereitung, Gebühren. Bezeichnung kurz (z. B. "Fracht", "Montage", "Zubehör: Palettengabel"). Kein Eintrag für die MwSt.
- summe_netto: Rechnungsbetrag netto. preis_maschine_netto + Summe der zusatzkosten soll summe_netto ergeben.
- Nur Bruttobeträge angegeben: durch 1,19 teilen.
- hinweise: kurz, was sonst wichtig ist (Liefertermin, Zahlungsziel, Skonto, Garantie).
Was nicht im Dokument steht: null bzw. leere Liste. Nichts erfinden.`;

let cached = { key: null, client: null };
const clientFor = (key) => { if (cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120000 }) }; return cached.client; };

async function parseInvoice({ buffer, mime, apiKey, dealer, brands, types }) {
  let source;
  if (mime === 'application/pdf') source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
  else if (IMAGE_TYPES.includes(mime)) source = { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
  else throw new OfferError('Bitte die Rechnung als PDF oder Foto (JPG/PNG) hochladen');
  if (buffer.length > 20 * 1024 * 1024) throw new OfferError('Die Datei ist zu groß für die Auswertung (max. 20 MB)');
  let msg;
  try {
    msg = await clientFor(apiKey).beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT(dealer, brands, types) }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new OfferError('Der KI-Schlüssel ist ungültig – bitte unter Einstellungen prüfen');
    if (e instanceof Anthropic.PermissionDeniedError) throw new OfferError('Der KI-Schlüssel hat keine Berechtigung – bitte unter Einstellungen prüfen');
    if (e instanceof Anthropic.RateLimitError) throw new OfferError('Die KI ist gerade ausgelastet oder das Guthaben ist aufgebraucht – bitte gleich noch einmal versuchen');
    if (e instanceof Anthropic.BadRequestError) throw new OfferError('Die Datei konnte nicht gelesen werden (' + e.message.slice(0, 160) + ')');
    if (e instanceof Anthropic.APIConnectionError) throw new OfferError('Keine Verbindung zur KI – bitte später noch einmal versuchen');
    if (e instanceof Anthropic.APIError) throw new OfferError(`KI-Fehler ${e.status ?? ''} – bitte später noch einmal versuchen`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new OfferError('Die KI hat das Dokument nicht ausgewertet – bitte die Felder von Hand ausfüllen');
  if (msg.stop_reason === 'max_tokens') throw new OfferError('Die Rechnung war zu lang für die Auswertung – bitte die Felder von Hand ausfüllen');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new OfferError('Die Auswertung hat nichts Lesbares ergeben – bitte die Felder von Hand ausfüllen'); }
}

/** ausgelesene Rechnung -> Felder des Maschinen-Formulars */
function toMachineFields(x, isDate) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const i = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const date = (v) => (isDate(v) ? v : null);
  const costs = (Array.isArray(x.zusatzkosten) ? x.zusatzkosten : []).map((c) => ({ label: String(c.bezeichnung || 'Zusatzkosten').slice(0, 80), amount: n(c.betrag_netto) })).filter((c) => c.amount != null && c.amount !== 0);
  const eq = (Array.isArray(x.ausstattung) ? x.ausstattung : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
  const nr = [x.rechnung_nr ? `Rechnung Nr. ${x.rechnung_nr}` : '', date(x.rechnung_datum) ? `vom ${x.rechnung_datum.split('-').reverse().join('.')}` : '', x.lieferant ? `von ${x.lieferant}` : ''].filter(Boolean).join(' ');
  return {
    category: x.maschinentyp || '', brand: x.marke || '', model: x.modell || '', serial: x.seriennummer || '',
    year: i(x.baujahr, 1950, 2100), hours: i(x.betriebsstunden, 0, 1000000), condition: x.zustand || '',
    equipment: eq.join('\n'), purchase_price: n(x.preis_maschine_netto), costs,
    in_date: date(x.rechnung_datum), origin: x.lieferant ? `${x.zustand === 'neu' ? 'Neu von' : 'Ankauf von'} ${x.lieferant}` : '',
    notes: [nr, x.hinweise || ''].filter(Boolean).join(' · ').slice(0, 1000),
    total: n(x.summe_netto),
  };
}

module.exports = { parseInvoice, toMachineFields, SCHEMA };
