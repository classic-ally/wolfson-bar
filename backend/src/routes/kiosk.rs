//! Kiosk shift check-in.
//!
//! A bar PC enrols once as a *kiosk device* (QR pairing approved by any committee
//! member) and then displays a rotating check-in code. Rota members scan the QR;
//! a valid, fresh code stamps their attendance for the current shift and opens the bar.
//!
//! Two independent secrets:
//! - the per-device token (raw on the PC, only its hash server-side) gates *who
//!   can display* codes;
//! - the persistent `kiosk_secret` (in `app_config`) derives the rotating codes
//!   and proves the scanner physically saw the live screen.
//!
//! Time: every decision reads `AppState::clock`. Timestamps are stored as UTC
//! `YYYY-MM-DD HH:MM:SS` (same shape as SQLite's `datetime('now')`); bar hours and
//! shift dates are interpreted in `BAR_TZ`, never the host's local zone.

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{SqliteExecutor, SqlitePool};
use tracing::error;
use ts_rs::TS;
use uuid::Uuid;

use crate::auth::{AuthenticatedUser, CommitteeUser, KioskDevice};
use crate::constants::BAR_TZ;
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;
use crate::routes::shifts::{shift_requirements, ShiftRequirements};

/// Rotation period for check-in codes, in seconds.
pub const PERIOD_SECS: u64 = 30;

/// How long a pairing QR stays approvable.
const PAIRING_TTL_MINUTES: i64 = 10;

/// `pair_start` is public; cap unapproved pairings so it can't grow the DB unbounded.
const MAX_PENDING_PAIRINGS: i64 = 20;

const TS_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

type HmacSha256 = Hmac<Sha256>;

/// `bar_hours` rows as `(day_of_week, open_time, close_time)`, 0 = Sunday.
pub type BarHours = [(i64, String, String)];

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

fn format_ts(t: DateTime<Utc>) -> String {
    t.format(TS_FORMAT).to_string()
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, TS_FORMAT).ok().map(|n| n.and_utc())
}

fn bar_local(t: DateTime<Utc>) -> NaiveDateTime {
    t.with_timezone(&BAR_TZ).naive_local()
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

/// Bar-local open and close of the shift that starts on `date`. A close at or
/// before the open time means the shift runs past midnight.
fn shift_window(hours: &BarHours, date: NaiveDate) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let dow = date.weekday().num_days_from_sunday() as i64;
    let (_, open, close) = hours.iter().find(|(d, _, _)| *d == dow)?;
    let open = NaiveTime::parse_from_str(open, "%H:%M").ok()?;
    let close = NaiveTime::parse_from_str(close, "%H:%M").ok()?;
    let close_date = if close <= open { date + Duration::days(1) } else { date };
    Some((date.and_time(open), close_date.and_time(close)))
}

/// The shift a bar-local instant belongs to: the previous evening's while its
/// after-midnight close hasn't passed, otherwise today's.
pub fn active_shift_date(now: NaiveDateTime, hours: &BarHours) -> NaiveDate {
    let yesterday = now.date() - Duration::days(1);
    match shift_window(hours, yesterday) {
        Some((_, close)) if now < close => yesterday,
        _ => now.date(),
    }
}

/// Scheduled close of the shift a bar-local instant belongs to.
fn shift_close(hours: &BarHours, at: NaiveDateTime) -> Option<NaiveDateTime> {
    shift_window(hours, active_shift_date(at, hours)).map(|(_, close)| close)
}

/// Apply the scheduled-close rule to a raw `is_open` row: the bar reads open until
/// the close of the shift it was opened in. Unknown inputs fail open (never wrongly
/// close a live bar).
pub fn effective_open(opened_at: Option<DateTime<Utc>>, hours: &BarHours, now: DateTime<Utc>) -> bool {
    let Some(opened_at) = opened_at else {
        return true;
    };
    match shift_close(hours, bar_local(opened_at)) {
        Some(close) => bar_local(now) < close,
        None => true,
    }
}

fn reject(status: StatusCode, msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(e: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    error!("kiosk db error: {}", e);
    reject(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
}

async fn load_bar_hours<'e, E: SqliteExecutor<'e>>(db: E) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT day_of_week, open_time, close_time FROM bar_hours")
        .fetch_all(db)
        .await
}

/// Load the persistent kiosk TOTP secret: `KIOSK_SECRET` env (hex) wins, else the
/// value stored in `app_config`, else generate 32 bytes and persist them.
///
/// Errors instead of regenerating when the stored secret can't be read: silently
/// minting a new one would invalidate every code on screen.
pub async fn load_or_create_kiosk_secret(db: &SqlitePool) -> Result<Vec<u8>, String> {
    if let Ok(hex) = std::env::var("KIOSK_SECRET") {
        if let Some(bytes) = decode_hex(&hex) {
            tracing::info!("Using KIOSK_SECRET from environment");
            return Ok(bytes);
        }
        tracing::warn!("KIOSK_SECRET env var is not valid hex; ignoring it");
    }

    let existing: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_config WHERE key = 'kiosk_secret'")
            .fetch_optional(db)
            .await
            .map_err(|e| format!("reading kiosk secret: {e}"))?;
    if let Some(hex) = existing {
        return decode_hex(&hex).ok_or_else(|| "stored kiosk secret is not valid hex".to_string());
    }

    let secret: [u8; 32] = rand::random();
    sqlx::query("INSERT INTO app_config (key, value, updated_at) VALUES ('kiosk_secret', ?, datetime('now'))")
        .bind(to_hex(&secret))
        .execute(db)
        .await
        .map_err(|e| format!("persisting kiosk secret: {e}"))?;
    tracing::info!("Generated and persisted a new kiosk secret");
    Ok(secret.to_vec())
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

/// Best-effort requester address for the approval screen: the first
/// `X-Forwarded-For` hop when behind a proxy, else the socket peer. Display only.
fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|ip| ip.trim().to_string())
        .filter(|ip| !ip.is_empty())
        .or_else(|| peer.map(|p| p.ip().to_string()))
}

