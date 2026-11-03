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

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub exp: usize,  // expiry timestamp
    pub iat: usize,  // issued at
    /// Set on single-purpose tokens (e.g. a QR shown for induction). Absent on
    /// session tokens; a token with a purpose is never accepted as a session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
}

fn now_secs() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
}

fn decode_claims(token: &str, secret: &[u8]) -> Result<Claims, jsonwebtoken::errors::Error> {
    Ok(decode::<Claims>(token, &DecodingKey::from_secret(secret), &Validation::default())?.claims)
}

/// A short-lived token that only proves `user_id` for one `purpose`.
pub fn create_purpose_token(user_id: &str, purpose: &str, ttl_secs: usize, secret: &[u8]) -> Result<String, jsonwebtoken::errors::Error> {
    let now = now_secs();
    let claims = Claims {
        sub: user_id.to_string(),
        exp: now + ttl_secs,
        iat: now,
        purpose: Some(purpose.to_string()),
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret))
}

/// The user a purpose token was issued for, if it is valid and for `purpose`.
pub fn verify_purpose_token(token: &str, purpose: &str, secret: &[u8]) -> Option<String> {
    let claims = decode_claims(token, secret).ok()?;
    (claims.purpose.as_deref() == Some(purpose)).then_some(claims.sub)
}

pub fn create_jwt_token(user_id: &str, secret: &[u8]) -> Result<String, jsonwebtoken::errors::Error> {
    let now = now_secs();

    let claims = Claims {
        sub: user_id.to_string(),
        exp: now + 86400, // 24 hours
        iat: now,
        purpose: None,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
}

/// Verify a session token. Single-purpose tokens are rejected.
pub fn verify_jwt_token(token: &str, secret: &[u8]) -> Result<Claims, jsonwebtoken::errors::Error> {
    let claims = decode_claims(token, secret)?;
    if claims.purpose.is_some() {
        return Err(jsonwebtoken::errors::ErrorKind::InvalidToken.into());
    }
    Ok(claims)
}

// Helper to extract user_id from Authorization header
pub fn extract_user_id_from_header(auth_header: Option<&str>, secret: &[u8]) -> Option<String> {
    let token = auth_header?.strip_prefix("Bearer ")?;
    let claims = verify_jwt_token(token, secret).ok()?;
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
        let user = extract_user_from_request(parts, &state.db, &state.jwt_secret).await?;
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
        let user = extract_user_from_request(parts, &state.db, &state.jwt_secret).await?;

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
        let user = extract_user_from_request(parts, &state.db, &state.jwt_secret).await?;

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

/// Extractor for an enrolled kiosk device, authenticated via the `X-Kiosk-Token`
/// header. The header carries the raw device token; only its hash is stored
/// server-side. Wholly independent of the user/committee/admin login.
#[allow(dead_code)] // id/name are carried for handlers/logging that may use them
pub struct KioskDevice {
    pub id: String,
    pub name: Option<String>,
}

#[async_trait]
impl FromRequestParts<AppState> for KioskDevice {
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let unauthorized = || {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Kiosk not enrolled".to_string(),
                }),
            )
        };

        let token = parts
            .headers
            .get("x-kiosk-token")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(unauthorized)?;
        let hash = crate::routes::kiosk::hash_token(token);

        let row = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT id, name FROM kiosk_devices WHERE token_hash = ? AND revoked = 0",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            // Not a 401: the kiosk treats 401 as "revoked" and discards its token.
            tracing::error!("kiosk device lookup failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Internal error".to_string(),
                }),
            )
        })?
        .ok_or_else(unauthorized)?;

        // Best-effort liveness stamp; failure here must not block the request.
        let _ = sqlx::query("UPDATE kiosk_devices SET last_seen_at = datetime('now') WHERE id = ?")
            .bind(&row.0)
            .execute(&state.db)
            .await;

        Ok(KioskDevice {
            id: row.0,
            name: row.1,
        })
    }
}

/// Helper function to extract and fetch user from request
async fn extract_user_from_request(
    parts: &Parts,
    db: &SqlitePool,
    jwt_secret: &[u8],
) -> Result<User, (StatusCode, Json<ErrorResponse>)> {
    // Get auth header
    let auth_header = parts
        .headers
        .get("authorization")
        .and_then(|h| h.to_str().ok());

    // Extract user_id from JWT
    let user_id = extract_user_id_from_header(auth_header, jwt_secret).ok_or_else(|| {
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

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = &[1u8; 32];

    // Impact: the induction QR is shown on a phone screen; if it were a session
    // token, anyone who photographed it could act as the member.
    // Should not: accept a single-purpose token as a session.
    #[test]
    fn purpose_token_is_not_a_session() {
        let qr = create_purpose_token("member", "induction", 300, SECRET).unwrap();
        assert!(verify_jwt_token(&qr, SECRET).is_err());
    }

    // Should: accept a purpose token only for its own purpose.
    // Should not: accept a session token as proof for a purpose.
    #[test]
    fn purpose_token_only_proves_its_purpose() {
        let qr = create_purpose_token("member", "induction", 300, SECRET).unwrap();
        assert_eq!(verify_purpose_token(&qr, "induction", SECRET).as_deref(), Some("member"));
        assert_eq!(verify_purpose_token(&qr, "food_safety", SECRET), None);
        let session = create_jwt_token("member", SECRET).unwrap();
        assert_eq!(verify_purpose_token(&session, "induction", SECRET), None);
    }
}
