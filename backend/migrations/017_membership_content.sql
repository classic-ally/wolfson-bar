-- Admin-editable content for membership emails and the onboarding checklist.
--
-- On re-run the CREATE TABLE IF NOT EXISTS statements are no-ops and the
-- seeds use INSERT OR IGNORE, so admin edits survive restarts.

-- Training links (e.g. the food safety course parts) shown on the onboarding
-- checklist and inserted into emails via {{food_safety_links}}.
CREATE TABLE IF NOT EXISTS training_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL
);

-- One row per membership email. Bodies are markdown with {{placeholders}}.
CREATE TABLE IF NOT EXISTS email_templates (
    key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Single-row settings for the membership email schedule.
-- stuck_reminder_days NULL turns the automatic reminder off.
CREATE TABLE IF NOT EXISTS onboarding_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    post_induction_delay_hours INTEGER NOT NULL DEFAULT 6,
    stuck_reminder_days INTEGER DEFAULT 7
);

-- Seed links only on the first run (the settings row is inserted last, below),
-- so links an admin deletes stay deleted across restarts.
INSERT INTO training_links (position, label, url)
SELECT 1, 'Food Safety Awareness, Part A', 'https://businesssafe.peninsula-online.com/ELearning/FoodSafetyAwarenessPartA/index.html#/'
WHERE NOT EXISTS (SELECT 1 FROM onboarding_settings)
UNION ALL
SELECT 2, 'Food Safety Awareness, Part B', 'https://businesssafe.peninsula-online.com/ELearning/FoodSafetyAwarenessPartB/index.html#/'
WHERE NOT EXISTS (SELECT 1 FROM onboarding_settings);

INSERT OR IGNORE INTO email_templates (key, subject, body) VALUES
('post_induction', 'Post Induction Formalities', 'Hi {{name}},

It was great to see you behind the bar last night for your induction. Here''s where you are with getting onto the rota:

{{next_steps}}

For the food safety training, complete both parts below and upload the certificate you get from Part B to the website:

{{food_safety_links}}

Once everything is completed and processed, your rota card will be issued and kept in your pidge and you''ll be able to sign up for shifts on the [calendar]({{calendar_url}}).

Your first shift will be with an experienced member of the bar to help you out.

Any questions then get in touch, but a big thank you for signing up and keeping our bar as active, cheap and independent as possible!

Thanks,
Wolfson College Bar Committee (''BarCo'')
Cellar Bar, Wolfson College, Linton Rd, Oxford, OX2 6UD'),

('ready_to_book', 'You''re ready to book your first bar shift', 'Hi {{name}},

Everything''s processed: you can now sign up for shifts on the [calendar]({{calendar_url}}).

Your first shift needs to be with a committee member so someone experienced can help you out. On the calendar, look for dates with a green **S**: those already have a committee member signed up.

Thanks,
Wolfson College Bar Committee (''BarCo'')'),

('welcome_to_rota', 'Welcome to the bar rota!', 'Hi {{name}},

You''ve completed your supervised shift, so you''re now a full rota member and can sign up for any shift on the [calendar]({{calendar_url}}).

A big thank you for keeping our bar as active, cheap and independent as possible!

Thanks,
Wolfson College Bar Committee (''BarCo'')'),

('stuck_reminder', 'A reminder to finish your bar onboarding', 'Hi {{name}},

Just a reminder that there are a few steps left before you can sign up for bar shifts:

{{next_steps}}

The food safety training is here; complete both parts and upload the certificate from Part B:

{{food_safety_links}}

You can see your progress on your [onboarding checklist]({{onboarding_url}}). Any questions then get in touch!

Thanks,
Wolfson College Bar Committee (''BarCo'')'),

('coc_resign', 'Please re-sign the updated Code of Conduct', 'Hi {{name}},

We''ve published an updated Code of Conduct for rota members. Please read and sign it on your [onboarding checklist]({{onboarding_url}}); until you do, you won''t be able to book or check in to shifts.

Thanks,
Wolfson College Bar Committee (''BarCo'')');

INSERT OR IGNORE INTO onboarding_settings (id) VALUES (1);
