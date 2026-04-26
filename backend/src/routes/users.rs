use axum::{
    extract::{State, Query},
    http::StatusCode,
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use tracing::{info, error};
use ts_rs::TS;
use jsonwebtoken::{encode, EncodingKey, Header};

use crate::auth::{AuthenticatedUser, Claims};
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserStatus {
    pub user_id: String,
    pub display_name: Option<String>,
    pub is_committee: bool,
    pub code_of_conduct_signed: bool,
    pub food_safety_completed: bool,
    pub has_food_safety_certificate: bool,
    pub induction_completed: bool,
    pub has_contract: bool,
    pub contract_expiry_date: Option<String>,
    pub email: Option<String>,
    pub email_notifications_enabled: bool,
    pub privacy_consent_given: bool,
    pub has_passkey: bool,
    pub supervised_shift_completed: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDisplayNameRequest {
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ContractRequest {
    pub contract_expiry_date: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserOverview {
    pub next_onboarding_step: Option<String>, // "code_of_conduct", "food_safety", "induction", or null if complete
    #[ts(type = "number")]
    pub shifts_next_7_days: i64,
    pub contract_expiry_date: Option<String>, // null if no contract
}

// Get current user's status
pub async fn get_me(
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<UserStatus>, (StatusCode, Json<ErrorResponse>)> {
    info!("📊 Fetching status for user: {}", user.id);

    Ok(Json(UserStatus {
        user_id: user.id,
        display_name: user.display_name,
        is_committee: user.is_committee,
        code_of_conduct_signed: user.code_of_conduct_signed,
        food_safety_completed: user.food_safety_completed,
        has_food_safety_certificate: user.food_safety_certificate.is_some(),
        induction_completed: user.induction_completed,
        has_contract: user.has_contract,
        contract_expiry_date: user.contract_expiry_date,
        email: user.email,
        email_notifications_enabled: user.email_notifications_enabled,
        privacy_consent_given: user.privacy_consent_given,
        has_passkey: user.passkey_credential.is_some(),
        supervised_shift_completed: user.supervised_shift_completed,
    }))
}

// Accept Code of Conduct
pub async fn accept_coc(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✍️ User {} accepting Code of Conduct", user.id);

    // Update user's CoC status
    sqlx::query("UPDATE users SET code_of_conduct_signed = ? WHERE id = ?")
        .bind(true)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to update CoC status: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to accept Code of Conduct".to_string(),
                }),
            )
        })?;

    info!("✅ Code of Conduct accepted for user: {}", user.id);

    Ok(StatusCode::OK)
}

// Upload food safety certificate
pub async fn upload_certificate(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📤 User {} uploading food safety certificate", user.id);

    // Check if already approved
    if user.food_safety_completed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Certificate already approved. Contact committee if you need to update it.".to_string(),
            }),
        ));
    }

    // Extract file from multipart
    let mut file_data: Option<Vec<u8>> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("❌ Multipart error: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid multipart data".to_string(),
            }),
        )
    })? {
        if field.name() == Some("certificate") {
            content_type = field.content_type().map(|s| s.to_string());
            let data = field.bytes().await.map_err(|e| {
                error!("❌ Failed to read file: {}", e);
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Failed to read file".to_string(),
                    }),
                )
            })?;
            file_data = Some(data.to_vec());
        }
    }

    let file_bytes = file_data.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "No file uploaded".to_string(),
            }),
        )
    })?;

    // Validate size (5MB)
    const MAX_SIZE: usize = 5 * 1024 * 1024;
    if file_bytes.len() > MAX_SIZE {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "File must be under 5 MB".to_string(),
            }),
        ));
    }

    // Validate content type (images and PDFs only)
    let stored_type = if let Some(ref ct) = content_type {
        if !ct.starts_with("image/") && ct != "application/pdf" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Only image files and PDFs are allowed".to_string(),
                }),
            ));
        }
        ct.clone()
    } else {
        "application/octet-stream".to_string()
    };

    info!("📸 Storing certificate ({} bytes, type: {}) for user: {}", file_bytes.len(), stored_type, user.id);

    // Store BLOB and content type in database
    sqlx::query("UPDATE users SET food_safety_certificate = ?, food_safety_certificate_type = ? WHERE id = ?")
        .bind(&file_bytes)
        .bind(&stored_type)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to store certificate: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to store certificate".to_string(),
                }),
            )
        })?;

    info!("✅ Certificate uploaded for user: {}", user.id);

    Ok(StatusCode::OK)
}

