<?php
/**
 * Подвал сайта. Одна разметка на все страницы.
 *
 * Сейчас подвал скопирован в 11 HTML-файлов и в них разошёлся. Разбор
 * расхождений сделан: после типографа из script.js текст на всех страницах
 * получается одинаковым, а телефон и знак копирайта помещаются в строку и
 * на 375 px. Значит на экране разницы нет, кроме двух вещей, и они
 * вынесены в параметры ниже.
 *
 * Параметры (задать перед подключением):
 *   $sitePage     — как в site-header.php, для aria-current;
 *   $footerAnim   — выводить ли атрибуты data-anim. Сейчас анимация подписей
 *                   в подвале включена только на index, news и contacts.
 *                   Чтобы включить её везде, поставьте true всем страницам:
 *                   это единственное видимое изменение, которое даст переход
 *                   на общий подвал;
 *   $footerClass  — добавочный класс: '', 'news-footer', 'news-detail-footer',
 *                   'documents-footer', 'contacts-footer';
 *   $footerId     — 'contacts' на большинстве страниц, 'documents-footer' на
 *                   документах, политиках и 404, пусто на news, news-detail
 *                   и contacts;
 *   $footerLegalBase, $footerPoliciesBase — префикс ссылок на документы.
 *                   На самих страницах документов и политик ссылки ведут
 *                   якорем внутрь той же страницы, поэтому префикс пустой.
 */

$sitePage        = $sitePage ?? '';
$footerAnim      = $footerAnim ?? true;
$footerClass     = $footerClass ?? '';
$footerId        = $footerId ?? 'contacts';
$footerLegalBase = $footerLegalBase ?? 'documents.html';
$footerPoliciesBase = $footerPoliciesBase ?? 'policies.html';

$current = ' aria-current="page"';
$isAbout    = $sitePage === 'about';
$isServices = $sitePage === 'services';
$isProjects = $sitePage === 'projects' || $sitePage === 'project-detail';
$isNews     = $sitePage === 'news' || $sitePage === 'news-detail';
$isContacts = $sitePage === 'contacts';

// Готовые наборы атрибутов: так их видно целиком и нельзя перепутать порядок.
$animType  = $footerAnim ? ' data-anim="typeChars" data-anim-target="a" data-anim-start="top bottom"' : '';
$animFade  = $footerAnim ? ' data-anim="fadeIn" data-anim-target="a" data-anim-start="top bottom"' : '';
$animTitle = $footerAnim ? ' data-anim="typeChars" data-anim-start="top bottom"' : '';
?>
<footer class="footer<?= $footerClass ? ' ' . $footerClass : '' ?>"<?= $footerId ? ' id="' . $footerId . '"' : '' ?>>
    <img class="footer__logo" src="assets/icons/logo-footer.svg" width="738" height="147" alt="РКС-НР">
    <div class="footer__nav">
      <nav aria-label="Навигация в подвале"<?= $animType ?>>
        <a href="about.html"<?= $isAbout ? $current : '' ?>>О&nbsp;компании</a>
        <a href="services.html"<?= $isServices ? $current : '' ?>>Услуги</a>
        <a href="projects.html"<?= $isProjects ? $current : '' ?>>Проекты</a>
        <a href="news.html"<?= $isNews ? $current : '' ?>>Новости</a>
        <a href="contacts.html"<?= $isContacts ? $current : '' ?>>Контакты</a>
        <a href="<?= $footerPoliciesBase ?>#labor">Охрана труда</a>
        <a href="<?= $footerPoliciesBase ?>#ethics">Этика и&nbsp;ответственность</a>
        <a href="<?= $footerPoliciesBase ?>#anti-corruption">Противодействие коррупции</a>
      </nav>
      <div class="footer__socials"<?= $animType ?>><a href="https://max.ru/rks_nr" target="_blank" rel="noopener noreferrer">MAX</a><a href="https://t.me/rks_nr" target="_blank" rel="noopener noreferrer">Telegram</a></div>
    </div>
    <div class="footer__contacts">
      <div<?= $animType ?>><a href="tel:+74951472233">+7&nbsp;(495)&nbsp;147-22-33</a><a href="mailto:mail@rks-nr.ru">mail@rks-nr.ru</a></div>
      <div class="footer__legal"<?= $animFade ?>><a href="<?= $footerLegalBase ?>#agreement"><span class="footer__legal-line">Согласие на обработку</span> <span class="footer__legal-line">персональных данных</span></a><a href="<?= $footerLegalBase ?>#policy"><span class="footer__legal-line">Политика в отношении обработки</span> <span class="footer__legal-line">персональных данных</span></a></div>
    </div>
    <p class="footer__copyright"<?= $animTitle ?>>©&nbsp;ООО&nbsp;«РКС-НР», 2026. Все права защищены</p>
  </footer>
