import { auth, db, normalizeRoles, hasAnyRole, hasFullControl } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, onSnapshot, where } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { pesoProtocolo } from '../lib/protocolo.js';
import { NIVEIS, bandeiraDoNivel, classeDoNivel, nivelDaAmostra, pesoPrioridade } from '../lib/prioridade.js';
import {
    CHAVES_ETAPA,
    ETAPAS,
    FEITO,
    estaNaEtapa,
    etapaPendente,
    etapasDaAmostra,
    etiquetasDeEtapa
} from '../lib/etapas.js';
import { TIPOS_AGENDA, infoDoTipo, pintarPorTipo, tipoDaAgenda } from '../lib/agenda-tipos.js';
import { aplicarLayout, initSeletorDeLayout } from '../lib/hub-layout.js';
import {
    CAMPO_REABERTO,
    estaReaberto,
    etiquetaReaberto,
    laudoPendente,
    pesoReabertura
} from '../lib/reabertura.js';
import {
    describeDeadline,
    formatDate,
    getCycleInfo,
    getItemStatus,
    isAlertStatus
} from '../lib/estoque-ciclo.js';

// 1. MAPEAMENTO DOS ELEMENTOS
const els = {
    userBadge: document.getElementById('user-role-badge'),
    statAnalisar: document.getElementById('stat-analisar'),
    statCorrigir: document.getElementById('stat-corrigir'),
    urgentList: document.getElementById('urgent-list'),
    urgentCount: document.getElementById('urgent-count'),
    urgentSubtitle: document.getElementById('urgent-subtitle'),
    listaBiopsias: document.getElementById('list-biopsias'),
    countBiopsias: document.getElementById('count-biopsias'),
    listaNecropsias: document.getElementById('list-necropsias'),
    countNecropsias: document.getElementById('count-necropsias'),
    stageFilters: document.querySelectorAll('.stage-filter-btn'),
    queueFilterContainer: document.getElementById('queue-filter-container'),
    queueFilterAll: document.getElementById('queue-filter-all'),
    queueFilterMine: document.getElementById('queue-filter-mine')
};

let currentUserData = null;
let queueSourceTasks = [];
let queueFilterMode = 'all';
let etapaFilterMode = 'tudo';    // 'tudo' | 'analise' | 'correcao'

// 2. INICIALIZAÇÃO
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadUserProfile(user.uid);
        if (currentUserData) {
            initRealTimeDashboard();
            initInventorySummary();
            initWeekAgenda();
        }
    } else {
        window.location.href = '../pages/auth.html';
    }
});

document.getElementById('logout-btn')?.addEventListener('click', () => signOut(auth));

// O menu já responde enquanto a fila carrega. A gravação na conta é que
// espera o login: antes dele, a escolha vale só neste aparelho.
initSeletorDeLayout(salvarLayoutNaConta);

// 3. CARREGAR PERFIL
async function loadUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            aplicarLayoutDaConta(currentUserData.hubLayout);
            updateUserBadge(currentUserData.role);
            setupStageFilters();
            setupQueueFilters();

        }
    } catch (e) { console.error(e); }
}

// LAYOUT DO PAINEL — a escolha mora na conta
//
// O arranjo é preferência de quem usa, e não do computador: quem gosta do
// foco dividido o encontra assim em qualquer máquina do laboratório, sem ter
// que reescolher. O `hubLayout` do documento do usuário é o dono da escolha;
// o localStorage é só a cópia que evita a tela pular de arranjo enquanto o
// login ainda está resolvendo.

/**
 * Conta sem escolha guardada não desfaz o que está na tela: vale o que o
 * aparelho tinha, e a conta só passa a mandar depois da primeira escolha.
 *
 * Num computador compartilhado a tela pode abrir no arranjo de quem usou por
 * último e trocar quando o perfil chega. É o preço de não segurar a primeira
 * pintura esperando o Firestore — e acontece uma vez, no login.
 */
function aplicarLayoutDaConta(layout) {
    if (layout) aplicarLayout(layout);
}

