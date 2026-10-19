//! The daily membership emails: onboarding prompts as members move through
//! induction, and Code of Conduct re-sign requests. Each email goes out at
//! most once per member, tracked in `membership_email_log`.

use std::collections::HashSet;
use std::future::Future;

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use sqlx::SqlitePool;
use tracing::{error, info};

use crate::email::EmailService;
use crate::membership_email::{render, Context, Progress, TemplateKey, TrainingLink};
use crate::models::User;
use crate::routes::coc::{current_coc_version, format_ts};
use crate::routes::membership::{load_links, load_settings, load_template, OnboardingSettings};

/// Sends one email. Implemented by the real email service and by tests.
pub trait Mailer {
    fn send(&self, to: &str, subject: &str, html: &str) -> impl Future<Output = Result<(), String>> + Send;
}

impl Mailer for EmailService {
    fn send(&self, to: &str, subject: &str, html: &str) -> impl Future<Output = Result<(), String>> + Send {
        self.send_email(to, subject, html, None)
    }
}

fn parse_ts(ts: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S").ok().map(|t| t.and_utc())
}

/// The onboarding email due for a member, plus earlier-stage emails it
/// supersedes (logged as skipped so they never arrive out of order later).
fn onboarding_email_due(
    user: &User,
    logged: &HashSet<&str>,
    settings: &OnboardingSettings,
    now: DateTime<Utc>,
) -> Option<(TemplateKey, &'static [TemplateKey])> {
    let inducted_at = user.induction_completed_at.as_deref().and_then(parse_ts);
    // Members inducted before timestamps were recorded have no undo window to wait out.
    let settled = inducted_at
        .map(|t| t <= now - Duration::hours(settings.post_induction_delay_hours))
        .unwrap_or(true);
    if !user.induction_completed || !settled {
        return None;
    }
    let has = |key: TemplateKey| logged.contains(key.as_str());

    if user.is_rota_member() {
        return (!has(TemplateKey::WelcomeToRota))
            .then_some((TemplateKey::WelcomeToRota, &[TemplateKey::PostInduction, TemplateKey::ReadyToBook]));
    }
    if user.can_signup_for_shifts() {
        return (!has(TemplateKey::ReadyToBook)).then_some((TemplateKey::ReadyToBook, &[TemplateKey::PostInduction]));
    }
    let inducted_at = inducted_at?;
    if !has(TemplateKey::PostInduction) {
        return Some((TemplateKey::PostInduction, &[]));
    }
    let stuck_after = Duration::days(settings.stuck_reminder_days?);
    (inducted_at <= now - stuck_after && !has(TemplateKey::StuckReminder)).then_some((TemplateKey::StuckReminder, &[]))
}

async fn log_email(
    db: &SqlitePool,
    user_id: &str,
    email_key: &str,
    outcome: &str,
    sent_by: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO membership_email_log (user_id, email_key, outcome, sent_at, sent_by) VALUES (?, ?, ?, ?, ?)")
        .bind(user_id)
        .bind(email_key)
        .bind(outcome)
        .bind(format_ts(now))
        .bind(sent_by)
        .execute(db)
        .await?;
    Ok(())
}

pub struct Delivery<'a> {
    pub user: &'a User,
    pub key: TemplateKey,
    /// What the log records: the template key, plus the version for CoC emails.
    pub log_key: String,
    /// Committee member sending it by hand.
    pub sent_by: Option<&'a str>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    /// Membership emails are off for this member, or they have no address.
    OptedOut,
}

/// Send one membership email to a member, or log it as skipped if they've
/// opted out. A failed send isn't logged, so the worker retries it next run.
pub async fn deliver<M: Mailer>(
    db: &SqlitePool,
    mailer: &M,
    public_url: &str,
    links: &[TrainingLink],
    delivery: Delivery<'_>,
    now: DateTime<Utc>,
) -> Result<Outcome, String> {
    let user = delivery.user;
    let to = user.email.as_deref().filter(|_| user.email_membership);
    let outcome = match to {
        Some(to) => {
            let (subject, body) = load_template(db, delivery.key).await.map_err(|e| e.to_string())?;
            let name = user.display_name.as_deref().unwrap_or("there");
            let ctx = Context { name, progress: Progress::of(user), links, public_url };
            let (subject, html) = render(&subject, &body, &ctx);
            mailer.send(to, &subject, &html).await?;
            Outcome::Sent
        }
        None => Outcome::OptedOut,
    };
    let label = if outcome == Outcome::Sent { "sent" } else { "skipped" };
    log_email(db, &user.id, &delivery.log_key, label, delivery.sent_by, now)
        .await
        .map_err(|e| e.to_string())?;
    Ok(outcome)
}

