use axum::{
    extract::{Query, State, Path},
    http::{StatusCode, header},
    Json,
    response::Response,
    body::Body,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use ts_rs::TS;

use crate::auth::{CommitteeUser, AdminUser};
use crate::models::{ErrorResponse, User, IS_ROTA_MEMBER_SQL};
use crate::routes::auth::{AppState, create_user_in_db};

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PendingCertificate {
    pub user_id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActiveMember {
    pub user_id: String,
    pub display_name: Option<String>,
    pub has_contract: bool,
    pub contract_expiry_date: Option<String>,
    pub is_committee: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PendingContract {
    pub user_id: String,
    pub display_name: Option<String>,
    pub contract_expiry_date: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UnallocatedMember {
    pub user_id: String,
    pub display_name: Option<String>,
    pub has_contract: bool,
    pub contract_expiry_date: Option<String>,
    /// Most recent shift_signups.shift_date for this user across all time, null if never.
    pub last_shift_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnallocatedQuery {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, sqlx::FromRow)]
struct UnallocatedRow {
    id: String,
    display_name: Option<String>,
    has_contract: bool,
    contract_expiry_date: Option<String>,
    last_shift_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerificationRequest {
    pub token: String,
}

// Get all pending food safety certificates (committee only)
pub async fn get_pending_certificates(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Json<Vec<PendingCertificate>>, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 Committee member {} fetching pending certificates", user.id);

    // Get users with uploaded but not approved certificates
    let pending_users = sqlx::query_as::<_, User>(
        "SELECT * FROM users
         WHERE food_safety_certificate IS NOT NULL
         AND food_safety_completed = FALSE"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch pending certificates: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch pending certificates".to_string(),
            }),
        )
    })?;

    let pending: Vec<PendingCertificate> = pending_users
        .into_iter()
        .map(|u| PendingCertificate {
            user_id: u.id,
            display_name: u.display_name,
        })
        .collect();

    info!("✅ Found {} pending certificates", pending.len());

    Ok(Json(pending))
}

// Get certificate image for a specific user (committee only)
pub async fn get_certificate(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Path(target_user_id): Path<String>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    info!("🖼️ Committee member {} viewing certificate for user {}", user.id, target_user_id);

    // Get target user's certificate
    let target_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to fetch target user: {}", e);
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "User not found".to_string(),
                }),
            )
        })?;

    let certificate_bytes = target_user.food_safety_certificate.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "No certificate found for this user".to_string(),
            }),
        )
    })?;

    // Use stored content type, or default to image/jpeg for legacy data
    let content_type = target_user.food_safety_certificate_type
        .unwrap_or_else(|| "image/jpeg".to_string());

    // Return file as response with correct content type
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(certificate_bytes))
        .unwrap())
}

// Approve food safety certificate (committee only)
pub async fn approve_certificate(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Committee member {} approving certificate for user {}", user.id, target_user_id);

    // Mark certificate as approved (keep BLOB for audit trail)
    sqlx::query("UPDATE users SET food_safety_completed = ? WHERE id = ?")
        .bind(true)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to approve certificate: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to approve certificate".to_string(),
                }),
            )
        })?;

    info!("🎉 Certificate approved for user: {}", target_user_id);

    Ok(StatusCode::OK)
}

// Verify induction via QR code (committee only)
pub async fn verify_induction(
    State(state): State<AppState>,
    CommitteeUser(committee_user): CommitteeUser,
    Json(body): Json<VerificationRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    use jsonwebtoken::{decode, DecodingKey, Validation};
    use crate::auth::Claims;

    // Parse token format "induction:JWT"
    let parts: Vec<&str> = body.token.split(':').collect();
    if parts.len() != 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid token format".to_string(),
            }),
        ));
    }

    let verification_type = parts[0];
    let jwt = parts[1];

    if verification_type != "induction" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid verification type".to_string(),
            }),
        ));
    }

    // Verify JWT and extract user_id
    let token_data = decode::<Claims>(
        jwt,
        &DecodingKey::from_secret(&state.jwt_secret),
        &Validation::default(),
    )
    .map_err(|e| {
        error!("❌ Failed to verify token: {}", e);
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Invalid or expired token".to_string(),
            }),
        )
    })?;

    let target_user_id = token_data.claims.sub;

    info!("✅ Committee member {} verifying induction for user {}", committee_user.id, target_user_id);

    // Mark induction as completed
    sqlx::query("UPDATE users SET induction_completed = ? WHERE id = ?")
        .bind(true)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to mark induction complete: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to verify induction".to_string(),
                }),
            )
        })?;

    info!("🎉 Induction verified for user: {}", target_user_id);

    Ok(StatusCode::OK)
}

