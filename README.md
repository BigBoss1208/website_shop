# VòngMáy — E-commerce trên Cloudflare (Workers + D1 + R2 + Hono)

Full-stack e-commerce chạy hoàn toàn trên Cloudflare edge:
- **Backend**: Cloudflare Workers + Hono.js (RESTful API)
- **Database**: Cloudflare D1 (SQLite)
- **Ảnh sản phẩm**: Cloudflare R2
- **Frontend**: HTML + Tailwind CSS (CDN, mobile-first) + vanilla JS, phục vụ qua Workers Static Assets
- **Auth**: JWT (`hono/jwt`) kèm phân quyền `user` / `admin`
- **Tìm kiếm & lọc**: API sản phẩm hỗ trợ tìm không dấu, danh mục, khoảng giá và sắp xếp
- **Chatbot RAG**: Workers AI (`bge-m3`, Llama 3.3) + Cloudflare Vectorize

## 1. Cài đặt

```bash
npm install
npm install -g wrangler   # nếu chưa có wrangler CLI
wrangler login
```

## 2. Tạo D1 Database

```bash
wrangler d1 create ecommerce-db
```

Lệnh trên trả về một khối cấu hình có `database_id`. Copy giá trị đó và dán vào
`wrangler.toml`, thay cho `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 3. Tạo R2 Bucket

```bash
wrangler r2 bucket create ecommerce-images
```

Tên bucket phải khớp với `bucket_name = "ecommerce-images"` trong `wrangler.toml`
(nếu bạn đổi tên, nhớ sửa lại cả hai chỗ).

## 4. Chạy migration cho schema.sql

Chỉ dùng bước này cho **D1 database mới, chưa có dữ liệu**. `schema.sql` khởi tạo lại các bảng và chèn sản phẩm mẫu.

**Local (dùng cho `wrangler dev`):**
```bash
wrangler d1 execute ecommerce-db --local --file=./schema.sql
```

**Remote (dùng cho production sau khi deploy):**
```bash
wrangler d1 execute ecommerce-db --remote --file=./schema.sql
```

Lệnh này tạo các bảng (`users`, `categories`, `products`, `orders`, `order_items`) và chèn 4 sản phẩm mẫu được phân vào danh mục tương ứng.

Với database đã có dữ liệu từ schema cũ, **không chạy lại `schema.sql`**. Chạy migration chỉ một lần để thêm danh mục mà không xóa sản phẩm:
```bash
npm run db:migrate:categories:local
# Production: npm run db:migrate:categories:remote
```

Sản phẩm cũ được giữ nguyên và ban đầu chưa phân loại. Quản trị viên có thể tạo danh mục và gán sản phẩm trong trang Quản lý sản phẩm.

## 5. Cấu hình Vectorize

Tạo index một lần trong Cloudflare account:
```bash
wrangler vectorize create shoplite-products --dimensions=1024 --metric=cosine
```

`wrangler.toml` đã khai báo binding Workers AI (`AI`), Vectorize (`VECTORIZE`) và rate limiter (`CHAT_RATE_LIMITER`). AI/Vectorize dùng binding từ Cloudflare ngay cả khi chạy `wrangler dev`; local chat vì vậy cần đăng nhập Cloudflare, kết nối mạng và có thể phát sinh usage. D1 vẫn dùng local database. Namespace ID `932715` của rate limiter phải là duy nhất trong Cloudflare account; đổi giá trị `namespace_id` trong `wrangler.toml` nếu đã được Worker khác sử dụng.

Sau khi deploy và đã đăng nhập bằng tài khoản admin, mở **Quản lý sản phẩm** và bấm **Re-index sản phẩm** để tạo embedding cho toàn bộ sản phẩm hiện có. Thao tác tạo/sửa/xóa sản phẩm cũng tự đồng bộ Vectorize; nếu đồng bộ gặp lỗi, thay đổi D1 vẫn được giữ và lỗi được ghi vào Worker log.

## 6. Chạy thử ở local

```bash
npm run dev
```

Mặc định Wrangler sẽ serve tại `http://localhost:8787`. Trang chủ ở
`http://localhost:8787/index.html`.

