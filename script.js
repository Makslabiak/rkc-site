/* Страховка на случай, если page-entry.js не подключили: там объявлен общий
   переключатель системной настройки «Уменьшение движения», и без него все
   двенадцать мест, которые его спрашивают, упали бы с ошибкой. Значение то
   же самое, менять решение надо в page-entry.js, а не здесь. */
window.rksReduceMotion = window.rksReduceMotion || function () { return false; };

/* Единый пресет дизера для всех фото сайта. Меняем параметры здесь —
   основной движок и страницы получают одинаковые значения. */
/* Единый fixed WebGL-canvas нужен для сохранения исходного вида дизера на
   всех брейкпоинтах. На touch-устройствах Lenis синхронизирует виртуальный
   скролл с главным потоком, поэтому canvas и DOM обновляются в одном ticker. */
window.SITE_DITHER_ENGINE = 'shared-webgl';
window.SITE_DITHER_CONFIG = Object.freeze({
  blockPx: 3,
  dpr: 1.5,
  textureMaxEdge: 2048,
  textureOversample: 1.25,
  bias: 0.16,
  levels: 4,
  exposure: 0.8,
  saturation: 1.12,
  dark: [8, 37, 84],
  light: [215, 240, 255]
});
/* Единая настройка для всех scramble-эффектов сайта. */
window.SITE_SCRAMBLE_CONFIG = Object.freeze({
  chars: 'ркс-нр',
  duration: 1.3,
  speed: 1.2
});
window.SITE_SCRAMBLE_CHARS = window.SITE_SCRAMBLE_CONFIG.chars;
document.documentElement.style.setProperty('--dither-exposure', window.SITE_DITHER_CONFIG.exposure);
document.documentElement.style.setProperty('--dither-saturation', window.SITE_DITHER_CONFIG.saturation);

/* ---------- Типографика ----------
   Короткие русские предлоги и союзы не должны отрываться от следующего
   слова при переносе. Работаем по текстовым узлам после site-header.js,
   поэтому правило применяется и к динамической шапке/мобильному меню. */
(function applySiteTypography() {
  if (!document.body) return;

  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'PRE', 'CODE', 'SVG']);
  const textNodes = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT
  );

  const typograph = (value) => value
    .replace(/(^|[^А-Яа-яЁё])([А-Яа-яЁё])[\t\n\r ]+(?=[А-Яа-яЁё0-9])/g, '$1$2\u00A0')
    .replace(/№[\t\n\r ]+(?=\d)/g, '№\u00A0')
    .replace(/[\t\n\r ]+(?:—|–)[\t\n\r ]+/g, '\u00A0—\u00A0')
    .replace(/\.\.\./g, '…');

  let node;
  while ((node = textNodes.nextNode())) {
    const parent = node.parentElement;
    if (!parent || skipTags.has(parent.tagName) || parent.closest('script, style, noscript, pre, code, svg')) continue;
    node.nodeValue = typograph(node.nodeValue);
  }
})();

/* ---------- единый переход страницы и общей шапки ----------
   Сохраняем обычную HTML-навигацию для Битрикса. Весь экран исчезает
   с ускорением, а подготовленная страница проявляется с замедлением. */
(function initPageTransitions() {
  const root = document.documentElement;
  const motion = { get matches() { return window.rksReduceMotion(); } };
  const ENTER_MS = 800;
  const EXIT_MS = 600;
  const easeOut = 'cubic-bezier(.215, .61, .355, 1)';
  const easeIn = 'cubic-bezier(.55, .055, .675, .19)';
  const animations = new Set();
  let leaving = false;
  let exitTimer;
  let releaseTimer;
  let readinessTimer;
  const useEntryLoader = window.__rksPageEntering && document.querySelector('.loader');

  function animate(element, frames, duration, easing) {
    if (!element.animate || motion.matches) return Promise.resolve();
    const animation = element.animate(frames, { duration, easing, fill: 'both' });
    animations.add(animation);
    return animation.finished.catch(() => {});
  }

  function release() {
    window.clearTimeout(window.__rksPageEntryFallback);
    window.clearTimeout(readinessTimer);
    window.__rksPageEntering = false;
    window.__rksPageEnteringHome = false;
    root.classList.remove(
      'is-page-entering',
      'is-page-entering-home',
      'is-page-leaving',
      'is-page-leaving-to-home'
    );
    root.classList.add('is-loaded');
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    document.body.inert = false;
    window.lenis?.start();
  }

  function reveal() {
    if (!window.__rksPageEntering || leaving) return;
    window.clearTimeout(window.__rksPageEntryFallback);
    window.clearTimeout(readinessTimer);
    window.__rksPageEntering = false;
    root.classList.add('is-loaded', 'is-hero-zoom-started');
    window.dispatchEvent(new CustomEvent('site:hero-zoom'));
    window.dispatchEvent(new CustomEvent('site:loaded'));
    const effects = [
      animate(document.body, [{ opacity: 0 }, { opacity: 1 }], ENTER_MS, easeOut)
    ];
    if (window.matchMedia('(max-width: 599px)').matches) {
      document.querySelectorAll('.site-logo, .site-header__actions').forEach((part) => {
        effects.push(animate(part, [
          { transform: 'translateY(16px)' }, { transform: 'translateY(0)' }
        ], ENTER_MS, easeOut));
      });
    }
    // Не оставляем заблокированный экран, если вкладка ушла в фон.
    releaseTimer = window.setTimeout(release, ENTER_MS + 200);
    Promise.all(effects).then(() => {
      if (leaving) return;
      window.clearTimeout(releaseTimer);
      release();
    });
  }

  async function prepareEntry() {
    if (!window.__rksPageEntering) return;
    document.body.inert = true;
    window.lenis?.stop();
    const inViewport = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < window.innerHeight;
    };
    const images = Array.from(document.images).filter(inViewport);
    const imageReady = images.map((img) => {
      img.loading = 'eager';
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    });
    const ditherReady = new Promise((resolve) => {
      const targets = Array.from(document.querySelectorAll(
        '.image-tone, .hero__media[data-dither-src]'
      )).filter(inViewport);
      const observer = new MutationObserver(check);
      const timeout = window.setTimeout(done, 1500);
      function done() {
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
      function check() {
        if (targets.every((el) => el.classList.contains('is-shared-dither-ready'))) done();
      }
      targets.forEach((el) => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
      check();
    });
    const ready = Promise.all([
      document.fonts?.ready,
      window.__rksAnimationsReady,
      ...imageReady,
      ditherReady
    ]);
    await Promise.race([
      ready,
      new Promise((resolve) => { readinessTimer = window.setTimeout(resolve, 2000); })
    ]);
    window.clearTimeout(readinessTimer);
    window.ScrollTrigger?.refresh();
    // После измерений и загрузки текстур отдаём браузеру кадр на композицию.
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }

  if (window.__rksPageEntering && !useEntryLoader) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', prepareEntry, { once: true });
    } else {
      prepareEntry();
    }
  }

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    window.clearTimeout(exitTimer);
    window.clearTimeout(releaseTimer);
    leaving = false;
    release();
    try { sessionStorage.removeItem('rks-page-transition'); } catch (error) { /* no-op */ }
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    const link = event.target.closest('a');
    if (!link || (link.target && link.target !== '_self') ||
        link.hasAttribute('download') || link.dataset.noTransition !== undefined) return;
    const destination = new URL(link.href, location.href);
    if (!/^https?:$/.test(destination.protocol) || destination.origin !== location.origin ||
        (destination.pathname === location.pathname && destination.search === location.search) ||
        !/(?:\/|\.html)$/.test(destination.pathname)) return;
    if (motion.matches || !document.body.animate) return;

    event.preventDefault();
    if (leaving) return;
    leaving = true;
    window.clearTimeout(releaseTimer);
    window.clearTimeout(window.__rksPageEntryFallback);
    const opacity = getComputedStyle(document.body).opacity;
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    root.classList.remove('is-page-entering');
    root.classList.add('is-page-leaving');
    const isHomeDestination = destination.pathname === '/' ||
      /(?:^|\/)index\.html$/i.test(destination.pathname);
    root.classList.toggle('is-page-leaving-to-home', isHomeDestination);
    document.body.inert = true;
    window.lenis?.stop();
    try {
      sessionStorage.setItem('rks-page-transition', JSON.stringify({
        url: destination.pathname + destination.search,
        time: Date.now(),
        home: isHomeDestination
      }));
    } catch (error) { /* Обычная навигация доступна без хранилища. */ }
    let navigated = false;
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      window.clearTimeout(exitTimer);
      location.assign(destination.href);
    };
    animate(document.body, [{ opacity }, { opacity: 0 }], EXIT_MS, easeIn).then(navigate);
    exitTimer = window.setTimeout(navigate, EXIT_MS + 150);
  });
})();

