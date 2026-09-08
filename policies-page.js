/* Вкладки политик. Логика повторяет documents-page.js, но здесь три раздела
   и хеш совпадает с именем вкладки, поэтому свой файл, а не общий. */
(function initPolicyTabs() {
  const tabs = Array.from(document.querySelectorAll('[data-document-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-document-panel]'));
  if (!tabs.length || !panels.length) return;

  const names = tabs.map((tab) => tab.dataset.documentTab);
  const tabsRow = document.querySelector('.documents-tabs');

  /* Ссылки подвала ведут на #labor / #ethics / #anti-corruption, но элементов
     с такими id нет — вкладка переключается скриптом. Значит и прокрутку к
     вкладкам делаем сами, иначе с подвала переключение остаётся за экраном. */
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

  function selectPolicy(name, updateHash = true) {
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

    if (updateHash) history.replaceState(null, '', `#${activeName}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectPolicy(tab.dataset.documentTab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (index + direction + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectPolicy(tabs[nextIndex].dataset.documentTab);
    });
  });

  /* Клик перехватываем сами: если хеш уже совпадает с нужным (пришли по
     policies.html#ethics и жмём тот же пункт в подвале), hashchange не
     сработает и страница просто ничего не сделает. */
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const name = link.getAttribute('href').slice(1).replace(/^document-/, '');
    if (!names.includes(name)) return;
    event.preventDefault();
    selectPolicy(name);
    scrollToTabs();
  });

  const selectFromHash = () => {
    const requested = location.hash.slice(1).replace(/^document-/, '');
    selectPolicy(requested, false);
  };

  selectFromHash();
  /* Смена хеша — это переход по ссылке уже внутри страницы, значит вкладки
     нужно показать. На первой отрисовке (selectFromHash выше) не крутим:
     страница должна открываться сверху, как остальные. */
  window.addEventListener('hashchange', () => {
    selectFromHash();
    scrollToTabs();
  });
})();
