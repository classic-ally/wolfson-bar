//! Onboarding step transitions. Every route that marks a step goes through
//! here so the step's `*_at` timestamp is always recorded alongside its flag.
//! Re-marking a completed step keeps the original timestamp.

use chrono::{DateTime, Utc};
use sqlx::SqliteExecutor;

use crate::routes::coc::format_ts;

pub async fn mark_inducted<'e, E: SqliteExecutor<'e>>(
    db: E,
    user_id: &str,
    at: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET induction_completed = TRUE,
         induction_completed_at = CASE WHEN induction_completed = TRUE THEN induction_completed_at ELSE ? END
         WHERE id = ?",
    )
    .bind(format_ts(at))
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// Undo an induction marked by mistake. Clearing the timestamp also stops the
/// post-induction email if it hasn't gone out yet.
pub async fn unmark_inducted<'e, E: SqliteExecutor<'e>>(db: E, user_id: &str) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET induction_completed = FALSE, induction_completed_at = NULL WHERE id = ?",
    )
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

pub async fn mark_supervised<'e, E: SqliteExecutor<'e>>(
    db: E,
    user_id: &str,
    at: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET supervised_shift_completed = TRUE,
         supervised_shift_completed_at = CASE WHEN supervised_shift_completed = TRUE
             THEN supervised_shift_completed_at ELSE ? END
         WHERE id = ?",
    )
    .bind(format_ts(at))
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

pub async fn unmark_supervised<'e, E: SqliteExecutor<'e>>(db: E, user_id: &str) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET supervised_shift_completed = FALSE, supervised_shift_completed_at = NULL WHERE id = ?",
    )
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

/// Store a member's food safety certificate. `approved` is set when an admin
/// uploads on the member's behalf, which counts as approval.
pub async fn record_certificate<'e, E: SqliteExecutor<'e>>(
    db: E,
    user_id: &str,
    bytes: &[u8],
    content_type: &str,
    approved: bool,
    at: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let ts = format_ts(at);
    let result = sqlx::query(
        "UPDATE users SET food_safety_certificate = ?, food_safety_certificate_type = ?,
         food_safety_uploaded_at = ?,
         food_safety_completed = food_safety_completed OR ?,
         food_safety_approved_at = CASE WHEN ? AND food_safety_completed = FALSE THEN ? ELSE food_safety_approved_at END
         WHERE id = ?",
    )
    .bind(bytes)
    .bind(content_type)
    .bind(&ts)
    .bind(approved)
    .bind(approved)
    .bind(&ts)
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

pub async fn approve_certificate<'e, E: SqliteExecutor<'e>>(
    db: E,
    user_id: &str,
    at: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE users SET food_safety_completed = TRUE,
         food_safety_approved_at = CASE WHEN food_safety_completed = TRUE THEN food_safety_approved_at ELSE ? END
         WHERE id = ?",
    )
    .bind(format_ts(at))
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{insert_user, london, test_state, user_with};
    use sqlx::SqlitePool;

    async fn timestamps(db: &SqlitePool, id: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
        sqlx::query_as(
            "SELECT induction_completed_at, food_safety_uploaded_at, food_safety_approved_at,
             supervised_shift_completed_at FROM users WHERE id = ?",
        )
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
    }

    // Impact: the post-induction email is scheduled from this timestamp, so a
    // repeat QR scan must not push it back or re-arm it.
    // Should: record when a member was first inducted.
    // Should not: move the timestamp when an inducted member is marked again.
    #[tokio::test]
    async fn induction_keeps_first_timestamp() {
        let state = test_state().await;
        let user = user_with(false, true, true, false);
        insert_user(&state.db, &user).await;

        mark_inducted(&state.db, &user.id, london(2026, 6, 17, 19, 45)).await.unwrap();
        mark_inducted(&state.db, &user.id, london(2026, 6, 20, 19, 45)).await.unwrap();

        let (inducted_at, ..) = timestamps(&state.db, &user.id).await;
        assert_eq!(inducted_at.as_deref(), Some("2026-06-17 18:45:00"));
    }

    // Should: clear the induction flag and its timestamp when unmarked.
    #[tokio::test]
    async fn unmarking_induction_clears_timestamp() {
        let state = test_state().await;
        let user = user_with(false, true, true, false);
        insert_user(&state.db, &user).await;
        mark_inducted(&state.db, &user.id, london(2026, 6, 17, 19, 45)).await.unwrap();

        unmark_inducted(&state.db, &user.id).await.unwrap();

        let inducted: bool = sqlx::query_scalar("SELECT induction_completed FROM users WHERE id = ?")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert!(!inducted);
        assert_eq!(timestamps(&state.db, &user.id).await.0, None);
    }

    // Should: record the upload time of a member's own certificate without approving it.
    // Should: record both upload and approval when an admin uploads on their behalf.
    #[tokio::test]
    async fn certificate_upload_records_times() {
        let state = test_state().await;
        let member = user_with(true, true, false, false);
        let via_admin = user_with(true, true, false, false);
        insert_user(&state.db, &member).await;
        insert_user(&state.db, &via_admin).await;
        let at = london(2026, 6, 18, 10, 0);

        record_certificate(&state.db, &member.id, b"%PDF", "application/pdf", false, at).await.unwrap();
        record_certificate(&state.db, &via_admin.id, b"%PDF", "application/pdf", true, at).await.unwrap();

        let (_, uploaded, approved, _) = timestamps(&state.db, &member.id).await;
        assert_eq!((uploaded.as_deref(), approved), (Some("2026-06-18 09:00:00"), None));
        let (_, uploaded, approved, _) = timestamps(&state.db, &via_admin.id).await;
        assert_eq!(uploaded.as_deref(), Some("2026-06-18 09:00:00"));
        assert_eq!(approved.as_deref(), Some("2026-06-18 09:00:00"));
    }

    // Should: record when a certificate and a supervised shift were approved.
    #[tokio::test]
    async fn approvals_record_times() {
        let state = test_state().await;
        let user = user_with(true, true, false, false);
        insert_user(&state.db, &user).await;

        approve_certificate(&state.db, &user.id, london(2026, 6, 18, 10, 0)).await.unwrap();
        mark_supervised(&state.db, &user.id, london(2026, 6, 19, 23, 0)).await.unwrap();

        let (_, _, approved, supervised) = timestamps(&state.db, &user.id).await;
        assert_eq!(approved.as_deref(), Some("2026-06-18 09:00:00"));
        assert_eq!(supervised.as_deref(), Some("2026-06-19 22:00:00"));
    }
}
