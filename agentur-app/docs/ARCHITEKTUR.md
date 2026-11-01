# Agentur-Verwaltung: Architekturübersicht

Stand: bestätigt, Umsetzung läuft in Etappen. Das vollständige Datenbankschema liegt in `server/db/migrations/001_init.sql`.

Rahmen: Einzelnutzer (Inhaber arbeitet allein), App liegt im Ordner `agentur-app/` auf dem Branch `claude/agentur-verwaltung`.

## 1. Technik-Stack und Begründung

| Baustein | Wahl | Warum |
|---|---|---|
| Server | Node.js 22 LTS + Express, TypeScript | Die App braucht einen dauerhaft laufenden Prozess mit Zeitplaner (Briefing 9:00, Backups, Sync alle 5 Minuten, Desktop-Benachrichtigungen). Express ist genau das: ein schlichter, langlebiger Prozess. Next.js ist auf Web-Hosting und Serverless ausgelegt, Hintergrund-Jobs passen dort schlecht hinein. |
| Datenbank | SQLite, in Node.js eingebaut (`node:sqlite`) | Eine einzige Datei, kein Datenbankserver, sehr schnell. Gegenüber dem Zusatzpaket `better-sqlite3` muss bei der Installation nichts kompiliert werden; das vermeidet die häufigsten Installationsprobleme unter Windows und macOS. Voraussetzung: Node.js ab 22.13. |
| Oberfläche | React 18 + Vite, Tailwind CSS | Schnelle, saubere Oberfläche, Hell-/Dunkelmodus über CSS-Klassen. |
| Datenabruf | TanStack Query | Zwischenspeicher im Browser, automatische Aktualisierung nach Änderungen. |
| Kanban | dnd-kit | Drag-and-Drop, auch per Tastatur bedienbar. |
| Kalender | FullCalendar (freie MIT-Module), deutsche Lokalisierung | Tag-, Wochen- und Monatsansicht, Termine verschiebbar. |
| Live-Updates | Server-Sent Events (SSE) | Der Server meldet Änderungen, Dashboard und Listen aktualisieren sich ohne Neuladen. Einfacher als WebSockets, Einweg-Kommunikation genügt. |
| Zeitplaner | eigener Minuten-Takt, Zeitzone Europe/Berlin | Prüft jede Minute, welche Aufgaben fällig sind. Dadurch werden verpasste Läufe automatisch nachgeholt, wenn der Rechner aus war oder geschlafen hat. |
| Google | offizielle `googleapis`-Bibliothek, OAuth 2.0 | Drive, Calendar, Gmail (für den E-Mail-Versand des Briefings). |
| Benachrichtigungen | node-notifier | Native Desktop-Hinweise unter macOS und Windows, Klick öffnet die App. |
| Export | PDFKit (PDF), CSV mit Semikolon und UTF-8-BOM | CSV öffnet sich in deutschem Excel ohne Umlaut- und Spaltenfehler. |
| Validierung | zod | Gemeinsame Prüfregeln für Formulare und Server. |
| Datum/Zeit | `Intl`-Funktionen von JavaScript, Zeitzone Europe/Berlin | Korrekte Sommer-/Winterzeit, deutsche Formate, ohne Zusatzpaket. |

Kein Login: Der Server lauscht ausschließlich auf `127.0.0.1` und ist damit nur vom eigenen Rechner erreichbar.

## 2. Aufbau

```
Browser  http://localhost:3000
  React-Oberfläche: Start/Briefing, Dashboard, Kunden, Akquise, Projekte (Kanban/Liste),
  Aufgaben, Kalender, Zeiterfassung, Berichte, Einstellungen, globale Suche (Strg/Cmd+K)
        |  REST-API /api/*                      ^  Live-Ereignisse /api/events (SSE)
        v                                       |
Node.js-Server (ein einziger Prozess)
  ├─ API-Routen        Kunden, Projekte, Phasen, Aufgaben, Kalender, Suche, Zeiten, Export
  ├─ Fachlogik         Phasenregeln, Fortschritt, Paketverbrauch, Engpässe, Briefing-Text
  ├─ Zeitplaner        Briefing, Backup, Erinnerungen, Wiederholungen, Google-Sync
  ├─ Google-Dienste    OAuth, Drive, Calendar, Gmail
  ├─ Warteschlange     Google-Aktionen werden bei fehlendem Internet später nachgeholt
  └─ Benachrichtigung  Desktop-Hinweise
        |
SQLite  data/agentur.sqlite   ──>  tägliche Kopie in backups/ (optional zweiter Ordner)
        |
Google APIs (HTTPS)
```