## 7. Tạo tài khoản Admin đầu tiên

Không có sẵn tài khoản admin — mọi tài khoản đăng ký qua `/register.html` đều
có `role = 'user'` (vì lý do bảo mật, endpoint đăng ký công khai không cho
chọn role). Sau khi đăng ký tài khoản đầu tiên, hãy tự tay nâng role bằng
lệnh dưới đây (thay `you@example.com` bằng email bạn vừa đăng ký):

```bash
# local
wrangler d1 execute ecommerce-db --local --command \
  "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';"

# remote (sau khi deploy)
wrangler d1 execute ecommerce-db --remote --command \
  "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';"
```

Đăng xuất rồi đăng nhập lại để JWT mới chứa `role: 'admin'`.

## 8. Deploy lên Cloudflare

```bash
# Bắt buộc trước khi deploy production: đặt JWT_SECRET bằng secret thật,
# KHÔNG dùng giá trị mặc định trong wrangler.toml.
wrangler secret put JWT_SECRET

npm run deploy
```

## 9. Cấu trúc thư mục

```
cf-ecommerce/
├── wrangler.toml            # Binding D1, R2, Workers AI, Vectorize, rate limiter, Assets
├── schema.sql                # Schema D1 hiện tại và dữ liệu mẫu
├── migrations/
│   └── 0001_add_categories.sql # Migration an toàn cho DB dùng schema cũ
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # App Hono chính, mount routes, serve ảnh từ R2
│   ├── types.ts               # Kiểu Env, JwtPayload, các Row type
│   ├── middleware/
│   │   └── auth.ts            # authMiddleware (verify JWT) + adminMiddleware
│   ├── lib/
│   │   └── rag.ts             # Embedding, index/re-index, truy xuất và prompt RAG
│   ├── utils/
│   │   └── password.ts        # Hash/verify mật khẩu bằng PBKDF2 (Web Crypto)
│   │   └── search.ts          # Chuẩn hóa từ khóa tiếng Việt
│   └── routes/
│       ├── auth.ts            # POST /api/auth/register, /api/auth/login
│       ├── products.ts        # GET /api/products với search/filter/sort
│       ├── categories.ts      # GET /api/categories
│       ├── chat.ts            # POST /api/chat
│       ├── admin.ts           # CRUD sản phẩm, category, re-index, upload R2, orders
│       └── orders.ts          # POST /api/orders, GET /api/user/orders
└── public/                    # Front-end tĩnh (Tailwind CDN, mobile-first)
    ├── index.html              # Trang chủ / Cửa hàng (grid 1/2/4 cột)
    ├── favorites.html           # Sản phẩm yêu thích (localStorage)
    ├── product.html             # Chi tiết sản phẩm
    ├── cart.html                 # Giỏ hàng
    ├── checkout.html              # Thanh toán
    ├── orders.html                 # Lịch sử đơn hàng (user)
    ├── login.html / register.html
    ├── admin/
    │   ├── dashboard.html          # Thống kê doanh thu/đơn hàng
    │   ├── products.html            # CRUD sản phẩm + upload ảnh lên R2
    │   └── orders.html               # Quản lý & cập nhật trạng thái đơn hàng
    └── js/
        ├── api.js                    # fetch wrapper, session (JWT) trong localStorage
        ├── cart.js                    # Giỏ hàng client-side (localStorage)
        ├── nav.js                      # Thanh điều hướng dùng chung
        └── chat-widget.js              # Chatbot RAG cho storefront (không hiển thị trong admin)

```

## 10. Danh sách API

