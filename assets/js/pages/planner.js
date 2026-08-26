import { db, auth, normalizeRoles, hasFullControl } from '../core.js';
import {
    collection, query, where, doc, getDoc, updateDoc, deleteDoc, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { TIPOS_AGENDA, TIPO_AGENDA, pintarPorTipo, tipoDaAgenda } from '../lib/agenda-tipos.js';

/* ==========================================================================
   CONSTANTES
   ========================================================================== */

/* A tabela de tipos mora em lib/agenda-tipos.js: a semana do Hub lê a mesma
   agenda e precisa das mesmas cores. */
const TIPOS = TIPOS_AGENDA;
const T = TIPO_AGENDA;

/** O tipo que o estagiário pode criar — e o único que ele pode editar. */
const TIPO_ESTAGIO = 'estagio';

const DOW_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const TURNOS = {
    manha: { ini: 8 * 60,  fim: 12 * 60, rotulo: 'Manhã' },
    tarde: { ini: 13 * 60, fim: 18 * 60, rotulo: 'Tarde' },
};

/** Quantos chips cabem numa célula do mês antes do "+N mais". */
const MAX_CHIPS = 3;

/** A semana mostra só os dias úteis: segunda a sexta. */
const DIAS_SEMANA = 5;

/* ==========================================================================
   HELPERS DE DATA / HORA
   ========================================================================== */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const somaDias = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const inicioSemana = (s) => somaDias(s, -parseISO(s).getDay());
const br = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
const minutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const turnoDe = (h) => (minutos(h) < 12 * 60 ? 'manha' : 'tarde');
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

const HOJE = iso(new Date());

/* ==========================================================================
   ESTADO
   ========================================================================== */

let tasksCache = [];

/**
 * PERMISSÃO DE EDIÇÃO — dois níveis, não um interruptor.
 *
 * Professor, pós-graduando e admin mexem no calendário inteiro: arrastam
 * amostra, agendam, movem turno, excluem. É a escala do laboratório.
 *
 * Estagiário mexe só no que é dele e só do tipo "Estágio" — a própria tarefa, a
 * própria falta. Não é uma versão mais fraca da mesma permissão: ele pode criar
 * (o que o "somente leitura" de antes proibia) e não pode tocar em caso de
 * laboratório nenhum, nem no dos outros estagiários.
 */
const perfil = { podeTudo: false, ehEstagiario: false, uid: null };

/** Quem pode encostar NESTA tarefa. */
function podeEditar(task) {
    if (perfil.podeTudo) return true;
    if (!perfil.ehEstagiario || !task) return false;
    return tipoDaAgenda(task) === TIPO_ESTAGIO && task.createdBy === perfil.uid;
}

/** Quem pode abrir uma faixa vazia e criar alguma coisa nela. */
function podeCriar() {
    return perfil.podeTudo || perfil.ehEstagiario;
}

/** A fila de pendentes é de amostra do laboratório: estagiário não agenda. */
function podeMexerNaFila() {
    return perfil.podeTudo;
}

/** Os tipos que aparecem no modal de criação para quem está logado. */
function tiposDisponiveis() {
    return perfil.podeTudo ? TIPOS : [T[TIPO_ESTAGIO]];
}

/* No desktop o trilho fica ao lado da agenda e já abre na fila de pendentes;
   no mobile ele é uma gaveta sobreposta, então começa fechado. */
const RAIL_INICIAL = window.matchMedia('(min-width: 1024px)').matches ? 'pendentes' : null;

const state = {
    visao: 'semana',       // 'semana' | 'mes'
    ancora: HOJE,          // data de referência do período exibido
    diaMobile: 0,          // dia aberto na visão de um dia por vez (0 = segunda)
    rail: RAIL_INICIAL,    // 'pendentes' | 'detalhe' | null
    detalheId: null,
    colocacao: null,       // tarefa aguardando escolha de faixa
    criando: null,         // { data, turno }
    novo: { tipo: 'necropsia', duracao: '60' },
};

let dragId = null;

/* ==========================================================================
   ELEMENTOS
   ========================================================================== */

const el = {};
function cacheEls() {
    const ids = [
        'tab-semana', 'tab-mes', 'prev-period', 'today-btn', 'next-period',
        'period-title', 'period-sub', 'period-count',
        'placement-banner', 'placement-task-name', 'cancel-placement',
        'week-view', 'week-head', 'band-manha', 'band-tarde',
        'month-view', 'month-grid',
        'planner-rail', 'rail-detalhe', 'rail-pendentes', 'detalhe-body',
        'close-detalhe', 'close-pendentes', 'pendentes-list', 'pendentes-count',
        'btn-pendentes', 'badge-pendentes', 'btn-agendar',
        'create-modal', 'create-target', 'close-create', 'cancel-create', 'save-create',
        'novo-titulo', 'novo-sub', 'novo-tipos', 'novo-data', 'novo-hora', 'novo-duracao',
        'create-hint',
    ];
    ids.forEach(id => { el[id] = document.getElementById(id); });
}

/* ==========================================================================
   NORMALIZAÇÃO DAS TAREFAS DO FIRESTORE
   ========================================================================== */

/* Leitura do tipo: a mesma da biblioteca, para a semana do Hub não divergir. */
const tipoDe = tipoDaAgenda;

function tituloDe(task) {
    return task.protocolo || task.animalNome || 'Sem título';
}

function subDe(task) {
    const partes = [task.especie, task.proprietario].filter(Boolean);
    if (partes.length) return partes.join(' · ');
    return task.animalNome || '—';
}

function responsavelDe(task) {
    return task.posGraduando || task.docente || task.remetente || '—';
}

function duracaoDe(task) {
    return Number(task.duration) || 60;
}

/** Data em que a tarefa entrou na fila, para o "na fila desde". */
function desdeDe(task) {
    const raw = task.dataEntrada || task.createdAt;
    if (!raw) return null;
    const s = String(raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const agendadas = () => tasksCache.filter(t => t.scheduledDate && t.scheduledTime);
const pendentes = () => tasksCache.filter(t => !t.scheduledDate && !t.releasedAt);

/* ==========================================================================
   REGRAS DE AGENDAMENTO
   ========================================================================== */

function estaNoPassado(dataISO) {
    return dataISO < HOJE;
}

/** Primeiro horário livre da faixa, encaixando depois da última tarefa. */
function proximaLivre(data, turno) {
    const { ini, fim } = TURNOS[turno];
    const doDia = agendadas().filter(t => t.scheduledDate === data && turnoDe(t.scheduledTime) === turno);
    let m = ini;
    doDia.sort((a, b) => minutos(a.scheduledTime) - minutos(b.scheduledTime)).forEach(t => {
        const termino = minutos(t.scheduledTime) + duracaoDe(t);
        if (termino > m) m = termino;
    });
    return hhmm(Math.min(m, fim - 30));
}

async function agendar(id, data, turno) {
    const alvo = tasksCache.find(t => t.id === id);
    if (!podeEditar(alvo)) return;
    if (estaNoPassado(data)) {
        alert('Não é possível agendar em dias que já passaram.');
        return;
    }
    const tarefa = tasksCache.find(t => t.id === id);
    if (!tarefa) return;

    const hora = proximaLivre(data, turno);
    const { fim } = TURNOS[turno];
    const duracao = Math.min(duracaoDe(tarefa), fim - minutos(hora));

    state.colocacao = null;
    await updateDoc(doc(db, 'tasks', id), {
        scheduledDate: data,
        scheduledTime: hora,
        duration: duracao > 0 ? duracao : 30,
        updatedAt: new Date().toISOString(),
    });
}

/* ==========================================================================
   RENDER — BARRA DE CONTROLE
   ========================================================================== */

/** Segunda-feira da semana exibida (o desenho começa a semana na segunda). */
function inicioDaSemana() {
    return somaDias(inicioSemana(state.ancora), 1);
}

function renderToolbar() {
    const ehSemana = state.visao === 'semana';
    el['tab-semana'].classList.toggle('is-active', ehSemana);
    el['tab-semana'].setAttribute('aria-pressed', String(ehSemana));
    el['tab-mes'].classList.toggle('is-active', !ehSemana);
    el['tab-mes'].setAttribute('aria-pressed', String(!ehSemana));

    const a = parseISO(state.ancora);
    const ini = inicioDaSemana();
    const fimSem = somaDias(ini, DIAS_SEMANA - 1);
    const totalDias = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();

    if (ehSemana) {
        el['period-title'].textContent = ini.slice(5, 7) === fimSem.slice(5, 7)
            ? `${Number(ini.slice(8, 10))} – ${Number(fimSem.slice(8, 10))} de ${MESES[parseISO(ini).getMonth()]}`
            : `${Number(ini.slice(8, 10))} ${MESES[parseISO(ini).getMonth()].slice(0, 3)} – ${Number(fimSem.slice(8, 10))} ${MESES[parseISO(fimSem).getMonth()].slice(0, 3)}`;
        el['period-sub'].textContent = `Semana de ${br(ini)} · ${a.getFullYear()}`;
    } else {
        el['period-title'].textContent = `${MESES[a.getMonth()]} ${a.getFullYear()}`;
        el['period-sub'].textContent = `${totalDias} dias · visão do mês`;
    }

    const noPeriodo = ehSemana
        ? agendadas().filter(t => t.scheduledDate >= ini && t.scheduledDate <= fimSem).length
        : agendadas().filter(t => t.scheduledDate.slice(0, 7) === state.ancora.slice(0, 7)).length;
    el['period-count'].textContent = noPeriodo;

    // Faixa do modo "escolher onde encaixar"
    if (state.colocacao) {
        el['placement-banner'].classList.remove('hidden');
        el['placement-task-name'].textContent = tituloDe(state.colocacao);
    } else {
        el['placement-banner'].classList.add('hidden');
    }
}

/* ==========================================================================
   RENDER — CARTÕES
   ========================================================================== */

/** Aplica a cor do tipo como custom properties usadas pelo CSS. */
const pintar = pintarPorTipo;

function criarCartao(task) {
    const tipo = tipoDe(task);
    const card = document.createElement('div');
    card.className = 'pl-card';
    pintar(card, tipo);
    card.draggable = podeEditar(task);
    card.innerHTML = `
        <div class="pl-card-top">
            <span class="pl-card-hora">${task.scheduledTime}</span>
            <span class="pl-tag">${T[tipo].curto}</span>
        </div>
        <span class="pl-card-titulo"></span>
        <span class="pl-card-sub"></span>
    `;
    card.querySelector('.pl-card-titulo').textContent = tituloDe(task);
    card.querySelector('.pl-card-sub').textContent = subDe(task);

    card.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirDetalhe(task.id);
    });
    card.addEventListener('dragstart', (e) => {
        if (!podeEditar(task)) return;
        dragId = task.id;
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    return card;
}

/* ==========================================================================
   RENDER — VISÃO SEMANAL
   ========================================================================== */

function renderSemana() {
    const ini = inicioDaSemana();

    // Semana nova na tela: o dia aberto no celular volta a ser hoje.
    if (semanaAberta !== ini) {
        state.diaMobile = diaPadrao(ini);
        semanaAberta = ini;
    }

    const porDia = {};
    agendadas().forEach(t => { (porDia[t.scheduledDate] = porDia[t.scheduledDate] || []).push(t); });
    Object.values(porDia).forEach(a => a.sort((x, y) => minutos(x.scheduledTime) - minutos(y.scheduledTime)));

    // Cabeçalho dos dias
    el['week-head'].querySelectorAll('.pl-day-head').forEach(n => n.remove());
    ['manha', 'tarde'].forEach(t => {
        el[`band-${t}`].querySelectorAll('.pl-lane').forEach(n => n.remove());
    });

    for (let i = 0; i < DIAS_SEMANA; i++) {
        const data = somaDias(ini, i);
        const d = parseISO(data);
        const eHoje = data === HOJE;
        const passado = data < HOJE;
        const lista = porDia[data] || [];

        const head = document.createElement('div');
        head.className = 'pl-day-head' + (eHoje ? ' is-today' : '') + (passado ? ' is-past' : '')
                       + (i === state.diaMobile ? ' is-selected' : '');
        head.innerHTML = `
            <div class="pl-day-label">
                <span class="pl-dow">${DOW_CURTO[d.getDay()]}</span>
                <span class="pl-daynum">${d.getDate()}</span>
            </div>
            ${lista.length ? `<span class="pl-day-count">${lista.length}</span>` : ''}
        `;

        // Abaixo de 720px o cabeçalho do dia é o seletor da agenda. Acima, as
        // cinco colunas já aparecem juntas: redesenhar não mudaria nada na tela
        // além de repetir a animação de entrada de todos os cartões.
        head.addEventListener('click', () => {
            if (!umDiaPorVez.matches || state.diaMobile === i) return;
            state.diaMobile = i;
            renderSemana();
        });

        el['week-head'].appendChild(head);

        ['manha', 'tarde'].forEach(turno => {
            const doTurno = lista.filter(t => turnoDe(t.scheduledTime) === turno);
            const lane = document.createElement('div');
            lane.className = 'pl-lane';
            if (i === state.diaMobile) lane.classList.add('is-selected');
            if (passado) lane.classList.add('is-past');
            if (state.colocacao) lane.classList.add('is-target');
            if (!podeCriar()) lane.classList.add('is-locked');

            doTurno.forEach(t => lane.appendChild(criarCartao(t)));
            if (!doTurno.length) {
                const vazio = document.createElement('span');
                vazio.className = 'pl-lane-empty';
                vazio.textContent = '+ agendar';
                lane.appendChild(vazio);
            }

            lane.addEventListener('click', (e) => {
                if (e.target.closest('.pl-card')) return;
                if (!podeCriar()) return;
                if (state.colocacao) agendar(state.colocacao.id, data, turno);
                else abrirCriar(data, turno);
            });
            if (podeCriar()) {
                lane.addEventListener('dragover', (e) => { e.preventDefault(); lane.classList.add('is-dragover'); });
                lane.addEventListener('dragleave', () => lane.classList.remove('is-dragover'));
                lane.addEventListener('drop', (e) => {
                    e.preventDefault();
                    lane.classList.remove('is-dragover');
                    if (dragId) { agendar(dragId, data, turno); dragId = null; }
                });
            }
            el[`band-${turno}`].appendChild(lane);
        });
    }
}

/* --------------------------------------------------------------------------
   UM DIA POR VEZ NO CELULAR

   Cinco colunas não cabem num telefone. A primeira tentativa foi manter a grade
   e rolar de lado, uma coluna por tela — mas o dia chegava cortado pela metade,
   com o vizinho aparecendo de lado, e o rótulo do turno virava uma faixa
   vertical de 46px que roubava 13% da largura para dizer duas palavras.

   Aqui o cabeçalho da semana vira a régua de dias (SEG a SEX, com a contagem
   de cada um) e a agenda mostra o dia escolhido inteiro, manhã e tarde
   empilhadas na largura toda. É o desenho de qualquer calendário de celular, e
   quem escolhe o que aparece é esta variável — o CSS abaixo de 720px esconde
   as faixas dos outros dias.

   O dia aberto é hoje quando a semana exibida contém hoje. A escolha é refeita
   quando o período muda, não a cada render: a agenda redesenha a cada mudança
   no Firestore, e reescolher ali jogaria de volta para hoje o dia que a pessoa
   acabou de abrir.
   -------------------------------------------------------------------------- */
let semanaAberta = null;

/** O mesmo corte do CSS: abaixo dele a agenda mostra um dia por vez. */
const umDiaPorVez = window.matchMedia('(max-width: 720px)');

/** Índice do dia que a semana abre: hoje, quando ele está nela. */
function diaPadrao(ini) {
    const i = Math.round((parseISO(HOJE) - parseISO(ini)) / 86400000);
    return i >= 0 && i < DIAS_SEMANA ? i : 0;
}

/* ==========================================================================
   RENDER — VISÃO MENSAL
   ========================================================================== */

function renderMes() {
    const a = parseISO(state.ancora);
    const primeiro = new Date(a.getFullYear(), a.getMonth(), 1);
    const offset = primeiro.getDay();
    const totalDias = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
    const semanas = Math.ceil((offset + totalDias) / 7);

    const porDia = {};
    agendadas().forEach(t => { (porDia[t.scheduledDate] = porDia[t.scheduledDate] || []).push(t); });
    Object.values(porDia).forEach(l => l.sort((x, y) => minutos(x.scheduledTime) - minutos(y.scheduledTime)));

    const grid = el['month-grid'];
    grid.innerHTML = '';
    // A altura da linha é do CSS (`--pl-month-row`): no celular a célula vira
    // número e horários, e o piso do desktop deixaria o mês rolando à toa.
    grid.style.gridTemplateRows = `repeat(${semanas}, minmax(var(--pl-month-row, ${52 + MAX_CHIPS * 22 + 18}px), 1fr))`;

    for (let i = 0; i < semanas * 7; i++) {
        const dia = i - offset + 1;
        const d = new Date(a.getFullYear(), a.getMonth(), dia);
        const data = iso(d);
        const doMes = dia >= 1 && dia <= totalDias;
        const eHoje = data === HOJE;
        const lista = porDia[data] || [];

        const cell = document.createElement('div');
        cell.className = 'pl-cell';
        if (!doMes) cell.classList.add('is-outside');
        else if (eHoje) cell.classList.add('is-today');
        if (doMes && state.colocacao) cell.classList.add('is-target');
        if (doMes && !podeCriar()) cell.classList.add('is-locked');

        // Cabeçalho da célula: número + contagem/barra por tipo
        const top = document.createElement('div');
        top.className = 'pl-cell-top';
        const cores = TIPOS.filter(t => lista.some(x => tipoDe(x) === t.id)).map(t => t.cor);
        const barra = cores.length > 1 ? `linear-gradient(90deg,${cores.join(',')})` : (cores[0] || 'transparent');
        top.innerHTML = `
            <span class="pl-cell-num">${d.getDate()}</span>
            ${lista.length ? `
                <span class="pl-cell-meta">
                    <span class="pl-cell-total">${lista.length}</span>
                    <span class="pl-cell-bar" style="background:${barra};"></span>
                </span>` : ''}
        `;
        cell.appendChild(top);

        const chips = document.createElement('div');
        chips.className = 'pl-cell-chips';
        lista.slice(0, MAX_CHIPS).forEach(t => {
            const tipo = tipoDe(t);
            const chip = document.createElement('div');
            chip.className = 'pl-chip';
            pintar(chip, tipo);
            chip.style.setProperty('--card-tint', `${T[tipo].cor}1a`);
            chip.innerHTML = `
                <span class="pl-chip-dot"></span>
                <span class="pl-chip-hora">${t.scheduledTime}</span>
                <span class="pl-chip-titulo"></span>
            `;
            chip.querySelector('.pl-chip-titulo').textContent = tituloDe(t);
            chip.addEventListener('click', (e) => { e.stopPropagation(); abrirDetalhe(t.id); });
            chips.appendChild(chip);
        });
        if (lista.length > MAX_CHIPS) {
            const mais = document.createElement('span');
            mais.className = 'pl-cell-mais';
            mais.textContent = `+${lista.length - MAX_CHIPS} mais`;
            chips.appendChild(mais);
        }
        cell.appendChild(chips);

        if (doMes) {
            cell.addEventListener('click', (e) => {
                if (e.target.closest('.pl-chip')) return;
                if (!podeCriar()) return;
                if (state.colocacao) {
                    agendar(state.colocacao.id, data, 'manha');
                } else {
                    state.ancora = data;
                    abrirCriar(data, 'manha');
                }
            });
            if (podeCriar()) {
                cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('is-dragover'); });
                cell.addEventListener('dragleave', () => cell.classList.remove('is-dragover'));
                cell.addEventListener('drop', (e) => {
                    e.preventDefault();
                    cell.classList.remove('is-dragover');
                    if (dragId) { agendar(dragId, data, 'manha'); dragId = null; }
                });
            }
        }

        grid.appendChild(cell);
    }
}

/* ==========================================================================
   RENDER — TRILHO LATERAL
   ========================================================================== */

function renderRail() {
    const fila = pendentes();
    // O detalhe só existe para tarefa agendada: se ela foi devolvida à fila por
    // outra pessoa enquanto o painel estava aberto, o trilho volta aos pendentes.
    const tarefaDet = tasksCache.find(t => t.id === state.detalheId && t.scheduledDate && t.scheduledTime);
    if (state.rail === 'detalhe' && !tarefaDet) {
        state.rail = 'pendentes';
        state.detalheId = null;
    }
    const verDetalhe = state.rail === 'detalhe';
    const verPendentes = state.rail === 'pendentes';

    el['planner-rail'].classList.toggle('hidden', state.rail === null);
    el['rail-detalhe'].classList.toggle('hidden', !verDetalhe);
    el['rail-pendentes'].classList.toggle('hidden', !verPendentes);

    el['btn-pendentes'].classList.toggle('is-active', verPendentes);
    el['badge-pendentes'].textContent = fila.length ? fila.length : '';
    el['pendentes-count'].textContent = fila.length;

    if (verDetalhe) renderDetalhe(tarefaDet);
    if (verPendentes) renderPendentes(fila);
}

function renderDetalhe(task) {
    const tipo = tipoDe(task);
    const duracao = duracaoDe(task);
    const turno = turnoDe(task.scheduledTime);
    const body = el['detalhe-body'];
    body.innerHTML = `
        <div class="pl-detail-head">
            <span class="pl-detail-tag">${T[tipo].rotulo}</span>
            <span class="pl-detail-titulo"></span>
            <span class="pl-detail-sub"></span>
        </div>
        <div class="pl-detail-grid">
            <div class="pl-field"><span class="pl-field-label">Data</span><span class="pl-field-value num">${br(task.scheduledDate)}</span></div>
            <div class="pl-field"><span class="pl-field-label">Horário</span><span class="pl-field-value num">${task.scheduledTime} – ${hhmm(minutos(task.scheduledTime) + duracao)}</span></div>
            <div class="pl-field"><span class="pl-field-label">Turno</span><span class="pl-field-value">${TURNOS[turno].rotulo}</span></div>
            <div class="pl-field"><span class="pl-field-label">Duração</span><span class="pl-field-value">${dur(duracao)}</span></div>
            <div class="pl-field"><span class="pl-field-label">Responsável</span><span class="pl-field-value" data-slot="responsavel"></span></div>
            <div class="pl-field"><span class="pl-field-label">Espécie</span><span class="pl-field-value" data-slot="especie"></span></div>
        </div>
        ${podeEditar(task) ? `
        <div class="pl-detail-actions">
            <button type="button" class="pl-action" data-act="mover"><i class="fas fa-right-left"></i> Mover para ${turno === 'manha' ? 'tarde' : 'manhã'}</button>
            <!-- Devolver aos pendentes é só de quem mexe na fila: um item de
                 estágio devolvido cairia num trilho que o estagiário não pode
                 abrir, e ele ficaria sem como trazer o próprio item de volta. -->
            ${podeMexerNaFila() ? `
            <button type="button" class="pl-action" data-act="devolver"><i class="fas fa-inbox"></i> Devolver aos pendentes</button>` : ''}
            <button type="button" class="pl-action danger" data-act="excluir"><i class="fas fa-trash"></i> Excluir</button>
        </div>` : ''}
    `;
    pintar(body.querySelector('.pl-detail-tag'), tipo);
    body.querySelector('.pl-detail-titulo').textContent = tituloDe(task);
    body.querySelector('.pl-detail-sub').textContent = subDe(task);
    body.querySelector('[data-slot="responsavel"]').textContent = responsavelDe(task);
    body.querySelector('[data-slot="especie"]').textContent = task.especie || '—';

    const acao = (nome, fn) => {
        const btn = body.querySelector(`[data-act="${nome}"]`);
        if (btn) btn.addEventListener('click', fn);
    };
    acao('mover', () => moverTurno(task));
    acao('devolver', () => devolverParaPendentes(task));
    acao('excluir', () => excluirTarefa(task));
}

function renderPendentes(fila) {
    const list = el['pendentes-list'];
    list.innerHTML = '';

    if (!fila.length) {
        list.innerHTML = `
            <div class="pl-pend-empty">
                <i class="fas fa-check-circle"></i>
                <p>Fila vazia</p>
                <p class="sub">Todos os casos estão agendados.</p>
            </div>`;
        return;
    }

    fila.forEach(task => {
        const tipo = tipoDe(task);
        const desde = desdeDe(task);
        const card = document.createElement('div');
        card.className = 'pl-pend-card';
        pintar(card, tipo);
        card.draggable = podeMexerNaFila();
        if (!podeMexerNaFila()) card.classList.add('is-locked');
        card.innerHTML = `
            <div class="pl-pend-top">
                <span class="pl-pend-titulo"></span>
                <span class="pl-pend-tag">${T[tipo].curto}</span>
            </div>
            <span class="pl-pend-sub"></span>
            <div class="pl-pend-foot">
                <span class="pl-pend-espera">${desde ? `na fila desde ${br(desde)}` : 'sem data'}</span>
                ${podeMexerNaFila() ? `
                <span class="pl-pend-btns">
                    <button type="button" class="pl-pend-btn schedule" title="Escolher faixa"><i class="fas fa-clock"></i></button>
                    <button type="button" class="pl-pend-btn remove" title="Excluir"><i class="fas fa-trash-alt"></i></button>
                </span>` : ''}
            </div>
        `;
        card.querySelector('.pl-pend-titulo').textContent = tituloDe(task);
        card.querySelector('.pl-pend-sub').textContent = subDe(task);

        card.addEventListener('dragstart', (e) => {
            if (!podeMexerNaFila()) return;
            dragId = task.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', task.id);
            card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));

        if (podeMexerNaFila()) {
            card.querySelector('.schedule').addEventListener('click', (e) => {
                e.stopPropagation();
                state.colocacao = task;
                renderAll();
            });
            card.querySelector('.remove').addEventListener('click', (e) => {
                e.stopPropagation();
                excluirTarefa(task);
            });
        }
        list.appendChild(card);
    });
}

/* ==========================================================================
   AÇÕES
   ========================================================================== */

function abrirDetalhe(id) {
    state.detalheId = id;
    state.rail = 'detalhe';
    renderAll();
}

async function moverTurno(task) {
    if (!podeEditar(task)) return;
    const destino = turnoDe(task.scheduledTime) === 'manha' ? 'tarde' : 'manha';
    const hora = proximaLivre(task.scheduledDate, destino);
    await updateDoc(doc(db, 'tasks', task.id), { scheduledTime: hora, updatedAt: new Date().toISOString() });
}

async function devolverParaPendentes(task) {
    state.rail = 'pendentes';
    state.detalheId = null;
    await updateDoc(doc(db, 'tasks', task.id), {
        scheduledDate: null, scheduledTime: null, duration: null,
        updatedAt: new Date().toISOString(),
    });
}

async function excluirTarefa(task) {
    if (!podeEditar(task)) return;
    if (!confirm(`Tem certeza que deseja excluir "${tituloDe(task)}"?`)) return;
    try {
        if (state.detalheId === task.id) { state.rail = 'pendentes'; state.detalheId = null; }
        if (state.colocacao && state.colocacao.id === task.id) state.colocacao = null;
        await deleteDoc(doc(db, 'tasks', task.id));
    } catch (e) {
        console.error(e);
        alert('Não foi possível excluir.');
    }
}

/* ==========================================================================
   MODAL DE NOVO AGENDAMENTO
   ========================================================================== */

function renderTipos() {
    const disponiveis = tiposDisponiveis();

    // O estagiário só tem "Estágio": a escolha some, e o tipo do estado é
    // corrigido aqui em vez de na gravação — o botão precisa nascer marcado.
    if (!disponiveis.some(t => t.id === state.novo.tipo)) {
        state.novo.tipo = disponiveis[0].id;
    }

    el['novo-tipos'].innerHTML = '';
    disponiveis.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pl-type-btn' + (state.novo.tipo === t.id ? ' is-active' : '');
        btn.textContent = t.rotulo;
        pintar(btn, t.id, true);
        btn.addEventListener('click', () => { state.novo.tipo = t.id; renderTipos(); });
        el['novo-tipos'].appendChild(btn);
    });
}

