import { db, auth } from '../core.js';
import { 
    collection, 
    addDoc, 
    getDocs,
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Elementos
const modal = document.getElementById('entry-modal');
const closeBtn = document.getElementById('close-modal-btn');
const formV = document.getElementById('form-new-v');
const dateInput = document.getElementById('date-v');
const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');

// Novos Selects Separados
const selectDocente = document.getElementById('select-docente');
const selectPos = document.getElementById('select-pos');

const displayCode = document.getElementById('display-code');
const hiddenCodeInput = document.getElementById('generated-access-code');

// Botões que abrem o modal
const openBtns = document.querySelectorAll('.btn-sidebar-new, .nav-fab');

// --- 1. ABRIR E FECHAR MODAL ---
openBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault(); // Previne qualquer comportamento padrão
        openModal();
    });
});

if (closeBtn) closeBtn.addEventListener('click', closeModal);

function openModal() {
    if (!modal) return;
    modal.classList.remove('hidden');
    
    const today = new Date().toISOString().split('T')[0];
    if (dateInput) dateInput.value = today;
    
    generateRandomCode();
    loadTeamData(); // Nova função de carga separada
}

function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    formV.reset();
}

// --- 2. SISTEMA DE ABAS ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
    });
});

// --- 3. CARREGAR EQUIPE (SEPARADA) ---
async function loadTeamData() {
    // Evita recarregar se já tiver opções (considerando o placeholder)
    if (selectDocente.options.length > 1 && selectPos.options.length > 1) return;

    try {
        // Busca APENAS Professores e Pós-graduandos (Admin fora)
        const q = query(
            collection(db, "users"), 
            where("role", "in", ["professor", "pós graduando"])
        );
        
        const snapshot = await getDocs(q);
        
        // Limpa e reseta os selects
        selectDocente.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        selectPos.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        
        // Itera e separa
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const role = (data.role || "").toLowerCase();
            const option = document.createElement('option');
            option.value = data.name;
            option.textContent = data.name;

            if (role === 'professor') {
                selectDocente.appendChild(option);
            } else if (role === 'pós graduando') {
                selectPos.appendChild(option);
            }
        });

    } catch (error) {
        console.error("Erro ao carregar equipe:", error);
        selectDocente.innerHTML = '<option disabled>Erro</option>';
        selectPos.innerHTML = '<option disabled>Erro</option>';
    }
}

// --- 4. GERAR CÓDIGO ALEATÓRIO ---
function generateRandomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
    let code = "LPV-";
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    if (displayCode) displayCode.textContent = code;
    if (hiddenCodeInput) hiddenCodeInput.value = code;
}

// --- 5. SALVAR NO FIRESTORE ---
if (formV) {
    formV.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = formV.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        btn.disabled = true;

        try {
            const formData = new FormData(formV);
            const data = Object.fromEntries(formData.entries());

            // Estrutura final do documento
            const taskData = {
                ...data, // Inclui docente e posGraduando automaticamente pelos 'name' dos inputs
                type: 'biopsia',
                status: 'clivagem',
                steps: {
                    macro: false,
                    clearing: false,
                    inclusion: false,
                    microtomy: false,
                    staining: false,
                    microscopy: false
                },
                createdBy: auth.currentUser.uid,
                createdAt: new Date()
            };

            await addDoc(collection(db, "tasks"), taskData);

            alert("Entrada registrada com sucesso!");
            closeModal();

        } catch (error) {
            console.error("Erro ao salvar:", error);
            alert("Erro ao salvar entrada: " + error.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}