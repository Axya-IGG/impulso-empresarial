// ==========================================
// IMPULSO EMPRESARIAL 2026 — Script
// ==========================================

// === COUNTDOWN — PRÉ-VENDA ===
// Janela fixa da pré-venda, ancorada no fuso de Brasília (-03:00) para que
// o prazo seja o mesmo independente do fuso de quem acessa.
const PRESALE_START = new Date('2026-08-10T00:00:00-03:00').getTime();
const PRESALE_END   = new Date('2026-08-21T23:59:59-03:00').getTime();

const COUNTDOWN_IDS = [
  ['cd-days',  'cd-hours',  'cd-minutes',  'cd-seconds'],
  ['cd2-days', 'cd2-hours', 'cd2-minutes', 'cd2-seconds'],
  ['cd3-days', 'cd3-hours', 'cd3-minutes', 'cd3-seconds'],
];

const pad = n => String(n).padStart(2, '0');

function paintCountdown(diff) {
  const parts = [
    Math.floor(diff / 86400000),
    Math.floor((diff % 86400000) / 3600000),
    Math.floor((diff % 3600000) / 60000),
    Math.floor((diff % 60000) / 1000),
  ];
  COUNTDOWN_IDS.forEach(ids => {
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = pad(parts[i]);
    });
  });
}

function setCountdownLabel(text) {
  document.querySelectorAll('.countdown-label').forEach(el => { el.textContent = text; });
}

function updateCountdown() {
  const now = Date.now();

  if (now < PRESALE_START) {
    setCountdownLabel('Pré-venda começa em:');
    paintCountdown(PRESALE_START - now);
  } else if (now <= PRESALE_END) {
    setCountdownLabel('Pré-venda encerra em:');
    paintCountdown(PRESALE_END - now);
  } else {
    setCountdownLabel('Pré-venda encerrada');
    paintCountdown(0);
  }
}

updateCountdown();
setInterval(updateCountdown, 1000);

// === VÍDEO DA AÇÃO SOCIAL ===
// O play sobreposto some assim que a reprodução começa; daí em diante
// quem manda são os controles nativos.
const socialVideo = document.getElementById('social-video-player');
const socialPlayBtn = document.querySelector('.social-video-play');

if (socialVideo && socialPlayBtn) {
  // Com JS: poster limpo + play sobreposto. Os controles nativos entram
  // ao iniciar a reprodução, para não poluir o poster.
  socialVideo.controls = false;
  socialPlayBtn.hidden = false;

  socialPlayBtn.addEventListener('click', () => {
    socialVideo.controls = true;
    socialVideo.play();
  });
  socialVideo.addEventListener('play', () => { socialPlayBtn.hidden = true; });
  // Se o arquivo não carregar, devolve os controles e o link do Instagram
  // abaixo continua valendo.
  socialVideo.addEventListener('error', () => {
    socialPlayBtn.hidden = true;
    socialVideo.controls = true;
  });
}

// === SMOOTH SCROLL ===
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const headerHeight = document.querySelector('.header')?.offsetHeight || 70;
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - headerHeight - 16,
        behavior: 'smooth'
      });
    }
  });
});

// === SCROLL REVEAL ===
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll(
  '.card, .module-card, .speaker-card, .testimonial-card, .ticket-card, ' +
  '.schedule-item, .faq-item, .checklist-item, .brand-main-card, .sponsor-card'
).forEach(el => {
  el.classList.add('reveal-on-scroll');
  revealObserver.observe(el);
});

const revealStyle = document.createElement('style');
revealStyle.textContent = `
  .reveal-on-scroll {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  .reveal-on-scroll.revealed {
    opacity: 1;
    transform: translateY(0);
  }
`;
document.head.appendChild(revealStyle);

// === HEADER SHADOW ON SCROLL ===
const header = document.querySelector('.header');
window.addEventListener('scroll', () => {
  header?.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

const headerStyle = document.createElement('style');
headerStyle.textContent = `.header.scrolled { box-shadow: 0 2px 20px rgba(0,0,0,0.6); }`;
document.head.appendChild(headerStyle);

// === MENU HAMBURGER ===
const hamburger = document.getElementById('hamburger');
const mainNav = document.getElementById('nav-links');

if (hamburger && mainNav) {
  hamburger.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('nav-open');
    hamburger.classList.toggle('active', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });
  mainNav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      mainNav.classList.remove('nav-open');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });
}

// === CARROSSÉIS (somente mobile) ===
function buildCarousel(containerId, dotsContainerId, options = {}) {
  const { autoplayMs = 0 } = options;
  const el = document.getElementById(containerId);
  const dotsEl = dotsContainerId ? document.getElementById(dotsContainerId) : null;
  if (!el) return;

  const items = Array.from(el.children);
  if (items.length < 2) return;

  // Monta estrutura: outer > track (com itens) + botões
  const outer = document.createElement('div');
  outer.className = 'js-carousel-outer';

  const track = document.createElement('div');
  track.className = 'js-carousel-track';
  items.forEach(item => track.appendChild(item));
  outer.appendChild(track);

  // Substitui o container original pelo outer
  el.parentNode.insertBefore(outer, el);
  el.remove();

  // Setas
  const svgL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const svgR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'js-carousel-btn js-carousel-btn-prev';
  prevBtn.setAttribute('aria-label', 'Anterior');
  prevBtn.innerHTML = svgL;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'js-carousel-btn js-carousel-btn-next';
  nextBtn.setAttribute('aria-label', 'Próximo');
  nextBtn.innerHTML = svgR;

  outer.appendChild(prevBtn);
  outer.appendChild(nextBtn);

  // Pontos
  let dots = [];
  if (dotsEl) {
    dotsEl.innerHTML = '';
    dots = items.map((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Slide ${i + 1}`);
      dot.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(dot);
      return dot;
    });
  }

  let idx = 0;

  function goTo(n) {
    idx = Math.max(0, Math.min(n, items.length - 1));
    track.style.transform = `translateX(${-idx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === items.length - 1;
  }

  // === AUTOPLAY ===
  // Avança sozinho e dá a volta ao chegar no último. Para de vez assim que
  // a pessoa assume o controle: retomar depois atrapalharia a leitura.
  let timer = null;
  let assumiuControle = false;
  const prefereMenosMovimento =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function iniciaAutoplay() {
    if (!autoplayMs || prefereMenosMovimento || assumiuControle) return;
    paraAutoplay();
    timer = setInterval(() => goTo((idx + 1) % items.length), autoplayMs);
  }
  function paraAutoplay() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function cedeControle() {
    assumiuControle = true;
    paraAutoplay();
  }

  prevBtn.addEventListener('click', () => { cedeControle(); goTo(idx - 1); });
  nextBtn.addEventListener('click', () => { cedeControle(); goTo(idx + 1); });
  dots.forEach(d => d.addEventListener('click', cedeControle));

  // Suporte a swipe
  let tx = 0;
  outer.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  outer.addEventListener('touchend', e => {
    const dx = tx - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) { cedeControle(); dx > 0 ? goTo(idx + 1) : goTo(idx - 1); }
  }, { passive: true });

  // Não gira em aba oculta: gastaria bateria e a pessoa voltaria num slide
  // aleatório.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) paraAutoplay();
    else iniciaAutoplay();
  });

  window.addEventListener('resize', () => goTo(idx), { passive: true });

  goTo(0);
  iniciaAutoplay();
}

if (window.innerWidth <= 768) {
  buildCarousel('speakers-carousel', 'speakers-dots', { autoplayMs: 2000 });
}
