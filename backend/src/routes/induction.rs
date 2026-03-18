use axum::{
    extract::{State, Path},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use ts_rs::TS;

use crate::auth::{AuthenticatedUser, CommitteeUser, AdminUser};
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

// ===== Induction Availability (Committee) =====

/// Committee member marks themselves available for induction on a date
pub async fn set_induction_availability(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid date format".to_string() })))?;

    // Only one committee member can run an induction per date (space limited)
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT committee_user_id FROM induction_availability WHERE shift_date = ?"
    )
    .bind(&date)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to check existing availability: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Database error".to_string() }))
    })?;

    if let Some((existing_id,)) = existing {
        if existing_id != user.id {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse { error: "Another committee member is already running an induction on this date".to_string() }),
            ));
        }
        // Already set by this user — idempotent, nothing to do
        return Ok(StatusCode::OK);
    }

    sqlx::query("INSERT INTO induction_availability (shift_date, committee_user_id) VALUES (?, ?)")
        .bind(&date)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to set induction availability: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to set availability".to_string() }))
        })?;

    info!("Committee member {} marked available for induction on {}", user.id, date);
    Ok(StatusCode::OK)
}

/// Committee member removes their induction availability
pub async fn remove_induction_availability(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Check for existing inductee signups before removing
    let inductee_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM induction_signups WHERE shift_date = ?"
    )
    .bind(&date)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0,));

    if inductee_count.0 > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: "Cannot remove availability: inductees are already signed up. Cancel their signups first.".to_string(),
            }),
        ));
    }

    sqlx::query("DELETE FROM induction_availability WHERE shift_date = ? AND committee_user_id = ?")
        .bind(&date)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to remove induction availability: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to remove availability".to_string() }))
        })?;

    info!("Committee member {} removed induction availability on {}", user.id, date);
    Ok(StatusCode::OK)
}

// ===== Induction Dates (Any Authenticated User) =====

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct InductionDateInductee {
    pub user_id: String,
    pub display_name: Option<String>,
    pub full_shift: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct InductionDate {
    pub date: String,
    pub has_full_shift_committee: bool,
    pub slots_remaining: i32,
    pub user_signed_up: bool,
    pub user_signed_up_full_shift: bool,
    pub inductees: Vec<InductionDateInductee>, // populated for committee members only
}

/// Get future dates with induction availability
pub async fn get_induction_dates(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<InductionDate>>, (StatusCode, Json<ErrorResponse>)> {
    #[derive(sqlx::FromRow)]
    struct AvailabilityRow {
        shift_date: String,
        committee_user_id: String,
    }

    let availability: Vec<AvailabilityRow> = sqlx::query_as(
        "SELECT shift_date, committee_user_id FROM induction_availability WHERE shift_date >= date('now') ORDER BY shift_date"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch induction dates: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to fetch induction dates".to_string() }))
    })?;

    // Get all shift signups for committee members to check full-shift availability
    let shift_signups: Vec<(String, String)> = sqlx::query_as(
        "SELECT ss.shift_date, ss.user_id FROM shift_signups ss
         JOIN users u ON ss.user_id = u.id
         WHERE u.is_committee = TRUE AND ss.shift_date >= date('now')"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let shift_signup_set: std::collections::HashSet<(String, String)> = shift_signups
        .into_iter()
        .collect();

    // Get induction signup counts per date
    let signup_counts: Vec<(String, i64)> = sqlx::query_as(
        "SELECT shift_date, COUNT(*) FROM induction_signups WHERE shift_date >= date('now') GROUP BY shift_date"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let count_map: std::collections::HashMap<String, i64> = signup_counts.into_iter().collect();

    // Get the current user's existing induction signup
    let user_signup: Option<(String, bool)> = sqlx::query_as(
        "SELECT shift_date, full_shift FROM induction_signups WHERE user_id = ?"
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    // For committee members, get inductee details per date
    let inductee_details: Vec<(String, String, Option<String>, bool)> = if user.is_committee {
        sqlx::query_as(
            "SELECT is2.shift_date, is2.user_id, u.display_name, is2.full_shift
             FROM induction_signups is2
             JOIN users u ON is2.user_id = u.id
             WHERE is2.shift_date >= date('now')
             ORDER BY is2.shift_date, u.display_name"
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut inductees_by_date: std::collections::HashMap<String, Vec<InductionDateInductee>> = std::collections::HashMap::new();
    for (date, uid, name, full) in inductee_details {
        inductees_by_date.entry(date).or_default().push(InductionDateInductee {
            user_id: uid,
            display_name: name,
            full_shift: full,
        });
    }

    // Group by date
    let mut date_map: std::collections::BTreeMap<String, InductionDate> = std::collections::BTreeMap::new();

    for row in &availability {
        let entry = date_map.entry(row.shift_date.clone()).or_insert(InductionDate {
            date: row.shift_date.clone(),
            has_full_shift_committee: false,
            slots_remaining: 4 - *count_map.get(&row.shift_date).unwrap_or(&0) as i32,
            user_signed_up: user_signup.as_ref().map_or(false, |(d, _)| d == &row.shift_date),
            user_signed_up_full_shift: user_signup.as_ref().map_or(false, |(d, f)| d == &row.shift_date && *f),
            inductees: inductees_by_date.remove(&row.shift_date).unwrap_or_default(),
        });

        // Check if this committee member is also signed up for the full shift
        if shift_signup_set.contains(&(row.shift_date.clone(), row.committee_user_id.clone())) {
            entry.has_full_shift_committee = true;
        }
    }

    Ok(Json(date_map.into_values().collect()))
}

// ===== Induction Signup (Inductee) =====

#[derive(Debug, Deserialize)]
pub struct InductionSignupRequest {
    pub full_shift: bool,
}

/// Inductee signs up for an induction session
pub async fn signup_for_induction(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(date): Path<String>,
    Json(req): Json<InductionSignupRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid date format".to_string() })))?;

    if user.induction_completed {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "You have already completed your induction".to_string() })));
    }

    // Only one induction signup at a time
    let existing_signup: Option<(String,)> = sqlx::query_as(
        "SELECT shift_date FROM induction_signups WHERE user_id = ?"
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let Some((existing_date,)) = existing_signup {
        if existing_date == date {
            return Err((StatusCode::CONFLICT, Json(ErrorResponse { error: "You are already signed up for this induction".to_string() })));
        } else {
            return Err((StatusCode::CONFLICT, Json(ErrorResponse {
                error: format!("You are already signed up for induction on {}. Cancel that signup first.", existing_date),
            })));
        }
    }

    // Check availability exists
    let avail_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM induction_availability WHERE shift_date = ?"
    )
    .bind(&date)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to check availability: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Database error".to_string() }))
    })?;

    if avail_count.0 == 0 {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "No induction available on this date".to_string() })));
    }

    // Check capacity (max 4)
    let current_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM induction_signups WHERE shift_date = ?"
    )
    .bind(&date)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0,));

    if current_count.0 >= 4 {
        return Err((StatusCode::CONFLICT, Json(ErrorResponse { error: "This induction session is full (max 4 inductees)".to_string() })));
    }

    // If full_shift requested, verify committee member is on the full shift
    if req.full_shift {
        let committee_on_shift: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM induction_availability ia
             JOIN shift_signups ss ON ia.shift_date = ss.shift_date AND ia.committee_user_id = ss.user_id
             WHERE ia.shift_date = ?"
        )
        .bind(&date)
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));

        if committee_on_shift.0 == 0 {
            return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: "No committee member is available for the full shift on this date. You can sign up for induction only.".to_string(),
            })));
        }
    }

    sqlx::query("INSERT INTO induction_signups (shift_date, user_id, full_shift) VALUES (?, ?, ?)")
        .bind(&date)
        .bind(&user.id)
        .bind(req.full_shift)
        .execute(&state.db)
        .await
        .map_err(|e| {
            if e.to_string().contains("UNIQUE constraint") {
                (StatusCode::CONFLICT, Json(ErrorResponse { error: "You are already signed up for this induction".to_string() }))
            } else {
                error!("Failed to create induction signup: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to sign up".to_string() }))
            }
        })?;

    info!("User {} signed up for induction on {} (full_shift: {})", user.id, date, req.full_shift);
    Ok(StatusCode::OK)
}

