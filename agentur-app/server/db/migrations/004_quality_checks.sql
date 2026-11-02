-- Migration 004: Videoschnitt-Agenten und Qualitätsprüfung

-- Prüfprofil des Agenten clip-qualitaetspruefung je Kunde (leer = aus dem Kundentyp)
ALTER TABLE customers ADD COLUMN qa_profile TEXT
  CHECK (qa_profile IN ('standard','fahrschule','zahnarzt','restaurant','handwerk'));
-- Durchgehende Kamerabewegung Pflicht (Option --bewegung-pflicht)
ALTER TABLE customers ADD COLUMN qa_motion_required INTEGER NOT NULL DEFAULT 0;
-- Besonderheiten für den Schnitt (z. B. "keine Hände im Bild", "Endschnitt in Premiere")
ALTER TABLE customers ADD COLUMN qa_notes TEXT;

-- Ergebnisse von Vorprüfung und Endkontrolle, gemeldet vom Agenten oder von Hand
CREATE TABLE quality_checks (
  id                  INTEGER PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_name          TEXT NOT NULL,
  stage               TEXT NOT NULL CHECK (stage IN ('vorpruefung','endkontrolle')),
  verdict             TEXT NOT NULL CHECK (verdict IN ('freigegeben','zurueck','offen')),
  run_no              INTEGER NOT NULL DEFAULT 1,
  profile             TEXT,
  shots               INTEGER,
  drone_perspectives  INTEGER,
  summary             TEXT,
  issues_json         TEXT NOT NULL DEFAULT '[]',
  clip_list           TEXT,
  source              TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','manuell')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_quality_checks_project ON quality_checks (project_id, created_at);
