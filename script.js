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

// === VIRADA DE LOTE ===
// Quando `virada_lote.em` (no #countdown-config) passa, os preços trocam
// sozinhos — sem isso alguém teria que lembrar de editar o HTML às 23:59 do
// dia certo. Só ida: não existe caminho de volta pro preço do lote 1 (ao
// contrário da lista de espera, que podia reabrir), então não precisa
// guardar o valor original em lugar nenhum pra restaurar depois.
const cfgLote = countdownCfg?.virada_lote;
const viradaLoteEm = cfgLote?.em ? new Date(cfgLote.em).getTime() : 0;
let loteJaVirou = false; // trava a reescrita do DOM: sem isso rodaria a cada segundo à toa

function pintarLote() {
  if (!cfgLote || !viradaLoteEm || Date.now() < viradaLoteEm) return;
  if (loteJaVirou) return;
  loteJaVirou = true;

  const preencher = (id, texto) => {
    const el = document.getElementById(id);
    if (el && texto) el.textContent = texto;
  };
  preencher('preco-ate3', `R$ ${cfgLote.preco_ate3}`);
  preencher('preco-4mais', `R$ ${cfgLote.preco_4mais}`);
  preencher('preco-cta-ate3', cfgLote.preco_ate3);
  preencher('preco-cta-4mais', cfgLote.preco_4mais);
}

if (countdownCfg) {
  updateCountdown();
  pintarLote();
  setInterval(() => { updateCountdown(); pintarLote(); }, 1000);
}

// === ATRIBUIÇÃO (UTM + Meta Pixel) — CAMINHO DE RESERVA ===
// Desde a migration 004, quem faz a captura de verdade é a borda
// (functions/_middleware.js): cookie de 400 dias, sobrevive ao Safari
// (ITP apaga localStorage depois de alguns dias sem visita, sem avisar em
// lugar nenhum) e decora o link de checkout direto no HTML de saída — não
// depende de este script rodar a tempo. O que sobra aqui só serve de
// reforço no corpo do POST /api/lead, pro caso raro de cookie bloqueado.
const ATRIBUICAO_KEY = 'impulso_atribuicao';
const CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function lerAtribuicaoSalva() {
  try { return JSON.parse(localStorage.getItem(ATRIBUICAO_KEY) || '{}'); }
  catch { return {}; }
}

// Só sobrescreve o que já estava salvo se a URL atual realmente trouxe UTM
// novo — assim quem chegou por um anúncio e depois navega o site sem UTM
// (ex.: voltou pela home) não perde a origem original (first-touch).
function capturarAtribuicao() {
  const params = new URLSearchParams(window.location.search);
  const daUrl = {};
  let temAlgumUtm = false;
  CAMPOS_UTM.forEach(c => {
    const v = params.get(c);
    if (v) { daUrl[c] = v; temAlgumUtm = true; }
  });

  if (!temAlgumUtm) return lerAtribuicaoSalva();
  try { localStorage.setItem(ATRIBUICAO_KEY, JSON.stringify(daUrl)); } catch { /* navegação privada */ }
  return daUrl;
}

// Roda uma vez, no carregamento da página, só para manter o localStorage
// atualizado como reserva — o link de checkout já chega decorado pela
// borda, não depende mais deste valor.
capturarAtribuicao();

const lerCookie = (nome) => {
  const m = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
};

// fbp/fbc são lidos na hora (não guardados à parte): o próprio Pixel os
// mantém no cookie e os renova sozinho a cada visita, então ler direto do
// cookie no momento do cadastro é sempre mais atual do que uma cópia salva.
function dadosDeAtribuicaoAtuais() {
  return { ...capturarAtribuicao(), fbp: lerCookie('_fbp'), fbc: lerCookie('_fbc') };
}

// === CHECKOUT E LISTA DE ESPERA ===
// Antes de `vendas_abrem` os CTAs de compra nao levam ao checkout: viram
// entrada para a lista de espera, com o aviso da data logo abaixo. Assim os
// dias que antecedem a estreia continuam gerando contato, em vez de esbarrar
// num botao morto. O estado e reavaliado a cada segundo junto do contador,
// para que a pagina aberta durante a noite destrave sozinha na virada.
const CTAS_CHECKOUT = document.querySelectorAll('[data-checkout]');
const NOTAS_ESPERA  = document.querySelectorAll('[data-nota-espera]');
const cfgEspera     = countdownCfg?.espera || {};
const abremEm       = countdownCfg?.vendas_abrem ? new Date(countdownCfg.vendas_abrem).getTime() : 0;

