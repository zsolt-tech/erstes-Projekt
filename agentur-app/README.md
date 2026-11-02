# Agentur-Verwaltung

Lokale Web-App zur Verwaltung von Kunden, Projekten und Aufgaben für Videoproduktion und Social-Media-Betreuung.
Läuft auf deinem Rechner unter `http://localhost:3000`, die Daten liegen in einer lokalen Datei.

Aktueller Stand: **Etappe 5**
- Etappe 1: Grundgerüst, Kunden, Einstellungen, Hell-/Dunkelmodus, tägliche Datensicherung
- Etappe 2: Projekte mit fünf Phasen, Kanban-Board und Liste, Checklisten mit Sperre, Drehtag, Freigaberunden, Veröffentlichungen, Fortschritt, Vorlagen je Kundentyp, Rechnungsstatus, Aufgaben
- Etappe 3: Google-Anmeldung, automatische Drive-Ordner für Kunden und Projekte, Verknüpfung bestehender Ordner, Erkennung fertiger Videos
- Etappe 4: Zwei-Wege-Abgleich mit Google Calendar, Kalenderansicht (Tag, Woche, Monat, Liste) mit farbigen Drehtagen, Deadlines, Freigabe-Fristen, Veröffentlichungen und Google-Terminen
- Etappe 5: Tägliches Briefing um 9:00 Uhr (Startseite, Desktop-Benachrichtigung, optional E-Mail), Freigabe-Erinnerungen, Engpass-Warnungen, Benachrichtigungszentrale
- Agenten und PDFs: Claude-Agenten für Videoschnitt und PDFs mit Anbindung an die App, Monatsbericht, Drehplan, Freigabe-Protokoll und Briefing als PDF

Weitere Dokumente:
- Architektur und Datenmodell: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)
- Google-Zugang einrichten (für Etappe 3): [docs/GOOGLE-EINRICHTUNG.md](docs/GOOGLE-EINRICHTUNG.md)
- Agenten und PDFs: [docs/AGENTEN.md](docs/AGENTEN.md)

---

## Einmalige Einrichtung

### 1. Node.js installieren

Node.js ist die Laufzeitumgebung, mit der die App läuft.

1. Öffne <https://nodejs.org/de> und lade die Version mit der Kennzeichnung **LTS** herunter.
2. Installiere sie mit den Standardeinstellungen (macOS: `.pkg`-Datei, Windows: `.msi`-Datei).
3. Prüfen: Öffne ein Terminal (macOS: Programm „Terminal“, Windows: „Eingabeaufforderung“ oder „Terminal“) und gib ein:

   ```
   node -v
   ```

   Es muss eine Versionsnummer ab `v22.13` erscheinen, zum Beispiel `v24.11.0`.

### 2. App herunterladen

