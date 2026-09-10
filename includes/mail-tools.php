<?php
/**
 * Общая часть почтовых приёмников сайта: cookie-consent.php (согласие на
 * cookie) и contact-form.php (заявка с формы обратной связи). Оба подключают
 * этот файл первой строкой.
 *
 * Здесь лежит то, что у них одинаковое: чтение настроек, чистка строк,
 * определение адреса посетителя, учёт частоты обращений и сама отправка
 * письма.
 *
 * Настройки — в файле site-mail-config.php на уровень выше папки сайта.
 * В репозитории его нет и быть не должно: репозиторий открытый, а на
 * хостинге без PHP файлы отдаются посетителю текстом. Образец с пояснениями
 * лежит рядом со страницами, site-mail-config.sample.php.
 *
 * Хостинг обязан выполнять PHP. Если файлы просто раздаются, POST сюда
 * получит от сервера ответ 405, письма не будет.
 */

declare(strict_types=1);

/* Читаем настройки один раз за запрос. Файла нет — работаем на запасных
   значениях, они прописаны в местах вызова. */
function mailToolsConfig(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $config = [];
    $file = __DIR__ . '/../../site-mail-config.php';
    if (is_readable($file)) {
        $loaded = require $file;
        if (is_array($loaded)) {
            $config = $loaded;
        }
    }

    return $config;
}

function mailToolsSetting(string $key, string $fallback): string
{
    $value = mailToolsConfig()[$key] ?? null;
    return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
}

function mailToolsFlag(string $key, bool $fallback): bool
{
    $value = mailToolsConfig()[$key] ?? null;
    return is_bool($value) ? $value : $fallback;
}

/* Ответ без тела. Приёмникам согласия этого хватает, и лишние подробности
   не подсказывают, как по скрипту стучать. */
function mailToolsDone(int $status = 204): void
{
    http_response_code($status);
    exit;
}

function mailToolsJson(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/* Строки от посетителя. Переводы строк вырезаются: с ними в письмо можно
   было бы дописать свой заголовок. */
function mailToolsClean(string $value, int $limit): string
{
    $value = trim(str_replace(["\r", "\n", "\0"], ' ', $value));
    if ($value === '') {
        return '';
    }
    if (mb_strlen($value) > $limit) {
        $value = mb_substr($value, 0, $limit) . '…';
    }
    return $value;
}

/* Значение поля формы. Массив вместо строки — это уже не наш посетитель. */
function mailToolsField(string $name, int $limit): string
{
    $raw = $_POST[$name] ?? '';
    return is_string($raw) ? mailToolsClean($raw, $limit) : '';
}

/* Запрос обязан прийти со своей же страницы. Чужая страница, вставившая к
   себе этот адрес, письма не вызовет. */
function mailToolsSameOrigin(): bool
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return true;
    }
    $host = $_SERVER['HTTP_HOST'] ?? '';
    return parse_url($origin, PHP_URL_HOST) === parse_url('http://' . $host, PHP_URL_HOST);
}

function mailToolsIp(): string
{
    /* Заголовок от прокси читаем, только если так сказано в настройках:
       напрямую его подделывает кто угодно. За CDN, наоборот, без него все
       посетители сольются в один адрес. */
    if (mailToolsFlag('trust_proxy', false)) {
        $forwarded = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($forwarded !== '') {
            $first = trim(explode(',', $forwarded)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }
    }

    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/**
 * Учёт обращений. Держит один файл на приёмник: кто уже обращался и сколько
 * писем ушло в текущий час. Файл под замком, поэтому два одновременных
 * посетителя не затрут учёт друг друга.
 *
 * $options:
 *   window      — сколько секунд помнить посетителя;
 *   limit       — сколько писем в час максимум;
 *   skipRepeat  — не глушить повторы (нужно на проверке).
 *
 * Возвращает число пропущенных ранее обращений, если письмо слать надо,
 * и null, если не надо: посетитель уже обращался или упёрлись в предел.
 */
function mailToolsThrottle(string $stateFile, string $fingerprint, int $now, array $options): ?int
{
    $window = (int) ($options['window'] ?? 86400);
    $limit = (int) ($options['limit'] ?? 60);
    $skipRepeat = (bool) ($options['skipRepeat'] ?? false);

    $handle = @fopen($stateFile, 'c+');
    if ($handle === false) {
        /* Учёт недоступен — письмо всё равно уходит. Лучше лишнее письмо,
           чем потерянная заявка. */
        return 0;
    }

    flock($handle, LOCK_EX);
    $state = json_decode((string) stream_get_contents($handle), true);
    if (!is_array($state)) {
        $state = [];
    }

    $seen = is_array($state['seen'] ?? null) ? $state['seen'] : [];
    $hour = is_array($state['hour'] ?? null) ? $state['hour'] : [];

    /* Забываем старых посетителей, иначе файл растёт без края. */
    foreach ($seen as $key => $time) {
        if (!is_int($time) || $time < $now - $window) {
            unset($seen[$key]);
        }
    }

    $repeat = !$skipRepeat && isset($seen[$fingerprint]);
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
        /* Тот же посетитель в то же окно — письмо уже было. */
    } elseif ($sent >= $limit) {
        $skipped++;
    } else {
        $result = $skipped;
        $sent++;
        $skipped = 0;
    }

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, (string) json_encode([
        'seen' => $seen,
        'hour' => ['start' => $start, 'sent' => $sent, 'skipped' => $skipped],
    ]));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $result;
}

/* Кириллица в теме и в имени отправителя кодируется: голый UTF-8 в
   заголовке письма читается не везде. */
function mailToolsEncode(string $text): string
{
    return '=?UTF-8?B?' . base64_encode($text) . '?=';
}

/**
 * Отправка. $replyTo — адрес посетителя, если письмо разумно на него
 * отвечать; пустая строка, если нет. Возвращает то же, что mail():
 * приняла ли почтовая служба письмо. Это ещё не доставка, но по такому
 * ответу видно, что отправка вообще состоялась.
 */
function mailToolsSend(string $to, string $subject, array $lines, string $replyTo = ''): bool
{
    $from = mailToolsSetting('from', 'no-reply@rks-nr.ru');

    $headers = [
        'From: ' . mailToolsEncode('Сайт РКС-НР') . ' <' . $from . '>',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'MIME-Version: 1.0',
    ];

    /* Адрес проверяем ещё раз перед тем, как ставить в заголовок: сюда он
       приходит от посетителя. */
    if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL) !== false) {
        $headers[] = 'Reply-To: ' . $replyTo;
    }

    return @mail(
        $to,
        mailToolsEncode($subject),
        implode("\r\n", $lines),
        implode("\r\n", $headers)
    );
}
