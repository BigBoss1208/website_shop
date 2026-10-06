import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import {
  generateProductAnswer,
  NO_PRODUCT_ANSWER,
  searchProducts,
  type ProductSource,
} from '../lib/rag';

const chat = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

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
// HELPER: CHUẨN HÓA TEXT
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

// =====================================================
// HELPER: FORMAT GIÁ
// =====================================================

function formatPrice(price: number) {
  return (
    new Intl.NumberFormat('vi-VN').format(price) +
    'đ'
  );
}

// =====================================================
// HELPER: PRODUCT -> SOURCE CARD
// =====================================================

function toSources(
  products: ProductRow[]
): ProductSource[] {
  return products.map((product) => ({
    product_id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,

    // ProductSource yêu cầu string | null
    image_url: product.image_url ?? null,

    // ProductSource yêu cầu string | null
    category_name:
      product.category_name ?? null,
  }));
}

// =====================================================
// HELPER: QUERY D1
// =====================================================

async function getProducts(
  env: Env,
  sql: string,
  params: unknown[] = []
): Promise<ProductRow[]> {
  const statement =
    env.DB.prepare(sql);

  const { results } =
    params.length > 0
      ? await statement
          .bind(...params)
          .all<ProductRow>()
      : await statement.all<ProductRow>();

  return results ?? [];
}

// =====================================================
// SQL PRODUCT CƠ BẢN
// =====================================================

const PRODUCT_SELECT = `
  SELECT
    p.*,
    c.name AS category_name
  FROM products p
  LEFT JOIN categories c
    ON c.id = p.category_id
`;

// =====================================================
// PHÁT HIỆN DANH MỤC
//
// DB:
// Màn Hinh
// Bàn Phím
// Chuột
// PC
// =====================================================

function detectCategory(
  text: string
): string | null {
  const q = normalizeText(text);

  // MÀN HÌNH
  if (
    q.includes('man hinh') ||
    q.includes('monitor')
  ) {
    return 'Màn Hinh';
  }

  // BÀN PHÍM
  if (
    q.includes('ban phim') ||
    q.includes('keyboard')
  ) {
    return 'Bàn Phím';
  }

  // CHUỘT
  if (
    q.includes('chuot') ||
    q.includes('mouse')
  ) {
    return 'Chuột';
  }

  // PC
  if (
    /\bpc\b/.test(q) ||
    q.includes('may tinh de ban') ||
    q.includes('may tinh gaming')
  ) {
    return 'PC';
  }

  return null;
}

// =====================================================
// TÁCH GIÁ TỪ CÂU HỎI
//
// 2 triệu -> 2.000.000
// 500k -> 500.000
// =====================================================

function extractMoney(
  text: string
): number | null {
  const q = normalizeText(text);

  // Ví dụ:
  // 2 triệu
  // 2.5 triệu
  // 2tr
  const millionMatch = q.match(
    /(\d+(?:\.\d+)?)\s*(trieu|tr)/
  );

  if (millionMatch) {
    return (
      Number(millionMatch[1]) *
      1_000_000
    );
  }

  // Ví dụ:
  // 500k
  // 500 nghìn
  // 500 ngàn
  const thousandMatch = q.match(
    /(\d+(?:\.\d+)?)\s*(nghin|ngan|k)/
  );

  if (thousandMatch) {
    return (
      Number(thousandMatch[1]) *
      1_000
    );
  }

  return null;
}