| Method | Endpoint                     | Quyền        | Mô tả |
|--------|-------------------------------|--------------|-------|
| POST   | `/api/auth/register`          | Public       | Đăng ký (luôn role=user) |
| POST   | `/api/auth/login`              | Public       | Đăng nhập, trả JWT chứa role |
| GET    | `/api/products`                 | Public       | Danh sách (`?page=&limit=&search=&category_id=&price_range=&sort=`) |
| GET    | `/api/products/:id`              | Public       | Chi tiết sản phẩm, kèm danh mục |
| GET    | `/api/categories`                | Public       | Danh sách danh mục từ D1 |
| POST   | `/api/chat`                      | Public       | Hỏi đáp sản phẩm bằng RAG; giới hạn 10 câu hỏi/IP/phút |
| POST   | `/api/orders`                     | User         | Tạo đơn hàng từ giỏ hàng, trừ stock |
| GET    | `/api/user/orders`                 | User         | Lịch sử đơn hàng của chính mình |
| POST   | `/api/admin/products`               | Admin        | Tạo sản phẩm |
| PUT    | `/api/admin/products/:id`            | Admin        | Sửa sản phẩm |
| DELETE | `/api/admin/products/:id`             | Admin        | Xoá sản phẩm |
| POST   | `/api/admin/categories`              | Admin        | Tạo danh mục |
| POST   | `/api/admin/products/reindex`        | Admin        | Re-index sản phẩm hiện có trong Vectorize |
| POST   | `/api/admin/upload`                    | Admin        | Upload ảnh lên R2 (multipart, field `file`) |
| GET    | `/api/admin/orders`                     | Admin        | Danh sách đơn hàng (`?status=&page=&limit=`) |
| GET    | `/api/admin/orders/:id`                  | Admin        | Chi tiết 1 đơn hàng kèm items |
| PUT    | `/api/admin/orders/:id`                   | Admin        | Đổi trạng thái đơn hàng |
| GET    | `/images/:key`                             | Public       | Phục vụ lại ảnh lưu trong R2 |

## 11. Ghi chú kỹ thuật

- **Mật khẩu**: băm bằng PBKDF2-SHA256 (100.000 vòng) qua Web Crypto API —
  không dùng bcrypt vì Workers runtime không có Node crypto module gốc.
- **RAG**: vector ID có dạng `product_<id>`. Chat lấy tối đa 4 kết quả, kiểm tra lại ID với D1 để bỏ qua sản phẩm đã xóa, rồi chỉ đưa dữ liệu hiện tại vào prompt. Nếu điểm tương đồng dưới ngưỡng, chatbot không gọi LLM. `slug`, SKU, giá gốc và trạng thái ẩn không có trong model hiện tại nên không được bịa hoặc dùng trong index.
- **Tìm kiếm không dấu**: lọc tên, mô tả và tên danh mục sau khi chuẩn hóa Unicode tiếng Việt. Danh mục và khoảng giá được lọc đồng thời trong API; sắp xếp và phân trang được áp dụng sau lọc.
- **Sản phẩm yêu thích**: danh sách lưu cục bộ trong `localStorage` (key `favorites`), cùng với giỏ hàng `localStorage` hiện tại. Không cần migration D1.
- **Rate limit**: binding giới hạn 10 request mỗi IP trong 60 giây tại một Cloudflare location; đây là bộ giới hạn bảo vệ Workers AI, không thay thế chính sách rate-limit toàn cầu.
- **Ảnh R2**: không cần bật public access cho bucket. Ảnh upload xong được
  lưu key dạng `products/<uuid>.<ext>`, và app phục vụ lại qua route
  `GET /images/:key` (đọc trực tiếp từ binding `MY_BUCKET`).
- **Static Assets**: nhờ `run_worker_first = ["/api/*", "/images/*"]` trong
  `wrangler.toml`, mọi request khác (html/css/js) được Cloudflare trả thẳng
  từ thư mục `public/` mà không tốn một lượt gọi Worker nào.
- **Giao dịch đơn hàng**: khi tạo đơn, insert `order_items` và trừ `stock`
  được gộp vào một `DB.batch()` để D1 chạy như một nhóm câu lệnh atomic.