// Get all active members (committee only)
pub async fn get_active_members(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Json<Vec<ActiveMember>>, (StatusCode, Json<ErrorResponse>)> {
    info!("👥 Committee member {} fetching active members", user.id);

    // Get users who are fully onboarded (active members)
    let active_users = sqlx::query_as::<_, User>(
        &format!(
            "SELECT * FROM users WHERE {} ORDER BY display_name ASC",
            IS_ROTA_MEMBER_SQL
        )
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch active members: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch active members".to_string(),
            }),
        )
    })?;

    let members: Vec<ActiveMember> = active_users
        .into_iter()
        .map(|u| ActiveMember {
            user_id: u.id,
            display_name: u.display_name,
            has_contract: u.has_contract,
            contract_expiry_date: u.contract_expiry_date,
            is_committee: u.is_committee,
        })
        .collect();

    info!("✅ Found {} active members", members.len());

    Ok(Json(members))
}

/// Get rota members with no shift signups in the requested date range.
/// Used by the Rota Manager page to surface allocation candidates.
pub async fn get_unallocated_users(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Query(params): Query<UnallocatedQuery>,
) -> Result<Json<Vec<UnallocatedMember>>, (StatusCode, Json<ErrorResponse>)> {
    chrono::NaiveDate::parse_from_str(&params.start_date, "%Y-%m-%d").map_err(|_| (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse { error: "Invalid start_date format".to_string() }),
    ))?;
    chrono::NaiveDate::parse_from_str(&params.end_date, "%Y-%m-%d").map_err(|_| (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse { error: "Invalid end_date format".to_string() }),
    ))?;

    let rows = sqlx::query_as::<_, UnallocatedRow>(&format!(
        "SELECT u.id, u.display_name, u.has_contract, u.contract_expiry_date,
                (SELECT MAX(shift_date) FROM shift_signups s WHERE s.user_id = u.id) AS last_shift_date
         FROM users u
         WHERE {IS_ROTA_MEMBER_SQL}
           AND u.id NOT IN (
               SELECT user_id FROM shift_signups
               WHERE shift_date BETWEEN ?1 AND ?2
           )
         ORDER BY u.display_name ASC"
    ))
    .bind(&params.start_date)
    .bind(&params.end_date)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch unallocated users: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "Failed to fetch unallocated users".to_string() }),
        )
    })?;

    let members: Vec<UnallocatedMember> = rows.into_iter().map(|r| UnallocatedMember {
        user_id: r.id,
        display_name: r.display_name,
        has_contract: r.has_contract,
        contract_expiry_date: r.contract_expiry_date,
        last_shift_date: r.last_shift_date,
    }).collect();

    info!("✅ Committee {} fetched {} unallocated members for {}–{}", user.id, members.len(), params.start_date, params.end_date);
    Ok(Json(members))
}

/// Get all pending contract requests (committee only)
pub async fn get_pending_contracts(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Json<Vec<PendingContract>>, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 Fetching pending contracts for committee user: {}", user.id);

    // Get users with pending contracts (has expiry date but not approved)
    let pending_users = sqlx::query_as::<_, User>(
        "SELECT * FROM users
         WHERE contract_expiry_date IS NOT NULL
         AND has_contract = FALSE
         ORDER BY display_name ASC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch pending contracts: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch pending contracts".to_string(),
            }),
        )
    })?;

    let pending: Vec<PendingContract> = pending_users
        .into_iter()
        .map(|u| PendingContract {
            user_id: u.id,
            display_name: u.display_name,
            contract_expiry_date: u.contract_expiry_date.unwrap_or_default(),
        })
        .collect();

    info!("✅ Found {} pending contracts", pending.len());

    Ok(Json(pending))
}

