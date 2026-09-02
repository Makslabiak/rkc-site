/*!
 * ANNOTATOR — визуальный инспектор для сбора правок по сайту.
 *
 * ПОДКЛЮЧЕНИЕ (одна строка, в любом месте HTML, лучше перед </body>):
 *   <script src="annotator.js"></script>
 * Ничего больше не нужно. Работает на любом сайте — вся панель живёт
 * в Shadow DOM, поэтому не конфликтует с CSS страницы и не требует
 * никакой настройки под конкретный проект.
 *
 * ДЛЯ КЛОДА, ПОДКЛЮЧАЮЩЕГО ЭТОТ ИНСТРУМЕНТ К ПРОЕКТУ:
 *   На http(s) номера строк работают сразу, без доп. действий (скрипт
 *   сам фетчит исходник страницы).
 *   На file:///... (сайт открыт двойным кликом по index.html) браузеры
 *   блокируют fetch() — в этом случае в панели снизу справа появляется
 *   кнопка «📄 Подключить файл»: пользователь один раз выбирает исходный
 *   HTML-файл через системный диалог (File System Access API), и дальше
 *   выбор запоминается в IndexedDB — при следующих перезагрузках страницы
 *   файл подключается автоматически, без сервера и без повторного диалога
 *   (в Chrome/Edge). В Firefox/Safari (нет File System Access API) —
 *   фолбэк на обычный input[type=file], придётся выбирать заново при
 *   каждой перезагрузке, но сервер всё равно не нужен.
 *   Рядом лежащий serve.sh — не обязателен, оставлен как альтернативный
 *   способ на случай, если оба варианта выше не подходят.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   Cmd+B (Mac) или Ctrl+B (Win/Linux) — включить/выключить режим
 *   инспектора. В этом режиме:
 *     - наведение на любой элемент подсвечивает его и показывает
 *       во всплывающей подсказке тег, классы, размер, padding,
 *       margin и шрифт
 *     - клик по элементу открывает окно с полем для комментария
 *     - сохранённые правки остаются видимыми на странице лаймовыми
 *       метками с номером (и вне режима инспектора тоже — чтобы
 *       было видно, что уже отмечено, при обычном просмотре сайта)
 *     - клик по существующей метке открывает её на редактирование
 *       или удаление
 *   Кнопка «Скопировать всё» в панели снизу справа копирует в буфер
 *   обмена все накопленные правки по всем страницам сайта одним
 *   текстом — готово вставить в чат с Клодом.
 *
 * ХРАНЕНИЕ: localStorage текущего домена, ключ 'annotator:comments'.
 * Ничего никуда не уходит за пределы браузера.
 *
 * ВАЖНО: это инструмент для этапа разработки. Перед сдачей сайта
 * клиенту или публикацией на боевой домен — удали строку подключения
 * скрипта, иначе метки и панель будут видны обычным посетителям.
 */
