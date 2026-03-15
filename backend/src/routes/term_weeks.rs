use axum::http::StatusCode;
use axum::Json;
use icalendar::Component;
use serde::Serialize;
use std::sync::OnceLock;
use tokio::sync::RwLock;

static CACHE: OnceLock<RwLock<Option<Vec<TermWeek>>>> = OnceLock::new();

#[derive(Serialize, Clone)]
pub struct TermWeek {
    pub summary: String,
    pub start_date: String,
    pub end_date: String,
}

pub async fn get_term_weeks() -> Result<Json<Vec<TermWeek>>, (StatusCode, String)> {
    let lock = CACHE.get_or_init(|| RwLock::new(None));

    // Return cached data if available
    {
        let cached = lock.read().await;
        if let Some(ref data) = *cached {
            return Ok(Json(data.clone()));
        }
    }

    // Fetch and parse
    let weeks = fetch_and_parse().await.map_err(|e| {
        tracing::error!("Failed to fetch term weeks: {}", e);
        (StatusCode::BAD_GATEWAY, format!("Failed to fetch term dates: {}", e))
    })?;

    // Cache it
    {
        let mut cached = lock.write().await;
        *cached = Some(weeks.clone());
    }

    Ok(Json(weeks))
}

async fn fetch_and_parse() -> Result<Vec<TermWeek>, String> {
    let body = reqwest::get("https://www.wolfson.ox.ac.uk/oxdate.ics")
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let calendar: icalendar::Calendar = body.parse().map_err(|e: String| e)?;

    let mut weeks = Vec::new();

    for component in calendar.iter() {
        if let Some(event) = component.as_event() {
            let summary = match event.get_summary() {
                Some(s) => s.to_string(),
                None => continue,
            };

            let start = match event.property_value("DTSTART") {
                Some(s) => format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]),
                None => continue,
            };

            let end = match event.property_value("DTEND") {
                Some(s) => format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]),
                None => continue,
            };

            weeks.push(TermWeek {
                summary,
                start_date: start,
                end_date: end,
            });
        }
    }

    weeks.sort_by(|a, b| a.start_date.cmp(&b.start_date));

    Ok(weeks)
}
