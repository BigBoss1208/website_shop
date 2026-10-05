import { Hono } from 'hono';
import type { Env, AppVariables, ProductRow, CategoryRow, OrderRow, OrderItemRow } from '../types';
import {
  deleteProductIndex,
  indexProduct,
  indexProducts,
  type ProductWithCategory,
} from '../lib/rag';

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

type ProductBody = {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  image_url?: string;
  category_id?: number | null;
};

async function validateCategoryId(
  db: D1Database,
  value: number | null | undefined,
  fallback: number | null = null
): Promise<number | null | undefined> {
  const categoryId = value === undefined ? fallback : value === null ? null : Number(value);

  if (categoryId === undefined || categoryId === null) return categoryId;
  if (!Number.isInteger(categoryId) || categoryId < 1) return undefined;

  const category = await db.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
  return category ? categoryId : undefined;
}

async function syncProductIndex(env: Env, productId: number): Promise<void> {
  try {
    const product = await env.DB.prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`
    )
      .bind(productId)
      .first<ProductWithCategory>();

    if (!product) throw new Error(`Product ${productId} was not found after saving.`);
    await indexProduct(env, product);
  } catch (error) {
    console.error(`Product ${productId} was saved but Vectorize indexing failed.`, error);
  }
}

// ---------------------------------------------------------------------------
// PRODUCTS CRUD
// ---------------------------------------------------------------------------

// POST /api/admin/products/reindex
admin.post('/products/reindex', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.id`
    ).all<ProductWithCategory>();

    const batchSize = 20;
    for (let offset = 0; offset < results.length; offset += batchSize) {
      await indexProducts(c.env, results.slice(offset, offset + batchSize));
    }

    return c.json({ message: 'Đã lập chỉ mục sản phẩm thành công.', indexed: results.length });
  } catch (error) {
    console.error('Product re-index failed.', error);
    return c.json({ error: 'Không thể lập chỉ mục sản phẩm. Hãy kiểm tra Workers AI và Vectorize.' }, 500);
  }
});

// POST /api/admin/categories
admin.post('/categories', async (c) => {
  type CategoryBody = { name?: string };
  const body = await c.req.json<CategoryBody>().catch(() => ({} as CategoryBody));
  const name = body.name?.trim();

  if (!name) return c.json({ error: 'Tên danh mục là bắt buộc.' }, 400);
  if (name.length > 80) return c.json({ error: 'Tên danh mục không được vượt quá 80 ký tự.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE')
    .bind(name)
    .first();
  if (existing) return c.json({ error: 'Danh mục này đã tồn tại.' }, 409);

  const category = await c.env.DB.prepare('INSERT INTO categories (name) VALUES (?) RETURNING id, name')
    .bind(name)
    .first<CategoryRow>();

  return c.json({ message: 'Tạo danh mục thành công.', data: category }, 201);
});

// POST /api/admin/products
admin.post('/products', async (c) => {
  const body = await c.req.json<ProductBody>().catch(() => ({} as ProductBody));

  const name = body.name?.trim();
  const description = body.description?.trim() ?? '';
  const price = Number(body.price);
  const stock = Number(body.stock ?? 0);
  const imageUrl = body.image_url ?? null;
  const categoryId = await validateCategoryId(c.env.DB, body.category_id);

  if (!name) return c.json({ error: 'Tên sản phẩm là bắt buộc.' }, 400);
  if (Number.isNaN(price) || price < 0) return c.json({ error: 'Giá sản phẩm không hợp lệ.' }, 400);
  if (Number.isNaN(stock) || stock < 0) return c.json({ error: 'Số lượng tồn kho không hợp lệ.' }, 400);
  if (categoryId === undefined) return c.json({ error: 'Danh mục sản phẩm không hợp lệ.' }, 400);

  const created = await c.env.DB.prepare(
    `INSERT INTO products (name, description, price, stock, image_url, category_id)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(name, description, price, stock, imageUrl, categoryId)
    .first<ProductRow>();

  if (created) await syncProductIndex(c.env, created.id);

  return c.json({ message: 'Tạo sản phẩm thành công.', data: created }, 201);
});

// PUT /api/admin/products/:id
admin.put('/products/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'ID sản phẩm không hợp lệ.' }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?')
    .bind(id)
    .first<ProductRow>();
  if (!existing) return c.json({ error: 'Không tìm thấy sản phẩm.' }, 404);

  const body = await c.req.json<ProductBody>().catch(() => ({} as ProductBody));

  const name = body.name?.trim() ?? existing.name;
  const description = body.description?.trim() ?? existing.description;
  const price = body.price !== undefined ? Number(body.price) : existing.price;
  const stock = body.stock !== undefined ? Number(body.stock) : existing.stock;
  const imageUrl = body.image_url !== undefined ? body.image_url : existing.image_url;
  const categoryId = await validateCategoryId(c.env.DB, body.category_id, existing.category_id);

  if (Number.isNaN(price) || price < 0) return c.json({ error: 'Giá sản phẩm không hợp lệ.' }, 400);
  if (Number.isNaN(stock) || stock < 0) return c.json({ error: 'Số lượng tồn kho không hợp lệ.' }, 400);
  if (categoryId === undefined) return c.json({ error: 'Danh mục sản phẩm không hợp lệ.' }, 400);

  const updated = await c.env.DB.prepare(
    `UPDATE products SET name = ?, description = ?, price = ?, stock = ?, image_url = ?, category_id = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(name, description, price, stock, imageUrl, categoryId, id)
    .first<ProductRow>();

  if (updated) await syncProductIndex(c.env, updated.id);

  return c.json({ message: 'Cập nhật sản phẩm thành công.', data: updated });
});

// DELETE /api/admin/products/:id
admin.delete('/products/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'ID sản phẩm không hợp lệ.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Không tìm thấy sản phẩm.' }, 404);

  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  try {
    await deleteProductIndex(c.env.VECTORIZE, id);
  } catch (error) {
    console.error(`Product ${id} was deleted but its Vectorize entry could not be removed.`, error);
  }

  return c.json({ message: 'Đã xoá sản phẩm.' });
});

// ---------------------------------------------------------------------------
// IMAGE UPLOAD (R2)
// ---------------------------------------------------------------------------

// POST /api/admin/upload  (multipart/form-data, field name: "file")
admin.post('/upload', async (c) => {
  const formData = await c.req.formData().catch(() => null);
  const entry = formData?.get('file');

  // FormDataEntryValue là `string | File`. Loại trường hợp string trước khi dùng các API của File.
  if (!entry || typeof entry === 'string') {
    return c.json({ error: 'Vui lòng gửi file ảnh với field "file".' }, 400);
  }
  const file = entry as File;

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return c.json({ error: 'Định dạng ảnh không hỗ trợ. Chỉ chấp nhận JPEG/PNG/WEBP/GIF.' }, 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: 'Ảnh vượt quá dung lượng cho phép (tối đa 5MB).' }, 400);
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const key = `products/${crypto.randomUUID()}.${extension}`;

  await c.env.MY_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // Ảnh được phục vụ lại qua route GET /images/:key (xem src/index.ts),
  // nên không cần bật public access cho R2 bucket.
  return c.json({ message: 'Tải ảnh lên thành công.', url: `/images/${key}`, key }, 201);
});

