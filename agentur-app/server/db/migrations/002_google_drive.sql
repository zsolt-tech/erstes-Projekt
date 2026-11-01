-- Migration 002: Google Drive
-- Herkunft eines Ordners: von der App angelegt oder vom Nutzer verknüpft
ALTER TABLE drive_folders ADD COLUMN name TEXT;
ALTER TABLE drive_folders ADD COLUMN origin TEXT NOT NULL DEFAULT 'angelegt'
  CHECK (origin IN ('angelegt','verknuepft'));

-- Dateien im Ordner "Fertige Videos" (Name, Link, Änderungszeit) aus der letzten Prüfung
ALTER TABLE projects ADD COLUMN final_files_json TEXT;

-- Je Kunde/Projekt/Rolle/Jahr höchstens ein Ordner
CREATE UNIQUE INDEX ux_drive_folders_role
  ON drive_folders (customer_id, COALESCE(project_id, 0), role, COALESCE(year, 0));
