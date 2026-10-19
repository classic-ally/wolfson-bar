-- Which membership emails each member has had. The worker sends an email only
-- when its key has no row yet; committee members can send stuck reminders
-- by hand, so a key may appear more than once.
--
-- outcome: 'sent'; 'skipped' (the member had Membership emails off or no
-- address, or a later email superseded it, so it isn't sent late);
-- 'backfilled' (already past that stage when this table was created).
--
-- Plain CREATE TABLE (no IF NOT EXISTS): on re-run it fails with "already
-- exists" and the runner skips the backfill below, so it happens only once.
CREATE TABLE membership_email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Template key; Code of Conduct emails add the version, e.g. coc_resign:v3.
    email_key TEXT NOT NULL,
    outcome TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Committee member who sent it by hand; NULL for automatic emails.
    sent_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_membership_email_log_user ON membership_email_log(user_id, email_key);

-- Members already able to book shouldn't be told they're ready to book.
INSERT INTO membership_email_log (user_id, email_key, outcome)
SELECT id, 'ready_to_book', 'backfilled' FROM users
WHERE induction_completed = TRUE AND code_of_conduct_signed = TRUE AND food_safety_completed = TRUE;

-- Existing rota members shouldn't be welcomed to the rota.
INSERT INTO membership_email_log (user_id, email_key, outcome)
SELECT id, 'welcome_to_rota', 'backfilled' FROM users
WHERE induction_completed = TRUE AND code_of_conduct_signed = TRUE AND food_safety_completed = TRUE
  AND supervised_shift_completed = TRUE;

-- Only Code of Conduct versions published from now on prompt a re-sign email.
INSERT INTO membership_email_log (user_id, email_key, outcome)
SELECT id, 'coc_resign:v' || (SELECT MAX(version) FROM coc_versions), 'backfilled' FROM users
WHERE code_of_conduct_version IS NOT NULL;