function abrirCriar(data, turno) {
    if (!podeCriar()) return;
    if (estaNoPassado(data)) {
        alert('Não é possível agendar em dias que já passaram.');
        return;
    }
    state.criando = { data, turno };
    el['create-target'].textContent = `${br(data)} · ${turno === 'manha' ? 'manhã' : 'tarde'}`;
    el['novo-titulo'].value = '';
    el['novo-sub'].value = '';
    el['novo-data'].value = data;
    el['novo-hora'].value = proximaLivre(data, turno);
    el['novo-duracao'].value = state.novo.duracao;
    renderTipos();
    el['create-modal'].classList.remove('hidden');
    setTimeout(() => el['novo-titulo'].focus(), 80);
}

function fecharCriar() {
    state.criando = null;
    el['create-modal'].classList.add('hidden');
}

async function salvarCriar() {
    if (!podeCriar()) return;

    const titulo = el['novo-titulo'].value.trim();
    if (!titulo) { alert('Digite um título.'); return; }

    const data = el['novo-data'].value;
    const hora = el['novo-hora'].value || '08:00';
    if (!data) { alert('Escolha uma data.'); return; }
    if (estaNoPassado(data)) { alert('Não é possível agendar em dias que já passaram.'); return; }

    // O tipo é conferido de novo na gravação: `state.novo.tipo` é estado de
    // tela, e tela é o que dá para burlar.
    const tipo = tiposDisponiveis().some(t => t.id === state.novo.tipo)
        ? state.novo.tipo
        : tiposDisponiveis()[0].id;

    state.novo.duracao = el['novo-duracao'].value;

    try {
        await addDoc(collection(db, 'tasks'), {
            protocolo: titulo,
            animalNome: el['novo-sub'].value.trim() || '',
            status: 'agendado',
            scheduledDate: data,
            scheduledTime: hora,
            duration: Number(state.novo.duracao),
            // O Mural e o Hub ignoram `agendamento_rapido`; o tipo de agenda
            // fica em `plannerTipo`, que só o Planner lê.
            type: 'agendamento_rapido',
            plannerTipo: tipo,
            // `createdBy` é o dono: é por ele que o estagiário reconhece o que é
            // dele e o que é de outro estagiário.
            createdBy: auth.currentUser ? auth.currentUser.uid : 'anon',
            createdAt: new Date().toISOString(),
        });
        state.ancora = data;
        fecharCriar();
        renderAll();
    } catch (e) {
        console.error(e);
        alert('Erro ao agendar: ' + e.message);
    }
}

