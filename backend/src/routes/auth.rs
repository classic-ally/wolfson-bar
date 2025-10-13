use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use base64::Engine;
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{info, error, debug};
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::auth::create_jwt_token;
use crate::models::{AuthResponse, ErrorResponse, RegisterStartRequest, User};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub webauthn: Webauthn,
}

// Registration Start - Generate challenge
pub async fn register_start(
    State(state): State<AppState>,
    Json(req): Json<RegisterStartRequest>,
) -> Result<Json<CreationChallengeResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("📝 Registration start for: {}", req.display_name);
    let user_id = Uuid::new_v4();
    let user_name = req.display_name.clone();

    // Generate passkey registration challenge
    let (ccr, reg_state) = state
        .webauthn
        .start_passkey_registration(user_id, &user_name, &user_name, None)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to start registration: {}", e),
                }),
            )
        })?;

    // Store registration state temporarily
    let state_id = Uuid::new_v4().to_string();
    let state_data = serde_json::to_string(&reg_state).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to serialize state: {}", e),
            }),
        )
    })?;

    sqlx::query("INSERT INTO auth_states (id, state_type, state_data, display_name) VALUES (?, ?, ?, ?)")
        .bind(&state_id)
        .bind("registration")
        .bind(&state_data)
        .bind(&req.display_name)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    // Add state_id to response (we'll need it later)
    // For simplicity, we'll use the user_id as lookup key
    Ok(Json(ccr))
}

// Registration Finish - Verify and store credential
pub async fn register_finish(
    State(state): State<AppState>,
    Json(credential): Json<RegisterPublicKeyCredential>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Registration finish - verifying credential");

    // Get registration state (in production, use proper session management)
    let auth_state: (String, Option<String>) = sqlx::query_as(
        "SELECT state_data, display_name FROM auth_states WHERE state_type = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind("registration")
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("No registration state found: {}", e),
            }),
        )
    })?;

    let display_name = auth_state.1;
    let reg_state: PasskeyRegistration = serde_json::from_str(&auth_state.0).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to deserialize state: {}", e),
            }),
        )
    })?;

    // Verify the credential
    let passkey = state
        .webauthn
        .finish_passkey_registration(&credential, &reg_state)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("Registration verification failed: {}", e),
                }),
            )
        })?;

    // Check if this is the first user
    let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    let is_committee = user_count.0 == 0;
    if is_committee {
        info!("👑 First user - granting committee permissions");
    }

    // Store user with passkey
    let user = User::new(
        display_name,
        serde_json::to_string(&passkey).unwrap(),
        is_committee,
    );

    info!("💾 Storing user with ID: {}", user.id);
    debug!("🔑 Passkey credential: {}", user.passkey_credential);

    sqlx::query("INSERT INTO users (id, display_name, passkey_credential, is_committee, code_of_conduct_signed, food_safety_completed, food_safety_certificate, induction_completed, has_contract, contract_expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&user.id)
        .bind(&user.display_name)
        .bind(&user.passkey_credential)
        .bind(is_committee)
        .bind(&user.code_of_conduct_signed)
        .bind(&user.food_safety_completed)
        .bind(&user.food_safety_certificate)
        .bind(&user.induction_completed)
        .bind(&user.has_contract)
        .bind(&user.contract_expiry_date)
        .bind(&user.created_at)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to create user: {}", e),
                }),
            )
        })?;

    // Generate JWT
    let token = create_jwt_token(&user.id).map_err(|e| {
        error!("❌ Failed to create JWT: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create token: {}", e),
            }),
        )
    })?;

    info!("🎉 Registration complete for user: {}", user.id);

    // Clean up registration state
    sqlx::query("DELETE FROM auth_states WHERE state_type = ?")
        .bind("registration")
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(AuthResponse {
        token,
        user_id: user.id,
        is_committee: user.is_committee,
    }))
}

// Authentication Start - Generate challenge
pub async fn login_start(
    State(state): State<AppState>,
) -> Result<Json<RequestChallengeResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("🔐 Login start - fetching registered users");

    // Get all passkeys
    let users = sqlx::query_as::<_, User>("SELECT * FROM users")
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    info!("👥 Found {} users in database", users.len());

    let passkeys: Vec<Passkey> = users
        .iter()
        .filter_map(|u| {
            debug!("🔍 Parsing passkey for user: {}", u.id);
            serde_json::from_str(&u.passkey_credential).ok()
        })
        .collect();

    info!("🔑 Parsed {} valid passkeys", passkeys.len());

    if passkeys.is_empty() {
        error!("❌ No users registered or failed to parse passkeys");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "No users registered".to_string(),
            }),
        ));
    }

    // Generate authentication challenge
    let (rcr, auth_state) = state
        .webauthn
        .start_passkey_authentication(&passkeys)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to start authentication: {}", e),
                }),
            )
        })?;

    // Store auth state
    let state_id = Uuid::new_v4().to_string();
    let state_data = serde_json::to_string(&auth_state).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to serialize state: {}", e),
            }),
        )
    })?;

    sqlx::query("INSERT INTO auth_states (id, state_type, state_data) VALUES (?, ?, ?)")
        .bind(&state_id)
        .bind("authentication")
        .bind(&state_data)
        .execute(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    Ok(Json(rcr))
}

// Authentication Finish - Verify signature
pub async fn login_finish(
    State(state): State<AppState>,
    Json(credential): Json<PublicKeyCredential>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("✅ Login finish - verifying signature");

    // Get auth state
    let auth_state_record: (String,) = sqlx::query_as(
        "SELECT state_data FROM auth_states WHERE state_type = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind("authentication")
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("No auth state found: {}", e),
            }),
        )
    })?;

    let auth_state: PasskeyAuthentication =
        serde_json::from_str(&auth_state_record.0).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to deserialize state: {}", e),
                }),
            )
        })?;

    // Verify the credential
    let auth_result = state
        .webauthn
        .finish_passkey_authentication(&credential, &auth_state)
        .map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: format!("Authentication failed: {}", e),
                }),
            )
        })?;

    // Find user by credential ID
    // The credential ID in the passkey JSON is base64url encoded
    // We need to serialize the credential ID the same way it's stored
    let cred_id_str = serde_json::to_string(auth_result.cred_id()).unwrap_or_default();
    info!("🔍 Looking for user with credential ID: {}", cred_id_str);

    let users = sqlx::query_as::<_, User>("SELECT * FROM users")
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    info!("👥 Checking {} users", users.len());
    for u in &users {
        debug!("User {}: checking if credential contains '{}'", u.id, cred_id_str);
        debug!("  Credential preview: {}...", &u.passkey_credential.chars().take(100).collect::<String>());
    }

    let user = users
        .iter()
        .find(|u| {
            let found = u.passkey_credential.contains(&cred_id_str);
            debug!("User {}: match = {}", u.id, found);
            found
        })
        .ok_or_else(|| {
            error!("❌ User not found for credential ID: {}", cred_id_str);
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "User not found".to_string(),
                }),
            )
        })?;

    info!("✨ Found matching user: {}", user.id);

    // Generate JWT
    let token = create_jwt_token(&user.id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create token: {}", e),
            }),
        )
    })?;

    // Clean up auth state
    sqlx::query("DELETE FROM auth_states WHERE state_type = ?")
        .bind("authentication")
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(AuthResponse {
        token,
        user_id: user.id.clone(),
        is_committee: user.is_committee,
    }))
}