/// Approve a contract (committee only)
pub async fn approve_contract(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Committee user {} approving contract for user: {}", user.id, target_user_id);

    // Approve the contract
    sqlx::query("UPDATE users SET has_contract = TRUE WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to approve contract: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to approve contract".to_string(),
                }),
            )
        })?;

    info!("✅ Contract approved for user: {}", target_user_id);

    Ok(StatusCode::OK)
}

// Bar hours management
#[derive(Debug, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct BarHours {
    pub day_of_week: i32,  // 0=Sunday, 1=Monday, ..., 6=Saturday
    pub open_time: String,
    pub close_time: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBarHoursRequest {
    pub day_of_week: i32,
    pub open_time: String,
    pub close_time: String,
}

/// Get all bar hours (committee only)
pub async fn get_bar_hours(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
) -> Result<Json<Vec<BarHours>>, (StatusCode, Json<ErrorResponse>)> {
    // Fetch bar hours
    let hours = sqlx::query_as::<_, BarHours>(
        "SELECT day_of_week, open_time, close_time FROM bar_hours ORDER BY day_of_week"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch bar hours: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch bar hours".to_string(),
            }),
        )
    })?;

    Ok(Json(hours))
}

/// Update bar hours for a specific day (committee only)
pub async fn update_bar_hours(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
    Json(req): Json<UpdateBarHoursRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Validate day of week (0-6)
    if req.day_of_week < 0 || req.day_of_week > 6 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid day of week (must be 0-6)".to_string(),
            }),
        ));
    }

    // Validate time format (HH:MM)
    let time_regex = regex::Regex::new(r"^\d{2}:\d{2}$").unwrap();
    if !time_regex.is_match(&req.open_time) || !time_regex.is_match(&req.close_time) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid time format (must be HH:MM)".to_string(),
            }),
        ));
    }

    info!(
        "🕐 Updating bar hours for day {}: {}-{}",
        req.day_of_week, req.open_time, req.close_time
    );

    // Update bar hours
    sqlx::query(
        "UPDATE bar_hours SET open_time = ?, close_time = ? WHERE day_of_week = ?"
    )
    .bind(&req.open_time)
    .bind(&req.close_time)
    .bind(req.day_of_week)
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to update bar hours: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to update bar hours".to_string(),
            }),
        )
    })?;

    info!("✅ Bar hours updated for day: {}", req.day_of_week);

    Ok(StatusCode::OK)
}

// Committee dashboard overview stats
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OverviewStats {
    #[ts(type = "number")]
    pub active_members_count: i64,
    #[ts(type = "number")]
    pub pending_certificates_count: i64,
    #[ts(type = "number")]
    pub pending_contracts_count: i64,
    #[ts(type = "number")]
    pub unstaffed_shifts_next_3_days: i64,
    #[ts(type = "number")]
    pub understaffed_events_next_7_days: i64,
    #[ts(type = "number")]
    pub expiring_contracts_next_30_days: i64,
}

/// Get dashboard overview stats (committee only)
pub async fn get_overview_stats(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
) -> Result<Json<OverviewStats>, (StatusCode, Json<ErrorResponse>)> {
    // Get active members count
    let active_members_count: i64 = sqlx::query_scalar(
        &format!("SELECT COUNT(*) FROM users WHERE {}", IS_ROTA_MEMBER_SQL)
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Get pending certificates count
    let pending_certificates_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users
         WHERE food_safety_certificate IS NOT NULL
         AND food_safety_completed = FALSE"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Get pending contracts count
    let pending_contracts_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users
         WHERE contract_expiry_date IS NOT NULL
         AND has_contract = FALSE"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Get unstaffed shifts in next 3 days
    let unstaffed_shifts_next_3_days: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT e.event_date) FROM events e
         WHERE e.event_date >= date('now')
         AND e.event_date <= date('now', '+3 days')
         AND (SELECT COUNT(*) FROM shift_signups s WHERE s.shift_date = e.event_date) = 0"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Get understaffed events (not regular bar openings) in next 7 days
    // An event is understaffed if it has signups < max_volunteers AND title is not null (it's an event)
    let understaffed_events_next_7_days: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events e
         WHERE e.event_date >= date('now')
         AND e.event_date <= date('now', '+7 days')
         AND e.title IS NOT NULL
         AND COALESCE(e.shift_max_volunteers, 2) > (
             SELECT COUNT(*) FROM shift_signups s WHERE s.shift_date = e.event_date
         )"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Get expiring contracts in next 30 days
    let expiring_contracts_next_30_days: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users
         WHERE has_contract = TRUE
         AND contract_expiry_date IS NOT NULL
         AND contract_expiry_date >= date('now')
         AND contract_expiry_date <= date('now', '+30 days')"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(OverviewStats {
        active_members_count,
        pending_certificates_count,
        pending_contracts_count,
        unstaffed_shifts_next_3_days,
        understaffed_events_next_7_days,
        expiring_contracts_next_30_days,
    }))
}

