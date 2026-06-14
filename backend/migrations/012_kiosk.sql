-- Shift check-in via an enrolled kiosk device.
-- Adds physical-attendance tracking, a bar open/closed state, and the
-- device-credential + pairing tables that gate kiosk code generation.

-- Attendance: who actually showed up (vs who merely signed up).
ALTER TABLE shift_signups ADD COLUMN checked_in_at TEXT;

-- Single-row real-time bar open/closed state (distinct from scheduled bar_hours).
CREATE TABLE IF NOT EXISTS bar_status (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    is_open    BOOLEAN NOT NULL DEFAULT 0,
    opened_at  TEXT,
    opened_by  TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO bar_status (id, is_open) VALUES (1, 0);

-- Enrolled kiosk devices. The raw device token never reaches the server;
-- only its sha256 hash is stored.
CREATE TABLE IF NOT EXISTS kiosk_devices (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
);

-- Short-lived pairing handshakes. The device posts the hash of a token it
-- generated and keeps; a committee member approves by scanning the code.
CREATE TABLE IF NOT EXISTS kiosk_pairings (
    code        TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved'
    device_id   TEXT,
    name        TEXT,
    approved_by TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

-- Generic key/value config. Holds the persistent TOTP secret so rotating
-- check-in codes survive backend restarts.
CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