/// Submit contract request with expiry date
pub async fn submit_contract_request(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<ContractRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 User {} requesting contract approval with expiry: {}", user.id, req.contract_expiry_date);

    // Validate date format
    if chrono::NaiveDate::parse_from_str(&req.contract_expiry_date, "%Y-%m-%d").is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid date format. Use YYYY-MM-DD".to_string(),
            }),
        ));
    }

    // Check if already approved
    if user.has_contract {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Contract already approved. Contact committee if you need to update it.".to_string(),
            }),
        ));
    }

    // Set expiry date (has_contract stays FALSE until committee approves)
    sqlx::query("UPDATE users SET contract_expiry_date = ? WHERE id = ?")
        .bind(&req.contract_expiry_date)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to submit contract request: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to submit contract request".to_string(),
                }),
            )
        })?;

    info!("✅ Contract request submitted for user: {}", user.id);

    Ok(StatusCode::OK)
}

#[derive(Debug, Deserialize)]
pub struct VerificationQuery {
    #[serde(rename = "type")]
    verification_type: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerificationToken {
    pub token: String,
}

// Generate verification token for QR code
pub async fn get_verification_token(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(params): Query<VerificationQuery>,
) -> Result<Json<VerificationToken>, (StatusCode, Json<ErrorResponse>)> {

    // Validate type
    if params.verification_type != "induction" && params.verification_type != "food_safety" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid verification type".to_string(),
            }),
        ));
    }

    info!("🎫 Generating {} verification token for user: {}", params.verification_type, user.id);

    // Create claims with short expiry (5 minutes)
    let now = chrono::Utc::now().timestamp() as usize;
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::minutes(5))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user.id.clone(),
        exp: expiration,
        iat: now,
    };

    // Encode verification type in the token
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(&state.jwt_secret),
    )
    .map_err(|e| {
        error!("❌ Failed to create token: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to create verification token".to_string(),
            }),
        )
    })?;

    // Encode type in token data (we'll pass it separately in the QR)
    let token_with_type = format!("{}:{}", params.verification_type, token);

    Ok(Json(VerificationToken {
        token: token_with_type,
    }))
}

// Update display name
pub async fn update_display_name(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<UpdateDisplayNameRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {

    // Validate display name
    let trimmed_name = req.display_name.trim();
    if trimmed_name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Display name cannot be empty".to_string(),
            }),
        ));
    }

    if trimmed_name.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Display name must be 100 characters or less".to_string(),
            }),
        ));
    }

    info!("✏️ User {} updating display name to: {}", user.id, trimmed_name);

    // Update display name
    sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
        .bind(trimmed_name)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("❌ Failed to update display name: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to update display name".to_string(),
                }),
            )
        })?;

    info!("✅ Display name updated for user: {}", user.id);

    Ok(StatusCode::OK)
}

