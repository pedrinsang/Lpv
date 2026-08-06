import { db, auth } from '../core.js';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { uploadInternalPhotos } from '../lib/internal-photos-service.js';
import { camposDerivados, formatarProtocolo } from '../lib/protocolo.js';

console.log("Entry Modal Module Loaded - formulário único (tipo pelo protocolo)");

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('entry-modal');
const closeBtn = document.getElementById('close-modal-btn');
const openBtns = document.querySelectorAll('.btn-sidebar-new, .nav-fab');
const modalTitle = document.getElementById('entry-modal-title');

const form = document.getElementById('form-new-entry');
const protocoloInput = document.getElementById('entry-protocolo');
const urgentInput = document.getElementById('entry-urgent');
const typePill = document.getElementById('entry-type-pill');
const typeText = document.getElementById('entry-type-text');

const selectDocente = document.getElementById('select-docente');
const selectPos = document.getElementById('select-pos');
const hiddenPosUid = document.getElementById('select-pos-uid');

// --- ESTADO LOCAL ---
let editingTaskId = null; // null = Modo Criação | ID = Modo Edição

// ==========================================================================
// 1. TIPO DERIVADO DO PROTOCOLO
//    VN... = necropsia | V... = biópsia. Sem prefixo válido não há tipo.
// ==========================================================================
const TYPE_LABELS = {
    necropsia: { text: 'Necropsia', icon: 'fa-skull', cls: 'is-necro' },
    biopsia: { text: 'Biópsia', icon: 'fa-microscope', cls: 'is-bio' }
};

export function detectTypeFromProtocolo(protocolo) {
    const clean = (protocolo || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.startsWith('VN')) return 'necropsia';
    if (clean.startsWith('V')) return 'biopsia';
    return null;
}

function updateTypePill() {
    if (!typePill || !typeText) return;

    const type = detectTypeFromProtocolo(protocoloInput?.value);
    const info = TYPE_LABELS[type];

    typePill.classList.toggle('is-empty', !info);
    typePill.classList.toggle('is-necro', info?.cls === 'is-necro');
    typePill.classList.toggle('is-bio', info?.cls === 'is-bio');

    const icon = typePill.querySelector('i');
    if (icon) icon.className = `fas ${info ? info.icon : 'fa-circle-question'}`;
    typeText.textContent = info ? info.text : 'Informe o protocolo';
}

if (protocoloInput) protocoloInput.addEventListener('input', updateTypePill);

// ==========================================================================
// 2. ABRIR E FECHAR MODAL (MODO CRIAÇÃO)
// ==========================================================================
openBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });
});

if (closeBtn) closeBtn.addEventListener('click', closeModal);

function openModal() {
    if (!modal || !form) return;

    editingTaskId = null;
    modal.classList.remove('hidden');

    if (modalTitle) modalTitle.textContent = 'Nova Entrada';

    form.reset();
    if (hiddenPosUid) hiddenPosUid.value = '';

    const dateInput = document.getElementById('date-entrada');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    setupSubmitButton('Salvar Entrada');
    updateTypePill();
    loadTeamData();
}

function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    editingTaskId = null;
    if (form) form.reset();
    updateTypePill();
}

// ==========================================================================
// 3. ABRIR PARA EDIÇÃO (ACESSO EXTERNO)
// ==========================================================================
window.openEditEntry = function(task) {
    if (!modal || !form) return;

    editingTaskId = task.id;
    modal.classList.remove('hidden');

    if (modalTitle) modalTitle.textContent = 'Editar Entrada';

    loadTeamData();
    fillForm(task);
    setupSubmitButton('Atualizar Dados');
};

// Preenche os inputs com base no name=""
function fillForm(data) {
    Array.from(form.elements).forEach(field => {
        if (field.type === 'file' || field.type === 'checkbox') return;
        if (field.name && data[field.name] !== undefined) {
            field.value = data[field.name];
        }
    });

    if (urgentInput) urgentInput.checked = !!data.isUrgent;
    if (hiddenPosUid) hiddenPosUid.value = data.posResponsavelUid || '';

    syncPosResponsavelUid();
    updateTypePill();
}

function syncPosResponsavelUid() {
    if (!selectPos || !hiddenPosUid) return;
    const selectedOption = selectPos.options[selectPos.selectedIndex];
    hiddenPosUid.value = selectedOption?.dataset?.uid || '';
}

function setupSubmitButton(text) {
    const btn = form?.querySelector('button[type="submit"]');
    if (btn) btn.innerHTML = `<i class="fas fa-save"></i> ${text}`;
}