const emEspera = () => Boolean(abremEm) && Date.now() < abremEm;

// O destino tem de ser guardado antes da primeira pintura: o
// removeAttribute('href') apagaria o unico lugar onde ele existe. Já chega
// decorado com ?trk=...&utm_*=... — quem faz isso é a borda
// (functions/_middleware.js, via HTMLRewriter), não este script. Assim
// tanto o clique direto (quem já se cadastrou antes) quanto o
// redirecionamento pós-popup carregam a mesma origem, e não depende de JS
// ter rodado a tempo (foi exatamente isso que já deu bug uma vez aqui).
CTAS_CHECKOUT.forEach(a => { a.dataset.destino = a.getAttribute('href') || ''; });

function pintarCheckout() {
  const espera = emEspera();

  CTAS_CHECKOUT.forEach(a => {
    if (!a.dataset.rotulo) a.dataset.rotulo = a.textContent.trim();

    if (espera && a.dataset.modo !== 'espera') {
      // Sai o href de verdade: se o JS falhasse depois de apenas trocar o
      // rotulo, um clique ainda abriria o checkout antes da hora.
      a.removeAttribute('href');
      a.removeAttribute('target');
      a.dataset.modo = 'espera';
      a.textContent = cfgEspera.rotulo || 'ENTRAR NA LISTA DE ESPERA';
      // <a> sem href sai da ordem de tabulacao e deixa de se anunciar como
      // controle; role + tabindex devolvem as duas coisas.
      a.setAttribute('role', 'button');
      a.setAttribute('tabindex', '0');
    } else if (!espera && a.dataset.modo === 'espera') {
      a.href = a.dataset.destino;
      a.target = '_blank';
      delete a.dataset.modo;
      a.textContent = a.dataset.rotulo;
      a.removeAttribute('role');
      a.removeAttribute('tabindex');
    }
  });

  // Blocos marcados com data-espera-unico tem mais de um CTA porque cada um
  // leva a um lote de preco diferente. Na lista de espera todos viram o mesmo
  // rotulo, entao repetir o botao so polui: fica o primeiro.
  document.querySelectorAll('[data-espera-unico]').forEach(bloco => {
    const ctas = bloco.querySelectorAll('[data-checkout]');
    ctas.forEach((a, i) => { a.hidden = espera && i > 0; });
  });

  NOTAS_ESPERA.forEach(n => {
    if (espera && cfgEspera.nota) { n.textContent = cfgEspera.nota; n.hidden = false; }
    else n.hidden = true;
  });
}

pintarCheckout();
setInterval(pintarCheckout, 1000);

// === POPUP DE CAPTURA DE LEAD ===
// Abre no primeiro clique num CTA. Com as vendas abertas ele e a ponte para
// o checkout; antes disso, e o cadastro na lista de espera. Quem ja
// preencheu nao ve o formulario de novo: a marca fica no localStorage e,
// como ele se perde ao limpar o navegador, o servidor tambem devolve um
// cookie de um ano e trata o WhatsApp como chave unica.
const JA_CADASTRADO = 'impulso_lead_ok';

const modal        = document.getElementById('lead-modal');
const formLead     = document.getElementById('lead-form');
const erroLead     = document.getElementById('lead-erro');
const tituloLead   = document.getElementById('lead-modal-titulo');
const subLead      = document.getElementById('lead-modal-sub');
const sucessoLead  = document.getElementById('lead-sucesso');
const sucessoTexto = document.getElementById('lead-sucesso-texto');

const jaCadastrou = () => {
  try { return localStorage.getItem(JA_CADASTRADO) === '1'; }
  catch { return document.cookie.includes('impulso_lead=1'); }
};
const marcarCadastrado = () => {
  try { localStorage.setItem(JA_CADASTRADO, '1'); } catch { /* navegacao privada */ }
};

