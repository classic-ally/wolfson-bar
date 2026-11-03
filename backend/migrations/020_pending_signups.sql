-- Email sign-ups no longer create the account up front: the welcome link
-- carries the display name, and the account is created when it is redeemed,
-- so nobody can claim an address they can't read.
ALTER TABLE magic_link_tokens ADD COLUMN display_name TEXT;
