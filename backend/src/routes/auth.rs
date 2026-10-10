use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{info, error};
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::auth::create_jwt_token;
use crate::models::{AuthResponse, ErrorResponse, RegisterStartRequest, User};

/// Shared helper for creating a user in the database.
/// Handles first-user detection (auto-admin/committee).
pub async fn create_user_in_db(
    db: &SqlitePool,
    display_name: Option<String>,
    email: Option<String>,
    passkey_credential: Option<String>,
) -> Result<User, (StatusCode, Json<ErrorResponse>)> {
    // Check if this is the first user
    let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Database error: {}", e),
                }),
            )
        })?;

    let is_first_user = user_count.0 == 0;
    if is_first_user {
        info!("👑 First user - granting admin and committee permissions");
    }

    let mut user = User::new(
        display_name,
        passkey_credential,
        is_first_user,
        is_first_user,
    );
    user.email = email;

    info!("💾 Storing user with ID: {}", user.id);

    sqlx::query("INSERT INTO users (id, display_name, passkey_credential, is_committee, is_admin, code_of_conduct_signed, food_safety_completed, food_safety_certificate, induction_completed, has_contract, contract_expiry_date, created_at, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&user.id)
        .bind(&user.display_name)
        .bind(&user.passkey_credential)
        .bind(user.is_committee)
        .bind(user.is_admin)
        .bind(user.code_of_conduct_signed)
        .bind(user.food_safety_completed)
        .bind(&user.food_safety_certificate)
        .bind(user.induction_completed)
        .bind(user.has_contract)
        .bind(&user.contract_expiry_date)
        .bind(&user.created_at)
        .bind(&user.email)
        .execute(db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to create user: {}", e),
                }),
            )
        })?;

    Ok(user)
}

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub webauthn: Webauthn,
    pub jwt_secret: Vec<u8>,
    /// Persistent secret for kiosk check-in TOTP codes. Unlike jwt_secret this
    /// is loaded from app_config so rotating codes survive backend restarts.
    pub kiosk_secret: Vec<u8>,
    pub email_service: Option<crate::email::EmailService>,
    pub public_url: String,
    pub clock: crate::clock::Clock,
}

/// How long a passkey challenge stays usable between start and finish.
const CHALLENGE_TTL: &str = "-10 minutes";

fn reject(status: StatusCode, msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, Json<ErrorResponse>) {
    error!("❌ Auth error: {}", e);
    reject(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
}

/// A passkey challenge plus the id of its stored state, which the client echoes
/// back to the finish endpoint so concurrent ceremonies never share a challenge.
#[derive(Debug, Serialize)]
pub struct ChallengeResponse<T> {
    pub state_id: String,
    #[serde(flatten)]
    pub challenge: T,
}

#[derive(Debug, Deserialize)]
pub struct FinishRequest<T> {
    pub state_id: String,
    pub credential: T,
}

/// Store a ceremony's state under a fresh id, sweeping abandoned ones of the same type.
async fn store_challenge(
    db: &SqlitePool,
    state_type: &str,
    state: &impl Serialize,
    meta: Option<&str>,
) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
    let state_data = serde_json::to_string(state).map_err(internal)?;

    sqlx::query("DELETE FROM auth_states WHERE state_type = ? AND created_at < datetime('now', ?)")
        .bind(state_type)
        .bind(CHALLENGE_TTL)
        .execute(db)
        .await
        .map_err(internal)?;

    let state_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO auth_states (id, state_type, state_data, display_name) VALUES (?, ?, ?, ?)")
        .bind(&state_id)
        .bind(state_type)
        .bind(&state_data)
        .bind(meta)
        .execute(db)
        .await
        .map_err(internal)?;

    Ok(state_id)
}

/// Read and delete a ceremony's state in one statement, so each challenge is used at most once.
async fn take_challenge<T: serde::de::DeserializeOwned>(
    db: &SqlitePool,
    state_type: &str,
    state_id: &str,
) -> Result<(T, Option<String>), (StatusCode, Json<ErrorResponse>)> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "DELETE FROM auth_states
         WHERE id = ? AND state_type = ? AND created_at >= datetime('now', ?)
         RETURNING state_data, display_name",
    )
    .bind(state_id)
    .bind(state_type)
    .bind(CHALLENGE_TTL)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    let (state_data, meta) =
        row.ok_or_else(|| reject(StatusCode::BAD_REQUEST, "Passkey request expired, please try again"))?;
    let state = serde_json::from_str(&state_data).map_err(internal)?;
    Ok((state, meta))
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistrationMeta {
    name: String,
    email: Option<String>,
}