/// One pass of the daily job.
pub async fn send_membership_emails<M: Mailer>(
    db: &SqlitePool,
    mailer: &M,
    public_url: &str,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let settings = load_settings(db).await.map_err(|e| e.to_string())?;
    let links = load_links(db).await.map_err(|e| e.to_string())?;
    let coc_version = current_coc_version(db).await.map_err(|e| e.to_string())?;
    let users: Vec<User> = sqlx::query_as("SELECT * FROM users").fetch_all(db).await.map_err(|e| e.to_string())?;
    let logged: Vec<(String, String)> = sqlx::query_as("SELECT DISTINCT user_id, email_key FROM membership_email_log")
        .fetch_all(db)
        .await
        .map_err(|e| e.to_string())?;

    let coc_key = format!("coc_resign:v{coc_version}");
    let mut sent = 0;
    for user in &users {
        let user_logged: HashSet<&str> =
            logged.iter().filter(|(id, _)| *id == user.id).map(|(_, key)| key.as_str()).collect();

        let mut due = Vec::new();
        if let Some((key, superseded)) = onboarding_email_due(user, &user_logged, &settings, now) {
            due.push((key, key.as_str().to_string(), superseded));
        }
        if Progress::of(user).coc_resign && !user_logged.contains(coc_key.as_str()) {
            due.push((TemplateKey::CocResign, coc_key.clone(), &[]));
        }

        for (key, log_key, superseded) in due {
            let delivery = Delivery { user, key, log_key, sent_by: None };
            match deliver(db, mailer, public_url, &links, delivery, now).await {
                Ok(outcome) => {
                    sent += usize::from(outcome == Outcome::Sent);
                    for earlier in superseded.iter().filter(|k| !user_logged.contains(k.as_str())) {
                        log_email(db, &user.id, earlier.as_str(), "skipped", None, now)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                }
                Err(e) => error!("Failed to send {} email to user {}: {}", key.as_str(), user.id, e),
            }
        }
    }
    info!("Sent {} membership emails", sent);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{insert_user, london, test_state, user_with};
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingMailer {
        sent: Mutex<Vec<(String, String)>>,
        fail: bool,
    }

    impl Mailer for RecordingMailer {
        fn send(&self, to: &str, subject: &str, _html: &str) -> impl Future<Output = Result<(), String>> + Send {
            let result = if self.fail {
                Err("provider down".to_string())
            } else {
                self.sent.lock().unwrap().push((to.to_string(), subject.to_string()));
                Ok(())
            };
            async move { result }
        }
    }

    impl RecordingMailer {
        fn subjects(&self) -> Vec<String> {
            self.sent.lock().unwrap().iter().map(|(_, s)| s.clone()).collect()
        }
    }

    /// Insert a member with an address and Membership emails on, inducted at `inducted_at`.
    async fn member(db: &SqlitePool, user: &User, inducted_at: Option<&str>) {
        insert_user(db, user).await;
        sqlx::query(
            "UPDATE users SET email = ?, email_membership = TRUE, induction_completed_at = ? WHERE id = ?",
        )
        .bind(format!("{}@example.test", user.id))
        .bind(inducted_at)
        .bind(&user.id)
        .execute(db)
        .await
        .unwrap();
    }

    async fn run(db: &SqlitePool, mailer: &RecordingMailer, now: DateTime<Utc>) {
        send_membership_emails(db, mailer, "https://bar.example", now).await.unwrap();
    }

    // Impact: the delay is the window to undo a mistaken induction before
    // the member hears about it.
    // Should: send the post-induction email once the delay has passed.
    // Should not: send it before the delay, or more than once.
    #[tokio::test]
    async fn post_induction_waits_for_delay_then_sends_once() {
        let state = test_state().await;
        let user = user_with(true, false, false, false);
        member(&state.db, &user, Some("2026-06-17 18:50:00")).await;
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 0, 0)).await;
        assert!(mailer.subjects().is_empty());

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        run(&state.db, &mailer, london(2026, 6, 19, 9, 0)).await;
        assert_eq!(mailer.subjects(), vec!["Post Induction Formalities"]);
    }

    // Should not: email members inducted before induction times were recorded.
    #[tokio::test]
    async fn no_post_induction_email_without_timestamp() {
        let state = test_state().await;
        let user = user_with(true, false, false, false);
        member(&state.db, &user, None).await;
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        assert!(mailer.subjects().is_empty());
    }

    // Impact: a member who opts out and back in later shouldn't receive a
    // backlog of stale onboarding emails.
    // Should not: email members with Membership emails off, now or after they opt back in.
    #[tokio::test]
    async fn opted_out_emails_are_skipped_for_good() {
        let state = test_state().await;
        let user = user_with(true, false, false, false);
        member(&state.db, &user, Some("2026-06-17 18:50:00")).await;
        sqlx::query("UPDATE users SET email_membership = FALSE").execute(&state.db).await.unwrap();
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        sqlx::query("UPDATE users SET email_membership = TRUE").execute(&state.db).await.unwrap();
        run(&state.db, &mailer, london(2026, 6, 19, 9, 0)).await;

        assert!(mailer.subjects().is_empty());
    }

    // Should: send only the welcome email to someone who finished every step at once.
    // Should not: send the earlier-stage emails afterwards.
    #[tokio::test]
    async fn welcome_supersedes_earlier_emails() {
        let state = test_state().await;
        let user = user_with(true, true, true, true);
        member(&state.db, &user, Some("2026-06-17 18:50:00")).await;
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        run(&state.db, &mailer, london(2026, 6, 19, 9, 0)).await;

        assert_eq!(mailer.subjects(), vec!["Welcome to the bar rota!"]);
    }

    // Should: tell a member who can book, but hasn't done their supervised shift, that they're ready.
    #[tokio::test]
    async fn ready_to_book_once_signup_unlocked() {
        let state = test_state().await;
        let user = user_with(true, true, true, false);
        member(&state.db, &user, Some("2026-06-10 18:50:00")).await;
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;

        assert_eq!(mailer.subjects(), vec!["You're ready to book your first bar shift"]);
    }

    // Should: remind a member still missing steps once the configured days have passed, once.
    // Should not: send the automatic reminder when it's turned off.
    #[tokio::test]
    async fn stuck_reminder_follows_settings() {
        let state = test_state().await;
        let user = user_with(true, false, false, false);
        member(&state.db, &user, Some("2026-06-17 18:50:00")).await;
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await; // post-induction
        run(&state.db, &mailer, london(2026, 6, 23, 9, 0)).await; // 6 days: too soon
        run(&state.db, &mailer, london(2026, 6, 25, 9, 0)).await;
        run(&state.db, &mailer, london(2026, 6, 26, 9, 0)).await;
        assert_eq!(
            mailer.subjects(),
            vec!["Post Induction Formalities", "A reminder to finish your bar onboarding"]
        );

        let other = user_with(true, false, false, false);
        member(&state.db, &other, Some("2026-06-17 18:50:00")).await;
        sqlx::query("UPDATE onboarding_settings SET stuck_reminder_days = NULL").execute(&state.db).await.unwrap();
        let mailer = RecordingMailer::default();
        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        run(&state.db, &mailer, london(2026, 7, 30, 9, 0)).await;
        assert_eq!(mailer.subjects(), vec!["Post Induction Formalities"]);
    }

    // Should: ask members who signed an earlier Code of Conduct to re-sign a new version, once per version.
    // Should not: email members who have never signed one.
    #[tokio::test]
    async fn coc_resign_once_per_version() {
        let state = test_state().await;
        let signed = user_with(true, true, true, true);
        let never = user_with(false, false, false, false);
        member(&state.db, &signed, None).await;
        member(&state.db, &never, None).await;
        // Already welcomed, so only the CoC email is in play.
        log_email(&state.db, &signed.id, "welcome_to_rota", "backfilled", None, london(2026, 6, 1, 9, 0)).await.unwrap();
        sqlx::query("INSERT INTO coc_versions (version, body) VALUES (2, 'v2')").execute(&state.db).await.unwrap();
        sqlx::query("UPDATE users SET code_of_conduct_signed = FALSE").execute(&state.db).await.unwrap();
        let mailer = RecordingMailer::default();

        run(&state.db, &mailer, london(2026, 6, 18, 9, 0)).await;
        run(&state.db, &mailer, london(2026, 6, 19, 9, 0)).await;

        assert_eq!(
            *mailer.sent.lock().unwrap(),
            vec![(format!("{}@example.test", signed.id), "Please re-sign the updated Code of Conduct".to_string())]
        );
    }

    // Should: retry an email whose send failed on the next run.
    #[tokio::test]
    async fn failed_sends_are_retried() {
        let state = test_state().await;
        let user = user_with(true, false, false, false);
        member(&state.db, &user, Some("2026-06-17 18:50:00")).await;

        let failing = RecordingMailer { fail: true, ..Default::default() };
        run(&state.db, &failing, london(2026, 6, 18, 9, 0)).await;
        let mailer = RecordingMailer::default();
        run(&state.db, &mailer, london(2026, 6, 19, 9, 0)).await;

        assert_eq!(mailer.subjects(), vec!["Post Induction Formalities"]);
    }

    // Impact: deploying this must not email the whole existing rota.
    // Should not: send ready, welcome or re-sign emails to members already past
    // those stages when the email log was created.
    #[tokio::test]
    async fn backfill_spares_existing_members() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect("sqlite:file:membership_backfill_018_test?mode=memory&cache=shared")
            .await
            .unwrap();
        for (_, sql, _) in crate::db::MIGRATIONS.iter().take_while(|(name, ..)| *name != "018_membership_email_log") {
            let _ = sqlx::query(sql).execute(&db).await;
        }
        let rota = user_with(true, true, true, true);
        let ready = user_with(true, true, true, false);
        member(&db, &rota, None).await;
        member(&db, &ready, None).await;
        crate::db::run_migrations(&db).await;

        let mailer = RecordingMailer::default();
        run(&db, &mailer, london(2026, 6, 18, 9, 0)).await;

        assert!(mailer.subjects().is_empty());
    }
}
