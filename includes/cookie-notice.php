<?php
/**
 * Плашка о cookie. Подключается один раз в footer.php шаблона, рядом с
 * подвалом: она fixed, поэтому место в потоке значения не имеет.
 *
 * Разметка выводится сервером, а не строится скриптом: так её видит
 * поисковик. cookie-notice.js только снимает hidden, если согласие ещё не
 * дано, и прячет плашку обратно по нажатию «Принять».
 *
 * Согласие сейчас живёт только в браузере посетителя. Если заказчик
 * попросит хранить его на сервере, добавлять надо в двух местах: запрос в
 * cookie-notice.js (место помечено там же) и обработчик на стороне Bitrix.
 *
 * $cookiePolicyUrl — адрес раздела о cookie в политике. По умолчанию это
 * якорь в документах; при переходе на ЧПУ поменяйте на свой адрес.
 */

$cookiePolicyUrl = $cookiePolicyUrl ?? 'documents.html#document-cookies';
?>
<aside class="cookie-notice" data-cookie-notice aria-label="Использование cookie" hidden>
  <div class="cookie-notice__text">
    <p class="cookie-notice__title">Использование cookie на сайте</p>
    <p class="cookie-notice__copy">Мы используем cookie для улучшения работы сайта. Продолжая использовать сайт, вы соглашаетесь с нашей <a href="<?= htmlspecialchars($cookiePolicyUrl, ENT_QUOTES, 'UTF-8') ?>">политикой использования cookie</a>.</p>
  </div>
  <button class="cookie-notice__accept" type="button" data-cookie-accept>Принять</button>
</aside>
