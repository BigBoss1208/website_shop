import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import {
  generateProductAnswer,
  NO_PRODUCT_ANSWER,
  searchProducts,
  type ProductSource,
} from '../lib/rag';

const chat = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// =====================================================
// TYPES
// =====================================================

type ChatBody = {
  message?: unknown;
};

type ProductRow = {
  id: number;
  name: string;
  description?: string | null;
  price: number;
  stock: number;
  image_url?: string | null;
  category_id?: number | null;
  category_name?: string | null;
};

// =====================================================
// HELPER
// =====================================================

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPrice(price: number) {
  return (
    new Intl.NumberFormat('vi-VN').format(price) + 'đ'
  );
}

function toSources(
  products: ProductRow[]
): ProductSource[] {
  return products.map((product) => ({
    product_id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    image_url: product.image_url ?? undefined,
    category_name:
      product.category_name ?? undefined,
  }));
}

async function getProducts(
  env: Env,
  sql: string,
  params: unknown[] = []
): Promise<ProductRow[]> {
  const statement = env.DB.prepare(sql);

  const { results } =
    params.length > 0
      ? await statement
          .bind(...params)
          .all<ProductRow>()
      : await statement.all<ProductRow>();

  return results ?? [];
}

const PRODUCT_SELECT = `
  SELECT
    p.*,
    c.name AS category_name
  FROM products p
  LEFT JOIN categories c
    ON c.id = p.category_id
`;

// =====================================================
// TÁCH GIÁ TỪ CÂU HỎI
// Ví dụ:
// "dưới 2 triệu"
// "dưới 500k"
// =====================================================

function extractMoney(text: string): number | null {
  const normalized = normalizeText(text);

  const millionMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(trieu|tr)/
  );

  if (millionMatch) {
    return (
      Number(millionMatch[1]) * 1_000_000
    );
  }

  const thousandMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(nghin|ngan|k)/
  );

  if (thousandMatch) {
    return (
      Number(thousandMatch[1]) * 1_000
    );
  }

  return null;
}

// =====================================================
// ROUTE
// =====================================================

