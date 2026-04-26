use sqlx::SqlitePool;

const MIGRATIONS: &[(&str, &str, &[&str])] = &[
    ("001_init", include_str!("../migrations/001_init.sql"), &[]),
    ("002_events", include_str!("../migrations/002_events.sql"), &[]),
    ("003_shifts", include_str!("../migrations/003_shifts.sql"), &["duplicate column"]),
    ("004_calendar", include_str!("../migrations/004_calendar.sql"), &["duplicate column", "already exists"]),
    ("005_stock", include_str!("../migrations/005_stock.sql"), &["already exists"]),
    ("006_certificate_type", include_str!("../migrations/006_certificate_type.sql"), &["duplicate column"]),
    ("007_admin_role", include_str!("../migrations/007_admin_role.sql"), &["duplicate column"]),
    ("008_email", include_str!("../migrations/008_email.sql"), &["duplicate column", "already exists"]),
    ("009_optional_passkey", include_str!("../migrations/009_optional_passkey.sql"), &["already exists"]),
    ("010_induction", include_str!("../migrations/010_induction.sql"), &["duplicate column", "already exists"]),
];

pub async fn run_migrations(db: &SqlitePool) {
    for (name, sql, ignorable_errors) in MIGRATIONS {
        match sqlx::query(sql).execute(db).await {
            Ok(_) => tracing::info!("Migration {} applied", name),
            Err(e) if ignorable_errors.iter().any(|ie| e.to_string().contains(ie)) => {
                tracing::info!("Migration {} already applied", name);
            }
            Err(e) => panic!("Failed to run migration {}: {}", name, e),
        }
    }
}
