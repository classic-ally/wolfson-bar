//! Shift slots: the separately-staffed parts of a night.
//!
//! A night is one regular slot (`REGULAR_SLOT`, the bar's opening hours) unless
//! the committee flags an event as `staff_separately`. Each flagged event is
//! then its own slot, keyed by the event id, with its own times and staffing
//! rules. The regular slot shrinks to the opening hours the flagged events
//! leave uncovered, and disappears when they cover all of it, unless someone
//! is already booked on it.

use chrono::{Datelike, NaiveDate};
use sqlx::SqliteConnection;

use crate::constants::{DEFAULT_SHIFT_MAX_VOLUNTEERS, DEFAULT_SHIFT_REQUIRES_CONTRACT};

/// Slot key of the regular night shift. Flagged events use their event id.
pub const REGULAR_SLOT: &str = "";

/// SQL expression for the title of the slot a `shift_signups` row (aliased
/// `ss`) is on: the flagged event's title, or the night's other event titles.
pub const SLOT_TITLE_SQL: &str = "CASE WHEN ss.slot = '' THEN
        (SELECT group_concat(title, ' + ') FROM
            (SELECT title FROM events
             WHERE event_date = ss.shift_date AND NOT staff_separately
             ORDER BY title))
     ELSE (SELECT title FROM events WHERE id = ss.slot) END";

#[derive(Debug, Clone, PartialEq)]
pub struct Slot {
    pub key: String,
    pub title: Option<String>,
    pub description: Option<String>,
    /// `HH:MM`, bar-local. `None` when the night has no opening hours set.
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub max_volunteers: i32,
    pub requires_contract: bool,
}

/// An event on the night, as far as staffing is concerned.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SlotEvent {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
    pub staff_separately: bool,
}

fn minutes(t: &str) -> Option<u32> {
    let (h, m) = t.split_once(':')?;
    Some(h.parse::<u32>().ok()? * 60 + m.parse::<u32>().ok()?)
}

fn hhmm(mins: u32) -> String {
    let mins = mins % (24 * 60);
    format!("{:02}:{:02}", mins / 60, mins % 60)
}

/// Minutes from the night's midnight; an end at or before the start runs past
/// midnight, as with bar hours.
fn window(start: &str, end: &str) -> Option<(u32, u32)> {
    let (s, e) = (minutes(start)?, minutes(end)?);
    Some((s, if e <= s { e + 24 * 60 } else { e }))
}

/// The parts of `open..close` that `covered` leaves free, in order.
fn gaps((open, close): (u32, u32), covered: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut covered = covered.to_vec();
    covered.sort_unstable();
    let mut free = Vec::new();
    let mut cursor = open;
    for &(s, e) in &covered {
        if s > cursor {
            free.push((cursor, s.min(close)));
        }
        cursor = cursor.max(e);
        if cursor >= close {
            break;
        }
    }
    if cursor < close {
        free.push((cursor, close));
    }
    free.retain(|(s, e)| s < e);
    free
}

/// The slots of one night, ordered by start time.
pub fn build_slots(events: &[SlotEvent], bar_hours: Option<(&str, &str)>, regular_booked: bool) -> Vec<Slot> {
    let (flagged, regular): (Vec<&SlotEvent>, Vec<&SlotEvent>) =
        events.iter().partition(|e| e.staff_separately);

    let mut slots: Vec<(Option<u32>, Slot)> = flagged
        .iter()
        .map(|e| {
            let start = e.start_time.as_deref().and_then(minutes);
            let slot = Slot {
                key: e.id.clone(),
                title: Some(e.title.clone()),
                description: e.description.clone(),
                start_time: e.start_time.clone(),
                end_time: e.end_time.clone(),
                max_volunteers: e.shift_max_volunteers.unwrap_or(DEFAULT_SHIFT_MAX_VOLUNTEERS),
                requires_contract: e.shift_requires_contract.unwrap_or(DEFAULT_SHIFT_REQUIRES_CONTRACT),
            };
            (start, slot)
        })
        .collect();

    let bar_window = bar_hours.and_then(|(open, close)| window(open, close));
    let regular_window = match bar_window {
        Some(bar) => {
            let covered: Vec<(u32, u32)> = flagged
                .iter()
                .filter_map(|e| window(e.start_time.as_deref()?, e.end_time.as_deref()?))
                .collect();
            let free = gaps(bar, &covered);
            match (free.first(), free.last()) {
                (Some(first), Some(last)) => Some(Some((first.0, last.1))),
                _ if regular_booked => Some(Some(bar)),
                _ => None,
            }
        }
        None if flagged.is_empty() || regular_booked => Some(None),
        None => None,
    };

    if let Some(times) = regular_window {
        let mut titles: Vec<&str> = regular.iter().map(|e| e.title.as_str()).collect();
        titles.sort_unstable();
        let descriptions: Vec<&str> = regular.iter().filter_map(|e| e.description.as_deref()).collect();
        let slot = Slot {
            key: REGULAR_SLOT.to_string(),
            title: (!titles.is_empty()).then(|| titles.join(" + ")),
            description: (!descriptions.is_empty()).then(|| descriptions.join(" | ")),
            start_time: times.map(|(s, _)| hhmm(s)),
            end_time: times.map(|(_, e)| hhmm(e)),
            max_volunteers: regular
                .iter()
                .filter_map(|e| e.shift_max_volunteers)
                .fold(DEFAULT_SHIFT_MAX_VOLUNTEERS, i32::max),
            requires_contract: DEFAULT_SHIFT_REQUIRES_CONTRACT
                || regular.iter().any(|e| e.shift_requires_contract == Some(true)),
        };
        slots.push((times.map(|(s, _)| s), slot));
    }

    slots.sort_by_key(|(start, _)| *start);
    slots.into_iter().map(|(_, slot)| slot).collect()
}

