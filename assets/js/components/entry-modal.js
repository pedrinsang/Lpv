import { db, auth } from '../core.js';
import { 
    collection, 
    addDoc, 
    updateDoc,
    doc,
    getDocs,
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log("Entry Modal Module Loaded - vFinal (Create/Edit Unified)");

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('entry-modal');
const closeBtn = document.getElementById('close-modal-btn');
const openBtns = document.querySelectorAll('.btn-sidebar-new, .nav-fab');
const modalTitle = document.querySelector('#entry-modal h3'); 

// Forms
const formV = document.getElementById('form-new-v');   // Form Biópsia
const formVn = document.getElementById('form-new-vn'); // Form Necropsia

// Inputs Gerais
const dateInputV = document.getElementById('date-v');
const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');

// Selects de Equipe
const selectDocente = document.getElementById('select-docente');
const selectPos = document.getElementById('select-pos');

// Código Aleatório
const displayCode = document.getElementById('display-code');
const hiddenCodeInput = document.getElementById('generated-access-code');

// --- ESTADO LOCAL ---
let editingTaskId = null; // null = Modo Criação | ID = Modo Edição

// ==========================================================================
// 1. ABRIR E FECHAR MODAL (MODO CRIAÇÃO)
// ==========================================================================
openBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal(); // Abre como Nova Entrada
    });
});

if (closeBtn) closeBtn.addEventListener('click', closeModal);

function openModal() {
    if (!modal) return;
    
    // RESET PARA MODO CRIAÇÃO
    editingTaskId = null; 
    if(modalTitle) modalTitle.textContent = "Nova Entrada";
    
    modal.classList.remove('hidden');
    
    // Reseta formulários
    if(formV) { formV.reset(); setupSubmitButton(formV, 'Salvar Entrada'); }
    if(formVn) { formVn.reset(); setupSubmitButton(formVn, 'Salvar Entrada'); }

    // Define data de hoje no campo data (se existir)
    const today = new Date().toISOString().split('T')[0];
    if (dateInputV) dateInputV.value = today;
    
    // Gera novo código
    generateRandomCode();
    loadTeamData();
    
    // Reseta para a primeira aba (Biópsia)
    if(tabs[0]) tabs[0].click();
}

function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    editingTaskId = null;
    if(formV) formV.reset();
    if(formVn) formVn.reset();
}

// ==========================================================================
// 2. ABRIR PARA EDIÇÃO (ACESSO EXTERNO)
// ==========================================================================
window.openEditEntry = function(task) {
    if (!modal) return;

    editingTaskId = task.id; // Marca que estamos editando
    modal.classList.remove('hidden');

    if(modalTitle) modalTitle.textContent = "Editar Entrada";

    loadTeamData(); // Carrega lista de veterinários

    // Detecta o tipo e preenche o formulário correto
    const type = task.type || 'biopsia';
    
    if (type === 'necropsia') {
        // Clica na aba de necropsia
        const tabN = document.querySelector('[data-tab="tab-necropsia"]');
        if (tabN) tabN.click();
        fillForm(formVn, task);
        setupSubmitButton(formVn, 'Atualizar Dados');
    } else {
        // Clica na aba de biópsia
        const tabB = document.querySelector('[data-tab="tab-biopsia"]');
        if (tabB) tabB.click();
        fillForm(formV, task);
        setupSubmitButton(formV, 'Atualizar Dados');
    }
    
    // Mostra o código existente (não gera novo)
    if(displayCode) displayCode.textContent = task.accessCode || '---';
}

// Preenche os inputs com base no name=""
function fillForm(form, data) {
    if(!form) return;
    Array.from(form.elements).forEach(field => {
        if (field.name && data[field.name] !== undefined) {
            field.value = data[field.name];
        }
    });
    // Garante que o input hidden do código receba o valor
    const codeInput = form.querySelector('[name="accessCode"]');
    if(codeInput && data.accessCode) codeInput.value = data.accessCode;
}

function setupSubmitButton(form, text) {
    const btn = form.querySelector('button[type="submit"]');
    if(btn) btn.innerHTML = `<i class="fas fa-save"></i> ${text}`;
}

// ==========================================================================
// 3. SISTEMA DE ABAS
// ==========================================================================
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        const targetContent = document.getElementById(targetId);
        if(targetContent) targetContent.classList.add('active');
    });
});

// ==========================================================================
// 4. CARREGAR EQUIPE (DOCENTES E PÓS)
// ==========================================================================
async function loadTeamData() {
    if (selectDocente && selectDocente.options.length > 1) return; // Evita recarregar sem necessidade

    try {
        const q = query(
            collection(db, "users"), 
            where("role", "in", ["professor", "pós graduando"])
        );
        
        const snapshot = await getDocs(q);
        
        if(selectDocente) selectDocente.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        if(selectPos) selectPos.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || "").toLowerCase();
            const option = document.createElement('option');
            option.value = data.name;
            option.textContent = data.name;

            if (role === 'professor' && selectDocente) selectDocente.appendChild(option);
            else if ((role.includes('graduando')) && selectPos) selectPos.appendChild(option);
        });
    } catch (error) { console.error("Erro equipe:", error); }
}

// ==========================================================================
// 5. GERAR CÓDIGO
// ==========================================================================
window.generateRandomCode = function() {
    if (editingTaskId) return; // Não muda código na edição

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
    let code = "LPV-";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    if (displayCode) displayCode.textContent = code;
    if (hiddenCodeInput) hiddenCodeInput.value = code;
    return code;
}

// ==========================================================================
// 6. SALVAR (CRIAÇÃO OU ATUALIZAÇÃO)
// ==========================================================================
async function saveEntry(e, originType) {
    e.preventDefault();
    
    const form = originType === 'v' ? formV : formVn;
    if (!form) return;

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    btn.disabled = true;

    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        if (editingTaskId) {
            // --- MODO EDIÇÃO ---
            await updateDoc(doc(db, "tasks", editingTaskId), {
                ...data,
                financialStatus: data.situacao || undefined,
                lastEditedAt: new Date().toISOString(),
                lastEditor: auth.currentUser ? auth.currentUser.uid : 'anon'
            });
            alert("Entrada atualizada com sucesso!");
            
            // Atualiza a tela de detalhes se estiver aberta
            if(window.openTaskManager) window.openTaskManager(editingTaskId); 
            closeModal();

        } else { 
            // --- MODO CRIAÇÃO ---
            let taskType = 'biopsia'; 
            let initialColor = 'rosa'; 

            if (originType === 'vn') {
                taskType = 'necropsia';
                initialColor = 'azul';
            }

            const taskData = {
                ...data,
                type: taskType,         
                k7Color: initialColor,  
                k7Quantity: 0,          
                status: 'clivagem',
                financialStatus: data.situacao || 'pendente',
                createdBy: auth.currentUser ? auth.currentUser.uid : 'anon',
                createdAt: new Date().toISOString() 
            };

            await addDoc(collection(db, "tasks"), taskData);
            alert(`Entrada de ${taskType.toUpperCase()} registrada!`);
            closeModal();
            generateRandomCode();
        }

    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Listeners de Envio
if (formV) formV.addEventListener('submit', (e) => saveEntry(e, 'v'));
if (formVn) formVn.addEventListener('submit', (e) => saveEntry(e, 'vn'));