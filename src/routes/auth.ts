import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import type { Env, AppVariables, UserRow } from '../types';
import { hashPassword, verifyPassword } from '../utils/password';

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 ngày

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  type RegisterBody = { email?: string; password?: string; name?: string };
  const body = await c.req.json<RegisterBody>().catch(() => ({} as RegisterBody));
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const name = body.name?.trim();

  if (!email || !isValidEmail(email)) {
    return c.json({ error: 'Email không hợp lệ.' }, 400);
  }
  if (!password || password.length < 6) {
    return c.json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' }, 400);
  }
  if (!name) {
    return c.json({ error: 'Vui lòng nhập tên.' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ error: 'Email này đã được đăng ký.' }, 409);
  }

  const passwordHash = await hashPassword(password);

  const result = await c.env.DB.prepare(
    `INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, 'user', ?) RETURNING id, email, role, name, created_at`
  )
    .bind(email, passwordHash, name)
    .first<UserRow>();

  if (!result) {
    return c.json({ error: 'Không thể tạo tài khoản, vui lòng thử lại.' }, 500);
  }

  return c.json(
    {
      message: 'Đăng ký thành công.',
      user: { id: result.id, email: result.email, role: result.role, name: result.name },
    },
    201
  );
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  type LoginBody = { email?: string; password?: string };
  const body = await c.req.json<LoginBody>().catch(() => ({} as LoginBody));
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return c.json({ error: 'Vui lòng nhập email và mật khẩu.' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();

  if (!user) {
    return c.json({ error: 'Email hoặc mật khẩu không đúng.' }, 401);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    return c.json({ error: 'Email hoặc mật khẩu không đúng.' }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = await sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name, exp },
    c.env.JWT_SECRET,
    'HS256'
  );

  return c.json({
    message: 'Đăng nhập thành công.',
    token,
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  });
});

export default auth;
