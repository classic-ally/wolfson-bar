-- Make passkey_credential optional (SQLite requires table recreation to drop NOT NULL)
PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    passkey_credential TEXT,  -- Now optional: NULL for email-only users
    is_committee BOOLEAN DEFAULT FALSE,
    code_of_conduct_signed BOOLEAN DEFAULT FALSE,
    food_safety_completed BOOLEAN DEFAULT FALSE,
    food_safety_certificate BLOB,
    food_safety_certificate_type TEXT,
    induction_completed BOOLEAN DEFAULT FALSE,
    has_contract BOOLEAN DEFAULT FALSE,
    contract_expiry_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_admin BOOLEAN DEFAULT FALSE,
    email TEXT,
    email_notifications_enabled BOOLEAN DEFAULT TRUE,
    privacy_consent_given BOOLEAN DEFAULT FALSE
);

INSERT INTO users_new SELECT
    id, display_name, passkey_credential, is_committee,
    code_of_conduct_signed, food_safety_completed,
    food_safety_certificate, food_safety_certificate_type,
    induction_completed, has_contract, contract_expiry_date,
    created_at, is_admin, email, email_notifications_enabled,
    privacy_consent_given
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

PRAGMA foreign_keys=ON;
