use axum::{
    extract::{State, Path, ConnectInfo},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use tracing::{info, warn};
use std::net::SocketAddr;

use crate::auth::create_jwt_token;
use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;

#[derive(Debug, Serialize)]
pub struct JwtResponse {
    pub token: String,
    pub user_id: String,
}

/// Generate a JWT for a user (localhost only)
/// This endpoint is for local development/testing only
pub async fn generate_jwt(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<JwtResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Only allow from localhost
    if !addr.ip().is_loopback() {
        warn!("🚫 Rejected local JWT generation from non-localhost: {}", addr.ip());
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "This endpoint is only accessible from localhost".to_string(),
            }),
        ));
    }

    info!("🔑 Generating JWT for user: {} (from localhost)", user_id);

    // Verify user exists
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "User not found".to_string(),
                }),
            )
        })?;

    // Generate JWT
    let token = create_jwt_token(&user_id).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create JWT: {}", e),
            }),
        )
    })?;

    info!("✅ Generated JWT for user: {}", user_id);

    Ok(Json(JwtResponse {
        token,
        user_id: user.id,
    }))
}
