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

  /* Если подготовка изображения или другой скрипт на короткое время занимает
     главный поток, не даём таймлайну перескочить сразу на пропущенное время.
     После паузы GSAP продолжит анимацию с ближайшего кадра, поэтому строки
     статистики не «телепортируются» в финальное состояние. */
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
  var SCRAMBLE_CHARS = 'ркс-нр';

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

  /* ---------- общий запуск ----------
     Ключевое для производительности: таймлайн и разбивка текста создаются
     не на старте страницы, а в момент входа элемента в зону видимости.
     Иначе все SplitText инициализируются одним пакетом и подвешивают поток. */
  function run(el, o, build) {
    var state = { tl: null, split: null };
    var built = false;

    function cleanup() {
      if (state.tl) {
        /* У статистики финальные состояния должны остаться на экране:
           timeline.revert() здесь возвращал цифры и линии в ноль сразу
           после завершения их анимации. */
        if (!state.keepFinal) state.tl.revert();
        state.tl = null;
      }
      /* state.split намеренно НЕ откатываем: обёртки SplitText считают высоту
         строки чуть иначе, чем обычный текстовый поток (отсюда компенсация
         .line-split в CSS для хвостиков букв «у», «р», «д»). На многострочном
         тексте расхождение накапливается по строкам, и при revert() браузер
         пересчитывает раскладку — текст видимо дёргается в момент, когда
         анимация как раз закончилась и всё должно было успокоиться.
         Финальное состояние тween'а (всё на месте, непрозрачность 1) и так
         визуально неотличимо от обычного текста — откат нужен только для
         гигиены DOM, а не для картинки, и того не стоит. */
      state.split = null;
    }

    function play() {
      if (!introStarted && el.closest('.hero')) {
        introQueue.push(play);
        return;
      }
      if (!state.tl) { el.classList.add('is-anim-ready'); return; }

      /* не затираем onComplete, заданный внутри пресета */
      var previous = state.tl.eventCallback('onComplete');
      state.tl.eventCallback('onComplete', function () {
        if (previous) previous();
        cleanup();
      });

      el.classList.add('is-anim-ready');
      state.tl.play();
    }

    function activate() {
      if (built) return;
      built = true;
      var result = build(state);
      if (result && typeof result.then === 'function') result.then(play);
      else play();
    }

    if (o.onLoad) {
      if (introStarted) activate();
      else window.addEventListener('site:loaded', activate, { once: true });
      return;
    }

    var st = ScrollTrigger.create({
      trigger: el,
      start: o.start || TRIGGER_START,
      once: true,
      onEnter: activate,
      onRefresh: function (self) {
        /* При reload/back браузер восстанавливает scroll не всегда до
           создания ScrollTrigger. Если элемент уже в viewport на refresh,
           запускаем его здесь, иначе он останется скрытым под has-anim. */
        if (self.progress > 0 || self.isActive) activate();
      }
    });

    /* если элемент уже в зоне видимости на момент инициализации */
    if (st.progress > 0 || st.isActive) activate();
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

    /* Статистика: линии рисуются слева направо, показатели появляются
       последовательно, один за другим. */
    stats: function (el, o) {
      var t = Object.assign({}, TWEEN, { duration: 0.72, stagger: 0.26 }, o);
      var items = gsap.utils.toArray(el.querySelectorAll('.stat-item'));
      var numbers = items.map(function (item) { return item.querySelector('strong'); }).filter(Boolean);
      var numberTexts = numbers.map(function (number) { return number.textContent; });
      var descriptions = items.map(function (item) { return item.querySelector('p'); }).filter(Boolean);
      var button = el.querySelector('.stats__button');
      if (!items.length) return;

      run(el, o, function (state) {
        state.keepFinal = true;
        gsap.set(el, { '--stats-line-progress': 0 });
        gsap.set(items, { '--stat-line-progress': 0 });
        gsap.set(descriptions, { opacity: 0, y: 12 });
        if (button) gsap.set(button, { opacity: 0, y: 20 });

        state.tl = gsap.timeline({ paused: true });
        state.tl.to(el, {
          '--stats-line-progress': 1,
          duration: items.length * t.stagger + t.duration,
          ease: 'power1.out'
        }, 0);
        items.forEach(function (item, i) {
          var at = i * t.stagger;
          var number = item.querySelector('strong');
          var description = item.querySelector('p');

          state.tl.to(item, {
            '--stat-line-progress': 1,
            duration: t.duration,
            ease: 'power2.out'
          }, at);
          if (number) {
            state.tl.fromTo(number,
              { scrambleText: { text: '_' } },
              {
                duration: t.duration,
                ease: 'power4.out',
                scrambleText: {
                  text: numberTexts[i],
                  speed: 2,
                  chars: SCRAMBLE_CHARS
                }
              },
              at + 0.16
            );
          }
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
      run(el, o, function (state) {
        el.classList.add('split-text');
        return fontsReady.then(function () {
          state.split = SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            autoSplit: true,
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
      run(el, o, function (state) {
        el.classList.add('split-text');
        return fontsReady.then(function () {
          state.split = SplitText.create(el, {
            type: 'lines, words, chars',
            mask: 'lines',
            autoSplit: true,
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
                speed: 2,
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
    var isHidden = window.matchMedia('(min-width: 1200px)').matches && window.scrollY > 24;
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
              speed: 2,
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
          duration: 0.85,
          ease: 'power2.out',
          scrambleText: {
            text: next ? '' : originalTexts[i],
            speed: 2,
            chars: SCRAMBLE_CHARS
          }
        }, i * 0.06);
      });
    }

    function sync(scrollTop) {
      var currentScroll = typeof scrollTop === 'number' ? scrollTop : window.scrollY;
      setHidden(window.matchMedia('(min-width: 1200px)').matches && currentScroll > 24);
    }

    links.forEach(function (link, i) {
      function scrambleOnHover() {
        if (!window.matchMedia('(min-width: 1200px)').matches || isHidden) return;
        gsap.killTweensOf(link);
        gsap.to(link, {
          duration: 0.85,
          ease: 'power4.out',
          scrambleText: {
            text: originalTexts[i],
            speed: 2,
            chars: SCRAMBLE_CHARS
          }
        });
      }

      link.addEventListener('mouseenter', scrambleOnHover);
      link.addEventListener('focus', scrambleOnHover);
    });

    if (introStarted) playIntro();
    else window.addEventListener('site:loaded', playIntro, { once: true });
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    if (window.lenis) {
      window.lenis.on('scroll', function (event) {
        sync(event && typeof event.animatedScroll === 'number' ? event.animatedScroll : undefined);
      });
    }
    sync();
  }

  /* Ссылки «Подробнее» и «Все новости» при наведении перебирают буквы
     тем же ScrambleText-эффектом, что и пункты шапки. */
  function initServiceLinksScramble() {
    var links = gsap.utils.toArray('.service-card .text-link, .news__header .text-link');
    if (!links.length || !window.ScrambleTextPlugin) return;

    links.forEach(function (link) {
      var originalText = link.textContent;

      function scramble() {
        gsap.killTweensOf(link);
        gsap.to(link, {
          duration: 0.85,
          ease: 'power4.out',
          scrambleText: {
            text: originalText,
            speed: 2,
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
              duration: 0.85,
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
          duration: 0.85,
          ease: 'power4.out',
          scrambleText: {
            text: originalText,
            speed: 2,
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

  /* ---------- параллакс карточек проектов (только десктоп) ---------- */
  var PROJECT_SHIFT = 20; /* в vh; выраженный параллакс для всех трёх карточек */

  function initProjectsParallax() {
    var grid = document.querySelector('.projects__grid');
    if (!grid) return;

    gsap.matchMedia().add('(min-width: 1200px)', function () {
      var cards = gsap.utils.toArray('.projects__grid .project-card');
      if (!cards.length) return;

      var half = PROJECT_SHIFT / 2;
      var from = cards.map(function (card, i) {
        return i % 2 === 1
          ? gsap.utils.random(0, half)
          : gsap.utils.random(half, PROJECT_SHIFT);
      });
      var to = from.map(function (value, i) {
        var shift = gsap.utils.random(PROJECT_SHIFT / 3, PROJECT_SHIFT / 2);
        return i % 2 === 1
          ? Math.min(value + shift, PROJECT_SHIFT)
          : Math.max(value - shift, 0);
      });

      gsap.set(cards, { y: function (i) { return from[i] + 'vh'; } });
      gsap.to(cards, {
        y: function (i) { return to[i] + 'vh'; },
        scrollTrigger: {
          trigger: grid,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true
        }
      });

      return function () { gsap.set(cards, { clearProps: 'all' }); };
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

      /* Сначала явно выставляем стабильный старт. Это предотвращает
         immediateRender-скачок, характерный для gsap.from + scrub. */
      gsap.set(cards, {
        x: function (i) { return offsets[i].x; },
        y: function (i) { return offsets[i].y; },
        rotation: function (i) { return offsets[i].rotation; },
        transformOrigin: 'center center',
        force3D: true
      });

      var tween = gsap.to(cards, {
        x: 0,
        y: 0,
        rotation: 0,
        immediateRender: false,
        force3D: true,
        stagger: {
          each: 0.1,
          ease: 'power2.out'
        },
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: isDesktop ? 'bottom 50%' : 'bottom 120%',
          scrub: 0.45,
          invalidateOnRefresh: true
        }
      });
      list.classList.add('is-services-anim-ready');

      return function () {
        tween.kill();
        gsap.set(cards, { clearProps: 'transform' });
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

    gsap.from(logo, {
      scale: 0.85,
      opacity: 0,
      transformOrigin: 'center bottom',
      ease: 'none',
      scrollTrigger: {
        trigger: logo,
        start: 'top bottom',
        endTrigger: footer,
        end: 'bottom bottom',
        scrub: true
      }
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
    }

    fontsReady.then(refreshAnimations);
    window.addEventListener('load', refreshAnimations);
    window.addEventListener('pageshow', function () {
      /* Два кадра дают браузеру завершить восстановление scroll-позиции. */
      requestAnimationFrame(function () {
        requestAnimationFrame(refreshAnimations);
      });
    });
  }

  /* Строим таймлайны и триггеры сразу под лоадером. run() выше удерживает
     только playback hero до сигнала закрытия; остальные секции остаются
     ленивыми и собираются при входе в область видимости. */
  var booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    boot();
  }

  bootOnce();
})();
