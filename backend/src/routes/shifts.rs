use axum::{
    extract::{State, Path, Query},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use chrono::Datelike;
use sqlx::SqliteConnection;
use tracing::{info, error};
use ts_rs::TS;

use crate::auth::{AuthenticatedUser, CommitteeUser};
use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;
use crate::slots::{build_slots, events_on, load_slots, Slot, REGULAR_SLOT};

#[derive(Debug, Deserialize)]
pub struct ShiftsQuery {
    pub start_date: String,
    pub end_date: String,
}

/// Which of a night's shifts a request is about. Omitted means the regular
/// shift, which is the only one on most nights.
#[derive(Debug, Default, Deserialize)]
pub struct SlotQuery {
    #[serde(default)]
    pub slot: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShiftSignupUser {
    pub user_id: String,
    pub display_name: Option<String>,
    pub is_committee: bool,
    /// Whether this member still has to re-sign the Code of Conduct before they
    /// can check in. Only sent to committee viewers; `None` for everyone else.
    #[ts(optional = nullable)]
    pub needs_coc: Option<bool>,
}

/// One shift on a night. Most nights have a single shift; nights with events
/// staffed separately have one per such event (see `crate::slots`).
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShiftInfo {
    pub date: String,
    /// `""` for the night's regular shift, otherwise the separately-staffed event's id.
    pub slot: String,
    pub event_title: Option<String>,
    pub event_description: Option<String>,
    pub max_volunteers: i32,
    pub requires_contract: bool,
    pub signups_count: i32,
    pub signups: Vec<ShiftSignupUser>,
    pub open_time: Option<String>,
    pub close_time: Option<String>,
    pub has_induction_availability: bool,
    pub induction_signups_count: i32,
    pub current_user_induction_available: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserShift {
    pub date: String,
    pub slot: String,
    pub event_title: Option<String>,
    pub open_time: Option<String>,
    pub close_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkippedShift {
    pub slot: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WholeNightSignup {
    /// Slots the member was booked onto.
    pub booked: Vec<String>,
    /// Slots left out, e.g. because they were full or already booked.
    pub skipped: Vec<SkippedShift>,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

const ALREADY_SIGNED_UP: &str = "You are already signed up for this shift";

fn reject(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(ErrorResponse { error: msg.to_string() }))
}

fn internal(context: &'static str) -> impl Fn(sqlx::Error) -> ApiError {
    move |e| {
        error!("❌ {}: {}", context, e);
        reject(StatusCode::INTERNAL_SERVER_ERROR, context)
    }
}

fn parse_date(date: &str) -> Result<chrono::NaiveDate, ApiError> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| reject(StatusCode::BAD_REQUEST, "Invalid date format"))
}

/// The shift `key` on the night starting `date`, or 404.
async fn find_slot(conn: &mut SqliteConnection, date: &str, key: &str) -> Result<Slot, ApiError> {
    load_slots(conn, date)
        .await
        .map_err(internal("Failed to fetch shifts"))?
        .into_iter()
        .find(|s| s.key == key)
        .ok_or_else(|| reject(StatusCode::NOT_FOUND, "No such shift on this date"))
}

/// Who is taking a shift, as far as its staffing rules are concerned.
struct Volunteer {
    has_contract: bool,
    /// Still needs their supervised shift, so a committee member must be on it.
    needs_supervision: bool,
}

impl Volunteer {
    fn member(user: &User) -> Self {
        Self {
            has_contract: user.has_contract,
            needs_supervision: !user.supervised_shift_completed,
        }
    }
}

/// Check a shift's staffing rules: supervision, contract and capacity.
async fn check_can_take(
    conn: &mut SqliteConnection,
    date: &str,
    slot: &Slot,
    volunteer: &Volunteer,
) -> Result<(), ApiError> {
    if volunteer.needs_supervision {
        let committee_count: i32 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM shift_signups ss
             JOIN users u ON ss.user_id = u.id
             WHERE ss.shift_date = ? AND ss.slot = ? AND u.is_committee = 1"
        )
        .bind(date)
        .bind(&slot.key)
        .fetch_one(&mut *conn)
        .await
        .map_err(internal("Failed to check shift eligibility"))?;

        if committee_count == 0 {
            return Err(reject(
                StatusCode::FORBIDDEN,
                "You need to complete a supervised shift first. Please choose a shift where a committee member is already signed up.",
            ));
        }
    }

    if slot.requires_contract && !volunteer.has_contract {
        return Err(reject(StatusCode::FORBIDDEN, "This shift requires a valid contract"));
    }

    let signed_up: i32 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shift_signups WHERE shift_date = ? AND slot = ?"
    )
    .bind(date)
    .bind(&slot.key)
    .fetch_one(&mut *conn)
    .await
    .map_err(internal("Failed to count signups"))?;

    if signed_up >= slot.max_volunteers {
        return Err(reject(StatusCode::CONFLICT, "This shift is already full"));
    }
    Ok(())
}

async fn insert_signup(
    conn: &mut SqliteConnection,
    date: &str,
    slot: &str,
    user_id: &str,
    already_msg: &str,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO shift_signups (shift_date, slot, user_id) VALUES (?, ?, ?)")
        .bind(date)
        .bind(slot)
        .bind(user_id)
        .execute(conn)
        .await
        .map_err(|e| {
            if e.to_string().contains("UNIQUE constraint failed") {
                reject(StatusCode::CONFLICT, already_msg)
            } else {
                internal("Failed to create signup")(e)
            }
        })?;
    Ok(())
}

fn require_onboarded(user: &User) -> Result<(), ApiError> {
    if user.can_signup_for_shifts() {
        Ok(())
    } else {
        Err(reject(
            StatusCode::FORBIDDEN,
            "You must complete your induction, code of conduct, and food safety training before signing up for shifts",
        ))
    }
}

// Get shift information for a date range (authenticated)
pub async fn get_shifts(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(params): Query<ShiftsQuery>,
) -> Result<Json<Vec<ShiftInfo>>, ApiError> {
    info!("📋 Fetching shifts from {} to {}", params.start_date, params.end_date);

    let start = chrono::NaiveDate::parse_from_str(&params.start_date, "%Y-%m-%d")
        .map_err(|_| reject(StatusCode::BAD_REQUEST, "Invalid start_date format"))?;
    let end = chrono::NaiveDate::parse_from_str(&params.end_date, "%Y-%m-%d")
        .map_err(|_| reject(StatusCode::BAD_REQUEST, "Invalid end_date format"))?;

    let mut conn = state.db.acquire().await.map_err(internal("Failed to fetch shifts"))?;

    // Fetch bar hours upfront (indexed by day_of_week: 0=Sunday..6=Saturday)
    let bar_hours_map: std::collections::HashMap<u32, (String, String)> =
        sqlx::query_as::<_, (u32, String, String)>("SELECT day_of_week, open_time, close_time FROM bar_hours")
            .fetch_all(&mut *conn)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|(dow, open, close)| (dow, (open, close)))
            .collect();

    // Pre-fetch induction availability and signup counts for the date range
    let induction_avail_dates: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT shift_date FROM induction_availability WHERE shift_date >= ? AND shift_date <= ?"
    )
    .bind(&params.start_date)
    .bind(&params.end_date)
    .fetch_all(&mut *conn)
    .await
    .unwrap_or_default();
    let induction_avail_set: std::collections::HashSet<String> = induction_avail_dates.into_iter().map(|(d,)| d).collect();

    let induction_counts: Vec<(String, i64)> = sqlx::query_as(
        "SELECT shift_date, COUNT(*) FROM induction_signups WHERE shift_date >= ? AND shift_date <= ? GROUP BY shift_date"
    )
    .bind(&params.start_date)
    .bind(&params.end_date)
    .fetch_all(&mut *conn)
    .await
    .unwrap_or_default();
    let induction_count_map: std::collections::HashMap<String, i64> = induction_counts.into_iter().collect();

    // Current user's own induction availability (for committee members)
    let user_induction_avail: Vec<(String,)> = sqlx::query_as(
        "SELECT shift_date FROM induction_availability WHERE committee_user_id = ? AND shift_date >= ? AND shift_date <= ?"
    )
    .bind(&user.id)
    .bind(&params.start_date)
    .bind(&params.end_date)
    .fetch_all(&mut *conn)
    .await
    .unwrap_or_default();
    let user_induction_avail_set: std::collections::HashSet<String> = user_induction_avail.into_iter().map(|(d,)| d).collect();

    // Pre-induction users don't see shift signup details
    let hide_signups = !user.induction_completed;

    #[derive(sqlx::FromRow)]
    struct SignupRow {
        slot: String,
        user_id: String,
        display_name: Option<String>,
        is_committee: bool,
        code_of_conduct_signed: bool,
    }

    let mut shifts = Vec::new();
    let mut current_date = start;

    while current_date <= end {
        let date_str = current_date.format("%Y-%m-%d").to_string();
        let bar_hours = bar_hours_map.get(&current_date.weekday().num_days_from_sunday());

        let events = events_on(&mut conn, &date_str)
            .await
            .map_err(internal("Failed to fetch events"))?;

        let signups = sqlx::query_as::<_, SignupRow>(
            "SELECT ss.slot, ss.user_id, u.display_name, u.is_committee, u.code_of_conduct_signed
             FROM shift_signups ss
             JOIN users u ON ss.user_id = u.id
             WHERE ss.shift_date = ?"
        )
        .bind(&date_str)
        .fetch_all(&mut *conn)
        .await
        .map_err(internal("Failed to fetch signups"))?;

        let regular_booked = signups.iter().any(|s| s.slot == REGULAR_SLOT);
        let slots = build_slots(&events, bar_hours.map(|(o, c)| (o.as_str(), c.as_str())), regular_booked);

        for slot in slots {
            let signup_users: Vec<ShiftSignupUser> = if hide_signups {
                Vec::new() // Pre-induction users don't see who is signed up
            } else {
                signups
                    .iter()
                    .filter(|s| s.slot == slot.key)
                    .map(|s| ShiftSignupUser {
                        user_id: s.user_id.clone(),
                        display_name: s.display_name.clone(),
                        is_committee: s.is_committee,
                        needs_coc: user.is_committee.then_some(!s.code_of_conduct_signed),
                    })
                    .collect()
            };

            shifts.push(ShiftInfo {
                date: date_str.clone(),
                slot: slot.key,
                event_title: slot.title,
                event_description: slot.description,
                max_volunteers: slot.max_volunteers,
                requires_contract: slot.requires_contract,
                signups_count: signup_users.len() as i32,
                signups: signup_users,
                open_time: slot.start_time,
                close_time: slot.end_time,
                has_induction_availability: induction_avail_set.contains(&date_str),
                induction_signups_count: *induction_count_map.get(&date_str).unwrap_or(&0) as i32,
                current_user_induction_available: user_induction_avail_set.contains(&date_str),
            });
        }

        current_date = current_date
            .succ_opt()
            .ok_or_else(|| reject(StatusCode::INTERNAL_SERVER_ERROR, "Date overflow"))?;
    }

    info!("✅ Fetched {} shifts", shifts.len());
    Ok(Json(shifts))
}

