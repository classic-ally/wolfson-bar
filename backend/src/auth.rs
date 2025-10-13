use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

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
