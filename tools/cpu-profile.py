"""Профиль процессора: кто съедает время при загрузке или прокрутке.

Показывает собственное время функций, отсортированное по убыванию. Именно
так нашлось, что texImage2D занимал 20% времени прокрутки — из-за ленивых
картинок, долетавших ровно в момент появления секции.

Нужен пакет websocket-client (см. tools/frame-check.py).

    python3 tools/serve.py &
    python3 tools/cpu-profile.py http://localhost:4173/index.html --phase scroll
    python3 tools/cpu-profile.py http://localhost:4173/index.html --phase load

Читать так: `(idle)` — простой главного потока, `(program)` — работа
движка вне JS (стиль, раскладка, композитинг). Если наверху `(idle)`, а
кадры всё равно просаживаются, дело не в JS, а в отрисовке.
"""
import argparse
import collections
import json
import subprocess
import time
import urllib.request

import websocket

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9334


def cdp(ws, method, params=None, _id=[0]):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get('id') == _id[0]:
            if 'error' in message:
                raise RuntimeError(message['error'])
            return message.get('result', {})


def summarize(profile, label, top):
    nodes = {n['id']: n for n in profile['nodes']}
    self_time = collections.Counter()
    deltas = profile.get('timeDeltas') or []
    for index, node_id in enumerate(profile.get('samples') or []):
        self_time[node_id] += deltas[index] if index < len(deltas) else 0
    total = sum(self_time.values()) / 1000.0 or 1

    print(f'--- {label}: {total:.0f} мс процессорного времени ---')
    for node_id, micros in self_time.most_common(top):
        frame = nodes[node_id]['callFrame']
        ms = micros / 1000.0
        if ms < 1:
            continue
        name = frame['functionName'] or '(анонимная)'
        source = frame['url'].rsplit('/', 1)[-1] or '(движок)'
        where = f"{source}:{frame['lineNumber'] + 1}" if source != '(движок)' else source
        print(f'  {ms:7.1f} мс  {ms / total * 100:4.1f}%  {name:32} {where}')


def run(url, phase, top):
    chrome = subprocess.Popen([
        CHROME, '--headless=new', f'--remote-debugging-port={PORT}',
        '--window-size=1440,900', '--force-device-scale-factor=2',
        '--hide-scrollbars', '--mute-audio', '--no-first-run',
        '--remote-allow-origins=*',
        f'--user-data-dir=/tmp/chrome-cpu-profile-{time.time_ns()}', 'about:blank',
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
        cdp(ws, 'Profiler.enable')
        cdp(ws, 'Profiler.setSamplingInterval', {'interval': 200})

        if phase == 'load':
            cdp(ws, 'Profiler.start')
            cdp(ws, 'Page.navigate', {'url': url})
            time.sleep(8)
        else:
            cdp(ws, 'Page.navigate', {'url': url})
            time.sleep(8)
            cdp(ws, 'Profiler.start')
            for _ in range(300):
                cdp(ws, 'Input.dispatchMouseEvent', {
                    'type': 'mouseWheel', 'x': 700, 'y': 400,
                    'deltaX': 0, 'deltaY': 100})
                time.sleep(0.05)

        profile = cdp(ws, 'Profiler.stop')['profile']
        ws.close()
    finally:
        chrome.terminate()
        chrome.wait(timeout=10)
    summarize(profile, phase, top)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('url')
    parser.add_argument('--phase', default='scroll', choices=['scroll', 'load'])
    parser.add_argument('--top', type=int, default=14)
    args = parser.parse_args()
    run(args.url, args.phase, args.top)
