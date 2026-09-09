"""Сверка серверных включений с тем, что сейчас на страницах.

PHP на этой машине нет, поэтому включения из includes/ прогоняются простым
подстановщиком: он умеет ровно те выражения, которые в них встречаются, и
падает, если появится незнакомое. Дальше результат сравнивается с живой
разметкой страницы.

    python3 tools/check-includes.py            # все страницы
    python3 tools/check-includes.py --page news.html

Разница в выводе — это не обязательно ошибка. Подвал на страницах разошёлся
исторически, и отчёт показывает, что именно изменится при переходе на общее
включение. Пустой отчёт значит, что страница переносится один в один.
"""
import argparse
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = json.loads((ROOT / 'bitrix-prep' / 'pages.json').read_text(encoding='utf-8'))

ANIM_TYPE = ' data-anim="typeChars" data-anim-target="a" data-anim-start="top bottom"'
ANIM_FADE = ' data-anim="fadeIn" data-anim-target="a" data-anim-start="top bottom"'
ANIM_TITLE = ' data-anim="typeChars" data-anim-start="top bottom"'
CURRENT = ' aria-current="page"'

DARK_PAGES = {'about', 'services', 'news-detail', 'project-detail'}


def flags(site_page):
    return {
        '$isAbout': site_page == 'about',
        '$isServices': site_page == 'services',
        '$isProjects': site_page in ('projects', 'project-detail'),
        '$isNews': site_page in ('news', 'news-detail'),
        '$isContacts': site_page == 'contacts',
    }


def footer_values(page, meta):
    site_page = meta['sitePage']
    foot = meta['footer']
    values = {
        "$footerClass ? ' ' . $footerClass : ''":
            (' ' + foot['class']) if foot['class'] else '',
        "$footerId ? ' id=\"' . $footerId . '\"' : ''":
            (' id="%s"' % foot['id']) if foot['id'] else '',
        '$animType': ANIM_TYPE if foot['anim'] else '',
        '$animFade': ANIM_FADE if foot['anim'] else '',
        '$animTitle': ANIM_TITLE if foot['anim'] else '',
        '$footerPoliciesBase': foot['policiesBase'],
        '$footerLegalBase': foot['legalBase'],
    }
    for flag, on in flags(site_page).items():
        values[f"{flag} ? $current : ''"] = CURRENT if on else ''
    return values


def header_values(meta):
    site_page = meta['sitePage']
    values = {
        '$headerTheme': 'dark' if site_page in DARK_PAGES else 'light',
        '$homeUrl': '#top' if site_page == 'home' else 'index.html',
    }
    for flag, on in flags(site_page).items():
        values[f"{flag} ? $current : ''"] = CURRENT if on else ''
    return values


def render(include, values):
    """Выполняет включение подстановкой. Незнакомое выражение — ошибка."""
    body = (ROOT / 'includes' / include).read_text(encoding='utf-8').split('?>\n', 1)[1]

    def one(match):
        expr = match.group(1).strip()
        if expr not in values:
            raise SystemExit(f'{include}: проверка не знает выражения {expr}')
        return values[expr]

    return re.sub(r'<\?=(.*?)\?>', one, body).strip('\n')


def page_footer(page):
    html = (ROOT / page).read_text(encoding='utf-8')
    return re.search(r'<footer.*?</footer>', html, re.S).group(0)


def normalize(markup):
    """Убирает форматирование, оставляя всё, что видно на экране.

    Отступы и переносы между тегами браузер схлопывает, поэтому сравнивать
    их бессмысленно: часть страниц свёрстана в одну строку. А вот неразрывный
    пробел остаётся как есть — от него зависит, где встанет перенос строки.
    """
    markup = re.sub(r'>[\t\n\r ]+<', '><', markup)
    markup = re.sub(r'[\t\n\r ]+', ' ', markup)
    return re.sub(r'><', '>\n<', markup).strip()


def report(page, meta):
    was = normalize(page_footer(page))
    now = normalize(render('site-footer.php', footer_values(page, meta)))
    if was == now:
        return []
    return list(difflib.unified_diff(
        was.split('\n'), now.split('\n'),
        f'{page} сейчас', 'site-footer.php', lineterm='', n=0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--page', help='проверить одну страницу')
    args = parser.parse_args()

    pages = {args.page: PAGES[args.page]} if args.page else PAGES

    # Шапки в HTML-страницах нет, её строит site-header.js. Поэтому включение
    # сверяется с куском bitrix-prep/markup/chrome/site-header.html: он снят с
    # живой страницы и сверен с выводом скрипта поэлементно.
    for page, meta in pages.items():
        render('site-header.php', header_values(meta))
    print(f'site-header.php: разбирается на всех страницах ({len(pages)})')

    # Включение выводит шапку и меню вместе, поэтому эталон складывается из
    # двух кусков.
    chrome = ROOT / 'bitrix-prep' / 'markup' / 'chrome'
    reference = ''.join(
        re.sub(r'<!--.*?-->', '', (chrome / name).read_text(encoding='utf-8'), flags=re.S)
        for name in ('site-header.html', 'site-menu.html'))
    built = render('site-header.php', header_values(PAGES['index.html']))
    if normalize(reference) == normalize(built):
        print('site-header.php: на главной совпадает с эталоном разметки')
    else:
        print('site-header.php: РАЗОШЁЛСЯ с эталоном разметки')
        for line in difflib.unified_diff(
                normalize(reference).split('\n'), normalize(built).split('\n'),
                'эталон', 'site-header.php', lineterm='', n=0):
            print('  ' + line)

    same, differ = [], {}
    for page, meta in pages.items():
        diff = report(page, meta)
        (same.append(page) if not diff else differ.setdefault(page, diff))

    print(f'\nПодвал совпадает один в один: {len(same)} из {len(pages)}')
    for page in same:
        print('  ' + page)
    if differ:
        print(f'\nОтличается: {len(differ)}')
        for page, diff in differ.items():
            print(f'\n--- {page}')
            for line in diff:
                print('  ' + line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
