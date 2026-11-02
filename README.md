# Bussmann CRM

Kundenverwaltung für **Bussmann Land- & Gartentechnik**, als Ersatz für Zoho Bigin. Die Gestaltung folgt dem Corporate Design 2025: Rot HKS 14 `#c0292f`, Grau HKS 92 `#6a6d6e`, Schrift Nunito Sans (Condensed).

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Übersicht** | Wochenkalender mit Terminen und Aufgaben, offene Aufgaben (überfällig, heute, demnächst) zum Anklicken und Abhaken, Kundengeburtstage der Woche und der nächsten 30 Tage, Aufgaben, die man an Kollegen delegiert hat. Umschaltbar zwischen „Meine“, „Alle Mitarbeiter“ und einzelnen Kollegen. |
| **Kunden** | Liste mit Name, Ort, Kundenart, E-Mail, Telefon, Betreuer und letztem Kontakt. Die Suche läuft beim Tippen über Name, Firma, Ort, PLZ, Straße, E-Mail, Telefonnummer und Infofeld. Filter nach Kundenart, Sortierung, Excel-Export. |
| **Kunde anlegen** | Anrede, Vorname, Nachname, Firma, Straße mit Hausnummer, PLZ, Ort, Kundenart (Kommune, Privat, Landwirt, Forst, Gewerbe), Geburtsdatum, E-Mail, Handy, Festnetz, Besuchsintervall, Betreuer. |
| **Excel-Import** | .xlsx, .xls, .csv. Spalten werden automatisch erkannt, auch die eines Zoho-Bigin-Exports. Vor dem Import gibt es eine Vorschau mit Dubletten-Prüfung. Eine Vorlage lässt sich herunterladen. |
| **Kundenakte** | Das **Infofeld** steht immer oben. Darunter die **Zeitleiste** wie ein Tagebuch: Besuche, Telefonate, E-Mails, Termine und Notizen, jeweils mit Verfasser. Zu jedem Eintrag lassen sich direkt **Folgeaufgaben** anlegen (Anruf, Termin, Besuch, Angebot, Aufgabe), auch für Kollegen. Änderungen an den Kundendaten werden automatisch mitgeschrieben („Festnetznummer aktualisiert – Kai“). Dazu Reiter für Aufgaben und Dateien. |
| **Besuchsintervall** | Monatlich, vierteljährlich, halbjährlich oder jährlich. Das CRM hält automatisch eine Besuchsaufgabe vor, fällig am letzten Besuch plus Intervall. Wird ein Besuch eingetragen oder die Aufgabe erledigt, rückt der nächste Termin automatisch weiter. |
| **Erinnerungen** | Pro Aufgabe „einen Tag vorher erinnern“: Hinweis in der App (Glocke), E-Mail, sofern SMTP eingerichtet ist, und Alarm im Outlook- bzw. iPhone-Kalender. |
| **Mehrere Benutzer** | Jeder hat einen eigenen Zugang. Es gibt Administratoren und Mitarbeiter. Überall ist sichtbar, wer was eingetragen oder geändert hat. |
| **Aufgaben an Kollegen** | Der Kollege sieht die Aufgabe in seiner Liste und bekommt einen Hinweis in der App sowie eine **E-Mail**. Wird sie erledigt, bekommt der Ersteller einen Hinweis. |
| **Kalender-Abo** | Jeder Benutzer hat eine persönliche iCal-Adresse für **Outlook** und **iPhone**. Alle Termine und Aufgaben sowie die Kundengeburtstage erscheinen dort automatisch. |
| **Mobil** | Läuft im Handy-Browser und lässt sich auf dem iPhone als App auf den Home-Bildschirm legen („Zum Home-Bildschirm“). |

## Installation

