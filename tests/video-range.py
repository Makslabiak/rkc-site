"""Run while tools/serve.py is listening on port 4173."""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

path = Path(__file__).resolve().parents[1] / 'assets/videos/company.mp4'
size = path.stat().st_size
url = 'http://127.0.0.1:4173/assets/videos/company.mp4'
for header, start, end in [('bytes=0-1023', 0, 1023), ('bytes=-512', size-512, size-1),
                            (f'bytes={size-100}-', size-100, size-1)]:
    with urlopen(Request(url, headers={'Range': header})) as response:
        assert response.status == 206
        assert response.headers['Content-Range'] == f'bytes {start}-{end}/{size}'
        with path.open('rb') as source:
            source.seek(start)
            assert response.read() == source.read(end-start+1)
try:
    urlopen(Request(url, headers={'Range': f'bytes={size}-'}))
    raise AssertionError('Expected 416')
except HTTPError as error:
    assert error.code == 416
    assert error.headers['Content-Range'] == f'bytes */{size}'
with urlopen(Request(url, method='HEAD', headers={'Range':'bytes=0-1023'})) as response:
    assert response.status == 206 and response.read() == b''
    assert response.headers['Content-Length'] == '1024'
print('PASS HTTP Range: byte content, suffix, open end, HEAD, invalid range')
