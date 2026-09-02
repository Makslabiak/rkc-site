(function initServiceAccordion() {
  const items = Array.from(document.querySelectorAll('.service-accordion__item'));
  if (!items.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setItemState(item, open, animate = true) {
    const button = item.querySelector('.service-accordion__header');
    const panel = item.querySelector('.service-accordion__panel');
    if (!button || !panel) return;

    panel.getAnimations().forEach((animation) => animation.cancel());
    button.setAttribute('aria-expanded', String(open));
    item.classList.toggle('is-open', open);

    if (!animate || reduceMotion) {
      panel.hidden = !open;
      panel.style.removeProperty('height');
      panel.style.removeProperty('overflow');
      return;
    }

    if (open) {
      panel.hidden = false;
      const targetHeight = panel.scrollHeight;
      panel.style.overflow = 'hidden';
      const animation = panel.animate(
        [{ height: '0px', opacity: 0 }, { height: `${targetHeight}px`, opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' }
      );
      animation.addEventListener('finish', () => {
        panel.style.removeProperty('height');
        panel.style.removeProperty('overflow');
      }, { once: true });
    } else {
      const startHeight = panel.getBoundingClientRect().height;
      panel.style.overflow = 'hidden';
      const animation = panel.animate(
        [{ height: `${startHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 320, easing: 'cubic-bezier(.4, 0, 1, 1)' }
      );
      animation.addEventListener('finish', () => {
        panel.hidden = true;
        panel.style.removeProperty('height');
        panel.style.removeProperty('overflow');
      }, { once: true });
    }
  }

  items.forEach((item) => {
    const button = item.querySelector('.service-accordion__header');
    button?.addEventListener('click', () => {
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      items.forEach((otherItem) => {
        if (otherItem !== item && otherItem.classList.contains('is-open')) {
          setItemState(otherItem, false);
        }
      });
      setItemState(item, willOpen);
    });
  });

  const openFromHash = () => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    if (!target?.classList.contains('service-accordion__item')) return;
    items.forEach((item) => setItemState(item, item === target, false));
  };

  openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