/// Device begins enrolment: posts the hash of a token it generated and keeps.
/// Public — the pairing is inert until a committee member approves it.
pub async fn pair_start(
    State(state): State<AppState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    Json(req): Json<PairStartRequest>,
) -> Result<Json<PairStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.token_hash.len() != 64 || !req.token_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(reject(StatusCode::BAD_REQUEST, "Invalid token hash"));
    }

    let now = state.clock.now();
    let now_ts = format_ts(now);

    sqlx::query("DELETE FROM kiosk_pairings WHERE expires_at <= ?")
        .bind(&now_ts)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM kiosk_pairings WHERE status = 'pending'")
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;
    if pending >= MAX_PENDING_PAIRINGS {
        return Err(reject(StatusCode::TOO_MANY_REQUESTS, "Too many pending pairings; try again later"));
    }

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|h| h.to_str().ok())
        .map(str::to_string);

    let code = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO kiosk_pairings (code, token_hash, status, created_at, expires_at, client_ip, user_agent)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)",
    )
    .bind(&code)
    .bind(&req.token_hash)
    .bind(&now_ts)
    .bind(format_ts(now + Duration::minutes(PAIRING_TTL_MINUTES)))
    .bind(client_ip(&headers, peer.map(|ConnectInfo(addr)| addr)))
    .bind(user_agent)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PairStartResponse { code }))
}

#[derive(Debug, Deserialize)]
pub struct PairCodeQuery {
    pub code: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PairStatusResponse {
    /// `pending` | `approved` | `expired` | `unknown`
    pub status: String,
}

/// Device polls for approval. Returns only the status string; nothing secret —
/// the device already holds its own raw token.
pub async fn pair_status(
    State(state): State<AppState>,
    Query(q): Query<PairCodeQuery>,
) -> Result<Json<PairStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT status, expires_at FROM kiosk_pairings WHERE code = ?")
            .bind(&q.code)
            .fetch_optional(&state.db)
            .await
            .map_err(internal)?;

    let now = state.clock.now();
    let status = match row {
        None => "unknown".to_string(),
        Some((status, expires_at))
            if status == "pending" && parse_ts(&expires_at).map_or(true, |exp| exp <= now) =>
        {
            "expired".to_string()
        }
        Some((status, _)) => status,
    };
    Ok(Json(PairStatusResponse { status }))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PairingInfo {
    pub status: String,
    /// UTC, `YYYY-MM-DD HH:MM:SS`.
    pub created_at: String,
    pub expires_at: String,
    pub client_ip: Option<String>,
    pub user_agent: Option<String>,
    /// Enrolled kiosks that approving this pairing will revoke.
    pub active_devices: i64,
}

/// What the approving committee member is about to trust: when and from where
/// the pairing was started.
pub async fn pair_info(
    State(state): State<AppState>,
    CommitteeUser(_user): CommitteeUser,
    Query(q): Query<PairCodeQuery>,
) -> Result<Json<PairingInfo>, (StatusCode, Json<ErrorResponse>)> {
    let row: Option<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT status, created_at, expires_at, client_ip, user_agent FROM kiosk_pairings WHERE code = ?",
    )
    .bind(&q.code)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;
    let (status, created_at, expires_at, client_ip, user_agent) =
        row.ok_or_else(|| reject(StatusCode::NOT_FOUND, "Pairing code not found or expired"))?;

    let active_devices: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM kiosk_devices WHERE revoked = 0")
        .fetch_one(&state.db)
        .await
        .map_err(internal)?;

