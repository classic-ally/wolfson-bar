#!/usr/bin/env python3
"""Seed wolfson_bar.db with dummy users, events, shifts, and magic-link tokens
so a developer can walk the entire UI without doing real signups.

Run after the backend has created the database (the regular start.sh runs
migrations on first boot). Re-run any time — it wipes dummy rows (id prefix
`dummy-`) and reinserts with fresh magic-link timestamps.

Magic-link tokens expire 15 minutes after creation, so re-run this script
whenever you want a fresh window. See SIGNIN_URLS printed at the end.
"""

from __future__ import annotations

import argparse
import os
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Deterministic randomness so re-runs produce the same shift distribution.
random.seed(42)

# Default DB path matches the launch/start scripts: repo-root wolfson_bar.db.
# Override via $DATABASE_PATH (preferred — same env var the backend reads) or
# --db on the command line.
_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = Path(os.environ.get("DATABASE_PATH", _REPO_ROOT / "wolfson_bar.db"))
MIGRATIONS_DIR = Path(__file__).parent / "migrations"
DUMMY_PREFIX = "dummy-"

# Errors we tolerate while applying migrations standalone — these match
# backend/src/db.rs's allowlist for the same migrations.
MIGRATION_ALLOWED_ERRORS = ("duplicate column", "already exists")


# -- Users -------------------------------------------------------------------
# (id_suffix, display_name, email, role, onboarding)
# role: 'admin' | 'committee' | 'member' | 'pre_induction' | 'pending_cert'
USERS = [
    ("allison", "Allison Bentley",  "allison@example.test",  "admin",         "full"),
    ("morgan",  "Morgan Steward",   "morgan@example.test",   "admin",         "full"),
    ("jess",    "Jess Treasurer",   "jess@example.test",     "committee",     "full"),
    ("kai",     "Kai Welfare",      "kai@example.test",      "committee",     "full"),
    ("priya",   "Priya Social",     "priya@example.test",    "committee",     "full"),
    ("sam",     "Sam Member",       "sam@example.test",      "member",        "full"),
    ("riley",   "Riley Member",     "riley@example.test",    "member",        "full"),
    ("alex",    "Alex Member",      "alex@example.test",     "member",        "full"),
    ("blair",   "Blair Member",     "blair@example.test",    "member",        "full"),
    ("dana",    "Dana Member",      "dana@example.test",     "member",        "no_contract"),
    ("noor",    "Noor Newbie",      "noor@example.test",     "pre_induction", "pre_induction"),
    ("luca",    "Luca Newbie",      "luca@example.test",     "pre_induction", "pre_induction"),
    ("eve",     "Eve Halfway",      "eve@example.test",      "member",        "pending_cert"),
]

# -- Events ------------------------------------------------------------------
# (offset_days_from_today, title, description, start, end, requires_contract)
EVENT_TEMPLATES = [
    (-7,  "Karaoke Night",          None,                 "20:00", "23:00", False),
    (-3,  "Quiz Night",              "Weekly pub quiz",    "20:00", "22:30", False),
    ( 1,  "Open Mic",                None,                 "20:00", "22:30", False),
    ( 3,  "Bop: Y2K Throwback",      "Big paid event",     "21:30", "01:30", True),
    ( 4,  "Live Music — The Wolftones", None,              "20:00", "23:00", True),
    ( 7,  "Quiz Night",              "Weekly pub quiz",    "20:00", "22:30", False),
    (10,  "Halfway Hall Afterparty", "Paid: 2nd-years",    "22:00", "02:00", True),
    (14,  "Quiz Night",              "Weekly pub quiz",    "20:00", "22:30", False),
    (17,  "Pub Crawl Finish",        None,                 "21:00", "23:00", False),
    (21,  "Quiz Night",              "Weekly pub quiz",    "20:00", "22:30", False),
    (24,  "Bop: Glow Night",         "Big paid event",     "21:30", "01:30", True),
    (28,  "Quiz Night",              "Weekly pub quiz",    "20:00", "22:30", False),
    (35,  "Cellar Sessions Acoustic", None,                "20:00", "22:00", False),
    (42,  "Bop: End of Term",        "Big paid event",     "21:30", "01:30", True),
]

# -- Shift fill plan --------------------------------------------------------
# Distribution of bookings per day (signups vs max). The default max is 2 in
# constants.rs; we use the same so the UI matches production behaviour.
SHIFT_FILL_WEIGHTS = {
    "empty":   0.25,  # 0/2 — red
    "partial": 0.45,  # 1/2 — amber
    "full":    0.25,  # 2/2 — grey + strikethrough
    "skip":    0.05,  # no signups, but date still appears as an empty shift slot
}


# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", type=Path, default=DEFAULT_DB,
                   help=f"path to the SQLite DB (default: {DEFAULT_DB})")
    p.add_argument("--public-url", default="http://localhost:3000",
                   help="origin used to print sign-in URLs (default: %(default)s)")
    return p.parse_args()


def _split_statements(sql: str):
    """Yield complete SQL statements one at a time. Uses sqlite3's own
    statement-completeness check so BEGIN ... END trigger bodies stay
    intact (a naive split-on-';' would chop those in half)."""
    buf = ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if stmt:
                yield stmt
            buf = ""
    tail = buf.strip()
    if tail:
        yield tail


def ensure_schema(con: sqlite3.Connection) -> None:
    """Apply backend/migrations/*.sql in order so we don't depend on the
    Rust binary having been started yet. start.sh only seeds 001_init.sql;
    everything else only runs once `cargo run` boots the server. This makes
    the script self-contained."""
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        for stmt in _split_statements(path.read_text()):
            try:
                con.execute(stmt)
            except sqlite3.OperationalError as e:
                msg = str(e).lower()
                if any(allow in msg for allow in MIGRATION_ALLOWED_ERRORS):
                    continue
                raise
        con.commit()


def wipe_dummies(con: sqlite3.Connection) -> None:
    cur = con.cursor()
    # FK CASCADE on user_id wipes shift_signups, induction_availability,
    # induction_signups, magic-link-state. Events have no FK to users so we
    # delete them by id prefix.
    cur.execute("DELETE FROM users WHERE id LIKE ?", (DUMMY_PREFIX + "%",))
    cur.execute("DELETE FROM events WHERE id LIKE ?", (DUMMY_PREFIX + "%",))
    cur.execute("DELETE FROM magic_link_tokens WHERE token LIKE ?", (DUMMY_PREFIX + "%",))
    con.commit()


def seed_users(con: sqlite3.Connection) -> list[dict]:
    cur = con.cursor()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S+00:00")
    members: list[dict] = []
    for suffix, name, email, role, onboarding in USERS:
        uid = DUMMY_PREFIX + suffix
        is_committee = role in ("admin", "committee")
        is_admin = role == "admin"
        # Onboarding state
        coc = onboarding != "pre_induction"
        food = onboarding not in ("pre_induction", "pending_cert")
        induction = onboarding not in ("pre_induction",)
        supervised = induction
        has_contract = onboarding == "full"
        contract_expiry = "2026-10-31" if has_contract else None

        cur.execute(
            """
            INSERT INTO users (
                id, display_name, passkey_credential,
                is_committee, is_admin,
                code_of_conduct_signed, food_safety_completed,
                food_safety_certificate, food_safety_certificate_type,
                induction_completed, has_contract, contract_expiry_date,
                created_at, email, email_notifications_enabled,
                privacy_consent_given, supervised_shift_completed
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0, 1, ?)
            """,
            (uid, name, is_committee, is_admin, coc, food,
             induction, has_contract, contract_expiry, now, email, supervised),
        )
        members.append({
            "id": uid, "name": name, "email": email,
            "role": role, "onboarding": onboarding,
            "is_committee": is_committee, "is_admin": is_admin,
            "induction": induction, "has_contract": has_contract,
        })
    con.commit()
    return members


