use axum::{
    extract::{State, Path},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, error};

use crate::auth::CommitteeUser;
use crate::models::ErrorResponse;
use crate::routes::auth::AppState;

// ===== Request/Response Models =====

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Product {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductWithStock {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    // i64: the SUM of i32 changes can exceed i32.
    pub current_stock: i64,
    pub last_unit_cost: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProductRequest {
    pub name: String,
    pub description: Option<String>,
    pub category: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductBarcode {
    pub id: i32,
    pub product_id: i32,
    pub barcode: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddBarcodeRequest {
    pub barcode: String,
}

#[derive(Debug, Deserialize)]
pub struct TransactionItem {
    pub product_id: i32,
    pub quantity: i32,  // Positive = add stock, Negative = remove stock
    pub unit_cost: Option<f64>,  // Required when quantity > 0 and it's a purchase (not adjustment)
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionsRequest {
    pub transactions: Vec<TransactionItem>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionResponse {
    pub success: bool,
    pub transactions_created: usize,
}

/// Largest stock change accepted in one transaction line, either direction.
const MAX_QUANTITY_CHANGE: i32 = 100_000;
/// Most lines accepted in one bulk transaction request.
const MAX_TRANSACTIONS: usize = 500;

// ===== Route Handlers =====

// POST /api/admin/stock/products/:id
// Create a new product with specified PoS ID
pub async fn create_product(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Path(id): Path<i32>,
    Json(req): Json<CreateProductRequest>,
) -> Result<Json<Product>, (StatusCode, Json<ErrorResponse>)> {
    info!("📦 Creating product with ID {}: {}", id, req.name);

    // Check if product ID already exists
    let existing = sqlx::query_scalar::<_, i32>("SELECT COUNT(*) FROM products WHERE id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("Database error checking product existence: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error".to_string(),
                }),
            )
        })?;

    if existing > 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: format!("Product with PoS ID {} already exists", id),
            }),
        ));
    }

    // Insert the product
    sqlx::query(
        "INSERT INTO products (id, name, description, category) VALUES (?, ?, ?, ?)"
    )
    .bind(id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.category)
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to create product: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to create product".to_string(),
            }),
        )
    })?;

    // Fetch and return the created product
    let product = sqlx::query_as::<_, Product>("SELECT * FROM products WHERE id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to fetch created product: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch product".to_string(),
                }),
            )
        })?;

    info!("✅ Created product {}: {}", id, req.name);
    Ok(Json(product))
}

// GET /api/admin/stock/barcode/:barcode
// Look up product by barcode with stock information
pub async fn lookup_barcode(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Path(barcode): Path<String>,
) -> Result<Json<ProductWithStock>, (StatusCode, Json<ErrorResponse>)> {
    info!("🔍 Looking up barcode: {}", barcode);

    let product = sqlx::query_as::<_, ProductWithStock>(
        "SELECT
            p.id,
            p.name,
            p.description,
            p.category,
            COALESCE(SUM(st.quantity_change), 0) as current_stock,
            (SELECT unit_cost FROM stock_transactions
             WHERE product_id = p.id AND unit_cost IS NOT NULL
             ORDER BY created_at DESC LIMIT 1) as last_unit_cost,
            p.created_at,
            p.updated_at
         FROM products p
         JOIN product_barcodes pb ON p.id = pb.product_id
         LEFT JOIN stock_transactions st ON p.id = st.product_id
         WHERE pb.barcode = ?
         GROUP BY p.id"
    )
    .bind(&barcode)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        error!("Database error looking up barcode: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Database error".to_string(),
            }),
        )
    })?;

    match product {
        Some(p) => {
            info!("✅ Found product for barcode {}: {} (stock: {})", barcode, p.name, p.current_stock);
            Ok(Json(p))
        }
        None => {
            info!("❌ No product found for barcode: {}", barcode);
            Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Barcode not found".to_string(),
                }),
            ))
        }
    }
}

// POST /api/admin/stock/products/:id/barcodes
// Link a barcode to a product
pub async fn add_barcode(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
    Path(product_id): Path<i32>,
    Json(req): Json<AddBarcodeRequest>,
) -> Result<Json<ProductBarcode>, (StatusCode, Json<ErrorResponse>)> {
    info!("🏷️ Adding barcode {} to product {}", req.barcode, product_id);

    // Check if product exists
    let product_exists = sqlx::query_scalar::<_, i32>("SELECT COUNT(*) FROM products WHERE id = ?")
        .bind(product_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            error!("Database error checking product existence: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Database error".to_string(),
                }),
            )
        })?;

    if product_exists == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Product {} not found", product_id),
            }),
        ));
    }

    // Check if barcode already exists
    let existing_barcode = sqlx::query_as::<_, ProductBarcode>(
        "SELECT * FROM product_barcodes WHERE barcode = ?"
    )
    .bind(&req.barcode)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        error!("Database error checking barcode: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Database error".to_string(),
            }),
        )
    })?;

    if let Some(existing) = existing_barcode {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: format!("Barcode already linked to product {}", existing.product_id),
            }),
        ));
    }

    // Insert the barcode
    sqlx::query("INSERT INTO product_barcodes (product_id, barcode) VALUES (?, ?)")
        .bind(product_id)
        .bind(&req.barcode)
        .execute(&state.db)
        .await
        .map_err(|e| {
            error!("Failed to add barcode: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to add barcode".to_string(),
                }),
            )
        })?;

    // Fetch and return the created barcode
    let barcode = sqlx::query_as::<_, ProductBarcode>(
        "SELECT * FROM product_barcodes WHERE barcode = ?"
    )
    .bind(&req.barcode)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch created barcode: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch barcode".to_string(),
            }),
        )
    })?;

    info!("✅ Added barcode {} to product {}", req.barcode, product_id);
    Ok(Json(barcode))
}

