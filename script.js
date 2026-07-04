// ==========================================
// IMPULSO EMPRESARIAL 2026 — Script
// ==========================================

// === COUNTDOWN — PRÉ-VENDA (5 DIAS) ===
// O countdown usa localStorage para manter a data consistente entre sessões.
// Na primeira visita, define o prazo como 5 dias a partir de agora.
const STORAGE_KEY = 'impulso_presale_end';
const DAYS_PRESALE = 5;

function getOrSetEndDate() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const date = new Date(parseInt(stored, 10));
    if (date > new Date()) return date;
  }
  const end = new Date();
  end.setDate(end.getDate() + DAYS_PRESALE);
  end.setHours(23, 59, 59, 0);
  localStorage.setItem(STORAGE_KEY, end.getTime().toString());
  return end;
}

const PRE_SALE_END = getOrSetEndDate();

function updateCountdown() {
  const now = new Date();
  const diff = PRE_SALE_END - now;

  const ids = [
    ['cd-days', 'cd-hours', 'cd-minutes', 'cd-seconds'],
    ['cd2-days', 'cd2-hours', 'cd2-minutes', 'cd2-seconds'],
    ['cd3-days', 'cd3-hours', 'cd3-minutes', 'cd3-seconds'],
  ];

  if (diff <= 0) {
    ids.forEach(([d, h, m, s]) => {
      ['0', '0', '0', '0'].forEach((v, i) => {
        const el = document.getElementById([d, h, m, s][i]);
        if (el) el.textContent = '00';
      });
    });
    return;
  }

  const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const pad = n => String(n).padStart(2, '0');

  ids.forEach(([d, h, m, s]) => {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl(d, pad(days));
    setEl(h, pad(hours));
    setEl(m, pad(minutes));
    setEl(s, pad(seconds));
  });
}

updateCountdown();
setInterval(updateCountdown, 1000);

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
function buildCarousel(containerId, dotsContainerId) {
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

  prevBtn.addEventListener('click', () => goTo(idx - 1));
  nextBtn.addEventListener('click', () => goTo(idx + 1));

  // Suporte a swipe
  let tx = 0;
  outer.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  outer.addEventListener('touchend', e => {
    const dx = tx - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) dx > 0 ? goTo(idx + 1) : goTo(idx - 1);
  }, { passive: true });

  window.addEventListener('resize', () => goTo(idx), { passive: true });

  goTo(0);
}

if (window.innerWidth <= 768) {
  buildCarousel('checklist-carousel', 'checklist-dots');
  buildCarousel('speakers-carousel', 'speakers-dots');
}
