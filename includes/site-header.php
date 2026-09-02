<?php
/**
 * Общая шапка сайта для интеграции в Bitrix.
 * Перед подключением можно задать $sitePage: home, services, documents, news или contacts.
 */
$sitePage = $sitePage ?? '';
$siteHomeUrl = $sitePage === 'home' ? '#top' : '/';
$siteServicesUrl = $sitePage === 'services' ? '/services/' : '/services/';
$siteProjectsUrl = $sitePage === 'home' ? '#projects' : '/#projects';
$siteNewsUrl = $sitePage === 'home' ? '#news' : '/news/';
$siteContactsUrl = $sitePage === 'contacts' ? '#contact-form' : '/contacts/';
$siteHeaderTheme = in_array($sitePage, ['services', 'news-detail'], true) ? 'dark' : 'light';
?>
<div class="site-header site-header--<?= $siteHeaderTheme ?>">
  <a class="site-logo" href="<?= htmlspecialchars($siteHomeUrl, ENT_QUOTES, 'UTF-8') ?>" aria-label="РКС-НР — на главную">
    <img src="/assets/icons/logo-header.svg" width="142" height="54" alt="РКС-НР">
  </a>

  <nav class="desktop-nav" aria-label="Основная навигация" data-anim="typeChars" data-anim-target="a" data-anim-on-load>
    <div class="desktop-nav__group">
      <a href="/#company">О компании</a>
      <a href="<?= htmlspecialchars($siteServicesUrl, ENT_QUOTES, 'UTF-8') ?>"<?= $sitePage === 'services' ? ' aria-current="page"' : '' ?>>Услуги</a>
      <a href="<?= htmlspecialchars($siteProjectsUrl, ENT_QUOTES, 'UTF-8') ?>">Проекты</a>
    </div>
    <div class="desktop-nav__group">
      <a href="<?= htmlspecialchars($siteNewsUrl, ENT_QUOTES, 'UTF-8') ?>"<?= $sitePage === 'news' ? ' aria-current="page"' : '' ?>>Новости</a>
      <a href="<?= htmlspecialchars($siteContactsUrl, ENT_QUOTES, 'UTF-8') ?>">Контакты</a>
    </div>
  </nav>

  <div class="site-header__actions">
    <button class="menu-button button--fill-hover" type="button" aria-expanded="false" aria-controls="mobile-menu"><span class="button__text button__text--current">Меню</span><span class="button__text button__text--hover" aria-hidden="true">Меню</span></button>
    <button class="language-button button--fill-hover" type="button" aria-label="Выбран русский язык"><span class="button__text button__text--current">RU</span><span class="button__text button__text--hover" aria-hidden="true">RU</span></button>
  </div>
</div>

<div class="menu-panel" id="mobile-menu" hidden>
  <nav class="menu-panel__nav" aria-label="Основная навигация">
    <a href="/#company">О компании</a>
    <a href="<?= htmlspecialchars($siteServicesUrl, ENT_QUOTES, 'UTF-8') ?>">Услуги</a>
    <a href="<?= htmlspecialchars($siteProjectsUrl, ENT_QUOTES, 'UTF-8') ?>">Проекты</a>
    <a href="<?= htmlspecialchars($siteNewsUrl, ENT_QUOTES, 'UTF-8') ?>">Новости</a>
    <a href="<?= htmlspecialchars($siteContactsUrl, ENT_QUOTES, 'UTF-8') ?>">Контакты</a>
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
  </div>
</div>
