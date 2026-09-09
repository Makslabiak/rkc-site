"""Сколько работы во время прокрутки достаётся видеокарте и компоновщику.

frame-check.py считает просевшие кадры главного потока, а полноэкранный
WebGL-слой стоит не там: он стоит на GPU-задачах и композитинге, которых
headless почти не показывает счётчиком кадров. Здесь берётся трейс с
категориями gpu/viz/cc и печатается время и количество задач по каждому
интересному событию.

    python3 tools/gpu-trace.py http://localhost:4173/index.html --label база
    python3 tools/gpu-trace.py ... --block "*services-dither.js*" --label "без дизера"
"""
import argparse
import collections
import json
import subprocess
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9379

CATEGORIES = ('disabled-by-default-devtools.timeline,devtools.timeline,'
              'disabled-by-default-devtools.timeline.frame,gpu,viz,cc,benchmark')

INTERESTING = {
    'GPUTask': 'задача GPU',
    'RasterTask': 'растеризация',
    'CompositeLayers': 'композитинг',
    'Commit': 'коммит кадра',
    'DrawFrame': 'кадр компоновщика',
    'Layout': 'раскладка',
    'UpdateLayoutTree': 'пересчёт стилей',
    'Paint': 'отрисовка',
    'PrePaint': 'подготовка отрисовки',
    'FunctionCall': 'JS-вызовы',
    'Decode Image': 'декод картинки',
    'ImageDecodeTask': 'декод картинки (задача)',
    'WebGL': 'команды WebGL',
    'Graphics.Pipeline': 'конвейер графики',
    'TextureLayer::PushPropertiesTo': 'слой canvas в компоновщик',
}


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


def collect_trace(ws):
    events = []
    ws.send(json.dumps({'id': 9999, 'method': 'Tracing.end', 'params': {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('method') == 'Tracing.dataCollected':
            events.extend(message['params']['value'])
        elif message.get('method') == 'Tracing.tracingComplete':
            return events


def run(url, label, seconds, block, window, scale, before, idle):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        f'--window-size={window}', f'--force-device-scale-factor={scale}',
        '--hide-scrollbars', '--mute-audio', '--no-first-run', '--remote-allow-origins=*',
        f'--user-data-dir=/tmp/chrome-gpu-trace-{time.time_ns()}', 'about:blank',
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
        if before:
            cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {'source': before})
        cdp(ws, 'Page.navigate', {'url': url})
        time.sleep(8)
        if idle:
            # Доезжаем до секции с фотографиями и стоим на месте.
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
        scrolled = evaluate(ws, 'Math.round(window.scrollY)')
        events = collect_trace(ws)
        ws.close()
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)

    totals = collections.Counter()
    counts = collections.Counter()
    for event in events:
        name = event.get('name')
        if name in INTERESTING and event.get('ph') == 'X':
            totals[name] += event.get('dur', 0) / 1000.0
            counts[name] += 1

    print(f'== {label} == прокручено {scrolled} px, событий {len(events)}')
    print(f'{"событие":26} {"всего":>9}  {"штук":>6}  {"среднее":>9}')
    for name, ms in totals.most_common():
        print(f'{INTERESTING[name]:26} {ms:8.1f} мс {counts[name]:6}  {ms / counts[name]:8.3f} мс')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('--label', default='замер')
    parser.add_argument('--seconds', type=float, default=14)
    parser.add_argument('--block', default='')
    parser.add_argument('--window', default='1680,928')
    parser.add_argument('--scale', default='2')
    parser.add_argument('--before', default='', help='JS до скриптов страницы')
    parser.add_argument('--idle', action='store_true',
                        help='стоять на секции с фото вместо прокрутки')
    args = parser.parse_args()
    run(args.url, args.label, args.seconds, args.block, args.window, args.scale,
        args.before, args.idle)