async function salvarLayoutNaConta(layout) {
    const uid = auth.currentUser?.uid;
    // Menu usado antes do login resolver: a escolha já valeu na tela e ficou
    // no aparelho; sem uid não há onde gravar.
    if (!uid) return;

    try {
        await updateDoc(doc(db, 'users', uid), { hubLayout: layout });
        if (currentUserData) currentUserData.hubLayout = layout;
    } catch (erro) {
        // Falhar aqui não desfaz a troca: o layout já está na tela e no
        // aparelho. O que se perde é o "em qualquer máquina".
        console.warn('Não foi possível guardar o layout na conta:', erro.message);
    }
}

function updateUserBadge(role) {
    if(!els.userBadge) return;
    const roles = normalizeRoles(role);
    const display = roles.map(r => r.charAt(0).toUpperCase() + r.slice(1).replace('-', ' ')).join(' / ');
    els.userBadge.textContent = display;
}

// ALERTAS DO ESTOQUE
//
// O estoque não é contado unidade a unidade: cada item guarda quanto se compra
// e quanto tempo aquilo costuma durar. Aqui só aparece o que está chegando no
// fim do prazo previsto — o aviso para conferir o armário antes de comprar.
const HUB_STOCK_MAX_ROWS = 4;

function initInventorySummary() {
    const list = document.getElementById('hub-stock-alerts');
    const subtitle = document.getElementById('hub-stock-subtitle');
    if (!list) return;

    onSnapshot(collection(db, 'inventory_items'), (snapshot) => {
        const alerts = [];

        snapshot.forEach((itemDoc) => {
            const item = { id: itemDoc.id, ...itemDoc.data() };
            const cycle = getCycleInfo(item);
            const status = getItemStatus(item, cycle);
            if (isAlertStatus(status)) alerts.push({ item, cycle, status });
        });

        alerts.sort((a, b) => a.cycle.daysLeft - b.cycle.daysLeft);
        renderInventoryAlerts(list, subtitle, alerts);
    }, (error) => {
        console.warn('Resumo do estoque indisponível:', error.message);
    });
}

function renderInventoryAlerts(list, subtitle, alerts) {
    document.querySelector('.inventory-hub-panel')?.classList.toggle('has-attention', alerts.length > 0);

    if (subtitle) {
        subtitle.textContent = alerts.length === 0
            ? 'Nenhum prazo perto do fim'
            : `${alerts.length} ${alerts.length === 1 ? 'produto para conferir' : 'produtos para conferir'}`;
    }

    if (alerts.length === 0) {
        list.innerHTML = `
            <div class="inventory-hub-empty">
                <i class="far fa-check-circle"></i>
                <span>Estoque dentro do prazo previsto.</span>
            </div>`;
        return;
    }

    const rows = alerts.slice(0, HUB_STOCK_MAX_ROWS).map(({ item, cycle, status }) => `
        <div class="inventory-hub-alert ${status === 'due' ? 'is-late' : 'is-near'}">
            <span class="inventory-hub-alert-icon">
                <i class="fas ${status === 'due' ? 'fa-triangle-exclamation' : 'fa-hourglass-half'}"></i>
            </span>
            <div class="inventory-hub-alert-text">
                <strong>${escapeHtml(item.name)}</strong>
                <small>${describeDeadline(cycle)} · previsão ${formatDate(cycle.expectedEndDate)}</small>
            </div>
        </div>`).join('');

    const extra = alerts.length - HUB_STOCK_MAX_ROWS;
    list.innerHTML = rows + (extra > 0
        ? `<div class="inventory-hub-more">+${extra} ${extra === 1 ? 'outro item' : 'outros itens'}</div>`
        : '');
}

// 4. AS TRÊS FILAS DO PAINEL
//
// O Hub mostra a fila inteira de laudo pendente, repartida em três cartões:
// urgências e prioridades de um lado (biópsia e necropsia juntas, porque o que
// importa ali é o prazo), e as duas filas gerais por tipo do outro. As três
// saem da mesma leitura — o corte é feito aqui, não no Firestore.
//
// Só a janela recente do acervo é lida, pelo mesmo motivo do Mural: o Firestore
// não sabe consultar "documento sem o campo X", e é a ausência de `releasedAt`
// que marca o laudo pendente. Ler a coleção inteira para descobrir isso puxaria
// todo o acervo já laudado a cada abertura. O ano do protocolo é indexado, então
// a consulta corta por ele — sem teto, para que série futura ou virada de ano
// entrem sozinhas.
const PRIMEIRO_ANO_ATIVO = () => new Date().getFullYear() - 1;

