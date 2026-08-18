import { db, auth } from '../core.js';
import { infoDoNivel } from '../lib/prioridade.js';
import { 
    doc, getDoc, updateDoc, deleteDoc
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
import { registrarLiberacao, registrarExclusao } from '../lib/livro-indice.js';

const ENABLE_EXTERNAL_STORAGE_INTEGRATION = true;

// --- ESTILOS INJETADOS (Correções Específicas Mobile) ---
const style = document.createElement('style');
style.innerHTML = `
    @media (max-width: 768px) {
        .modal-glass { 
            width: 100% !important; 
            height: 100% !important; 
            max-height: 100vh !important; 
            border-radius: 0 !important; 
            margin: 0 !important; 
            display: flex; 
            flex-direction: column; 
        }
        .tm-hero-modern { flex-direction: column; text-align: center; gap: 15px; }
        .tm-hero-modern > div:last-child { text-align: center !important; width: 100%; }
        
        /* Layout Vertical para as seções principais */
        .tm-code-section { flex-direction: column; gap: 20px; align-items: stretch !important; }
        .tm-code-section > div { text-align: left !important; width: 100%; }
        
        /* CORREÇÃO: Botão de Editar ocupa largura total */
        .tm-code-section > button { margin-left: 0 !important; width: 100%; margin-top: 5px; }

        /* CORREÇÃO CRÍTICA: Botão de Copiar no Mobile */
        .btn-copy-code {
            width: 40px !important; /* Tamanho fixo */
            height: 40px !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important; /* Impede de encolher ou esticar */
            background: rgba(0,0,0,0.05) !important; /* Fundo leve para área de toque */
            border-radius: 8px !important;
        }

        .tm-code-row {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 10px !important;
            width: 100%;
        }

        .tm-info-cards { grid-template-columns: 1fr !important; }
        .tm-actions-footer { flex-direction: column; }
        .tm-actions-footer button { width: 100%; }
        .modal-footer { flex-direction: column-reverse; }
        .modal-footer button { width: 100%; }
    }
    
    .btn-copy-code:active { transform: scale(0.9); }
`;
document.head.appendChild(style);

const modal = document.getElementById('task-manager-modal');
const closeBtn = document.getElementById('close-tm-btn');
const viewDetails = document.getElementById('view-details-content');
const viewK7 = document.getElementById('view-k7-form');
const viewRelease = document.getElementById('view-release-form');
const infoGrid = document.getElementById('tm-info-grid');
const formK7 = document.getElementById('form-k7');
const formRelease = document.getElementById('form-release');

const btnDelete = document.getElementById('btn-delete-task');

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
            <div class="info-card" style="grid-column:1 / -1; border:1px solid rgba(148,163,184,0.25);">
                <div class="info-icon"><i class="fas fa-folder-open"></i></div>
                <div class="info-label">Arquivos do Laudo</div>
                <div style="font-size:0.78rem; color:var(--text-tertiary); margin-top:6px;">Sem permissão para visualizar arquivos deste laudo.</div>
            </div>
        `;
    }

    const wordVersionsHtml = state.wordVersions.slice().reverse().slice(0, 5).map((version) => {
        const date = version.uploadedAt ? new Date(version.uploadedAt).toLocaleString('pt-BR') : '-';
        const activeTag = state.activeWordVersionId === version.versionId
            ? '<span style="font-size:0.65rem; font-weight:700; color:#14532d; background:#dcfce7; padding:2px 6px; border-radius:999px;">ativo</span>'
            : '';
        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px dashed rgba(148,163,184,0.35);">
            <div style="min-width:0;">
                <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${version.fileName || 'arquivo.docx'}</div>
                <div style="font-size:0.72rem; color:var(--text-tertiary);">${date} • ${formatFileSize(version.size)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
                ${activeTag}
                <button data-report-download="word:${version.versionId}" style="border:none; border-radius:6px; padding:4px 6px; background:rgba(59,130,246,0.15); color:#1d4ed8; cursor:pointer;" title="Baixar versão"><i class="fas fa-download"></i></button>
            </div>
        </div>`;
    }).join('');

    const pdfVersionsHtml = state.pdfVersions.slice().reverse().slice(0, 5).map((version) => {
        const date = version.uploadedAt ? new Date(version.uploadedAt).toLocaleString('pt-BR') : '-';
        const activeTag = state.activePdfVersionId === version.versionId
            ? '<span style="font-size:0.65rem; font-weight:700; color:#14532d; background:#dcfce7; padding:2px 6px; border-radius:999px;">ativo</span>'
            : '';
        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px dashed rgba(148,163,184,0.35);">
            <div style="min-width:0;">
                <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${version.fileName || 'arquivo.pdf'}</div>
                <div style="font-size:0.72rem; color:var(--text-tertiary);">${date} • ${formatFileSize(version.size)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
                ${activeTag}
                <button data-report-download="pdf:${version.versionId}" style="border:none; border-radius:6px; padding:4px 6px; background:rgba(59,130,246,0.15); color:#1d4ed8; cursor:pointer;" title="Baixar versão"><i class="fas fa-download"></i></button>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="info-card" style="grid-column:1 / -1; border:1px solid rgba(59,130,246,0.25);">
            <div class="info-icon"><i class="fas fa-folder-open"></i></div>
            <div class="info-label">Arquivos do Laudo</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">
                Fonte oficial: <strong>${hasWordPrimary ? 'Word enviado' : (state.activeSource === 'uploaded_pdf' ? 'PDF enviado' : 'Nenhum arquivo enviado')}</strong>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
                ${canManage ? '<button id="tm-btn-upload-word" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-upload"></i> Upload Word</button>' : ''}
                ${canManage ? '<button id="tm-btn-upload-pdf" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-upload"></i> Upload PDF</button>' : ''}
                ${activeWord ? '<button id="tm-btn-download-word-active" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-download"></i> Baixar Word ativo</button>' : ''}
                ${activePdf ? '<button id="tm-btn-download-pdf-active" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-download"></i> Baixar PDF ativo</button>' : ''}
                ${canManage && activeWord ? '<button id="tm-btn-remove-word-active" class="btn btn-secondary btn-sm" type="button" style="border-color:#dc2626; color:#b91c1c;"><i class="fas fa-trash"></i> Retirar Word ativo</button>' : ''}
                ${canManage && activePdf ? '<button id="tm-btn-remove-pdf-active" class="btn btn-secondary btn-sm" type="button" style="border-color:#dc2626; color:#b91c1c;"><i class="fas fa-trash"></i> Retirar PDF ativo</button>' : ''}
            </div>

            <input id="tm-input-upload-word" type="file" accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden">
            <input id="tm-input-upload-pdf" type="file" accept=".pdf,application/pdf" class="hidden">

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-top:12px;">
                <div style="padding:10px; border:1px solid rgba(148,163,184,0.25); border-radius:10px;">
                    <div style="font-weight:800; font-size:0.82rem; margin-bottom:6px; color:var(--text-secondary);">Histórico Word</div>
                    ${wordVersionsHtml || '<div style="font-size:0.75rem; color:var(--text-tertiary);">Sem versões de Word.</div>'}
                </div>
                <div style="padding:10px; border:1px solid rgba(148,163,184,0.25); border-radius:10px;">
                    <div style="font-weight:800; font-size:0.82rem; margin-bottom:6px; color:var(--text-secondary);">Histórico PDF</div>
                    ${pdfVersionsHtml || '<div style="font-size:0.75rem; color:var(--text-tertiary);">Sem versões de PDF.</div>'}
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
    if (viewK7) viewK7.classList.toggle('hidden', nome !== 'k7');
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

function renderDetails(task) {
    const permission = getPermissionContext(task);
    const { isStaff, canReleaseInitial } = permission;
    // O laudo entra no sistema como Word/PDF enviado; download e histórico de
    // versões ficam no painel de arquivos.
    const storagePanelsHtml = ENABLE_EXTERNAL_STORAGE_INTEGRATION
        ? renderReportFilesPanel(task, permission)
        : '';

    const typeClass = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    const typeIcon = task.type === 'necropsia' ? 'fa-skull' : 'fa-microscope';
    const typeLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';

    // O laudo liberado é o que marca o caso como fechado — não existe mais etapa.
    const laudoLiberado = !!task.releasedAt;
    const dataLaudo = laudoLiberado ? brData(dataDoLaudo(task)) : '';

    // --- SEÇÃO FINANCEIRA ---
    let financialHtml = '';
    const finStatus = task.financialStatus || task.situacao || 'pendente';
    
    let alertStyle = '';
    let iconClass = '';
    let statusTitle = '';
    let statusSub = '';
    let btnHtml = '';

    if (finStatus === 'didatico') {
        alertStyle = 'background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a;'; 
        iconClass = 'fa-graduation-cap';
        statusTitle = 'Isento';
        statusSub = 'Interesse Didático';
        btnHtml = ''; 
    } else if (finStatus === 'pago') {
        alertStyle = 'background: #dcfce7; border: 1px solid #86efac; color: #14532d;';
        iconClass = 'fa-check-circle';
        statusTitle = 'Pago';
        statusSub = 'Liberado';
        if(isStaff) {
            btnHtml = `<button onclick="window.toggleFinancialStatus()" style="background:transparent; border:1px solid currentColor; border-radius:4px; padding:2px 8px; font-size:0.65rem; font-weight:700; color:inherit; cursor:pointer; margin-top:3px; white-space:nowrap; opacity:0.8;">REVERTER</button>`;
        }
    } else {
        alertStyle = 'background: #fffbeb; border: 1px solid #fcd34d; color: #78350f;';
        iconClass = 'fa-exclamation-triangle';
        statusTitle = 'Pendente';
        statusSub = 'Bloqueia laudo';
        if(isStaff) {
            btnHtml = `<button onclick="window.toggleFinancialStatus()" style="background:transparent; border:1px solid currentColor; border-radius:4px; padding:2px 8px; font-size:0.65rem; font-weight:700; color:inherit; cursor:pointer; margin-top:3px; white-space:nowrap; opacity:0.8;">PAGAR</button>`;
        }
    }

    financialHtml = `
        <div class="finance-alert" style="${alertStyle} padding:8px 12px; border-radius:8px; margin-top:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.2rem; flex-shrink:0;"><i class="fas ${iconClass}"></i></div>
            <div style="flex:1; min-width:0; line-height:1.2;">
                <div style="font-weight:800; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${statusTitle}</div>
                <div style="font-size:0.7rem; opacity:0.85; font-weight:600;">${statusSub}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; flex-shrink:0;">
                ${task.valor && task.valor !== '0,00' ? `<div style="font-size:1rem; font-weight:800; letter-spacing:-0.5px;">R$ ${task.valor}</div>` : ''}
                ${btnHtml}
            </div>
        </div>`;

    // --- REGISTRO DO LIVRO ---
    // Data do laudo e diagnóstico são as duas colunas do Livro de Registros que
    // não vêm da entrada da amostra: entram na liberação e ficam visíveis aqui.
    let livroHtml = '';
    if (laudoLiberado) {
        livroHtml = `
            <div class="info-card" style="grid-column:1 / -1; border:1px solid rgba(34,197,94,0.3);">
                <div class="info-icon"><i class="fas fa-book"></i></div>
                <div class="info-label">Registro no Livro</div>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">
                    Data do laudo: <strong>${dataLaudo || '—'}</strong>
                </div>
                <div style="font-size:0.85rem; color:var(--text-primary); margin-top:8px; white-space:pre-wrap; line-height:1.45;">${
                    task.diagnostico
                        ? esc(task.diagnostico)
                        : '<span style="color:var(--text-tertiary); font-style:italic;">Sem diagnóstico registrado.</span>'
                }</div>
                ${canReleaseInitial ? `
                    <button onclick="window.openReleaseForm()" class="btn btn-secondary btn-sm" type="button" style="margin-top:10px;">
                        <i class="fas fa-pen"></i> Corrigir registro
                    </button>` : ''}
            </div>`;
    }

    // --- BOTÕES DE AÇÃO ---
    // Liberar é a única ação de laudo aqui; o arquivo em si sobe e desce pelo
    // painel "Arquivos do Laudo".
    let actionsHtml = '';
    if (!laudoLiberado) {
        actionsHtml = canReleaseInitial
            ? `<button onclick="window.openReleaseForm()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>`
            : `<span style="font-size:0.8rem; color:#666; align-self:center;">Liberação: professor, pós ou admin</span>`;
    }

    // O botão de excluir mora no rodapé fixo do modal, fora deste HTML — some
    // para quem não pode apagar o caso.
    if (btnDelete) btnDelete.classList.toggle('hidden', !permission.canDelete);

    // Selo do nível da amostra, quando ela tem um: URGENTE em vermelho,
    // PRIORITÁRIA em âmbar, nada para a comum.
    const renderNivelBadge = (caso) => {
        const info = infoDoNivel(caso);
        if (!info) return '';
        return `<div class="tm-hero-badge tm-nivel-badge ${info.classe}">
            <i class="fas ${info.icone}"></i> ${info.rotulo.toUpperCase()}</div>`;
    };

    // --- HTML FINAL DO CARD ---
    const html = `
        <div class="tm-hero-modern ${typeClass}">
            <div class="tm-hero-content">
                <div class="tm-hero-badge"><i class="fas ${typeIcon}"></i> ${typeLabel}</div>
                ${renderNivelBadge(task)}
                <h2>${task.animalNome || 'Sem Nome'}</h2>
                <p><i class="fas fa-paw"></i> ${task.especie || 'Espécie não inf.'} &bull; ${task.sexo || '-'} &bull; ${task.idade || '-'}</p>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.8rem; opacity:0.8; margin-bottom:4px;">LAUDO</div>
                <div style="background:white; color:#333; padding:5px 12px; border-radius:8px; font-weight:700;">
                    ${laudoLiberado ? dataLaudo : 'Pendente'}
                </div>
            </div>
        </div>

        <div class="tm-code-section">
            <div>
                <div class="tm-code-label">Protocolo Interno</div>
                <div class="tm-code-value" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${task.protocolo || "---"}
                </div>
            </div>

            <button class="btn btn-sm btn-secondary" onclick="window.triggerEditEntry()" style="margin-left:15px;">
                <i class="fas fa-edit"></i> Editar Dados
            </button>
        </div>
        
        ${financialHtml}

        <div class="tm-info-cards">
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-tag"></i></div>
                <div class="info-label">Proprietário</div>
                <div class="info-value">${task.proprietario || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-md"></i></div>
                <div class="info-label">Veterinário / Docente</div>
                <div class="info-value">${task.docente || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-user-graduate"></i></div>
                <div class="info-label">Pós-Graduando</div>
                <div class="info-value">${task.posGraduando || '-'}</div>
            </div>
            <div class="info-card">
                <div class="info-icon"><i class="fas fa-vial"></i></div>
                <div class="info-label">Cassetes (Qtd/Cor)</div>
                <div class="info-value" style="display:flex; align-items:center; gap:8px;">
                    ${task.k7Quantity || 0} un. <span class="tm-hero-modern ${typeClass}"style="font-size:0.8rem; margin-left:5px; padding:2px 6px; border-radius:4px;">${task.k7Color || '-'}</span>
                    ${isStaff ? `<button onclick="window.openK7Edit()" style="background:transparent; border:1px solid var(--text-tertiary); border-radius:6px; padding:2px 8px; cursor:pointer; font-size:0.7rem; color:var(--text-secondary); margin-left:auto;" title="Editar K7"><i class="fas fa-pen"></i></button>` : ''}
                </div>
            </div>

            ${livroHtml}

            ${storagePanelsHtml}
        </div>

        ${actionsHtml ? `<div class="tm-actions-footer">${actionsHtml}</div>` : ''}
    `;

    infoGrid.innerHTML = html;
    if (ENABLE_EXTERNAL_STORAGE_INTEGRATION) {
        bindTaskFileActions(task, permission);
    }
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
 * FORMULÁRIO DE LIBERAÇÃO
 *
 * A liberação é o ponto em que a amostra vira linha do Livro de Registros, e
 * duas colunas do livro não existem em lugar nenhum antes dela: a data do laudo
 * e o diagnóstico. Todo o resto (protocolo, animal, remetente, docente, pós,
 * origem, situação, valor) já veio da entrada da amostra. Por isso a liberação
 * pede esses dois campos em vez de só congelar a data do clique.
 *
 * O mesmo formulário serve para corrigir o registro de um laudo já liberado —
 * aí ele não mexe em `releasedAt` nem soma de novo no índice do livro.
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
                o caso vai aparecer em <em>Sem ano</em>. Corrija em “Editar Dados” antes de liberar.
            </div>` : ''}

        ${financeiroPendente ? `
            <div style="background:#fffbeb; border:1px solid #fcd34d; color:#78350f; padding:10px 12px; border-radius:8px; margin-bottom:16px; font-size:0.82rem;">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Financeiro pendente.</strong> O laudo pode ser liberado assim mesmo, mas o caso vai para o livro como “Pendente”.
            </div>` : ''}

        <div class="form-group">
            <label for="release-data" style="font-weight:700; margin-bottom:8px; display:block;">
                Data do laudo <span style="color:var(--color-error);">*</span>
            </label>
            <input type="date" id="release-data" class="input-field" required
                   value="${esc(dataAtual)}" max="${esc(hoje)}" style="max-width:220px;">
            <div style="font-size:0.75rem; color:var(--text-tertiary); margin-top:6px;">
                É a data que vai para a coluna “Laudo” do Livro de Registros. Pode ser retroativa.
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

    if (!jaLiberado && !confirm('Liberar este laudo?\nO caso sai do Mural e passa a constar no Livro de Registros.')) return;

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

        // O índice conta laudos liberados; correção não é liberação nova.
        if (!jaLiberado) {
            await registrarLiberacao({ ...currentTask, ...derivados });
        }

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




function openK7FormSmart(task) {
    mostrarView('k7');

    const currentColor = task.k7Color || (task.type === 'necropsia' ? 'azul' : 'rosa');
    const currentQty = task.k7Quantity || 1;
    const isNecro = task.type === 'necropsia';
    
    // Restringir cores: necropsia = azul/branco, biópsia = rosa/branco
    const mainColor = isNecro ? 'azul' : 'rosa';
    const mainLabel = isNecro ? 'Azul' : 'Rosa';
    const mainBg = isNecro ? '#3b82f6' : '#ec4899';
    
    const optionsHTML = `
        <label class="k7-color-btn ${currentColor === mainColor ? 'selected' : ''}" style="--btn-color: ${mainBg};">
            <input type="radio" name="k7Color" value="${mainColor}" ${currentColor === mainColor ? 'checked' : ''}>
            <span class="k7-color-circle" style="background:${mainBg};"></span>
            <span>${mainLabel}</span>
        </label>
        <label class="k7-color-btn ${currentColor === 'branco' ? 'selected' : ''}" style="--btn-color: #94a3b8;">
            <input type="radio" name="k7Color" value="branco" ${currentColor === 'branco' ? 'checked' : ''}>
            <span class="k7-color-circle" style="background:#f1f5f9; border:2px solid #cbd5e1;"></span>
            <span>Branco</span>
        </label>
    `;
    
    if(formK7) {
        formK7.innerHTML = `
            <style>
                .k7-color-btn {
                    display: flex; align-items: center; gap: 10px;
                    padding: 12px 20px; border-radius: 12px; cursor: pointer;
                    border: 2px solid var(--border-glass); background: var(--bg-glass);
                    transition: all 0.25s ease; user-select: none; flex: 1;
                }
                .k7-color-btn input { display: none; }
                .k7-color-btn .k7-color-circle {
                    width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
                    transition: transform 0.25s ease, box-shadow 0.25s ease;
                }
                .k7-color-btn span:last-child { font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
                .k7-color-btn:hover { border-color: var(--btn-color); background: rgba(0,0,0,0.03); }
                .k7-color-btn:hover .k7-color-circle { transform: scale(1.1); }
                .k7-color-btn.selected {
                    border-color: var(--btn-color);
                    background: linear-gradient(135deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06));
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--btn-color) 25%, transparent);
                }
                .k7-color-btn.selected .k7-color-circle {
                    transform: scale(1.2);
                    box-shadow: 0 0 12px var(--btn-color);
                }
                .k7-color-btn.selected span:last-child { color: var(--btn-color); font-weight: 800; }
                .k7-color-btn.selected::after {
                    content: '\\f00c'; font-family: 'Font Awesome 6 Free'; font-weight: 900;
                    margin-left: auto; color: var(--btn-color); font-size: 1.1rem;
                }
            </style>
            <div class="form-group"><label style="font-weight:700; margin-bottom:8px; display:block;">Quantidade de Cassetes</label><input type="number" id="k7-quantity" class="input-field" min="1" value="${currentQty}" style="font-size:1.2rem; text-align:center; max-width:120px;"></div>
            <div class="form-group"><label style="font-weight:700; margin-bottom:8px; display:block;">Cor do Cassete</label><div style="display:flex; gap:12px;">${optionsHTML}</div></div>
            <div class="modal-footer"><button type="button" id="btn-cancel-k7-dyn" class="btn btn-secondary">Voltar</button><button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Salvar</button></div>
        `;
        
        // Toggle visual selection on click
        formK7.querySelectorAll('.k7-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                formK7.querySelectorAll('.k7-color-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
        
        document.getElementById('btn-cancel-k7-dyn').addEventListener('click', () => mostrarView('details'));
        formK7.onsubmit = async (e) => { 
            e.preventDefault(); 
            const qty = parseInt(document.getElementById('k7-quantity').value, 10) || 1; 
            const color = document.querySelector('input[name="k7Color"]:checked').value; 
            const updateData = { k7Quantity: qty, k7Color: color };
            try {
                await updateDoc(doc(db, "tasks", currentTask.id), updateData); 
                Object.assign(currentTask, updateData);
                renderDetails(currentTask);
                mostrarView('details');
            } catch(err){ alert("Erro: " + err.message); }
        };
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
            ? `Excluir ${nome}?\n\nO laudo já foi liberado: ele sai do Livro de Registros junto.`
            : `Excluir ${nome}?`;
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
window.openK7Edit = function() { if(currentTask) openK7FormSmart(currentTask); };