def seed_events(con: sqlite3.Connection) -> list[dict]:
    cur = con.cursor()
    today = date.today()
    events: list[dict] = []
    for i, (offset, title, desc, start, end, paid) in enumerate(EVENT_TEMPLATES):
        eid = f"{DUMMY_PREFIX}evt-{i:02d}"
        ev_date = (today + timedelta(days=offset)).isoformat()
        # The default max_volunteers is 2 (constants.rs). Paid events get
        # an override of 4 so the shift fills are visible.
        max_vols = 4 if paid else None
        cur.execute(
            """
            INSERT INTO events (
                id, title, description, event_date, start_time, end_time,
                shift_max_volunteers, shift_requires_contract
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (eid, title, desc, ev_date, start, end, max_vols, paid),
        )
        events.append({"id": eid, "date": ev_date, "paid": paid,
                       "max": max_vols or 2})
    con.commit()
    return events


def seed_shift_signups(
    con: sqlite3.Connection,
    members: list[dict],
    events: list[dict],
) -> None:
    """Distribute shift signups across the next 8 weeks for the full UI mix."""
    cur = con.cursor()
    today = date.today()
    bookable = [m for m in members if m["induction"]]
    contracted = [m for m in members if m["has_contract"] and m["induction"]]

    by_date = {e["date"]: e for e in events}

    def choose_fill_state() -> str:
        r = random.random()
        cum = 0.0
        for state, weight in SHIFT_FILL_WEIGHTS.items():
            cum += weight
            if r < cum:
                return state
        return "empty"

    for day_offset in range(-7, 56):
        d = today + timedelta(days=day_offset)
        ev = by_date.get(d.isoformat())
        max_vols = ev["max"] if ev else 2
        # Only contracted members can sign up for paid shifts.
        pool = contracted if (ev and ev["paid"]) else bookable
        if not pool:
            continue
        state = choose_fill_state()
        if state == "skip":
            continue
        n = {"empty": 0, "partial": 1, "full": max_vols}[state]
        if state == "partial" and max_vols > 2:
            n = random.randint(1, max_vols - 1)
        picks = random.sample(pool, min(n, len(pool)))
        for m in picks:
            cur.execute(
                "INSERT OR IGNORE INTO shift_signups (shift_date, user_id) VALUES (?, ?)",
                (d.isoformat(), m["id"]),
            )
    con.commit()


def seed_inductions(con: sqlite3.Connection, members: list[dict]) -> None:
    cur = con.cursor()
    today = date.today()
    committee = [m for m in members if m["is_committee"]]
    inductees = [m for m in members if not m["induction"]]

    # Two future induction dates, each with a committee member available.
    # First date also has an inductee signed up.
    avail_dates = [
        (today + timedelta(days=5)).isoformat(),
        (today + timedelta(days=12)).isoformat(),
    ]
    for d, comm in zip(avail_dates, committee[:2]):
        cur.execute(
            "INSERT OR IGNORE INTO induction_availability (shift_date, committee_user_id) VALUES (?, ?)",
            (d, comm["id"]),
        )

    if inductees:
        cur.execute(
            "INSERT OR IGNORE INTO induction_signups (shift_date, user_id, full_shift) VALUES (?, ?, ?)",
            (avail_dates[0], inductees[0]["id"], False),
        )
    con.commit()


def seed_magic_links(con: sqlite3.Connection, members: list[dict]) -> list[tuple[str, str]]:
    """Insert one usable magic-link token per dummy user.

    The token value is `dummy-link-{suffix}` so devs can paste it into the
    verify URL. The verify endpoint enforces a 15-minute age — re-run this
    script to refresh."""
    cur = con.cursor()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    links: list[tuple[str, str]] = []
    for m in members:
        suffix = m["id"].removeprefix(DUMMY_PREFIX)
        token = f"{DUMMY_PREFIX}link-{suffix}"
        token_id = f"{DUMMY_PREFIX}magic-{suffix}"
        cur.execute(
            """
            INSERT OR REPLACE INTO magic_link_tokens (
                id, email, token, created_at, used, ip_address
            ) VALUES (?, ?, ?, ?, 0, '127.0.0.1')
            """,
            (token_id, m["email"], token, now),
        )
        links.append((m["name"], token))
    con.commit()
    return links


def main() -> int:
    args = parse_args()
    if not args.db.exists():
        print(f"error: database not found at {args.db}. Boot the backend "
              f"first (./start.sh) so migrations run, then re-run me.",
              file=sys.stderr)
        return 1

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA foreign_keys = ON;")
    try:
        ensure_schema(con)
        wipe_dummies(con)
        members = seed_users(con)
        seed_events(con)
        # Build a thin event dict list for the signup planner.
        rows = con.execute(
            "SELECT id, event_date, shift_requires_contract, shift_max_volunteers "
            "FROM events WHERE id LIKE ?",
            (DUMMY_PREFIX + "%",),
        ).fetchall()
        events = [
            {"id": r[0], "date": r[1], "paid": bool(r[2]),
             "max": (r[3] if r[3] is not None else 2)}
            for r in rows
        ]
        seed_shift_signups(con, members, events)
        seed_inductions(con, members)
        links = seed_magic_links(con, members)
    finally:
        con.close()

    print(f"Seeded {len(members)} users, {len(EVENT_TEMPLATES)} events, "
          f"and {len(links)} magic-link tokens (valid 15 min).\n")
    print("Sign-in URLs — paste any of these into the browser to log in:\n")
    for name, token in links:
        print(f"  {name:<22}  {args.public_url}/api/auth/magic-link/verify?token={token}")
    print("\nRe-run this script any time to refresh the 15-minute token window.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