/* На обычном reload браузер часто восстанавливает прежнюю позицию скролла.
   Тогда scrub-анимация блока услуг сразу оказывается в финале и выглядит
   так, будто не запустилась. На главной без hash начинаем reload сверху. */
(function resetHomeScrollOnReload() {
  if (document.body?.dataset.sitePage !== 'home' || location.hash) return;
  const navigation = performance.getEntriesByType?.('navigation')?.[0];
  if (navigation?.type !== 'reload') return;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const reset = () => {
    window.scrollTo(0, 0);
    window.lenis?.scrollTo(0, { immediate: true });
  };

  reset();
  window.addEventListener('pageshow', () => {
    window.requestAnimationFrame(reset);
  }, { once: true });
})();

/* ---------- Лоадер: гейт готовности страницы ----------
   Ждём шрифты и первый кадр hero-дизера, затем запускаем закрытие лоадера
   вместе с зумом hero и вступительными анимациями из animations.js.
   Вся тяжёлая разовая работа — декодирование картинки, WebGL-дизер, разбор
   текста SplitText — успевает пройти за этим экраном, невидимо для глаза.
   Защитный таймаут — чтобы страница не зависла наглухо, если что-то из
   перечисленного никогда не срастётся (медленная сеть, ошибка загрузки). */
