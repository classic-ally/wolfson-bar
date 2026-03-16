use base64::Engine;
use sqlx::SqlitePool;
use tracing::{info, error};

use crate::email::{EmailAttachment, EmailService};
use crate::ical::{self, ShiftIcalParams};

#[derive(Debug, sqlx::FromRow)]
struct NotifiableUser {
    id: String,
    email: String,
}

#[derive(Debug, sqlx::FromRow)]
struct BarHours {
    open_time: String,
    close_time: String,
}

#[derive(Debug, sqlx::FromRow)]
struct NotificationLogEntry {
    shift_date: String,
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
                error!("Notification job failed: {}", e);
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
    let current_signups: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT s.shift_date,
                (SELECT title FROM events WHERE event_date = s.shift_date) as event_title
         FROM shift_signups s
         WHERE s.user_id = ? AND s.shift_date >= date('now')"
    )
    .bind(&user.id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch signups: {}", e))?;

    // Get notification log
    let log_entries: Vec<NotificationLogEntry> = sqlx::query_as(
        "SELECT shift_date, notification_type FROM email_notification_log
         WHERE user_id = ? AND shift_date >= date('now')"
    )
    .bind(&user.id)
    .fetch_all(db)
    .await
    .map_err(|e| format!("Failed to fetch notification log: {}", e))?;

    let signup_dates: std::collections::HashSet<&str> = current_signups
        .iter()
        .map(|(d, _)| d.as_str())
        .collect();

    let log_map: std::collections::HashMap<&str, &str> = log_entries
        .iter()
        .map(|e| (e.shift_date.as_str(), e.notification_type.as_str()))
        .collect();

    // Find shifts that need "added" notifications
    for (shift_date, event_title) in &current_signups {
        let needs_notification = match log_map.get(shift_date.as_str()) {
            None => true,                          // No log entry yet
            Some(&"removed") => true,              // Was removed, now re-added
            Some(&"added") => false,               // Already notified
            _ => false,
        };

        if needs_notification {
            // Get bar hours for this day
            let bar_hours = get_bar_hours_for_shift(db, shift_date).await?;

            let params = ShiftIcalParams {
                shift_date: shift_date.clone(),
                event_title: event_title.clone(),
                open_time: bar_hours.open_time.clone(),
                close_time: bar_hours.close_time.clone(),
                uid: ical::shift_uid(&user.id, shift_date),
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
                bar_hours.open_time,
                bar_hours.close_time,
                if let Some(title) = event_title {
                    format!("<p><strong>Event:</strong> {}</p>", title)
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
                error!("Failed to send addition email to {}: {}", user.email, e);
                continue;
            }

            // Update notification log
            upsert_notification_log(db, &user.id, shift_date, "added").await?;
        }
    }

    // Find shifts that need "removed" notifications
    for entry in &log_entries {
        if entry.notification_type == "added" && !signup_dates.contains(entry.shift_date.as_str()) {
            let bar_hours = get_bar_hours_for_shift(db, &entry.shift_date).await?;

            let params = ShiftIcalParams {
                shift_date: entry.shift_date.clone(),
                event_title: None,
                open_time: bar_hours.open_time,
                close_time: bar_hours.close_time,
                uid: ical::shift_uid(&user.id, &entry.shift_date),
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
                error!("Failed to send removal email to {}: {}", user.email, e);
                continue;
            }

            upsert_notification_log(db, &user.id, &entry.shift_date, "removed").await?;
        }
    }

    Ok(())
}

async fn get_bar_hours_for_shift(db: &SqlitePool, shift_date: &str) -> Result<BarHours, String> {
    let date = chrono::NaiveDate::parse_from_str(shift_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date: {}", e))?;

    let day_of_week = date.format("%w").to_string().parse::<i32>().unwrap_or(0);

    sqlx::query_as::<_, BarHours>(
        "SELECT open_time, close_time FROM bar_hours WHERE day_of_week = ?"
    )
    .bind(day_of_week)
    .fetch_one(db)
    .await
    .map_err(|e| format!("Failed to get bar hours: {}", e))
}

async fn upsert_notification_log(
    db: &SqlitePool,
    user_id: &str,
    shift_date: &str,
    notification_type: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO email_notification_log (user_id, shift_date, notification_type, sent_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, shift_date) DO UPDATE SET
             notification_type = excluded.notification_type,
             sent_at = excluded.sent_at"
    )
    .bind(user_id)
    .bind(shift_date)
    .bind(notification_type)
    .execute(db)
    .await
    .map_err(|e| format!("Failed to update notification log: {}", e))?;

    Ok(())
}

fn format_shift_date(date_str: &str) -> String {
    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map(|d| d.format("%A, %e %B %Y").to_string())
        .unwrap_or_else(|_| date_str.to_string())
}