// =====================================================
// ROUTE CHAT
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
        error:
          'Vui lòng nhập câu hỏi.',
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
    c.req.header(
      'CF-Connecting-IP'
    ) ?? 'unknown';

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
    // =================================================
    // 3. PHÂN TÍCH CÂU HỎI
    // =================================================

    const q =
      normalizeText(message);

    const detectedCategory =
      detectCategory(message);

    const money =
      extractMoney(message);

    // =================================================
    // 4. CHÀO HỎI
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
          'Tôi có thể giúp bạn tìm sản phẩm, kiểm tra giá, ' +
          'tồn kho, so sánh, tư vấn mua hàng và hướng dẫn sử dụng cửa hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 5. CHATBOT LÀM ĐƯỢC GÌ?
    // =================================================

    if (
      q.includes('ban lam duoc gi') ||
      q.includes(
        'chatbot lam duoc gi'
      ) ||
      q.includes('giup duoc gi') ||
      q.includes('ho tro gi')
    ) {
      return c.json({
        answer:
          'Tôi có thể tìm kiếm và tư vấn sản phẩm, ' +
          'kiểm tra giá và tồn kho, tìm sản phẩm rẻ nhất hoặc đắt nhất, ' +
          'gợi ý sản phẩm theo ngân sách và nhu cầu, ' +
          'hỗ trợ so sánh sản phẩm và hướng dẫn sử dụng cửa hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 6. THANH TOÁN
    // =================================================

    if (
      q.includes('thanh toan') ||
      q.includes('cach tra tien') ||
      q.includes(
        'tra tien nhu the nao'
      )
    ) {
      return c.json({
        answer:
          'Để thanh toán, bạn chọn sản phẩm muốn mua → ' +
          'nhấn "Thêm vào giỏ" hoặc "Mua ngay" → ' +
          'kiểm tra sản phẩm và số lượng → tiến hành thanh toán → ' +
          'nhập thông tin nhận hàng → chọn phương thức thanh toán ' +
          'mà website đang hỗ trợ → xác nhận đặt hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 7. GIỎ HÀNG
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
          'để xem sản phẩm, điều chỉnh số lượng và tiến hành thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 8. MUA NGAY / CÁCH MUA
    // =================================================

    if (
      q.includes('mua ngay') ||
      q.includes('cach mua') ||
      q.includes(
        'mua nhu the nao'
      ) ||
      q.includes(
        'lam sao de mua'
      ) ||
      q.includes(
        'huong dan mua'
      ) ||
      q.includes(
        'cach dat hang'
      )
    ) {
      return c.json({
        answer:
          'Bạn có thể mua theo 2 cách. ' +
          'Nếu muốn mua nhanh một sản phẩm, nhấn "Mua ngay". ' +
          'Nếu muốn mua nhiều sản phẩm, nhấn "Thêm vào giỏ", ' +
          'sau đó mở "Giỏ hàng" và tiến hành thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 9. ĐƠN HÀNG
    // =================================================

    if (
      q.includes('don cua toi') ||
      q.includes('xem don hang') ||
      q.includes('theo doi don') ||
      q.includes(
        'kiem tra don hang'
      ) ||
      q.includes(
        'don hang cua toi'
      )
    ) {
      return c.json({
        answer:
          'Bạn mở mục "Đơn của tôi" trên thanh menu để xem ' +
          'danh sách đơn hàng và trạng thái các đơn đã đặt.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 10. YÊU THÍCH
    // =================================================

    if (
      q.includes('yeu thich') ||
      q.includes(
        'them yeu thich'
      )
    ) {
      return c.json({
        answer:
          'Bạn nhấn biểu tượng trái tim trên sản phẩm để thêm sản phẩm ' +
          'vào danh sách yêu thích. Sau đó mở mục "Yêu thích" ' +
          'để xem lại các sản phẩm đã lưu.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 11. ĐĂNG NHẬP
    // =================================================

    if (
      q.includes('dang nhap') ||
      q.includes('login')
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng nhập", nhập tài khoản và mật khẩu ' +
          'đã đăng ký rồi nhấn đăng nhập. Nếu chưa có tài khoản, ' +
          'bạn cần đăng ký trước.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 12. ĐĂNG KÝ
    // =================================================

    if (
      q.includes('dang ky') ||
      q.includes(
        'tao tai khoan'
      )
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng ký", nhập các thông tin được yêu cầu ' +
          'và tạo tài khoản. Sau đó bạn có thể đăng nhập để mua hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 13. HƯỚNG DẪN TÌM KIẾM
    // =================================================

    if (
      q.includes(
        'cach tim san pham'
      ) ||
      q.includes(
        'tim kiem nhu the nao'
      ) ||
      q.includes(
        'cach loc san pham'
      )
    ) {
      return c.json({
        answer:
          'Bạn có thể nhập tên sản phẩm vào ô tìm kiếm. ' +
          'Ngoài ra có thể sử dụng danh mục, khoảng giá và sắp xếp ' +
          'để tìm sản phẩm phù hợp nhanh hơn.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 14. TƯ VẤN CHUNG
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
    // 15. RẺ NHẤT
    //
    // màn hình rẻ nhất -> chỉ Màn Hinh
    // chuột rẻ nhất    -> chỉ Chuột
    // bàn phím rẻ nhất -> chỉ Bàn Phím
    // PC rẻ nhất       -> chỉ PC
    //
    // chỉ "rẻ nhất" -> toàn shop
    // =================================================

    if (
      q.includes('re nhat') ||
      q.includes(
        'gia thap nhat'
      )
    ) {
      let products: ProductRow[];

      // Có danh mục
      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0
              AND c.name = ?

            ORDER BY p.price ASC

            LIMIT 3
            `,
            [detectedCategory]
          );
      }

      // Không có danh mục
      else {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0

            ORDER BY p.price ASC

            LIMIT 3
            `
          );
      }

      if (products.length === 0) {
        return c.json({
          answer:
            detectedCategory
              ? `Hiện tại tôi không tìm thấy sản phẩm thuộc danh mục ${detectedCategory} đang còn hàng.`
              : 'Hiện tại cửa hàng không có sản phẩm còn hàng.',

          sources:
            [] as ProductSource[],
        });
      }

      const product =
        products[0];

      if (detectedCategory) {
        return c.json({
          answer:
            `${product.name} là sản phẩm thuộc danh mục ${detectedCategory} ` +
            `có giá rẻ nhất hiện đang còn hàng. ` +
            `Giá ${formatPrice(product.price)}, ` +
            `hiện còn ${product.stock} sản phẩm. ` +
            `Tôi cũng hiển thị thêm các sản phẩm cùng danh mục có giá gần nhất để bạn tham khảo.`,

          sources:
            toSources(products),
        });
      }

      return c.json({
        answer:
          `Sản phẩm rẻ nhất toàn cửa hàng hiện đang còn hàng là ` +
          `${product.name}, giá ${formatPrice(product.price)}. ` +
          `Hiện còn ${product.stock} sản phẩm.`,

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 16. ĐẮT NHẤT
    //
    // màn hình đắt nhất -> chỉ màn hình
    // chuột đắt nhất -> chỉ chuột
    // ...
    // =================================================

    if (
      q.includes('dat nhat') ||
      q.includes(
        'gia cao nhat'
      )
    ) {
      let products: ProductRow[];

      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0
              AND c.name = ?

            ORDER BY p.price DESC

            LIMIT 3
            `,
            [detectedCategory]
          );
      } else {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0

            ORDER BY p.price DESC

            LIMIT 3
            `
          );
      }

      if (products.length === 0) {
        return c.json({
          answer:
            detectedCategory
              ? `Hiện tại tôi không tìm thấy sản phẩm thuộc danh mục ${detectedCategory} đang còn hàng.`
              : 'Hiện tại cửa hàng không có sản phẩm còn hàng.',

          sources:
            [] as ProductSource[],
        });
      }

      const product =
        products[0];

      if (detectedCategory) {
        return c.json({
          answer:
            `${product.name} là sản phẩm thuộc danh mục ${detectedCategory} ` +
            `có giá cao nhất hiện tại. ` +
            `Giá ${formatPrice(product.price)}, ` +
            `hiện còn ${product.stock} sản phẩm.`,

          sources:
            toSources(products),
        });
      }

      return c.json({
        answer:
          `Sản phẩm có giá cao nhất toàn cửa hàng là ` +
          `${product.name}, giá ${formatPrice(product.price)}. ` +
          `Hiện còn ${product.stock} sản phẩm.`,

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 17. SẢN PHẨM DƯỚI NGÂN SÁCH
    //
    // "dưới 2 triệu"
    // -> toàn shop
    //
    // "chuột dưới 2 triệu"
    // -> Chuột
    //
    // "màn hình dưới 5 triệu"
    // -> Màn Hinh
    // =================================================

    if (
      money !== null &&
      (
        q.includes('duoi') ||
        q.includes(
          'khong qua'
        ) ||
        q.includes('toi da')
      )
    ) {
      let products: ProductRow[];

      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0
              AND p.price <= ?
              AND c.name = ?

            ORDER BY p.price DESC

            LIMIT 8
            `,
            [
              money,
              detectedCategory,
            ]
          );
      } else {
        products =
          await getProducts(
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
      }

      if (products.length === 0) {
        return c.json({
          answer:
            detectedCategory
              ? `Hiện tôi chưa tìm thấy sản phẩm ${detectedCategory} còn hàng có giá không quá ${formatPrice(money)}.`
              : `Hiện tôi chưa tìm thấy sản phẩm còn hàng có giá không quá ${formatPrice(money)}.`,

          sources:
            [] as ProductSource[],
        });
      }

      // Cho Llama tư vấn dựa trên
      // đúng các sản phẩm đã lọc từ D1
      const answer =
        await generateProductAnswer(
          c.env.AI,
          products as any,
          message
        );

      return c.json({
        answer,

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 18. SẢN PHẨM CÒN HÀNG
    // =================================================

    if (
      q === 'con hang' ||
      q.includes(
        'san pham con hang'
      ) ||
      q.includes(
        'nhung san pham con hang'
      )
    ) {
      let products: ProductRow[];

      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0
              AND c.name = ?

            ORDER BY p.id DESC

            LIMIT 8
            `,
            [detectedCategory]
          );
      } else {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock > 0

            ORDER BY p.id DESC

            LIMIT 8
            `
          );
      }

      return c.json({
        answer:
          products.length > 0
            ? detectedCategory
              ? `Tôi tìm thấy ${products.length} sản phẩm ${detectedCategory} đang còn hàng.`
              : `Tôi đang hiển thị ${products.length} sản phẩm còn hàng.`
            : detectedCategory
              ? `Hiện không có sản phẩm ${detectedCategory} còn hàng.`
              : 'Hiện tại chưa có sản phẩm còn hàng.',

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 19. SẢN PHẨM HẾT HÀNG
    // =================================================

    if (
      q.includes('het hang')
    ) {
      let products: ProductRow[];

      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock <= 0
              AND c.name = ?

            ORDER BY p.id DESC

            LIMIT 8
            `,
            [detectedCategory]
          );
      } else {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE p.stock <= 0

            ORDER BY p.id DESC

            LIMIT 8
            `
          );
      }

      if (products.length === 0) {
        return c.json({
          answer:
            detectedCategory
              ? `Hiện tôi không thấy sản phẩm ${detectedCategory} nào hết hàng.`
              : 'Hiện tại tôi không thấy sản phẩm nào hết hàng.',

          sources:
            [] as ProductSource[],
        });
      }

      return c.json({
        answer:
          detectedCategory
            ? `Có ${products.length} sản phẩm ${detectedCategory} đang hết hàng.`
            : `Có ${products.length} sản phẩm đang hết hàng.`,

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 20. LIỆT KÊ SẢN PHẨM
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
      let products: ProductRow[];

      // Ví dụ:
      // "có những màn hình nào"
      // nếu detectCategory được
      if (detectedCategory) {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            WHERE c.name = ?

            ORDER BY p.id DESC

            LIMIT 8
            `,
            [detectedCategory]
          );
      } else {
        products =
          await getProducts(
            c.env,
            `
            ${PRODUCT_SELECT}

            ORDER BY p.id DESC

            LIMIT 8
            `
          );
      }

      if (products.length === 0) {
        return c.json({
          answer:
            detectedCategory
              ? `Hiện chưa có sản phẩm thuộc danh mục ${detectedCategory}.`
              : 'Hiện tại cửa hàng chưa có sản phẩm.',

          sources:
            [] as ProductSource[],
        });
      }

      return c.json({
        answer:
          detectedCategory
            ? `Dưới đây là các sản phẩm thuộc danh mục ${detectedCategory}.`
            : `Tôi đang hiển thị ${products.length} sản phẩm của cửa hàng.`,

        sources:
          toSources(products),
      });
    }

    // =================================================
    // 21. HOT / BÁN CHẠY
    //
    // Chưa tính vì cần dữ liệu order_items
    // Không để AI tự bịa
    // =================================================

    if (
      q.includes('hot nhat') ||
      q.includes(
        'san pham hot'
      ) ||
      q.includes(
        'ban chay nhat'
      ) ||
      q.includes(
        'pho bien nhat'
      )
    ) {
      return c.json({
        answer:
          'Để xác định sản phẩm hot hoặc bán chạy nhất chính xác, ' +
          'tôi cần dựa trên dữ liệu đơn hàng và số lượng sản phẩm đã bán. ' +
          'Hiện chatbot chưa sử dụng dữ liệu doanh số để xếp hạng nên tôi sẽ không tự bịa sản phẩm hot.',

        sources:
          [] as ProductSource[],
      });
    }

    // =================================================
    // 22. RAG
    //
    // Các câu còn lại:
    //
    // "Có chuột Logitech không?"
    // "Tìm màn hình gaming"
    // "Tư vấn chuột chơi game"
    // "So sánh A với B"
    // "Con nào phù hợp chơi game?"
    // =================================================

    const matches =
      await searchProducts(
        c.env,
        message
      );

    // =================================================
    // 23. KHÔNG TÌM THẤY
    // =================================================

    if (
      matches.length === 0
    ) {
      return c.json({
        answer:
          NO_PRODUCT_ANSWER,

        sources:
          [] as ProductSource[],
      });
    }

    // =================================================
    // 24. LẤY SẢN PHẨM
    // =================================================

    const products =
      matches.map(
        (match) =>
          match.product
      );

    // =================================================
    // 25. AI TẠO CÂU TRẢ LỜI
    // =================================================

    const answer =
      await generateProductAnswer(
        c.env.AI,
        products,
        message
      );

    // =================================================
    // 26. CARD SẢN PHẨM
    //
    // Ở đây product từ RAG đã đúng ProductSource
    // =================================================

    const sources: ProductSource[] =
      products.map(
        (product) => ({
          product_id:
            product.id,

          name:
            product.name,

          price:
            product.price,

          stock:
            product.stock,

          image_url:
            product.image_url ?? null,

          category_name:
            product.category_name ?? null,
        })
      );

    // =================================================
    // 27. RETURN
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