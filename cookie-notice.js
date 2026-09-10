/* Плашка о cookie. Показывается, пока согласие не дано, и закрывается
   кнопкой «Принять».

   Согласие запоминается в браузере и уходит на cookie-consent.php, который
   шлёт письмо заказчику. Отправка ничего не ждёт и ничего не блокирует:
   плашка закрывается сразу, а если сервера нет (открыли страницу файлом или
   простым статическим сервером), запрос молча падает и на плашке это никак
   не сказывается.

   Разметка лежит в самой странице, а не строится здесь: так плашку увидит
   поисковик и так её потом выведет шаблон Bitrix (includes/cookie-notice.php). */
(function initCookieNotice() {
  const notice = document.querySelector('[data-cookie-notice]');
  if (!notice) return;

  const accept = notice.querySelector('[data-cookie-accept]');
  const STORAGE_KEY = 'rks-cookie-consent';

  /* Адрес приёмника. Лежит рядом со страницами; на Bitrix путь тот же. */
  const ENDPOINT = 'cookie-consent.php';

  /* Приватный режим и заблокированные данные сайта: обращение к хранилищу
     там бросает исключение. Плашка в этом случае просто показывается каждый
     раз — это лучше, чем упасть и оставить страницу без обработчиков. */
  function readConsent() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveConsent(when) {
    try {
      window.localStorage.setItem(STORAGE_KEY, when);
    } catch (error) {
      /* Не сохранилось — плашка вернётся при следующем заходе. */
    }
  }

  if (readConsent()) return;

  notice.hidden = false;

  /* keepalive: посетитель может нажать «Принять» и тут же уйти по ссылке —
     с ним запрос доживёт до сервера даже после ухода со страницы.
     Ошибки гасим: несостоявшееся письмо не повод ломать страницу. */
  function reportConsent(when) {
    try {
      const body = new URLSearchParams({ consent: when, page: window.location.href });
      window.fetch(ENDPOINT, {
        method: 'POST',
        body,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {});
    } catch (error) {
      /* Совсем старый браузер без fetch — плашка всё равно закроется. */
    }
  }

  accept?.addEventListener('click', () => {
    const when = new Date().toISOString();
    saveConsent(when);
    notice.hidden = true;
    reportConsent(when);
  });
})();
