use axum::{
    extract::{State, Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use tracing::{info, error};
use uuid::Uuid;

use crate::auth::CommitteeUser;
use crate::models::{ErrorResponse, Event};
use crate::routes::auth::AppState;
use crate::slots::merge_into_regular;

#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub title: String,
    pub description: Option<String>,
    pub event_date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
    pub staff_separately: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub event_date: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
    pub staff_separately: Option<bool>,
}

// Get events (public endpoint)
pub async fn get_events(
    State(state): State<AppState>,
    Query(params): Query<EventsQuery>,
) -> Result<Json<Vec<Event>>, (StatusCode, Json<ErrorResponse>)> {
    info!("📅 Fetching events with filters: {:?}", params);

    let events = match (params.start_date, params.end_date) {
        (Some(start_date), Some(end_date)) => {
            // Query with both start and end date
            info!("📅 Fetching events between {} and {}", start_date, end_date);
            sqlx::query_as::<_, Event>(
                "SELECT * FROM events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date ASC"
            )
            .bind(&start_date)
            .bind(&end_date)
            .fetch_all(&state.db)
            .await
        }
        (Some(start_date), None) => {
            // Query with only start date (from start onwards)
            info!("📅 Fetching events from {} onwards", start_date);
            sqlx::query_as::<_, Event>(
                "SELECT * FROM events WHERE event_date >= ? ORDER BY event_date ASC"
            )
            .bind(&start_date)
            .fetch_all(&state.db)
            .await
        }
        (None, Some(end_date)) => {
            // Query with only end date (up to end)
            info!("📅 Fetching events up to {}", end_date);
            sqlx::query_as::<_, Event>(
                "SELECT * FROM events WHERE event_date <= ? ORDER BY event_date ASC"
            )
            .bind(&end_date)
            .fetch_all(&state.db)
            .await
        }
        (None, None) => {
            // No date filters - fetch all events
            info!("📅 Fetching all events");
            sqlx::query_as::<_, Event>(
                "SELECT * FROM events ORDER BY event_date ASC"
            )
            .fetch_all(&state.db)
            .await
        }
    }
    .map_err(|e| {
        error!("❌ Failed to fetch events: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch events".to_string(),
            }),
        )
    })?;

    info!("✅ Found {} events", events.len());

    Ok(Json(events))
}

// Get single event (public endpoint)
pub async fn get_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Result<Json<Event>, (StatusCode, Json<ErrorResponse>)> {
    info!("📅 Fetching event: {}", event_id);

    let event = sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = ?")
        .bind(&event_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch event: {}", e);
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Event not found".to_string(),
                }),
            )
        })?;

    Ok(Json(event))
}

/// Check an event's date and times. A separately-staffed event needs both
/// times, since they define its shift.
fn validate_event(event: &Event) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    fn bad(error: &str) -> (StatusCode, Json<ErrorResponse>) {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: error.to_string() }))
    }
    fn valid_time(t: &str) -> bool {
        t.len() == 5 && t.as_bytes()[2] == b':' &&
        t[..2].parse::<u8>().map_or(false, |h| h < 24) &&
        t[3..].parse::<u8>().map_or(false, |m| m < 60)
    }

    // Exactly YYYY-MM-DD: shifts match events on the date string.
    let canonical = chrono::NaiveDate::parse_from_str(&event.event_date, "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string());
    if canonical.as_deref() != Ok(event.event_date.as_str()) {
        return Err(bad("Invalid date format. Use YYYY-MM-DD"));
    }
    if event.start_time.as_deref().is_some_and(|t| !valid_time(t)) {
        return Err(bad("Invalid start_time format. Use HH:MM"));
    }
    if event.end_time.as_deref().is_some_and(|t| !valid_time(t)) {
        return Err(bad("Invalid end_time format. Use HH:MM"));
    }
    // Event text ends up in calendar files, file names and emails. Line breaks
    // are fine in a description; other control characters (e.g. a bare CR,
    // which splits iCal lines) aren't.
    if event.title.trim().is_empty() || event.title.chars().any(char::is_control) {
        return Err(bad("Title can't be empty or contain line breaks or control characters"));
    }
    if event
        .description
        .as_deref()
        .is_some_and(|d| d.chars().any(|c| c.is_control() && c != '\n' && c != '\t'))
    {
        return Err(bad("Description can't contain control characters"));
    }
    if event.staff_separately && (event.start_time.is_none() || event.end_time.is_none()) {
        return Err(bad("An event staffed as a separate shift needs a start and end time"));
    }
    Ok(())
}

fn internal(context: &str, e: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    error!("❌ {}: {}", context, e);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: context.to_string(),
        }),
    )
}

