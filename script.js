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

/* ---------- переходы между страницами ----------
   Один светлый слой закрывает текущую страницу перед навигацией и
   открывается обратно уже на следующей. Якоря этой же страницы и внешние
   действия не перехватываем. */
(function initPageTransitions() {
  const TRANSITION_KEY = 'rks-page-transition';
  const TRANSITION_DURATION = 720;
  const ENTER_DURATION = 1000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transition = document.createElement('div');
  transition.className = 'page-transition';
  transition.setAttribute('aria-hidden', 'true');
  document.body.append(transition);

  let mode = null;
  try {
    mode = sessionStorage.getItem(TRANSITION_KEY);
    sessionStorage.removeItem(TRANSITION_KEY);
  } catch (error) {
    mode = null;
  }

  const shouldEnter = mode === 'enter' || mode === 'enter-home';
  const enterToHome = mode === 'enter-home';

  if (shouldEnter && !reduceMotion) {
    transition.classList.add('is-visible', 'is-entering');
    if (enterToHome) transition.classList.add('is-to-home');

    const revealPage = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          transition.classList.remove('is-visible');
          window.setTimeout(
            () => transition.classList.remove('is-entering', 'is-to-home'),
            ENTER_DURATION + 180
          );
        });
      });
    };

    if (enterToHome) {
      /* На главной за вуалью уже стоит свой лоадер — вскрываем сразу,
         вуаль просто мягко проявляет пульсирующий логотип. */
      revealPage();
    } else {
      /* «Дёрганье» на входе — это своп шрифтов, проскакивавший сквозь ещё
         прозрачную вуаль. Держим её до fonts.ready (с потолком, чтобы
         медленная сеть не заперла занавес), потом открываем. */
      Promise.race([
        document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
        new Promise((resolve) => window.setTimeout(resolve, 600))
      ]).then(revealPage);
    }
  }

  /* Возврат из bfcache восстанавливает DOM «как ушли» — вуаль могла остаться
     поднятой после клика по ссылке. Снимаем её, иначе назад ведёт на белый
     (или тёмный) экран. */
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      transition.classList.remove('is-visible', 'is-entering', 'is-to-home');
    }
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;

    const link = event.target.closest('a');
    if (!link || link.target === '_blank' || link.hasAttribute('download') ||
        link.dataset.noTransition !== undefined) return;

    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref === '#' || /^(?:#|mailto:|tel:|javascript:)/i.test(rawHref)) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
         destination.search === window.location.search)) return;

    event.preventDefault();
    if (reduceMotion) {
      window.location.href = destination.href;
      return;
    }

    const isHome = destination.pathname === '/' || /\/index\.html$/i.test(destination.pathname);
    try {
      sessionStorage.setItem(TRANSITION_KEY, isHome ? 'enter-home' : 'enter');
    } catch (error) { /* no-op */ }
    transition.classList.remove('is-entering');
    /* На главную уходим тёмной вуалью в цвет лоадера — стык выход→лоадер
       без резкого перехода со светлого на тёмное. */
    if (isHome) transition.classList.add('is-to-home');
    transition.classList.add('is-visible');
    window.setTimeout(() => { window.location.href = destination.href; }, TRANSITION_DURATION);
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
    root.classList.add('is-loaded');
  }

  let done = false;
  function finish() {
    if (done) return;
    done = true;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lenis = new window.Lenis({
    duration: 1.2,
    easing: (time) => Math.min(1, 1.001 - Math.pow(2, -10 * time)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    syncTouch: true,
    /* Мобильный скролл ощущался слишком резким: палец отрывается — контент
       «выстреливает» и жёстко тормозит. Понижаем и слежение за пальцем
       (меньший lerp = мягче догоняет), и силу инерции после отрыва
       (дефолт 35 даёт слишком длинный и хлёсткий бросок). */
    syncTouchLerp: 0.055,
    touchInertiaMultiplier: 18,
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
const menuLinks = document.querySelectorAll('.menu-panel a');
let menuCloseTimer;
let menuMotion;
const MENU_SCRAMBLE_CHARS = window.SITE_SCRAMBLE_CHARS;

function scrambleMenuButtonLabel(targetText) {
  if (!menuButtonLabels?.length) {
    menuButton.textContent = targetText;
    return;
  }

  menuButtonLabels.forEach((label) => {
    if (window.gsap && window.ScrambleTextPlugin) {
      window.gsap.registerPlugin(window.ScrambleTextPlugin);
      window.gsap.killTweensOf(label);
      window.gsap.fromTo(label,
        { scrambleText: { text: label.textContent } },
        {
          duration: window.SITE_SCRAMBLE_CONFIG.duration,
          ease: 'power2.out',
          scrambleText: {
            text: targetText,
            speed: window.SITE_SCRAMBLE_CONFIG.speed,
            chars: MENU_SCRAMBLE_CHARS
          }
        }
      );
      return;
    }

    /* Fallback, если GSAP или ScrambleTextPlugin ещё не загрузились. */
    const startedAt = performance.now();
    const duration = window.SITE_SCRAMBLE_CONFIG.duration * 1000;
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const settled = Math.floor(targetText.length * progress);
      label.textContent = Array.from(targetText, (character, index) => {
        if (index < settled || character === ' ') return character;
        return MENU_SCRAMBLE_CHARS[Math.floor(Math.random() * MENU_SCRAMBLE_CHARS.length)];
      }).join('');
      if (progress < 1) window.requestAnimationFrame(animate);
    };
    window.requestAnimationFrame(animate);
  });
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
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 1050);
    }
  }

  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  scrambleMenuButtonLabel(open ? 'Закрыть' : 'Меню');
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

menuPanel?.setAttribute('aria-hidden', 'true');
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

function closeMenuOnScrollStart() {
  if (menuPanel && !menuPanel.hidden && menuPanel.classList.contains('is-open')) {
    setMenu(false);
  }
}

window.addEventListener('wheel', closeMenuOnScrollStart, { passive: true });
window.addEventListener('touchmove', closeMenuOnScrollStart, { passive: true });

/* matchMedia создаёт новый MediaQueryList на каждый вызов, а syncDesktopMenu
   срабатывает на каждом кадре скролла. Держим один объект. */
const desktopQuery = window.matchMedia('(min-width: 1200px)');

function syncDesktopMenu(scrollTop) {
  const isDesktop = desktopQuery.matches;
  const currentScroll = typeof scrollTop === 'number' ? scrollTop : window.scrollY;
  const isVisible = !isDesktop || currentScroll > 24;
  document.body.classList.toggle('is-scrolled', isDesktop && isVisible);
  if (menuButton) {
    menuButton.tabIndex = isVisible ? 0 : -1;
    menuButton.setAttribute('aria-hidden', String(!isVisible));
  }
}

/* При живом Lenis нативный scroll дублирует его собственное событие —
   обработчик отрабатывал дважды за кадр. Подписываемся на что-то одно. */
if (window.lenis) {
  window.lenis.on('scroll', ({ animatedScroll }) => syncDesktopMenu(animatedScroll));
} else {
  window.addEventListener('scroll', syncDesktopMenu, { passive: true });
}
window.addEventListener('resize', syncDesktopMenu);
syncDesktopMenu();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menuPanel.hidden) {
    setMenu(false);
    menuButton.focus();
  }
});

