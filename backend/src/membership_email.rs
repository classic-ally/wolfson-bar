//! Membership emails: admin-editable markdown templates with {{placeholders}},
//! rendered for one member. Placeholders are substituted into the markdown
//! before rendering, with member-supplied text escaped, so nothing a member
//! types can inject markup. Raw HTML in a template is shown as text.

use pulldown_cmark::{html, Event, Options, Parser};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::User;

/// Every membership email, in the order they're shown to admins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TemplateKey {
    PostInduction,
    ReadyToBook,
    WelcomeToRota,
    StuckReminder,
    CocResign,
}

impl TemplateKey {
    pub const ALL: [TemplateKey; 5] = [
        TemplateKey::PostInduction,
        TemplateKey::ReadyToBook,
        TemplateKey::WelcomeToRota,
        TemplateKey::StuckReminder,
        TemplateKey::CocResign,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            TemplateKey::PostInduction => "post_induction",
            TemplateKey::ReadyToBook => "ready_to_book",
            TemplateKey::WelcomeToRota => "welcome_to_rota",
            TemplateKey::StuckReminder => "stuck_reminder",
            TemplateKey::CocResign => "coc_resign",
        }
    }

    pub fn parse(key: &str) -> Option<TemplateKey> {
        Self::ALL.into_iter().find(|k| k.as_str() == key)
    }
}

/// Placeholders a template body may use. Block placeholders expand to a list
/// and belong on a line of their own.
pub const BODY_PLACEHOLDERS: &[&str] =
    &["name", "next_steps", "food_safety_links", "onboarding_url", "calendar_url"];
/// Subjects are plain text, so only the member's name is offered.
pub const SUBJECT_PLACEHOLDERS: &[&str] = &["name"];

/// Every `{{placeholder}}` in `text` that isn't in `allowed`, in order of appearance.
pub fn unknown_placeholders(text: &str, allowed: &[&str]) -> Vec<String> {
    let mut unknown = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        let name = after[..end].trim();
        if !allowed.contains(&name) && !unknown.iter().any(|u| u == name) {
            unknown.push(name.to_string());
        }
        rest = &after[end + 2..];
    }
    unknown
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct TrainingLink {
    pub label: String,
    pub url: String,
}

/// Where a member is in onboarding, as the next-steps checklist sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub coc_signed: bool,
    /// Signed an earlier version and must re-sign.
    pub coc_resign: bool,
    pub inducted: bool,
    pub certificate_uploaded: bool,
    pub certificate_approved: bool,
    pub supervised: bool,
}

impl Progress {
    pub fn of(user: &User) -> Self {
        Self {
            coc_signed: user.code_of_conduct_signed,
            coc_resign: !user.code_of_conduct_signed && user.code_of_conduct_version.is_some(),
            inducted: user.induction_completed,
            certificate_uploaded: user.food_safety_certificate.is_some(),
            certificate_approved: user.food_safety_completed,
            supervised: user.supervised_shift_completed,
        }
    }

    /// A member partway through onboarding, used for previews and test sends.
    pub const SAMPLE: Progress = Progress {
        coc_signed: true,
        coc_resign: false,
        inducted: true,
        certificate_uploaded: false,
        certificate_approved: false,
        supervised: false,
    };
}

pub struct Context<'a> {
    pub name: &'a str,
    pub progress: Progress,
    pub links: &'a [TrainingLink],
    pub public_url: &'a str,
}

impl Context<'_> {
    fn onboarding_url(&self) -> String {
        format!("{}/profile/induction", self.public_url)
    }

    fn calendar_url(&self) -> String {
        format!("{}/events", self.public_url)
    }

    fn settings_url(&self) -> String {
        format!("{}/profile/account", self.public_url)
    }
}

/// Backslash-escape ASCII punctuation so text renders literally in CommonMark.
fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        // Newlines would let a value start new markdown blocks.
        out.push(if c == '\n' || c == '\r' { ' ' } else { c });
    }
    out
}

fn link(label: &str, url: &str) -> String {
    format!("[{}](<{}>)", escape_markdown(label), url)
}

fn next_steps(ctx: &Context) -> String {
    let p = ctx.progress;
    let onboarding = ctx.onboarding_url();
    let coc = if p.coc_signed {
        "✅ **Code of Conduct**: signed".to_string()
    } else if p.coc_resign {
        format!("☐ **Code of Conduct**: {}", link("re-sign the updated version", &onboarding))
    } else {
        format!("☐ **Code of Conduct**: {}", link("read and sign it", &onboarding))
    };
    let induction = if p.inducted {
        "✅ **Induction**: done".to_string()
    } else {
        format!("☐ **Induction**: {}", link("sign up for an induction session", &ctx.calendar_url()))
    };
    let food = if p.certificate_approved {
        "✅ **Food safety certificate**: approved".to_string()
    } else if p.certificate_uploaded {
        "⏳ **Food safety certificate**: uploaded, waiting for committee approval".to_string()
    } else {
        format!(
            "☐ **Food safety certificate**: complete the training and {}",
            link("upload your certificate", &onboarding)
        )
    };
    let supervised = if p.supervised {
        "✅ **Supervised shift**: done".to_string()
    } else {
        format!(
            "☐ **Supervised shift**: book a shift with a committee member (dates with a green **S** on the {})",
            link("calendar", &ctx.calendar_url())
        )
    };
    [coc, induction, food, supervised].map(|item| format!("- {item}")).join("\n")
}

