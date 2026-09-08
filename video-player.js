/* Плеер сайта РКС-НР.

   Разметка — единственный источник данных: CMS отдаёт стандартные
   <video>/<source>/<track>, плеер строит панель управления сам. Никаких
   путей к файлам в JavaScript нет, поэтому шаблон Bitrix может подставлять
   что угодно, включая несколько источников и субтитры.

   Инициализация: автоматически при загрузке и повторно после AJAX через
   window.RKSVideoPlayer.init(container). Повторный вызов на уже подключённом
   блоке безопасен. */
(() => {
  'use strict';

  const instances = new WeakMap();
  const VOLUME_KEY = 'rks-video-volume';
  const STEP_SMALL = 5;
  const STEP_LARGE = 10;
  const VOLUME_STEP = 0.05;
  const IDLE_MS = 2800;
  /* Живая перемотка during drag шлёт Range-запрос на каждый шаг. Ограничиваем
     частоту и ждём завершения предыдущего seek — иначе на длинном файле
     браузер копит очередь запросов и картинка отстаёт от ползунка. */
  const SCRUB_THROTTLE_MS = 120;
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const DOUBLE_CLICK_MS = 300;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isCoarse = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
  /* :focus-visible понимают все актуальные браузеры, но matches() на
     неизвестном псевдоклассе бросает — старым движкам отвечаем «нет». */
  const matchesFocusVisible = (element) => {
    try { return element.matches(':focus-visible'); } catch { return false; }
  };

  function formatTime(seconds) {
    const total = Math.floor(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
      : `${minutes}:${secs}`;
  }

  const formatRate = (rate) => `${String(rate).replace('.', ',')}×`;

  /* Safari в приватном режиме бросает на самом доступе к localStorage. */
  function readStored() {
    try {
      const raw = window.localStorage.getItem(VOLUME_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const volume = Number(parsed.volume);
      return Number.isFinite(volume)
        ? { volume: clamp(volume, 0, 1), muted: !!parsed.muted }
        : null;
    } catch { return null; }
  }

  function writeStored(volume, muted) {
    try {
      window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
    } catch { /* приватный режим — просто не запоминаем */ }
  }

  const ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
    replay: '<path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9H4zm11.5.2v5.6a4 4 0 0 0 0-5.6zm0-3v2.1a6 6 0 0 1 0 7.4v2.1a8 8 0 0 0 0-11.6z"/>',
    muted: '<path d="M4 9v6h4l5 4V5L8 9H4zm11.6.6L17 8.2l1.4 1.4 1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4z"/>',
    enterFullscreen: '<path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/>',
    exitFullscreen: '<path d="M10 4h2v6H6V8h4V4zm4 0h2v4h4v2h-6V4zM6 14h6v6h-2v-4H6v-2zm8 0h6v2h-4v4h-2v-6z"/>',
    pip: '<path d="M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h18V5H3zm8 6h8v6h-8v-6z"/>',
    captions: '<path d="M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2.8 4.6a2 2 0 0 0-2 2v.8a2 2 0 0 0 2 2H8.4v-1.7H6.1a.4.4 0 0 1-.4-.4v-.6c0-.2.2-.4.4-.4h2.3V9.6H5.8zm8 0a2 2 0 0 0-2 2v.8a2 2 0 0 0 2 2h2.6v-1.7h-2.3a.4.4 0 0 1-.4-.4v-.6c0-.2.2-.4.4-.4h2.3V9.6h-2.6z"/>'
  };

  const icon = (name, extraClass = '') =>
    `<svg class="video-control__icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

  function buildSlider(modifier, label, withTooltip) {
    const slider = document.createElement('div');
    slider.className = `video-slider video-slider--${modifier}`;
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-label', label);
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', '100');
    slider.setAttribute('aria-valuenow', '0');
    slider.tabIndex = 0;
    slider.innerHTML =
      '<span class="video-slider__track">'
      + '<span class="video-slider__buffer"></span>'
      /* Бегунок лежит внутри заливки и цепляется к её правому краю —
         одна ширина двигает и шкалу, и бегунок. */
      + '<span class="video-slider__fill"><span class="video-slider__thumb"></span></span>'
      + '</span>'
      + (withTooltip ? '<span class="video-slider__tooltip" aria-hidden="true">0:00</span>' : '');
    return slider;
  }

  /* Собственный ползунок вместо <input type="range">: у нативного элемента
     нет единого поведения между движками (Firefox не отдаёт pointerup после
     disabled, Safari перехватывает касания), а нам нужен предсказуемый
     захват указателя и буфер под шкалой. */
  function bindSlider(slider, handlers) {
    const track = slider.querySelector('.video-slider__track');
    let active = false;

    const ratioAt = (event) => {
      const rect = track.getBoundingClientRect();
      if (!rect.width) return 0;
      return clamp((event.clientX - rect.left) / rect.width, 0, 1);
    };

    const stop = (event) => {
      if (!active) return;
      active = false;
      slider.classList.remove('is-scrubbing');
      handlers.onCommit(ratioAt(event));
    };

    slider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || slider.getAttribute('aria-disabled') === 'true') return;
      active = true;
      slider.classList.add('is-scrubbing');
      /* Захват гарантирует, что pointerup придёт даже если палец ушёл за
         пределы шкалы. lostpointercapture ниже — страховка на случай, когда
         браузер отбирает захват сам (жест назад, смена вкладки). */
      try { slider.setPointerCapture(event.pointerId); } catch { /* не поддерживается */ }
      event.preventDefault();
      handlers.onScrub(ratioAt(event));
    });

    slider.addEventListener('pointermove', (event) => {
      if (active) handlers.onScrub(ratioAt(event));
      else handlers.onHover?.(ratioAt(event));
    });

    slider.addEventListener('pointerup', stop);
    slider.addEventListener('pointercancel', stop);
    slider.addEventListener('lostpointercapture', stop);
    slider.addEventListener('pointerleave', () => handlers.onHoverEnd?.());
    slider.addEventListener('keydown', handlers.onKey);
    return { isActive: () => active };
  }

  function setup(frame) {
    if (instances.has(frame)) return instances.get(frame);

    const media = frame.querySelector('.video-frame__media');
    const video = frame.querySelector('video');
    const playButton = frame.querySelector('.play-button');
    if (!media || !video || !playButton) return null;

    const cleanup = [];
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };

    /* Слой управления живёт РЯДОМ с .image-tone, а не внутри него.
       У .image-tone есть isolation: isolate, поэтому всё вложенное
       запирается в его stacking context, а общий WebGL-дизер — это
       position: fixed; z-index: 2 в корне документа. Кнопка play с
       z-index: 3 внутри изолированного слоя оказывалась ПОД дизером и
       была не видна до старта видео. Отдельная сцена с z-index: 3 в
       корневом контексте решает это, не трогая рисунок дизера. */
    const stage = document.createElement('div');
    stage.className = 'video-frame__stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', video.getAttribute('aria-label') || 'Видеоплеер');
    media.after(stage);
    stage.append(video, playButton);

    const controls = document.createElement('div');
    controls.className = 'video-controls';
    controls.innerHTML =
      '<div class="video-controls__scrub"></div>'
      + '<div class="video-controls__bar">'
      + '<button class="video-control video-control--toggle" type="button" aria-label="Воспроизвести видео">'
      + icon('play', 'video-control__icon--play')
      + icon('pause', 'video-control__icon--pause')
      + icon('replay', 'video-control__icon--replay')
      + '</button>'
      + '<div class="video-volume">'
      + '<button class="video-control video-control--mute" type="button" aria-label="Выключить звук" aria-pressed="false">'
      + icon('sound', 'video-control__icon--sound')
      + icon('muted', 'video-control__icon--muted')
      + '</button>'
      + '</div>'
      + '<p class="video-controls__time"><span data-video-current>0:00</span>'
      + '<span aria-hidden="true"> / </span><span data-video-duration>0:00</span></p>'
      + '<span class="video-controls__spacer"></span>'
      + '<div class="video-controls__popup">'
      + '<button class="video-control video-control--rate" type="button" aria-haspopup="true"'
      + ' aria-expanded="false" aria-label="Скорость воспроизведения"><span data-video-rate>1×</span></button>'
      + '<div class="video-menu" role="menu" aria-label="Скорость воспроизведения" hidden></div>'
      + '</div>'
      + '<button class="video-control video-control--captions" type="button" aria-label="Субтитры" aria-pressed="false" hidden>'
      + icon('captions') + '</button>'
      + '<button class="video-control video-control--pip" type="button" aria-label="Мини-плеер" aria-pressed="false" hidden>'
      + icon('pip') + '</button>'
      + '<button class="video-control video-control--fullscreen" type="button" aria-label="На весь экран" aria-pressed="false">'
      + icon('enterFullscreen', 'video-control__icon--enter')
      + icon('exitFullscreen', 'video-control__icon--exit')
      + '</button>'
      + '</div>';
    stage.append(controls);

    const progress = buildSlider('progress', 'Позиция видео', true);
    controls.querySelector('.video-controls__scrub').append(progress);
    const volumeSlider = buildSlider('volume', 'Громкость', false);
    controls.querySelector('.video-volume').append(volumeSlider);

    const toggleButton = controls.querySelector('.video-control--toggle');
    const muteButton = controls.querySelector('.video-control--mute');
    const rateButton = controls.querySelector('.video-control--rate');
    const rateLabel = controls.querySelector('[data-video-rate]');
    const rateMenu = controls.querySelector('.video-menu');
    const captionsButton = controls.querySelector('.video-control--captions');
    const pipButton = controls.querySelector('.video-control--pip');
    const fullscreenButton = controls.querySelector('.video-control--fullscreen');
    const currentLabel = controls.querySelector('[data-video-current]');
    const durationLabel = controls.querySelector('[data-video-duration]');
    const progressFill = progress.querySelector('.video-slider__fill');
    const progressBuffer = progress.querySelector('.video-slider__buffer');
    const progressTooltip = progress.querySelector('.video-slider__tooltip');
    const volumeFill = volumeSlider.querySelector('.video-slider__fill');

    const spinner = document.createElement('div');
    spinner.className = 'video-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    stage.append(spinner);

    const status = document.createElement('div');
    status.className = 'video-status';
    status.setAttribute('role', 'status');
    status.innerHTML = '<span class="video-status__text"></span>'
      + '<button class="video-status__action" type="button" hidden></button>';
    const statusText = status.querySelector('.video-status__text');
    const statusAction = status.querySelector('.video-status__action');
    stage.append(status);

    /* Сцена обязана точно повторять коробку обложки. Базовые стили дают
       обоим слоям один inset, но шаблон страницы может переопределить
       только .video-frame__media (так сделано в news-detail.css). Сверяем
       коробки и, если они разошлись, докладываем сцене точные смещения —
       тогда произвольный шаблон Bitrix ничего не ломает. */
    function alignStage() {
      if (frame.classList.contains('is-fullscreen')) return;
      stage.style.inset = '';
      const frameBox = frame.getBoundingClientRect();
      const mediaBox = media.getBoundingClientRect();
      const stageBox = stage.getBoundingClientRect();
      if (!mediaBox.width || !mediaBox.height) return;
      const drift = Math.max(
        Math.abs(stageBox.left - mediaBox.left), Math.abs(stageBox.top - mediaBox.top),
        Math.abs(stageBox.right - mediaBox.right), Math.abs(stageBox.bottom - mediaBox.bottom)
      );
      if (drift < 0.5) return;
      stage.style.inset = `${mediaBox.top - frameBox.top}px ${frameBox.right - mediaBox.right}px `
        + `${frameBox.bottom - mediaBox.bottom}px ${mediaBox.left - frameBox.left}px`;
    }

    let previewTime = null;   // положение ползунка во время перетаскивания
    let seekTarget = null;    // куда просили перемотать: ждём seeked
    let pendingSeek = null;   // перемотка до готовности метаданных
    let blobUrl = null;       // ролик, скачанный целиком в обход Range
    let lastScrubAt = 0;
    let idleTimer = 0;
    let lastActivationAt = 0;
    let lastVolume = clamp(video.volume || 1, 0.05, 1);
    let seekingBroken = false;
    let started = false;

    const hasDuration = () => Number.isFinite(video.duration) && video.duration > 0;
    const displayTime = () => (previewTime ?? seekTarget ?? video.currentTime) || 0;

    /* kind: 'info' — служебное сообщение о загрузке, гасится сразу, как
       только видео поехало; 'error' — держится, пока пользователь его не
       прочитает, и его не стирает случайный canplay. */
    let statusKind = null;
    let statusTimer = 0;

    let statusHandler = null;

    function say(text, kind = 'info', action = null) {
      window.clearTimeout(statusTimer);
      statusKind = text ? kind : null;
      statusText.textContent = text || '';
      status.classList.toggle('is-visible', !!text);
      status.classList.toggle('is-error', kind === 'error');
      statusAction.hidden = !action;
      statusAction.textContent = action ? action.label : '';
      statusHandler = action ? action.onClick : null;
      /* Сообщение с кнопкой остаётся на экране: его закрывает действие. */
      if (text && !action) statusTimer = window.setTimeout(() => say(''), 6000);
    }

    function clearInfo() {
      if (statusKind !== 'error') say('');
    }

    function setSpinner(visible) {
      spinner.classList.toggle('is-visible', !!visible);
    }

    /* ---------- показ и скрытие панели ---------- */

    function scheduleIdle() {
      window.clearTimeout(idleTimer);
      if (video.paused || video.ended) return;
      if (progressState.isActive() || volumeState.isActive()) return;
      if (!rateMenu.hidden) return;
      /* Панель остаётся только при клавиатурном фокусе. Иначе после клика
         мышью по кнопке паузы фокус оставался на ней и панель не пряталась
         уже никогда. */
      const focused = document.activeElement;
      if (focused && focused !== stage && stage.contains(focused) && matchesFocusVisible(focused)) return;
      idleTimer = window.setTimeout(() => frame.classList.add('is-controls-hidden'), IDLE_MS);
    }

    function reveal() {
      frame.classList.remove('is-controls-hidden');
      scheduleIdle();
    }

    /* ---------- перемотка ---------- */

    function clampToSeekable(target) {
      const limit = hasDuration() ? video.duration : Infinity;
      let value = clamp(target, 0, Number.isFinite(limit) ? limit : target);
      const ranges = video.seekable;
      if (!ranges || !ranges.length) return value;
      let nearest = value;
      let distance = Infinity;
      for (let index = 0; index < ranges.length; index += 1) {
        const candidate = clamp(value, ranges.start(index), ranges.end(index));
        const gap = Math.abs(candidate - value);
        if (gap < distance) { nearest = candidate; distance = gap; }
      }
      return nearest;
    }

    /* Сервер без поддержки HTTP Range отдаёт вырожденный seekable [0, 0]:
       браузер честно говорит «перемотать никуда не могу». Зажимать цель в
       такой диапазон нельзя — получится перемотка в 0, то есть ролик просто
       начнётся сначала. Проверяем это отдельно. */
    function canSeek() {
      const ranges = video.seekable;
      if (!ranges || !ranges.length) return false;
      return ranges.end(ranges.length - 1) - ranges.start(0) > 1;
    }

    function seek(target) {
      if (!hasDuration()) { pendingSeek = target; return; }
      /* Последний кадр не отдаётся: браузер считает его концом и сразу шлёт
         ended. Отступаем на кадр, чтобы перемотка «в конец» показывала кадр,
         а не чёрный экран. */
      const wanted = clamp(Math.min(target, video.duration - 0.05), 0, video.duration);
      if (!canSeek()) {
        /* Диапазоны появляются не сразу — пока идёт загрузка, откладываем
           перемотку вместо приговора. */
        if (video.readyState < 2) { pendingSeek = wanted; return; }
        reportNoSeeking();
        return;
      }
      const safe = clampToSeekable(wanted);
      seekTarget = safe;
      try {
        video.currentTime = safe;
      } catch {
        seekTarget = null;
        say('Перемотка станет доступна после загрузки видео.', 'error');
        return;
      }
      renderProgress();
    }

    /* Чинить это по-настоящему нужно на сервере, поэтому пишем и в консоль:
       разработчик увидит причину, не разбирая плеер. */
    function reportNoSeeking() {
      if (seekingBroken) return;
      seekingBroken = true;
      const src = video.currentSrc || '';
      let sameOrigin = false;
      try { sameOrigin = new URL(src, location.href).origin === location.origin; } catch { /* нет src */ }
      // eslint-disable-next-line no-console
      console.warn(
        '[RKSVideoPlayer] Сервер отдаёт видео без поддержки HTTP Range, поэтому '
        + 'браузер не может перемотать (video.seekable пуст). Отдавайте файл '
        + 'статикой nginx/Apache/CDN с заголовком Accept-Ranges: bytes.', src
      );
      say(
        'Сервер отдаёт видео без поддержки докачки (HTTP Range) — перемотка недоступна.',
        'error',
        sameOrigin && typeof window.fetch === 'function' && !blobUrl
          ? { label: 'Загрузить ролик целиком', onClick: downloadWholeFile }
          : null
      );
      renderProgress();
    }

    /* Запасной путь на случай неисправимого сервера: качаем файл одним
       запросом и играем из памяти — по blob-ссылке перемотка работает
       всегда. Только по явному нажатию: ролик может весить десятки мегабайт. */
    async function downloadWholeFile() {
      const src = video.currentSrc;
      if (!src || blobUrl) return;
      const at = video.currentTime;
      const wasPlaying = !video.paused;
      say('Загрузка ролика… 0%');
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(String(response.status));
        const total = Number(response.headers.get('content-length')) || 0;
        const chunks = [];
        if (response.body && response.body.getReader) {
          const reader = response.body.getReader();
          let received = 0;
          let shown = -1;
          for (;;) {
            const step = await reader.read();
            if (step.done) break;
            chunks.push(step.value);
            received += step.value.length;
            const percent = total ? Math.round((received / total) * 100) : -1;
            if (percent !== shown) { shown = percent; say(`Загрузка ролика… ${percent}%`); }
          }
        } else {
          chunks.push(new Uint8Array(await response.arrayBuffer()));
        }
        blobUrl = URL.createObjectURL(
          new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' })
        );
        video.src = blobUrl;
        video.load();
        await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
        seekingBroken = false;
        video.currentTime = at;
        if (wasPlaying) void video.play();
        say('Ролик загружен целиком — перемотка работает.');
        renderProgress();
      } catch {
        say('Не удалось загрузить ролик целиком. Перемотка останется недоступной.', 'error');
      }
    }

    function flushPendingSeek() {
      if (pendingSeek === null) return;
      const target = pendingSeek;
      pendingSeek = null;
      seek(target);
    }

    function ratioToTime(ratio) {
      return hasDuration() ? ratio * video.duration : 0;
    }

    /* ---------- отрисовка ---------- */

    function bufferedRatio() {
      if (!hasDuration()) return 0;
      const ranges = video.buffered;
      const time = displayTime();
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= time + 0.25 && time <= ranges.end(index) + 0.25) {
          return clamp(ranges.end(index) / video.duration, 0, 1);
        }
      }
      return ranges.length ? clamp(ranges.end(ranges.length - 1) / video.duration, 0, 1) : 0;
    }

    function renderProgress() {
      const time = displayTime();
      const ratio = hasDuration() ? clamp(time / video.duration, 0, 1) : 0;
      progressFill.style.width = `${ratio * 100}%`;
      progressBuffer.style.width = `${bufferedRatio() * 100}%`;
      currentLabel.textContent = formatTime(time);
      durationLabel.textContent = hasDuration() ? formatTime(video.duration) : '0:00';
      progress.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      progress.setAttribute('aria-valuetext', `${formatTime(time)} из ${durationLabel.textContent}`);
      progress.setAttribute('aria-disabled', hasDuration() && !seekingBroken ? 'false' : 'true');
    }

    function renderPlayback() {
      const paused = video.paused || video.ended;
      frame.classList.toggle('is-paused', paused);
      frame.classList.toggle('is-ended', video.ended);
      playButton.hidden = !paused;
      const label = video.ended
        ? 'Воспроизвести заново'
        : paused ? 'Воспроизвести видео' : 'Поставить видео на паузу';
      toggleButton.setAttribute('aria-label', label);
      playButton.setAttribute('aria-label', label);
      reveal();
    }

    function renderVolume() {
      const muted = video.muted || video.volume === 0;
      const level = muted ? 0 : video.volume;
      frame.classList.toggle('is-muted', muted);
      muteButton.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
      muteButton.setAttribute('aria-pressed', String(muted));
      volumeFill.style.width = `${level * 100}%`;
      volumeSlider.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      volumeSlider.setAttribute('aria-valuetext', `Громкость ${Math.round(level * 100)}%`);
      if (video.volume > 0) lastVolume = video.volume;
      writeStored(video.volume, video.muted);
    }

    /* ---------- воспроизведение ---------- */

    function markStarted() {
      if (started) return;
      started = true;
      frame.classList.add('is-playing');
      /* Общий дизер продолжает рисовать обложку поверх страницы, пока ему
         не сказать погаснуть; сцена с видео лежит выше него. */
      window.__rksDitherSetOpacity?.(media, 0);
    }

    async function play() {
      statusKind = null;
      say('');
      markStarted();
      try {
        await video.play();
      } catch (error) {
        if (error && error.name === 'NotAllowedError') {
          /* Политика автовоспроизведения: со звуком нельзя, без звука можно. */
          video.muted = true;
          try { await video.play(); return; } catch { /* ниже общий текст */ }
        }
        if (!error || error.name !== 'AbortError') {
          say('Не удалось воспроизвести видео. Попробуйте ещё раз.', 'error');
        }
        renderPlayback();
      }
    }

    function togglePlayback() {
      if (video.paused || video.ended) {
        if (video.error) video.load();
        void play();
      } else {
        video.pause();
      }
    }

    function toggleMute() {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        if (video.volume === 0) video.volume = lastVolume;
      } else {
        video.muted = true;
      }
    }

    function nudgeVolume(delta) {
      video.muted = false;
      video.volume = clamp(video.volume + delta, 0, 1);
    }

    /* ---------- полный экран ---------- */

    const fullscreenTarget = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const canFullscreen = !!(
      (stage.requestFullscreen && document.fullscreenEnabled)
      || stage.webkitRequestFullscreen
      || video.webkitEnterFullscreen
    );
    fullscreenButton.hidden = !canFullscreen;

    function renderFullscreen() {
      const active = fullscreenTarget() === stage || !!video.webkitDisplayingFullscreen;
      frame.classList.toggle('is-fullscreen', active);
      stage.classList.toggle('is-fullscreen', active);
      if (active) stage.style.inset = '';
      else alignStage();
      fullscreenButton.setAttribute('aria-label', active ? 'Выйти из полноэкранного режима' : 'На весь экран');
      fullscreenButton.setAttribute('aria-pressed', String(active));
      reveal();
    }

    async function toggleFullscreen() {
      try {
        if (fullscreenTarget() === stage) {
          await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else if (stage.requestFullscreen && document.fullscreenEnabled) {
          await stage.requestFullscreen({ navigationUI: 'hide' });
        } else if (stage.webkitRequestFullscreen) {
          stage.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
          /* iPhone не умеет полный экран для произвольного элемента —
             только нативный оверлей самого видео, и лишь когда метаданные
             уже загружены. */
          if (video.readyState === 0) {
            video.load();
            video.addEventListener('loadedmetadata', () => video.webkitEnterFullscreen(), { once: true });
          } else {
            video.webkitEnterFullscreen();
          }
        }
      } catch {
        say('Не удалось открыть полный экран.', 'error');
      }
    }

    /* ---------- мини-плеер ---------- */

    const canPip = !!(document.pictureInPictureEnabled && video.requestPictureInPicture && !video.disablePictureInPicture);
    pipButton.hidden = !canPip;

    async function togglePip() {
      try {
        if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {
        say('Мини-плеер недоступен в этом браузере.', 'error');
      }
    }

    /* ---------- скорость ---------- */

    rateMenu.innerHTML = RATES.map((rate) =>
      `<button class="video-menu__item" type="button" role="menuitemradio" aria-checked="${rate === 1}"`
      + ` data-video-rate-value="${rate}">${rate === 1 ? 'Обычная' : formatRate(rate)}</button>`
    ).join('');

    function renderRate() {
      const rate = video.playbackRate;
      rateLabel.textContent = formatRate(Number(rate.toFixed(2)));
      rateMenu.querySelectorAll('[data-video-rate-value]').forEach((item) => {
        item.setAttribute('aria-checked', String(Number(item.dataset.videoRateValue) === rate));
      });
      rateButton.setAttribute('aria-label', `Скорость воспроизведения: ${formatRate(Number(rate.toFixed(2)))}`);
    }

    function setMenu(open) {
      rateMenu.hidden = !open;
      rateButton.setAttribute('aria-expanded', String(open));
      if (open) {
        (rateMenu.querySelector('[aria-checked="true"]') || rateMenu.firstElementChild)?.focus();
        window.clearTimeout(idleTimer);
      } else {
        scheduleIdle();
      }
    }

    /* ---------- субтитры ---------- */

    const subtitleTracks = () => Array.from(video.textTracks || [])
      .filter((track) => track.kind === 'subtitles' || track.kind === 'captions');

    function renderCaptions() {
      const textTracks = subtitleTracks();
      if (!textTracks.length) { captionsButton.hidden = true; return; }
      captionsButton.hidden = false;
      const active = textTracks.some((track) => track.mode === 'showing');
      captionsButton.setAttribute('aria-pressed', String(active));
      captionsButton.setAttribute('aria-label', active ? 'Скрыть субтитры' : 'Показать субтитры');
      frame.classList.toggle('is-captioned', active);
    }

    function toggleCaptions() {
      const textTracks = subtitleTracks();
      const active = textTracks.some((track) => track.mode === 'showing');
      textTracks.forEach((track, index) => {
        track.mode = !active && index === 0 ? 'showing' : 'disabled';
      });
      renderCaptions();
    }

    /* ---------- события ползунков ---------- */

    const progressState = bindSlider(progress, {
      onScrub(ratio) {
        previewTime = ratioToTime(ratio);
        renderProgress();
        progress.classList.add('is-scrubbing');
        const now = performance.now();
        /* Живой предпросмотр кадра, но без очереди Range-запросов. */
        if (!video.seeking && now - lastScrubAt > SCRUB_THROTTLE_MS) {
          lastScrubAt = now;
          seek(previewTime);
        }
        window.clearTimeout(idleTimer);
      },
      onCommit(ratio) {
        const target = ratioToTime(ratio);
        previewTime = null;
        progress.classList.remove('is-scrubbing');
        seek(target);
        reveal();
      },
      onHover(ratio) {
        if (!progressTooltip || !hasDuration()) return;
        progressTooltip.textContent = formatTime(ratioToTime(ratio));
        progressTooltip.style.left = `${ratio * 100}%`;
        progress.classList.add('is-hovered');
      },
      onHoverEnd() {
        progress.classList.remove('is-hovered');
      },
      onKey(event) {
        if (!hasDuration()) return;
        const time = video.currentTime;
        let target = null;
        switch (event.key) {
          case 'ArrowLeft': case 'Left': target = time - STEP_SMALL; break;
          case 'ArrowRight': case 'Right': target = time + STEP_SMALL; break;
          case 'ArrowDown': case 'Down': target = time - STEP_LARGE; break;
          case 'ArrowUp': case 'Up': target = time + STEP_LARGE; break;
          case 'PageDown': target = time - video.duration * 0.1; break;
          case 'PageUp': target = time + video.duration * 0.1; break;
          case 'Home': target = 0; break;
          case 'End': target = video.duration; break;
          default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        seek(target);
        reveal();
      }
    });

    const volumeState = bindSlider(volumeSlider, {
      onScrub(ratio) {
        video.muted = false;
        video.volume = clamp(ratio, 0, 1);
        window.clearTimeout(idleTimer);
      },
      onCommit(ratio) {
        video.muted = false;
        video.volume = clamp(ratio, 0, 1);
        reveal();
      },
      onKey(event) {
        let delta = 0;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -VOLUME_STEP;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = VOLUME_STEP;
        else if (event.key === 'Home') { video.muted = false; video.volume = 0; }
        else if (event.key === 'End') { video.muted = false; video.volume = 1; }
        else return;
        event.preventDefault();
        event.stopPropagation();
        if (delta) nudgeVolume(delta);
        reveal();
      }
    });

    /* ---------- кнопки ---------- */

    on(statusAction, 'click', () => { statusHandler?.(); });
    on(playButton, 'click', togglePlayback);
    on(toggleButton, 'click', togglePlayback);
    on(muteButton, 'click', toggleMute);
    on(fullscreenButton, 'click', () => { void toggleFullscreen(); });
    on(pipButton, 'click', () => { void togglePip(); });
    on(captionsButton, 'click', toggleCaptions);
    on(rateButton, 'click', () => setMenu(rateMenu.hidden));
    on(rateMenu, 'click', (event) => {
      const item = event.target.closest('[data-video-rate-value]');
      if (!item) return;
      video.playbackRate = Number(item.dataset.videoRateValue);
      setMenu(false);
      rateButton.focus();
    });
    on(rateMenu, 'keydown', (event) => {
      const items = Array.from(rateMenu.querySelectorAll('[data-video-rate-value]'));
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { setMenu(false); rateButton.focus(); }
      else if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
      else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    on(document, 'pointerdown', (event) => {
      if (!rateMenu.hidden && !controls.querySelector('.video-controls__popup').contains(event.target)) setMenu(false);
    });

    /* До первого запуска сам <video> скрыт, а видимая фотография находится
       под прозрачной сценой управления. Поэтому клик по свободной области
       сцены должен запускать ролик так же, как центральная кнопка. */
    on(stage, 'click', (event) => {
      if (event.target !== stage) return;
      togglePlayback();
    });

    /* Клик по видео — пуск/пауза, двойной — полный экран. Второй клик
       отменяет переключение от первого, чтобы состояние не менялось. */
    on(video, 'click', (event) => {
      event.preventDefault();
      const now = performance.now();
      if (!isCoarse() && now - lastActivationAt < DOUBLE_CLICK_MS) {
        lastActivationAt = 0;
        togglePlayback();
        void toggleFullscreen();
        return;
      }
      lastActivationAt = now;
      togglePlayback();
    });

    /* ---------- события медиа ---------- */

    on(video, 'play', () => {
      document.querySelectorAll('[data-video-player] video').forEach((other) => {
        if (other !== video && !other.paused) other.pause();
      });
      markStarted();
      renderPlayback();
    });
    on(video, 'pause', renderPlayback);
    on(video, 'ended', () => { setSpinner(false); renderPlayback(); });
    on(video, 'loadedmetadata', () => { renderProgress(); renderCaptions(); flushPendingSeek(); });
    on(video, 'loadeddata', flushPendingSeek);
    on(video, 'durationchange', renderProgress);
    on(video, 'progress', renderProgress);
    on(video, 'timeupdate', () => {
      /* Страховка: если по какой-то причине не пришёл seeked, цель перемотки
         не должна навсегда подменить показываемое время. */
      if (seekTarget !== null && !video.seeking) seekTarget = null;
      if (!progressState.isActive()) renderProgress();
    });
    on(video, 'ratechange', renderRate);
    on(video, 'volumechange', renderVolume);
    on(video, 'waiting', () => setSpinner(true));
    on(video, 'stalled', () => setSpinner(true));
    on(video, 'seeking', () => setSpinner(true));
    on(video, 'playing', () => { setSpinner(false); clearInfo(); });
    on(video, 'canplay', () => { setSpinner(false); clearInfo(); flushPendingSeek(); });

    on(video, 'seeked', () => {
      setSpinner(false);
      /* Вторая линия обороны: seekable выглядел рабочим, но браузер всё равно
         не попал в запрошенную точку — значит источник перемотку не держит. */
      if (seekTarget !== null && Math.abs(video.currentTime - seekTarget) > 1.5) reportNoSeeking();
      seekTarget = null;
      renderProgress();
    });

    on(video, 'error', () => {
      seekTarget = null;
      setSpinner(false);
      say('Не удалось загрузить видео. Проверьте соединение и нажмите «Воспроизвести».', 'error');
      renderPlayback();
    });
    on(video, 'emptied', () => { seekTarget = null; previewTime = null; });
    on(video, 'enterpictureinpicture', () => pipButton.setAttribute('aria-pressed', 'true'));
    on(video, 'leavepictureinpicture', () => pipButton.setAttribute('aria-pressed', 'false'));

    ['fullscreenchange', 'webkitfullscreenchange'].forEach((type) => on(document, type, renderFullscreen));
    ['webkitbeginfullscreen', 'webkitendfullscreen'].forEach((type) => on(video, type, renderFullscreen));

    ['pointermove', 'pointerdown', 'focusin'].forEach((type) => on(stage, type, reveal));
    on(stage, 'pointerleave', () => { if (!video.paused) scheduleIdle(); });
    on(stage, 'focusout', () => window.setTimeout(scheduleIdle, 0));

    /* ---------- горячие клавиши ---------- */

    on(stage, 'keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const inWidget = target !== stage && target.closest('.video-slider, button, [role="menuitem"], [role="menuitemradio"]');
      const key = event.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;

      /* Пробел и Enter принадлежат кнопке под фокусом. */
      if (inWidget && (key === ' ' || key === 'Enter' || key === 'Spacebar')) return;
      /* Стрелки и Home/End обрабатывает сам ползунок. */
      if (target.closest('.video-slider') && /^(Arrow|Page|Home|End)/.test(key)) return;

      if (key === ' ' || key === 'Spacebar' || lower === 'k') togglePlayback();
      else if (key === 'ArrowLeft' || key === 'Left') seek(video.currentTime - STEP_SMALL);
      else if (key === 'ArrowRight' || key === 'Right') seek(video.currentTime + STEP_SMALL);
      else if (lower === 'j') seek(video.currentTime - STEP_LARGE);
      else if (lower === 'l') seek(video.currentTime + STEP_LARGE);
      else if (key === 'ArrowUp' || key === 'Up') nudgeVolume(VOLUME_STEP);
      else if (key === 'ArrowDown' || key === 'Down') nudgeVolume(-VOLUME_STEP);
      else if (key === 'Home') seek(0);
      else if (key === 'End' && hasDuration()) seek(video.duration);
      else if (lower === 'm') toggleMute();
      else if (lower === 'f') void toggleFullscreen();
      else if (lower === 'c' && subtitleTracks().length) toggleCaptions();
      else if (lower === 'p' && canPip) void togglePip();
      else if (/^[0-9]$/.test(key) && hasDuration()) seek(video.duration * Number(key) / 10);
      else if (key === 'Escape' && !rateMenu.hidden) setMenu(false);
      else return;
      event.preventDefault();
      reveal();
    });

    /* ---------- первичное состояние ---------- */

    const stored = readStored();
    if (stored) {
      video.volume = stored.volume;
      video.muted = stored.muted;
      if (stored.volume > 0) lastVolume = stored.volume;
    }

    /* Нативные контролы остаются в разметке как запасной вариант: если
       скрипт не выполнится, видео всё равно управляемо. */
    video.controls = false;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    frame.classList.add('is-enhanced', 'is-paused');

    if (video.textTracks) {
      ['addtrack', 'removetrack', 'change'].forEach((type) =>
        on(video.textTracks, type, () => window.setTimeout(renderCaptions, 0)));
    }

    /* Отложенная загрузка ролика.

       С preload="none" браузер не трогает файл вообще: ни одного запроса за
       первый экран. Но тогда и duration неизвестна — полоса прогресса стоит
       на 0:00 и помечена aria-disabled. Поэтому за один экран до секции
       поднимаем preload до "metadata": к моменту, когда пользователь
       доскроллит, длительность и первый кадр уже на месте, а стартовая
       загрузка страницы осталась чистой.

       Разметка главнее: если шаблон явно задал preload="metadata"/"auto",
       ничего не делаем — это осознанное решение автора страницы. */
    if (video.preload === 'none' && typeof IntersectionObserver === 'function') {
      const preloadObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        preloadObserver.disconnect();
        /* Ролик уже запущен или что-то успел загрузить — load() сбросил бы
           прогресс. Проверять currentSrc здесь нельзя: браузер выбирает
           источник и заполняет его даже при preload="none", ничего не
           скачивая, — такое условие не срабатывало никогда. */
        if (started || video.readyState > 0) return;
        video.preload = 'metadata';
        video.load();
      }, { rootMargin: '100% 0px' });
      preloadObserver.observe(frame);
      cleanup.push(() => preloadObserver.disconnect());
    }

    alignStage();
    if (typeof ResizeObserver === 'function') {
      /* Наблюдаем только за обложкой: сцену меняем мы сами, поэтому
         обратной связи и зацикливания не будет. */
      const observer = new ResizeObserver(alignStage);
      observer.observe(media);
      cleanup.push(() => observer.disconnect());
    } else {
      on(window, 'resize', alignStage);
    }

    renderPlayback();
    renderProgress();
    renderVolume();
    renderRate();
    renderCaptions();
    renderFullscreen();

    const api = {
      video,
      play,
      pause: () => video.pause(),
      seek,
      destroy() {
        cleanup.forEach((off) => off());
        window.clearTimeout(idleTimer);
        window.clearTimeout(statusTimer);
        stage.style.inset = '';
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; video.removeAttribute('src'); video.load(); }
        media.after(video);
        frame.append(playButton);
        stage.remove();
        frame.classList.remove('is-enhanced', 'is-playing', 'is-paused', 'is-controls-hidden');
        video.controls = true;
        instances.delete(frame);
      }
    };
    instances.set(frame, api);
    return api;
  }

  function init(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list = [];
    if (scope.matches?.('[data-video-player]')) list.push(scope);
    scope.querySelectorAll('[data-video-player]').forEach((frame) => list.push(frame));
    return list.map(setup).filter(Boolean);
  }

  window.RKSVideoPlayer = Object.freeze({
    init,
    get: (frame) => instances.get(frame) || null
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})();
