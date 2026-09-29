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
use crate::routes::coc::{current_coc_version, record_signature};
use crate::routes::auth::AppState;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserStatus {
    pub user_id: String,
    pub display_name: Option<String>,
    pub is_committee: bool,
    pub code_of_conduct_signed: bool,
    /// Last version signed; set but not current means "re-sign the updated CoC".
    #[ts(type = "number | null")]
    pub code_of_conduct_version: Option<i64>,
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
    /// "induction", "code_of_conduct", "code_of_conduct_resign" (signed an
    /// earlier version), "food_safety", "supervised_shift", or null if complete
    pub next_onboarding_step: Option<String>,
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
        code_of_conduct_version: user.code_of_conduct_version,
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

#[derive(Debug, Deserialize)]
pub struct AcceptCocRequest {
    /// The version the user was shown. Rejected if a newer one was published
    /// while they were reading.
    pub version: i64,
}

// Accept Code of Conduct
pub async fn accept_coc(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<AcceptCocRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("✍️ User {} accepting Code of Conduct v{}", user.id, req.version);

    let internal = |e: sqlx::Error| {
        error!("❌ Failed to update CoC status: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to accept Code of Conduct".to_string(),
            }),
        )
    };

    let mut tx = state.db.begin().await.map_err(internal)?;
    let current = current_coc_version(&mut *tx).await.map_err(internal)?;
    if req.version != current {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: "The Code of Conduct has been updated — please re-read it".to_string(),
            }),
        ));
    }
    record_signature(&mut *tx, &user.id, current, state.clock.now())
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;

    info!("✅ Code of Conduct v{} accepted for user: {}", current, user.id);

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

    // Determine the content type from the file bytes — clients routinely
    // mislabel PDFs (e.g. scanner apps export a PDF the picker reports as
    // image/jpeg, or an empty type that becomes application/octet-stream).
    // The sniffed type is authoritative; the client-declared type is only
    // logged for diagnostics.
    let stored_type = crate::routes::cert_type::sniff_certificate_type(&file_bytes)
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Unsupported file type — upload a PDF or image".to_string(),
                }),
            )
        })?;

    info!(
        "📸 Storing certificate ({} bytes, type: {}, client declared: {:?}) for user: {}",
        file_bytes.len(), stored_type, content_type, user.id
    );

    // Store BLOB and content type in database
    sqlx::query("UPDATE users SET food_safety_certificate = ?, food_safety_certificate_type = ? WHERE id = ?")
        .bind(&file_bytes)
        .bind(stored_type)
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
        Some(if user.code_of_conduct_version.is_some() {
            "code_of_conduct_resign".to_string()
        } else {
            "code_of_conduct".to_string()
        })
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