document.querySelectorAll('.play-button').forEach((playButton) => {
  playButton.addEventListener('click', (event) => {
    event.currentTarget.classList.toggle('is-active');
  });

  const videoMedia = playButton.closest('.video-frame__media');
  videoMedia?.addEventListener('click', (event) => {
    if (event.target.closest('.play-button')) return;
    playButton.click();
  });
});

(function initVideoTicker() {
  /* Скорости соответствуют прежнему виду: верх/низ проезжали 2968px за 24s,
     бока — 22946px за 150s. */
  const EDGE_SPEED_PX_PER_SEC = 124;
  const SIDE_SPEED_PX_PER_SEC = 153;

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
    const speed = isSide ? SIDE_SPEED_PX_PER_SEC : EDGE_SPEED_PX_PER_SEC;
    const travel = track.offsetWidth / 2;
    if (travel > 0) {
      track.style.animationDuration = `${(travel / speed).toFixed(2)}s`;
    }
  });

  /* Бегущая строка крутится только когда видео действительно вошло в экран.
     Раньше rootMargin запускал четыре слоя на 200px заранее — одновременно
     с завершением анимации последней карточки услуг. */
  const videoSection = document.querySelector('.video-section');
  if (videoSection && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        videoSection.classList.toggle(
          'is-ticker-active',
          entry.isIntersecting && entry.intersectionRatio >= 0.1
        );
      });
    }, { threshold: [0, 0.1] });
    observer.observe(videoSection);
  } else {
    videoSection?.classList.add('is-ticker-active');
  }
})();