// Registration Start - Generate challenge
pub async fn register_start(
    State(state): State<AppState>,
    Json(req): Json<RegisterStartRequest>,
) -> Result<Json<ChallengeResponse<CreationChallengeResponse>>, (StatusCode, Json<ErrorResponse>)> {
    info!("📝 Registration start for: {}", req.display_name);

    let (challenge, reg_state) = state
        .webauthn
        .start_passkey_registration(Uuid::new_v4(), &req.display_name, &req.display_name, None)
        .map_err(internal)?;

    let meta = serde_json::to_string(&RegistrationMeta { name: req.display_name, email: req.email })
        .map_err(internal)?;
    let state_id = store_challenge(&state.db, "registration", &reg_state, Some(&meta)).await?;

    Ok(Json(ChallengeResponse { state_id, challenge }))
}

// Registration Finish - Verify and store credential
pub async fn register_finish(
    State(state): State<AppState>,
    Json(req): Json<FinishRequest<RegisterPublicKeyCredential>>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let (reg_state, meta): (PasskeyRegistration, _) =
        take_challenge(&state.db, "registration", &req.state_id).await?;
    let meta: RegistrationMeta = serde_json::from_str(meta.as_deref().unwrap_or_default()).map_err(internal)?;

    let passkey = state
        .webauthn
        .finish_passkey_registration(&req.credential, &reg_state)
        .map_err(|e| {
            info!("📝 Passkey registration verification failed: {}", e);
            reject(StatusCode::BAD_REQUEST, "Registration verification failed")
        })?;

    let passkey_json = serde_json::to_string(&passkey).map_err(internal)?;
    let user = create_user_in_db(&state.db, Some(meta.name), meta.email, Some(passkey_json)).await?;

    let token = create_jwt_token(&user.id, &state.jwt_secret).map_err(internal)?;

    info!("🎉 Registration complete for user: {}", user.id);

    Ok(Json(AuthResponse {
        token,
        user_id: user.id,
        is_committee: user.is_committee,
        is_admin: user.is_admin,
    }))
}

// Authentication Start - Generate challenge
pub async fn login_start(
    State(state): State<AppState>,
) -> Result<Json<ChallengeResponse<RequestChallengeResponse>>, (StatusCode, Json<ErrorResponse>)> {
    // Discoverable (usernameless) login: the authenticator picks the credential,
    // so allowCredentials stays empty no matter how many members have passkeys.
    // Listing every passkey broke once there were more than browsers accept (64 in Chrome).
    let (mut challenge, auth_state) = state
        .webauthn
        .start_discoverable_authentication()
        .map_err(internal)?;
    // webauthn-rs asks for conditional (autofill) mediation; the sign-in button uses the modal prompt.
    challenge.mediation = None;

    let state_id = store_challenge(&state.db, "authentication", &auth_state, None).await?;

    Ok(Json(ChallengeResponse { state_id, challenge }))
}

// Authentication Finish - Verify signature
pub async fn login_finish(
    State(state): State<AppState>,
    Json(req): Json<FinishRequest<PublicKeyCredential>>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let (auth_state, _): (DiscoverableAuthentication, _) =
        take_challenge(&state.db, "authentication", &req.state_id).await?;

    // The authenticator chose the credential; find the member it belongs to.
    let cred_id = req.credential.get_credential_id();
    let (user, passkey) = sqlx::query_as::<_, User>("SELECT * FROM users WHERE passkey_credential IS NOT NULL")
        .fetch_all(&state.db)
        .await
        .map_err(internal)?
        .into_iter()
        .find_map(|u| {
            let passkey: Passkey = serde_json::from_str(u.passkey_credential.as_deref()?).ok()?;
            (passkey.cred_id().as_ref() == cred_id).then_some((u, passkey))
        })
        .ok_or_else(|| {
            info!("🔍 No member has the presented passkey");
            reject(StatusCode::UNAUTHORIZED, "Passkey not recognised")
        })?;

    state
        .webauthn
        .finish_discoverable_authentication(&req.credential, auth_state, &[DiscoverableKey::from(&passkey)])
        .map_err(|e| {
            info!("🔐 Passkey verification failed for {}: {}", user.id, e);
            reject(StatusCode::UNAUTHORIZED, "Authentication failed")
        })?;

    let token = create_jwt_token(&user.id, &state.jwt_secret).map_err(internal)?;

    info!("✨ Logged in user: {}", user.id);

    Ok(Json(AuthResponse {
        token,
        user_id: user.id,
        is_committee: user.is_committee,
        is_admin: user.is_admin,
    }))
}

