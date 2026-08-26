/**
 * LPV — HISTÓRICO / LIVRO DE REGISTROS
 *
 * Todos os casos do acervo, de todos os anos, em uma linha por caso, com janela
 * virtual (só o que está em tela vira DOM) e expansão inline da ficha. O tipo do
 * caso não ocupa coluna: vira a cor da borda esquerda da linha (azul =
 * necropsia, rosa = biópsia), e os botões do filtro "Tipo" e os contadores do
 * topo servem de legenda.
 *
 * O livro é o registro de entrada do laboratório, não só o arquivo de laudos
 * prontos: a amostra ganha a linha dela no cadastro da entrada, com tudo o que
 * se sabe do caso. A liberação do laudo só preenche as duas colunas que a
 * entrada não tem como saber — data do laudo e diagnóstico. Por isso o filtro
 * "Laudo" existe: é ele que separa o que já está fechado do que ainda corre.
 */
import { db, auth, logout, hasFullControl } from '../core.js';
import { collection, query, where, getDocs, getDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { anoProtocolo, pesoProtocolo } from '../lib/protocolo.js';
import { ANO_DESCONHECIDO, gravarIndice } from '../lib/livro-indice.js';
import '../components/task-manager.js';

// ================================================================
// CONSTANTES
// ================================================================
const SITUACAO = {
    pago: { label: 'Pago', cls: 'lr-sit-pago' },
    didatico: { label: 'Interesse Didático', cls: 'lr-sit-didatico' },
    pendente: { label: 'Pendente', cls: 'lr-sit-pendente' }
};

const ROTULOS = {
    busca: 'Busca',
    tipo: 'Tipo',
    laudo: 'Laudo',
    situacao: 'Situação',
    ano: 'Ano do protocolo',
    docente: 'Docente',
    posGraduando: 'Pós-graduando',
    especie: 'Espécie',
    sexo: 'Sexo',
    origem: 'Origem',
    remetente: 'Remetente',
    raca: 'Raça'
};

// Filtros que moram no painel "Mais filtros" — alimentam o contador do botão.
const NO_PAINEL = ['docente', 'posGraduando', 'especie', 'sexo', 'origem', 'remetente', 'raca', 'periodo'];

// No celular a barra de filtros fica só com a busca e o tipo: laudo, situação e
// ano também se recolhem para o painel (ver o bloco mobile do historico.css).
// O contador do botão precisa saber disso, senão ele diz "0" com três filtros
// ativos escondidos — que é justamente o caso em que o número importa.
const NO_PAINEL_MOBILE = [...NO_PAINEL, 'laudo', 'situacao', 'ano'];
const telaEstreita = window.matchMedia('(max-width: 1023px)');

const F_VAZIO = {
    busca: '', tipo: 'todos', laudo: '', situacao: '', ano: '',
    docente: '', posGraduando: '', especie: '', sexo: '', origem: '',
    remetente: '', raca: '', campoData: 'dataLaudo', de: '', ate: ''
};

const OVER = 6; // linhas extras renderizadas fora da viewport

// ================================================================
// HELPERS
// ================================================================
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const norm = (v) => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const nf = (n) => Number(n || 0).toLocaleString('pt-BR');

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' */
const br = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');

/** Data (ISO, Date ou timestamp) -> 'YYYY-MM-DD' no fuso local. */
function isoLocal(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Um ano do índice ainda tem caso? `{ biopsia: 0, necropsia: 0 }` já não. */
const temCaso = (contagens) => Object.values(contagens || {}).some((n) => Number(n) > 0);

/** Nome do ano no filtro. '0' é o balde dos protocolos que não têm ano legível. */
const rotuloAno = (a) => (a === ANO_DESCONHECIDO ? 'Sem ano (protocolo inválido)' : a);

/** "Ana Maria Klein" -> "Ana" — a coluna mostra só o primeiro nome, inteiro. */
function curto(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    return partes.length === 0 ? '—' : partes[0];
}

/** Lê uma medida definida no CSS para JS e CSS não saírem de sincronia. */
function medida(nome, padrao) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(nome);
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : padrao;
}

// ================================================================
// DOM
// ================================================================
const el = (id) => document.getElementById(id);

const viewport = el('ledger-viewport');
const track = el('ledger-track');
const vazioBox = el('ledger-empty');
const headEl = el('ledger-head');
const chipsBox = el('ledger-chips');
const painel = el('ledger-panel');
const btnPainel = el('btn-painel');
const painelBadge = el('painel-badge');
const segTipo = el('f-tipo');

const campos = {
    busca: el('f-busca'),
    laudo: el('f-laudo'),
    situacao: el('f-situacao'),
    ano: el('f-ano'),
    docente: el('f-docente'),
    posGraduando: el('f-pos'),
    especie: el('f-especie'),
    sexo: el('f-sexo'),
    origem: el('f-origem'),
    remetente: el('f-remetente'),
    raca: el('f-raca'),
    campoData: el('f-campo-data'),
    de: el('f-de'),
    ate: el('f-ate')
};

const botoesExportar = [el('btn-export-excel'), el('btn-export-excel-mobile')].filter(Boolean);
const botoesApagar = [el('btn-clear-history'), el('btn-clear-history-mobile')].filter(Boolean);

// Apagar o acervo é a única ação irreversível do sistema, e o botão nasce ao
// lado do "Exportar" — que é justamente o que se demonstra numa apresentação.
// Vale para quem responde pelo laudo (professor, pós, admin), a mesma régua do
// `isLaudoManager` das regras do Firestore. Estagiário nem vê o botão, em vez
// de descobrir a barreira só no erro de permissão do servidor.
let podeApagarAcervo = false;

// ================================================================
// ESTADO
// ================================================================
const state = {
    casos: [],
    f: { ...F_VAZIO },
    ordem: { campo: 'protocolo', dir: 'desc' },
    aberto: null,
    scrollTop: 0,
    painelAberto: false,
    carregado: false,
    carregando: false,
    // Cache por ano: trocar o filtro de ano e voltar não relê o Firestore.
    porAno: new Map(),
    meta: null
};

let rowH = 46;
let expH = 300;
let memoSig = null;
let memoRes = [];
let debounceBusca = null;
let rafScroll = null;

// ================================================================
// NORMALIZAÇÃO DOS DADOS
// ================================================================
function normalizarCaso(id, t) {
    const necropsia = t.type === 'necropsia' || (!t.type && t.k7Color === 'azul');
    const dataEntrada = t.dataEntrada || isoLocal(t.createdAt);
    // O laudo liberado é o que fecha a linha do livro. Enquanto não vem, o caso
    // já está aqui — com data de entrada, animal, remetente e o resto — só sem
    // data de laudo e sem diagnóstico.
    //
    // `releasedAt` é o mesmo critério que tira o caso do Mural e que a ficha usa
    // para mostrar o laudo como fechado: um caso não pode estar em andamento numa
    // tela e concluído na outra.
    const liberado = !!t.releasedAt;
    // `dataLaudo` é a data informada na liberação e pode ser retroativa;
    // `releasedAt` (o instante do clique) é o que sobra nos casos liberados
    // antes de o formulário de liberação existir.
    const dataLaudo = liberado
        ? (t.dataLaudo || isoLocal(t.releasedAt) || isoLocal(t.updatedAt))
        : '';
    const situacaoKey = SITUACAO[t.financialStatus] ? t.financialStatus
        : (SITUACAO[t.situacao] ? t.situacao : 'pendente');
    const diagnostico = t.diagnostico || (t.report && t.report.diagnostico) || '';

    const caso = {
        id,
        protocolo: t.protocolo || '—',
        tipo: necropsia ? 'necropsia' : 'biopsia',
        liberado,
        situacao: situacaoKey,
        docente: t.docente || '',
        posGraduando: t.posGraduando || '',
        proprietario: t.proprietario || '',
        remetente: t.remetente || '',
        origem: t.origem || '',
        nome: t.animalNome || '',
        rg: t.animalRg || '',
        especie: t.especie || '',
        sexo: t.sexo || '',
        idade: t.idade || '',
        raca: t.raca || '',
        valor: t.valor || '',
        dataEntrada,
        dataLaudo,
        // O ano do caso é o da série do protocolo, não o da emissão do laudo:
        // um V279-25 laudado em fevereiro de 2026 continua sendo de 2025.
        // Protocolo ilegível cai em ANO_DESCONHECIDO ('0') em vez de ficar sem
        // ano nenhum — assim o caso ainda tem onde aparecer no livro.
        ano: String(t.protocoloAno || anoProtocolo(t.protocolo) || ANO_DESCONHECIDO),
        diagnostico
    };

    caso.pesoProtocolo = Number.isFinite(t.protocoloPeso)
        ? t.protocoloPeso : pesoProtocolo(caso.protocolo);

    caso.blob = norm([
        caso.protocolo, caso.nome, caso.rg, caso.proprietario, caso.remetente,
        caso.docente, caso.posGraduando, caso.especie, caso.raca, caso.sexo,
        caso.origem, caso.diagnostico,
        br(caso.dataEntrada), liberado ? br(caso.dataLaudo) : '',
        caso.tipo === 'necropsia' ? 'necropsia' : 'biopsia',
        liberado ? 'laudo liberado' : 'laudo pendente em aberto'
    ].filter(Boolean).join(' '));

    return caso;
}

// ================================================================
// SINCRONIA COM A FICHA
//
// Esta página não usa `onSnapshot`: ela lê um ano por vez e guarda em cache,
// porque leitura é o recurso que acaba. O preço é que o Firestore não avisa
// quando um caso muda — e um caso excluído na ficha continuaria na lista até
// alguém recarregar a página, que é exatamente a leitura que o cache evitou.
// Por isso o Task Manager dispara eventos e a lista se corrige em memória.
// ================================================================

/** Tira o caso da lista e de todos os caches de ano. Não mexe em contador. */
function tirarDaLista(id) {
    state.casos = state.casos.filter((c) => c.id !== id);
    state.porAno.forEach((lista, ano) => {
        state.porAno.set(ano, lista.filter((c) => c.id !== id));
    });

    if (state.aberto === id) state.aberto = null;
    memoSig = null;
}

/** O caso foi excluído de verdade: sai da lista e desconta dos contadores. */
function removerCasoLocal(id) {
    const caso = state.casos.find((c) => c.id === id);

    tirarDaLista(id);

    // O índice é espelhado aqui: sem descontar, os totais do topo continuariam
    // contando o caso até a próxima leitura do documento `meta/livroRegistros`.
    const anos = state.meta && state.meta.anos;
    if (caso && anos && anos[caso.ano]) {
        if (anos[caso.ano][caso.tipo] > 0) anos[caso.ano][caso.tipo] -= 1;
        // Excluído o último caso do ano, o ano deixa de existir para o livro e
        // não pode continuar no filtro.
        if (!temCaso(anos[caso.ano])) delete anos[caso.ano];
    }

    // O ano em tela pode ter acabado de sumir: cai para "Todos os anos" em vez
    // de ficar com um filtro apontando para um ano que não existe mais.
    const anoSumiu = caso && state.f.ano === caso.ano && !anosDoAcervo().includes(caso.ano);
    if (anoSumiu) {
        state.f.ano = '';
        montarSelectAnos();
        renderTotais();
        carregarCasos('');
        return;
    }

    montarSelectAnos();
    renderTotais();
    render();
}

/** Redesenha a linha de um caso editado na ficha (data, diagnóstico, dados). */
function atualizarCasoLocal(id, bruto) {
    const indice = state.casos.findIndex((c) => c.id === id);
    if (indice === -1) return;   // caso de outro ano, não carregado aqui

    const anterior = state.casos[indice];
    const atualizado = normalizarCaso(id, bruto);

    // Corrigir o protocolo pode mudar o ano da série ou o tipo do caso; no
    // Firestore quem move a contagem é a própria edição da entrada, mas os
    // contadores do topo leem do espelho local.
    const anos = state.meta && state.meta.anos;
    const mudouDeBalde = anterior
        && (anterior.ano !== atualizado.ano || anterior.tipo !== atualizado.tipo);
    if (anos && mudouDeBalde) {
        if (anos[anterior.ano] && anos[anterior.ano][anterior.tipo] > 0) {
            anos[anterior.ano][anterior.tipo] -= 1;
            if (!temCaso(anos[anterior.ano])) delete anos[anterior.ano];
        }
        anos[atualizado.ano] = anos[atualizado.ano] || { biopsia: 0, necropsia: 0 };
        anos[atualizado.ano][atualizado.tipo] = Number(anos[atualizado.ano][atualizado.tipo] || 0) + 1;
        montarSelectAnos();
        renderTotais();
    }

    // O caso pode ter deixado de pertencer ao ano que está na tela: sai da lista
    // em vez de virar uma linha fora de lugar. O cache do ano novo ainda não
    // existe, então nada a inserir.
    if (state.f.ano && atualizado.ano !== state.f.ano) {
        tirarDaLista(id);                      // o caso existe, só não é deste ano
        state.porAno.delete(atualizado.ano);   // força reler o ano de destino
        render();
        return;
    }

    state.casos[indice] = atualizado;
    state.porAno.forEach((lista, ano) => {
        const i = lista.findIndex((c) => c.id === id);
        if (i !== -1) lista[i] = atualizado;
    });

    memoSig = null;
    render();
}

/**
 * Amostra cadastrada com a página aberta. O livro recebe a linha no mesmo
 * instante em que o Mural recebe o cartão — sem esperar recarga, e sem reler do
 * Firestore o ano inteiro que o cache já tem.
 */
function inserirCasoLocal(id, bruto) {
    if (!ehCasoDoLivro(bruto)) return;

    const caso = normalizarCaso(id, bruto);

    // `state.casos` e o cache do ano podem ser o MESMO array (o filtro de ano
    // entrega a lista cacheada): o teste por id evita a linha duplicada.
    const cache = state.porAno.get(caso.ano);
    if (cache && !cache.some((c) => c.id === id)) cache.push(caso);

    // Com filtro de ano ativo, um caso de outro ano não entra na lista em tela;
    // ele já foi para o cache do ano dele (se houver) e aparece quando for a vez.
    const noRecorte = !state.f.ano || state.f.ano === caso.ano;
    if (noRecorte && !state.casos.some((c) => c.id === id)) state.casos.push(caso);

    // Espelho local do índice: quem grava no Firestore é o cadastro da entrada,
    // mas os contadores do topo leem daqui e não podem esperar a próxima carga.
    const anos = state.meta && state.meta.anos;
    if (anos) {
        anos[caso.ano] = anos[caso.ano] || { biopsia: 0, necropsia: 0 };
        anos[caso.ano][caso.tipo] = Number(anos[caso.ano][caso.tipo] || 0) + 1;
    }

    memoSig = null;
    montarSelectAnos();
    atualizarOpcoes();
    renderTotais();
    render();
}

document.addEventListener('lpv:caso-criado', (e) => inserirCasoLocal(e.detail.id, e.detail.task));
document.addEventListener('lpv:caso-excluido', (e) => removerCasoLocal(e.detail.id));
document.addEventListener('lpv:caso-atualizado', (e) => atualizarCasoLocal(e.detail.id, e.detail.task));

// ================================================================
// FILTRO + ORDENAÇÃO (memoizado por assinatura)
// ================================================================

/**
 * A ordem do próprio livro: o protocolo é cronológico (ano da série + número
 * sequencial), não alfabético — "V140-26" vem depois de "V009-26", e não antes.
 * Por ser único e existir em todo caso, ele também é o desempate de qualquer
 * outra coluna.
 *
 * Protocolo ilegível não tem lugar na sequência: fica no fim nas duas direções.
 * O peso desses casos é o maior possível, então em ordem decrescente eles
 * abririam a lista — que é o oposto do que são, uma pendência de cadastro.
 */
function porProtocolo(a, b, sinal) {
    const semA = a.pesoProtocolo === Number.MAX_SAFE_INTEGER;
    const semB = b.pesoProtocolo === Number.MAX_SAFE_INTEGER;
    if (semA || semB) return semA && semB ? 0 : (semA ? 1 : -1);
    return sinal * (a.pesoProtocolo - b.pesoProtocolo);
}
function processar() {
    const { casos, f, ordem } = state;
    const sig = JSON.stringify([casos.length, f, ordem]);
    if (sig === memoSig) return memoRes;

    const termos = norm(f.busca).split(/\s+/).filter(Boolean);
    const contem = (valor, alvo) => !alvo || norm(valor).includes(norm(alvo));

    const out = casos.filter((c) => {
        if (f.tipo !== 'todos' && c.tipo !== f.tipo) return false;
        if (f.laudo === 'liberado' && !c.liberado) return false;
        if (f.laudo === 'pendente' && c.liberado) return false;
        if (f.situacao && c.situacao !== f.situacao) return false;
        if (f.ano && c.ano !== f.ano) return false;
        if (f.docente && c.docente !== f.docente) return false;
        if (f.posGraduando && c.posGraduando !== f.posGraduando) return false;
        if (f.especie && c.especie !== f.especie) return false;
        if (f.sexo && c.sexo !== f.sexo) return false;
        if (f.origem && c.origem !== f.origem) return false;
        if (!contem(c.remetente, f.remetente)) return false;
        if (!contem(c.raca, f.raca)) return false;

        const data = c[f.campoData];
        if (f.de && (!data || data < f.de)) return false;
        if (f.ate && (!data || data > f.ate)) return false;

        if (termos.length && !termos.every((t) => c.blob.includes(t))) return false;
        return true;
    });

    const sinal = ordem.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        if (ordem.campo === 'protocolo') return porProtocolo(a, b, sinal);

        const va = String(a[ordem.campo] ?? '');
        const vb = String(b[ordem.campo] ?? '');
        if (va && !vb) return -1;   // vazios sempre no fim, nas duas direções
        if (!va && vb) return 1;
        // Empate cai no protocolo. Sem isso a ordem dentro do bloco empatado é a
        // que o Firestore devolveu — e empate deixou de ser exceção: todo caso em
        // aberto tem data de laudo vazia, então todos eles empatam entre si.
        if (va === vb) return porProtocolo(a, b, sinal);
        return sinal * va.localeCompare(vb, 'pt-BR', { numeric: true });
    });

    memoSig = sig;
    memoRes = out;
    return out;
}

