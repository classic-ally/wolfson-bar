//! Committee-only CSV data exports.
//!
//! Two reports ship today (members, shift history). The page is structured
//! so future exports become additional handlers here without redesigning the
//! response shape: build the CSV body inline using the `csv_field` helpers,
//! then hand off to `csv_response` with a date-stamped filename.

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use tracing::{error, info};

use crate::auth::CommitteeUser;
use crate::models::{ErrorResponse, IS_ROTA_MEMBER_SQL};
use crate::routes::auth::AppState;

/// RFC 4180 CSV field escaping. Wraps the value in quotes and doubles any
/// embedded quotes if it contains a comma, quote, or line break.
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn csv_field_opt(s: Option<&str>) -> String {
    s.map(csv_field).unwrap_or_default()
}

fn csv_field_bool(b: bool) -> &'static str {
    if b { "true" } else { "false" }
}

fn csv_response(filename: &str, body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", filename),
            ),
        ],
        body,
    )
        .into_response()
}

#[derive(Debug, sqlx::FromRow)]
struct MembersExportRow {
    display_name: Option<String>,
    email: Option<String>,
    has_contract: bool,
    contract_expiry_date: Option<String>,
}

/// Export the active rota-member roster as a CSV. Committee-only.
///
/// Columns: display_name, email, has_contract, contract_expiry_date.
/// Scope matches `get_active_members` (IS_ROTA_MEMBER_SQL) so the export
/// reflects what committee already see in the rota manager.
pub async fn export_members_csv(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    info!("📤 Committee member {} exporting members CSV", user.id);

    let rows = sqlx::query_as::<_, MembersExportRow>(&format!(
        "SELECT display_name, email, has_contract, contract_expiry_date \
         FROM users WHERE {} ORDER BY display_name ASC",
        IS_ROTA_MEMBER_SQL,
    ))
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch members for export: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to export members".to_string(),
            }),
        )
    })?;

    let mut body = String::new();
    body.push_str("display_name,email,has_contract,contract_expiry_date\n");
    for r in &rows {
        body.push_str(&csv_field_opt(r.display_name.as_deref()));
        body.push(',');
        body.push_str(&csv_field_opt(r.email.as_deref()));
        body.push(',');
        body.push_str(csv_field_bool(r.has_contract));
        body.push(',');
        body.push_str(&csv_field_opt(r.contract_expiry_date.as_deref()));
        body.push('\n');
    }

    let filename = format!(
        "members-{}.csv",
        chrono::Local::now().format("%Y-%m-%d"),
    );
    info!("✅ Exported {} members", rows.len());
    Ok(csv_response(&filename, body))
}

#[derive(Debug, sqlx::FromRow)]
struct ShiftHistoryExportRow {
    shift_date: String,
    event_title: String,
    display_name: Option<String>,
    email: Option<String>,
}

