import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import {
  generateProductAnswer,
  NO_PRODUCT_ANSWER,
  searchProducts,
  type ProductSource,
} from '../lib/rag';

const chat = new Hono<{ Bindings: Env; Variables: AppVariables }>();

chat.post('/', async (c) => {
  type ChatBody = {
    message?: unknown;
  };

  // =========================
  // 1. LẤY CÂU HỎI
  // =========================

  const body = await c.req
    .json<ChatBody>()
    .catch(() => ({} as ChatBody));

  const message =
    typeof body.message === 'string'
      ? body.message.trim()
      : '';

  if (!message) {
    return c.json(
      {
        error: 'Vui lòng nhập câu hỏi.',
      },
      400
    );
  }

  if (message.length > 500) {
    return c.json(
      {
        error: 'Câu hỏi không được vượt quá 500 ký tự.',
      },
      400
    );
  }

  // =========================
  // 2. RATE LIMIT
  // =========================

  const ipAddress =
    c.req.header('CF-Connecting-IP') ?? 'unknown';

  const { success } =
    await c.env.CHAT_RATE_LIMITER.limit({
      key: ipAddress,
    });

  if (!success) {
    return c.json(
      {
        error:
          'Bạn gửi quá nhiều câu hỏi. Vui lòng thử lại sau một phút.',
      },
      429
    );
  }

  try {
    // =========================
    // 3. CHUẨN HÓA CÂU HỎI
    // =========================

    const normalizedMessage = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[?!.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // =========================
    // 4. CHÀO HỎI
    // =========================

    const greetings = [
      'xin chao',
      'chao',
      'hello',
      'hi',
      'hey',
      'alo',
      'chao shop',
      'xin chao shop',
    ];

    if (greetings.includes(normalizedMessage)) {
      return c.json({
        answer:
          'Xin chào! Tôi là trợ lý VòngMáy. Tôi có thể giúp bạn tìm sản phẩm, kiểm tra giá, tồn kho hoặc tư vấn sản phẩm phù hợp.',
        sources: [] as ProductSource[],
      });
    }

    // =========================
    // 5. NHU CẦU MUA HÀNG CHUNG
    // =========================

    const shoppingRequests = [
      'mua hang',
      'toi muon mua hang',
      'muon mua hang',
      'tu van',
      'tu van cho toi',
      'tu van san pham',
      'toi can tu van',
      'toi muon mua san pham',
      'muon mua san pham',
      'toi can mua san pham',
    ];

    if (shoppingRequests.includes(normalizedMessage)) {
      return c.json({
        answer:
          'Được chứ! Bạn đang muốn mua sản phẩm nào? Hãy cho tôi biết loại sản phẩm, thương hiệu hoặc khoảng giá bạn mong muốn.',
        sources: [] as ProductSource[],
      });
    }

    // =========================
    // 6. LIỆT KÊ SẢN PHẨM
    // =========================

    const listProductQuestions = [
      'co nhung san pham nao',
      'co san pham nao',
      'cua hang co nhung san pham nao',
      'shop co nhung san pham nao',
      'shop co san pham nao',
      'xem san pham',
      'xem cac san pham',
      'danh sach san pham',
      'san pham cua cua hang',
      'san pham cua shop',
      'cho toi xem san pham',
      'cho xem san pham',
    ];

    if (
      listProductQuestions.includes(normalizedMessage)
    ) {
      const { results } =
        await c.env.DB.prepare(
          `
          SELECT
            p.*,
            c.name AS category_name
          FROM products p
          LEFT JOIN categories c
            ON c.id = p.category_id
          ORDER BY p.id DESC
          LIMIT 8
          `
        ).all<any>();

      if (!results || results.length === 0) {
        return c.json({
          answer:
            'Hiện tại cửa hàng chưa có sản phẩm.',
          sources: [] as ProductSource[],
        });
      }

      const sources: ProductSource[] =
        results.map((product) => ({
          product_id: product.id,
          name: product.name,
          price: product.price,
          stock: product.stock,
          image_url: product.image_url,
          category_name: product.category_name,
        }));

      return c.json({
        answer:
          `Hiện tại tôi tìm thấy ${results.length} sản phẩm. ` +
          'Bạn có thể xem các sản phẩm bên dưới:',
        sources,
      });
    }

    // =========================
    // 7. TÌM SẢN PHẨM BẰNG RAG
    // =========================

    const matches = await searchProducts(
      c.env,
      message
    );

    if (matches.length === 0) {
      return c.json({
        answer: NO_PRODUCT_ANSWER,
        sources: [] as ProductSource[],
      });
    }

    // =========================
    // 8. AI TẠO CÂU TRẢ LỜI
    // =========================

    const answer =
      await generateProductAnswer(
        c.env.AI,
        matches.map(
          (match) => match.product
        ),
        message
      );

    // =========================
    // 9. TẠO CARD SẢN PHẨM
    // =========================

    const sources: ProductSource[] =
      matches.map(({ product }) => ({
        product_id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        image_url: product.image_url,
        category_name: product.category_name,
      }));

    // =========================
    // 10. TRẢ KẾT QUẢ
    // =========================

    return c.json({
      answer,
      sources,
    });
  } catch (error) {
    console.error(
      'Product chat failed during embedding, Vectorize retrieval, or AI generation.',
      error
    );

    return c.json(
      {
        error:
          'Chatbot tạm thời không khả dụng. Hãy kiểm tra Workers AI và Vectorize trong log Worker.',
      },
      503
    );
  }
});

export default chat;