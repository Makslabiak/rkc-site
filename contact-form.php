<?php
/**
 * Приём заявки с формы обратной связи и письмо заказчику.
 *
 * Форма живёт на contacts.html, отправляет её contacts-page.js. Проверка
 * полей есть и там, и здесь: браузерная — чтобы человек сразу видел ошибку,
 * серверная — потому что мимо страницы сюда может постучать кто угодно.
 *
 * Это основа, а не окончательное решение. Когда сайт переедет на Bitrix,
 * заявки разумно перевести на компонент веб-форм: он принесёт свой
 * обработчик, токен и капчу, а с ними хранение заявок в админке. Разметку
 * формы и имена полей при этом сохранить.
 *
 * Общая часть с приёмником согласия — includes/mail-tools.php, там же
 * сказано, где лежат настройки с адресами почты.
 *
 * Ответ — JSON: {"ok":true} либо {"ok":false,"error":"текст для человека"}.
 */

declare(strict_types=1);

require __DIR__ . '/includes/mail-tools.php';

/* Сколько заявок в час принимаем со всего сайта. Выше этого письма не
   уходят: столько заявок за час — это не люди. */
const FORM_HOURLY_LIMIT = 30;

/* Сколько секунд помнить отправителя, чтобы не принимать вторую заявку
   сразу же. Пять минут: человеку хватает, кнопке, нажатой дважды, тем более. */
const FORM_REPEAT_WINDOW = 300;

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    mailToolsJson(405, ['ok' => false, 'error' => 'Метод не поддерживается.']);
}

if (!mailToolsSameOrigin()) {
    mailToolsJson(403, ['ok' => false, 'error' => 'Заявка пришла не с сайта.']);
}

/* Поле-ловушка. В форме оно спрятано, человек его не видит и не заполнит,
   а простой рассылочный робот заполняет всё подряд. Такой заявке отвечаем
   как обычной, но письма не шлём: пусть считает, что всё удалось. */
if (mailToolsField('company_site', 100) !== '') {
    mailToolsJson(200, ['ok' => true]);
}

$name = mailToolsField('name', 100);
$organization = mailToolsField('organization', 150);
$phone = mailToolsField('phone', 30);
$email = mailToolsField('email', 150);
$message = mailToolsField('message', 3000);
$consent = ($_POST['consent'] ?? '') !== '';

$errors = [];
if ($name === '') {
    $errors[] = 'имя';
}
if (preg_match_all('/\d/', $phone) < 11) {
    $errors[] = 'телефон';
}
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    $errors[] = 'почта';
}
if (!$consent) {
    $errors[] = 'согласие на обработку данных';
}

if ($errors !== []) {
    mailToolsJson(422, [
        'ok' => false,
        'error' => 'Проверьте поля: ' . implode(', ', $errors) . '.',
    ]);
}

$now = time();
$ip = mailToolsIp();
$agent = mailToolsClean((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 300);
$fingerprint = hash('sha256', $ip . '|' . $agent);

$skipped = mailToolsThrottle(
    __DIR__ . '/../contact-form-state.json',
    $fingerprint,
    $now,
    [
        'window' => FORM_REPEAT_WINDOW,
        'limit' => FORM_HOURLY_LIMIT,
        'skipRepeat' => false,
    ]
);

if ($skipped === null) {
    mailToolsJson(429, [
        'ok' => false,
        'error' => 'Заявка уже отправлена. Если нужно дополнить, напишите через несколько минут.',
    ]);
}

$when = (new DateTimeImmutable('@' . $now))
    ->setTimezone(new DateTimeZone('Europe/Moscow'))
    ->format('d.m.Y H:i') . ' МСК';

$lines = [
    'Заявка с формы обратной связи на сайте.',
    '',
    'Имя: ' . $name,
    'Организация: ' . ($organization === '' ? '—' : $organization),
    'Телефон: ' . $phone,
    'Почта: ' . $email,
    '',
    'Сообщение:',
    $message === '' ? '—' : $message,
    '',
    'Отправлено: ' . $when,
    'Адрес отправителя: ' . ($ip === '' ? '—' : $ip),
];

if ($skipped > 0) {
    $lines[] = '';
    $lines[] = 'С прошлого письма заявок было ещё ' . $skipped
        . '. Письма по ним не отправлялись: сработал часовой предел.';
}

/* Пока в настройках задан адрес для проверки, заявки идут на него. */
$testTo = mailToolsSetting('form_test_to', '');
$to = $testTo !== '' ? $testTo : mailToolsSetting('form_to', 'mail@rks-nr.ru');

$subject = ($testTo !== '' ? 'Проверка: заявка с сайта' : 'Заявка с сайта') . ' — ' . $name;

/* Reply-To ставим на почту отправителя: ответ из ящика уйдёт сразу ему.
   Адрес перед этим ещё раз проверяется внутри mailToolsSend. */
$sent = mailToolsSend($to, $subject, $lines, $email);

if (!$sent) {
    mailToolsJson(500, [
        'ok' => false,
        'error' => 'Не удалось отправить заявку. Позвоните нам или напишите на почту из раздела контактов.',
    ]);
}

mailToolsJson(200, ['ok' => true]);
