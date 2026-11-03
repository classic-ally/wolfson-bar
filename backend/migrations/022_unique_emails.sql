-- Emails are compared exactly, so store them trimmed and lowercase, and allow
-- each address on one account only.
--
-- Safe to run on every start. If accounts already share an address, the index
-- can't be created: the runner logs a warning and tries again next start, while
-- the app refuses new duplicates in the meantime.
UPDATE users SET email = NULL WHERE trim(email) = '';
UPDATE users SET email = lower(trim(email)) WHERE email != lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);
