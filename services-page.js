(function initServiceAccordion() {
  const items = Array.from(document.querySelectorAll('.service-accordion__item'));
  if (!items.length) return;

  const reduceMotion = window.rksReduceMotion();
  const easing = 'cubic-bezier(.4, 0, .2, 1)';
  const openDuration = 520;
  const closeDuration = 420;
  const contentOffset = 'translate3d(0, -48px, 0)';
  const scrollOffset = 100;
  const accordion = items[0].closest('.service-accordion');
  const hoverMedia = window.matchMedia('(min-width: 1200px) and (hover: hover)');
  let deferredScrollTimer = 0;
  let hoveredItem = null;
  let hoverFrame = 0;

  function positionHoverIndicator(item, initial = false) {
    if (!accordion || !hoverMedia.matches || !item) return;

    const accordionRect = accordion.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    accordion.style.setProperty('--service-hover-y', `${itemRect.top - accordionRect.top}px`);
    accordion.style.setProperty('--service-hover-height', `${itemRect.height}px`);
    /* Общая стрелка едет по этим же переменным. На раскрытом пункте её
       прячем: там уже стоит собственная кнопка закрытия. */
    accordion.classList.toggle('is-hover-open', item.classList.contains('is-open'));

    if (initial) {
      accordion.classList.add('is-hover-initializing');
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        accordion.classList.remove('is-hover-initializing');
      });
    }
  }

  function activateHover(item) {
    if (!accordion || !hoverMedia.matches) return;
    const initial = !hoveredItem;
    hoveredItem = item;
    items.forEach((otherItem) => otherItem.classList.toggle('is-hovered', otherItem === item));
    positionHoverIndicator(item, initial);
    accordion.classList.add('has-hover');
  }

  function clearHover() {
    hoveredItem = null;
    items.forEach((item) => item.classList.remove('is-hovered'));
    accordion?.classList.remove('has-hover', 'is-hover-initializing', 'is-hover-open');
  }

  function stopCurrentScroll() {
    if (window.lenis && typeof window.lenis.scrollTo === 'function') {
      const currentScroll = Number.isFinite(window.lenis.animatedScroll)
        ? window.lenis.animatedScroll
        : window.scrollY;
      window.lenis.scrollTo(currentScroll, { immediate: true, force: true });
      return;
    }

    window.scrollTo({ top: window.scrollY, left: 0, behavior: 'auto' });
  }

  function getScrollTarget(item) {
    const currentScroll = window.lenis && Number.isFinite(window.lenis.animatedScroll)
      ? window.lenis.animatedScroll
      : window.scrollY;
    return Math.max(0, item.getBoundingClientRect().top + currentScroll - scrollOffset);
  }

  function getScrollLimit() {
    if (window.lenis && Number.isFinite(window.lenis.limit)) return window.lenis.limit;
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function scrollToItem(item) {
    const top = getScrollTarget(item);

    if (!reduceMotion && window.lenis && typeof window.lenis.scrollTo === 'function') {
      window.lenis.scrollTo(top, {
        duration: 0.8,
        easing: (time) => 1 - Math.pow(1 - time, 3),
        lock: true,
        force: true
      });
      return;
    }

    window.scrollTo({
      top,
      left: 0,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }

  function setItemState(item, open, animate = true) {
    const button = item.querySelector('.service-accordion__header');
    const panel = item.querySelector('.service-accordion__panel');
    const panelInner = panel?.querySelector('.service-accordion__panel-inner');
    if (!button || !panel || !panelInner) return;

    const wasHidden = panel.hidden;
    const currentHeight = wasHidden ? 0 : panel.getBoundingClientRect().height;
    const currentTransform = getComputedStyle(panelInner).transform;
    panel.getAnimations().forEach((animation) => animation.cancel());
    panelInner.getAnimations().forEach((animation) => animation.cancel());
    button.setAttribute('aria-expanded', String(open));
    item.classList.toggle('is-open', open);

    if (!animate || reduceMotion) {
      panel.hidden = !open;
      clearPanelStyles(panel);
      return;
    }

    panel.hidden = false;
    panel.style.overflow = 'hidden';
    panel.style.willChange = 'height';

    if (open) {
      const targetHeight = panel.scrollHeight;
      const contentAnimation = panelInner.animate(
        [
          { transform: wasHidden || currentTransform === 'none' ? contentOffset : currentTransform },
          { transform: 'translate3d(0, 0, 0)' }
        ],
        { duration: openDuration, easing, fill: 'both' }
      );
      const animation = panel.animate(
        [
          { height: `${currentHeight}px` },
          { height: `${targetHeight}px` }
        ],
        { duration: openDuration, easing }
      );
      animation.addEventListener('finish', () => {
        contentAnimation.cancel();
        clearPanelStyles(panel);
      }, { once: true });
    } else {
      const contentAnimation = panelInner.animate(
        [
          { transform: currentTransform === 'none' ? 'translate3d(0, 0, 0)' : currentTransform },
          { transform: contentOffset }
        ],
        { duration: closeDuration, easing, fill: 'both' }
      );
      const animation = panel.animate(
        [
          { height: `${currentHeight}px` },
          { height: '0px' }
        ],
        { duration: closeDuration, easing }
      );
      animation.addEventListener('finish', () => {
        panel.hidden = true;
        contentAnimation.cancel();
        clearPanelStyles(panel);
      }, { once: true });
    }
  }

  function clearPanelStyles(panel) {
    panel.style.removeProperty('height');
    panel.style.removeProperty('overflow');
    panel.style.removeProperty('will-change');
  }

  items.forEach((item) => {
    const button = item.querySelector('.service-accordion__header');
    item.addEventListener('pointerenter', () => activateHover(item));
    button?.addEventListener('focus', () => activateHover(item));

    button?.addEventListener('click', () => {
      window.clearTimeout(deferredScrollTimer);
      stopCurrentScroll();
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      const hasAnotherOpenItem = items.some((otherItem) => (
        otherItem !== item && otherItem.classList.contains('is-open')
      ));
      items.forEach((otherItem) => {
        if (otherItem !== item && otherItem.classList.contains('is-open')) {
          setItemState(otherItem, false);
        }
      });
      setItemState(item, willOpen);
      requestAnimationFrame(() => positionHoverIndicator(hoveredItem));
      if (willOpen) {
        // The closing panel changes the position of every item below it.
        // Measure the target only after that collapse has finished.
        const needsReflowBeforeScroll = hasAnotherOpenItem;
        if (needsReflowBeforeScroll || getScrollTarget(item) > getScrollLimit()) {
          deferredScrollTimer = window.setTimeout(() => {
            if (!item.classList.contains('is-open')) return;
            window.lenis?.resize?.();
            scrollToItem(item);
          }, needsReflowBeforeScroll ? closeDuration + 40 : openDuration + 40);
        } else {
          scrollToItem(item);
        }
      }
    });
  });

  accordion?.addEventListener('pointerleave', clearHover);
  accordion?.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!accordion.contains(document.activeElement)) clearHover();
    });
  });

  if ('ResizeObserver' in window && accordion) {
    const hoverResizeObserver = new ResizeObserver(() => {
      if (hoveredItem) positionHoverIndicator(hoveredItem);
    });
    hoverResizeObserver.observe(accordion);
    items.forEach((item) => hoverResizeObserver.observe(item));
  }

  hoverMedia.addEventListener?.('change', () => {
    clearHover();
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