// ---------------------------------------------------------------------------
// ORDERS MANAGEMENT
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['pending', 'processing', 'completed', 'cancelled']);

// GET /api/admin/orders?status=pending&page=1&limit=20
admin.get('/orders', async (c) => {
  const status = c.req.query('status');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const offset = (page - 1) * limit;

  const whereClause = status && VALID_STATUSES.has(status) ? 'WHERE o.status = ?' : '';
  const bindings: (string | number)[] = status && VALID_STATUSES.has(status) ? [status] : [];

  const query = `
    SELECT o.*, u.email AS user_email, u.name AS user_name
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ${whereClause}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const { results } = await c.env.DB.prepare(query)
    .bind(...bindings, limit, offset)
    .all();

  const countQuery = `SELECT COUNT(*) as count FROM orders o ${whereClause}`;
  const totalRow = await c.env.DB.prepare(countQuery)
    .bind(...bindings)
    .first<{ count: number }>();

  return c.json({
    data: results,
    pagination: { page, limit, total: totalRow?.count ?? 0 },
  });
});

// GET /api/admin/orders/:id  (chi tiết đơn hàng kèm order_items)
admin.get('/orders/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'ID đơn hàng không hợp lệ.' }, 400);

  const order = await c.env.DB.prepare(
    `SELECT o.*, u.email AS user_email, u.name AS user_name
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.id = ?`
  )
    .bind(id)
    .first<OrderRow & { user_email: string; user_name: string }>();

  if (!order) return c.json({ error: 'Không tìm thấy đơn hàng.' }, 404);

  const { results: items } = await c.env.DB.prepare(
    `SELECT oi.*, p.name AS product_name, p.image_url AS product_image_url
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`
  )
    .bind(id)
    .all<OrderItemRow & { product_name: string; product_image_url: string | null }>();

  return c.json({ data: { ...order, items } });
});

// PUT /api/admin/orders/:id  { status: 'processing' | 'completed' | 'cancelled' | 'pending' }
admin.put('/orders/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'ID đơn hàng không hợp lệ.' }, 400);

  type StatusBody = { status?: string };
  const body = await c.req.json<StatusBody>().catch(() => ({} as StatusBody));
  const status = body.status;

  if (!status || !VALID_STATUSES.has(status)) {
    return c.json({ error: 'Trạng thái không hợp lệ. Chỉ chấp nhận: pending, processing, completed, cancelled.' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Không tìm thấy đơn hàng.' }, 404);

  const updated = await c.env.DB.prepare('UPDATE orders SET status = ? WHERE id = ? RETURNING *')
    .bind(status, id)
    .first<OrderRow>();

  return c.json({ message: 'Cập nhật trạng thái đơn hàng thành công.', data: updated });
});

export default admin;
