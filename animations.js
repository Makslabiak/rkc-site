/* ==========================================================================
   Анимации появления (GSAP + ScrollTrigger + SplitText + ScrambleText)
   Пресеты: fadeIn / fadeUp / line / lineUp / title / typeChars
   Разметка: data-anim="title" data-anim-delay=".3" и т.д.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  function reveal() {
    root.classList.remove('has-anim');
  }

  if (!window.gsap || !window.ScrollTrigger) {
    reveal();
    return;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  window.__rksScrollTriggerReady = true;
  window.__rksDitherAttachTicker?.();
  if (window.SplitText) gsap.registerPlugin(SplitText);
  if (window.ScrambleTextPlugin) gsap.registerPlugin(ScrambleTextPlugin);

  /* limitCallbacks — не дёргать колбэки на каждом промежуточном кадре скролла;
     ignoreMobileResize — не пересчитывать всё при появлении адресной строки */
  ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });

  /* Синхронизация Lenis и ScrollTrigger — без этого главная причина рывков
     и рассинхрона: Lenis двигает страницу «виртуально» (со сглаживанием)
     своим собственным rAF-циклом, а ScrollTrigger по умолчанию пересчитывает
     позиции триггеров по нативному скроллу, который обновляется на кадр позже.
     На стыке точки срабатывания анимаций смещаются — элементы либо
     проигрываются с опозданием, либо резко «доигрывают» рывком.
     Подписываем ScrollTrigger на каждый кадр Lenis напрямую. */
  if (window.lenis) {
    window.lenis.on('scroll', ScrollTrigger.update);
  }

  /* Lenis и ScrollTrigger уже работают в одном ticker. Если один кадр занят
     сборкой/отрисовкой, не даём GSAP перескочить через всю паузу: короткий
     пропуск кадров должен выглядеть как мягкое продолжение, а не как рывок
     текста или карточки.

     Не менять на lagSmoothing(0) по рекомендации из документации Lenis: она
     написана про синхронность часов, но здесь этим же тикером кормится
     lenis.raf, а Lenis сконфигурирован с duration + easing, то есть внутри
     делает currentTime += delta. Без подрезки дельты каждая просадка кадра
     превращается в скачок прогресса — то есть в рывок скролла. Проверено:
     с lagSmoothing(0) плавность заметно хуже. */
  gsap.ticker.lagSmoothing(500, 33);

  /* Hero готовится заранее под неподвижным лоадером, но его таймлайны
     начинают play только по сигналу закрытия. В критический кадр остаётся
     лишь compositor-анимация — без SplitText и построения ScrollTrigger. */
  var introStarted = root.classList.contains('is-loaded') || !document.querySelector('.loader');
  var introQueue = [];

  if (!introStarted) {
    window.addEventListener('site:loaded', function () {
      introStarted = true;
      var queued = introQueue.slice();
      introQueue.length = 0;
      queued.forEach(function (play) { play(); });
    }, { once: true });
  }

  /* Базовые значения — как на референсе */
  var TWEEN = { duration: 1, ease: 'power4.out' };
  var TRIGGER_START = 'top 80%';
  var SCRAMBLE_CONFIG = window.SITE_SCRAMBLE_CONFIG || {
    chars: 'ркс-нр',
    duration: 1.3,
    speed: 1.2
  };
  var SCRAMBLE_CHARS = SCRAMBLE_CONFIG.chars;
  var SCRAMBLE_DURATION = SCRAMBLE_CONFIG.duration;
  var SCRAMBLE_SPEED = SCRAMBLE_CONFIG.speed;

  /* Глобальной страховки по таймеру больше нет: она снимала has-anim
     со всей страницы разом через 5 секунд независимо от того, проиграла
     ли анимация у конкретного элемента — если пользователь скроллил
     дольше этого, уже показанный контент вдруг «проваливался» в стартовое
     состояние анимации и доигрывал с нуля прямо на глазах.
     Подстраховка теперь только точечная: если пресет анимации упадёт
     с ошибкой, конкретный элемент помечается видимым в catch-блоке ниже
     (см. initDeclarative), а если сам GSAP не загрузится — сработает
     проверка в самом начале файла и откроет всю страницу. */

  /* ---------- чтение настроек из data-атрибутов ---------- */
  function readOptions(el) {
    var d = el.dataset;
    var o = {};
    if (d.animDelay) o.delay = parseFloat(d.animDelay);
    if (d.animDuration) o.duration = parseFloat(d.animDuration);
    if (d.animStagger) o.stagger = parseFloat(d.animStagger);
    if (d.animStart) o.start = d.animStart;
    if (d.animTarget) o.target = d.animTarget;
    if (d.animAxis) o.axis = d.animAxis;
    if (d.animOrigin) o.origin = d.animOrigin;
    if (d.animChars) o.chars = d.animChars;
    if (d.animOnLoad !== undefined) o.onLoad = d.animOnLoad !== 'false';
    if (d.animPrewarm !== undefined) o.prewarm = d.animPrewarm !== 'false';
    return o;
  }

  function targetsOf(el, o) {
    if (!o.target) return el;
    var found = el.querySelectorAll(o.target);
    return found.length ? gsap.utils.toArray(found) : el;
  }

  /* Ждём загрузку шрифтов — без этого SplitText режет строки по неверным метрикам */
  var fontsReady = document.fonts && document.fonts.ready
    ? document.fonts.ready
    : Promise.resolve();

  /* ---------- очередь предварительного разбора ----------
     Prewarm существует, чтобы к моменту входа в viewport оставался только
     play(). Но все элементы разрешались в микротасках одного fontsReady.then,
     то есть 18 разборов SplitText подряд без выхода в цикл событий: замер дал
     7.8мс на разбор, около 140мс сплошной блокировки — ровно тогда, когда
     уходит лоадер и стартуют анимации hero. Отсюда рывок на «вылете»
     заголовков. Теперь hero разбирается сразу (ему играть немедленно), а
     остальное расходится по кадрам — но обязательно внутри окна лоадера,
     а не после него. */
  var prewarmQueue = [];
  var prewarmDraining = false;
  /* Бюджет на кадр. Один разбор SplitText стоит около 8мс, поэтому обычно
     за кадр уходит ровно один элемент — кадр не превышает своей нормы. */
  var FRAME_BUDGET_MS = 8;
  /* Страховка на случай, когда rAF не идёт (страница открыта в фоновой
     вкладке): там всё равно никто не смотрит, поэтому добираем остаток
     разом, лишь бы очередь не осталась висеть навсегда. */
  var DRAIN_FALLBACK_MS = 3000;
  var fallbackTimer = 0;

  function finishPrewarm() {
    prewarmDraining = false;
    window.clearTimeout(fallbackTimer);
    /* SplitText меняет геометрию (mask: lines добавляет обёртки), поэтому
       триггеры пересчитываем один раз, когда разбор действительно закончен,
       а не до него. */
    ScrollTrigger.refresh();
    window.__rksDitherRefresh?.();
    window.__rksScrollbarRefresh?.();
  }

  function drainPrewarm() {
    /* Очередь могла опустеть между планированием кадра и его исполнением:
       fallback-таймер успел разобрать всё сам, пока rAF стоял на паузе в
       фоновой вкладке. Тогда do/while ниже дёрнул бы undefined(). */
    if (!prewarmQueue.length) {
      finishPrewarm();
      return;
    }
    var started = performance.now();
    /* Берём столько, сколько влезает в бюджет кадра, но всегда хотя бы один —
       иначе на медленной машине очередь не сдвинется. */
    do {
      prewarmQueue.shift()();
    } while (prewarmQueue.length && performance.now() - started < FRAME_BUDGET_MS);

    if (prewarmQueue.length) {
      window.requestAnimationFrame(drainPrewarm);
      return;
    }
    finishPrewarm();
  }

  function startDraining() {
    if (prewarmDraining) return;
    prewarmDraining = true;
    /* Именно requestAnimationFrame, а не requestIdleCallback: лоадер держит
       экран MIN_DISPLAY_MS (2000мс), и весь разбор обязан уложиться в это
       окно — в этом вся идея лоадера, он прячет разовую тяжёлую работу.
       Кадры идут каждые ~16мс, поэтому три десятка элементов расходятся
       примерно за 500мс, с запасом. Idle-коллбэки приходили по таймауту в
       150мс, очередь растягивалась на 2+ секунды и вылезала из-под лоадера
       прямо в момент, когда пользователь начинал скроллить. */
    window.requestAnimationFrame(drainPrewarm);
    fallbackTimer = window.setTimeout(function () {
      if (!prewarmQueue.length) return;
      while (prewarmQueue.length) prewarmQueue.shift()();
      finishPrewarm();
    }, DRAIN_FALLBACK_MS);
  }

  function schedulePrewarm(el, activate) {
    /* Hero играет сразу по site:loaded — откладывать его разбор нельзя. */
    if (el.closest('.hero')) {
      fontsReady.then(function () { activate(false); });
      return;
    }
    fontsReady.then(function () {
      prewarmQueue.push(function () { activate(false); });
      startDraining();
    });
  }

  /* ---------- общий запуск ----------
     SplitText для заголовков и многострочного текста готовится заранее после
     загрузки шрифтов. В момент входа в viewport остаётся только play(), а
     после завершения одноразовой анимации DOM-обёртки освобождаются. */
  function run(el, o, build) {
    var state = { tl: null, split: null, playRequested: false, played: false };
    var built = false;
    var buildPromise = null;
    var st = null;

    function cleanup() {
      if (state.tl) {
        state.tl.kill();
        state.tl = null;
      }
      if (state.split) {
        /* Как на OCI: после одноразового появления возвращаем исходную
           разметку. Так на странице не остаются сотни char/line-обёрток и
           ResizeObserver, созданный autoSplit. */
        state.split.revert();
        state.split = null;
        el.classList.remove('split-text');
      }
      if (st) {
        st.kill();
        st = null;
      }
    }

    function play() {
      if (!introStarted && el.closest('.hero')) {
        introQueue.push(play);
        return;
      }
      if (state.played) return;
      state.played = true;
      if (!state.tl) {
        el.classList.add('is-anim-ready');
        cleanup();
        return;
      }

      /* не затираем onComplete, заданный внутри пресета */
      var previous = state.tl.eventCallback('onComplete');
      state.tl.eventCallback('onComplete', function () {
        if (previous) previous();
        cleanup();
      });

      el.classList.add('is-anim-ready');
      state.tl.play();
    }

    function activate(requestPlay) {
      if (requestPlay !== false) state.playRequested = true;
      if (built) {
        if (!buildPromise && state.playRequested && !state.played) play();
        return;
      }
      built = true;
      var result = build(state);
      if (result && typeof result.then === 'function') {
        buildPromise = result;
        result.then(function () {
          buildPromise = null;
          if (state.playRequested) play();
        }).catch(function (error) {
          buildPromise = null;
          /* Ошибка загрузки шрифта/разбиения не должна оставлять нижний
             блок навсегда под visibility:hidden. Показываем исходный текст,
             сохраняя доступность страницы даже без motion-эффекта. */
          el.classList.add('is-anim-ready');
          state.played = true;
          cleanup();
          console.warn('anim: async build', error);
        });
      } else if (state.playRequested) {
        play();
      }
    }

    if (o.onLoad) {
      if (introStarted) activate();
      else window.addEventListener('site:loaded', activate, { once: true });
      return;
    }

    st = ScrollTrigger.create({
      trigger: el,
      start: o.start || TRIGGER_START,
      once: true,
      onEnter: activate,
      onRefresh: function (self) {
        /* При reload/back браузер восстанавливает scroll не всегда до
           создания ScrollTrigger. Если элемент уже в viewport на refresh,
           запускаем его здесь. Проверка start <= scroll() дополнительно
           покрывает случай, когда refresh случился уже после триггера, но
           ScrollTrigger ещё не успел обновить progress. */
        if (self.progress > 0 || self.isActive || self.start <= self.scroll()) activate();
      }
    });

    /* если элемент уже в зоне видимости на момент инициализации */
    if (st.progress > 0 || st.isActive) activate();

    /* SplitText создаёт много DOM-обёрток и читает метрики строк. Поэтому
       lineUp/title помечают prewarm автоматически и собираются после
       document.fonts.ready, пока пользователь ещё не дошёл до блока. */
    if (o.prewarm) schedulePrewarm(el, activate);
  }

  /* ---------- пресеты ---------- */
  var presets = {

    /* Простое проявление по прозрачности */
    fadeIn: function (el, o) {
      var t = Object.assign({}, TWEEN, { stagger: 0.1 }, o);
      var targets = targetsOf(el, o);
      run(el, o, function (state) {
        state.tl = gsap.timeline({ paused: true });
        state.tl.from(targets, {
          opacity: 0,
          duration: t.duration,
          ease: t.ease,
          delay: t.delay,
          stagger: t.stagger
        });
      });
    },

    /* Проявление со сдвигом снизу на 30px */
    fadeUp: function (el, o) {
      var t = Object.assign({}, TWEEN, { y: 30, stagger: 0.1 }, o);
      var targets = targetsOf(el, o);
      run(el, o, function (state) {
        state.tl = gsap.timeline({ paused: true });
        state.tl.from(targets, {
          opacity: 0,
          y: t.y,
          duration: t.duration,
          ease: t.ease,
          delay: t.delay,
          stagger: t.stagger
        });
      });
    },

    /* Статистика: цифры и разделители всегда находятся в финальном
       состоянии. Анимируем только поясняющий текст и кнопку, чтобы блок не
       запускал лишние layout/paint-задачи во время прокрутки. */
    stats: function (el, o) {
      var t = Object.assign({}, TWEEN, { duration: 0.72, stagger: 0.26 }, o);
      var items = gsap.utils.toArray(el.querySelectorAll('.stat-item'));
      var descriptions = items.map(function (item) { return item.querySelector('p'); }).filter(Boolean);
      var button = el.querySelector('.stats__button');
      if (!items.length) return;

      run(el, o, function (state) {
        gsap.set(descriptions, { opacity: 0, y: 12 });
        if (button) gsap.set(button, { opacity: 0, y: 20 });
        state.tl = gsap.timeline({ paused: true });
        state.tl.eventCallback('onComplete', function () {
          /* После появления освобождаем compositor-слои описаний и кнопки. */
          gsap.set(descriptions, { clearProps: 'transform,opacity' });
          if (button) gsap.set(button, { clearProps: 'transform,opacity' });
        });
        items.forEach(function (item, i) {
          var at = i * t.stagger;
          var description = item.querySelector('p');

          if (description) {
            state.tl.to(description, {
              opacity: 1,
              y: 0,
              duration: 0.55,
              ease: 'power3.out'
            }, at + 0.26);
          }
        });

        if (button) {
          state.tl.to(button, {
            opacity: 1,
            y: 0,
            duration: 0.65,
            ease: 'power3.out'
          }, items.length * t.stagger + 0.08);
        }
      });
    },

    /* Отрисовка линии: масштаб от 0 (по умолчанию вертикально, сверху вниз) */
    line: function (el, o) {
      var t = Object.assign({}, TWEEN, { duration: 0.6, stagger: 0.1 }, o);
      var targets = gsap.utils.toArray(targetsOf(el, o)).filter(function (target) {
        return window.getComputedStyle(target).display !== 'none';
      });
      var axis = o.axis || 'y';
      var prop = axis === 'x' ? 'scaleX' : 'scaleY';
      var origin = o.origin
        ? o.origin
        : (axis === 'x' ? 'left center' : 'top center');
      var vars = {
        transformOrigin: origin,
        duration: t.duration,
        ease: t.ease,
        delay: t.delay,
        stagger: t.stagger
      };
      vars[prop] = 0;
      run(el, o, function (state) {
        state.tl = gsap.timeline({ paused: true });
        state.tl.from(targets, vars);
      });
    },

    /* Текст выезжает построчно из-под маски */
    lineUp: function (el, o) {
      var t = Object.assign({}, TWEEN, { duration: 0.8, stagger: 0.1 }, o);
      if (!window.SplitText) return presets.fadeUp(el, o);
      var runOptions = Object.assign({ prewarm: true }, o);
      run(el, runOptions, function (state) {
        el.classList.add('split-text');
        return fontsReady.then(function () {
          state.split = SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            autoSplit: true,
            /* Не даём SplitText заменить неразрывные пробелы (&nbsp;)
               обычными: иначе короткие предлоги снова повисают в конце
               строки после разбивки текста. Обычные переводы/табы чистим
               отдельно, не затрагивая NBSP. */
            reduceWhiteSpace: false,
            prepareText: function (value) {
              return value.replace(/[\t\n\r ]+/g, ' ');
            },
            linesClass: 'line-split',
            onSplit: function (self) {
              state.tl = gsap.timeline({ paused: true });
              state.tl.fromTo(self.lines,
                { yPercent: 100, opacity: 0 },
                {
                  yPercent: 0,
                  opacity: 1,
                  duration: t.duration,
                  ease: t.ease,
                  delay: t.delay,
                  stagger: t.stagger
                }
              );
              return state.tl;
            }
          });
        });
      });
    },

    /* Заголовок выезжает посимвольно из-под маски строк */
    title: function (el, o) {
      var t = Object.assign({}, TWEEN, { duration: 1 }, o);
      if (!window.SplitText) return presets.fadeUp(el, o);
      var runOptions = Object.assign({ prewarm: true }, o);
      run(el, runOptions, function (state) {
        el.classList.add('split-text');
        return fontsReady.then(function () {
          state.split = SplitText.create(el, {
            type: 'lines, words, chars',
            mask: 'lines',
            autoSplit: true,
            reduceWhiteSpace: false,
            prepareText: function (value) {
              return value.replace(/[\t\n\r ]+/g, ' ');
            },
            linesClass: 'line-split',
            onSplit: function (self) {
              var to = {
                yPercent: 0,
                opacity: 1,
                ease: t.ease,
                delay: t.delay
              };
              if (t.stagger) {
                to.stagger = t.stagger;
                to.duration = t.duration;
              } else {
                /* символы «догоняют» друг друга: общий разброс = 20% длительности */
                to.duration = t.duration * 0.8;
                to.stagger = { amount: t.duration * 0.2 };
              }
              state.tl = gsap.timeline({ paused: true });
              state.tl.fromTo(self.chars, { yPercent: 100, opacity: 0 }, to);
              return state.tl;
            }
          });
        });
      });
    },

    /* Текст «набирается» из подчёркивания случайными символами */
    typeChars: function (el, o) {
      var t = Object.assign({}, TWEEN, { delay: 0, duration: 2, stagger: 0.05 }, o);

      /* Номера карточек — это короткие крупные значения. Посимвольная
         запись ScrambleText здесь каждый кадр трогает textContent и может
         запускать layout всей карточки. Сохраняем появление номера, но
         переводим его на compositor-свойства, как у показателей статистики. */
      if (el.matches('.project-card__number, .service-card__head > span')) {
        presets.fadeUp(el, o);
        return;
      }
      if (!window.ScrambleTextPlugin) return;

      var nodes = o.target
        ? gsap.utils.toArray(el.querySelectorAll(o.target))
        : [el];
      if (!nodes.length) return;

      var texts = nodes.map(function (node) {
        var text = node.textContent;
        node.dataset.originalText = text;
        return text;
      });

      /* Скрамбл переписывает textContent каждый кадр — это принудительный
         пересчёт раскладки. Фиксируем ширину заранее, чтобы reflow не уходил
         вверх по дереву и соседние элементы не дёргались */
      var widths = nodes.map(function (node) { return node.getBoundingClientRect().width; });
      nodes.forEach(function (node, i) {
        /* min-width не действует на строчные элементы — там пропускаем */
        if (widths[i] && window.getComputedStyle(node).display !== 'inline') {
          node.style.minWidth = widths[i] + 'px';
        }
      });

      run(el, o, function (state) {
        state.tl = gsap.timeline({
          paused: true,
          onComplete: function () {
            nodes.forEach(function (node) { node.style.minWidth = ''; });
            gsap.set(nodes, { clearProps: 'all' });
          }
        });
        nodes.forEach(function (node, i) {
          state.tl.fromTo(node,
            { scrambleText: { text: '_' } },
            {
              duration: t.duration,
              ease: t.ease,
              scrambleText: {
                text: texts[i],
                speed: SCRAMBLE_SPEED,
                chars: o.chars || SCRAMBLE_CHARS
              }
            },
            t.delay + i * t.stagger
          );
        });
      });
    }
  };

  /* Фиксированное desktop-меню скрывается тем же посимвольным скрамблом,
     что и текст футера. При возврате к верхней точке исходные подписи
     проигрываются обратно. */
  function initDesktopNavScrollScramble() {
    var nav = document.querySelector('.desktop-nav');
    if (!nav || !window.ScrambleTextPlugin) return;

    var links = gsap.utils.toArray(nav.querySelectorAll('a'));
    if (!links.length) return;

    var originalTexts = links.map(function (link) { return link.textContent; });
    /* sync вызывается на каждом кадре скролла, а matchMedia каждый раз
       создаёт новый MediaQueryList. Держим один объект на всю функцию. */
    var desktopQuery = window.matchMedia('(min-width: 1200px)');
    var isHidden = desktopQuery.matches && window.scrollY > 24;
    var introPlayed = false;
    var introTween;
    var tween;

    function stopTween() {
      if (introTween) introTween.kill();
      if (tween) tween.kill();
      gsap.killTweensOf(links);
      introTween = null;
      tween = null;
    }

    function playIntro() {
      if (introPlayed) return;
      introPlayed = true;
      nav.classList.add('is-anim-ready');

      if (isHidden) {
        gsap.set(links, { scrambleText: { text: '' } });
        return;
      }

      introTween = gsap.timeline({
        onComplete: function () { introTween = null; }
      });
      links.forEach(function (link, i) {
        introTween.fromTo(link,
          { scrambleText: { text: '_' } },
          {
            duration: 2,
            ease: 'power4.out',
            scrambleText: {
              text: originalTexts[i],
              speed: SCRAMBLE_SPEED,
              chars: SCRAMBLE_CHARS
            }
          },
          i * 0.05
        );
      });
    }

    function setHidden(next) {
      if (isHidden === next) return;
      isHidden = next;
      if (!introPlayed) return;

      stopTween();
      tween = gsap.timeline();

      links.forEach(function (link, i) {
        tween.to(link, {
          duration: SCRAMBLE_DURATION,
          ease: 'power2.out',
          scrambleText: {
            text: next ? '' : originalTexts[i],
            speed: SCRAMBLE_SPEED,
            chars: SCRAMBLE_CHARS
          }
        }, i * 0.06);
      });
    }

    function sync(scrollTop) {
      var currentScroll = typeof scrollTop === 'number' ? scrollTop : window.scrollY;
      setHidden(desktopQuery.matches && currentScroll > 24);
    }

    links.forEach(function (link, i) {
      function scrambleOnHover() {
        if (!desktopQuery.matches || isHidden) return;
        gsap.killTweensOf(link);
        gsap.to(link, {
          duration: SCRAMBLE_DURATION,
          ease: 'power4.out',
          scrambleText: {
            text: originalTexts[i],
            speed: SCRAMBLE_SPEED,
            chars: SCRAMBLE_CHARS
          }
        });
      }

      link.addEventListener('mouseenter', scrambleOnHover);
      link.addEventListener('focus', scrambleOnHover);
    });

    if (introStarted) playIntro();
    else window.addEventListener('site:loaded', playIntro, { once: true });
    /* Lenis эмитит scroll на каждом кадре — нативное событие поверх него
       заставляло sync отрабатывать дважды за кадр. */
    if (window.lenis) {
      window.lenis.on('scroll', function (event) {
        sync(event && typeof event.animatedScroll === 'number' ? event.animatedScroll : undefined);
      });
    } else {
      window.addEventListener('scroll', sync, { passive: true });
    }
    window.addEventListener('resize', sync);
    sync();
  }

  /* Текстовые ссылки и пункты открытого меню при наведении перебирают буквы
     тем же ScrambleText-эффектом, что и пункты desktop-навигации. */
  function initServiceLinksScramble() {
    var links = gsap.utils.toArray([
      '.service-card .text-link',
      '.news__header .text-link',
      '.menu-panel__nav a',
      '.menu-panel__contacts-links a',
      '.contacts-info__links a',
      '.news-detail__back'
    ].join(', '));
    if (!links.length || !window.ScrambleTextPlugin) return;

    links.forEach(function (link) {
      var originalText = link.textContent;

      function scramble() {
        gsap.killTweensOf(link);
        gsap.to(link, {
          duration: SCRAMBLE_DURATION,
          ease: 'power4.out',
          scrambleText: {
            text: originalText,
            speed: SCRAMBLE_SPEED,
            chars: SCRAMBLE_CHARS
          }
        });
      }

      link.addEventListener('mouseenter', scramble);
      link.addEventListener('focus', scramble);
    });
  }

  /* Все ссылки футера получают тот же scramble-hover и не меняют свою
     геометрию при переборе символов. */
  function initFooterLinksScramble() {
    var links = gsap.utils.toArray('.footer a');
    if (!links.length || !window.ScrambleTextPlugin) return;

    links.forEach(function (link) {
      var lineNodes = link.querySelectorAll('.footer__legal-line');

      /* Для политик меняем только textContent каждой заранее заданной строки.
         Так ScrambleTextPlugin не может создать временный перенос через innerHTML. */
      if (lineNodes.length) {
        var lineStates = Array.prototype.map.call(lineNodes, function (line) {
          return { element: line, text: line.textContent, progress: 1 };
        });

        function renderLine(state) {
          var chars = Array.from(state.text);
          var revealed = Math.floor(chars.length * state.progress);
          state.element.textContent = chars.map(function (char, index) {
            if (/\s/.test(char) || index < revealed) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          }).join('');
        }

        function scrambleLines() {
          lineStates.forEach(function (state) {
            gsap.killTweensOf(state);
            state.progress = 0;
            gsap.to(state, {
              duration: SCRAMBLE_DURATION,
              ease: 'power4.out',
              progress: 1,
              onUpdate: function () { renderLine(state); },
              onComplete: function () { state.element.textContent = state.text; }
            });
          });
        }

        link.addEventListener('mouseenter', scrambleLines);
        link.addEventListener('focus', scrambleLines);
        return;
      }

      var originalText = link.textContent;

      function scramble() {
        gsap.killTweensOf(link);
        gsap.to(link, {
          duration: SCRAMBLE_DURATION,
          ease: 'power4.out',
          scrambleText: {
            text: originalText,
            speed: SCRAMBLE_SPEED,
            chars: SCRAMBLE_CHARS
          }
        });
      }

      link.addEventListener('mouseenter', scramble);
      link.addEventListener('focus', scramble);
    });
  }

  /* ---------- инициализация по data-anim ---------- */
  function initDeclarative() {
    gsap.utils.toArray('[data-anim]').forEach(function (el) {
      if (el.classList.contains('desktop-nav')) return;
      var name = el.dataset.anim;
      var preset = presets[name];
      if (!preset) {
        el.classList.add('is-anim-ready');
        return;
      }
      try {
        preset(el, readOptions(el));
      } catch (error) {
        el.classList.add('is-anim-ready');
        console.warn('anim: ' + name, error);
      }
    });
  }

  /* ---------- «лестница» в блоке о компании: движение по скроллу ---------- */
  function initStairs() {
    var steps = document.querySelector('.company-intro__steps');
    var stairs = gsap.utils.toArray('.company-intro__steps span');
    var section = document.querySelector('.company-intro');
    if (!steps || !stairs.length || !section) return;

    gsap.from(steps, {
      scaleX: function () {
        /* Масштабируем всю композицию одним GPU-слоем. Самая короткая
           нижняя плашка в начале доходит до левого края, правые границы
           всех плашек при этом остаются закреплены справа. */
        var lastWidth = stairs[stairs.length - 1].offsetWidth;
        return lastWidth ? section.clientWidth / lastWidth : 1;
      },
      transformOrigin: 'right center',
      force3D: true,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: stairs[stairs.length - 1],
        start: 'top 70%',
        endTrigger: section,
        end: 'bottom 45%',
        scrub: 0.35,
        invalidateOnRefresh: true
      }
    });
  }

  /* ---------- параллакс карточек проектов (только десктоп) ----------
     Двигаем саму карточку лёгким вертикальным смещением. Вертикальные
     разделители вынесены из карточек в статический слой секции, поэтому они
     не следуют за transform и остаются закреплены нижним краем проекта. */
  function initProjectsParallax() {
    var grid = document.querySelector('.projects__grid');
    if (!grid) return;

    gsap.matchMedia().add('(min-width: 1200px)', function () {
      var cards = gsap.utils.toArray(grid.querySelectorAll('.project-card'));
      if (!cards.length) return;

      var from = [8, 0, 10];
      var to = [0, 8, 2];
      var motionStates = cards.map(function (card, i) {
        var state = {
          x: 0,
          y: window.innerHeight * from[i % from.length] / 100,
          rotation: 0
        };
        card.__rksDitherMotion = state;
        return state;
      });

      /* Стрелку выносим из карточки: .project-card из-за transform параллакса
         становится контекстом наложения, и z-index стрелки не поднимается над
         общим WebGL-дизером (fixed, z-index 2). Слой живёт на уровне body,
         стрелки в нём стоят по углу медиа и едут за карточкой. */
      var layer = document.createElement('div');
      layer.className = 'projects-arrow-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);

      var medias = cards.map(function (card) {
        return card.querySelector('.project-card__media');
      });
      var arrows = medias.map(function (media) {
        var arrow = media && media.querySelector('.project-card__arrow');
        if (arrow) layer.appendChild(arrow);
        return arrow;
      });

      function placeArrows() {
        var scrollX = window.scrollX || window.pageXOffset;
        var scrollY = window.scrollY || window.pageYOffset;
        arrows.forEach(function (arrow, i) {
          if (!arrow || !medias[i]) return;
          var rect = medias[i].getBoundingClientRect();
          /* База — «нулевой» кадр параллакса: вычитаем текущее смещение. */
          arrow.style.top = (rect.bottom + scrollY - motionStates[i].y - arrow.offsetHeight) + 'px';
          arrow.style.left = (rect.right + scrollX - arrow.offsetWidth) + 'px';
        });
      }

      function syncArrows() {
        arrows.forEach(function (arrow, i) {
          if (arrow) arrow.style.transform = 'translate3d(0, ' + motionStates[i].y + 'px, 0)';
        });
      }

      var hoverBindings = [];
      medias.forEach(function (media, i) {
        var arrow = arrows[i];
        if (!media || !arrow) return;
        var show = function () { arrow.classList.add('is-visible'); };
        var hide = function () { arrow.classList.remove('is-visible'); };
        media.addEventListener('pointerenter', show);
        media.addEventListener('pointerleave', hide);
        media.addEventListener('focusin', show);
        media.addEventListener('focusout', hide);
        hoverBindings.push({ media: media, show: show, hide: hide });
      });

      gsap.set(cards, {
        y: function (i) { return from[i % from.length] + 'vh'; },
        force3D: true
      });
      placeArrows();
      syncArrows();

      var timeline = gsap.timeline({
        scrollTrigger: {
          trigger: grid,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.8,
          invalidateOnRefresh: true
        },
        onUpdate: syncArrows
      });
      timeline.to(cards, {
        y: function (i) { return to[i % to.length] + 'vh'; },
        force3D: true,
        ease: 'none'
      }, 0);
      timeline.to(motionStates, {
        y: function (i) { return window.innerHeight * to[i % to.length] / 100; },
        ease: 'none'
      }, 0);

      var relayout = function () { placeArrows(); syncArrows(); };
      window.addEventListener('resize', relayout);
      window.addEventListener('load', relayout);
      ScrollTrigger.addEventListener('refresh', relayout);
      window.requestAnimationFrame(relayout);

      return function () {
        timeline.kill();
        window.removeEventListener('resize', relayout);
        window.removeEventListener('load', relayout);
        ScrollTrigger.removeEventListener('refresh', relayout);
        gsap.set(cards, { clearProps: 'transform' });
        hoverBindings.forEach(function (b) {
          b.media.removeEventListener('pointerenter', b.show);
          b.media.removeEventListener('pointerleave', b.hide);
          b.media.removeEventListener('focusin', b.show);
          b.media.removeEventListener('focusout', b.hide);
        });
        arrows.forEach(function (arrow, i) {
          if (!arrow) return;
          arrow.classList.remove('is-visible');
          arrow.style.top = '';
          arrow.style.left = '';
          arrow.style.transform = '';
          if (medias[i]) medias[i].appendChild(arrow);
        });
        layer.remove();
        motionStates.forEach(function (state, i) {
          state.x = 0;
          state.y = 0;
          state.rotation = 0;
          delete cards[i].__rksDitherMotion;
        });
        window.__rksDitherRefresh?.();
      };
    });
  }

  /* ---------- карточки услуг: диагональная scroll-анимация ----------
     Стартовые значения фиксированы, чтобы resize/refresh не меняли рисунок
     и не запускали карточки заново с другим поворотом. */
  function initServicesCardsReveal() {
    var section = document.querySelector('.services');
    var list = document.querySelector('.services__list');
    if (!section || !list) return;

    var cards = gsap.utils.toArray(list.querySelectorAll('.service-card'));
    if (!cards.length) return;

    gsap.matchMedia().add({
      desktop: '(min-width: 1200px)',
      adaptive: '(max-width: 1199px)'
    }, function (context) {
      var isDesktop = context.conditions.desktop;
      var xStep = isDesktop ? 150 : 75;
      var yStep = isDesktop ? 200 : 100;
      var rotations = [-18, 22, -16, 20, -13];
      var offsets = cards.map(function (_, i) {
        return {
          x: (i + 1) * xStep,
          y: (i + 1) * yStep,
          rotation: rotations[i % rotations.length]
        };
      });
      var motionStates = offsets.map(function (offset, i) {
        var state = { x: offset.x, y: offset.y, rotation: offset.rotation };
        cards[i].__rksDitherMotion = state;
        return state;
      });

      /* Сначала явно выставляем стабильный старт. Это предотвращает
         immediateRender-скачок, характерный для gsap.from + scrub. */
      gsap.set(cards, {
        x: function (i) { return offsets[i].x; },
        y: function (i) { return offsets[i].y; },
        rotation: function (i) { return offsets[i].rotation; },
        transformOrigin: 'center center',
        force3D: true
      });

      var tweens = [];

      if (isDesktop) {
        /* Десктоп: карточки идут в отдельном sticky-блоке рядом с интро.
           Возвращаем постепенный диагональный reveal по прокрутке, но с
           мягким scrub: карточки и их изображения двигаются одним кадром. */
        var desktopTimeline = gsap.timeline({
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom 50%',
            scrub: 0.65,
            invalidateOnRefresh: true
          }
        });
        desktopTimeline.to(cards, {
          x: 0,
          y: 0,
          rotation: 0,
          immediateRender: false,
          force3D: true,
          stagger: {
            each: 0.1,
            ease: 'power2.out'
          }
        }, 0);
        desktopTimeline.to(motionStates, {
          x: 0,
          y: 0,
          rotation: 0,
          stagger: {
            each: 0.1,
            ease: 'power2.out'
          }
        }, 0);
        tweens.push(desktopTimeline);
      } else {
        /* Моб/планшет: список из 5 карточек значительно выше экрана,
           поэтому общий триггер на всю секцию раньше растягивал анимацию
           так, что первые карточки "успокаивались" (transform: none) уже
           над экраном или впритык к верхнему краю — контент не успевал
           считаться. У каждой карточки теперь свой триггер: анимация
           доигрывает именно тогда, когда верх карточки доходит до точки
           примерно на 20% ниже центра экрана, и дальше карточка спокойно
           стоит на месте, пока не начнёт уходить сама естественным скроллом. */
        cards.forEach(function (card, index) {
          var cardTimeline = gsap.timeline({
            scrollTrigger: {
              trigger: card,
              /* Запускаем движение чуть до появления карточки в viewport:
                 при старте ровно на нижней границе первый видимый кадр был
                 слишком резким, особенно на быстром touch-скролле. */
              start: 'top 110%',
              /* Последняя карточка появляется почти у нижней границы
                 секции. Завершаем её немного раньше и ниже центра, чтобы
                 она не оставалась в промежуточном transform при переходе к
                 видео. Остальные сохраняют точку около 20% ниже центра. */
              end: index === cards.length - 1 ? 'top 76%' : 'top 70%',
              scrub: 0.8,
              invalidateOnRefresh: true
            }
          });
          cardTimeline.to(card, {
            x: 0,
            y: 0,
            rotation: 0,
            immediateRender: false,
            force3D: true,
            ease: 'power2.out'
          }, 0);
          cardTimeline.to(motionStates[index], {
            x: 0,
            y: 0,
            rotation: 0,
            ease: 'power2.out'
          }, 0);
          tweens.push(cardTimeline);
        });
      }

      list.classList.add('is-services-anim-ready');

      return function () {
        tweens.forEach(function (tween) { tween.kill(); });
        gsap.set(cards, { clearProps: 'transform' });
        motionStates.forEach(function (state, i) {
          state.x = 0;
          state.y = 0;
          state.rotation = 0;
          delete cards[i].__rksDitherMotion;
        });
        window.__rksDitherRefresh?.();
      };
    });
  }

  /* Наезд камеры живёт в script.js и масштабирует уже готовый canvas через
     compositor transform. Дизер при этом не пересчитывается на каждом кадре. */

  /* ---------- логотип в подвале: подъезжает по мере скролла ---------- */
  function initFooterLogo() {
    var footer = document.querySelector('.footer');
    var logo = document.querySelector('.footer__logo');
    if (!footer || !logo) return;

    var isMobile = window.matchMedia('(max-width: 599px)').matches;
    var scrollTrigger = {
      trigger: logo,
      start: isMobile ? 'top 85%' : 'top bottom',
      end: isMobile ? 'center 50%' : 'bottom bottom',
      scrub: isMobile ? 0.8 : true,
      invalidateOnRefresh: true
    };

    if (!isMobile) scrollTrigger.endTrigger = footer;

    gsap.from(logo, {
      scale: 0.85,
      opacity: 0,
      transformOrigin: 'center bottom',
      ease: 'none',
      scrollTrigger: scrollTrigger
    });
  }

  /* ---------- запуск ---------- */
  function boot() {
    initDeclarative();
    initDesktopNavScrollScramble();
    initServiceLinksScramble();
    initFooterLinksScramble();
    initStairs();
    initProjectsParallax();
    initServicesCardsReveal();
    initFooterLogo();

    /* пересчёт после подгрузки шрифтов и картинок */
    function refreshAnimations() {
      ScrollTrigger.refresh();
      ScrollTrigger.update();
      window.__rksDitherRefresh?.();
      window.__rksScrollbarRefresh?.();
    }

    /* ScrollTrigger намеренно игнорирует mobile-resize, потому что Safari
       меняет высоту viewport при появлении адресной строки. Для смены ширины
       это поведение всё же нужно: SplitText и адаптивные секции получают новую
       геометрию, а триггеры нижних блоков должны пересчитаться. */
    var lastViewportWidth = window.innerWidth;
    var resizeTimer;
    function refreshOnWidthChange() {
      var nextWidth = window.innerWidth;
      if (nextWidth === lastViewportWidth) return;
      lastViewportWidth = nextWidth;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refreshAnimations, 120);
    }

    /* Когда есть prewarm-очередь, refresh делает drainPrewarm по её
       завершении: считать позиции триггеров до разбиения текста бессмысленно,
       SplitText ещё изменит геометрию. Здесь остаётся страховка для страниц,
       где prewarm-элементов нет вовсе. */
    fontsReady.then(function () {
      if (!prewarmDraining && !prewarmQueue.length) refreshAnimations();
    });
    window.addEventListener('load', refreshAnimations);
    window.addEventListener('resize', refreshOnWidthChange, { passive: true });
    window.addEventListener('pageshow', function () {
      /* Два кадра дают браузеру завершить восстановление scroll-позиции. */
      requestAnimationFrame(function () {
        requestAnimationFrame(refreshAnimations);
      });
    });
  }

  /* Строим таймлайны и триггеры сразу под лоадером. Тяжёлая разбивка
     заголовков уже завершена к моменту входа в область видимости. */
  var booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    boot();
  }

  bootOnce();
})();
