-- Users table with passkey credentials
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    passkey_credential TEXT NOT NULL,  -- JSON serialized Passkey
    is_committee BOOLEAN DEFAULT FALSE,
    code_of_conduct_signed BOOLEAN DEFAULT FALSE,
    food_safety_completed BOOLEAN DEFAULT FALSE,
    food_safety_certificate BLOB,  -- Max 5MB, kept for audit trail
    induction_completed BOOLEAN DEFAULT FALSE,
    has_contract BOOLEAN DEFAULT FALSE,
    contract_expiry_date TEXT,  -- ISO date: "2026-10-09"
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session storage for auth states (temporary, could use in-memory later)
CREATE TABLE IF NOT EXISTS auth_states (
    id TEXT PRIMARY KEY,
    state_type TEXT NOT NULL,  -- 'registration' or 'authentication'
    state_data TEXT NOT NULL,  -- JSON serialized state
    display_name TEXT,  -- For registration flow
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_states_created ON auth_states(created_at);
