use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

// API Request/Response types (exported to TypeScript)

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct RegisterStartRequest {
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
    pub is_committee: bool,
    pub is_admin: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct ErrorResponse {
    pub error: String,
}

// Database models
#[derive(Debug, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub display_name: Option<String>,
    #[sqlx(default)]
    pub passkey_credential: Option<String>,
    pub is_committee: bool,
    #[sqlx(default)]
    pub is_admin: bool,
    pub code_of_conduct_signed: bool,
    pub food_safety_completed: bool,
    #[sqlx(default)]
    pub food_safety_certificate: Option<Vec<u8>>,
    #[sqlx(default)]
    pub food_safety_certificate_type: Option<String>,
    pub induction_completed: bool,
    pub has_contract: bool,
    pub contract_expiry_date: Option<String>,
    pub created_at: String,
    #[sqlx(default)]
    pub email: Option<String>,
    #[sqlx(default)]
    pub email_notifications_enabled: bool,
    #[sqlx(default)]
    pub privacy_consent_given: bool,
    #[sqlx(default)]
    pub supervised_shift_completed: bool,
}

#[derive(Debug, sqlx::FromRow)]
pub struct AuthState {
    pub id: String,
    pub state_type: String,
    pub state_data: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "../frontend/src/types/")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub event_date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub shift_max_volunteers: Option<i32>,
    pub shift_requires_contract: Option<bool>,
}

impl User {
    pub fn new(display_name: Option<String>, passkey_credential: Option<String>, is_committee: bool, is_admin: bool) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            display_name,
            passkey_credential,
            is_committee,
            is_admin,
            code_of_conduct_signed: false,
            food_safety_completed: false,
            food_safety_certificate: None,
            food_safety_certificate_type: None,
            induction_completed: false,
            has_contract: false,
            contract_expiry_date: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            email: None,
            email_notifications_enabled: false,
            privacy_consent_given: false,
            supervised_shift_completed: false,
        }
    }
}