// Get user overview for dashboard
pub async fn get_my_overview(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<UserOverview>, (StatusCode, Json<ErrorResponse>)> {
    info!("📊 Fetching overview for user: {}", user.id);

    // Determine next onboarding step (induction first, then CoC, food safety, supervised shift)
    let next_onboarding_step = if !user.induction_completed {
        Some("induction".to_string())
    } else if !user.code_of_conduct_signed {
        Some("code_of_conduct".to_string())
    } else if !user.food_safety_completed {
        Some("food_safety".to_string())
    } else if !user.supervised_shift_completed {
        Some("supervised_shift".to_string())
    } else {
        None
    };

    // Count shifts in next 7 days
    let shifts_next_7_days: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shift_signups
         WHERE user_id = ?
         AND shift_date >= date('now')
         AND shift_date <= date('now', '+7 days')"
    )
    .bind(&user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(UserOverview {
        next_onboarding_step,
        shifts_next_7_days,
        contract_expiry_date: user.contract_expiry_date,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailRequest {
    pub email: Option<String>,
}

/// Update user's email address
pub async fn update_email(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<UpdateEmailRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Validate email format if provided
    if let Some(ref email) = req.email {
        let trimmed = email.trim();
        if trimmed.is_empty() {
            // Clear email
            sqlx::query("UPDATE users SET email = NULL, email_notifications_enabled = FALSE WHERE id = ?")
                .bind(&user.id)
                .execute(&state.db)
                .await
                .map_err(|e| {
                    error!("Failed to clear email: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to update email".to_string() }))
                })?;
            return Ok(StatusCode::OK);
        }

        // Basic email validation: must contain @ with something on each side
        if !trimmed.contains('@') || trimmed.starts_with('@') || trimmed.ends_with('@') {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: "Invalid email address".to_string() }),
            ));
        }

        // Check domain has at least one dot
        let parts: Vec<&str> = trimmed.split('@').collect();
        if parts.len() != 2 || !parts[1].contains('.') {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: "Invalid email address".to_string() }),
            ));
        }

        // Check uniqueness
        let existing: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE email = ? AND id != ?)"
        )
        .bind(trimmed)
        .bind(&user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if existing {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse { error: "Email address already in use".to_string() }),
            ));
        }

        info!("Updating email for user {}", user.id);
        sqlx::query("UPDATE users SET email = ? WHERE id = ?")
            .bind(trimmed)
            .bind(&user.id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("Failed to update email: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to update email".to_string() }))
            })?;
    } else {
        // Clear email and disable notifications
        sqlx::query("UPDATE users SET email = NULL, email_notifications_enabled = FALSE WHERE id = ?")
            .bind(&user.id)
            .execute(&state.db)
            .await
            .map_err(|e| {
                error!("Failed to clear email: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to update email".to_string() }))
            })?;
    }

    Ok(StatusCode::OK)
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailNotificationsRequest {
    pub enabled: bool,
}

/// Toggle email notifications
pub async fn update_email_notifications(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<UpdateEmailNotificationsRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    if req.enabled && user.email.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "Cannot enable notifications without an email address".to_string() }),
        ));
    }

    sqlx::query("UPDATE users SET email_notifications_enabled = ? WHERE id = ?")
        .bind(req.enabled)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to update notification settings: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to update settings".to_string() }))
        })?;

    Ok(StatusCode::OK)
}

/// Accept privacy notice
pub async fn accept_privacy(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    sqlx::query("UPDATE users SET privacy_consent_given = TRUE WHERE id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to update privacy consent: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to accept privacy notice".to_string() }))
        })?;

    Ok(StatusCode::OK)
}

/// Self-service account deletion
pub async fn delete_my_account(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("User {} requesting account deletion", user.id);

    // CASCADE handles shift_signups and email_notification_log
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to delete user: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to delete account".to_string() }))
        })?;

    info!("User {} account deleted", user.id);
    Ok(StatusCode::OK)
}

