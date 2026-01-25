import { db, auth } from '../core.js';
import { 
    collection, 
    addDoc, 
    getDocs,
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('entry-modal');
const closeBtn = document.getElementById('close-modal-btn');
const openBtns = document.querySelectorAll('.btn-sidebar-new, .nav-fab');

// Forms
const formV = document.getElementById('form-new-v');
const formVn = document.getElementById('form-new-vn'); // Se você criar o form Vn no futuro

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


// --- 1. ABRIR E FECHAR MODAL ---
openBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });
});

if (closeBtn) closeBtn.addEventListener('click', closeModal);

function openModal() {
    if (!modal) return;
    modal.classList.remove('hidden');
    
    // Define data de hoje
    const today = new Date().toISOString().split('T')[0];
    if (dateInputV) dateInputV.value = today;
    
    generateRandomCode();
    loadTeamData();
}

function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    if(formV) formV.reset();
    if(formVn) formVn.reset();
}


// --- 2. SISTEMA DE ABAS ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active de tudo
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        // Ativa o clicado
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        const targetContent = document.getElementById(targetId);
        if(targetContent) targetContent.classList.add('active');
    });
});


// --- 3. CARREGAR EQUIPE (DOCENTES E PÓS) ---
async function loadTeamData() {
    // Evita recarregar se já tiver opções carregadas
    if (selectDocente && selectDocente.options.length > 1) return;

    try {
        const q = query(
            collection(db, "users"), 
            where("role", "in", ["professor", "pós graduando"])
        );
        
        const snapshot = await getDocs(q);
        
        // Limpa selects
        if(selectDocente) selectDocente.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        if(selectPos) selectPos.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || "").toLowerCase();
            
            const option = document.createElement('option');
            option.value = data.name;
            option.textContent = data.name;

            if (role === 'professor' && selectDocente) {
                selectDocente.appendChild(option);
            } else if ((role === 'pós graduando' || role === 'pos-graduando') && selectPos) {
                selectPos.appendChild(option);
            }
        });

    } catch (error) {
        console.error("Erro ao carregar equipe:", error);
    }
}


// --- 4. GERAR CÓDIGO ALEATÓRIO ---
window.generateRandomCode = function() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
    let code = "LPV-";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    if (displayCode) displayCode.textContent = code;
    if (hiddenCodeInput) hiddenCodeInput.value = code;
    return code;
}


// --- 5. FUNÇÃO DE SALVAR UNIFICADA (LÓGICA AUTOMÁTICA) ---
async function saveEntry(e, originType) {
    e.preventDefault();
    
    // Seleciona o formulário correto
    const form = originType === 'v' ? formV : formVn;
    if (!form) return;

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    
    // Feedback visual
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // --- DEFINIÇÃO AUTOMÁTICA DE TIPO E COR ---
        let taskType = 'biopsia'; // Padrão
        let initialColor = 'rosa'; // Padrão

        if (originType === 'vn') {
            taskType = 'necropsia';
            initialColor = 'azul';
        }

        // Estrutura do Documento
        const taskData = {
            ...data,
            type: taskType,         // Define automaticamente
            k7Color: initialColor,  // Define automaticamente
            k7Quantity: 0,          // Será definido na clivagem
            status: 'clivagem',     // Etapa inicial
            createdBy: auth.currentUser ? auth.currentUser.uid : 'anon',
            createdAt: new Date().toISOString() // Formato String ISO para ordenar fácil
        };

        // Salva no Firestore
        await addDoc(collection(db, "tasks"), taskData);

        alert(`Entrada de ${taskType.toUpperCase()} registrada com sucesso!`);
        closeModal();
        
        // Gera novo código para a próxima
        generateRandomCode();

    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar entrada: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// --- 6. LISTENERS DE SUBMIT ---

// Formulário V (Biópsia)
if (formV) {
    formV.addEventListener('submit', (e) => saveEntry(e, 'v'));
}

// Formulário Vn (Necropsia) - Caso você adicione no HTML futuramente
if (formVn) {
    formVn.addEventListener('submit', (e) => saveEntry(e, 'vn'));
}