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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fieldsValid = fields.map(validateField).every(Boolean);
    const consentValid = validateConsent();
    if (!fieldsValid || !consentValid) {
      const firstInvalid = form.querySelector('[aria-invalid="true"], .contact-consent.is-error input');
      firstInvalid?.focus();
      return;
    }

    if (status) status.hidden = false;
  });
})();
