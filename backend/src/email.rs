use serde::Serialize;
use tracing::{info, error};

#[derive(Clone)]
pub struct EmailService {
    api_key: String,
    from_address: String,
    client: reqwest::Client,
}

#[derive(Debug, Serialize)]
struct SendEmailRequest {
    from: String,
    to: Vec<String>,
    subject: String,
    html: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachments: Option<Vec<EmailAttachmentPayload>>,
}

#[derive(Debug, Serialize)]
struct EmailAttachmentPayload {
    filename: String,
    content: String, // base64
    #[serde(rename = "type")]
    content_type: String,
}

pub struct EmailAttachment {
    pub filename: String,
    pub content: String, // base64
    pub content_type: String,
}

impl EmailService {
    pub fn new() -> Option<Self> {
        let api_key = std::env::var("RESEND_API_KEY").ok()?;
        let from_address = std::env::var("EMAIL_FROM")
            .unwrap_or_else(|_| "Wolfson Cellar Bar <noreply@wolfson-bar.example>".to_string());

        info!("Email service initialized with from address: {}", from_address);

        Some(Self {
            api_key,
            from_address,
            client: reqwest::Client::new(),
        })
    }

    pub async fn send_email(
        &self,
        to: &str,
        subject: &str,
        html_body: &str,
        attachment: Option<EmailAttachment>,
    ) -> Result<(), String> {
        let attachments = attachment.map(|a| {
            vec![EmailAttachmentPayload {
                filename: a.filename,
                content: a.content,
                content_type: a.content_type,
            }]
        });

        let request = SendEmailRequest {
            from: self.from_address.clone(),
            to: vec![to.to_string()],
            subject: subject.to_string(),
            html: html_body.to_string(),
            attachments,
        };

        let response = self
            .client
            .post("https://api.resend.com/emails")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Failed to send email: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("Email send failed ({}): {}", status, body);
            return Err(format!("Email send failed ({}): {}", status, body));
        }

        info!("Email sent successfully to {}", to);
        Ok(())
    }
}
