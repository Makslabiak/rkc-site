"""Сколько РАБОТЫ делает движок при прокрутке страницы.

Зачем нужен отдельно от frame-check.py. Счётчик просевших кадров меряет не
только сайт, но и загрузку машины: на занятом MacBook один и тот же код
давал то 0, то 147 просадок, и разница между вариантами правки тонула в
разбросе. Трейс движка от этого почти не зависит: суммарное время шумит,
но КОЛИЧЕСТВО задач растеризации, отрисовки и пересчёта стилей остаётся тем
же. Поэтому варианты правки сравнивать надёжнее по нему, а frame-check
оставить для итоговой проверки на спокойной машине.

Так нашлось, что лид «О компании» разбивался на 189 анимируемых символов:
4393 задачи растеризации против 1615 у построчного варианта.

Нужен пакет websocket-client (см. tools/frame-check.py).

    python3 tools/serve.py &
    python3 tools/work-trace.py http://localhost:4173/about.html
    python3 tools/work-trace.py http://localhost:4173/about.html 12
    python3 tools/work-trace.py http://localhost:4173/news-detail.html 0 entry

Третий аргумент `entry` меряет входную анимацию вместо прокрутки: трейс
пишется с самой навигации и восемь секунд, без колеса.

ВАЖНО: сравнивать варианты только прогонами вплотную друг к другу и в обоих
порядках — иначе разница в загрузке машины между прогонами выдаст себя за
разницу в коде.
"""
import collections
import json
import subprocess
import sys
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9381

INTERESTING = {
    'UpdateLayoutTree': 'пересчёт стилей',
    'Layout': 'раскладка',
    'Paint': 'отрисовка',
    'RasterTask': 'растеризация',
    'CompositeLayers': 'композитинг',
    'UpdateLayer': 'слои',
    'PrePaint': 'подготовка отрисовки',
    'Commit': 'коммит кадра',
    'FunctionCall': 'JS-вызовы',
    'TimerFire': 'таймеры',
}

TRACE_CATEGORIES = 'disabled-by-default-devtools.timeline,devtools.timeline'


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
    """Tracing.end отвечает не результатом, а потоком событий."""
    events = []
    ws.send(json.dumps({'id': 9999, 'method': 'Tracing.end', 'params': {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('method') == 'Tracing.dataCollected':
            events.extend(message['params']['value'])
        elif message.get('method') == 'Tracing.tracingComplete':
            return events


def report(events, scrolled):
    totals = collections.Counter()
    counts = collections.Counter()
    for event in events:
        name = event.get('name')
        if name in INTERESTING and event.get('ph') == 'X':
            totals[name] += event.get('dur', 0) / 1000.0
            counts[name] += 1

    print(f'прокручено {scrolled} px, событий в трейсе {len(events)}')
    print(f'{"событие":22} {"всего":>9}  {"штук":>6}  {"среднее":>8}')
    grand = 0
    for name, ms in totals.most_common():
        grand += ms
        print(f'{INTERESTING[name]:22} {ms:8.1f} мс {counts[name]:6}  {ms / counts[name]:7.2f} мс')
    print(f'{"ИТОГО работы":22} {grand:8.1f} мс')


def run(url, seconds, entry):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        '--window-size=1440,900', '--force-device-scale-factor=2',
        '--hide-scrollbars', '--mute-audio', '--no-first-run', '--remote-allow-origins=*',
        # Профиль свежий на каждый прогон — как во frame-check.py.
        f'--user-data-dir=/tmp/chrome-work-trace-{time.time_ns()}', 'about:blank',
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

        if entry:
            cdp(ws, 'Tracing.start', {'categories': TRACE_CATEGORIES,
                                      'transferMode': 'ReportEvents'})
            cdp(ws, 'Page.navigate', {'url': url})
            # Лоадер держит экран 2 с, потом полторы секунды въезжает первый экран.
            time.sleep(8)
            events, scrolled = collect_trace(ws), 0
        else:
            cdp(ws, 'Page.navigate', {'url': url})
            time.sleep(8)
            cdp(ws, 'Tracing.start', {'categories': TRACE_CATEGORIES,
                                      'transferMode': 'ReportEvents'})
            # Колесо, а не scrollTo: программная прокрутка воюет с Lenis.
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

    report(events, scrolled)


if __name__ == '__main__':
    run(sys.argv[1],
        float(sys.argv[2]) if len(sys.argv) > 2 else 12,
        len(sys.argv) > 3 and sys.argv[3] == 'entry')
