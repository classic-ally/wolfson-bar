//! Versioned Code of Conduct.
//!
//! `users.code_of_conduct_signed` means "signed the latest `coc_versions` row".
//! Only two paths write it: publishing a new version (resets it for everyone,
//! in the same transaction as the insert) and `record_signature` (sets it
//! together with the version that was signed).

use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqliteExecutor;
use tracing::{error, info};
use ts_rs::TS;

use crate::auth::AdminUser;
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

/// Same shape as SQLite's `datetime('now')`, the default for `published_at`.
const TS_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

pub fn format_ts(t: DateTime<Utc>) -> String {
    t.format(TS_FORMAT).to_string()
}

#[derive(Debug, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct CocVersion {
    #[ts(type = "number")]
    pub version: i64,
    pub body: String,
    pub published_at: String,
}

#[derive(Debug, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct CocVersionSummary {
    #[ts(type = "number")]
    pub version: i64,
    pub published_at: String,
    pub published_by_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PublishCocRequest {
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PublishCocResponse {
    #[ts(type = "number")]
    pub version: i64,
    #[ts(type = "number")]
    pub users_reset: u64,
}

fn reject(status: StatusCode, msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(e: sqlx::Error) -> (StatusCode, Json<ErrorResponse>) {
    error!("❌ CoC db error: {}", e);
    reject(StatusCode::INTERNAL_SERVER_ERROR, "Internal error")
}

pub async fn current_coc_version<'e, E: SqliteExecutor<'e>>(db: E) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM coc_versions")
        .fetch_one(db)
        .await
}

/// Mark `user_id` as having signed `version`. Callers must have checked that
/// `version` is the current one, in the same transaction.
pub async fn record_signature<'e, E: SqliteExecutor<'e>>(
    db: E,
    user_id: &str,
    version: i64,
    signed_at: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET code_of_conduct_signed = TRUE, code_of_conduct_version = ?,
         code_of_conduct_signed_at = ? WHERE id = ?",
    )
    .bind(version)
    .bind(format_ts(signed_at))
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// The CoC members are currently asked to sign. Public: the footer shows it
/// to logged-out visitors too.
pub async fn get_current_coc(
    State(state): State<AppState>,
) -> Result<Json<CocVersion>, (StatusCode, Json<ErrorResponse>)> {
    sqlx::query_as::<_, CocVersion>(
        "SELECT version, body, published_at FROM coc_versions ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .map(Json)
    .ok_or_else(|| reject(StatusCode::NOT_FOUND, "No Code of Conduct published"))
}

/// Publish a new CoC version. Every member, committee and admins included,
/// must re-sign before booking or checking in to shifts again.
pub async fn publish_coc(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Json(req): Json<PublishCocRequest>,
) -> Result<Json<PublishCocResponse>, (StatusCode, Json<ErrorResponse>)> {
    let body = req.body.trim();
    if body.is_empty() {
        return Err(reject(StatusCode::BAD_REQUEST, "Code of Conduct text cannot be empty"));
    }

    let mut tx = state.db.begin().await.map_err(internal)?;

    let current_body: Option<String> =
        sqlx::query_scalar("SELECT body FROM coc_versions ORDER BY version DESC LIMIT 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?;
    if current_body.as_deref().map(str::trim) == Some(body) {
        return Err(reject(
            StatusCode::BAD_REQUEST,
            "Text is unchanged from the current version",
        ));
    }

    let version = current_coc_version(&mut *tx).await.map_err(internal)? + 1;
    sqlx::query(
        "INSERT INTO coc_versions (version, body, published_at, published_by) VALUES (?, ?, ?, ?)",
    )
    .bind(version)
    .bind(body)
    .bind(format_ts(state.clock.now()))
    .bind(&admin.id)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;

    let users_reset = sqlx::query(
        "UPDATE users SET code_of_conduct_signed = FALSE WHERE code_of_conduct_signed = TRUE",
    )
    .execute(&mut *tx)
    .await
    .map_err(internal)?
    .rows_affected();

    tx.commit().await.map_err(internal)?;

    info!(
        "📜 Admin {} published CoC v{}; {} signatures reset",
        admin.id, version, users_reset
    );
    Ok(Json(PublishCocResponse { version, users_reset }))
}

/// Publication history, newest first.
pub async fn list_coc_versions(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
) -> Result<Json<Vec<CocVersionSummary>>, (StatusCode, Json<ErrorResponse>)> {
    let versions = sqlx::query_as::<_, CocVersionSummary>(
        "SELECT c.version, c.published_at, u.display_name AS published_by_name
         FROM coc_versions c LEFT JOIN users u ON u.id = c.published_by
         ORDER BY c.version DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    Ok(Json(versions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::User;
    use crate::routes::admin::get_overview_stats;
    use crate::routes::shifts::signup_for_shift;
    use crate::test_util::{
        body_json, get_req, insert_user, json_post, test_state, token_for, user_with, user_with_role,
    };
    use axum::http::StatusCode as Status;
    use axum::routing::{get, post};
    use axum::Router;
    use tower::ServiceExt;

    fn build_app(state: AppState) -> Router {
        Router::new()
            .route("/api/coc/current", get(get_current_coc))
            .route("/api/admin/coc", post(publish_coc))
            .route("/api/admin/coc/versions", get(list_coc_versions))
            .route("/api/admin/overview", get(get_overview_stats))
            .route("/api/shifts/:date/signup", post(signup_for_shift))
            .with_state(state)
    }

    fn admin() -> User {
        let mut u = user_with(true, true, true, true);
        u.is_committee = true;
        u.is_admin = true;
        u
    }

    async fn publish(state: &AppState, as_user: &User, body: &str) -> axum::response::Response {
        build_app(state.clone())
            .oneshot(json_post(
                "/api/admin/coc",
                serde_json::json!({ "body": body }),
                Some(&token_for(state, as_user)),
                None,
            ))
            .await
            .unwrap()
    }

    async fn signed(state: &AppState, user_id: &str) -> bool {
        sqlx::query_scalar("SELECT code_of_conduct_signed FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap()
    }

    // Should: serve the seeded version 1 text to anyone, without logging in.
    #[tokio::test]
    async fn current_coc_is_public_and_seeded() {
        let state = test_state().await;
        let res = build_app(state).oneshot(get_req("/api/coc/current", None, None)).await.unwrap();
        assert_eq!(res.status(), Status::OK);
        let json = body_json(res).await;
        assert_eq!(json["version"], 1);
        assert!(json["body"].as_str().unwrap().contains("Code of Conduct"));
    }

    // Should: create the next version, record who published it, and serve it as current.
    // Should: reset the signature of every member who had signed the previous version.
    #[tokio::test]
    async fn publish_creates_next_version_and_resets_signatures() {
        let state = test_state().await;
        let admin = admin();
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &admin).await;
        insert_user(&state.db, &member).await;

        let res = publish(&state, &admin, "# New CoC").await;
        assert_eq!(res.status(), Status::OK);
        let json = body_json(res).await;
        assert_eq!(json["version"], 2);
        assert_eq!(json["users_reset"], 2);

        assert!(!signed(&state, &admin.id).await);
        assert!(!signed(&state, &member.id).await);

        let current = body_json(
            build_app(state.clone()).oneshot(get_req("/api/coc/current", None, None)).await.unwrap(),
        )
        .await;
        assert_eq!(current["version"], 2);
        assert_eq!(current["body"], "# New CoC");

        let history = body_json(
            build_app(state.clone())
                .oneshot(get_req("/api/admin/coc/versions", Some(&token_for(&state, &admin)), None))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(history[0]["version"], 2);
        assert_eq!(history[0]["published_by_name"], "Test");
        assert_eq!(history[1]["version"], 1);
    }

    // Should not: let committee members or regular members publish a new version.
    #[tokio::test]
    async fn only_admins_can_publish() {
        let state = test_state().await;
        for user in [user_with_role(true, false), user_with_role(false, false)] {
            insert_user(&state.db, &user).await;
            let res = publish(&state, &user, "# Sneaky").await;
            assert_eq!(res.status(), Status::FORBIDDEN);
        }
        assert_eq!(current_coc_version(&state.db).await.unwrap(), 1);
    }

    // Should not: publish an empty or unchanged text as a new version.
    #[tokio::test]
    async fn publish_rejects_empty_or_unchanged_text() {
        let state = test_state().await;
        let admin = admin();
        insert_user(&state.db, &admin).await;

        assert_eq!(publish(&state, &admin, "   ").await.status(), Status::BAD_REQUEST);
        assert_eq!(publish(&state, &admin, "# v2").await.status(), Status::OK);
        assert_eq!(publish(&state, &admin, "# v2\n").await.status(), Status::BAD_REQUEST);
        assert_eq!(current_coc_version(&state.db).await.unwrap(), 2);
    }

    // Impact: committee and admins must keep running the system while they
    // haven't re-signed; only the bar-work gates depend on the CoC.
    // Should: keep committee endpoints available to a committee member whose signature was reset.
    // Should: refuse that member's shift signups until they re-sign.
    #[tokio::test]
    async fn reset_committee_member_keeps_access_but_cannot_book_shifts() {
        let state = test_state().await;
        let admin = admin();
        let mut committee = user_with(true, true, true, true);
        committee.is_committee = true;
        insert_user(&state.db, &admin).await;
        insert_user(&state.db, &committee).await;

        assert_eq!(publish(&state, &admin, "# v2").await.status(), Status::OK);
        let token = token_for(&state, &committee);

        let overview = build_app(state.clone())
            .oneshot(get_req("/api/admin/overview", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(overview.status(), Status::OK);

        let signup = build_app(state.clone())
            .oneshot(json_post("/api/shifts/2026-06-20/signup", serde_json::json!({}), Some(&token), None))
            .await
            .unwrap();
        assert_eq!(signup.status(), Status::FORBIDDEN);
    }
}
