/* Один WebGL-canvas для всех фотографий страницы услуг.
   DOM-картинки остаются fallback: они скрываются только после загрузки GPU-текстуры. */
(function initServicesDither() {
  if (window.SITE_DITHER_ENGINE !== 'shared-webgl') return;

  const page = document.body;
  if (!page) return;
  const ditherConfig = window.SITE_DITHER_CONFIG || {
    dpr: 1.5,
    textureMaxEdge: 2048,
    textureOversample: 1.25,
    bias: 0.16,
    exposure: 0.8,
    saturation: 1.12,
    dark: [8, 37, 84],
    light: [215, 240, 255]
  };

  const mediaElements = Array.from(document.querySelectorAll(
    '.image-tone, .hero__media[data-dither-src]'
  ));
  if (!mediaElements.length) return;

  if (window.rksReduceMotion()) return;

  /* Длина хвоста указателя. Больше точек — плавнее дуга на резких
     движениях, но и больше сегментов считает шейдер на каждый пиксель. */
  const TRAIL_POINTS = 8;
  /* Насколько быстро каждая точка догоняет предыдущую: меньше — длиннее и
     ленивее хвост. Голова идёт за курсором отдельным, более резким шагом. */
  const TRAIL_HEAD_LERP = 0.315;
  const TRAIL_FOLLOW_LERP = 0.196;

  const canvas = document.createElement('canvas');
  canvas.className = 'site-dither-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    /* На MacBook владельца две видеокарты, и high-performance держит
       включённой дискретную. В замерах атрибут не дал ни выигрыша, ни
       проигрыша — оставлен как был. */
    powerPreference: 'high-performance'
  });
  if (!gl) return;

  const vertexSource = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'uniform vec2 uElementSize;',
    'uniform vec2 uBoundsSize;',
    'uniform vec2 uPlaneOffset;',
    'uniform float uRotation;',
    'void main() {',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vec2 localPosition = aPosition * uElementSize * 0.5;',
    '  float cosine = cos(uRotation);',
    '  float sine = sin(uRotation);',
    '  vec2 rotatedPosition = vec2(',
    '    localPosition.x * cosine - localPosition.y * sine,',
    '    localPosition.x * sine + localPosition.y * cosine',
    '  );',
    '  vec2 clipPosition = (rotatedPosition + uPlaneOffset) / max(uBoundsSize * 0.5, vec2(0.5));',
    '  gl_Position = vec4(clipPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  const fragmentSource = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform vec2 uTextureSize;',
    'uniform vec2 uPlaneSize;',
    'uniform vec2 uObjectPosition;',
    'uniform vec2 uPointer;',
    `const int TRAIL_POINTS = ${TRAIL_POINTS};`,
    'uniform vec2 uTrail[TRAIL_POINTS];',
    'uniform float uPointerEnergy;',
    'uniform float uPixelRatio;',
    'uniform float uTime;',
    'uniform float uDitherAmount;',
    'uniform float uOpacity;',
    'uniform vec3 uColorDark;',
    'uniform vec3 uColorLight;',
    '',
    'float hash21(vec2 point) {',
    '  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    'float valueNoise(vec2 point) {',
    '  vec2 cell = floor(point);',
    '  vec2 fraction = fract(point);',
    '  fraction = fraction * fraction * (3.0 - 2.0 * fraction);',
    '  float a = hash21(cell);',
    '  float b = hash21(cell + vec2(1.0, 0.0));',
    '  float c = hash21(cell + vec2(0.0, 1.0));',
    '  float d = hash21(cell + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);',
    '}',
    '',
    'float bayer4(vec2 point) {',
    '  float x = mod(floor(point.x), 4.0);',
    '  float y = mod(floor(point.y), 4.0);',
    '  if (y < 1.0) {',
    '    if (x < 1.0) return 0.0 / 16.0;',
    '    if (x < 2.0) return 8.0 / 16.0;',
    '    if (x < 3.0) return 2.0 / 16.0;',
    '    return 10.0 / 16.0;',
    '  }',
    '  if (y < 2.0) {',
    '    if (x < 1.0) return 12.0 / 16.0;',
    '    if (x < 2.0) return 4.0 / 16.0;',
    '    if (x < 3.0) return 14.0 / 16.0;',
    '    return 6.0 / 16.0;',
    '  }',
    '  if (y < 3.0) {',
    '    if (x < 1.0) return 3.0 / 16.0;',
    '    if (x < 2.0) return 11.0 / 16.0;',
    '    if (x < 3.0) return 1.0 / 16.0;',
    '    return 9.0 / 16.0;',
    '  }',
    '  if (x < 1.0) return 15.0 / 16.0;',
    '  if (x < 2.0) return 7.0 / 16.0;',
    '  if (x < 3.0) return 13.0 / 16.0;',
    '  return 5.0 / 16.0;',
    '}',
    '',
    'float distanceToSegment(vec2 point, vec2 start, vec2 end) {',
    '  vec2 segment = end - start;',
    '  float lengthSquared = max(dot(segment, segment), 0.0001);',
    '  float offset = clamp(dot(point - start, segment) / lengthSquared, 0.0, 1.0);',
    '  return length(point - (start + segment * offset));',
    '}',
    '',
    'void main() {',
    '  float textureAspect = uTextureSize.x / uTextureSize.y;',
    '  float planeAspect = uPlaneSize.x / uPlaneSize.y;',
    '  vec2 scale = vec2(1.0);',
    '  vec2 offset = vec2(0.0);',
    '',
    '  if (textureAspect > planeAspect) {',
    '    scale.x = planeAspect / textureAspect;',
    '    offset.x = (1.0 - scale.x) * uObjectPosition.x;',
    '  } else {',
    '    scale.y = textureAspect / planeAspect;',
    '    offset.y = (1.0 - scale.y) * (1.0 - uObjectPosition.y);',
    '  }',
    '',
    '  vec2 textureUv = clamp(vUv * scale + offset, 0.0, 1.0);',
    '  vec3 original = texture2D(uTexture, textureUv).rgb;',
    '  float luminance = dot(original, vec3(0.2126, 0.7152, 0.0722));',
    '',
    /* Хвост складывается из ломаной по точкам uTrail: голова идёт за
       курсором, каждая следующая точка догоняет предыдущую — отсюда инерция.
       Радиус и сила плавно убывают к концу, поэтому след сужается и гаснет.
       max, а не сумма: на стыках сегментов иначе получался бы пересвет. */
    '  float trail = 0.0;',
    /* Ветвление по uniform одинаково для всего draw call, поэтому при
       неподвижной мыши GPU пропускает цикл целиком и хвост ничего не стоит. */
    '  if (uPointerEnergy > 0.002) {',
    '    for (int i = 0; i < TRAIL_POINTS - 1; i++) {',
    '      float t = float(i) / float(TRAIL_POINTS - 1);',
    '      float d = distanceToSegment(gl_FragCoord.xy, uTrail[i], uTrail[i + 1]);',
    '      float inner = mix(26.4, 6.0, t) * uPixelRatio;',
    '      float outer = mix(138.0, 50.4, t) * uPixelRatio;',
    '      float segment = (1.0 - smoothstep(inner, outer, d)) * (1.0 - t * 0.72);',
    '      trail = max(trail, segment);',
    '    }',
    '    trail *= uPointerEnergy;',
    '  }',
    '  float drift = valueNoise(vUv * 3.2 + vec2(uTime * 0.085, -uTime * 0.055)) - 0.5;',
    '  float pulse = sin(uTime * 0.72 + vUv.x * 2.7 + vUv.y * 2.1) * 0.5;',
    '  /* Сдвигаем порог так, чтобы в среднем около 70% точек были тёмно-синими. */',
    `  float animatedBias = ${ditherConfig.bias} + drift * 0.14 + pulse * 0.035 + trail * 0.16;`,
    '  float threshold = bayer4(gl_FragCoord.xy) + animatedBias;',
    '  vec3 dithered = mix(uColorDark, uColorLight, step(threshold, luminance));',
    '  vec3 color = mix(original, dithered, uDitherAmount);',
    '  gl_FragColor = vec4(color, uOpacity);',
    '}'
  ].join('\n');

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Services dither shader:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return;

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Services dither program:', gl.getProgramInfoLog(program));
    return;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const locations = {
    position: gl.getAttribLocation(program, 'aPosition'),
    elementSize: gl.getUniformLocation(program, 'uElementSize'),
    boundsSize: gl.getUniformLocation(program, 'uBoundsSize'),
    planeOffset: gl.getUniformLocation(program, 'uPlaneOffset'),
    rotation: gl.getUniformLocation(program, 'uRotation'),
    texture: gl.getUniformLocation(program, 'uTexture'),
    textureSize: gl.getUniformLocation(program, 'uTextureSize'),
    planeSize: gl.getUniformLocation(program, 'uPlaneSize'),
    objectPosition: gl.getUniformLocation(program, 'uObjectPosition'),
    pointer: gl.getUniformLocation(program, 'uPointer'),
    trail: gl.getUniformLocation(program, 'uTrail'),
    pointerEnergy: gl.getUniformLocation(program, 'uPointerEnergy'),
    pixelRatio: gl.getUniformLocation(program, 'uPixelRatio'),
    time: gl.getUniformLocation(program, 'uTime'),
    ditherAmount: gl.getUniformLocation(program, 'uDitherAmount'),
    opacity: gl.getUniformLocation(program, 'uOpacity'),
    colorDark: gl.getUniformLocation(program, 'uColorDark'),
    colorLight: gl.getUniformLocation(program, 'uColorLight')
  };

  gl.useProgram(program);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(locations.texture, 0);
  gl.uniform3f(locations.colorDark, ditherConfig.dark[0] / 255, ditherConfig.dark[1] / 255, ditherConfig.dark[2] / 255);
  gl.uniform3f(locations.colorLight, ditherConfig.light[0] / 255, ditherConfig.light[1] / 255, ditherConfig.light[2] / 255);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.SCISSOR_TEST);

  /* Sticky-элемент не едет по документу линейно: как только он «прилипает»,
     кэшированная геометрия (bounds − scrollY) расходится с реальным местом,
     и дизер уезжает от своей подложки. Такие элементы меряем живьём каждый
     кадр (их единицы, один getBoundingClientRect роли не играет). */
  function hasStickyAncestor(node) {
    while (node && node !== document.body) {
      if (getComputedStyle(node).position === 'sticky') return true;
      node = node.parentElement;
    }
    return false;
  }

  function needsLiveGeometry(node) {
    return hasStickyAncestor(node) || Boolean(node.closest('[data-news-gallery]'));
  }

  const items = mediaElements.map((element) => {
    const configuredParallax = Number.parseFloat(element.dataset.ditherParallax);
    return {
      element,
      image: element.querySelector(':scope > img:last-of-type'),
      motionRoot: element.closest('.project-card__body, .service-card, .project-card'),
      sticky: needsLiveGeometry(element),
      inProjectsGrid: Boolean(element.closest('[data-projects-grid]')),
      hidden: Boolean(element.closest('[hidden]')),
      texture: null,
      width: 1,
      height: 1,
      visible: true,
      bounds: null,
      motionOrigin: null,
      // Весь контентный фотоконтур получает общий внутренний параллакс.
      // data-dither-parallax="0" оставляет возможность отключить его точечно.
      parallax: Number.isFinite(configuredParallax) ? configuredParallax : 0.08,
      ditherAmount: 1,
      ditherTarget: 1,
      opacity: Number.parseFloat(element.dataset.ditherOpacity ?? '1'),
      objectPosition: [0.5, 0.5]
    };
  }).filter((item) => item.image);

  if (!items.length) return;
  /* Общий слой видит и hero выше main, и контент ниже него. */
  document.body.prepend(canvas);

  let pixelRatio = Math.min(window.devicePixelRatio || 1, ditherConfig.dpr);
  let canvasWidth = 0;
  let canvasHeight = 0;
  let viewportHeight = window.innerHeight;
  let viewportWidth = window.innerWidth;
  let canvasRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  let geometryFrame = 0;
  let pointerX = -10000;
  let pointerY = -10000;
  let previousPointerX = pointerX;
  let previousPointerY = pointerY;
  let pointerEnergy = 0;
  /* Плоский массив [x0,y0,x1,y1,...] — сразу в том виде, в каком его ждёт
     uniform2fv, без пересборки на каждом кадре. */
  const trailPoints = new Float32Array(TRAIL_POINTS * 2);
  for (let i = 0; i < TRAIL_POINTS; i += 1) {
    trailPoints[i * 2] = pointerX;
    trailPoints[i * 2 + 1] = pointerY;
  }
  let running = true;
  let rafId = 0;
  const gsapTicker = window.gsap?.ticker || null;
  let tickerAttached = false;

  /* Частота в покое. Пока по экрану ничего не движется, слой всё равно
     обязан обновляться: узор дышит от uTime. Но каждое обновление — это
     полная пересборка кадра компоновщиком (замеры в README, раздел «Слой
     дизера: во что он обходится»), и в покое шестьдесят таких пересборок в
     секунду не нужны: и drift, и pulse считаются от времени медленно, на
     глаз разницы нет. На любое движение — прокрутку, курсор, проявление,
     параллакс — частота возвращается к полной в тот же кадр.

     Половинная частота ПРИ ПРОКРУТКЕ проверялась дважды и отклонена: в
     первый раз эффект отставал от вёрстки, во второй (со сдвигом слоя
     вместо перерисовки) выигрыша не дал. Подробности в README. */
  const IDLE_FPS = 18;
  const idleFrameGap = 1000 / IDLE_FPS;
  /* null, а не число: подпись бывает отрицательной (фото уехало за левый
     край), и любой числовой сторож мог бы с ней совпасть. */
  let frameSignature = null;
  let lastDrawTime = -Infinity;

  function parseObjectPosition(value) {
    const parts = value.trim().split(/\s+/);
    const keyword = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
    const parsePart = (part, fallback) => {
      if (part in keyword) return keyword[part];
      if (part.endsWith('%')) return Math.min(1, Math.max(0, parseFloat(part) / 100));
      return fallback;
    };
    return [parsePart(parts[0] || '50%', 0.5), parsePart(parts[1] || '50%', 0.5)];
  }

  function getMotion(item) {
    return item.motionRoot?.__rksDitherMotion || { x: 0, y: 0, rotation: 0 };
  }

  function getScrollY() {
    /* Берём положение у браузера, а не у Lenis. Раньше здесь стоял
       lenis.animatedScroll, и на десктопе разницы не было: Lenis сам двигает
       окно на это же значение в том же кадре, до отрисовки слоя.

       А на айфоне палец крутит страницу нативно, Lenis только подтягивается
       следом, и подтягивается медленно: syncTouchLerp у него 0.039, то есть
       меньше четырёх процентов расстояния за кадр. Слой при этом рисовался по
       отставшему значению и уезжал вниз от фотографии — сверху оставалась
       незакрашенная полоса. Замер с устройства владельца: отставание 8-9 px,
       строго по вертикали, при полном совпадении окна и видимой области.

       window.scrollY — это то, где страница уже нарисована, поэтому слой и
       вёрстка совпадают на любом устройстве. */
    return window.scrollY;
  }

  /* DOM измеряется только при инициализации/resize. Если карточка в этот
     момент уже трансформирована GSAP, восстанавливаем её базовые координаты
     обратным поворотом вокруг центра. На scroll-кадрах layout не читается. */
  function measureItem(item) {
    /* Пересматриваем на resize: sticky и горизонтальная галерея меняют
       экранные координаты независимо от основного scrollY. */
    item.sticky = needsLiveGeometry(item.element);
    /* closest() в рендер-цикле — это обход дерева вверх до корня на каждый
       элемент на каждом кадре. Признак галереи меняется только вместе с
       раскладкой, поэтому считается здесь, а не 60 раз в секунду. */
    item.inProjectsGrid = Boolean(item.element.closest('[data-projects-grid]'));
    const rect = item.element.getBoundingClientRect();
    const width = item.element.offsetWidth || rect.width;
    const height = item.element.offsetHeight || rect.height;
    const scrollX = window.scrollX;
    const scrollY = getScrollY();
    let centerX = rect.left + rect.width * 0.5;
    let centerY = rect.top + rect.height * 0.5;

    if (item.motionRoot) {
      const rootRect = item.motionRoot.getBoundingClientRect();
      const motion = getMotion(item);
      const translationX = Number(motion.x) || 0;
      const translationY = Number(motion.y) || 0;
      const angle = (Number(motion.rotation) || 0) * Math.PI / 180;
      const rootCenterX = rootRect.left + rootRect.width * 0.5;
      const rootCenterY = rootRect.top + rootRect.height * 0.5;
      const relativeX = centerX - rootCenterX;
      const relativeY = centerY - rootCenterY;
      const cosine = Math.cos(-angle);
      const sine = Math.sin(-angle);
      const baseRootCenterX = rootCenterX - translationX;
      const baseRootCenterY = rootCenterY - translationY;

      centerX = baseRootCenterX + relativeX * cosine - relativeY * sine;
      centerY = baseRootCenterY + relativeX * sine + relativeY * cosine;
      item.motionOrigin = {
        x: baseRootCenterX + scrollX,
        y: baseRootCenterY + scrollY
      };
    } else {
      item.motionOrigin = null;
    }

    item.bounds = {
      left: centerX + scrollX - width * 0.5,
      top: centerY + scrollY - height * 0.5,
      width,
      height
    };
  }

  function measureAll() {
    items.forEach(measureItem);
  }

  function scheduleGeometryRefresh() {
    if (geometryFrame) return;
    geometryFrame = window.requestAnimationFrame(() => {
      geometryFrame = 0;
      resizeCanvas(true);
      syncObjectPositions();
      measureAll();
    });
  }

  /* Возвращает экранный AABB из сохранённой document-space геометрии и
     числового состояния GSAP. Это только арифметика — без style/layout read. */
  function getRenderGeometry(item, scrollX, scrollY) {
    /* Отфильтрованные карточки сохраняют текстуры, но не должны рисоваться
       по устаревшей геометрии. Скрытость пересчитывается по событию (см.
       hiddenObserver ниже), а не поиском предка на каждом кадре. */
    if (!item.element.isConnected || item.hidden) return null;
    const bounds = item.bounds;
    if (!bounds) return null;

    if (item.sticky || item.inProjectsGrid) {
      const live = item.element.getBoundingClientRect();
      if (!live.width || !live.height) return null;
      return {
        rect: {
          left: live.left,
          top: live.top,
          right: live.right,
          bottom: live.bottom,
          width: live.width,
          height: live.height
        },
        width: live.width,
        height: live.height,
        rotation: 0
      };
    }

    const motion = getMotion(item);
    const translationX = Number(motion.x) || 0;
    const translationY = Number(motion.y) || 0;
    const angle = (Number(motion.rotation) || 0) * Math.PI / 180;

    if (!item.motionOrigin || Math.abs(angle) < 0.00001) {
      return {
        rect: {
          left: bounds.left - scrollX + translationX,
          top: bounds.top - scrollY + translationY,
          right: bounds.left - scrollX + translationX + bounds.width,
          bottom: bounds.top - scrollY + translationY + bounds.height,
          width: bounds.width,
          height: bounds.height
        },
        width: bounds.width,
        height: bounds.height,
        rotation: 0
      };
    }

    const origin = item.motionOrigin;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const corners = [
      [bounds.left, bounds.top],
      [bounds.left + bounds.width, bounds.top],
      [bounds.left, bounds.top + bounds.height],
      [bounds.left + bounds.width, bounds.top + bounds.height]
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    corners.forEach(([x, y]) => {
      const relativeX = x - origin.x;
      const relativeY = y - origin.y;
      const transformedX = origin.x + relativeX * cosine - relativeY * sine + translationX;
      const transformedY = origin.y + relativeX * sine + relativeY * cosine + translationY;
      minX = Math.min(minX, transformedX);
      minY = Math.min(minY, transformedY);
      maxX = Math.max(maxX, transformedX);
      maxY = Math.max(maxY, transformedY);
    });

    return {
      rect: {
        left: minX - scrollX,
        top: minY - scrollY,
        right: maxX - scrollX,
        bottom: maxY - scrollY,
        width: maxX - minX,
        height: maxY - minY
      },
      width: bounds.width,
      height: bounds.height,
      /* CSS использует ось Y вниз, WebGL — вверх. */
      rotation: -angle
    };
  }

  function resizeCanvas(force) {
    pixelRatio = Math.min(window.devicePixelRatio || 1, ditherConfig.dpr);
    /* Центр экрана для внутреннего параллакса и границы отсечения берутся
       от окна, а не от коробки холста: так они не зависят от того, как
       холст в этот момент устроен. */
    viewportHeight = window.innerHeight;
    viewportWidth = window.innerWidth;
    const nextRect = force || !canvasRect.width
      ? canvas.getBoundingClientRect()
      : canvasRect;
    const nextWidth = Math.max(1, Math.round(nextRect.width * pixelRatio));
    const nextHeight = Math.max(1, Math.round(nextRect.height * pixelRatio));
    if (!force && nextWidth === canvasWidth && nextHeight === canvasHeight) return;
    canvasRect = nextRect;
    canvasWidth = canvas.width = nextWidth;
    canvasHeight = canvas.height = nextHeight;
  }

  function syncObjectPositions() {
    items.forEach((item) => {
      item.objectPosition = parseObjectPosition(getComputedStyle(item.image).objectPosition);
    });
  }

  function getTextureSource(item) {
    const naturalWidth = item.image.naturalWidth || 1;
    const naturalHeight = item.image.naturalHeight || 1;
    const elementRect = item.element.getBoundingClientRect();
    const elementWidth = item.element.offsetWidth || elementRect.width || naturalWidth;
    const elementHeight = item.element.offsetHeight || elementRect.height || naturalHeight;
    const coverScale = Math.max(elementWidth / naturalWidth, elementHeight / naturalHeight);
    const oversample = Number(ditherConfig.textureOversample) > 0
      ? Number(ditherConfig.textureOversample)
      : 1.25;
    const maxEdge = Number(ditherConfig.textureMaxEdge) > 0
      ? Number(ditherConfig.textureMaxEdge)
      : 2048;
    /* Полноразмерные 4K-текстуры занимали сотни мегабайт GPU-памяти на
       мобильном Safari. Для дизера достаточно небольшого запаса над реальным
       размером блока: рисунок остаётся тем же, а upload и sampling дешевле. */
    const displayScale = coverScale * pixelRatio * oversample;
    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight), displayScale);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    if (width === naturalWidth && height === naturalHeight) {
      return { source: item.image, width: naturalWidth, height: naturalHeight };
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const context = sourceCanvas.getContext('2d');
    if (!context) return { source: item.image, width: naturalWidth, height: naturalHeight };
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(item.image, 0, 0, width, height);
    return { source: sourceCanvas, width, height };
  }

  function upload(item) {
    const textureSource = getTextureSource(item);
    if (item.texture) gl.deleteTexture(item.texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureSource.source);
    item.texture = texture;
    item.width = textureSource.width;
    item.height = textureSource.height;
    item.element.classList.add('is-shared-dither-ready');
    measureItem(item);
    setVisibility();
    if (item.element.matches('.hero__media[data-dither-src]')) {
      window.__resolveHeroReady?.();
    }
  }

  /* Первый texImage2D распаковывает webp синхронно в главном потоке, а
     исходники здесь по 4096px — это десятки миллисекунд блокировки прямо
     посреди первой прокрутки. image.decode() уводит распаковку в фоновый
     поток и отдаёт уже готовый битмап. В текстуру попадает ровно то же
     изображение: рисунок дизера не меняется. */
  function uploadWhenDecoded(item) {
    const image = item.image;
    const run = () => {
      if (typeof image.decode === 'function') {
        image.decode().then(() => upload(item), () => upload(item));
      } else {
        upload(item);
      }
    };
    if (image.complete && image.naturalWidth) run();
    else image.addEventListener('load', run, { once: true });
  }

  items.forEach((item) => {
    uploadWhenDecoded(item);
    item.image.addEventListener('load', () => {
      if (item.texture) uploadWhenDecoded(item);
    });
    const hasHoverAction = !item.element.matches('.video-frame__media') && (
      item.element.matches('.projects-page-card__media, .news-page-card__image, .news-detail-page .image-tone, .project-detail-page .image-tone, .about-leadership__photo')
      || item.element.querySelector(':scope > button, :scope > .project-card__arrow')
    );
    if (hasHoverAction) {
      const hoverTarget = item.element.closest('.news-page-card') || item.element;
      hoverTarget.addEventListener('pointerenter', () => { item.ditherTarget = 0; });
      hoverTarget.addEventListener('pointerleave', () => { item.ditherTarget = 1; });
    }
  });

  window.__rksDitherSetOpacity = function (element, opacity, duration = 0.8) {
    const item = items.find((candidate) => candidate.element === element);
    if (!item) return false;
    const value = Math.max(0, Math.min(1, Number(opacity)));
    if (window.gsap) {
      window.gsap.to(item, {
        opacity: value,
        duration,
        ease: 'power4.inOut',
        overwrite: true
      });
    } else {
      item.opacity = value;
    }
    return true;
  };

  /* Перекрывающий crossfade для нескольких фотографий в одном контейнере.
     Новый слой проявляется поверх полностью непрозрачного предыдущего, поэтому
     в середине перехода сквозь изображения не проступает фон. */
  window.__rksDitherCrossfade = function (elements, targetElement, duration = 0.8) {
    const group = Array.from(elements || [])
      .map((element) => items.find((candidate) => candidate.element === element))
      .filter(Boolean);
    const target = group.find((item) => item.element === targetElement);
    if (!target || !target.texture) return false;

    const targetIndex = items.indexOf(target);
    if (targetIndex >= 0) {
      items.splice(targetIndex, 1);
      items.push(target);
    }

    const previous = group
      .filter((item) => item !== target)
      .sort((a, b) => b.opacity - a.opacity)[0];

    if (!window.gsap) {
      group.forEach((item) => { item.opacity = item === target ? 1 : 0; });
      return true;
    }

    window.gsap.killTweensOf(group);

    /* Даже при быстром движении курсора под новым кадром всегда остаётся
       непрозрачная база. Незавершённый переход продолжится без белой вспышки. */
    if (previous && previous.opacity < 1) previous.opacity = 1;
    target.opacity = 0;

    window.gsap.to(target, {
      opacity: 1,
      duration,
      ease: 'power2.inOut',
      overwrite: true,
      onComplete: () => {
        group.forEach((item) => {
          if (item !== target) item.opacity = 0;
        });
      }
    });
    return true;
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      let changed = false;
      entries.forEach((entry) => {
        const item = items.find((candidate) => candidate.element === entry.target);
        if (item && item.visible !== entry.isIntersecting) {
          item.visible = entry.isIntersecting;
          changed = true;
        }
      });
      if (changed) {
        setVisibility();
      }
    }, { rootMargin: '100px 0px' });
    items.forEach((item) => observer.observe(item.element));
  }

  window.addEventListener('pointermove', (event) => {
    previousPointerX = pointerX;
    previousPointerY = pointerY;
    pointerX = (event.clientX - canvasRect.left) * pixelRatio;
    pointerY = (canvasRect.bottom - event.clientY) * pixelRatio;
    const velocity = Math.hypot(pointerX - previousPointerX, pointerY - previousPointerY);
    pointerEnergy = Math.min(1, pointerEnergy + velocity / (70 * pixelRatio));
  }, { passive: true });

  function render(timestamp) {
    if (!running) return;
    const now = gsapTicker ? timestamp * 1000 : timestamp;
    resizeCanvas();

    /* Сначала выясняем, попадает ли хоть одно фото в кадр — это чистая
       арифметика по сохранённой геометрии, без единого вызова GL.
       Без этой проверки слой очищался и композитился 60 раз в секунду
       даже там, где фотографий на экране нет: IntersectionObserver держит
       item.visible с запасом в 100 px, поэтому цикл продолжал крутиться
       вхолостую. На секциях без фото это давало полноэкранный clear и
       перекомпозицию каждый кадр — то есть просадку ровно там, где
       рисовать нечего. */
    const кадр = [];
    const scrollXPre = window.scrollX;
    const scrollYPre = getScrollY();
    const cullBottom = viewportHeight;
    const cullRight = viewportWidth;
    items.forEach((item) => {
      if (!item.texture || !item.visible) return;
      /* Полностью прозрачный слой не даёт ни одного пикселя: блендинг идёт
         по SRC_ALPHA, и при alpha = 0 результат равен фону. А платили за
         него полным проходом шейдера по площади фотографии.

         Так лежат блоки статистики и новостей на главной: четыре снимка
         друг на друге, из которых виден один, остальные ждут своей очереди
         в кроссфейде. То есть на этих секциях дизер делал вчетверо больше
         работы, чем нужно. Как только кроссфейд поднимает прозрачность выше
         нуля, слой снова попадает в кадр. */
      if (item.opacity <= 0.001) return;
      const geometry = getRenderGeometry(item, scrollXPre, scrollYPre);
      if (!geometry) return;
      const rect = geometry.rect;
      /* Отсечение считается от ОКНА, а не от холста: в режиме полосы холст
         меньше окна, и отсечение по нему выкинуло бы из кадра те самые
         фотографии, под которые полосу и надо подводить. При холсте во весь
         экран это те же самые границы, что были. */
      if (
        rect.bottom <= 0 ||
        rect.top >= cullBottom ||
        rect.right <= 0 ||
        rect.left >= cullRight ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return;
      кадр.push({ item, geometry });
    });

    if (!кадр.length) {
      /* Один раз гасим слой и больше его не трогаем, пока фото не вернутся.
         Скрытый canvas композитор исключает из сцены целиком. */
      if (!canvas.hidden) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasWidth, canvasHeight);
        gl.scissor(0, 0, canvasWidth, canvasHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        canvas.hidden = true;
        /* Слой очищен, и его содержимое больше не соответствует подписи.
           Иначе вернувшееся в кадр фото с той же геометрией не было бы
           нарисовано ещё до трёх кадров, а на экране висел бы пустой слой. */
        frameSignature = null;
      }
      /* Хвост указателя продолжает затухать, иначе при возврате фото
         в кадр он прыгнет из старого положения. */
      pointerEnergy *= 0.94;
      if (!gsapTicker) rafId = window.requestAnimationFrame(render);
      return;
    }
    if (canvas.hidden) canvas.hidden = false;

    /* Подпись кадра: всё, от чего зависит картинка, кроме самого времени —
       положение и поворот прямоугольников, прозрачность, проявление по
       наведению, число фотографий, размер холста, энергия курсора. Совпала
       с прошлой — на экране покой, и слой можно обновлять реже. Любое
       движение возвращает полную частоту в тот же кадр.

       Это только арифметика по уже посчитанной геометрии, без чтения
       раскладки. */
    {
      let signature = кадр.length * 7919 + Math.round(pointerEnergy * 1000)
        + canvasWidth * 3 + canvasHeight * 5;
      кадр.forEach(({ item, geometry }) => {
        const rect = geometry.rect;
        signature = (signature * 31
          + Math.round(rect.left * 16) + Math.round(rect.top * 16) * 3
          + Math.round(rect.width * 16) * 5 + Math.round(rect.height * 16) * 7
          + Math.round(geometry.rotation * 1000) * 11
          + Math.round(item.opacity * 1000) * 13
          + Math.round(item.ditherAmount * 1000) * 17
          + Math.round(item.ditherTarget * 1000) * 19) % 2147483647;
      });

      if (signature === frameSignature && now - lastDrawTime < idleFrameGap) {
        if (!gsapTicker) rafId = window.requestAnimationFrame(render);
        return;
      }
      frameSignature = signature;
      lastDrawTime = now;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.scissor(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(locations.time, now * 0.001);
    gl.uniform1f(locations.pixelRatio, pixelRatio);
    gl.uniform2f(locations.pointer, pointerX, pointerY);
    gl.uniform2fv(locations.trail, trailPoints);
    gl.uniform1f(locations.pointerEnergy, pointerEnergy);

    кадр.forEach(({ item, geometry: renderGeometry }) => {
      const rect = renderGeometry.rect;

      const left = Math.round((rect.left - canvasRect.left) * pixelRatio);
      const bottom = Math.round((canvasRect.bottom - rect.bottom) * pixelRatio);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      const [positionX, positionY] = item.objectPosition;

      /* Параллакс живёт внутри неподвижной рамки: плоскость делаем чуть
         больше bounds и сдвигаем по вертикали в зависимости от положения
         изображения относительно центра viewport. Благодаря scissor край
         кадра остаётся чистым, а DOM-карточка не участвует в движении. */
      const parallax = Math.max(-0.2, Math.min(0.2, item.parallax));
      const planeScale = 1 + Math.abs(parallax) * 2;
      const planeWidth = renderGeometry.width * planeScale;
      const planeHeight = renderGeometry.height * planeScale;
      const viewportCenter = viewportHeight * 0.5;
      const elementCenter = rect.top + rect.height * 0.5;
      const travel = Math.max(1, viewportHeight * 0.5 + rect.height * 0.5);
      const viewportProgress = Math.max(-1, Math.min(1, (elementCenter - viewportCenter) / travel));
      const planeOffsetY = viewportProgress * parallax * rect.height;

      item.ditherAmount += (item.ditherTarget - item.ditherAmount) * 0.12;
      const scissorLeft = Math.max(0, left);
      const scissorBottom = Math.max(0, bottom);
      const scissorRight = Math.min(canvasWidth, left + width);
      const scissorTop = Math.min(canvasHeight, bottom + height);
      if (scissorRight <= scissorLeft || scissorTop <= scissorBottom) return;

      gl.viewport(left, bottom, width, height);
      gl.scissor(scissorLeft, scissorBottom, scissorRight - scissorLeft, scissorTop - scissorBottom);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.uniform2f(locations.textureSize, item.width, item.height);
      gl.uniform2f(locations.elementSize, planeWidth, planeHeight);
      gl.uniform2f(locations.boundsSize, rect.width, rect.height);
      gl.uniform2f(locations.planeOffset, 0, planeOffsetY);
      gl.uniform1f(locations.rotation, renderGeometry.rotation);
      gl.uniform2f(locations.planeSize, planeWidth, planeHeight);
      gl.uniform2f(locations.objectPosition, positionX, positionY);
      gl.uniform1f(locations.ditherAmount, item.ditherAmount);
      gl.uniform1f(locations.opacity, item.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    /* Затухание чуть мягче прежних 0.925: иначе энергия гасла раньше, чем
       хвост успевал догнать курсор, и инерции не было видно. */
    pointerEnergy *= 0.94;
    previousPointerX += (pointerX - previousPointerX) * 0.3;
    previousPointerY += (pointerY - previousPointerY) * 0.3;

    /* Голова тянется к курсору, каждое следующее звено — к предыдущему.
       Идём с головы, поэтому за один проход волна доходит до конца хвоста. */
    trailPoints[0] += (pointerX - trailPoints[0]) * TRAIL_HEAD_LERP;
    trailPoints[1] += (pointerY - trailPoints[1]) * TRAIL_HEAD_LERP;
    for (let i = 1; i < TRAIL_POINTS; i += 1) {
      const current = i * 2;
      const ahead = (i - 1) * 2;
      trailPoints[current] += (trailPoints[ahead] - trailPoints[current]) * TRAIL_FOLLOW_LERP;
      trailPoints[current + 1] += (trailPoints[ahead + 1] - trailPoints[current + 1]) * TRAIL_FOLLOW_LERP;
    }
    if (!gsapTicker) rafId = window.requestAnimationFrame(render);
  }

  function startLoop() {
    if (gsapTicker) {
      /* ScrollTrigger регистрируется в следующем defer-скрипте. До его
         регистрации canvas не подключаем: иначе он оказывается раньше
         updateRoot в ticker и читает трансформацию карточек на кадр раньше. */
      if (window.__rksScrollTriggerReady) attachTicker();
      return;
    }
    if (!rafId) rafId = window.requestAnimationFrame(render);
  }

  function stopLoop() {
    if (gsapTicker && tickerAttached) {
      gsapTicker.remove(render);
      tickerAttached = false;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function attachTicker() {
    if (!gsapTicker || !running || tickerAttached) return;
    gsapTicker.add(render);
    tickerAttached = true;
  }

  /* animations.js вызывается после этого файла и сигнализирует, когда
     ScrollTrigger уже добавил свой updateRoot. */
  window.__rksDitherAttachTicker = attachTicker;

  function setVisibility() {
    const hasVisibleTexture = items.some((item) => item.visible && !!item.texture);
    running = !document.hidden && !window.rksReduceMotion() && hasVisibleTexture;
    if (running) startLoop();
    else stopLoop();
    canvas.hidden = !running;
    frameSignature = null;
    items.forEach((item) => item.element.classList.toggle('is-shared-dither-ready', running && !!item.texture));
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    running = false;
    stopLoop();
    canvas.hidden = true;
    items.forEach((item) => item.element.classList.remove('is-shared-dither-ready'));
  });

  /* Фильтр проектов переключает [hidden] на карточках — единственный
     сценарий, в котором скрытость меняется без перестройки раскладки.
     MutationObserver отрабатывает в микротаске до отрисовки, поэтому
     кадров со старой геометрией не остаётся, а рендер-цикл читает готовый
     флаг вместо обхода дерева. */
  if ('MutationObserver' in window) {
    const hiddenObserver = new MutationObserver(() => {
      items.forEach((item) => { item.hidden = Boolean(item.element.closest('[hidden]')); });
    });
    hiddenObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  document.addEventListener('visibilitychange', setVisibility);
  window.addEventListener('resize', scheduleGeometryRefresh, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleGeometryRefresh, { passive: true });
  window.addEventListener('load', scheduleGeometryRefresh, { once: true });
  document.fonts?.ready.then(scheduleGeometryRefresh);
  window.__rksDitherRefresh = scheduleGeometryRefresh;
  resizeCanvas(true);
  syncObjectPositions();
  measureAll();
  setVisibility();
})();
