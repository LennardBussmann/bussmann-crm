# Bussmann CRM auf dem Mini-PC im Büro

Mit dieser Anleitung zieht das CRM vom Hetzner-Server auf euren Windows-Mini-PC im Büro um. Die Adresse bleibt **crm.bussmann-maschinen.de**. Für alle Mitarbeiter ändert sich nichts: gleiche Adresse, gleiche Anmeldung, gleiche App auf dem Handy.

**Zeitbedarf:** etwa 1 Stunde, verteilt auf zwei Termine (Probebetrieb und Umzug).

**Was der Mini-PC danach von allein macht:**
- Er startet das CRM nach jedem Neustart automatisch, auch ohne dass jemand angemeldet ist.
- Er holt neue Versionen alle 10 Minuten von selbst, so wie jetzt auf dem Server.
- Er macht jede Nacht um 3 Uhr eine Datensicherung und hebt sie 30 Tage auf.
- Er meldet Strato, wenn sich die Internet-Adresse des Büros ändert.

---

## Teil 1: Vorbereitung (einmalig, ca. 15 Minuten)

### 1.1 Router prüfen: Hat das Büro eine „echte“ IPv4-Adresse?
In der FRITZ!Box unter **Internet → Online-Monitor** nachsehen.
- Steht dort eine normale IPv4-Adresse (z. B. `87.123.45.67`), passt alles.
- Steht dort **„DS-Lite“** oder eine Adresse, die mit `100.` beginnt, ist der PC von außen so nicht erreichbar. In dem Fall bitte kurz melden, dafür gibt es eine andere Lösung.

### 1.2 Bei Strato eine Test-Adresse mit DynDNS anlegen
1. Im Strato-Kundenlogin unter **Domains → Domainverwaltung** bei *bussmann-maschinen.de* eine Subdomain **crm-neu** anlegen.
2. Bei der Subdomain *crm-neu* das Zahnrad (Einstellungen) öffnen, dann **DNS → DynDNS** einschalten und ein **DynDNS-Passwort** festlegen. Das Passwort notieren, es wird bei der Installation abgefragt.

> Die richtige Adresse **crm**.bussmann-maschinen.de bleibt vorerst unverändert und zeigt weiter auf den Hetzner-Server. Sie wird erst beim Umzug in Teil 4 umgestellt.

### 1.3 Mini-PC vorbereiten
- Das Gerät mit **Netzwerkkabel** am Router anschließen (stabiler als WLAN).
- Im BIOS bzw. in den Energieoptionen „Nach Stromausfall wieder einschalten“ aktivieren, falls vorhanden. Der Installer schaltet den Energiesparmodus von Windows selbst ab.

---

## Teil 2: Installation (ca. 15 Minuten)

1. Die Datei **BussmannCRM-Windows.zip** auf den Mini-PC kopieren.
2. Rechtsklick → **Alle extrahieren** (wichtig: erst entpacken, nicht direkt aus der ZIP-Datei starten).
3. Im entpackten Ordner **Installieren.bat** doppelklicken und die Frage nach Administrator-Rechten mit **Ja** beantworten.
   *Falls Windows „Der Computer wurde durch Windows geschützt“ meldet: auf **Weitere Informationen → Trotzdem ausführen** klicken.*
4. Die Fragen beantworten. Die Vorschläge in [Klammern] kann man meist mit **Enter** übernehmen:
   - Adresse des CRM: `crm.bussmann-maschinen.de`
   - Test-Adresse: `crm-neu.bussmann-maschinen.de`
   - DynDNS-Benutzername: `bussmann-maschinen.de`
   - DynDNS-Passwort: das Passwort aus Schritt 1.2
   - Zweite Sicherungskopie: z. B. ein USB-Stick, der dauerhaft steckt (`E:\CRM-Sicherung`), oder ein NAS-Ordner. Sehr empfohlen!
5. Am Ende zeigt das Fenster **„Fertig!“** und die Adresse des PCs im Netzwerk an (z. B. `192.168.178.50`). Diese Adresse notieren.

### Router einstellen (FRITZ!Box)
1. **Heimnetz → Netzwerk** → beim Mini-PC auf den Stift klicken → **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** anhaken.
2. **Internet → Freigaben → Portfreigaben → Gerät für Freigaben hinzufügen** → Mini-PC auswählen → **Neue Freigabe → Portfreigabe**:
   - **HTTP-Server** (Port 80) und
   - **HTTPS-Server** (Port 443) anlegen.
3. Den Mini-PC einmal **neu starten**. Danach holt er sich automatisch das Sicherheitszertifikat.

Nach etwa 5 Minuten sollte **https://crm-neu.bussmann-maschinen.de** eine (noch leere) Anmeldeseite zeigen.

---

## Teil 3: Probebetrieb mit echten Daten