if (modal && formLead) {
  const botaoLead = formLead.querySelector('button[type="submit"]');

  // A copy de checkout mora no HTML; guardamos para restaurar depois de uma
  // abertura em modo lista de espera.
  const COPY_PADRAO = {
    titulo: tituloLead.textContent,
    sub: subLead.textContent,
    botao: botaoLead.textContent.trim(),
  };

  let destinoPendente = '';
  let origemPendente  = '';
  let modoPendente    = '';
  let ultimoFoco      = null;

  function mostrarSucesso(texto) {
    formLead.hidden = true;
    subLead.hidden = true;
    sucessoTexto.textContent = texto;
    sucessoLead.hidden = false;
  }

  function abrirModal({ destino = '', origem = '', modo = '', jaNaLista = false }) {
    destinoPendente = destino;
    origemPendente = origem;
    modoPendente = modo;

    const espera = modo === 'espera';
    tituloLead.textContent = espera ? (cfgEspera.titulo || COPY_PADRAO.titulo) : COPY_PADRAO.titulo;
    subLead.textContent    = espera ? (cfgEspera.sub || COPY_PADRAO.sub) : COPY_PADRAO.sub;
    botaoLead.textContent  = espera ? (cfgEspera.botao || COPY_PADRAO.botao) : COPY_PADRAO.botao;

    erroLead.hidden = true;
    botaoLead.disabled = false;

    // Quem ja se cadastrou e clica de novo durante a espera nao precisa
    // preencher nada: recebe so a confirmacao de que esta na lista.
    if (jaNaLista) {
      mostrarSucesso(cfgEspera.ja_inscrito || 'Você já está na lista de espera.');
    } else {
      formLead.hidden = false;
      subLead.hidden = false;
      sucessoLead.hidden = true;
    }

    ultimoFoco = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!jaNaLista) modal.querySelector('input[name="nome"]')?.focus();
  }

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

  function aoAcionarCta(e, a) {
    if (a.dataset.modo === 'espera') {
      e.preventDefault();
      abrirModal({ origem: 'espera-' + a.dataset.checkout, modo: 'espera', jaNaLista: jaCadastrou() });
      return;
    }
    if (typeof fbq === 'function') fbq('track', 'InitiateCheckout');
    if (jaCadastrou()) return;          // segue direto para a Eduzz
    e.preventDefault();
    abrirModal({ destino: a.dataset.destino, origem: a.dataset.checkout });
  }

  CTAS_CHECKOUT.forEach(a => {
    a.addEventListener('click', e => aoAcionarCta(e, a));
    // Sem href, o Enter num <a> nao dispara click: precisa ser no braco.
    a.addEventListener('keydown', e => {
      if (a.dataset.modo === 'espera' && (e.key === 'Enter' || e.key === ' ')) aoAcionarCta(e, a);
    });
  });

  formLead.addEventListener('submit', async e => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(formLead));
    dados.origem = origemPendente;
    dados.atribuicao = JSON.stringify(dadosDeAtribuicaoAtuais());
    // Mesmo event_id no Pixel (abaixo) e no evento de servidor que
    // /api/lead dispara — é assim que o Meta sabe que as duas fontes são
    // o mesmo Lead e conta uma vez só, em vez de duas.
    dados.event_id = crypto.randomUUID();
    dados.event_source_url = window.location.href;

    erroLead.hidden = true;
    botaoLead.disabled = true;
    const rotulo = botaoLead.textContent;
    botaoLead.textContent = 'ENVIANDO...';

    try {
      const r = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro || 'Não foi possível enviar.');

      marcarCadastrado();
      if (typeof fbq === 'function') fbq('track', 'Lead', {}, { eventID: dados.event_id });

      if (modoPendente === 'espera') {
        mostrarSucesso(cfgEspera.sucesso || 'Pronto, você está na lista!');
      } else {
        // Navegacao direta, e nao window.open: o clique original ja foi
        // consumido pelo preventDefault, entao um popup seria bloqueado.
        window.location.href = destinoPendente;
      }
    } catch (err) {
      erroLead.textContent = err.message;
      erroLead.hidden = false;
      botaoLead.disabled = false;
      botaoLead.textContent = rotulo;
    }
  });
}

