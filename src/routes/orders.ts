import { Hono } from 'hono';
import type { Env, AppVariables, ProductRow, OrderRow, OrderItemRow } from '../types';
import { indexProductsByIds } from '../lib/rag';

const orders = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type CartItemInput = { product_id: number; quantity: number };

// POST /api/orders  (yêu cầu đăng nhập — auth middleware gắn ở src/index.ts)
// body: { items: [{ product_id, quantity }], shipping_address }
orders.post('/orders', async (c) => {
  const user = c.get('user');
  type CreateOrderBody = { items?: CartItemInput[]; shipping_address?: string };
  const body = await c.req.json<CreateOrderBody>().catch(() => ({} as CreateOrderBody));

  const items = body.items;
  const shippingAddress = body.shipping_address?.trim();

  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'Giỏ hàng đang trống.' }, 400);
  }
  if (!shippingAddress) {
    return c.json({ error: 'Vui lòng nhập địa chỉ giao hàng.' }, 400);
  }
  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity <= 0) {
      return c.json({ error: 'Dữ liệu sản phẩm trong giỏ hàng không hợp lệ.' }, 400);
    }
  }

  // 1. Lấy thông tin sản phẩm hiện tại và kiểm tra tồn kho.
  const productIds = items.map((i) => i.product_id);
  const placeholders = productIds.map(() => '?').join(',');
  const { results: dbProducts } = await c.env.DB.prepare(
    `SELECT * FROM products WHERE id IN (${placeholders})`
  )
    .bind(...productIds)
    .all<ProductRow>();

  const productMap = new Map(dbProducts.map((p) => [p.id, p]));

  let totalPrice = 0;
  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product) {
      return c.json({ error: `Sản phẩm #${item.product_id} không tồn tại.` }, 404);
    }
    if (product.stock < item.quantity) {
      return c.json(
        { error: `Sản phẩm "${product.name}" chỉ còn ${product.stock} sản phẩm trong kho.` },
        400
      );
    }
    totalPrice += product.price * item.quantity;
  }

  // 2. Tạo đơn hàng.
  const order = await c.env.DB.prepare(
    `INSERT INTO orders (user_id, total_price, status, shipping_address)
     VALUES (?, ?, 'pending', ?)
     RETURNING *`
  )
    .bind(user.sub, totalPrice, shippingAddress)
    .first<OrderRow>();

  if (!order) {
    return c.json({ error: 'Không thể tạo đơn hàng, vui lòng thử lại.' }, 500);
  }

  // 3. Thêm order_items và trừ stock — gộp thành một batch để D1 chạy atomic.
  const statements = items.flatMap((item) => {
    const product = productMap.get(item.product_id)!;
    return [
      c.env.DB.prepare(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)'
      ).bind(order.id, item.product_id, item.quantity, product.price),
      c.env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(
        item.quantity,
        item.product_id
      ),
    ];
  });

  await c.env.DB.batch(statements);

  c.executionCtx.waitUntil(
    indexProductsByIds(
      c.env,
      items.map((item) => item.product_id)
    ).catch((error) => {
      console.error(`Order ${order.id} was created but product stock indexing failed.`, error);
    })
  );

  return c.json({ message: 'Đặt hàng thành công.', data: order }, 201);
});

// GET /api/user/orders  (yêu cầu đăng nhập)
orders.get('/user/orders', async (c) => {
  const user = c.get('user');

  const { results: userOrders } = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(user.sub)
    .all<OrderRow>();

  const orderIds = userOrders.map((o) => o.id);
  let itemsByOrder = new Map<number, (OrderItemRow & { product_name: string })[]>();

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const { results: items } = await c.env.DB.prepare(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id IN (${placeholders})`
    )
      .bind(...orderIds)
      .all<OrderItemRow & { product_name: string }>();

    itemsByOrder = items.reduce((map, item) => {
      const list = map.get(item.order_id) ?? [];
      list.push(item);
      map.set(item.order_id, list);
      return map;
    }, new Map<number, (OrderItemRow & { product_name: string })[]>());
  }

  const data = userOrders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
  }));

  return c.json({ data });
});

export default orders;