// Três consultas, três motivos:
//
//   recentes  — a janela do acervo que ainda tem trabalho correndo;
//   semAno    — protocolo ilegível (`protocoloAno: 0`) fica abaixo do corte, e a
//               entrada hoje exige ano, mas o que foi cadastrado antes disso não
//               pode sumir da fila;
//   reabertos — caso que já teve laudo e foi trazido de volta do livro. Pode ser
//               de qualquer ano, então nenhuma das outras duas o alcança.
const filaPorFonte = { recentes: [], semAno: [], reabertos: [] };

function initRealTimeDashboard() {
    const consultas = {
        recentes: query(collection(db, "tasks"), where("protocoloAno", ">=", PRIMEIRO_ANO_ATIVO())),
        semAno: query(collection(db, "tasks"), where("protocoloAno", "==", 0)),
        reabertos: query(collection(db, "tasks"), where(CAMPO_REABERTO, "==", true))
    };

    Object.entries(consultas).forEach(([fonte, q]) => onSnapshot(q, (snapshot) => {
        filaPorFonte[fonte] = snapshot.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter(laudoPendente);

        // As consultas se sobrepõem (um reaberto deste ano vem por duas), mas o
        // id manda — nunca duplica.
        const porId = new Map();
        [...filaPorFonte.recentes, ...filaPorFonte.semAno, ...filaPorFonte.reabertos]
            .forEach((task) => porId.set(task.id, task));

        queueSourceTasks = [...porId.values()];
        applyQueueFilter();

    }, (error) => console.warn('Fila do Hub indisponível:', error.message)));
}

// --- FILTRO POR ETAPA ---
//
// O filtro pergunta "está nesta fila?", e não "ainda falta?": marcar como feito
// não pode fazer o cartão sumir debaixo do cursor de quem acabou de clicar. O
// que muda é a etiqueta — e os contadores do cabeçalho, que só contam o que
// falta.
function setupStageFilters() {
    els.stageFilters.forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.addEventListener('click', () => {
            etapaFilterMode = btn.dataset.etapa || 'tudo';
            updateStageFilterButtons();
            applyQueueFilter();
        });
        btn.dataset.bound = 'true';
    });
    updateStageFilterButtons();
}

function updateStageFilterButtons() {
    els.stageFilters.forEach((btn) => {
        btn.classList.toggle('is-active', (btn.dataset.etapa || 'tudo') === etapaFilterMode);
    });
}

function setupQueueFilters() {
    const isPosGrad = hasAnyRole(currentUserData?.role, ['pós graduando', 'pos-graduando']);

    if (els.queueFilterContainer) {
        els.queueFilterContainer.classList.toggle('hidden', !isPosGrad);
    }

    if (!isPosGrad) return;

    if (els.queueFilterAll && !els.queueFilterAll.dataset.bound) {
        els.queueFilterAll.addEventListener('click', () => {
            queueFilterMode = 'all';
            updateQueueFilterButtons();
            applyQueueFilter();
        });
        els.queueFilterAll.dataset.bound = 'true';
    }

    if (els.queueFilterMine && !els.queueFilterMine.dataset.bound) {
        els.queueFilterMine.addEventListener('click', () => {
            queueFilterMode = 'mine';
            updateQueueFilterButtons();
            applyQueueFilter();
        });
        els.queueFilterMine.dataset.bound = 'true';
    }

    updateQueueFilterButtons();
}

function updateQueueFilterButtons() {
    if (!els.queueFilterAll || !els.queueFilterMine) return;
    const allActive = queueFilterMode === 'all';
    els.queueFilterAll.classList.toggle('is-active', allActive);
    els.queueFilterMine.classList.toggle('is-active', !allActive);
}