/// Export the full shift signup history as a CSV. Committee-only.
///
/// Columns: shift_date, event_title, display_name, email. An empty event_title
/// indicates a regular (non-event) bar night, not a missing event row.
pub async fn export_shift_history_csv(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    info!("📤 Committee member {} exporting shift history CSV", user.id);

    let rows = sqlx::query_as::<_, ShiftHistoryExportRow>(
        "SELECT s.shift_date, \
                COALESCE(e.title, '') AS event_title, \
                u.display_name, \
                u.email \
         FROM shift_signups s \
         JOIN users u ON u.id = s.user_id \
         LEFT JOIN events e ON e.event_date = s.shift_date \
         ORDER BY s.shift_date DESC, u.display_name ASC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("❌ Failed to fetch shift history for export: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to export shift history".to_string(),
            }),
        )
    })?;

    let mut body = String::new();
    body.push_str("shift_date,event_title,display_name,email\n");
    for r in &rows {
        body.push_str(&csv_field(&r.shift_date));
        body.push(',');
        body.push_str(&csv_field(&r.event_title));
        body.push(',');
        body.push_str(&csv_field_opt(r.display_name.as_deref()));
        body.push(',');
        body.push_str(&csv_field_opt(r.email.as_deref()));
        body.push('\n');
    }

    let filename = format!(
        "shift-history-{}.csv",
        chrono::Local::now().format("%Y-%m-%d"),
    );
    info!("✅ Exported {} shift history rows", rows.len());
    Ok(csv_response(&filename, body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::create_jwt_token;
    use crate::models::User;
    use crate::test_util::{
        insert_shift_signup, insert_user, test_state, user_with, user_with_role,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode as Status};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    /// Build a fully onboarded rota member with the committee flag flipped as
    /// requested. Mirrors the helper used elsewhere in the admin tests — kept
    /// local so this file doesn't depend on the parent module's test internals.
    fn rota_member(committee: bool) -> User {
        let mut u = user_with(true, true, true, true);
        u.is_committee = committee;
        u
    }

    // -------- csv_field RFC 4180 escaping --------

    #[test]
    fn csv_field_plain_string_passes_through_unchanged() {
        assert_eq!(csv_field("Alice"), "Alice");
        assert_eq!(csv_field(""), "");
        assert_eq!(csv_field("alice@example.com"), "alice@example.com");
    }

    #[test]
    fn csv_field_with_comma_is_quoted() {
        assert_eq!(csv_field("Smith, Alice"), "\"Smith, Alice\"");
    }

    #[test]
    fn csv_field_with_embedded_quote_is_doubled_and_wrapped() {
        // Alice "Ally" Smith → "Alice ""Ally"" Smith"
        assert_eq!(
            csv_field("Alice \"Ally\" Smith"),
            "\"Alice \"\"Ally\"\" Smith\"",
        );
    }

    #[test]
    fn csv_field_with_newline_is_wrapped() {
        assert_eq!(csv_field("line1\nline2"), "\"line1\nline2\"");
    }

    #[test]
    fn csv_field_with_carriage_return_is_wrapped() {
        assert_eq!(csv_field("line1\rline2"), "\"line1\rline2\"");
    }

    #[test]
    fn csv_field_with_mixed_specials_escapes_all() {
        // Both a comma AND a quote — must wrap AND double the quote.
        assert_eq!(
            csv_field("Smith, \"Ally\""),
            "\"Smith, \"\"Ally\"\"\"",
        );
    }

    #[test]
    fn csv_field_opt_renders_none_as_empty_string() {
        assert_eq!(csv_field_opt(None), "");
        assert_eq!(csv_field_opt(Some("hi")), "hi");
        assert_eq!(csv_field_opt(Some("a,b")), "\"a,b\"");
    }

    #[test]
    fn csv_field_bool_renders_lowercase() {
        assert_eq!(csv_field_bool(true), "true");
        assert_eq!(csv_field_bool(false), "false");
    }

    // -------- export_members_csv --------

    /// Set fields on a User row that `insert_user` doesn't touch.
    /// Used by the export tests to vary email / has_contract / contract_expiry.
    async fn set_member_fields(
        db: &sqlx::SqlitePool,
        user_id: &str,
        email: Option<&str>,
        has_contract: bool,
        contract_expiry: Option<&str>,
    ) {
        sqlx::query(
            "UPDATE users SET email = ?, has_contract = ?, contract_expiry_date = ? WHERE id = ?",
        )
        .bind(email)
        .bind(has_contract)
        .bind(contract_expiry)
        .bind(user_id)
        .execute(db)
        .await
        .expect("update member fields");
    }

    async fn run_members_export(state: AppState, caller: User) -> (Response, String) {
        let response = export_members_csv(State(state), CommitteeUser(caller))
            .await
            .expect("export ok");
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body_bytes.to_vec()).expect("utf8 body");
        // Body has been consumed; tests that need the original headers re-run
        // the handler. Return a placeholder Response so the tuple shape lines
        // up at the call site.
        (Response::new(Body::empty()), body)
    }

    #[tokio::test]
    async fn export_members_empty_roster_returns_header_only() {
        let state = test_state().await;
        let committee = rota_member(true);
        insert_user(&state.db, &committee).await;
        // Non-rota committee (supervised_shift_completed = true makes them rota by
        // rota_member); flip the gate so the roster is genuinely empty.
        sqlx::query("UPDATE users SET supervised_shift_completed = FALSE WHERE id = ?")
            .bind(&committee.id)
            .execute(&state.db)
            .await
            .unwrap();

        let (_resp, body) = run_members_export(state, committee).await;
        assert_eq!(body, "display_name,email,has_contract,contract_expiry_date\n");
    }

    #[tokio::test]
    async fn export_members_includes_rota_member_with_all_fields() {
        let state = test_state().await;
        let committee = rota_member(true);
        insert_user(&state.db, &committee).await;
        set_member_fields(
            &state.db,
            &committee.id,
            Some("test@example.com"),
            true,
            Some("2026-12-31"),
        )
        .await;

        let (_resp, body) = run_members_export(state, committee).await;
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "header + 1 row, got {body:?}");
        assert_eq!(lines[0], "display_name,email,has_contract,contract_expiry_date");
        assert_eq!(lines[1], "Test,test@example.com,true,2026-12-31");
    }

    #[tokio::test]
    async fn export_members_excludes_non_rota_member() {
        let state = test_state().await;
        let caller = rota_member(true);
        insert_user(&state.db, &caller).await;

        let mut non_rota = user_with(true, true, false, true); // food_safety = false
        non_rota.id = "non-rota".into();
        non_rota.is_committee = false;
        insert_user(&state.db, &non_rota).await;

        let (_resp, body) = run_members_export(state, caller).await;
        // Only the caller (rota member) should appear — 2 lines total (header + 1).
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "non-rota member leaked into export: {body:?}");
    }

    #[tokio::test]
    async fn export_members_escapes_comma_in_display_name() {
        let state = test_state().await;
        let mut user = rota_member(true);
        user.display_name = Some("Smith, Alice".into());
        insert_user(&state.db, &user).await;

        let (_resp, body) = run_members_export(state, user).await;
        // The display_name cell must be wrapped in quotes so the comma doesn't
        // split it into two CSV columns.
        assert!(
            body.contains("\"Smith, Alice\",,false,"),
            "display_name with comma not escaped: {body:?}",
        );
    }

    #[tokio::test]
    async fn export_members_renders_null_email_as_empty_cell() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        // No email set → email column should be empty (",,false,").

        let (_resp, body) = run_members_export(state, user).await;
        let row = body.lines().nth(1).unwrap();
        assert_eq!(row, "Test,,false,");
    }

    #[tokio::test]
    async fn export_members_response_has_csv_content_type_and_attachment_header() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;

        let resp = export_members_csv(State(state), CommitteeUser(user))
            .await
            .expect("export ok");
        let ct = resp
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        let cd = resp
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(ct, "text/csv; charset=utf-8");
        assert!(cd.starts_with("attachment; filename=\"members-"), "got {cd}");
        assert!(cd.ends_with(".csv\""), "got {cd}");
    }

    // -------- export_shift_history_csv --------

    async fn insert_event(
        db: &sqlx::SqlitePool,
        id: &str,
        title: &str,
        event_date: &str,
    ) {
        sqlx::query("INSERT INTO events (id, title, description, event_date) VALUES (?, ?, NULL, ?)")
            .bind(id)
            .bind(title)
            .bind(event_date)
            .execute(db)
            .await
            .expect("insert event");
    }

    async fn run_shift_history_export(state: AppState, caller: User) -> String {
        let response = export_shift_history_csv(State(state), CommitteeUser(caller))
            .await
            .expect("export ok");
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8(body_bytes.to_vec()).expect("utf8 body")
    }

    #[tokio::test]
    async fn export_shift_history_empty_returns_header_only() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;

        let body = run_shift_history_export(state, user).await;
        assert_eq!(body, "shift_date,event_title,display_name,email\n");
    }

    #[tokio::test]
    async fn export_shift_history_left_join_preserves_non_event_signup() {
        // A signup on a date with no matching event should still appear, with an
        // empty event_title — not be dropped by an inner join.
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-06-10").await;

        let body = run_shift_history_export(state, user).await;
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "non-event signup dropped: {body:?}");
        assert_eq!(lines[1], "2026-06-10,,Test,");
    }

    #[tokio::test]
    async fn export_shift_history_joins_event_title_when_present() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_event(&state.db, "e1", "Quiz Night", "2026-06-11").await;
        insert_shift_signup(&state.db, &user.id, "2026-06-11").await;

        let body = run_shift_history_export(state, user).await;
        let row = body.lines().nth(1).unwrap();
        assert_eq!(row, "2026-06-11,Quiz Night,Test,");
    }

    #[tokio::test]
    async fn export_shift_history_orders_by_date_desc() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_shift_signup(&state.db, &user.id, "2026-06-01").await;
        insert_shift_signup(&state.db, &user.id, "2026-06-15").await;
        insert_shift_signup(&state.db, &user.id, "2026-06-08").await;

        let body = run_shift_history_export(state, user).await;
        let dates: Vec<&str> = body
            .lines()
            .skip(1)
            .map(|l| l.split(',').next().unwrap())
            .collect();
        assert_eq!(dates, vec!["2026-06-15", "2026-06-08", "2026-06-01"]);
    }

    #[tokio::test]
    async fn export_shift_history_escapes_comma_in_event_title() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        insert_event(&state.db, "e2", "Halfway Hall, Trinity", "2026-06-20").await;
        insert_shift_signup(&state.db, &user.id, "2026-06-20").await;

        let body = run_shift_history_export(state, user).await;
        let row = body.lines().nth(1).unwrap();
        // event_title with a comma must be wrapped in quotes.
        assert_eq!(row, "2026-06-20,\"Halfway Hall, Trinity\",Test,");
    }

    #[tokio::test]
    async fn export_shift_history_includes_email_when_set() {
        let state = test_state().await;
        let user = rota_member(true);
        insert_user(&state.db, &user).await;
        set_member_fields(&state.db, &user.id, Some("test@example.com"), false, None).await;
        insert_shift_signup(&state.db, &user.id, "2026-06-25").await;

        let body = run_shift_history_export(state, user).await;
        let row = body.lines().nth(1).unwrap();
        assert_eq!(row, "2026-06-25,,Test,test@example.com");
    }

    // -------- Export auth gates --------

    fn build_exports_app(state: AppState) -> Router {
        Router::new()
            .route("/api/admin/exports/members.csv", get(export_members_csv))
            .route(
                "/api/admin/exports/shift-history.csv",
                get(export_shift_history_csv),
            )
            .with_state(state)
    }

    fn exports_request(path: &str, token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri(path);
        if let Some(t) = token {
            builder = builder.header("authorization", format!("Bearer {t}"));
        }
        builder.body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn export_members_rejects_unauthenticated_request_with_401() {
        let state = test_state().await;
        let response = build_exports_app(state)
            .oneshot(exports_request("/api/admin/exports/members.csv", None))
            .await
            .unwrap();
        assert_eq!(response.status(), Status::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn export_members_rejects_non_committee_user_with_403() {
        let state = test_state().await;
        let user = user_with_role(false, false);
        insert_user(&state.db, &user).await;
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();

        let response = build_exports_app(state)
            .oneshot(exports_request(
                "/api/admin/exports/members.csv",
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), Status::FORBIDDEN);
    }

    #[tokio::test]
    async fn export_shift_history_rejects_unauthenticated_request_with_401() {
        let state = test_state().await;
        let response = build_exports_app(state)
            .oneshot(exports_request(
                "/api/admin/exports/shift-history.csv",
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), Status::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn export_shift_history_rejects_non_committee_user_with_403() {
        let state = test_state().await;
        let user = user_with_role(false, false);
        insert_user(&state.db, &user).await;
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();

        let response = build_exports_app(state)
            .oneshot(exports_request(
                "/api/admin/exports/shift-history.csv",
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), Status::FORBIDDEN);
    }

    #[tokio::test]
    async fn export_members_succeeds_via_router_for_committee_user() {
        // Sanity check: the auth tests above prove the gate rejects; this one
        // proves the gate lets a committee user through end-to-end (extractor +
        // handler + CSV response).
        let state = test_state().await;
        let user = user_with_role(true, false);
        insert_user(&state.db, &user).await;
        let token = create_jwt_token(&user.id, &state.jwt_secret).unwrap();

        let response = build_exports_app(state)
            .oneshot(exports_request(
                "/api/admin/exports/members.csv",
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), Status::OK);
        let ct = response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(ct, "text/csv; charset=utf-8");
    }
}
