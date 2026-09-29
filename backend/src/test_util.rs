//! Shared test helpers for integration tests across the route modules.
//! `#[cfg(test)]` keeps these out of release builds.

use axum::body::Body;
use axum::http::Request;
use chrono::{DateTime, TimeZone, Utc};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use webauthn_rs::prelude::*;

use crate::auth::create_jwt_token;
use crate::clock::Clock;
use crate::constants::BAR_TZ;
use crate::db::run_migrations;
use crate::models::User;
use crate::routes::auth::AppState;

/// Test state pinned to a fixed, unremarkable instant (a Wednesday afternoon).
/// Use `test_state_at` when the test depends on the time of day or weekday.
pub async fn test_state() -> AppState {
    test_state_at(london(2026, 6, 17, 15, 0)).await
}

pub async fn test_state_at(now: DateTime<Utc>) -> AppState {
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite");
    run_migrations(&db).await;

    let rp_origin = Url::parse("http://localhost").unwrap();
    let webauthn = WebauthnBuilder::new("localhost", &rp_origin)
        .unwrap()
        .build()
        .unwrap();

    AppState {
        db,
        webauthn,
        jwt_secret: vec![0u8; 32],
        kiosk_secret: vec![7u8; 32],
        email_service: None,
        public_url: "http://localhost".to_string(),
        clock: Clock::fixed(now),
    }
}

/// A wall-clock time in the bar's timezone, as the UTC instant the clock yields.
pub fn london(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
    BAR_TZ
        .with_ymd_and_hms(y, m, d, h, min, 0)
        .single()
        .expect("unambiguous London time")
        .with_timezone(&Utc)
}

pub fn token_for(state: &AppState, user: &User) -> String {
    create_jwt_token(&user.id, &state.jwt_secret).expect("sign test jwt")
}

pub async fn set_bar_hours(db: &SqlitePool, day_of_week: i64, open: &str, close: &str) {
    sqlx::query("UPDATE bar_hours SET open_time = ?, close_time = ? WHERE day_of_week = ?")
        .bind(open)
        .bind(close)
        .bind(day_of_week)
        .execute(db)
        .await
        .expect("set bar hours");
}

pub async fn insert_event(db: &SqlitePool, date: &str, max_volunteers: Option<i32>, requires_contract: Option<bool>) {
    sqlx::query(
        "INSERT INTO events (id, title, event_date, shift_max_volunteers, shift_requires_contract)
         VALUES (?, 'Test event', ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(date)
    .bind(max_volunteers)
    .bind(requires_contract)
    .execute(db)
    .await
    .expect("insert event");
}

pub fn json_post(uri: &str, body: serde_json::Value, bearer: Option<&str>, kiosk: Option<&str>) -> Request<Body> {
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

pub fn get_req(uri: &str, bearer: Option<&str>, kiosk: Option<&str>) -> Request<Body> {
    let mut b = Request::builder().uri(uri);
    if let Some(t) = bearer {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    if let Some(k) = kiosk {
        b = b.header("x-kiosk-token", k);
    }
    b.body(Body::empty()).unwrap()
}

pub async fn body_json(res: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

pub async fn insert_user(db: &SqlitePool, user: &User) {
    sqlx::query(
        "INSERT INTO users (id, display_name, passkey_credential, is_committee, is_admin,
         code_of_conduct_signed, food_safety_completed, induction_completed, has_contract,
         contract_expiry_date, created_at, supervised_shift_completed)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
    )
    .bind(&user.id)
    .bind(&user.display_name)
    .bind(user.is_committee)
    .bind(user.is_admin)
    .bind(user.code_of_conduct_signed)
    .bind(user.food_safety_completed)
    .bind(user.induction_completed)
    .bind(user.has_contract)
    .bind(&user.created_at)
    .bind(user.supervised_shift_completed)
    .execute(db)
    .await
    .expect("insert user");
}

pub async fn insert_shift_signup(db: &SqlitePool, user_id: &str, date: &str) {
    sqlx::query("INSERT INTO shift_signups (shift_date, user_id) VALUES (?, ?)")
        .bind(date)
        .bind(user_id)
        .execute(db)
        .await
        .expect("insert shift signup");
}

/// Build a User with the four onboarding flags set as specified.
pub fn user_with(induction: bool, coc: bool, food: bool, supervised: bool) -> User {
    let mut u = User::new(Some("Test".into()), None, false, false);
    u.induction_completed = induction;
    u.code_of_conduct_signed = coc;
    u.food_safety_completed = food;
    u.supervised_shift_completed = supervised;
    u
}

/// Build a User with explicit committee + admin flags. Used for auth-gate tests.
pub fn user_with_role(committee: bool, admin: bool) -> User {
    User::new(Some("Test".into()), None, committee, admin)
}
