use axum::{
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
    response::Redirect,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::net::{IpAddr, SocketAddr};
use tracing::{info, error, warn};
use uuid::Uuid;
use webauthn_rs::prelude::Url;

use crate::auth::create_jwt_token;
use crate::email::EmailService;
use crate::models::ErrorResponse;
use crate::routes::auth::{create_user_in_db, AppState};

#[derive(Debug, Deserialize)]
pub struct MagicLinkRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct MagicLinkVerifyQuery {
    pub token: String,
}

/// Emails per hour to any one address, across sign-in and sign-up links.
const PER_EMAIL_PER_HOUR: i64 = 3;
/// Emails per hour requested from one client IP (generous: eduroam is one NAT).
const PER_IP_PER_HOUR: i64 = 50;
/// Emails per hour site-wide. The backstop against requests spread over many
/// addresses, which the per-address limit can't catch; protects the sending
/// quota and domain reputation.
const SITE_PER_HOUR: i64 = 100;

/// Whether to send a sign-in or sign-up email.
#[derive(Debug, PartialEq)]
pub enum Throttle {
    Send,
    /// Over the per-address limit: answer as usual but send nothing, so the
    /// response doesn't reveal that an address is being targeted.
    Skip,
    Refuse(&'static str),
}

/// Check the email rate limits, counted from the links issued in the last hour.
pub async fn email_throttle(db: &SqlitePool, email: &str, ip: &str) -> Result<Throttle, sqlx::Error> {
    let (site, by_ip, by_email): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(ip_address = ?), 0), COALESCE(SUM(email = ?), 0)
         FROM magic_link_tokens WHERE created_at > datetime('now', '-1 hour')",
    )
    .bind(ip)
    .bind(email)
    .fetch_one(db)
    .await?;

    Ok(if site >= SITE_PER_HOUR {
        warn!("Site-wide email limit reached ({} in the last hour)", site);
        Throttle::Refuse("We're sending a lot of emails right now. Please try again in a little while.")
    } else if by_ip >= PER_IP_PER_HOUR {
        Throttle::Refuse("Too many requests from this network. Please try again later.")
    } else if by_email >= PER_EMAIL_PER_HOUR {
        Throttle::Skip
    } else {
        Throttle::Send
    })
}

/// Rate limits apply in release builds only, so local testing isn't throttled.
async fn throttle_for(db: &SqlitePool, email: &str, ip: &str) -> Result<Throttle, sqlx::Error> {
    if cfg!(debug_assertions) {
        Ok(Throttle::Send)
    } else {
        email_throttle(db, email, ip).await
    }
}

/// The requesting client's IP. Behind the local reverse proxy every connection
/// comes from loopback, so there the proxy's `X-Forwarded-For` is used: its last
/// entry, the one the proxy itself appended. Clients reaching the server
/// directly can't spoof it.
pub fn client_ip(addr: SocketAddr, headers: &HeaderMap) -> String {
    if addr.ip().is_loopback() {
        let forwarded = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit(',').next())
            .map(str::trim)
            .filter(|ip| ip.parse::<IpAddr>().is_ok());
        if let Some(ip) = forwarded {
            return ip.to_string();
        }
    }
    addr.ip().to_string()
}

/// Store a new single-use link token. With `display_name`, redeeming it creates
/// the account (an email sign-up); without, it signs into an existing one.
pub async fn issue_token(db: &SqlitePool, email: &str, ip: &str, display_name: Option<&str>) -> Result<String, sqlx::Error> {
    let token_bytes: [u8; 32] = rand::random();
    let token = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token_bytes);
    sqlx::query(
        "INSERT INTO magic_link_tokens (id, email, token, ip_address, display_name) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(email)
    .bind(&token)
    .bind(ip)
    .bind(display_name)
    .execute(db)
    .await?;
    // Tokens older than the rate-limit window are no longer needed.
    sqlx::query("DELETE FROM magic_link_tokens WHERE created_at < datetime('now', '-1 hour')")
        .execute(db)
        .await
        .ok();
    Ok(token)
}

/// Which email a link goes out in.
pub enum LinkEmail {
    SignIn,
    /// Sign-up for an address that already has an account: a sign-in link.
    AlreadyRegistered,
    /// Sign-up for a new address: redeeming the link creates the account.
    Welcome,
}

pub async fn send_link_email(state: &AppState, email_service: &EmailService, email: &str, token: &str, kind: LinkEmail) {
    let link = format!("{}/api/auth/magic-link/verify?token={}", state.public_url, token);
    let button = format!(
        r#"<p><a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #8B0000; color: white; text-decoration: none; border-radius: 4px;">Sign In</a></p>"#,
        link
    );
    let (subject, intro) = match kind {
        LinkEmail::SignIn => (
            "Sign in to Wolfson Cellar Bar",
            "<h2>Sign in to Wolfson Cellar Bar</h2><p>Click the link below to sign in. This link expires in 15 minutes.</p>",
        ),
        LinkEmail::AlreadyRegistered => (
            "Sign in to Wolfson Cellar Bar",
            "<h2>You already have an account</h2><p>Someone tried to sign up with this email address, which already has a Wolfson Cellar Bar account. Click below to sign in. This link expires in 15 minutes.</p>",
        ),
        LinkEmail::Welcome => (
            "Welcome to Wolfson Cellar Bar",
            "<h2>Welcome to Wolfson Cellar Bar!</h2><p>Click below to confirm your email and finish creating your account. This link expires in 15 minutes.</p>",
        ),
    };
    let html = format!(
        r#"{}{}<p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>"#,
        intro, button
    );
    if let Err(e) = email_service.send_email(email, subject, &html, None).await {
        // Not surfaced to the caller, so responses don't reveal anything about the address.
        error!("Failed to send link email: {}", e);
    }
}