(function initLoader() {
  const root = document.documentElement;
  const hasHero = !!document.querySelector('.hero__media[data-dither-src]');
  const loader = document.querySelector('.loader');
  // Внутренние страницы без лоадера раскрывает общий переход выше. На
  // главной лоадер остаётся видимым и выполняет штатный FLIP-переход.
  if (window.__rksPageEntering && !loader) return;
  const loaderBackdrop = loader?.querySelector('.loader__backdrop');
  const loaderLogo = loader?.querySelector('.loader__logo');
  const heroLogo = document.querySelector('.site-logo img');
  const MIN_DISPLAY_MS = 2000;
  const SAFETY_MS = 4000;
  const EXIT_MS = 950;
  const HERO_ANIMATION_DELAY_MS = 500;

  let resolveHeroReady;
  const heroReady = hasHero
    ? new Promise((resolve) => { resolveHeroReady = resolve; })
    : Promise.resolve();
  window.__resolveHeroReady = resolveHeroReady;

  const fontsReady = document.fonts && document.fonts.ready
    ? document.fonts.ready
    : Promise.resolve();

  let animationsStarted = false;
  let heroZoomStarted = false;
  function startHeroZoom() {
    if (heroZoomStarted) return;
    heroZoomStarted = true;
    root.classList.add('is-hero-zoom-started');
    window.dispatchEvent(new CustomEvent('site:hero-zoom'));
  }

  function startHeroAnimations() {
    if (animationsStarted) return;
    animationsStarted = true;
    window.dispatchEvent(new CustomEvent('site:loaded'));
  }

  function revealPage() {
    window.clearTimeout(window.__rksPageEntryFallback);
    window.__rksPageEntering = false;
    window.__rksPageEnteringHome = false;
    root.classList.remove('is-page-entering', 'is-page-entering-home');
    root.classList.add('is-loaded');
    document.body.inert = false;
    window.lenis?.start();
  }

  let done = false;
  function finish() {
    if (done) return;

    /* Скрытая вкладка (открытие в фоне, восстановленная сессия) не выполняет
       requestAnimationFrame, а именно в его колбэке ниже живёт и FLIP-переход,
       и снятие лоадера. Без этой проверки страница, открытая в фоне, оставалась
       под заставкой до самого переключения на вкладку. Ждём момент, когда на
       неё действительно посмотрят: тогда и переход отыграет по актуальным
       координатам, а не по измеренным несколько минут назад. */
    if (document.hidden) {
      document.addEventListener('visibilitychange', function onVisible() {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', onVisible);
        finish();
      });
      return;
    }

    done = true;

    const reduceMotion = window.rksReduceMotion();
    if (!loader || !loaderBackdrop || !loaderLogo || !heroLogo || reduceMotion) {
      startHeroZoom();
      startHeroAnimations();
      revealPage();
      return;
    }

    const start = loaderLogo.getBoundingClientRect();
    const target = heroLogo.getBoundingClientRect();
    const loaderRect = loader.getBoundingClientRect();
    const logoScaleX = start.width / target.width;
    const logoScaleY = start.height / target.height;
    const logoTranslateX = start.left - target.left;
    const logoTranslateY = start.top - target.top;
    const backdropInset = 2;
    const backdropScaleX = (target.width - backdropInset * 2) / loaderRect.width;
    const backdropScaleY = (target.height - backdropInset * 2) / loaderRect.height;
    const backdropTranslateX = target.left + backdropInset - loaderRect.left;
    const backdropTranslateY = target.top + backdropInset - loaderRect.top;

    /* FLIP: сразу задаём логотипу финальную геометрию, но обратным transform
       визуально оставляем его большим и по центру. Во время анимации меняется
       только transform — без layout и перерисовки на каждом кадре. */
    loader.classList.add('is-preparing');
    Object.assign(loaderLogo.style, {
      top: `${target.top}px`,
      left: `${target.left}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
      maxWidth: 'none',
      transform: `translate3d(${logoTranslateX}px, ${logoTranslateY}px, 0) scale(${logoScaleX}, ${logoScaleY})`,
    });
    loaderLogo.getBoundingClientRect();

    /* Отдельный кадр нужен, чтобы браузер запомнил большой стартовый rect,
       а затем интерполировал его до логотипа в шапке. */
    window.requestAnimationFrame(() => {
      loader.classList.remove('is-preparing');
      loaderLogo.getBoundingClientRect();
      loader.classList.add('is-exiting');
      loaderBackdrop.style.transform = `translate3d(${backdropTranslateX}px, ${backdropTranslateY}px, 0) scale(${backdropScaleX}, ${backdropScaleY})`;
      loaderLogo.style.transform = 'translate3d(0, 0, 0) scale(1)';

      startHeroZoom();
      window.setTimeout(startHeroAnimations, HERO_ANIMATION_DELAY_MS);
      window.setTimeout(function () {
        revealPage();
        /* opacity: 0 не убирает лоадер из композиции: это fixed-слой во весь
           viewport, чьи дети держат will-change: transform. Он оставался
           поверх страницы до конца сессии и участвовал в каждом кадре.
           Снимаем его совсем, когда переход уже отыграл. */
        window.setTimeout(function () { loader.remove(); }, 400);
      }, EXIT_MS);
    });
  }

  const resourcesReady = Promise.race([
    Promise.all([fontsReady, heroReady]),
    new Promise((resolve) => window.setTimeout(resolve, SAFETY_MS))
  ]);

  Promise.all([
    resourcesReady,
    new Promise((resolve) => window.setTimeout(resolve, MIN_DISPLAY_MS))
  ]).then(finish);
})();

/* Плавный скролл на всех страницах */
(function initSmoothScroll() {
  if (typeof window.Lenis !== 'function') return;
  if (window.rksReduceMotion()) return;
  /* lerp вместо duration+easing: Lenis больше не считает currentTime += delta
     по кадрам, а просто подтягивает позицию к цели на фиксированную долю
     каждый кадр. Просадка кадра тогда даёт чуть больший шаг, а не скачок по
     кривой easing.

     Значение 0.1 — стандартное для Lenis и то же, что у референса
     (oci.madebybuzzworthy.com). Одно время здесь стояло 0.052: снижали по
     ощущениям ради мягкости. Оказалось, что это и было главной причиной
     жалоб на «лаги при прокрутке». Чем меньше lerp, тем дольше страница
     ползёт после жеста и тем мельче её шаг за кадр; на медленном
     равномерном ползании глаз ведёт постоянную скорость и спотыкается о
     любой сбой кадра, даже когда просевших кадров в замере нет. На 0.1
     владелец перестал отличать страницу с дизером от страницы без него,
     хотя на 0.052 разница была очевидна. Подробности в README, раздел
     «Инерция прокрутки». Не снижать обратно без замера и без владельца.

     syncTouchLerp оставлен прежним: на мобильном жалоб не было, а трогать
     тач без проверки на устройстве нет смысла. */
  const lenis = new window.Lenis({
    lerp: 0.1,
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.039,
    wheelMultiplier: 1,
    /* При syncTouch значение 2 удваивает каждый жест и делает мобильный
       скролл заметно резче нативного. Единица сохраняет плавность Lenis,
       но возвращает естественную скорость следования за пальцем. */
    touchMultiplier: 1,
    infinite: false,
  });

  window.lenis = lenis;

  /* Один ticker для Lenis и GSAP исключает рассинхрон между двумя
     независимыми requestAnimationFrame-циклами, особенно заметный на 120 Гц. */
  if (window.gsap) {
    window.gsap.ticker.add((time) => lenis.raf(time * 1000));
  } else {
    function raf(time) {
      lenis.raf(time);
      window.requestAnimationFrame(raf);
    }
    window.requestAnimationFrame(raf);
  }
})();

/* Кастомный scrollbar в стиле референса. Скролл остаётся нативным,
   заменяется только его визуальное представление. */
(function initCustomScrollbar() {
  const track = document.createElement('div');
  track.className = 'site-scrollbar is-hidden';
  track.setAttribute('aria-hidden', 'true');
  track.innerHTML = '<span class="site-scrollbar__thumb"></span>';
  document.body.appendChild(track);

  const thumb = track.querySelector('.site-scrollbar__thumb');
  let limit = 0;
  let hideTimer;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;
  let trackHeight = 0;
  let thumbHeight = 0;
  let maxOffset = 0;
  let metricsDirty = true;
  let updateFrame = 0;
  let dragColorFrame = 0;

  function getScrollLimit() {
    const pageHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    const nativeLimit = Math.max(0, pageHeight - window.innerHeight);
    const lenisLimit = window.lenis && typeof window.lenis.limit === 'number'
      ? window.lenis.limit
      : 0;
    return Math.max(nativeLimit, lenisLimit);
  }

  /* Высота ползунка зависит только от размеров страницы и окна, а не от
     позиции скролла. Раньше она переписывалась на каждом кадре — то есть
     каждый кадр скролла инвалидировал layout ради значения, которое не
     менялось. Теперь пересчёт идёт вместе с остальными метриками. */
  function updateMetrics() {
    limit = getScrollLimit();
    trackHeight = track.clientHeight;
    thumbHeight = limit > 0
      ? Math.max(38, Math.round(window.innerHeight * window.innerHeight / (window.innerHeight + limit) * .8))
      : 0;
    maxOffset = Math.max(0, trackHeight - thumbHeight);
    thumb.style.height = `${thumbHeight}px`;
    metricsDirty = false;
  }

  function updateThumb() {
    if (metricsDirty) updateMetrics();
    const currentScroll = window.lenis && typeof window.lenis.animatedScroll === 'number'
      ? window.lenis.animatedScroll
      : window.scrollY;
    const progress = limit > 0 ? Math.min(1, Math.max(0, currentScroll / limit)) : 0;

    /* На кадрах скролла меняется только transform — композиторное свойство. */
    thumb.style.transform = `translate3d(-50%, ${Math.round(progress * maxOffset)}px, 0)`;
    track.classList.toggle('is-hidden', limit <= 0);
  }

  function showScrollbar() {
    if (limit <= 0) return;
    track.classList.remove('is-hidden');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!isDragging) track.classList.add('is-hidden');
    }, 2000);
  }

  function isDarkBackgroundAtThumb() {
    const viewportMidpoint = window.innerHeight / 2;
    const darkSections = document.querySelectorAll('.hero, .services-hero, .news-cover, .documents-cover, .footer, .documents-footer');
    for (const section of darkSections) {
      const bounds = section.getBoundingClientRect();
      if (bounds.top <= viewportMidpoint && bounds.bottom >= viewportMidpoint) return true;
    }

    const probe = document.elementFromPoint(Math.max(0, window.innerWidth - 2), thumb.getBoundingClientRect().top + thumb.offsetHeight / 2);
    let element = probe;

    while (element && element !== document.body) {
      const style = window.getComputedStyle(element);
      const color = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (color) {
        const values = color[1].split(',').map((value) => Number.parseFloat(value.trim()));
        const alpha = values.length === 4 ? values[3] : 1;
        if (alpha > 0) {
          const luminance = values[0] * .299 + values[1] * .587 + values[2] * .114;
          return luminance < 150;
        }
      }

      if (element.matches('.hero, .services-hero, .news-cover, .documents-cover, .footer, .documents-footer')) {
        return true;
      }
      element = element.parentElement;
    }

    return false;
  }

  /* isDarkBackgroundAtThumb делает elementFromPoint и поднимается по
     предкам с getComputedStyle — это forced layout. Раньше он вызывался
     на каждый pointermove, из-за чего перетаскивание ползунка дёргалось.
     Теперь не чаще одного раза за кадр. */
  function updateDragColor() {
    if (dragColorFrame) return;
    dragColorFrame = window.requestAnimationFrame(() => {
      dragColorFrame = 0;
      thumb.classList.toggle('is-over-dark', isDragging && isDarkBackgroundAtThumb());
    });
  }

  function getCurrentScroll() {
    return window.lenis && typeof window.lenis.animatedScroll === 'number'
      ? window.lenis.animatedScroll
      : window.scrollY;
  }

  function scrollToPosition(value) {
    const nextScroll = Math.min(limit, Math.max(0, value));
    if (window.lenis) {
      window.lenis.scrollTo(nextScroll, { immediate: true });
    } else {
      window.scrollTo(0, nextScroll);
    }
  }

  thumb.addEventListener('pointerdown', (event) => {
    if (limit <= 0) return;
    isDragging = true;
    dragStartY = event.clientY;
    dragStartScroll = getCurrentScroll();
    thumb.classList.add('is-dragging');
    thumb.setPointerCapture(event.pointerId);
    showScrollbar();
    updateDragColor();
    event.preventDefault();
  });

  thumb.addEventListener('pointermove', (event) => {
    if (!isDragging) return;
    /* maxOffset уже посчитан в updateMetrics — читать clientHeight и
       offsetHeight на каждый move значило форсировать layout. */
    const scrollDelta = (event.clientY - dragStartY) / Math.max(1, maxOffset) * limit;
    scrollToPosition(dragStartScroll + scrollDelta);
    showScrollbar();
    updateDragColor();
    event.preventDefault();
  });

  function stopDragging(event) {
    if (!isDragging) return;
    isDragging = false;
    thumb.classList.remove('is-dragging');
    thumb.classList.remove('is-over-dark');
    if (event && thumb.hasPointerCapture(event.pointerId)) {
      thumb.releasePointerCapture(event.pointerId);
    }
    showScrollbar();
  }

  thumb.addEventListener('pointerup', stopDragging);
  thumb.addEventListener('pointercancel', stopDragging);

  function handleScrollActivity() {
    if (updateFrame) return;
    updateFrame = window.requestAnimationFrame(() => {
      updateFrame = 0;
      updateThumb();
      showScrollbar();
    });
  }

  function refreshScrollbar() {
    metricsDirty = true;
    handleScrollActivity();
  }

  window.addEventListener('resize', refreshScrollbar, { passive: true });
  /* То же дублирование, что и у меню: Lenis эмитит scroll на каждом кадре,
     нативное событие поверх него — лишний проход. */
  if (window.lenis) {
    window.lenis.on('scroll', handleScrollActivity);
  } else {
    window.addEventListener('scroll', handleScrollActivity, { passive: true });
  }
  window.addEventListener('load', refreshScrollbar, { once: true });
  document.fonts?.ready.then(refreshScrollbar);
  if ('ResizeObserver' in window) {
    new ResizeObserver(refreshScrollbar).observe(document.documentElement);
  }
  window.__rksScrollbarRefresh = refreshScrollbar;
  handleScrollActivity();
})();

const menuButton = document.querySelector('.menu-button');
const menuButtonLabels = menuButton?.querySelectorAll('.button__text');
const menuPanel = document.querySelector('.menu-panel');
const menuLinks = document.querySelectorAll('.menu-panel__nav a');
let menuCloseTimer;
let menuMotion;
function setMenuButtonLabels(open) {
  if (!menuButtonLabels?.length) {
    menuButton.textContent = 'Меню';
    return;
  }

  menuButtonLabels[0].textContent = 'Меню';
  menuButtonLabels[1].textContent = open ? 'Закрыть' : 'Меню';
}

function finishMenuClose() {
  window.clearTimeout(menuCloseTimer);
      menuPanel.hidden = true;
      menuPanel.classList.remove('is-closing');
      document.body.classList.remove('menu-closing');
      document.documentElement.classList.remove('menu-closing');
}

if (menuPanel && window.gsap) {
  const gsap = window.gsap;
  const nav = menuPanel.querySelector('.menu-panel__nav');
  const contacts = menuPanel.querySelector('.menu-panel__contacts');
  const contactsTitle = menuPanel.querySelector('.menu-panel__contacts-title');
  const contactsContent = menuPanel.querySelector('.menu-panel__contacts-content');

  menuPanel.classList.add('menu-panel--gsap');
  gsap.set(menuPanel, { '--menu-panel-x': '100%', autoAlpha: 0 });
  gsap.set([nav, contacts], { y: 18, autoAlpha: 0 });
  gsap.set([contactsTitle, contactsContent], { y: 12, autoAlpha: 0 });
  if (contacts) gsap.set(contacts, { '--menu-line-progress': 0 });

  menuMotion = gsap.timeline({ paused: true, onReverseComplete: finishMenuClose });
  menuMotion
    .to(menuPanel, { '--menu-panel-x': '0%', autoAlpha: 1, duration: .5, ease: 'power2.inOut' }, 0)
    .to(nav, { y: 0, autoAlpha: 1, duration: .36, ease: 'power2.out' }, .12)
    .to(contacts, { y: 0, autoAlpha: 1, duration: .4, ease: 'power2.out' }, .26)
    .to(contacts, { '--menu-line-progress': 1, duration: .42, ease: 'power2.out' }, .31)
    .to(contactsTitle, { y: 0, autoAlpha: 1, duration: .36, ease: 'power2.out' }, .36)
    .to(contactsContent, { y: 0, autoAlpha: 1, duration: .4, ease: 'power2.out' }, .41);
}

function setMenu(open) {
  if (!menuPanel || !menuButton) return;

  window.clearTimeout(menuCloseTimer);

  const isOpen = menuPanel.classList.contains('is-open');
  const isClosing = menuPanel.classList.contains('is-closing');

  /* Повторный вызов закрытия во время reverse() разворачивал timeline
     обратно в сторону открытия. Из-за этого пункты иногда оставались в
     промежуточном состоянии после wheel/touchmove или клика по overlay. */
  if (!open && (menuPanel.hidden || isClosing)) return;
  if (open && isOpen && !isClosing) return;

  if (open) {
    menuPanel.hidden = false;
    menuPanel.setAttribute('aria-hidden', 'false');
    menuPanel.classList.remove('is-closing');
    /* Возвращаем панель в стартовую точку перед каждым новым открытием,
       чтобы повторный запуск после закрытия не перескакивал без перехода. */
    menuPanel.classList.remove('is-open');
    void menuPanel.offsetWidth;
    menuPanel.classList.add('is-open');
    if (menuMotion) {
      menuMotion.timeScale(.8);
      menuMotion.play();
    }
  } else if (!menuPanel.hidden) {
    menuPanel.setAttribute('aria-hidden', 'true');
    menuPanel.classList.remove('is-open');
    menuPanel.classList.add('is-closing');
    if (menuMotion) {
      menuMotion.timeScale(1);
      menuMotion.reverse();
      menuCloseTimer = window.setTimeout(finishMenuClose, 1200);
    } else {
      menuCloseTimer = window.setTimeout(() => {
        menuPanel.hidden = true;
        menuPanel.classList.remove('is-closing');
        document.body.classList.remove('menu-closing');
      }, window.rksReduceMotion() ? 20 : 1050);
    }
  }

  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  setMenuButtonLabels(open);
  syncMenuFocus(open);
  if (open) {
    document.body.classList.add('menu-open');
    document.body.classList.remove('menu-closing');
    document.documentElement.classList.add('menu-open');
    document.documentElement.classList.remove('menu-closing');
  } else if (!menuPanel.hidden) {
    document.body.classList.remove('menu-open');
    document.body.classList.add('menu-closing');
    document.documentElement.classList.remove('menu-open');
    document.documentElement.classList.add('menu-closing');
  } else {
    document.body.classList.remove('menu-open', 'menu-closing');
    document.documentElement.classList.remove('menu-open', 'menu-closing');
  }
}

/* Клавиатура в открытом меню.

   Панель перекрывает страницу целиком, но фокус оставался снаружи: Tab уходил
   по ссылкам под ней — пользователь клавиатуры «бродил» по невидимому
   контенту. Уводим фокус внутрь при открытии, замыкаем Tab внутри панели и
   возвращаем фокус на кнопку при закрытии. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function menuFocusable() {
  if (!menuPanel) return [];
  return Array.from(menuPanel.querySelectorAll(FOCUSABLE))
    .filter((element) => element.getAttribute('aria-disabled') !== 'true' && element.offsetParent !== null);
}

function syncMenuFocus(open) {
  if (!menuPanel) return;
  if (open) {
    /* Панель показывается анимацией; фокус ставим в следующем кадре, когда
       элементы уже участвуют в раскладке и offsetParent не null. */
    window.requestAnimationFrame(() => {
      if (!menuPanel.classList.contains('is-open')) return;
      (menuFocusable()[0] || menuPanel).focus({ preventScroll: true });
    });
  } else if (menuPanel.contains(document.activeElement)) {
    menuButton?.focus({ preventScroll: true });
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !menuPanel || menuPanel.hidden ||
      !menuPanel.classList.contains('is-open')) return;
  const items = menuFocusable();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !menuPanel.contains(active))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || !menuPanel.contains(active))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
});

menuPanel?.setAttribute('aria-hidden', 'true');
menuPanel?.setAttribute('tabindex', '-1');
menuButton?.addEventListener('click', () => setMenu(!menuPanel.classList.contains('is-open')));
menuLinks.forEach((link) => {
  if (link.matches('[aria-current="page"]')) {
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    return;
  }
  link.addEventListener('click', () => setMenu(false));
});

document.querySelectorAll('.desktop-nav a[aria-current="page"]').forEach((link) => {
  link.setAttribute('aria-disabled', 'true');
  link.setAttribute('tabindex', '-1');
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
});

document.addEventListener('click', (event) => {
  if (!menuPanel || menuPanel.hidden || !menuPanel.classList.contains('is-open')) return;
  if (event.target.closest('.menu-panel, .site-header__actions')) return;
  setMenu(false);
}, true);

/* matchMedia создаёт новый MediaQueryList на каждый вызов, а syncDesktopMenu
   срабатывает на каждом кадре скролла. Держим один объект. */
const desktopQuery = window.matchMedia('(min-width: 1200px)');

/* Функция вызывается на каждом кадре скролла. Раньше она безусловно писала
   tabIndex и aria-hidden — то есть 60-120 раз в секунду грязнила стиль шапки
   значением, которое почти никогда не меняется. Пишем только на переходе. */
let desktopMenuState = '';
function syncDesktopMenu(scrollTop) {
  const isDesktop = desktopQuery.matches;
  const currentScroll = typeof scrollTop === 'number' ? scrollTop : window.scrollY;
  const isVisible = !isDesktop || currentScroll > 24;
  /* Класс is-scrolled зависит и от брейкпоинта: при одном и том же isVisible
     переход десктоп/адаптив его меняет. Поэтому в ключе оба флага. */
  const state = `${isDesktop}:${isVisible}`;
  if (state === desktopMenuState) return;
  desktopMenuState = state;
  document.body.classList.toggle('is-scrolled', isDesktop && isVisible);
  if (menuButton) {
    menuButton.tabIndex = isVisible ? 0 : -1;
    menuButton.setAttribute('aria-hidden', String(!isVisible));
  }
}

/* При живом Lenis нативный scroll дублирует его собственное событие —
   обработчик отрабатывал дважды за кадр. Подписываемся на что-то одно. */
if (window.lenis) {
  window.lenis.on('scroll', ({ targetScroll }) => syncDesktopMenu(targetScroll));
} else {
  window.addEventListener('scroll', syncDesktopMenu, { passive: true });
}
window.addEventListener('resize', syncDesktopMenu);
syncDesktopMenu();

/* Как в аккордеоне OCI Our Services: все фото загружены заранее отдельными
   плоскостями и переключаются одновременным crossfade без пустого кадра. */
(function initStatsImageHover() {
  const layers = Array.from(document.querySelectorAll('.stats__image-layer'));
  const items = Array.from(document.querySelectorAll('.stat-item[data-stats-index]'));
  if (!layers.length || !items.length) return;

  let activeIndex = 0;
  let activeLayer = layers.find((layer) => layer.classList.contains('is-active')) || layers[0];
  let imageTransitionId = 0;

  function showItemImage(item) {
    const nextIndex = Number.parseInt(item?.dataset.statsIndex || '0', 10);
    if (nextIndex === activeIndex || !layers[nextIndex]) return;
    const nextLayer = layers[nextIndex];
    const previousLayer = activeLayer;
    activeIndex = nextIndex;
    activeLayer = nextLayer;

    window.__rksDitherCrossfade?.(layers, nextLayer, 0.7);

    const transitionId = ++imageTransitionId;
    layers.forEach((layer) => layer.classList.remove('is-front'));
    previousLayer?.classList.add('is-active');
    nextLayer.classList.add('is-active', 'is-front');

    window.setTimeout(() => {
      if (transitionId !== imageTransitionId) return;
      layers.forEach((layer) => {
        layer.classList.toggle('is-active', layer === nextLayer);
        layer.classList.remove('is-front');
      });
    }, 700);
  }

  items.forEach((item) => {
    item.addEventListener('pointerenter', () => showItemImage(item));
    item.addEventListener('focus', () => showItemImage(item));
  });

  document.querySelector('.stats__list')?.addEventListener('pointerleave', () => {
    const focusedItem = document.activeElement?.closest?.('.stat-item[data-stats-index]');
    showItemImage(focusedItem || items[0]);
  });
})();

/* Декор, привязанный к тексту. Линии и разрывы в линиях раньше стояли на
   долях высоты, подогнанных под текущий текст: правка из админки на строку
   длиннее наезжала на линию, на строку короче оставляла дыру. Блок, за
   который держится декор, помечается data-box-var="имя", и его фактическая
   коробка публикуется переменными --имя-top / --имя-bottom на своей секции
   (или на элементе из data-box-target). Куда их подставить, решает CSS. */
(function initTextBoxVars() {
  const parts = Array.from(document.querySelectorAll('[data-box-var]'))
    .map((element) => ({
      element,
      name: element.dataset.boxVar,
      host: (element.dataset.boxTarget && element.closest(element.dataset.boxTarget))
        || element.closest('section, header, footer')
        || element.parentElement,
    }))
    .filter((part) => part.name && part.host);
  if (!parts.length) return;

  let frameId = 0;
  const sync = () => {
    frameId = 0;
    parts.forEach(({ element, name, host }) => {
      const hostRect = host.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      host.style.setProperty(`--${name}-top`, `${rect.top - hostRect.top}px`);
      host.style.setProperty(`--${name}-bottom`, `${rect.bottom - hostRect.top}px`);
    });
  };

  const scheduleSync = () => {
    if (frameId) return;
    frameId = requestAnimationFrame(sync);
  };

  scheduleSync();
  window.addEventListener('load', scheduleSync);
  window.addEventListener('resize', scheduleSync);
  document.fonts?.ready.then(scheduleSync);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleSync);
    parts.forEach(({ element }) => observer.observe(element));
  }
})();

document.addEventListener('keydown', (event) => {
  /* Страница без общей шапки (например, стенд плеера) подключает тот же
     script.js — без проверки обработчик падал на каждое нажатие клавиши. */
  if (event.key !== 'Escape' || !menuPanel || menuPanel.hidden) return;
  setMenu(false);
  menuButton?.focus();
});

(function initVideoTicker() {
  /* Скорости соответствуют прежнему виду: верх/низ проезжали 2968px за 24s,
     бока — 22946px за 150s. */
  const EDGE_SPEED_PX_PER_SEC = 124;
  const SIDE_SPEED_PX_PER_SEC = 153;
  const isMobile = window.matchMedia('(max-width: 599px)').matches;

  document.querySelectorAll('.video-frame__ticker').forEach((ticker) => {
    const text = ticker.textContent.trim();
    if (!text) return;

    /* На узких и широких экранах ширина строки разная. Измеряем один блок и
       добираем повторы с запасом, чтобы на стыке двух половин не появлялся
       пустой участок. */
    const measure = document.createElement('span');
    measure.className = 'video-frame__ticker-item';
    measure.textContent = text;
    Object.assign(measure.style, {
      position: 'absolute',
      display: 'inline-block',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'nowrap'
    });
    ticker.append(measure);
    /* Боковые тикеры лежат внутри контейнера с transform: rotate(90deg), а
       getBoundingClientRect отдаёт размеры в ЭКРАННЫХ координатах, уже с
       учётом трансформаций предков. Строка шириной 669px, повёрнутая на бок,
       мерилась как 20px — и вместо 2 повторов получалось 35. Треки боковых
       строк раздувались до 45892px: два композиторных слоя по 5248 символов,
       которые GPU держал и бесконечно двигал. offsetWidth даёт размер в
       собственной системе координат элемента, без поворота. */
    const itemWidth = measure.offsetWidth;
    measure.remove();
    const tickerWidth = ticker.offsetWidth;
    const repeats = Math.max(1, Math.ceil(tickerWidth / Math.max(itemWidth, 1)) + 1);
    const loopText = Array.from({ length: repeats }, () => text).join('　');

    const track = document.createElement('span');
    track.className = 'video-frame__ticker-track';

    /* Две одинаковые половины позволяют оставить translateX(-50%) и сделать
       цикл бесшовным, независимо от ширины конкретной стороны видео. */
    for (let index = 0; index < 2; index += 1) {
      const item = document.createElement('span');
      item.className = 'video-frame__ticker-item';
      item.textContent = loopText;
      if (index > 0) item.setAttribute('aria-hidden', 'true');
      track.append(item);
    }

    ticker.replaceChildren(track);

    /* Длительность раньше была захардкожена в CSS (24s сверху/снизу, 150s по
       бокам) и подогнана под тогдашнюю ширину трека. Но анимация сдвигает
       трек на -50% его СОБСТВЕННОЙ ширины, поэтому фиксированная длительность
       означает скорость, зависящую от длины строки: как только трек стал
       короче, боковые строки поползли в те же 11 раз медленнее. Считаем
       длительность от фактической ширины — скорость в пикселях в секунду
       остаётся той же на любом экране и при любом шрифте. */
    const isSide = ticker.classList.contains('video-frame__ticker--left')
      || ticker.classList.contains('video-frame__ticker--right');
    const mobileSpeedMultiplier = isSide ? 0.4 : 0.5;
    const speed = (isSide ? SIDE_SPEED_PX_PER_SEC : EDGE_SPEED_PX_PER_SEC)
      * (isMobile ? mobileSpeedMultiplier : 1);
    const travel = track.offsetWidth / 2;
    if (travel > 0) {
      track.style.animationDuration = `${(travel / speed).toFixed(2)}s`;
    }
  });

  /* Бегущая строка крутится только когда видео действительно вошло в экран.
     Раньше rootMargin запускал четыре слоя на 200px заранее — одновременно
     с завершением анимации последней карточки услуг. */
  const videoSections = document.querySelectorAll('.video-section');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle(
          'is-ticker-active',
          entry.isIntersecting && entry.intersectionRatio >= 0.1
        );
      });
    }, { threshold: [0, 0.1] });
    videoSections.forEach((section) => observer.observe(section));
  } else {
    videoSections.forEach((section) => section.classList.add('is-ticker-active'));
  }
})();

(function initNewsCards() {
  const grid = document.querySelector('.news__grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.news-card'));
  const imageLayers = Array.from(document.querySelectorAll('.news__image-layer'));
  const defaultCard = cards[0] || grid.querySelector('.news-card--featured') || cards[1];
  let activeLayer = imageLayers.find((layer) => layer.classList.contains('is-active')) || null;
  let imageTransitionId = 0;

  const activate = (card) => {
    const index = cards.indexOf(card);
    if (index < 0) return;

    const column = index % 2;
    const row = Math.floor(index / 2);
    cards.forEach((item) => item.classList.toggle('is-active', item === card));
    const nextLayer = imageLayers[index];
    const changed = nextLayer && nextLayer !== activeLayer;
    if (changed) {
      window.__rksDitherCrossfade?.(imageLayers, nextLayer, 0.7);
    }

    if (changed && nextLayer) {
      const previousLayer = activeLayer;
      const transitionId = ++imageTransitionId;
      imageLayers.forEach((layer) => layer.classList.remove('is-front'));
      previousLayer?.classList.add('is-active');
      nextLayer.classList.add('is-active', 'is-front');

      window.setTimeout(() => {
        if (transitionId !== imageTransitionId) return;
        imageLayers.forEach((layer) => {
          layer.classList.toggle('is-active', layer === nextLayer);
          layer.classList.remove('is-front');
        });
      }, 700);
    } else {
      imageLayers.forEach((layer, layerIndex) => {
        layer.classList.toggle('is-active', layerIndex === index);
      });
    }
    activeLayer = nextLayer || activeLayer;
    grid.style.setProperty('--news-indicator-x', `${column * 100}%`);
    grid.style.setProperty('--news-indicator-y', `${row * 100}%`);
  };

  /* Стрелка одна на весь блок и держится, пока указатель или фокус внутри
     сетки. При переходе на соседнюю карточку она переезжает вместе с тёмной
     подложкой, а не гаснет и не раскрывается заново. Считаем указатель и
     фокус по отдельности: иначе уход фокуса гасил бы стрелку под курсором. */
  let pointerInside = false;
  let focusInside = false;
  const syncArrow = () => {
    grid.classList.toggle('is-arrow-visible', pointerInside || focusInside);
  };

  cards.forEach((card) => {
    card.addEventListener('pointerenter', () => activate(card));
    card.addEventListener('focus', () => {
      focusInside = true;
      syncArrow();
      activate(card);
    });
  });

  grid.addEventListener('pointerenter', () => {
    pointerInside = true;
    syncArrow();
  });
  grid.addEventListener('pointerleave', () => {
    pointerInside = false;
    syncArrow();
    activate(defaultCard);
  });
  grid.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (grid.contains(document.activeElement)) return;
      focusInside = false;
      syncArrow();
      activate(defaultCard);
    });
  });

  activate(defaultCard);
})();

(function initProjectLineGaps() {
  const cards = document.querySelectorAll('.project-card');
  if (!cards.length) return;

  const section = cards[0].closest('.projects');
  /* matchMedia создавал новый MediaQueryList на каждую карточку на каждом
     кадре скролла. Один объект на всю функцию. */
  const tabletQuery = window.matchMedia('(min-width: 600px) and (max-width: 1199px)');
  /* Ссылки на заголовок и описание не меняются — querySelector в цикле
     каждого кадра был лишним обходом DOM. */
  const parts = Array.from(cards, (card) => ({
    card,
    heading: card.querySelector('.project-card__body > h3'),
    description: card.querySelector('.project-card__body > p')
  }));

  let frameId = 0;
  const sync = () => {
    frameId = 0;

    /* Сначала ВСЕ чтения, потом ВСЕ записи.

       Раньше цикл чередовал getBoundingClientRect и setProperty. Запись
       кастомного свойства инвалидирует стиль, поэтому следующее чтение
       форсировало полный пересчёт раскладки — и так дважды за кадр. А кадр
       здесь не редкий: sync вызывается из onUpdate параллакса, то есть на
       каждом кадре прокрутки, пока сетка проектов в экране. */
    const sectionRect = section?.getBoundingClientRect();
    const lineClearance = tabletQuery.matches ? 30 : 0;
    const measurements = parts.map(({ card, heading, description }) => {
      const cardRect = card.getBoundingClientRect();
      const hasBody = Boolean(heading && description);
      return {
        card,
        hasBody,
        headingTop: hasBody ? heading.getBoundingClientRect().top : 0,
        descriptionBottom: hasBody ? description.getBoundingClientRect().bottom : 0,
        cardTop: cardRect.top,
        cardLeft: cardRect.left
      };
    });

    measurements.forEach((measurement, index) => {
      const style = measurement.card.style;
      if (measurement.hasBody) {
        style.setProperty('--project-line-gap-start', `${measurement.headingTop - measurement.cardTop - lineClearance}px`);
        style.setProperty('--project-line-gap-end', `${measurement.descriptionBottom - measurement.cardTop + lineClearance}px`);
        if (sectionRect) {
          style.setProperty('--project-line-height', `${sectionRect.bottom - measurement.cardTop}px`);
        }
      }
      if (section && sectionRect) {
        section.style.setProperty(`--projects-line-${index + 1}-x`, `${measurement.cardLeft - sectionRect.left}px`);
      }
    });
  };

  const scheduleSync = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(sync);
  };

  /* Параллакс двигает .project-card__body через transform, поэтому обычный
     ResizeObserver этого не видит. Анимация вызывает этот лёгкий rAF-sync,
     и разрывы вертикальных линий всё время следуют за заголовком и текстом. */
  window.__rksSyncProjectLines = scheduleSync;

  scheduleSync();
  window.addEventListener('load', scheduleSync);
  window.addEventListener('resize', scheduleSync);
  document.fonts?.ready.then(scheduleSync);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleSync);
    cards.forEach((card) => observer.observe(card));
  }
})();

/* Bayer-дизер целиком живёт в services-dither.js: один WebGL-canvas на
   весь viewport. Прежняя реализация (canvas на каждую картинку +
   CPU-фолбэк) лежала здесь и была недостижима — SITE_DITHER_ENGINE
   выставляется в 'shared-webgl' в начале этого же файла. Удалена. */

/* Ленивые картинки догружаются фоном, когда страница уже показана.

   Зачем. Подготовка кадра для дизера — загрузка текстуры в видеопамять —
   стоит около 60 мс главного потока и не зависит от размера картинки: это
   не перекачка пикселей, а остановка конвейера GL. Пока картинки были
   ленивыми, они долетали ровно в момент появления секции, и эта остановка
   приходилась на анимацию её заголовка. Замер CDP на Intel HD 530: 13
   загрузок из 18 попадали в прокрутку.

   Теперь после входной анимации мы тихо доводим оставшиеся кадры по одному,
   в свободное время. К моменту, когда пользователь доберётся до секции,
   всё готово, и в прокрутку не приходится ничего. Замер: просевших кадров
   при прокрутке 0 из 359.

   Первый экран это не утяжеляет: файлы запрашиваются уже после загрузки
   страницы и с низким приоритетом. */
(function initLazyWarmup() {
  /* Экономия трафика и медленная сеть — случай, когда лишнего качать нельзя:
     пользователь сам попросил обратное. Там ленивость остаётся как была. */
  const connection = navigator.connection;
  if (connection && (connection.saveData
      || /^(slow-)?2g$/.test(connection.effectiveType || ''))) return;

  let busy = false;

  function next() {
    return document.querySelector('img[loading="lazy"]:not([data-warmed])');
  }

  function step() {
    if (busy) return;
    const image = next();
    if (!image) return;
    busy = true;
    image.dataset.warmed = '1';
    image.loading = 'eager';
    if ('fetchPriority' in image) image.fetchPriority = 'low';
    /* Следующий кадр берём только после того, как этот долетел: две
       остановки конвейера подряд в одном кадре не нужны никому. */
    const done = () => {
      busy = false;
      schedule();
    };
    if (image.complete && image.naturalWidth) {
      window.setTimeout(done, 0);
      return;
    }
    image.addEventListener('load', () => window.setTimeout(done, 0), { once: true });
    image.addEventListener('error', done, { once: true });
  }

  function schedule() {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(step, { timeout: 1500 });
    } else {
      window.setTimeout(step, 150);
    }
  }

  /* Ждём не просто load, а конец входной анимации: лоадер держит экран 2 с,
     потом полторы секунды въезжает заголовок первого экрана. Начни раньше —
     и остановка конвейера придётся ровно на этот заголовок, то есть рывок
     был бы перенесён, а не убран. */
  let started = false;
  function start() {
    if (started) return;
    started = true;
    window.setTimeout(schedule, 1800);
  }
  window.addEventListener('site:loaded', start, { once: true });
  /* Страховка для страниц без лоадера и на случай, если событие не пришло. */
  window.setTimeout(start, 6000);
})();
