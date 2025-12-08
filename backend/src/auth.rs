use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{ErrorResponse, User};
use crate::routes::auth::AppState;

const JWT_SECRET: &[u8] = b"your-secret-key-change-this-in-production";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub exp: usize,  // expiry timestamp
    pub iat: usize,  // issued at
}

pub fn create_jwt_token(user_id: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        exp: now + 86400, // 24 hours
        iat: now,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
}

pub fn verify_jwt_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}

// Helper to extract user_id from Authorization header
pub fn extract_user_id_from_header(auth_header: Option<&str>) -> Option<String> {
    let token = auth_header?.strip_prefix("Bearer ")?;
    let claims = verify_jwt_token(token).ok()?;
    Some(claims.sub)
}

// ===== Auth Extractors =====
// These extractors automatically authenticate and authorize requests

/// Extractor for any authenticated user
pub struct AuthenticatedUser(pub User);

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = extract_user_from_request(parts, &state.db).await?;
        Ok(AuthenticatedUser(user))
    }
}

/// Extractor for committee members (is_committee = true)
pub struct CommitteeUser(pub User);

#[async_trait]
impl FromRequestParts<AppState> for CommitteeUser {
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = extract_user_from_request(parts, &state.db).await?;

        if !user.is_committee {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: "Committee access required".to_string(),
                }),
            ));
        }

        Ok(CommitteeUser(user))
    }
}

/// Extractor for admins (is_admin = true)
pub struct AdminUser(pub User);

#[async_trait]
impl FromRequestParts<AppState> for AdminUser {
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = extract_user_from_request(parts, &state.db).await?;

        if !user.is_admin {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: "Admin access required".to_string(),
                }),
            ));
        }

        Ok(AdminUser(user))
    }
}

/// Helper function to extract and fetch user from request
async fn extract_user_from_request(
    parts: &Parts,
    db: &SqlitePool,
) -> Result<User, (StatusCode, Json<ErrorResponse>)> {
    // Get auth header
    let auth_header = parts
        .headers
        .get("authorization")
        .and_then(|h| h.to_str().ok());

    // Extract user_id from JWT
    let user_id = extract_user_id_from_header(auth_header).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Not authenticated".to_string(),
            }),
        )
    })?;

    // Fetch user from database
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(db)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "User not found".to_string(),
                }),
            )
        })?;

    Ok(user)
}
