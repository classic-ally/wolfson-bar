-- Personal shift calendar feeds were keyed by user id, which other members
-- can see. Each member now gets a random token for their feed, which they can
-- reset; it's created the first time they ask for their feed link.
ALTER TABLE users ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);
