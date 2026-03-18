use axum::{
    extract::{ConnectInfo, Query, State},
    http::StatusCode,
    Json,
    response::Redirect,
};
use serde::Deserialize;
use std::net::SocketAddr;
use tracing::{info, error};
use uuid::Uuid;

use crate::auth::create_jwt_token;
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

#[derive(Debug, Deserialize)]
pub struct MagicLinkRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct MagicLinkVerifyQuery {
    pub token: String,
}

/// Request a magic link login email
pub async fn request_magic_link(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<MagicLinkRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let email = req.email.trim().to_lowercase();
    info!("Magic link requested for email: {}", email);

    // Always return 200 to prevent email enumeration
    let email_service = match &state.email_service {
        Some(svc) => svc,
        None => {
            error!("Magic link requested but email service not configured");
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "Email service not configured".to_string(),
                }),
            ));
        }
    };

    let ip_str = addr.ip().to_string();

    // Rate limiting disabled in debug builds for easier testing
    #[cfg(not(debug_assertions))]
    {
        // Rate limit per-email: max 3 per hour
        let email_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM magic_link_tokens WHERE email = ? AND created_at > datetime('now', '-1 hour')"
        )
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if email_count >= 3 {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorResponse {
                    error: "Too many magic link requests. Please try again later.".to_string(),
                }),
            ));
        }

        // Rate limit per-IP: max 10 per hour
        let ip_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM magic_link_tokens WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')"
        )
        .bind(&ip_str)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if ip_count >= 10 {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorResponse {
                    error: "Too many requests from this IP. Please try again later.".to_string(),
                }),
            ));
        }
    }

    // Check if user exists with this email
    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)"
    )
    .bind(&email)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !user_exists {
        // Return 200 regardless to prevent enumeration
        info!("Magic link requested for non-existent email: {}", email);
        return Ok(StatusCode::OK);
    }

    // Generate random token
    let token_bytes: [u8; 32] = rand::random();
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        token_bytes,
    );

    let id = Uuid::new_v4().to_string();

    // Store token
    sqlx::query(
        "INSERT INTO magic_link_tokens (id, email, token, ip_address) VALUES (?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&email)
    .bind(&token)
    .bind(&ip_str)
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to store magic link token: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to create magic link".to_string(),
            }),
        )
    })?;

    // Send email
    let link = format!("{}/api/auth/magic-link/verify?token={}", state.public_url, token);
    let html = format!(
        r#"<h2>Sign in to Wolfson Cellar Bar</h2>
        <p>Click the link below to sign in. This link expires in 15 minutes.</p>
        <p><a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #8B0000; color: white; text-decoration: none; border-radius: 4px;">Sign In</a></p>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>"#,
        link
    );

    if let Err(e) = email_service.send_email(&email, "Sign in to Wolfson Cellar Bar", &html, None).await {
        error!("Failed to send magic link email: {}", e);
        // Don't expose email send failures to prevent enumeration
    }

    // Clean up expired tokens
    sqlx::query("DELETE FROM magic_link_tokens WHERE created_at < datetime('now', '-1 hour')")
        .execute(&state.db)
        .await
        .ok();

    Ok(StatusCode::OK)
}

/// Verify a magic link token and redirect with JWT
pub async fn verify_magic_link(
    State(state): State<AppState>,
    Query(params): Query<MagicLinkVerifyQuery>,
) -> Result<Redirect, (StatusCode, Json<ErrorResponse>)> {
    info!("Magic link verification attempt");

    // Look up unused token, check age
    let token_record: Option<(String, String, String)> = sqlx::query_as(
        "SELECT id, email, created_at FROM magic_link_tokens WHERE token = ? AND used = FALSE"
    )
    .bind(&params.token)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to look up magic link token: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Database error".to_string(),
            }),
        )
    })?;

    let (token_id, email, created_at) = token_record.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid or expired magic link".to_string(),
            }),
        )
    })?;

    // Check if token is less than 15 minutes old
    let created = chrono::NaiveDateTime::parse_from_str(&created_at, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Invalid token timestamp".to_string(),
                }),
            )
        })?;

    let now = chrono::Utc::now().naive_utc();
    let age = now.signed_duration_since(created);
    if age.num_minutes() > 15 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Magic link has expired. Please request a new one.".to_string(),
            }),
        ));
    }

    // Mark token as used
    sqlx::query("UPDATE magic_link_tokens SET used = TRUE WHERE id = ?")
        .bind(&token_id)
        .execute(&state.db)
        .await
        .ok();

    // Look up user by email
    let user: (String, bool, bool) = sqlx::query_as(
        "SELECT id, is_committee, is_admin FROM users WHERE email = ?"
    )
    .bind(&email)
    .fetch_one(&state.db)
    .await
    .map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "User not found".to_string(),
            }),
        )
    })?;

    let (user_id, is_committee, is_admin) = user;

    // Create JWT
    let jwt = create_jwt_token(&user_id, &state.jwt_secret).map_err(|e| {
        error!("Failed to create JWT: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to create token".to_string(),
            }),
        )
    })?;

    // Redirect to frontend callback
    let redirect_url = format!(
        "{}/auth/magic-link-callback?token={}&user_id={}&is_committee={}&is_admin={}",
        state.public_url, jwt, user_id, is_committee, is_admin
    );

    Ok(Redirect::temporary(&redirect_url))
}