// Sign up for a shift (authenticated)
pub async fn signup_for_shift(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(date): Path<String>,
    Query(SlotQuery { slot }): Query<SlotQuery>,
) -> Result<StatusCode, ApiError> {
    info!("➕ User {} signing up for shift {:?} on {}", user.id, slot, date);

    parse_date(&date)?;
    require_onboarded(&user)?;

    let mut tx = state.db.begin().await.map_err(internal("Failed to create signup"))?;
    let shift = find_slot(&mut tx, &date, &slot).await?;
    check_can_take(&mut tx, &date, &shift, &Volunteer::member(&user)).await?;
    insert_signup(&mut tx, &date, &slot, &user.id, ALREADY_SIGNED_UP).await?;
    tx.commit().await.map_err(internal("Failed to create signup"))?;

    info!("✅ User {} signed up for shift {:?} on {}", user.id, slot, date);
    Ok(StatusCode::OK)
}

// Sign up for every shift on a night that has room (authenticated)
pub async fn signup_for_whole_night(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(date): Path<String>,
) -> Result<Json<WholeNightSignup>, ApiError> {
    info!("➕ User {} signing up for the whole night on {}", user.id, date);

    parse_date(&date)?;
    require_onboarded(&user)?;

    let mut tx = state.db.begin().await.map_err(internal("Failed to create signup"))?;
    let slots = load_slots(&mut tx, &date).await.map_err(internal("Failed to fetch shifts"))?;
    let volunteer = Volunteer::member(&user);

    let mut result = WholeNightSignup { booked: Vec::new(), skipped: Vec::new() };
    for slot in &slots {
        let already: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM shift_signups WHERE shift_date = ? AND slot = ? AND user_id = ?)"
        )
        .bind(&date)
        .bind(&slot.key)
        .bind(&user.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal("Failed to check signups"))?;

        let outcome = if already {
            Err(reject(StatusCode::CONFLICT, ALREADY_SIGNED_UP))
        } else {
            match check_can_take(&mut tx, &date, slot, &volunteer).await {
                Ok(()) => insert_signup(&mut tx, &date, &slot.key, &user.id, ALREADY_SIGNED_UP).await,
                Err(e) => Err(e),
            }
        };
        match outcome {
            Ok(()) => result.booked.push(slot.key.clone()),
            Err((status, _)) if status == StatusCode::INTERNAL_SERVER_ERROR => {
                return Err(reject(status, "Failed to create signup"));
            }
            Err((_, Json(body))) => result.skipped.push(SkippedShift { slot: slot.key.clone(), reason: body.error }),
        }
    }

    if result.booked.is_empty() {
        let reason = match result.skipped.as_slice() {
            [only] => only.reason.clone(),
            all if all.iter().all(|s| s.reason == ALREADY_SIGNED_UP) => {
                "You are already signed up for every shift this night".to_string()
            }
            _ => "None of this night's shifts have room for you".to_string(),
        };
        return Err(reject(StatusCode::CONFLICT, &reason));
    }

    tx.commit().await.map_err(internal("Failed to create signup"))?;

    info!("✅ User {} booked {} shifts on {}", user.id, result.booked.len(), date);
    Ok(Json(result))
}

