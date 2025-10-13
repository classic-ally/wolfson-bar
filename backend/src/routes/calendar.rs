use axum::{
    extract::{State, Path},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{NaiveDate, Datelike};
use icalendar::{Calendar, Component, Event as IcalEvent, EventLike};
use sqlx::FromRow;
use tracing::error;

use crate::routes::auth::AppState;

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
    let filename = format!("frontend-{}.ics", event.title.replace(' ', "-").to_lowercase());

    Ok((
        [(header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
         (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename).as_str())],
        ical_string,
    ).into_response())
}

/// Get user's personal shift calendar feed (uses user_id as auth token)
pub async fn get_user_calendar(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    // Verify user exists
    let user_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to check user existence: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
        })?;

    if !user_exists {
        return Err((StatusCode::NOT_FOUND, "User not found".to_string()));
    }

    // Get user's shifts (today onwards)
    let shifts: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT shift_date,
                (SELECT title FROM events WHERE event_date = shift_date) as event_title
         FROM shift_signups
         WHERE user_id = ?
         AND shift_date >= date('now')
         ORDER BY shift_date ASC"
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch user shifts: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch shifts".to_string())
    })?;

    // Create calendar
    let mut calendar = Calendar::new();
    calendar.name("Wolfson Bar - My Shifts");

    // Add each shift as an event
    for (shift_date, event_title) in shifts {
        let date = NaiveDate::parse_from_str(&shift_date, "%Y-%m-%d")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid date: {}", e)))?;

        let day_of_week = date.weekday().num_days_from_sunday();
        let bar_hours = get_bar_hours_for_day(&state, day_of_week)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

        // Parse times
        let start_parts: Vec<&str> = bar_hours.open_time.split(':').collect();
        let end_parts: Vec<&str> = bar_hours.close_time.split(':').collect();

        let start_hour: u32 = start_parts[0].parse().unwrap_or(20);
        let start_min: u32 = start_parts[1].parse().unwrap_or(0);
        let end_hour: u32 = end_parts[0].parse().unwrap_or(23);
        let end_min: u32 = end_parts[1].parse().unwrap_or(0);

        let start_datetime = date.and_hms_opt(start_hour, start_min, 0).ok_or_else(|| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Invalid start datetime".to_string())
        })?;

        // Handle midnight crossover
        let end_datetime = if end_hour < start_hour {
            let next_day = date.succ_opt().ok_or_else(|| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Invalid end date".to_string())
            })?;
            next_day.and_hms_opt(end_hour, end_min, 0).ok_or_else(|| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Invalid end datetime".to_string())
            })?
        } else {
            date.and_hms_opt(end_hour, end_min, 0).ok_or_else(|| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Invalid end datetime".to_string())
            })?
        };

        let title = if let Some(event) = event_title {
            format!("Bar Shift - {}", event)
        } else {
            "Bar Shift".to_string()
        };

        let mut ical_event = IcalEvent::new();
        ical_event
            .summary(&title)
            .starts(start_datetime)
            .ends(end_datetime)
            .location("Wolfson College, Linton Road, Oxford OX2 6UD, UK");

        calendar.push(ical_event);
    }

    // Generate iCal string
    let ical_string = calendar.to_string();

    Ok((
        [(header::CONTENT_TYPE, "text/calendar; charset=utf-8")],
        ical_string,
    ).into_response())
}
