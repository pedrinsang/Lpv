import { db, auth } from '../core.js';
import { infoDoNivel } from '../lib/prioridade.js';
import { CHAVES_ETAPA, ETAPAS, FEITO, PENDENTE, estadoDaEtapa } from '../lib/etapas.js';
import { CAMPO_REABERTO, estaReaberto } from '../lib/reabertura.js';
import {
    doc, getDoc, updateDoc, deleteDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

import {
    uploadWordReportFile,
    uploadPdfReportFile,
    downloadStoredReportVersion,
    removeReportFileVersion,
    getReportFilesState,
    hasActiveUploadedWord
} from '../lib/report-files-service.js';
import { camposDerivados, parseProtocolo } from '../lib/protocolo.js';
import { registrarExclusao } from '../lib/livro-indice.js';

const ENABLE_EXTERNAL_STORAGE_INTEGRATION = true;

// O ajuste de celular da ficha mora em assets/css/components/modals.css, junto
// com o resto do modal — injetar CSS daqui deixava a mesma regra em dois lugares.

const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');
const viewDetails = document.getElementById('view-details-content');
const viewRelease = document.getElementById('view-release-form');
const infoGrid = document.getElementById('tm-info-grid');
const formRelease = document.getElementById('form-release');

// Rodapé fixo da ficha: sai de cena junto com ela quando o modal troca para o
// formulário de liberação, que tem rodapé próprio.
const detailsFooter = document.getElementById('tm-details-footer');
const btnDelete = document.getElementById('btn-delete-task');
const btnEditEntry = document.getElementById('btn-edit-entry');

let currentTask = null;
let currentUserData = null;

/** O diagnóstico é texto livre e vai para dentro de HTML — escapa sempre. */
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/** Data (ISO ou Date) -> 'YYYY-MM-DD' no fuso local, que é o formato do input. */
function isoLocal(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

const brData = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');

/**
 * Data que o Livro de Registros mostra na coluna "Laudo".
 *
 * `dataLaudo` é a data informada na liberação (pode ser retroativa, para casos
 * laudados fora do sistema); `releasedAt` é o instante em que o laudo foi
 * liberado aqui. Casos liberados antes do formulário existir só têm o segundo.
 */
function dataDoLaudo(task) {
    return (task && task.dataLaudo) || isoLocal(task && task.releasedAt);
}

/** Sexo é gravado como 'M'/'F' no formulário; a ficha lê por extenso. */
function sexoExtenso(valor) {
    const s = String(valor ?? '').trim().toUpperCase();
    if (s === 'M') return 'Macho';
    if (s === 'F') return 'Fêmea';
    return valor || '';
}

/**
 * Uma célula do bloco de campos.
 *
 * `valor` é escapado; `html` entra cru, para os casos em que a célula já vem
 * montada (contato com link, botão de editar ao lado). Campo vazio vira travessão
 * em vez de sumir: saber que o cadastro não preencheu é informação.
 */
function campo(rotulo, valor, opts = {}) {
    const { span = 0, tom = '', num = false, html = '' } = opts;
    const texto = String(valor ?? '').trim();
    const conteudo = html || (texto ? esc(texto) : '—');
    const classes = ['tm-field-value', tom, num ? 'is-num' : ''].filter(Boolean).join(' ');
    return `
        <div class="tm-field${span ? ` span-${span}` : ''}">
            <div class="tm-field-label">${esc(rotulo)}</div>
            <div class="${classes}">${conteudo}</div>
        </div>`;
}

/** Bloco de campos com o título da seção — os mesmos títulos do formulário. */
function bloco(icone, titulo, campos, extraClasse = '') {
    return `
        <div class="tm-section">
            <div class="tm-section-head"><i class="fas ${icone}"></i> ${esc(titulo)}</div>
            <div class="tm-fields ${extraClasse}">${campos.join('')}</div>
        </div>`;
}

/**
 * CONTATO CLICÁVEL
 *
 * Remetente e proprietário guardam telefone ou e-mail no mesmo campo (ver
 * lib/contato.js). Aqui o conteúdo decide o link: com "@" abre o cliente de
 * e-mail, com dígitos abre o discador. O botão de copiar existe porque no
 * computador nenhum dos dois resolve — o número vai para o WhatsApp e o e-mail
 * para outra janela, e ler da tela para digitar é onde o dígito se perde.
 */
function contatoHTML(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return '';

    const digitos = texto.replace(/\D/g, '');
    const href = texto.includes('@')
        ? `mailto:${texto}`
        : (digitos ? `tel:${texto.trim().startsWith('+') ? '+' : ''}${digitos}` : '');

    const alvo = href ? `<a href="${esc(href)}">${esc(texto)}</a>` : esc(texto);

    return `<div class="tm-contact">${alvo}
        <button type="button" class="tm-copy" data-copiar="${esc(texto)}" title="Copiar contato">
            <i class="fas fa-copy"></i>
        </button>
    </div>`;
}

/**
 * NOME DE QUEM CADASTROU A AMOSTRA
 *
 * O caso guarda `createdBy` como uid — o nome mora na coleção `users`, e lê-lo
 * custa uma leitura a mais por ficha aberta. Por isso o resultado fica em cache
 * pela sessão: a segunda ficha cadastrada pela mesma pessoa não lê de novo, e o
 * uid sem perfil legível também é guardado, para não tentar de novo a cada
 * abertura. Quem não é staff não pode ler o perfil dos outros (ver
 * firestore.rules); nesse caso o rodapé fica só com as datas.
 */
const nomesPorUid = new Map();

async function nomeDeQuemCadastrou(uid) {
    if (!uid || uid === 'anon') return '';
    if (nomesPorUid.has(uid)) return nomesPorUid.get(uid);

    let nome = '';
    try {
        const perfil = await getDoc(doc(db, 'users', uid));
        if (perfil.exists()) nome = perfil.data().name || '';
    } catch (e) {
        console.warn('Não foi possível ler quem cadastrou a amostra.', e);
    }

    nomesPorUid.set(uid, nome);
    return nome;
}

/**
 * AVISOS PARA A TELA QUE ABRIU A FICHA
 *
 * Mural, Hub e Planner escutam o Firestore com `onSnapshot` e se corrigem
 * sozinhos. O Livro de Registros não: ele lê uma vez por ano de protocolo e
 * guarda em cache, de propósito, porque leitura é o recurso que acaba. Sem um
 * aviso, o caso excluído aqui continua na lista de lá até alguém recarregar a
 * página — e recarregar custa justamente a leitura que o cache evitou.
 */
function avisarCasoExcluido(id) {
    document.dispatchEvent(new CustomEvent('lpv:caso-excluido', { detail: { id } }));
}

function avisarCasoAtualizado(task) {
    document.dispatchEvent(new CustomEvent('lpv:caso-atualizado', {
        detail: { id: task.id, task: { ...task } }
    }));
}

/**
 * ARQUIVOS DO LAUDO — CÓDIGO GUARDADO, FORA DE USO
 *
 * A ficha não mostra mais o painel de arquivos, então nada abaixo é chamado:
 * `renderReportFilesPanel` e `bindTaskFileActions` ficam aqui de propósito,
 * prontos para o dia em que o upload/download do Word e do PDF voltar à tela.
 * Enquanto isso, `lib/report-files-service.js` não tem quem o chame.
 */
function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!value || value <= 0) return '-';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function getActiveReportVersion(task, fileType) {
    const state = getReportFilesState(task);
    const list = fileType === 'word' ? state.wordVersions : state.pdfVersions;
    const activeId = fileType === 'word' ? state.activeWordVersionId : state.activePdfVersionId;
    return list.find((item) => item.versionId === activeId) || null;
}

function renderReportFilesPanel(task, permission) {
    const state = getReportFilesState(task);
    const activeWord = getActiveReportVersion(task, 'word');
    const activePdf = getActiveReportVersion(task, 'pdf');
    const canManage = permission.canFillReport || permission.canCorrectReport || permission.canReleaseInitial;
    const canView = permission.canDownloadReport || canManage;
    const hasWordPrimary = hasActiveUploadedWord(task);

    if (!canView) {
        return `
            <div class="tm-section">
                <div class="tm-section-head"><i class="fas fa-folder-open"></i> Arquivos do laudo</div>
                <div class="tm-block">
                    <p class="tm-block-hint">Sem permissão para visualizar arquivos deste laudo.</p>
                </div>
            </div>`;
    }

    const versoesHtml = (fileType, versoes, activeId, nomePadrao) => versoes
        .slice()
        .reverse()
        .slice(0, 5)
        .map((version) => {
            const date = version.uploadedAt ? new Date(version.uploadedAt).toLocaleString('pt-BR') : '-';
            const activeTag = activeId === version.versionId
                ? '<span class="tm-tag-active">ativo</span>'
                : '';
            return `<div class="tm-file-row">
                <div style="min-width:0;">
                    <div class="tm-file-name">${esc(version.fileName || nomePadrao)}</div>
                    <div class="tm-file-meta">${esc(date)} • ${formatFileSize(version.size)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    ${activeTag}
                    <button type="button" class="tm-file-download" data-report-download="${fileType}:${esc(version.versionId)}" title="Baixar versão"><i class="fas fa-download"></i></button>
                </div>
            </div>`;
        })
        .join('');

    const wordVersionsHtml = versoesHtml('word', state.wordVersions, state.activeWordVersionId, 'arquivo.docx');
    const pdfVersionsHtml = versoesHtml('pdf', state.pdfVersions, state.activePdfVersionId, 'arquivo.pdf');

    const fonte = hasWordPrimary
        ? 'Word enviado'
        : (state.activeSource === 'uploaded_pdf' ? 'PDF enviado' : 'Nenhum arquivo enviado');

    return `
        <div class="tm-section">
            <div class="tm-section-head"><i class="fas fa-folder-open"></i> Arquivos do laudo</div>
            <div class="tm-block is-files">
                <div class="tm-block-row">
                    <div>
                        <div class="tm-field-label">Fonte oficial</div>
                        <div class="tm-field-value">${fonte}</div>
                    </div>
                </div>

                <div class="tm-block-actions">
                    ${canManage ? '<button id="tm-btn-upload-word" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-upload"></i> Upload Word</button>' : ''}
                    ${canManage ? '<button id="tm-btn-upload-pdf" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-upload"></i> Upload PDF</button>' : ''}
                    ${activeWord ? '<button id="tm-btn-download-word-active" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-download"></i> Baixar Word ativo</button>' : ''}
                    ${activePdf ? '<button id="tm-btn-download-pdf-active" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-download"></i> Baixar PDF ativo</button>' : ''}
                    ${canManage && activeWord ? '<button id="tm-btn-remove-word-active" class="btn btn-secondary btn-sm" type="button" style="border-color:#dc2626; color:#f87171;"><i class="fas fa-trash"></i> Retirar Word ativo</button>' : ''}
                    ${canManage && activePdf ? '<button id="tm-btn-remove-pdf-active" class="btn btn-secondary btn-sm" type="button" style="border-color:#dc2626; color:#f87171;"><i class="fas fa-trash"></i> Retirar PDF ativo</button>' : ''}
                </div>

                <input id="tm-input-upload-word" type="file" accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden">
                <input id="tm-input-upload-pdf" type="file" accept=".pdf,application/pdf" class="hidden">

                <div class="tm-file-history">
                    <div class="tm-file-col">
                        <div class="tm-file-col-title">Histórico Word</div>
                        ${wordVersionsHtml || '<p class="tm-block-hint">Sem versões de Word.</p>'}
                    </div>
                    <div class="tm-file-col">
                        <div class="tm-file-col-title">Histórico PDF</div>
                        ${pdfVersionsHtml || '<p class="tm-block-hint">Sem versões de PDF.</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function normalizeName(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function getPermissionContext(task = currentTask) {
    const user = currentUserData || {};
    const roles = user._roles || [];
    const normalizedTaskPos = normalizeName(task?.posGraduando);
    const taskPosUid = (task?.posResponsavelUid || '').toString().trim();
    const currentUid = (auth.currentUser?.uid || '').toString().trim();
    const normalizedUserName = normalizeName(user?.name || auth.currentUser?.displayName || '');

    const isAdmin = roles.includes('admin');
    const isProfessor = roles.includes('professor');
    const isPostGrad = roles.some(r => r.includes('graduando'));
    const isStaff = isAdmin || isProfessor || isPostGrad;
    const isPosResponsavelByUid = isPostGrad && !!taskPosUid && !!currentUid && taskPosUid === currentUid;
    const isPosResponsavelByLegacyName = isPostGrad && !taskPosUid && !!normalizedTaskPos && normalizedTaskPos === normalizedUserName;
    const isPosResponsavel = isPosResponsavelByUid || isPosResponsavelByLegacyName;

    return {
        isAdmin,
        isProfessor,
        isPostGrad,
        isStaff,
        isPosResponsavel,
        usesLegacyPosMatch: !taskPosUid,
        canFillReport: isAdmin || isProfessor || isPosResponsavel,
        canDownloadReport: isAdmin || isProfessor || isPosResponsavel,
        canCorrectReport: isAdmin || isProfessor,
        // Liberar o laudo e excluir o caso valem para professor, admin e pós —
        // em qualquer tela onde a ficha abra (Mural, Hub, Livro de Registros).
        // Não depende de o pós ser o responsável pelo caso.
        canReleaseInitial: isAdmin || isProfessor || isPostGrad,
        canDelete: isAdmin || isProfessor || isPostGrad
    };
}

async function fetchCurrentUserData() {
    if (currentUserData) return currentUserData;
    if (!auth.currentUser) return null;
    try {
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            // Normaliza role para array lowercase
            if (currentUserData.role) {
                const r = currentUserData.role;
                currentUserData._roles = Array.isArray(r) ? r.map(x => x.toLowerCase()) : [r.toLowerCase()];
            } else {
                currentUserData._roles = [];
            }
        }
    } catch(e) { console.error("Erro user data:", e); }
    return currentUserData;
}

/** O modal tem três telas mutuamente exclusivas: ficha, cassetes e liberação. */
function mostrarView(nome) {
    if (viewDetails) viewDetails.classList.toggle('hidden', nome !== 'details');
    if (detailsFooter) detailsFooter.classList.toggle('hidden', nome !== 'details');
    if (viewRelease) viewRelease.classList.toggle('hidden', nome !== 'release');
}

async function openTaskManager(taskId) {
    try {
        await fetchCurrentUserData();
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        renderDetails(currentTask);

        mostrarView('details');
        if(modal) modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

    } catch (e) { console.error(e); alert("Erro ao abrir: " + e.message); }
}

async function refreshCurrentTask() {
    if (!currentTask?.id) return;
    const refreshed = await getDoc(doc(db, "tasks", currentTask.id));
    if (!refreshed.exists()) return;
    currentTask = { id: refreshed.id, ...refreshed.data() };
    renderDetails(currentTask);
}

function closeTaskModal() {
    if(modal) modal.classList.add('hidden');
    mostrarView('details');   // a próxima abertura começa sempre pela ficha
    document.body.style.overflow = '';
}

if(closeBtn) closeBtn.addEventListener('click', closeTaskModal);

if (modal) {
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeTaskModal();
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeTaskModal();
    }
});

/**
 * ETAPAS DO LAUDO — a barra do alto da ficha.
 *
 * É daqui que o caso entra e sai das filas do Hub. Ela ficava seis blocos
 * abaixo, atrás de remetente, animal, proprietário e financeiro: a ação mais
 * frequente da ficha exigia rolar até achar. Agora abre logo sob a faixa de
 * identidade, à vista desde o primeiro instante.
 *
 * Os três estados de cada fila viram três botões, e não uma lista de ações que
 * troca de nome conforme o estado ("Colocar em análise", depois "Analisado",
 * depois "Reabrir"): o botão aceso diz onde o caso está, e qualquer um dos
 * outros dois está a um clique — sem ninguém precisar decorar o caminho de
 * volta. Os rótulos são os mesmos das etiquetas do Hub e do Mural, porque são
 * a mesma informação.
 *
 * As duas etapas são independentes de propósito: uma amostra pode estar
 * esperando só a análise das lâminas, só a correção do texto, as duas ou
 * nenhuma — e quem decide isso é quem está com o caso na mão, não uma máquina
 * de estados que anda sozinha.
 *
 * "Fora da fila" apaga o campo em vez de gravar um estado a mais: sair da fila
 * e ter concluído a etapa são coisas diferentes, e o documento precisa dizer
 * qual das duas aconteceu.
 */
function renderEtapasBarra(task, permission) {
    const podeMarcar = permission.isStaff;

    const filas = CHAVES_ETAPA.map((chave) => {
        const etapa = ETAPAS[chave];
        const estado = estadoDaEtapa(task, chave);

        const opcoes = [
            { estado: null, rotulo: 'Fora da fila', tom: 'is-fora' },
            { estado: PENDENTE, rotulo: etapa.rotulo, tom: `is-fila ${etapa.classe}` },
            { estado: FEITO, rotulo: etapa.rotuloFeito, tom: 'is-feito' }
        ].map((opcao) => {
            const alvo = opcao.estado === null ? 'null' : `'${opcao.estado}'`;
            const aceso = opcao.estado === estado;
            return `<button type="button" class="tm-etapa-op ${opcao.tom}${aceso ? ' is-active' : ''}"
                aria-pressed="${aceso}"
                ${podeMarcar ? `onclick="window.marcarEtapa('${chave}', ${alvo})"` : 'disabled'}
                >${opcao.rotulo}</button>`;
        }).join('');

        return `
            <div class="tm-etapa">
                <span class="tm-etapa-nome"><i class="fas ${etapa.icone}"></i> ${esc(etapa.titulo)}</span>
                <div class="tm-etapa-ops" role="group" aria-label="Etapa de ${esc(etapa.titulo.toLowerCase())}">${opcoes}</div>
            </div>`;
    }).join('');

    return `
        <div class="tm-etapas-bar">
            <div class="tm-etapas">${filas}</div>
            <p class="tm-block-hint">
                ${podeMarcar
                    ? 'As duas filas do Hub são independentes: o caso pode esperar só a análise, só a correção, as duas ao mesmo tempo ou nenhuma delas.'
                    : 'Só professor, pós ou admin podem mexer nas etapas.'}
            </p>
        </div>`;
}

/**
 * Grava o marcador de uma etapa. `estado` null apaga o campo — é o "tirar da
 * fila", que não é a mesma coisa que concluir.
 */
async function marcarEtapa(chave, estado) {
    if (!currentTask || !ETAPAS[chave]) return;

    if (!getPermissionContext(currentTask).isStaff) {
        alert('Apenas professor, pós-graduando ou admin podem mexer nas etapas.');
        return;
    }

    // Clicar no botão que já está aceso não é um pedido de mudança: sem isto,
    // cada clique de confirmação viraria uma gravação e um redesenho da ficha.
    if (estadoDaEtapa(currentTask, chave) === estado) return;

    const campo = ETAPAS[chave].campo;
    try {
        await updateDoc(doc(db, "tasks", currentTask.id), {
            [campo]: estado === null ? deleteField() : estado
        });

        if (estado === null) delete currentTask[campo];
        else currentTask[campo] = estado;

        renderDetails(currentTask);
    } catch (erro) {
        console.error(erro);
        alert('Não foi possível atualizar a etapa.');
    }
}

/**
 * FICHA COMPLETA DA AMOSTRA
 *
 * A ficha mostra tudo o que a entrada cadastrou, nos mesmos blocos e com os
 * mesmos rótulos do formulário — antes ela exibia oito campos dos vinte e três,
 * e CRMV, contatos, endereços, clínica, origem, RG, raça e prioridade só
 * apareciam reabrindo o formulário de edição, que é a tela de escrever.
 *
 * Campo vazio vira travessão em vez de sumir: quem confere um cadastro precisa
 * distinguir "não preencheram" de "não existe aqui".
 */
function renderDetails(task) {
    const permission = getPermissionContext(task);
    const { isStaff, canReleaseInitial } = permission;

    const typeClass = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    const typeIcon = task.type === 'necropsia' ? 'fa-skull' : 'fa-microscope';
    const typeLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';
    const prefixo = task.type === 'necropsia' ? 'VN' : 'V';

    // O laudo liberado é o que marca o caso como fechado — não existe mais etapa.
    const laudoLiberado = !!task.releasedAt;
    // ...a não ser que alguém tenha trazido o caso de volta do livro. Aí ele
    // volta a ter etapas e a aparecer no Mural e no Hub, sem que o registro do
    // laudo se desfaça (ver lib/reabertura.js).
    const reaberto = estaReaberto(task);
    const dataLaudo = laudoLiberado ? brData(dataDoLaudo(task)) : '';
    const protocolo = task.protocolo || '—';
    const nome = task.animalNome || 'Sem nome';
    const nivel = infoDoNivel(task);

    // --- CABEÇALHO FIXO ---
    // O protocolo sai da vista assim que o miolo rola; a barra o mantém à mão,
    // que é o número pelo qual o caso é chamado no laboratório.
    const tituloEl = document.getElementById('tm-modal-title');
    if (tituloEl) tituloEl.textContent = `${protocolo} · ${nome}`;

    // --- FAIXA DE IDENTIDADE ---
    const especieLinha = [task.especie, task.raca, sexoExtenso(task.sexo), task.idade]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' · ');

    const heroHtml = `
        <div class="tm-hero ${typeClass}">
            <div class="tm-hero-main">
                <div class="tm-hero-badges">
                    <span class="tm-badge"><i class="fas ${typeIcon}"></i> ${typeLabel}</span>
                    ${nivel ? `<span class="tm-badge ${nivel.classe}"><i class="fas ${nivel.icone}"></i> ${nivel.rotulo}</span>` : ''}
                    ${task.origem ? `<span class="tm-badge"><i class="fas fa-hospital"></i> ${esc(task.origem)}</span>` : ''}
                </div>
                <h2>${esc(nome)}</h2>
                <p><i class="fas fa-paw"></i> ${esc(especieLinha || 'Sem dados do animal')}</p>
            </div>
            <div class="tm-hero-side">
                <div class="tm-hero-side-label">Protocolo</div>
                <div class="tm-hero-protocolo">${esc(protocolo)}</div>
                <div class="tm-hero-laudo ${laudoLiberado ? '' : 'is-pending'}">
                    <i class="fas ${laudoLiberado ? 'fa-check-double' : 'fa-hourglass-half'}"></i>
                    ${laudoLiberado ? `Laudo em ${dataLaudo}` : 'Laudo pendente'}
                </div>
                ${reaberto ? '<div class="tm-hero-reaberta"><i class="fas fa-rotate-left"></i> De volta no mural</div>' : ''}
            </div>
        </div>`;

    // --- IDENTIFICAÇÃO DA AMOSTRA ---
    const serie = parseProtocolo(task.protocolo);
    const anoSerie = serie ? serie.ano : (task.protocoloAno || 0);

    const identificacaoHtml = bloco('fa-vial', 'Identificação da amostra', [
        campo('Nº protocolo interno', protocolo, { num: true }),
        campo('Tipo do caso', null, {
            html: `${typeLabel} <span class="tm-field-note">(prefixo ${prefixo})</span>`
        }),
        campo('Data de entrada', brData(task.dataEntrada), { num: true }),
        campo('Prioridade', nivel ? nivel.rotulo : 'Comum', {
            tom: nivel ? (nivel.chave === 'urgente' ? 'is-alert' : 'is-warn') : '',
            html: nivel
                ? `<i class="fas ${nivel.icone}" style="font-size:0.8rem;"></i> ${nivel.rotulo}`
                : ''
        }),
        campo('Ano da série', anoSerie || 'Sem ano', { num: !!anoSerie })
    ]);

    // --- REMETENTE ---
    const remetenteHtml = bloco('fa-truck-medical', 'Remetente', [
        campo('Remetente', task.remetente),
        campo('CRMV do remetente', task.remetenteCrmv, { num: true }),
        campo('Contato do remetente', task.remetenteContato, {
            html: contatoHTML(task.remetenteContato)
        }),
        campo('Clínica / empresa', task.remetenteClinicaEmpresa),
        campo('Origem', task.origem),
        campo('Endereço do remetente', task.remetenteEndereco, { span: 3 })
    ]);

    // --- DADOS DO ANIMAL ---
    const animalHtml = bloco('fa-paw', 'Dados do animal', [
        campo('Nome do animal', task.animalNome),
        campo('RG do animal', task.animalRg, { num: true }),
        campo('Espécie', task.especie),
        campo('Raça', task.raca),
        campo('Sexo', sexoExtenso(task.sexo)),
        campo('Idade', task.idade)
    ]);

    // --- PROPRIETÁRIO ---
    const proprietarioHtml = bloco('fa-user-tag', 'Dados do proprietário', [
        campo('Proprietário', task.proprietario),
        campo('Contato do proprietário', task.proprietarioContato, {
            span: 2,
            html: contatoHTML(task.proprietarioContato)
        }),
        campo('Endereço do proprietário', task.proprietarioEndereco, { span: 3 })
    ]);

    // --- FINANCEIRO E RESPONSÁVEIS ---
    // Pendente bloqueia a liberação do laudo, então a situação é a primeira
    // coisa da linha e a única colorida.
    const finStatus = task.financialStatus || task.situacao || 'pendente';
    const situacao = {
        didatico: { rotulo: 'Isento — interesse didático', icone: 'fa-graduation-cap', tom: '', acao: '' },
        pago: { rotulo: 'Pago', icone: 'fa-check-circle', tom: 'is-ok', acao: 'REVERTER' },
        pendente: { rotulo: 'Pendente', icone: 'fa-exclamation-triangle', tom: 'is-warn', acao: 'PAGAR' }
    }[finStatus] || { rotulo: 'Pendente', icone: 'fa-exclamation-triangle', tom: 'is-warn', acao: 'PAGAR' };

    const botaoFinanceiro = isStaff && situacao.acao
        ? `<button type="button" class="btn btn-secondary btn-sm" onclick="window.toggleFinancialStatus()" style="padding:2px 10px; font-size:0.65rem; font-weight:700;">${situacao.acao}</button>`
        : '';

    const financeiroHtml = bloco('fa-user-md', 'Financeiro e responsáveis', [
        campo('Situação financeira', situacao.rotulo, {
            tom: situacao.tom,
            html: `<span class="tm-field-inline"><i class="fas ${situacao.icone}" style="font-size:0.8rem;"></i> ${situacao.rotulo} ${botaoFinanceiro}</span>`
        }),
        campo('Valor', task.valor && task.valor !== '0,00' ? `R$ ${task.valor}` : '—', { num: true }),
        campo('Docente responsável', task.docente),
        campo('Pós-graduando', task.posGraduando)
    ], 'cols-4');

    // --- REGISTRO NO LIVRO ---
    // O caso entra no Livro de Registros no cadastro da entrada, então este bloco
    // aparece sempre. Data do laudo e diagnóstico são as duas únicas colunas do
    // livro que a entrada não tem como preencher: chegam na liberação.
    const livroHtml = laudoLiberado
        ? `
        <div class="tm-section">
            <div class="tm-section-head"><i class="fas fa-book"></i> Registro no livro</div>
            <div class="tm-block is-done">
                <div class="tm-block-row">
                    <div>
                        <div class="tm-field-label">Data do laudo</div>
                        <div class="tm-field-value is-num">${dataLaudo || '—'}</div>
                    </div>
                    <div>
                        <div class="tm-field-label">Situação</div>
                        <div class="tm-field-value is-ok"><i class="fas fa-check-double" style="font-size:0.8rem;"></i> Laudo liberado</div>
                    </div>
                </div>
                <div>
                    <div class="tm-field-label">Diagnóstico</div>
                    ${task.diagnostico
                        ? `<p class="tm-block-text">${esc(task.diagnostico)}</p>`
                        : '<p class="tm-block-hint" style="font-style:italic;">Sem diagnóstico registrado.</p>'}
                </div>
                ${reaberto ? `
                    <p class="tm-block-hint">
                        <i class="fas fa-rotate-left"></i>
                        Este caso está de volta no Mural e no Hub para consulta. O registro acima
                        continua valendo — a reabertura não desfaz o laudo.
                    </p>` : ''}
                ${canReleaseInitial ? `
                    <div class="tm-block-actions">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.openReleaseForm()">
                            <i class="fas fa-pen"></i> Corrigir registro
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.alternarReabertura()">
                            <i class="fas ${reaberto ? 'fa-book' : 'fa-rotate-left'}"></i>
                            ${reaberto ? 'Devolver ao livro' : 'Voltar ao mural'}
                        </button>
                    </div>` : ''}
            </div>
        </div>`
        : `
        <div class="tm-section">
            <div class="tm-section-head"><i class="fas fa-book"></i> Registro no livro</div>
            <div class="tm-block is-open">
                <p class="tm-block-hint">
                    O caso já consta no livro com o protocolo <strong>${esc(protocolo)}</strong>,
                    desde a entrada em ${brData(task.dataEntrada)}.
                </p>
                <p class="tm-block-hint" style="font-style:italic;">
                    Faltam a data do laudo e o diagnóstico — é o que a liberação acrescenta.
                </p>
            </div>
        </div>`;

    // --- AÇÕES ---
    let actionsHtml = '';
    if (!laudoLiberado) {
        actionsHtml = canReleaseInitial
            ? '<button type="button" onclick="window.openReleaseForm()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>'
            : '<span class="tm-block-hint">Liberação: professor, pós ou admin</span>';
    }

    // --- RODAPÉ DE PROCEDÊNCIA ---
    // O nome de quem cadastrou entra depois, quando a leitura do perfil voltar:
    // a ficha não segura a abertura por causa dele.
    const cadastro = task.createdAt ? brData(isoLocal(task.createdAt)) : brData(task.dataEntrada);
    const ultimaEdicao = task.lastEditedAt ? brData(isoLocal(task.lastEditedAt)) : '';

    // O botão de excluir e o de editar moram no rodapé fixo do modal, fora deste
    // HTML — o de excluir some para quem não pode apagar o caso.
    if (btnDelete) btnDelete.classList.toggle('hidden', !permission.canDelete);

    infoGrid.innerHTML = `
        ${heroHtml}
        ${laudoLiberado && !reaberto ? '' : renderEtapasBarra(task, permission)}
        ${identificacaoHtml}
        ${remetenteHtml}
        ${animalHtml}
        ${proprietarioHtml}
        ${financeiroHtml}
        ${livroHtml}
        ${actionsHtml ? `<div class="tm-actions-footer">${actionsHtml}</div>` : ''}
        <div class="tm-meta">
            <span>Cadastrada<span data-autor></span> em ${cadastro}${ultimaEdicao ? ` · última edição ${ultimaEdicao}` : ''}</span>
        </div>
    `;

    const alvoAutor = infoGrid.querySelector('[data-autor]');
    if (alvoAutor && task.createdBy) {
        nomeDeQuemCadastrou(task.createdBy).then((nome) => {
            // A ficha pode ter trocado de caso enquanto a leitura voltava.
            if (nome && alvoAutor.isConnected) alvoAutor.textContent = ` por ${nome}`;
        });
    }
}

/**
 * Copiar contato: o clique confirma na própria pílula (o ícone vira um "certo"
 * por um segundo), porque um alert para copiar um telefone interrompe mais do
 * que informa.
 */
if (infoGrid) {
    infoGrid.addEventListener('click', async (event) => {
        const botao = event.target.closest('.tm-copy[data-copiar]');
        if (!botao) return;

        const texto = botao.getAttribute('data-copiar') || '';
        if (!texto) return;

        try {
            await navigator.clipboard.writeText(texto);
            botao.classList.add('is-done');
            botao.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => {
                botao.classList.remove('is-done');
                botao.innerHTML = '<i class="fas fa-copy"></i>';
            }, 1200);
        } catch (e) {
            // Sem permissão de área de transferência (ou fora de HTTPS): o link
            // continua clicável, que é o caminho principal do campo.
            console.warn('Não foi possível copiar o contato.', e);
        }
    });
}


function bindTaskFileActions(task, permission) {
    if (!ENABLE_EXTERNAL_STORAGE_INTEGRATION) return;

    const inputWord = document.getElementById('tm-input-upload-word');
    const btnUploadWord = document.getElementById('tm-btn-upload-word');
    if (btnUploadWord && inputWord && !btnUploadWord.dataset.bound) {
        btnUploadWord.dataset.bound = '1';
        btnUploadWord.addEventListener('click', () => inputWord.click());

        inputWord.addEventListener('change', async () => {
            const file = inputWord.files && inputWord.files[0] ? inputWord.files[0] : null;
            if (!file) return;

            try {
                await uploadWordReportFile(task.id, file, {
                    source: 'manual_upload',
                    markAsPrimary: true
                });
                alert('Word enviado com sucesso.');
                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao enviar Word: ${error.message}`);
            } finally {
                inputWord.value = '';
            }
        });
    }

    const inputPdf = document.getElementById('tm-input-upload-pdf');
    const btnUploadPdf = document.getElementById('tm-btn-upload-pdf');
    if (btnUploadPdf && inputPdf && !btnUploadPdf.dataset.bound) {
        btnUploadPdf.dataset.bound = '1';
        btnUploadPdf.addEventListener('click', () => inputPdf.click());

        inputPdf.addEventListener('change', async () => {
            const file = inputPdf.files && inputPdf.files[0] ? inputPdf.files[0] : null;
            if (!file) return;

            try {
                await uploadPdfReportFile(task.id, file, {
                    source: 'manual_upload',
                    markAsPrimary: true
                });
                alert('PDF enviado com sucesso.');
                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao enviar PDF: ${error.message}`);
            } finally {
                inputPdf.value = '';
            }
        });
    }

    const btnDownloadWord = document.getElementById('tm-btn-download-word-active');
    if (btnDownloadWord && !btnDownloadWord.dataset.bound) {
        btnDownloadWord.dataset.bound = '1';
        btnDownloadWord.addEventListener('click', async () => {
            try {
                await downloadStoredReportVersion({ taskId: task.id, fileType: 'word' });
            } catch (error) {
                console.error(error);
                alert(`Erro ao baixar Word: ${error.message}`);
            }
        });
    }

    const btnDownloadPdf = document.getElementById('tm-btn-download-pdf-active');
    if (btnDownloadPdf && !btnDownloadPdf.dataset.bound) {
        btnDownloadPdf.dataset.bound = '1';
        btnDownloadPdf.addEventListener('click', async () => {
            try {
                await downloadStoredReportVersion({ taskId: task.id, fileType: 'pdf' });
            } catch (error) {
                console.error(error);
                alert(`Erro ao baixar PDF ativo: ${error.message}`);
            }
        });
    }

    const btnRemoveWord = document.getElementById('tm-btn-remove-word-active');
    if (btnRemoveWord && !btnRemoveWord.dataset.bound) {
        btnRemoveWord.dataset.bound = '1';
        btnRemoveWord.addEventListener('click', async () => {
            if (!confirm('Retirar o Word ativo desta amostra?')) return;

            const original = btnRemoveWord.innerHTML;
            btnRemoveWord.disabled = true;
            btnRemoveWord.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removendo...';

            try {
                const result = await removeReportFileVersion({
                    taskId: task.id,
                    fileType: 'word'
                });

                if (result?.warning) {
                    alert(result.warning);
                }

                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao retirar Word ativo: ${error.message}`);
            } finally {
                btnRemoveWord.disabled = false;
                btnRemoveWord.innerHTML = original;
            }
        });
    }

    const btnRemovePdf = document.getElementById('tm-btn-remove-pdf-active');
    if (btnRemovePdf && !btnRemovePdf.dataset.bound) {
        btnRemovePdf.dataset.bound = '1';
        btnRemovePdf.addEventListener('click', async () => {
            if (!confirm('Retirar o PDF ativo desta amostra?')) return;

            const original = btnRemovePdf.innerHTML;
            btnRemovePdf.disabled = true;
            btnRemovePdf.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removendo...';

            try {
                const result = await removeReportFileVersion({
                    taskId: task.id,
                    fileType: 'pdf'
                });

                if (result?.warning) {
                    alert(result.warning);
                }

                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao retirar PDF ativo: ${error.message}`);
            } finally {
                btnRemovePdf.disabled = false;
                btnRemovePdf.innerHTML = original;
            }
        });
    }

    document.querySelectorAll('[data-report-download]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';

        button.addEventListener('click', async () => {
            const raw = button.getAttribute('data-report-download') || '';
            const [fileType, versionId] = raw.split(':');
            if (!fileType || !versionId) return;

            try {
                await downloadStoredReportVersion({
                    taskId: task.id,
                    fileType,
                    versionId
                });
            } catch (error) {
                console.error(error);
                alert(`Erro ao baixar versao: ${error.message}`);
            }
        });
    });

}

async function toggleFinancialStatus() {
    if(!currentTask) return;
    const currentStatus = currentTask.financialStatus || 'pendente';
    if(currentStatus === 'didatico') return; 
    
    const newStatus = currentStatus === 'pago' ? 'pendente' : 'pago'; 

    if(!confirm(`Mudar status financeiro para ${newStatus.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), { financialStatus: newStatus });
        currentTask.financialStatus = newStatus;
        renderDetails(currentTask); 
    } catch(e) { console.error(e); alert("Erro ao atualizar financeiro."); }
}


/**
 * VOLTAR AO MURAL / DEVOLVER AO LIVRO
 *
 * O caminho de volta de um caso já laudado. Reabrir não mexe em `releasedAt`,
 * `dataLaudo` nem no diagnóstico: a linha do livro continua exatamente como
 * está, e o que muda é só onde o caso aparece. É o que permite ao pós rever as
 * lâminas de um caso do ano passado, ou ao professor separar casos antigos para
 * uma aula, usando as mesmas etapas de sempre.
 *
 * Devolver ao livro apaga o campo — nada mais se desfaz, e o caso pode ir e
 * voltar quantas vezes for preciso.
 */
async function alternarReabertura() {
    if (!currentTask) return;

    if (!getPermissionContext(currentTask).canReleaseInitial) {
        alert('Apenas professor, pós-graduando ou admin podem reabrir um caso.');
        return;
    }

    const voltando = !estaReaberto(currentTask);
    const nome = [currentTask.protocolo, currentTask.animalNome].filter(Boolean).join(' — ') || 'este caso';

    const aviso = voltando
        ? `Trazer ${nome} de volta para o Mural e o Hub?\n\nO laudo continua liberado e o registro `
            + 'do livro não muda — o caso só volta a aparecer nas filas, marcado como reaberto.'
        : `Devolver ${nome} ao livro?\n\nEle sai do Mural e do Hub. As etapas marcadas continuam `
            + 'gravadas, caso ele seja reaberto de novo.';
    if (!confirm(aviso)) return;

    const dados = voltando
        ? {
            [CAMPO_REABERTO]: true,
            reabertoEm: new Date().toISOString(),
            reabertoPor: auth.currentUser.uid
        }
        : {
            [CAMPO_REABERTO]: deleteField(),
            reabertoEm: deleteField(),
            reabertoPor: deleteField()
        };

    try {
        await updateDoc(doc(db, "tasks", currentTask.id), dados);

        // `deleteField()` é uma ordem para o Firestore, não um valor: gravá-la no
        // objeto local deixaria `reaberto` "verdadeiro" na tela até a próxima
        // leitura. Os campos apagados saem do espelho local na mão.
        if (voltando) Object.assign(currentTask, dados);
        else Object.keys(dados).forEach((campo) => delete currentTask[campo]);

        // Mural e Hub se corrigem sozinhos (onSnapshot); o Livro de Registros lê
        // por ano e guarda em cache, então precisa do aviso.
        avisarCasoAtualizado(currentTask);
        renderDetails(currentTask);
    } catch (e) {
        console.error(e);
        alert('Não foi possível mudar a situação do caso: ' + e.message);
    }
}

/**
 * FORMULÁRIO DE LIBERAÇÃO
 *
 * A linha do Livro de Registros já existe desde o cadastro da entrada, com tudo
 * o que se sabe do caso (protocolo, animal, remetente, docente, pós, origem,
 * situação, valor). O que falta nela são as duas colunas que só o laudo produz:
 * a data do laudo e o diagnóstico. É isso — e só isso — que a liberação
 * acrescenta; ela não cria registro nenhum.
 *
 * O mesmo formulário serve para corrigir o registro de um laudo já liberado —
 * aí ele não mexe em `releasedAt`.
 */
function openReleaseForm() {
    if (!currentTask || !formRelease) return;

    const permission = getPermissionContext(currentTask);
    if (!permission.canReleaseInitial) {
        alert('Apenas professor, pós-graduando ou admin podem liberar o laudo.');
        return;
    }

    const jaLiberado = !!currentTask.releasedAt;
    const finStatus = currentTask.financialStatus || 'pendente';
    const financeiroPendente = !jaLiberado && finStatus !== 'pago' && finStatus !== 'didatico';

    const hoje = isoLocal(new Date());
    const dataAtual = dataDoLaudo(currentTask) || hoje;
    // O ano do livro sai do protocolo. Se ele não for legível, o caso é liberado
    // mas cai no balde "Sem ano" — a liberação é a última hora de avisar.
    const protocoloIlegivel = !parseProtocolo(currentTask.protocolo);

    formRelease.innerHTML = `
        <h3 style="margin:0 0 4px; font-size:1.15rem;">
            <i class="fas fa-book"></i> ${jaLiberado ? 'Corrigir registro do livro' : 'Liberar laudo'}
        </h3>
        <p style="margin:0 0 18px; font-size:0.82rem; color:var(--text-tertiary);">
            ${esc(currentTask.protocolo || 'Sem protocolo')} &bull; ${esc(currentTask.animalNome || 'Sem nome')}
            &bull; entrada ${brData(currentTask.dataEntrada)}
        </p>

        ${protocoloIlegivel ? `
            <div style="background:#fef2f2; border:1px solid #fca5a5; color:#7f1d1d; padding:10px 12px; border-radius:8px; margin-bottom:16px; font-size:0.82rem;">
                <i class="fas fa-triangle-exclamation"></i>
                <strong>Protocolo sem ano de série.</strong> O livro organiza os casos pelo ano do protocolo
                (V001-26, Vn007-2026). Como “${esc(currentTask.protocolo || '')}” não tem ano legível,
                o caso está aparecendo em <em>Sem ano</em>. Corrija em “Editar Dados”.
            </div>` : ''}

        ${financeiroPendente ? `
            <div style="background:#fffbeb; border:1px solid #fcd34d; color:#78350f; padding:10px 12px; border-radius:8px; margin-bottom:16px; font-size:0.82rem;">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Financeiro pendente.</strong> O laudo pode ser liberado assim mesmo, mas o caso continua no livro como “Pendente”.
            </div>` : ''}

        <div class="form-group">
            <label for="release-data" style="font-weight:700; margin-bottom:8px; display:block;">
                Data do laudo <span style="color:var(--color-error);">*</span>
            </label>
            <input type="date" id="release-data" class="input-field" required
                   value="${esc(dataAtual)}" max="${esc(hoje)}" style="max-width:220px;">
            <div style="font-size:0.75rem; color:var(--text-tertiary); margin-top:6px;">
                Preenche a coluna “Laudo” da linha que o caso já tem no Livro de Registros. Pode ser retroativa.
            </div>
        </div>

        <div class="form-group">
            <label for="release-diagnostico" style="font-weight:700; margin-bottom:8px; display:block;">
                Diagnóstico <span style="color:var(--color-error);">*</span>
            </label>
            <textarea id="release-diagnostico" class="input-field" rows="5" required
                      placeholder="Diagnóstico como deve constar no livro."
                      style="resize:vertical; line-height:1.45;">${esc(currentTask.diagnostico || '')}</textarea>
        </div>

        <div class="modal-footer">
            <button type="button" id="btn-cancel-release" class="btn btn-secondary">Voltar</button>
            <button type="submit" class="btn btn-primary">
                <i class="fas ${jaLiberado ? 'fa-save' : 'fa-check-double'}"></i>
                ${jaLiberado ? 'Salvar correção' : 'Liberar laudo'}
            </button>
        </div>
    `;

    document.getElementById('btn-cancel-release')
        .addEventListener('click', () => mostrarView('details'));

    formRelease.onsubmit = (e) => salvarLiberacao(e, jaLiberado);

    mostrarView('release');
    document.getElementById('release-diagnostico').focus();
}

async function salvarLiberacao(event, jaLiberado) {
    event.preventDefault();
    if (!currentTask) return;

    const dataLaudo = document.getElementById('release-data').value;
    const diagnostico = document.getElementById('release-diagnostico').value.trim();

    if (!dataLaudo) return alert('Informe a data do laudo.');
    if (!diagnostico) return alert('Informe o diagnóstico — é uma das colunas do livro.');

    const hoje = isoLocal(new Date());
    if (dataLaudo > hoje) return alert('A data do laudo não pode estar no futuro.');
    if (currentTask.dataEntrada && dataLaudo < currentTask.dataEntrada) {
        const entrada = brData(currentTask.dataEntrada);
        if (!confirm(`A data do laudo é anterior à entrada da amostra (${entrada}).\nDeseja gravar assim mesmo?`)) return;
    }

    if (!jaLiberado && !confirm('Liberar este laudo?\nO caso sai do Mural; no Livro de Registros, a linha dele recebe a data do laudo e o diagnóstico.')) return;

    const btn = formRelease.querySelector('button[type="submit"]');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gravando...';

    try {
        // Casos antigos podem não ter os campos derivados do protocolo; o
        // Histórico filtra por eles, então garante que existam na liberação.
        const derivados = camposDerivados(currentTask.protocolo);
        const agora = new Date().toISOString();

        const dados = jaLiberado
            ? {
                dataLaudo,
                diagnostico,
                livroEditadoEm: agora,
                livroEditadoPor: auth.currentUser.uid,
                ...derivados
            }
            : {
                dataLaudo,
                diagnostico,
                releasedBy: auth.currentUser.uid,
                releasedAt: agora,
                // O caso sai do fluxo e vira histórico: é o que tira ele do Mural
                // e do Planner, e o que impede o acervo de voltar a ser lido por
                // eles.
                status: 'concluido',
                ...derivados
            };

        await updateDoc(doc(db, "tasks", currentTask.id), dados);

        // O índice do livro não é tocado aqui: ele conta casos, e este já foi
        // somado no cadastro da entrada. Liberar não cria linha, completa a que
        // existe.

        Object.assign(currentTask, dados);
        // Mural e Planner tiram o caso sozinhos (onSnapshot); o Livro precisa do
        // aviso para redesenhar a linha sem reler o ano inteiro do Firestore.
        avisarCasoAtualizado(currentTask);
        alert(jaLiberado ? 'Registro do livro atualizado.' : 'Laudo liberado com sucesso!');
        closeTaskModal();
    } catch (e) {
        console.error(e);
        alert('Erro ao gravar: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}




if(btnDelete) {
    btnDelete.addEventListener('click', async () => {
        if (!currentTask) return;

        if (!getPermissionContext(currentTask).canDelete) {
            alert('Apenas professor, pós-graduando ou admin podem excluir um caso.');
            return;
        }

        const nome = [currentTask.protocolo, currentTask.animalNome].filter(Boolean).join(' — ') || 'este caso';
        const aviso = currentTask.releasedAt
            ? `Excluir ${nome}?\n\nO laudo já foi liberado: o caso sai do Livro de Registros junto.`
            : `Excluir ${nome}?\n\nO caso sai do Mural e do Livro de Registros.`;
        if (!confirm(aviso)) return;

        const excluido = { ...currentTask };
        btnDelete.disabled = true;
        try {
            await deleteDoc(doc(db, "tasks", excluido.id));
            await registrarExclusao(excluido);
            avisarCasoExcluido(excluido.id);
            closeTaskModal();
        } catch (e) {
            console.error(e);
            alert('Erro ao excluir: ' + e.message);
        } finally {
            btnDelete.disabled = false;
        }
    });
}

if (btnEditEntry) {
    btnEditEntry.addEventListener('click', () => window.triggerEditEntry());
}

window.triggerEditEntry = function() {
    if(currentTask && window.openEditEntry) {
        const tmModal = document.getElementById('task-manager-modal');
        if(tmModal) tmModal.classList.add('hidden');
        window.openEditEntry(currentTask);
    } else {
        console.error("Não foi possível editar: Task ou função global não encontrada.");
    }
}

window.openTaskManager = openTaskManager;
window.openReleaseForm = openReleaseForm;
window.toggleFinancialStatus = toggleFinancialStatus;
window.alternarReabertura = alternarReabertura;
window.marcarEtapa = marcarEtapa;