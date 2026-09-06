(function initProjectsPage() {
  const page = document.querySelector('.projects-page');
  const grid = page?.querySelector('[data-projects-grid]');
  const dataElement = page?.querySelector('#projects-data');
  const filters = page ? Array.from(page.querySelectorAll('[data-filter]')) : [];
  if (!page || !grid || !dataElement) return;

  let projects = [];
  try {
    const parsed = JSON.parse(dataElement.textContent || '[]');
    projects = Array.isArray(parsed) ? parsed.filter((project) => project && project.title && project.image) : [];
  } catch (error) {
    console.warn('Projects data could not be parsed:', error);
  }

  const makeCard = (project) => {
    const card = document.createElement('article');
    card.className = 'projects-page-card';
    card.dataset.projectId = project.id || '';
    card.dataset.category = project.category || '';
    card.dataset.subcategory = project.subcategory || '';

    const media = document.createElement('div');
    media.className = 'projects-page-card__media image-tone';
    const image = document.createElement('img');
    image.src = project.image;
    image.alt = project.alt || project.title;
    image.loading = 'lazy';
    image.decoding = 'async';
    media.append(image);

    const info = document.createElement('div');
    info.className = 'projects-page-card__info';
    const title = document.createElement('h2');
    title.className = 'projects-page-card__title';
    title.textContent = project.title;
    const category = document.createElement('p');
    category.className = 'projects-page-card__category';
    category.textContent = project.categoryLabel || project.category || '';
    info.append(title, category);

    if (project.url) {
      const link = document.createElement('a');
      link.className = 'projects-page-card__link';
      link.href = project.url;
      link.append(media, info);
      card.append(link);
    } else {
      card.append(media, info);
    }
    return card;
  };

  // Keep DOM images and their GPU textures alive across filter changes.
  const cards = projects.map(makeCard);
  const empty = document.createElement('p');
  empty.className = 'projects-page__empty';
  empty.textContent = 'Проектов в этой категории пока нет';
  empty.hidden = true;
  grid.append(...cards, empty);
  let activeFilter;

  const render = (filter = 'all') => {
    if (filter === activeFilter) return;
    activeFilter = filter;
    let count = 0;
    projects.forEach((project, index) => {
      const visible = filter === 'all' || filter === project.category
        || filter === `${project.category}-${project.subcategory}`;
      cards[index].hidden = !visible;
      if (visible) count += 1;
    });
    empty.hidden = count > 0;
    grid.classList.toggle('is-empty', count === 0);
    document.querySelector('[data-projects-status]').textContent = count
      ? `Найдено проектов: ${count}` : empty.textContent;
    window.lenis?.resize();
    window.ScrollTrigger?.refresh();
    window.__rksDitherRefresh?.();
    window.__rksScrollbarRefresh?.();
  };

  filters.forEach((filter) => {
    filter.addEventListener('click', () => {
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      render(filter.dataset.filter || 'all');
    });
  });

  const requestedFilter = new URLSearchParams(window.location.search).get('filter');
  const initialFilter = filters.some((filter) => filter.dataset.filter === requestedFilter)
    ? requestedFilter
    : 'all';
  const initialButton = filters.find((filter) => filter.dataset.filter === initialFilter);
  filters.forEach((filter) => {
    const active = filter === initialButton;
    filter.classList.toggle('is-active', active);
    filter.setAttribute('aria-pressed', String(active));
  });
  render(initialFilter);
})();