    Ok(Json(PairingInfo {
        status,
        created_at,
        expires_at,
        client_ip,
        user_agent,
        active_devices,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PairApproveRequest {
    pub code: String,
    pub name: Option<String>,
}

/// A committee member approves a pending pairing (scanned from the kiosk screen).
/// Creates the device record from the hash the device supplied at pair/start.
///
/// Only one kiosk is active at a time: approving retires every other device, so a
/// pairing approved by mistake knocks the real bar PC offline (and gets noticed)
/// rather than quietly minting codes somewhere else.
pub async fn pair_approve(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Json(req): Json<PairApproveRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let now_ts = format_ts(state.clock.now());
    let device_id = Uuid::new_v4().to_string();
    let name = req.name.filter(|n| !n.trim().is_empty());

    let mut tx = state.db.begin().await.map_err(internal)?;

    // Claim the pairing atomically; a concurrent approval of the same code gets nothing back.
    let token_hash: Option<String> = sqlx::query_scalar(
        "UPDATE kiosk_pairings SET status = 'approved', device_id = ?, name = ?, approved_by = ?
         WHERE code = ? AND status = 'pending' AND expires_at > ?
         RETURNING token_hash",
    )
    .bind(&device_id)
    .bind(&name)
    .bind(&user.id)
    .bind(&req.code)
    .bind(&now_ts)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;

    let Some(token_hash) = token_hash else {
        let live: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM kiosk_pairings WHERE code = ? AND expires_at > ?)",
        )
        .bind(&req.code)
        .bind(&now_ts)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
        return Err(if live {
            reject(StatusCode::CONFLICT, "Pairing already used")
        } else {
            reject(StatusCode::NOT_FOUND, "Pairing code not found or expired")
        });
    };

    sqlx::query("UPDATE kiosk_devices SET revoked = 1 WHERE revoked = 0")
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    sqlx::query("INSERT INTO kiosk_devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
        .bind(&device_id)
        .bind(&name)
        .bind(&token_hash)
        .bind(&now_ts)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    tx.commit().await.map_err(internal)?;
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
        return Err(reject(StatusCode::NOT_FOUND, "Device not found"));
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
    let code = current_code(&state.kiosk_secret, state.clock.unix_secs());
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
    /// Shift the attendance was recorded against (`YYYY-MM-DD`); after midnight
    /// this is the previous evening's shift.
    pub shift_date: String,
    pub was_signed_up: bool,
    /// Whether the bar reads open after this check-in. False for a check-in after
    /// the shift's scheduled close.
    pub bar_open: bool,
}

/// A rota member scans the kiosk QR and lands here. Validates eligibility and
/// code freshness, then stamps attendance for the current shift and opens the bar.
pub async fn check_in(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<CheckInRequest>,
) -> Result<Json<CheckInResponse>, (StatusCode, Json<ErrorResponse>)> {
    if !user.is_rota_member() {
        // Members already on the rota lose check-in when a new CoC is
        // published; tell them the one thing to do instead of the generic gate.
        let only_coc_missing = !user.code_of_conduct_signed && {
            let mut signed = user.clone();
            signed.code_of_conduct_signed = true;
            signed.is_rota_member()
        };
        let msg = if only_coc_missing {
            "Please re-sign the updated Code of Conduct on your profile before checking in"
        } else {
            "You must be a fully-inducted rota member to check in"
        };
        return Err(reject(StatusCode::FORBIDDEN, msg));
    }

    if !is_code_valid(&state.kiosk_secret, state.clock.unix_secs(), &req.code) {
        return Err(reject(StatusCode::BAD_REQUEST, "Invalid or expired code"));
    }

    let now = state.clock.now();
    let now_ts = format_ts(now);
    let now_local = bar_local(now);

    let mut tx = state.db.begin().await.map_err(internal)?;

    let hours = load_bar_hours(&mut *tx).await.map_err(internal)?;
    let shift_date = active_shift_date(now_local, &hours).format("%Y-%m-%d").to_string();

    let was_signed_up: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM shift_signups WHERE shift_date = ? AND user_id = ?)",
    )
    .bind(&shift_date)
    .bind(&user.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;

    // A walk-in takes a slot, so it has to satisfy the same rules as signing up.
    if !was_signed_up {
        let ShiftRequirements { max_volunteers, requires_contract } =
            shift_requirements(&mut *tx, &shift_date).await.map_err(internal)?;
        if requires_contract && !user.has_contract {
            return Err(reject(StatusCode::FORBIDDEN, "This shift requires a valid contract"));
        }
        let signed_up: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM shift_signups WHERE shift_date = ?")
            .bind(&shift_date)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
        if signed_up >= max_volunteers {
            return Err(reject(StatusCode::CONFLICT, "This shift is already full"));
        }
    }

    // Stamp attendance (first scan wins); auto-create the signup row for a walk-in.
    sqlx::query(
        "INSERT INTO shift_signups (shift_date, user_id, checked_in_at)
         VALUES (?, ?, ?)
         ON CONFLICT(shift_date, user_id)
         DO UPDATE SET checked_in_at = COALESCE(shift_signups.checked_in_at, excluded.checked_in_at)",
    )
    .bind(&shift_date)
    .bind(&user.id)
    .bind(&now_ts)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;

    let (is_open, opened_at): (bool, Option<String>) =
        sqlx::query_as("SELECT is_open, opened_at FROM bar_status WHERE id = 1")
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
    let already_open = is_open && effective_open(opened_at.as_deref().and_then(parse_ts), &hours, now);
    let within_hours = shift_close(&hours, now_local).map_or(true, |close| now_local < close);

    // Keep the original opener/time when the bar is already open.
    if !already_open && within_hours {
        sqlx::query(
            "UPDATE bar_status SET is_open = 1, opened_at = ?, opened_by = ?, updated_at = ? WHERE id = 1",
        )
        .bind(&now_ts)
        .bind(&user.id)
        .bind(&now_ts)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    }

    tx.commit().await.map_err(internal)?;

    Ok(Json(CheckInResponse {
        shift_date,
        was_signed_up,
        bar_open: already_open || within_hours,
    }))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct BarStatus {
    pub is_open: bool,
    /// UTC, `YYYY-MM-DD HH:MM:SS`.
    pub opened_at: Option<String>,
}

/// Mark the bar closed, but only if it is still the opening we evaluated. A
/// check-in that re-opened the bar in the meantime has a newer `opened_at` and
/// is left alone.
async fn close_if_unchanged(db: &SqlitePool, opened_at: Option<&str>, now: DateTime<Utc>) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE bar_status SET is_open = 0, updated_at = ? WHERE id = 1 AND is_open = 1 AND opened_at IS ?")
        .bind(format_ts(now))
        .bind(opened_at)
        .execute(db)
        .await?;
    Ok(())
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

    let hours = load_bar_hours(&state.db).await.map_err(internal)?;
    let now = state.clock.now();
    let effective = effective_open(opened_at.as_deref().and_then(parse_ts), &hours, now);
    if !effective {
        close_if_unchanged(&state.db, opened_at.as_deref(), now)
            .await
            .map_err(internal)?;
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
    sqlx::query("UPDATE bar_status SET is_open = 0, updated_at = ? WHERE id = 1")
        .bind(format_ts(state.clock.now()))
        .execute(&state.db)
        .await
        .map_err(internal)?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::Clock;
    use crate::test_util::{
        body_json, get_req, insert_event, insert_shift_signup, insert_user, json_post, london, set_bar_hours,
        test_state, test_state_at, token_for, user_with, user_with_role,
    };
    use axum::http::StatusCode as Status;
    use axum::routing::{get, post};
    use axum::Router;
    use tower::ServiceExt;

    // Seeded bar_hours: Sun-Thu 20:00-23:00, Fri-Sat 20:30-02:00.
    const SUN: i64 = 0;
    const MON: i64 = 1;
    const FRI: i64 = 5;

    // -------- Pure TOTP: the freshness invariant --------

    // Should: produce the same code for the same secret and window.
    #[test]
    fn code_is_deterministic_per_window() {
        let s = [1u8; 32];
        assert_eq!(code_for_window(&s, 100), code_for_window(&s, 100));
    }

    // Should: produce a different code in the next window.
    #[test]
    fn code_changes_across_windows() {
        let s = [1u8; 32];
        assert_ne!(code_for_window(&s, 100), code_for_window(&s, 101));
    }

    // Should: accept the current window and one either side.
    #[test]
    fn valid_codes_include_current_and_neighbours() {
        let s = [2u8; 32];
        let now = 100 * PERIOD_SECS + 5; // window 100
        let codes = valid_codes(&s, now);
        assert!(codes.contains(&code_for_window(&s, 99)));
        assert!(codes.contains(&code_for_window(&s, 100)));
        assert!(codes.contains(&code_for_window(&s, 101)));
    }

    // Impact: if the accepted window widens, the rotating QR degrades into a
    // static one and stops proving the scanner was physically at the bar.
    // Should: reject a code two windows after it was minted.
    #[test]
    fn code_from_window_w_is_rejected_at_w_plus_2() {
        let s = [3u8; 32];
        let code_w = code_for_window(&s, 100);
        assert!(is_code_valid(&s, 100 * PERIOD_SECS, &code_w), "valid at W");
        assert!(
            !is_code_valid(&s, 102 * PERIOD_SECS, &code_w),
            "must be rejected at W+2"
        );
    }

    // -------- Pure shift-date + auto-close --------

    fn seeded_hours() -> Vec<(i64, String, String)> {
        (0..=6)
            .map(|d| {
                let (o, c) = if d == 5 || d == 6 { ("20:30", "02:00") } else { ("20:00", "23:00") };
                (d, o.to_string(), c.to_string())
            })
            .collect()
    }

    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, min, 0).unwrap()
    }

    // Should: attribute times before a late shift's close to the previous evening's shift.
    // Should: attribute times after that close, and on nights that end before midnight, to the calendar day.
    #[test]
    fn active_shift_date_follows_the_shift_not_the_calendar() {
        let hours = seeded_hours();
        let fri = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let sat = NaiveDate::from_ymd_opt(2026, 6, 20).unwrap();
        let tue = NaiveDate::from_ymd_opt(2026, 6, 16).unwrap();
        let cases = [
            (local(2026, 6, 19, 22, 0), fri, "Friday evening"),
            (local(2026, 6, 20, 0, 30), fri, "Friday's shift after midnight"),
            (local(2026, 6, 20, 1, 59), fri, "just before Friday's 02:00 close"),
            (local(2026, 6, 20, 2, 0), sat, "at Friday's close"),
            (local(2026, 6, 20, 18, 0), sat, "Saturday afternoon"),
            (local(2026, 6, 16, 0, 30), tue, "Monday's shift ended at 23:00"),
        ];
        for (at, expected, label) in cases {
            assert_eq!(active_shift_date(at, &hours), expected, "{label}");
        }
    }

    // Impact: regression guard. Opening after midnight used to pick the next
    // day's hours, so the homepage showed the bar open for a whole day.
    // Should: close a bar opened at Sat 00:30 at Friday's 02:00 close.
    #[test]
    fn opened_after_midnight_closes_with_the_previous_evenings_shift() {
        let hours = seeded_hours();
        let opened = london(2026, 6, 20, 0, 30);
        assert!(effective_open(Some(opened), &hours, london(2026, 6, 20, 1, 30)));
        assert!(!effective_open(Some(opened), &hours, london(2026, 6, 20, 2, 30)));
        assert!(!effective_open(Some(opened), &hours, london(2026, 6, 20, 18, 0)));
    }

    // Should: close a normal weekday shift at its scheduled close.
    #[test]
    fn auto_close_past_scheduled_close() {
        let hours = seeded_hours();
        let opened = london(2026, 6, 15, 20, 30);
        assert!(effective_open(Some(opened), &hours, london(2026, 6, 15, 22, 0)));
        assert!(!effective_open(Some(opened), &hours, london(2026, 6, 15, 23, 30)));
    }

    // Impact: the server runs in UTC, so the close must be applied in UK wall
    // time in both summer (BST, UTC+1) and winter (GMT).
    // Should: honour a 23:00 close in bar-local time in both July and January.
    #[test]
    fn scheduled_close_uses_bar_time_in_bst_and_gmt() {
        let hours = seeded_hours();
        for (m, d) in [(7, 13), (1, 12)] {
            let opened = london(2026, m, d, 20, 30);
            assert!(effective_open(Some(opened), &hours, london(2026, m, d, 22, 59)), "month {m}");
            assert!(!effective_open(Some(opened), &hours, london(2026, m, d, 23, 1)), "month {m}");
        }
    }

    // Should: keep the bar open when it has no recorded opening time.
    #[test]
    fn unknown_opening_time_fails_open() {
        assert!(effective_open(None, &seeded_hours(), london(2026, 6, 15, 23, 30)));
    }

    // -------- Router-level --------

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/kiosk/pair/start", post(pair_start))
            .route("/api/kiosk/pair/status", get(pair_status))
            .route("/api/kiosk/pair/info", get(pair_info))
            .route("/api/kiosk/pair/approve", post(pair_approve))
            .route("/api/kiosk/checkin-code", get(get_checkin_code))
            .route("/api/shifts/check-in", post(check_in))
            .route("/api/bar-status", get(get_bar_status))
            .with_state(state)
    }

