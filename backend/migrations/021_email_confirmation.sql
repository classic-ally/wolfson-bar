-- Members confirm an email address before it is set on their account: the
-- confirmation link is a magic link token for that address, naming the
-- account it is for.
ALTER TABLE magic_link_tokens ADD COLUMN user_id TEXT;
