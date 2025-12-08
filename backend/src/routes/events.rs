use axum::{
    extract::{State, Path, Query},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use uuid::Uuid;

use crate::models::{ErrorResponse, Event};
use crate::routes::auth::AppState;

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
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub event_date: Option<String>,
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
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

// Create event (committee only - validation done in main.rs middleware or here)
pub async fn create_event(
    State(state): State<AppState>,
    Json(req): Json<CreateEventRequest>,
) -> Result<Json<Event>, (StatusCode, Json<ErrorResponse>)> {
    info!("➕ Creating event: {}", req.title);

    // Validate date format (basic check)
    if req.event_date.len() != 10 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid date format. Use YYYY-MM-DD".to_string(),
            }),
        ));
    }

    let event_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO events (id, title, description, event_date, shift_max_volunteers, shift_requires_contract) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&event_id)
    .bind(&req.title)
    .bind(&req.description)
    .bind(&req.event_date)
    .bind(&req.shift_max_volunteers)
    .bind(&req.shift_requires_contract)
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to create event: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to create event".to_string(),
            }),
        )
    })?;

    let event = Event {
        id: event_id,
        title: req.title,
        description: req.description,
        event_date: req.event_date,
        shift_max_volunteers: req.shift_max_volunteers,
        shift_requires_contract: req.shift_requires_contract,
    };

    info!("✅ Event created: {}", event.id);

    Ok(Json(event))
}

// Update event (committee only)
pub async fn update_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Json(req): Json<UpdateEventRequest>,
) -> Result<Json<Event>, (StatusCode, Json<ErrorResponse>)> {
    info!("✏️ Updating event: {}", event_id);

    // Get existing event
    let mut event = sqlx::query_as::<_, Event>("SELECT * FROM events WHERE id = ?")
        .bind(&event_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Event not found: {}", e);
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Event not found".to_string(),
                }),
            )
        })?;

    // Update fields if provided
    if let Some(title) = req.title {
        event.title = title;
    }
    if let Some(description) = req.description {
        event.description = Some(description);
    }
    if let Some(event_date) = req.event_date {
        event.event_date = event_date;
    }
    if req.shift_max_volunteers.is_some() {
        event.shift_max_volunteers = req.shift_max_volunteers;
    }
    if req.shift_requires_contract.is_some() {
        event.shift_requires_contract = req.shift_requires_contract;
    }

    sqlx::query(
        "UPDATE events SET title = ?, description = ?, event_date = ?, shift_max_volunteers = ?, shift_requires_contract = ? WHERE id = ?"
    )
    .bind(&event.title)
    .bind(&event.description)
    .bind(&event.event_date)
    .bind(&event.shift_max_volunteers)
    .bind(&event.shift_requires_contract)
    .bind(&event_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to update event: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to update event".to_string(),
            }),
        )
    })?;

    info!("✅ Event updated: {}", event_id);

    Ok(Json(event))
}

// Delete event (committee only)
pub async fn delete_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("🗑️ Deleting event: {}", event_id);

    sqlx::query("DELETE FROM events WHERE id = ?")
        .bind(&event_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to delete event: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to delete event".to_string(),
                }),
            )
        })?;

    info!("✅ Event deleted: {}", event_id);

    Ok(StatusCode::OK)
}
