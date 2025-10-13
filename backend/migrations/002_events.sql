-- Events table
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT NOT NULL  -- ISO date: "2025-10-15"
);

-- Index for faster date lookups
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