/* ==========================================================================
   RENDER GERAL
   ========================================================================== */

function renderAll() {
    const ehSemana = state.visao === 'semana';
    el['week-view'].classList.toggle('hidden', !ehSemana);
    el['month-view'].classList.toggle('hidden', ehSemana);

    // A marca no <body> deixa o CSS saber qual visão está aberta. Serve para a
    // legenda de cores no celular: na semana cada cartão já traz a etiqueta do
    // tipo escrita, no mês sobram bolinha e hora — e aí a legenda é necessária.
    document.body.classList.toggle('pl-visao-mes', !ehSemana);

    renderToolbar();
    if (ehSemana) renderSemana(); else renderMes();
    renderRail();
}

/* ==========================================================================
   EVENTOS
   ========================================================================== */

function initControles() {
    el['tab-semana'].addEventListener('click', () => {
        state.visao = 'semana';
        renderAll();
    });
    el['tab-mes'].addEventListener('click', () => { state.visao = 'mes'; renderAll(); });

    el['prev-period'].addEventListener('click', () => {
        const a = parseISO(state.ancora);
        state.ancora = state.visao === 'semana'
            ? somaDias(state.ancora, -7)
            : iso(new Date(a.getFullYear(), a.getMonth() - 1, 1));
        renderAll();
    });

    el['next-period'].addEventListener('click', () => {
        const a = parseISO(state.ancora);
        state.ancora = state.visao === 'semana'
            ? somaDias(state.ancora, 7)
            : iso(new Date(a.getFullYear(), a.getMonth() + 1, 1));
        renderAll();
    });

    // "Hoje" apertado dentro da própria semana de hoje não muda o período — o
    // que ele precisa mudar no celular é o dia aberto, e quem segura isso é a
    // trava. Sem soltá-la, o botão não faria nada.
    el['today-btn'].addEventListener('click', () => {
        state.ancora = HOJE;
        semanaAberta = null;
        renderAll();
    });

    el['cancel-placement'].addEventListener('click', () => { state.colocacao = null; renderAll(); });

    el['btn-pendentes'].addEventListener('click', () => {
        state.rail = state.rail === 'pendentes' ? null : 'pendentes';
        state.detalheId = null;
        renderAll();
    });

    el['close-pendentes'].addEventListener('click', () => { state.rail = null; renderAll(); });
    el['close-detalhe'].addEventListener('click', () => {
        state.rail = 'pendentes';
        state.detalheId = null;
        renderAll();
    });

    el['btn-agendar'].addEventListener('click', () => abrirCriar(state.ancora, 'manha'));

    // "Nova Entrada" na sidebar e FAB do mobile abrem o mesmo agendamento.
    document.querySelectorAll('.btn-sidebar-new, .nav-fab').forEach(btn => {
        btn.addEventListener('click', () => abrirCriar(state.ancora, 'manha'));
    });

    el['close-create'].addEventListener('click', fecharCriar);
    el['cancel-create'].addEventListener('click', fecharCriar);
    el['save-create'].addEventListener('click', salvarCriar);
    el['create-modal'].addEventListener('click', (e) => {
        if (e.target === el['create-modal']) fecharCriar();
    });
    el['novo-titulo'].addEventListener('keydown', (e) => { if (e.key === 'Enter') salvarCriar(); });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (state.criando) fecharCriar();
        else if (state.colocacao) { state.colocacao = null; renderAll(); }
    });

    const logoutDesk = document.getElementById('logout-btn-desk');
    if (logoutDesk) logoutDesk.addEventListener('click', () => auth.signOut());
}