fn throttle_error(e: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    error!("Failed to check email rate limits: {}", e);
    (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Database error".to_string() }))
}

/// Request a magic link login email
pub async fn request_magic_link(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<MagicLinkRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let email = req.email.trim().to_lowercase();
    info!("Magic link requested");

    let email_service = state.email_service.as_ref().ok_or_else(|| {
        error!("Magic link requested but email service not configured");
        (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: "Email service not configured".to_string() }))
    })?;

    let ip = client_ip(addr, &headers);
    match throttle_for(&state.db, &email, &ip).await.map_err(throttle_error)? {
        Throttle::Refuse(msg) => {
            return Err((StatusCode::TOO_MANY_REQUESTS, Json(ErrorResponse { error: msg.to_string() })));
        }
        Throttle::Skip => return Ok(StatusCode::OK),
        Throttle::Send => {}
    }

    let user_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
    // Return 200 regardless to prevent enumeration
    if !user_exists {
        return Ok(StatusCode::OK);
    }

    let token = issue_token(&state.db, &email, &ip, None).await.map_err(|e| {
        error!("Failed to store magic link token: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "Failed to create magic link".to_string() }))
    })?;
    send_link_email(&state, email_service, &email, &token, LinkEmail::SignIn).await;

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
    let claimed: Option<(String, Option<String>)> = sqlx::query_as(
        "UPDATE magic_link_tokens SET used = TRUE
         WHERE token = ? AND NOT used AND created_at >= datetime('now', '-15 minutes')
         RETURNING email, display_name",
    )
    .bind(&req.token)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let (email, signup_name) =
        claimed.ok_or_else(|| bad("This sign-in link has expired or was already used. Please request a new one."))?;

    let existing: Option<(String, bool, bool)> =
        sqlx::query_as("SELECT id, is_committee, is_admin FROM users WHERE email = ?")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let (user_id, is_committee, is_admin) = match (existing, signup_name) {
        (Some(user), _) => user,
        // An email sign-up: the address is now proven, so create the account.
        (None, Some(name)) => {
            let user = create_user_in_db(&state.db, Some(name), Some(email.clone()), None).await?;
            info!("📧 Created email-only user {}", user.id);
            (user.id, user.is_committee, user.is_admin)
        }
        (None, None) => return Err(bad("User not found")),
    };

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

    // Impact: behind the reverse proxy every request arrives from loopback; without
    // the forwarded address all users would share one rate-limit counter.
    // Should: use the address the local proxy appended to X-Forwarded-For.
    // Should not: trust X-Forwarded-For from clients connecting directly.
    #[test]
    fn client_ip_trusts_only_the_local_proxy() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "198.51.100.66, 203.0.113.7".parse().unwrap());
        let proxy = SocketAddr::from(([127, 0, 0, 1], 40000));
        let direct = SocketAddr::from(([192, 0, 2, 5], 40000));
        assert_eq!(client_ip(proxy, &headers), "203.0.113.7");
        assert_eq!(client_ip(direct, &headers), "192.0.2.5");
        assert_eq!(client_ip(proxy, &HeaderMap::new()), "127.0.0.1");
    }

    // Should: send nothing, without an error, once an address has had its hourly emails.
    // Should: refuse every request once the site-wide hourly cap is reached.
    #[tokio::test]
    async fn email_limits_per_address_and_site_wide() {
        let state = test_state().await;
        for _ in 0..PER_EMAIL_PER_HOUR {
            issue_token(&state.db, "a@example.test", "192.0.2.1", None).await.unwrap();
        }
        assert_eq!(email_throttle(&state.db, "a@example.test", "192.0.2.9").await.unwrap(), Throttle::Skip);
        assert_eq!(email_throttle(&state.db, "b@example.test", "192.0.2.9").await.unwrap(), Throttle::Send);

        for i in PER_EMAIL_PER_HOUR..SITE_PER_HOUR {
            issue_token(&state.db, &format!("{i}@example.test"), &format!("198.51.100.{}", i % 200), None)
                .await
                .unwrap();
        }
        assert!(matches!(
            email_throttle(&state.db, "new@example.test", "192.0.2.9").await.unwrap(),
            Throttle::Refuse(_)
        ));
    }

    // Impact: creating the account only once the link is redeemed stops anyone
    // claiming an address they can't read.
    // Should: create the account when a sign-up link is redeemed.
    // Should not: create any account before then.
    #[tokio::test]
    async fn signup_creates_the_account_on_redeem() {
        let state = test_state().await;
        let token = issue_token(&state.db, "new@example.test", "192.0.2.1", Some("New Member")).await.unwrap();
        let count = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = 'new@example.test'")
                .fetch_one(&state.db)
                .await
                .unwrap()
        };
        assert_eq!(count().await, 0);

        let Json(session) = redeem(&state, &token).await.unwrap();

        assert_eq!(count().await, 1);
        let name: Option<String> = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
            .bind(&session.user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(name.as_deref(), Some("New Member"));
    }
}