// === VÍDEO DE FUNDO DO HERO ===
// O arquivo só é baixado quando faz sentido tocar. Duas condições:
//
//   1. Desktop. No celular o vídeo nem aparece (o CSS o esconde), então
//      baixá-lo seria gastar 1,7 MB do plano de dados de quem chegou pelo
//      Instagram sem nada em troca.
//   2. Sem `prefers-reduced-motion`. Quem configurou o sistema pedindo menos
//      animação não deve receber vídeo em loop atrás do texto.
//
// Fora dessas condições o <video> fica sem fonte e o poster nem carrega —
// o hero cai nos gradientes, que é como ele era antes.
const heroVideo = document.getElementById('hero-video');

if (heroVideo) {
  const podeTocar =
    window.matchMedia('(min-width: 769px)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (podeTocar) {
    heroVideo.src = heroVideo.dataset.src;
    // O play() é explícito porque o autoplay foi tirado do HTML junto com a
    // fonte; sem ele o vídeo carregaria e ficaria parado no primeiro frame.
    // A promessa é ignorada de proposito: se o navegador recusar, fica o
    // poster, que ja e uma imagem valida do evento.
    heroVideo.play().catch(() => {});

    // Aba oculta não precisa decodificar vídeo: gasta bateria à toa.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) heroVideo.pause();
      else heroVideo.play().catch(() => {});
    });
  }
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

// === GALERIA 1ª EDIÇÃO — LIGHTBOX ===
// O carrossel duplica cada foto (loop sem emenda), então o índice de
// navegação é montado pela primeira ocorrência de cada src — as cópias
// (aria-hidden) abrem a mesma foto, só que sem entrar na leitura de tela.
const galleryPhotos = Array.from(document.querySelectorAll('.gallery-photo'));