function aplicarPermissoes() {
    el['btn-agendar'].classList.toggle('hidden', !podeCriar());

    // A lista de tipos depende do papel, então ela só pode ser desenhada depois
    // que o perfil chega — antes disso o Planner ainda não sabe quem está ali.
    renderTipos();

    // Dito uma vez, no lugar onde a pessoa vai clicar: sem isso o estagiário
    // descobre o limite tentando arrastar um caso e não entendendo por que não
    // vai.
    if (el['create-hint']) {
        el['create-hint'].classList.toggle('hidden', perfil.podeTudo);
    }
}

/* ==========================================================================
   DADOS
   ========================================================================== */

/**
 * O corte de leitura é o ano do protocolo, não o `status`.
 *
 * A consulta antiga era `status not-in ['arquivado','concluido']`, e no Firestore
 * `not-in` só devolve documento que TEM o campo. Amostra cadastrada pelo
 * formulário de entrada nunca grava `status` — só o Planner (`agendado`) e a
 * liberação (`concluido`) gravam —, então nenhuma amostra chegava aqui: a lista
 * de pendências só via os agendamentos criados pelo próprio Planner.
 *
 * `protocoloAno` todo caso tem, e o `>=` não tem teto: série de ano futuro
 * (VN001-28) entra sozinha. O `status` passa a ser filtrado em memória, onde
 * campo ausente simplesmente não casa com 'arquivado'/'concluido'.
 */
