"""Проверка покрытия шрифтов: все ли символы страниц есть в подрезанных WOFF2.

Шрифты в assets/fonts подрезаны до латиницы, кириллицы и пунктуации. Если
контент когда-нибудь принесёт символ вне этого набора, браузер молча
подставит системный шрифт — визуально это заметно не сразу. Скрипт ловит
такое до публикации.

    python3 tools/check-fonts.py

Выход 0 — всё покрыто; 1 — есть символы без глифа (кроме заведомо
отсутствующих и в исходных файлах).
"""
import glob
import html
import os
import re
import sys

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Шрифт -> где он применяется. Проверяем оба по всему тексту сайта: точное
# соответствие правил CSS и узлов DOM здесь не нужно, важен сам факт наличия.
FONTS = ["assets/fonts/LTSuperior-Regular.woff2",
         "assets/fonts/LTSuperior-Semibold.woff2",
         "assets/fonts/Roboto-Variable.woff2"]

# Символы, которых не было и в исходных OTF/TTF: их отсутствие не регрессия,
# браузер и раньше брал их из системного шрифта.
KNOWN_GAPS = {
    "LTSuperior-Regular.woff2": {0x2116, 0x3000},   # № и ideographic space
    "LTSuperior-Semibold.woff2": {0x2116, 0x3000},  # тот же подрез, что у Regular
    "Roboto-Variable.woff2": {0x2192, 0x3000},      # → и ideographic space
}


def page_characters():
    chars = set()
    for path in glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "*.js")):
        text = open(path, encoding="utf-8").read()
        if path.endswith(".html"):
            text = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
            text = html.unescape(re.sub(r"<[^>]+>", " ", text))
        chars |= set(text)
    return {c for c in chars if ord(c) > 31}


def codepoints(font_path):
    font = TTFont(font_path)
    covered = set()
    for table in font["cmap"].tables:
        covered |= set(table.cmap.keys())
    return covered


def main():
    chars = page_characters()
    failed = False
    for relative in FONTS:
        name = os.path.basename(relative)
        covered = codepoints(os.path.join(ROOT, relative))
        allowed = KNOWN_GAPS.get(name, set())
        missing = sorted(c for c in chars if ord(c) not in covered and ord(c) not in allowed)
        if missing:
            failed = True
            listing = ", ".join(f"{c!r} (U+{ord(c):04X})" for c in missing)
            print(f"{name}: нет глифов для {listing}")
        else:
            print(f"{name}: покрытие полное")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
