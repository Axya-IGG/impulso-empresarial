// ==========================================
// IMPULSO EMPRESARIAL — Painel administrativo
// ==========================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/** Escapa antes de qualquer interpolação em innerHTML. Nome e e-mail vêm de
 *  formulário público: sem isso, um lead com `<img onerror=...>` no nome
 *  executaria script dentro do painel de quem abrisse a lista. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function api(rota, opcoes = {}) {
  const r = await fetch(rota, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });

  // O 401 do próprio login significa "senha errada", não "sessão expirada":
  // sem esta exceção, quem erra a senha lê que a sessão caiu e não entende
  // que basta digitar de novo.
  if (r.status === 401 && !rota.startsWith('/api/login')) {
    mostrarLogin();
    throw new Error('Sessão expirada. Entre novamente.');
  }

  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`);
  return corpo;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

const dataBR = (iso) => {
  if (!iso) return '—';
  // O banco grava ISO em UTC; o painel é operado do Brasil.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

const telBR = (n) => {
  const s = String(n || '');
  if (s.length < 12) return s;
  return `(${s.slice(2, 4)}) ${s.slice(4, 9)}-${s.slice(9)}`;
};

// ------------------------------------------------------------ navegação
function mostrarLogin() {
  $('#tela-login').hidden = false;
  $('#tela-painel').hidden = true;
}

// Cada aba tem sua propria URL (#leads, #recebidas...), pra dar pra
// favoritar uma aba especifica em vez de sempre cair na de Leads.
const ABAS_VALIDAS = ['leads', 'mensagens', 'envios', 'recebidas'];
const CARREGAR_ABA = { leads: carregarLeads, mensagens: carregarMensagens, envios: carregarEnvios, recebidas: carregarRecebidas };

function mostrarAba(nome) {
  if (!ABAS_VALIDAS.includes(nome)) nome = 'leads';
  $$('.aba').forEach(a => a.classList.toggle('ativa', a.dataset.aba === nome));
  $$('.painel-aba').forEach(p => { p.hidden = p.dataset.painel !== nome; });
  history.replaceState(null, '', `#${nome}`);
  CARREGAR_ABA[nome]();
}

function mostrarPainel() {
  $('#tela-login').hidden = true;
  $('#tela-painel').hidden = false;
  const aba = location.hash.slice(1);
  mostrarAba(aba);
  // So' o contador (nao a lista inteira) pra badge aparecer sem precisar
  // abrir a aba - e' o que avisa que chegou resposta nova. Se a aba que
  // abriu ja e' a propria caixa de entrada, ela mesma ja atualizou o
  // contador ao carregar a lista inteira.
  if (aba !== 'recebidas') atualizarContadorRecebidas();
}

$$('.aba').forEach(aba => aba.addEventListener('click', () => mostrarAba(aba.dataset.aba)));

// --------------------------------------------------------------- login
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#login-erro');
  const botao = e.target.querySelector('button');
  erro.hidden = true;
  botao.disabled = true;

  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ senha: e.target.senha.value }),
    });
    e.target.reset();
    mostrarPainel();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await fetch('/api/login', { method: 'DELETE' });
  mostrarLogin();
});

// --------------------------------------------------------------- leads
let buscaTimer;
$('#busca-leads').addEventListener('input', () => {
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(carregarLeads, 300);
});
$('#filtro-comprou').addEventListener('change', carregarLeads);

// UTM gravada na propria compra (ver migrations/005_compras_utm.sql) — "—"
// quando nao comprou, "sem utm" quando comprou mas nenhum utm_* foi
// capturado (link do checkout sem parametro, ou compra de antes desta
// migracao sem sessao/atribuicao pra backfill). O título mostra origem,
// meio, campanha, conteúdo e termo completos; o texto da célula só
// origem/campanha, que já dá pra saber de qual anúncio veio.
function renderUtmCompra(l) {
  if (!l.comprou) return '—';
  const partes = [l.compra_utm_source, l.compra_utm_campaign].filter(Boolean);
  if (!partes.length) return '<span class="utm-vazio">sem utm</span>';
  const detalhe = [
    l.compra_utm_source && `origem: ${l.compra_utm_source}`,
    l.compra_utm_medium && `meio: ${l.compra_utm_medium}`,
    l.compra_utm_campaign && `campanha: ${l.compra_utm_campaign}`,
    l.compra_utm_content && `conteúdo: ${l.compra_utm_content}`,
    l.compra_utm_term && `termo: ${l.compra_utm_term}`,
  ].filter(Boolean).join(' · ');
  return `<span title="${esc(detalhe)}">${esc(partes.join(' / '))}</span>`;
}

