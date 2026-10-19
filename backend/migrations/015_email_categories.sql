-- Split email preferences into two categories. The existing
-- email_notifications_enabled column keeps its name (renaming it would let
-- 008's ADD COLUMN recreate it in seed-dummy.py's per-statement runner) and
-- now means "shift updates": shift and induction schedule emails.
-- email_membership covers onboarding and Code of Conduct emails; existing
-- members inherit their current choice, new members default to on.
--
-- On re-run the ALTER fails with "duplicate column" and the backend runner
-- skips the rest, so the copy only happens once.
ALTER TABLE users ADD COLUMN email_membership BOOLEAN DEFAULT TRUE;
UPDATE users SET email_membership = COALESCE(email_notifications_enabled, TRUE);