// ==========================================================================
// 4. CARREGAR EQUIPE (DOCENTES E PÓS)
// ==========================================================================
async function loadTeamData() {
    if (!selectDocente || !selectPos) return;
    // Se o select já tem opções, assumimos que já foi carregado
    if (selectDocente.options.length > 1) return;

    try {
        // Busca todos os usuários e filtra client-side (compatível com role string ou array)
        const snapshot = await getDocs(collection(db, "users"));

        selectDocente.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        selectPos.innerHTML = '<option value="" disabled selected>Selecione...</option>';

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const userId = docSnap.id;
            const roles = Array.isArray(data.role)
                ? data.role.map(r => r.toLowerCase())
                : [(data.role || '').toLowerCase()];

            const createOption = () => {
                const opt = document.createElement('option');
                opt.value = data.name;
                opt.textContent = data.name;
                opt.dataset.uid = userId;
                return opt;
            };

            if (roles.includes('professor')) selectDocente.appendChild(createOption());
            if (roles.some(r => r.includes('graduando'))) selectPos.appendChild(createOption());
        });
    } catch (error) { console.error("Erro ao carregar equipe:", error); }
}

// ==========================================================================
// 5. SALVAR (CRIAÇÃO OU ATUALIZAÇÃO)
// ==========================================================================
async function saveEntry(e) {
    e.preventDefault();
    if (!form) return;

    const taskType = detectTypeFromProtocolo(protocoloInput?.value);
    if (!taskType) {
        alert('O protocolo define o tipo do caso. Use "V" para biópsia (ex: V-123/26) ou "VN" para necropsia (ex: VN-123/26).');
        protocoloInput?.focus();
        return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    btn.disabled = true;

    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        delete data.internalPhotos;

        syncPosResponsavelUid();
        data.posResponsavelUid = hiddenPosUid?.value || '';
        // O checkbox só entra no FormData quando marcado — lemos direto do input.
        data.isUrgent = !!urgentInput?.checked;

        const selectedPhotoFiles = Array.from(form.querySelector('input[name="internalPhotos"]')?.files || []);

        const uploadPhotosIfSelected = async (taskId) => {
            if (selectedPhotoFiles.length === 0) {
                return { uploaded: 0, error: null };
            }

            try {
                await uploadInternalPhotos(taskId, selectedPhotoFiles);
                return { uploaded: selectedPhotoFiles.length, error: null };
            } catch (uploadError) {
                console.error('Erro ao enviar fotos internas:', uploadError);
                return { uploaded: 0, error: uploadError };
            }
        };

        if (editingTaskId) {
            // --- MODO EDIÇÃO ---
            // A cor do cassete é gerenciada no Mural/Task Manager, então não é
            // sobrescrita aqui mesmo quando o protocolo muda de tipo.
            await updateDoc(doc(db, "tasks", editingTaskId), {
                ...data,
                protocolo: formatarProtocolo(data.protocolo),
                ...camposDerivados(data.protocolo),
                type: taskType,
                financialStatus: data.situacao || undefined,
                lastEditedAt: new Date().toISOString(),
                lastEditor: auth.currentUser ? auth.currentUser.uid : 'anon'
            });

            const photoUploadResult = await uploadPhotosIfSelected(editingTaskId);
            const uploadedMessage = photoUploadResult.uploaded > 0
                ? `\n\n${photoUploadResult.uploaded} foto(s) interna(s) enviada(s) para o Cloudinary.`
                : '';
            const uploadWarning = photoUploadResult.error
                ? `\n\nA entrada foi atualizada, mas houve falha no upload das fotos: ${photoUploadResult.error.message}`
                : '';

            alert(`Entrada atualizada com sucesso!${uploadedMessage}${uploadWarning}`);

            const updatedId = editingTaskId;
            closeModal();
            if (window.openTaskManager) window.openTaskManager(updatedId);
            return;
        }

        // --- MODO CRIAÇÃO ---
        const taskData = {
            ...data,
            // Grafia oficial (V001-26 / Vn001-26) + ano e peso da série, que são
            // o que o Livro de Registros usa para filtrar e ordenar.
            protocolo: formatarProtocolo(data.protocolo),
            ...camposDerivados(data.protocolo),
            type: taskType,
            k7Color: taskType === 'necropsia' ? 'azul' : 'rosa',
            k7Quantity: 0,
            financialStatus: data.situacao || 'pendente',
            createdBy: auth.currentUser ? auth.currentUser.uid : 'anon',
            createdAt: new Date().toISOString()
        };

        const createdRef = await addDoc(collection(db, "tasks"), taskData);

        const photoUploadResult = await uploadPhotosIfSelected(createdRef.id);
        const uploadedMessage = photoUploadResult.uploaded > 0
            ? `\n\n${photoUploadResult.uploaded} foto(s) interna(s) enviada(s) para o Cloudinary.`
            : '';
        const uploadWarning = photoUploadResult.error
            ? `\n\nA entrada foi criada, mas houve falha no upload das fotos: ${photoUploadResult.error.message}`
            : '';
        const urgentMessage = taskData.isUrgent ? '\n\nMarcada como URGENTE.' : '';

        alert(`Entrada de ${taskType.toUpperCase()} registrada!${urgentMessage}${uploadedMessage}${uploadWarning}`);
        closeModal();

    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

if (form) form.addEventListener('submit', saveEntry);
if (selectPos) selectPos.addEventListener('change', syncPosResponsavelUid);

updateTypePill();
