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

function mostrarPainel() {
  $('#tela-login').hidden = true;
  $('#tela-painel').hidden = false;
  carregarLeads();
}

$$('.aba').forEach(aba => aba.addEventListener('click', () => {
  $$('.aba').forEach(a => a.classList.toggle('ativa', a === aba));
  $$('.painel-aba').forEach(p => { p.hidden = p.dataset.painel !== aba.dataset.aba; });
  ({ leads: carregarLeads, mensagens: carregarMensagens, envios: carregarEnvios })[aba.dataset.aba]();
}));

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

async function carregarLeads() {
  const busca = $('#busca-leads').value.trim();
  const { leads, estat } = await api(`/api/admin/leads?busca=${encodeURIComponent(busca)}`);

  $('#cards-estat').innerHTML = [
    ['Leads', estat.total],
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
          <td>
            <button class="btn-mini" data-optout="${esc(l.id)}" data-valor="${l.optout ? 0 : 1}">
              ${l.optout ? 'Reativar' : 'Descadastrar'}
            </button>
            <button class="btn-mini perigo" data-excluir-lead="${esc(l.id)}">Excluir</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="vazio">Nenhum lead ainda.</td></tr>';
}

$('#corpo-leads').addEventListener('click', async e => {
  const btOptout = e.target.closest('[data-optout]');
  const btExcluir = e.target.closest('[data-excluir-lead]');

  if (btOptout) {
    await api(`/api/admin/leads/${btOptout.dataset.optout}`, {
      method: 'PATCH',
      body: JSON.stringify({ optout: btOptout.dataset.valor === '1' }),
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

// ----------------------------------------------------------- mensagens
$('#ver-arquivadas').addEventListener('change', carregarMensagens);

function descreverQuando(m) {
  if (m.tipo === 'data') return `Em ${dataBR(m.enviar_em)}`;
  const min = m.atraso_minutos;
  if (min === 0) return 'Imediatamente após o cadastro';
  if (min % 1440 === 0) return `${min / 1440} dia(s) após o cadastro`;
  if (min % 60 === 0) return `${min / 60} hora(s) após o cadastro`;
  return `${min} minuto(s) após o cadastro`;
}

async function carregarMensagens() {
  const arq = $('#ver-arquivadas').checked ? 1 : 0;
  const { mensagens } = await api(`/api/admin/mensagens?arquivadas=${arq}`);

  $('#lista-mensagens').innerHTML = mensagens.length
    ? mensagens.map(m => `
        <div class="msg-card ${m.ativo ? '' : 'inativa'}">
          <div class="msg-info">
            <div class="msg-topo">
              <h3>${esc(m.titulo)}</h3>
              <span class="selo ${m.ativo ? 'selo-ok' : 'selo-off'}">${m.ativo ? 'ativa' : 'pausada'}</span>
            </div>
            <div class="msg-quando">${esc(descreverQuando(m))}</div>
            <div class="msg-texto">${esc(m.texto)}</div>
            <div class="msg-stats">${m.enviados || 0} enviadas · ${m.erros || 0} falhas</div>
          </div>
          <div class="msg-acoes">
            <button class="btn-mini" data-editar="${m.id}">Editar</button>
            <button class="btn-mini" data-acao="${m.ativo ? 'desativar' : 'ativar'}" data-id="${m.id}">
              ${m.ativo ? 'Pausar' : 'Ativar'}
            </button>
            <button class="btn-mini" data-acao="${m.arquivado ? 'desarquivar' : 'arquivar'}" data-id="${m.id}">
              ${m.arquivado ? 'Desarquivar' : 'Arquivar'}
            </button>
            <button class="btn-mini perigo" data-excluir="${m.id}">Excluir</button>
          </div>
        </div>`).join('')
    : `<div class="vazio">Nenhuma mensagem ${arq ? 'arquivada' : 'cadastrada'}.</div>`;

  cacheMensagens = mensagens;
}

let cacheMensagens = [];

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
$$('[data-fechar]').forEach(el => el.addEventListener('click', fecharModais));
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModais(); });

$('#campo-tipo').addEventListener('change', e => {
  $('#bloco-atraso').hidden = e.target.value !== 'atraso';
  $('#bloco-data').hidden = e.target.value !== 'data';
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
  formMsg.ativo.checked = m ? !!m.ativo : true;

  const [valor, unidade] = decompor(m?.atraso_minutos);
  formMsg.atraso_valor.value = m?.tipo === 'data' ? 10 : valor;
  formMsg.atraso_unidade.value = String(unidade);

  if (m?.enviar_em) {
    // O input datetime-local não aceita sufixo de fuso; convertemos para o
    // horário de Brasília e cortamos, senão o campo abre em UTC e o
    // operador vê 3 horas a mais do que agendou.
    const d = new Date(m.enviar_em);
    const br = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    formMsg.enviar_em.value = new Date(br.getTime() - br.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
  }

  $('#campo-tipo').dispatchEvent(new Event('change'));
  modalMsg.hidden = false;
}

$('#btn-nova').addEventListener('click', () => abrirModalMensagem(null));

formMsg.addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#msg-erro');
  erro.hidden = true;

  const corpo = {
    titulo: formMsg.titulo.value,
    texto: formMsg.texto.value,
    tipo: formMsg.tipo.value,
    ativo: formMsg.ativo.checked,
  };

  if (corpo.tipo === 'atraso') {
    corpo.atraso_minutos = Number(formMsg.atraso_valor.value) * Number(formMsg.atraso_unidade.value);
  } else {
    if (!formMsg.enviar_em.value) {
      erro.textContent = 'Escolha a data e a hora do envio.';
      erro.hidden = false;
      return;
    }
    // -03:00 explícito: o valor digitado é horário de Brasília, não o fuso
    // do computador de quem opera o painel.
    corpo.enviar_em = `${formMsg.enviar_em.value}:00-03:00`;
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
async function carregarEnvios() {
  const { envios } = await api('/api/admin/envios');
  const selo = { enviado: 'selo-ok', erro: 'selo-erro', enviando: 'selo-andamento' };

  $('#corpo-envios').innerHTML = envios.length
    ? envios.map(e => `
        <tr>
          <td>${esc(dataBR(e.enviado_em))}</td>
          <td>${esc(e.lead_nome || '—')}<br><small>${esc(telBR(e.lead_whatsapp))}</small></td>
          <td>${esc(e.mensagem_titulo || '—')}</td>
          <td><span class="selo ${selo[e.status] || 'selo-off'}">${esc(e.status)}</span></td>
          <td>${esc((e.detalhe || '').slice(0, 90))}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="vazio">Nenhum envio ainda.</td></tr>';
}

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