function applyQueueFilter() {
    const isPosGrad = hasAnyRole(currentUserData?.role, ['pós graduando', 'pos-graduando']);

    let tasksToRender = queueSourceTasks;
    if (isPosGrad && queueFilterMode === 'mine') {
        const currentUserName = normalizeText(currentUserData?.name || '');
        if (!currentUserName) {
            tasksToRender = [];
        } else {
            tasksToRender = queueSourceTasks.filter((task) => normalizeText(task.posGraduando || '') === currentUserName);
        }
    }

    // Os contadores do cabeçalho contam a fila do laboratório que aquela pessoa
    // vê, mas sem o recorte por etapa — senão o número mudaria ao clicar no
    // próprio filtro que ele deveria explicar.
    renderStageStats(tasksToRender);

    const visiveis = etapaFilterMode === 'tudo'
        ? tasksToRender
        : tasksToRender.filter((task) => estaNaEtapa(task, etapaFilterMode));

    // Caso reaberto fica de fora das prioridades: o cartão de urgências é sobre
    // prazo a estourar, e o prazo dele já foi cumprido. Ele aparece na fila do
    // tipo dele, que é onde se vai procurar um caso antigo.
    renderUrgentList(visiveis.filter((task) => nivelDaAmostra(task) !== null && !estaReaberto(task)));
    renderTypeQueue(
        els.listaBiopsias,
        els.countBiopsias,
        visiveis.filter((task) => !isNecropsiaTask(task)),
        'Fila de biópsias vazia.'
    );
    renderTypeQueue(
        els.listaNecropsias,
        els.countNecropsias,
        visiveis.filter(isNecropsiaTask),
        'Fila de necropsias vazia.'
    );
}

function renderStageStats(tasks) {
    const alvos = { analise: els.statAnalisar, correcao: els.statCorrigir };

    CHAVES_ETAPA.forEach((chave) => {
        const alvo = alvos[chave];
        if (!alvo) return;
        const total = tasks.filter((task) => etapaPendente(task, chave)).length;
        alvo.querySelector('strong').textContent = total;
        // Zerado o contador continua de pé, só apagado: some e a barra pula de
        // largura toda vez que a última pendência é resolvida.
        alvo.classList.toggle('is-clear', total === 0);
    });
}

// 5. RENDERIZAR AS FILAS
// Prazo de entrega em dias corridos contados a partir da data de entrada.
const DEADLINE_DAYS = { necropsia: 40, biopsia: 15 };