// Cancel shift signup (authenticated)
pub async fn cancel_shift_signup(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(date): Path<String>,
    Query(SlotQuery { slot }): Query<SlotQuery>,
) -> Result<StatusCode, ApiError> {
    info!("🗑️ User {} cancelling signup for shift {:?} on {}", user.id, slot, date);

    let result = sqlx::query("DELETE FROM shift_signups WHERE shift_date = ? AND slot = ? AND user_id = ?")
        .bind(&date)
        .bind(&slot)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(internal("Failed to cancel signup"))?;

    if result.rows_affected() == 0 {
        return Err(reject(StatusCode::NOT_FOUND, "You are not signed up for this shift"));
    }

    info!("✅ User {} cancelled signup for shift {:?} on {}", user.id, slot, date);
    Ok(StatusCode::OK)
}

// Get user's upcoming shifts (authenticated)
pub async fn get_my_shifts(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<UserShift>>, ApiError> {
    info!("📋 Fetching shifts for user {}", user.id);

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut conn = state.db.acquire().await.map_err(internal("Failed to fetch shifts"))?;

    let booked: Vec<(String, String)> = sqlx::query_as(
        "SELECT shift_date, slot FROM shift_signups
         WHERE user_id = ? AND shift_date >= ?
         ORDER BY shift_date ASC"
    )
    .bind(&user.id)
    .bind(&today)
    .fetch_all(&mut *conn)
    .await
    .map_err(internal("Failed to fetch shifts"))?;

    let mut user_shifts: Vec<UserShift> = Vec::with_capacity(booked.len());
    let mut night: Option<(String, Vec<Slot>)> = None;
    for (date, key) in booked {
        if night.as_ref().map_or(true, |(d, _)| *d != date) {
            let slots = load_slots(&mut conn, &date).await.map_err(internal("Failed to fetch shifts"))?;
            night = Some((date.clone(), slots));
        }
        let slot = night.as_ref().and_then(|(_, slots)| slots.iter().find(|s| s.key == key));
        user_shifts.push(UserShift {
            date,
            event_title: slot.and_then(|s| s.title.clone()),
            open_time: slot.and_then(|s| s.start_time.clone()),
            close_time: slot.and_then(|s| s.end_time.clone()),
            slot: key,
        });
    }
    // Within a night, earliest shift first.
    user_shifts.sort_by(|a, b| (&a.date, &a.open_time).cmp(&(&b.date, &b.open_time)));

    info!("✅ Found {} shifts for user {}", user_shifts.len(), user.id);
    Ok(Json(user_shifts))
}

// Committee: Assign user to shift (committee only)
pub async fn admin_assign_to_shift(
    State(state): State<AppState>,
    CommitteeUser(committee_user): CommitteeUser,
    Path((date, target_user_id)): Path<(String, String)>,
    Query(SlotQuery { slot }): Query<SlotQuery>,
) -> Result<StatusCode, ApiError> {
    info!("➕ Committee member {} assigning user {} to shift {:?} on {}", committee_user.id, target_user_id, slot, date);

    parse_date(&date)?;

    let mut tx = state.db.begin().await.map_err(internal("Failed to assign user to shift"))?;

    let has_contract: bool = sqlx::query_scalar("SELECT has_contract FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal("Failed to fetch user"))?
        .ok_or_else(|| reject(StatusCode::NOT_FOUND, "User not found"))?;

    let shift = find_slot(&mut tx, &date, &slot).await?;
    // Committee can place anyone, so no supervision requirement here.
    let volunteer = Volunteer { has_contract, needs_supervision: false };
    check_can_take(&mut tx, &date, &shift, &volunteer).await.map_err(|(status, body)| {
        if status == StatusCode::FORBIDDEN {
            reject(status, "This shift requires a valid contract and the target user does not have one")
        } else {
            (status, body)
        }
    })?;
    insert_signup(&mut tx, &date, &slot, &target_user_id, "User is already signed up for this shift").await?;
    tx.commit().await.map_err(internal("Failed to assign user to shift"))?;

    info!("✅ Committee member {} assigned user {} to shift {:?} on {}", committee_user.id, target_user_id, slot, date);
    Ok(StatusCode::OK)
}

// Committee: Remove user from shift (committee only)
pub async fn admin_remove_from_shift(
    State(state): State<AppState>,
    CommitteeUser(committee_user): CommitteeUser,
    Path((date, target_user_id)): Path<(String, String)>,
    Query(SlotQuery { slot }): Query<SlotQuery>,
) -> Result<StatusCode, ApiError> {
    info!("🗑️ Committee member {} removing user {} from shift {:?} on {}", committee_user.id, target_user_id, slot, date);

    let result = sqlx::query("DELETE FROM shift_signups WHERE shift_date = ? AND slot = ? AND user_id = ?")
        .bind(&date)
        .bind(&slot)
        .bind(&target_user_id)
        .execute(&state.db)
        .await
        .map_err(internal("Failed to remove user from shift"))?;

    if result.rows_affected() == 0 {
        return Err(reject(StatusCode::NOT_FOUND, "User is not signed up for this shift"));
    }

    info!("✅ Committee member {} removed user {} from shift {:?} on {}", committee_user.id, target_user_id, slot, date);
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{
        insert_separate_event, insert_shift_signup, insert_slot_signup, insert_user, test_state, user_with,
    };

    /// Friday 2026-06-19, split into an early and a late shift that cover the opening hours.
    const SPLIT_NIGHT: &str = "2026-06-19";

    async fn split_night(state: &AppState, late_capacity: Option<i32>) {
        insert_separate_event(&state.db, "early", SPLIT_NIGHT, "18:30", "21:00", None).await;
        insert_separate_event(&state.db, "late", SPLIT_NIGHT, "21:00", "02:00", late_capacity).await;
    }

    async fn sign_up(state: &AppState, user: &User, slot: &str) -> Result<StatusCode, ApiError> {
        signup_for_shift(
            State(state.clone()),
            AuthenticatedUser(user.clone()),
            Path(SPLIT_NIGHT.to_string()),
            Query(SlotQuery { slot: slot.to_string() }),
        )
        .await
    }

    async fn whole_night(state: &AppState, user: &User) -> Result<Json<WholeNightSignup>, ApiError> {
        signup_for_whole_night(State(state.clone()), AuthenticatedUser(user.clone()), Path(SPLIT_NIGHT.to_string())).await
    }

    async fn shifts_on(state: &AppState, viewer: User, date: &str) -> Vec<ShiftInfo> {
        let Json(shifts) = get_shifts(
            State(state.clone()),
            AuthenticatedUser(viewer),
            Query(ShiftsQuery { start_date: date.to_string(), end_date: date.to_string() }),
        )
        .await
        .unwrap();
        shifts
    }

    // Should: list each separately-staffed event on a night as its own shift.
    // Should: let one member hold both shifts on the same night.
    #[tokio::test]
    async fn member_can_hold_two_shifts_on_one_night() {
        let state = test_state().await;
        split_night(&state, None).await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;

        assert_eq!(sign_up(&state, &member, "early").await.unwrap(), StatusCode::OK);
        assert_eq!(sign_up(&state, &member, "late").await.unwrap(), StatusCode::OK);

        let shifts = shifts_on(&state, member, SPLIT_NIGHT).await;
        let seen: Vec<(&str, Option<&str>, i32)> = shifts
            .iter()
            .map(|s| (s.slot.as_str(), s.open_time.as_deref(), s.signups_count))
            .collect();
        assert_eq!(seen, [("early", Some("18:30"), 1), ("late", Some("21:00"), 1)]);
    }

    // Impact: the supervised first shift exists so an experienced committee
    // member is working alongside the newcomer, not elsewhere that night.
    // Should: require a committee member on the same shift, not just the same night.
    #[tokio::test]
    async fn supervision_needs_committee_on_the_same_shift() {
        let state = test_state().await;
        split_night(&state, None).await;
        let mut committee = user_with(true, true, true, true);
        committee.is_committee = true;
        let newcomer = user_with(true, true, true, false);
        insert_user(&state.db, &committee).await;
        insert_user(&state.db, &newcomer).await;
        insert_slot_signup(&state.db, &committee.id, SPLIT_NIGHT, "early").await;

        let (status, _) = sign_up(&state, &newcomer, "late").await.expect_err("no committee on late");
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(sign_up(&state, &newcomer, "early").await.unwrap(), StatusCode::OK);
    }

    // Should: refuse a shift that isn't on that night.
    #[tokio::test]
    async fn unknown_shift_is_not_found() {
        let state = test_state().await;
        split_night(&state, None).await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;

        let (status, _) = sign_up(&state, &member, "nonexistent").await.expect_err("unknown slot");
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    // Should: book every shift on the night that has room, and report the ones skipped.
    #[tokio::test]
    async fn whole_night_books_every_shift_with_room() {
        let state = test_state().await;
        split_night(&state, Some(1)).await;
        let (member, other) = (user_with(true, true, true, true), user_with(true, true, true, true));
        insert_user(&state.db, &member).await;
        insert_user(&state.db, &other).await;
        insert_slot_signup(&state.db, &other.id, SPLIT_NIGHT, "late").await;

        let Json(result) = whole_night(&state, &member).await.unwrap();
        assert_eq!(result.booked, ["early"]);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].slot, "late");
        assert!(result.skipped[0].reason.contains("full"), "{}", result.skipped[0].reason);
    }

    // Should: fail when no shift on the night can be booked.
    #[tokio::test]
    async fn whole_night_with_no_room_is_a_conflict() {
        let state = test_state().await;
        split_night(&state, Some(1)).await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        insert_slot_signup(&state.db, &member.id, SPLIT_NIGHT, "early").await;
        let other = user_with(true, true, true, true);
        insert_user(&state.db, &other).await;
        insert_slot_signup(&state.db, &other.id, SPLIT_NIGHT, "late").await;

        let (status, _) = whole_night(&state, &member).await.expect_err("nothing left to book");
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn signup_blocked_when_food_safety_missing() {
        let state = test_state().await;
        let user = user_with(true, true, false, false);
        insert_user(&state.db, &user).await;

        let result = signup_for_shift(
            State(state),
            AuthenticatedUser(user),
            Path("2026-05-01".to_string()),
            Query(SlotQuery::default()),
        )
        .await;

        let (status, body) = result.expect_err("expected gate to block");
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(
            body.error.contains("food safety"),
            "expected onboarding error, got: {}",
            body.error
        );
    }

    #[tokio::test]
    async fn signup_blocked_when_induction_missing() {
        let state = test_state().await;
        let user = user_with(false, true, true, false);
        insert_user(&state.db, &user).await;

        let result = signup_for_shift(
            State(state),
            AuthenticatedUser(user),
            Path("2026-05-01".to_string()),
            Query(SlotQuery::default()),
        )
        .await;

        let (status, body) = result.expect_err("expected gate to block");
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(body.error.contains("induction"));
    }

    #[tokio::test]
    async fn signup_passes_gate_then_blocks_on_supervised_check() {
        // All three signup flags true, supervised false, no committee on the shift date.
        // Proves the can_signup_for_shifts gate passes (otherwise we'd see the onboarding
        // error) and the supervised-shift gate then takes over with its own error.
        let state = test_state().await;
        let user = user_with(true, true, true, false);
        insert_user(&state.db, &user).await;

        let result = signup_for_shift(
            State(state),
            AuthenticatedUser(user),
            Path("2026-05-01".to_string()),
            Query(SlotQuery::default()),
        )
        .await;

        let (status, body) = result.expect_err("expected supervised-shift block");
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(
            body.error.contains("supervised shift"),
            "expected supervised-shift error (proves first gate let user through), got: {}",
            body.error
        );
    }

    async fn signups_seen_by(state: &AppState, viewer: crate::models::User) -> Vec<ShiftSignupUser> {
        let Json(shifts) = get_shifts(
            State(state.clone()),
            AuthenticatedUser(viewer),
            Query(ShiftsQuery {
                start_date: "2026-06-20".to_string(),
                end_date: "2026-06-20".to_string(),
            }),
        )
        .await
        .unwrap();
        shifts.into_iter().next().unwrap().signups
    }

    // Should: flag booked members who still need to re-sign the CoC to committee viewers.
    // Should not: reveal other members' CoC status to non-committee viewers.
    #[tokio::test]
    async fn needs_coc_is_shown_only_to_committee() {
        let state = test_state().await;
        let unsigned = user_with(true, false, true, true);
        let mut committee = user_with(true, true, true, true);
        committee.is_committee = true;
        let member = user_with(true, true, true, true);
        for u in [&unsigned, &committee, &member] {
            insert_user(&state.db, u).await;
        }
        insert_shift_signup(&state.db, &unsigned.id, "2026-06-20").await;

        let seen = signups_seen_by(&state, committee).await;
        assert_eq!(seen[0].needs_coc, Some(true));

        let seen = signups_seen_by(&state, member).await;
        assert_eq!(seen[0].needs_coc, None);
    }
}
