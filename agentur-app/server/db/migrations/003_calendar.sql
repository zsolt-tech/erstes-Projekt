-- Migration 003: Google Calendar
-- Prüfsumme des zuletzt an Google übertragenen Inhalts, um unnötige Aktualisierungen zu vermeiden
ALTER TABLE calendar_events ADD COLUMN content_hash TEXT;

-- Farbe und Schreibrecht der Google-Kalender
ALTER TABLE calendar_sync_state ADD COLUMN color TEXT;
ALTER TABLE calendar_sync_state ADD COLUMN access_role TEXT;

-- Änderungszeitpunkte für "jüngere Änderung gewinnt"
ALTER TABLE shoots ADD COLUMN updated_at TEXT;
ALTER TABLE publications ADD COLUMN updated_at TEXT;
