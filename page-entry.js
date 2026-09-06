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
        matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