### Ordnerstruktur des Projekts

```
agentur-app/
  package.json            ein Paket, Start mit "npm start"
  .env.example            Vorlage für Zugangsdaten (die echte .env wird nie eingecheckt)
  server/
    index.ts              Start
    app.ts                Express-Anwendung, Auslieferung der Oberfläche
    db/                   Verbindung, Migrationen, Startdaten (Vorlagen, Leistungsarten)
    routes/               REST-Endpunkte
    services/             Fachlogik und Google-Anbindung
    jobs/                 Zeitplaner
  shared/                 Prüfregeln, Typen und deutsche Bezeichnungen für Server und Oberfläche
  client/src/
    pages/ components/ api/ lib/
  tests/                  automatische Tests
  scripts/                Start, Backup-Wiederherstellung, Autostart macOS/Windows
  data/                   Datenbank (nicht im Git)
  backups/                Backups (nicht im Git)
  docs/                   Anleitungen
```

### Start

- Einmalig: `npm install`
- Danach immer: `npm start` baut die Oberfläche falls nötig, führt Datenbank-Migrationen aus, startet den Server und öffnet den Browser.
- Für die Entwicklung: `npm run dev` mit automatischem Neuladen.

### .env (Zugangsdaten)

```
PORT=3000
APP_SECRET=            # wird beim ersten Start automatisch erzeugt, verschlüsselt die Google-Tokens
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
BACKUP_DIR=./backups
BACKUP_EXTRA_DIR=      # optional, z. B. ein Ordner, der in die Cloud synchronisiert wird
BACKUP_KEEP_DAYS=30
```

Alle anderen Einstellungen (Erinnerungsfristen, Schwellenwerte, Drive-Ordnernamen, Briefing-Empfänger) werden in der App unter Einstellungen gepflegt.

## 3. Zeitgesteuerte Jobs

| Wann | Was |
|---|---|
| täglich 09:00 | Briefing erzeugen, Desktop-Benachrichtigung, optional E-Mail |
| jede Minute | Nachhol-Prüfung: Ist es nach 9:00 und gibt es noch kein Briefing für heute, wird es sofort erzeugt (Rechner war aus oder im Ruhezustand) |
| täglich ab 02:30, sonst kurz nach dem Start | Datenbank-Backup (ein Stand pro Tag, spätestens nach 24 h), Aufbewahrung 30 Tagesstände und 12 Monatsstände |
| täglich 06:00 und beim Start | Wiederkehrende Projekte und Aufgaben anlegen |
| stündlich | Freigabe-Erinnerungen, Engpass-Prüfung |
| alle 5 Minuten | Google-Calendar-Sync in beide Richtungen |
| alle 15 Minuten | Drive: Final-Ordner aktiver Upload-Projekte prüfen |
| jede Minute | Warteschlange für Google-Aktionen abarbeiten |

## 4. Google-Anbindung

**Berechtigungen (Scopes):** Drive (vollständig, damit die App auch Dateien sieht, die du selbst in den Final-Ordner hochlädst), Calendar (Termine lesen und schreiben), Gmail nur Senden (für das Briefing per E-Mail). Die Tokens liegen verschlüsselt in der lokalen Datenbank.

**Drive-Ordnerstruktur** (an deine bisherige Ablage angelehnt, Namen in den Einstellungen änderbar):

```
Kunden/                              Stammordner für neue Kunden, frei wählbar
  Hamacher/                          beim Anlegen des Kunden
    Scripts/                         Kundenebene, wie bisher
    Sonstiges/                       Kundenebene, wie bisher
    2026/                            beim ersten Projekt des Jahres
      2026-11 Reels November/        beim Anlegen des Projekts
        01 Rohmaterial
        02 Entwürfe                  (= Schnitt)
        03 Fertige Videos            (= Final, wird für die Upload-Erkennung geprüft)
        04 Freigabe
```

