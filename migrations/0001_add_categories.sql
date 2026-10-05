CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

ALTER TABLE products
ADD COLUMN category_id INTEGER REFERENCES categories(id);

CREATE INDEX idx_products_category_id ON products(category_id);