if (galleryPhotos.length) {
  const seen = new Map();
  const items = [];

  galleryPhotos.forEach(fig => {
    const img = fig.querySelector('img');
    const src = img.getAttribute('src');
    if (!seen.has(src)) {
      seen.set(src, items.length);
      items.push({ src, alt: img.getAttribute('alt') || '' });
    }
    fig.dataset.galleryIndex = seen.get(src);

    if (!fig.hasAttribute('aria-hidden')) {
      fig.setAttribute('role', 'button');
      fig.setAttribute('tabindex', '0');
      fig.setAttribute('aria-label', 'Ampliar foto: ' + (img.getAttribute('alt') || ''));
    }
  });

  const modal = document.createElement('div');
  modal.className = 'gallery-lightbox';
  modal.innerHTML = `
    <button class="gallery-lightbox-close" type="button" aria-label="Fechar">&times;</button>
    <button class="gallery-lightbox-nav gallery-lightbox-prev" type="button" aria-label="Foto anterior">&lsaquo;</button>
    <img class="gallery-lightbox-img" src="" alt="" />
    <button class="gallery-lightbox-nav gallery-lightbox-next" type="button" aria-label="Próxima foto">&rsaquo;</button>
  `;
  document.body.appendChild(modal);

  const lbImg = modal.querySelector('.gallery-lightbox-img');
  let current = 0;

  function openGalleryAt(i) {
    current = (i + items.length) % items.length;
    lbImg.src = items[current].src;
    lbImg.alt = items[current].alt;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeGallery() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  galleryPhotos.forEach(fig => {
    const open = () => openGalleryAt(Number(fig.dataset.galleryIndex));
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  modal.querySelector('.gallery-lightbox-close').addEventListener('click', closeGallery);
  modal.querySelector('.gallery-lightbox-prev').addEventListener('click', () => openGalleryAt(current - 1));
  modal.querySelector('.gallery-lightbox-next').addEventListener('click', () => openGalleryAt(current + 1));
  modal.addEventListener('click', e => { if (e.target === modal) closeGallery(); });

  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') closeGallery();
    if (e.key === 'ArrowLeft') openGalleryAt(current - 1);
    if (e.key === 'ArrowRight') openGalleryAt(current + 1);
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

// === CRONOGRAMA EM ROLO ===
// Os tópicos giram como o seletor de hora do despertador do iPhone, e quem
// gira é a rolagem DENTRO de um container próprio: o #schedule-scroll, uma
// camada invisível do tamanho exato da janela do rolo. Esse é o "quadrado" da
// interação — fora dele a página rola como em qualquer outra seção.
//
// Rolagem nativa, não evento sequestrado, porque é ela que resolve de graça
// os casos difíceis: no celular o dedo já rola o container, teclado
// (setas/PageUp/Home) funciona sozinho, e — o mais importante — ao chegar
// numa ponta o navegador encadeia a rolagem de volta pra página, então
// ninguém fica preso na seção. A única exceção é a roda do mouse, tratada
// mais abaixo: um giro comum manda mais pixel do que separa dois tópicos, e
// a rolagem nativa pousaria no tópico ERRADO.
//
// A versão anterior prendia a seção na tela (stage sticky) e gastava o scroll
// da PÁGINA numa altura extra do trilho. Girava bonito, mas obrigava quem só
// queria passar direto a percorrer o dia inteiro antes de alcançar a próxima
// seção — que é exatamente o que esta versão desfaz.
//
// O rolo não gira infinito: começa no primeiro tópico centralizado e trava no
// último.
(function cronogramaEmRolo() {
  const trilho     = document.getElementById('schedule-track');
  const roda       = document.getElementById('schedule-wheel');
  const superficie = document.getElementById('schedule-scroll');
  const espacador  = document.getElementById('schedule-scroll-spacer');
  const barra      = document.getElementById('schedule-rail-fill');
  if (!trilho || !roda || !superficie || !espacador) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const itens = [...roda.querySelectorAll('.schedule-item')];
  if (itens.length < 3) return;

  const PASSO_GRAUS = 20;              // ângulo entre um tópico e o vizinho
  const RAD = Math.PI / 180;
  const ehMobile = () => window.innerWidth <= 768;

  let raio = 0, pos = -1, porItemAtual = 88;

  function medir() {
    const alturaItem = parseFloat(getComputedStyle(trilho).getPropertyValue('--roda-item-h')) || 78;
    // Raio do cilindro em que dois vizinhos ficam exatamente encostados:
    // metade da altura do item sobre a tangente de meio passo.
    raio = (alturaItem / 2) / Math.tan((PASSO_GRAUS / 2) * RAD);

    // Recua o cilindro inteiro pelo proprio raio: sem isso o item do centro
    // fica a `raio` px do olho e a perspectiva o amplia ~33%, empurrando a
    // coluna de horario para fora da janela (que tem overflow:hidden). Com o
    // recuo o centro cai em z=0 — tamanho natural — e os vizinhos afundam,
    // que e' exatamente o que o seletor do iPhone faz.
    roda.style.transform = `translateZ(${-raio}px)`;

    // Quanto de rolagem cada tópico consome. Mais curto no celular, onde o
    // mesmo gesto cobre menos pixels.
    porItemAtual = ehMobile() ? 74 : 88;

    // O espaçador é o único conteúdo do container, e é só ele que define
    // quanto dá pra rolar: uma janela inteira (pra o primeiro tópico já
    // nascer centralizado, sem rolagem nenhuma) mais um passo por tópico
    // restante. Assim scrollTop vai de 0 ao último tópico e para ali.
    espacador.style.height = `${superficie.clientHeight + (itens.length - 1) * porItemAtual}px`;
  }

  function desenhar() {
    // scrollTop 0 = primeiro tópico no centro; no fim do container, último no
    // centro. O clamp cobre o overscroll elástico do iOS, que devolve
    // scrollTop negativo ou acima do máximo por alguns quadros.
    const util = (itens.length - 1) * porItemAtual;
    const p = Math.min(1, Math.max(0, superficie.scrollTop / util));
    const alvo = p * (itens.length - 1);
    if (Math.abs(alvo - pos) < 0.0005) return;
    pos = alvo;

    for (let i = 0; i < itens.length; i++) {
      const graus = (i - pos) * PASSO_GRAUS;
      const el = itens[i];
      el.style.transform = `rotateX(${-graus}deg) translateZ(${raio}px)`;
      // cos elevado escurece rápido nas pontas, como no seletor do iPhone.
      // Passados 90° o item está de costas — o backface-visibility do CSS
      // esconde, e o max(0) evita opacidade negativa.
      el.style.opacity = Math.max(0, Math.cos(graus * RAD) ** 2.4).toFixed(3);
      el.classList.toggle('is-center', Math.abs(graus) < PASSO_GRAUS / 2);
    }

    if (barra) barra.style.transform = `scaleX(${p})`;
    trilho.classList.toggle('ja-rolou', p > 0.02);
    agendarEncaixe();
  }

  let pedido = 0;
  const agendar = () => {
    if (pedido) return;
    pedido = requestAnimationFrame(() => { pedido = 0; desenhar(); });
  };

  // Encaixa no tópico mais próximo depois que a rolagem para de verdade.
  // Tentei primeiro com scroll-snap do CSS, mas o Chromium nao honra
  // scroll-snap-stop:always quando o delta de um giro de roda passa de meio
  // passo — testado: um giro de 150px (comum num giro rapido) pulava direto
  // pro SEGUNDO marco, ignorando o primeiro. Daqui em diante quem decide o
  // destino sou eu: `pos` e' continuo e reflete a rolagem de verdade, entao
  // Math.round(pos) nunca erra por mais de meio item — nao importa o quao
  // rapido ou longo foi o gesto que trouxe a rolagem ate' aqui.
  let temporizadorEncaixe = null;
  function agendarEncaixe() {
    clearTimeout(temporizadorEncaixe);
    temporizadorEncaixe = setTimeout(encaixarNoCentro, 140);
  }
  function encaixarNoCentro() {
    if (arrastando) return; // dedo/mouse ainda preso: o soltar cuida disso
    if (pos <= 0 || pos >= itens.length - 1) return; // pontas ja' sao exatas
    const alvo = Math.round(pos);
    if (Math.abs(alvo - pos) < 0.01) return;
    superficie.scrollTo({ top: alvo * porItemAtual, behavior: 'smooth' });
  }

  // Arrastar o rolo com o mouse, como se pegasse no cilindro. Só mouse: no
  // toque, arrastar já rola o container nativamente, e roubar o gesto
  // deixaria o dedo preso. Escreve scrollTop direto (e não scrollTo) porque
  // aqui cada quadro já é a posição final: com 'smooth' o navegador animaria
  // cada passo do arrasto e ele ficaria borrachudo.
  let arrastando = false, ultimoY = 0;
  superficie.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    arrastando = true;
    ultimoY = e.clientY;
    superficie.setPointerCapture(e.pointerId);
    superficie.classList.add('is-dragging');
    clearTimeout(temporizadorEncaixe); // nao encaixa no meio do arrasto
    e.preventDefault();
  });
  superficie.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const dy = e.clientY - ultimoY;
    ultimoY = e.clientY;
    superficie.scrollTop -= dy * 1.8;
  });
  const soltar = (e) => {
    if (!arrastando) return;
    arrastando = false;
    superficie.classList.remove('is-dragging');
    try { superficie.releasePointerCapture(e.pointerId); } catch { /* ponteiro já foi */ }
    encaixarNoCentro();
  };
  superficie.addEventListener('pointerup', soltar);
  superficie.addEventListener('pointercancel', soltar);

  // === RODA DE MOUSE: um giro, um tópico — nunca dois ===
  // Deixada por conta do navegador, a roda rolaria o container pelo tanto de
  // pixel que o sistema mandou — e um giro comum no Windows manda mais do que
  // os ~88px que separam dois tópicos (testado: um único giro de 120 a 200px,
  // nada fora do normal, já cai mais perto do SEGUNDO tópico). O encaixe
  // então pousa lá, corretamente, e o resultado percebido é "pulou um".
  //
  // Pra roda especificamente, então, cada evento avança exatamente um tópico
  // e fica em cooldown até a rolagem programada assentar, pra um giro rápido
  // (vários eventos em sequência) também avançar de um em um.
  //
  // deltaY nao vem sempre em pixels: alguns navegadores/dispositivos mandam em
  // linhas ou em telas cheias. Sem converter, encaminhar o valor cru pra
  // pagina rolaria 3px onde deveria rolar 100.
  const pixelsDoEvento = (e) => {
    if (e.deltaMode === 1) return e.deltaY * 16;                 // linhas
    if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // telas
    return e.deltaY;                                             // pixels
  };

  let travadoAte = 0;
  superficie.addEventListener('wheel', (e) => {
    const maxRolo = superficie.scrollHeight - superficie.clientHeight;
    const indoParaFrente = e.deltaY > 0;
    // Lê a rolagem real do container, não `pos` arredondado: num giro rápido
    // `pos` passa por 13,6 (arredonda pra 14, o último) antes de o rolo ter
    // de fato chegado lá, e a página começaria a rolar cedo demais, comendo
    // o último tópico.
    const podeAvancar = indoParaFrente
      ? superficie.scrollTop < maxRolo - 1
      : superficie.scrollTop > 1;

    // Ponta do rolo: a rolagem tem que seguir para a página. Daria pra só não
    // chamar preventDefault e deixar o navegador encadear sozinho — mas ele
    // só encadeia num gesto NOVO: num giro contínuo o Chrome gruda a
    // gesticulação neste container e a página fica parada até a pessoa parar
    // e girar de novo (testado aqui, com gesto sintetizado com fases). Como
    // prender a pessoa na seção é exatamente o que esta mudança veio desfazer,
    // o encaminhamento é explícito.
    if (!podeAvancar) {
      e.preventDefault();
      window.scrollBy({ top: pixelsDoEvento(e), behavior: 'instant' });
      return;
    }
    e.preventDefault();
    if (performance.now() < travadoAte) return;
    travadoAte = performance.now() + 320;
    clearTimeout(temporizadorEncaixe);
    superficie.scrollBy({ top: (indoParaFrente ? 1 : -1) * porItemAtual, behavior: 'smooth' });
  }, { passive: false });

  // is-wheel antes de medir: e' ele que liga o CSS do rolo, e sem isso o
  // container ainda estaria display:none (clientHeight 0) e a --roda-item-h
  // nem existiria.
  trilho.classList.add('is-wheel');
  medir();
  desenhar();

  superficie.addEventListener('scroll', agendar, { passive: true });
  window.addEventListener('resize', () => { medir(); pos = -1; desenhar(); }, { passive: true });
})();

