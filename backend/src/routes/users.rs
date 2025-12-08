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
#[ts(export, export_to = "../frontend/src/types/")]
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
#[ts(export, export_to = "../frontend/src/types/")]
pub struct UserOverview {
    pub next_onboarding_step: Option<String>, // "code_of_conduct", "food_safety", "induction", or null if complete
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
#[ts(export, export_to = "../frontend/src/types/")]
pub struct VerificationToken {
    pub token: String,
}

// Generate verification token for QR code
pub async fn get_verification_token(
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
    let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "your-secret-key".to_string());
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
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

    // Determine next onboarding step
    let next_onboarding_step = if !user.code_of_conduct_signed {
        Some("code_of_conduct".to_string())
    } else if !user.food_safety_completed {
        Some("food_safety".to_string())
    } else if !user.induction_completed {
        Some("induction".to_string())
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
