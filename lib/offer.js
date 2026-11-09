'use strict';
/**
 * Angebote (PDF oder Foto) automatisch auswerten – mit der Claude-API.
 * Der API-Schlüssel kommt aus der Umgebung (ANTHROPIC_API_KEY) oder aus den
 * Einstellungen (nur Administrator). Ohne Schlüssel ist die Auswertung aus.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.OFFER_MODEL || 'claude-opus-5-5';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
function schema(financing) {
  const props = {
    firma: str, vorname: str, nachname: str, strasse: str, plz: str, ort: str,
    ansprechpartner: str, telefon: str, email: str,
    marke: str, maschinentyp: str, modell: str, ausstattung: str,
    preis_netto: num, angebot_datum: str, angebot_nr: str, gueltig_bis: str, liefertermin: str,
    inzahlung: str, inzahlung_wert: num,
    finanzierung: { anyOf: [{ type: 'string', enum: financing }, { type: 'null' }] },
    hinweise: str,
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

const PROMPT = (brands, types) => `Du liest ein Angebot eines Landtechnik-Händlers (Bussmann Land- & Gartentechnik, Havixbeck) an einen Kunden und überträgst die Daten in ein CRM.
Wichtig: Bussmann ist der Anbieter, nicht der Kunde. Kunde ist der Empfänger des Angebots (Anschriftenfeld).

Felder:
- firma, vorname, nachname, strasse, plz, ort: Empfänger des Angebots. Privatperson ohne Firma: firma = null. Landwirtschaftlicher Betrieb ohne Firmennamen: firma = null.
- ansprechpartner, telefon, email: Ansprechpartner beim Kunden, falls genannt (nicht die Bussmann-Mitarbeiter).
- marke: Hersteller der angebotenen Hauptmaschine. Bekannte Marken: ${brands.join(', ')}. Schreibweise genau so übernehmen, wenn es eine davon ist.
- maschinentyp: Art der Maschine auf Deutsch, z. B. ${types.join(', ')}.
- modell: Modellbezeichnung ohne Marke, z. B. "1390", "4080T", "MF 5S.145".
- ausstattung: wichtigste Ausstattung und Anbaugeräte, kurz, durch Komma getrennt (höchstens ca. 300 Zeichen).
- preis_netto: Endpreis des Angebots netto in Euro (nach Rabatt, ohne MwSt., ohne Abzug der Inzahlungnahme). Nur brutto angegeben: durch 1,19 teilen.
- angebot_datum, gueltig_bis, liefertermin: als JJJJ-MM-TT. Nur ungefähr ("KW 12/2027", "Frühjahr") -> null und in hinweise.
- inzahlung, inzahlung_wert: in Zahlung genommene Gebrauchtmaschine (Bezeichnung mit Baujahr) und Wert in Euro.
- finanzierung: nur wenn das Angebot eine Zahlungsart nennt.
- hinweise: kurz, was sonst wichtig ist (Gültigkeit, Lieferzeit, Sonderkonditionen, Finanzierungsrate).
Was nicht im Dokument steht: null. Nichts erfinden.`;

let cached = { key: null, client: null };
function clientFor(key) {
  if (cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120000 }) };
  return cached.client;
}

class OfferError extends Error {}

/** @returns {Promise<object>} ausgelesene Felder (siehe schema) */
async function parseOffer({ buffer, mime, apiKey, brands, types, financing }) {
  let source;
  if (mime === 'application/pdf') source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
  else if (IMAGE_TYPES.includes(mime)) source = { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
  else throw new OfferError('Bitte ein Angebot als PDF oder Foto (JPG/PNG) hochladen');
  if (buffer.length > 20 * 1024 * 1024) throw new OfferError('Die Datei ist zu groß für die Auswertung (max. 20 MB)');

  let msg;
  try {
    msg = await clientFor(apiKey).beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema(financing) } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT(brands, types) }] }],
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
  if (msg.stop_reason === 'max_tokens') throw new OfferError('Das Angebot war zu lang für die Auswertung – bitte die Felder von Hand ausfüllen');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new OfferError('Die Auswertung hat nichts Lesbares ergeben – bitte die Felder von Hand ausfüllen'); }
}

module.exports = { parseOffer, OfferError, IMAGE_TYPES, MODEL };
