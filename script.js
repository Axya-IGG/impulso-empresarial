// ==========================================
// IMPULSO EMPRESARIAL — Main Script
// ==========================================

// === COUNTDOWN TIMER ===
// Set your pre-sale end date here (YYYY, MM-1, DD, HH, MM, SS)
const PRE_SALE_END = new Date(2025, 6, 31, 23, 59, 59); // July 31, 2025 — update as needed

function updateCountdown() {
  const now = new Date();
  const diff = PRE_SALE_END - now;

  if (diff <= 0) {
    // Pre-sale ended
    ['countdown', 'countdown2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p style="color:var(--primary);font-weight:700;">Pré-venda encerrada!</p>';
    });
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const pad = n => String(n).padStart(2, '0');

  // Countdown 1 (hero)
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('cd-days',    pad(days));
  setEl('cd-hours',   pad(hours));
  setEl('cd-minutes', pad(minutes));
  setEl('cd-seconds', pad(seconds));

  // Countdown 2 (CTA final)
  setEl('cd2-days',    pad(days));
  setEl('cd2-hours',   pad(hours));
  setEl('cd2-minutes', pad(minutes));
  setEl('cd2-seconds', pad(seconds));
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
      const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
      window.scrollTo({ top, behavior: 'smooth' });
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
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll(
  '.card, .module-card, .speaker-card, .testimonial-card, .ticket-card, .schedule-item, .faq-item'
).forEach(el => {
  el.classList.add('reveal-on-scroll');
  revealObserver.observe(el);
});

// Inject reveal styles
const revealStyle = document.createElement('style');
revealStyle.textContent = `
  .reveal-on-scroll {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  .reveal-on-scroll.revealed {
    opacity: 1;
    transform: translateY(0);
  }
`;
document.head.appendChild(revealStyle);

// === HEADER SCROLL SHADOW ===
const header = document.querySelector('.header');
window.addEventListener('scroll', () => {
  if (window.scrollY > 10) {
    header?.classList.add('scrolled');
  } else {
    header?.classList.remove('scrolled');
  }
}, { passive: true });

const headerStyle = document.createElement('style');
headerStyle.textContent = `.header.scrolled { box-shadow: 0 2px 20px rgba(0,0,0,0.5); }`;
document.head.appendChild(headerStyle);
