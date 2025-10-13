use axum::{
    extract::{State, Path, Query},
    http::{StatusCode, HeaderMap},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use ts_rs::TS;

use crate::auth::extract_user_id_from_header;
use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;
use crate::constants::{DEFAULT_SHIFT_MAX_VOLUNTEERS, DEFAULT_SHIFT_REQUIRES_CONTRACT};

#[derive(Debug, Deserialize)]
pub struct ShiftsQuery {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct ShiftSignupUser {
    pub user_id: String,
    pub display_name: Option<String>,
    pub is_committee: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct ShiftInfo {
    pub date: String,
    pub event_title: Option<String>,
    pub event_description: Option<String>,
    pub max_volunteers: i32,
    pub requires_contract: bool,
    pub signups_count: i32,
    pub signups: Vec<ShiftSignupUser>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct UserShift {
    pub date: String,
    pub event_title: Option<String>,
}

// Helper function to extract user ID from auth token
fn get_user_id_from_headers(headers: &HeaderMap) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok());

    extract_user_id_from_header(auth_header).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Not authenticated".to_string(),
            }),
        )
    })
}

// Get shift information for a date range (authenticated)
pub async fn get_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ShiftsQuery>,
) -> Result<Json<Vec<ShiftInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let _user_id = get_user_id_from_headers(&headers)?;

    info!("📋 Fetching shifts from {} to {}", params.start_date, params.end_date);

    // Generate all dates in range
    let start = chrono::NaiveDate::parse_from_str(&params.start_date, "%Y-%m-%d")
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Invalid start_date format".to_string(),
                }),
            )
        })?;

    let end = chrono::NaiveDate::parse_from_str(&params.end_date, "%Y-%m-%d")
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Invalid end_date format".to_string(),
                }),
            )
        })?;

    let mut shifts = Vec::new();
    let mut current_date = start;

    while current_date <= end {
        let date_str = current_date.format("%Y-%m-%d").to_string();

        // Get all events for this date (may be multiple)
        #[derive(sqlx::FromRow)]
        struct EventRow {
            title: String,
            description: Option<String>,
            shift_max_volunteers: Option<i32>,
            shift_requires_contract: Option<bool>,
        }

        let events = sqlx::query_as::<_, EventRow>(
            "SELECT title, description, shift_max_volunteers, shift_requires_contract
             FROM events WHERE event_date = ?
             ORDER BY title ASC"
        )
        .bind(&date_str)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch events: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch events".to_string(),
                }),
            )
        })?;

        // Get signups for this date
        #[derive(sqlx::FromRow)]
        struct SignupRow {
            user_id: String,
            display_name: Option<String>,
            is_committee: bool,
        }

        let signups = sqlx::query_as::<_, SignupRow>(
            "SELECT ss.user_id, u.display_name, u.is_committee
             FROM shift_signups ss
             JOIN users u ON ss.user_id = u.id
             WHERE ss.shift_date = ?"
        )
        .bind(&date_str)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch signups: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch signups".to_string(),
                }),
            )
        })?;

        // Combine event info - use highest requirements
        let mut max_volunteers = DEFAULT_SHIFT_MAX_VOLUNTEERS;
        let mut requires_contract = DEFAULT_SHIFT_REQUIRES_CONTRACT;
        let mut event_titles = Vec::new();
        let mut event_descriptions = Vec::new();

        for event in &events {
            event_titles.push(event.title.clone());
            if let Some(desc) = &event.description {
                event_descriptions.push(desc.clone());
            }

            // Use the highest max_volunteers if specified
            if let Some(event_max) = event.shift_max_volunteers {
                if event_max > max_volunteers {
                    max_volunteers = event_max;
                }
            }

            // If any event requires contract, the shift requires contract
            if let Some(true) = event.shift_requires_contract {
                requires_contract = true;
            }
        }

        // Combine event titles and descriptions
        let combined_title = if event_titles.is_empty() {
            None
        } else {
            Some(event_titles.join(" + "))
        };

        let combined_description = if event_descriptions.is_empty() {
            None
        } else {
            Some(event_descriptions.join(" | "))
        };

        shifts.push(ShiftInfo {
            date: date_str,
            event_title: combined_title,
            event_description: combined_description,
            max_volunteers,
            requires_contract,
            signups_count: signups.len() as i32,
            signups: signups
                .into_iter()
                .map(|s| ShiftSignupUser {
                    user_id: s.user_id,
                    display_name: s.display_name,
                    is_committee: s.is_committee,
                })
                .collect(),
        });

        current_date = current_date.succ_opt().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Date overflow".to_string(),
                }),
            )
        })?;
    }

    info!("✅ Fetched {} shifts", shifts.len());
    Ok(Json(shifts))
}

