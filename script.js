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
      window.setTimeout(revealPage, EXIT_MS);
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
    wheelMultiplier: 1,
    touchMultiplier: 2,
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

const menuButton = document.querySelector('.menu-button');
const menuButtonLabels = menuButton?.querySelectorAll('.button__text');
const menuPanel = document.querySelector('.menu-panel');
const menuLinks = document.querySelectorAll('.menu-panel a');

function setMenu(open) {
  menuPanel.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  if (menuButtonLabels?.length) {
    menuButtonLabels.forEach((label) => {
      label.textContent = open ? 'Закрыть' : 'Меню';
    });
  } else {
    menuButton.textContent = open ? 'Закрыть' : 'Меню';
  }
  document.body.classList.toggle('menu-open', open);
}

menuButton?.addEventListener('click', () => setMenu(menuPanel.hidden));
menuLinks.forEach((link) => link.addEventListener('click', () => setMenu(false)));

function syncDesktopMenu(scrollTop) {
  const isDesktop = window.matchMedia('(min-width: 1200px)').matches;
  const currentScroll = typeof scrollTop === 'number' ? scrollTop : window.scrollY;
  const isVisible = !isDesktop || currentScroll > 24;
  document.body.classList.toggle('is-scrolled', isDesktop && isVisible);
  if (menuButton) {
    menuButton.tabIndex = isVisible ? 0 : -1;
    menuButton.setAttribute('aria-hidden', String(!isVisible));
  }
}

window.addEventListener('scroll', syncDesktopMenu, { passive: true });
window.addEventListener('resize', syncDesktopMenu);
window.lenis?.on('scroll', ({ animatedScroll }) => syncDesktopMenu(animatedScroll));
syncDesktopMenu();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menuPanel.hidden) {
    setMenu(false);
    menuButton.focus();
  }
});

document.querySelector('.play-button')?.addEventListener('click', (event) => {
  event.currentTarget.classList.toggle('is-active');
});

(function initVideoTicker() {
  document.querySelectorAll('.video-frame__ticker').forEach((ticker) => {
    const text = ticker.textContent.trim();
    if (!text) return;
    const loopText = `${text}　${text}`;

    const track = document.createElement('span');
    track.className = 'video-frame__ticker-track';

    for (let index = 0; index < 2; index += 1) {
      const item = document.createElement('span');
      item.className = 'video-frame__ticker-item';
      item.textContent = loopText;
      if (index > 0) item.setAttribute('aria-hidden', 'true');
      track.append(item);
    }

    ticker.replaceChildren(track);
  });
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

  /* Размер одного блока дизера в физических пикселях экрана.
     Больше значение — крупнее зерно. Это единственные ручки для настройки;
     от разрешения исходника картинки результат больше не зависит.
     Переопределяется на блоке атрибутом data-dither-block="3" */
  const DITHER_BLOCK_PX = 3;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const LIGHT_POINT_BIAS = 0.08;
  const FG_COLOR = [8, 37, 84];
  const BG_COLOR = [215, 240, 255];
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
      'void main() {',
      '  vec2 zoomedUv = (vUv - 0.5) / uZoom + 0.5;',
      '  vec3 rgb = texture2D(uImage, zoomedUv).rgb;',
      '  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));',
      '  vec2 cellIndex = mod(floor(vUv * uGridSize), 8.0);',
      '  vec2 cellUv = (cellIndex + 0.5) / 8.0;',
      '  float threshold = min(texture2D(uBayer, cellUv).r + uBias, 1.0);',
      '  float ink = step(threshold, 1.0 - luma);',
      '  gl_FragColor = vec4(mix(uPaper, uInk, ink), 1.0);',
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

    /* матрица Байера как 8×8 lookup-текстура: значение ячейки = (matrix+0.5)/64,
       ровно та же формула порога, что и в CPU-версии */
    const matrixBytes = new Uint8Array(64);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        matrixBytes[y * 8 + x] = Math.round(((BAYER_8[y][x] + 0.5) / 64) * 255);
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
      render(sourceCanvas, fg, bg, bias, zoom) {
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
  function ditherImageCPU(context, source, gridWidth, gridHeight) {
    const matrixData = getMatrix(MATRIX_SIZE);
    const matrix = matrixData.matrix;
    const matrixSize = matrix.length;
    const output = context.createImageData(gridWidth, gridHeight);
    const pixels = output.data;

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
      for (let gridX = 0; gridX < gridWidth; gridX += 1) {
        const index = (gridY * gridWidth + gridX) * 4;
        const red = source[index];
        const green = source[index + 1];
        const blue = source[index + 2];
        const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
        const threshold = Math.min(1, (
          matrix[gridY % matrixSize][gridX % matrixSize] + 0.5
        ) / matrixData.count + LIGHT_POINT_BIAS);
        const color = (1 - luminance) > threshold ? FG_COLOR : BG_COLOR;

        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
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

  function ditherImage(image, container, objectPosition, blockPx) {
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
    const state = { bias: LIGHT_POINT_BIAS, zoom: 1 };

    function paint() {
      const glResult = glDitherer && glDitherer.render(sourceCanvas, FG_COLOR, BG_COLOR, state.bias, state.zoom);
      if (glResult) {
        context.drawImage(glResult, 0, 0);
        return true;
      }
      return false;
    }

    if (!paint()) {
      glDitherer = null; /* GPU однажды подвела — дальше на этой странице работаем на CPU */
      const source = sourceContext.getImageData(0, 0, gridWidth, gridHeight).data;
      ditherImageCPU(context, source, gridWidth, gridHeight);
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

  function prepare(container, source, getObjectPosition, blockPx, onFirstRender) {
    let image = null;
    let firstRenderDone = false;

    const render = () => {
      const handle = ditherImage(image, container, getObjectPosition(), blockPx);
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
      }, { rootMargin: '800px 0px' });
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
      }
    );
  }

  document.querySelectorAll('.image-tone').forEach((container) => {
    const sourceImage = container.querySelector(':scope > img:first-child');
    if (!sourceImage || sourceImage.classList.contains('project-card__arrow')) return;
    const requested = Number(container.dataset.ditherBlock);
    const blockPx = Number.isFinite(requested) && requested > 0
      ? requested
      : DITHER_BLOCK_PX;
    prepare(
      container,
      sourceImage.currentSrc || sourceImage.src,
      () => getComputedStyle(sourceImage).objectPosition,
      blockPx
    );
  });

  /* ---------- реакция дизера на наведение: карточки проектов и услуг ----------
     Порог (bias) плавно растёт — паттерн «разрежается», приоткрывая исходное
     фото, вместо резкой подмены прозрачности. Идёт поверх уже существующего
     CSS-перехода (canvas тоже подтухает через opacity) — эффекты складываются. */
  const HOVER_BIAS = 0.34;

  document.querySelectorAll('.project-card__media, .service-card__media').forEach((container) => {
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