// Create event (committee only)
pub async fn create_event(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Json(req): Json<CreateEventRequest>,
) -> Result<Json<Event>, (StatusCode, Json<ErrorResponse>)> {
    info!("➕ Creating event: {}", req.title);

    let event = Event {
        id: Uuid::new_v4().to_string(),
        title: req.title,
        description: req.description.map(|d| d.replace("\r\n", "\n")),
        event_date: req.event_date,
        start_time: req.start_time,
        end_time: req.end_time,
        shift_max_volunteers: req.shift_max_volunteers,
        shift_requires_contract: req.shift_requires_contract,
        staff_separately: req.staff_separately.unwrap_or(false),
    };
    validate_event(&event)?;

    sqlx::query(
        "INSERT INTO events (id, title, description, event_date, start_time, end_time, shift_max_volunteers, shift_requires_contract, staff_separately) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&event.id)
    .bind(&event.title)
    .bind(&event.description)
    .bind(&event.event_date)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(event.shift_max_volunteers)
    .bind(event.shift_requires_contract)
    .bind(event.staff_separately)
    .execute(&state.db)
    .await
    .map_err(|e| internal("Failed to create event", e))?;

    info!("✅ Event created: {}", event.id);

    Ok(Json(event))
}

// Update event (committee only)
pub async fn update_event(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Path(event_id): Path<String>,
    Json(req): Json<UpdateEventRequest>,
) -> Result<Json<Event>, (StatusCode, Json<ErrorResponse>)> {
    info!("✏️ Updating event: {}", event_id);

    let mut tx = state.db.begin().await.map_err(|e| internal("Failed to update event", e))?;

    // Get existing event
    let mut event = sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = ?")
        .bind(&event_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| internal("Failed to fetch event", e))?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Event not found".to_string(),
                }),
            )
        })?;
    let was_separate_on = event.staff_separately.then(|| event.event_date.clone());

    // Update fields if provided
    if let Some(title) = req.title {
        event.title = title;
    }
    if let Some(description) = req.description {
        event.description = Some(description.replace("\r\n", "\n"));
    }
    if let Some(event_date) = req.event_date {
        event.event_date = event_date;
    }
    // start_time and end_time: always update (allows clearing by sending null)
    event.start_time = req.start_time;
    event.end_time = req.end_time;
    if req.shift_max_volunteers.is_some() {
        event.shift_max_volunteers = req.shift_max_volunteers;
    }
    if req.shift_requires_contract.is_some() {
        event.shift_requires_contract = req.shift_requires_contract;
    }
    if let Some(staff_separately) = req.staff_separately {
        event.staff_separately = staff_separately;
    }
    validate_event(&event)?;

    // Bookings on the event's own shift belong to the night it was on; once it
    // stops being that shift, they fall back to that night's regular shift.
    if was_separate_on.is_some_and(|date| !event.staff_separately || date != event.event_date) {
        merge_into_regular(&mut tx, &event_id)
            .await
            .map_err(|e| internal("Failed to move shift signups", e))?;
    }

    sqlx::query(
        "UPDATE events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, shift_max_volunteers = ?, shift_requires_contract = ?, staff_separately = ? WHERE id = ?"
    )
    .bind(&event.title)
    .bind(&event.description)
    .bind(&event.event_date)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(event.shift_max_volunteers)
    .bind(event.shift_requires_contract)
    .bind(event.staff_separately)
    .bind(&event_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| internal("Failed to update event", e))?;

    tx.commit().await.map_err(|e| internal("Failed to update event", e))?;

    info!("✅ Event updated: {}", event_id);

    Ok(Json(event))
}

