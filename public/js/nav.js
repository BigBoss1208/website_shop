// ============================================================================
// nav.js — Vẽ thanh điều hướng dùng chung. Mỗi trang chỉ cần:
//   <div id="site-nav"></div>
//   <script src="/js/api.js"></script>
//   <script src="/js/cart.js"></script>
//   <script src="/js/nav.js"></script>
// ============================================================================

function renderNav() {
  const mount = document.getElementById('site-nav');
  if (!mount) return;

  const user = getUser();
  const path = window.location.pathname;

  const linkClass = (href) =>
    `text-sm font-medium transition-colors ${
      path === href ? 'text-brand-600' : 'text-ink-500 hover:text-ink-900'
    }`;

  mount.innerHTML = `
    <header class="sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="/index.html" class="flex items-baseline gap-1 font-display text-xl font-bold text-ink-900">
          Quang<span class="text-brand-600">Mạnh</span>
        </a>

        <nav class="hidden min-w-0 items-center gap-4 lg:flex xl:gap-6">
          <a href="/index.html" class="${linkClass('/index.html')}">Cửa hàng</a>
          <a href="/favorites.html" class="${linkClass('/favorites.html')}">
            Yêu thích <span aria-hidden="true">♡</span>
            <span id="favorites-count-badge" class="favorites-count-badge ml-1 hidden min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">0</span>
          </a>
          <a href="/orders.html" class="${linkClass('/orders.html')}">Đơn của tôi</a>
          <a href="/cart.html" class="${linkClass('/cart.html')}">
            Giỏ hàng <span aria-hidden="true">🛒</span>
            <span id="cart-count-badge" class="cart-count-badge ml-1 hidden min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">0</span>
          </a>
          ${
            user?.role === 'admin'
              ? `<a href="/admin/dashboard.html" class="${linkClass('/admin/dashboard.html')}">Quản trị</a>`
              : ''
          }
        </nav>

        <div class="flex shrink-0 items-center gap-3">
          ${
            user
              ? `<button id="logout-btn" class="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700">Đăng xuất</button>`
              : `<a href="/login.html" class="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Đăng nhập</a>`
          }
        </div>
      </div>

      <nav class="flex items-center gap-5 overflow-x-auto border-t border-ink-100 px-4 py-2 lg:hidden">
        <a href="/index.html" class="${linkClass('/index.html')}">Cửa hàng</a>
        <a href="/favorites.html" class="${linkClass('/favorites.html')} whitespace-nowrap">
          Yêu thích <span aria-hidden="true">♡</span>
          <span class="favorites-count-badge ml-1 hidden min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">0</span>
        </a>
        <a href="/orders.html" class="${linkClass('/orders.html')}">Đơn của tôi</a>
        <a href="/cart.html" class="${linkClass('/cart.html')} whitespace-nowrap">
          Giỏ hàng <span aria-hidden="true">🛒</span>
          <span class="cart-count-badge ml-1 hidden min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">0</span>
        </a>
        ${
          user?.role === 'admin'
            ? `<a href="/admin/dashboard.html" class="${linkClass('/admin/dashboard.html')}">Quản trị</a>`
            : ''
        }
      </nav>
    </header>
  `;

  updateCartBadge();
  updateFavoritesBadge();

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  if (!path.startsWith('/admin')) {
    const widgetScript = document.createElement('script');
    widgetScript.src = '/js/chat-widget.js';
    document.body.appendChild(widgetScript);
  }
}

document.addEventListener('DOMContentLoaded', renderNav);
