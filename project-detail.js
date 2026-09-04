(function initProjectDetail() {
  const dataElement = document.querySelector('#project-detail-data');
  if (!dataElement) return;

  let payload;
  try {
    payload = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    console.warn('Project data could not be parsed:', error);
    return;
  }

  // The detail layout is intentionally shared by every project card for now.
  // The admin can replace this one object later without coupling the page to
  // the catalog URL or to a query-string project id.
  const project = payload;
  if (!project || typeof project !== 'object' || !project.title) return;

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element && value != null) element.textContent = String(value);
  };

  setText('[data-project-title]', project.title);
  setText('[data-project-year]', project.year);
  setText('[data-project-contractor]', project.contractor);

  const hero = document.querySelector('[data-project-hero]');
  if (hero && project.hero) {
    hero.src = project.hero;
    hero.alt = project.title;
  }

  const description = document.querySelector('[data-project-description]');
  if (description) {
    description.replaceChildren();
    (Array.isArray(project.description) ? project.description : []).forEach((paragraph) => {
      if (!paragraph) return;
      const element = document.createElement('p');
      element.textContent = paragraph;
      description.append(element);
    });
  }

  const renderGallery = (name, items) => {
    const container = document.querySelector(`[data-project-gallery="${name}"]`);
    if (!container) return;
    container.replaceChildren();
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item?.src) return;
      const media = document.createElement('div');
      media.className = 'project-detail__gallery-item image-tone';
      const image = document.createElement('img');
      image.src = item.src;
      image.alt = item.alt || project.title;
      image.loading = 'lazy';
      image.decoding = 'async';
      media.append(image);
      container.append(media);
    });
  };

  renderGallery('before', project.before);
  renderGallery('after', project.after);

  document.title = `${project.title} — РКС-НР`;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) {
    descriptionMeta.content = `${project.title} — проект ООО «РКС-НР», ${project.category || 'Проекты'}.`;
  }
})();
