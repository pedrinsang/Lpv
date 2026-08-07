/**
 * MURAL — dois painéis de laudo pendente (necropsias e biópsias).
 *
 * O Mural é a fila de trabalho: só entra caso que ainda não teve laudo liberado.
 * Assim que o laudo sai, o caso vira acervo e passa a ser assunto do Livro de
 * Registros — por isso `releasedAt`/`status: concluido` derruba o caso daqui.
 *
 * O switch Todos/Minhas troca entre a fila do laboratório inteiro e a fila de
 * quem está logado (as entradas que a pessoa cadastrou, `createdBy`).
 */
import { auth, db } from '../core.js';
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { pesoProtocolo } from '../lib/protocolo.js';

const els = {
    board: document.getElementById('mural-board'),
    dots: document.getElementById('carousel-dots'),
    switchAll: document.getElementById('filter-all'),
    switchMine: document.getElementById('filter-mine')
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
let currentUid = null;

// --- INICIALIZAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../auth.html';
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
 * indexado, então a consulta traz o ano corrente e o anterior (prazo máximo de
 * um caso é de 40 dias) e o pendente é separado aqui. O ano 0 entra porque é o
 * que `camposDerivados` grava quando o protocolo não é legível.
 */
function anosAtivos() {
    const ano = new Date().getFullYear();
    return [ano, ano - 1, 0];
}

function initBoard() {
    const q = query(collection(db, "tasks"), where("protocoloAno", "in", anosAtivos()));

    onSnapshot(q, (snapshot) => {
        allTasks = [];
        snapshot.forEach((docSnap) => {
            const task = { id: docSnap.id, ...docSnap.data() };
            if (isPendente(task)) allTasks.push(task);
        });
        renderBoard();
    }, (erro) => console.warn('Não foi possível carregar o mural.', erro));
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
    const visiveis = currentFilter === 'mine'
        ? allTasks.filter((task) => task.createdBy && task.createdBy === currentUid)
        : allTasks;

    const grupos = { necropsia: [], biopsia: [] };
    visiveis.forEach((task) => {
        grupos[isNecropsiaTask(task) ? 'necropsia' : 'biopsia'].push(task);
    });

    Object.entries(panels).forEach(([tipo, painel]) => {
        renderPanel(painel, ordenarPorPrazo(grupos[tipo]));
    });
}

// O caso mais perto de estourar o prazo (ou mais atrasado) vem primeiro; sem
// data de entrada não há prazo a cobrar, então esses ficam no fim.
function ordenarPorPrazo(tasks) {
    return [...tasks].sort((a, b) => {
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
    card.className = `mural-card${task.isUrgent ? ' is-urgent' : ''}`;
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

    card.innerHTML = `
        <div class="mural-card-top">
            <span class="m-prot">
                ${task.isUrgent ? '<i class="fas fa-triangle-exclamation m-flag" title="Amostra urgente"></i>' : ''}
                ${escapeHtml(task.protocolo || '---')}
            </span>
            ${renderDeadline(getDeadlineInfo(task))}
        </div>
        <div class="m-animal">
            <strong>${escapeHtml(task.animalNome || 'Sem Nome')}</strong>
            <span class="m-species">${escapeHtml(task.especie || 'Espécie não informada')}</span>
        </div>
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
