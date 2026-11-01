# Agentur-Verwaltung

Lokale Web-App zur Verwaltung von Kunden, Projekten und Aufgaben für Videoproduktion und Social-Media-Betreuung.
Läuft auf deinem Rechner unter `http://localhost:3000`, die Daten liegen in einer lokalen Datei.

Aktueller Stand: **Etappe 1** (Grundgerüst, Kunden, Einstellungen, Hell-/Dunkelmodus, tägliche Datensicherung).
Architektur und Datenmodell: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

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

## Für Entwickler

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklung mit automatischem Neuladen (Oberfläche unter <http://localhost:5173>) |
| `npm test` | Server-Tests (Node-Testrunner) |
| `npm run typecheck` | TypeScript-Prüfung von Server und Oberfläche |
| `npm run build` | Oberfläche bauen |

Technik: Node.js (ab 22.13) mit Express, eingebautes SQLite (`node:sqlite`), React mit Vite und Tailwind CSS, TanStack Query, Live-Updates per Server-Sent Events.
