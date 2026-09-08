"""Перевод растровых исходников в WebP с сохранением оригиналов.

Фотографии кодируются с потерями, плоская графика с прозрачностью — без.
Оригинал уезжает в assets/images/_backup-original/ (каталог в .gitignore),
чтобы к нему можно было вернуться, не поднимая историю git.

    python3 tools/to-webp.py --dry-run assets/images/projects
    python3 tools/to-webp.py assets/images/about/hero.png

Ссылки в разметке скрипт не правит: расширение меняется, и заменить путь
нужно осознанно, вместе с width/height.
"""
import argparse
import io
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKUP = ROOT / 'assets' / 'images' / '_backup-original'
SOURCES = {'.png', '.jpg', '.jpeg'}
# raw — присланные заказчиком исходники, _backup-original — уже отработанные:
# при обходе каталога ни то, ни другое трогать не нужно.
SKIP_DIRS = {'raw', '_backup-original'}
# Порог «плоской графики»: логотипы заказчиков укладываются в 400 цветов,
# самый бедный фотоснимок сайта — в 20 000.
FLAT_COLORS = 2048
# Мелкие исходники (карточки проектов, превью новостей) на экране
# растягиваются вверх, и артефакты растут вместе с ними — им качество выше.
SMALL_EDGE = 800
SMALL_BONUS = 6


def classify(image):
    """('lossless' | 'lossy', есть ли реальная прозрачность)."""
    alpha = image.mode in ('RGBA', 'LA') or 'transparency' in image.info
    if alpha:
        band = image.convert('RGBA').getchannel('A')
        alpha = band.getextrema()[0] < 255
    colors = image.convert('RGB').getcolors(maxcolors=FLAT_COLORS)
    return ('lossless' if colors is not None else 'lossy'), alpha


def convert(path, quality, keep_original, dry_run):
    with Image.open(path) as image:
        image.load()
        mode, alpha = classify(image)
        target = image.convert('RGBA' if alpha else 'RGB')
        out = path.with_suffix('.webp')
        if out.exists() and not dry_run:
            raise SystemExit(f'{out} уже существует — разобраться вручную')
        if mode == 'lossless':
            options = {'lossless': True}
        else:
            bonus = SMALL_BONUS if max(image.size) <= SMALL_EDGE else 0
            options = {'quality': min(quality + bonus, 100)}
        if dry_run:
            buffer = io.BytesIO()
            target.save(buffer, 'WEBP', method=6, **options)
            now = buffer.tell()
        else:
            target.save(out, 'WEBP', method=6, **options)
            now = out.stat().st_size
    was = path.stat().st_size
    if not dry_run and keep_original:
        backup = BACKUP / path.relative_to(ROOT / 'assets' / 'images')
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(backup))
    note = ('без потерь' if mode == 'lossless' else f'q{options["quality"]}')
    note += ', с прозрачностью' if alpha else ''
    print(f'{path.relative_to(ROOT)}: {was // 1024} КБ → {now // 1024} КБ '
          f'({100 - (100 * now // was if was else 100)}%, {note})')
    return was, now


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('paths', nargs='+', type=Path, help='файлы или каталоги')
    parser.add_argument('--quality', type=int, default=82)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--no-backup', action='store_true',
                        help='удалить оригинал вместо переноса в _backup-original')
    args = parser.parse_args()

    files = []
    for path in args.paths:
        path = path if path.is_absolute() else ROOT / path
        if path.is_dir():
            files += sorted(p for p in path.rglob('*')
                            if p.suffix.lower() in SOURCES
                            and not SKIP_DIRS.intersection(p.relative_to(path).parts))
        elif path.suffix.lower() in SOURCES:
            files.append(path)
        else:
            print(f'пропуск (не растр): {path}')
    if not files:
        print('нечего конвертировать')
        return 1

    was = now = 0
    for path in files:
        a, b = convert(path, args.quality, not args.no_backup, args.dry_run)
        was += a
        now += b
    print(f'\nитого: {was // 1024} КБ → {now // 1024} КБ '
          f'({100 - (100 * now // was if was else 100)}%), файлов: {len(files)}')
    if args.dry_run:
        print('это был пробный прогон, файлы не тронуты')
    return 0


if __name__ == '__main__':
    sys.exit(main())
