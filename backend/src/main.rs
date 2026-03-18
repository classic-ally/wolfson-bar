mod auth;
mod constants;
mod email;
mod ical;
mod models;
mod notifications;
mod routes;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use routes::auth::{login_finish, login_start, register_finish, register_start, register_with_email, AppState};
use routes::users::{get_me, accept_coc, upload_certificate, get_verification_token, update_display_name, submit_contract_request, get_my_overview, update_email, update_email_notifications, delete_my_account, export_my_data, accept_privacy, start_passkey_setup, finish_passkey_setup};
use routes::magic_link::{request_magic_link, verify_magic_link};
use routes::admin::{get_pending_certificates, get_certificate, approve_certificate, verify_induction, get_active_members, get_pending_contracts, approve_contract, get_bar_hours, update_bar_hours, get_overview_stats, get_all_users, promote_user, demote_user, delete_user, admin_mark_induction, admin_mark_coc, bulk_import_users, admin_upload_certificate, admin_set_contract};
use routes::events::{get_events, get_event, create_event, update_event, delete_event};
use routes::shifts::{get_shifts, signup_for_shift, cancel_shift_signup, get_my_shifts, admin_assign_to_shift, admin_remove_from_shift};
use routes::calendar::{get_calendar_feed, download_event, get_user_calendar};
#[cfg(debug_assertions)]
use routes::local::generate_jwt;
use routes::stock::{create_product, lookup_barcode, add_barcode, create_transactions, get_products};
use routes::term_weeks::get_term_weeks;
use sqlx::sqlite::SqlitePoolOptions;
use rand::Rng;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use webauthn_rs::prelude::*;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Setup database (create if it doesn't exist)
    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect("sqlite:wolfson_bar.db?mode=rwc")
        .await
        .expect("Failed to connect to database");

    // Run embedded migrations
    let migrations: &[(&str, &str, &[&str])] = &[
        ("001_init", include_str!("../migrations/001_init.sql"), &[]),
        ("002_events", include_str!("../migrations/002_events.sql"), &[]),
        ("003_shifts", include_str!("../migrations/003_shifts.sql"), &["duplicate column"]),
        ("004_calendar", include_str!("../migrations/004_calendar.sql"), &["duplicate column", "already exists"]),
        ("005_stock", include_str!("../migrations/005_stock.sql"), &["already exists"]),
        ("006_certificate_type", include_str!("../migrations/006_certificate_type.sql"), &["duplicate column"]),
        ("007_admin_role", include_str!("../migrations/007_admin_role.sql"), &["duplicate column"]),
        ("008_email", include_str!("../migrations/008_email.sql"), &["duplicate column", "already exists"]),
        ("009_optional_passkey", include_str!("../migrations/009_optional_passkey.sql"), &["already exists"]),
    ];

    for (name, sql, ignorable_errors) in migrations {
        match sqlx::query(sql).execute(&db).await {
            Ok(_) => tracing::info!("Migration {} applied", name),
            Err(e) if ignorable_errors.iter().any(|ie| e.to_string().contains(ie)) => {
                tracing::info!("Migration {} already applied", name);
            }
            Err(e) => panic!("Failed to run migration {}: {}", name, e),
        }
    }

    // Get public URL from environment (required)
    let public_url = std::env::var("PUBLIC_URL")
        .expect("PUBLIC_URL environment variable must be set");

    // Setup WebAuthn
    let rp_origin = Url::parse(&public_url).expect("Invalid PUBLIC_URL format");
    let rp_id = rp_origin.host_str().expect("PUBLIC_URL must have a valid host");
    let builder = WebauthnBuilder::new(rp_id, &rp_origin).expect("Invalid WebAuthn configuration");
    let webauthn = builder.build().expect("Failed to build Webauthn");

    // Generate random JWT secret (invalidates all sessions on restart)
    let jwt_secret: Vec<u8> = rand::thread_rng().gen::<[u8; 32]>().to_vec();
    tracing::info!("Generated random JWT secret for this session");

    // Initialize email service (optional - app works without it)
    let email_service = email::EmailService::new();
    if email_service.is_some() {
        tracing::info!("Email service initialized");
    } else {
        tracing::info!("Email service not configured (set RESEND_API_KEY to enable)");
    }

    // App state
    let state = AppState {
        db,
        webauthn,
        jwt_secret,
        email_service: email_service.clone(),
        public_url: public_url.clone(),
    };

    // CORS setup for local development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Setup static file serving for frontend
    let frontend_path = std::env::var("FRONTEND_PATH").unwrap_or_else(|_| "../frontend/dist".to_string());
    let index_path = format!("{}/index.html", frontend_path);
    let serve_dir = ServeDir::new(&frontend_path)
        .not_found_service(ServeFile::new(&index_path));

    // Build router
    let app = Router::new()
        .route("/api/auth/register/start", post(register_start))
        .route("/api/auth/register/finish", post(register_finish))
        .route("/api/auth/login/start", post(login_start))
        .route("/api/auth/login/finish", post(login_finish))
        .route("/api/users/me", get(get_me))
        .route("/api/users/me/overview", get(get_my_overview))
        .route("/api/users/me/display-name", axum::routing::put(update_display_name))
        .route("/api/users/me/accept-coc", post(accept_coc))
        .route("/api/users/me/food-safety-certificate", post(upload_certificate))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024)) // 10MB limit for certificate uploads
        .route("/api/users/me/verification-token", get(get_verification_token))
        .route("/api/users/me/contract-request", post(submit_contract_request))
        .route("/api/users/me/email", axum::routing::put(update_email))
        .route("/api/users/me/email-notifications", axum::routing::put(update_email_notifications))
        .route("/api/users/me/accept-privacy", post(accept_privacy))
        .route("/api/users/me/data", get(export_my_data))
        .route("/api/users/me", axum::routing::delete(delete_my_account))
        .route("/api/auth/register/email", post(register_with_email))
        .route("/api/auth/magic-link/request", post(request_magic_link))
        .route("/api/auth/magic-link/verify", get(verify_magic_link))
        .route("/api/admin/pending-certificates", get(get_pending_certificates))
        .route("/api/admin/certificate/:user_id", get(get_certificate))
        .route("/api/admin/approve-food-safety/:user_id", post(approve_certificate))
        .route("/api/admin/verify-induction", post(verify_induction))
        .route("/api/admin/active-members", get(get_active_members))
        .route("/api/admin/pending-contracts", get(get_pending_contracts))
        .route("/api/admin/approve-contract/:user_id", post(approve_contract))
        .route("/api/admin/bar-hours", get(get_bar_hours))
        .route("/api/admin/bar-hours", axum::routing::put(update_bar_hours))
        .route("/api/admin/overview", get(get_overview_stats))
        .route("/api/term-weeks", get(get_term_weeks))
        .route("/api/events", get(get_events))
        .route("/api/events/:id", get(get_event))
        .route("/api/events/calendar.ics", get(get_calendar_feed))
        .route("/api/events/:id/download.ics", get(download_event))
        .route("/api/users/:user_id/calendar.ics", get(get_user_calendar))
        .route("/api/admin/events", post(create_event))
        .route("/api/admin/events/:id", axum::routing::put(update_event))
        .route("/api/admin/events/:id", axum::routing::delete(delete_event))
        .route("/api/shifts", get(get_shifts))
        .route("/api/shifts/:date/signup", post(signup_for_shift))
        .route("/api/shifts/:date/signup", axum::routing::delete(cancel_shift_signup))
        .route("/api/users/me/shifts", get(get_my_shifts))
        .route("/api/admin/shifts/:date/:user_id", post(admin_assign_to_shift).delete(admin_remove_from_shift))
        .route("/api/admin/stock/products", get(get_products))
        .route("/api/admin/stock/products/:id", post(create_product))
        .route("/api/admin/stock/products/:id/barcodes", post(add_barcode))
        .route("/api/admin/stock/barcode/:barcode", get(lookup_barcode))
        .route("/api/admin/stock/transactions", post(create_transactions))
        // Admin user management routes
        .route("/api/admin/users", get(get_all_users))
        .route("/api/admin/users/:user_id/promote", post(promote_user))
        .route("/api/admin/users/:user_id/demote", post(demote_user))
        .route("/api/admin/users/:user_id", axum::routing::delete(delete_user))
        .route("/api/admin/users/:user_id/mark-induction", post(admin_mark_induction))
        .route("/api/admin/users/:user_id/mark-coc", post(admin_mark_coc))
        .route("/api/admin/users/bulk-import", post(bulk_import_users))
        .route("/api/admin/users/:user_id/upload-certificate", post(admin_upload_certificate))
        .route("/api/admin/users/:user_id/set-contract", post(admin_set_contract))
        .route("/api/users/me/passkey/start", post(start_passkey_setup))
        .route("/api/users/me/passkey/finish", post(finish_passkey_setup))
        ;
        // Debug-only endpoint for generating JWTs for any user
        #[cfg(debug_assertions)]
        let app = app.route("/api/local/jwt/:user_id", get(generate_jwt));

    // Start notification worker if email service is available (before state is moved)
    if let Some(ref email_svc) = email_service {
        notifications::start_notification_worker(
            state.db.clone(),
            email_svc.clone(),
            public_url.clone(),
        );
        tracing::info!("Notification worker started");
    }

        let app = app
            .layer(cors)
            .with_state(state)
            // Serve static files (must be last to act as catch-all)
            .fallback_service(serve_dir);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
