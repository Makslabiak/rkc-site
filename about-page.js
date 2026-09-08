(function initLeadershipModal() {
  const modal = document.querySelector('[data-leadership-modal]');
  const backdrop = document.querySelector('[data-person-backdrop]');
  const triggers = Array.from(document.querySelectorAll('[data-person]'));
  if (!modal || !triggers.length) return;

  const people = [
    { name: 'Шарипов Ильдар', role: 'Генеральный директор', image: 'assets/images/about/team-01.webp', education: ['Казанский государственный технический университет им. А.Н. Туполева. Инженер по специальности «Теплофизик».', 'Московская академия государственного и муниципального управления.', 'Институт управления инвестиционными проектами Федерального автономного учреждения «РосКапСтрой» по программе «Технический заказчик».'], experience: '17 лет', activity: 'До работы в ООО «РКС-НР» занимал руководящие должности в ГК «Олимпстрой», ООО «Объединенная дирекция по проектированию и строительству Центра разработки и коммерциализации новых технологий инновационного центра «Сколково», ООО «Гравион-Констракшн», АО «Москапстрой».', awards: ['2010 — Благодарность Государственной корпорации по строительству олимпийских объектов и развитию города Сочи как горноклиматического курорта (ГК «Олимпстрой» г. Сочи)', '2022 — Знак «Почетный строитель России»', '2023 — Знак «Почетный строитель Донецкой Народной Республики»', '2023 — Знак «За заслуги перед Донецкой Народной Республикой III степени»', '2023 — Медаль Ордена «За заслуги перед отечеством» II степени', '2024 — Почетный знак Министерства строительства и жилищно-коммунального хозяйства Российской Федерации', '2025 — Медаль «За трудовую доблесть» Донецкой Народной Республики', '2025 — Медаль «За восстановление жилья и инфраструктуры» Министерства строительства и жилищно-коммунального хозяйства Российской Федерации'] },
    { name: 'Шевелев Роман', role: 'Первый заместитель генерального директора', image: 'assets/images/about/team-02.webp', education: ['Сочинский государственный университет туризма и курортного дела. Инженер по специальности «Городское строительство и хозяйство».'], experience: '12 лет', activity: 'До работы в ООО «РКС-НР» занимал руководящие должности в ООО «Объединенная дирекция по проектированию и строительству Центра разработки и коммерциализации новых технологий инновационного центра «Сколково», ООО «ГЭС-2», ООО «Гравион-Констракшн».', awards: ['2022 — Знак «Почетный строитель России»', '2023 — Благодарность Правительства Донецкой Народной Республики «За внесение значительного вклада в восстановление и развитие отрасли строительства ДНР»', '2023 — Знак «Почетный строитель Донецкой Народной Республики»', '2025 — Медаль «За восстановление жилья и инфраструктуры»', '2025 — Благодарность Главы Донецкой Народной Республики «За значительный вклад в восстановление объектов инфраструктуры Донецкой Народной Республики»'] },
    { name: 'Исламов Марат', role: 'Заместитель генерального директора по развитию', image: 'assets/images/about/team-03.webp', education: ['Казанский государственный технический университет им. А.Н. Туполева. Инженер по специальности «Теплофизика».', 'МВА во Всероссийской Академии Внешней Торговли по специальности «Международный бизнес».', 'Сертифицированный профессионал по управлению проектами (PMI).'], experience: '17 лет (включая строительство в энергетике)', activity: 'До работы в ООО «РКС-НР» занимал руководящие должности в УК «КЭР-Холдинг», ОАО «Мобильные газотурбинные электрические станции», ООО «Интер РАО-Экспорт» в проектах строительства электростанций в Республике Венесуэла, Республике Эквадор и Республике Куба.', awards: ['2022 — Благодарность Министерства строительства и жилищно-коммунального хозяйства Российской Федерации «За высокие производственные достижения и плодотворный труд»', '2023 — Благодарность Правительства Донецкой Народной Республики «За внесение значительного вклада в восстановление и развитие отрасли строительства ДНР»', '2024 — Знак «Почетный строитель России»', '2025 — Медаль «За безупречный труд и усердие» II степени'] },
    { name: 'Лопухов Константин', role: 'Заместитель генерального директора по строительству', image: 'assets/images/about/team-04.webp', education: ['Тульский Государственный Университет, направление «Менеджмент».'], experience: '22 года', activity: 'До работы в ООО «РКС-НР» занимал руководящие должности в ООО «Техпромсвязь», Администрации муниципального образования города Плавска, Администрации муниципального образования Плавского района, Фонде капитального ремонта Тульской области. С 06.2019 по 11.2022 был Министром строительства в Правительстве Тульской области.', awards: ['2014 — Благодарность Правительства Тульской области', '2022 — Благодарность Президента Российской Федерации «За достигнутые трудовые успехи и многолетнюю добросовестную работу»', '2022 — Благодарность Министерства строительства и жилищно-коммунального хозяйства Российской Федерации «За высокие производственные достижения и плодотворный труд»', '2023 — Знак «Почетный строитель Донецкой Народной Республики»', '2024 — Медаль «За безупречный труд и усердие» III степени'] },
    { name: 'Анкудинова Анна', role: 'Заместитель генерального директора по финансам', image: 'assets/images/about/team-05.webp', education: ['Ижевский государственный технический университет им. М.Т. Калашникова, Экономист-менеджер по специальности «Экономика и управление на предприятии (строительство)».'], experience: '17 лет', activity: 'До работы в ООО «РКС-НР» занимала руководящие должности в подведомственных учреждениях Министерства спорта, Министерства обороны Российской Федерации, работала главным бухгалтером в управляющей компании ЖКХ, в строительных коммерческих организациях.', awards: ['2023 — Благодарность Правительства Донецкой Народной Республики «За внесение значительного вклада в восстановление и развитие ДНР»', '2024 — Медаль «За безупречный труд и усердие» III степени'] },
    { name: 'Зайцев Роман', role: 'Руководитель договорно-правового департамента', image: 'assets/images/about/team-06.webp', education: ['Московский государственный университет имени М.В. Ломоносова по специальности «Финансовый менеджмент».'], experience: '13 лет - опыт работы в области реставрации и сохранения объектов культурного наследия.', activity: ['До работы в ООО «РКС-НР» руководил договорным отделом, возглавлял коммерческое направление ФГБУН Институт археологии РАН в области сохранения объектов культурного наследия.', 'Занимался пилотным проектом в учреждениях, подведомственных Департаменту культуры г. Москвы «Центра театра и кино на Поварской» под руководством Н.С. Михалкова, возглавлял договорно-правовой отдел, руководил контрактной службой.', 'Методологическое сопровождение в контрактной системе в сфере закупок в области сохранения объектов культурного наследия.', 'Энергетический, производственный технологический аудит и бюджетное управление в структурах РАО «ЕЭС России», разработка проблематики Киотского протокола.'], awards: ['2023 — Благодарность Министерства строительного комплекса Московской области', '2023 — Почетная грамота Федерального учреждения «РосКапСтрой»', '2023 — Благодарность Правительства Донецкой Народной Республики «За внесение значительного вклада в восстановление и развитие отрасли строительства ДНР»', '2024 — Медаль «За безупречный труд и усердие» III степени'] },
    { name: 'Дудина Екатерина', role: 'Руководитель Департамента ценообразования и сметного нормирования', image: 'assets/images/about/team-07.webp', education: ['Негосударственное высшее образовательное учреждение «Институт современной экономики». Экономист-менеджер по специальности «Экономика и управление на предприятии».'], experience: '17 лет', activity: 'До работы в ООО «РКС-НР» занимала различные, в том числе руководящие должности в ЗАО «ПК «Энергосервис», ЗАО «ПК «ИнжЭнергоСтрой», ООО «Объединенная дирекция по проектированию и строительству Центра разработки и коммерциализации новых технологий инновационного центра «Сколково».', awards: ['2023 — Благодарность Правительства Донецкой Народной Республики «За внесение значительного вклада в восстановление и развитие отрасли строительства ДНР»', '2023 — Благодарность Министерства строительства и жилищно-коммунального хозяйства Российской Федерации «За высокие производственные достижения и плодотворный труд»', '2024 — Медаль «За безупречный труд и усердие» III степени'] },
    { name: 'Белова Татьяна', role: 'Главный бухгалтер', image: 'assets/images/about/team-08.webp', education: ['АНО ВПО Центросоюза Российской Федерации «Российский университет кооперации», г. Москва.', 'Финансовый университет при Правительстве Российской Федерации, г. Москва.', 'Действительный член Института профессиональных бухгалтеров (ИПБ) России.'], experience: '16 лет', activity: 'До работы в ООО «РКС-НР» занимала руководящие должности в ООО «ЭСК „СОЮЗ“», ООО «СОЦЦЕНТРСТРОЙ», ООО «Русский Автомотоклуб», ООО «Электов».', awards: ['2023 — Благодарность Министерства строительства и жилищно-коммунального хозяйства Донецкой Народной Республики «За профессионализм и самоотверженный труд по восстановлению ДНР, а также плодотворную деятельность, направленную на развитие и совершенствование сферы строительства»', '2024 — Благодарность Министерства строительства и жилищно-коммунального хозяйства Российской Федерации', '2025 — Медаль «За безупречный труд и усердие» II степени'] }
  ];

  /* В исходных файлах портреты Шевелева и Лопухова названы в обратном
     порядке; явно закрепляем правильное соответствие и для модалки. */
  people[1].image = 'assets/images/about/team-04.webp';
  people[3].image = 'assets/images/about/team-02.webp';

  /* Модалка заполняется после общего прохода типографа из script.js,
     поэтому динамический текст обрабатываем непосредственно перед выводом. */
  function typograph(value) {
    let result = String(value)
      .replace(/\.\.\./g, '…')
      .replace(/[\t\n\r ]+(?:—|–|-)[\t\n\r ]+/g, '\u00A0—\u00A0')
      .replace(/([А-ЯЁ])\.\s*([А-ЯЁ])\.\s*/g, '$1.\u00A0$2.\u00A0')
      .replace(/(^|[^А-ЯЁа-яё])(им|г)\.\s+/gi, '$1$2.\u00A0')
      .replace(/№\s+(?=\d)/g, '№\u00A0')
      .replace(/(\d)\s+(?=(?:лет|год|года|кв\.|степени)(?:[^А-ЯЁа-яё]|$))/gi, '$1\u00A0')
      .replace(/(II|III|IV)\s+(?=степени(?:[^А-ЯЁа-яё]|$))/g, '$1\u00A0')
      .replace(/(^|[^А-ЯЁа-яё])(ООО|ОАО|АО|ГК|УК|РАО|РАН|РФ|ДНР)\s+(?=[«А-ЯЁ])/g, '$1$2\u00A0');

    /* Повторный проход нужен для цепочек коротких слов: «в том числе». */
    for (let pass = 0; pass < 3; pass += 1) {
      result = result.replace(
        /(^|[\s(«„])([А-ЯЁа-яё]{1,2})[\t\n\r ]+(?=[А-ЯЁа-яё0-9«„])/g,
        '$1$2\u00A0'
      );
    }
    return result;
  }

  const image = modal.querySelector('[data-person-image]');
  const name = modal.querySelector('[data-person-name]');
  const role = modal.querySelector('[data-person-role]');
  const count = modal.querySelector('[data-person-count]');
  const details = modal.querySelector('[data-person-details]');
  const scroller = modal.querySelector('.leadership-modal__body');
  const header = modal.querySelector('.leadership-modal__header');
  const personCard = modal.querySelector('.leadership-modal__person');
  scroller?.addEventListener('wheel', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(maxScroll, scroller.scrollTop + event.deltaY * deltaScale));
  }, { passive: false });
  let current = 0;
  let lenisWasStopped = false;
  let lastTrigger = null;
  let closeTimer;
  let modalMotion;
  let contentMotion;
  let isSwitching = false;

  function finishClose() {
    window.clearTimeout(closeTimer);
    modal.classList.remove('is-open', 'is-closing');
    modal.setAttribute('aria-hidden', 'true');
    backdrop?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('leadership-modal-open');
    if (!lenisWasStopped) window.lenis?.start();
    lastTrigger?.focus();
  }

  if (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const gsap = window.gsap;
    modal.classList.add('leadership-modal--gsap');
    gsap.set(modal, { '--leadership-modal-x': '100%', autoAlpha: 0 });
    gsap.set([header, personCard, details], { y: 18, autoAlpha: 0 });

    modalMotion = gsap.timeline({ paused: true, onReverseComplete: finishClose });
    modalMotion
      .to(modal, { '--leadership-modal-x': '0%', autoAlpha: 1, duration: .5, ease: 'power2.inOut' }, 0)
      .to(header, { y: 0, autoAlpha: 1, duration: .36, ease: 'power2.out' }, .12)
      .to(personCard, { y: 0, autoAlpha: 1, duration: .4, ease: 'power2.out' }, .26)
      .to(details, { y: 0, autoAlpha: 1, duration: .4, ease: 'power2.out' }, .41);
  }

  function render(index) {
    current = (index + people.length) % people.length;
    const person = people[current];
    image.src = person.image;
    image.alt = person.name;
    name.textContent = typograph(person.name);
    role.textContent = typograph(person.role);
    count.textContent = `${String(current + 1).padStart(2, '0')}-${String(people.length).padStart(2, '0')}`;
    details.replaceChildren();
    const activity = Array.isArray(person.activity) ? person.activity : [person.activity];
    [['Образование', person.education], ['Опыт в отрасли', [person.experience]], ['Профессиональная деятельность', activity], ['Награды', person.awards]].forEach(([label, values]) => {
      const row = document.createElement('div'); row.className = 'leadership-modal__detail';
      const caption = document.createElement('p'); caption.className = 'leadership-modal__detail-label'; caption.textContent = typograph(label);
      const value = document.createElement('div'); value.className = 'leadership-modal__detail-value';
      values.forEach((text) => { const paragraph = document.createElement('p'); paragraph.textContent = typograph(text); value.append(paragraph); });
      row.append(caption, value); details.append(row);
    });
    scroller.scrollTop = 0;
  }

  function switchPerson(offset) {
    if (isSwitching || !modal.classList.contains('is-open')) return;
    const nextIndex = (current + offset + people.length) % people.length;
    const gsap = window.gsap;
    if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      render(nextIndex);
      return;
    }

    isSwitching = true;
    contentMotion?.kill();
    const outgoingY = offset > 0 ? -18 : 18;
    const incomingY = -outgoingY;
    const targets = [count, personCard, details];

    contentMotion = gsap.timeline({
      onComplete: () => {
        isSwitching = false;
        contentMotion = null;
      }
    });
    contentMotion
      .to(targets, { y: outgoingY, autoAlpha: 0, duration: .22, stagger: .025, ease: 'power2.in' })
      .add(() => {
        render(nextIndex);
        gsap.set(targets, { y: incomingY, autoAlpha: 0 });
      })
      .to(targets, { y: 0, autoAlpha: 1, duration: .4, stagger: .06, ease: 'power2.out' });
  }

  function open(index, trigger) {
    window.clearTimeout(closeTimer);
    contentMotion?.kill();
    contentMotion = null;
    isSwitching = false;
    lastTrigger = trigger || triggers[index];
    lenisWasStopped = Boolean(window.lenis?.isStopped);
    window.lenis?.stop();
    render(index);
    modal.classList.remove('is-open', 'is-closing');
    void modal.offsetWidth;
    modal.classList.add('is-open');
    backdrop?.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    backdrop?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('leadership-modal-open');
    if (modalMotion) modalMotion.timeScale(.8).play(0);
    modal.querySelector('[data-person-close]').focus();
  }

  function close() {
    if (!modal.classList.contains('is-open') || modal.classList.contains('is-closing')) return;
    contentMotion?.kill();
    contentMotion = null;
    isSwitching = false;
    window.gsap?.set([count, personCard, details], { y: 0, autoAlpha: 1 });
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    backdrop?.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    backdrop?.setAttribute('aria-hidden', 'true');
    if (modalMotion) {
      modalMotion.timeScale(1).reverse();
      closeTimer = window.setTimeout(finishClose, 1200);
    } else {
      closeTimer = window.setTimeout(
        finishClose,
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 1000
      );
    }
  }
  triggers.forEach((trigger) => trigger.addEventListener('click', () => open(Number(trigger.dataset.person), trigger)));
  modal.querySelector('[data-person-prev]').addEventListener('click', () => switchPerson(-1));
  modal.querySelector('[data-person-next]').addEventListener('click', () => switchPerson(1));
  modal.querySelector('[data-person-close]').addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('is-open')) close(); });
})();
