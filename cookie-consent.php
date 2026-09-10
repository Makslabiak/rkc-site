<?php
/**
 * Приём согласия на cookie и письмо заказчику.
 *
 * Плашка о cookie после нажатия «Принять» шлёт сюда POST (см. отправку в
 * cookie-notice.js). Здесь запрос превращается в письмо заказчику — это и
 * есть доказательство согласия: дата, страница, браузер и адрес посетителя.
 *
 * Адрес получателя берётся из настроек на сервере, см. ниже. Хостинг обязан
 * выполнять PHP: если файлы просто раздаются, POST сюда получит ответ 405,
 * письма не будет, а сам файл покажут посетителю текстом.
 *
 * Файл кладётся в корень сайта рядом со страницами. На Bitrix путь тот же,
 * менять в скрипте ничего не нужно; если письма пойдут через почтовые
 * события Bitrix, заменить тело функции sendConsentMail(), остальное
 * оставить как есть.
 *
 * Что здесь защищает почтовый ящик заказчика от завала:
 *  - одно письмо с одного адреса в сутки (повторные нажатия молча гасятся);
 *  - потолок писем в час, сверх него согласия считаются и попадают строкой
 *    в следующее письмо;
 *  - в заголовки письма не попадает ничего, что пришло от посетителя.
 *
 * Состояние лежит в одном файле, CONSENT_STATE_FILE. Он должен быть вне
 * папки сайта: в нём хранятся отпечатки адресов посетителей, и отдавать их
 * наружу нельзя. По умолчанию это на уровень выше корня.
 */

declare(strict_types=1);

/* Адреса в этом файле не держим. Репозиторий открытый, а на хостинге без
   PHP этот файл отдаётся посетителю как обычный текст — и то и другое
   показало бы почту заказчика всем желающим.
   Настоящие адреса лежат в файле рядом с сайтом, но вне его папки:
   ../cookie-consent-config.php. Образец с пояснениями — в репозитории,
   cookie-consent-config.sample.php: скопировать, положить на сервер,
   заполнить. */
$consentConfig = [];
$consentConfigFile = __DIR__ . '/../cookie-consent-config.php';
if (is_readable($consentConfigFile)) {
    $loaded = require $consentConfigFile;
    if (is_array($loaded)) {
        $consentConfig = $loaded;
    }
}

function consentSetting(array $config, string $key, string $fallback): string
{
    $value = $config[$key] ?? null;
    return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
}

/* Пока настроек на сервере нет, письма идут на общую почту компании. Она и
   так напечатана в подвале сайта, так что прятать её незачем, а согласия
   при забытой настройке не пропадут. Несколько адресов — через запятую. */
define('CONSENT_MAIL_TO', consentSetting($consentConfig, 'to', 'mail@rks-nr.ru'));

/* Адрес на время проверки. Пока он задан, письма идут на него, а не
   заказчику, тема помечается словом «проверка», и подряд идущие нажатия не
   склеиваются — иначе с одного браузера письмо ушло бы раз в сутки и
   перепроверить бы не вышло. Часовой предел при этом работает. */
define('CONSENT_MAIL_TEST_TO', consentSetting($consentConfig, 'test_to', ''));

/* Отправитель. Домен обязан совпадать с доменом сайта, иначе почта
   получателя отправит письмо в спам. */
define('CONSENT_MAIL_FROM', consentSetting($consentConfig, 'from', 'no-reply@rks-nr.ru'));

/* Сколько писем в час максимум. Остальные согласия не теряются: их число
   уходит строкой в следующем письме. */
const CONSENT_HOURLY_LIMIT = 60;

/* Сколько помнить адрес, чтобы не слать письмо на каждое нажатие, секунд. */
const CONSENT_REPEAT_WINDOW = 86400;

/* Включить, только если сайт стоит за прокси или CDN. Тогда адрес посетителя
   берётся из заголовка X-Forwarded-For, который проставляет прокси.
   Оставить выключенным на прямом хостинге: заголовок подделывается, и с ним
   защита от повторов перестаёт работать. А вот не включить его за прокси —
   ошибка обратная и заметная: все посетители сольются в один адрес прокси,
   и письмо уйдёт одно в сутки на всех. */
const CONSENT_TRUST_PROXY = false;

const CONSENT_STATE_FILE = __DIR__ . '/../cookie-consent-state.json';

/* Отвечаем всегда пустотой: плашке ответ не нужен, а лишние подробности
   подсказывают, как по скрипту стучать. */
function consentDone(int $status = 204): void
{
    http_response_code($status);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    consentDone(405);
}

/* Запрос обязан прийти со своей же страницы. Чужая страница, вставившая
   к себе этот адрес, письмо не вызовет. */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('http://' . $host, PHP_URL_HOST)) {
    consentDone(403);
}

/* Строки от посетителя. Переводы строк вырезаются: с ними в письмо можно
   было бы дописать свой заголовок. */
function consentClean(string $value, int $limit): string
{
    $value = str_replace(["\r", "\n", "\0"], ' ', $value);
    $value = trim($value);
    if ($value === '') {
        return '—';
    }
    if (mb_strlen($value) > $limit) {
        $value = mb_substr($value, 0, $limit) . '…';
    }
    return $value;
}

/* Страницу берём только свою: чужой адрес в письме — готовая ссылка-приманка
   для того, кто письмо откроет. */
