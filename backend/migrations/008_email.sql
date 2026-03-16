ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_notifications_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN privacy_consent_given BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    used BOOLEAN DEFAULT FALSE,
    ip_address TEXT
);
CREATE INDEX idx_magic_link_tokens_token ON magic_link_tokens(token);
CREATE INDEX idx_magic_link_tokens_email ON magic_link_tokens(email);

-- Tracks the last notification state per user+shift.
-- PK is (user_id, shift_date) so each pair has exactly one row
-- representing the most recent notification sent (added or removed).
CREATE TABLE IF NOT EXISTS email_notification_log (
    user_id TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    notification_type TEXT NOT NULL,  -- 'added' or 'removed'
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, shift_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
