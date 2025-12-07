mod auth;
mod constants;
mod models;
mod routes;

use axum::{
    routing::{get, post},
    Router,
};
use routes::auth::{login_finish, login_start, register_finish, register_start, AppState};
use routes::users::{get_me, accept_coc, upload_certificate, get_verification_token, update_display_name, submit_contract_request, get_my_overview};
use routes::admin::{get_pending_certificates, get_certificate, approve_certificate, verify_induction, get_active_members, get_pending_contracts, approve_contract, get_bar_hours, update_bar_hours, get_overview_stats};
use routes::events::{get_events, get_event, create_event, update_event, delete_event};
use routes::shifts::{get_shifts, signup_for_shift, cancel_shift_signup, get_my_shifts, admin_remove_from_shift};
use routes::calendar::{get_calendar_feed, download_event, get_user_calendar};
use routes::local::generate_jwt;
use routes::stock::{create_product, lookup_barcode, add_barcode, create_transactions, get_products};
use sqlx::sqlite::SqlitePoolOptions;
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

    // Run migrations
    sqlx::query(&std::fs::read_to_string("migrations/001_init.sql").expect("Failed to read migration"))
        .execute(&db)
        .await
        .expect("Failed to run migrations");

    sqlx::query(&std::fs::read_to_string("migrations/002_events.sql").expect("Failed to read migration"))
        .execute(&db)
        .await
        .expect("Failed to run events migration");

    // Run shifts migration (ignore duplicate column errors for idempotency)
    if let Err(e) = sqlx::query(&std::fs::read_to_string("migrations/003_shifts.sql").expect("Failed to read migration"))
        .execute(&db)
        .await
    {
        // Ignore "duplicate column" errors - migration already ran
        if !e.to_string().contains("duplicate column") {
            panic!("Failed to run shifts migration: {}", e);
        }
        tracing::info!("Shifts migration already applied (ignoring duplicate column error)");
    }

    // Run calendar migration (ignore duplicate errors for idempotency)
    if let Err(e) = sqlx::query(&std::fs::read_to_string("migrations/004_calendar.sql").expect("Failed to read migration"))
        .execute(&db)
        .await
    {
        // Ignore errors if already applied
        if !e.to_string().contains("duplicate column") && !e.to_string().contains("already exists") {
            panic!("Failed to run calendar migration: {}", e);
        }
        tracing::info!("Calendar migration already applied (ignoring duplicate errors)");
    }

    // Run stock management migration (ignore duplicate errors for idempotency)
    if let Err(e) = sqlx::query(&std::fs::read_to_string("migrations/005_stock.sql").expect("Failed to read migration"))
        .execute(&db)
        .await
    {
        // Ignore errors if already applied
        if !e.to_string().contains("already exists") {
            panic!("Failed to run stock migration: {}", e);
        }
        tracing::info!("Stock migration already applied (ignoring duplicate errors)");
    }

    // Get public URL from environment (required)
    let public_url = std::env::var("PUBLIC_URL")
        .expect("PUBLIC_URL environment variable must be set");

    // Setup WebAuthn
    let rp_origin = Url::parse(&public_url).expect("Invalid PUBLIC_URL format");
    let rp_id = rp_origin.host_str().expect("PUBLIC_URL must have a valid host");
    let builder = WebauthnBuilder::new(rp_id, &rp_origin).expect("Invalid WebAuthn configuration");
    let webauthn = builder.build().expect("Failed to build Webauthn");

    // App state
    let state = AppState { db, webauthn };

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
        .route("/api/users/me/verification-token", get(get_verification_token))
        .route("/api/users/me/contract-request", post(submit_contract_request))
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
        .route("/api/admin/shifts/:date/:user_id", axum::routing::delete(admin_remove_from_shift))
        .route("/api/admin/stock/products", get(get_products))
        .route("/api/admin/stock/products/:id", post(create_product))
        .route("/api/admin/stock/products/:id/barcodes", post(add_barcode))
        .route("/api/admin/stock/barcode/:barcode", get(lookup_barcode))
        .route("/api/admin/stock/transactions", post(create_transactions))
        // Localhost-only endpoints for development
        .route("/api/local/jwt/:user_id", get(generate_jwt))
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
