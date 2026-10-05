// ============================================================================
// cart.js — Giỏ hàng phía client, lưu trong localStorage.
// Cấu trúc lưu trữ: { [productId]: { id, name, price, image_url, quantity } }
// ============================================================================

const CART_KEY = 'cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(product, quantity = 1) {
  const cart = getCart();
  const key = String(product.id);
  const existingQty = cart[key]?.quantity ?? 0;

  cart[key] = {
    id: product.id,
    name: product.name,
    price: product.price,
    image_url: product.image_url,
    stock: product.stock,
    quantity: existingQty + quantity,
  };

  saveCart(cart);
}

function updateCartQuantity(productId, quantity) {
  const cart = getCart();
  const key = String(productId);
  if (!cart[key]) return;

  if (quantity <= 0) {
    delete cart[key];
  } else {
    cart[key].quantity = quantity;
  }
  saveCart(cart);
}

function removeFromCart(productId) {
  const cart = getCart();
  delete cart[String(productId)];
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadge();
}

function cartItemsArray() {
  return Object.values(getCart());
}

function cartCount() {
  return cartItemsArray().reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal() {
  return cartItemsArray().reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function updateCartBadge() {
  const count = cartCount();
  document.querySelectorAll('#cart-count-badge, .cart-count-badge').forEach((badge) => {
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  });
}

const FAVORITES_KEY = 'favorites';

function getFavorites() {
  try {
    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(favorites)
      ? favorites.filter((product) => product && Number.isInteger(Number(product.id)) && Number(product.id) > 0)
      : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  updateFavoritesBadge();
}

function isFavorite(productId) {
  return getFavorites().some((product) => Number(product.id) === Number(productId));
}

function toggleFavorite(product) {
  const favorites = getFavorites();
  const existingIndex = favorites.findIndex((item) => Number(item.id) === Number(product.id));

  if (existingIndex >= 0) {
    favorites.splice(existingIndex, 1);
    saveFavorites(favorites);
    return false;
  }

  favorites.push({
    id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    image_url: product.image_url,
  });
  saveFavorites(favorites);
  return true;
}

function removeFavorite(productId) {
  saveFavorites(getFavorites().filter((product) => Number(product.id) !== Number(productId)));
}

function updateFavoritesBadge() {
  const count = getFavorites().length;
  document.querySelectorAll('#favorites-count-badge, .favorites-count-badge').forEach((badge) => {
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  updateFavoritesBadge();
});

// ============================================================================
// "Mua ngay" — bỏ qua giỏ hàng, thanh toán ngay 1 sản phẩm.
// Lưu riêng ở key khác, không đụng tới giỏ hàng chính.
// ============================================================================

const BUY_NOW_KEY = 'buyNowItem';

function setBuyNowItem(product, quantity = 1) {
  const item = {
    id: product.id,
    name: product.name,
    price: product.price,
    image_url: product.image_url,
    stock: product.stock,
    quantity,
  };
  localStorage.setItem(BUY_NOW_KEY, JSON.stringify(item));
}

function getBuyNowItem() {
  try {
    return JSON.parse(localStorage.getItem(BUY_NOW_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearBuyNowItem() {
  localStorage.removeItem(BUY_NOW_KEY);
}

function buyNowItemArray() {
  const item = getBuyNowItem();
  return item ? [item] : [];
}