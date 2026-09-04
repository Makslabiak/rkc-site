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

    card.append(media, info);
    if (project.url) {
      card.classList.add('is-link');
      card.tabIndex = 0;
      card.addEventListener('click', () => { window.location.href = project.url; });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = project.url;
        }
      });
    }
    return card;
  };

  const render = (filter = 'all') => {
    const fragment = document.createDocumentFragment();
    const visibleProjects = projects.filter((project) => {
      if (filter === 'all') return true;
      if (filter === project.category) return true;
      return filter === `${project.category}-${project.subcategory}`;
    });

    visibleProjects.forEach((project) => fragment.append(makeCard(project)));
    grid.replaceChildren(fragment);
    grid.classList.toggle('is-empty', visibleProjects.length === 0);
    if (!visibleProjects.length) {
      const empty = document.createElement('p');
      empty.className = 'projects-page__empty';
      empty.textContent = 'Проектов в этой категории пока нет';
      grid.append(empty);
    }
    window.__rksDitherRefresh?.();
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
