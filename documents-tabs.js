/* Вкладки документов и политик — общий скрипт для documents.html и
   policies.html. Разметка у страниц одна и та же: кнопки с
   data-document-tab и панели с data-document-panel; первая вкладка —
   раздел по умолчанию. */
(function initDocumentTabs() {
  const tabs = Array.from(document.querySelectorAll('[data-document-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-document-panel]'));
  if (!tabs.length || !panels.length) return;

  const names = tabs.map((tab) => tab.dataset.documentTab);
  const defaultName = names[0];
  const tabsRow = document.querySelector('.documents-tabs');

  /* Ссылки ведут на #agreement, #labor и подобные, но элементов с такими id
     на страницах нет — это имена вкладок, их разбирает этот скрипт. Значит
     браузер по ним никуда не прокручивает, и подводить экран к вкладкам
     приходится самим: иначе переключение из подвала остаётся за экраном. */
  function scrollToTabs() {
    if (!tabsRow) return;
    if (window.lenis) {
      window.lenis.scrollTo(tabsRow, { offset: -80 });
      return;
    }
    /* Lenis нет ровно в одном случае — prefers-reduced-motion (script.js,
       initSmoothScroll выходит сразу). Значит и прыжок делаем без анимации. */
    tabsRow.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function selectDocument(name, updateHash = true) {
    const activeTab = tabs.find((tab) => tab.dataset.documentTab === name) || tabs[0];
    const activeName = activeTab.dataset.documentTab;

    tabs.forEach((tab) => {
      const active = tab === activeTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.documentPanel !== activeName;
    });

    /* Раздел по умолчанию живёт на чистом адресе: хеш в нём ничего не
       уточняет, а ссылку с ним неудобно копировать. */
    if (updateHash) {
      history.replaceState(null, '',
        activeName === defaultName ? location.pathname : `#${activeName}`);
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectDocument(tab.dataset.documentTab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (index + direction + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectDocument(tabs[nextIndex].dataset.documentTab);
    });
  });

  /* Клик по внутристраничной ссылке перехватываем сами: если хеш уже равен
     нужному (пришли по policies.html#ethics и жмём тот же пункт в подвале),
     hashchange не сработает и страница не отреагирует вовсе. */
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element
      ? event.target.closest('a[href^="#"]')
      : null;
    if (!link) return;
    const name = link.getAttribute('href').slice(1).replace(/^document-/, '');
    if (!names.includes(name)) return;
    event.preventDefault();
    selectDocument(name);
    scrollToTabs();
  });

  const selectFromHash = () => {
    selectDocument(location.hash.slice(1).replace(/^document-/, ''), false);
  };

  selectFromHash();
  /* Смена хеша — переход по ссылке уже внутри страницы, вкладки надо
     показать. На первой отрисовке (selectFromHash выше) не крутим: страница
     должна открываться сверху, как остальные. */
  window.addEventListener('hashchange', () => {
    selectFromHash();
    scrollToTabs();
  });
})();
