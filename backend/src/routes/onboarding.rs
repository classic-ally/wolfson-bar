//! Committee view of where every member is in onboarding, and sending a
//! stuck reminder by hand.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use tracing::{error, info};
use ts_rs::TS;

use crate::auth::CommitteeUser;
use crate::membership_email::TemplateKey;
use crate::membership_notifications::{deliver, Delivery};
use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;
use crate::routes::membership::load_links;

type ApiError = (StatusCode, Json<ErrorResponse>);

fn reject(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(e: sqlx::Error) -> ApiError {
    error!("Onboarding query failed: {}", e);
    reject(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
}

/// One member's onboarding progress. Step times are null when the step isn't
/// done, or was done before times were recorded.
#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct OnboardingRow {
    pub user_id: String,
    pub display_name: Option<String>,
    pub created_at: String,
    pub has_email: bool,
    pub email_membership: bool,
    pub coc_signed: bool,
    /// Signed an earlier version and must re-sign.
    pub coc_resign: bool,
    pub coc_signed_at: Option<String>,
    pub inducted: bool,
    pub inducted_at: Option<String>,
    pub certificate_uploaded: bool,
    pub certificate_uploaded_at: Option<String>,
    pub certificate_approved: bool,
    pub certificate_approved_at: Option<String>,
    pub supervised: bool,
    pub supervised_at: Option<String>,
    /// Most recent membership email actually sent.
    pub last_email_key: Option<String>,
    pub last_email_at: Option<String>,
    pub last_reminder_at: Option<String>,
}

pub async fn get_onboarding(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
) -> Result<Json<Vec<OnboardingRow>>, ApiError> {
    sqlx::query_as(
        "SELECT u.id AS user_id, u.display_name, u.created_at,
                u.email IS NOT NULL AS has_email, u.email_membership,
                u.code_of_conduct_signed AS coc_signed,
                (u.code_of_conduct_signed = FALSE AND u.code_of_conduct_version IS NOT NULL) AS coc_resign,
                u.code_of_conduct_signed_at AS coc_signed_at,
                u.induction_completed AS inducted, u.induction_completed_at AS inducted_at,
                u.food_safety_certificate IS NOT NULL AS certificate_uploaded,
                u.food_safety_uploaded_at AS certificate_uploaded_at,
                u.food_safety_completed AS certificate_approved,
                u.food_safety_approved_at AS certificate_approved_at,
                u.supervised_shift_completed AS supervised,
                u.supervised_shift_completed_at AS supervised_at,
                last.email_key AS last_email_key, last.sent_at AS last_email_at,
                (SELECT MAX(sent_at) FROM membership_email_log
                 WHERE user_id = u.id AND email_key = 'stuck_reminder' AND outcome = 'sent') AS last_reminder_at
         FROM users u
         LEFT JOIN membership_email_log last ON last.id = (
             SELECT id FROM membership_email_log
             WHERE user_id = u.id AND outcome = 'sent'
             ORDER BY sent_at DESC, id DESC LIMIT 1
         )
         ORDER BY u.created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map(Json)
    .map_err(internal)
}

/// Send the stuck reminder to a member now. Unlike the automatic one, this can
/// be sent any number of times.
pub async fn send_onboarding_reminder(
    State(state): State<AppState>,
    CommitteeUser(sender): CommitteeUser,
    Path(user_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?
        .ok_or_else(|| reject(StatusCode::NOT_FOUND, "User not found"))?;

    if user.is_rota_member() {
        return Err(reject(StatusCode::BAD_REQUEST, "They've already finished onboarding"));
    }
    if user.email.is_none() {
        return Err(reject(StatusCode::BAD_REQUEST, "They don't have an email address"));
    }
    if !user.email_membership {
        return Err(reject(StatusCode::BAD_REQUEST, "They've turned off Membership emails"));
    }
    let Some(email_service) = state.email_service.as_ref() else {
        return Err(reject(StatusCode::SERVICE_UNAVAILABLE, "Email sending isn't configured on this server"));
    };

    let links = load_links(&state.db).await.map_err(internal)?;
    let delivery = Delivery {
        user: &user,
        key: TemplateKey::StuckReminder,
        log_key: TemplateKey::StuckReminder.as_str().to_string(),
        sent_by: Some(&sender.id),
    };
    deliver(&state.db, email_service, &state.public_url, &links, delivery, state.clock.now())
        .await
        .map_err(|e| {
            error!("Failed to send onboarding reminder: {}", e);
            reject(StatusCode::BAD_GATEWAY, "Failed to send the reminder")
        })?;

    info!("📨 Committee member {} sent an onboarding reminder to {}", sender.id, user.id);
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::mark_inducted;
    use crate::test_util::{insert_user, london, test_state, user_with, user_with_role};

    // Should: report each member's steps with the time each one was done.
    // Should: show the most recent membership email actually sent.
    #[tokio::test]
    async fn lists_progress_with_times_and_last_email() {
        let state = test_state().await;
        let committee = user_with_role(true, false);
        let member = user_with(false, true, false, false);
        insert_user(&state.db, &committee).await;
        insert_user(&state.db, &member).await;
        mark_inducted(&state.db, &member.id, london(2026, 6, 17, 19, 45)).await.unwrap();
        sqlx::query(
            "INSERT INTO membership_email_log (user_id, email_key, outcome, sent_at) VALUES
             (?, 'post_induction', 'sent', '2026-06-18 07:00:00'),
             (?, 'ready_to_book', 'skipped', '2026-06-19 07:00:00')",
        )
        .bind(&member.id)
        .bind(&member.id)
        .execute(&state.db)
        .await
        .unwrap();

        let Json(rows) = get_onboarding(State(state), CommitteeUser(committee)).await.unwrap();
        let row = rows.iter().find(|r| r.user_id == member.id).unwrap();
        assert!(row.inducted && row.coc_signed && !row.certificate_uploaded);
        assert_eq!(row.inducted_at.as_deref(), Some("2026-06-17 18:45:00"));
        assert_eq!(row.last_email_key.as_deref(), Some("post_induction"));
        assert_eq!(row.last_email_at.as_deref(), Some("2026-06-18 07:00:00"));
    }

    // Should not: send a reminder to members who opted out, have no address,
    // or have already finished onboarding.
    #[tokio::test]
    async fn reminder_respects_member_state() {
        let state = test_state().await;
        let committee = user_with_role(true, false);
        insert_user(&state.db, &committee).await;
        let no_email = user_with(true, false, false, false);
        let opted_out = user_with(true, false, false, false);
        let finished = user_with(true, true, true, true);
        for u in [&no_email, &opted_out, &finished] {
            insert_user(&state.db, u).await;
        }
        sqlx::query("UPDATE users SET email = id || '@example.test', email_membership = TRUE WHERE id IN (?, ?)")
            .bind(&opted_out.id)
            .bind(&finished.id)
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query("UPDATE users SET email_membership = FALSE WHERE id = ?")
            .bind(&opted_out.id)
            .execute(&state.db)
            .await
            .unwrap();

        for target in [&no_email, &opted_out, &finished] {
            let (status, _) = send_onboarding_reminder(
                State(state.clone()),
                CommitteeUser(committee.clone()),
                Path(target.id.clone()),
            )
            .await
            .expect_err("expected rejection");
            assert_eq!(status, StatusCode::BAD_REQUEST);
        }
    }
}
