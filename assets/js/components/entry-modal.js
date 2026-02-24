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


// Selects de Equipe (Agora capturando de ambos os formulários)
const selectsDocente = document.querySelectorAll('#select-docente, #select-docente-vn');
const selectsPos = document.querySelectorAll('#select-pos, #select-pos-vn');

// Código Aleatório (Capturando múltiplos displays e inputs hidden)
const displayCodes = document.querySelectorAll('#display-code, #display-code-vn');
const hiddenCodeInputs = document.querySelectorAll('#generated-access-code, #generated-access-code-vn');
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
    
    editingTaskId = null; 
    modal.classList.remove('hidden');

    // Ativa a aba padrão (primeira)
    const defaultTab = document.querySelector('.tab-btn[data-tab="tab-v"]');
    if (defaultTab) defaultTab.click();

    // Reseta ambos os formulários
    [formV, formVn].forEach(f => {
        if(f) {
            f.reset();
            setupSubmitButton(f, f.id === 'form-new-v' ? 'Salvar Entrada' : 'Salvar Necropsia');
        }
    });

    // Seta data de hoje para ambos os campos de data
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('#date-v, #date-vn');
    dateInputs.forEach(i => i.value = today);

    generateRandomCode();
    loadTeamData();
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
    // Se o primeiro select já tem opções, assumimos que já foi carregado
    if (selectsDocente[0] && selectsDocente[0].options.length > 1) return;

    try {
        const q = query(
            collection(db, "users"), 
            where("role", "in", ["professor", "pós graduando"])
        );
        
        const snapshot = await getDocs(q);
        
        // Limpa todos os selects antes de popular
        selectsDocente.forEach(s => s.innerHTML = '<option value="" disabled selected>Selecione...</option>');
        selectsPos.forEach(s => s.innerHTML = '<option value="" disabled selected>Selecione...</option>');
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || "").toLowerCase();
            
            const createOption = () => {
                const opt = document.createElement('option');
                opt.value = data.name;
                opt.textContent = data.name;
                return opt;
            };

            if (role === 'professor') {
                selectsDocente.forEach(s => s.appendChild(createOption()));
            } else if (role.includes('graduando')) {
                selectsPos.forEach(s => s.appendChild(createOption()));
            }
        });
    } catch (error) { console.error("Erro ao carregar equipe:", error); }
}

// ==========================================================================
// 5. GERAR CÓDIGO
// ==========================================================================
window.generateRandomCode = function() {
    if (editingTaskId) return; 

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
    let code = "LPV-";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Atualiza todos os locais onde o código deve aparecer
    displayCodes.forEach(el => el.textContent = code);
    hiddenCodeInputs.forEach(el => el.value = code);
    
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