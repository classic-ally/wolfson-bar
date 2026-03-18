-- Induction availability (committee members marking dates they can run inductions)
CREATE TABLE IF NOT EXISTS induction_availability (
    shift_date TEXT NOT NULL,
    committee_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (shift_date, committee_user_id),
    FOREIGN KEY (committee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Induction signups (inductees signing up for induction sessions)
CREATE TABLE IF NOT EXISTS induction_signups (
    shift_date TEXT NOT NULL,
    user_id TEXT NOT NULL,
    full_shift BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (shift_date, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Separate notification log for induction emails (different PK structure from shift notifications)
CREATE TABLE IF NOT EXISTS induction_notification_log (
    recipient_id TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (recipient_id, shift_date, notification_type),
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

-- New user field for supervised shift tracking
ALTER TABLE users ADD COLUMN supervised_shift_completed BOOLEAN DEFAULT FALSE;

-- Backward compat: existing inducted users are grandfathered as having completed supervised shift
UPDATE users SET supervised_shift_completed = TRUE WHERE induction_completed = TRUE;
