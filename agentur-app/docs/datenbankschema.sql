-- =====================================================================
-- Agentur-Verwaltung: Datenbankschema (SQLite)
-- Entwurf zur Abstimmung, wird nach Bestätigung zur ersten Migration.
--
-- Konventionen
--   Zeitpunkte      TEXT, ISO 8601 in UTC        2026-11-01T08:00:00.000Z
--   Datumswerte     TEXT, YYYY-MM-DD             (Ortszeit Europe/Berlin)
--   Uhrzeiten       TEXT, HH:MM                  (Ortszeit Europe/Berlin)
--   Monate          TEXT, YYYY-MM
--   Ja/Nein         INTEGER 0/1
--   Geldbeträge     INTEGER in Cent              (keine Rundungsfehler)
--   Phasen          INTEGER 1-5: 1 Drehtag, 2 Bearbeitung, 3 Upload,
--                   4 Freigabe, 5 Veröffentlichung
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Verwaltung
-- ---------------------------------------------------------------------

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Einstellungen als Schlüssel/Wert (Wert als JSON)
-- Beispiele: approval_reminder_days, phase_max_days, briefing_email_to,
-- drive_root_folder, drive_subfolders, calendar_write_id, theme
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL
);

-- Team (Verantwortliche). Kein Login, die App läuft nur lokal.
CREATE TABLE team_members (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT,
  color                TEXT NOT NULL DEFAULT '#3B5BDB',
  weekly_capacity_h    REAL,                     -- für Engpass-Warnungen
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Leistungsarten, frei erweiterbar (Reel, Imagefilm, Post, Story, Fotoshooting ...)
CREATE TABLE deliverable_types (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Kunden, Interessenten (Akquise), Ansprechpartner, Kanäle, Pakete
-- ---------------------------------------------------------------------

CREATE TABLE customers (
  id                      INTEGER PRIMARY KEY,
  company_name            TEXT NOT NULL,
  industry                TEXT,                  -- Branche als Freitext
  customer_type           TEXT NOT NULL DEFAULT 'sonstige'
                          CHECK (customer_type IN ('restaurant','handwerk','arztpraxis','fahrschule','sonstige')),
  status                  TEXT NOT NULL DEFAULT 'interessent'
                          CHECK (status IN ('interessent','aktiv','pausiert','beendet')),
  -- Akquise-Pipeline (nur relevant, solange Status = interessent)
  pipeline_stage          TEXT
                          CHECK (pipeline_stage IN ('erstkontakt','termin','angebot','gewonnen','verloren')),
  lead_source             TEXT,                  -- Empfehlung, Instagram, Kaltakquise ...
  expected_monthly_cents  INTEGER,               -- erwarteter Monatsumsatz
  next_contact_date       TEXT,
  lost_reason             TEXT,
  converted_at            TEXT,                  -- Zeitpunkt der Umwandlung in einen Kunden
  -- Stammdaten
  street                  TEXT,
  postal_code             TEXT,
  city                    TEXT,
  country                 TEXT DEFAULT 'Deutschland',
  website                 TEXT,
  notes                   TEXT,
  approval_reminder_days  INTEGER,               -- überschreibt die globale Einstellung
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at             TEXT
);

CREATE TABLE contacts (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  role         TEXT,                             -- Inhaber, Marketing ...
  phone        TEXT,
  email        TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE social_channels (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL
               CHECK (platform IN ('instagram','tiktok','facebook','youtube','linkedin','pinterest','google_business','x','sonstige')),
  handle       TEXT,
  url          TEXT
);

-- Gebuchtes Paket: eine Zeile je Leistungsart, z. B. "4 Reels pro Monat"
CREATE TABLE package_items (
  id                   INTEGER PRIMARY KEY,
  customer_id          INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  deliverable_type_id  INTEGER NOT NULL REFERENCES deliverable_types(id),
  quantity_per_month   INTEGER NOT NULL CHECK (quantity_per_month > 0),
  monthly_price_cents  INTEGER,
  valid_from           TEXT NOT NULL,            -- YYYY-MM-DD
  valid_until          TEXT                      -- leer = unbefristet
);

-- ---------------------------------------------------------------------
-- Vorlagen
-- ---------------------------------------------------------------------

CREATE TABLE project_templates (
  id                         INTEGER PRIMARY KEY,
  name                       TEXT NOT NULL,
  customer_type              TEXT
                             CHECK (customer_type IN ('restaurant','handwerk','arztpraxis','fahrschule','sonstige')),
  deliverable_type_id        INTEGER REFERENCES deliverable_types(id),
  default_deliverable_count  INTEGER NOT NULL DEFAULT 1,
  -- Fälligkeiten der Phasen in Tagen nach dem Drehtag, z. B. {"2":3,"3":5,"4":6,"5":12}
  phase_offsets_json         TEXT NOT NULL DEFAULT '{}',
  description                TEXT,
  active                     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE template_checklist_items (
  id           INTEGER PRIMARY KEY,
  template_id  INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  phase        INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 5),
  kind         TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','equipment','shot')),
  label        TEXT NOT NULL,
  is_gate      INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Wiederkehrende Projekte und Aufgaben
-- ---------------------------------------------------------------------

CREATE TABLE recurrence_rules (
  id                   INTEGER PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('projekt','aufgabe')),
  customer_id          INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  template_id          INTEGER REFERENCES project_templates(id),
  title_pattern        TEXT NOT NULL,            -- z. B. "Reels {monat} {jahr}"
  frequency            TEXT NOT NULL CHECK (frequency IN ('woechentlich','monatlich')),
  interval_count       INTEGER NOT NULL DEFAULT 1,
  day_of_month         INTEGER CHECK (day_of_month BETWEEN 1 AND 28),
  weekday              INTEGER CHECK (weekday BETWEEN 1 AND 7),   -- 1 = Montag
  create_days_ahead    INTEGER NOT NULL DEFAULT 7,                -- so viele Tage vorher anlegen
  defaults_json        TEXT NOT NULL DEFAULT '{}',                -- Verantwortlicher, Priorität, Anzahl ...
  start_date           TEXT NOT NULL,
  end_date             TEXT,
  next_occurrence      TEXT,
  active               INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Projekte und Workflow
-- ---------------------------------------------------------------------

CREATE TABLE projects (
  id                       INTEGER PRIMARY KEY,
  customer_id              INTEGER NOT NULL REFERENCES customers(id),
  title                    TEXT NOT NULL,
  description              TEXT,
  template_id              INTEGER REFERENCES project_templates(id),
  deliverable_type_id      INTEGER REFERENCES deliverable_types(id),
  deliverable_count        INTEGER NOT NULL DEFAULT 1,
  service_month            TEXT NOT NULL,        -- YYYY-MM, zählt für das Paket dieses Monats
  current_phase            INTEGER NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 5),
  status                   TEXT NOT NULL DEFAULT 'aktiv'
                           CHECK (status IN ('aktiv','pausiert','abgeschlossen','abgebrochen')),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('niedrig','normal','hoch')),
  -- Rechnung
  invoice_status           TEXT NOT NULL DEFAULT 'offen' CHECK (invoice_status IN ('offen','gestellt','bezahlt')),
  invoice_number           TEXT,
  invoice_amount_cents     INTEGER,
  invoice_date             TEXT,
  paid_date                TEXT,
  -- Upload-Phase: Ergebnis der letzten Prüfung des Final-Ordners
  final_file_count         INTEGER,
  final_checked_at         TEXT,
  -- Freigabe
  approval_reminder_days   INTEGER,              -- überschreibt Kunde und globale Einstellung
  -- Wiederholung
  recurrence_rule_id       INTEGER REFERENCES recurrence_rules(id) ON DELETE SET NULL,
  recurrence_period        TEXT,                 -- z. B. 2026-12, verhindert doppeltes Anlegen
  notes                    TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at             TEXT,
  archived_at              TEXT,
  UNIQUE (recurrence_rule_id, recurrence_period)
);

-- Je Projekt genau fünf Zeilen, eine pro Phase
CREATE TABLE project_phases (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase        INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 5),
  due_date     TEXT,
  assignee_id  INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  notes        TEXT,
  entered_at   TEXT,                             -- zuletzt in diese Phase gekommen
  completed_at TEXT,
  UNIQUE (project_id, phase)
);

-- Checklisten aller Phasen. kind: standard | equipment (Drehtag) | shot (Shotlist)
CREATE TABLE checklist_items (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase        INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 5),
  kind         TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','equipment','shot')),
  label        TEXT NOT NULL,
  is_done      INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,
  is_gate      INTEGER NOT NULL DEFAULT 0,       -- muss erledigt sein, bevor das Projekt weiterrückt
  is_system    INTEGER NOT NULL DEFAULT 0,       -- nicht löschbar (z. B. Clip-Qualitätsprüfung)
  auto_key     TEXT,                             -- wird automatisch gesetzt, z. B. 'final_files_present'
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Phase 1: Drehtag (ein Drehtag je Projekt)
CREATE TABLE shoots (
  project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  shoot_date     TEXT,
  start_time     TEXT,
  end_time       TEXT,
  location       TEXT,
  location_notes TEXT,                           -- Parken, Ansprechpartner vor Ort ...
  shotlist_notes TEXT                            -- Freitext zusätzlich zu den Shot-Punkten
);

-- Phase 4: Freigabe, eine Zeile je Runde (Korrekturschleifen = Runden mit Ergebnis 'korrektur')
CREATE TABLE approval_rounds (
  id                INTEGER PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_no          INTEGER NOT NULL,
  requested_at      TEXT NOT NULL,               -- Datum der Freigabe-Anfrage
  responded_at      TEXT,
  result            TEXT CHECK (result IN ('freigegeben','korrektur')),
  feedback          TEXT,
  last_reminder_at  TEXT,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, round_no)
);

