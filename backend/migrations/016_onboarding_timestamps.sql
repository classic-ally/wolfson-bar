-- When each onboarding step happened, for the committee onboarding view and
-- the membership email schedule. Members who completed a step before this
-- migration keep NULL ("done, date unknown"), which also keeps the
-- post-induction email from going to everyone already inducted.
ALTER TABLE users ADD COLUMN induction_completed_at TEXT;
ALTER TABLE users ADD COLUMN food_safety_uploaded_at TEXT;
ALTER TABLE users ADD COLUMN food_safety_approved_at TEXT;
ALTER TABLE users ADD COLUMN supervised_shift_completed_at TEXT;