// ================================================================
// OPÇÕES DOS SELECTS
// ================================================================
function unicos(chave) {
    return [...new Set(state.casos.map((c) => c[chave]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function preencher(select, itens, valorAtual) {
    if (!select) return;
    const placeholder = select.options[0] ? select.options[0].outerHTML : '<option value="">Todos</option>';
    select.innerHTML = placeholder + itens
        .map((i) => `<option value="${esc(i)}">${esc(i)}</option>`)
        .join('');
    select.value = itens.includes(valorAtual) ? valorAtual : '';
}

/**
 * A lista de anos vem do índice (`meta/livroRegistros`), não dos casos em
 * memória — a página carrega um ano por vez, então quem está na tela não
 * conhece os outros anos do acervo.
 */
function montarSelectAnos() {
    const anos = anosDoAcervo();
    if (!campos.ano) return;
    // "Todos os anos" abre a lista por ser o padrão da tela.
    campos.ano.innerHTML = '<option value="">Todos os anos</option>' + anos
        .map((a) => `<option value="${esc(a)}">${esc(rotuloAno(a))}</option>`)
        .join('');
    campos.ano.value = state.f.ano;
}

function atualizarOpcoes() {
    ['docente', 'posGraduando', 'especie', 'sexo', 'origem'].forEach((chave) => {
        preencher(campos[chave], unicos(chave), state.f[chave]);
    });
}

// ================================================================
// RENDER
// ================================================================
function medirLinhas() {
    rowH = medida('--ledger-row-h', 46);
    expH = medida('--ledger-exp-h', 300);
}

function linhaHTML(c, aberto) {
    const sit = SITUACAO[c.situacao] || SITUACAO.pendente;
    const resumo = [c.especie, c.sexo].filter(Boolean).join(' · ');
    // Sem laudo liberado a coluna não fica vazia: um traço não diferencia "não
    // tem data" de "ainda não foi laudado", e é essa a informação que importa
    // numa linha que existe desde a entrada da amostra.
    const laudo = c.liberado
        ? `<span class="lr-laudo">${br(c.dataLaudo)}</span>`
        : '<span class="lr-laudo is-aberto"><i class="fas fa-hourglass-half"></i> Em aberto</span>';
    const diag = c.diagnostico
        ? `<span class="lr-diag lr-truncate" title="${esc(c.diagnostico)}">${esc(c.diagnostico)}</span>`
        : `<span class="lr-diag lr-truncate is-empty">${
            c.liberado ? 'Sem diagnóstico registrado' : 'Aguardando liberação do laudo'
          }</span>`;

    return `
        <div class="ledger-row tipo-${c.tipo}${c.liberado ? '' : ' is-aberto'}" role="button" tabindex="0"
             title="${c.tipo === 'necropsia' ? 'Necropsia' : 'Biópsia'}">
            <i class="lr-chevron fas fa-chevron-right"></i>
            <span class="lr-protocolo">${esc(c.protocolo)}</span>
            <span class="lr-animal lr-truncate">
                <strong>${esc(c.nome || 'Sem nome')}</strong>
                ${resumo ? `<span class="lr-muted">· ${esc(resumo)}</span>` : ''}
            </span>
            <span class="lr-prop lr-truncate">${esc(c.proprietario || '—')}</span>
            <span class="lr-entrada">${br(c.dataEntrada)}</span>
            ${laudo}
            <span class="lr-situacao lr-tag ${sit.cls}">${sit.label}</span>
            <span class="lr-pos lr-truncate">${esc(curto(c.posGraduando))}</span>
            ${diag}
        </div>
        ${aberto ? expansaoHTML(c) : ''}
    `;
}

function item(rotulo, valor) {
    return `<div class="ledger-expand-item"><dt>${rotulo}</dt><dd>${esc(valor || '—')}</dd></div>`;
}

function expansaoHTML(c) {
    return `
        <div class="ledger-expand">
            <dl class="ledger-expand-grid">
                ${item('Tipo', c.tipo === 'necropsia' ? 'Necropsia' : 'Biópsia')}
                ${item('Remetente', c.remetente)}
                ${item('Origem', c.origem)}
                ${item('Docente', c.docente)}
                ${item('Pós-graduando', c.posGraduando)}
                ${item('Proprietário', c.proprietario)}
                ${item('Nome', c.nome)}
                ${item('RG', c.rg)}
                ${item('Espécie', c.especie)}
                ${item('Sexo', c.sexo)}
                ${item('Idade', c.idade)}
                ${item('Raça', c.raca)}
                ${item('Entrada', br(c.dataEntrada))}
                ${item('Laudo', c.liberado ? br(c.dataLaudo) : 'Em aberto')}
                ${item('Valor', c.valor ? `R$ ${c.valor}` : '—')}
            </dl>
            <div class="ledger-expand-diag">
                <span>Diagnóstico</span>
                <p>${esc(c.diagnostico || (c.liberado
                    ? 'Sem diagnóstico registrado.'
                    : 'O laudo ainda não foi liberado — o diagnóstico entra na ficha, na liberação.'))}</p>
            </div>
            <div class="ledger-expand-actions">
                <button type="button" class="is-primary" data-abrir="${esc(c.id)}">
                    <i class="fas fa-folder-open"></i> Abrir ficha completa
                </button>
            </div>
        </div>
    `;
}

function render() {
    const lista = processar();
    const idxAberto = state.aberto == null ? -1 : lista.findIndex((c) => c.id === state.aberto);
    if (idxAberto === -1 && state.aberto != null) state.aberto = null;

    // Altura total da pista: todas as linhas + a expansão aberta (se houver).
    track.style.height = `${lista.length * rowH + (idxAberto >= 0 ? expH : 0)}px`;

    // O cabeçalho é sticky dentro da viewport: cobre `headEl.offsetHeight` do
    // topo, então a faixa realmente visível de linhas é menor na mesma medida.
    // Em coordenadas da pista, ela começa exatamente no scrollTop.
    const alturaVisivel = Math.max(120, viewport.clientHeight - headEl.offsetHeight);
    const scrollTop = state.scrollTop;
    const limite = (idxAberto + 1) * rowH;

    let ini = (idxAberto < 0 || scrollTop < limite)
        ? Math.floor(scrollTop / rowH)
        : Math.max(idxAberto + 1, Math.floor((scrollTop - expH) / rowH));
    ini = Math.max(0, ini - OVER);
    const fim = Math.min(lista.length, ini + Math.ceil(alturaVisivel / rowH) + OVER * 2 + 1);

    const partes = [];
    for (let i = ini; i < fim; i++) {
        const c = lista[i];
        const aberto = c.id === state.aberto;
        const topo = i * rowH + (idxAberto >= 0 && i > idxAberto ? expH : 0);
        // A zebra segue o índice real na lista — a janela virtual reordena o DOM,
        // então nth-child não serve aqui.
        const classes = ['ledger-row-wrap', aberto ? 'is-open' : '', i % 2 ? 'is-odd' : ''];
        partes.push(
            `<div class="${classes.filter(Boolean).join(' ')}" data-id="${esc(c.id)}"
                  style="top:${topo}px">${linhaHTML(c, aberto)}</div>`
        );
    }
    track.innerHTML = partes.join('');

    vazioBox.classList.toggle('hidden', lista.length > 0 || !state.carregado);
    el('foot-filtrados').textContent = nf(lista.length);

    // Quantos do recorte ainda não têm laudo. Some quando é zero: no acervo
    // fechado de um ano antigo, "0 em aberto" é ruído — a informação só existe
    // enquanto houver trabalho correndo.
    const abertos = lista.reduce((n, c) => n + (c.liberado ? 0 : 1), 0);
    el('foot-abertos').textContent = nf(abertos);
    el('foot-abertos-box').classList.toggle('hidden', abertos === 0);
    el('foot-abertos-sep').classList.toggle('hidden', abertos === 0);

    el('foot-render').textContent = nf(Math.max(0, fim - ini));

    atualizarCabecalhoOrdem();
    renderChips();
}

function atualizarCabecalhoOrdem() {
    headEl.querySelectorAll('button[data-sort]').forEach((btn) => {
        const ativo = btn.dataset.sort === state.ordem.campo;
        btn.classList.toggle('is-sorted', ativo);
        const icone = btn.querySelector('i');
        if (icone) {
            icone.className = ativo
                ? `fas fa-sort-${state.ordem.dir === 'asc' ? 'up' : 'down'}`
                : 'fas fa-sort';
        }
    });
}

/**
 * Os contadores do topo falam do acervo inteiro, não do ano carregado — por
 * isso saem do índice. Sem índice, sobra o que está em memória.
 */
function renderTotais() {
    const porAno = (state.meta && state.meta.anos) || null;
    let necro, bio;

    if (porAno) {
        // Piso em 0 por ano: índice gravado antes do desconto ficar transacional
        // pode ter contagem negativa, e isso viraria um total menor que a lista.
        const soma = (chave) => Object.values(porAno)
            .reduce((s, a) => s + Math.max(0, Number(a[chave]) || 0), 0);
        necro = soma('necropsia');
        bio = soma('biopsia');
    } else {
        necro = state.casos.filter((c) => c.tipo === 'necropsia').length;
        bio = state.casos.length - necro;
    }

    el('total-necropsias').textContent = nf(necro);
    el('total-biopsias').textContent = nf(bio);
    el('foot-desde').textContent = anosReais().slice(-1)[0] || '—';
}

// ================================================================
// CHIPS DE FILTRO ATIVO
// ================================================================
function rotuloValor(chave, valor) {
    if (chave === 'tipo') return valor === 'necropsia' ? 'Necropsias' : 'Biópsias';
    if (chave === 'laudo') return valor === 'liberado' ? 'Liberados' : 'Em aberto';
    if (chave === 'situacao') return (SITUACAO[valor] || {}).label || valor;
    if (chave === 'ano') return rotuloAno(valor);
    return valor;
}

function chipsAtivos() {
    const { f } = state;
    const chips = [];

    Object.keys(ROTULOS).forEach((chave) => {
        const valor = f[chave];
        if (!valor || (chave === 'tipo' && valor === 'todos')) return;
        chips.push({ chave, rotulo: ROTULOS[chave], valor: rotuloValor(chave, valor) });
    });

    if (f.de || f.ate) {
        const campo = f.campoData === 'dataEntrada' ? 'Entrada' : 'Laudo';
        const valor = f.de && f.ate ? `${br(f.de)} a ${br(f.ate)}`
            : f.de ? `de ${br(f.de)}` : `até ${br(f.ate)}`;
        chips.push({ chave: 'periodo', rotulo: campo, valor });
    }

    return chips;
}

function renderChips() {
    const chips = chipsAtivos();
    chipsBox.classList.toggle('hidden', chips.length === 0);
    chipsBox.innerHTML = chips.map((c) => `
        <button type="button" class="ledger-chip" data-chip="${esc(c.chave)}">
            <span class="chip-label">${esc(c.rotulo)}:</span>
            <span class="chip-value">${esc(c.valor)}</span>
            <i class="fas fa-times"></i>
        </button>
    `).join('') + (chips.length ? '<button type="button" class="ledger-chip-clear">Limpar tudo</button>' : '');

    const dentro = telaEstreita.matches ? NO_PAINEL_MOBILE : NO_PAINEL;
    const escondidos = chips.filter((c) => dentro.includes(c.chave)).length;
    painelBadge.textContent = escondidos;
    painelBadge.classList.toggle('hidden', escondidos === 0);
}

// ================================================================
// AÇÕES
// ================================================================
function aplicar(chave, valor) {
    state.f[chave] = valor;
    state.aberto = null;
    state.scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
    render();
}

/**
 * O ano não é um filtro em memória como os outros: ele decide o que vem do
 * Firestore. Trocar o ano recarrega a lista (e o cache evita reler).
 */
function aplicarAno(valor) {
    state.f.ano = valor;
    state.aberto = null;
    state.scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
    if (campos.ano) campos.ano.value = valor;
    return carregarCasos(valor);
}

function limparFiltro(chave) {
    if (chave === 'ano') {
        aplicarAno('');   // tirar o filtro de ano = carregar o acervo inteiro
        return;
    }
    if (chave === 'periodo') {
        state.f.de = '';
        state.f.ate = '';
        campos.de.value = '';
        campos.ate.value = '';
        aplicar('de', '');
        return;
    }
    if (chave === 'tipo') {
        sincronizarSegmentado('todos');
        aplicar('tipo', 'todos');
        return;
    }
    if (campos[chave]) campos[chave].value = '';
    aplicar(chave, '');
}

function limparTudo() {
    const anoAtual = state.f.ano;
    state.f = { ...F_VAZIO, ano: anoAtual };   // o ano carregado não é um filtro a limpar
    Object.entries(campos).forEach(([chave, campo]) => {
        if (!campo || chave === 'ano') return;
        campo.value = chave === 'campoData' ? 'dataLaudo' : '';
    });
    sincronizarSegmentado('todos');
    state.aberto = null;
    state.scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
    render();
}

function sincronizarSegmentado(tipo) {
    segTipo.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tipo === tipo);
    });
}

function ordenar(campo) {
    const { ordem } = state;
    state.ordem = ordem.campo === campo
        ? { campo, dir: ordem.dir === 'asc' ? 'desc' : 'asc' }
        : { campo, dir: (campo === 'protocolo' || campo === 'proprietario' || campo === 'situacao') ? 'asc' : 'desc' };
    state.aberto = null;
    render();
}

async function abrirFicha(id) {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
        if (typeof window.openTaskManager === 'function') {
            window.openTaskManager(id);
            return;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    console.warn('Task manager indisponível no momento.');
}

// ================================================================
// EVENTOS
// ================================================================
segTipo.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tipo]');
    if (!btn) return;
    sincronizarSegmentado(btn.dataset.tipo);
    aplicar('tipo', btn.dataset.tipo);
});