function isNecropsiaTask(task) {
    return (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
}

// Positivo = dias que faltam; negativo = dias de atraso. null quando não há
// data de entrada para contar.
function getDeadlineInfo(task) {
    if (!task.dataEntrada) return null;

    const entry = new Date(`${task.dataEntrada}T12:00:00`);
    if (Number.isNaN(entry.getTime())) return null;

    const limit = DEADLINE_DAYS[isNecropsiaTask(task) ? 'necropsia' : 'biopsia'];
    const due = new Date(entry);
    due.setDate(due.getDate() + limit);

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    return { remaining: Math.round((due - today) / 86400000), limit };
}

/**
 * Canto do prazo. Caso reaberto não mostra contagem: pela data de entrada ele
 * apareceria com centenas de dias de atraso, cobrando um prazo que o laudo já
 * cumpriu. No lugar vai a data em que o laudo saiu.
 */
function renderPrazo(task) {
    if (estaReaberto(task)) {
        const quando = task.dataLaudo
            ? new Date(`${task.dataLaudo}T12:00:00`).toLocaleDateString('pt-BR')
            : '';
        return `<span class="u-prazo is-unknown" title="Laudo já liberado${quando ? ` em ${quando}` : ''} — o prazo não corre mais">laudada</span>`;
    }
    return renderDeadlineCell(getDeadlineInfo(task));
}

function renderDeadlineCell(info) {
    if (!info) {
        return '<span class="u-prazo is-unknown" title="Sem data de entrada">—</span>';
    }

    const { remaining, limit } = info;
    const late = remaining < 0;
    const days = Math.abs(remaining);

    let title;
    if (late) title = `${days} ${days === 1 ? 'dia' : 'dias'} em atraso (prazo de ${limit} dias)`;
    else if (remaining === 0) title = `Vence hoje (prazo de ${limit} dias)`;
    else title = `Faltam ${days} ${days === 1 ? 'dia' : 'dias'} (prazo de ${limit} dias)`;

    const icon = late ? 'fa-triangle-exclamation' : 'fa-clock';
    return `<span class="u-prazo ${late ? 'is-late' : 'is-ok'}" title="${title}">
        <i class="fas ${icon}"></i>${days} d</span>`;
}

/**
 * SITUAÇÃO FINANCEIRA — um cifrão colorido, e só.
 *
 * A informação é de conferência, não de trabalho: quem olha a fila quer saber o
 * que analisar, e o financeiro só precisa saltar aos olhos quando alguém for
 * atrás dele. Por isso um único caractere, com a situação por extenso no
 * `title`, em vez de mais uma pílula disputando a linha.
 *
 * Fica no fim da faixa de etiquetas, encostado na borda direita — logo acima da
 * data de entrada, na coluna que o olho já percorre de cima para baixo.
 *
 * Verde pago, âmbar pendente, roxo isento por interesse didático — as mesmas
 * cores do Mural e do Livro de Registros.
 */
function renderFinanceiro(task) {
    const situacao = task.financialStatus || task.situacao || 'pendente';
    const info = {
        pago: { classe: 'is-pago', titulo: 'Pago' },
        didatico: { classe: 'is-didatico', titulo: 'Isento — interesse didático' }
    }[situacao] || { classe: 'is-pendente', titulo: 'Pagamento pendente' };

    return `<span class="u-fin ${info.classe}" title="${info.titulo}" aria-label="${info.titulo}">$</span>`;
}

/**
 * Subtítulo do cartão de prioridades: um número por nível, cada um na sua cor.
 * Com a fila vazia sobra a frase de descanso — dois zeros lado a lado não dizem
 * nada.
 */
function renderPriorityCounts(urgentes, prioritarias) {
    const total = urgentes + prioritarias;

    if (els.urgentCount) els.urgentCount.textContent = total;

    if (!els.urgentSubtitle) return;

    if (total === 0) {
        els.urgentSubtitle.innerHTML = 'Nada urgente nem prioritário agora';
        return;
    }

    const rotular = (n, nivel) =>
        `${n} ${n === 1 ? NIVEIS[nivel].rotulo.toLowerCase() : NIVEIS[nivel].plural}`;

    els.urgentSubtitle.innerHTML = [
        `<span class="is-urgent">${rotular(urgentes, 'urgente')}</span>`,
        `<span class="is-priority">${rotular(prioritarias, 'prioritaria')}</span>`
    ].join(' · ');
}

// Urgente antes de prioritária, sempre: é a ordem da escala, e um prazo
// confortável numa urgente não a faz esperar atrás de uma prioritária estourada.
// Dentro de cada nível vale o prazo — o caso mais perto de estourar (ou mais
// atrasado) vem primeiro.
function renderUrgentList(tasks) {
    if (!els.urgentList) return;

    const rows = [...tasks].sort((a, b) => {
        const nivel = pesoPrioridade(a) - pesoPrioridade(b);
        if (nivel !== 0) return nivel;

        const infoA = getDeadlineInfo(a);
        const infoB = getDeadlineInfo(b);
        if (!infoA !== !infoB) return infoA ? -1 : 1;   // sem data vai pro fim
        if (infoA && infoB && infoA.remaining !== infoB.remaining) {
            return infoA.remaining - infoB.remaining;
        }
        // Protocolo é cronológico: ano da série primeiro, depois o número.
        return pesoProtocolo(a.protocolo) - pesoProtocolo(b.protocolo);
    });

    renderPriorityCounts(
        rows.filter((task) => nivelDaAmostra(task) === 'urgente').length,
        rows.filter((task) => nivelDaAmostra(task) === 'prioritaria').length
    );

    els.urgentList.innerHTML = '';
    els.urgentList.classList.toggle('is-empty', rows.length === 0);

    if (rows.length === 0) {
        els.urgentList.appendChild(buildEmpty('Nenhuma amostra urgente ou prioritária no momento.'));
        return;
    }

    rows.forEach((task) => els.urgentList.appendChild(buildUrgentCard(task)));
}

/**
 * Fila geral de um tipo: mais antigo primeiro. Aqui não existe recorte por
 * prioridade — o cartão ao lado já cuida disso, e o que esta lista responde é
 * "o que está encalhado há mais tempo". O protocolo é sequencial no tempo, então
 * é ele que ordena.
 */
function renderTypeQueue(list, counter, tasks, mensagemVazia) {
    if (!list) return;

    const rows = [...tasks].sort((a, b) => {
        // Reaberto por último: ele está aqui para ser encontrado, não para
        // furar a fila de quem ainda tem prazo correndo.
        const reabertura = pesoReabertura(a) - pesoReabertura(b);
        if (reabertura !== 0) return reabertura;
        return pesoProtocolo(a.protocolo) - pesoProtocolo(b.protocolo);
    });

    if (counter) counter.textContent = rows.length;

    list.innerHTML = '';
    list.classList.toggle('is-empty', rows.length === 0);

    if (rows.length === 0) {
        list.appendChild(buildEmpty(mensagemVazia));
        return;
    }

    rows.forEach((task) => list.appendChild(buildQueueCard(task)));
}

function buildEmpty(mensagem) {
    const box = document.createElement('div');
    box.className = 'hub-card-empty';
    box.innerHTML = `
        <i class="far fa-check-circle fa-lg"></i>
        <p>${escapeHtml(mensagem)}</p>`;
    return box;
}

/** Abrir a ficha é o que todo cartão do painel faz — clique ou Enter/Espaço. */
function makeCardOpenable(card, task) {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.title = `${task.protocolo || ''} — ${task.animalNome || ''}`;

    const openDetails = () => openTaskManagerWithRetry(task.id);
    card.addEventListener('click', openDetails);
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetails();
        }
    });
}

