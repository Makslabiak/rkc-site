/* Форма обратной связи. Заявка уходит на contact-form.php, тот шлёт письмо.
   Здесь проверка полей, отправка и показ ответа; те же поля скрипт проверяет
   ещё раз на сервере.

   Это основа. Когда сайт переедет на Bitrix, заявки разумно перевести на
   компонент веб-форм (`bitrix:form.result.new`): он принесёт свой обработчик,
   токен и капчу, а с ними хранение заявок в админке. Имена полей и состояния
   `.is-error` при этом сохранить, иначе поедут стили и подсказки. */
(function initContactForm() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const fields = Array.from(form.querySelectorAll('[data-field]'));
  const consent = form.querySelector('[data-consent]');
  const consentInput = consent?.querySelector('input');
  const phone = form.querySelector('#contact-phone');
  const status = form.querySelector('.contact-form__status');

  function setFieldState(field, invalid) {
    field.classList.toggle('is-error', invalid);
    const input = field.querySelector('input, textarea');
    if (input) input.setAttribute('aria-invalid', String(invalid));
  }

  function validateField(field) {
    const input = field.querySelector('input, textarea');
    if (!input) return true;
    const invalid = !input.checkValidity();
    setFieldState(field, invalid);
    return !invalid;
  }

  function validateConsent() {
    const invalid = !consentInput?.checked;
    consent?.classList.toggle('is-error', invalid);
    return !invalid;
  }

  fields.forEach((field) => {
    const input = field.querySelector('input, textarea');
    input?.addEventListener('focus', () => setFieldState(field, false));
    input?.addEventListener('input', () => {
      if (input.value.trim() || input.type === 'email') validateField(field);
      if (status) status.hidden = true;
    });
    input?.addEventListener('blur', () => validateField(field));
  });

  consentInput?.addEventListener('focus', () => consent?.classList.remove('is-error'));
  consentInput?.addEventListener('change', () => {
    validateConsent();
    if (status) status.hidden = true;
  });

  phone?.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g, '').replace(/^7/, '').slice(0, 10);
    phone.value = digits ? `+7 ${digits}` : '';
  });

  const ENDPOINT = 'contact-form.php';
  const submit = form.querySelector('.contact-form__submit');
  const SUCCESS = status?.textContent ?? 'Спасибо, заявка отправлена.';
  let sending = false;

  function showStatus(text, failed) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('contact-form__status--error', failed);
    status.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;

    const fieldsValid = fields.map(validateField).every(Boolean);
    const consentValid = validateConsent();
    if (!fieldsValid || !consentValid) {
      const firstInvalid = form.querySelector('[aria-invalid="true"], .contact-consent.is-error input');
      firstInvalid?.focus();
      return;
    }

    /* Пока запрос идёт, кнопка заперта: иначе нетерпеливый посетитель
       отправит одну и ту же заявку трижды. */
    sending = true;
    if (submit) submit.disabled = true;
    if (status) status.hidden = true;

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
      });

      /* Ответ разбираем осторожно: на статическом хостинге вместо JSON
         прилетит страница ошибки, и разбор упадёт. */
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (response.ok && payload?.ok) {
        form.reset();
        fields.forEach((field) => setFieldState(field, false));
        consent?.classList.remove('is-error');
        showStatus(SUCCESS, false);
      } else {
        showStatus(
          payload?.error || 'Не получилось отправить заявку. Попробуйте ещё раз или позвоните нам.',
          true
        );
      }
    } catch (error) {
      /* Сеть отвалилась или сервера нет. Заявку не теряем: поля остаются
         заполненными, человек может нажать ещё раз. */
      showStatus('Связь с сайтом прервалась. Проверьте интернет и попробуйте ещё раз.', true);
    } finally {
      sending = false;
      if (submit) submit.disabled = false;
    }
  });
})();

(function initContactMap() {
  const map = document.querySelector('[data-map]');
  if (!map) return;

  const preview = map.querySelector('[data-map-preview]');
  const toggle = map.querySelector('[data-map-toggle]');
  const frame = map.querySelector('[data-map-frame]');
  const currentText = toggle?.querySelector('.button__text--current');
  const hoverText = toggle?.querySelector('.button__text--hover');

  if (!preview || !toggle || !frame) return;

  function setExpanded(expanded) {
    map.classList.toggle('is-expanded', expanded);
    preview.hidden = expanded;
    frame.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));

    if (expanded && !frame.src && frame.dataset.src) {
      frame.src = frame.dataset.src;
    }

    const label = expanded ? 'Свернуть карту' : 'Развернуть карту';
    if (currentText) currentText.textContent = label;
    if (hoverText) hoverText.textContent = label;
  }

  toggle.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
  });
})();