(function initNewsCards() {
  const grid = document.querySelector('.news__grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.news-card'));
  const defaultCard = cards[0] || grid.querySelector('.news-card--featured') || cards[1];

  const activate = (card) => {
    const index = cards.indexOf(card);
    if (index < 0) return;

    const column = index % 2;
    const row = Math.floor(index / 2);
    cards.forEach((item) => item.classList.toggle('is-active', item === card));
    grid.style.setProperty('--news-indicator-x', `${column * 100}%`);
    grid.style.setProperty('--news-indicator-y', `${row * 100}%`);
    grid.style.setProperty('--news-button-right', `${column === 0 ? 50 : 0}%`);
    grid.style.setProperty('--news-button-top', `${row * 50}%`);
  };

  cards.forEach((card) => {
    card.addEventListener('pointerenter', () => activate(card));
    card.addEventListener('focus', () => activate(card));
  });

  grid.addEventListener('pointerleave', () => activate(defaultCard));
  grid.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!grid.contains(document.activeElement)) activate(defaultCard);
    });
  });

  activate(defaultCard);
})();

(function initProjectLineGaps() {
  const cards = document.querySelectorAll('.project-card');
  if (!cards.length) return;

  let frameId = 0;
  const sync = () => {
    frameId = 0;
    cards.forEach((card) => {
      const heading = card.querySelector(':scope > h3');
      const description = card.querySelector(':scope > p');
      if (!heading || !description) return;

      const cardRect = card.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const descriptionRect = description.getBoundingClientRect();
      const sectionRect = card.closest('.projects')?.getBoundingClientRect();
      card.style.setProperty('--project-line-gap-start', `${headingRect.top - cardRect.top}px`);
      card.style.setProperty('--project-line-gap-end', `${descriptionRect.bottom - cardRect.top}px`);
      if (sectionRect) {
        card.style.setProperty('--project-line-height', `${sectionRect.bottom - cardRect.top}px`);
      }
    });
  };

  const scheduleSync = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(sync);
  };

  scheduleSync();
  window.addEventListener('load', scheduleSync);
  window.addEventListener('resize', scheduleSync);
  document.fonts?.ready.then(scheduleSync);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleSync);
    cards.forEach((card) => observer.observe(card));
  }
})();