campos.busca.addEventListener('input', (e) => {
    const valor = e.target.value;
    clearTimeout(debounceBusca);
    debounceBusca = setTimeout(() => aplicar('busca', valor), 200);
});

['laudo', 'situacao', 'docente', 'posGraduando', 'especie', 'sexo', 'origem',
 'campoData', 'de', 'ate'].forEach((chave) => {
    campos[chave].addEventListener('change', (e) => aplicar(chave, e.target.value));
});

campos.ano.addEventListener('change', (e) => aplicarAno(e.target.value));

['remetente', 'raca'].forEach((chave) => {
    campos[chave].addEventListener('input', (e) => {
        const valor = e.target.value;
        clearTimeout(debounceBusca);
        debounceBusca = setTimeout(() => aplicar(chave, valor), 200);
    });
});

btnPainel.addEventListener('click', () => {
    state.painelAberto = !state.painelAberto;
    painel.classList.toggle('hidden', !state.painelAberto);
    btnPainel.classList.toggle('is-open', state.painelAberto);
    // A marca no <body> é o que deixa o CSS do celular mostrar de volta os
    // campos recolhidos, que vivem fora do #ledger-panel.
    document.body.classList.toggle('ledger-panel-open', state.painelAberto);
});

// Girar o aparelho muda quais filtros estão escondidos, e com isso o número do
// botão. Recontar no evento evita o badge congelado da orientação anterior.
telaEstreita.addEventListener('change', renderChips);