    /// Same DB, different "now".
    fn at(state: &AppState, now: DateTime<Utc>) -> AppState {
        AppState { clock: Clock::fixed(now), ..state.clone() }
    }

    async fn enroll_device(state: &AppState, raw_token: &str) -> String {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO kiosk_devices (id, name, token_hash) VALUES (?, 'Till', ?)")
            .bind(&id)
            .bind(hash_token(raw_token))
            .execute(&state.db)
            .await
            .unwrap();
        id
    }

    async fn start_pairing(state: &AppState, raw_token: &str) -> String {
        let res = build_app(state.clone())
            .oneshot(json_post(
                "/api/kiosk/pair/start",
                serde_json::json!({ "token_hash": hash_token(raw_token) }),
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
        body_json(res).await["code"].as_str().unwrap().to_string()
    }

    async fn approve(state: &AppState, token: &str, code: &str) -> Status {
        build_app(state.clone())
            .oneshot(json_post(
                "/api/kiosk/pair/approve",
                serde_json::json!({ "code": code, "name": "Till PC" }),
                Some(token),
                None,
            ))
            .await
            .unwrap()
            .status()
    }

    async fn committee_token(state: &AppState) -> String {
        let committee = user_with_role(true, false);
        insert_user(&state.db, &committee).await;
        token_for(state, &committee)
    }

    async fn check_in_as(state: &AppState, token: &str) -> axum::response::Response {
        let code = current_code(&state.kiosk_secret, state.clock.unix_secs());
        build_app(state.clone())
            .oneshot(json_post(
                "/api/shifts/check-in",
                serde_json::json!({ "code": code }),
                Some(token),
                None,
            ))
            .await
            .unwrap()
    }

    async fn rota_member(state: &AppState) -> (crate::models::User, String) {
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        let token = token_for(state, &member);
        (member, token)
    }

    async fn checked_in_at(state: &AppState, date: &str, user_id: &str) -> Option<String> {
        sqlx::query_scalar("SELECT checked_in_at FROM shift_signups WHERE shift_date = ? AND user_id = ?")
            .bind(date)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .unwrap()
            .flatten()
    }

    async fn bar_row(state: &AppState) -> (bool, Option<String>, Option<String>) {
        sqlx::query_as("SELECT is_open, opened_at, opened_by FROM bar_status WHERE id = 1")
            .fetch_one(&state.db)
            .await
            .unwrap()
    }

    // --- device gate ---

    // Should: refuse code requests without a device token.
    #[tokio::test]
    async fn checkin_code_requires_a_device_token() {
        let state = test_state().await;
        let res = build_app(state).oneshot(get_req("/api/kiosk/checkin-code", None, None)).await.unwrap();
        assert_eq!(res.status(), Status::UNAUTHORIZED);
    }

    // Should: serve codes to an enrolled device.
    #[tokio::test]
    async fn checkin_code_ok_with_valid_device_token() {
        let state = test_state().await;
        enroll_device(&state, "raw-token-abc").await;
        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some("raw-token-abc")))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
    }

