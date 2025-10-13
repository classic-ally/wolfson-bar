-- Add shift override fields to events
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- The duplicate column error is handled gracefully in main.rs
ALTER TABLE events ADD COLUMN shift_max_volunteers INTEGER;
ALTER TABLE events ADD COLUMN shift_requires_contract BOOLEAN;

-- Shift signups table
CREATE TABLE IF NOT EXISTS shift_signups (
    shift_date TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (shift_date, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_shift_signups_date ON shift_signups(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_signups_user ON shift_signups(user_id);
