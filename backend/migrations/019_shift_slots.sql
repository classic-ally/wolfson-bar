-- Split nights into separately-staffed shifts. An event flagged
-- staff_separately is its own shift slot; signups record which slot they are
-- on ('' is the night's regular shift, otherwise the flagged event's id).
--
-- The first ALTER fails with "duplicate column" on re-run, which stops the
-- runner before the table rebuilds below, so they happen only once.
-- seed-dummy.py applies statements one at a time and re-runs the rebuilds,
-- which is harmless: they copy every column, slot included.
ALTER TABLE shift_signups ADD COLUMN slot TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN staff_separately BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE email_notification_log ADD COLUMN slot TEXT NOT NULL DEFAULT '';

-- SQLite can't change a primary key in place: rebuild so a member can hold
-- more than one slot on the same night.
CREATE TABLE shift_signups_new (
    shift_date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    checked_in_at TEXT,
    PRIMARY KEY (shift_date, slot, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO shift_signups_new (shift_date, slot, user_id, checked_in_at)
SELECT shift_date, slot, user_id, checked_in_at FROM shift_signups;
DROP TABLE shift_signups;
ALTER TABLE shift_signups_new RENAME TO shift_signups;
CREATE INDEX IF NOT EXISTS idx_shift_signups_date ON shift_signups(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_signups_user ON shift_signups(user_id);

CREATE TABLE email_notification_log_new (
    user_id TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT '',
    notification_type TEXT NOT NULL,  -- 'added' or 'removed'
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, shift_date, slot),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO email_notification_log_new (user_id, shift_date, slot, notification_type, sent_at)
SELECT user_id, shift_date, slot, notification_type, sent_at FROM email_notification_log;
DROP TABLE email_notification_log;
ALTER TABLE email_notification_log_new RENAME TO email_notification_log;
