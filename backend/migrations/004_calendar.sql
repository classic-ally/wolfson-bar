-- Bar opening hours by day of week
CREATE TABLE IF NOT EXISTS bar_hours (
    day_of_week INTEGER PRIMARY KEY, -- 0=Sunday, 1=Monday, ..., 6=Saturday
    open_time TEXT NOT NULL,         -- "20:00" format
    close_time TEXT NOT NULL         -- "23:00" or "02:00" (can cross midnight)
);

-- Add optional custom times to events
ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;

-- Seed default bar hours
-- Sunday-Thursday: 20:00-23:00
INSERT OR REPLACE INTO bar_hours (day_of_week, open_time, close_time) VALUES
    (0, '20:00', '23:00'), -- Sunday
    (1, '20:00', '23:00'), -- Monday
    (2, '20:00', '23:00'), -- Tuesday
    (3, '20:00', '23:00'), -- Wednesday
    (4, '20:00', '23:00'); -- Thursday

-- Friday-Saturday: 20:30-02:00
INSERT OR REPLACE INTO bar_hours (day_of_week, open_time, close_time) VALUES
    (5, '20:30', '02:00'), -- Friday
    (6, '20:30', '02:00'); -- Saturday
