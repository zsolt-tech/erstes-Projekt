# Agentur-Verwaltung

Lokale Web-App (Node.js, Express, eingebautes SQLite, React mit Vite) für Kunden, Projekte und Aufgaben einer Agentur für Videoproduktion und Social-Media-Betreuung. Oberfläche und Texte auf Deutsch, sachlich, ohne Emojis. Zeitzone Europe/Berlin.

## Befehle

- Starten: `npm start` (http://localhost:3000)
- Entwicklung: `npm run dev`
- Tests: `npm test`, Typprüfung: `npm run typecheck`

## Aufbau

- `server/` Express-API, `server/db/migrations/` SQL-Migrationen, `server/google/` Google-Anbindung (Drive, Calendar, Gmail, Warteschlange), `server/services/` Fachlogik (Projekte, Briefing, Engpässe, PDF, Agenten)
- `shared/schemas.ts` gemeinsame Typen, Prüfregeln und deutsche Bezeichnungen
- `client/src/` React-Oberfläche
- `docs/` Anleitungen (Architektur, Google-Einrichtung, Agenten)

## Agenten

- `videoschnitt`: Schnitt und Endkontrolle nach dem Skill clip-qualitaetspruefung, Highlight-Reels mit local-highlight-reel, Rückmeldung an `POST /api/projects/<ID>/quality-checks`
- `pdf-erstellung`: individuelle PDFs mit Daten aus der App (Skill pdf)

Projektkontext für Agenten: `GET /api/projects/<ID>/agent-context`. Anleitung: `docs/AGENTEN.md`.

## Regeln

- Keine Kundendaten, Videos, Prüfdateien oder Zugangsdaten in das Repository schreiben. Arbeitsdateien gehören nach `~/Agentur/Arbeitsbereich/`.
- Die `.env` enthält Zugangsdaten und wird nie eingecheckt.
- Datenbankänderungen nur über neue Migrationen in `server/db/migrations/`.