Am einfachsten mit **GitHub Desktop** (kostenlos, <https://desktop.github.com>), weil du damit später neue Etappen mit einem Klick holst:

1. GitHub Desktop installieren und mit deinem GitHub-Konto anmelden.
2. „File“ > „Clone repository“ > `zsolt-tech/erstes-Projekt` auswählen, Speicherort wählen, „Clone“.
3. Oben bei „Current branch“ den Branch `claude/agentur-verwaltung` auswählen.
4. Später neue Etappen holen: „Fetch origin“ und danach „Pull origin“. Deine Daten bleiben dabei unberührt.

### 3. Abhängigkeiten installieren

Terminal im Ordner `agentur-app` öffnen:

- **macOS:** Im Terminal `cd ` eintippen (mit Leerzeichen), den Ordner `agentur-app` aus dem Finder ins Terminal ziehen, Enter.
- **Windows:** Den Ordner `agentur-app` im Explorer öffnen, in die Adresszeile `cmd` tippen, Enter.

Dann einmalig:

```
npm install
```

Das dauert beim ersten Mal ein bis zwei Minuten. Nach jedem Update auf eine neue Etappe einmal wiederholen.

---

## Starten und Beenden

```
npm start
```

- Beim ersten Start wird die Konfigurationsdatei `.env` angelegt, die Oberfläche gebaut (ca. 10 bis 30 Sekunden) und die Datenbank eingerichtet.
- Der Browser öffnet sich automatisch mit der App. Falls nicht: <http://localhost:3000>
- Läuft die App schon, öffnet `npm start` nur den Browser.
- **Beenden:** im Terminal `Strg + C` drücken.

Den automatischen Start beim Hochfahren des Rechners richten wir in Etappe 7 ein.

---

## Wo liegen meine Daten?

| Was | Wo |
|---|---|
| Datenbank | `agentur-app/data/agentur.sqlite` |
| Tägliche Sicherungen | `agentur-app/backups/` |
| Konfiguration und Zugangsdaten | `agentur-app/.env` |

Diese Ordner und die `.env` werden nie ins Git übertragen.

**Zweiter Sicherungsort (empfohlen):** Trage in der `.env` bei `BACKUP_EXTRA_DIR` einen Ordner ein, der mit iCloud, OneDrive oder Google Drive synchronisiert wird. Jede Sicherung wird dann zusätzlich dorthin kopiert. Beispiel macOS: `BACKUP_EXTRA_DIR=/Users/deinname/Library/Mobile Documents/com~apple~CloudDocs/Agentur-Backups`. Nach einer Änderung an der `.env` die App neu starten.

### Sicherung wiederherstellen

1. App beenden (`Strg + C`).
2. Vorhandene Sicherungen anzeigen:

   ```
   npm run restore
   ```

3. Gewünschte Sicherung zurückspielen, zum Beispiel:

   ```
   npm run restore -- agentur-2026-11-01_02-30-00.sqlite
   ```

   Der aktuelle Stand wird vorher automatisch als `data/vor-wiederherstellung-....sqlite` gesichert.

4. App wieder starten: `npm start`

---

## Etappe 1 testen

1. **Start:** `npm start` ausführen. Der Browser öffnet die Startseite mit Begrüßung und Kennzahlen.
2. **Einstellungen:** Links unten „Einstellungen“. Namen der Agentur eintragen und speichern; er erscheint oben in der Seitenleiste.
3. **Kunde anlegen:** „Kunden“ > „Neuer Kunde“.
   - Erst ohne Firmenname auf „Kunde anlegen“ klicken: Das Feld wird rot markiert („Firmenname fehlt“).
   - Firmenname, Branche, Kundentyp, Adresse und Website ausfüllen (die Website ohne `https://` eingeben, das wird ergänzt).
   - Zwei Ansprechpartner erfassen, beim zweiten den Stern anklicken: Er wird Hauptkontakt.
   - Einen Social-Media-Kanal und unter „Gebuchtes Paket“ zum Beispiel 4 Reels pro Monat für 890,00 Euro eintragen.
   - Speichern. Die Detailseite zeigt „Paketverbrauch“ mit „0 von 4“. Gezählt wird ab Etappe 2, sobald Projekte angelegt werden. Mit den Pfeilen wechselst du den Monat.
4. **Bearbeiten:** „Bearbeiten“, etwas ändern, speichern. Einen Ansprechpartner entfernen und prüfen, dass er verschwunden ist.
5. **Interessent:** Neuen Kunden mit Status „Interessent“ anlegen. Es erscheinen die Felder Akquise-Stufe, Nächster Kontakt und Quelle. Später den Status auf „Aktiver Kunde“ ändern: Das ist die Umwandlung in einen Kunden.
6. **Suche und Filter:** In der Kundenliste nach einem Ansprechpartner oder Ort suchen, Statusfilter ausprobieren.
7. **Archivieren:** Auf einer Detailseite „Archivieren“. Der Kunde verschwindet aus der Liste, erscheint unter „Archiv anzeigen“ und lässt sich dort wiederherstellen.
8. **Live-Aktualisierung:** Die App in zwei Browser-Tabs öffnen. Im einen Tab einen Kunden ändern: Der andere Tab zeigt die Änderung ohne Neuladen.
9. **Hell/Dunkel:** Links unten „Darstellung“ anklicken (Wie System, Hell, Dunkel).
10. **Datensicherung:** Einstellungen > Datensicherung > „Jetzt sichern“. Die Datei erscheint in der Liste und im Ordner `backups`. Kurz nach jedem Start prüft die App, ob die Tagessicherung fällig ist, und legt sie bei Bedarf an.
11. **Wiederherstellen:** App beenden, `npm run restore` und danach eine der Dateien wie oben beschrieben zurückspielen.

---

## Etappe 2 testen

Nach dem Update auf Etappe 2 einmal `npm install` ausführen (neues Paket für Drag-and-Drop), dann `npm start`.

1. **Projekt anlegen:** Auf einer Kundenseite „Neues Projekt“ (oder Projekte > „Neues Projekt“).
   - Die Vorlage passt sich dem Kundentyp an (z. B. „Restaurant / Gastronomie“ mit Food-Shotlist). Darunter steht, wie viele Checklistenpunkte sie mitbringt.
   - Leistung und Anzahl kommen aus der Vorlage. Der Leistungsmonat folgt dem Drehdatum.
   - Titel leer lassen: Die App schlägt „Reel · November 2026“ vor.
   - Drehdatum, Uhrzeit und Ort eintragen und anlegen. Die Fälligkeiten aller Phasen werden aus dem Drehdatum berechnet.
2. **Phase Drehtag:** Auf der Projektseite stehen Drehtag-Details sowie drei Listen: Checkliste, Equipment, Shotlist. Punkte abhaken, eigene ergänzen, umbenennen und löschen (Stift- und Papierkorb-Symbol erscheinen beim Darüberfahren). Der Fortschritt steigt anteilig.
3. **Kanban-Board:** Projekte > Board. Eine Karte von „Drehtag“ nach „Bearbeitung“ ziehen. Ein Hinweis bestätigt die Verschiebung.
4. **Sperre Clip-Qualitätsprüfung:** Dieselbe Karte nach „Upload“ ziehen. Die App lehnt ab und nennt den Grund. Die Karte zeigt „QS offen“. Auf der Projektseite „Clip-Qualitätsprüfung abgeschlossen“ abhaken: Jetzt geht „Weiter zu Upload“.
5. **Freigabe:** Projekt in „Freigabe“ schieben. Eine Freigaberunde startet mit dem heutigen Datum. Das Anfragedatum kannst du ändern; die Wartezeit erscheint auf der Karte („wartet 4 Tage“).
   - „Korrektur nötig“: Rückmeldung eintragen. Das Projekt geht zurück in die Bearbeitung, der Zähler steigt, die Qualitätsprüfung muss erneut abgehakt werden.
   - „Kunde hat freigegeben“: Das Projekt rückt in die Veröffentlichung.
6. **Veröffentlichung:** Plattform und Datum planen. Sobald für alle geplanten Veröffentlichungen ein Link eingetragen ist, wird das Projekt automatisch abgeschlossen (100 %). „Wieder öffnen“ macht das rückgängig.
7. **Paketverbrauch:** Auf der Kundenseite zählt „Paketverbrauch“ jetzt die Projekte des Leistungsmonats, zum Beispiel „4 von 4“. Ein auf „Abgebrochen“ gesetztes Projekt zählt nicht mehr.
8. **Rechnung:** Auf der Projektseite Status „Gestellt“ wählen, Nummer und Betrag eintragen. Das Datum wird automatisch gesetzt. In der Projektliste erscheint der Rechnungsstatus.
9. **Aufgaben:** Unter „Aufgaben“, auf Kundenseiten und auf Projektseiten Aufgaben erfassen. Die Übersicht gruppiert nach Überfällig, Heute, Nächste 7 Tage, Später. Klick auf den Titel öffnet die Bearbeitung.
10. **Liste:** Projekte > Liste zeigt auch abgeschlossene und abgebrochene Projekte.

Die mitgelieferten Vorlagen (Standard, Restaurant, Handwerk, Arztpraxis, Fahrschule) lassen sich ab Etappe 7 in der App bearbeiten. Bis dahin passt du Checklisten direkt im Projekt an.

---

## Etappe 3 testen (Google Drive)

Voraussetzung: Google-Zugang nach [docs/GOOGLE-EINRICHTUNG.md](docs/GOOGLE-EINRICHTUNG.md) eingerichtet (Schritte 1 bis 4).

1. **Verbinden:** Einstellungen > Google-Verbindung > „JSON-Datei auswählen“ (Datei von Google), dann „Mit Google verbinden“. Nach der Anmeldung steht dort „Verbunden mit …“.
2. **Ordnerstruktur prüfen:** Einstellungen > Drive-Ordnerstruktur. Vorgabe: Stammordner „Kunden“, je Kunde „Scripts“ und „Sonstiges“, je Projekt „01 Rohmaterial“, „02 Entwürfe“, „03 Fertige Videos“, „04 Freigabe“. Die Vorschau zeigt den Pfad. Änderungen gelten für neu angelegte Ordner.
3. **Neuer Kunde:** Einen Testkunden mit Status „Aktiver Kunde“ anlegen. Auf der Kundenseite zeigt „Google Drive“ kurz „Ordner wird angelegt …“ und dann den Ordner. Klick öffnet ihn in Drive: `Kunden / Testkunde` mit `Scripts` und `Sonstiges`.
4. **Interessent:** Einen Interessenten anlegen. Es entsteht kein Ordner. Status auf „Aktiver Kunde“ ändern: Jetzt wird der Ordner angelegt.
5. **Neues Projekt:** Für den Testkunden ein Projekt anlegen. In Drive erscheint `Kunden / Testkunde / 2026 / 2026-11 Projekttitel` mit den vier Unterordnern. Auf der Projektseite stehen die Ordner unter Phase 3 „Upload“.
6. **Upload-Erkennung:** Eine beliebige Datei in Drive in „03 Fertige Videos“ legen. Auf der Projektseite (Phase Upload) „Jetzt prüfen“: Die Datei erscheint, und „Dateien im Ordner Fertige Videos“ ist abgehakt. Ohne Klick passiert das automatisch innerhalb von 15 Minuten.
7. **Bestandskunde verknüpfen:** Für einen bestehenden Kunden auf der Kundenseite „Bestehenden verknüpfen“ wählen und den Link des vorhandenen Kundenordners aus der Browserzeile von Drive einfügen. Es wird kein neuer Ordner angelegt. Für ein laufendes Projekt auf der Projektseite (Phase Upload) „Bestehenden Ordner verknüpfen“: Unterordner wie „Rohmaterial“, „Entwürfe“ und „Fertige Videos“ werden erkannt, auch ohne Nummern.
8. **Ohne Internet:** WLAN aus, Kunden anlegen. Der Ordner zeigt „wird angelegt“, unter Einstellungen > Google-Aufträge steht der Auftrag. WLAN an: Der Ordner wird nachgeholt (spätestens nach 1 bis 5 Minuten, sonst „Jetzt erneut“).

Die App legt in Drive nur Ordner an. Sie verschiebt, ändert und löscht nichts. „Verknüpfung lösen“ entfernt nur die Zuordnung in der App.

Bestehende Kunden und Projekte aus der Zeit vor der Google-Verbindung bekommen nicht automatisch Ordner, damit keine Doppelungen zu deinen vorhandenen Ordnern entstehen. Dort wählst du jeweils „Ordner anlegen“ oder „Bestehenden verknüpfen“.

---

## Etappe 4 testen (Google Calendar)

Voraussetzung: Google ist verbunden (Etappe 3). Eine neue Anmeldung ist nicht nötig, die Kalender-Berechtigung war schon dabei.

1. **Einstellungen > Google Calendar:** „Drehtage eintragen in“ zeigt deinen Hauptkalender. Unter „Termine aus diesen Kalendern in der App anzeigen“ wählst du, welche Google-Kalender in der App erscheinen. Optional lassen sich auch Freigabe-Fristen und geplante Veröffentlichungen in Google eintragen.
2. **Drehtag eintragen:** Ein Projekt mit Drehdatum, Uhrzeit und Ort anlegen oder auf der Projektseite (Phase Drehtag) speichern. Nach wenigen Sekunden steht dort „In Google Calendar eingetragen“ mit Link. Der Google-Termin heißt „Drehtag: Kunde – Projekt“, ist blau und enthält Ort, Shotlist und einen Link zur App.
3. **In der App ändern:** Uhrzeit des Drehtags ändern und speichern. Der Google-Termin wird angepasst, es entsteht kein zweiter.
4. **In Google ändern:** Den Termin in Google Calendar auf einen anderen Tag oder eine andere Uhrzeit ziehen oder den Ort ändern. Spätestens nach 5 Minuten (oder sofort mit „Jetzt abgleichen“ auf der Kalenderseite) zeigt die Projektseite das neue Datum.
5. **In Google löschen:** Den Termin in Google löschen und abgleichen. Das Projekt bleibt, auf der Projektseite erscheint „Der Termin wurde in Google Calendar gelöscht“ mit „Erneut eintragen“.
6. **Kalenderansicht:** Links „Kalender“. Oben umschalten zwischen Tag, Woche, Monat und Liste. Farben: Drehtage blau, Deadlines und Aufgaben orange, Freigabe-Fristen violett, Veröffentlichungen grün, Google-Termine grau. Die Schaltflächen darüber blenden Arten ein und aus.
7. **Verschieben:** Einen Drehtag, eine Deadline, Aufgabe oder Veröffentlichung im Kalender auf einen anderen Tag ziehen. Die Änderung steht sofort im Projekt und geht beim nächsten Abgleich an Google. Ein Klick auf einen Eintrag öffnet das Projekt; Google-Termine öffnen sich in Google Calendar.
8. **Kundenseite:** „Termine der nächsten 60 Tage“ listet alle Einträge des Kunden.

Hinweise:
- Der Abgleich läuft alle 5 Minuten und nach jeder Änderung in der App. Google meldet Änderungen nicht von sich aus an einen lokalen Rechner, daher diese kurze Verzögerung.
- Ändern sich ein Termin in Google und derselbe Drehtag in der App gleichzeitig, gewinnt die jüngere Änderung.
- Vergangene Drehtage, die länger als 60 Tage zurückliegen, werden weder eingetragen noch verändert.

---

## Etappe 5 testen (Briefing und Erinnerungen)

1. **Startseite:** Vor 9:00 Uhr zeigt sie eine Vorschau des Briefings mit dem aktuellen Stand, danach das Briefing des Tages. Oben steht eine Zusammenfassung in einem Satz, darunter: Termine heute (auch aus Google), fällige und überfällige Aufgaben und Phasen, Projekte, die auf Freigabe warten (mit Wartezeit und „nachfassen“), Drehtage der nächsten 7 Tage, Paketverbrauch und Warnungen. Ein Klick auf einen Eintrag öffnet ihn.
2. **Briefing sofort testen:** Auf der Startseite „Erzeugen und senden“ (oder Einstellungen > Briefing und Benachrichtigungen > „Briefing jetzt testen“).
   - **macOS:** Beim ersten Mal fragt macOS, ob „Skripteditor“ Mitteilungen senden darf. Bitte erlauben; darüber kommen die Desktop-Hinweise der App. Falls nichts erscheint: Systemeinstellungen > Mitteilungen > Skripteditor > Mitteilungen erlauben.
   - **Windows:** Der Hinweis erscheint unten rechts als Windows-Benachrichtigung von „Windows PowerShell“.
   - Links unten bei **Benachrichtigungen** steht ein Zähler; dort sind alle Hinweise gesammelt.
3. **E-Mail:** Einstellungen > Briefing und Benachrichtigungen > „Briefing zusätzlich per E-Mail“ anhaken (Google muss verbunden sein), optional eine andere Adresse eintragen, speichern, „Briefing jetzt testen“. Die E-Mail kommt von deinem eigenen Google-Konto.
4. **Uhrzeit:** Die Uhrzeit des Briefings ist einstellbar. War der Rechner um diese Zeit aus oder im Ruhezustand, erscheint das Briefing kurz nach dem Start bzw. Aufwachen.
5. **Freigabe-Erinnerung:** Ein Projekt in die Freigabe schieben und auf der Projektseite das Anfragedatum auf vor 4 Tagen setzen. Innerhalb einer Stunde (zwischen 9 und 19 Uhr) kommt „Freigabe nachfassen: …“ als Desktop-Hinweis und in den Benachrichtigungen, mit dem Namen des Ansprechpartners. Danach erst wieder nach Ablauf der Frist.
6. **Nachfassen per E-Mail:** In der Freigabe-Phase eines Projekts öffnet „Nachfassen per E-Mail“ dein E-Mail-Programm mit einer vorformulierten Nachricht an den Ansprechpartner. Der Text ist in Sie-Form und lässt sich vor dem Senden anpassen.
7. **Browser-Benachrichtigungen (optional):** In den Einstellungen „Browser-Benachrichtigungen auf diesem Rechner“ anhaken und im Browser erlauben. Dann erscheinen Hinweise zusätzlich als Browser-Meldung, solange die App in einem Tab offen ist.
8. **Engpass-Schwellen:** Einstellungen > Engpass-Erkennung. Dort legst du fest, ab wann eine Warnung erscheint (z. B. länger als 5 Tage in Bearbeitung, mehr als 3 Drehtage in 7 Tagen).

---

## Agenten und PDFs testen

Nach dem Update einmal `npm install` (neues Paket für PDFs), dann `npm start`. Ausführlich: [docs/AGENTEN.md](docs/AGENTEN.md).

1. **Kunde bearbeiten > Videoschnitt:** Prüfprofil (automatisch oder fest), „Durchgehende Kamerabewegung Pflicht“ und Hinweise für den Schnitt speichern. Die Kundenseite zeigt sie im Bereich „Videoschnitt“.
2. **Auftrag an Claude:** Projekt in der Phase Bearbeitung öffnen, „Schnitt und Endkontrolle“. Ein Fenster zeigt den vorbereiteten Auftrag; „Kopieren“, dann in Claude Desktop (Code, Ordner agentur-app) einfügen.
3. **Rückmeldung:** Nach der Endkontrolle erscheint das Ergebnis im Projekt. Sind alle Videos bestanden, ist „Clip-Qualitätsprüfung abgeschlossen“ automatisch abgehakt.
4. **PDFs:** Kundenseite > Paketverbrauch > „Monatsbericht“; Projektseite > Dokumente > Drehplan und Freigabe-Protokoll; Startseite > Briefing > „PDF“.

---

## Für Entwickler

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklung mit automatischem Neuladen (Oberfläche unter <http://localhost:5173>) |
| `npm test` | Server-Tests (Node-Testrunner) |
| `npm run typecheck` | TypeScript-Prüfung von Server und Oberfläche |
| `npm run build` | Oberfläche bauen |

Technik: Node.js (ab 22.13) mit Express, eingebautes SQLite (`node:sqlite`), React mit Vite und Tailwind CSS, TanStack Query, Live-Updates per Server-Sent Events.