async function carregarLeads() {
  const busca = $('#busca-leads').value.trim();
  const comprou = $('#filtro-comprou').value;
  const qs = new URLSearchParams({ busca });
  if (comprou) qs.set('comprou', comprou);
  const { leads, estat } = await api(`/api/admin/leads?${qs}`);

  $('#cards-estat').innerHTML = [
    ['Leads', estat.total],
    ['Compradores', estat.compradores],
    ['Últimas 24h', estat.ultimas24h],
    ['Mensagens enviadas', estat.enviados],
    ['Falhas de envio', estat.erros],
    ['Descadastrados', estat.descadastrados],
  ].map(([r, v]) => `<div class="card"><b>${v ?? 0}</b><span>${r}</span></div>`).join('');

  $('#corpo-leads').innerHTML = leads.length
    ? leads.map(l => `
        <tr>
          <td>${esc(l.nome)}${l.optout ? ' <span class="selo selo-off">saiu</span>' : ''}</td>
          <td>${esc(l.email)}</td>
          <td>${esc(telBR(l.whatsapp))}</td>
          <td>${esc(l.origem || '—')}</td>
          <td>${esc(dataBR(l.criado_em))}</td>
          <td>${l.comprou ? '<span class="selo selo-ok">comprou</span>' : '—'}</td>
          <td>${renderUtmCompra(l)}</td>
          <td>
            <button class="btn-mini" data-comprou="${esc(l.id)}" data-valor="${l.comprou ? 0 : 1}">
              ${l.comprou ? 'Desmarcar compra' : 'Marcar como comprador'}
            </button>
            <button class="btn-mini" data-optout="${esc(l.id)}" data-valor="${l.optout ? 0 : 1}">
              ${l.optout ? 'Reativar' : 'Descadastrar'}
            </button>
            <button class="btn-mini perigo" data-excluir-lead="${esc(l.id)}">Excluir</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="8" class="vazio">Nenhum lead ainda.</td></tr>';
}

$('#corpo-leads').addEventListener('click', async e => {
  const btOptout = e.target.closest('[data-optout]');
  const btComprou = e.target.closest('[data-comprou]');
  const btExcluir = e.target.closest('[data-excluir-lead]');

  if (btOptout) {
    await api(`/api/admin/leads/${btOptout.dataset.optout}`, {
      method: 'PATCH',
      body: JSON.stringify({ optout: btOptout.dataset.valor === '1' }),
    });
    toast('Lead atualizado.');
    carregarLeads();
  }

  if (btComprou) {
    await api(`/api/admin/leads/${btComprou.dataset.comprou}`, {
      method: 'PATCH',
      body: JSON.stringify({ comprou: btComprou.dataset.valor === '1' }),
    });
    toast('Lead atualizado.');
    carregarLeads();
  }

  if (btExcluir) {
    if (!confirm('Excluir este lead? Os envios registrados para ele também somem. Não dá para desfazer.')) return;
    await api(`/api/admin/leads/${btExcluir.dataset.excluirLead}`, { method: 'DELETE' });
    toast('Lead excluído.');
    carregarLeads();
  }
});

// ------------------------------------------------------- modal novo lead
const modalLead = $('#modal-lead');
const formLeadManual = $('#form-lead-manual');

$('#btn-novo-lead').addEventListener('click', () => {
  formLeadManual.reset();
  $('#lead-manual-erro').hidden = true;
  modalLead.hidden = false;
});

formLeadManual.addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#lead-manual-erro');
  const botao = e.target.querySelector('button');
  erro.hidden = true;
  botao.disabled = true;

  try {
    await api('/api/admin/leads', {
      method: 'POST',
      body: JSON.stringify({
        nome: formLeadManual.nome.value,
        email: formLeadManual.email.value,
        whatsapp: formLeadManual.whatsapp.value,
        origem: formLeadManual.origem.value,
        comprou: formLeadManual.comprou.checked,
      }),
    });
    fecharModais();
    toast('Lead adicionado.');
    carregarLeads();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
  }
});

// ----------------------------------------------------------- mensagens
$('#ver-arquivadas').addEventListener('change', carregarMensagens);

const PUBLICOS = {
  todos: 'Todos os leads',
  compradores: 'Só quem comprou',
  nao_compradores: 'Só quem não comprou',
};

function descreverQuando(m) {
  if (m.tipo === 'data') {
    // enviar_em guarda o inicio da janela (sempre 10h em Brasilia) — a data
    // sozinha ja descreve o agendamento, a hora fixa so confundiria, dado
    // que o envio de cada lead sai espalhado, nao nesse horario exato.
    const dia = new Date(m.enviar_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `Em ${dia}, aos poucos entre 10h e 20h`;
  }
  // Mensagem de comprador conta o prazo a partir da compra, não do
  // cadastro — mesma regra do worker (montarFila), só descrita em texto.
  const ancora = m.publico === 'compradores' ? 'a compra' : 'o cadastro';
  const min = m.atraso_minutos;
  if (min === 0) return `Imediatamente após ${ancora}`;
  if (min % 1440 === 0) return `${min / 1440} dia(s) após ${ancora}`;
  if (min % 60 === 0) return `${min / 60} hora(s) após ${ancora}`;
  return `${min} minuto(s) após ${ancora}`;
}

/** dd/mm/aaaa compacto pra ficar ao lado do título — só existe pra tipo
 *  'data', que é o único com um dia fixo no calendário; 'atraso' devolve
 *  null e o chamador simplesmente não desenha a etiqueta. */
function dataEnvioCompacta(m) {
  if (m.tipo !== 'data') return null;
  return new Date(m.enviar_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** enviar_em é sempre 10h em Brasília = 13h UTC (ver mensagens.js no
 *  backend) — nunca cruza a virada do dia, então cortar os 10 primeiros
 *  caracteres do ISO (que vem em UTC) já dá o dia certo em Brasília, sem
 *  precisar converter fuso pra comparar com o período. */
const diaDoEnvio = (m) => m.enviar_em.slice(0, 10);

function passaNoFiltro(m) {
  const publico = $('#filtro-publico-msg').value;
  if (publico && m.publico !== publico) return false;

  const de = $('#filtro-data-de').value;
  const ate = $('#filtro-data-ate').value;
  if (de || ate) {
    // Período só compara com quem tem um dia fixo — 'atraso' é relativo a
    // cada lead (não tem "um dia" pra cair dentro ou fora do intervalo).
    if (m.tipo !== 'data') return false;
    const dia = diaDoEnvio(m);
    if (de && dia < de) return false;
    if (ate && dia > ate) return false;
  }
  return true;
}

let cacheMensagens = [];

async function carregarMensagens() {
  const arq = $('#ver-arquivadas').checked ? 1 : 0;
  const { mensagens } = await api(`/api/admin/mensagens?arquivadas=${arq}`);
  cacheMensagens = mensagens;
  renderizarMensagens();
}

function renderizarMensagens() {
  const periodoAtivo = Boolean($('#filtro-data-de').value || $('#filtro-data-ate').value);
  $('#dica-periodo').hidden = !periodoAtivo;

  const mensagens = cacheMensagens.filter(passaNoFiltro);
  const arq = $('#ver-arquivadas').checked;
  const filtrouAlgo = periodoAtivo || $('#filtro-publico-msg').value;

  $('#lista-mensagens').innerHTML = mensagens.length
    ? mensagens.map(m => {
        const dataTopo = dataEnvioCompacta(m);
        return `
        <div class="msg-card ${m.ativo ? '' : 'inativa'}">
          <label class="msg-chave" title="${m.ativo ? 'Pausar' : 'Ativar'}">
            <input type="checkbox" data-chave="${m.id}" ${m.ativo ? 'checked' : ''} />
            <span class="msg-chave-trilho"></span>
          </label>
          <div class="msg-info">
            <div class="msg-topo">
              <h3>${esc(m.titulo)}</h3>
              ${dataTopo ? `<span class="msg-data-topo">${esc(dataTopo)}</span>` : ''}
              <span class="selo ${m.ativo ? 'selo-ok' : 'selo-off'}">${m.ativo ? 'ativa' : 'pausada'}</span>
              ${m.template_nome
                ? `<span class="selo selo-oficial" title="Template: ${esc(m.template_nome)}">Template ativo</span>`
                : '<span class="selo selo-off" title="Sem template aprovado pela Meta, nao entra na fila de envio">Sem template</span>'}
            </div>
            <div class="msg-quando">
              ${esc(descreverQuando(m))} · ${esc(PUBLICOS[m.publico] || PUBLICOS.todos)}
            </div>
            <div class="msg-texto">${esc(m.texto)}</div>
            <div class="msg-stats">${m.enviados || 0} enviadas · ${m.erros || 0} falhas</div>
          </div>
          <div class="msg-acoes">
            <button class="btn-mini" data-editar="${m.id}">Editar</button>
            <button class="btn-mini" data-acao="${m.arquivado ? 'desarquivar' : 'arquivar'}" data-id="${m.id}">
              ${m.arquivado ? 'Desarquivar' : 'Arquivar'}
            </button>
            <button class="btn-mini perigo" data-excluir="${m.id}">Excluir</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="vazio">${filtrouAlgo
        ? 'Nenhuma mensagem bate com esse filtro.'
        : `Nenhuma mensagem ${arq ? 'arquivada' : 'cadastrada'}.`}</div>`;
}

$('#filtro-publico-msg').addEventListener('change', renderizarMensagens);
$('#filtro-data-de').addEventListener('change', renderizarMensagens);
$('#filtro-data-ate').addEventListener('change', renderizarMensagens);

$('#lista-mensagens').addEventListener('change', async e => {
  const chave = e.target.closest('[data-chave]');
  if (!chave) return;
  // Otimista: o próprio clique já moveu o visual da chave, então só
  // reverte se o servidor recusar — não trava esperando a resposta.
  try {
    await api(`/api/admin/mensagens/${chave.dataset.chave}`, {
      method: 'PATCH',
      body: JSON.stringify({ acao: chave.checked ? 'ativar' : 'desativar' }),
    });
    toast(chave.checked ? 'Mensagem ativada.' : 'Mensagem pausada.');
    carregarMensagens();
  } catch (err) {
    chave.checked = !chave.checked;
    toast(err.message);
  }
});

$('#lista-mensagens').addEventListener('click', async e => {
  const bt = e.target.closest('[data-acao], [data-editar], [data-excluir]');
  if (!bt) return;

  if (bt.dataset.editar) return abrirModalMensagem(
    cacheMensagens.find(m => String(m.id) === bt.dataset.editar));

  if (bt.dataset.excluir) {
    if (!confirm('Excluir esta mensagem? O histórico de envios dela também some.\n\nPara só parar os disparos, use Pausar ou Arquivar.')) return;
    await api(`/api/admin/mensagens/${bt.dataset.excluir}`, { method: 'DELETE' });
    toast('Mensagem excluída.');
    return carregarMensagens();
  }

  await api(`/api/admin/mensagens/${bt.dataset.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ acao: bt.dataset.acao }),
  });
  toast('Mensagem atualizada.');
  carregarMensagens();
});