/// Which of `candidates` (in start order) a check-in `now` minutes after the
/// night's midnight belongs to: the one running now, else the next to start,
/// else the last.
pub fn slot_at<'a>(candidates: &[&'a Slot], now: u32) -> Option<&'a Slot> {
    let window_of = |s: &Slot| window(s.start_time.as_deref()?, s.end_time.as_deref()?);
    candidates
        .iter()
        .find(|s| window_of(s).is_some_and(|(start, end)| start <= now && now < end))
        .or_else(|| candidates.iter().find(|s| window_of(s).is_some_and(|(start, _)| now < start)))
        .or_else(|| candidates.last())
        .copied()
}

/// Bar hours (`open_time`, `close_time`) for the night starting on `date`.
pub async fn bar_hours_for(conn: &mut SqliteConnection, date: NaiveDate) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT open_time, close_time FROM bar_hours WHERE day_of_week = ?")
        .bind(date.weekday().num_days_from_sunday() as i64)
        .fetch_optional(conn)
        .await
}

pub async fn events_on(conn: &mut SqliteConnection, date: &str) -> Result<Vec<SlotEvent>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, title, description, start_time, end_time,
                shift_max_volunteers, shift_requires_contract, staff_separately
         FROM events WHERE event_date = ?",
    )
    .bind(date)
    .fetch_all(conn)
    .await
}

/// The slots of the night starting on `date` (`YYYY-MM-DD`).
pub async fn load_slots(conn: &mut SqliteConnection, date: &str) -> Result<Vec<Slot>, sqlx::Error> {
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| sqlx::Error::Protocol(format!("invalid shift date {date}: {e}")))?;
    let events = events_on(&mut *conn, date).await?;
    let hours = bar_hours_for(&mut *conn, day).await?;
    let regular_booked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM shift_signups WHERE shift_date = ? AND slot = '')",
    )
    .bind(date)
    .fetch_one(&mut *conn)
    .await?;
    Ok(build_slots(&events, hours.as_ref().map(|(o, c)| (o.as_str(), c.as_str())), regular_booked))
}

/// Start and end of shift `key` on the night starting `date`, falling back to
/// the night's bar hours when that shift is no longer on the plan (e.g. its
/// event was deleted after a cancellation).
pub async fn shift_times(conn: &mut SqliteConnection, date: &str, key: &str) -> Result<Option<(String, String)>, sqlx::Error> {
    let slot = load_slots(&mut *conn, date).await?.into_iter().find(|s| s.key == key);
    if let Some(Slot { start_time: Some(start), end_time: Some(end), .. }) = slot {
        return Ok(Some((start, end)));
    }
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| sqlx::Error::Protocol(format!("invalid shift date {date}: {e}")))?;
    bar_hours_for(conn, day).await
}