    // Should: refuse codes to a revoked device.
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
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some("raw-token-xyz")))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::UNAUTHORIZED);
    }

    // Impact: the kiosk discards its token on 401, so a database hiccup
    // reported as 401 de-enrolled the bar PC.
    // Should: report a device lookup failure as a server error.
    #[tokio::test]
    async fn device_lookup_failure_is_a_server_error_not_unauthorized() {
        let state = test_state().await;
        sqlx::query("DROP TABLE kiosk_devices").execute(&state.db).await.unwrap();
        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some("raw-token")))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::INTERNAL_SERVER_ERROR);
    }

    // --- pairing ---

    // Should: enrol the device from the pairing and let its raw token mint codes.
    // Should not: persist the raw device token.
    #[tokio::test]
    async fn pairing_flow_creates_device_and_stores_only_the_hash() {
        let state = test_state().await;
        let raw = "device-secret-token";
        let code = start_pairing(&state, raw).await;
        let token = committee_token(&state).await;
        assert_eq!(approve(&state, &token, &code).await, Status::OK);

        let stored: String = sqlx::query_scalar("SELECT token_hash FROM kiosk_devices LIMIT 1")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(stored, hash_token(raw));
        assert_ne!(stored, raw);

        let res = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some(raw)))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
    }

    // Should: reject approval by a non-committee user.
    #[tokio::test]
    async fn pair_approve_requires_committee() {
        let state = test_state().await;
        let code = start_pairing(&state, "t").await;
        let plain = user_with_role(false, false);
        insert_user(&state.db, &plain).await;
        assert_eq!(approve(&state, &token_for(&state, &plain), &code).await, Status::FORBIDDEN);
    }

    // Impact: only one kiosk may mint codes, so a pairing approved by mistake
    // takes the real bar PC offline instead of running unnoticed alongside it.
    // Should: revoke the previously enrolled kiosk when a new one is approved.
    #[tokio::test]
    async fn approving_a_new_kiosk_revokes_the_old_one() {
        let state = test_state().await;
        let token = committee_token(&state).await;
        let first = start_pairing(&state, "first-pc").await;
        assert_eq!(approve(&state, &token, &first).await, Status::OK);
        let second = start_pairing(&state, "second-pc").await;
        assert_eq!(approve(&state, &token, &second).await, Status::OK);

        let old = build_app(state.clone())
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some("first-pc")))
            .await
            .unwrap();
        assert_eq!(old.status(), Status::UNAUTHORIZED);
        let new = build_app(state)
            .oneshot(get_req("/api/kiosk/checkin-code", None, Some("second-pc")))
            .await
            .unwrap();
        assert_eq!(new.status(), Status::OK);
    }

    // Should: answer a repeat approval of the same pairing with a conflict and keep one device.
    #[tokio::test]
    async fn approving_the_same_pairing_twice_conflicts() {
        let state = test_state().await;
        let token = committee_token(&state).await;
        let code = start_pairing(&state, "pc").await;
        assert_eq!(approve(&state, &token, &code).await, Status::OK);
        assert_eq!(approve(&state, &token, &code).await, Status::CONFLICT);
        let devices: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM kiosk_devices")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(devices, 1);
    }

    // Should: report a pairing as pending until its TTL, then as expired.
    // Should not: allow an expired pairing to be approved.
    #[tokio::test]
    async fn pairing_expires_after_its_ttl() {
        let t0 = london(2026, 6, 17, 15, 0);
        let state = test_state_at(t0).await;
        let code = start_pairing(&state, "pc").await;
        let token = committee_token(&state).await;

        let status_at = |now| {
            let app = build_app(at(&state, now));
            let uri = format!("/api/kiosk/pair/status?code={code}");
            async move { body_json(app.oneshot(get_req(&uri, None, None)).await.unwrap()).await["status"].clone() }
        };
        assert_eq!(status_at(t0 + Duration::minutes(9)).await, "pending");
        assert_eq!(status_at(t0 + Duration::minutes(11)).await, "expired");
        assert_eq!(
            approve(&at(&state, t0 + Duration::minutes(11)), &token, &code).await,
            Status::NOT_FOUND
        );
    }

    // Should: delete expired pairings when a new pairing starts.
    #[tokio::test]
    async fn pair_start_purges_expired_pairings() {
        let t0 = london(2026, 6, 17, 15, 0);
        let state = test_state_at(t0).await;
        start_pairing(&state, "stale").await;
        start_pairing(&at(&state, t0 + Duration::minutes(11)), "fresh").await;
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM kiosk_pairings")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    // Should: refuse new pairings once too many are pending.
    #[tokio::test]
    async fn pair_start_caps_pending_pairings() {
        let state = test_state().await;
        for i in 0..MAX_PENDING_PAIRINGS {
            start_pairing(&state, &format!("pc-{i}")).await;
        }
        let res = build_app(state)
            .oneshot(json_post(
                "/api/kiosk/pair/start",
                serde_json::json!({ "token_hash": hash_token("one-too-many") }),
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::TOO_MANY_REQUESTS);
    }

    // Should: show the approver where the pairing came from and how many kiosks it will replace.
    #[tokio::test]
    async fn pair_info_reports_requester_and_active_devices() {
        let state = test_state().await;
        enroll_device(&state, "current-pc").await;
        let req = axum::http::Request::builder()
            .method("POST")
            .uri("/api/kiosk/pair/start")
            .header("content-type", "application/json")
            .header("x-forwarded-for", "203.0.113.7, 10.0.0.1")
            .header("user-agent", "KioskBrowser/1.0")
            .body(axum::body::Body::from(
                serde_json::json!({ "token_hash": hash_token("new-pc") }).to_string(),
            ))
            .unwrap();
        let code = body_json(build_app(state.clone()).oneshot(req).await.unwrap()).await["code"]
            .as_str()
            .unwrap()
            .to_string();

        let token = committee_token(&state).await;
        let res = build_app(state)
            .oneshot(get_req(&format!("/api/kiosk/pair/info?code={code}"), Some(&token), None))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::OK);
        let info = body_json(res).await;
        assert_eq!(info["client_ip"], "203.0.113.7");
        assert_eq!(info["user_agent"], "KioskBrowser/1.0");
        assert_eq!(info["active_devices"], 1);
    }

    // Should: hide pairing details from non-committee users.
    #[tokio::test]
    async fn pair_info_requires_committee() {
        let state = test_state().await;
        let code = start_pairing(&state, "pc").await;
        let plain = user_with_role(false, false);
        insert_user(&state.db, &plain).await;
        let res = build_app(state.clone())
            .oneshot(get_req(
                &format!("/api/kiosk/pair/info?code={code}"),
                Some(&token_for(&state, &plain)),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), Status::FORBIDDEN);
    }

    // --- kiosk secret ---

    // Should: return the stored secret on later loads.
    #[tokio::test]
    async fn kiosk_secret_persists_across_loads() {
        let state = test_state().await;
        let first = load_or_create_kiosk_secret(&state.db).await.unwrap();
        let second = load_or_create_kiosk_secret(&state.db).await.unwrap();
        assert_eq!(first, second);
    }

    // Impact: generating a fresh secret after a failed read would silently
    // invalidate every code on screen and overwrite the stored one.
    // Should: fail when the stored secret can't be read.
    #[tokio::test]
    async fn kiosk_secret_read_failure_is_an_error() {
        let state = test_state().await;
        sqlx::query("DROP TABLE app_config").execute(&state.db).await.unwrap();
        assert!(load_or_create_kiosk_secret(&state.db).await.is_err());
    }

    // --- check-in ---

    // Should: stamp attendance on today's shift and open the bar during opening hours.
    #[tokio::test]
    async fn rota_member_checks_in_and_opens_bar() {
        let state = test_state_at(london(2026, 6, 17, 20, 15)).await;
        let (member, token) = rota_member(&state).await;
        insert_shift_signup(&state.db, &member.id, "2026-06-17").await;

        let res = check_in_as(&state, &token).await;
        assert_eq!(res.status(), Status::OK);
        let body = body_json(res).await;
        assert_eq!(body["shift_date"], "2026-06-17");
        assert_eq!(body["was_signed_up"], true);
        assert_eq!(body["bar_open"], true);

        assert!(checked_in_at(&state, "2026-06-17", &member.id).await.is_some());
        let (is_open, _, opened_by) = bar_row(&state).await;
        assert!(is_open);
        assert_eq!(opened_by.as_deref(), Some(member.id.as_str()));
    }

    // Impact: regression guard. After midnight, check-ins used the calendar
    // date: Friday's signup got no attendance and a stray Saturday signup took a slot.
    // Should: record a Sat 00:15 check-in against Friday's shift.
    // Should not: create a signup on Saturday's shift.
    #[tokio::test]
    async fn check_in_after_midnight_lands_on_the_previous_evenings_shift() {
        let state = test_state_at(london(2026, 6, 20, 0, 15)).await;
        let (member, token) = rota_member(&state).await;
        insert_shift_signup(&state.db, &member.id, "2026-06-19").await;

        let body = body_json(check_in_as(&state, &token).await).await;
        assert_eq!(body["shift_date"], "2026-06-19");
        assert_eq!(body["was_signed_up"], true);
        assert!(checked_in_at(&state, "2026-06-19", &member.id).await.is_some());

        let saturday: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shift_signups WHERE shift_date = '2026-06-20'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(saturday, 0);
    }

    // Should: create a signup for a qualified walk-in on a shift with space.
    #[tokio::test]
    async fn walk_in_auto_creates_attendance_row() {
        let state = test_state_at(london(2026, 6, 17, 20, 15)).await;
        let (member, token) = rota_member(&state).await;

        let res = check_in_as(&state, &token).await;
        assert_eq!(res.status(), Status::OK);
        assert_eq!(body_json(res).await["was_signed_up"], false);
        assert!(checked_in_at(&state, "2026-06-17", &member.id).await.is_some());
    }

    // Should not: let a walk-in without a contract onto a contract-only shift.
    #[tokio::test]
    async fn walk_in_needs_a_contract_on_a_contract_only_shift() {
        let state = test_state_at(london(2026, 6, 17, 20, 15)).await;
        insert_event(&state.db, "2026-06-17", None, Some(true)).await;
        let (member, token) = rota_member(&state).await;

        assert_eq!(check_in_as(&state, &token).await.status(), Status::FORBIDDEN);
        assert!(checked_in_at(&state, "2026-06-17", &member.id).await.is_none());
    }

    // Should not: let a walk-in take a slot on a full shift.
    #[tokio::test]
    async fn walk_in_cannot_overfill_a_shift() {
        let state = test_state_at(london(2026, 6, 17, 20, 15)).await;
        for _ in 0..2 {
            let other = user_with(true, true, true, true);
            insert_user(&state.db, &other).await;
            insert_shift_signup(&state.db, &other.id, "2026-06-17").await;
        }
        let (_, token) = rota_member(&state).await;
        assert_eq!(check_in_as(&state, &token).await.status(), Status::CONFLICT);
    }

    // Should: let a member already on a full shift check in.
    #[tokio::test]
    async fn signed_up_member_checks_in_on_a_full_shift() {
        let state = test_state_at(london(2026, 6, 17, 20, 15)).await;
        let (member, token) = rota_member(&state).await;
        insert_shift_signup(&state.db, &member.id, "2026-06-17").await;
        let other = user_with(true, true, true, true);
        insert_user(&state.db, &other).await;
        insert_shift_signup(&state.db, &other.id, "2026-06-17").await;

        assert_eq!(check_in_as(&state, &token).await.status(), Status::OK);
    }

    // Impact: re-stamping on every scan pushed the auto-close onto the wrong
    // shift and lost who actually opened the bar.
    // Should: keep the first opener and opening time when others check in later.
    // Should: keep a member's first check-in time when they scan again.
    #[tokio::test]
    async fn later_check_ins_keep_the_original_opening_and_attendance() {
        let t0 = london(2026, 6, 19, 20, 30);
        let state = test_state_at(t0).await;
        let (first, first_token) = rota_member(&state).await;
        let (_, second_token) = rota_member(&state).await;

        check_in_as(&state, &first_token).await;
        let (_, opened_at, opened_by) = bar_row(&state).await;
        let first_stamp = checked_in_at(&state, "2026-06-19", &first.id).await;

        let later = at(&state, london(2026, 6, 20, 0, 30));
        assert_eq!(check_in_as(&later, &second_token).await.status(), Status::OK);
        assert_eq!(check_in_as(&later, &first_token).await.status(), Status::OK);

        let (is_open, opened_at_after, opened_by_after) = bar_row(&state).await;
        assert!(is_open);
        assert_eq!(opened_at_after, opened_at);
        assert_eq!(opened_by_after, opened_by);
        assert_eq!(checked_in_at(&state, "2026-06-19", &first.id).await, first_stamp);
    }

    // Should: record attendance for a check-in after the scheduled close.
    // Should not: open the bar after the scheduled close.
    #[tokio::test]
    async fn check_in_after_close_records_attendance_without_opening() {
        let state = test_state_at(london(2026, 6, 15, 23, 10)).await; // Monday, closes 23:00
        set_bar_hours(&state.db, MON, "20:00", "23:00").await;
        let (member, token) = rota_member(&state).await;

        let body = body_json(check_in_as(&state, &token).await).await;
        assert_eq!(body["bar_open"], false);
        assert!(checked_in_at(&state, "2026-06-15", &member.id).await.is_some());
        assert!(!bar_row(&state).await.0);
    }

    // Should: reject members who haven't finished onboarding.
    #[tokio::test]
    async fn non_rota_member_cannot_check_in() {
        let state = test_state().await;
        let member = user_with(true, true, true, false); // missing supervised shift
        insert_user(&state.db, &member).await;
        assert_eq!(check_in_as(&state, &token_for(&state, &member)).await.status(), Status::FORBIDDEN);
    }

    // Impact: a member already booked on tonight's shift loses check-in when a
    // new CoC is published; the error is their only prompt at the bar.
    // Should: tell a rota member whose CoC signature was reset to re-sign it.
    #[tokio::test]
    async fn reset_coc_member_is_told_to_resign() {
        let state = test_state().await;
        let member = user_with(true, false, true, true);
        insert_user(&state.db, &member).await;
        let res = check_in_as(&state, &token_for(&state, &member)).await;
        assert_eq!(res.status(), Status::FORBIDDEN);
        let msg = body_json(res).await["error"].as_str().unwrap().to_string();
        assert!(msg.contains("re-sign the updated Code of Conduct"), "got: {msg}");
    }

    // Should: reject a code that isn't currently shown.
    #[tokio::test]
    async fn invalid_code_rejected() {
        let state = test_state().await;
        let (_, token) = rota_member(&state).await;
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

    // --- bar status ---

    async fn open_bar_at(state: &AppState, opened_at: DateTime<Utc>) {
        sqlx::query("UPDATE bar_status SET is_open = 1, opened_at = ? WHERE id = 1")
            .bind(format_ts(opened_at))
            .execute(&state.db)
            .await
            .unwrap();
    }

    async fn public_is_open(state: &AppState) -> serde_json::Value {
        body_json(build_app(state.clone()).oneshot(get_req("/api/bar-status", None, None)).await.unwrap()).await
            ["is_open"]
            .clone()
    }

    // Should: report closed, and persist it, once the opening shift's close has passed.
    #[tokio::test]
    async fn bar_status_auto_closes_after_the_scheduled_close() {
        let state = test_state_at(london(2026, 6, 21, 23, 30)).await; // Sunday
        set_bar_hours(&state.db, SUN, "20:00", "23:00").await;
        open_bar_at(&state, london(2026, 6, 21, 20, 5)).await;

        assert_eq!(public_is_open(&state).await, false);
        assert!(!bar_row(&state).await.0);
    }

    // Should: report open within the shift, including after midnight on a late night.
    #[tokio::test]
    async fn bar_status_reports_open_within_hours() {
        let state = test_state_at(london(2026, 6, 20, 1, 30)).await;
        set_bar_hours(&state.db, FRI, "20:30", "02:00").await;
        open_bar_at(&state, london(2026, 6, 19, 21, 0)).await;
        assert_eq!(public_is_open(&state).await, true);
    }

    // Impact: the lazy auto-close runs on a public read; without the guard it
    // could close a bar that a concurrent check-in had just re-opened.
    // Should not: close the bar when it was re-opened after the stale reading.
    #[tokio::test]
    async fn auto_close_leaves_a_newer_opening_alone() {
        let now = london(2026, 6, 17, 20, 30);
        let state = test_state_at(now).await;
        let stale = format_ts(london(2026, 6, 16, 20, 0));
        open_bar_at(&state, now).await;

        close_if_unchanged(&state.db, Some(&stale), now).await.unwrap();
        assert!(bar_row(&state).await.0);
    }
}