chipsBox.addEventListener('click', (e) => {
    if (e.target.closest('.ledger-chip-clear')) return limparTudo();
    const chip = e.target.closest('[data-chip]');
    if (chip) limparFiltro(chip.dataset.chip);
});

headEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]');
    if (btn) ordenar(btn.dataset.sort);
});

/**
 * Abrir uma linha.
 *
 * No desktop a linha se expande no lugar: a ficha resumida aparece embaixo dela
 * e a lista continua em volta, então dá para descer de caso em caso sem perder
 * o fio.
 *
 * No celular isso não funciona. A janela da lista tem uns 450px e a expansão
 * ocupa 340: abrir uma linha apagava a lista inteira da tela e deixava no lugar
 * um `dl` de duas colunas espremidas — o pior dos dois mundos, porque nem a
 * lista se lê nem a ficha. Lá o toque vai direto para a ficha completa, que é
 * de tela cheia e tem tudo. É também o que o único botão da expansão fazia.
 */
function abrirLinha(id) {
    if (telaEstreita.matches) {
        abrirFicha(id);
        return;
    }
    state.aberto = state.aberto === id ? null : id;
    render();
}

track.addEventListener('click', (e) => {
    const acao = e.target.closest('[data-abrir]');
    if (acao) {
        e.stopPropagation();
        abrirFicha(acao.dataset.abrir);
        return;
    }
    // Cliques dentro da ficha expandida não fecham a linha.
    if (e.target.closest('.ledger-expand')) return;

    const wrap = e.target.closest('.ledger-row-wrap');
    if (!wrap) return;
    abrirLinha(wrap.dataset.id);
});