chat.post('/', async (c) => {
  const body = await c.req
    .json<ChatBody>()
    .catch(() => ({} as ChatBody));

  const message =
    typeof body.message === 'string'
      ? body.message.trim()
      : '';

  // ===================================================
  // 1. VALIDATE
  // ===================================================

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
        error:
          'Câu hỏi không được vượt quá 500 ký tự.',
      },
      400
    );
  }

  // ===================================================
  // 2. RATE LIMIT
  // ===================================================

  const ipAddress =
    c.req.header('CF-Connecting-IP') ??
    'unknown';

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
    const q = normalizeText(message);

    // =================================================
    // 3. CHÀO HỎI
    // =================================================

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

    if (greetings.includes(q)) {
      return c.json({
        answer:
          'Xin chào! Tôi là trợ lý VòngMáy. ' +
          'Tôi có thể giúp bạn tìm sản phẩm, so sánh sản phẩm, ' +
          'kiểm tra giá, tồn kho, tư vấn mua hàng và hướng dẫn sử dụng cửa hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 4. CHATBOT LÀM ĐƯỢC GÌ?
    // =================================================

    if (
      q.includes('ban lam duoc gi') ||
      q.includes('chatbot lam duoc gi') ||
      q.includes('giup duoc gi') ||
      q.includes('ho tro gi')
    ) {
      return c.json({
        answer:
          'Tôi có thể giúp bạn tìm và tư vấn sản phẩm, ' +
          'kiểm tra giá và tồn kho, tìm sản phẩm rẻ hoặc đắt nhất, ' +
          'so sánh sản phẩm, gợi ý theo nhu cầu/ngân sách, ' +
          'hướng dẫn thêm vào giỏ, mua ngay, thanh toán, ' +
          'xem sản phẩm yêu thích và theo dõi đơn hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 5. HƯỚNG DẪN THANH TOÁN
    // =================================================

    if (
      q.includes('thanh toan') ||
      q.includes('cach tra tien') ||
      q.includes('tra tien nhu the nao')
    ) {
      return c.json({
        answer:
          'Để thanh toán, bạn hãy chọn sản phẩm muốn mua → ' +
          'nhấn "Thêm vào giỏ" hoặc "Mua ngay" → ' +
          'kiểm tra sản phẩm và số lượng → ' +
          'tiến hành thanh toán → nhập thông tin nhận hàng ' +
          'và chọn phương thức thanh toán mà website đang hỗ trợ → ' +
          'xác nhận đặt hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 6. HƯỚNG DẪN GIỎ HÀNG
    // =================================================

    if (
      q.includes('them vao gio') ||
      q.includes('gio hang') ||
      q.includes('them gio')
    ) {
      return c.json({
        answer:
          'Để thêm sản phẩm vào giỏ hàng, bạn tìm sản phẩm muốn mua ' +
          'và nhấn "Thêm vào giỏ". Sau đó mở mục "Giỏ hàng" ' +
          'trên thanh menu để xem sản phẩm, thay đổi số lượng ' +
          'và tiếp tục thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 7. HƯỚNG DẪN MUA NGAY
    // =================================================

    if (
      q.includes('mua ngay') ||
      q.includes('cach mua') ||
      q.includes('mua nhu the nao') ||
      q.includes('lam sao de mua') ||
      q.includes('huong dan mua') ||
      q.includes('cach dat hang')
    ) {
      return c.json({
        answer:
          'Bạn có thể mua theo 2 cách. ' +
          'Nếu chỉ muốn mua nhanh một sản phẩm, hãy nhấn "Mua ngay". ' +
          'Nếu muốn mua nhiều sản phẩm, hãy nhấn "Thêm vào giỏ", ' +
          'sau đó mở "Giỏ hàng" và tiến hành thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 8. HƯỚNG DẪN XEM ĐƠN
    // =================================================

    if (
      q.includes('don cua toi') ||
      q.includes('xem don hang') ||
      q.includes('theo doi don') ||
      q.includes('kiem tra don hang') ||
      q.includes('don hang cua toi')
    ) {
      return c.json({
        answer:
          'Bạn mở mục "Đơn của tôi" trên thanh menu để xem ' +
          'danh sách đơn hàng và trạng thái các đơn đã đặt.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 9. HƯỚNG DẪN YÊU THÍCH
    // =================================================

    if (
      q.includes('yeu thich') ||
      q.includes('them yeu thich')
    ) {
      return c.json({
        answer:
          'Bạn nhấn biểu tượng trái tim trên sản phẩm để thêm vào ' +
          'danh sách yêu thích. Sau đó mở mục "Yêu thích" ' +
          'trên thanh menu để xem lại các sản phẩm đã lưu.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 10. ĐĂNG NHẬP
    // =================================================

    if (
      q.includes('dang nhap') ||
      q.includes('login')
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng nhập", nhập tài khoản và mật khẩu ' +
          'đã đăng ký rồi nhấn nút đăng nhập. ' +
          'Nếu chưa có tài khoản, bạn cần đăng ký trước.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 11. ĐĂNG KÝ
    // =================================================

    if (
      q.includes('dang ky') ||
      q.includes('tao tai khoan')
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng ký", nhập các thông tin được yêu cầu ' +
          'và tạo tài khoản. Sau khi đăng ký thành công, ' +
          'bạn có thể đăng nhập để mua hàng và xem đơn hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 12. TÌM KIẾM / LỌC
    // =================================================

    if (
      q.includes('cach tim san pham') ||
      q.includes('tim kiem nhu the nao') ||
      q.includes('cach loc san pham')
    ) {
      return c.json({
        answer:
          'Bạn có thể nhập tên sản phẩm vào ô tìm kiếm. ' +
          'Ngoài ra, cửa hàng có thể lọc theo danh mục, khoảng giá ' +
          'và sắp xếp sản phẩm để giúp bạn tìm nhanh hơn.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 13. NHU CẦU TƯ VẤN CHUNG
    // =================================================

    const generalShoppingRequests = [
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

    if (
      generalShoppingRequests.includes(q)
    ) {
      return c.json({
        answer:
          'Được chứ! Bạn hãy cho tôi biết loại sản phẩm, ' +
          'mục đích sử dụng hoặc ngân sách. Ví dụ: ' +
          '"Tư vấn chuột gaming dưới 2 triệu" hoặc ' +
          '"Tôi cần màn hình để chơi game".',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 14. RẺ NHẤT
    // =================================================

    if (
      q.includes('re nhat') ||
      q.includes('gia thap nhat')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock > 0
        ORDER BY p.price ASC
        LIMIT 3
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại cửa hàng không có sản phẩm còn hàng.',
          sources: [],
        });
      }

      const product = products[0];

      return c.json({
        answer:
          `Sản phẩm rẻ nhất hiện đang còn hàng là ` +
          `${product.name}, giá ${formatPrice(product.price)}. ` +
          `Hiện còn ${product.stock} sản phẩm. ` +
          `Tôi cũng hiển thị thêm các sản phẩm có mức giá gần nhất để bạn tham khảo.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 15. ĐẮT NHẤT
    // =================================================

    if (
      q.includes('dat nhat') ||
      q.includes('gia cao nhat')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock > 0
        ORDER BY p.price DESC
        LIMIT 3
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại cửa hàng không có sản phẩm còn hàng.',
          sources: [],
        });
      }

      const product = products[0];

      return c.json({
        answer:
          `Sản phẩm có giá cao nhất hiện tại là ` +
          `${product.name}, giá ${formatPrice(product.price)}. ` +
          `Hiện còn ${product.stock} sản phẩm.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 16. TÌM SẢN PHẨM DƯỚI NGÂN SÁCH
    // Ví dụ: dưới 2 triệu
    // =================================================

    const money = extractMoney(message);

    if (
      money !== null &&
      (
        q.includes('duoi') ||
        q.includes('khong qua') ||
        q.includes('toi da')
      )
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock > 0
          AND p.price <= ?
        ORDER BY p.price DESC
        LIMIT 8
        `,
        [money]
      );

      if (products.length === 0) {
        return c.json({
          answer:
            `Hiện tôi chưa tìm thấy sản phẩm còn hàng có giá không quá ${formatPrice(money)}.`,
          sources: [],
        });
      }

      // Cho AI tư vấn dựa trên những sản phẩm
      // thực sự nằm trong ngân sách.
      const answer =
        await generateProductAnswer(
          c.env.AI,
          products as any,
          message
        );

      return c.json({
        answer,
        sources: toSources(products),
      });
    }

    // =================================================
    // 17. SẢN PHẨM CÒN HÀNG
    // =================================================

    if (
      q === 'con hang' ||
      q.includes('san pham con hang') ||
      q.includes('nhung san pham con hang')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock > 0
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      return c.json({
        answer:
          products.length > 0
            ? `Dưới đây là ${products.length} sản phẩm đang còn hàng.`
            : 'Hiện tại chưa có sản phẩm còn hàng.',
        sources: toSources(products),
      });
    }

    // =================================================
    // 18. SẢN PHẨM HẾT HÀNG
    // =================================================

    if (
      q.includes('het hang') ||
      q.includes('san pham het hang')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock <= 0
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại tôi không thấy sản phẩm nào hết hàng.',
          sources: [],
        });
      }

      return c.json({
        answer:
          `Có ${products.length} sản phẩm đang hết hàng.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 19. LIỆT KÊ SẢN PHẨM
    // =================================================

    const listQuestions = [
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
      'tat ca san pham',
    ];

    if (
      listQuestions.some(
        (item) =>
          q === item ||
          q.includes(item)
      )
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại cửa hàng chưa có sản phẩm.',
          sources: [],
        });
      }

      return c.json({
        answer:
          `Tôi đang hiển thị ${products.length} sản phẩm của cửa hàng. ` +
          `Bạn có thể hỏi tôi về giá, tồn kho hoặc nhờ tôi tư vấn và so sánh.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 20. HOT / BÁN CHẠY
    // =================================================

    if (
      q.includes('hot nhat') ||
      q.includes('san pham hot') ||
      q.includes('ban chay nhat') ||
      q.includes('pho bien nhat')
    ) {
      /*
       * KHÔNG tự bịa sản phẩm hot.
       *
       * Bước tiếp theo có thể JOIN bảng orders /
       * order_items để tính SUM(quantity).
       */

      return c.json({
        answer:
          'Sản phẩm hot/bán chạy cần được xác định từ dữ liệu đơn hàng và số lượng thực tế đã bán. ' +
          'Hiện tôi chưa sử dụng dữ liệu doanh số để xếp hạng nên sẽ không tự chọn một sản phẩm ngẫu nhiên. ' +
          'Bạn có thể hỏi tôi về sản phẩm rẻ nhất, giá, tồn kho, so sánh hoặc sản phẩm phù hợp với nhu cầu.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 21. RAG
    //
    // Các câu như:
    // - Có chuột Logitech không?
    // - Tìm bàn phím gaming
    // - Màn hình cho chơi game
    // - So sánh A với B
    // - A hay B tốt hơn?
    // - Tư vấn sản phẩm
    // =================================================

    const matches =
      await searchProducts(
        c.env,
        message
      );

    if (matches.length === 0) {
      return c.json({
        answer:
          NO_PRODUCT_ANSWER ||
          'Tôi chưa tìm thấy sản phẩm phù hợp. Hãy thử cho tôi biết loại sản phẩm, hãng, ngân sách hoặc nhu cầu sử dụng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 22. AI TẠO CÂU TRẢ LỜI
    // =================================================

    const products =
      matches.map(
        (match) => match.product
      );

    const answer =
      await generateProductAnswer(
        c.env.AI,
        products,
        message
      );

    // =================================================
    // 23. CARD SẢN PHẨM
    // =================================================

    const sources: ProductSource[] =
      products.map((product) => ({
        product_id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        image_url: product.image_url,
        category_name:
          product.category_name,
      }));

    // =================================================
    // 24. TRẢ KẾT QUẢ
    // =================================================

    return c.json({
      answer,
      sources,
    });
  } catch (error) {
    console.error(
      'Product chat failed:',
      error
    );

    return c.json(
      {
        error:
          'Chatbot tạm thời không khả dụng. Hãy kiểm tra D1, Workers AI và Vectorize trong log Worker.',
      },
      503
    );
  }
});

export default chat;