// ===== Admin-only endpoints (user management) =====

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserListItem {
    pub id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub is_committee: bool,
    pub is_admin: bool,
    pub code_of_conduct_signed: bool,
    pub induction_completed: bool,
    pub supervised_shift_completed: bool,
    pub created_at: String,
}

/// Get all users (admin only)
/// Returns users sorted by: admins first, then committee, then regular users
pub async fn get_all_users(
    State(state): State<AppState>,
    AdminUser(user): AdminUser,
) -> Result<Json<Vec<UserListItem>>, (StatusCode, Json<ErrorResponse>)> {
    info!("👥 Admin {} fetching all users", user.id);

    // Fetch all users, sorted by admin first, then committee, then regular
    let users = sqlx::query_as::<_, User>(
        "SELECT * FROM users ORDER BY is_admin DESC, is_committee DESC, display_name ASC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch users: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch users".to_string(),
            }),
        )
    })?;

    let user_list: Vec<UserListItem> = users
        .into_iter()
        .map(|u| UserListItem {
            id: u.id,
            display_name: u.display_name,
            email: u.email,
            is_committee: u.is_committee,
            is_admin: u.is_admin,
            code_of_conduct_signed: u.code_of_conduct_signed,
            induction_completed: u.induction_completed,
            supervised_shift_completed: u.supervised_shift_completed,
            created_at: u.created_at,
        })
        .collect();

    info!("✅ Found {} users", user_list.len());

    Ok(Json(user_list))
}

/// Promote a user (admin only)
/// user -> committee -> admin
pub async fn promote_user(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Fetch target user
    let target_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Target user not found".to_string(),
                }),
            )
        })?;

    // Determine new role
    if target_user.is_admin {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "User is already an admin".to_string(),
            }),
        ));
    }

    if target_user.is_committee {
        // Promote committee -> admin
        info!("⬆️ Promoting user {} to admin", target_user_id);
        sqlx::query("UPDATE users SET is_admin = TRUE WHERE id = ?")
            .bind(&target_user_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("❌ Failed to promote user: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to promote user".to_string(),
                    }),
                )
            })?;
    } else {
        // Promote regular user -> committee
        info!("⬆️ Promoting user {} to committee", target_user_id);
        sqlx::query("UPDATE users SET is_committee = TRUE WHERE id = ?")
            .bind(&target_user_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("❌ Failed to promote user: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to promote user".to_string(),
                    }),
                )
            })?;
    }

    Ok(StatusCode::OK)
}

/// Demote a user (admin only)
/// admin -> committee -> user
/// Blocked if demoting the last admin
pub async fn demote_user(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Fetch target user
    let target_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Target user not found".to_string(),
                }),
            )
        })?;

    // Check if trying to demote the last admin
    if target_user.is_admin {
        let admin_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_admin = TRUE")
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

        if admin_count <= 1 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Cannot demote the last admin".to_string(),
                }),
            ));
        }

        // Demote admin -> committee
        info!("⬇️ Demoting admin {} to committee", target_user_id);
        sqlx::query("UPDATE users SET is_admin = FALSE WHERE id = ?")
            .bind(&target_user_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("❌ Failed to demote user: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to demote user".to_string(),
                    }),
                )
            })?;
    } else if target_user.is_committee {
        // Demote committee -> regular user
        info!("⬇️ Demoting committee {} to regular user", target_user_id);
        sqlx::query("UPDATE users SET is_committee = FALSE WHERE id = ?")
            .bind(&target_user_id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("❌ Failed to demote user: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to demote user".to_string(),
                    }),
                )
            })?;
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "User is already a regular user".to_string(),
            }),
        ));
    }

    Ok(StatusCode::OK)
}