fn food_safety_links(ctx: &Context) -> String {
    ctx.links
        .iter()
        .map(|l| format!("- {}", link(&l.label, &l.url)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn substitute(template: &str, ctx: &Context, plain: bool) -> String {
    let name = if plain { ctx.name.to_string() } else { escape_markdown(ctx.name) };
    let mut out = template.replace("{{name}}", &name);
    if !plain {
        out = out
            .replace("{{next_steps}}", &next_steps(ctx))
            .replace("{{food_safety_links}}", &food_safety_links(ctx))
            .replace("{{onboarding_url}}", &ctx.onboarding_url())
            .replace("{{calendar_url}}", &ctx.calendar_url());
    }
    out
}

fn markdown_to_html(markdown: &str) -> String {
    let parser = Parser::new_ext(markdown, Options::ENABLE_STRIKETHROUGH).map(|event| match event {
        // Show raw HTML as text rather than passing it into the email.
        Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
        // Keep line breaks as typed, e.g. in a sign-off; committee members
        // editing these won't expect markdown to join lines.
        Event::SoftBreak => Event::HardBreak,
        other => other,
    });
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

/// Render a template for one member: the subject line and the HTML body.
pub fn render(subject: &str, body: &str, ctx: &Context) -> (String, String) {
    let subject = substitute(subject, ctx, true);
    let content = markdown_to_html(&substitute(body, ctx, false));
    let html = format!(
        r#"<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #222; max-width: 600px;">
{content}<hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0 12px;">
<p style="color: #888; font-size: 12px;">You're receiving this because Membership emails are turned on for your Wolfson Cellar Bar account. You can turn them off in your <a href="{settings}" style="color: #888;">account settings</a>.</p>
</div>"#,
        settings = ctx.settings_url(),
    );
    (subject, html)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(name: &'a str, links: &'a [TrainingLink]) -> Context<'a> {
        Context { name, progress: Progress::SAMPLE, links, public_url: "https://bar.example" }
    }

    // Should: report placeholders a template uses that aren't offered, once each.
    #[test]
    fn finds_unknown_placeholders() {
        let text = "Hi {{name}} {{nmae}}, see {{ calendar_url }} and {{nmae}} {{oops}}";
        assert_eq!(unknown_placeholders(text, BODY_PLACEHOLDERS), vec!["nmae", "oops"]);
        assert_eq!(unknown_placeholders("{{next_steps}}", SUBJECT_PLACEHOLDERS), vec!["next_steps"]);
    }

    // Impact: display names are member-controlled and land in emails sent
    // from the bar's address, so they must not be able to add links or markup.
    // Should not: let a member's name inject HTML or markdown links into an email.
    #[test]
    fn escapes_member_names() {
        let (_, html) = render("Hi", "Hi {{name}}", &ctx("<b>Evil</b> [click](https://x.example)", &[]));
        assert!(html.contains("&lt;b&gt;Evil&lt;/b&gt;"));
        assert!(!html.contains("<a href=\"https://x.example\""));
    }

    // Should: show raw HTML written into a template as text.
    #[test]
    fn escapes_template_html() {
        let (_, html) = render("Hi", "<script>alert(1)</script>", &ctx("Sam", &[]));
        assert!(!html.contains("<script>"));
    }

    // Should: link the URL placeholders and the training links.
    // Should: keep the subject as plain text with the member's name.
    #[test]
    fn fills_placeholders() {
        let links = [TrainingLink { label: "Part A".into(), url: "https://train.example/a#/".into() }];
        let (subject, html) = render(
            "Welcome {{name}}",
            "See the [calendar]({{calendar_url}}).\n\n{{food_safety_links}}",
            &ctx("Sam O'Neil", &links),
        );
        assert_eq!(subject, "Welcome Sam O'Neil");
        assert!(html.contains(r#"<a href="https://bar.example/events">calendar</a>"#));
        assert!(html.contains(r#"<a href="https://train.example/a#/">Part A</a>"#));
    }

    // Should: keep single line breaks, so a multi-line sign-off stays on separate lines.
    #[test]
    fn keeps_line_breaks() {
        let (_, html) = render("", "Thanks,\nBarCo", &ctx("Sam", &[]));
        assert!(html.contains("Thanks,<br />\nBarCo"));
    }

    // Should: tick completed steps and say what's left for the others.
    // Should: show an uploaded certificate as waiting for approval.
    #[test]
    fn next_steps_follow_progress() {
        let mut c = ctx("Sam", &[]);
        c.progress.certificate_uploaded = true;
        let (_, html) = render("", "{{next_steps}}", &c);
        assert!(html.contains("✅ <strong>Code of Conduct</strong>: signed"));
        assert!(html.contains("✅ <strong>Induction</strong>: done"));
        assert!(html.contains("⏳ <strong>Food safety certificate</strong>: uploaded"));
        assert!(html.contains("☐ <strong>Supervised shift</strong>"));
    }
}
