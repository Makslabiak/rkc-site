/* Плашка о cookie. Показывается, пока согласие не дано, и закрывается
   кнопкой «Принять».

   Согласие пока только запоминается в браузере: отправки на сервер нет,
   владелец уточняет у заказчика, нужна ли она. Место для отправки помечено
   ниже — добавить туда запрос, ничего больше в этом файле не меняя.

   Разметка лежит в самой странице, а не строится здесь: так плашку увидит
   поисковик и так её потом выведет шаблон Bitrix (includes/cookie-notice.php). */
(function initCookieNotice() {
  const notice = document.querySelector('[data-cookie-notice]');
  if (!notice) return;

  const accept = notice.querySelector('[data-cookie-accept]');
  const STORAGE_KEY = 'rks-cookie-consent';

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

  function saveConsent() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch (error) {
      /* Не сохранилось — плашка вернётся при следующем заходе. */
    }
  }

  if (readConsent()) return;

  notice.hidden = false;

  accept?.addEventListener('click', () => {
    saveConsent();
    notice.hidden = true;

    /* СЮДА подключается отправка согласия на сервер, если заказчик её
       попросит: дата уже лежит в localStorage под тем же ключом. */
  });
})();
