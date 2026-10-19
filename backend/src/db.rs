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
    ("011_backfill_certificate_type", include_str!("../migrations/011_backfill_certificate_type.sql"), &[]),
    ("012_kiosk", include_str!("../migrations/012_kiosk.sql"), &["duplicate column", "already exists"]),
    ("013_kiosk_pairing_meta", include_str!("../migrations/013_kiosk_pairing_meta.sql"), &["duplicate column"]),
    ("014_coc_versions", include_str!("../migrations/014_coc_versions.sql"), &["duplicate column"]),
    ("015_email_categories", include_str!("../migrations/015_email_categories.sql"), &["duplicate column"]),
];

pub async fn run_migrations(db: &SqlitePool) {
    for (name, sql, ignorable_errors) in MIGRATIONS {
        if already_applied(db, name).await {
            tracing::info!("Migration {} already applied", name);
            continue;
        }
        match sqlx::query(sql).execute(db).await {
            Ok(_) => tracing::info!("Migration {} applied", name),
            Err(e) if ignorable_errors.iter().any(|ie| e.to_string().contains(ie)) => {
                tracing::info!("Migration {} already applied", name);
            }
            Err(e) => panic!("Failed to run migration {}: {}", name, e),
        }
    }
}

/// Detects migrations whose re-run is neither a cheap no-op nor an ignorable error.
async fn already_applied(db: &SqlitePool, name: &str) -> bool {
    match name {
        // 009 recreates `users` from a fixed column list. Re-running it rewrites the
        // whole table (minutes on production, site down meanwhile) and drops every
        // column added after it, which later migrations then re-add with defaults.
        "009_optional_passkey" => sqlx::query_scalar(
            "SELECT \"notnull\" = 0 FROM pragma_table_info('users') WHERE name = 'passkey_credential'",
        )
        .fetch_optional(db)
        .await
        .expect("inspect users schema")
        .unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod backfill_tests {
    use crate::test_util::{insert_user, user_with_role};
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    /// Dedicated shared-cache in-memory DB with several connections, so
    /// this test never contends on `test_state`'s single-connection pool.
    /// Unique name keeps it isolated from other tests' shared caches.
    async fn fresh_db() -> SqlitePool {
        let url = "sqlite:file:backfill_011_test?mode=memory&cache=shared";
        let db = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(url)
            .await
            .expect("connect shared in-memory sqlite");
        super::run_migrations(&db).await;
        db
    }

    const PDF: &[u8] = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\nx\n%%EOF";
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    async fn set_cert(db: &sqlx::SqlitePool, id: &str, bytes: &[u8], ty: Option<&str>) {
        sqlx::query(
            "UPDATE users SET food_safety_certificate = ?, food_safety_certificate_type = ? WHERE id = ?",
        )
        .bind(bytes)
        .bind(ty)
        .bind(id)
        .execute(db)
        .await
        .unwrap();
    }

    async fn run_011(db: &sqlx::SqlitePool, sql: &str) {
        for chunk in sql.split(';') {
            // Drop comment-only lines so a leading comment block doesn't
            // mask the statement that follows it.
            let stmt: String = chunk
                .lines()
                .filter(|l| !l.trim_start().starts_with("--"))
                .collect::<Vec<_>>()
                .join("\n");
            let stmt = stmt.trim();
            if stmt.is_empty() {
                continue;
            }
            sqlx::query(stmt).execute(db).await.unwrap();
        }
    }

    async fn ty_of(db: &sqlx::SqlitePool, id: &str) -> Option<String> {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT food_safety_certificate_type FROM users WHERE id = ?",
        )
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn migration_011_backfills_from_bytes_and_is_idempotent() {
        let db = fresh_db().await;
        let sql = include_str!("../migrations/011_backfill_certificate_type.sql");

        let mut pdf_null = user_with_role(false, false);
        pdf_null.id = "pdf-null".into();
        insert_user(&db, &pdf_null).await;
        set_cert(&db, &pdf_null.id, PDF, None).await;

        let mut pdf_wrong = user_with_role(false, false);
        pdf_wrong.id = "pdf-wrong".into();
        insert_user(&db, &pdf_wrong).await;
        set_cert(&db, &pdf_wrong.id, PDF, Some("image/jpeg")).await;

        let mut png_null = user_with_role(false, false);
        png_null.id = "png-null".into();
        insert_user(&db, &png_null).await;
        set_cert(&db, &png_null.id, PNG, None).await;

        let mut jpeg_ok = user_with_role(false, false);
        jpeg_ok.id = "jpeg-ok".into();
        insert_user(&db, &jpeg_ok).await;
        set_cert(&db, &jpeg_ok.id, JPEG, Some("image/jpeg")).await;

        // fresh_db already ran 011 on the empty schema; re-applying its
        // statements is exactly what an upgrade does to existing rows.
        run_011(&db, sql).await;

        assert_eq!(ty_of(&db, "pdf-null").await.as_deref(), Some("application/pdf"));
        assert_eq!(ty_of(&db, "pdf-wrong").await.as_deref(), Some("application/pdf"));
        assert_eq!(ty_of(&db, "png-null").await.as_deref(), Some("image/png"));
        assert_eq!(ty_of(&db, "jpeg-ok").await.as_deref(), Some("image/jpeg"));

        // Idempotent: a second pass changes nothing.
        run_011(&db, sql).await;
        assert_eq!(ty_of(&db, "pdf-wrong").await.as_deref(), Some("application/pdf"));
        assert_eq!(ty_of(&db, "jpeg-ok").await.as_deref(), Some("image/jpeg"));
    }

    // Impact: members who signed before versioning existed must not be asked
    // to re-sign just because the schema changed.
    // Should: mark members who had signed as having signed version 1, seeded from the old text.
    // Should not: give a version to members who never signed, or change anything on re-run.
    #[tokio::test]
    async fn migration_014_backfills_existing_signatures() {
        let url = "sqlite:file:backfill_014_test?mode=memory&cache=shared";
        let db = SqlitePoolOptions::new().max_connections(5).connect(url).await.unwrap();
        for (_, sql, _) in &super::MIGRATIONS[..13] {
            sqlx::query(sql).execute(&db).await.unwrap();
        }
        for (id, signed) in [("signed", true), ("unsigned", false)] {
            sqlx::query(
                "INSERT INTO users (id, is_committee, code_of_conduct_signed, food_safety_completed,
                 induction_completed, has_contract, created_at) VALUES (?, 0, ?, 0, 0, 0, '')",
            )
            .bind(id)
            .bind(signed)
            .execute(&db)
            .await
            .unwrap();
        }

        super::run_migrations(&db).await;
        super::run_migrations(&db).await;

        let versions: Vec<(String, Option<i64>)> =
            sqlx::query_as("SELECT id, code_of_conduct_version FROM users ORDER BY id")
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(
            versions,
            vec![("signed".to_string(), Some(1)), ("unsigned".to_string(), None)]
        );
        let body: String = sqlx::query_scalar("SELECT body FROM coc_versions WHERE version = 1")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(body.starts_with("# Wolfson Cellar Bar - Code of Conduct"));
        assert!(body.contains("Members' Understanding"));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM coc_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    // Impact: 009 rebuilt `users` on every startup, taking the site down for minutes
    // and resetting columns added after it (supervised shifts, CoC version and date).
    // Should: keep members' data and the existing users table intact when migrations run again.
    #[tokio::test]
    async fn rerunning_migrations_preserves_users() {
        let url = "sqlite:file:rerun_009_test?mode=memory&cache=shared";
        let db = SqlitePoolOptions::new().max_connections(5).connect(url).await.unwrap();
        super::run_migrations(&db).await;
        sqlx::query(
            "INSERT INTO users (id, is_committee, code_of_conduct_signed, code_of_conduct_version,
             code_of_conduct_signed_at, food_safety_completed, induction_completed,
             supervised_shift_completed, has_contract, created_at)
             VALUES ('member', 0, 1, 2, '2026-10-08T12:00:00Z', 0, 1, 0, 0, '')",
        )
        .execute(&db)
        .await
        .unwrap();
        // Recreating the table would drop this index along with it.
        sqlx::query("CREATE INDEX rerun_marker ON users(email)").execute(&db).await.unwrap();

        super::run_migrations(&db).await;

        let row: (Option<i64>, Option<String>, bool) = sqlx::query_as(
            "SELECT code_of_conduct_version, code_of_conduct_signed_at, supervised_shift_completed
             FROM users WHERE id = 'member'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(row, (Some(2), Some("2026-10-08T12:00:00Z".to_string()), false));
        let marker: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'rerun_marker'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(marker, 1);
    }

    // Impact: members who turned emails off before the categories split must
    // not start receiving onboarding emails they never agreed to.
    // Should: carry each member's existing email choice into both categories.
    // Should: turn both categories on for members who join after the split.
    #[tokio::test]
    async fn email_categories_inherit_existing_choice() {
        let url = "sqlite:file:email_categories_015_test?mode=memory&cache=shared";
        let db = SqlitePoolOptions::new().max_connections(5).connect(url).await.unwrap();
        // Bring the schema up to just before 015, ignoring the same re-run
        // errors the real runner tolerates.
        for (_, sql, _) in super::MIGRATIONS.iter().take_while(|(name, ..)| *name != "015_email_categories") {
            let _ = sqlx::query(sql).execute(&db).await;
        }
        sqlx::query(
            "INSERT INTO users (id, created_at, email_notifications_enabled)
             VALUES ('opted-out', '', 0), ('opted-in', '', 1)",
        )
        .execute(&db)
        .await
        .unwrap();

        super::run_migrations(&db).await;
        sqlx::query("INSERT INTO users (id, created_at) VALUES ('newcomer', '')")
            .execute(&db)
            .await
            .unwrap();

        let rows: Vec<(String, bool, bool)> = sqlx::query_as(
            "SELECT id, email_notifications_enabled, email_membership FROM users ORDER BY id",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("newcomer".to_string(), true, true),
                ("opted-in".to_string(), true, true),
                ("opted-out".to_string(), false, false),
            ]
        );
    }
}
