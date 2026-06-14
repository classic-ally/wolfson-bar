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
}
