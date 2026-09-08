"""Попиксельная сверка раскладки: текущее дерево против снимка «до».

Два локальных сервера отдают текущий проект и его копию, headless-Chrome
открывает на каждом tools/layout-probe.html, снимает геометрию всех
классованных элементов страницы и печатает расхождения.

    python3 tools/layout-check.py baseline            # снять снимок «до»
    python3 tools/layout-check.py run --page about.html

Снимок «до» делается один раз перед правкой: дальше `run` сравнивает с ним.
"""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.parse
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = Path(os.environ.get('RKS_BASELINE', '/tmp/rks-base'))
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
WIDTHS = [1920, 1440, 820, 768, 500]
PROBE_RE = re.compile(r'<pre id="probe">(\{.*?)</pre>', re.S)
# Ширина этих элементов зависит от того, сколько успело буферизоваться видео.
IGNORE = re.compile(r'video-slider__(buffer|fill|thumb)')


class NotReady(RuntimeError):
    """Кадр снят до применения CSS или загрузки шрифтов."""
UNESCAPE = [('&quot;', '"'), ('&#39;', "'"), ('&lt;', '<'), ('&gt;', '>'), ('&amp;', '&')]


def log(message):
    print(message, flush=True)


def snapshot(dest):
    """Копия рабочего дерева без .git и мусора — эталон «до»."""
    if dest.exists():
        shutil.rmtree(dest)
    subprocess.run([
        'rsync', '-a',
        '--exclude', '.git/', '--exclude', 'node_modules/', '--exclude', '.DS_Store',
        f'{ROOT}/', f'{dest}/',
    ], check=True)
    log(f'Снимок «до»: {dest}')


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(('127.0.0.1', port)) == 0