/// Delete a user (admin only)
/// Cannot delete yourself or the last admin
pub async fn delete_user(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Cannot delete yourself
    if admin.id == target_user_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Cannot delete yourself".to_string(),
            }),
        ));
    }

    // Fetch target user
    let target_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Target user not found".to_string(),
                }),
            )
        })?;

    // Cannot delete the last admin
    if target_user.is_admin {
        let admin_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_admin = TRUE")
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

        if admin_count <= 1 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Cannot delete the last admin".to_string(),
                }),
            ));
        }
    }

    info!("🗑️ Admin {} deleting user {}", admin.id, target_user_id);

    // Delete the user
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to delete user: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to delete user".to_string(),
                }),
            )
        })?;

    info!("✅ User {} deleted", target_user_id);

    Ok(StatusCode::OK)
}

/// Mark a user's induction as complete (admin only)
pub async fn admin_mark_induction(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Admin {} marking induction complete for user {}", admin.id, target_user_id);

    let result = sqlx::query("UPDATE users SET induction_completed = TRUE WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to mark induction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to mark induction complete".to_string(),
                }),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "User not found".to_string(),
            }),
        ));
    }

    info!("✅ Induction marked complete for user {}", target_user_id);
    Ok(StatusCode::OK)
}

/// Mark a user's code of conduct as signed (admin only)
pub async fn admin_mark_coc(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Admin {} marking CoC signed for user {}", admin.id, target_user_id);

    let result = sqlx::query("UPDATE users SET code_of_conduct_signed = TRUE WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to mark CoC: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to mark code of conduct signed".to_string(),
                }),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "User not found".to_string(),
            }),
        ));
    }

    info!("✅ CoC marked signed for user {}", target_user_id);
    Ok(StatusCode::OK)
}

// ===== Bulk Import =====

#[derive(Debug, Deserialize)]
pub struct BulkImportUser {
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BulkImportRequest {
    pub users: Vec<BulkImportUser>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct BulkImportDetail {
    pub email: String,
    pub status: String, // "created", "skipped", "error"
    pub message: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct BulkImportResult {
    pub created: i32,
    pub skipped: i32,
    pub errors: Vec<String>,
    pub details: Vec<BulkImportDetail>,
}

/// Bulk import users by email (admin only)
pub async fn bulk_import_users(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Json(req): Json<BulkImportRequest>,
) -> Result<Json<BulkImportResult>, (StatusCode, Json<ErrorResponse>)> {
    info!("📦 Admin {} bulk importing {} users", admin.id, req.users.len());

    let mut created = 0i32;
    let mut skipped = 0i32;
    let mut errors = Vec::new();
    let mut details = Vec::new();

    for entry in &req.users {
        let email = entry.email.trim().to_lowercase();

        // Validate email
        if !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
            errors.push(format!("Invalid email: {}", email));
            details.push(BulkImportDetail {
                email: email.clone(),
                status: "error".to_string(),
                message: Some("Invalid email format".to_string()),
            });
            continue;
        }

        // Check duplicate
        let existing: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)")
            .bind(&email)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);

        if existing {
            skipped += 1;
            details.push(BulkImportDetail {
                email: email.clone(),
                status: "skipped".to_string(),
                message: Some("Email already exists".to_string()),
            });
            continue;
        }

        // Create user (no passkey, no email sent)
        match create_user_in_db(
            &state.db,
            entry.display_name.clone(),
            Some(email.clone()),
            None,
        ).await {
            Ok(_) => {
                created += 1;
                details.push(BulkImportDetail {
                    email: email.clone(),
                    status: "created".to_string(),
                    message: None,
                });
            }
            Err((_status, err_json)) => {
                let msg = err_json.0.error.clone();
                errors.push(format!("{}: {}", email, msg));
                details.push(BulkImportDetail {
                    email: email.clone(),
                    status: "error".to_string(),
                    message: Some(msg),
                });
            }
        }
    }