track.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const linha = e.target.closest('.ledger-row');
    if (!linha) return;
    e.preventDefault();
    abrirLinha(linha.closest('.ledger-row-wrap').dataset.id);
});

/* Girar para o retrato com uma linha expandida deixaria a expansão ocupando a
   janela inteira da lista, que é justamente o que o desvio acima evita. */
telaEstreita.addEventListener('change', (e) => {
    if (e.matches && state.aberto != null) {
        state.aberto = null;
        render();
    }
});

viewport.addEventListener('scroll', () => {
    if (rafScroll) return;
    rafScroll = requestAnimationFrame(() => {
        rafScroll = null;
        state.scrollTop = viewport.scrollTop;
        render();
    });
}, { passive: true });

el('btn-topo').addEventListener('click', () => {
    viewport.scrollTop = 0;
    state.scrollTop = 0;
    render();
});

window.addEventListener('resize', () => {
    medirLinhas();
    render();
});

/**
 * A lista ocupa a altura que sobra da janela, então quantas linhas cabem muda
 * sem que a janela mude de tamanho: abrir "Mais filtros", os chips de filtro
 * ativo aparecerem, o teclado do celular subir. Observar a viewport cobre todos
 * esses casos de uma vez — mais confiável que ligar um listener em cada um.
 */