Voraussetzung ist **Node.js 22.13 oder neuer** (https://nodejs.org, LTS-Version). Eine separate Datenbank ist nicht nötig, die Daten liegen als SQLite-Datei in `data/`.

```bash
npm install
npm start
```

Danach http://localhost:3000 öffnen. Beim ersten Aufruf wird der Administrator-Zugang angelegt. Unter Windows reicht ein Doppelklick auf `start-windows.bat`.

### Betrieb im Netz (empfohlen)

Damit Kollegen von unterwegs zugreifen können und das Kalender-Abo auf dem iPhone funktioniert, muss das CRM **über HTTPS aus dem Internet erreichbar** sein. Möglichkeiten:

- **Kleiner Cloud-Server** (z. B. Hetzner oder IONOS, ca. 5 €/Monat) mit Docker: `docker compose up -d`. Davor kommt ein Reverse-Proxy mit Let's-Encrypt-Zertifikat (z. B. Caddy: `crm.landtechnik-bussmann.de { reverse_proxy localhost:3000 }`).
- **NAS im Büro** (Synology oder QNAP mit Docker) plus Reverse-Proxy und DynDNS.

Umgebungsvariablen (alle optional):

| Variable | Bedeutung |
|---|---|
| `PORT` | Port, Standard 3000 |
| `DATA_DIR` | Ablageort für Datenbank und Dateien, Standard `./data` |
| `APP_URL` | Öffentliche Adresse, z. B. `https://crm.landtechnik-bussmann.de`. Wird für Links in E-Mails und das Kalender-Abo verwendet und kann auch unter Einstellungen eingetragen werden. |
| `TRUST_PROXY=1`, `COOKIE_SECURE=1` | Setzen, wenn ein HTTPS-Proxy davor sitzt |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Alternative zur Einrichtung in der Oberfläche |

### Schnellinstallation auf einem Cloud-Server (empfohlen)

1. Ubuntu-Server anlegen (z. B. Hetzner Cloud CX22, Standort Deutschland).
2. Beim Domain-Anbieter einen A-Eintrag `crm.landtechnik-bussmann.de` auf die IP-Adresse des Servers setzen.
3. Per SSH auf den Server und:
   ```bash
   git clone <Repository-Adresse> bussmann-crm && cd bussmann-crm
   sudo bash deploy/install.sh crm.landtechnik-bussmann.de
   ```
Das Skript installiert Docker, startet das CRM mit automatischem HTTPS-Zertifikat (Caddy/Let's Encrypt), richtet die Firewall ein und legt eine tägliche Sicherung unter `/var/backups/bussmann-crm` an (30 Tage). Updates spielt man mit `sudo bash deploy/update.sh` ein.

### Datensicherung

Es genügt, den Ordner `data/` regelmäßig zu sichern. Er enthält `crm.sqlite` und die hochgeladenen Dateien.

## E-Mail-Versand einrichten

Einstellungen → E-Mail-Versand (SMTP), nur für Administratoren sichtbar. Für Microsoft 365 bzw. Outlook.com:

- Server `smtp.office365.com`, Port `587`, SSL/TLS **nicht** anhaken (STARTTLS läuft automatisch)
- Benutzer und Passwort eines Postfachs, z. B. `crm@landtechnik-bussmann.de`. Bei Microsoft 365 muss für dieses Postfach „SMTP AUTH“ im Admin-Center aktiviert sein.
- Absender: `Bussmann CRM <crm@landtechnik-bussmann.de>`

Mit „Testmail an mich senden“ lässt sich die Einrichtung prüfen.

## Kalender mit Outlook und iPhone verbinden

Unter Einstellungen steht für jeden Benutzer eine persönliche Abo-Adresse.

- **iPhone:** Die Seite auf dem iPhone öffnen und „Auf diesem Gerät abonnieren“ antippen. Alternativ: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.
- **Outlook (neu) und Web:** Kalender → Kalender hinzufügen → Aus dem Internet abonnieren.
- **Outlook klassisch:** Kalender → Kalender hinzufügen → Aus dem Internet…

Das Abo arbeitet **in eine Richtung**: Termine aus dem CRM erscheinen in Outlook und auf dem iPhone. Termine, die direkt in Outlook angelegt werden, kommen nicht ins CRM. Outlook aktualisiert abonnierte Kalender je nach Version alle paar Stunden, das iPhone je nach Einstellung alle 15 Minuten bis stündlich.

**Ausbaustufe Zwei-Wege-Abgleich:** Über die Microsoft-Graph-Schnittstelle lassen sich CRM-Termine sofort in den Outlook-Kalender jedes Mitarbeiters schreiben. Das iPhone sieht sie dann über das Exchange-Konto ebenfalls sofort. Voraussetzung sind Microsoft 365 und eine App-Registrierung in Azure/Entra ID.

## Tests

```bash
npm test
```

Der Test spielt die Kernabläufe gegen eine leere Test-Datenbank durch: Anlage, Besuch mit Folgeaufgabe für einen Kollegen, Benachrichtigung, Erinnerung, Infofeld, Änderungsprotokoll, Suche, Excel-Import mit Dubletten, iCal-Feed und Rechte.

## Aufbau

```
server.js          Webserver und Programmierschnittstelle
lib/db.js          Datenbank (SQLite, in Node.js eingebaut)
lib/logic.js       Besuchsintervalle, Erinnerungen, Benachrichtigungen
lib/ical.js        Kalender-Abo (iCal) für Outlook und iPhone
lib/importer.js    Excel-Import und -Export
lib/mail.js        E-Mail-Versand
public/            Oberfläche (HTML, CSS, JavaScript ohne Build-Schritt)
```