// POST /api/admin/stock/transactions
// Create bulk stock transactions (purchases, removals, adjustments)
pub async fn create_transactions(
    State(state): State<AppState>,
    CommitteeUser(user): CommitteeUser,
    Json(req): Json<CreateTransactionsRequest>,
) -> Result<Json<TransactionResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("📝 Creating {} stock transactions", req.transactions.len());

    let bad = |error: String| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error }));
    if req.transactions.len() > MAX_TRANSACTIONS {
        return Err(bad(format!("At most {MAX_TRANSACTIONS} transactions per request")));
    }
    for item in &req.transactions {
        if item.quantity.unsigned_abs() > MAX_QUANTITY_CHANGE as u32 {
            return Err(bad(format!("Quantity must be between -{MAX_QUANTITY_CHANGE} and {MAX_QUANTITY_CHANGE}")));
        }
        if item.unit_cost.is_some_and(|c| !c.is_finite() || c < 0.0) {
            return Err(bad("Unit cost must be a non-negative number".to_string()));
        }
    }
    let user_id = user.id;

    // Start a transaction
    let mut tx = state.db.begin().await.map_err(|e| {
        error!("Failed to start transaction: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Database error".to_string(),
            }),
        )
    })?;

    let mut transactions_created = 0;

    for item in req.transactions {
        // Check if product exists
        let product_exists = sqlx::query_scalar::<_, i32>("SELECT COUNT(*) FROM products WHERE id = ?")
            .bind(item.product_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                error!("Database error checking product: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Database error".to_string(),
                    }),
                )
            })?;

        if product_exists == 0 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("Product {} not found", item.product_id),
                }),
            ));
        }

        // Insert transaction (quantity can be positive or negative)
        sqlx::query(
            "INSERT INTO stock_transactions (product_id, quantity_change, unit_cost, notes, user_id)
             VALUES (?, ?, ?, ?, ?)"
        )
        .bind(item.product_id)
        .bind(item.quantity)
        .bind(item.unit_cost)
        .bind(&req.notes)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            error!("Failed to create transaction: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to create transaction".to_string(),
                }),
            )
        })?;

        transactions_created += 1;
    }

    // Commit the transaction
    tx.commit().await.map_err(|e| {
        error!("Failed to commit transactions: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to commit transactions".to_string(),
            }),
        )
    })?;

    info!("✅ Created {} stock transactions", transactions_created);
    Ok(Json(TransactionResponse {
        success: true,
        transactions_created,
    }))
}

// GET /api/admin/stock/products
// List all products with current stock levels
pub async fn get_products(
    State(state): State<AppState>,
    CommitteeUser(_): CommitteeUser,
) -> Result<Json<Vec<ProductWithStock>>, (StatusCode, Json<ErrorResponse>)> {
    info!("📋 Fetching all products with stock levels");

    let products = sqlx::query_as::<_, ProductWithStock>(
        "SELECT
            p.id,
            p.name,
            p.description,
            p.category,
            COALESCE(SUM(st.quantity_change), 0) as current_stock,
            (SELECT unit_cost FROM stock_transactions
             WHERE product_id = p.id AND unit_cost IS NOT NULL
             ORDER BY created_at DESC LIMIT 1) as last_unit_cost,
            p.created_at,
            p.updated_at
         FROM products p
         LEFT JOIN stock_transactions st ON p.id = st.product_id
         GROUP BY p.id
         ORDER BY p.name"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch products: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to fetch products".to_string(),
            }),
        )
    })?;

    info!("✅ Fetched {} products", products.len());
    Ok(Json(products))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{get_req, insert_user, test_state, token_for, user_with};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    // Impact: stock routes had no auth check, so anyone could read costs and
    // change products and barcodes.
    // Should: refuse the stock list to anonymous callers and to members who aren't on the committee.
    #[tokio::test]
    async fn stock_requires_committee() {
        let state = test_state().await;
        let member = user_with(true, true, true, true);
        insert_user(&state.db, &member).await;
        let app = Router::new()
            .route("/api/admin/stock/products", get(get_products))
            .with_state(state.clone());

        let anon = app.clone().oneshot(get_req("/api/admin/stock/products", None, None)).await.unwrap();
        assert_eq!(anon.status(), StatusCode::UNAUTHORIZED);
        let token = token_for(&state, &member);
        let res = app.oneshot(get_req("/api/admin/stock/products", Some(&token), None)).await.unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }

    // Should: reject a stock change outside the allowed quantity range.
    #[tokio::test]
    async fn oversized_quantity_is_refused() {
        let state = test_state().await;
        let mut committee = user_with(true, true, true, true);
        committee.is_committee = true;
        let req = CreateTransactionsRequest {
            transactions: vec![TransactionItem { product_id: 1, quantity: i32::MAX, unit_cost: None }],
            notes: None,
        };
        let (status, _) = create_transactions(State(state), CommitteeUser(committee), Json(req))
            .await
            .expect_err("quantity out of range");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
