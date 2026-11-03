use axum::{
    extract::{State, Path},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{NaiveDate, Datelike};
use icalendar::{Calendar, Component, Event as IcalEvent, EventLike};
use sqlx::FromRow;
use tracing::error;

use crate::ical::{ShiftIcalParams, create_shift_ical_event, shift_uid};
use crate::routes::auth::AppState;
use crate::slots::{shift_times, SLOT_TITLE_SQL};

#[derive(Debug, FromRow)]
struct Event {
    id: String,
    title: String,
    description: Option<String>,
    event_date: String,
    start_time: Option<String>,
    end_time: Option<String>,
}

#[derive(Debug, FromRow)]
struct BarHours {
    day_of_week: i32,
    open_time: String,
    close_time: String,
}

/// Get bar hours for a specific day of week (0=Sunday, 6=Saturday)
async fn get_bar_hours_for_day(state: &AppState, day_of_week: u32) -> Result<BarHours, String> {
    sqlx::query_as::<_, BarHours>("SELECT * FROM bar_hours WHERE day_of_week = ?")
        .bind(day_of_week as i32)
        .fetch_one(&state.db)
        .await
        .map_err(|e| format!("Failed to get bar hours: {}", e))
}

/// Generate iCal event with proper datetime handling
fn create_ical_event(
    event: &Event,
    bar_hours: &BarHours,
) -> Result<icalendar::Event, String> {
    let date = NaiveDate::parse_from_str(&event.event_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;

    // Use custom times if provided, otherwise use bar hours
    let start_time = event.start_time.as_deref().unwrap_or(&bar_hours.open_time);
    let end_time = event.end_time.as_deref().unwrap_or(&bar_hours.close_time);

    // Parse times
    let start_parts: Vec<&str> = start_time.split(':').collect();
    let end_parts: Vec<&str> = end_time.split(':').collect();

    if start_parts.len() != 2 || end_parts.len() != 2 {
        return Err("Invalid time format".to_string());
    }

    let start_hour: u32 = start_parts[0].parse().map_err(|_| "Invalid start hour")?;
    let start_min: u32 = start_parts[1].parse().map_err(|_| "Invalid start minute")?;
    let end_hour: u32 = end_parts[0].parse().map_err(|_| "Invalid end hour")?;
    let end_min: u32 = end_parts[1].parse().map_err(|_| "Invalid end minute")?;

    // Create start datetime
    let start_datetime = date.and_hms_opt(start_hour, start_min, 0)
        .ok_or("Invalid start datetime")?;

    // Handle end time crossing midnight
    let end_datetime = if end_time < start_time {
        // Crosses midnight - add one day
        let next_day = date.succ_opt().ok_or("Invalid end date")?;
        next_day.and_hms_opt(end_hour, end_min, 0)
            .ok_or("Invalid end datetime")?
    } else {
        date.and_hms_opt(end_hour, end_min, 0)
            .ok_or("Invalid end datetime")?
    };

    // Create iCal event
    let mut ical_event = IcalEvent::new();
    ical_event
        .summary(&event.title)
        .starts(start_datetime)
        .ends(end_datetime)
        .location("Wolfson College, Linton Road, Oxford OX2 6UD, UK");

    if let Some(desc) = &event.description {
        ical_event.description(desc);
    }

    ical_event.uid(&format!("wolfson-bar-{}", event.id));

    Ok(ical_event.done())
}

/// Get full calendar feed (all events)
pub async fn get_calendar_feed(
    State(state): State<AppState>,
) -> Result<Response, (StatusCode, String)> {
    // Fetch all future events
    let events = sqlx::query_as::<_, Event>(
        "SELECT id, title, description, event_date, start_time, end_time
         FROM events
         WHERE event_date >= date('now')
         ORDER BY event_date ASC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch events: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch events".to_string())
    })?;

    // Fetch all bar hours
    let bar_hours_list = sqlx::query_as::<_, BarHours>("SELECT * FROM bar_hours")
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to fetch bar hours: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch bar hours".to_string())
        })?;

    // Create calendar
    let mut calendar = Calendar::new();
    calendar
        .name("Wolfson Cellar Bar Events")
        .description("Events at Wolfson College Cellar Bar");

    // Add each event
    for event in events {
        let date = NaiveDate::parse_from_str(&event.event_date, "%Y-%m-%d")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid date: {}", e)))?;

        let day_of_week = date.weekday().num_days_from_sunday();

        let bar_hours = bar_hours_list
            .iter()
            .find(|h| h.day_of_week == day_of_week as i32)
            .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Bar hours not found".to_string()))?;

        let ical_event = create_ical_event(&event, bar_hours)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create event: {}", e)))?;

        calendar.push(ical_event);
    }

    // Generate iCal string
    let ical_string = calendar.to_string();

    Ok((
        [(header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
         (header::CONTENT_DISPOSITION, "attachment; filename=\"frontend.ics\"")],
        ical_string,
    ).into_response())
}