// Email-only registration (no passkey)
#[derive(Debug, serde::Deserialize)]
pub struct RegisterEmailRequest {
    pub display_name: String,
    pub email: String,
}

pub async fn register_with_email(
    State(state): State<AppState>,
    Json(req): Json<RegisterEmailRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let display_name = req.display_name.trim().to_string();
    let email = req.email.trim().to_lowercase();

    if display_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Display name is required".to_string() })));
    }

    if !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Invalid email address".to_string() })));
    }

    // Check email uniqueness
    let existing: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

    if existing {
        return Err((StatusCode::CONFLICT, Json(ErrorResponse { error: "An account with this email already exists. Try signing in instead.".to_string() })));
    }

    let email_service = state.email_service.as_ref().ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: "Email service not configured".to_string() }))
    })?;

    // Create user without passkey via shared helper
    let user = create_user_in_db(&state.db, Some(display_name), Some(email.clone()), None).await?;

    info!("📧 Created email-only user: {} ({})", user.id, email);

    // Send magic link so they can sign in immediately
    let token_bytes: [u8; 32] = rand::random();
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        token_bytes,
    );

    let token_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO magic_link_tokens (id, email, token) VALUES (?, ?, ?)")
        .bind(&token_id)
        .bind(&email)
        .bind(&token)
        .execute(&state.db)
        .await
        .ok();

    let link = format!("{}/api/auth/magic-link/verify?token={}", state.public_url, token);
    let html = format!(
        r#"<h2>Welcome to Wolfson Cellar Bar!</h2>
        <p>Your account has been created. Click below to sign in:</p>
        <p><a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #8B0000; color: white; text-decoration: none; border-radius: 4px;">Sign In</a></p>
        <p style="color: #666; font-size: 12px;">This link expires in 15 minutes.</p>"#,
        link
    );

    if let Err(e) = email_service.send_email(&email, "Welcome to Wolfson Cellar Bar", &html, None).await {
        error!("Failed to send welcome email: {}", e);
    }

    Ok(StatusCode::OK)
}