- Bestandsaufnahme vom 01.11.2026: Deine Kundenordner liegen direkt in „Meine Ablage“ und enthalten meist Rohmaterial, Entwürfe, Fertige Videos, Scripts und Sonstiges. Die Standardnamen übernehmen diese Begriffe; die Nummern halten die Reihenfolge der Phasen.
- Bestehende Kunden: Statt einen neuen Ordner anzulegen, kann ein vorhandener Drive-Ordner per Link verknüpft werden. Die App verschiebt und löscht nichts.
- Interessenten bekommen erst bei der Umwandlung in einen Kunden einen Ordner, damit Drive nicht mit Absagen zugemüllt wird.
- Ohne Internet oder ohne Google-Verbindung funktioniert die App vollständig weiter; die Ordner werden über die Warteschlange angelegt, sobald die Verbindung steht.
- Final-Erkennung: Die App zählt die Dateien in `03 Fertige Videos`. Liegt dort mindestens eine Datei, wird der Checkpunkt "Dateien im Final-Ordner" automatisch abgehakt. Zusätzlich gibt es einen Knopf "Jetzt prüfen".

**Kalender, Zwei-Wege-Sync:**

- App nach Google: Drehtage werden automatisch als Termin eingetragen (mit Ort, Shotlist-Auszug und Link zum Projekt). Optional per Einstellung auch Freigabe-Fristen und Veröffentlichungen als ganztägige Termine.
- Google nach App: Alle Termine der ausgewählten Kalender erscheinen in der App und im Briefing. Wird ein App-Termin in Google verschoben, übernimmt die App Datum, Uhrzeit und Ort in den Drehtag. Wird er in Google gelöscht, bleibt das Projekt erhalten und zeigt einen Hinweis.
- Technik: inkrementeller Abgleich mit Sync-Token alle 5 Minuten. Echte Push-Benachrichtigungen von Google setzen eine öffentlich erreichbare Adresse voraus, die ein lokaler Rechner nicht hat; 5 Minuten Verzögerung sind der Kompromiss.
- Bei gleichzeitiger Änderung auf beiden Seiten gewinnt die jüngere Änderung.

Die Schritt-für-Schritt-Anleitung zur Einrichtung der Google-Zugangsdaten kommt mit Etappe 3.

## 5. Fachliche Regeln

**Phasen:** 1 Drehtag, 2 Bearbeitung, 3 Upload, 4 Freigabe, 5 Veröffentlichung.

- Vorwärts per Drag-and-Drop oder Knopf. Überspringen ist erlaubt, übersprungene Phasen gelten dann als erledigt.
- Sperre: Solange "Clip-Qualitätsprüfung abgeschlossen" in Phase 2 nicht abgehakt ist, lehnt der Server jedes Weiterrücken über Phase 2 hinaus ab. Der Checkpunkt ist Systembestandteil jedes Projekts und nicht löschbar. Das Prinzip ist allgemein gebaut: Jeder Checklistenpunkt kann als Sperrpunkt markiert werden.
- Zurückschieben ist jederzeit möglich und wird mit Grund protokolliert.
- Eintritt in Phase 4 öffnet automatisch eine Freigaberunde mit Anfragedatum heute (änderbar).
- "Korrektur nötig" zählt die Korrekturschleife hoch, schiebt das Projekt (nach Rückfrage) zurück in Bearbeitung und setzt die Clip-Qualitätsprüfung zurück, damit die korrigierte Fassung erneut geprüft wird.
- Abschluss: wenn alle geplanten Veröffentlichungen einen Link haben, oder per Knopf "Abschließen".

**Fortschritt in Prozent:** Jede Phase zählt 20 %. Abgeschlossene Phasen zählen voll, die aktuelle Phase anteilig nach erledigten Checklistenpunkten. Beispiel: Phase 2 mit 3 von 4 Punkten erledigt = 20 % + 15 % = 35 %.

