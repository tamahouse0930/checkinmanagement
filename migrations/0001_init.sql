-- TAMAHOUSE チェックイン管理システム 初期スキーマ（設計書 3.3）
-- 日時は ISO 8601 形式の文字列（UTC）、日付は YYYY-MM-DD（JST の暦日）

-- 物件と設定（初期は 1 行）
CREATE TABLE properties (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  checkin_time         TEXT NOT NULL DEFAULT '15:00',
  checkout_time        TEXT NOT NULL DEFAULT '10:00',
  operator_name        TEXT NOT NULL DEFAULT '',
  operator_contact     TEXT NOT NULL DEFAULT '',
  drive_root_folder_id TEXT,
  revoked_sessions     TEXT NOT NULL DEFAULT '[]',
  settings_version     INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT NOT NULL
);

-- 管理者が編集する言語ごとの文面
CREATE TABLE property_texts (
  property_id TEXT NOT NULL REFERENCES properties(id),
  kind        TEXT NOT NULL CHECK (kind IN ('invite', 'code', 'reject', 'host_contact', 'house_rules', 'privacy')),
  lang        TEXT NOT NULL,
  body        TEXT NOT NULL,
  PRIMARY KEY (property_id, kind, lang)
);

-- 通知メールの宛先
CREATE TABLE notify_recipients (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  created_at TEXT NOT NULL
);

-- iCal の取得元
CREATE TABLE ical_sources (
  id             TEXT PRIMARY KEY,
  property_id    TEXT NOT NULL REFERENCES properties(id),
  channel        TEXT NOT NULL CHECK (channel IN ('airbnb', 'booking')),
  url            TEXT NOT NULL,
  last_synced_at TEXT,
  last_error     TEXT
);

-- 予約
CREATE TABLE reservations (
  id                       TEXT PRIMARY KEY,
  property_id              TEXT NOT NULL REFERENCES properties(id),
  ical_source_id           TEXT REFERENCES ical_sources(id),
  channel                  TEXT NOT NULL CHECK (channel IN ('airbnb', 'booking', 'other')),
  source                   TEXT NOT NULL CHECK (source IN ('ical', 'manual')),
  is_test                  INTEGER NOT NULL DEFAULT 0,
  external_uid             TEXT,
  reservation_code         TEXT,
  phone_last4              TEXT,
  booker_name              TEXT,
  note                     TEXT,
  check_in_date            TEXT NOT NULL,
  check_out_date           TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled', 'blocked')),
  status_locked            INTEGER NOT NULL DEFAULT 0,
  guest_token              TEXT UNIQUE,
  reg_status               TEXT NOT NULL DEFAULT 'none'
                           CHECK (reg_status IN ('none', 'in_progress', 'submitted', 'rejected', 'approved')),
  stay_status              TEXT NOT NULL DEFAULT 'not_arrived'
                           CHECK (stay_status IN ('not_arrived', 'in_house', 'checked_out')),
  lang                     TEXT,
  reject_reason            TEXT,
  keybox_code              TEXT,
  consent_at               TEXT,
  consent_for_companions   INTEGER NOT NULL DEFAULT 0,
  invite_sent_at           TEXT,
  submitted_at             TEXT,
  approved_at              TEXT,
  code_sent_at             TEXT,
  first_checkin_at         TEXT,
  photos_verified_at       TEXT,
  checked_out_at           TEXT,
  checked_out_by           TEXT,
  notified_unregistered_at TEXT,
  notified_overdue_at      TEXT,
  display_name             TEXT,
  guest_total              INTEGER NOT NULL DEFAULT 0,
  guest_ready              INTEGER NOT NULL DEFAULT 0,
  guest_pending            INTEGER NOT NULL DEFAULT 0,
  guest_checked_in         INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (ical_source_id, external_uid)
);
CREATE INDEX idx_reservations_checkout ON reservations (check_out_date, check_in_date);

-- 写真台帳（写真本体は Google ドライブ）
CREATE TABLE photos (
  id              TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL REFERENCES reservations(id),
  guest_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('id', 'kiosk')),
  drive_file_id   TEXT NOT NULL UNIQUE,
  drive_folder_id TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  taken_at        TEXT NOT NULL,
  delete_after    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_photos_reservation ON photos (reservation_id);
CREATE INDEX idx_photos_taken ON photos (taken_at);
CREATE INDEX idx_photos_delete ON photos (delete_after);

-- 宿泊者名簿
CREATE TABLE guests (
  id                  TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL REFERENCES reservations(id),
  seq                 INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'submitted', 'approved')),
  entry_token         TEXT UNIQUE,
  entered_by          TEXT NOT NULL DEFAULT 'representative' CHECK (entered_by IN ('representative', 'self', 'admin')),
  is_japanese         INTEGER,
  full_name           TEXT,
  address_country     TEXT,
  address             TEXT,
  occupation          TEXT,
  contact             TEXT,
  nationality         TEXT,
  passport_number     TEXT,
  is_under16          INTEGER NOT NULL DEFAULT 0,
  id_photo_id         TEXT REFERENCES photos(id),
  passport_mrz_number TEXT,
  passport_check      TEXT CHECK (passport_check IN ('match', 'mismatch', 'unreadable')),
  approved_at         TEXT,
  kiosk_photo_id      TEXT REFERENCES photos(id),
  checked_in_at       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (reservation_id, seq)
);

-- 管理者による名簿の修正・削除の記録
CREATE TABLE guest_revisions (
  id             TEXT PRIMARY KEY,
  guest_id       TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('update', 'delete', 'replace_photo')),
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT,
  admin_email    TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- 玄関タブレット
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE device_pairings (
  code        TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- 管理画面にログインできる Google アカウント
CREATE TABLE admin_accounts (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  created_at TEXT NOT NULL
);

-- ログインのセッション（端末ごと）
CREATE TABLE admin_sessions (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- Google アカウントの連携（写真の保存・メールの送信）
CREATE TABLE google_link (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  account_email     TEXT NOT NULL,
  scopes            TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  linked_at         TEXT NOT NULL,
  last_error        TEXT
);

-- 定期処理の実行記録
CREATE TABLE job_runs (
  job      TEXT NOT NULL,
  run_date TEXT NOT NULL,
  PRIMARY KEY (job, run_date)
);

-- 操作ログ
CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  created_at TEXT NOT NULL
);

-- 物件の初期データ
INSERT INTO properties (id, name, updated_at) VALUES ('main', 'TAMAHOUSE', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO admin_accounts (email, name, created_at) VALUES ('tamahouse0930@gmail.com', 'TAMAHOUSE（管理用）', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