/// Inductee cancels their induction signup
pub async fn cancel_induction_signup(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(date): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let result = sqlx::query("DELETE FROM induction_signups WHERE shift_date = ? AND user_id = ?")
        .bind(&date)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to cancel induction signup: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to cancel signup".to_string() }))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "You are not signed up for this induction".to_string() })));
    }

    info!("User {} cancelled induction signup on {}", user.id, date);
    Ok(StatusCode::OK)
}

// ===== Admin: Mark Supervised Shift =====

/// Mark a user's supervised shift as complete (admin only)
pub async fn admin_mark_supervised(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("Admin {} marking supervised shift complete for user {}", admin.id, target_user_id);

    let result = sqlx::query("UPDATE users SET supervised_shift_completed = TRUE WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to mark supervised shift: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to mark supervised shift complete".to_string() }))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "User not found".to_string() })));
    }

    info!("Supervised shift marked complete for user {}", target_user_id);
    Ok(StatusCode::OK)
}

// ===== Committee: Pending Induction Approvals =====

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct PendingInductionApproval {
    pub shift_date: String,
    pub user_id: String,
    pub display_name: Option<String>,
    pub full_shift: bool,
}

/// Get past inductions that need approval (committee member's own dates)
pub async fn get_pending_induction_approvals(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Json<Vec<PendingInductionApproval>>, (StatusCode, Json<ErrorResponse>)> {
    let approvals: Vec<PendingInductionApproval> = sqlx::query_as::<_, (String, String, Option<String>, bool)>(
        "SELECT is2.shift_date, is2.user_id, u.display_name, is2.full_shift
         FROM induction_signups is2
         JOIN users u ON is2.user_id = u.id
         JOIN induction_availability ia ON is2.shift_date = ia.shift_date AND ia.committee_user_id = ?
         WHERE is2.shift_date < date('now')
         AND u.induction_completed = FALSE
         ORDER BY is2.shift_date DESC"
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch pending approvals: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to fetch approvals".to_string() }))
    })?
    .into_iter()
    .map(|(date, uid, name, full)| PendingInductionApproval {
        shift_date: date,
        user_id: uid,
        display_name: name,
        full_shift: full,
    })
    .collect();

    Ok(Json(approvals))
}
