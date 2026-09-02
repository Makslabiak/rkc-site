/* Один WebGL-canvas для всех фотографий страницы услуг.
   DOM-картинки остаются fallback: они скрываются только после загрузки GPU-текстуры. */
(function initServicesDither() {
  const page = document.body;
  if (!page) return;
  const ditherConfig = window.SITE_DITHER_CONFIG || {
    dpr: 1.5,
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
    '  vec2 clipPosition = rotatedPosition / max(uBoundsSize * 0.5, vec2(0.5));',
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
    'uniform vec2 uPointerPrevious;',
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
    '  float trailDistance = distanceToSegment(gl_FragCoord.xy, uPointerPrevious, uPointer);',
    '  float trail = (1.0 - smoothstep(24.0 * uPixelRatio, 115.0 * uPixelRatio, trailDistance)) * uPointerEnergy;',
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
    rotation: gl.getUniformLocation(program, 'uRotation'),
    texture: gl.getUniformLocation(program, 'uTexture'),
    textureSize: gl.getUniformLocation(program, 'uTextureSize'),
    planeSize: gl.getUniformLocation(program, 'uPlaneSize'),
    objectPosition: gl.getUniformLocation(program, 'uObjectPosition'),
    pointer: gl.getUniformLocation(program, 'uPointer'),
    pointerPrevious: gl.getUniformLocation(program, 'uPointerPrevious'),
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

  const items = mediaElements.map((element) => ({
    element,
    image: element.querySelector(':scope > img:last-of-type'),
    texture: null,
    width: 1,
    height: 1,
    visible: true,
    ditherAmount: 1,
    ditherTarget: 1,
    objectPosition: [0.5, 0.5]
  })).filter((item) => item.image);

  if (!items.length) return;
  /* Общий слой видит и hero выше main, и контент ниже него. */
  document.body.prepend(canvas);

  let pixelRatio = 1;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pointerX = -10000;
  let pointerY = -10000;
  let previousPointerX = pointerX;
  let previousPointerY = pointerY;
  let pointerEnergy = 0;
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

  /* Общий canvas не наследует transform DOM-элементов. Считываем матрицу
     анимируемой карточки и передаём её поворот в vertex shader, чтобы фото
     двигалось и вращалось строго вместе с карточкой. */
  function getElementGeometry(element, rect) {
    const animatedCard = element.closest('.service-card');
    if (!animatedCard) {
      return { width: rect.width, height: rect.height, rotation: 0 };
    }

    const transform = getComputedStyle(animatedCard).transform;
    if (!transform || transform === 'none') {
      return {
        width: element.offsetWidth || rect.width,
        height: element.offsetHeight || rect.height,
        rotation: 0
      };
    }

    try {
      const matrix = new DOMMatrixReadOnly(transform);
      const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
      const scaleY = Math.hypot(matrix.c, matrix.d) || 1;
      return {
        width: (element.offsetWidth || rect.width) * scaleX,
        height: (element.offsetHeight || rect.height) * scaleY,
        /* CSS вращается в системе координат с осью Y вниз, WebGL — вверх. */
        rotation: -Math.atan2(matrix.b, matrix.a)
      };
    } catch (error) {
      return { width: rect.width, height: rect.height, rotation: 0 };
    }
  }

  function resizeCanvas() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, ditherConfig.dpr);
    const canvasRect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(canvasRect.width * pixelRatio));
    const nextHeight = Math.max(1, Math.round(canvasRect.height * pixelRatio));
    if (nextWidth === canvasWidth && nextHeight === canvasHeight) return;
    canvasWidth = canvas.width = nextWidth;
    canvasHeight = canvas.height = nextHeight;
  }

  function syncObjectPositions() {
    items.forEach((item) => {
      item.objectPosition = parseObjectPosition(getComputedStyle(item.image).objectPosition);
    });
  }

  function upload(item) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.image);
    item.texture = texture;
    item.width = item.image.naturalWidth || 1;
    item.height = item.image.naturalHeight || 1;
    item.element.classList.add('is-shared-dither-ready');
    if (item.element.matches('.hero__media[data-dither-src]')) {
      window.__resolveHeroReady?.();
    }
  }

  items.forEach((item) => {
    if (item.image.complete && item.image.naturalWidth) {
      upload(item);
    } else {
      item.image.addEventListener('load', () => upload(item), { once: true });
    }
    const hasHoverAction = item.element.querySelector(':scope > button, :scope > .project-card__arrow');
    if (hasHoverAction) {
      item.element.addEventListener('pointerenter', () => { item.ditherTarget = 0; });
      item.element.addEventListener('pointerleave', () => { item.ditherTarget = 1; });
    }
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const item = items.find((candidate) => candidate.element === entry.target);
        if (item) item.visible = entry.isIntersecting;
      });
    }, { rootMargin: '100px 0px' });
    items.forEach((item) => observer.observe(item.element));
  }

  window.addEventListener('pointermove', (event) => {
    const canvasRect = canvas.getBoundingClientRect();
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
    gl.uniform2f(locations.pointerPrevious, previousPointerX, previousPointerY);
    gl.uniform1f(locations.pointerEnergy, pointerEnergy);

    const canvasRect = canvas.getBoundingClientRect();

    items.forEach((item) => {
      if (!item.texture || !item.visible) return;
      const rect = item.element.getBoundingClientRect();
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
      const geometry = getElementGeometry(item.element, rect);

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
      gl.uniform2f(locations.elementSize, geometry.width, geometry.height);
      gl.uniform2f(locations.boundsSize, rect.width, rect.height);
      gl.uniform1f(locations.rotation, geometry.rotation);
      gl.uniform2f(locations.planeSize, geometry.width, geometry.height);
      gl.uniform2f(locations.objectPosition, positionX, positionY);
      gl.uniform1f(locations.ditherAmount, item.ditherAmount);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    pointerEnergy *= 0.925;
    previousPointerX += (pointerX - previousPointerX) * 0.3;
    previousPointerY += (pointerY - previousPointerY) * 0.3;
    if (!gsapTicker) rafId = window.requestAnimationFrame(render);
  }

  function startLoop() {
    if (gsapTicker) {
      if (!tickerAttached) {
        gsapTicker.add(render);
        tickerAttached = true;
      }
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

  function setVisibility() {
    running = !document.hidden && !reduceMotion.matches;
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
  window.addEventListener('resize', () => {
    resizeCanvas();
    syncObjectPositions();
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();
  syncObjectPositions();
  startLoop();
})();