(function () {
  'use strict';

  if (window.__annotatorMounted__) return;
  window.__annotatorMounted__ = true;

  var STORAGE_KEY = 'annotator:comments';
  var active = false;

  // ---------- данные ----------
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch (e) {}
  }
  function forThisPage(list) {
    return list.filter(function (c) { return c.page === location.pathname; });
  }

  // ---------- селектор и краткое описание элемента ----------
  function cssPath(elm) {
    if (!(elm instanceof Element)) return '';
    var parts = [];
    while (elm && elm.nodeType === 1 && elm !== document.body) {
      var part = elm.nodeName.toLowerCase();
      if (elm.id) { part += '#' + elm.id; parts.unshift(part); break; }
      var sib = elm, nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName === elm.nodeName) nth++;
      }
      if (nth > 1) part += ':nth-of-type(' + nth + ')';
      parts.unshift(part);
      elm = elm.parentElement;
    }
    return parts.join(' > ');
  }

  function shortLabel(elm) {
    var cls = elm.className && typeof elm.className === 'string'
      ? '.' + elm.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return elm.nodeName.toLowerCase() + cls;
  }

  // ---------- текстовое представление элемента и поиск в исходном HTML ----------
  // Для p/h1-h6 берём текст (надёжнее ищется в исходнике). Для остальных
  // тегов — открывающий тег как есть (div, button, img и т.д.), этого
  // достаточно, чтобы Клод нашёл нужное место grep'ом по файлу.
  var TEXT_TAGS = /^(P|H1|H2|H3|H4|H5|H6)$/;

  // Короткая версия для показа человеку (тултип/редактор/копирование).
  function codeSnippet(elm) {
    var tag = elm.nodeName.toLowerCase();
    if (TEXT_TAGS.test(elm.nodeName)) {
      var clsAttr = elm.className && typeof elm.className === 'string' && elm.className.trim()
        ? ' class="' + elm.className.trim() + '"'
        : '';
      var text = (elm.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length > 120) text = text.slice(0, 120) + '…';
      return '<' + tag + clsAttr + '>' + text + '</' + tag + '>';
    }
    var html = elm.outerHTML || '';
    var idx = html.indexOf('>');
    return idx === -1 ? html : html.slice(0, idx + 1);
  }

  // Строка для точного поиска в исходном HTML (без обрезки — обрезанный
  // текст может не совпасть с оригиналом посимвольно).
  function searchSnippet(elm) {
    if (TEXT_TAGS.test(elm.nodeName)) {
      var text = (elm.textContent || '').trim();
      if (text) return text;
    }
    var html = elm.outerHTML || '';
    var idx = html.indexOf('>');
    return idx === -1 ? html : html.slice(0, idx + 1);
  }

  // ---------- номер строки в исходном HTML ----------
  var pageSource = null;
  var fileStatus = 'idle'; // idle | connected | needs-click | unsupported

  // На http(s) можно просто зафетчить исходник страницы. На file://
  // fetch() браузеры блокируют — там используется connectFile()/
  // tryAutoReconnect() через File System Access API (см. ниже).
  function loadPageSource() {
    if (location.protocol === 'file:') { tryAutoReconnect(); return; }
    fetch(location.href, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (html) { pageSource = html; })
      .catch(function () {});
  }

  // ---------- file:// без сервера: File System Access API + IndexedDB ----------
  // Идея: один раз пользователь руками выбирает исходный HTML-файл через
  // системный диалог (showOpenFilePicker). Дальше хэндл на файл кладём в
  // IndexedDB и при следующих открытиях страницы молча проверяем права
  // (queryPermission) — если браузер их ещё помнит, читаем файл заново
  // без всякого диалога. Так сервер вообще не нужен.
  var IDB_NAME = 'annotator-fs', IDB_STORE = 'handles';

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  function readHandle(handle) {
    return handle.getFile().then(function (file) { return file.text(); })
      .then(function (text) {
        pageSource = text;
        fileStatus = 'connected';
        updateFileStatusUI();
      });
  }

  function tryAutoReconnect() {
    if (!window.showOpenFilePicker) {
      // Firefox/Safari — нет File System Access API. Фолбэк на обычный
      // <input type="file">, без запоминания между перезагрузками.
      fileStatus = 'unsupported';
      updateFileStatusUI();
      return;
    }
    idbGet(location.pathname).then(function (handle) {
      if (!handle) { fileStatus = 'needs-click'; updateFileStatusUI(); return; }
      handle.queryPermission({ mode: 'read' }).then(function (perm) {
        if (perm === 'granted') {
          readHandle(handle);
        } else {
          fileStatus = 'needs-click';
          updateFileStatusUI();
        }
      }).catch(function () { fileStatus = 'needs-click'; updateFileStatusUI(); });
    });
  }

  function connectFile() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({
        types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }]
      }).then(function (handles) {
        var handle = handles[0];
        idbSet(location.pathname, handle);
        return readHandle(handle);
      }).catch(function () {});
      return;
    }
    // фолбэк: обычный input[type=file], сработает и в Firefox/Safari
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.style.cssText = 'position:fixed;top:-999px;';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      file.text().then(function (text) {
        pageSource = text;
        fileStatus = 'connected';
        updateFileStatusUI();
      });
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  function updateFileStatusUI() {
    if (!panel) return;
    buildPanel();
    refreshCounter();
  }

  function lineNumber(elm) {
    if (!pageSource) return null;
    var search = searchSnippet(elm);
    if (!search) return null;
    var idx = pageSource.indexOf(search);
    if (idx === -1 && search.length > 40) idx = pageSource.indexOf(search.slice(0, 40));
    if (idx === -1) return null;
    return pageSource.slice(0, idx).split('\n').length;
  }

  function styleSnapshot(elm) {
    var cs = getComputedStyle(elm);
    var r = elm.getBoundingClientRect();
    return {
      size: Math.round(r.width) + '×' + Math.round(r.height),
      padding: cs.padding,
      margin: cs.margin,
      font: cs.fontWeight + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily.split(',')[0]
    };
  }

  // ---------- монтирование в Shadow DOM ----------
  // host держим pointer-events:none ВСЕГДА (даже в активном режиме) —
  // это ключевой момент: без этого он перекрывал бы hit-testing по
  // всему экрану и document.elementFromPoint возвращал бы только его.
  // Интерактивными делаем точечно только .panel и .editor (см. CSS).
  var host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

  var root, outline, tooltip, editor, panel, markersLayer;

  function mount() {
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });

    var styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    root.appendChild(styleEl);

    outline = mk('outline hidden');
    tooltip = mk('tooltip hidden');
    editor = mk('editor hidden');
    panel = mk('panel hidden');
    root.appendChild(outline);
    root.appendChild(tooltip);
    root.appendChild(editor);
    root.appendChild(panel);

    markersLayer = document.createElement('div');
    markersLayer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;';
    document.body.appendChild(markersLayer);

    buildPanel();
    applyPanelPosition();
    initDrag(panel);
    renderMarkers();
    loadPageSource();
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', throttle(renderMarkers, 200), true);
    window.addEventListener('resize', throttle(renderMarkers, 200));
  }

  function mk(cls) {
    var d = document.createElement('div');
    d.className = cls;
    return d;
  }

  // ---------- перетаскивание панели ----------
  // Тянешь за заголовок — позиция запоминается в localStorage (свой
  // домен) и применяется при следующих открытиях. Двойной клик по
  // заголовку — сброс в угол по умолчанию.
  var PANEL_POS_KEY = 'annotator:panelPos';

  function applyPanelPosition() {
    var pos;
    try { pos = JSON.parse(localStorage.getItem(PANEL_POS_KEY)); } catch (e) {}
    if (!pos) return;
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function resetPanelPosition() {
    try { localStorage.removeItem(PANEL_POS_KEY); } catch (e) {}
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '20px';
    panel.style.bottom = '20px';
  }

  // Слушатели вешаем на сам .panel (он не пересоздаётся, в отличие от
  // .panel__title, которая переотрисовывается при каждом buildPanel()) —
  // делегирование, чтобы не переинициализировать драг после каждого
  // обновления содержимого панели.
  function initDrag(panelEl) {
    var dragging = false, startX, startY, startLeft, startTop, moved;

    panelEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest || !e.target.closest('.panel__title')) return;
      if (e.target.closest('.panel__hint')) return;
      dragging = true;
      moved = false;
      var r = panel.getBoundingClientRect();
      startLeft = r.left;
      startTop = r.top;
      startX = e.clientX;
      startY = e.clientY;
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.classList.add('is-dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      moved = true;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      var newLeft = Math.max(4, Math.min(window.innerWidth - panel.offsetWidth - 4, startLeft + dx));
      var newTop = Math.max(4, Math.min(window.innerHeight - panel.offsetHeight - 4, startTop + dy));
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('is-dragging');
      if (moved) {
        var r = panel.getBoundingClientRect();
        try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch (e) {}
      }
    });

    panelEl.addEventListener('dblclick', function (e) {
      if (!e.target.closest || !e.target.closest('.panel__title')) return;
      if (e.target.closest('.panel__hint')) return;
      resetPanelPosition();
    });
  }

  function throttle(fn, ms) {
    var t = 0;
    return function () {
      var now = Date.now();
      if (now - t > ms) { t = now; fn(); }
    };
  }

  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // ---------- переключение режима ----------
  function onKeydown(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'b' || e.key === 'B')) {
      var t = e.target;
      var typingOutside = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && t !== host;
      if (typingOutside) return; // не перехватываем Cmd+B, если человек печатает на самом сайте
      e.preventDefault();
      toggle();
      return;
    }
    if (e.key === 'Escape') {
      if (!editor.classList.contains('hidden')) closeEditor();
      else if (active) toggle();
    }
  }

  function toggle() {
    active = !active;
    document.body.style.cursor = active ? 'crosshair' : '';
    panel.classList.toggle('hidden', !active);
    outline.classList.toggle('hidden', !active);
    tooltip.classList.toggle('hidden', !active);
    if (active) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('click', onClick, true);
      refreshCounter();
    } else {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick, true);
      closeEditor();
    }
  }

  // ---------- ховер: подсветка + подсказка ----------
  var hoveredEl = null;

  function onMouseMove(e) {
    if (e.target === host) return; // курсор над своей же панелью/редактором
    if (!editor.classList.contains('hidden')) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === hoveredEl || markersLayer.contains(target)) return;
    hoveredEl = target;
    var r = target.getBoundingClientRect();
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    var s = styleSnapshot(target);
    var code = codeSnippet(target);
    var ln = lineNumber(target);
    tooltip.innerHTML =
      '<b>' + shortLabel(target) + '</b>' +
      '<span>' + s.size + ' · padding ' + s.padding + ' · margin ' + s.margin + '</span>' +
      '<span>' + s.font + '</span>' +
      '<span class="tooltip__text">' + escapeHtml(code) + (ln ? ' <i>· строка ' + ln + '</i>' : '') + '</span>';
    positionTooltip(e.clientX, e.clientY, true);
  }

  function positionTooltip(x, y, hasText) {
    var pad = 14, tw = 260, th = hasText ? 128 : 74;
    var left = x + pad, top = y + pad;
    if (left + tw > window.innerWidth) left = x - tw - pad;
    if (top + th > window.innerHeight) top = y - th - pad;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  // ---------- клик: открыть редактор комментария ----------
  function onClick(e) {
    if (e.target === host || markersLayer.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    // клик по странице при открытом окне комментария — просто закрываем
    // его, не открывая сразу новое поверх другого элемента
    if (!editor.classList.contains('hidden')) { closeEditor(); return; }
    openEditor(e.target, e.clientX, e.clientY, null);
  }

  // ---------- окно редактора ----------
  function openEditor(targetEl, x, y, existing) {
    var s = styleSnapshot(targetEl);
    var code = codeSnippet(targetEl);
    var ln = lineNumber(targetEl);
    editor.innerHTML =
      '<div class="editor__head">' + shortLabel(targetEl) + '</div>' +
      '<div class="editor__meta">' + s.size + ' · padding ' + s.padding + ' · margin ' + s.margin + '<br>' + s.font +
        '<br><span class="editor__text">' + escapeHtml(code) + (ln ? ' <i>· строка ' + ln + '</i>' : '') + '</span>' +
      '</div>' +
      '<textarea placeholder="Что поправить?">' + (existing ? escapeHtml(existing.text) : '') + '</textarea>' +
      '<div class="editor__row">' +
        (existing ? '<button class="btn btn--danger" data-act="delete">Удалить</button>' : '<span></span>') +
        '<div>' +
          '<button class="btn" data-act="cancel">Отмена</button>' +
          '<button class="btn btn--primary" data-act="save">Сохранить</button>' +
        '</div>' +
      '</div>';

    editor.classList.remove('hidden');
    editor.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    editor.style.top = Math.min(y, window.innerHeight - 220) + 'px';

    var ta = editor.querySelector('textarea');
    ta.focus();

    editor.querySelector('[data-act="save"]').onclick = function () {
      var text = ta.value.trim();
      if (!text) { closeEditor(); return; }
      saveComment(targetEl, text, s, existing);
      closeEditor();
    };
    editor.querySelector('[data-act="cancel"]').onclick = closeEditor;
    var delBtn = editor.querySelector('[data-act="delete"]');
    if (delBtn) delBtn.onclick = function () { deleteComment(existing.id); closeEditor(); };
  }

  function closeEditor() { editor.classList.add('hidden'); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  // ---------- CRUD комментариев ----------
  function saveComment(targetEl, text, styleSnap, existing) {
    var list = loadAll();
    if (existing) {
      var item = list.filter(function (c) { return c.id === existing.id; })[0];
      if (item) { item.text = text; item.updatedAt = Date.now(); }
    } else {
      list.push({
        id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
        page: location.pathname,
        selector: cssPath(targetEl),
        label: shortLabel(targetEl),
        text: text,
        style: styleSnap,
        elementText: codeSnippet(targetEl),
        line: lineNumber(targetEl),
        createdAt: Date.now()
      });
    }
    saveAll(list);
    renderMarkers();
    refreshCounter();
  }

  function deleteComment(id) {
    saveAll(loadAll().filter(function (c) { return c.id !== id; }));
    renderMarkers();
    refreshCounter();
  }

  // ---------- метки на странице (видны и вне режима инспектора) ----------
  function renderMarkers() {
    if (!markersLayer) return;
    markersLayer.innerHTML = '';
    var mine = forThisPage(loadAll());
    mine.forEach(function (c, i) {
      var target = safeQuery(c.selector);
      if (!target) return;
      var r = target.getBoundingClientRect();
      var pin = document.createElement('div');
      pin.textContent = i + 1;
      pin.title = c.text;
      pin.style.cssText =
        'all:initial;position:absolute;' +
        'left:' + (r.left + window.scrollX - 10) + 'px;' +
        'top:' + (r.top + window.scrollY - 10) + 'px;' +
        'width:20px;height:20px;border-radius:50%;background:#c9f24d;color:#111;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font:700 11px/1 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid #111;' +
        'pointer-events:auto;z-index:2147483646;';
      pin.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openEditor(target, r.left + 24, r.top, c);
      });
      markersLayer.appendChild(pin);
    });
  }

  function safeQuery(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  // ---------- панель управления (снизу справа, только в активном режиме) ----------
  function buildPanel() {
    var fileBlock = '';
    if (location.protocol === 'file:') {
      if (fileStatus === 'connected') {
        fileBlock = '<div class="panel__ok">✓ Файл подключён — номера строк работают</div>';
      } else if (fileStatus === 'unsupported') {
        fileBlock = '<div class="panel__warn">Номера строк недоступны в этом браузере. Открой сайт в Chrome/Edge — там можно подключить файл без сервера.</div>';
      } else {
        fileBlock =
          '<div class="panel__warn">Сайт открыт как file:// — для номеров строк подключи исходный HTML-файл (без сервера, один раз).</div>' +
          '<button class="btn btn--primary panel__connect" data-act="connect">📄 Подключить файл</button>';
      }
    }
    panel.innerHTML =
      '<div class="panel__title">Инспектор <span class="panel__hint">⌘B</span></div>' +
      fileBlock +
      '<div class="panel__count">0 правок на этой странице</div>' +
      '<div class="panel__row">' +
        '<button class="btn" data-act="copy">Скопировать всё</button>' +
        '<button class="btn btn--ghost" data-act="clear">Очистить всё</button>' +
      '</div>';
    panel.querySelector('[data-act="copy"]').onclick = copyAll;
    panel.querySelector('[data-act="clear"]').onclick = clearAll;
    var connectBtn = panel.querySelector('[data-act="connect"]');
    if (connectBtn) connectBtn.onclick = connectFile;
  }

  function refreshCounter() {
    var count = forThisPage(loadAll()).length;
    var c = panel.querySelector('.panel__count');
    if (c) c.textContent = count + (count === 1 ? ' правка' : ' правок') + ' на этой странице';
  }

  function copyAll() {
    var list = loadAll();
    if (!list.length) { flashPanel('Пока нет правок'); return; }
    var byPage = {};
    list.forEach(function (c) { (byPage[c.page] = byPage[c.page] || []).push(c); });
    var lines = ['Правки по сайту (' + (location.host || location.pathname) + ')', ''];
    Object.keys(byPage).forEach(function (page) {
      lines.push('## ' + page);
      byPage[page].forEach(function (c, i) {
        lines.push((i + 1) + '. [' + c.label + '] ' + c.text);
        lines.push('   selector: ' + c.selector);
        if (c.elementText) lines.push('   ' + c.elementText + (c.line ? '  (строка ' + c.line + ')' : ''));
        if (c.style) lines.push('   ' + c.style.size + ' · padding ' + c.style.padding + ' · margin ' + c.style.margin + ' · ' + c.style.font);
      });
      lines.push('');
    });
    var text = lines.join('\n');
    navigator.clipboard.writeText(text).then(function () {
      var count = list.length;
      saveAll([]); // копирование = забрали правки, дальше они не нужны
      renderMarkers();
      flashPanel('Скопировано и очищено (' + count + ')');
    }).catch(function () {
      flashPanel('Не удалось скопировать');
    });
  }

  function clearAll() {
    if (!confirm('Удалить все собранные правки по всему сайту?')) return;
    saveAll([]);
    renderMarkers();
    refreshCounter();
  }

  function flashPanel(msg) {
    var c = panel.querySelector('.panel__count');
    if (!c) return;
    c.textContent = msg;
    setTimeout(refreshCounter, 1400);
  }

  // ---------- стили панели (изолированы в Shadow DOM, не зависят от CSS сайта) ----------
  var CSS =
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.hidden{display:none!important}' +
    '.outline{position:fixed;border:2px solid #c9f24d;background:rgba(201,242,77,.12);' +
      'border-radius:4px;pointer-events:none;z-index:1}' +
    '.tooltip{position:fixed;background:#111;color:#fff;padding:9px 12px;border-radius:8px;' +
      'font-size:12px;line-height:1.5;pointer-events:none;max-width:260px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:2}' +
    '.tooltip b{display:block;color:#c9f24d;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'font-size:12px;margin-bottom:4px}' +
    '.tooltip span{display:block;opacity:.75}' +
    '.tooltip__text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.9!important;' +
      'white-space:normal;word-break:break-word;margin-top:4px;padding-top:4px;' +
      'border-top:1px solid rgba(255,255,255,.15)}' +
    '.editor{position:fixed;width:300px;background:#181818;color:#fff;border-radius:12px;' +
      'padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:auto;z-index:3}' +
    '.editor__head{font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9f24d;margin-bottom:4px}' +
    '.editor__meta{font-size:11px;opacity:.6;margin-bottom:8px;line-height:1.5}' +
    '.editor__text{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'opacity:.85;word-break:break-word}' +
    '.editor textarea{width:100%;min-height:70px;background:#0d0d0d;border:1px solid #333;' +
      'border-radius:8px;color:#fff;padding:8px;font-size:13px;line-height:1.4;resize:vertical}' +
    '.editor__row{display:flex;justify-content:space-between;align-items:center;margin-top:10px}' +
    '.btn{background:#2a2a2a;color:#fff;border:0;border-radius:7px;padding:7px 12px;' +
      'font-size:12px;font-weight:500;cursor:pointer}' +
    '.btn--primary{background:#c9f24d;color:#111}' +
    '.btn--danger{background:#3a1414;color:#ff8080}' +
    '.btn--ghost{background:transparent;border:1px solid #333}' +
    '.panel{position:fixed;right:20px;bottom:20px;width:210px;background:#181818;color:#fff;' +
      'border-radius:14px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:auto;z-index:3}' +
    '.panel.is-dragging{opacity:.85;box-shadow:0 16px 50px rgba(0,0,0,.6)}' +
    '.panel__title{font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center;' +
      'cursor:move;user-select:none;margin:-2px -2px 0;padding:2px}' +
    '.panel__hint{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.5}' +
    '.panel__warn{font-size:10.5px;line-height:1.4;color:#ffcf7a;background:rgba(255,207,122,.1);' +
      'border:1px solid rgba(255,207,122,.3);border-radius:8px;padding:6px 8px;margin-top:8px}' +
    '.panel__ok{font-size:10.5px;line-height:1.4;color:#c9f24d;background:rgba(201,242,77,.1);' +
      'border:1px solid rgba(201,242,77,.3);border-radius:8px;padding:6px 8px;margin-top:8px}' +
    '.panel__connect{width:100%;margin-top:8px}' +
    '.panel__count{font-size:11px;opacity:.7;margin:8px 0 10px}' +
    '.panel__row{display:flex;gap:8px}' +
    '.panel .btn{flex:1}';
})();