/// Download single event as iCal
pub async fn download_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    // Fetch event
    let event = sqlx::query_as::<_, Event>(
        "SELECT id, title, description, event_date, start_time, end_time
         FROM events
         WHERE id = ?"
    )
    .bind(&event_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| (StatusCode::NOT_FOUND, "Event not found".to_string()))?;

    // Get bar hours for this event's day
    let date = NaiveDate::parse_from_str(&event.event_date, "%Y-%m-%d")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid date: {}", e)))?;

    let day_of_week = date.weekday().num_days_from_sunday();
    let bar_hours = get_bar_hours_for_day(&state, day_of_week)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Create calendar with single event
    let mut calendar = Calendar::new();
    calendar.name("Wolfson Cellar Bar Event");

    let ical_event = create_ical_event(&event, &bar_hours)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create event: {}", e)))?;

    calendar.push(ical_event);

    // Generate iCal string
    let ical_string = calendar.to_string();
    // Only [a-z0-9-] from the title: quotes or non-ASCII would break the header.
    let slug: String = event
        .title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let filename = format!("frontend-{}.ics", slug.trim_matches('-'));

    Ok((
        [(header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
         (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename).as_str())],
        ical_string,
    ).into_response())
}

/// Former personal feed URL, keyed by user id. Other members can see user
/// ids, so it no longer serves shifts: subscribers get a single event telling
/// them to subscribe again from My Shifts.
pub async fn get_user_calendar_legacy(Path(_user_id): Path<String>) -> Response {
    let mut calendar = Calendar::new();
    calendar.name("Wolfson Bar - My Shifts");
    let today = chrono::Utc::now().date_naive();
    let mut notice = IcalEvent::new();
    notice
        .summary("Wolfson Bar: please re-subscribe to your shift calendar")
        .description("Your shift calendar has a new private link. Open My Shifts on the Wolfson Cellar Bar site and press Subscribe again.")
        .all_day(today)
        .uid("wolfson-bar-calendar-moved");
    calendar.push(notice.done());
    ([(header::CONTENT_TYPE, "text/calendar; charset=utf-8")], calendar.to_string()).into_response()
}

/// A member's personal shift calendar feed, keyed by their private calendar token.
pub async fn get_user_calendar(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let user_id: String = sqlx::query_scalar("SELECT id FROM users WHERE calendar_token = ?")
        .bind(&token)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to look up calendar token: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Calendar not found".to_string()))?;

    // Get user's shifts (today onwards)
    let mut conn = state.db.acquire().await.map_err(|e| {
        error!("❌ Failed to acquire connection: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;
    let shifts: Vec<(String, String, Option<String>)> = sqlx::query_as(&format!(
        "SELECT ss.shift_date, ss.slot, {SLOT_TITLE_SQL} as event_title
         FROM shift_signups ss
         WHERE ss.user_id = ?
         AND ss.shift_date >= date('now')
         ORDER BY ss.shift_date ASC"
    ))
    .bind(&user_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch user shifts: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch shifts".to_string())
    })?;

    // Create calendar
    let mut calendar = Calendar::new();
    calendar.name("Wolfson Bar - My Shifts");

    // Add each shift as an event using shared helper
    for (shift_date, slot, event_title) in shifts {
        let (open_time, close_time) = shift_times(&mut conn, &shift_date, &slot)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get shift times: {}", e)))?
            .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, format!("No opening hours for {}", shift_date)))?;

        let params = ShiftIcalParams {
            uid: shift_uid(&user_id, &shift_date, &slot),
            shift_date,
            event_title,
            open_time,
            close_time,
        };

        let ical_event = create_shift_ical_event(&params)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create event: {}", e)))?;

        calendar.push(ical_event);
    }

    // Generate iCal string
    let ical_string = calendar.to_string();

    Ok((
        [(header::CONTENT_TYPE, "text/calendar; charset=utf-8")],
        ical_string,
    ).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routes::users::{get_calendar_token, reset_calendar_token};
    use crate::auth::AuthenticatedUser;
    use crate::test_util::{insert_shift_signup, insert_user, test_state, user_with};
    use axum::Json;

    async fn body(res: Response) -> String {
        String::from_utf8(axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap().to_vec()).unwrap()
    }

    // Impact: other members can see a member's user id, so a feed keyed by it
    // let them follow that member's schedule indefinitely.
    // Should: serve a member's shifts only at their private calendar token.
    // Should not: serve shifts at the old user-id feed address.
    #[tokio::test]
    async fn feed_is_served_by_private_token_only() {
        let state = test_state().await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        let tomorrow = (chrono::Utc::now() + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        insert_shift_signup(&state.db, &member.id, &tomorrow).await;

        let Json(token) = get_calendar_token(State(state.clone()), AuthenticatedUser(member.clone())).await.unwrap();
        let feed = body(get_user_calendar(State(state.clone()), Path(token.token)).await.unwrap()).await;
        assert!(feed.contains("SUMMARY:Bar Shift"), "{feed}");

        let legacy = body(get_user_calendar_legacy(Path(member.id.clone())).await).await;
        assert!(!legacy.contains("Bar Shift"), "{legacy}");
        assert!(legacy.contains("re-subscribe"), "{legacy}");
    }

    // Should: keep the same token across requests until it is reset.
    // Should not: serve the feed at a token that was reset.
    #[tokio::test]
    async fn reset_token_stops_the_old_feed() {
        let state = test_state().await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;

        let Json(first) = get_calendar_token(State(state.clone()), AuthenticatedUser(member.clone())).await.unwrap();
        let Json(again) = get_calendar_token(State(state.clone()), AuthenticatedUser(member.clone())).await.unwrap();
        assert_eq!(first.token, again.token);

        let Json(fresh) = reset_calendar_token(State(state.clone()), AuthenticatedUser(member.clone())).await.unwrap();
        assert_ne!(fresh.token, first.token);
        let (status, _) = get_user_calendar(State(state.clone()), Path(first.token)).await.expect_err("old token");
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(get_user_calendar(State(state), Path(fresh.token)).await.is_ok());
    }
}