-- Phase 5: Veröffentlichung, eine Zeile je Plattform. Grundlage des Content-Kalenders.
CREATE TABLE publications (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL
                CHECK (platform IN ('instagram','tiktok','facebook','youtube','linkedin','pinterest','google_business','x','sonstige')),
  planned_date  TEXT,
  planned_time  TEXT,
  published_at  TEXT,
  post_url      TEXT,
  caption       TEXT,
  status        TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','veroeffentlicht'))
);

-- Verlauf aller Phasenwechsel: Grundlage für Durchlaufzeiten und Engpass-Erkennung
CREATE TABLE phase_transitions (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_phase  INTEGER,
  to_phase    INTEGER NOT NULL,
  moved_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason      TEXT                               -- z. B. 'Korrekturschleife'
);

-- ---------------------------------------------------------------------
-- Aufgaben und Zeiterfassung
-- ---------------------------------------------------------------------

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  phase               INTEGER CHECK (phase BETWEEN 1 AND 5),
  due_date            TEXT,
  due_time            TEXT,
  assignee_id         INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('niedrig','normal','hoch')),
  status              TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
  completed_at        TEXT,
  recurrence_rule_id  INTEGER REFERENCES recurrence_rules(id) ON DELETE SET NULL,
  recurrence_period   TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (recurrence_rule_id, recurrence_period)
);

