//! Kiosk shift check-in.
//!
//! A bar PC enrols once as a *kiosk device* (QR pairing approved by any committee
//! member) and then displays a rotating check-in code. Rota members scan the QR;
//! a valid, fresh code stamps their attendance for today and opens the bar.
//!
//! Two independent secrets:
//! - the per-device token (raw on the PC, only its hash server-side) gates *who
//!   can display* codes;
//! - the persistent `kiosk_secret` (in `app_config`) derives the rotating codes
//!   and proves the scanner physically saw the live screen.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::error;
use ts_rs::TS;
use uuid::Uuid;

use crate::auth::{AuthenticatedUser, CommitteeUser, KioskDevice};
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

/// Rotation period for check-in codes, in seconds.
pub const PERIOD_SECS: u64 = 30;

type HmacSha256 = Hmac<Sha256>;

// ===== Pure helpers (no I/O, clock injected) =====

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if s.is_empty() || s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// sha256 hex of a raw token. The raw token never leaves the device; the server
/// only ever stores/compares this hash.
pub fn hash_token(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    to_hex(&h.finalize())
}

/// The time-window index a given unix timestamp falls in.
pub fn current_window(now_secs: u64) -> u64 {
    now_secs / PERIOD_SECS
}

/// Deterministic 8-hex-char code for a (secret, window) pair.
pub fn code_for_window(secret: &[u8], window: u64) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&window.to_be_bytes());
    let out = mac.finalize().into_bytes();
    let n = u32::from_be_bytes([out[0], out[1], out[2], out[3]]);
    format!("{:08X}", n)
}

/// The code currently shown on the kiosk.
pub fn current_code(secret: &[u8], now_secs: u64) -> String {
    code_for_window(secret, current_window(now_secs))
}

/// Codes accepted right now: the current window plus one on each side, to
/// tolerate scan latency and small clock skew (~±30s).
pub fn valid_codes(secret: &[u8], now_secs: u64) -> [String; 3] {
    let w = current_window(now_secs);
    [
        code_for_window(secret, w.saturating_sub(1)),
        code_for_window(secret, w),
        code_for_window(secret, w + 1),
    ]
}

/// Freshness check: accept only codes from `{W-1, W, W+1}`. A code from an older
/// window is rejected — this is what keeps the rotating QR a presence proof.
pub fn is_code_valid(secret: &[u8], now_secs: u64, code: &str) -> bool {
    valid_codes(secret, now_secs).iter().any(|c| c == code)
}

/// Apply the scheduled-close rule to a raw `is_open` row. `hours` are the
/// `bar_hours` rows as `(day_of_week, open_time, close_time)`. Returns whether the
/// bar should still read as open. Unparseable inputs fail open (never wrongly
/// close a live bar).
pub fn effective_open(
    opened_at: Option<&str>,
    hours: &[(i64, String, String)],
    now: chrono::DateTime<chrono::Local>,
) -> bool {
    use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime};

    let opened = match opened_at.and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
    {
        Some(dt) => dt,
        None => return true,
    };
    let dow = opened.date().weekday().num_days_from_sunday() as i64;
    let (open_str, close_str) = match hours.iter().find(|(d, _, _)| *d == dow) {
        Some((_, o, c)) => (o, c),
        None => return true,
    };
    let (open_time, close_time) = match (
        NaiveTime::parse_from_str(open_str, "%H:%M"),
        NaiveTime::parse_from_str(close_str, "%H:%M"),
    ) {
        (Ok(o), Ok(c)) => (o, c),
        _ => return true,
    };

    // A close at or before the open time means the bar shuts after midnight.
    let mut close_date = opened.date();
    if close_time <= open_time {
        close_date += Duration::days(1);
    }
    let close_dt = NaiveDateTime::new(close_date, close_time);
    now.naive_local() < close_dt
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn internal(e: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    error!("kiosk db error: {}", e);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Internal error".to_string(),
        }),
    )
}

/// Load the persistent kiosk TOTP secret: `KIOSK_SECRET` env (hex) wins, else the
/// value stored in `app_config`, else generate 32 bytes and persist them.
pub async fn load_or_create_kiosk_secret(db: &SqlitePool) -> Vec<u8> {
    if let Ok(hex) = std::env::var("KIOSK_SECRET") {
        if let Some(bytes) = decode_hex(&hex) {
            tracing::info!("Using KIOSK_SECRET from environment");
            return bytes;
        }
        tracing::warn!("KIOSK_SECRET env var is not valid hex; ignoring it");
    }

    let existing: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_config WHERE key = 'kiosk_secret'")
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    if let Some(hex) = existing {
        if let Some(bytes) = decode_hex(&hex) {
            return bytes;
        }
    }

    let secret: [u8; 32] = rand::random();
    let hex = to_hex(&secret);
    if let Err(e) = sqlx::query(
        "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES ('kiosk_secret', ?, datetime('now'))",
    )
    .bind(&hex)
    .execute(db)
    .await
    {
        tracing::error!("Failed to persist kiosk secret: {}", e);
    } else {
        tracing::info!("Generated and persisted a new kiosk secret");
    }
    secret.to_vec()
}