    info!("✅ Bulk import complete: {} created, {} skipped, {} errors", created, skipped, errors.len());

    Ok(Json(BulkImportResult {
        created,
        skipped,
        errors,
        details,
    }))
}

// ===== Admin Certificate Upload =====

/// Upload a food safety certificate on behalf of a user (admin only)
/// Automatically marks food_safety_completed = true (pre-approved)
pub async fn admin_upload_certificate(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
    mut multipart: Multipart,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📤 Admin {} uploading certificate for user {}", admin.id, target_user_id);

    // Verify target user exists
    let _target = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (StatusCode::NOT_FOUND, Json(ErrorResponse { error: "User not found".to_string() }))
        })?;

    // Extract file from multipart
    let mut file_data: Option<Vec<u8>> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("❌ Multipart error: {}", e);
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid multipart data".to_string() }))
    })? {
        if field.name() == Some("certificate") {
            content_type = field.content_type().map(|s| s.to_string());
            let data = field.bytes().await.map_err(|e| {
                error!("❌ Failed to read file: {}", e);
                (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Failed to read file".to_string() }))
            })?;
            file_data = Some(data.to_vec());
        }
    }

    let file_bytes = file_data.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "No file uploaded".to_string() }))
    })?;

    // Validate size (5MB)
    const MAX_SIZE: usize = 5 * 1024 * 1024;
    if file_bytes.len() > MAX_SIZE {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "File must be under 5 MB".to_string() })));
    }

    // Validate content type
    let stored_type = if let Some(ref ct) = content_type {
        if !ct.starts_with("image/") && ct != "application/pdf" {
            return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Only image files and PDFs are allowed".to_string() })));
        }
        ct.clone()
    } else {
        "application/octet-stream".to_string()
    };

    // Store certificate and auto-approve
    sqlx::query("UPDATE users SET food_safety_certificate = ?, food_safety_certificate_type = ?, food_safety_completed = TRUE WHERE id = ?")
        .bind(&file_bytes)
        .bind(&stored_type)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to store certificate: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to store certificate".to_string() }))
        })?;

    info!("✅ Certificate uploaded and approved for user {}", target_user_id);
    Ok(StatusCode::OK)
}

// ===== Admin Set Contract =====

#[derive(Debug, Deserialize)]
pub struct AdminSetContractRequest {
    pub contract_expiry_date: String,
}

/// Set contract for a user (admin only)
/// Automatically marks has_contract = true (pre-approved)
pub async fn admin_set_contract(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
    Json(req): Json<AdminSetContractRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 Admin {} setting contract for user {}", admin.id, target_user_id);

    // Validate date format
    if chrono::NaiveDate::parse_from_str(&req.contract_expiry_date, "%Y-%m-%d").is_err() {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid date format. Use YYYY-MM-DD".to_string() })));
    }

    // Verify target user exists
    let result = sqlx::query("UPDATE users SET has_contract = TRUE, contract_expiry_date = ? WHERE id = ?")
        .bind(&req.contract_expiry_date)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to set contract: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to set contract".to_string() }))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "User not found".to_string() })));
    }

    info!("✅ Contract set for user {}", target_user_id);
    Ok(StatusCode::OK)
}

/// Clear contract for a user (admin only)
pub async fn admin_clear_contract(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 Admin {} clearing contract for user {}", admin.id, target_user_id);

    let result = sqlx::query("UPDATE users SET has_contract = FALSE, contract_expiry_date = NULL WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to clear contract: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to clear contract".to_string() }))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "User not found".to_string() })));
    }

    info!("✅ Contract cleared for user {}", target_user_id);
    Ok(StatusCode::OK)
}

#[derive(Debug, Deserialize)]
pub struct AdminSetEmailRequest {
    pub email: String,
}