/// Export all user data as JSON
pub async fn export_my_data(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Get shift signups
    let signups: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT s.shift_date,
                (SELECT title FROM events WHERE event_date = s.shift_date) as event_title
         FROM shift_signups s WHERE s.user_id = ? ORDER BY s.shift_date"
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Get notification log
    let notifications: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT shift_date, notification_type, sent_at FROM email_notification_log WHERE user_id = ? ORDER BY sent_at"
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let data = serde_json::json!({
        "profile": {
            "user_id": user.id,
            "display_name": user.display_name,
            "email": user.email,
            "email_notifications_enabled": user.email_notifications_enabled,
            "is_committee": user.is_committee,
            "is_admin": user.is_admin,
            "code_of_conduct_signed": user.code_of_conduct_signed,
            "food_safety_completed": user.food_safety_completed,
            "has_food_safety_certificate": user.food_safety_certificate.is_some(),
            "induction_completed": user.induction_completed,
            "has_contract": user.has_contract,
            "contract_expiry_date": user.contract_expiry_date,
            "privacy_consent_given": user.privacy_consent_given,
            "supervised_shift_completed": user.supervised_shift_completed,
            "created_at": user.created_at,
        },
        "shift_signups": signups.iter().map(|(date, title)| {
            serde_json::json!({ "date": date, "event_title": title })
        }).collect::<Vec<_>>(),
        "notification_log": notifications.iter().map(|(date, ntype, sent)| {
            serde_json::json!({ "shift_date": date, "type": ntype, "sent_at": sent })
        }).collect::<Vec<_>>(),
    });

    Ok(Json(data))
}

// ===== Passkey Setup (for email-only users) =====

use webauthn_rs::prelude::*;
use uuid::Uuid;

/// Start passkey registration for an authenticated user
pub async fn start_passkey_setup(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<CreationChallengeResponse>, (StatusCode, Json<ErrorResponse>)> {
    if user.passkey_credential.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "Passkey already configured".to_string() }),
        ));
    }

    let user_uuid = Uuid::parse_str(&user.id).unwrap_or_else(|_| Uuid::new_v4());
    let user_name = user.display_name.as_deref().unwrap_or("user");

    let (ccr, reg_state) = state
        .webauthn
        .start_passkey_registration(user_uuid, user_name, user_name, None)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse { error: format!("Failed to start passkey registration: {}", e) }),
            )
        })?;

    // Store registration state keyed to user
    let state_id = Uuid::new_v4().to_string();
    let state_data = serde_json::to_string(&reg_state).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: format!("Failed to serialize state: {}", e) }),
        )
    })?;

    // Clean up any previous passkey_setup states for this user
    sqlx::query("DELETE FROM auth_states WHERE state_type = ? AND display_name = ?")
        .bind("passkey_setup")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query("INSERT INTO auth_states (id, state_type, state_data, display_name) VALUES (?, ?, ?, ?)")
        .bind(&state_id)
        .bind("passkey_setup")
        .bind(&state_data)
        .bind(&user.id) // store user_id in display_name column for lookup
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse { error: format!("Database error: {}", e) }),
            )
        })?;

    info!("🔑 Passkey setup started for user {}", user.id);

    Ok(Json(ccr))
}

/// Finish passkey registration for an authenticated user
pub async fn finish_passkey_setup(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(credential): Json<RegisterPublicKeyCredential>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    if user.passkey_credential.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "Passkey already configured".to_string() }),
        ));
    }

    // Get registration state for this user
    let auth_state: (String,) = sqlx::query_as(
        "SELECT state_data FROM auth_states WHERE state_type = ? AND display_name = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind("passkey_setup")
    .bind(&user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: format!("No passkey setup state found: {}", e) }),
        )
    })?;

    let reg_state: PasskeyRegistration = serde_json::from_str(&auth_state.0).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: format!("Failed to deserialize state: {}", e) }),
        )
    })?;

    // Verify the credential
    let passkey = state
        .webauthn
        .finish_passkey_registration(&credential, &reg_state)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: format!("Passkey registration failed: {}", e) }),
            )
        })?;

    // Store passkey on user
    let passkey_json = serde_json::to_string(&passkey).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: format!("Failed to serialize passkey: {}", e) }),
        )
    })?;

    sqlx::query("UPDATE users SET passkey_credential = ? WHERE id = ?")
        .bind(&passkey_json)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse { error: format!("Failed to store passkey: {}", e) }),
            )
        })?;

    // Clean up
    sqlx::query("DELETE FROM auth_states WHERE state_type = ? AND display_name = ?")
        .bind("passkey_setup")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .ok();

    info!("🎉 Passkey configured for user {}", user.id);

    Ok(StatusCode::OK)
}
