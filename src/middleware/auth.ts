import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import type { Env, AppVariables, JwtPayload } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/**
 * Kiểm tra header "Authorization: Bearer <token>", verify JWT bằng JWT_SECRET,
 * và gắn payload (user hiện tại) vào context để các handler phía sau dùng.
 */
export async function authMiddleware(c: AppContext, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Chưa đăng nhập: thiếu Bearer token.' }, 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();

  try {
    const payload = (await verify(token, c.env.JWT_SECRET, 'HS256')) as unknown as JwtPayload;
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Token không hợp lệ hoặc đã hết hạn.' }, 401);
  }
}

/**
 * Phải dùng SAU authMiddleware. Chỉ cho phép role === 'admin' đi tiếp.
 */
export async function adminMiddleware(c: AppContext, next: Next) {
  const user = c.get('user');

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Chỉ quản trị viên mới được phép thực hiện thao tác này.' }, 403);
  }

  await next();
}
