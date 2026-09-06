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

  const activateArrow = (card) => {
    cards.forEach((item) => item.classList.toggle('is-arrow-active', item === card));
  };

  const defaultCard = cards[0];

  cards.forEach((card) => {
    card.addEventListener('pointerenter', () => {
      activate(card);
      activateArrow(card);
    });
    card.addEventListener('pointerleave', () => {
      if (document.activeElement !== card) {
        activateArrow(null);
        activate(defaultCard);
      }
    });
    card.addEventListener('focus', () => {
      activate(card);
      activateArrow(card);
    });
  });

  list.addEventListener('pointerleave', () => {
    activateArrow(null);
    activate(defaultCard);
  });
  list.addEventListener('focusout', () => {
    window.requestAnimationFrame(() => {
      if (!list.contains(document.activeElement)) {
        activateArrow(null);
        activate(defaultCard);
      }
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
      activateArrow(null);
      activate(visibleCards[0] || cards[0]);
    });
  });
})();
