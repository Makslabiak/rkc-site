"""Local preview server with byte ranges for HTML video. Not a production server."""
import argparse
import re
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.remaining = None
        path = Path(self.translate_path(self.path))
        header = self.headers.get('Range')
        if not header or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', header.strip())
        # Multiple/unknown ranges may be ignored according to HTTP semantics.
        if not match or not any(match.groups()):
            return super().send_head()
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            start, end = max(0, size - int(last)), size - 1
        if start > end or start >= size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        file = path.open('rb')
        file.seek(start)
        self.remaining = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(self.remaining))
        self.send_header('Last-Modified', self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        return file

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            if self.remaining is None:
                return super().copyfile(source, outputfile)
            while self.remaining:
                chunk = source.read(min(self.remaining, 64 * 1024))
                if not chunk:
                    break
                outputfile.write(chunk)
                self.remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A media client may cancel a range when seeking.


def lan_addresses():
    """Все адреса машины в локальных сетях.

    Печатаем список, а не один адрес: когда поднят VPN, маршрут уводит на
    его интерфейс, а телефону нужен адрес того же Wi-Fi. Угадывать за
    владельца нечего, пусть выберет из списка.
    """
    found = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if not address.startswith('127.') and address not in found:
                found.append(address)
    except OSError:
        pass
    return found


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--lan', action='store_true',
                        help='отдавать сайт в локальную сеть: проверить на телефоне '
                             'или на другом ноутбуке')
    args = parser.parse_args()
    handler = partial(RangeHandler, directory=str(Path(__file__).resolve().parents[1]))
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    server = ThreadingHTTPServer((host, args.port), handler)
    print(f'Preview: http://127.0.0.1:{args.port}', flush=True)
    if args.lan:
        addresses = lan_addresses()
        if addresses:
            print('\nС телефона или другого ноутбука в той же сети:', flush=True)
            for address in addresses:
                print(f'  http://{address}:{args.port}', flush=True)
                print(f'  http://{address}:{args.port}/tools/device-check.html', flush=True)
            print('Если адресов несколько, подходит тот, что начинается так же, '
                  'как адрес телефона.', flush=True)
        else:
            print('Адрес в сети определить не вышло, посмотрите его в настройках Wi-Fi.',
                  flush=True)
    server.serve_forever()
