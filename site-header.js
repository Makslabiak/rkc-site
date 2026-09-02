/* Единая шапка сайта. Страницы передают только свой тип через data-site-page. */
(function () {
  const header = document.querySelector('[data-site-header]');
  const menu = document.querySelector('[data-site-menu]');
  if (!header || !menu) return;

  const page = document.body.dataset.sitePage || '';
  const isHome = page === 'home';
  const isServices = page === 'services';
  const isNews = page === 'news' || page === 'news-detail';
  const isContacts = page === 'contacts';
  const headerTheme = isServices || page === 'news-detail' ? 'dark' : 'light';

  const homeUrl = isHome ? '#top' : 'index.html';
  const companyUrl = isHome ? '#company' : 'index.html#company';
  const projectsUrl = isHome ? '#projects' : 'index.html#projects';
  const newsUrl = isHome ? '#news' : 'news.html';

  const current = (condition) => condition ? ' aria-current="page"' : '';

  header.innerHTML = `
    <a class="site-logo" href="${homeUrl}" aria-label="РКС-НР — на главную">
      <img src="assets/icons/logo-header.svg" width="142" height="54" alt="РКС-НР">
    </a>
    <nav class="desktop-nav" aria-label="Основная навигация" data-anim="typeChars" data-anim-target="a" data-anim-on-load>
      <div class="desktop-nav__group">
        <a href="${companyUrl}">О компании</a>
        <a href="services.html"${current(isServices)}>Услуги</a>
        <a href="${projectsUrl}">Проекты</a>
      </div>
      <div class="desktop-nav__group">
        <a href="${newsUrl}"${current(isNews)}>Новости</a>
        <a href="contacts.html"${current(isContacts)}>Контакты</a>
      </div>
    </nav>
    <div class="site-header__actions">
      <button class="menu-button button--fill-hover" type="button" aria-expanded="false" aria-controls="mobile-menu">
        <span class="button__text button__text--current">Меню</span>
        <span class="button__text button__text--hover" aria-hidden="true">Меню</span>
      </button>
      <button class="language-button button--fill-hover" type="button" aria-label="Выбран русский язык">
        <span class="button__text button__text--current">RU</span>
        <span class="button__text button__text--hover" aria-hidden="true">EN</span>
      </button>
    </div>`;
  header.classList.add(`site-header--${headerTheme}`);

  menu.className = 'menu-panel';
  menu.id = 'mobile-menu';
  menu.hidden = true;
  menu.innerHTML = `
    <nav class="menu-panel__nav" aria-label="Основная навигация">
      <a href="${companyUrl}">О компании</a>
      <a href="services.html"${current(isServices)}>Услуги</a>
      <a href="${projectsUrl}">Проекты</a>
      <a href="${newsUrl}"${current(isNews)}>Новости</a>
      <a href="contacts.html"${current(isContacts)}>Контакты</a>
    </nav>
    <div class="menu-panel__contacts">
      <p class="menu-panel__contacts-title">Свяжитесь с нами</p>
      <div class="menu-panel__contacts-content">
        <div class="menu-panel__contacts-links">
          <a href="tel:+74951472233">+7 (495) 147-22-33</a>
          <a href="mailto:mail@rks-nr.ru">mail@rks-nr.ru</a>
        </div>
        <p>Пн-Пт с 9:00 до 18:00</p>
        <p>125167, город Москва,<br>Ленинградский проспект, д. 47, стр. 3, подъезд 3</p>
      </div>
    </div>`;
})();
