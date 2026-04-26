//! Shared test helpers for integration tests across the route modules.
//! `#[cfg(test)]` keeps these out of release builds.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use webauthn_rs::prelude::*;

use crate::db::run_migrations;
use crate::models::User;
use crate::routes::auth::AppState;

pub async fn test_state() -> AppState {
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
        email_service: None,
        public_url: "http://localhost".to_string(),
    }
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
