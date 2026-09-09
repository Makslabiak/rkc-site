"""Замер плавности: сколько кадров просаживается при прокрутке страницы.

Headless-Chrome в реальном времени (не virtual-time: под ним rAF идёт как
попало и цифры бессмысленны), прокрутка настоящим колесом мыши через CDP.
Колесо, а не window.scrollTo — программная прокрутка воюет с Lenis и сама
создаёт рывки, из-за чего чужой сайт можно намерить хуже своего.

Нужен пакет websocket-client:

    pip3 install websocket-client

Примеры:

    python3 tools/serve.py &
    python3 tools/frame-check.py http://localhost:4173/index.html --label наша
    python3 tools/frame-check.py https://пример.рф/ --label чужая
    python3 tools/frame-check.py http://localhost:4173/index.html \\
        --block "*services-dither.js*" --label "без дизера"

ВАЖНО про методику. Разброс между прогонами сопоставим с разницей, которую
обычно ищут: на одной паре запусков можно получить обратный результат.
Гонять минимум по 4 раза вперемешку и сравнивать медианы, а не один прогон
с другим.
"""
import argparse
import json
import subprocess
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9341

# Ставится до скриптов страницы: пишем дельту каждого кадра и длинные
# JS-задачи, чтобы отличать «поток заблокирован» от «не успела отрисовка».
RECORDER = """
window.__frames = [];
window.__long = [];
(function () {
  var last = performance.now();
  function tick(now) {
    window.__frames.push([Math.round(now), Math.round((now - last) * 10) / 10]);
    last = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        window.__long.push([Math.round(e.startTime), Math.round(e.duration)]);
      });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}
})();
"""


def cdp(ws, method, params=None, _id=[0]):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == _id[0]:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def evaluate(ws, expression):
    return cdp(ws, 'Runtime.evaluate', {
        'expression': expression, 'returnByValue': True})['result'].get('value')


def run(url, label, seconds, before, block, scale, window):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        f'--window-size={window}', f'--force-device-scale-factor={scale}',
        '--hide-scrollbars', '--mute-audio', '--no-first-run',
        '--remote-allow-origins=*',
        # Профиль свежий на каждый прогон: общий копит кеш и шейдеры,
        # и прогоны перестают быть сравнимыми.
        f'--user-data-dir=/tmp/chrome-frame-check-{time.time_ns()}', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                targets = json.load(urllib.request.urlopen(
                    f'http://127.0.0.1:{PORT}/json'))
                page = next(t for t in targets if t['type'] == 'page')
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError('Chrome не поднялся')

        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=240)
        cdp(ws, 'Page.enable')
        cdp(ws, 'Runtime.enable')
        if block:
            cdp(ws, 'Network.enable')
            cdp(ws, 'Network.setBlockedURLs', {'urls': block.split(',')})
        cdp(ws, 'Page.addScriptToEvaluateOnNewDocument',
            {'source': RECORDER + (before or '')})
        cdp(ws, 'Page.navigate', {'url': url})
        # Лоадер держит экран 2 с, потом въезжает первый экран: ждём, чтобы
        # в выборку попала прокрутка, а не загрузка.
        time.sleep(8)

        height = evaluate(ws, 'document.documentElement.scrollHeight') or 0
        start = len(evaluate(ws, 'window.__frames') or [])

        # Один щелчок колеса — 100 px, шаг 50 мс: примерно так листает человек.
        for _ in range(int(seconds * 20)):
            cdp(ws, 'Input.dispatchMouseEvent', {
                'type': 'mouseWheel', 'x': 700, 'y': 400,
                'deltaX': 0, 'deltaY': 100})
            time.sleep(0.05)

        frames = evaluate(ws, 'window.__frames.slice(0)') or []
        longs = evaluate(ws, 'window.__long.slice(0)') or []
        scrolled = evaluate(ws, 'window.scrollY') or 0
        ws.close()
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)

    deltas = sorted(d for _, d in frames[start:] if d > 0)
    if not deltas:
        print(f'{label}: кадров нет')
        return
    n = len(deltas)
    slow = sum(1 for d in deltas if d > 20)
    print(f'{label:24} страница {height} px, прокручено {scrolled} px')
    print(f'{label:24} медиана {deltas[n // 2]:5.1f}  p95 {deltas[int(n * 0.95)]:6.1f}  '
          f'худший {deltas[-1]:6.1f}  дольше 20 мс: {slow:4}/{n} ({slow / n * 100:.1f}%)')
    big = sorted(longs, key=lambda x: -x[1])[:3]
    if big:
        print(f'{label:24} самые длинные JS-задачи: '
              + ', '.join(f'{d} мс' for _, d in big))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('url')
    parser.add_argument('--label', default='замер')
    parser.add_argument('--seconds', type=float, default=18)
    parser.add_argument('--before', default='', help='JS до скриптов страницы')
    parser.add_argument('--block', default='', help='маски URL через запятую')
    parser.add_argument('--scale', default='2', help='device scale factor')
    parser.add_argument('--window', default='1440,900',
                        help='размер окна; у владельца 1680,928 — дизер там на 43%% больше')
    args = parser.parse_args()
    run(args.url, args.label, args.seconds, args.before, args.block, args.scale,
        args.window)
