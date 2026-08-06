/**
 * LPV — HISTÓRICO / LIVRO DE REGISTROS
 *
 * Todos os laudos liberados, de todos os anos, em uma linha por caso, com
 * janela virtual (só o que está em tela vira DOM) e expansão inline da ficha.
 * O tipo do caso não ocupa coluna: vira a cor da borda esquerda da linha
 * (azul = necropsia, rosa = biópsia), e os botões do filtro "Tipo" e os
 * contadores do topo servem de legenda.
 */
import { db, auth, logout } from '../core.js';
import { collection, query, where, getDocs, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
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
    situacao: 'Situação',
    ano: 'Ano',
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

const F_VAZIO = {
    busca: '', tipo: 'todos', situacao: '', ano: '',
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

/** "Ana Maria Klein" -> "A. Klein" */
function curto(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '—';
    if (partes.length === 1) return partes[0];
    return `${partes[0][0]}. ${partes[partes.length - 1]}`;
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

// ================================================================
// ESTADO
// ================================================================
const state = {
    casos: [],
    f: { ...F_VAZIO },
    ordem: { campo: 'dataLaudo', dir: 'desc' },
    aberto: null,
    scrollTop: 0,
    painelAberto: false,
    carregado: false
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
    const dataLaudo = isoLocal(t.releasedAt) || isoLocal(t.updatedAt);
    const situacaoKey = SITUACAO[t.financialStatus] ? t.financialStatus
        : (SITUACAO[t.situacao] ? t.situacao : 'pendente');
    const diagnostico = (t.report && t.report.diagnostico) || t.diagnostico || '';

    const caso = {
        id,
        protocolo: t.protocolo || '—',
        tipo: necropsia ? 'necropsia' : 'biopsia',
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
        ano: dataLaudo ? dataLaudo.slice(0, 4) : '',
        diagnostico
    };

    caso.blob = norm([
        caso.protocolo, caso.nome, caso.rg, caso.proprietario, caso.remetente,
        caso.docente, caso.posGraduando, caso.especie, caso.raca, caso.sexo,
        caso.origem, caso.diagnostico,
        br(caso.dataEntrada), br(caso.dataLaudo),
        caso.tipo === 'necropsia' ? 'necropsia' : 'biopsia'
    ].filter(Boolean).join(' '));

    return caso;
}

// ================================================================
// FILTRO + ORDENAÇÃO (memoizado por assinatura)
// ================================================================
function processar() {
    const { casos, f, ordem } = state;
    const sig = JSON.stringify([casos.length, f, ordem]);
    if (sig === memoSig) return memoRes;

    const termos = norm(f.busca).split(/\s+/).filter(Boolean);
    const contem = (valor, alvo) => !alvo || norm(valor).includes(norm(alvo));

    const out = casos.filter((c) => {
        if (f.tipo !== 'todos' && c.tipo !== f.tipo) return false;
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
        const va = String(a[ordem.campo] ?? '');
        const vb = String(b[ordem.campo] ?? '');
        if (!va && !vb) return 0;
        if (!va) return 1;   // vazios sempre no fim
        if (!vb) return -1;
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

function atualizarOpcoes() {
    const anos = [...new Set(state.casos.map((c) => c.ano).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a));
    preencher(campos.ano, anos, state.f.ano);

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
    const diag = c.diagnostico
        ? `<span class="lr-diag lr-truncate" title="${esc(c.diagnostico)}">${esc(c.diagnostico)}</span>`
        : '<span class="lr-diag lr-truncate is-empty">Sem diagnóstico registrado</span>';

    return `
        <div class="ledger-row tipo-${c.tipo}" role="button" tabindex="0"
             title="${c.tipo === 'necropsia' ? 'Necropsia' : 'Biópsia'}">
            <i class="lr-chevron fas fa-chevron-right"></i>
            <span class="lr-protocolo">${esc(c.protocolo)}</span>
            <span class="lr-animal lr-truncate">
                <strong>${esc(c.nome || 'Sem nome')}</strong>
                ${resumo ? `<span class="lr-muted">· ${esc(resumo)}</span>` : ''}
            </span>
            <span class="lr-prop lr-truncate">${esc(c.proprietario || '—')}</span>
            <span class="lr-entrada">${br(c.dataEntrada)}</span>
            <span class="lr-laudo">${br(c.dataLaudo)}</span>
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
                ${item('Laudo', br(c.dataLaudo))}
                ${item('Valor', c.valor ? `R$ ${c.valor}` : '—')}
            </dl>
            <div class="ledger-expand-diag">
                <span>Diagnóstico</span>
                <p>${esc(c.diagnostico || 'Sem diagnóstico registrado.')}</p>
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

function renderTotais() {
    const necro = state.casos.filter((c) => c.tipo === 'necropsia').length;
    const anos = state.casos.map((c) => c.ano).filter(Boolean).sort();

    el('total-necropsias').textContent = nf(necro);
    el('total-biopsias').textContent = nf(state.casos.length - necro);
    el('foot-desde').textContent = anos[0] || '—';
}

// ================================================================
// CHIPS DE FILTRO ATIVO
// ================================================================
function rotuloValor(chave, valor) {
    if (chave === 'tipo') return valor === 'necropsia' ? 'Necropsias' : 'Biópsias';
    if (chave === 'situacao') return (SITUACAO[valor] || {}).label || valor;
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

    const escondidos = chips.filter((c) => NO_PAINEL.includes(c.chave)).length;
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

function limparFiltro(chave) {
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
    state.f = { ...F_VAZIO };
    Object.entries(campos).forEach(([chave, campo]) => {
        if (!campo) return;
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

['situacao', 'ano', 'docente', 'posGraduando', 'especie', 'sexo', 'origem',
 'campoData', 'de', 'ate'].forEach((chave) => {
    campos[chave].addEventListener('change', (e) => aplicar(chave, e.target.value));
});

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
});

chipsBox.addEventListener('click', (e) => {
    if (e.target.closest('.ledger-chip-clear')) return limparTudo();
    const chip = e.target.closest('[data-chip]');
    if (chip) limparFiltro(chip.dataset.chip);
});

headEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]');
    if (btn) ordenar(btn.dataset.sort);
});

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
    state.aberto = state.aberto === wrap.dataset.id ? null : wrap.dataset.id;
    render();
});

track.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const linha = e.target.closest('.ledger-row');
    if (!linha) return;
    e.preventDefault();
    const wrap = linha.closest('.ledger-row-wrap');
    state.aberto = state.aberto === wrap.dataset.id ? null : wrap.dataset.id;
    render();
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

[el('btn-logout'), el('logout-btn-header')].forEach((btn) => {
    if (btn) btn.addEventListener('click', logout);
});

// ================================================================
// EXPORTAÇÃO EXCEL — exporta o que está no filtro atual
// ================================================================
function exportarExcel() {
    const lista = processar();
    if (lista.length === 0) {
        alert('Não há laudos no filtro atual para exportar.');
        return;
    }

    const rows = lista.map((c) => [
        c.protocolo,
        br(c.dataEntrada),
        br(c.dataLaudo),
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

    const COL_VALOR = 17;
    const total = rows.reduce((soma, row) => soma + row[COL_VALOR], 0);
    const header = ['PROTOCOLO', 'DATA ENTRADA', 'DATA LAUDO', 'NOME', 'RG', 'ESPÉCIE', 'RAÇA',
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
            if ([3, 5, 6, 9, 10, 14].includes(C) && R !== 0) ws[cellRef].s.alignment.horizontal = 'left';
        }
    }

    ws['!cols'] = [{ wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 14 },
        { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 25 },
        { wch: 25 }, { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Livro de Registros');
    XLSX.writeFile(wb, `Livro_Registros_LPV_${new Date().toISOString().slice(0, 10)}.xlsx`);

    // Apagar só fica disponível depois de existir uma cópia exportada.
    botoesApagar.forEach((btn) => btn.classList.add('is-visible'));
}

botoesExportar.forEach((btn) => btn.addEventListener('click', exportarExcel));

// ================================================================
// APAGAR HISTÓRICO
// ================================================================
async function apagarHistorico() {
    if (state.casos.length === 0) return;
    if (!confirm('ATENÇÃO: deseja apagar permanentemente TODO o histórico de laudos liberados?')) return;

    botoesApagar.forEach((btn) => { btn.disabled = true; });
    try {
        // O Firestore limita cada lote a 500 operações.
        for (let i = 0; i < state.casos.length; i += 450) {
            const lote = writeBatch(db);
            state.casos.slice(i, i + 450).forEach((c) => lote.delete(doc(db, 'tasks', c.id)));
            await lote.commit();
        }
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
// INICIALIZAÇÃO
// ================================================================
async function carregar() {
    try {
        // O livro de registros é formado pelos casos com laudo liberado.
        const snapshot = await getDocs(query(collection(db, 'tasks'), where('releasedAt', '!=', null)));
        state.casos = snapshot.docs.map((d) => normalizarCaso(d.id, d.data()));
    } catch (erro) {
        console.error('Erro ao carregar o livro de registros:', erro);
        state.casos = [];
        alert('Erro ao carregar o histórico: ' + erro.message);
    }

    state.carregado = true;
    memoSig = null;
    atualizarOpcoes();
    renderTotais();
    render();
}

auth.onAuthStateChanged((user) => {
    if (!user) {
        window.location.href = 'auth.html';
        return;
    }
    medirLinhas();
    carregar();
});
