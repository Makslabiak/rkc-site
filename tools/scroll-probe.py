"""Где именно на странице просаживается кадр и что в этот момент делает дизер.

Отличие от frame-check.py: кадры раскладываются по участкам прокрутки, и рядом
с каждым участком видно, сколько за него было вызовов drawArrays, clear и
getBoundingClientRect. Так видно не «сколько всего просадок», а «на каком
блоке» и «под какую работу».

    python3 tools/scroll-probe.py http://localhost:4173/index.html --label база
    python3 tools/scroll-probe.py ... --block "*services-dither.js*" --label "без дизера"
"""
import argparse
import json
import subprocess
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9377

RECORDER = r"""
window.__probe = { frames: [], gl: {draw: 0, clear: 0, tex: 0}, rect: 0, long: [] };
(function () {
  var p = window.__probe;
  var origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { p.rect += 1; return origRect.call(this); };

  function wrapGL(proto) {
    if (!proto) return;
    var d = proto.drawArrays, c = proto.clear, t = proto.texImage2D, s = proto.texSubImage2D;
    proto.drawArrays = function () { p.gl.draw += 1; return d.apply(this, arguments); };
    proto.clear = function () { p.gl.clear += 1; return c.apply(this, arguments); };
    proto.texImage2D = function () { p.gl.tex += 1; return t.apply(this, arguments); };
    if (s) proto.texSubImage2D = function () { p.gl.tex += 1; return s.apply(this, arguments); };
  }
  wrapGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  wrapGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  var last = performance.now();
  var prev = { draw: 0, clear: 0, tex: 0, rect: 0 };
  function tick(now) {
    var d = Math.round((now - last) * 10) / 10;
    last = now;
    p.frames.push([
      Math.round(now), d, Math.round(window.scrollY),
      p.gl.draw - prev.draw, p.gl.clear - prev.clear, p.gl.tex - prev.tex, p.rect - prev.rect
    ]);
    prev = { draw: p.gl.draw, clear: p.gl.clear, tex: p.gl.tex, rect: p.rect };
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        p.long.push([Math.round(e.startTime), Math.round(e.duration)]);
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


def run(url, label, seconds, block, window, scale, bucket, slow_ms):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        f'--window-size={window}', f'--force-device-scale-factor={scale}',
        '--hide-scrollbars', '--mute-audio', '--no-first-run', '--remote-allow-origins=*',
        f'--user-data-dir=/tmp/chrome-scroll-probe-{time.time_ns()}', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json'))
                page = next(t for t in targets if t['type'] == 'page')
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError('Chrome не поднялся')

        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=300)
        cdp(ws, 'Page.enable')
        cdp(ws, 'Runtime.enable')
        if block:
            cdp(ws, 'Network.enable')
            cdp(ws, 'Network.setBlockedURLs', {'urls': block.split(',')})
        cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {'source': RECORDER})
        cdp(ws, 'Page.navigate', {'url': url})
        time.sleep(8)

        start = len(evaluate(ws, 'window.__probe.frames') or [])
        for _ in range(int(seconds * 20)):
            cdp(ws, 'Input.dispatchMouseEvent', {
                'type': 'mouseWheel', 'x': 700, 'y': 400, 'deltaX': 0, 'deltaY': 100})
            time.sleep(0.05)

        frames = evaluate(ws, 'window.__probe.frames.slice(0)') or []
        longs = evaluate(ws, 'window.__probe.long.slice(0)') or []
        height = evaluate(ws, 'document.documentElement.scrollHeight') or 0
        ws.close()
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)

    frames = frames[start:]
    if not frames:
        print(f'{label}: кадров нет')
        return

    buckets = {}
    for _, delta, y, draw, clear, tex, rect in frames:
        key = int(y // bucket) * bucket
        b = buckets.setdefault(key, {'n': 0, 'slow': 0, 'worst': 0,
                                     'draw': 0, 'clear': 0, 'tex': 0, 'rect': 0, 'time': 0.0})
        b['n'] += 1
        b['time'] += delta
        if delta > slow_ms:
            b['slow'] += 1
        b['worst'] = max(b['worst'], delta)
        b['draw'] += draw
        b['clear'] += clear
        b['tex'] += tex
        b['rect'] += rect

    total = len(frames)
    slow = sum(b['slow'] for b in buckets.values())
    print(f'== {label} == страница {height} px, кадров {total}, '
          f'дольше {slow_ms} мс: {slow} ({slow / total * 100:.1f}%)')
    print(f'{"scrollY":>9} {"кадров":>7} {"мед.мс":>7} {"просад":>7} {"худший":>7} '
          f'{"draw/к":>7} {"clear/к":>8} {"tex":>4} {"rect/к":>7}')
    for key in sorted(buckets):
        b = buckets[key]
        n = b['n']
        print(f'{key:>9} {n:>7} {b["time"] / n:>7.1f} {b["slow"]:>7} {b["worst"]:>7.1f} '
              f'{b["draw"] / n:>7.2f} {b["clear"] / n:>8.2f} {b["tex"]:>4} {b["rect"] / n:>7.2f}')
    if frames:
        first = frames[0][0]
        last = frames[-1][0]
        during = [(t, d) for t, d in longs if first <= t <= last]
        print(f'\nдлинные задачи ВО ВРЕМЯ прокрутки: {len(during)}')
        for stamp, dur in sorted(during, key=lambda x: -x[1])[:8]:
            near = [y for t, _, y, *_ in frames if abs(t - stamp) < 60]
            place = f'scrollY≈{near[0]}' if near else 'вне выборки'
            print(f'  {dur:4} мс  {place}')
        before = [d for t, d in longs if t < first]
        if before:
            print(f'до прокрутки (загрузка и входная анимация): {len(before)} задач, '
                  f'самая длинная {max(before)} мс')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('--label', default='замер')
    parser.add_argument('--seconds', type=float, default=18)
    parser.add_argument('--block', default='')
    parser.add_argument('--window', default='1680,928')
    parser.add_argument('--scale', default='2')
    parser.add_argument('--bucket', type=int, default=1000)
    parser.add_argument('--slow', type=float, default=20)
    args = parser.parse_args()
    run(args.url, args.label, args.seconds, args.block, args.window,
        args.scale, args.bucket, args.slow)