function buildUrgentCard(task) {
    const isNecropsia = isNecropsiaTask(task);
    const typeClass = isNecropsia ? 'type-necro' : 'type-bio';

    const card = document.createElement('div');
    card.className = `hub-row is-prioridade ${classeDoNivel(task)} ${typeClass}`;
    makeCardOpenable(card, task);

    card.innerHTML = `
        <span class="u-prot">${bandeiraDoNivel(task, 'u-flag')}${escapeHtml(task.protocolo || '---')}</span>
        <span class="u-tags">${etiquetaReaberto(task, 'u-tag')}${etiquetasDeEtapa(task, 'u-tag')}${renderFinanceiro(task)}</span>
        <span class="u-animal"><strong>${escapeHtml(task.animalNome || 'Sem Nome')}</strong>
            <span class="u-species">(${escapeHtml(task.especie || '?')})</span></span>
        <span class="u-type ${typeClass}">${isNecropsia ? 'NECROPSIA' : 'BIÓPSIA'}</span>
        <span class="u-resp"><i class="fas fa-user-graduate"></i>${escapeHtml(getShortName(task.posGraduando || 'Sem Pós'))}</span>
        ${renderPrazo(task)}`;

    return card;
}

function buildQueueCard(task) {
    const typeClass = isNecropsiaTask(task) ? 'type-necro' : 'type-bio';

    const card = document.createElement('div');
    card.className = `hub-row is-fila ${typeClass}${estaReaberto(task) ? ' is-reaberta' : ''}`;
    makeCardOpenable(card, task);

    const dataEntrada = task.dataEntrada
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : '—';

    // O canto de baixo à direita é do botão de concluir enquanto houver etapa
    // pendente; sem nenhuma, o espaço volta a mostrar o prazo.
    const pendentes = etapasDaAmostra(task).filter((etapa) => etapa.estado !== FEITO);
    const acoes = pendentes.length > 0
        ? `<span class="u-done">${pendentes.map((etapa) => `
            <button type="button" class="btn-done" data-etapa="${etapa.chave}" data-task="${escapeHtml(task.id)}"
                title="Marcar ${etapa.titulo.toLowerCase()} como concluída">${escapeHtml(etapa.rotuloAcao)}</button>`).join('')}</span>`
        : renderPrazo(task);

    card.innerHTML = `
        <span class="u-prot">${escapeHtml(task.protocolo || '---')}</span>
        <span class="u-tags">${etiquetaReaberto(task, 'u-tag')}${etiquetasDeEtapa(task, 'u-tag')}${renderFinanceiro(task)}</span>
        <span class="u-animal"><strong>${escapeHtml(task.animalNome || 'Sem Nome')}</strong>
            <span class="u-species">(${escapeHtml(task.especie || '?')})</span></span>
        <span class="u-date"><i class="far fa-calendar"></i>${dataEntrada}</span>
        <span class="u-resp"><i class="fas fa-user-graduate"></i>${escapeHtml(getShortName(task.posGraduando || 'Sem Pós'))}</span>
        ${acoes}`;

    card.querySelectorAll('.btn-done').forEach((botao) => {
        botao.addEventListener('click', (event) => {
            // O cartão inteiro abre a ficha; o botão não pode abrir junto.
            event.stopPropagation();
            concluirEtapa(botao.dataset.task, botao.dataset.etapa, botao);
        });
    });

    return card;
}

