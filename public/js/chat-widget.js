(function mountChatWidget() {
  const path = window.location.pathname;
  if (path.startsWith('/admin') || document.getElementById('chat-widget')) return;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div id="chat-widget" class="fixed bottom-4 right-4 z-50 flex flex-col items-end sm:bottom-6 sm:right-6">
        <section id="chat-panel" class="mb-3 hidden h-[min(70vh,520px)] w-[min(88vw,380px)] flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl" aria-label="Trợ lý tư vấn sản phẩm">
          <header class="flex items-center justify-between bg-ink-900 px-4 py-3 text-white">
            <div>
              <p class="font-display font-bold">Trợ lý VòngMáy</p>
              <p class="text-xs text-white/70">Hỏi đáp theo thông tin sản phẩm</p>
            </div>
            <button id="chat-close" type="button" aria-label="Đóng chatbot" class="rounded-full px-2 py-1 text-xl leading-none hover:bg-white/10">×</button>
          </header>
          <div id="chat-messages" class="flex-1 space-y-3 overflow-y-auto bg-ink-50 p-3" aria-live="polite">
            <div class="mr-8 rounded-2xl rounded-tl-sm bg-white p-3 text-sm shadow-sm">
              Xin chào! Bạn muốn tìm hiểu sản phẩm nào?
            </div>
          </div>
          <form id="chat-form" class="flex items-end gap-2 border-t border-ink-100 bg-white p-3">
            <textarea id="chat-input" rows="1" maxlength="500" placeholder="Nhập câu hỏi về sản phẩm..."
              class="max-h-24 min-w-0 flex-1 resize-y rounded-xl border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"></textarea>
            <button id="chat-send" type="submit" aria-label="Gửi câu hỏi"
              class="rounded-xl bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">Gửi</button>
          </form>
        </section>
        <button id="chat-toggle" type="button" aria-label="Mở chatbot"
          class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h8M8 14h5m-8 6 2.4-3.2A8 8 0 1 1 20 14.5" />
          </svg>
        </button>
      </div>
    `
  );

  const panel = document.getElementById('chat-panel');
  const toggle = document.getElementById('chat-toggle');
  const messages = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendButton = document.getElementById('chat-send');

  function addMessage(text, role, sources = []) {
    const bubble = document.createElement('div');
    bubble.className =
      role === 'user'
        ? 'ml-8 whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-600 p-3 text-sm text-white'
        : 'mr-4 whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white p-3 text-sm shadow-sm';
    bubble.textContent = text;
    messages.appendChild(bubble);

    if (role === 'assistant' && sources.length > 0) {
      const sourceList = document.createElement('div');
      sourceList.className = 'mr-2 space-y-2';
      sourceList.innerHTML = sources
        .map(
          (source) => `
            <a href="/product.html?id=${encodeURIComponent(source.product_id)}"
              class="block rounded-xl border border-ink-100 bg-white p-3 text-xs hover:border-brand-400">
              <span class="block font-semibold text-ink-900">${escapeHtml(source.name)}</span>
              <span class="mt-1 block text-brand-600">${formatCurrency(source.price)}</span>
              <span class="mt-1 block text-ink-500">Tồn kho: ${Number(source.stock)}</span>
              <span class="mt-2 inline-block font-medium text-brand-600">Xem sản phẩm →</span>
            </a>
          `
        )
        .join('');
      messages.appendChild(sourceList);
    }

    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function setOpen(open) {
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('flex', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
  document.getElementById('chat-close').addEventListener('click', () => setOpen(false));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || sendButton.disabled) return;

    addMessage(message, 'user');
    input.value = '';
    sendButton.disabled = true;
    const loading = addMessage('Đang tìm thông tin sản phẩm...', 'assistant');

    try {
      const result = await apiFetch('/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      loading.remove();
      addMessage(result.answer, 'assistant', result.sources || []);
    } catch (error) {
      loading.textContent = error.message || 'Không thể gửi câu hỏi. Vui lòng thử lại.';
      loading.classList.add('text-red-500');
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });
})();