/// Delete a user and everything that identifies them. Rows owned by the user
/// cascade via foreign keys; references without one (who opened the bar, who
/// approved a kiosk) are cleared here.
pub async fn delete_user_account(db: &sqlx::SqlitePool, user_id: &str) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE bar_status SET opened_by = NULL WHERE opened_by = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE kiosk_pairings SET approved_by = NULL WHERE approved_by = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE coc_versions SET published_by = NULL WHERE published_by = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// Self-service account deletion
pub async fn delete_my_account(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    info!("User {} requesting account deletion", user.id);

    delete_user_account(&state.db, &user.id)
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
    let signups: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT s.shift_date,
                (SELECT title FROM events WHERE event_date = s.shift_date) as event_title,
                s.checked_in_at
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
            "code_of_conduct_version": user.code_of_conduct_version,
            "code_of_conduct_signed_at": user.code_of_conduct_signed_at,
            "food_safety_completed": user.food_safety_completed,
            "has_food_safety_certificate": user.food_safety_certificate.is_some(),
            "induction_completed": user.induction_completed,
            "has_contract": user.has_contract,
            "contract_expiry_date": user.contract_expiry_date,
            "privacy_consent_given": user.privacy_consent_given,
            "supervised_shift_completed": user.supervised_shift_completed,
            "created_at": user.created_at,
        },
        "shift_signups": signups.iter().map(|(date, title, checked_in_at)| {
            serde_json::json!({ "date": date, "event_title": title, "checked_in_at": checked_in_at })
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

#[cfg(test)]
mod cert_upload_tests {
    use super::*;
    use crate::auth::create_jwt_token;
    use crate::models::User;
    use crate::test_util::{insert_user, test_state, user_with};
    use axum::body::Body;
    use axum::http::{Request, StatusCode as Status};
    use axum::routing::post;
    use axum::Router;
    use tower::ServiceExt;

    const PDF: &[u8] = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F'];
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/users/me/food-safety-certificate", post(upload_certificate))
            .with_state(state)
    }

    /// Multipart body with one `certificate` part. `declared` is the
    /// part's Content-Type header (None = omit it, like a browser with
    /// an empty File.type).
    fn multipart_body(declared: Option<&str>, bytes: &[u8]) -> (String, Vec<u8>) {
        let boundary = "TESTBOUNDARY1234";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"certificate\"; filename=\"c.bin\"\r\n",
        );
        if let Some(ct) = declared {
            body.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        (
            format!("multipart/form-data; boundary={boundary}"),
            body,
        )
    }

    async fn upload(state: &AppState, user: &User, declared: Option<&str>, bytes: &[u8]) -> Status {
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();
        let (content_type, body) = multipart_body(declared, bytes);
        let req = Request::builder()
            .method("POST")
            .uri("/api/users/me/food-safety-certificate")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", content_type)
            .body(Body::from(body))
            .unwrap();
        build_app(state.clone())
            .oneshot(req)
            .await
            .unwrap()
            .status()
    }

    async fn stored_type(state: &AppState, user_id: &str) -> Option<String> {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT food_safety_certificate_type FROM users WHERE id = ?",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn pdf_mislabeled_as_jpeg_is_stored_as_pdf() {
        let state = test_state().await;
        let user = user_with(true, true, false, true);
        insert_user(&state.db, &user).await;

        // Client lies: declares image/jpeg for PDF bytes (scanner-app case).
        let status = upload(&state, &user, Some("image/jpeg"), PDF).await;
        assert_eq!(status, Status::OK);
        assert_eq!(stored_type(&state, &user.id).await.as_deref(), Some("application/pdf"));
    }

    #[tokio::test]
    async fn pdf_with_no_declared_type_is_accepted() {
        let state = test_state().await;
        let user = user_with(true, true, false, true);
        insert_user(&state.db, &user).await;

        // Empty File.type → no part Content-Type. Previously stored as
        // application/octet-stream (or rejected); now sniffed.
        let status = upload(&state, &user, None, PDF).await;
        assert_eq!(status, Status::OK);
        assert_eq!(stored_type(&state, &user.id).await.as_deref(), Some("application/pdf"));
    }

    #[tokio::test]
    async fn jpeg_and_png_get_correct_types() {
        let state = test_state().await;

        let jpeg_user = user_with(true, true, false, true);
        insert_user(&state.db, &jpeg_user).await;
        assert_eq!(upload(&state, &jpeg_user, Some("application/octet-stream"), JPEG).await, Status::OK);
        assert_eq!(stored_type(&state, &jpeg_user.id).await.as_deref(), Some("image/jpeg"));

        let mut png_user = user_with(true, true, false, true);
        png_user.id = "png-user".to_string();
        insert_user(&state.db, &png_user).await;
        assert_eq!(upload(&state, &png_user, Some("image/jpeg"), PNG).await, Status::OK);
        assert_eq!(stored_type(&state, &png_user.id).await.as_deref(), Some("image/png"));
    }

    #[tokio::test]
    async fn garbage_upload_is_rejected() {
        let state = test_state().await;
        let user = user_with(true, true, false, true);
        insert_user(&state.db, &user).await;

        let status = upload(&state, &user, Some("application/pdf"), b"this is just text, not a document").await;
        assert_eq!(status, Status::BAD_REQUEST);
        assert_eq!(stored_type(&state, &user.id).await, None);
    }

    #[tokio::test]
    async fn unauthenticated_upload_is_rejected() {
        let state = test_state().await;
        let (content_type, body) = multipart_body(Some("application/pdf"), PDF);
        let req = Request::builder()
            .method("POST")
            .uri("/api/users/me/food-safety-certificate")
            .header("content-type", content_type)
            .body(Body::from(body))
            .unwrap();
        let status = build_app(state).oneshot(req).await.unwrap().status();
        assert_eq!(status, Status::UNAUTHORIZED);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{insert_shift_signup, insert_user, test_state, user_with};

    // Should: include kiosk check-in times alongside each shift in a member's data export.
    #[tokio::test]
    async fn data_export_includes_check_in_times() {
        let state = test_state().await;
        let user = user_with(true, true, true, true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-06-19").await;
        sqlx::query("UPDATE shift_signups SET checked_in_at = '2026-06-19 19:45:00' WHERE user_id = ?")
            .bind(&user.id)
            .execute(&state.db)
            .await
            .unwrap();

        let Json(data) = export_my_data(State(state), AuthenticatedUser(user)).await.unwrap();
        assert_eq!(data["shift_signups"][0]["checked_in_at"], "2026-06-19 19:45:00");
    }

    // Impact: bar_status and kiosk_pairings reference users without a foreign
    // key, so a cascade alone left deleted members' IDs behind.
    // Should not: leave the deleted user recorded as the bar opener, kiosk approver, or CoC publisher.
    #[tokio::test]
    async fn account_deletion_clears_kiosk_references() {
        let state = test_state().await;
        let user = user_with(true, true, true, true);
        insert_user(&state.db, &user).await;
        sqlx::query("UPDATE bar_status SET is_open = 1, opened_by = ? WHERE id = 1")
            .bind(&user.id)
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO kiosk_pairings (code, token_hash, status, approved_by, expires_at)
             VALUES ('c', 'h', 'approved', ?, '2026-06-19 20:00:00')",
        )
        .bind(&user.id)
        .execute(&state.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO coc_versions (version, body, published_by) VALUES (2, 'v2', ?)")
            .bind(&user.id)
            .execute(&state.db)
            .await
            .unwrap();

        let db = state.db.clone();
        delete_my_account(State(state), AuthenticatedUser(user.clone())).await.unwrap();

        let remaining: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM bar_status WHERE opened_by = ?1)
                  + (SELECT COUNT(*) FROM kiosk_pairings WHERE approved_by = ?1)
                  + (SELECT COUNT(*) FROM coc_versions WHERE published_by = ?1)
                  + (SELECT COUNT(*) FROM users WHERE id = ?1)",
        )
        .bind(&user.id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(remaining, 0);
    }

    async fn coc_state(state: &AppState, user_id: &str) -> (bool, Option<i64>, Option<String>) {
        sqlx::query_as(
            "SELECT code_of_conduct_signed, code_of_conduct_version, code_of_conduct_signed_at
             FROM users WHERE id = ?",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap()
    }

    async fn publish_v2(state: &AppState) {
        sqlx::query("INSERT INTO coc_versions (version, body) VALUES (2, 'v2')")
            .execute(&state.db)
            .await
            .unwrap();
    }

    // Should: record the signed version and the time of signing.
    #[tokio::test]
    async fn accepting_current_coc_records_version_and_time() {
        let state = test_state().await;
        publish_v2(&state).await;
        let user = user_with(true, false, true, true);
        insert_user(&state.db, &user).await;

        let status = accept_coc(
            State(state.clone()),
            AuthenticatedUser(user.clone()),
            Json(AcceptCocRequest { version: 2 }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            coc_state(&state, &user.id).await,
            (true, Some(2), Some("2026-06-17 14:00:00".to_string()))
        );
    }

    // Impact: a new version can be published while a member has the old text
    // open; accepting then must not count as signing text they never saw.
    // Should not: count acceptance of a superseded version as a signature.
    #[tokio::test]
    async fn accepting_stale_coc_version_conflicts() {
        let state = test_state().await;
        publish_v2(&state).await;
        let user = user_with(true, false, true, true);
        insert_user(&state.db, &user).await;

        let (status, _) = accept_coc(
            State(state.clone()),
            AuthenticatedUser(user.clone()),
            Json(AcceptCocRequest { version: 1 }),
        )
        .await
        .unwrap_err();
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(coc_state(&state, &user.id).await, (false, None, None));
    }

    // Should: include the signed CoC version and signing time in a member's data export.
    #[tokio::test]
    async fn data_export_includes_coc_signature() {
        let state = test_state().await;
        let user = user_with(true, false, true, true);
        insert_user(&state.db, &user).await;
        accept_coc(State(state.clone()), AuthenticatedUser(user.clone()), Json(AcceptCocRequest { version: 1 }))
            .await
            .unwrap();
        let signed = sqlx::query_as::<_, crate::models::User>("SELECT * FROM users WHERE id = ?")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await
            .unwrap();

        let Json(data) = export_my_data(State(state), AuthenticatedUser(signed)).await.unwrap();
        assert_eq!(data["profile"]["code_of_conduct_version"], 1);
        assert_eq!(data["profile"]["code_of_conduct_signed_at"], "2026-06-17 14:00:00");
    }

    // Should: point a member whose CoC was reset at re-signing rather than first-time signing.
    // Should: keep asking members who never signed to sign for the first time.
    #[tokio::test]
    async fn overview_distinguishes_resign_from_first_signature() {
        let state = test_state().await;
        let mut reset = user_with(true, false, true, true);
        reset.code_of_conduct_version = Some(1);
        let never = user_with(true, false, true, true);
        insert_user(&state.db, &reset).await;
        insert_user(&state.db, &never).await;

        let Json(o) = get_my_overview(State(state.clone()), AuthenticatedUser(reset)).await.unwrap();
        assert_eq!(o.next_onboarding_step.as_deref(), Some("code_of_conduct_resign"));
        let Json(o) = get_my_overview(State(state), AuthenticatedUser(never)).await.unwrap();
        assert_eq!(o.next_onboarding_step.as_deref(), Some("code_of_conduct"));
    }
}
