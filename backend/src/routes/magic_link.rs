use axum::{
    extract::{ConnectInfo, Query, State},
    http::StatusCode,
    Json,
    response::Redirect,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, error};
use uuid::Uuid;
use webauthn_rs::prelude::Url;

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

        // Rate limit per-IP: max 50 per hour (generous due to shared NAT on eduroam)
        let ip_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM magic_link_tokens WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')"
        )
        .bind(&ip_str)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if ip_count >= 50 {
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

/// Landing for the link in the email. Only redirects to the sign-in page, which
/// redeems the token on a button press: mail scanners and link previews fetch
/// GET links, and must not use up a single-use token.
pub async fn verify_magic_link(
    State(state): State<AppState>,
    Query(params): Query<MagicLinkVerifyQuery>,
) -> Redirect {
    let callback = format!("{}/auth/magic-link-callback", state.public_url);
    match Url::parse(&callback) {
        Ok(mut url) => {
            url.query_pairs_mut().append_pair("token", &params.token);
            Redirect::temporary(url.as_str())
        }
        Err(_) => Redirect::temporary(&callback),
    }
}

#[derive(Debug, Serialize)]
pub struct MagicLinkSession {
    pub token: String,
    pub user_id: String,
    pub is_committee: bool,
    pub is_admin: bool,
}

/// Redeem a magic link token for a session. Each token works once, within 15
/// minutes of being issued.
pub async fn redeem_magic_link(
    State(state): State<AppState>,
    Json(req): Json<MagicLinkVerifyQuery>,
) -> Result<Json<MagicLinkSession>, (StatusCode, Json<ErrorResponse>)> {
    info!("Magic link redemption attempt");

    let bad = |error: &str| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: error.to_string() }));
    let internal = |e: sqlx::Error| {
        error!("Failed to redeem magic link: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Database error".to_string() }))
    };

    // Claim the token atomically so two concurrent redemptions can't both succeed.
    let email: Option<String> = sqlx::query_scalar(
        "UPDATE magic_link_tokens SET used = TRUE
         WHERE token = ? AND NOT used AND created_at >= datetime('now', '-15 minutes')
         RETURNING email",
    )
    .bind(&req.token)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let email = email.ok_or_else(|| bad("This sign-in link has expired or was already used. Please request a new one."))?;

    let (user_id, is_committee, is_admin): (String, bool, bool) =
        sqlx::query_as("SELECT id, is_committee, is_admin FROM users WHERE email = ?")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?
            .ok_or_else(|| bad("User not found"))?;

    let token = create_jwt_token(&user_id, &state.jwt_secret).map_err(|e| {
        error!("Failed to create JWT: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to create token".to_string() }))
    })?;

    Ok(Json(MagicLinkSession { token, user_id, is_committee, is_admin }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{insert_user, test_state, user_with};

    async fn issue(state: &AppState, email: &str, token: &str, age_minutes: i64) {
        sqlx::query(
            "INSERT INTO magic_link_tokens (id, email, token, created_at)
             VALUES (?, ?, ?, datetime('now', ?))",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(email)
        .bind(token)
        .bind(format!("-{age_minutes} minutes"))
        .execute(&state.db)
        .await
        .unwrap();
    }

    async fn member_with_email(state: &AppState, email: &str) {
        let user = user_with(true, true, true, true);
        insert_user(&state.db, &user).await;
        sqlx::query("UPDATE users SET email = ? WHERE id = ?")
            .bind(email)
            .bind(&user.id)
            .execute(&state.db)
            .await
            .unwrap();
    }

    async fn redeem(state: &AppState, token: &str) -> Result<Json<MagicLinkSession>, (StatusCode, Json<ErrorResponse>)> {
        redeem_magic_link(State(state.clone()), Json(MagicLinkVerifyQuery { token: token.to_string() })).await
    }

    // Impact: mail scanners prefetch links in emails; if opening the link spent
    // the token, members would find their sign-in link already used.
    // Should: leave the token redeemable after the emailed link is opened.
    #[tokio::test]
    async fn opening_the_link_does_not_use_it_up() {
        let state = test_state().await;
        member_with_email(&state, "m@example.test").await;
        issue(&state, "m@example.test", "tok", 0).await;

        let _ = verify_magic_link(State(state.clone()), Query(MagicLinkVerifyQuery { token: "tok".into() })).await;

        assert!(redeem(&state, "tok").await.is_ok());
    }

    // Impact: a leaked link (forwarded email, logs, history) must not mint sessions repeatedly.
    // Should: sign in once per token.
    // Should not: accept the same token a second time.
    #[tokio::test]
    async fn token_is_single_use() {
        let state = test_state().await;
        member_with_email(&state, "m@example.test").await;
        issue(&state, "m@example.test", "tok", 0).await;

        assert!(redeem(&state, "tok").await.is_ok());
        let (status, _) = redeem(&state, "tok").await.expect_err("second use");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // Should not: accept a token more than 15 minutes old.
    #[tokio::test]
    async fn expired_token_is_refused() {
        let state = test_state().await;
        member_with_email(&state, "m@example.test").await;
        issue(&state, "m@example.test", "tok", 16).await;

        assert!(redeem(&state, "tok").await.is_err());
    }
}