// === SCROLL REVEAL ===
// A regra de opacidade e injetada daqui, e nao no style.css, de proposito:
// sem JS nada recebe .revealed e o conteudo ficaria invisivel para sempre.
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

// .speaker-card fica de fora: os cards vivem num carrossel, e os que estao
// fora da janela do slide nunca chegam a intersectar — ficariam em opacity 0
// ate o autoplay passar por eles, deixando buracos na fileira. O movimento
// do proprio carrossel ja cumpre o papel da entrada.
document.querySelectorAll(
  '.card, .module-card, .testimonial-card, .ticket-card, ' +
  '.schedule-item, .faq-item, .checklist-item, .brand-main-card, .sponsor-card, .gallery-photo'
).forEach(el => {
  el.classList.add('reveal-on-scroll');
  // Itens de uma mesma lista entram em cascata, e nao todos de uma vez. O
  // teto de 5 evita que o fim de uma lista longa demore a aparecer.
  const ordem = Math.min([...el.parentElement.children].indexOf(el), 5);
  el.style.setProperty('--reveal-atraso', `${ordem * 70}ms`);
  revealObserver.observe(el);
});

const revealStyle = document.createElement('style');
revealStyle.textContent = `
  .reveal-on-scroll {
    opacity: 0;
    transform: translateY(24px) scale(0.985);
    transition: opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-atraso, 0ms),
                transform 0.6s cubic-bezier(0.22, 1, 0.36, 1) var(--reveal-atraso, 0ms);
  }
  .reveal-on-scroll.revealed {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  @media (prefers-reduced-motion: reduce) {
    .reveal-on-scroll { opacity: 1; transform: none; transition: none; }
  }
`;
document.head.appendChild(revealStyle);

