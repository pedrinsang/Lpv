/**
 * MURAL — dois painéis de laudo pendente (necropsias e biópsias).
 *
 * O Mural é a fila de trabalho: só entra caso que ainda não teve laudo liberado.
 * Assim que o laudo sai, o caso vira acervo e passa a ser assunto do Livro de
 * Registros — por isso `releasedAt`/`status: concluido` derruba o caso daqui.
 *
 * O switch Todos/Minhas troca entre a fila do laboratório inteiro e a fila de
 * quem está logado (as entradas que a pessoa cadastrou, `createdBy`).
 *
 * O filtro por etapa (Tudo / Analisar / Corrigir) e as etiquetas dos cartões
 * saem da mesma tabela do Hub (lib/etapas.js). São a mesma fila vista de duas
 * telas: se cada uma inventasse o próprio rótulo, "para analisar" passaria a
 * significar coisas diferentes conforme onde se olha.
 */
import { auth, db } from '../core.js';
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { pesoProtocolo } from '../lib/protocolo.js';
import { bandeiraDoNivel, classeDoNivel, pesoPrioridade } from '../lib/prioridade.js';
import { estaNaEtapa, etiquetasDeEtapa } from '../lib/etapas.js';

const els = {
    board: document.getElementById('mural-board'),
    dots: document.getElementById('carousel-dots'),
    switchAll: document.getElementById('filter-all'),
    switchMine: document.getElementById('filter-mine'),
    stageFilters: document.querySelectorAll('.mural-stage-filter [data-etapa]')
};

// Um painel por tipo de amostra. O `wrap` é o alvo do carrossel no mobile.
const panels = {
    necropsia: {
        wrap: document.getElementById('panel-necropsias'),
        list: document.getElementById('list-necropsias'),
        count: document.getElementById('count-necropsias'),
        empty: 'Nenhuma necropsia com laudo pendente.'
    },
    biopsia: {
        wrap: document.getElementById('panel-biopsias'),
        list: document.getElementById('list-biopsias'),
        count: document.getElementById('count-biopsias'),
        empty: 'Nenhuma biópsia com laudo pendente.'
    }
};

const panelOrder = [panels.necropsia, panels.biopsia];

// Prazo de entrega em dias corridos a partir da data de entrada (igual ao Hub).
const DEADLINE_DAYS = { necropsia: 40, biopsia: 15 };

let allTasks = [];
let currentFilter = 'all';       // 'all' | 'mine'
let etapaFilter = 'tudo';        // 'tudo' | 'analise' | 'correcao'
let currentUid = null;

// --- INICIALIZAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // O Mural mora em /pages/, então o login é irmão dele. Com "../" a conta
        // subia um nível a mais e caía num /auth.html que não existe.
        window.location.href = 'auth.html';
        return;
    }

    currentUid = user.uid;

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) updateUserBadge(userDoc.data().role);
    } catch (erro) {
        console.warn('Não foi possível ler o perfil do usuário.', erro);
    }

    initSwitch();
    initStageFilter();
    initBoard();
    initMobileCarousel();
});

function updateUserBadge(role) {
    const badge = document.getElementById('user-role-badge');
    if (!badge) return;
    const roles = Array.isArray(role) ? role : [role];
    badge.textContent = roles
        .filter(Boolean)
        .map((r) => r.charAt(0).toUpperCase() + r.slice(1).replace('-', ' '))
        .join(' / ');
}

/**
 * Só a janela recente do acervo é lida.
 *
 * O Firestore não sabe consultar "documento sem o campo X", e é justamente a
 * ausência de `releasedAt` que marca o laudo pendente. Ler a coleção inteira
 * para descobrir isso significaria puxar todo o acervo de laudos liberados a
 * cada abertura do Mural — leitura é o recurso que acaba. O ano do protocolo é
 * indexado, então a consulta corta por ele.
 *
 * O corte é `>=` e não uma lista de anos: com uma lista fixa (ano corrente e
 * anterior), um caso de série futura — VN001-28 aberto em 2026, ou a virada do
 * ano — não voltava na consulta e simplesmente não aparecia no Mural, mesmo
 * tendo sido cadastrado. Como `>=` não tem teto, qualquer ano novo entra sozinho
 * e nada precisa ser configurado.
 */
const PRIMEIRO_ANO_ATIVO = () => new Date().getFullYear() - 1;

/**
 * Casos com protocolo ilegível (`protocoloAno: 0`) ficam abaixo do corte, então
 * vêm de uma segunda consulta. A entrada hoje exige protocolo com ano, mas casos
 * cadastrados antes disso continuam existindo — e não podem sumir da fila.
 */
const fontes = { recentes: [], semAno: [] };

function initBoard() {
    const consultas = {
        recentes: query(collection(db, "tasks"), where("protocoloAno", ">=", PRIMEIRO_ANO_ATIVO())),
        semAno: query(collection(db, "tasks"), where("protocoloAno", "==", 0))
    };

    Object.entries(consultas).forEach(([fonte, q]) => {
        onSnapshot(q, (snapshot) => {
            fontes[fonte] = snapshot.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                .filter(isPendente);
            juntarFontes();
        }, (erro) => console.warn('Não foi possível carregar o mural.', erro));
    });
}