// ------------------------------------------------------- modal mensagem
const modalMsg = $('#modal-mensagem');
const formMsg = $('#form-mensagem');

const fecharModais = () => $$('.modal').forEach(m => { m.hidden = true; });

// O X e o fundo de CADA modal fecham só aquele modal, não todos — o de teste
// abre por CIMA do de mensagem (os dois ficam visíveis ao mesmo tempo), e
// fechar todos de uma vez no X do de teste devolvia pra lista de mensagens
// em vez de voltar pro formulário que estava sendo editado por baixo.
$$('[data-fechar]').forEach(el => el.addEventListener('click', () => {
  el.closest('.modal').hidden = true;
}));

// Esc fecha só o modal mais de cima. Todo .modal tem o mesmo z-index, então
// quem aparece por cima é quem vem depois no HTML — daí pegar o último
// visível da lista, não simplesmente "um modal qualquer".
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const abertos = $$('.modal:not([hidden])');
  if (abertos.length) abertos[abertos.length - 1].hidden = true;
});

$('#campo-tipo').addEventListener('change', e => {
  $('#bloco-atraso').hidden = e.target.value !== 'atraso';
  $('#bloco-data').hidden = e.target.value !== 'data';
});

// O rótulo do "atraso" muda com o público: para quem já comprou, o prazo
// conta a partir da compra, não do cadastro (é assim que o worker calcula
// — ver montarFila em worker-remarketing/src/index.js). Sem isso o painel
// diria uma coisa e o envio real faria outra.
$('#campo-publico').addEventListener('change', e => {
  $('#opcao-atraso-cadastro').textContent =
    e.target.value === 'compradores' ? 'Tempo após a compra' : 'Tempo após o cadastro do lead';
});