// === BARRA DE PROGRESSO DE LEITURA ===
// Escala em X em vez de mudar a largura: fica no compositor, sem relayout a
// cada scroll.
const barraProgresso = document.getElementById('scroll-progress');
if (barraProgresso) {
  let agendado = false;
  const pintarProgresso = () => {
    const rolavel = document.documentElement.scrollHeight - window.innerHeight;
    const razao = rolavel > 0 ? Math.min(1, window.scrollY / rolavel) : 0;
    barraProgresso.style.transform = `scaleX(${razao})`;
    agendado = false;
  };
  window.addEventListener('scroll', () => {
    if (!agendado) { agendado = true; requestAnimationFrame(pintarProgresso); }
  }, { passive: true });
  pintarProgresso();
}

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

// === CARROSSÉIS ===
// Roda em qualquer largura. Quantos cards aparecem por vez vem de `perView`,
// que e reavaliado no resize; o deslocamento e medido em pixels a partir do
// proprio item, e nao em porcentagem, para o `gap` do flex nao desalinhar a
// conta. O autoplay da a volta e pausa enquanto o ponteiro (ou o foco do
// teclado) estiver dentro do carrossel, voltando sozinho na saida.
function buildCarousel(containerId, dotsContainerId, options = {}) {
  const { autoplayMs = 0, perView = () => 1 } = options;
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

  let idx = 0;
  // Comeca em 0, e nao em 1, para a primeira chamada de aplicaPerView() nunca
  // bater com o valor atual: no celular perView() devolve 1 e o retorno
  // antecipado pularia a montagem dos pontos.
  let visiveis = 0;
  let dots = [];

  // Ultimo indice util: alem dele sobraria espaco vazio no fim do trilho.
  const maxIdx = () => Math.max(0, items.length - visiveis);

  function montaDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    dotsEl.classList.add('is-active');
    dots = Array.from({ length: maxIdx() + 1 }, (_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel-dot';
      dot.setAttribute('aria-label', `Ir para o slide ${i + 1}`);
      dot.addEventListener('click', () => { goTo(i); reiniciaAutoplay(); });
      dotsEl.appendChild(dot);
      return dot;
    });
  }

  function aplicaPerView() {
    const novo = Math.max(1, Math.min(perView(), items.length));
    if (novo === visiveis) return false;
    visiveis = novo;
    track.style.setProperty('--per-view', visiveis);
    montaDots();
    return true;
  }

  function goTo(n) {
    const ultimo = maxIdx();
    // Da a volta nas duas pontas: o autoplay nunca fica preso no fim.
    idx = n < 0 ? ultimo : n > ultimo ? 0 : n;
    const desloc = items[idx].offsetLeft - items[0].offsetLeft;
    track.style.transform = `translateX(${-desloc}px)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  // === AUTOPLAY ===
  // Avanca sozinho e da a volta no fim. Pausa enquanto o ponteiro estiver em
  // cima ou o foco do teclado estiver dentro, e volta a girar na saida.
  let timer = null;
  let pausas = 0;
  const prefereMenosMovimento =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const podeGirar = () => autoplayMs && !prefereMenosMovimento && pausas === 0;

  function iniciaAutoplay() {
    paraAutoplay();
    if (!podeGirar()) return;
    timer = setInterval(() => goTo(idx + 1), autoplayMs);
  }
  function paraAutoplay() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  // Contador em vez de booleano: hover e foco podem se sobrepor, e sair de um
  // deles nao pode religar o giro enquanto o outro ainda vale.
  const pausa = () => { pausas++; paraAutoplay(); };
  const retoma = () => { pausas = Math.max(0, pausas - 1); iniciaAutoplay(); };
  const reiniciaAutoplay = () => iniciaAutoplay();

  outer.addEventListener('mouseenter', pausa);
  outer.addEventListener('mouseleave', retoma);
  outer.addEventListener('focusin', pausa);
  outer.addEventListener('focusout', retoma);

  prevBtn.addEventListener('click', () => { goTo(idx - 1); reiniciaAutoplay(); });
  nextBtn.addEventListener('click', () => { goTo(idx + 1); reiniciaAutoplay(); });

  // Suporte a swipe
  let tx = 0;
  outer.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  outer.addEventListener('touchend', e => {
    const dx = tx - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) { goTo(dx > 0 ? idx + 1 : idx - 1); reiniciaAutoplay(); }
  }, { passive: true });

  // Nao gira em aba oculta: gastaria bateria e a pessoa voltaria num slide
  // aleatorio.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) paraAutoplay();
    else iniciaAutoplay();
  });

  window.addEventListener('resize', () => {
    // Com menos cards por vez o indice atual pode passar do fim do trilho.
    if (aplicaPerView()) idx = Math.min(idx, maxIdx());
    goTo(idx);
  }, { passive: true });

  aplicaPerView();
  goTo(0);
  iniciaAutoplay();
}

// 3 cards no desktop, 2 no tablet, 1 no celular.
const cardsPorVez = () => {
  const w = window.innerWidth;
  return w > 900 ? 3 : w > 600 ? 2 : 1;
};

buildCarousel('speakers-carousel', 'speakers-dots', {
  autoplayMs: 2000,
  perView: cardsPorVez,
});