const PRIMEIRO_ANO_ATIVO = () => new Date().getFullYear() - 1;

const FORA_DO_PLANNER = ['arquivado', 'concluido'];

/**
 * Três fontes porque nem todo documento tem `protocoloAno`:
 * - `recentes`: as amostras da série corrente em diante;
 * - `semAno`: protocolo ilegível, que fica abaixo do corte;
 * - `agendamentos`: os agendamentos rápidos criados aqui, que não têm protocolo
 *   nenhum e sumiriam de qualquer consulta baseada em ano.
 */
const fontesTasks = { recentes: [], semAno: [], agendamentos: [] };

function subscribeToTasks() {
    const consultas = {
        recentes: query(collection(db, 'tasks'), where('protocoloAno', '>=', PRIMEIRO_ANO_ATIVO())),
        semAno: query(collection(db, 'tasks'), where('protocoloAno', '==', 0)),
        agendamentos: query(collection(db, 'tasks'), where('type', '==', 'agendamento_rapido'))
    };

    Object.entries(consultas).forEach(([fonte, q]) => {
        onSnapshot(q, (snapshot) => {
            fontesTasks[fonte] = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(t => !FORA_DO_PLANNER.includes(t.status));
            aplicarTasks();
        }, (err) => {
            console.error('Planner: falha ao ler as tarefas:', err);
        });
    });
}

