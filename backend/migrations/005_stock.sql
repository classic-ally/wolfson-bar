-- Stock Management System
-- Tracks inventory levels, purchases, and removals for bar stock
--
-- Transaction type is inferred from quantity and unit_cost:
-- - quantity > 0 + unit_cost present = purchase
-- - quantity < 0 = removal
-- - quantity > 0 + no unit_cost = adjustment

-- Products table: Core product information with user-defined PoS IDs
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY NOT NULL,  -- User-entered PoS ID (not auto-increment)
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,  -- beer, wine, spirits, soft_drinks, snacks, etc.
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Stock transactions: Audit trail of all inventory changes
CREATE TABLE IF NOT EXISTS stock_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity_change INTEGER NOT NULL,  -- Positive for purchases, negative for removals
    unit_cost REAL,  -- Only populated for purchases
    notes TEXT,
    user_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Product barcodes: Maps barcodes to products (many-to-one relationship)
CREATE TABLE IF NOT EXISTS product_barcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    barcode TEXT NOT NULL UNIQUE,  -- Barcode value (EAN-13, UPC-A, etc.)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_stock_transactions_product ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_created ON stock_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);

-- Trigger to update updated_at on products
CREATE TRIGGER IF NOT EXISTS update_products_timestamp
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
    UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