/** Divide os minutos na maior unidade inteira, para o formulário reabrir
 *  mostrando "2 dias" em vez de "2880 minutos". */
function decompor(min) {
  if (min && min % 1440 === 0) return [min / 1440, 1440];
  if (min && min % 60 === 0) return [min / 60, 60];
  return [min ?? 0, 1];
}

function abrirModalMensagem(m) {
  formMsg.reset();
  $('#msg-erro').hidden = true;
  $('#modal-titulo').textContent = m ? 'Editar mensagem' : 'Nova mensagem';

  formMsg.id.value = m?.id || '';
  formMsg.titulo.value = m?.titulo || '';
  formMsg.texto.value = m?.texto || '';
  formMsg.tipo.value = m?.tipo || 'atraso';
  formMsg.publico.value = m?.publico || 'todos';
  formMsg.ativo.checked = m ? !!m.ativo : true;
  $('#campo-publico').dispatchEvent(new Event('change'));

  const [valor, unidade] = decompor(m?.atraso_minutos);
  formMsg.atraso_valor.value = m?.tipo === 'data' ? 10 : valor;
  formMsg.atraso_unidade.value = String(unidade);

  if (m?.enviar_em) {
    // O input date não aceita sufixo de fuso; convertemos para o horário de
    // Brasília antes de cortar, senão o campo pode abrir um dia adiantado ou
    // atrasado (o enviar_em salvo está em UTC, 10h em Brasília = 13h UTC).
    const d = new Date(m.enviar_em);
    const br = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    formMsg.enviar_em.value = new Date(br.getTime() - br.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
  }

  $('#campo-tipo').dispatchEvent(new Event('change'));
  modalMsg.hidden = false;
}

$('#btn-nova').addEventListener('click', () => abrirModalMensagem(null));

// ------------------------------------------------- formatação (WhatsApp)
// Envolve a seleção com o símbolo (*negrito*, _itálico_, ~tachado~) — texto
// puro, sem HTML: é literalmente assim que o WhatsApp reconhece a
// formatação, então o que fica no textarea é exatamente o que chega pra
// quem recebe. Clicar de novo em cima de um trecho já marcado desfaz, pra
// dar pra alternar sem precisar apagar os símbolos na mão.
function formatarSelecao(campo, marcador) {
  const inicio = campo.selectionStart;
  const fim = campo.selectionEnd;
  const valor = campo.value;
  const selecionado = valor.slice(inicio, fim);

  const antes = valor.slice(Math.max(0, inicio - marcador.length), inicio);
  const depois = valor.slice(fim, fim + marcador.length);
  const jaMarcado = selecionado && antes === marcador && depois === marcador;

  if (jaMarcado) {
    campo.value = valor.slice(0, inicio - marcador.length) + selecionado + valor.slice(fim + marcador.length);
    campo.selectionStart = inicio - marcador.length;
    campo.selectionEnd = fim - marcador.length;
  } else {
    campo.value = valor.slice(0, inicio) + marcador + selecionado + marcador + valor.slice(fim);
    // Sem seleção, o cursor fica entre os dois símbolos, pronto pra digitar;
    // com seleção, continua abraçando o texto marcado (não o símbolo).
    campo.selectionStart = inicio + marcador.length;
    campo.selectionEnd = fim + marcador.length;
  }
  campo.focus();
}

$$('.msg-formatacao [data-formatar]').forEach(bt => bt.addEventListener('click', () => {
  formatarSelecao(formMsg.texto, bt.dataset.formatar);
}));

formMsg.addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#msg-erro');
  erro.hidden = true;

  const corpo = {
    titulo: formMsg.titulo.value,
    texto: formMsg.texto.value,
    tipo: formMsg.tipo.value,
    publico: formMsg.publico.value,
    ativo: formMsg.ativo.checked,
  };

  if (corpo.tipo === 'atraso') {
    corpo.atraso_minutos = Number(formMsg.atraso_valor.value) * Number(formMsg.atraso_unidade.value);
  } else {
    if (!formMsg.enviar_em.value) {
      erro.textContent = 'Escolha o dia do envio.';
      erro.hidden = false;
      return;
    }
    // Só o dia (AAAA-MM-DD): a hora não é escolhida aqui, o backend fixa o
    // início da janela de espalhamento (10h em Brasília) sozinho.
    corpo.enviar_em = formMsg.enviar_em.value;
  }

  const id = formMsg.id.value;
  try {
    await api(id ? `/api/admin/mensagens/${id}` : '/api/admin/mensagens', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(corpo),
    });
    fecharModais();
    toast(id ? 'Mensagem salva.' : 'Mensagem criada.');
    carregarMensagens();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  }
});