// Delete event (committee only)
pub async fn delete_event(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Path(event_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("🗑️ Deleting event: {}", event_id);

    let mut tx = state.db.begin().await.map_err(|e| internal("Failed to delete event", e))?;

    merge_into_regular(&mut tx, &event_id)
        .await
        .map_err(|e| internal("Failed to move shift signups", e))?;

    sqlx::query("DELETE FROM events WHERE id = ?")
        .bind(&event_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| internal("Failed to delete event", e))?;

    tx.commit().await.map_err(|e| internal("Failed to delete event", e))?;

    info!("✅ Event deleted: {}", event_id);

    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{
        insert_separate_event, insert_slot_signup, insert_user, json_post, test_state, token_for, user_with,
        user_with_role,
    };
    use axum::routing::post;
    use axum::Router;
    use tower::ServiceExt;

    const NIGHT: &str = "2026-06-19";

    async fn slots_of(state: &AppState) -> Vec<(String, String)> {
        sqlx::query_as("SELECT slot, user_id FROM shift_signups WHERE shift_date = ? ORDER BY slot, user_id")
            .bind(NIGHT)
            .fetch_all(&state.db)
            .await
            .unwrap()
    }

    fn unflag() -> UpdateEventRequest {
        UpdateEventRequest {
            title: None,
            description: None,
            event_date: None,
            start_time: Some("18:30".to_string()),
            end_time: Some("21:00".to_string()),
            shift_max_volunteers: None,
            shift_requires_contract: None,
            staff_separately: Some(false),
        }
    }

    // Impact: event routes had no auth check, so anyone could create, edit or
    // delete events and now reshape the rota.
    // Should: refuse event creation from members who aren't on the committee.
    #[tokio::test]
    async fn non_committee_cannot_create_events() {
        let state = test_state().await;
        let member = user_with_role(false, false);
        insert_user(&state.db, &member).await;
        let app = Router::new().route("/api/admin/events", post(create_event)).with_state(state.clone());

        let res = app
            .oneshot(json_post(
                "/api/admin/events",
                serde_json::json!({ "title": "Party", "event_date": NIGHT }),
                Some(&token_for(&state, &member)),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    // Should: refuse a separately-staffed event without start and end times.
    #[tokio::test]
    async fn separate_shift_needs_times() {
        let state = test_state().await;
        let committee = user_with_role(true, false);
        let req = CreateEventRequest {
            title: "Party".to_string(),
            description: None,
            event_date: NIGHT.to_string(),
            start_time: Some("21:00".to_string()),
            end_time: None,
            shift_max_volunteers: None,
            shift_requires_contract: None,
            staff_separately: Some(true),
        };
        let (status, _) = create_event(State(state), CommitteeUser(committee), Json(req))
            .await
            .expect_err("missing end time");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // Impact: a bare carriage return in a title splits iCal lines, and quotes or
    // non-ASCII broke the download's file name.
    // Should: refuse event titles with line breaks or control characters.
    // Should: accept line breaks in a description, normalised to \n.
    #[tokio::test]
    async fn event_text_is_checked() {
        let state = test_state().await;
        let req = |title: &str, description: &str| CreateEventRequest {
            title: title.to_string(),
            description: Some(description.to_string()),
            event_date: NIGHT.to_string(),
            start_time: None,
            end_time: None,
            shift_max_volunteers: None,
            shift_requires_contract: None,
            staff_separately: None,
        };
        let committee = || CommitteeUser(user_with_role(true, false));

        let (status, _) = create_event(State(state.clone()), committee(), Json(req("Party\rX-EVIL:1", "")))
            .await
            .expect_err("control character in title");
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let Json(event) = create_event(State(state), committee(), Json(req("Café night", "Line one\r\nLine two")))
            .await
            .unwrap();
        assert_eq!(event.description.as_deref(), Some("Line one\nLine two"));
    }

    // Impact: unflagging must not silently drop members' bookings for that night.
    // Should: move bookings on an unflagged event's shift onto the night's regular shift.
    // Should not: double-book a member who was already on the regular shift.
    #[tokio::test]
    async fn unflagging_moves_bookings_to_the_regular_shift() {
        let state = test_state().await;
        insert_separate_event(&state.db, "early", NIGHT, "18:30", "21:00", None).await;
        let (a, b) = (user_with(true, true, true, true), user_with(true, true, true, true));
        insert_user(&state.db, &a).await;
        insert_user(&state.db, &b).await;
        insert_slot_signup(&state.db, &a.id, NIGHT, "early").await;
        insert_slot_signup(&state.db, &b.id, NIGHT, "early").await;
        insert_slot_signup(&state.db, &b.id, NIGHT, "").await;

        let _ = update_event(
            State(state.clone()),
            CommitteeUser(user_with_role(true, false)),
            Path("early".to_string()),
            Json(unflag()),
        )
        .await
        .unwrap();

        let mut expected = vec![(String::new(), a.id.clone()), (String::new(), b.id.clone())];
        expected.sort();
        assert_eq!(slots_of(&state).await, expected);
    }

    // Should: move bookings onto the regular shift when a separately-staffed event is deleted.
    #[tokio::test]
    async fn deleting_moves_bookings_to_the_regular_shift() {
        let state = test_state().await;
        insert_separate_event(&state.db, "early", NIGHT, "18:30", "21:00", None).await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        insert_slot_signup(&state.db, &member.id, NIGHT, "early").await;

        delete_event(State(state.clone()), CommitteeUser(user_with_role(true, false)), Path("early".to_string()))
            .await
            .unwrap();

        assert_eq!(slots_of(&state).await, [(String::new(), member.id.clone())]);
    }
}
