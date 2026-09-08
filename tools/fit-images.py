"""Приведение картинок к тому размеру, в котором они реально показываются.

Зачем. Кадры хранились в 2048 px, а на экране занимают 200-670. Лишние
пиксели никто не видит, но они качаются и распаковываются: 5.3 МБ на главной
вместо 2.1. Из-за веса картинки приходилось грузить лениво, они долетали ровно
в момент появления секции, и подготовка текстуры для дизера вставала посреди
анимации заголовка — отсюда рывки. Подробности замеров — в README, раздел
«Размер картинок и плавность».

Вид не меняется. Дизер сам уменьшает текстуру до «ширина на экране × 1.9»
(pixelRatio до 1.5 × oversample 1.25), то есть до 2048 он никогда не
добирался. Обычные <img> показываются меньше, чем хранятся. Запас × 2 от
ширины на экране покрывает Retina.

Ширины показа лежат в tools/display-widths.json — самая большая ширина файла
по всем страницам на 1920 px. Пересобрать их можно замером через CDP
(см. README), вручную править не нужно.

    python3 tools/fit-images.py --dry-run
    python3 tools/fit-images.py assets/images/home/project-restoration.webp
    python3 tools/fit-images.py            # все файлы из таблицы
"""
import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = Path(__file__).resolve().parent / 'display-widths.json'
# Запас над шириной показа: Retina просит два пикселя на точку.
SCALE = 2
# Ниже этого не опускаемся: у мелких иконок и превью запас важнее экономии.
MIN_EDGE = 400
QUALITY = 82


def fit(path, display_width, dry_run):
    with Image.open(path) as image:
        image.load()
        source = image.convert('RGB')
        natural_width, natural_height = source.size
        target_width = min(natural_width, max(MIN_EDGE, display_width * SCALE))
        if target_width >= natural_width:
            return None
        target_height = round(natural_height * target_width / natural_width)
        resized = source.resize((target_width, target_height), Image.LANCZOS)
        buffer = io.BytesIO()
        resized.save(buffer, 'WEBP', quality=QUALITY, method=6)

    was = path.stat().st_size
    now = buffer.tell()
    if now >= was:
        return None
    if not dry_run:
        path.write_bytes(buffer.getvalue())
    print(f'{path.relative_to(ROOT)}: {natural_width}x{natural_height} → '
          f'{target_width}x{target_height}, {was // 1024} КБ → {now // 1024} КБ '
          f'(показ {display_width} px)')
    return was, now, target_width, target_height


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('paths', nargs='*', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    widths = json.loads(WIDTHS.read_text(encoding='utf-8'))
    targets = [str(p) for p in args.paths] if args.paths else sorted(widths)

    was = now = 0
    touched = 0
    for relative in targets:
        display = widths.get(relative)
        if display is None:
            print(f'{relative}: ширины показа нет в таблице — пропускаю')
            continue
        path = ROOT / relative
        if not path.exists():
            print(f'{relative}: файла нет — пропускаю')
            continue
        result = fit(path, display, args.dry_run)
        if result:
            was += result[0]
            now += result[1]
            touched += 1

    if touched:
        print(f'\nитого: {was / 1048576:.2f} МБ → {now / 1048576:.2f} МБ '
              f'({100 - round(100 * now / was)}%), файлов: {touched}')
        print('Размеры в пикселях изменились — обновить width/height в разметке.')
    else:
        print('нечего уменьшать')
    return 0


if __name__ == '__main__':
    sys.exit(main())