function aplicarTasks() {
    // As fontes podem se sobrepor (um agendamento com protocoloAno, por
    // exemplo); o id manda e o caso entra uma vez só.
    const porId = new Map();
    [...fontesTasks.recentes, ...fontesTasks.semAno, ...fontesTasks.agendamentos]
        .forEach(t => porId.set(t.id, t));
    tasksCache = [...porId.values()];

    // A tarefa em colocação (ou aberta no detalhe) pode ter sumido.
    if (state.colocacao && !tasksCache.some(t => t.id === state.colocacao.id)) state.colocacao = null;
    if (state.detalheId && !tasksCache.some(t => t.id === state.detalheId)) {
        state.detalheId = null;
        if (state.rail === 'detalhe') state.rail = 'pendentes';
    }

    renderAll();
}

/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */

window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    cacheEls();
    initControles();
    renderAll();

    auth.onAuthStateChanged(async (user) => {
        if (!user) return window.location.href = '../pages/auth.html';

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const roleData = userSnap.exists() ? userSnap.data().role : 'student';
        const roles = normalizeRoles(roleData);

        perfil.uid = user.uid;
        perfil.podeTudo = hasFullControl(roleData);
        perfil.ehEstagiario = !perfil.podeTudo && roles.includes('estagiario');

        aplicarPermissoes();
        subscribeToTasks();
    });
});
