"""Какие именно события трейса появляются из-за слоя дизера.

Снимает полный трейс двух вариантов подряд — со слоем и с погашенным через
display:none — и печатает разницу по именам событий: что и насколько чаще
происходит, когда canvas отдаётся компоновщику.

    python3 tools/trace-diff.py http://localhost:4173/index.html
    python3 tools/trace-diff.py http://localhost:4173/index.html --idle
"""
import argparse
import collections
import json
import subprocess
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9380
CATEGORIES = ('disabled-by-default-devtools.timeline,devtools.timeline,'
              'disabled-by-default-devtools.timeline.frame,gpu,viz,cc,benchmark,'
              'disabled-by-default-gpu.service')


def cdp(ws, method, params=None, _id=[0]):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == _id[0]:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def collect_trace(ws):
    events = []
    ws.send(json.dumps({'id': 9999, 'method': 'Tracing.end', 'params': {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('method') == 'Tracing.dataCollected':
            events.extend(message['params']['value'])
        elif message.get('method') == 'Tracing.tracingComplete':
            return events


def run(url, seconds, before, idle):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        '--window-size=1680,928', '--force-device-scale-factor=2',
        '--hide-scrollbars', '--mute-audio', '--no-first-run', '--remote-allow-origins=*',
        f'--user-data-dir=/tmp/chrome-trace-diff-{time.time_ns()}', 'about:blank',
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
        if before:
            cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {'source': before})
        cdp(ws, 'Page.navigate', {'url': url})
        time.sleep(8)
        if idle:
            # Доезжаем до секции с фотографиями и стоим.
            for _ in range(28):
                cdp(ws, 'Input.dispatchMouseEvent', {
                    'type': 'mouseWheel', 'x': 700, 'y': 400, 'deltaX': 0, 'deltaY': 100})
                time.sleep(0.05)
            time.sleep(1.5)
            cdp(ws, 'Tracing.start', {'categories': CATEGORIES, 'transferMode': 'ReportEvents'})
            time.sleep(seconds)
        else:
            cdp(ws, 'Tracing.start', {'categories': CATEGORIES, 'transferMode': 'ReportEvents'})
            for _ in range(int(seconds * 20)):
                cdp(ws, 'Input.dispatchMouseEvent', {
                    'type': 'mouseWheel', 'x': 700, 'y': 400, 'deltaX': 0, 'deltaY': 100})
                time.sleep(0.05)
        events = collect_trace(ws)
        ws.close()
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)
    return events


def summarize(events):
    counts = collections.Counter()
    times = collections.Counter()
    for event in events:
        if event.get('ph') != 'X':
            continue
        name = event.get('name')
        counts[name] += 1
        times[name] += event.get('dur', 0) / 1000.0
    return counts, times


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--idle', action='store_true', help='стоять на месте вместо прокрутки')
    args = parser.parse_args()

    hide = ('document.addEventListener("DOMContentLoaded",function(){'
            'var s=document.createElement("style");'
            's.textContent=".site-dither-canvas{display:none!important}";'
            'document.head.appendChild(s);});')

    with_layer = summarize(run(args.url, args.seconds, '', args.idle))
    without = summarize(run(args.url, args.seconds, hide, args.idle))

    print(f'{"событие":42} {"со слоем":>9} {"без слоя":>9} {"разница":>9} {"мс со":>8} {"мс без":>8}')
    names = set(with_layer[0]) | set(without[0])
    rows = sorted(names, key=lambda n: -(with_layer[0][n] - without[0][n]))
    for name in rows[:25]:
        a, b = with_layer[0][name], without[0][name]
        if a - b < 20:
            continue
        print(f'{name[:42]:42} {a:>9} {b:>9} {a - b:>+9} '
              f'{with_layer[1][name]:>8.1f} {without[1][name]:>8.1f}')
