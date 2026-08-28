// ==========================================
// IMPULSO EMPRESARIAL 2026 — Script
// ==========================================

// === COUNTDOWN ===
// As fases vêm do JSON em #countdown-config, dentro do HTML de cada página.
// Assim a pré-venda arquivada e a página de vendas dividem este script sem
// que uma carregue as datas da outra. Cada fase traz o instante em que
// termina e o rótulo que vale até lá; vencida a última, fica o rótulo de
// `encerrado`. As datas são ancoradas no fuso de Brasília (-03:00) para que
// o prazo seja o mesmo independente do fuso de quem acessa.
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

function lerConfigCountdown() {
  const el = document.getElementById('countdown-config');
  if (!el) return null;
  try {
    const cfg = JSON.parse(el.textContent);
    // Converte para milissegundos uma única vez, na leitura.
    cfg.fases = (cfg.fases || []).map(f => ({ label: f.label, ate: new Date(f.ate).getTime() }));
    return cfg.fases.length ? cfg : null;
  } catch {
    // Config quebrada não deve derrubar o resto da página: o markup
    // estático do contador fica como está.
    return null;
  }
}

const countdownCfg = lerConfigCountdown();

function updateCountdown() {
  const now = Date.now();
  const fase = countdownCfg.fases.find(f => now < f.ate);

  if (fase) {
    setCountdownLabel(fase.label);
    paintCountdown(fase.ate - now);
  } else {
    setCountdownLabel(countdownCfg.encerrado);
    paintCountdown(0);
  }
}

if (countdownCfg) {
  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// === CHECKOUT: TRAVA ATE A ABERTURA DAS VENDAS ===
// Antes de `vendas_abrem` os CTAs de compra ficam inertes, com o aviso no
// lugar do rotulo. O estado e reavaliado a cada segundo junto do contador,
// para que a pagina que ficou aberta a noite toda destrave sozinha na
// virada, sem depender de alguem recarregar.
const CTAS_CHECKOUT = document.querySelectorAll('[data-checkout]');
const abremEm = countdownCfg?.vendas_abrem ? new Date(countdownCfg.vendas_abrem).getTime() : 0;
const avisoBloqueio = countdownCfg?.aviso_bloqueado || 'EM BREVE';

function pintarCheckout() {
  const travado = abremEm && Date.now() < abremEm;

  CTAS_CHECKOUT.forEach(a => {
    // O rotulo original e guardado na primeira passada: e ele que volta
    // quando as vendas abrem.
    if (!a.dataset.rotulo) a.dataset.rotulo = a.textContent.trim();

    if (travado) {
      // Tirar o href e o que realmente desabilita: sem ele o link nao e
      // clicavel nem por teclado, nem por "abrir em nova aba".
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.classList.add('btn-bloqueado');
      a.textContent = avisoBloqueio;
    } else if (a.getAttribute('aria-disabled')) {
      a.href = a.dataset.destino;
      a.removeAttribute('aria-disabled');
      a.classList.remove('btn-bloqueado');
      a.textContent = a.dataset.rotulo;
    }
  });
}

// O destino tem de ser guardado antes da primeira pintura, senao o
// removeAttribute('href') apaga o unico lugar onde ele existia.
CTAS_CHECKOUT.forEach(a => { a.dataset.destino = a.getAttribute('href') || ''; });
pintarCheckout();
setInterval(pintarCheckout, 1000);

// === POPUP DE CAPTURA DE LEAD ===
// Dispara no primeiro clique num CTA liberado. Quem ja preencheu vai direto
// para o checkout: a marca fica no localStorage e, como ele se perde ao
// limpar o navegador, o servidor tambem devolve um cookie de um ano e trata
// o WhatsApp como chave unica.
const JA_CADASTRADO = 'impulso_lead_ok';

const modal      = document.getElementById('lead-modal');
const formLead   = document.getElementById('lead-form');
const erroLead   = document.getElementById('lead-erro');

const jaCadastrou = () => {
  try { return localStorage.getItem(JA_CADASTRADO) === '1'; }
  catch { return document.cookie.includes('impulso_lead=1'); }
};
const marcarCadastrado = () => {
  try { localStorage.setItem(JA_CADASTRADO, '1'); } catch { /* modo privado */ }
};

if (modal && formLead) {
  let destinoPendente = '';
  let origemPendente = '';
  let ultimoFoco = null;

  const abrirModal = (destino, origem) => {
    destinoPendente = destino;
    origemPendente = origem;
    ultimoFoco = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('input[name="nome"]')?.focus();
  };

  const fecharModal = () => {
    modal.hidden = true;
    document.body.style.overflow = '';
    ultimoFoco?.focus();
  };

  modal.querySelectorAll('[data-fechar-modal]').forEach(el =>
    el.addEventListener('click', fecharModal));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) fecharModal();
  });

  CTAS_CHECKOUT.forEach(a => {
    a.addEventListener('click', e => {
      if (a.getAttribute('aria-disabled')) { e.preventDefault(); return; }
      if (jaCadastrou()) return;               // segue direto para a Eduzz
      e.preventDefault();
      abrirModal(a.dataset.destino, a.dataset.checkout);
    });
  });

  formLead.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = formLead.querySelector('button[type="submit"]');
    const dados = Object.fromEntries(new FormData(formLead));
    dados.origem = origemPendente;

    erroLead.hidden = true;
    botao.disabled = true;
    botao.textContent = 'ENVIANDO...';

    try {
      const r = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro || 'Não foi possível enviar.');

      marcarCadastrado();
      // Navegacao direta, e nao window.open: o clique original ja foi
      // consumido pelo preventDefault, entao um popup seria bloqueado.
      window.location.href = destinoPendente;
    } catch (err) {
      erroLead.textContent = err.message;
      erroLead.hidden = false;
      botao.disabled = false;
      botao.textContent = 'CONTINUAR PARA O CHECKOUT';
    }
  });
}

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
