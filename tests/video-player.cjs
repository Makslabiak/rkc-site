/* Проверка плеера в реальном браузере.
   Запуск (нужен tools/serve.py на 4173 — статика без Range ломает перемотку):
     python3 tools/serve.py &
     PLAYWRIGHT_PATH=/path/to/node_modules/playwright node tests/video-player.cjs */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:4173';

const ready = (page) => page.waitForFunction(() => {
  const v = document.querySelector('.video-frame video');
  return v && v.readyState >= 1 && v.duration > 0 && v.seekable.length > 0;
});

/* Доля вдоль дорожки ползунка → клик мышью в этой точке. */
async function scrubTo(page, ratio, { drag = false } = {}) {
  const track = page.locator('.video-slider--progress .video-slider__track');
  const box = await track.boundingBox();
  const y = box.y + box.height / 2;
  if (!drag) {
    await page.mouse.click(box.x + box.width * ratio, y);
    return;
  }
  await page.mouse.move(box.x + box.width * 0.05, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (ratio / 2), y, { steps: 6 });
  await page.mouse.move(box.x + box.width * ratio, y, { steps: 6 });
  await page.mouse.up();
}

const settled = (page, low, high) => page.waitForFunction(([a, b]) => {
  const v = document.querySelector('.video-frame video');
  return !v.seeking && v.currentTime > v.duration * a && v.currentTime < v.duration * b;
}, [low, high]);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [375, 768, 1440]) {
      for (const path of ['/', '/news-detail.html']) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const warnings = [];
        page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('RKSVideoPlayer')) warnings.push(m.text()); });
        await page.goto(BASE + path);
        await page.locator('.video-frame.is-enhanced').waitFor();
        await page.locator('.video-frame').scrollIntoViewIfNeeded();
        await ready(page);

        // Разметка: видео и управление живут в сцене, обложка — в .image-tone.
        const layout = await page.evaluate(() => {
          const frame = document.querySelector('.video-frame');
          const stage = frame.querySelector('.video-frame__stage');
          const media = frame.querySelector('.video-frame__media');
          const controls = frame.querySelector('.video-controls');
          const s = stage.getBoundingClientRect();
          const m = media.getBoundingClientRect();
          const c = controls.getBoundingClientRect();
          return {
            videoInStage: frame.querySelector('video').parentElement === stage,
            playInStage: frame.querySelector('.play-button').parentElement === stage,
            coverStillInTone: !!media.querySelector(':scope > img:last-of-type'),
            stageZ: getComputedStyle(stage).zIndex,
            drift: [s.left - m.left, s.top - m.top, s.right - m.right, s.bottom - m.bottom],
            controlsDrift: [c.left - s.left, c.right - s.right, c.bottom - s.bottom]
          };
        });
        assert(layout.videoInStage && layout.playInStage, 'Видео и кнопка play — в сцене');
        assert(layout.coverStillInTone, 'Обложка остаётся в .image-tone для дизера');
        // Сцена должна быть выше общего WebGL-дизера (position: fixed; z-index: 2).
        assert.equal(layout.stageZ, '3', `z-index сцены: ${layout.stageZ}`);
        assert(layout.drift.every((d) => Math.abs(d) < 1), `Сцена ≠ обложка: ${layout.drift}`);
        assert(layout.controlsDrift.every((d) => Math.abs(d) < 1), `Панель ≠ сцена: ${layout.controlsDrift}`);

        // Кнопка play видна и кликабельна ДО старта — она не должна уходить под дизер.
        const hit = await page.evaluate(() => {
          const b = document.querySelector('.play-button');
          const r = b.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!el && b.contains(el);
        });
        assert(hit, 'Кнопка play перекрыта другим слоем');

        await page.locator('.play-button').click();
        await page.waitForFunction(() => {
          const v = document.querySelector('.video-frame video');
          return !v.paused && v.currentTime > 0.2;
        });
        await page.locator('.video-control--toggle').click();
        assert(await page.locator('.video-frame video').evaluate((v) => v.paused));

        // Перемотка: клик, перетаскивание, клавиатура — и на паузе, и на ходу.
        await scrubTo(page, 0.5);
        await settled(page, 0.45, 0.55);
        assert(await page.locator('.video-frame video').evaluate((v) => v.paused), 'Пауза сохраняется');

        await scrubTo(page, 0.8, { drag: true });
        await settled(page, 0.74, 0.86);

        await page.locator('.video-slider--progress').focus();
        const before = await page.locator('.video-frame video').evaluate((v) => v.currentTime);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction((t) => document.querySelector('.video-frame video').currentTime < t - 3, before);

        await page.locator('.video-frame__stage').focus();
        await page.keyboard.press('3');
        await settled(page, 0.25, 0.36);

        await page.locator('.play-button').click();
        await page.waitForFunction(() => !document.querySelector('.video-frame video').paused);
        await scrubTo(page, 0.6);
        await settled(page, 0.55, 0.68);
        assert(await page.locator('.video-frame video').evaluate((v) => !v.paused), 'Перемотка не роняет playback');

        // Скорость и звук.
        await page.locator('.video-control--rate').click();
        await page.locator('[data-video-rate-value="1.5"]').click();
        assert.equal(await page.locator('.video-frame video').evaluate((v) => v.playbackRate), 1.5);
        assert(await page.locator('.video-menu').isHidden(), 'Меню закрывается после выбора');

        await page.locator('.video-control--mute').click();
        assert(await page.locator('.video-frame video').evaluate((v) => v.muted));
        await page.locator('.video-control--mute').click();
        assert(await page.locator('.video-frame video').evaluate((v) => !v.muted && v.volume > 0), 'Звук возвращается');

        // Полный экран: в top layer уходит сцена, бегущей строки там нет.
        await page.locator('.video-control--fullscreen').click();
        await page.waitForFunction(() => document.fullscreenElement?.matches('.video-frame__stage'));
        const fs = await page.evaluate(() => {
          const el = document.fullscreenElement;
          const r = el.getBoundingClientRect();
          const bar = getComputedStyle(el.querySelector('.video-controls'));
          return {
            tickers: el.querySelectorAll('.video-frame__ticker').length,
            covers: [r.width - innerWidth, r.height - innerHeight],
            // Хвост градиента должен быть непрозрачно чёрным, иначе на полосе
            // letterbox виден стык «чёрная заливка под градиентом».
            gradientTail: bar.backgroundImage.includes('rgb(0, 0, 0) 100%'),
            stageBg: getComputedStyle(el).backgroundColor
          };
        });
        assert.equal(fs.tickers, 0, 'Бегущая строка не должна попадать в полный экран');
        assert(fs.covers.every((d) => Math.abs(d) < 2), `Сцена не во весь экран: ${fs.covers}`);
        assert(fs.gradientTail, 'Градиент панели должен доходить до чёрного');
        assert.equal(fs.stageBg, 'rgb(0, 0, 0)');
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => !document.fullscreenElement);

        // Сервер поддерживает Range, значит диагностика «перемотка недоступна»
        // не должна срабатывать: ползунок активен, предупреждений нет.
        assert.equal(await page.locator('.video-slider--progress').getAttribute('aria-disabled'), 'false');
        assert(await page.locator('.video-status').isHidden()
          || !(await page.locator('.video-status').evaluate((el) => el.classList.contains('is-error'))),
        'На Range-сервере не должно быть ошибок перемотки');
        assert.deepEqual(warnings, [], `Предупреждения плеера: ${warnings}`);

        await page.screenshot({ path: `/tmp/player-${width}-${path === '/' ? 'home' : 'news'}.png` });
        assert.deepEqual(errors, []);
        console.log(`PASS ${path} ${width}px: слои, play, пауза, клик/драг/клавиатура, скорость, звук, полный экран`);
        await page.close();
      }
    }

    // Автоскрытие, конец ролика и ошибка загрузки.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + '/news-detail.html');
    await page.locator('.video-frame.is-enhanced').waitFor();
    await ready(page);
    await page.locator('.play-button').click();
    await page.waitForFunction(() => document.querySelector('.video-frame video').currentTime > 0.1);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.querySelector('.video-frame').classList.contains('is-controls-hidden'));
    await page.locator('.video-frame__stage').hover();
    await page.waitForFunction(() => !document.querySelector('.video-frame').classList.contains('is-controls-hidden'));

    await page.locator('.video-frame video').evaluate((v) => { v.currentTime = v.duration - 0.2; });
    await page.waitForFunction(() => document.querySelector('.video-frame video').ended);
    assert(await page.locator('.play-button').isVisible(), 'После конца возвращается большая кнопка');
    assert(await page.locator('.video-controls').isVisible());
    assert(await page.locator('.video-control__icon--replay').isVisible(), 'Иконка «заново»');
    await page.locator('.play-button').click();
    await page.waitForFunction(() => {
      const v = document.querySelector('.video-frame video');
      return !v.paused && v.currentTime < 5;
    });

    await page.locator('.video-frame video').evaluate((v) => { v.src = '/missing-video-test.mp4'; v.load(); });
    await page.waitForFunction(() => document.querySelector('.video-frame video').error);
    assert(await page.locator('.video-status.is-visible').isVisible(), 'Сообщение об ошибке');
    console.log('PASS автоскрытие, конец ролика и повтор, ошибка загрузки');
    await page.close();

    // Без JavaScript остаются нативные контролы браузера.
    const plain = await browser.newPage({ javaScriptEnabled: false });
    await plain.goto(BASE + '/');
    assert(await plain.locator('.video-frame video').evaluate(
      (v) => v.controls && getComputedStyle(v).opacity === '1' && getComputedStyle(v).visibility === 'visible'
    ), 'Без JS видео управляемо');
    console.log('PASS нативные контролы без JavaScript');
    await plain.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
