"""Выжимка повторяемых кусков вёрстки для переноса в шаблоны Bitrix.

Куски не переписываются руками: скрипт вырезает их из живых страниц байт
в байт. Поэтому набор в bitrix-prep/markup/ нельзя рассинхронизировать со
страницами незаметно — `--check` это ловит.

    python3 tools/markup-kit.py --write   # обновить набор из страниц
    python3 tools/markup-kit.py --check   # убедиться, что набор совпадает

Шапка и мобильное меню сюда не попадают: их строит site-header.js, в HTML
их нет. Они лежат в bitrix-prep/markup/chrome/ и снимаются с живой страницы.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'bitrix-prep' / 'markup'

# (файл, страница, тег, регулярка по открывающему тегу, номер совпадения)
PIECES = [
    ('chrome/footer.html',            'index.html',          'footer',  r'<footer class="footer" id="contacts">', 1),
    ('home/hero.html',                'index.html',          'header',  r'<header class="hero"', 1),
    ('home/company-intro.html',       'index.html',          'section', r'<section class="company-intro"', 1),
    ('home/stats.html',               'index.html',          'section', r'<section class="stats"', 1),
    ('home/projects.html',            'index.html',          'section', r'<section class="projects"', 1),
    ('home/services.html',            'index.html',          'section', r'<section class="services"', 1),
    ('home/video-section.html',       'index.html',          'section', r'<section class="video-section"', 1),
    ('home/news.html',                'index.html',          'section', r'<section class="news"', 1),
    ('cards/project-card.html',       'index.html',          'article', r'<article class="project-card', 1),
    ('cards/service-card.html',       'index.html',          'article', r'<article class="service-card', 1),
    ('cards/news-card.html',          'index.html',          'a',       r'<a class="news-card', 1),
    ('cards/news-page-card.html',     'news.html',           'a',       r'<a class="news-page-card', 1),
    ('cards/advantage-card.html',     'about.html',          'article', r'<article class="advantage-card', 1),
    ('cards/service-accordion.html',  'services.html',       'article', r'<article class="service-accordion__item"', 1),
    ('cards/document-section.html',   'documents.html',      'article', r'<article class="document-section"', 1),
    ('news/list.html',                'news.html',           'section', r'<section class="news-page__content"', 1),
    ('news/detail.html',              'news-detail.html',    'section', r'<section class="news-detail__content"', 1),
    ('projects/catalog.html',         'projects.html',       'section', r'<section class="projects-page__catalog"', 1),
    ('projects/detail-intro.html',    'project-detail.html', 'section', r'<section class="project-detail__intro"', 1),
    ('projects/detail-gallery.html',  'project-detail.html', 'section', r'<section class="project-detail__gallery ', 1),
    ('about/leadership.html',         'about.html',          'section', r'<section class="about-leadership"', 1),
    ('about/clients.html',            'about.html',          'section', r'<section class="about-clients"', 1),
    ('about/career.html',             'about.html',          'section', r'<section class="about-career"', 1),
    ('contacts/form.html',            'contacts.html',       'section', r'<section class="contacts-form-section"', 1),
    ('contacts/map.html',             'contacts.html',       'section', r'<section class="contacts-map-section"', 1),
    ('contacts/details.html',         'contacts.html',       'section', r'<section class="contacts-main"', 1),
    ('documents/tabs.html',           'documents.html',      'section', r'<section class="documents-content"', 1),
]


def cut(html, tag, opening, nth):
    """Вырезает n-й элемент tag, считая вложенность одноимённых тегов."""
    found = 0
    for match in re.finditer(opening, html):
        found += 1
        if found == nth:
            break
    else:
        raise LookupError(opening)

    start = match.start()
    depth = 0
    pattern = re.compile(rf'<{tag}\b[^>]*?(/?)>|</{tag}>', re.S)
    for token in pattern.finditer(html, start):
        if token.group(0).startswith('</'):
            depth -= 1
            if depth == 0:
                return html[start:token.end()]
        elif not token.group(1):
            depth += 1
    raise ValueError(f'не закрыт {tag} в позиции {start}')


def collect():
    pieces = {}
    for name, page, tag, opening, nth in PIECES:
        html = (ROOT / page).read_text(encoding='utf-8')
        body = cut(html, tag, opening, nth)
        head = f'<!-- Источник: {page}. Вырезано tools/markup-kit.py, править здесь нельзя. -->\n'
        pieces[name] = head + body + '\n'
    return pieces


# Порядок страниц как в навигации, а не по алфавиту: так карту читать легче.
PAGES = [
    'index.html', 'about.html', 'services.html', 'projects.html',
    'project-detail.html', 'news.html', 'news-detail.html',
    'documents.html', 'policies.html', 'contacts.html', '404.html',
]


def one(pattern, html, group=1, default=''):
    found = re.search(pattern, html, re.S)
    return found.group(group) if found else default


def page_map():
    """Собирает по страницам всё, из чего шаблон восстанавливает head и body."""
    pages = {}
    for page in PAGES:
        html = (ROOT / page).read_text(encoding='utf-8')
        body_tag = one(r'<body[^>]*>', html, 0)
        footer = one(r'<footer.*?</footer>', html, 0)
        footer_open = one(r'<footer[^>]*>', footer, 0)
        drop_version = lambda src: re.sub(r'\?v=[^"]*', '', src)

        pages[page] = {
            'sitePage': one(r'data-site-page="([^"]*)"', body_tag),
            'bodyClass': one(r'<body[^>]*class="([^"]*)"', html),
            'title': one(r'<title>(.*?)</title>', html),
            'description': one(r'<meta name="description" content="([^"]*)"', html),
            'canonical': one(r'<link rel="canonical" href="([^"]*)"', html),
            'ogImage': one(r'<meta property="og:image" content="([^"]*)"', html),
            'robots': one(r'<meta name="robots" content="([^"]*)"', html),
            'preload': [drop_version(m) for m in
                        re.findall(r'<link rel="preload" href="([^"]*)"', html)],
            'css': [drop_version(m) for m in
                    re.findall(r'<link rel="stylesheet" href="([^"]*)"', html)],
            'js': [drop_version(m) for m in re.findall(r'<script src="([^"]*)"', html)],
            'jsonLd': len(re.findall(r'application/ld\+json', html)),
            'footer': {
                'class': one(r'class="footer([^"]*)"', footer_open).strip(),
                'id': one(r'id="([^"]+)"', footer_open),
                'anim': 'data-anim' in footer,
                'legalBase': '' if '"#agreement"' in footer else 'documents.html',
                'policiesBase': '' if '"#labor"' in footer else 'policies.html',
            },
        }
    return pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not (args.write or args.check):
        parser.error('нужен --write или --check')

    pieces = collect()
    pages = json.dumps(page_map(), ensure_ascii=False, indent=2) + '\n'
    pages_path = OUT.parent / 'pages.json'

    if args.write:
        for name, text in pieces.items():
            path = OUT / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        pages_path.write_text(pages, encoding='utf-8')
        print(f'записано кусков: {len(pieces)} в {OUT.relative_to(ROOT)}')
        print(f'карта страниц: {pages_path.relative_to(ROOT)}')
        return 0

    drift = []
    if not pages_path.exists():
        drift.append('pages.json: нет файла')
    elif pages_path.read_text(encoding='utf-8') != pages:
        drift.append('pages.json: разошёлся со страницами')
    for name, text in pieces.items():
        path = OUT / name
        if not path.exists():
            drift.append(f'{name}: нет файла')
        elif path.read_text(encoding='utf-8') != text:
            drift.append(f'{name}: разошёлся со страницей')
    if drift:
        print('Вёрстка и набор разошлись:')
        for line in drift:
            print('  ' + line)
        return 1
    print(f'совпадает: {len(pieces)} кусков')
    return 0


if __name__ == '__main__':
    sys.exit(main())
