/* Галерея новости. Снимков может быть любое количество: скрипт сам считает
   те, у которых есть картинка, и прячет пустые заготовки вместе со всей
   галереей, если фотографий нет.

   Перетаскивание мышью нужно только там, где галерея едет вбок, — на
   планшете. На телефоне и десктопе фотографии идут столбиком, и слайдера
   нет. */
(function initNewsDetailGallery() {
  const galleries = Array.from(document.querySelectorAll('[data-news-gallery]'));
  if (!galleries.length) return;

  const sliderMedia = window.matchMedia('(min-width: 600px) and (max-width: 1199px)');
  let refreshFrame = 0;

  function scheduleLayoutRefresh() {
    window.cancelAnimationFrame(refreshFrame);
    refreshFrame = window.requestAnimationFrame(() => {
      window.ScrollTrigger?.refresh();
      window.lenis?.resize?.();
      window.__rksDitherRefresh?.();
      window.__rksScrollbarRefresh?.();
    });
  }

  galleries.forEach((gallery) => {
    let initialized = false;
    let imageCount = 0;
    let pointerId = null;
    let pointerStartX = 0;
    let scrollStartX = 0;
    let dragged = false;

    function syncGallery() {
      const items = Array.from(gallery.children);
      imageCount = 0;

      items.forEach((item) => {
        const image = item.querySelector('img');
        const source = image?.getAttribute('src')?.trim();
        const hasImage = Boolean(source);

        item.hidden = !hasImage;
        if (hasImage) imageCount += 1;
      });

      gallery.dataset.galleryCount = String(imageCount);
      gallery.hidden = imageCount === 0;

      if (initialized) scheduleLayoutRefresh();
      initialized = true;
    }

    function finishDrag(event) {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      if (gallery.hasPointerCapture?.(pointerId)) gallery.releasePointerCapture(pointerId);
      pointerId = null;
      gallery.classList.remove('is-dragging');

      if (!dragged) return;
      const visibleItems = Array.from(gallery.children).filter((item) => !item.hidden);
      const padding = parseFloat(getComputedStyle(gallery).scrollPaddingLeft) || 0;
      const closest = visibleItems.reduce((best, item) => {
        const distance = Math.abs(item.offsetLeft - padding - gallery.scrollLeft);
        return !best || distance < best.distance ? { item, distance } : best;
      }, null);
      if (closest) {
        gallery.scrollTo({
          left: closest.item.offsetLeft - padding,
          behavior: 'smooth'
        });
      }
    }

    gallery.addEventListener('pointerdown', (event) => {
      if (!sliderMedia.matches || imageCount < 2 || event.pointerType === 'touch' || event.button !== 0) return;
      pointerId = event.pointerId;
      pointerStartX = event.clientX;
      scrollStartX = gallery.scrollLeft;
      dragged = false;
      gallery.setPointerCapture?.(pointerId);
      gallery.classList.add('is-dragging');
    });

    gallery.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const distance = event.clientX - pointerStartX;
      dragged = dragged || Math.abs(distance) > 3;
      gallery.scrollLeft = scrollStartX - distance;
      event.preventDefault();
    });

    gallery.addEventListener('pointerup', finishDrag);
    gallery.addEventListener('pointercancel', finishDrag);

    syncGallery();

    const observer = new MutationObserver(syncGallery);
    observer.observe(gallery, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  });
})();
