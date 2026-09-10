<?php
/**
 * Шапка сайта и мобильное меню одним куском.
 *
 * Разметка совпадает с тем, что сейчас строит site-header.js на живой
 * странице: сверено поэлементно, включая атрибуты и неразрывные пробелы.
 * Когда шапка начнёт приходить с сервера, site-header.js надо убрать из
 * подключений, иначе он перезапишет серверную разметку своей.
 *
 * Перед подключением задайте $sitePage одним из значений:
 *   home, about, services, projects, project-detail,
 *   news, news-detail, contacts, documents, policies, not-found
 *
 * Пустые обёртки <div data-site-header> и <div data-site-menu> в шаблоне
 * больше не нужны: этот файл выводит готовые элементы вместе с обёртками.
 *
 * Атрибуты aria-disabled, tabindex и aria-hidden расставляет script.js во
 * время работы страницы. Здесь их нет и быть не должно.
 */

$sitePage = $sitePage ?? '';

$isHome     = $sitePage === 'home';
$isAbout    = $sitePage === 'about';
$isServices = $sitePage === 'services';
$isProjects = $sitePage === 'projects' || $sitePage === 'project-detail';
$isNews     = $sitePage === 'news' || $sitePage === 'news-detail';
$isContacts = $sitePage === 'contacts';

// Тёмная тема шапки: обложка этих страниц светлая, поэтому логотип и пункты
// меню на ней выводятся тёмными.
$darkPages = ['about', 'services', 'news-detail', 'project-detail'];
$headerTheme = in_array($sitePage, $darkPages, true) ? 'dark' : 'light';

// На главной логотип не перезагружает страницу, а уводит к первому экрану.
$homeUrl = $isHome ? '#top' : 'index.html';

// Без стрелочных функций и замыканий: включение должно работать на любой
// версии PHP, которая стоит на боевом Bitrix.
$current = ' aria-current="page"';
?>
<div class="site-header site-header--<?= $headerTheme ?>" data-site-header>
  <a class="site-logo" href="<?= $homeUrl ?>" aria-label="РКС-НР — на главную">
    <img src="assets/icons/logo-header.svg" width="142" height="54" alt="РКС-НР">
  </a>
  <nav class="desktop-nav" aria-label="Основная навигация" data-anim="typeChars" data-anim-target="a" data-anim-on-load>
    <div class="desktop-nav__group">
      <a href="about.html"<?= $isAbout ? $current : '' ?>>О&nbsp;компании</a>
      <a href="services.html"<?= $isServices ? $current : '' ?>>Услуги</a>
      <a href="projects.html"<?= $isProjects ? $current : '' ?>>Проекты</a>
    </div>
    <div class="desktop-nav__group">
      <a href="news.html"<?= $isNews ? $current : '' ?>>Новости</a>
      <a href="contacts.html"<?= $isContacts ? $current : '' ?>>Контакты</a>
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
  </div>
</div>

<div class="menu-panel" id="mobile-menu" data-site-menu hidden>
  <nav class="menu-panel__nav" aria-label="Основная навигация">
    <a href="about.html"<?= $isAbout ? $current : '' ?>>О&nbsp;компании</a>
    <a href="services.html"<?= $isServices ? $current : '' ?>>Услуги</a>
    <a href="projects.html"<?= $isProjects ? $current : '' ?>>Проекты</a>
    <a href="news.html"<?= $isNews ? $current : '' ?>>Новости</a>
    <a href="contacts.html"<?= $isContacts ? $current : '' ?>>Контакты</a>
  </nav>
  <div class="menu-panel__contacts">
    <p class="menu-panel__contacts-title">Свяжитесь с&nbsp;нами</p>
    <div class="menu-panel__contacts-content">
      <div class="menu-panel__contacts-links">
        <a href="tel:+74951472233">+7 (495) 147-22-33</a>
        <a href="mailto:mail@rks-nr.ru">mail@rks-nr.ru</a>
      </div>
      <p>Пн-Пт с&nbsp;9:00 до 18:00</p>
      <p>125167, город Москва,<br>Ленинградский проспект, д. 47,<br>стр. 3, подъезд 3</p>
    </div>
  </div>
</div>