/** As duas consultas não se sobrepõem, mas o id manda — nunca duplica card. */
function juntarFontes() {
    const porId = new Map();
    [...fontes.recentes, ...fontes.semAno].forEach((task) => porId.set(task.id, task));
    allTasks = [...porId.values()];
    renderBoard();
}

// Laudo liberado sai do Mural; agendamento do Planner nunca entrou.
function isPendente(task) {
    if (task.releasedAt) return false;
    if (task.status === 'concluido' || task.status === 'arquivado') return false;
    if (task.type === 'agendamento_rapido') return false;
    return true;
}

function isNecropsiaTask(task) {
    return (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
}

function renderBoard() {
    const daPessoa = currentFilter === 'mine'
        ? allTasks.filter((task) => task.createdBy && task.createdBy === currentUid)
        : allTasks;

    // O filtro pergunta "está nesta fila?", e não "ainda falta?" — igual ao Hub.
    // Marcar a etapa como feita não pode fazer o cartão sumir debaixo do cursor
    // de quem acabou de clicar; o que muda é a etiqueta.
    const visiveis = etapaFilter === 'tudo'
        ? daPessoa
        : daPessoa.filter((task) => estaNaEtapa(task, etapaFilter));

    const grupos = { necropsia: [], biopsia: [] };
    visiveis.forEach((task) => {
        grupos[isNecropsiaTask(task) ? 'necropsia' : 'biopsia'].push(task);
    });

    Object.entries(panels).forEach(([tipo, painel]) => {
        renderPanel(painel, ordenarPorPrazo(grupos[tipo]));
    });
}

// Nível primeiro, sempre: urgente, depois prioritária, depois comum. É o motivo
// de a amostra ter sido marcada assim na entrada, e o prazo de uma urgente não
// conta a mesma história que o de uma comum. Dentro de cada nível vale o prazo —
// o caso mais perto de estourar (ou mais atrasado) vem primeiro; sem data de
// entrada não há prazo a cobrar, então esses ficam no fim.
function ordenarPorPrazo(tasks) {
    return [...tasks].sort((a, b) => {
        const nivel = pesoPrioridade(a) - pesoPrioridade(b);
        if (nivel !== 0) return nivel;

        const infoA = getDeadlineInfo(a);
        const infoB = getDeadlineInfo(b);
        if (!infoA !== !infoB) return infoA ? -1 : 1;
        if (infoA && infoB && infoA.remaining !== infoB.remaining) {
            return infoA.remaining - infoB.remaining;
        }
        return pesoProtocolo(a.protocolo) - pesoProtocolo(b.protocolo);
    });
}

function renderPanel(painel, tasks) {
    if (!painel.list) return;

    if (painel.count) painel.count.textContent = tasks.length;

    painel.list.innerHTML = '';
    painel.list.classList.toggle('is-empty', tasks.length === 0);

    if (tasks.length === 0) {
        painel.list.innerHTML = `
            <div class="mural-empty">
                <i class="far fa-check-circle fa-2x"></i>
                <p>${painel.empty}</p>
            </div>`;
        return;
    }

    tasks.forEach((task, index) => {
        painel.list.appendChild(buildCard(task, index));
    });
}

function buildCard(task, index) {
    const card = document.createElement('article');
    card.className = `mural-card ${classeDoNivel(task)}`.trim();
    card.style.setProperty('--card-index', index);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.title = `${task.protocolo || ''} — ${task.animalNome || ''}`;

    const abrir = () => openTaskManagerWithRetry(task.id);
    card.addEventListener('click', abrir);
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            abrir();
        }
    });

    const dataEntrada = task.dataEntrada
        ? new Date(`${task.dataEntrada}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : '—';

    // Caso comum não tem etapa marcada e não ganha linha nenhuma: uma faixa
    // vazia em todo cartão custaria altura sem dizer nada.
    const etiquetas = etiquetasDeEtapa(task, 'm-tag');

    card.innerHTML = `
        <div class="mural-card-top">
            <span class="m-prot">
                ${bandeiraDoNivel(task, 'm-flag')}
                ${escapeHtml(task.protocolo || '---')}
            </span>
            ${renderDeadline(getDeadlineInfo(task))}
        </div>
        <div class="m-animal">
            <strong>${escapeHtml(task.animalNome || 'Sem Nome')}</strong>
            <span class="m-species">${escapeHtml(task.especie || 'Espécie não informada')}</span>
        </div>
        ${etiquetas ? `<div class="m-tags">${etiquetas}</div>` : ''}
        <div class="mural-card-meta">
            <span class="m-resp"><i class="fas fa-user-graduate"></i>${escapeHtml(getShortName(task.posGraduando))}</span>
            <span class="m-date"><i class="far fa-calendar"></i>${dataEntrada}</span>
            ${task.k7Quantity ? `<span class="m-k7">${Number(task.k7Quantity)} K7</span>` : ''}
            ${renderFinanceiro(task)}
        </div>`;

    return card;
}

// Positivo = dias que faltam; negativo = dias de atraso. null sem data de entrada.
function getDeadlineInfo(task) {
    if (!task.dataEntrada) return null;

    const entrada = new Date(`${task.dataEntrada}T12:00:00`);
    if (Number.isNaN(entrada.getTime())) return null;

    const limit = DEADLINE_DAYS[isNecropsiaTask(task) ? 'necropsia' : 'biopsia'];
    const vencimento = new Date(entrada);
    vencimento.setDate(vencimento.getDate() + limit);

    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);

    return { remaining: Math.round((vencimento - hoje) / 86400000), limit };
}

function renderDeadline(info) {
    if (!info) return '<span class="m-prazo is-unknown" title="Sem data de entrada">—</span>';

    const { remaining, limit } = info;
    const late = remaining < 0;
    const days = Math.abs(remaining);

    let title;
    if (late) title = `${days} ${days === 1 ? 'dia' : 'dias'} em atraso (prazo de ${limit} dias)`;
    else if (remaining === 0) title = `Vence hoje (prazo de ${limit} dias)`;
    else title = `Faltam ${days} ${days === 1 ? 'dia' : 'dias'} (prazo de ${limit} dias)`;

    const icon = late ? 'fa-triangle-exclamation' : 'fa-clock';
    return `<span class="m-prazo ${late ? 'is-late' : 'is-ok'}" title="${title}">
        <i class="fas ${icon}"></i>${days} d</span>`;
}

function renderFinanceiro(task) {
    const situacao = task.financialStatus || task.situacao || 'pendente';

    if (situacao === 'pago') {
        return '<span class="m-fin is-pago"><i class="fas fa-check-circle"></i>PAGO</span>';
    }
    if (situacao === 'didatico') {
        return '<span class="m-fin is-didatico"><i class="fas fa-graduation-cap"></i>DIDÁTICO</span>';
    }
    return '<span class="m-fin is-pendente"><i class="fas fa-clock"></i>PENDENTE</span>';
}

// --- FILTRO POR ETAPA ---
function initStageFilter() {
    els.stageFilters.forEach((btn) => {
        btn.addEventListener('click', () => {
            etapaFilter = btn.dataset.etapa || 'tudo';
            updateStageFilter();
            renderBoard();
        });
    });
    updateStageFilter();
}

function updateStageFilter() {
    els.stageFilters.forEach((btn) => {
        btn.classList.toggle('is-active', (btn.dataset.etapa || 'tudo') === etapaFilter);
    });
}

// --- SWITCH TODOS / MINHAS ---
function initSwitch() {
    els.switchAll?.addEventListener('click', () => setFilter('all'));
    els.switchMine?.addEventListener('click', () => setFilter('mine'));
    updateSwitch();
}

function setFilter(mode) {
    if (currentFilter === mode) return;
    currentFilter = mode;
    updateSwitch();
    renderBoard();
}

function updateSwitch() {
    const allActive = currentFilter === 'all';
    els.switchAll?.classList.toggle('is-active', allActive);
    els.switchMine?.classList.toggle('is-active', !allActive);
    els.switchAll?.setAttribute('aria-pressed', String(allActive));
    els.switchMine?.setAttribute('aria-pressed', String(!allActive));
}

// --- CARROSSEL MOBILE (um painel por vez) ---
function initMobileCarousel() {
    if (!els.dots || !els.board) return;

    els.dots.innerHTML = '';
    panelOrder.forEach((painel, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = index === 0 ? 'dot active' : 'dot';
        dot.setAttribute('aria-label', painel.wrap?.querySelector('.mural-panel-title')?.textContent.trim() || `Painel ${index + 1}`);
        dot.addEventListener('click', () => {
            const largura = (panelOrder[0].wrap?.offsetWidth || 1) + 15;
            els.board.scrollTo({ left: largura * index, behavior: 'smooth' });
        });
        els.dots.appendChild(dot);
    });

    const sync = () => {
        if (window.innerWidth >= 1024) return;
        const largura = (panelOrder[0].wrap?.offsetWidth || 1) + 15;
        const ativo = Math.max(0, Math.min(panelOrder.length - 1, Math.round(els.board.scrollLeft / largura)));

        els.dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === ativo));
        panelOrder.forEach((painel, i) => painel.wrap?.classList.toggle('active-panel', i === ativo));
    };

    els.board.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
}

async function openTaskManagerWithRetry(taskId) {
    if (typeof window.openTaskManager === 'function') {
        window.openTaskManager(taskId);
        return;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (typeof window.openTaskManager === 'function') {
            window.openTaskManager(taskId);
            return;
        }
    }

    console.warn('Task manager indisponível no momento.');
}

// --- AUXILIARES ---
function getShortName(fullName) {
    if (!fullName) return 'Sem Pós';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0]}.`;
}

function escapeHtml(value) {
    return (value ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
