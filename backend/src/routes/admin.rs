use axum::{
    extract::{State, Path},
    http::{StatusCode, header},
    Json,
    response::Response,
    body::Body,
};
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use ts_rs::TS;

use crate::auth::{CommitteeUser, AdminUser};
use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct PendingCertificate {
    pub user_id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct ActiveMember {
    pub user_id: String,
    pub display_name: Option<String>,
    pub has_contract: bool,
    pub contract_expiry_date: Option<String>,
    pub is_committee: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct PendingContract {
    pub user_id: String,
    pub display_name: Option<String>,
    pub contract_expiry_date: String,
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
    let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "your-secret-key".to_string());
    let token_data = decode::<Claims>(
        jwt,
        &DecodingKey::from_secret(secret.as_ref()),
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
        "SELECT * FROM users
         WHERE code_of_conduct_signed = TRUE
         AND food_safety_completed = TRUE
         AND induction_completed = TRUE
         ORDER BY display_name ASC"
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
#[ts(export, export_to = "../frontend/src/types/")]
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
#[ts(export, export_to = "../frontend/src/types/")]
pub struct OverviewStats {
    pub active_members_count: i64,
    pub pending_certificates_count: i64,
    pub pending_contracts_count: i64,
    pub unstaffed_shifts_next_3_days: i64,
    pub understaffed_events_next_7_days: i64,
    pub expiring_contracts_next_30_days: i64,
}

/// Get dashboard overview stats (committee only)
pub async fn get_overview_stats(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
) -> Result<Json<OverviewStats>, (StatusCode, Json<ErrorResponse>)> {
    // Get active members count
    let active_members_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users
         WHERE code_of_conduct_signed = TRUE
         AND food_safety_completed = TRUE
         AND induction_completed = TRUE"
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
#[ts(export, export_to = "../frontend/src/types/")]
pub struct UserListItem {
    pub id: String,
    pub display_name: Option<String>,
    pub is_committee: bool,
    pub is_admin: bool,
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
            is_committee: u.is_committee,
            is_admin: u.is_admin,
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
