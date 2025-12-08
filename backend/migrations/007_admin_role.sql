-- Add admin role to users
-- Admins can manage other users (promote/demote/delete)
-- Existing committee members are promoted to admin on migration

ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- Promote existing committee members to admin
UPDATE users SET is_admin = TRUE WHERE is_committee = TRUE;