// ---------------------------------------------------------- envio teste
$('#btn-testar').addEventListener('click', () => {
  if (!formMsg.texto.value.trim()) {
    $('#msg-erro').textContent = 'Escreva o texto antes de testar.';
    $('#msg-erro').hidden = false;
    return;
  }
  $('#teste-aviso').hidden = true;
  $('#modal-teste').hidden = false;
});

$('#form-teste').addEventListener('submit', async e => {
  e.preventDefault();
  const aviso = $('#teste-aviso');
  const botao = e.target.querySelector('button');
  aviso.hidden = true;
  botao.disabled = true;

  try {
    await api('/api/admin/testar', {
      method: 'POST',
      body: JSON.stringify({
        whatsapp: e.target.whatsapp.value,
        texto: formMsg.texto.value,
        nome: 'Teste Impulso',
      }),
    });
    aviso.className = 'alerta alerta-ok';
    aviso.textContent = 'Enviado. Confira o WhatsApp.';
  } catch (err) {
    aviso.className = 'alerta alerta-erro';
    aviso.textContent = err.message;
  } finally {
    aviso.hidden = false;
    botao.disabled = false;
  }
});

// -------------------------------------------------------------- envios
/** Preenche o select de mensagens sem perder a escolha atual — a lista que
 *  vem da API é sempre o universo INTEIRO (o backend ignora os filtros só
 *  pra montar essa lista), então repopular a cada carregarEnvios() não faz
 *  as opções mudarem debaixo do operador. */
