import { db, auth } from '../core.js';
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
import { camposDerivados } from '../lib/protocolo.js';
import { registrarLiberacao } from '../lib/livro-indice.js';
import {
    uploadInternalPhotos,
    removeInternalPhoto
} from '../lib/internal-photos-service.js';

console.log("Task Manager Loaded - Mobile Layout Fix");
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
const infoGrid = document.getElementById('tm-info-grid'); 
const formK7 = document.getElementById('form-k7');

const btnDelete = document.getElementById('btn-delete-task');

let currentTask = null;
let currentUserData = null; 
let jsZipModulePromise = null;

async function loadJsZipModule() {
    if (!jsZipModulePromise) {
        jsZipModulePromise = import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    }

    return jsZipModulePromise;
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

function sanitizeFileNamePart(value, fallback = 'arquivo') {
    const safe = (value || fallback)
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');

    return safe || fallback;
}

function inferPhotoExtension(photo = {}, fallback = 'webp') {
    const fromOriginalName = (photo.originalFileName || '').toString().toLowerCase();
    const fromName = (photo.fileName || '').toString().toLowerCase();
    const fromFormat = (photo.format || '').toString().toLowerCase();
    const fromUrl = (photo.url || photo.thumbUrl || '').toString().toLowerCase();
    const fromMime = (photo.mimeType || '').toString().toLowerCase();

    if (fromOriginalName.includes('.')) {
        const ext = fromOriginalName.split('.').pop();
        if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
    }

    if (fromFormat && /^[a-z0-9]{2,10}$/.test(fromFormat)) {
        return fromFormat;
    }

    if (fromName.includes('.')) {
        const ext = fromName.split('.').pop();
        if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
    }

    const extMatch = fromUrl.match(/\.([a-z0-9]{2,5})(?:$|\?|#)/i);
    if (extMatch && extMatch[1]) {
        return extMatch[1].toLowerCase();
    }

    if (fromMime.includes('/')) {
        const ext = fromMime.split('/').pop();
        if (ext && /^[a-z0-9]{2,10}$/.test(ext)) return ext;
    }

    return fallback;
}

function buildZipPhotoFileName(photo, index) {
    const baseNameRaw = (photo?.originalFileName || photo?.fileName || '').toString().trim();
    const hasDot = baseNameRaw.includes('.');
    const defaultName = `foto_${String(index + 1).padStart(2, '0')}`;

    if (hasDot) {
        return sanitizeFileNamePart(baseNameRaw, `${defaultName}.webp`);
    }

    const ext = inferPhotoExtension(photo, 'webp');
    const base = sanitizeFileNamePart(baseNameRaw || defaultName, defaultName);
    return `${base}.${ext}`;
}

function buildPhotosZipName(task) {
    const protocol = sanitizeFileNamePart(task?.protocolo || task?.id || 'caso', 'caso');
    return `Fotos_Internas_${protocol}.zip`;
}

function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function buildInternalPhotosZip(task, options = {}) {
    const photos = Array.isArray(task?.internalPhotos) ? task.internalPhotos : [];
    if (photos.length === 0) {
        throw new Error('Nenhuma foto interna cadastrada para exportar.');
    }

    const { onProgress } = options;
    const jszipModule = await loadJsZipModule();
    const JSZip = jszipModule?.default || jszipModule?.JSZip || jszipModule;
    const zip = new JSZip();

    const folderName = sanitizeFileNamePart(task?.protocolo || task?.id || 'caso', 'caso');
    const zipFolder = zip.folder(folderName) || zip;

    let added = 0;
    const failures = [];

    for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index] || {};
        const sourceUrl = photo.url || photo.thumbUrl || '';
        const fileName = buildZipPhotoFileName(photo, index);

        try {
            if (!sourceUrl) {
                throw new Error('URL da foto indisponivel.');
            }

            const response = await fetch(sourceUrl);
            if (!response.ok) {
                throw new Error(`Falha HTTP ${response.status}`);
            }

            const blob = await response.blob();
            zipFolder.file(fileName, blob);
            added += 1;
        } catch (error) {
            failures.push({
                fileName,
                reason: error?.message || 'falha desconhecida'
            });
        }

        if (typeof onProgress === 'function') {
            onProgress({
                done: index + 1,
                total: photos.length,
                added,
                failed: failures.length
            });
        }
    }

    if (failures.length > 0) {
        const reportLines = [
            `Total de fotos: ${photos.length}`,
            `Incluidas no ZIP: ${added}`,
            `Falhas: ${failures.length}`,
            '',
            ...failures.map((item, index) => `${index + 1}. ${item.fileName} - ${item.reason}`)
        ];

        zip.file('falhas_download_fotos.txt', reportLines.join('\n'));
    }

    if (added === 0) {
        const firstFailure = failures[0]?.reason || 'Nao foi possivel baixar as fotos.';
        throw new Error(firstFailure);
    }

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    return {
        blob,
        added,
        failed: failures.length,
        total: photos.length
    };
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
                Fonte oficial: <strong>${hasWordPrimary ? 'Word enviado' : (state.activeSource === 'uploaded_pdf' ? 'PDF enviado' : 'Laudo online')}</strong>
                ${state.lastConversionError ? `<div style="margin-top:6px; color:#b91c1c;"><i class="fas fa-exclamation-triangle"></i> Conversão Word→PDF: ${state.lastConversionError}</div>` : ''}
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

function renderInternalPhotosPanel(task, permission) {
    const photos = Array.isArray(task.internalPhotos) ? task.internalPhotos : [];
    const canManagePhotos = permission.canFillReport || permission.canCorrectReport || permission.canReleaseInitial;
    const canDownloadPhotos = permission.canDownloadReport || canManagePhotos;

    const photosHtml = photos.length === 0
        ? '<div style="font-size:0.75rem; color:var(--text-tertiary);">Nenhuma foto interna cadastrada.</div>'
        : photos.map((photo) => `
            <div style="position:relative; border:1px solid rgba(148,163,184,0.25); border-radius:10px; overflow:hidden;">
                <a href="${photo.url}" target="_blank" rel="noopener noreferrer" style="display:block;">
                    <img src="${photo.thumbUrl || photo.url}" alt="Foto interna" style="width:100%; height:110px; object-fit:cover; display:block;">
                </a>
                <div style="padding:6px; background:rgba(15,23,42,0.75); color:#fff; font-size:0.68rem;">
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${photo.fileName || 'foto.webp'}</div>
                    <div>${formatFileSize(photo.bytes)} • ${photo.uploadedAt ? new Date(photo.uploadedAt).toLocaleDateString('pt-BR') : '-'}</div>
                </div>
                ${canManagePhotos ? `<button data-photo-remove="${photo.photoId}" style="position:absolute; top:6px; right:6px; border:none; width:28px; height:28px; border-radius:50%; background:rgba(185,28,28,0.9); color:#fff; cursor:pointer;"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `).join('');

    return `
        <div class="info-card" style="grid-column:1 / -1; border:1px solid rgba(14,165,233,0.3);">
            <div class="info-icon"><i class="fas fa-images"></i></div>
            <div class="info-label">Fotos Internas do Laboratório</div>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">Uso interno. Não entra no laudo PDF/Word.</div>

            <div style="display:flex; gap:8px; margin-top:10px;">
                ${canManagePhotos ? '<button id="tm-btn-upload-photos" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-upload"></i> Enviar fotos</button>' : ''}
                ${canDownloadPhotos && photos.length > 0 ? '<button id="tm-btn-download-photos-zip" class="btn btn-secondary btn-sm" type="button"><i class="fas fa-file-archive"></i> Baixar ZIP</button>' : ''}
            </div>
            <input id="tm-input-upload-photos" type="file" accept="image/*" multiple class="hidden">

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-top:10px;">
                ${photosHtml}
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
        canReleaseInitial: isAdmin || isProfessor
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

async function openTaskManager(taskId) {
    try {
        await fetchCurrentUserData();
        const docSnap = await getDoc(doc(db, "tasks", taskId));
        if (!docSnap.exists()) return alert("Tarefa não encontrada.");

        currentTask = { id: docSnap.id, ...docSnap.data() };
        renderDetails(currentTask);
        
        if(viewDetails) viewDetails.classList.remove('hidden');
        if(viewK7) viewK7.classList.add('hidden');
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
        ? `${renderReportFilesPanel(task, permission)}${renderInternalPhotosPanel(task, permission)}`
        : '';

    const typeClass = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    const typeIcon = task.type === 'necropsia' ? 'fa-skull' : 'fa-microscope';
    const typeLabel = task.type === 'necropsia' ? 'Necropsia' : 'Biópsia';

    // O laudo liberado é o que marca o caso como fechado — não existe mais etapa.
    const laudoLiberado = !!task.releasedAt;
    const dataLaudo = laudoLiberado
        ? new Date(task.releasedAt).toLocaleDateString('pt-BR')
        : '';

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

    // --- BOTÕES DE AÇÃO ---
    // Liberar é a única ação de laudo aqui; o arquivo em si sobe e desce pelo
    // painel "Arquivos do Laudo".
    let actionsHtml = '';
    if (!laudoLiberado) {
        actionsHtml = canReleaseInitial
            ? `<button onclick="window.finishReportWrapper()" class="action-btn btn-release"><i class="fas fa-check-double"></i> Liberar Laudo</button>`
            : `<span style="font-size:0.8rem; color:#666; align-self:center;">Liberação: professor ou admin</span>`;
    }

    // --- HTML FINAL DO CARD ---
    const html = `
        <div class="tm-hero-modern ${typeClass}">
            <div class="tm-hero-content">
                <div class="tm-hero-badge"><i class="fas ${typeIcon}"></i> ${typeLabel}</div>
                ${task.isUrgent ? `<div class="tm-hero-badge tm-urgent-badge"><i class="fas fa-triangle-exclamation"></i> URGENTE</div>` : ''}
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

            ${storagePanelsHtml}
        </div>
        
        ${actionsHtml ? `<div class="tm-actions-footer">${actionsHtml}</div>` : ''}
    `;

    infoGrid.innerHTML = html;
    if (ENABLE_EXTERNAL_STORAGE_INTEGRATION) {
        bindTaskFileAndPhotoActions(task, permission);
    }
}


function bindTaskFileAndPhotoActions(task, permission) {
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

    const btnUploadPhotos = document.getElementById('tm-btn-upload-photos');
    const inputUploadPhotos = document.getElementById('tm-input-upload-photos');
    if (btnUploadPhotos && inputUploadPhotos && !btnUploadPhotos.dataset.bound) {
        btnUploadPhotos.dataset.bound = '1';
        btnUploadPhotos.addEventListener('click', () => inputUploadPhotos.click());

        inputUploadPhotos.addEventListener('change', async () => {
            const files = Array.from(inputUploadPhotos.files || []);
            if (files.length === 0) return;

            const original = btnUploadPhotos.innerHTML;
            btnUploadPhotos.disabled = true;
            btnUploadPhotos.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

            try {
                await uploadInternalPhotos(task.id, files, {
                    onProgress: ({ done, total }) => {
                        btnUploadPhotos.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${done}/${total}`;
                    }
                });
                alert('Fotos internas enviadas com sucesso.');
                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao enviar fotos: ${error.message}`);
            } finally {
                btnUploadPhotos.disabled = false;
                btnUploadPhotos.innerHTML = original;
                inputUploadPhotos.value = '';
            }
        });
    }

    const btnDownloadPhotosZip = document.getElementById('tm-btn-download-photos-zip');
    if (btnDownloadPhotosZip && !btnDownloadPhotosZip.dataset.bound) {
        btnDownloadPhotosZip.dataset.bound = '1';
        btnDownloadPhotosZip.addEventListener('click', async () => {
            const photos = Array.isArray(task.internalPhotos) ? task.internalPhotos : [];
            if (photos.length === 0) {
                alert('Nenhuma foto interna cadastrada para exportar.');
                return;
            }

            const original = btnDownloadPhotosZip.innerHTML;
            btnDownloadPhotosZip.disabled = true;
            btnDownloadPhotosZip.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando...';

            try {
                const result = await buildInternalPhotosZip(task, {
                    onProgress: ({ done, total }) => {
                        btnDownloadPhotosZip.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${done}/${total}`;
                    }
                });

                const fileName = buildPhotosZipName(task);
                triggerBlobDownload(result.blob, fileName);

                if (result.failed > 0) {
                    alert(`ZIP gerado com ${result.added} foto(s). ${result.failed} foto(s) falharam e foram listadas em falhas_download_fotos.txt.`);
                }
            } catch (error) {
                console.error(error);
                alert(`Erro ao gerar ZIP de fotos: ${error.message}`);
            } finally {
                btnDownloadPhotosZip.disabled = false;
                btnDownloadPhotosZip.innerHTML = original;
            }
        });
    }

    document.querySelectorAll('[data-photo-remove]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';

        button.addEventListener('click', async () => {
            const photoId = button.getAttribute('data-photo-remove');
            if (!photoId) return;
            if (!confirm('Remover esta foto interna?')) return;

            try {
                await removeInternalPhoto(task.id, photoId);
                await refreshCurrentTask();
            } catch (error) {
                console.error(error);
                alert(`Erro ao remover foto: ${error.message}`);
            }
        });
    });
}

window.copyToClipboard = async function(text, btn) {
    if(!text) return;
    try {
        await navigator.clipboard.writeText(text);
        const icon = btn.querySelector('i');
        icon.className = 'fas fa-check';
        icon.style.color = '#10b981'; 
        setTimeout(() => {
            icon.className = 'far fa-copy';
            icon.style.color = '';
        }, 2000);
    } catch(e) { console.error(e); }
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


async function finishReportWrapper() {
    if(!currentTask) return;

    if (currentTask.releasedAt) {
        alert('Este laudo já foi liberado.');
        return;
    }

    const permission = getPermissionContext(currentTask);
    if (!permission.canReleaseInitial) {
        alert('Apenas professor ou admin podem liberar o laudo.');
        return;
    }

    const finStatus = currentTask.financialStatus || 'pendente';
    if (finStatus !== 'pago' && finStatus !== 'didatico') {
        if(!confirm("⚠️ AVISO FINANCEIRO: Status PENDENTE.\nDeseja liberar o laudo mesmo assim?")) return;
    }

    if(!confirm("Tem certeza que deseja LIBERAR este laudo?\nA data será congelada e o caso vai para o Histórico.")) return;

    try {
        const dataCongelada = new Date().toISOString();

        // Casos antigos podem não ter os campos derivados do protocolo; o
        // Histórico filtra por eles, então garante que existam na liberação.
        const derivados = camposDerivados(currentTask.protocolo);

        await updateDoc(doc(db, "tasks", currentTask.id), {
            releasedBy: auth.currentUser.uid,
            releasedAt: dataCongelada,
            // O caso sai do fluxo e vira histórico: é o que tira ele do Mural e
            // do Planner, e o que impede o acervo de voltar a ser lido por eles.
            status: 'concluido',
            ...derivados
        });
        await registrarLiberacao({ ...currentTask, ...derivados });
        alert("Laudo Liberado com Sucesso!");
        closeTaskModal();
        if(window.location.reload) window.location.reload();
    } catch(e) { console.error(e); alert("Erro ao liberar: " + e.message); }
}




function openK7FormSmart(task) {
    viewDetails.classList.add('hidden'); viewK7.classList.remove('hidden');
    
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
        
        document.getElementById('btn-cancel-k7-dyn').addEventListener('click', () => { viewK7.classList.add('hidden'); viewDetails.classList.remove('hidden'); });
        formK7.onsubmit = async (e) => { 
            e.preventDefault(); 
            const qty = parseInt(document.getElementById('k7-quantity').value, 10) || 1; 
            const color = document.querySelector('input[name="k7Color"]:checked').value; 
            const updateData = { k7Quantity: qty, k7Color: color };
            try {
                await updateDoc(doc(db, "tasks", currentTask.id), updateData); 
                Object.assign(currentTask, updateData);
                renderDetails(currentTask); 
                viewK7.classList.add('hidden'); 
                viewDetails.classList.remove('hidden'); 
            } catch(err){ alert("Erro: " + err.message); } 
        };
    }
}

if(btnDelete) {
    btnDelete.addEventListener('click', async () => { if(confirm("Excluir?")) { try { await deleteDoc(doc(db, "tasks", currentTask.id)); closeTaskModal(); } catch(e){} } });
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
window.finishReportWrapper = finishReportWrapper;
window.toggleFinancialStatus = toggleFinancialStatus;
window.openK7Edit = function() { if(currentTask) openK7FormSmart(currentTask); };