#[cfg(test)]
mod passkey_tests {
    use super::*;
    use crate::test_util::{body_json, json_post, test_state};
    use axum::routing::post;
    use axum::Router;
    use tower::ServiceExt;
    use webauthn_authenticator_rs::softpasskey::SoftPasskey;
    use webauthn_authenticator_rs::WebauthnAuthenticator;
    use webauthn_rs_proto::AllowCredentials;

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/auth/register/start", post(register_start))
            .route("/api/auth/register/finish", post(register_finish))
            .route("/api/auth/login/start", post(login_start))
            .route("/api/auth/login/finish", post(login_finish))
            .with_state(state)
    }

    fn origin() -> Url {
        Url::parse("http://localhost").unwrap()
    }

    /// A member's device: a software passkey holding one credential.
    struct Device {
        authenticator: WebauthnAuthenticator<SoftPasskey>,
        cred_id: Vec<u8>,
        user_id: String,
    }

    async fn post_json(state: &AppState, uri: &str, body: serde_json::Value) -> axum::response::Response {
        build_app(state.clone()).oneshot(json_post(uri, body, None, None)).await.unwrap()
    }

    async fn register_start_json(state: &AppState, name: &str, email: Option<&str>) -> serde_json::Value {
        let body = serde_json::json!({ "display_name": name, "email": email });
        let res = post_json(state, "/api/auth/register/start", body).await;
        assert_eq!(res.status(), StatusCode::OK);
        body_json(res).await
    }

    /// Create a credential on a fresh device for the given registration challenge.
    fn create_credential(start: &serde_json::Value) -> (WebauthnAuthenticator<SoftPasskey>, RegisterPublicKeyCredential) {
        let challenge: CreationChallengeResponse = serde_json::from_value(start.clone()).unwrap();
        let mut authenticator = WebauthnAuthenticator::new(SoftPasskey::new(true));
        let credential = authenticator.do_registration(origin(), challenge).unwrap();
        (authenticator, credential)
    }

    async fn register_finish_res(
        state: &AppState,
        start: &serde_json::Value,
        credential: &RegisterPublicKeyCredential,
    ) -> axum::response::Response {
        post_json(
            state,
            "/api/auth/register/finish",
            serde_json::json!({ "state_id": start["state_id"], "credential": credential }),
        )
        .await
    }

    async fn register(state: &AppState, name: &str) -> Device {
        let start = register_start_json(state, name, None).await;
        let (authenticator, credential) = create_credential(&start);
        let cred_id = credential.raw_id.to_vec();

        let res = register_finish_res(state, &start, &credential).await;
        assert_eq!(res.status(), StatusCode::OK);
        let user_id = body_json(res).await["user_id"].as_str().unwrap().to_string();

        Device { authenticator, cred_id, user_id }
    }

    async fn login_start_json(state: &AppState) -> serde_json::Value {
        let res = post_json(state, "/api/auth/login/start", serde_json::json!(null)).await;
        assert_eq!(res.status(), StatusCode::OK);
        body_json(res).await
    }

    /// Sign the challenge the way a browser would with a discoverable credential:
    /// the server lists nothing and the authenticator offers its own credential.
    /// SoftPasskey can only sign for listed credentials, so the test adds it here.
    fn sign(device: &mut Device, start: &serde_json::Value) -> PublicKeyCredential {
        let mut challenge: RequestChallengeResponse = serde_json::from_value(start.clone()).unwrap();
        challenge.public_key.allow_credentials = vec![AllowCredentials {
            type_: "public-key".to_string(),
            id: device.cred_id.clone().into(),
            transports: None,
        }];
        device.authenticator.do_authentication(origin(), challenge).unwrap()
    }

    async fn finish(state: &AppState, state_id: &serde_json::Value, credential: &PublicKeyCredential) -> axum::response::Response {
        post_json(
            state,
            "/api/auth/login/finish",
            serde_json::json!({ "state_id": state_id, "credential": credential }),
        )
        .await
    }

    // Impact: browsers reject challenges listing more than 64 credentials, which locked everyone out.
    // Should: issue a challenge with no allowed credentials, however many members have passkeys.
    // Should: log in a member with their passkey, returning a token for that member.
    #[tokio::test]
    async fn login_with_passkey_works_beyond_browser_credential_limit() {
        let state = test_state().await;
        let mut devices = Vec::new();
        for i in 0..70 {
            devices.push(register(&state, &format!("Member {i}")).await);
        }

        let start = login_start_json(&state).await;
        let allowed = &start["publicKey"]["allowCredentials"];
        assert!(allowed.is_null() || allowed.as_array().unwrap().is_empty(), "allowCredentials = {allowed}");

        let device = &mut devices[42];
        let credential = sign(device, &start);
        let res = finish(&state, &start["state_id"], &credential).await;
        assert_eq!(res.status(), StatusCode::OK);
        let json = body_json(res).await;
        assert_eq!(json["user_id"], device.user_id.as_str());
        assert!(!json["token"].as_str().unwrap().is_empty());
    }

    // Impact: finish used to verify against the most recent challenge from anyone,
    // so two members signing in at once would fail one of them.
    // Should: verify each login against the challenge it was issued, even when started concurrently.
    #[tokio::test]
    async fn concurrent_logins_each_use_their_own_challenge() {
        let state = test_state().await;
        let mut alice = register(&state, "Alice").await;
        let mut bob = register(&state, "Bob").await;

        let alice_start = login_start_json(&state).await;
        let bob_start = login_start_json(&state).await;
        let alice_cred = sign(&mut alice, &alice_start);
        let bob_cred = sign(&mut bob, &bob_start);

        let res = finish(&state, &alice_start["state_id"], &alice_cred).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await["user_id"], alice.user_id.as_str());

        let res = finish(&state, &bob_start["state_id"], &bob_cred).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_json(res).await["user_id"], bob.user_id.as_str());
    }

    // Should not: accept the same signed challenge a second time.
    #[tokio::test]
    async fn login_challenge_is_single_use() {
        let state = test_state().await;
        let mut device = register(&state, "Member").await;

        let start = login_start_json(&state).await;
        let credential = sign(&mut device, &start);
        assert_eq!(finish(&state, &start["state_id"], &credential).await.status(), StatusCode::OK);
        assert_eq!(finish(&state, &start["state_id"], &credential).await.status(), StatusCode::BAD_REQUEST);
    }

    // Should not: log anyone in with a passkey signed for a different challenge.
    #[tokio::test]
    async fn login_rejects_signature_over_another_challenge() {
        let state = test_state().await;
        let mut device = register(&state, "Member").await;

        let first = login_start_json(&state).await;
        let second = login_start_json(&state).await;
        let credential = sign(&mut device, &first);
        assert_eq!(finish(&state, &second["state_id"], &credential).await.status(), StatusCode::UNAUTHORIZED);
    }

    // Should not: log in with a passkey no member has registered.
    #[tokio::test]
    async fn login_rejects_unknown_passkey() {
        let state = test_state().await;
        register(&state, "Member").await;
        let mut stranger = register(&test_state().await, "Stranger").await;

        let start = login_start_json(&state).await;
        let credential = sign(&mut stranger, &start);
        assert_eq!(finish(&state, &start["state_id"], &credential).await.status(), StatusCode::UNAUTHORIZED);
    }

    async fn stored_member(state: &AppState, user_id: &str) -> (Option<String>, Option<String>) {
        sqlx::query_as("SELECT display_name, email FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap()
    }

    // Impact: finish used to read the most recent registration challenge from anyone,
    // so overlapping sign-ups failed or were stored under another person's name and email.
    // Should: create each member with the name and email they registered with, even when sign-ups overlap.
    #[tokio::test]
    async fn concurrent_registrations_each_use_their_own_challenge() {
        let state = test_state().await;
        let alice_start = register_start_json(&state, "Alice", Some("alice@example.com")).await;
        let bob_start = register_start_json(&state, "Bob", Some("bob@example.com")).await;
        let (_, alice_cred) = create_credential(&alice_start);
        let (_, bob_cred) = create_credential(&bob_start);

        let res = register_finish_res(&state, &alice_start, &alice_cred).await;
        assert_eq!(res.status(), StatusCode::OK);
        let alice_id = body_json(res).await["user_id"].as_str().unwrap().to_string();

        let res = register_finish_res(&state, &bob_start, &bob_cred).await;
        assert_eq!(res.status(), StatusCode::OK);
        let bob_id = body_json(res).await["user_id"].as_str().unwrap().to_string();

        assert_eq!(stored_member(&state, &alice_id).await, (Some("Alice".into()), Some("alice@example.com".into())));
        assert_eq!(stored_member(&state, &bob_id).await, (Some("Bob".into()), Some("bob@example.com".into())));
    }

    // Should not: create a second account from a registration challenge that was already used.
    #[tokio::test]
    async fn registration_challenge_is_single_use() {
        let state = test_state().await;
        let start = register_start_json(&state, "Member", None).await;
        let (_, credential) = create_credential(&start);

        assert_eq!(register_finish_res(&state, &start, &credential).await.status(), StatusCode::OK);
        assert_eq!(register_finish_res(&state, &start, &credential).await.status(), StatusCode::BAD_REQUEST);

        let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&state.db).await.unwrap();
        assert_eq!(users, 1);
    }

    // Should not: accept a credential created for a different registration challenge.
    #[tokio::test]
    async fn registration_rejects_credential_for_another_challenge() {
        let state = test_state().await;
        let first = register_start_json(&state, "First", None).await;
        let second = register_start_json(&state, "Second", None).await;
        let (_, credential) = create_credential(&first);

        assert_eq!(register_finish_res(&state, &second, &credential).await.status(), StatusCode::BAD_REQUEST);
    }

    // Should not: accept a challenge after it has expired.
    #[tokio::test]
    async fn expired_challenges_are_rejected() {
        let state = test_state().await;
        let mut device = register(&state, "Member").await;
        let reg_start = register_start_json(&state, "Late", None).await;
        let (_, reg_cred) = create_credential(&reg_start);
        let login_start = login_start_json(&state).await;
        let login_cred = sign(&mut device, &login_start);

        sqlx::query("UPDATE auth_states SET created_at = datetime('now', '-11 minutes')")
            .execute(&state.db)
            .await
            .unwrap();

        assert_eq!(register_finish_res(&state, &reg_start, &reg_cred).await.status(), StatusCode::BAD_REQUEST);
        assert_eq!(finish(&state, &login_start["state_id"], &login_cred).await.status(), StatusCode::BAD_REQUEST);
    }
}