**Freigabe-Erinnerung:** Frist X Tage (global, je Kunde oder je Projekt einstellbar, Standard 3). Ist eine Runde länger als X Tage offen, erhältst du eine Erinnerung (Desktop, Briefing, optional E-Mail). Wiederholung frühestens nach weiteren X Tagen. Die Erinnerung geht an dich, nicht automatisch an den Kunden; per Klick öffnet sich eine vorformulierte Nachfass-E-Mail an den Ansprechpartner.

**Paketverbrauch:** Jedes Projekt hat einen Leistungsmonat und eine Anzahl (z. B. 4 Reels). Verbrauch im laufenden Monat = Summe aller nicht abgebrochenen Projekte dieser Leistungsart mit diesem Leistungsmonat. Anzeige: "3 von 4 Reels, davon 1 veröffentlicht". Warnung bei Überschreitung und bei Rückstand (z. B. Monat zu zwei Dritteln vorbei, aber weniger als die Hälfte produziert).

**Engpass-Erkennung** (Schwellen einstellbar):

| Situation | Standard |
|---|---|
| Projekt hängt in Bearbeitung | länger als 5 Tage |
| Projekt hängt im Upload | länger als 2 Tage |
| Freigabe offen | länger als 5 Tage |
| Drehtag vorbei, Projekt noch in Phase 1 | ab 1 Tag |
| Veröffentlichungsdatum vorbei, kein Link | ab 1 Tag |
| Zu viele Drehtage | mehr als 3 in 7 Tagen |
| Zu viel gleichzeitig in Bearbeitung | mehr als 5 Projekte je Person |
| Fälligkeiten häufen sich | 4 oder mehr am selben Tag |

**Durchlaufzeit:** Drehtag bis erste Veröffentlichung, Durchschnitt der letzten 90 Tage, zusätzlich die mittlere Verweildauer je Phase (aus dem Phasenverlauf).

**Kalenderfarben:** Drehtag blau, Deadline orange, Freigabe-Frist violett, Veröffentlichung grün, externe Google-Termine grau. Im Dunkelmodus kontrastangepasst.

## 6. Datenmodell (Kurzfassung)

```
customers ──< contacts
    │    ──< social_channels
    │    ──< package_items >── deliverable_types
    │    ──< drive_folders
    │    ──< recurrence_rules >── project_templates ──< template_checklist_items
    │
    └──< projects ──< project_phases (genau 5)      >── team_members
              │   ──< checklist_items (Aufgaben, Equipment, Shots; Sperrpunkte)
              │   ──  shoots (1:1, Drehtag)
              │   ──< approval_rounds (Freigaberunden, Korrekturzähler)
              │   ──< publications (je Plattform; Content-Kalender)
              │   ──< phase_transitions (Verlauf, Durchlaufzeiten)
              │   ──< time_entries (Zeiterfassung)  >── team_members
              └──< tasks                             >── team_members

Google:    google_accounts, calendar_events, calendar_sync_state, sync_jobs
Sonstiges: settings, briefings, notifications, search_index (Volltext), schema_migrations
```

