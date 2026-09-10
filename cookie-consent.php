<?php
/**
 * Приём согласия на cookie и письмо заказчику.
 *
 * Плашка о cookie после нажатия «Принять» шлёт сюда POST (см. отправку в
 * cookie-notice.js). Здесь запрос превращается в письмо: дата, страница,
 * браузер и адрес посетителя. Это и есть доказательство согласия.
 *
 * Файл кладётся в корень сайта рядом со страницами. Общая часть с приёмником
 * заявок — в includes/mail-tools.php, адреса почты — в настройках на сервере,
 * там же сказано, где они лежат.
 *
 * Что защищает почтовый ящик от завала:
 *  - одно письмо с одного посетителя в сутки, повторные нажатия гасятся;
 *  - потолок писем в час, сверх него согласия считаются и попадают строкой
 *    в следующее письмо;
 *  - в заголовки письма не попадает ничего, что пришло от посетителя.
 */

declare(strict_types=1);

require __DIR__ . '/includes/mail-tools.php';

const CONSENT_HOURLY_LIMIT = 60;
const CONSENT_REPEAT_WINDOW = 86400;

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    mailToolsDone(405);
}

if (!mailToolsSameOrigin()) {
    mailToolsDone(403);
}

/* Пока в настройках задан адрес для проверки, письма идут на него, тема
   помечается словом «проверка», и подряд идущие нажатия не склеиваются:
   иначе с одного браузера письмо ушло бы раз в сутки и перепроверить бы не
   вышло. Часовой предел при этом работает. */
$testTo = mailToolsSetting('cookie_test_to', '');

/* Без настроек письма идут на общую почту компании, ту, что напечатана в
   подвале сайта: согласия не пропадут, а личных адресов в коде нет. */
$to = $testTo !== '' ? $testTo : mailToolsSetting('cookie_to', 'mail@rks-nr.ru');

/* Страницу берём только свою: чужой адрес в письме — готовая ссылка-приманка
   для того, кто письмо откроет. */
$page = mailToolsField('page', 300);
$pageHost = $page === '' ? null : parse_url($page, PHP_URL_HOST);
if ($pageHost !== null && $pageHost !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) {
    $page = '';
}

/* Дату ставим свою, а не ту, что прислала страница: часы посетителя могут
   показывать что угодно, а в письме нужна дата, на которую можно ссылаться. */
$now = time();
$ip = mailToolsIp();
$agent = mailToolsClean((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 300);

/* Отпечаток, а не сам адрес: файл учёта лежит на диске, и хранить в нём
   адреса посетителей ни к чему. */
$fingerprint = hash('sha256', $ip . '|' . $agent);

$skipped = mailToolsThrottle(
    __DIR__ . '/../cookie-consent-state.json',
    $fingerprint,
    $now,
    [
        'window' => CONSENT_REPEAT_WINDOW,
        'limit' => CONSENT_HOURLY_LIMIT,
        'skipRepeat' => $testTo !== '',
    ]
);

if ($skipped === null) {
    mailToolsDone();
}

$when = (new DateTimeImmutable('@' . $now))
    ->setTimezone(new DateTimeZone('Europe/Moscow'))
    ->format('d.m.Y H:i') . ' МСК';

$lines = [
    'Посетитель принял условия использования cookie.',
    '',
    'Дата и время: ' . $when,
    'Страница: ' . ($page === '' ? '—' : $page),
    'Браузер: ' . ($agent === '' ? '—' : $agent),
    'Адрес: ' . ($ip === '' ? '—' : $ip),
];

if ($skipped > 0) {
    $lines[] = '';
    $lines[] = 'Кроме этого, с прошлого письма согласий было ещё ' . $skipped
        . '. Письма по ним не отправлялись: сработал часовой предел.';
}

$lines[] = '';
$lines[] = 'Письмо отправлено сайтом автоматически, отвечать на него не нужно.';

$subject = $testTo !== ''
    ? 'Проверка: согласие на cookie — сайт РКС-НР'
    : 'Согласие на cookie — сайт РКС-НР';

mailToolsSend($to, $subject, $lines);
mailToolsDone();