function popularFiltroEnvioMensagem(mensagens) {
  const select = $('#filtro-envio-mensagem');
  const atual = select.value;
  select.innerHTML = '<option value="">Todas as mensagens</option>' +
    mensagens.map(m => `<option value="${m.id}">${esc(m.titulo)}</option>`).join('');
  select.value = atual;
}

async function carregarEnvios() {
  const qs = new URLSearchParams();
  const busca = $('#busca-envios').value.trim();
  const mensagemId = $('#filtro-envio-mensagem').value;
  const status = $('#filtro-envio-status').value;
  const de = $('#filtro-envio-de').value;
  const ate = $('#filtro-envio-ate').value;
  if (busca) qs.set('busca', busca);
  if (mensagemId) qs.set('mensagem_id', mensagemId);
  if (status) qs.set('status', status);
  if (de) qs.set('de', de);
  if (ate) qs.set('ate', ate);

  const { envios, mensagens } = await api(`/api/admin/envios?${qs}`);
  popularFiltroEnvioMensagem(mensagens);

  const selo = { enviado: 'selo-ok', erro: 'selo-erro', enviando: 'selo-andamento' };
  const filtrouAlgo = Boolean(busca || mensagemId || status || de || ate);

  $('#corpo-envios').innerHTML = envios.length
    ? envios.map(e => `
        <tr>
          <td>${esc(dataBR(e.enviado_em))}</td>
          <td>${esc(e.lead_nome || '—')}<br><small>${esc(telBR(e.lead_whatsapp))}</small></td>
          <td>${esc(e.mensagem_titulo || '—')}</td>
          <td><span class="selo ${selo[e.status] || 'selo-off'}">${esc(e.status)}</span></td>
          <td>${esc((e.detalhe || '').slice(0, 90))}</td>
          <td>${e.status === 'erro' ? `<button class="btn-mini" data-reenviar="${e.id}">Reenviar</button>` : ''}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="vazio">${filtrouAlgo ? 'Nenhum envio bate com esse filtro.' : 'Nenhum envio ainda.'}</td></tr>`;
}

$('#corpo-envios').addEventListener('click', async e => {
  const bt = e.target.closest('[data-reenviar]');
  if (!bt) return;

  bt.disabled = true;
  bt.textContent = 'Enviando...';
  try {
    await api('/api/admin/reenviar', {
      method: 'POST',
      body: JSON.stringify({ id: Number(bt.dataset.reenviar) }),
    });
    toast('Mensagem reenviada.');
  } catch (err) {
    toast(err.message);
  }
  carregarEnvios();
});

let buscaEnviosTimer;
$('#busca-envios').addEventListener('input', () => {
  clearTimeout(buscaEnviosTimer);
  buscaEnviosTimer = setTimeout(carregarEnvios, 300);
});
$('#filtro-envio-mensagem').addEventListener('change', carregarEnvios);
$('#filtro-envio-status').addEventListener('change', carregarEnvios);
$('#filtro-envio-de').addEventListener('change', carregarEnvios);
$('#filtro-envio-ate').addEventListener('change', carregarEnvios);

// ----------------------------------------------------------- recebidas
// Layout do WhatsApp Web: lista de conversas fixa a esquerda (mais recente
// no topo) e a conversa aberta a direita, com historico e caixa de texto.
async function atualizarContadorRecebidas() {
  const el = $('#contador-recebidas');
  try {
    const { nao_lidas } = await api('/api/admin/recebidas');
    el.textContent = nao_lidas;
    el.hidden = nao_lidas === 0;
  } catch {
    el.hidden = true;
  }
}

const ICONE_LIDO = '<svg viewBox="0 0 16 11" aria-hidden="true"><path d="M11.07.65 10.4.1a.37.37 0 0 0-.52.06L4.95 6.17 2.07 3.84a.37.37 0 0 0-.52.06l-.53.65a.37.37 0 0 0 .06.52l3.6 2.92c.16.13.4.1.52-.06L11.13 1.17a.37.37 0 0 0-.06-.52zm3.56 0-.67-.55a.37.37 0 0 0-.52.06L8.51 6.17l-.62-.5-.94 1.17 1.33 1.08c.16.13.4.1.52-.06l6.28-7.75a.37.37 0 0 0-.06-.52z"/></svg>';

const caixa = { conversas: [], aberta: null, filtro: 'tudo', totalThread: 0 };
const formConversa = $('#form-conversa');

const paraData = (iso) => new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
const diaSP = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const horaSP = (d) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

function rotuloDia(d) {
  const hoje = new Date();
  const ontem = new Date(Date.now() - 864e5);
  if (diaSP(d) === diaSP(hoje)) return 'Hoje';
  if (diaSP(d) === diaSP(ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Mesma regra da lista do WhatsApp: hoje mostra a hora, ontem "Ontem",
// a ultima semana o dia da semana, e antes disso a data.
function quandoLista(iso) {
  const d = paraData(iso);
  if (isNaN(d)) return '';
  const rotulo = rotuloDia(d);
  if (rotulo === 'Hoje') return horaSP(d);
  if (rotulo === 'Ontem') return 'Ontem';
  if (Date.now() - d < 6 * 864e5) {
    const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
    return dia.charAt(0).toUpperCase() + dia.slice(1);
  }
  return rotulo;
}

// Mesma marcacao do WhatsApp (*negrito*, _italico_, ~riscado~) e link
// clicavel. Roda DEPOIS do esc(), entao so' gera as tags daqui — nada do
// texto do lead vira HTML.
function formatarWhats(texto) {
  return esc(texto)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>');
}
// Na previa da lista o WhatsApp mostra o texto sem os simbolos de marcacao.
const semMarcacao = (t) => String(t || '').replace(/[*_~]/g, '');

const nomeDe = (c) => c.lead_nome || telBR(c.whatsapp);
const inicial = (nome) => esc(String(nome).trim().charAt(0).toUpperCase() || '?');

function renderLista() {
  const busca = $('#wa-busca').value.trim().toLowerCase();
  const naoLidas = caixa.conversas.filter(c => c.nao_lidas > 0).length;
  $('#wa-filtro-contador').textContent = naoLidas || '';

  const lista = caixa.conversas.filter(c => {
    if (caixa.filtro === 'nao-lidas' && !(c.nao_lidas > 0)) return false;
    if (!busca) return true;
    return nomeDe(c).toLowerCase().includes(busca) || String(c.whatsapp).includes(busca.replace(/\D/g, '') || '\u0000');
  });

  $('#corpo-recebidas').innerHTML = lista.length
    ? lista.map(c => {
        const nome = nomeDe(c);
        const previa = semMarcacao(c.texto).split('\n')[0];
        return `
        <button type="button" class="wa-item ${c.nao_lidas > 0 ? 'nao-lida' : ''} ${c.whatsapp === caixa.aberta ? 'ativo' : ''}" data-abrir="${esc(c.whatsapp)}">
          <div class="wa-avatar">${inicial(nome)}</div>
          <div class="wa-item-corpo">
            <div class="wa-item-linha">
              <span class="wa-item-nome">${esc(nome)}</span>
              <span class="wa-item-quando">${esc(quandoLista(c.recebido_em))}</span>
            </div>
            <div class="wa-item-linha">
              <span class="wa-item-previa">${c.direcao === 'saida' ? ICONE_LIDO : ''}<span>${esc(previa)}</span></span>
              ${c.nao_lidas > 0 ? `<span class="wa-badge">${c.nao_lidas}</span>` : ''}
            </div>
          </div>
        </button>`;
      }).join('')
    : `<div class="wa-lista-vazia">${caixa.conversas.length ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}</div>`;
}

async function carregarRecebidas() {
  const { conversas, nao_lidas } = await api('/api/admin/recebidas');
  caixa.conversas = conversas;

  const el = $('#contador-recebidas');
  el.textContent = nao_lidas;
  el.hidden = nao_lidas === 0;

  renderLista();
}

function renderThread(mensagens) {
  let diaAnterior = '';
  let direcaoAnterior = '';
  $('#conversa-thread').innerHTML = mensagens.map(m => {
    const d = paraData(m.recebido_em);
    const dia = diaSP(d);
    let html = '';
    if (dia !== diaAnterior) {
      html += `<div class="wa-dia">${esc(rotuloDia(d))}</div>`;
      direcaoAnterior = '';
    }
    const inicio = m.direcao !== direcaoAnterior ? 'inicio' : '';
    diaAnterior = dia;
    direcaoAnterior = m.direcao;
    return html + `
      <div class="wa-bolha ${m.direcao} ${inicio}">${formatarWhats(m.texto)}<span class="wa-bolha-meta">${esc(horaSP(d))}${m.direcao === 'saida' ? ICONE_LIDO : ''}</span></div>`;
  }).join('');
  const thread = $('#conversa-thread');
  thread.scrollTop = thread.scrollHeight;
}

async function abrirConversa(whatsapp) {
  const c = caixa.conversas.find(x => x.whatsapp === whatsapp);
  const nome = c ? nomeDe(c) : telBR(whatsapp);

  caixa.aberta = whatsapp;
  caixa.totalThread = 0;
  $('#wa').classList.add('com-conversa');
  $('#wa-vazio').hidden = true;
  $('#wa-aberta').hidden = false;
  $('#wa-topo-avatar').innerHTML = inicial(nome);
  $('#wa-topo-nome').textContent = nome;
  $('#wa-topo-numero').textContent = c?.lead_nome ? telBR(whatsapp) : '';
  $('#conversa-erro').hidden = true;
  $('#conversa-thread').innerHTML = '';
  if (formConversa.whatsapp.value !== whatsapp) formConversa.texto.value = '';
  formConversa.whatsapp.value = whatsapp;
  renderLista();

  await recarregarThread(true);
  formConversa.texto.focus();

  // Buscar a thread marca a conversa como lida no servidor; recarrega a
  // lista pra tirar o badge na hora.
  carregarRecebidas();
}

async function recarregarThread(forcar = false) {
  const whatsapp = caixa.aberta;
  if (!whatsapp) return;
  const { mensagens } = await api(`/api/admin/conversa?whatsapp=${encodeURIComponent(whatsapp)}`);
  // Trocou de conversa enquanto a resposta vinha: descarta, senao a thread
  // de um contato apareceria debaixo do nome de outro.
  if (caixa.aberta !== whatsapp) return;
  if (!forcar && mensagens.length === caixa.totalThread) return;
  caixa.totalThread = mensagens.length;
  renderThread(mensagens);
}

$('#corpo-recebidas').addEventListener('click', e => {
  const bt = e.target.closest('[data-abrir]');
  if (bt) abrirConversa(bt.dataset.abrir);
});

$('#wa-busca').addEventListener('input', renderLista);

$$('.wa-filtro').forEach(bt => bt.addEventListener('click', () => {
  caixa.filtro = bt.dataset.filtro;
  $$('.wa-filtro').forEach(b => b.classList.toggle('ativo', b === bt));
  renderLista();
}));

$('#wa-voltar').addEventListener('click', () => {
  caixa.aberta = null;
  $('#wa').classList.remove('com-conversa');
  $('#wa-aberta').hidden = true;
  $('#wa-vazio').hidden = false;
  renderLista();
});

// Enter envia e Shift+Enter quebra linha, igual ao WhatsApp Web; a caixa
// cresce com o texto ate um limite e depois rola.
formConversa.texto.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    formConversa.requestSubmit();
  }
});
formConversa.texto.addEventListener('input', () => {
  const t = formConversa.texto;
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
});

formConversa.addEventListener('submit', async e => {
  e.preventDefault();
  const texto = formConversa.texto.value.trim();
  if (!texto) return;
  const erroEl = $('#conversa-erro');
  const botao = formConversa.querySelector('.wa-enviar');
  erroEl.hidden = true;
  botao.disabled = true;

  try {
    await api('/api/admin/conversa', {
      method: 'POST',
      body: JSON.stringify({ whatsapp: formConversa.whatsapp.value, texto }),
    });
    formConversa.texto.value = '';
    formConversa.texto.style.height = '';
    await recarregarThread(true);
    carregarRecebidas();
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.hidden = false;
  } finally {
    botao.disabled = false;
    formConversa.texto.focus();
  }
});

// Atualiza sozinho enquanto a aba esta aberta, pra resposta nova aparecer
// sem recarregar a pagina, como no WhatsApp Web.
setInterval(() => {
  const abaAberta = !$('#tela-painel').hidden && !$('[data-painel="recebidas"]').hidden;
  if (!abaAberta || document.hidden) return;
  carregarRecebidas().catch(() => {});
  recarregarThread().catch(() => {});
}, 15000);

// -------------------------------------------------------------- arranque
// Uma chamada protegida decide a tela inicial: com cookie válido o painel
// abre direto, sem pedir a senha de novo a cada recarregamento.
(async () => {
  try {
    await api('/api/admin/sessao');
    mostrarPainel();
  } catch {
    mostrarLogin();
  }
})();