// ===== Pairing (device-shows-QR, committee-approves) =====

#[derive(Debug, Deserialize)]
pub struct PairStartRequest {
    pub token_hash: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PairStartResponse {
    pub code: String,
}

/// Device begins enrolment: posts the hash of a token it generated and keeps.
/// Public — the pairing is inert until a committee member approves it.
pub async fn pair_start(
    State(state): State<AppState>,
    Json(req): Json<PairStartRequest>,
) -> Result<Json<PairStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.token_hash.len() != 64 || !req.token_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid token hash".to_string(),
            }),
        ));
    }

    let code = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO kiosk_pairings (code, token_hash, status, expires_at)
         VALUES (?, ?, 'pending', datetime('now', '+10 minutes'))",
    )
    .bind(&code)
    .bind(&req.token_hash)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PairStartResponse { code }))
}

#[derive(Debug, Deserialize)]
pub struct PairStatusQuery {
    pub code: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PairStatusResponse {
    pub status: String,
}

/// Device polls for approval. Returns only the status string; nothing secret —
/// the device already holds its own raw token.
pub async fn pair_status(
    State(state): State<AppState>,
    Query(q): Query<PairStatusQuery>,
) -> Result<Json<PairStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM kiosk_pairings WHERE code = ?")
            .bind(&q.code)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    Ok(Json(PairStatusResponse {
        status: status.unwrap_or_else(|| "unknown".to_string()),
    }))
}

#[derive(Debug, Deserialize)]
pub struct PairApproveRequest {
    pub code: String,
    pub name: Option<String>,
}

/// A committee member approves a pending pairing (scanned from the kiosk screen).
/// Creates the device record from the hash the device supplied at pair/start.
pub async fn pair_approve(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Json(req): Json<PairApproveRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT token_hash, status FROM kiosk_pairings
         WHERE code = ? AND expires_at > datetime('now')",
    )
    .bind(&req.code)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let (token_hash, status) = row.ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "Pairing code not found or expired".to_string(),
        }),
    ))?;

    if status != "pending" {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: "Pairing already used".to_string(),
            }),
        ));
    }

    let device_id = Uuid::new_v4().to_string();
    let name = req.name.filter(|n| !n.trim().is_empty());

    sqlx::query("INSERT INTO kiosk_devices (id, name, token_hash) VALUES (?, ?, ?)")
        .bind(&device_id)
        .bind(&name)
        .bind(&token_hash)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    sqlx::query(
        "UPDATE kiosk_pairings SET status = 'approved', device_id = ?, name = ?, approved_by = ?
         WHERE code = ?",
    )
    .bind(&device_id)
    .bind(&name)
    .bind(&user.id)
    .bind(&req.code)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(StatusCode::OK)
}

// ===== Device management (committee dashboard) =====

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct KioskDeviceInfo {
    pub id: String,
    pub name: Option<String>,
    pub last_seen_at: Option<String>,
    pub revoked: bool,
}

pub async fn list_devices(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
) -> Result<Json<Vec<KioskDeviceInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let rows = sqlx::query_as::<_, (String, Option<String>, Option<String>, bool)>(
        "SELECT id, name, last_seen_at, revoked FROM kiosk_devices ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, name, last_seen_at, revoked)| KioskDeviceInfo {
                id,
                name,
                last_seen_at,
                revoked,
            })
            .collect(),
    ))
}

pub async fn revoke_device(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
    Path(device_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let res = sqlx::query("UPDATE kiosk_devices SET revoked = 1 WHERE id = ?")
        .bind(&device_id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Device not found".to_string(),
            }),
        ));
    }
    Ok(StatusCode::OK)
}

// ===== Run: code display + check-in + bar status =====

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CheckinCode {
    pub code: String,
    pub url: String,
    pub period_seconds: u32,
}

/// The live rotating code, for display on an enrolled kiosk. Device-gated so the
/// current code can't be fetched remotely.
pub async fn get_checkin_code(
    State(state): State<AppState>,
    _device: KioskDevice,
) -> Json<CheckinCode> {
    let code = current_code(&state.kiosk_secret, now_secs());
    let url = format!(
        "{}/checkin?code={}",
        state.public_url.trim_end_matches('/'),
        code
    );
    Json(CheckinCode {
        code,
        url,
        period_seconds: PERIOD_SECS as u32,
    })
}