| Tabelle | Inhalt |
|---|---|
| customers | Kunden und Interessenten in einer Tabelle. Status (Interessent, aktiv, pausiert, beendet), Pipeline-Stufe (Erstkontakt, Termin, Angebot, gewonnen, verloren), Kundentyp für Vorlagen, Adresse, Website, Notizen, Archivierung. Umwandlung in Kunden = Status wechseln, kein Kopieren von Daten. |
| contacts | Beliebig viele Ansprechpartner mit Rolle, Telefon, E-Mail, Hauptkontakt. |
| social_channels | Kanäle je Kunde (Instagram, TikTok, Facebook, YouTube, LinkedIn ...). |
| deliverable_types | Frei erweiterbare Leistungsarten (Reel, Imagefilm, Post, Story ...). |
| package_items | Gebuchtes Paket je Leistungsart: Menge pro Monat, Preis, gültig von/bis. |
| projects | Projekt mit Kunde, Leistungsart und Anzahl, Leistungsmonat, aktuelle Phase, Status, Rechnungsstatus (offen, gestellt, bezahlt) mit Nummer und Betrag, Ergebnis der Final-Prüfung, Verknüpfung zur Wiederholungsregel. |
| project_phases | Pro Phase: Fälligkeit, Verantwortlicher, Notizen, Eintritts- und Abschlusszeit. |
| checklist_items | Checklisten aller Phasen inkl. Equipment-Liste und Shotlist; Sperrpunkte, Systempunkte, automatisch gesetzte Punkte. |
| shoots | Drehtag: Datum, Uhrzeit von/bis, Ort, Hinweise, Shotlist-Notizen. |
| approval_rounds | Freigaberunden: Anfragedatum, Antwort, Ergebnis, Feedback, Erinnerungen. |
| publications | Veröffentlichungen je Plattform: geplantes Datum, Status, Link. |
| phase_transitions | Jeder Phasenwechsel mit Zeitpunkt und Grund. |
| tasks | Freie Aufgaben, optional mit Kunde, Projekt und Phase; Fälligkeit, Priorität, Status. |
| time_entries | Start/Stopp-Zeiten je Projekt und Person; höchstens ein laufender Timer pro Person. |
| project_templates, template_checklist_items | Vorlagen je Kundentyp mit vorausgefüllten Checklisten und Standard-Fristen relativ zum Drehtag. Mitgeliefert: Restaurant, Handwerk, Arztpraxis, Fahrschule, Standard. |
| recurrence_rules | Wiederkehrende Projekte und Aufgaben (wöchentlich/monatlich), Titelmuster wie "Reels {monat} {jahr}", Vorlaufzeit. Doppeltes Anlegen ist per Datenbank ausgeschlossen. |
| drive_folders | Alle angelegten Drive-Ordner mit Rolle (Kunde, Jahr, Projekt, Rohmaterial, Schnitt, Final, Freigabe) und Link. |
| calendar_events, calendar_sync_state | Spiegel der Google-Termine samt Verknüpfung zu Drehtag/Frist/Veröffentlichung; Sync-Stand je Kalender. |
| sync_jobs | Warteschlange für Google-Aktionen mit Wiederholversuchen. |
| briefings | Ein Briefing pro Tag (strukturiert für die Startseite, als Text für E-Mail). |
| notifications | Benachrichtigungszentrale, verhindert doppelte Erinnerungen. |
| search_index | Volltextindex (SQLite FTS5) über Kunden, Ansprechpartner, Projekte, Aufgaben und Notizen. |

## 7. Etappenplan

| Etappe | Inhalt | Testbar danach |
|---|---|---|
| 1 | Grundgerüst, Datenbank, Kunden (inkl. Ansprechpartner, Kanäle, Paket), Team, Einstellungen, Hell/Dunkel, tägliches Backup, Start mit einem Befehl | Kunden anlegen, bearbeiten, archivieren; Backup-Datei prüfen |
| 2 | Projekte, Phasen, Kanban und Liste, Checklisten mit Sperre, Drehtag-Details, Freigaberunden, Veröffentlichungen, Fortschritt, Vorlagen, Paketverbrauch, Kundendetailseite | Projekt durch alle Phasen ziehen, Sperre ausprobieren |
| 3 | Google-Einrichtung (Anleitung), OAuth, Drive-Ordner, Final-Erkennung | Kunde anlegen, Ordner in Drive erscheinen |
| 4 | Google Calendar Zwei-Wege-Sync, Kalenderansicht Tag/Woche/Monat | Drehtag anlegen, Termin in Google prüfen und verschieben |
| 5 | Briefing 9:00, Desktop-Benachrichtigung, E-Mail, Freigabe-Erinnerungen | Briefing manuell auslösen, Mail prüfen |
| 6 | Live-Dashboard mit Kennzahlen, Engpass-Erkennung | Dashboard offen lassen, in zweitem Tab Projekt verschieben |
| 7 | Zeiterfassung, Wiederholungen, Akquise-Pipeline, Rechnungsstatus, Content-Kalender, globale Suche, CSV/PDF-Export, Autostart macOS/Windows | Monatsbericht als PDF erzeugen, Autostart einrichten |