1. Im entpackten Ordner **Daten-uebernehmen.bat** doppelklicken.
2. Adresse des alten Servers: Enter (`91.99.146.99`).
3. **1 = Probelauf** wählen.
4. Zweimal das **root-Passwort des Hetzner-Servers** eingeben. Das ist das Passwort, mit dem auch die Server-Installation gemacht wurde. Bei der ersten Verbindung kann eine Frage „Are you sure…“ kommen, dann `yes` eingeben.

Jetzt unter **https://crm-neu.bussmann-maschinen.de** anmelden (gleiche Zugangsdaten wie immer) und in Ruhe testen: Kunden, Aufgaben, Angebote, Fotos, Karte, auch vom Handy aus.

> ⚠️ Im Probebetrieb **nicht richtig arbeiten**. Alles, was ihr hier ändert, wird beim Umzug überschrieben. Gearbeitet wird weiter ganz normal unter crm.bussmann-maschinen.de.

Den Probelauf kann man beliebig oft wiederholen.

---

## Teil 4: Der eigentliche Umzug (ca. 15 Minuten)

Am besten abends oder morgens, wenn niemand im CRM arbeitet.

1. Bei Strato bei der Subdomain **crm** (nicht crm-neu) genauso wie in Schritt 1.2 **DynDNS einschalten**, mit **demselben Passwort**.
2. **Daten-uebernehmen.bat** doppelklicken → **2 = Endgültiger Umzug** → `ja`.
   Dabei wird der alte Server angehalten, damit dort niemand mehr etwas einträgt. Danach kommen die aktuellen Daten auf den Mini-PC und Strato bekommt die neue Adresse.
3. Nach **5 bis 30 Minuten** zeigt **https://crm.bussmann-maschinen.de** auf den Mini-PC. Bis dahin kann das CRM kurz nicht erreichbar sein.
4. Prüfen: anmelden, ein paar Kunden öffnen, die Maschinenbörse auf der Homepage ansehen.

**Den Hetzner-Server erst nach ein paar Tagen ohne Probleme kündigen.** Bis dahin ist er der Rückweg: Falls etwas nicht klappt, einfach melden, dann wird er in wenigen Minuten wieder eingeschaltet.

---

## Teil 5: Das CRM als App auf iPhone und iPad

Das funktioniert genau wie bisher, weil die Adresse gleich bleibt. Wer die App schon auf dem Home-Bildschirm hat, muss **nichts tun**.

**Neu einrichten auf iPhone oder iPad:**
1. **Safari** öffnen (wichtig: nicht Chrome oder eine andere App) und **crm.bussmann-maschinen.de** aufrufen.
2. Unten (auf dem iPad oben rechts) auf das **Teilen-Symbol** tippen, das Quadrat mit dem Pfeil nach oben.
3. Etwas nach unten scrollen und **„Zum Home-Bildschirm“** antippen.
4. Den Namen bei Bedarf anpassen (z. B. „CRM“) und **Hinzufügen** tippen.

Das CRM-Symbol liegt jetzt auf dem Home-Bildschirm und öffnet sich wie eine App im Vollbild, ohne Adressleiste. Einmal anmelden, danach bleibt man angemeldet.

**Android:** In Chrome die Adresse öffnen → Menü **⋮** → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.

**Windows-PCs im Büro:** Im CRM unter *Einstellungen* gibt es eine Desktop-Verknüpfung zum Herunterladen. Oder einfach die Adresse im Browser als Favorit speichern.

---

## Gut zu wissen

| Was | Wo |
|---|---|
| Programm und Daten | `C:\BussmannCRM` (den Ordner **nicht** löschen oder verschieben) |
| Datensicherungen | `C:\BussmannCRM\backups` und der zweite Ordner aus der Installation |
| Sofort eine Sicherung machen | **Jetzt-sichern.bat** im entpackten Ordner |
| Protokolle bei Problemen | `C:\BussmannCRM\logs` |
| Automatische Aufgaben | Windows-Aufgabenplanung → Ordner **Bussmann** |

**Wichtig:**
- Den Mini-PC **nicht ausschalten**. Neustarts (z. B. durch Windows-Updates) sind kein Problem, das CRM startet danach von selbst wieder.
- Bei einem Strom- oder Internetausfall im Büro ist das CRM von außen nicht erreichbar, bis alles wieder läuft. Danach geht es automatisch weiter.
- Den USB-Stick mit der zweiten Sicherung ab und zu tauschen und einen davon außer Haus aufbewahren (Brand, Diebstahl).
- Die ZIP-Datei bzw. den entpackten Ordner aufheben, damit **Daten-uebernehmen.bat** und **Jetzt-sichern.bat** griffbereit sind. Alternativ liegen beide auch unter `C:\BussmannCRM\scripts`.
