//! Admin-editable membership email content: training links, email templates
//! and the email schedule settings.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::SqliteExecutor;
use tracing::{error, info};
use ts_rs::TS;

use crate::auth::{AdminUser, AuthenticatedUser};
use crate::membership_email::{
    render, unknown_placeholders, Context, Progress, TemplateKey, TrainingLink, BODY_PLACEHOLDERS,
    SUBJECT_PLACEHOLDERS,
};
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;
use crate::routes::coc::format_ts;

type ApiError = (StatusCode, Json<ErrorResponse>);

fn reject(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(e: sqlx::Error) -> ApiError {
    error!("Membership content query failed: {}", e);
    reject(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
}

pub async fn load_links<'e, E: SqliteExecutor<'e>>(db: E) -> Result<Vec<TrainingLink>, sqlx::Error> {
    sqlx::query_as("SELECT label, url FROM training_links ORDER BY position, id")
        .fetch_all(db)
        .await
}

/// The subject and body of a template.
pub async fn load_template<'e, E: SqliteExecutor<'e>>(
    db: E,
    key: TemplateKey,
) -> Result<(String, String), sqlx::Error> {
    sqlx::query_as("SELECT subject, body FROM email_templates WHERE key = ?")
        .bind(key.as_str())
        .fetch_one(db)
        .await
}

// ===== Training links =====

/// Training links for the onboarding checklist. Any signed-in member.
pub async fn get_training_links(
    State(state): State<AppState>,
    AuthenticatedUser(_): AuthenticatedUser,
) -> Result<Json<Vec<TrainingLink>>, ApiError> {
    load_links(&state.db).await.map(Json).map_err(internal)
}

fn valid_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://"))
        && !url.chars().any(|c| c.is_whitespace() || c == '<' || c == '>')
}

/// Replace the whole list of training links, in the order given.
pub async fn put_training_links(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Json(links): Json<Vec<TrainingLink>>,
) -> Result<StatusCode, ApiError> {
    for link in &links {
        if link.label.trim().is_empty() {
            return Err(reject(StatusCode::BAD_REQUEST, "Every link needs a label"));
        }
        if !valid_url(link.url.trim()) {
            return Err(reject(
                StatusCode::BAD_REQUEST,
                &format!("\"{}\" isn't a valid web address (it must start with https://)", link.url.trim()),
            ));
        }
    }

    let mut tx = state.db.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM training_links").execute(&mut *tx).await.map_err(internal)?;
    for (position, link) in links.iter().enumerate() {
        sqlx::query("INSERT INTO training_links (position, label, url) VALUES (?, ?, ?)")
            .bind(position as i64)
            .bind(link.label.trim())
            .bind(link.url.trim())
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;

    info!("🔗 Admin {} updated training links ({} links)", admin.id, links.len());
    Ok(StatusCode::OK)
}

// ===== Email templates =====

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct EmailTemplate {
    pub key: String,
    pub subject: String,
    pub body: String,
    pub updated_at: String,
    pub updated_by_name: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct EmailTemplateDraft {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RenderedEmail {
    pub subject: String,
    pub html: String,
}

pub async fn list_email_templates(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
) -> Result<Json<Vec<EmailTemplate>>, ApiError> {
    let mut templates: Vec<EmailTemplate> = sqlx::query_as(
        "SELECT t.key, t.subject, t.body, t.updated_at, u.display_name AS updated_by_name
         FROM email_templates t LEFT JOIN users u ON u.id = t.updated_by",
    )
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;
    let order = |key: &str| TemplateKey::ALL.iter().position(|k| k.as_str() == key);
    templates.sort_by_key(|t| order(&t.key));
    Ok(Json(templates))
}

fn parse_key(key: &str) -> Result<TemplateKey, ApiError> {
    TemplateKey::parse(key).ok_or_else(|| reject(StatusCode::NOT_FOUND, "Unknown email template"))
}

fn validate_draft(draft: &EmailTemplateDraft) -> Result<(), ApiError> {
    if draft.subject.trim().is_empty() || draft.body.trim().is_empty() {
        return Err(reject(StatusCode::BAD_REQUEST, "Subject and body can't be empty"));
    }
    let unknown_subject = unknown_placeholders(&draft.subject, SUBJECT_PLACEHOLDERS);
    if !unknown_subject.is_empty() {
        return Err(reject(
            StatusCode::BAD_REQUEST,
            &format!("The subject can only use {{{{name}}}}; found {{{{{}}}}}", unknown_subject.join("}}, {{")),
        ));
    }
    let unknown_body = unknown_placeholders(&draft.body, BODY_PLACEHOLDERS);
    if !unknown_body.is_empty() {
        return Err(reject(
            StatusCode::BAD_REQUEST,
            &format!("Unknown placeholder {{{{{}}}}}", unknown_body.join("}}, {{")),
        ));
    }
    Ok(())
}

pub async fn put_email_template(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(key): Path<String>,
    Json(draft): Json<EmailTemplateDraft>,
) -> Result<StatusCode, ApiError> {
    let key = parse_key(&key)?;
    validate_draft(&draft)?;
    sqlx::query("UPDATE email_templates SET subject = ?, body = ?, updated_at = ?, updated_by = ? WHERE key = ?")
        .bind(draft.subject.trim())
        .bind(draft.body.trim())
        .bind(format_ts(state.clock.now()))
        .bind(&admin.id)
        .bind(key.as_str())
        .execute(&state.db)
        .await
        .map_err(internal)?;
    info!("✉️ Admin {} updated the {} email template", admin.id, key.as_str());
    Ok(StatusCode::OK)
}

/// Render a draft for an example member partway through onboarding.
async fn render_sample(state: &AppState, draft: &EmailTemplateDraft) -> Result<RenderedEmail, ApiError> {
    validate_draft(draft)?;
    let links = load_links(&state.db).await.map_err(internal)?;
    let ctx = Context { name: "Alex", progress: Progress::SAMPLE, links: &links, public_url: &state.public_url };
    let (subject, html) = render(&draft.subject, &draft.body, &ctx);
    Ok(RenderedEmail { subject, html })
}

pub async fn preview_email_template(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    Path(key): Path<String>,
    Json(draft): Json<EmailTemplateDraft>,
) -> Result<Json<RenderedEmail>, ApiError> {
    parse_key(&key)?;
    render_sample(&state, &draft).await.map(Json)
}

/// Send the rendered draft to the admin's own address.
pub async fn send_test_email_template(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(key): Path<String>,
    Json(draft): Json<EmailTemplateDraft>,
) -> Result<StatusCode, ApiError> {
    parse_key(&key)?;
    let Some(to) = admin.email.as_deref() else {
        return Err(reject(StatusCode::BAD_REQUEST, "Add an email address to your account to receive test emails"));
    };
    let Some(email_service) = state.email_service.as_ref() else {
        return Err(reject(StatusCode::SERVICE_UNAVAILABLE, "Email sending isn't configured on this server"));
    };
    let rendered = render_sample(&state, &draft).await?;
    email_service
        .send_email(to, &format!("[Test] {}", rendered.subject), &rendered.html, None)
        .await
        .map_err(|e| {
            error!("Failed to send test email: {}", e);
            reject(StatusCode::BAD_GATEWAY, "Failed to send the test email")
        })?;
    Ok(StatusCode::OK)
}

// ===== Settings =====

#[derive(Debug, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct OnboardingSettings {
    /// Minimum time after induction before the post-induction email goes out,
    /// leaving room to undo a mistaken induction.
    #[ts(type = "number")]
    pub post_induction_delay_hours: i64,
    /// Days after induction before the automatic reminder; null turns it off.
    #[ts(type = "number | null")]
    pub stuck_reminder_days: Option<i64>,
}

pub async fn load_settings<'e, E: SqliteExecutor<'e>>(db: E) -> Result<OnboardingSettings, sqlx::Error> {
    sqlx::query_as("SELECT post_induction_delay_hours, stuck_reminder_days FROM onboarding_settings WHERE id = 1")
        .fetch_one(db)
        .await
}

pub async fn get_onboarding_settings(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
) -> Result<Json<OnboardingSettings>, ApiError> {
    load_settings(&state.db).await.map(Json).map_err(internal)
}

pub async fn put_onboarding_settings(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Json(settings): Json<OnboardingSettings>,
) -> Result<StatusCode, ApiError> {
    if !(0..=168).contains(&settings.post_induction_delay_hours) {
        return Err(reject(StatusCode::BAD_REQUEST, "The post-induction delay must be between 0 and 168 hours"));
    }
    if settings.stuck_reminder_days.is_some_and(|d| !(1..=365).contains(&d)) {
        return Err(reject(StatusCode::BAD_REQUEST, "The reminder must be between 1 and 365 days after induction"));
    }
    sqlx::query("UPDATE onboarding_settings SET post_induction_delay_hours = ?, stuck_reminder_days = ? WHERE id = 1")
        .bind(settings.post_induction_delay_hours)
        .bind(settings.stuck_reminder_days)
        .execute(&state.db)
        .await
        .map_err(internal)?;
    info!("⚙️ Admin {} updated onboarding email settings", admin.id);
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{insert_user, test_state, user_with_role};

    fn draft(subject: &str, body: &str) -> EmailTemplateDraft {
        EmailTemplateDraft { subject: subject.into(), body: body.into() }
    }

    // Should: seed every membership email template and the food safety links.
    #[tokio::test]
    async fn seeds_templates_and_links() {
        let state = test_state().await;
        for key in TemplateKey::ALL {
            load_template(&state.db, key).await.unwrap_or_else(|_| panic!("missing {}", key.as_str()));
        }
        assert_eq!(load_links(&state.db).await.unwrap().len(), 2);
    }

    // Impact: migrations re-run on every boot, so a re-seed would bring back
    // links an admin deliberately removed.
    // Should not: restore deleted training links when migrations run again.
    #[tokio::test]
    async fn deleted_links_stay_deleted() {
        // Own shared-cache pool: re-running migrations on test_state's
        // single-connection pool trips sqlx (see db.rs re-run tests).
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite:file:training_links_rerun_test?mode=memory&cache=shared")
            .await
            .unwrap();
        crate::db::run_migrations(&db).await;
        sqlx::query("DELETE FROM training_links").execute(&db).await.unwrap();

        crate::db::run_migrations(&db).await;

        assert!(load_links(&db).await.unwrap().is_empty());
    }

    // Should: reject templates that use placeholders the email can't fill.
    #[tokio::test]
    async fn rejects_unknown_placeholders() {
        let state = test_state().await;
        let admin = user_with_role(true, true);
        insert_user(&state.db, &admin).await;

        let bad_body = draft("Hi", "Hello {{nmae}}");
        let (status, _) = put_email_template(State(state.clone()), AdminUser(admin.clone()), Path("ready_to_book".into()), Json(bad_body))
            .await
            .expect_err("expected rejection");
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let bad_subject = draft("Your {{next_steps}}", "Hello");
        let (status, _) = put_email_template(State(state), AdminUser(admin), Path("ready_to_book".into()), Json(bad_subject))
            .await
            .expect_err("expected rejection");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // Should not: accept training links that aren't web addresses.
    #[tokio::test]
    async fn rejects_invalid_links() {
        let state = test_state().await;
        let admin = user_with_role(true, true);
        insert_user(&state.db, &admin).await;

        let links = vec![TrainingLink { label: "Part A".into(), url: "javascript:alert(1)".into() }];
        let (status, _) = put_training_links(State(state), AdminUser(admin), Json(links))
            .await
            .expect_err("expected rejection");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