-- Laufender Timer = Eintrag ohne ended_at
CREATE TABLE time_entries (
  id              INTEGER PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_member_id  INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  phase           INTEGER CHECK (phase BETWEEN 1 AND 5),
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  note            TEXT,
  billable        INTEGER NOT NULL DEFAULT 1
);
-- höchstens ein laufender Timer pro Person
CREATE UNIQUE INDEX ux_time_entries_running
  ON time_entries (COALESCE(team_member_id, 0)) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------
-- Google-Anbindung
-- ---------------------------------------------------------------------

-- Verbundenes Google-Konto. Tokens verschlüsselt mit APP_SECRET aus der .env
CREATE TABLE google_accounts (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),   -- genau ein Konto
  email              TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  access_token_enc   TEXT,
  token_expires_at   TEXT,
  scopes             TEXT NOT NULL,
  connected_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Angelegte Drive-Ordner. role: kunde | jahr | projekt | rohmaterial | schnitt | final | freigabe
CREATE TABLE drive_folders (
  id                INTEGER PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  project_id        INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  role              TEXT NOT NULL
                    CHECK (role IN ('kunde','jahr','projekt','rohmaterial','schnitt','final','freigabe')),
  year              INTEGER,
  google_folder_id  TEXT NOT NULL,
  web_url           TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Spiegel der Google-Kalender-Termine (fremde und von der App angelegte)
CREATE TABLE calendar_events (
  id                  INTEGER PRIMARY KEY,
  google_calendar_id  TEXT NOT NULL,
  google_event_id     TEXT NOT NULL,
  etag                TEXT,
  title               TEXT,
  description         TEXT,
  location            TEXT,
  start_at            TEXT,                      -- Zeitpunkt oder Datum (ganztägig)
  end_at              TEXT,
  all_day             INTEGER NOT NULL DEFAULT 0,
  status              TEXT,                      -- confirmed | tentative | cancelled
  html_link           TEXT,
  google_updated_at   TEXT,
  source              TEXT NOT NULL CHECK (source IN ('google','app')),
  linked_type         TEXT CHECK (linked_type IN ('shoot','phase_due','approval','publication','task')),
  linked_id           INTEGER,
  synced_at           TEXT,
  UNIQUE (google_calendar_id, google_event_id)
);

CREATE TABLE calendar_sync_state (
  google_calendar_id  TEXT PRIMARY KEY,
  name                TEXT,
  read_enabled        INTEGER NOT NULL DEFAULT 1,
  sync_token          TEXT,                      -- für inkrementelle Synchronisation
  last_sync_at        TEXT
);

-- Warteschlange für Google-Aktionen; ohne Internet wird später nachgeholt
CREATE TABLE sync_jobs (
  id            INTEGER PRIMARY KEY,
  job_type      TEXT NOT NULL,                   -- drive.customer_folder, drive.project_folders,
                                                 -- calendar.upsert, calendar.delete, gmail.send ...
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'wartend' CHECK (status IN ('wartend','laeuft','fertig','fehler')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  run_after     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
-- Briefing, Benachrichtigungen, Suche
-- ---------------------------------------------------------------------

CREATE TABLE briefings (
  id             INTEGER PRIMARY KEY,
  briefing_date  TEXT NOT NULL UNIQUE,           -- ein Briefing pro Tag
  generated_at   TEXT NOT NULL,
  data_json      TEXT NOT NULL,                  -- strukturierte Inhalte für die Startseite
  text           TEXT NOT NULL,                  -- ausformulierter Text für E-Mail
  notified_at    TEXT,
  emailed_at     TEXT
);

-- Benachrichtigungszentrale; verhindert doppelte Erinnerungen
CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL
               CHECK (type IN ('briefing','freigabe_erinnerung','engpass','sync_fehler','backup','system')),
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,                             -- Ziel in der App, z. B. /projekte/12
  entity_type  TEXT,
  entity_id    INTEGER,
  dedupe_key   TEXT UNIQUE,                      -- z. B. 'engpass:projekt:12:phase:2:2026-11-01'
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at      TEXT
);

-- Volltextsuche über Kunden, Ansprechpartner, Projekte, Aufgaben und Notizen
-- Präfixsuche; Umlaute werden von der App vereinheitlicht (ä/ae, ö/oe, ü/ue, ß/ss),
-- sodass "Bäckerei" und "Baeckerei" denselben Treffer liefern
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ---------------------------------------------------------------------
-- Indizes
-- ---------------------------------------------------------------------

CREATE INDEX ix_customers_status        ON customers (status, archived_at);
CREATE INDEX ix_contacts_customer       ON contacts (customer_id);
CREATE INDEX ix_package_items_customer  ON package_items (customer_id);
CREATE INDEX ix_projects_customer       ON projects (customer_id);
CREATE INDEX ix_projects_phase          ON projects (status, current_phase);
CREATE INDEX ix_projects_service_month  ON projects (customer_id, service_month);
CREATE INDEX ix_phases_due              ON project_phases (due_date);
CREATE INDEX ix_checklist_project       ON checklist_items (project_id, phase);
CREATE INDEX ix_shoots_date             ON shoots (shoot_date);
CREATE INDEX ix_approval_open           ON approval_rounds (project_id) WHERE responded_at IS NULL;
CREATE INDEX ix_publications_planned    ON publications (planned_date);
CREATE INDEX ix_transitions_project     ON phase_transitions (project_id, moved_at);
CREATE INDEX ix_tasks_due               ON tasks (status, due_date);
CREATE INDEX ix_tasks_project           ON tasks (project_id);
CREATE INDEX ix_time_project            ON time_entries (project_id, started_at);
CREATE INDEX ix_drive_folders_entity    ON drive_folders (customer_id, project_id, role);
CREATE INDEX ix_calendar_events_start   ON calendar_events (start_at);
CREATE INDEX ix_calendar_events_link    ON calendar_events (linked_type, linked_id);
CREATE INDEX ix_sync_jobs_queue         ON sync_jobs (status, run_after);