(function initDitherEffect() {
  /* Основным является новый общий WebGL-движок из services-dither.js. */
  if (window.SITE_DITHER_ENGINE === 'shared-webgl') return;

  const BAYER_2 = [[0, 2], [3, 1]];
  const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const BAYER_8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  const MATRIX_SIZE = 8;

  /* Единый размер блока дизера для всех фотографий — такой же, как у hero.
     Больше значение — крупнее зерно; от разрешения исходника результат
     больше не зависит. */
  const DITHER_CONFIG = window.SITE_DITHER_CONFIG;
  const DITHER_BLOCK_PX = DITHER_CONFIG.blockPx;

  /* Единое количество уровней яркости — hero использует 4. */
  const DITHER_LEVELS = DITHER_CONFIG.levels;

  const DPR = Math.min(window.devicePixelRatio || 1, DITHER_CONFIG.dpr);
  /* Базовый порог текущего пресета: в среднем около 70% точек остаются
     тёмно-синими, при этом результат всё ещё зависит от яркости фото. */
  const LIGHT_POINT_BIAS = DITHER_CONFIG.bias;
  const FG_COLOR = DITHER_CONFIG.dark;
  const BG_COLOR = DITHER_CONFIG.light;
  const queue = [];
  let queueIsRunning = false;

  function getMatrix(size) {
    if (size === 2) return { matrix: BAYER_2, count: 4 };
    if (size === 8) return { matrix: BAYER_8, count: 64 };
    return { matrix: BAYER_4, count: 16 };
  }

  /* ---------- GPU-путь: порог Байера считается во фрагментном шейдере ----------
     Один общий WebGL-контекст на все картинки — не упираемся в лимит браузера
     (обычно 8–16 живых контекстов на страницу). Матрица Байера передаётся не
     как uniform-массив (в GLSL ES 1.00 с этим есть проблемы совместимости),
     а как маленькая 8×8-текстура — стандартный приём lookup-таблицы. */
  function createGLDitherer() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false
    });
    if (!gl) return null;

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertexSource = [
      'attribute vec2 aPosition;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = aPosition * 0.5 + 0.5;',
      '  gl_Position = vec4(aPosition, 0.0, 1.0);',
      '}'
    ].join('\n');

    const fragmentSource = [
      'precision mediump float;',
      'varying vec2 vUv;',
      'uniform sampler2D uImage;',
      'uniform sampler2D uBayer;',
      'uniform vec3 uInk;',
      'uniform vec3 uPaper;',
      'uniform float uBias;',
      'uniform float uZoom;',
      'uniform vec2 uGridSize;',
      'uniform float uLevels;',
      'void main() {',
      '  vec2 zoomedUv = (vUv - 0.5) / uZoom + 0.5;',
      '  vec3 rgb = texture2D(uImage, zoomedUv).rgb;',
      '  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));',
      '  vec2 cellIndex = mod(floor(vUv * uGridSize), 8.0);',
      '  vec2 cellUv = (cellIndex + 0.5) / 8.0;',
      '  float threshold = texture2D(uBayer, cellUv).r;',
      '  float levels = max(uLevels, 2.0);',
      '  float scaledLum = luma * (levels - 1.0);',
      '  float lowerLevel = floor(scaledLum);',
      '  float upperLevel = ceil(scaledLum);',
      '  float frac = scaledLum - lowerLevel;',
      '  float ditheredLevel = lowerLevel;',
      '  if (frac + uBias > threshold) { ditheredLevel = upperLevel; }',
      '  float ditheredLum = ditheredLevel / (levels - 1.0);',
      '  gl_FragColor = vec4(mix(uInk, uPaper, ditheredLum), 1.0);',
      '}'
    ].join('\n');

    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    /* полноэкранный квад — два треугольника через TRIANGLE_STRIP */
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const positionLoc = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    /* матрица Байера как 8×8 lookup-текстура — те же сырые значения matrix/64,
       что и в шейдере Figma (без сдвига +0.5), и та же формула, что в CPU-версии */
    const matrixBytes = new Uint8Array(64);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        matrixBytes[y * 8 + x] = Math.round((BAYER_8[y][x] / 64) * 255);
      }
    }
    const bayerTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bayerTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, matrixBytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    /* исходник грузится «сверху вниз», как в 2D canvas — переворачиваем,
       чтобы совпасть с системой координат WebGL */
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const uImage = gl.getUniformLocation(program, 'uImage');
    const uBayer = gl.getUniformLocation(program, 'uBayer');
    const uInk = gl.getUniformLocation(program, 'uInk');
    const uPaper = gl.getUniformLocation(program, 'uPaper');
    const uBias = gl.getUniformLocation(program, 'uBias');
    const uZoom = gl.getUniformLocation(program, 'uZoom');
    const uGridSize = gl.getUniformLocation(program, 'uGridSize');
    const uLevels = gl.getUniformLocation(program, 'uLevels');

    let lost = false;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      lost = true;
    });

    /* Повторная заливка текстуры на GPU — не бесплатная операция (браузеру
       нужно прочитать пиксели канваса и передать в видеопамять). При live-
       перерисовке (hover, любая будущая покадровая анимация) картинка не
       меняется — меняются только числовые uniform'ы, так что грузим текстуру
       заново только когда реально сменился источник. */
    let uploadedSource = null;

    return {
      render(sourceCanvas, fg, bg, bias, zoom, levels) {
        if (lost) return null;

        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        if (uploadedSource !== sourceCanvas) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
          uploadedSource = sourceCanvas;
        }

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bayerTexture);

        gl.useProgram(program);
        gl.uniform1i(uImage, 0);
        gl.uniform1i(uBayer, 1);
        gl.uniform3f(uInk, fg[0] / 255, fg[1] / 255, fg[2] / 255);
        gl.uniform3f(uPaper, bg[0] / 255, bg[1] / 255, bg[2] / 255);
        gl.uniform1f(uBias, bias);
        gl.uniform1f(uZoom, zoom || 1);
        gl.uniform2f(uGridSize, width, height);
        gl.uniform1f(uLevels, levels || DITHER_LEVELS);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        return lost ? null : canvas;
      }
    };
  }

  let glDitherer;
  try {
    glDitherer = createGLDitherer();
  } catch (error) {
    glDitherer = null;
  }

  /* ---------- CPU-путь: запасной вариант, если WebGL недоступен ---------- */
  function ditherImageCPU(context, source, gridWidth, gridHeight, bias, levels) {
    const biasValue = bias !== undefined ? bias : LIGHT_POINT_BIAS;
    const levelsValue = Math.max(2, levels || DITHER_LEVELS);
    const output = context.createImageData(gridWidth, gridHeight);
    const pixels = output.data;

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
      for (let gridX = 0; gridX < gridWidth; gridX += 1) {
        const index = (gridY * gridWidth + gridX) * 4;
        const red = source[index];
        const green = source[index + 1];
        const blue = source[index + 2];
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        const threshold = BAYER_8[gridY % 8][gridX % 8] / 64;
        const scaledLum = luminance * (levelsValue - 1);
        const lowerLevel = Math.floor(scaledLum);
        const upperLevel = Math.ceil(scaledLum);
        const frac = scaledLum - lowerLevel;
        const ditheredLevel = (frac + biasValue > threshold) ? upperLevel : lowerLevel;
        const ditheredLum = ditheredLevel / (levelsValue - 1);

        pixels[index] = FG_COLOR[0] + (BG_COLOR[0] - FG_COLOR[0]) * ditheredLum;
        pixels[index + 1] = FG_COLOR[1] + (BG_COLOR[1] - FG_COLOR[1]) * ditheredLum;
        pixels[index + 2] = FG_COLOR[2] + (BG_COLOR[2] - FG_COLOR[2]) * ditheredLum;
        pixels[index + 3] = 255;
      }
    }

    context.putImageData(output, 0, 0);
  }

  /* ---------- лёгкий tween без зависимости от GSAP ----------
     Нужен для hover-реакции карточек: script.js подключён раньше GSAP
     в <head>, порядок специально не меняем. */
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  function tween(duration, ease, onUpdate) {
    const start = performance.now();
    let cancelled = false;
    function frame(now) {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      onUpdate(ease(t));
      if (t < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
    return () => { cancelled = true; };
  }

  /* Сетка выводится из размера блока на экране, а не из разрешения файла.
     Картинка выводится с object-fit: cover, поэтому сначала считаем,
     какого размера она реально отрисуется, и уже это делим на размер блока */
  function getGridSize(image, container, blockPx) {
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const rect = container.getBoundingClientRect();

    let gridWidth;
    if (rect.width > 0 && rect.height > 0) {
      const cover = Math.max(rect.width / naturalWidth, rect.height / naturalHeight);
      gridWidth = Math.round(naturalWidth * cover * DPR / blockPx);
    } else {
      gridWidth = Math.round(naturalWidth / blockPx);
    }

    /* не мельчим сверх детализации исходника и не уходим в вырожденный размер */
    gridWidth = Math.max(16, Math.min(gridWidth, naturalWidth));
    const gridHeight = Math.max(16, Math.round(gridWidth * naturalHeight / naturalWidth));
    return { gridWidth, gridHeight };
  }

  function ditherImage(image, container, objectPosition, blockPx, biasOverride, levelsOverride) {
    const { gridWidth, gridHeight } = getGridSize(image, container, blockPx);

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = gridWidth;
    sourceCanvas.height = gridHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) return null;
    sourceContext.drawImage(image, 0, 0, gridWidth, gridHeight);

    const canvas = document.createElement('canvas');
    canvas.className = 'dither-photo__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    canvas.style.objectPosition = objectPosition;
    /* блоки должны остаться с резкими краями, иначе зерно размоется в градиент */
    canvas.style.imageRendering = 'pixelated';

    const context = canvas.getContext('2d');
    if (!context) return null;

    /* текущие параметры живут в замыкании — rerender() дальше меняет
       только их и перерисовывает, не трогая остальной DOM/CSS */
    const state = { bias: biasOverride !== undefined ? biasOverride : LIGHT_POINT_BIAS, zoom: 1, levels: levelsOverride !== undefined ? levelsOverride : DITHER_LEVELS };

    function paint() {
      const glResult = glDitherer && glDitherer.render(sourceCanvas, FG_COLOR, BG_COLOR, state.bias, state.zoom, state.levels);
      if (glResult) {
        context.drawImage(glResult, 0, 0);
        return true;
      }
      return false;
    }

    if (!paint()) {
      glDitherer = null; /* GPU однажды подвела — дальше на этой странице работаем на CPU */
      const source = sourceContext.getImageData(0, 0, gridWidth, gridHeight).data;
      ditherImageCPU(context, source, gridWidth, gridHeight, state.bias, state.levels);
    }

    container.querySelector(':scope > .dither-photo__canvas')?.remove();
    container.append(canvas);
    container.classList.add('is-dithered');

    /* live-параметры (зум, порог) доступны только на GPU-пути: перерисовка
       на CPU за кадр обошлась бы слишком дорого для 60 fps-анимаций */
    return {
      supportsLive: !!glDitherer,
      rerender(bias, zoom) {
        if (!glDitherer) return;
        if (bias !== undefined) state.bias = bias;
        if (zoom !== undefined) state.zoom = zoom;
        paint();
      }
    };
  }

  function runQueue() {
    if (queueIsRunning || queue.length === 0) return;
    queueIsRunning = true;
    const job = queue.shift();

    window.setTimeout(() => {
      job();
      queueIsRunning = false;
      runQueue();
    }, 0);
  }

  function enqueue(job) {
    queue.push(job);
    runQueue();
  }

  function prepare(container, source, getObjectPosition, blockPx, onFirstRender, biasOverride, levelsOverride) {
    let image = null;
    let firstRenderDone = false;

    const render = () => {
      const handle = ditherImage(image, container, getObjectPosition(), blockPx, biasOverride, levelsOverride);
      if (!handle) return;
      container.__ditherHandle = handle;
      if (!firstRenderDone) {
        firstRenderDone = true;
        if (onFirstRender) {
          const canvasEl = container.querySelector(':scope > .dither-photo__canvas');
          onFirstRender(handle, canvasEl);
        }
      }
    };

    const load = () => {
      image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        enqueue(render);
        watchResize();
      };
      image.src = source;
    };

    /* Сетка привязана к размеру блока на экране, поэтому при смене
       брейкпоинта картинку нужно пересобрать */
    let lastWidth = 0;
    const watchResize = () => {
      lastWidth = container.getBoundingClientRect().width;
      let timer = 0;
      window.addEventListener('resize', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const width = container.getBoundingClientRect().width;
          if (!width || Math.abs(width - lastWidth) / lastWidth < 0.15) return;
          lastWidth = width;
          enqueue(render);
        }, 300);
      });
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      }, { rootMargin: '200px 0px' });
      observer.observe(container);
    } else {
      load();
    }
  }

  const HERO_ZOOM_MS = 1330;
  const HERO_ZOOM_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

  const hero = document.querySelector('.hero__media[data-dither-src]');
  if (hero) {
    prepare(
      hero,
      hero.dataset.ditherSrc,
      () => `${getComputedStyle(hero).getPropertyValue('--dither-position-x').trim() || '50%'} 50%`,
      DITHER_BLOCK_PX,
      (handle, canvasEl) => {
        /* «Наезд» камеры — compositor-переход готового канваса, без JS на
           каждом кадре. Первая отрисовка даёт лоадеру сигнал готовности,
           а zoom стартует вместе с его закрытием. */
        if (window.__resolveHeroReady) window.__resolveHeroReady();
        if (!canvasEl) return;

        const play = () => {
          canvasEl.style.willChange = 'transform';
          canvasEl.style.transform = 'scale3d(1.2, 1.2, 1)';
          // форсируем применение стартового состояния до начала перехода
          void canvasEl.offsetWidth;
          canvasEl.style.transition = `transform ${HERO_ZOOM_MS}ms ${HERO_ZOOM_EASE}`;
          window.requestAnimationFrame(() => {
            canvasEl.style.transform = 'scale3d(1, 1, 1)';
          });
          canvasEl.addEventListener('transitionend', () => {
            canvasEl.style.transition = '';
            canvasEl.style.transform = '';
            canvasEl.style.willChange = '';
          }, { once: true });
        };

        if (document.documentElement.classList.contains('is-hero-zoom-started') ||
            document.documentElement.classList.contains('is-loaded')) {
          play();
        } else {
          window.addEventListener('site:hero-zoom', play, { once: true });
        }
      },
      undefined,
      4
    );
  }

  document.querySelectorAll('.image-tone').forEach((container) => {
    const sourceImage = container.querySelector(':scope > img:last-of-type');
    if (!sourceImage || sourceImage.classList.contains('project-card__arrow')) return;
    const requested = Number(container.dataset.ditherBlock);
    const blockPx = Number.isFinite(requested) && requested > 0
      ? requested
      : DITHER_BLOCK_PX;
    const requestedBias = Number(container.dataset.ditherBias);
    const biasOverride = Number.isFinite(requestedBias) ? requestedBias : undefined;
    const requestedLevels = Number(container.dataset.ditherLevels);
    const levelsOverride = Number.isFinite(requestedLevels) && requestedLevels >= 2 ? requestedLevels : undefined;
    prepare(
      container,
      sourceImage.currentSrc || sourceImage.src,
      () => getComputedStyle(sourceImage).objectPosition,
      blockPx,
      undefined,
      biasOverride,
      levelsOverride
    );
  });

  /* ---------- реакция дизера на наведение: только интерактивные фото ----------
     Порог (bias) плавно растёт — паттерн «разрежается», приоткрывая исходное
     фото, вместо резкой подмены прозрачности. Идёт поверх уже существующего
     CSS-перехода (canvas тоже подтухает через opacity) — эффекты складываются. */
  const HOVER_BIAS = 0.34;

  Array.from(document.querySelectorAll('.project-card__media, .video-frame__media'))
    .filter((container) => container.querySelector(':scope > button, :scope > .project-card__arrow'))
    .forEach((container) => {
    let currentBias = LIGHT_POINT_BIAS;
    let cancelTween = null;

    const animateTo = (target) => {
      const handle = container.__ditherHandle;
      if (!handle || !handle.supportsLive) return;
      if (cancelTween) cancelTween();
      const from = currentBias;
      cancelTween = tween(320, easeOutQuart, (t) => {
        currentBias = from + (target - from) * t;
        handle.rerender(currentBias);
      });
    };

    container.addEventListener('pointerenter', () => animateTo(HOVER_BIAS));
    container.addEventListener('pointerleave', () => animateTo(LIGHT_POINT_BIAS));
    container.addEventListener('focusin', () => animateTo(HOVER_BIAS));
    container.addEventListener('focusout', () => animateTo(LIGHT_POINT_BIAS));
    });
})();
