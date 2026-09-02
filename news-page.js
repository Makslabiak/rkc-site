(function initNewsPage() {
  const page = document.querySelector('.news-page');
  if (!page) return;

  const list = page.querySelector('.news-page__list');
  const cards = Array.from(page.querySelectorAll('.news-page-card'));
  const filters = Array.from(page.querySelectorAll('.news-page__category'));
  if (!list || !cards.length) return;

  const activate = (card) => {
    cards.forEach((item) => item.classList.toggle('is-active', item === card));
  };

  cards.forEach((card) => {
    card.addEventListener('pointerenter', () => activate(card));
    card.addEventListener('focus', () => activate(card));
  });

  const defaultCard = cards[0];
  list.addEventListener('pointerleave', () => activate(defaultCard));
  list.addEventListener('focusout', () => {
    window.requestAnimationFrame(() => {
      if (!list.contains(document.activeElement)) activate(defaultCard);
    });
  });

  filters.forEach((filter) => {
    filter.addEventListener('click', () => {
      const category = filter.dataset.category;
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });

      const visibleCards = cards.filter((card) => {
        const visible = category === 'all' || card.dataset.category === category;
        card.hidden = !visible;
        return visible;
      });
      activate(visibleCards[0] || cards[0]);
    });
  });
})();