/**
 * Marca a etapa como feita. O caso continua na fila — quem tira um caso do
 * painel é a liberação do laudo. O que muda é a etiqueta, que passa a mostrar o
 * certo, e o contador do cabeçalho, que perde uma pendência.
 */
async function concluirEtapa(taskId, chave, botao) {
    if (!taskId || !ETAPAS[chave]) return;

    if (!hasFullControl(currentUserData?.role)) {
        alert('Apenas professor, pós-graduando ou admin podem concluir etapas.');
        return;
    }

    botao.disabled = true;
    try {
        await updateDoc(doc(db, "tasks", taskId), { [ETAPAS[chave].campo]: FEITO });
        // O onSnapshot redesenha sozinho; nada a fazer aqui.
    } catch (erro) {
        console.error(erro);
        botao.disabled = false;
        alert('Não foi possível marcar a etapa como concluída.');
    }
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

// AUXILIARES
function getShortName(fullName) {
    if (!fullName) return '-';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0]}.`;
}

function normalizeText(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function escapeHtml(value) {
    return (value ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =====================================================================
//  CALENDÁRIO — utilitários compartilhados
// =====================================================================

function getWeekDates(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0=Dom
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 5; i++) { // Seg-Sex only
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
    }
    return days;
}

function dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =====================================================================
//  AGENDA SEMANAL (Seg-Sex, separada por manhã e tarde)
//  Fonte: agendamentos do Planner na coleção "tasks".
// =====================================================================

const AGENDA_DAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const AGENDA_SHIFTS = [
    { key: 'manha', label: 'Manhã', icon: 'fa-sun' },
    { key: 'tarde', label: 'Tarde', icon: 'fa-moon' }
];
// Antes disso é manhã; a partir daí, tarde.
const AGENDA_SHIFT_CUTOFF = '12:00';

let weekOffset = 0;              // 0 = semana corrente
let weekTasksCache = [];
let unsubscribeWeek = null;

function initWeekAgenda() {
    renderWeekLegend();
    renderWeekAgenda();
    subscribeWeekTasks();

    document.getElementById('week-prev')?.addEventListener('click', () => shiftWeek(-1));
    document.getElementById('week-next')?.addEventListener('click', () => shiftWeek(1));
    document.getElementById('week-today')?.addEventListener('click', () => {
        if (weekOffset === 0) return;
        weekOffset = 0;
        renderWeekAgenda();
        subscribeWeekTasks();
    });
}

function shiftWeek(delta) {
    weekOffset += delta;
    renderWeekAgenda();
    subscribeWeekTasks();
}

function subscribeWeekTasks() {
    if (unsubscribeWeek) unsubscribeWeek();

    const days = getWeekDates(weekOffset);
    const q = query(
        collection(db, "tasks"),
        where("scheduledDate", ">=", dateToStr(days[0])),
        where("scheduledDate", "<=", dateToStr(days[4]))
    );

    unsubscribeWeek = onSnapshot(q, (snap) => {
        weekTasksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderWeekAgenda();
    }, (error) => {
        console.warn('Agenda semanal indisponível:', error.message);
        weekTasksCache = [];
        renderWeekAgenda();
    });
}

function getAgendaShift(task) {
    return (task.scheduledTime || '') < AGENDA_SHIFT_CUTOFF ? 'manha' : 'tarde';
}

/**
 * Legenda das cores da semana.
 *
 * A agenda ganhou cor e cor sem legenda é enfeite: quem abre o Hub precisa saber
 * que roxo é estágio e verde é aula sem ter que abrir o Planner para descobrir.
 * Sai da mesma tabela que pinta os chips, então não tem como uma dizer uma coisa
 * e a outra dizer outra.
 */
function renderWeekLegend() {
    const alvo = document.getElementById('week-legend');
    if (!alvo) return;

    alvo.innerHTML = '';
    TIPOS_AGENDA.forEach((tipo) => {
        const item = document.createElement('span');
        item.className = 'week-legend-item';
        pintarPorTipo(item, tipo.id);
        item.innerHTML = `<span class="week-legend-dot"></span>${escapeHtml(tipo.rotulo)}`;
        alvo.appendChild(item);
    });
}

// Uma coluna por dia; dentro dela os agendamentos vêm rotulados por turno.
function renderWeekAgenda() {
    const grid = document.getElementById('week-grid');
    if (!grid) return;

    const days = getWeekDates(weekOffset);
    const todayStr = dateToStr(new Date());

    const label = document.getElementById('week-range-label');
    if (label) {
        const [start] = days;
        const end = days[days.length - 1];
        label.textContent = `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} — ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`;
    }

    grid.innerHTML = '';

    days.forEach((date, index) => {
        const dStr = dateToStr(date);
        const isToday = dStr === todayStr;

        const col = document.createElement('div');
        col.className = `week-day${isToday ? ' today' : ''}`;
        col.innerHTML = `
            <div class="week-day-header">
                <span class="week-day-name">${AGENDA_DAY_SHORT[index]}</span>
                <span class="week-day-num">${date.getDate()}</span>
            </div>`;

        const body = document.createElement('div');
        body.className = 'week-day-body';

        const dayTasks = weekTasksCache.filter(t => t.scheduledDate === dStr);

        // Os dois turnos são sempre desenhados, mesmo vazios: é a divisão
        // manhã/tarde que dá a leitura do dia de relance.
        AGENDA_SHIFTS.forEach(({ key, label: shiftLabel, icon }) => {
            const items = dayTasks
                .filter(t => getAgendaShift(t) === key)
                .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

            const block = document.createElement('div');
            block.className = `week-shift-block shift-${key}`;
            block.innerHTML = `<div class="week-shift"><i class="fas ${icon}"></i>${shiftLabel}</div>`;

            const itemsWrap = document.createElement('div');
            itemsWrap.className = 'week-shift-items';

            if (items.length === 0) {
                itemsWrap.innerHTML = '<span class="week-shift-empty">—</span>';
            }

            items.forEach((task) => {
                const tipo = tipoDaAgenda(task);
                const chip = document.createElement('div');
                chip.className = 'week-chip';
                // A cor vem da tabela do Planner, não de uma classe daqui: era
                // assim que "Aula" chegava no Hub pintada de cinza de "outros".
                pintarPorTipo(chip, tipo);
                chip.innerHTML = `
                    <span class="week-chip-time">${escapeHtml(task.scheduledTime || '--:--')}</span>
                    <span class="week-chip-label">${escapeHtml(task.protocolo || task.animalNome || 'Sem título')}</span>`;
                chip.title = `${infoDoTipo(tipo).rotulo} · ${task.protocolo || ''} — ${task.animalNome || ''} (${task.scheduledTime || '--:--'})`;
                chip.addEventListener('click', () => { window.location.href = 'planner.html'; });
                itemsWrap.appendChild(chip);
            });

            block.appendChild(itemsWrap);
            body.appendChild(block);
        });

        col.appendChild(body);
        grid.appendChild(col);
    });
}
