/* Блок «Новости» на главной показывает первые 4 материала со страницы
   news.html. Источник правды — сама news.html: правим ленту там, главная
   подхватывает автоматически. Существующие 4 карточки в разметке —
   запасной вариант на случай, если fetch недоступен (например file://). */
(function initNewsHome() {
  const grid = document.querySelector('.news__grid[data-news-home]');
  if (!grid) return;

  const targets = Array.from(grid.querySelectorAll('.news-card'));
  if (!targets.length) return;

  const NEWS_URL = 'news.html';

  fetch(NEWS_URL, { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error('news.html: ' + response.status);
      return response.text();
    })
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const source = Array.from(
        doc.querySelectorAll('.news-page__list .news-page-card')
      ).slice(0, targets.length);
      if (!source.length) return;

      source.forEach((card, index) => {
        const target = targets[index];
        if (!target) return;

        const srcTime = card.querySelector('time');
        const srcHeadline = card.querySelector('.news-page-card__headline');
        const dstTime = target.querySelector('time');
        const dstHeadline = target.querySelector('span:not(.news-card__arrow)');

        if (srcTime && dstTime) {
          dstTime.textContent = srcTime.textContent.trim();
          const dt = srcTime.getAttribute('datetime');
          if (dt) dstTime.setAttribute('datetime', dt);
        }
        if (srcHeadline && dstHeadline) {
          dstHeadline.textContent = srcHeadline.textContent.trim();
        }

        const href = card.getAttribute('href');
        if (href) target.setAttribute('href', href);
      });

      /* Лишние карточки убираем, если на странице новостей их меньше 4. */
      targets.slice(source.length).forEach((card) => card.remove());
    })
    .catch(() => {
      /* Тихо остаёмся на запасной разметке. */
    });
})();
