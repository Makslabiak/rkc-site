(function initDocumentTabs() {
  const tabs = Array.from(document.querySelectorAll('[data-document-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-document-panel]'));
  if (!tabs.length || !panels.length) return;

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

    if (updateHash) history.replaceState(null, '', activeName === 'policy' ? location.pathname : '#agreement');
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectDocument(tab.dataset.documentTab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectDocument(tabs[nextIndex].dataset.documentTab);
    });
  });

  const selectFromHash = () => {
    selectDocument(location.hash === '#agreement' || location.hash === '#document-agreement' ? 'agreement' : 'policy', false);
  };

  selectFromHash();
  window.addEventListener('hashchange', selectFromHash);
})();
