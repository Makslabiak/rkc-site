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

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) return;

  /* Длина хвоста указателя. Больше точек — плавнее дуга на резких
     движениях, но и больше сегментов считает шейдер на каждый пиксель. */
  const TRAIL_POINTS = 8;
  /* Насколько быстро каждая точка догоняет предыдущую: меньше — длиннее и
     ленивее хвост. Голова идёт за курсором отдельным, более резким шагом. */
  const TRAIL_HEAD_LERP = 0.45;
  const TRAIL_FOLLOW_LERP = 0.28;

  const canvas = document.createElement('canvas');
  canvas.className = 'site-dither-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
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
    '  gl_FragColor = vec4(color, 1.0);',
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

  const items = mediaElements.map((element) => ({
    element,
    image: element.querySelector(':scope > img:last-of-type'),
    motionRoot: element.closest('.service-card, .project-card'),
    sticky: hasStickyAncestor(element),
    texture: null,
    width: 1,
    height: 1,
    visible: true,
    bounds: null,
    motionOrigin: null,
    parallax: Number.parseFloat(element.dataset.ditherParallax || '0') || 0,
    ditherAmount: 1,
    ditherTarget: 1,
    objectPosition: [0.5, 0.5]
  })).filter((item) => item.image);

  if (!items.length) return;
  /* Общий слой видит и hero выше main, и контент ниже него. */
  document.body.prepend(canvas);

  let pixelRatio = Math.min(window.devicePixelRatio || 1, ditherConfig.dpr);
  let canvasWidth = 0;
  let canvasHeight = 0;
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
    return window.lenis && typeof window.lenis.animatedScroll === 'number'
      ? window.lenis.animatedScroll
      : window.scrollY;
  }

  /* DOM измеряется только при инициализации/resize. Если карточка в этот
     момент уже трансформирована GSAP, восстанавливаем её базовые координаты
     обратным поворотом вокруг центра. На scroll-кадрах layout не читается. */
  function measureItem(item) {
    /* Пересматриваем на resize: sticky включается только на десктопе. */
    item.sticky = hasStickyAncestor(item.element);
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
    const bounds = item.bounds;
    if (!bounds) return null;

    if (item.sticky) {
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
    const hasHoverAction = item.element.matches('.projects-page-card__media, .news-detail-page .image-tone')
      || item.element.querySelector(':scope > button, :scope > .project-card__arrow');
    if (hasHoverAction) {
      item.element.addEventListener('pointerenter', () => { item.ditherTarget = 0; });
      item.element.addEventListener('pointerleave', () => { item.ditherTarget = 1; });
    }
  });

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

    const scrollX = window.scrollX;
    const scrollY = getScrollY();

    items.forEach((item) => {
      if (!item.texture || !item.visible) return;
      const renderGeometry = getRenderGeometry(item, scrollX, scrollY);
      if (!renderGeometry) return;
      const rect = renderGeometry.rect;
      if (
        rect.bottom <= canvasRect.top ||
        rect.top >= canvasRect.bottom ||
        rect.right <= canvasRect.left ||
        rect.left >= canvasRect.right ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return;

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
      const viewportCenter = canvasRect.height * 0.5;
      const elementCenter = rect.top + rect.height * 0.5;
      const travel = Math.max(1, canvasRect.height * 0.5 + rect.height * 0.5);
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
    running = !document.hidden && !reduceMotion.matches && hasVisibleTexture;
    if (running) startLoop();
    else stopLoop();
    canvas.hidden = !running;
    items.forEach((item) => item.element.classList.toggle('is-shared-dither-ready', running && !!item.texture));
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    running = false;
    stopLoop();
    canvas.hidden = true;
    items.forEach((item) => item.element.classList.remove('is-shared-dither-ready'));
  });

  document.addEventListener('visibilitychange', setVisibility);
  reduceMotion.addEventListener?.('change', setVisibility);
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
