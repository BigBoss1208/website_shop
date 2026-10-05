import { Hono } from 'hono';
import type { Env, AppVariables, ProductRow } from '../types';
import type { ProductWithCategory } from '../lib/rag';
import { normalizeSearchText } from '../utils/search';

const products = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const PRICE_RANGES: Record<string, { sql: string; values: number[] }> = {
  under_500k: { sql: 'p.price < ?', values: [500_000] },
  '500k_1m': { sql: 'p.price >= ? AND p.price <= ?', values: [500_000, 1_000_000] },
  '1m_3m': { sql: 'p.price > ? AND p.price <= ?', values: [1_000_000, 3_000_000] },
  '3m_5m': { sql: 'p.price > ? AND p.price <= ?', values: [3_000_000, 5_000_000] },
  over_5m: { sql: 'p.price > ?', values: [5_000_000] },
};
const SORT_OPTIONS = new Set(['default', 'price_asc', 'price_desc', 'name_asc', 'name_desc']);

// GET /api/products?page=1&limit=12&search=&category_id=&price_range=&sort=
products.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '12', 10) || 12));
  const search = normalizeSearchText(c.req.query('search')?.trim() ?? '');
  const categoryParam = c.req.query('category_id');
  const categoryId = categoryParam ? Number(categoryParam) : null;
  const priceRange = c.req.query('price_range') ?? '';
  const sort = c.req.query('sort') ?? 'default';

  if (categoryParam && (!Number.isInteger(categoryId) || (categoryId ?? 0) < 1)) {
    return c.json({ error: 'Danh mục không hợp lệ.' }, 400);
  }
  if (priceRange && !PRICE_RANGES[priceRange]) {
    return c.json({ error: 'Khoảng giá không hợp lệ.' }, 400);
  }
  if (!SORT_OPTIONS.has(sort)) {
    return c.json({ error: 'Thứ tự sắp xếp không hợp lệ.' }, 400);
  }

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (categoryId !== null) {
    conditions.push('p.category_id = ?');
    bindings.push(categoryId);
  }
  if (priceRange) {
    conditions.push(PRICE_RANGES[priceRange].sql);
    bindings.push(...PRICE_RANGES[priceRange].values);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results: candidates } = await c.env.DB.prepare(
    `SELECT p.*, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     ${whereClause}`
  )
    .bind(...bindings)
    .all<ProductWithCategory>();

  const filtered = search
    ? candidates.filter((product) =>
        normalizeSearchText(
          [product.name, product.description, product.category_name ?? ''].join(' ')
        ).includes(search)
      )
    : candidates;

  if (sort === 'price_asc') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') filtered.sort((a, b) => b.price - a.price);
  if (sort === 'name_asc') filtered.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
  if (sort === 'name_desc') filtered.sort((a, b) => b.name.localeCompare(a.name, 'vi', { sensitivity: 'base' }));
  if (sort === 'default') filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = filtered.length;
  const offset = (page - 1) * limit;

  return c.json({
    data: filtered.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

// GET /api/products/:id
products.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) {
    return c.json({ error: 'ID sản phẩm không hợp lệ.' }, 400);
  }

  const product = await c.env.DB.prepare(
    `SELECT p.*, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`
  )
    .bind(id)
    .first<ProductRow & { category_name: string | null }>();

  if (!product) {
    return c.json({ error: 'Không tìm thấy sản phẩm.' }, 404);
  }

  return c.json({ data: product });
});

export default products;
