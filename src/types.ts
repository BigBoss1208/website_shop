// Các binding được khai báo trong wrangler.toml sẽ xuất hiện ở đây.
export type Env = {
  DB: D1Database;
  MY_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  AI: Ai;
  VECTORIZE: Vectorize;
  CHAT_RATE_LIMITER: RateLimit;
  JWT_SECRET: string;
};

export type Role = 'user' | 'admin';

export type JwtPayload = {
  sub: number; // user id
  email: string;
  role: Role;
  name: string;
  exp: number; // unix timestamp giây, bắt buộc bởi hono/jwt
};

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  name: string;
  created_at: string;
};

export type ProductRow = {
  id: number;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_url: string | null;
  category_id: number | null;
  created_at: string;
};

export type CategoryRow = {
  id: number;
  name: string;
};

export type OrderRow = {
  id: number;
  user_id: number;
  total_price: number;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  shipping_address: string;
  created_at: string;
};

export type OrderItemRow = {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  price: number;
};

// Biến mà middleware auth gắn vào context của Hono
export type AppVariables = {
  user: JwtPayload;
};
