-- ============================================================================
-- schema.sql — Cloudflare D1 (SQLite) schema cho dự án E-commerce
-- Chạy local:  wrangler d1 execute ecommerce-db --local  --file=./schema.sql
-- Chạy remote: wrangler d1 execute ecommerce-db --remote --file=./schema.sql
-- ============================================================================

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- ----------------------------------------------------------------------------
-- categories: danh mục sản phẩm
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

-- ----------------------------------------------------------------------------
-- users: tài khoản khách hàng và quản trị viên
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);

-- ----------------------------------------------------------------------------
-- Danh mục phù hợp với các sản phẩm mẫu bên dưới
-- ----------------------------------------------------------------------------
INSERT INTO categories (name) VALUES ('Bàn phím'), ('Chuột'), ('Tai nghe'), ('Màn hình');

-- ----------------------------------------------------------------------------
-- products: sản phẩm, ảnh lưu trên R2 (image_url trỏ tới /images/<key>)
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       REAL NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url   TEXT,
  category_id INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX idx_products_created_at ON products(created_at);
CREATE INDEX idx_products_category_id ON products(category_id);

-- ----------------------------------------------------------------------------
-- orders: đơn hàng của user
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  total_price       REAL NOT NULL CHECK (total_price >= 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  shipping_address  TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- ----------------------------------------------------------------------------
-- order_items: chi tiết từng sản phẩm trong đơn hàng
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL,
  product_id  INTEGER NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  price       REAL NOT NULL CHECK (price >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- ----------------------------------------------------------------------------
-- Dữ liệu mẫu (tuỳ chọn) — xoá phần này nếu không cần seed data
-- ----------------------------------------------------------------------------
INSERT INTO products (name, description, price, stock, image_url, category_id) VALUES
  ('Bàn phím cơ Akko 3068B', 'Bàn phím cơ 68 phím, hotswap, kết nối Bluetooth 5.0', 890000, 25, NULL, (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Chuột không dây Logitech M650', 'Chuột không dây êm ái, pin 24 tháng', 450000, 40, NULL, (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Tai nghe Sony WH-1000XM4', 'Tai nghe chống ồn chủ động, âm thanh Hi-Res', 5990000, 10, NULL, (SELECT id FROM categories WHERE name = 'Tai nghe')),
  ('Màn hình LG 27 inch 2K', 'Màn hình IPS 2560x1440, 75Hz, viền mỏng', 4290000, 15, NULL, (SELECT id FROM categories WHERE name = 'Màn hình'));
