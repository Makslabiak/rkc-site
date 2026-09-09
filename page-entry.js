/* Единственное место, где решается, считаться ли с системной настройкой
   «Уменьшение движения» (Настройки → Универсальный доступ → Движение на
   айфоне, параметры доступности на компьютере).

   Сейчас сайт её не учитывает: анимации, набор текста по буквам, дизер,
   плавная прокрутка и переходы между страницами работают одинаково при
   любых настройках системы. Решение владельца, сентябрь 2026. До него
   настройка гасила всё сразу, и на устройствах с ней сайт выглядел
   неподвижной вёрсткой без дизера.

   Настройку придумали не для красоты: часть людей от движения на экране
   укачивает. Если решение когда-нибудь пересмотрят, менять надо здесь —
   вернуть чтение настройки, и все двенадцать мест в коде подхватят это
   сами. Заодно придётся вернуть блоки @media (prefers-reduced-motion) в
   стилях, они удалены тем же решением.

   Файл выполняется в head до первого кадра, поэтому переключатель доступен
   всем остальным скриптам с самого начала. */
window.rksReduceMotion = function () {
  return false;
};

/* Выполняется в head до первого кадра: скрываем только целевую страницу
   внутреннего перехода. При ошибке основных скриптов возвращаем контент. */
(function () {
  const root = document.documentElement;
  try {
    const saved = sessionStorage.getItem('rks-page-transition');
    sessionStorage.removeItem('rks-page-transition');
    const entry = saved && JSON.parse(saved);
    if (!entry || entry.url !== location.pathname + location.search ||
        Date.now() - entry.time > 15000 ||
        window.rksReduceMotion()) return;
    window.__rksPageEntering = true;
    window.__rksPageEnteringHome = entry.home === true;
    root.classList.add('is-page-entering');
    if (window.__rksPageEnteringHome) root.classList.add('is-page-entering-home');
    window.__rksPageEntryFallback = setTimeout(() => {
      window.__rksPageEntering = false;
      window.__rksPageEnteringHome = false;
      root.classList.remove('is-page-entering', 'is-page-entering-home', 'has-anim');
      root.classList.add('is-loaded');
      if (document.body) document.body.inert = false;
      window.lenis?.start();
      window.dispatchEvent(new CustomEvent('site:loaded'));
    }, 8000);
  } catch (error) { /* Прямой переход работает и без sessionStorage. */ }
})();