class Server:
    """tools/serve.py поверх нужного каталога; уже поднятый порт переиспользуем."""

    def __init__(self, root, port):
        self.port = port
        self.process = None
        if port_open(port):
            return
        self.process = subprocess.Popen(
            [sys.executable, str(root / 'tools' / 'serve.py'), '--port', str(port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 10
        while time.time() < deadline and not port_open(port):
            time.sleep(0.1)
        if not port_open(port):
            raise RuntimeError(f'сервер на {port} не поднялся')

    def stop(self):
        if self.process:
            self.process.terminate()
            self.process.wait(timeout=5)


def probe_url(port, page, width, height, scroll=None, offset=0):
    url = (f'http://127.0.0.1:{port}/tools/layout-probe.html'
           f'?page={page}&w={width}&h={height}')
    if scroll:
        url += f'&scroll={urllib.parse.quote(scroll)}&offset={offset}'
    return url


def shoot(port, page, width, height, scroll, offset, out, timeout):
    """Скриншот кадра: та же страница в iframe, подкрученная к секции."""
    shot = Path(out)
    if shot.exists():
        shot.unlink()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        process = subprocess.Popen([
            str(CHROME), '--headless=new', '--disable-gpu-sandbox',
            '--use-gl=angle', '--enable-unsafe-swiftshader', '--hide-scrollbars',
            '--force-device-scale-factor=1',
            f'--window-size={width},{height}',
            f'--user-data-dir={work}/profile',
            '--virtual-time-budget=22000',
            f'--screenshot={out}',
            probe_url(port, page, width, height, scroll, offset),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Chrome и здесь не всегда выходит сам: ждём, пока размер файла замрёт.
        deadline, size = time.time() + timeout, -1
        try:
            while time.time() < deadline:
                if process.poll() is not None:
                    break
                current = shot.stat().st_size if shot.exists() else -1
                if current > 0 and current == size:
                    break
                size = current
                time.sleep(0.5)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
    return shot.exists()


def capture_once(port, page, width, height, timeout):
    """Один прогон headless-Chrome; вернуть разобранный JSON пробника."""
    url = probe_url(port, page, width, height)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        dump = Path(work) / 'dom.html'
        handle = dump.open('w')
        process = subprocess.Popen([
            str(CHROME),
            '--headless=new',
            '--disable-gpu-sandbox',
            '--use-gl=angle',
            '--enable-unsafe-swiftshader',
            '--hide-scrollbars',
            '--force-device-scale-factor=1',
            f'--window-size={width + 40},{height + 120}',
            f'--user-data-dir={work}/profile',
            '--virtual-time-budget=18000',
            '--dump-dom',
            url,
        ], stdout=handle, stderr=subprocess.DEVNULL)
        deadline = time.time() + timeout
        text = ''
        try:
            # Chrome с --dump-dom не всегда завершается сам: ждём сам маркер.
            while time.time() < deadline:
                if process.poll() is not None:
                    handle.flush()
                    text = dump.read_text(errors='replace')
                    break
                if dump.exists():
                    text = dump.read_text(errors='replace')
                    if PROBE_RE.search(text):
                        break
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            handle.close()
    match = PROBE_RE.search(text)
    if not match:
        raise RuntimeError(f'пробник не отдал данные: {url}')
    payload = match.group(1)
    for entity, char in UNESCAPE:
        payload = payload.replace(entity, char)
    data = json.loads(payload)
    if 'error' in data:
        raise RuntimeError(f'{url}: {data["error"]}')
    ready = data.get('ready') or {}
    if not (ready.get('css') and ready.get('fonts')):
        raise NotReady(f'кадр снят без {"CSS" if not ready.get("css") else "шрифтов"}')
    return data


def capture(port, page, width, height, timeout, attempts=3):
    """То же с повтором: недогруженный кадр — повод снять заново, а не сравнивать."""
    for attempt in range(1, attempts + 1):
        try:
            return capture_once(port, page, width, height, timeout)
        except NotReady:
            if attempt == attempts:
                raise
            time.sleep(1.5 * attempt)


def diff(before, after, tol, ignore):
    """Расхождения по одной ширине. offset* — основной критерий."""
    old = {item['k']: item for item in before['items'] if not ignore.search(item['k'])}
    new = {item['k']: item for item in after['items'] if not ignore.search(item['k'])}
    report = {
        'docHeight': (before['docHeight'], after['docHeight']),
        'bodyHeight': (before['bodyHeight'], after['bodyHeight']),
        'removed': [k for k in old if k not in new],
        'added': [k for k in new if k not in old],
        'moved': [],
    }
    for key, was in old.items():
        now = new.get(key)
        if not now:
            continue
        changes = []
        for field, label in (('ol', 'left'), ('ot', 'top'), ('ow', 'width'), ('oh', 'height')):
            delta = now[field] - was[field]
            if abs(delta) > tol:
                changes.append(f'{label} {was[field]}→{now[field]} ({delta:+})')
        for field, label in (('op', 'offsetParent'), ('ds', 'display'), ('ps', 'position')):
            if was[field] != now[field]:
                changes.append(f'{label} {was[field]}→{now[field]}')
        if changes:
            report['moved'].append((key, changes))
    return report


def render(page, results, limit):
    """Печать отчёта; возвращает True, если расхождений нет."""
    clean = True
    for width in sorted(results, reverse=True):
        report = results[width]
        if isinstance(report, str):
            clean = False
            log(f'\n=== {page} @ {width} — ОШИБКА: {report}')
            continue
        counts = (len(report['removed']), len(report['added']), len(report['moved']))
        doc_before, doc_after = report['docHeight']
        head = f'\n=== {page} @ {width}px — '
        if not any(counts) and doc_before == doc_after:
            log(head + 'совпадает')
            continue
        clean = False
        log(head + f'удалено {counts[0]}, добавлено {counts[1]}, сдвинуто {counts[2]}')
        if doc_before != doc_after:
            log(f'  высота документа {doc_before}→{doc_after} ({doc_after - doc_before:+})')
        for key in report['removed'][:limit]:
            log(f'  − {key}')
        for key in report['added'][:limit]:
            log(f'  + {key}')
        for key, changes in report['moved'][:limit]:
            log(f'  ~ {key}: {"; ".join(changes)}')
        rest = max(counts) - limit
        if rest > 0:
            log(f'  … ещё до {rest} строк, полный список в --json')
    return clean


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    snap = sub.add_parser('baseline', help='снять снимок «до»')
    snap.add_argument('--dest', type=Path, default=DEFAULT_BASE)

    run = sub.add_parser('run', help='сверить текущее дерево со снимком')
    run.add_argument('--page', action='append', default=[], help='можно повторять')
    run.add_argument('--widths', default=','.join(map(str, WIDTHS)))
    run.add_argument('--height', type=int, default=900)
    run.add_argument('--baseline', type=Path, default=DEFAULT_BASE)
    run.add_argument('--port', type=int, default=4183)
    run.add_argument('--base-port', type=int, default=4184)
    run.add_argument('--tol', type=float, default=1.0)
    run.add_argument('--jobs', type=int, default=3)
    run.add_argument('--timeout', type=float, default=150)
    run.add_argument('--limit', type=int, default=40, help='строк на ширину в отчёте')
    run.add_argument('--ignore', default=IGNORE.pattern, help='regexp по ключам элементов')
    run.add_argument('--json', type=Path, help='полный отчёт файлом')

    shot = sub.add_parser('shot', help='скриншоты секции «до» и «после»')
    shot.add_argument('--page', default='index.html')
    shot.add_argument('--width', type=int, default=1440)
    shot.add_argument('--height', type=int, default=900)
    shot.add_argument('--scroll', help='селектор секции, к которой подкрутить')
    shot.add_argument('--offset', type=int, default=0)
    shot.add_argument('--out', type=Path, required=True, help='каталог для PNG')
    shot.add_argument('--baseline', type=Path, default=DEFAULT_BASE)
    shot.add_argument('--port', type=int, default=4183)
    shot.add_argument('--base-port', type=int, default=4184)
    shot.add_argument('--timeout', type=float, default=150)

    args = parser.parse_args()
    if args.command == 'baseline':
        snapshot(args.dest)
        return 0

    if args.command == 'shot':
        shutil.copy(ROOT / 'tools' / 'layout-probe.html',
                    args.baseline / 'tools' / 'layout-probe.html')
        args.out.mkdir(parents=True, exist_ok=True)
        tag = re.sub(r'[^a-z0-9]+', '-', (args.scroll or 'top').lower()).strip('-')
        stem = f'{Path(args.page).stem}-{args.width}-{tag}'
        current = Server(ROOT, args.port)
        base = Server(args.baseline, args.base_port)
        try:
            for label, port in (('before', args.base_port), ('after', args.port)):
                path = args.out / f'{stem}-{label}.png'
                shoot(port, args.page, args.width, args.height,
                      args.scroll, args.offset, str(path), args.timeout)
                log(f'{label}: {path}')
        finally:
            current.stop()
            base.stop()
        return 0

    if not CHROME.exists():
        log(f'Не найден Chrome: {CHROME}')
        return 2
    if not (args.baseline / 'index.html').exists():
        log(f'Нет снимка «до» в {args.baseline}: сначала `layout-check.py baseline`')
        return 2
    # Пробник новее снимка — кладём его в снимок, иначе там нечего открывать.
    shutil.copy(ROOT / 'tools' / 'layout-probe.html', args.baseline / 'tools' / 'layout-probe.html')

    pages = args.page or ['index.html']
    widths = [int(value) for value in args.widths.split(',') if value.strip()]
    current = Server(ROOT, args.port)
    base = Server(args.baseline, args.base_port)
    jobs = []
    for page in pages:
        for width in widths:
            jobs.append((page, width, 'before', args.base_port))
            jobs.append((page, width, 'after', args.port))

    shots = {}
    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = {
                pool.submit(capture, port, page, width, args.height, args.timeout):
                    (page, width, side)
                for page, width, side, port in jobs
            }
            for future, ident in futures.items():
                try:
                    shots[ident] = future.result()
                    log(f'снято: {ident[0]} @ {ident[1]} {ident[2]} '
                        f'({shots[ident]["count"]} элементов)')
                except Exception as error:  # прогон одной ширины не роняет остальные
                    shots[ident] = str(error)
                    log(f'сбой: {ident[0]} @ {ident[1]} {ident[2]} — {error}')
    finally:
        current.stop()
        base.stop()

    ignore = re.compile(args.ignore)
    clean = True
    full = {}
    for page in pages:
        results = {}
        for width in widths:
            before, after = shots.get((page, width, 'before')), shots.get((page, width, 'after'))
            if isinstance(before, str) or isinstance(after, str):
                results[width] = before if isinstance(before, str) else after
            else:
                results[width] = diff(before, after, args.tol, ignore)
        clean = render(page, results, args.limit) and clean
        full[page] = results
    if args.json:
        args.json.write_text(json.dumps(full, ensure_ascii=False, indent=1))
        log(f'\nПолный отчёт: {args.json}')
    log('\nРасхождений нет.' if clean else '\nЕсть расхождения — смотреть выше.')
    return 0 if clean else 1


if __name__ == '__main__':
    sys.exit(main())
