"""Проверка страниц на живучесть текста: что сломается, если текст правят.

Каждый текстовый блок по очереди удлиняется примерно на треть, и headless-Chrome
замеряет последствия: текст вылез за колонку, обрезан родителем, наехал на
соседа, а декоративная линия не отступила. Замер делает tools/text-stress.html.

    python3 tools/text-stress.py                       # все страницы, все ширины
    python3 tools/text-stress.py --page index.html --width 1440
    python3 tools/text-stress.py --grow .6             # правка длиннее

Сам сайт не меняется: разметка каждому блоку возвращается на место.
"""
import argparse
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
WIDTHS = [1920, 1440, 1024, 768, 375]
HEIGHTS = {1920: 1080, 1440: 900, 1024: 800, 768: 900, 375: 812}
PAGES = [
    'index.html', 'about.html', 'services.html', 'projects.html',
    'project-detail.html', 'news.html', 'news-detail.html',
    'documents.html', 'contacts.html', 'policies.html', '404.html',
]


def log(message):
    print(message, flush=True)


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(('127.0.0.1', port)) == 0


class Handler(SimpleHTTPRequestHandler):
    """Раздаёт проект и принимает результат прогона POST'ом на /stress-result."""

    results = None

    def do_POST(self):
        if self.path != '/stress-result':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length') or 0)
        payload = self.rfile.read(length)
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()
        try:
            Handler.results.append(json.loads(payload))
        except json.JSONDecodeError as error:
            Handler.results.append({'error': f'битый JSON: {error}'})

    def log_message(self, *args):
        pass


class Server:
    """Свой сервер, а не tools/serve.py: нужен приём результата."""

    def __init__(self, port):
        self.port = port
        self.results = []
        Handler.results = self.results
        self.httpd = ThreadingHTTPServer(
            ('127.0.0.1', port), partial(Handler, directory=str(ROOT))
        )
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def capture(server, page, width, height, grow, timeout, only=None):
    """Один прогон в реальном времени: Chrome сам присылает результат POST'ом."""
    url = (f'http://127.0.0.1:{server.port}/tools/text-stress.html'
           f'?page={page}&w={width}&h={height}&grow={grow}')
    if only:
        url += f'&only={only}'
    seen = len(server.results)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--disable-gpu-sandbox',
            '--use-gl=angle', '--enable-unsafe-swiftshader', '--hide-scrollbars',
            '--force-device-scale-factor=1',
            f'--window-size={width + 40},{height + 120}',
            f'--user-data-dir={work}/profile',
            url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + timeout
        try:
            while time.time() < deadline and len(server.results) == seen:
                if process.poll() is not None:
                    break
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
    if len(server.results) == seen:
        raise RuntimeError(f'пробник не отдал данные: {url}')
    data = server.results[-1]
    if 'error' in data:
        raise RuntimeError(f'{url}: {data["error"]}')
    return data


def render(data, verbose=False):
    """Печать находок одной страницы на одной ширине; True — если чисто."""
    head = f"{data['page']} @ {data['width']}"
    for item in data.get('trace', []):
        log(f'  {head}: {item["step"]} слов={item.get("words")} высота={item["height"]} '
            f'низ={item["bottom"]} ' + '; '.join(item['gaps']))
        if item.get('vars'):
            log(f'      {item["vars"]}')
    if verbose:
        log(f'  {head}: блоки — ' + ', '.join(data.get('checked', [])))
        log(f'  {head}: линии — ' + ', '.join(data.get('ruleList', [])))
    if data.get('rafAlive', 0) < 5:
        log(f'  {head}: ВНИМАНИЕ — кадров за прогон {data.get("rafAlive")}, '
            'страница почти не отрисовывалась: находкам про отступы линий верить нельзя')
    if not data['findings']:
        log(f'  {head}: чисто ({data["texts"]} блоков, {data["rules"]} линий)')
        return True
    log(f'  {head}: {len(data["findings"])} из {data["texts"]} блоков')
    for item in data['findings']:
        log(f'    {item["el"]} [{item["position"]}] «{item["text"]}…»')
        for problem in item['problems']:
            parts = [problem['kind']]
            if 'by' in problem:
                parts.append(f'на {problem["by"]}px')
            if 'who' in problem:
                parts.append(f'→ {problem["who"]}')
            if 'gap' in problem:
                parts.append(f'отступ {problem["gap"]}→{problem["after"]}px ({problem["side"]})')
            log('      ' + ' '.join(parts))
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--page', action='append', help='страница (можно несколько)')
    parser.add_argument('--width', action='append', type=int, help='ширина окна')
    parser.add_argument('--grow', default='0.35', help='на какую долю удлинять текст')
    parser.add_argument('--port', type=int, default=8123)
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--verbose', action='store_true', help='перечислить блоки и линии')
    parser.add_argument('--only', help='проверять только блоки, чей класс содержит строку')
    args = parser.parse_args()

    pages = args.page or PAGES
    widths = args.width or WIDTHS
    server = Server(args.port)
    clean = True
    try:
        for page in pages:
            log(f'\n=== {page}')
            for width in widths:
                height = HEIGHTS.get(width, 900)
                try:
                    data = capture(server, page, width, height, args.grow, args.timeout, args.only)
                except Exception as error:  # noqa: BLE001 — печатаем и идём дальше
                    clean = False
                    log(f'  {page} @ {width}: ОШИБКА {error}')
                    continue
                clean = render(data, args.verbose) and clean
    finally:
        server.stop()
    log('\nЧисто.' if clean else '\nЕсть находки.')
    return 0 if clean else 1


if __name__ == '__main__':
    raise SystemExit(main())