function consentPage(string $raw, string $host): string
{
    $raw = consentClean($raw, 300);
    $pageHost = parse_url($raw, PHP_URL_HOST);
    if ($pageHost !== null && $pageHost !== parse_url('http://' . $host, PHP_URL_HOST)) {
        return '—';
    }
    return $raw;
}

function consentIp(): string
{
    if (CONSENT_TRUST_PROXY) {
        $forwarded = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($forwarded !== '') {
            /* Прокси дописывают адреса через запятую, свой посетитель первый. */
            $first = trim(explode(',', $forwarded)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }
    }

    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/**
 * Прочитать состояние, решить судьбу этого согласия и записать состояние
 * обратно. Файл держится под замком, поэтому два одновременных посетителя
 * не затрут учёт друг друга.
 *
 * Возвращает число пропущенных ранее согласий, если письмо слать надо,
 * и null, если не надо.
 */
function consentRegister(string $fingerprint, int $now): ?int
{
    $handle = @fopen(CONSENT_STATE_FILE, 'c+');
    if ($handle === false) {
        /* Состояние недоступно — письмо всё равно уходит. Лучше лишнее
           письмо, чем потерянное согласие. */
        return 0;
    }

    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $state = json_decode((string) $raw, true);
    if (!is_array($state)) {
        $state = [];
    }

    $seen = is_array($state['seen'] ?? null) ? $state['seen'] : [];
    $hour = is_array($state['hour'] ?? null) ? $state['hour'] : [];

    /* Забываем старые адреса, иначе файл растёт без края. */
    foreach ($seen as $key => $time) {
        if (!is_int($time) || $time < $now - CONSENT_REPEAT_WINDOW) {
            unset($seen[$key]);
        }
    }

    /* На проверке повторы не глушим: иначе второе нажатие письма не даст. */
    $repeat = CONSENT_MAIL_TEST_TO === '' && isset($seen[$fingerprint]);
    $seen[$fingerprint] = $now;

    $start = is_int($hour['start'] ?? null) ? $hour['start'] : 0;
    $sent = is_int($hour['sent'] ?? null) ? $hour['sent'] : 0;
    $skipped = is_int($hour['skipped'] ?? null) ? $hour['skipped'] : 0;
    if ($start < $now - 3600) {
        $start = $now;
        $sent = 0;
    }

    $result = null;
    if ($repeat) {
        /* Тот же посетитель в те же сутки — письмо уже было. */
    } elseif ($sent >= CONSENT_HOURLY_LIMIT) {
        $skipped++;
    } else {
        $result = $skipped;
        $sent++;
        $skipped = 0;
    }

    $state = [
        'seen' => $seen,
        'hour' => ['start' => $start, 'sent' => $sent, 'skipped' => $skipped],
    ];

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string) json_encode($state));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $result;
}

function sendConsentMail(string $when, string $page, string $agent, string $ip, int $skipped): void
{
    $lines = [
        'Посетитель принял условия использования cookie.',
        '',
        'Дата и время: ' . $when,
        'Страница: ' . $page,
        'Браузер: ' . $agent,
        'Адрес: ' . ($ip === '' ? '—' : $ip),
    ];

    if ($skipped > 0) {
        $lines[] = '';
        $lines[] = 'Кроме этого, с прошлого письма согласий было ещё ' . $skipped
            . '. Письма по ним не отправлялись: сработал часовой предел.';
    }

    $lines[] = '';
    $lines[] = 'Письмо отправлено сайтом автоматически, отвечать на него не нужно.';

    /* Имя отправителя кириллицей, поэтому его, как и тему, приходится
       кодировать: голый UTF-8 в заголовке письма читается не везде. */
    $from = '=?UTF-8?B?' . base64_encode('Сайт РКС-НР') . '?=';

    $headers = [
        'From: ' . $from . ' <' . CONSENT_MAIL_FROM . '>',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'MIME-Version: 1.0',
    ];

    $to = CONSENT_MAIL_TEST_TO === '' ? CONSENT_MAIL_TO : CONSENT_MAIL_TEST_TO;
    $subject = CONSENT_MAIL_TEST_TO === ''
        ? 'Согласие на cookie — сайт РКС-НР'
        : 'Проверка: согласие на cookie — сайт РКС-НР';

    @mail(
        $to,
        '=?UTF-8?B?' . base64_encode($subject) . '?=',
        implode("\r\n", $lines),
        implode("\r\n", $headers)
    );
}

/* Дату берём свою, а не ту, что прислала страница: часы посетителя могут
   показывать что угодно, а в письме нужна дата, на которую можно ссылаться. */
$now = time();
$ip = consentIp();
$rawPage = $_POST['page'] ?? '';
$page = consentPage(is_string($rawPage) ? $rawPage : '', $host);
$agent = consentClean((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 300);

/* Отпечаток, а не сам адрес: файл состояния лежит на диске, и хранить в нём
   адреса посетителей ни к чему. */
$fingerprint = hash('sha256', $ip . '|' . $agent);

$skipped = consentRegister($fingerprint, $now);
if ($skipped === null) {
    consentDone();
}

$when = (new DateTimeImmutable('@' . $now))
    ->setTimezone(new DateTimeZone('Europe/Moscow'))
    ->format('d.m.Y H:i') . ' МСК';

sendConsentMail($when, $page, $agent, $ip, $skipped);
consentDone();