if (typeof ResizeObserver === 'function') {
    let alturaAnterior = 0;
    new ResizeObserver(() => {
        const altura = Math.round(viewport.clientHeight);
        if (altura === alturaAnterior) return;   // evita re-render em cascata
        alturaAnterior = altura;
        render();
    }).observe(viewport);
}

[el('btn-logout'), el('logout-btn-header')].forEach((btn) => {
    if (btn) btn.addEventListener('click', logout);
});

// ================================================================
// EXPORTAÇÃO EXCEL — exporta o que está no filtro atual
//
// Com o livro mostrando também as amostras em aberto, o filtro "Laudo" é o que
// separa uma cópia do arquivo fechado de um retrato do laboratório inteiro.
// ================================================================
function exportarExcel() {
    const lista = processar();
    if (lista.length === 0) {
        alert('Não há registros no filtro atual para exportar.');
        return;
    }

    const rows = lista.map((c) => [
        c.protocolo,
        br(c.dataEntrada),
        c.liberado ? br(c.dataLaudo) : '---',
        c.liberado ? 'Liberado' : 'Em aberto',
        c.nome || '---',
        c.rg || '---',
        c.especie || '---',
        c.raca || '---',
        c.sexo || '---',
        c.idade || '---',
        c.proprietario || '---',
        c.remetente || '---',
        c.docente || '---',
        c.posGraduando || '---',
        c.tipo === 'necropsia' ? 'Necropsia' : 'Biópsia',
        c.diagnostico || '---',
        c.origem || '---',
        (SITUACAO[c.situacao] || SITUACAO.pendente).label,
        parseFloat(String(c.valor || '0').replace(',', '.')) || 0
    ]);

    // A coluna do laudo entra logo depois da data dele: exportado assim, o livro
    // continua legível de ponta a ponta — dá para ver de um lance de olhos o que
    // já fechou e o que ainda corre.
    const COL_VALOR = 18;
    const total = rows.reduce((soma, row) => soma + row[COL_VALOR], 0);
    const header = ['PROTOCOLO', 'DATA ENTRADA', 'DATA LAUDO', 'LAUDO', 'NOME', 'RG', 'ESPÉCIE', 'RAÇA',
        'SEXO', 'IDADE', 'PROPRIETÁRIO', 'REMETENTE', 'DOCENTE', 'PÓS-GRADUANDO', 'TIPO',
        'DIAGNÓSTICO', 'HVU/EXTERNO', 'SITUAÇÃO', 'VALOR (R$)'];
    const footer = header.map((_, i) => (i === COL_VALOR ? total : (i === 0 ? 'TOTAL' : '')));

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows, footer]);
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellRef]) continue;
            ws[cellRef].s = {
                border: {
                    top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    left: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    right: { style: 'thin', color: { rgb: 'CCCCCC' } }
                },
                alignment: { vertical: 'center', horizontal: 'center' },
                font: { name: 'Arial', sz: 10 }
            };
            if (R === 0) {
                ws[cellRef].s.fill = { fgColor: { rgb: '2F75B5' } };
                ws[cellRef].s.font = { color: { rgb: 'FFFFFF' }, bold: true };
            } else if (R === range.e.r) {
                ws[cellRef].s.fill = { fgColor: { rgb: 'D9D9D9' } };
                ws[cellRef].s.font = { bold: true };
            } else if (R % 2 === 0) {
                ws[cellRef].s.fill = { fgColor: { rgb: 'F2F2F2' } };
            }
            if ([4, 6, 7, 10, 11, 15].includes(C) && R !== 0) ws[cellRef].s.alignment.horizontal = 'left';
        }
    }

    ws['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
        { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 25 }, { wch: 25 },
        { wch: 25 }, { wch: 25 }, { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Livro de Registros');
    XLSX.writeFile(wb, `Livro_Registros_LPV_${new Date().toISOString().slice(0, 10)}.xlsx`);

    // Apagar só fica disponível depois de existir uma cópia exportada — e só
    // para quem responde pelo laudo.
    if (podeApagarAcervo) {
        botoesApagar.forEach((btn) => btn.classList.add('is-visible'));
    }
}

botoesExportar.forEach((btn) => btn.addEventListener('click', exportarExcel));

// ================================================================
// APAGAR HISTÓRICO
// ================================================================
async function apagarHistorico() {
    if (!podeApagarAcervo) {
        alert('Apenas professor, pós-graduando ou admin podem apagar o histórico.');
        return;
    }

    const aviso = 'ATENÇÃO: deseja apagar permanentemente TODO o histórico de laudos liberados?'
        + '\n\nOs casos ainda em aberto permanecem — eles são o trabalho em andamento do Mural.';
    if (!confirm(aviso)) return;

    botoesApagar.forEach((btn) => { btn.disabled = true; });
    try {
        // A tela mostra um ano por vez, mas o botão apaga o acervo inteiro:
        // busca tudo antes de excluir.
        const todos = await buscarTudo();
        // O livro passou a mostrar também as amostras em aberto, e essas são o
        // trabalho que ainda está no Mural: apagar o histórico não pode levar
        // junto o que nem foi laudado.
        const liberados = todos.filter((c) => c.liberado);
        const restantes = todos.filter((c) => !c.liberado);
        if (liberados.length === 0) {
            alert('Não há laudos liberados para apagar.');
            return;
        }

        // O Firestore limita cada lote a 500 operações.
        for (let i = 0; i < liberados.length; i += 450) {
            const lote = writeBatch(db);
            liberados.slice(i, i + 450).forEach((c) => lote.delete(doc(db, 'tasks', c.id)));
            await lote.commit();
        }

        // O índice é uma contagem denormalizada: sem regravar junto, ele
        // continua anunciando anos e totais de um acervo que não existe mais.
        // Regravar (e não zerar) porque os casos em aberto continuam no livro.
        await gravarIndice(contarPorAno(restantes));

        alert('Histórico limpo com sucesso!');
        window.location.reload();
    } catch (e) {
        console.error(e);
        alert('Erro ao apagar histórico: ' + e.message);
        botoesApagar.forEach((btn) => { btn.disabled = false; });
    }
}

botoesApagar.forEach((btn) => btn.addEventListener('click', apagarHistorico));

// ================================================================
// CARGA DOS DADOS
//
// O acervo cresce um ano por vez e vai acumular décadas de casos, então puxar
// a coleção inteira a cada abertura não se sustenta. A página lê primeiro o
// índice `meta/livroRegistros` (um documento com os anos e as contagens), monta
// o filtro de ano e os totais a partir dele, e só busca no Firestore o ano
// selecionado. Cada ano lido fica em cache, então alternar entre anos já vistos
// não custa leitura nenhuma.
// ================================================================
const REF_META = doc(db, 'meta', 'livroRegistros');

/**
 * Anos do acervo, do mais recente para o mais antigo. O balde "Sem ano" fica
 * sempre por último: ele não é um ano, é uma pendência de protocolo.
 */
function anosDoAcervo() {
    // Índice + o que já está carregado: um caso que ficou de fora do índice
    // (falha de gravação, protocolo corrigido depois) some do filtro se a lista
    // sair só do índice.
    //
    // Ano com contagem zerada não entra: o índice guarda a chave do ano até
    // alguém regravar o documento, e sem esse corte um ano que teve o último
    // caso excluído continuaria sendo oferecido no filtro.
    const anosIndice = (state.meta && state.meta.anos) || {};
    const doIndice = Object.keys(anosIndice).filter((a) => temCaso(anosIndice[a]));
    const chaves = [...new Set([...doIndice, ...state.casos.map((c) => c.ano).filter(Boolean)])];

    return chaves.sort((a, b) => {
        if (a === ANO_DESCONHECIDO) return 1;
        if (b === ANO_DESCONHECIDO) return -1;
        return b.localeCompare(a);
    });
}

/** Anos de verdade — o que alimenta o "desde" do rodapé. */
function anosReais() {
    return anosDoAcervo().filter((a) => a !== ANO_DESCONHECIDO);
}

async function carregarMeta() {
    try {
        const snap = await getDoc(REF_META);
        state.meta = snap.exists() ? snap.data() : null;
    } catch (erro) {
        console.warn('Índice do livro indisponível, carregando o acervo inteiro.', erro);
        state.meta = null;
    }
}

/**
 * O Planner grava os compromissos da agenda na mesma coleção `tasks`. Eles não
 * são amostra nem protocolo: ficam fora do livro, como já ficam fora do Mural.
 */
const ehCasoDoLivro = (t) => t && t.type !== 'agendamento_rapido';

/** Casos de um ano de protocolo — liberados ou ainda em aberto. */
async function buscarAno(ano) {
    if (state.porAno.has(ano)) return state.porAno.get(ano);

    const snapshot = await getDocs(query(
        collection(db, 'tasks'), where('protocoloAno', '==', Number(ano))
    ));
    const casos = snapshot.docs
        .filter((d) => ehCasoDoLivro(d.data()))
        .map((d) => normalizarCaso(d.id, d.data()));

    state.porAno.set(ano, casos);
    return casos;
}

/** Acervo inteiro — usado quando não há índice ou em "Todos os anos". */
async function buscarTudo() {
    const snapshot = await getDocs(collection(db, 'tasks'));
    return snapshot.docs
        .filter((d) => ehCasoDoLivro(d.data()))
        .map((d) => normalizarCaso(d.id, d.data()));
}

/**
 * Contagem por ano e tipo, no formato do índice `meta/livroRegistros`.
 */
function contarPorAno(casos) {
    const anos = {};
    casos.forEach((c) => {
        const ano = c.ano || ANO_DESCONHECIDO;
        anos[ano] = anos[ano] || { biopsia: 0, necropsia: 0 };
        anos[ano][c.tipo] += 1;
    });
    return anos;
}

/**
 * O índice é uma contagem denormalizada e pode ficar para trás: gravação que
 * falhou, caso cadastrado antes de o índice contar amostras em aberto, protocolo
 * corrigido com o índice fora do ar. Quando a página carrega o acervo inteiro
 * ela sabe a verdade — e é a única hora barata de consertar, porque a leitura
 * já foi paga. Só grava quando o índice realmente diverge.
 */
async function reconciliarIndice(casos) {
    const apurado = contarPorAno(casos);
    const guardado = (state.meta && state.meta.anos) || {};

    const chaves = new Set([...Object.keys(apurado), ...Object.keys(guardado)]);
    const divergiu = [...chaves].some((ano) => ['biopsia', 'necropsia'].some((tipo) => (
        Math.max(0, Number((apurado[ano] || {})[tipo]) || 0)
        !== Math.max(0, Number((guardado[ano] || {})[tipo]) || 0)
    )));
    if (!divergiu) return;

    state.meta = {
        ...(state.meta || {}),
        anos: apurado,
        total: casos.length
    };
    await gravarIndice(apurado);
}

function mostrarCarregando(ligado, texto) {
    state.carregando = ligado;
    vazioBox.classList.toggle('hidden', !ligado && state.casos.length > 0);
    if (ligado) {
        vazioBox.querySelector('.ledger-empty-title').textContent = texto || 'Carregando…';
        vazioBox.querySelector('.ledger-empty-sub').textContent = '';
    } else {
        vazioBox.querySelector('.ledger-empty-title').textContent = 'Nenhum registro encontrado';
        vazioBox.querySelector('.ledger-empty-sub').textContent = 'Ajuste a busca ou limpe os filtros.';
    }
}

async function carregarCasos(ano) {
    mostrarCarregando(true, ano ? `Carregando ${ano}…` : 'Carregando o acervo…');
    try {
        if (ano) {
            state.casos = await buscarAno(ano);
        } else {
            // "Todos os anos" lê o acervo inteiro em vez de percorrer os anos do
            // índice: é o que garante que um caso fora do índice ainda apareça.
            state.casos = await buscarTudo();
            await reconciliarIndice(state.casos);
        }
    } catch (erro) {
        console.error('Erro ao carregar o livro de registros:', erro);
        state.casos = [];
        alert('Erro ao carregar o histórico: ' + erro.message);
    }

    state.carregado = true;
    mostrarCarregando(false);
    memoSig = null;
    // Refaz o select: a carga pode ter revelado anos que não estavam no índice.
    montarSelectAnos();
    atualizarOpcoes();
    renderTotais();
    render();
}

async function iniciar() {
    await carregarMeta();

    // Abre em "Todos os anos": o livro é consultado como um registro único, e
    // abrir num ano só escondia casos de série futura ou de protocolo sem ano.
    // O custo é ler o acervo inteiro na abertura, em vez de um ano — quando o
    // acervo crescer a ponto de pesar, dá para voltar a abrir no ano corrente
    // trocando esta linha por `anosReais()[0]`.
    state.f.ano = '';

    montarSelectAnos();
    renderTotais();
    await carregarCasos(state.f.ano);
}

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'auth.html';
        return;
    }

    try {
        const perfil = await getDoc(doc(db, 'users', user.uid));
        podeApagarAcervo = perfil.exists() && hasFullControl(perfil.data().role);
    } catch (erro) {
        // Sem conseguir ler o papel, o botão fica fora: errar para o lado de
        // não oferecer a exclusão é barato; o contrário, não.
        console.warn('Não foi possível ler o perfil para liberar a exclusão.', erro);
        podeApagarAcervo = false;
    }

    medirLinhas();
    iniciar();
});