#[derive(Debug, Deserialize)]
pub struct CheckInRequest {
    pub code: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CheckInResponse {
    pub checked_in: bool,
    pub was_signed_up: bool,
    pub bar_opened: bool,
}

/// A rota member scans the kiosk QR and lands here. Validates eligibility and
/// code freshness, then stamps attendance for today and opens the bar.
pub async fn check_in(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<CheckInRequest>,
) -> Result<Json<CheckInResponse>, (StatusCode, Json<ErrorResponse>)> {
    if !user.is_rota_member() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "You must be a fully-inducted rota member to check in".to_string(),
            }),
        ));
    }

    if !is_code_valid(&state.kiosk_secret, now_secs(), &req.code) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid or expired code".to_string(),
            }),
        ));
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let was_signed_up: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM shift_signups WHERE shift_date = ? AND user_id = ?)",
    )
    .bind(&today)
    .bind(&user.id)
    .fetch_one(&state.db)
    .await
    .map_err(internal)?;

    // Stamp attendance; auto-create the signup row for a qualified walk-in.
    sqlx::query(
        "INSERT INTO shift_signups (shift_date, user_id, checked_in_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(shift_date, user_id) DO UPDATE SET checked_in_at = excluded.checked_in_at",
    )
    .bind(&today)
    .bind(&user.id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    // Open the bar (opened_at in local time so the auto-close math stays in one zone).
    sqlx::query(
        "UPDATE bar_status
         SET is_open = 1, opened_at = datetime('now', 'localtime'), opened_by = ?,
             updated_at = datetime('now')
         WHERE id = 1",
    )
    .bind(&user.id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(CheckInResponse {
        checked_in: true,
        was_signed_up,
        bar_opened: true,
    }))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct BarStatus {
    pub is_open: bool,
    pub opened_at: Option<String>,
}

/// Public: whether the bar is currently open. Applies the scheduled-close rule
/// lazily (no background job) and flips a stale row closed on read.
pub async fn get_bar_status(
    State(state): State<AppState>,
) -> Result<Json<BarStatus>, (StatusCode, Json<ErrorResponse>)> {
    let row: Option<(bool, Option<String>)> =
        sqlx::query_as("SELECT is_open, opened_at FROM bar_status WHERE id = 1")
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;
    let (is_open_raw, opened_at) = row.unwrap_or((false, None));

    if !is_open_raw {
        return Ok(Json(BarStatus {
            is_open: false,
            opened_at,
        }));
    }

    let hours = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT day_of_week, open_time, close_time FROM bar_hours",
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    let effective = effective_open(opened_at.as_deref(), &hours, chrono::Local::now());
    if !effective {
        let _ = sqlx::query("UPDATE bar_status SET is_open = 0, updated_at = datetime('now') WHERE id = 1")
            .execute(&state.db)
            .await;
    }

    Ok(Json(BarStatus {
        is_open: effective,
        opened_at,
    }))
}

/// Manual early close, from the kiosk committee dashboard.
pub async fn close_bar(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    sqlx::query("UPDATE bar_status SET is_open = 0, updated_at = datetime('now') WHERE id = 1")
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::create_jwt_token;
    use crate::test_util::{insert_user, test_state, user_with, user_with_role};
    use axum::body::Body;
    use axum::http::{Request, StatusCode as Status};
    use axum::routing::{get, post};
    use axum::Router;
    use tower::ServiceExt;

    // -------- Pure TOTP: the freshness invariant --------

    #[test]
    fn code_is_deterministic_per_window() {
        let s = [1u8; 32];
        assert_eq!(code_for_window(&s, 100), code_for_window(&s, 100));
    }

    #[test]
    fn code_changes_across_windows() {
        let s = [1u8; 32];
        assert_ne!(code_for_window(&s, 100), code_for_window(&s, 101));
    }

    #[test]
    fn valid_codes_include_current_and_neighbours() {
        let s = [2u8; 32];
        let now = 100 * PERIOD_SECS + 5; // window 100
        let codes = valid_codes(&s, now);
        assert!(codes.contains(&code_for_window(&s, 99)));
        assert!(codes.contains(&code_for_window(&s, 100)));
        assert!(codes.contains(&code_for_window(&s, 101)));
    }

    #[test]
    fn code_from_window_w_is_rejected_at_w_plus_2() {
        // THE load-bearing invariant: a code minted at window W validates at W
        // but must be rejected two windows later. If this widens, the rotating
        // QR degrades into a static one and presence proof collapses.
        let s = [3u8; 32];
        let code_w = code_for_window(&s, 100);
        assert!(is_code_valid(&s, 100 * PERIOD_SECS, &code_w), "valid at W");
        assert!(
            !is_code_valid(&s, 102 * PERIOD_SECS, &code_w),
            "must be rejected at W+2"
        );
    }

    // -------- Pure auto-close (weekday-independent via uniform hours) --------

    fn hours_uniform(open: &str, close: &str) -> Vec<(i64, String, String)> {
        (0..=6).map(|d| (d, open.to_string(), close.to_string())).collect()
    }

    fn local_dt(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<chrono::Local> {
        use chrono::{Local, TimeZone};
        Local.with_ymd_and_hms(y, m, d, h, min, 0).single().expect("valid local time")
    }

    #[test]
    fn auto_close_past_scheduled_close() {
        let hours = hours_uniform("20:00", "23:00");
        let now = local_dt(2026, 6, 15, 23, 30);
        assert!(!effective_open(Some("2026-06-15 20:30:00"), &hours, now));
    }

    #[test]
    fn still_open_before_close() {
        let hours = hours_uniform("20:00", "23:00");
        let now = local_dt(2026, 6, 15, 22, 0);
        assert!(effective_open(Some("2026-06-15 20:30:00"), &hours, now));
    }

    #[test]
    fn midnight_spanning_still_open_after_midnight() {
        let hours = hours_uniform("20:30", "02:00");
        let now = local_dt(2026, 6, 16, 1, 0); // 01:00 the next day
        assert!(effective_open(Some("2026-06-15 21:00:00"), &hours, now));
    }

    #[test]
    fn midnight_spanning_closed_after_close() {
        let hours = hours_uniform("20:30", "02:00");
        let now = local_dt(2026, 6, 16, 2, 30); // past the 02:00 close
        assert!(!effective_open(Some("2026-06-15 21:00:00"), &hours, now));
    }

    // -------- Router-level: gate + pairing + check-in --------

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/kiosk/pair/start", post(pair_start))
            .route("/api/kiosk/pair/approve", post(pair_approve))
            .route("/api/kiosk/checkin-code", get(get_checkin_code))
            .route("/api/shifts/check-in", post(check_in))
            .route("/api/bar-status", get(get_bar_status))
            .with_state(state)
    }

    fn json_post(
        uri: &str,
        body: serde_json::Value,
        bearer: Option<&str>,
        kiosk: Option<&str>,
    ) -> Request<Body> {
        let mut b = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json");
        if let Some(t) = bearer {
            b = b.header("authorization", format!("Bearer {t}"));
        }
        if let Some(k) = kiosk {
            b = b.header("x-kiosk-token", k);
        }
        b.body(Body::from(body.to_string())).unwrap()
    }

    fn get_req(uri: &str, kiosk: Option<&str>) -> Request<Body> {
        let mut b = Request::builder().uri(uri);
        if let Some(k) = kiosk {
            b = b.header("x-kiosk-token", k);
        }
        b.body(Body::empty()).unwrap()
    }

    async fn body_json(res: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn enroll_device(state: &AppState, raw_token: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO kiosk_devices (id, name, token_hash) VALUES (?, 'Till', ?)")
            .bind(&id)
            .bind(hash_token(raw_token))
            .execute(&state.db)
            .await
            .unwrap();
        id
    }

    #[tokio::test]
    async fn checkin_code_requires_a_device_token() {
        let state = test_state().await;
        let res = build_app(state).oneshot(get_req("/api/kiosk/checkin-code", None)).await.unwrap();
        assert_eq!(res.status(), Status::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn checkin_code_ok_with_valid_device_token() {
        let state = test_state().await;
        enroll_device(&state, "raw-token-abc").await;
        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", Some("raw-token-abc")))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
    }

    #[tokio::test]
    async fn checkin_code_rejects_revoked_device() {
        let state = test_state().await;
        let id = enroll_device(&state, "raw-token-xyz").await;
        sqlx::query("UPDATE kiosk_devices SET revoked = 1 WHERE id = ?")
            .bind(&id)
            .execute(&state.db)
            .await
            .unwrap();
        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", Some("raw-token-xyz")))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn pairing_flow_creates_device_and_stores_only_the_hash() {
        let state = test_state().await;
        let raw = "device-secret-token";
        let token_hash = hash_token(raw);

        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/kiosk/pair/start",
                serde_json::json!({ "token_hash": token_hash }),
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
        let code = body_json(res).await["code"].as_str().unwrap().to_string();

        let committee = user_with_role(true, false);
        insert_user(&state.db, &committee).await;
        let token = create_jwt_token(&committee.id, &state.jwt_secret).unwrap();
        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/kiosk/pair/approve",
                serde_json::json!({ "code": code, "name": "Till PC" }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);

        // Only the hash is persisted — never the raw token.
        let stored: String = sqlx::query_scalar("SELECT token_hash FROM kiosk_devices LIMIT 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(stored, token_hash);
        assert_ne!(stored, raw);

        // The device's raw token now mints codes.
        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", Some(raw)))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
    }

    #[tokio::test]
    async fn pair_approve_requires_committee() {
        let state = test_state().await;
        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/kiosk/pair/start",
                serde_json::json!({ "token_hash": hash_token("t") }),
                None,
                None,
            ))
            .await
            .unwrap();
        let code = body_json(res).await["code"].as_str().unwrap().to_string();

        let plain = user_with_role(false, false);
        insert_user(&state.db, &plain).await;
        let token = create_jwt_token(&plain.id, &state.jwt_secret).unwrap();
        let res = build_app(state)
            .oneshot(json_post(
                "/api/kiosk/pair/approve",
                serde_json::json!({ "code": code }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::FORBIDDEN);
    }

    #[tokio::test]
    async fn rota_member_checks_in_and_opens_bar() {
        let state = test_state().await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        let token = create_jwt_token(&member.id, &state.jwt_secret).unwrap();
        let code = current_code(&state.kiosk_secret, now_secs());

        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/shifts/check-in",
                serde_json::json!({ "code": code }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let checked: Option<String> = sqlx::query_scalar(
            "SELECT checked_in_at FROM shift_signups WHERE shift_date = ? AND user_id = ?",
        )
        .bind(&today)
        .bind(&member.id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert!(checked.is_some(), "attendance stamped");

        let is_open: bool = sqlx::query_scalar("SELECT is_open FROM bar_status WHERE id = 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(is_open, "bar opened");
    }

    #[tokio::test]
    async fn walk_in_auto_creates_attendance_row() {
        let state = test_state().await;
        let member = user_with(true, true, true, true); // qualified but not signed up
        insert_user(&state.db, &member).await;
        let token = create_jwt_token(&member.id, &state.jwt_secret).unwrap();
        let code = current_code(&state.kiosk_secret, now_secs());

        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/shifts/check-in",
                serde_json::json!({ "code": code }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
        assert_eq!(body_json(res).await["was_signed_up"], serde_json::json!(false));

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shift_signups WHERE user_id = ?")
            .bind(&member.id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn non_rota_member_cannot_check_in() {
        let state = test_state().await;
        let member = user_with(true, true, true, false); // missing supervised shift
        insert_user(&state.db, &member).await;
        let token = create_jwt_token(&member.id, &state.jwt_secret).unwrap();
        let code = current_code(&state.kiosk_secret, now_secs());
        let res = build_app(state)
            .oneshot(json_post(
                "/api/shifts/check-in",
                serde_json::json!({ "code": code }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::FORBIDDEN);
    }

    #[tokio::test]
    async fn invalid_code_rejected() {
        let state = test_state().await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        let token = create_jwt_token(&member.id, &state.jwt_secret).unwrap();
        let res = build_app(state)
            .oneshot(json_post(
                "/api/shifts/check-in",
                serde_json::json!({ "code": "DEADBEEF" }),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::BAD_REQUEST);
    }

    #[tokio::test]
    async fn bar_status_auto_closes_when_opened_in_the_past() {
        let state = test_state().await;
        sqlx::query(
            "UPDATE bar_status SET is_open = 1, opened_at = datetime('now','localtime','-2 days') WHERE id = 1",
        )
        .execute(&state.db)
        .await
        .unwrap();
        let res = build_app(state).oneshot(get_req("/api/bar-status", None)).await.unwrap();
        assert_eq!(body_json(res).await["is_open"], serde_json::json!(false));
    }

    #[tokio::test]
    async fn bar_status_reports_open_within_hours() {
        let state = test_state().await;
        // close == open → spans to next midnight, so "today" always reads open.
        sqlx::query("UPDATE bar_hours SET open_time = '00:00', close_time = '00:00'")
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("UPDATE bar_status SET is_open = 1, opened_at = datetime('now','localtime') WHERE id = 1")
            .execute(&state.db)
            .await
            .unwrap();
        let res = build_app(state).oneshot(get_req("/api/bar-status", None)).await.unwrap();
        assert_eq!(body_json(res).await["is_open"], serde_json::json!(true));
    }
}
