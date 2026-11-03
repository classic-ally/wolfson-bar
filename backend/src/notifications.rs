use base64::Engine;
use sqlx::SqlitePool;
use tracing::{info, error};

use crate::email::{EmailAttachment, EmailService};
use crate::ical::{self, ShiftIcalParams};
use crate::slots::{shift_times, SLOT_TITLE_SQL};

#[derive(Debug, sqlx::FromRow)]
struct NotifiableUser {
    id: String,
    email: String,
}

#[derive(Debug, sqlx::FromRow)]
struct NotificationLogEntry {
    shift_date: String,
    slot: String,
    notification_type: String,
}

pub fn start_notification_worker(db: SqlitePool, email_service: EmailService, public_url: String) {
    tokio::spawn(async move {
        loop {
            // Calculate duration until next 8:00 AM Europe/London
            // Using a simple approach: check every hour, run if it's 8 AM
            let now = chrono::Utc::now();
            // Approximate London time (UTC+0 in winter, UTC+1 in summer)
            // For simplicity, target 8:00 UTC which is 8 AM GMT / 9 AM BST
            let target_hour = std::env::var("NOTIFICATION_HOUR")
                .ok()
                .and_then(|h| h.parse::<u32>().ok())
                .unwrap_or(8);

            let current_hour = now.format("%H").to_string().parse::<u32>().unwrap_or(0);
            let current_min = now.format("%M").to_string().parse::<u32>().unwrap_or(0);

            let hours_until = if current_hour < target_hour {
                target_hour - current_hour
            } else if current_hour == target_hour && current_min == 0 {
                0
            } else {
                24 - current_hour + target_hour
            };

            let minutes_until = if current_min > 0 && hours_until > 0 {
                (hours_until - 1) * 60 + (60 - current_min)
            } else {
                hours_until * 60
            };

            let sleep_duration = std::time::Duration::from_secs(minutes_until as u64 * 60);

            if sleep_duration.as_secs() > 0 {
                info!(
                    "Notification worker sleeping for {} hours {} minutes until next run",
                    minutes_until / 60,
                    minutes_until % 60
                );
                tokio::time::sleep(sleep_duration).await;
            }

            info!("Running daily shift notification job");
            if let Err(e) = send_shift_notifications(&db, &email_service, &public_url).await {
                error!("Shift notification job failed: {}", e);
            }

            if let Err(e) = send_induction_notifications(&db, &email_service).await {
                error!("Induction notification job failed: {}", e);
            }

            if let Err(e) = crate::membership_notifications::send_membership_emails(
                &db,
                &email_service,
                &public_url,
                chrono::Utc::now(),
            )
            .await
            {
                error!("Membership email job failed: {}", e);
            }

            // Sleep at least 1 hour to avoid running twice in the same hour
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });
}

async fn send_shift_notifications(
    db: &SqlitePool,
    email_service: &EmailService,
    _public_url: &str,
) -> Result<(), String> {
    // Get all users with email notifications enabled
    let users: Vec<NotifiableUser> = sqlx::query_as(
        "SELECT id, email FROM users WHERE email IS NOT NULL AND email_notifications_enabled = TRUE"
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch notifiable users: {}", e))?;

    info!("Processing notifications for {} users", users.len());

    for user in &users {
        if let Err(e) = process_user_notifications(db, email_service, user).await {
            error!("Failed to process notifications for user {}: {}", user.id, e);
        }
    }

    Ok(())
}

async fn process_user_notifications(
    db: &SqlitePool,
    email_service: &EmailService,
    user: &NotifiableUser,
) -> Result<(), String> {
    // Get current future signups
    let current_signups: Vec<(String, String, Option<String>)> = sqlx::query_as(&format!(
        "SELECT ss.shift_date, ss.slot, {SLOT_TITLE_SQL} as event_title
         FROM shift_signups ss
         WHERE ss.user_id = ? AND ss.shift_date >= date('now')"
    ))
    .bind(&user.id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch signups: {}", e))?;

    // Get notification log
    let log_entries: Vec<NotificationLogEntry> = sqlx::query_as(
        "SELECT shift_date, slot, notification_type FROM email_notification_log
         WHERE user_id = ? AND shift_date >= date('now')"
    )
    .bind(&user.id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch notification log: {}", e))?;

    // Keyed by (date, slot): a member can hold more than one shift on a split night.
    let signed_up: std::collections::HashSet<(&str, &str)> = current_signups
        .iter()
        .map(|(d, slot, _)| (d.as_str(), slot.as_str()))
        .collect();

    let log_map: std::collections::HashMap<(&str, &str), &str> = log_entries
        .iter()
        .map(|e| ((e.shift_date.as_str(), e.slot.as_str()), e.notification_type.as_str()))
        .collect();

    // Find shifts that need "added" notifications
    for (shift_date, slot, event_title) in &current_signups {
        let needs_notification = match log_map.get(&(shift_date.as_str(), slot.as_str())) {
            None => true,                          // No log entry yet
            Some(&"removed") => true,              // Was removed, now re-added
            Some(&"added") => false,               // Already notified
            _ => false,
        };

        if needs_notification {
            let (open_time, close_time) = get_shift_times(db, shift_date, slot).await?;

            let params = ShiftIcalParams {
                shift_date: shift_date.clone(),
                event_title: event_title.clone(),
                open_time: open_time.clone(),
                close_time: close_time.clone(),
                uid: ical::shift_uid(&user.id, shift_date, slot),
            };

            let ical_event = ical::create_shift_ical_event(&params)
                .map_err(|e| format!("Failed to create iCal event: {}", e))?;

            let mut cal = icalendar::Calendar::new();
            cal.push(ical_event);
            let ical_str = cal.to_string();
            let ical_base64 = base64::engine::general_purpose::STANDARD.encode(ical_str.as_bytes());

            let formatted_date = format_shift_date(shift_date);
            let title_part = event_title
                .as_deref()
                .map(|t| format!(" ({})", t))
                .unwrap_or_default();

            let subject = format!("Bar shift on {}{}", formatted_date, title_part);
            let html = format!(
                r#"<h2>You've been signed up for a bar shift</h2>
                <p><strong>Date:</strong> {}</p>
                <p><strong>Time:</strong> {} - {}</p>
                {}
                <p>An iCal file is attached so you can add this to your calendar.</p>"#,
                formatted_date,
                open_time,
                close_time,
                if let Some(title) = event_title {
                    format!("<p><strong>Event:</strong> {}</p>", escape_html(title))
                } else {
                    String::new()
                }
            );

            let attachment = EmailAttachment {
                filename: format!("shift-{}.ics", shift_date),
                content: ical_base64,
                content_type: "text/calendar".to_string(),
            };

            if let Err(e) = email_service.send_email(&user.email, &subject, &html, Some(attachment)).await {
                error!("Failed to send addition email to user {}: {}", user.id, e);
                continue;
            }

            // Update notification log
            upsert_notification_log(db, &user.id, shift_date, slot, "added").await?;
        }
    }

    // Find shifts that need "removed" notifications
    for entry in &log_entries {
        if entry.notification_type == "added"
            && !signed_up.contains(&(entry.shift_date.as_str(), entry.slot.as_str()))
        {
            let (open_time, close_time) = get_shift_times(db, &entry.shift_date, &entry.slot).await?;

            let params = ShiftIcalParams {
                shift_date: entry.shift_date.clone(),
                event_title: None,
                open_time,
                close_time,
                uid: ical::shift_uid(&user.id, &entry.shift_date, &entry.slot),
            };

            let cancel_ical = ical::create_cancel_ical(&params)
                .map_err(|e| format!("Failed to create cancel iCal: {}", e))?;
            let ical_base64 = base64::engine::general_purpose::STANDARD.encode(cancel_ical.as_bytes());

            let formatted_date = format_shift_date(&entry.shift_date);
            let subject = format!("Bar shift on {} cancelled", formatted_date);
            let html = format!(
                r#"<h2>Your bar shift has been cancelled</h2>
                <p>Your shift on <strong>{}</strong> has been removed.</p>
                <p>An iCal cancellation file is attached to remove this from your calendar.</p>"#,
                formatted_date
            );

            let attachment = EmailAttachment {
                filename: format!("cancel-shift-{}.ics", entry.shift_date),
                content: ical_base64,
                content_type: "text/calendar".to_string(),
            };

            if let Err(e) = email_service.send_email(&user.email, &subject, &html, Some(attachment)).await {
                error!("Failed to send removal email to user {}: {}", user.id, e);
                continue;
            }

            upsert_notification_log(db, &user.id, &entry.shift_date, &entry.slot, "removed").await?;
        }
    }

    Ok(())
}

async fn get_shift_times(db: &SqlitePool, shift_date: &str, slot: &str) -> Result<(String, String), String> {
    let mut conn = db.acquire().await.map_err(|e| format!("Failed to get shift times: {}", e))?;
    shift_times(&mut conn, shift_date, slot)
        .await
        .map_err(|e| format!("Failed to get shift times: {}", e))?
        .ok_or_else(|| format!("No opening hours for {}", shift_date))
}

async fn upsert_notification_log(
    db: &SqlitePool,
    user_id: &str,
    shift_date: &str,
    slot: &str,
    notification_type: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO email_notification_log (user_id, shift_date, slot, notification_type, sent_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, shift_date, slot) DO UPDATE SET
             notification_type = excluded.notification_type,
             sent_at = excluded.sent_at"
    )
    .bind(user_id)
    .bind(shift_date)
    .bind(slot)
    .bind(notification_type)
    .execute(db)
    .await
    .map_err(|e| format!("Failed to update notification log: {}", e))?;

    Ok(())
}

/// Escape text for an HTML email body.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn format_shift_date(date_str: &str) -> String {
    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map(|d| d.format("%A, %e %B %Y").to_string())
        .unwrap_or_else(|_| date_str.to_string())
}

// ===== Induction Notifications =====

async fn send_induction_notifications(
    db: &SqlitePool,
    email_service: &EmailService,
) -> Result<(), String> {
    // Get all committee members with induction availability on future dates
    #[derive(sqlx::FromRow)]
    struct InductionAvail {
        shift_date: String,
        committee_user_id: String,
    }

    let availability: Vec<InductionAvail> = sqlx::query_as(
        "SELECT ia.shift_date, ia.committee_user_id
         FROM induction_availability ia
         WHERE ia.shift_date >= date('now')
         ORDER BY ia.shift_date"
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch induction availability: {}", e))?;

    if availability.is_empty() {
        return Ok(());
    }

    // Get inductee counts per date
    #[derive(sqlx::FromRow)]
    struct InducteeCount {
        shift_date: String,
        count: i64,
    }

    let inductee_counts: Vec<InducteeCount> = sqlx::query_as(
        "SELECT shift_date, COUNT(*) as count FROM induction_signups
         WHERE shift_date >= date('now') GROUP BY shift_date"
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let count_map: std::collections::HashMap<String, i64> = inductee_counts
        .into_iter()
        .map(|c| (c.shift_date, c.count))
        .collect();

    // Get existing notification log entries
    #[derive(sqlx::FromRow)]
    struct InductionLogEntry {
        recipient_id: String,
        shift_date: String,
        notification_type: String,
    }

    let log_entries: Vec<InductionLogEntry> = sqlx::query_as(
        "SELECT recipient_id, shift_date, notification_type FROM induction_notification_log
         WHERE shift_date >= date('now')"
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let log_set: std::collections::HashSet<(String, String, String)> = log_entries
        .into_iter()
        .map(|e| (e.recipient_id, e.shift_date, e.notification_type))
        .collect();

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    for avail in &availability {
        let inductee_count = count_map.get(&avail.shift_date).copied().unwrap_or(0);

        // Get committee member's email
        let committee_email: Option<(String,)> = sqlx::query_as(
            "SELECT email FROM users WHERE id = ? AND email IS NOT NULL AND email_notifications_enabled = TRUE"
        )
        .bind(&avail.committee_user_id)
        .fetch_optional(db)
        .await
        .unwrap_or(None);

        let Some((email,)) = committee_email else { continue };

        // Notify committee member when inductees sign up (transition from 0 -> N)
        if inductee_count > 0 {
            let already_notified = log_set.contains(&(
                avail.committee_user_id.clone(),
                avail.shift_date.clone(),
                "induction_signup".to_string(),
            ));

            if !already_notified {
                let formatted_date = format_shift_date(&avail.shift_date);
                let subject = format!("Induction scheduled for {}", formatted_date);
                let html = format!(
                    r#"<h2>Induction Session Scheduled</h2>
                    <p>{} inductee(s) have signed up for your induction session on <strong>{}</strong>.</p>
                    <p><strong>Time:</strong> 7:45 – 8:30</p>"#,
                    inductee_count, formatted_date
                );

                if let Err(e) = email_service.send_email(&email, &subject, &html, None).await {
                    error!("Failed to send induction signup notification: {}", e);
                    continue;
                }

                upsert_induction_log(db, &avail.committee_user_id, &avail.shift_date, "induction_signup").await?;
            }
        }

        // Notify if all inductees cancelled (transition from N -> 0)
        if inductee_count == 0 {
            let was_notified_signup = log_set.contains(&(
                avail.committee_user_id.clone(),
                avail.shift_date.clone(),
                "induction_signup".to_string(),
            ));
            let already_cancelled = log_set.contains(&(
                avail.committee_user_id.clone(),
                avail.shift_date.clone(),
                "induction_cancelled".to_string(),
            ));

            if was_notified_signup && !already_cancelled {
                let formatted_date = format_shift_date(&avail.shift_date);
                let subject = format!("Induction cancelled for {}", formatted_date);
                let html = format!(
                    r#"<h2>Induction Session Cancelled</h2>
                    <p>All inductees have cancelled for your induction session on <strong>{}</strong>. No need to arrive early.</p>"#,
                    formatted_date
                );

                if let Err(e) = email_service.send_email(&email, &subject, &html, None).await {
                    error!("Failed to send induction cancellation notification: {}", e);
                    continue;
                }

                upsert_induction_log(db, &avail.committee_user_id, &avail.shift_date, "induction_cancelled").await?;
            }
        }

        // Day-of reminders
        if avail.shift_date == today && inductee_count > 0 {
            // Committee member day-of reminder
            let already_reminded = log_set.contains(&(
                avail.committee_user_id.clone(),
                avail.shift_date.clone(),
                "induction_day_committee".to_string(),
            ));

            if !already_reminded {
                let subject = "Induction today at 7:45".to_string();
                let html = format!(
                    r#"<h2>Induction Today</h2>
                    <p>You have an induction session today at <strong>7:45</strong> with {} inductee(s).</p>
                    <p>Please arrive by 7:40 to set up.</p>"#,
                    inductee_count
                );

                if let Err(e) = email_service.send_email(&email, &subject, &html, None).await {
                    error!("Failed to send committee day-of induction reminder: {}", e);
                } else {
                    upsert_induction_log(db, &avail.committee_user_id, &avail.shift_date, "induction_day_committee").await?;
                }
            }

            // Inductee day-of reminders
            let inductees: Vec<NotifiableUser> = sqlx::query_as(
                "SELECT u.id, u.email FROM induction_signups is2
                 JOIN users u ON is2.user_id = u.id
                 WHERE is2.shift_date = ? AND u.email IS NOT NULL AND u.email_notifications_enabled = TRUE"
            )
            .bind(&avail.shift_date)
            .fetch_all(db)
            .await
            .unwrap_or_default();

            for inductee in &inductees {
                let already_reminded = log_set.contains(&(
                    inductee.id.clone(),
                    avail.shift_date.clone(),
                    "induction_day_inductee".to_string(),
                ));

                if !already_reminded {
                    let subject = "Your induction is today at 7:45".to_string();
                    let html = r#"<h2>Induction Today</h2>
                        <p>Your bar induction session is today at <strong>7:45</strong> at Wolfson College.</p>
                        <p>Please arrive on time. The session runs from 7:45 to 8:30.</p>"#.to_string();

                    if let Err(e) = email_service.send_email(&inductee.email, &subject, &html, None).await {
                        error!("Failed to send inductee day-of reminder: {}", e);
                    } else {
                        upsert_induction_log(db, &inductee.id, &avail.shift_date, "induction_day_inductee").await?;
                    }
                }
            }
        }
    }

    Ok(())
}

async fn upsert_induction_log(
    db: &SqlitePool,
    recipient_id: &str,
    shift_date: &str,
    notification_type: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO induction_notification_log (recipient_id, shift_date, notification_type, sent_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(recipient_id, shift_date, notification_type) DO UPDATE SET
             sent_at = excluded.sent_at"
    )
    .bind(recipient_id)
    .bind(shift_date)
    .bind(notification_type)
    .execute(db)
    .await
    .map_err(|e| format!("Failed to update induction notification log: {}", e))?;

    Ok(())
}
