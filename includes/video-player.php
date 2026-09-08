<?php
/**
 * Шаблон видеоблока для Bitrix.
 *
 * Контракт (всё необязательно, кроме источника):
 *
 *   $siteVideo = [
 *       'src'      => '/upload/iblock/xxx/company.mp4', // одиночный источник
 *       'sources'  => [                                 // либо несколько
 *           ['src' => '/upload/.../company.webm', 'type' => 'video/webm'],
 *           ['src' => '/upload/.../company.mp4',  'type' => 'video/mp4'],
 *       ],
 *       'poster'   => '/upload/.../cover.jpg',
 *       'title'    => 'Видео о компании',   // подпись и aria-label
 *       'alt'      => 'Строительство ЖК',   // alt обложки, по умолчанию title
 *       'ticker'   => 'Первые в строительстве новой истории', // рамка-бегущая строка
 *       'tracks'   => [                     // субтитры WebVTT
 *           ['src' => '/upload/.../ru.vtt', 'srclang' => 'ru',
 *            'label' => 'Русские', 'default' => true],
 *       ],
 *       'preload'  => 'metadata',           // none | metadata | auto
 *       'loop'     => false,
 *       'muted'    => false,
 *       'section'  => true,                 // обернуть в <section class="video-section">
 *   ];
 *   include $_SERVER['DOCUMENT_ROOT'] . '/includes/video-player.php';
 *
 * Файлы инфоблока превращаются в пути через CFile::GetPath($id).
 *
 * ВАЖНО для перемотки: файл должен отдаваться веб-сервером напрямую из
 * /upload/ с заголовком Accept-Ranges: bytes. Если видео проксируется через
 * PHP (CFile::ViewByUser и подобное) без поддержки HTTP Range, браузер не
 * умеет перематывать и при клике по ползунку начинает ролик сначала.
 *
 * Подключить один раз на страницу: styles.css и video-player.js.
 * После AJAX-вставки блока вызвать window.RKSVideoPlayer.init(container).
 */
(static function (array $data) {
    $escape = static function ($value) {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    };

    /** Пропускаем только локальные абсолютные пути и http(s); никаких javascript:/data:. */
    $url = static function ($value) {
        $value = trim((string) $value);
        return preg_match('~^(?:/(?!/)|https?://)~i', $value) ? $value : '';
    };

    $mimeByExtension = static function (string $path): string {
        $map = [
            'mp4' => 'video/mp4',
            'm4v' => 'video/mp4',
            'webm' => 'video/webm',
            'ogv' => 'video/ogg',
            'ogg' => 'video/ogg',
            'mov' => 'video/quicktime',
        ];
        $extension = strtolower(pathinfo(parse_url($path, PHP_URL_PATH) ?: $path, PATHINFO_EXTENSION));
        return $map[$extension] ?? 'video/mp4';
    };

    // Источники: сначала явный список, затем одиночный src как запасной вариант.
    $sources = [];
    foreach ((array) ($data['sources'] ?? []) as $source) {
        $path = $url(is_array($source) ? ($source['src'] ?? '') : $source);
        if ($path === '') continue;
        $type = is_array($source) ? trim((string) ($source['type'] ?? '')) : '';
        $sources[] = ['src' => $path, 'type' => $type !== '' ? $type : $mimeByExtension($path)];
    }
    if (!$sources) {
        $path = $url($data['src'] ?? '');
        if ($path !== '') $sources[] = ['src' => $path, 'type' => $mimeByExtension($path)];
    }
    if (!$sources) return;

    $tracks = [];
    foreach ((array) ($data['tracks'] ?? []) as $track) {
        $path = $url($track['src'] ?? '');
        if ($path === '') continue;
        $kind = (string) ($track['kind'] ?? 'subtitles');
        $tracks[] = [
            'src' => $path,
            'kind' => in_array($kind, ['subtitles', 'captions', 'descriptions'], true) ? $kind : 'subtitles',
            'srclang' => trim((string) ($track['srclang'] ?? 'ru')) ?: 'ru',
            'label' => trim((string) ($track['label'] ?? 'Субтитры')) ?: 'Субтитры',
            'default' => !empty($track['default']),
        ];
    }

    $poster = $url($data['poster'] ?? '');
    $title = trim((string) ($data['title'] ?? '')) ?: 'Видео';
    $alt = trim((string) ($data['alt'] ?? '')) ?: $title;
    $ticker = trim((string) ($data['ticker'] ?? ''));
    $preload = (string) ($data['preload'] ?? 'metadata');
    if (!in_array($preload, ['none', 'metadata', 'auto'], true)) {
        $preload = 'metadata';
    }
    $withSection = !array_key_exists('section', $data) || !empty($data['section']);
?>
<?php if ($withSection): ?><section class="video-section" aria-label="<?= $escape($title) ?>"><?php endif; ?>
  <div class="video-frame" data-video-player>
    <?php if ($ticker !== ''): ?>
      <?php foreach (['top', 'right', 'bottom', 'left'] as $edge): ?>
        <div class="video-frame__ticker video-frame__ticker--<?= $edge ?>" aria-hidden="true"><?= $escape($ticker) ?></div>
      <?php endforeach; ?>
    <?php endif; ?>
    <?php /* .image-tone — слой обложки под общим дизером. Плеер строит рядом
             с ним .video-frame__stage и переносит туда видео и управление. */ ?>
    <div class="video-frame__media image-tone image-tone--hero">
      <?php if ($poster !== ''): ?><img src="<?= $escape($poster) ?>" alt="<?= $escape($alt) ?>"><?php endif; ?>
    </div>
    <?php
    // controls — запасной вариант: если JavaScript не выполнится, видео
    // всё равно останется управляемым нативными кнопками браузера.
    $videoAttributes = 'class="video-frame__video" preload="' . $escape($preload) . '"'
        . ' playsinline webkit-playsinline controls'
        . ($poster !== '' ? ' poster="' . $escape($poster) . '"' : '')
        . (!empty($data['loop']) ? ' loop' : '')
        . (!empty($data['muted']) ? ' muted' : '')
        . ' aria-label="' . $escape($title) . '"';
    ?>
    <video <?= $videoAttributes ?>>
      <?php foreach ($sources as $source): ?>
        <source src="<?= $escape($source['src']) ?>" type="<?= $escape($source['type']) ?>">
      <?php endforeach; ?>
      <?php foreach ($tracks as $track): ?>
        <track kind="<?= $escape($track['kind']) ?>" src="<?= $escape($track['src']) ?>"
               srclang="<?= $escape($track['srclang']) ?>" label="<?= $escape($track['label']) ?>"<?= $track['default'] ? ' default' : '' ?>>
      <?php endforeach; ?>
      <p>Ваш браузер не поддерживает встроенное видео.
        <a href="<?= $escape($sources[0]['src']) ?>">Скачать ролик</a>.</p>
    </video>
    <button class="play-button" type="button" aria-label="Воспроизвести видео">
      <img src="/assets/icons/play.svg" width="127" height="127" alt="">
    </button>
  </div>
<?php if ($withSection): ?></section><?php endif; ?>
<?php
})((array) ($siteVideo ?? []));