// Sign up for a shift (authenticated)
pub async fn signup_for_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id_from_headers(&headers)?;

    info!("➕ User {} signing up for shift on {}", user_id, date);

    // Validate date format
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Invalid date format".to_string(),
                }),
            )
        })?;

    // Get user to check eligibility
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch user: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch user".to_string(),
                }),
            )
        })?;

    // Check if user has completed code of conduct and food safety (minimum requirement)
    if !user.code_of_conduct_signed || !user.food_safety_completed {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "You must complete the code of conduct and food safety training before signing up for shifts".to_string(),
            }),
        ));
    }

    // If not fully inducted, can only sign up for shifts with committee members
    if !user.induction_completed {
        // Check if any committee member is already signed up
        #[derive(sqlx::FromRow)]
        struct CommitteeCheckRow {
            committee_count: i32,
        }

        let committee_check = sqlx::query_as::<_, CommitteeCheckRow>(
            "SELECT COUNT(*) as committee_count
             FROM shift_signups ss
             JOIN users u ON ss.user_id = u.id
             WHERE ss.shift_date = ? AND u.is_committee = 1"
        )
        .bind(&date)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to check committee signups: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to check shift eligibility".to_string(),
                }),
            )
        })?;

        if committee_check.committee_count == 0 {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: "You must complete your induction before signing up for shifts. Induction shifts require a committee member to be present - please choose a shift where a committee member is already signed up.".to_string(),
                }),
            ));
        }
    }

    // Get all events for this date to check requirements (use highest)
    #[derive(sqlx::FromRow)]
    struct EventRequirements {
        shift_max_volunteers: Option<i32>,
        shift_requires_contract: Option<bool>,
    }

    let events = sqlx::query_as::<_, EventRequirements>(
        "SELECT shift_max_volunteers, shift_requires_contract
         FROM events WHERE event_date = ?"
    )
    .bind(&date)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch events: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch events".to_string(),
            }),
        )
    })?;

    // Use highest requirements from all events on this date
    let mut requires_contract = DEFAULT_SHIFT_REQUIRES_CONTRACT;
    let mut max_volunteers = DEFAULT_SHIFT_MAX_VOLUNTEERS;

    for event in &events {
        // Use the highest max_volunteers if specified
        if let Some(event_max) = event.shift_max_volunteers {
            if event_max > max_volunteers {
                max_volunteers = event_max;
            }
        }

        // If any event requires contract, the shift requires contract
        if let Some(true) = event.shift_requires_contract {
            requires_contract = true;
        }
    }

    // Check contract requirement
    if requires_contract && !user.has_contract {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "This shift requires a valid contract".to_string(),
            }),
        ));
    }

    // Check if shift is full
    #[derive(sqlx::FromRow)]
    struct CountRow {
        count: i32,
    }

    let current_signups = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM shift_signups WHERE shift_date = ?"
    )
    .bind(&date)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to count signups: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to count signups".to_string(),
            }),
        )
    })?;

    if current_signups.count >= max_volunteers {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: "This shift is already full".to_string(),
            }),
        ));
    }

    // Insert signup
    sqlx::query("INSERT INTO shift_signups (shift_date, user_id) VALUES (?, ?)")
        .bind(&date)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to create signup: {}", e);
            if e.to_string().contains("UNIQUE constraint failed") {
                (
                    StatusCode::CONFLICT,
                    Json(ErrorResponse {
                        error: "You are already signed up for this shift".to_string(),
                    }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to create signup".to_string(),
                    }),
                )
            }
        })?;

    info!("✅ User {} signed up for shift on {}", user_id, date);
    Ok(StatusCode::OK)
}

// Cancel shift signup (authenticated)
pub async fn cancel_shift_signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id_from_headers(&headers)?;

    info!("🗑️ User {} cancelling signup for shift on {}", user_id, date);

    let result = sqlx::query("DELETE FROM shift_signups WHERE shift_date = ? AND user_id = ?")
        .bind(&date)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to cancel signup: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to cancel signup".to_string(),
                }),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "You are not signed up for this shift".to_string(),
            }),
        ));
    }

    info!("✅ User {} cancelled signup for shift on {}", user_id, date);
    Ok(StatusCode::OK)
}

// Get user's upcoming shifts (authenticated)
pub async fn get_my_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<UserShift>>, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id_from_headers(&headers)?;

    info!("📋 Fetching shifts for user {}", user_id);

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    #[derive(sqlx::FromRow)]
    struct ShiftRow {
        shift_date: String,
        event_title: Option<String>,
    }

    let shifts = sqlx::query_as::<_, ShiftRow>(
        "SELECT ss.shift_date, e.title as event_title
         FROM shift_signups ss
         LEFT JOIN events e ON ss.shift_date = e.event_date
         WHERE ss.user_id = ? AND ss.shift_date >= ?
         ORDER BY ss.shift_date ASC"
    )
    .bind(&user_id)
    .bind(&today)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch user shifts: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch shifts".to_string(),
            }),
        )
    })?;

    let user_shifts: Vec<UserShift> = shifts
        .into_iter()
        .map(|s| UserShift {
            date: s.shift_date,
            event_title: s.event_title,
        })
        .collect();

    info!("✅ Found {} shifts for user {}", user_shifts.len(), user_id);
    Ok(Json(user_shifts))
}

// Admin: Remove user from shift (committee only)
pub async fn admin_remove_from_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((date, target_user_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let admin_user_id = get_user_id_from_headers(&headers)?;

    info!("🗑️ Admin {} removing user {} from shift on {}", admin_user_id, target_user_id, date);

    // Check if requesting user is committee
    let admin_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&admin_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch admin user: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to verify permissions".to_string(),
                }),
            )
        })?;

    if !admin_user.is_committee {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "Only committee members can remove users from shifts".to_string(),
            }),
        ));
    }

    let result = sqlx::query("DELETE FROM shift_signups WHERE shift_date = ? AND user_id = ?")
        .bind(&date)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to remove user from shift: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to remove user from shift".to_string(),
                }),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "User is not signed up for this shift".to_string(),
            }),
        ));
    }

    info!("✅ Admin {} removed user {} from shift on {}", admin_user_id, target_user_id, date);
    Ok(StatusCode::OK)
}