/// Set email for a user (admin only)
pub async fn admin_set_email(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(target_user_id): Path<String>,
    Json(req): Json<AdminSetEmailRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📧 Admin {} setting email for user {}", admin.id, target_user_id);

    let email = req.email.trim().to_lowercase();
    if !email.contains('@') || !email.contains('.') {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid email address".to_string() })));
    }

    let result = sqlx::query("UPDATE users SET email = ? WHERE id = ?")
        .bind(&email)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to set email: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to set email".to_string() }))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "User not found".to_string() })));
    }

    info!("✅ Email set for user {}", target_user_id);
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::create_jwt_token;
    use crate::test_util::{insert_shift_signup, insert_user, test_state, user_with, user_with_role};
    use axum::body::Body;
    use axum::http::{Request, StatusCode as Status};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn rota_member(committee: bool) -> User {
        let mut u = user_with(true, true, true, true);
        u.is_committee = committee;
        u
    }

    fn unallocated_query(start: &str, end: &str) -> Query<UnallocatedQuery> {
        Query(UnallocatedQuery {
            start_date: start.to_string(),
            end_date: end.to_string(),
        })
    }

    // -------- Direct-handler tests (cover SQL behavior) --------

    #[tokio::test]
    async fn unallocated_includes_rota_members_with_no_signups_in_range() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].user_id, user.id);
        assert_eq!(members[0].last_shift_date, None);
    }

    #[tokio::test]
    async fn unallocated_excludes_rota_members_with_signups_in_range() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-05-15").await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert!(members.is_empty(), "user with in-range signup should be excluded");
    }

    #[tokio::test]
    async fn unallocated_includes_rota_members_whose_signups_are_outside_range() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-04-15").await;
        insert_shift_signup(&state.db, &user.id, "2026-06-15").await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert_eq!(members.len(), 1);
        // last_shift_date is the max across all time, not within range.
        assert_eq!(members[0].last_shift_date.as_deref(), Some("2026-06-15"));
    }

    #[tokio::test]
    async fn unallocated_excludes_non_rota_members() {
        let state = test_state().await;
        // supervised_shift_completed = false → fails IS_ROTA_MEMBER_SQL
        let mut user = user_with(true, true, true, false);
        user.is_committee = true;
        insert_user(&state.db, &user).await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert!(members.is_empty(), "non-rota member must not appear");
    }

    #[tokio::test]
    async fn last_shift_date_is_max_across_all_time() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-01-10").await;
        insert_shift_signup(&state.db, &user.id, "2026-03-22").await;
        insert_shift_signup(&state.db, &user.id, "2026-02-05").await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].last_shift_date.as_deref(), Some("2026-03-22"));
    }

    #[tokio::test]
    async fn last_shift_date_is_null_for_users_with_no_signups_ever() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;

        let Json(members) = get_unallocated_users(
            State(state),
            CommitteeUser(user.clone()),
            unallocated_query("2026-05-01", "2026-05-31"),
        )
        .await
        .expect("fetch ok");

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].last_shift_date, None);
    }

    // -------- Router-level tests (cover the auth gate) --------

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/admin/unallocated-users", get(get_unallocated_users))
            .with_state(state)
    }

    fn unallocated_request(token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .uri("/api/admin/unallocated-users?start_date=2026-05-01&end_date=2026-05-31");
        if let Some(t) = token {
            builder = builder.header("authorization", format!("Bearer {t}"));
        }
        builder.body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn router_rejects_non_committee_user_with_403() {
        let state = test_state().await;
        // Plain user — not committee, not admin.
        let user = user_with_role(false, false);
        insert_user(&state.db, &user).await;
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();

        let response = build_app(state).oneshot(unallocated_request(Some(&token))).await.unwrap();
        assert_eq!(response.status(), Status::FORBIDDEN);
    }

    #[tokio::test]
    async fn router_rejects_unauthenticated_request_with_401() {
        let state = test_state().await;
        let response = build_app(state).oneshot(unallocated_request(None)).await.unwrap();
        assert_eq!(response.status(), Status::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn router_committee_user_succeeds() {
        let state = test_state().await;
        let user = user_with_role(true, false);
        insert_user(&state.db, &user).await;
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();

        let response = build_app(state).oneshot(unallocated_request(Some(&token))).await.unwrap();
        assert_eq!(response.status(), Status::OK);

        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let members: Vec<UnallocatedMember> = serde_json::from_slice(&body_bytes).unwrap();
        assert!(members.is_empty(), "no rota members inserted");
    }
}
