import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppVariables } from './types';
import { authMiddleware, adminMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import categoryRoutes from './routes/categories';
import chatRoutes from './routes/chat';
import adminRoutes from './routes/admin';
import orderRoutes from './routes/orders';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('/api/*', cors());

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
app.route('/api/auth', authRoutes);
app.route('/api/products', productRoutes);
app.route('/api/categories', categoryRoutes);
app.route('/api/chat', chatRoutes);

// ---------------------------------------------------------------------------
// User routes (yêu cầu đăng nhập) — cung cấp POST /api/orders, GET /api/user/orders
// ---------------------------------------------------------------------------
app.use('/api/orders', authMiddleware);
app.use('/api/user/*', authMiddleware);
app.route('/api', orderRoutes);

// ---------------------------------------------------------------------------
// Admin routes (yêu cầu đăng nhập + role === 'admin')
// ---------------------------------------------------------------------------
app.use('/api/admin/*', authMiddleware, adminMiddleware);
app.route('/api/admin', adminRoutes);

// ---------------------------------------------------------------------------
// Phục vụ ảnh sản phẩm lưu trong R2: GET /images/<key>
// (key ví dụ: products/<uuid>.jpg — xem src/routes/admin.ts phần upload)
// ---------------------------------------------------------------------------
app.get('/images/*', async (c) => {
  const key = c.req.path.replace(/^\/images\//, '');
  const object = await c.env.MY_BUCKET.get(key);

  if (!object) {
    return c.json({ error: 'Không tìm thấy ảnh.' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

// ---------------------------------------------------------------------------
// 404 cho mọi route /api/* không khớp
// ---------------------------------------------------------------------------
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Không tìm thấy endpoint.' }, 404);
  }
  return c.text('Not found', 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Đã xảy ra lỗi phía server.' }, 500);
});

export default app;