/// Move everyone booked on a flagged event's slot onto the regular shift of
/// that night, e.g. when the event is unflagged, moved or deleted. Members
/// already on the regular shift keep their existing booking.
pub async fn merge_into_regular(conn: &mut SqliteConnection, event_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE OR IGNORE shift_signups SET slot = '' WHERE slot = ?")
        .bind(event_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM shift_signups WHERE slot = ?")
        .bind(event_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(id: &str, start: &str, end: &str, separate: bool) -> SlotEvent {
        SlotEvent {
            id: id.to_string(),
            title: id.to_string(),
            description: None,
            start_time: Some(start.to_string()),
            end_time: Some(end.to_string()),
            shift_max_volunteers: None,
            shift_requires_contract: None,
            staff_separately: separate,
        }
    }

    fn keys(slots: &[Slot]) -> Vec<&str> {
        slots.iter().map(|s| s.key.as_str()).collect()
    }

    const FRIDAY: Option<(&str, &str)> = Some(("20:30", "02:00"));

    fn at(h: u32, m: u32) -> u32 {
        h * 60 + m
    }

    // Should: give a night without flagged events a single regular shift over the opening hours.
    // Should: name the regular shift after the night's events.
    #[test]
    fn unflagged_night_is_one_regular_shift() {
        let slots = build_slots(&[event("Quiz", "20:00", "22:00", false)], FRIDAY, false);
        assert_eq!(keys(&slots), [REGULAR_SLOT]);
        assert_eq!(slots[0].title.as_deref(), Some("Quiz"));
        assert_eq!(slots[0].start_time.as_deref(), Some("20:30"));
        assert_eq!(slots[0].end_time.as_deref(), Some("02:00"));
    }

    // Impact: the committee request that prompted split shifts (18:30–21:00 then 21:00–02:00 on a Friday).
    // Should: offer each flagged event as its own shift, in start order.
    // Should not: offer a regular shift when the flagged events cover all opening hours.
    #[test]
    fn flagged_events_covering_the_night_replace_the_regular_shift() {
        let events = [event("late", "21:00", "02:00", true), event("early", "18:30", "21:00", true)];
        let slots = build_slots(&events, FRIDAY, false);
        assert_eq!(keys(&slots), ["early", "late"]);
    }

    // Should: keep a regular shift for the opening hours a flagged event leaves uncovered.
    #[test]
    fn partially_covered_night_keeps_the_remaining_hours() {
        let slots = build_slots(&[event("early", "18:30", "21:00", true)], FRIDAY, false);
        assert_eq!(keys(&slots), ["early", REGULAR_SLOT]);
        assert_eq!(slots[1].start_time.as_deref(), Some("21:00"));
        assert_eq!(slots[1].end_time.as_deref(), Some("02:00"));
    }

    // Impact: hiding a booked shift would strand members who signed up before the night was split.
    // Should: keep the regular shift while anyone is booked on it, even when fully covered.
    #[test]
    fn booked_regular_shift_stays_visible() {
        let events = [event("early", "18:30", "21:00", true), event("late", "21:00", "02:00", true)];
        let slots = build_slots(&events, FRIDAY, true);
        assert_eq!(keys(&slots), ["early", REGULAR_SLOT, "late"]);
    }

    // Should: take a flagged event's capacity and contract rule from the event alone.
    // Should not: let a flagged event raise the regular shift's capacity.
    #[test]
    fn staffing_rules_are_per_slot() {
        let mut flagged = event("party", "23:00", "02:00", true);
        flagged.shift_max_volunteers = Some(6);
        flagged.shift_requires_contract = Some(true);
        let slots = build_slots(&[flagged], FRIDAY, false);
        let (regular, party) = (&slots[0], &slots[1]);
        assert_eq!((party.max_volunteers, party.requires_contract), (6, true));
        assert_eq!(
            (regular.max_volunteers, regular.requires_contract),
            (DEFAULT_SHIFT_MAX_VOLUNTEERS, DEFAULT_SHIFT_REQUIRES_CONTRACT)
        );
    }

    // Should: pick the shift running at the time of a check-in.
    // Should: pick the next shift for an early check-in, and the last one after the night ends.
    #[test]
    fn check_in_lands_on_the_shift_running_now() {
        let events = [event("early", "18:30", "21:00", true), event("late", "21:00", "02:00", true)];
        let slots = build_slots(&events, FRIDAY, false);
        let all: Vec<&Slot> = slots.iter().collect();
        let key = |now| slot_at(&all, now).map(|s| s.key.as_str());
        assert_eq!(key(at(19, 0)), Some("early"));
        assert_eq!(key(at(21, 0)), Some("late"));
        assert_eq!(key(at(24 + 1, 0)), Some("late"));
        assert_eq!(key(at(17, 0)), Some("early"));
        assert_eq!(key(at(24 + 3, 0)), Some("late"));
    }
}
