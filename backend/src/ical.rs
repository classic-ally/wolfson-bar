use chrono::NaiveDate;
use icalendar::{Calendar, Component, Event as IcalEvent, EventLike};

pub struct ShiftIcalParams {
    pub shift_date: String,
    pub event_title: Option<String>,
    pub open_time: String,
    pub close_time: String,
    pub uid: String,
}

/// Create an iCal event for a shift
pub fn create_shift_ical_event(params: &ShiftIcalParams) -> Result<IcalEvent, String> {
    let date = NaiveDate::parse_from_str(&params.shift_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;

    let start_parts: Vec<&str> = params.open_time.split(':').collect();
    let end_parts: Vec<&str> = params.close_time.split(':').collect();

    if start_parts.len() != 2 || end_parts.len() != 2 {
        return Err("Invalid time format".to_string());
    }

    let start_hour: u32 = start_parts[0].parse().map_err(|_| "Invalid start hour")?;
    let start_min: u32 = start_parts[1].parse().map_err(|_| "Invalid start minute")?;
    let end_hour: u32 = end_parts[0].parse().map_err(|_| "Invalid end hour")?;
    let end_min: u32 = end_parts[1].parse().map_err(|_| "Invalid end minute")?;

    let start_datetime = date
        .and_hms_opt(start_hour, start_min, 0)
        .ok_or("Invalid start datetime")?;

    let end_datetime = if end_hour < start_hour {
        let next_day = date.succ_opt().ok_or("Invalid end date")?;
        next_day
            .and_hms_opt(end_hour, end_min, 0)
            .ok_or("Invalid end datetime")?
    } else {
        date.and_hms_opt(end_hour, end_min, 0)
            .ok_or("Invalid end datetime")?
    };

    let title = if let Some(ref event) = params.event_title {
        format!("Bar Shift - {}", event)
    } else {
        "Bar Shift".to_string()
    };

    let mut ical_event = IcalEvent::new();
    ical_event
        .summary(&title)
        .starts(start_datetime)
        .ends(end_datetime)
        .location("Wolfson College, Linton Road, Oxford OX2 6UD, UK")
        .uid(&params.uid);

    Ok(ical_event.done())
}

/// Create a cancellation iCal calendar with METHOD:CANCEL
pub fn create_cancel_ical(params: &ShiftIcalParams) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(&params.shift_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;

    let start_parts: Vec<&str> = params.open_time.split(':').collect();
    if start_parts.len() != 2 {
        return Err("Invalid time format".to_string());
    }

    let start_hour: u32 = start_parts[0].parse().map_err(|_| "Invalid start hour")?;
    let start_min: u32 = start_parts[1].parse().map_err(|_| "Invalid start minute")?;

    let start_datetime = date
        .and_hms_opt(start_hour, start_min, 0)
        .ok_or("Invalid start datetime")?;

    let title = if let Some(ref event) = params.event_title {
        format!("Bar Shift - {}", event)
    } else {
        "Bar Shift".to_string()
    };

    // Build cancel iCal manually since icalendar crate doesn't support METHOD directly
    let mut cal = Calendar::new();
    let mut ical_event = IcalEvent::new();
    ical_event
        .summary(&title)
        .starts(start_datetime)
        .uid(&params.uid);
    ical_event.append_property(icalendar::Property::new("STATUS", "CANCELLED"));
    cal.push(ical_event.done());

    let mut cal_str = cal.to_string();
    // Insert METHOD:CANCEL after BEGIN:VCALENDAR
    cal_str = cal_str.replace(
        "BEGIN:VCALENDAR",
        "BEGIN:VCALENDAR\r\nMETHOD:CANCEL",
    );

    Ok(cal_str)
}

/// Generate a deterministic UID for a shift
pub fn shift_uid(user_id: &str, shift_date: &str) -> String {
    format!("wolfson-bar-shift-{}-{}", user_id, shift_date)
}
