import { auth, db, onAuthStateChanged } from '../core.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const usersListEl = document.getElementById('users-list');
const secretInput = document.getElementById('admin-secret-code');
const saveCodeBtn = document.getElementById('btn-save-code');
let allUsers = [];

// 1. Verificação de Segurança (Apenas Admin entra)
onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = "auth.html";

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== 'admin') {
        alert("Acesso negado.");
        window.location.href = "hub.html";
        return;
    }

    // Se passou, carrega tudo
    loadSecretCode();
    loadUsers();
});

// 2. Gerenciar Código Secreto
async function loadSecretCode() {
    const docRef = doc(db, "config", "registration");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        secretInput.value = docSnap.data().secretCode;
    } else {
        secretInput.value = "LPV2024"; // Default
    }
}

saveCodeBtn.addEventListener('click', async () => {
    const newCode = secretInput.value.trim();
    if (!newCode) return alert("O código não pode ser vazio.");
    
    try {
        await setDoc(doc(db, "config", "registration"), { secretCode: newCode });
        alert("Código atualizado com sucesso!");
    } catch (error) {
        console.error(error);
        alert("Erro ao salvar código.");
    }
});

// 3. Gerenciar Usuários
async function loadUsers() {
    usersListEl.innerHTML = '<p style="text-align: center;">Carregando...</p>';
    
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsers = [];
        querySnapshot.forEach((doc) => {
            allUsers.push({ id: doc.id, ...doc.data() });
        });
        renderUsers(allUsers);
    } catch (error) {
        console.error(error);
        usersListEl.innerHTML = '<p class="alert-message error">Erro ao carregar usuários.</p>';
    }
}

function renderUsers(users) {
    usersListEl.innerHTML = '';
    
    if (users.length === 0) {
        usersListEl.innerHTML = '<p style="text-align: center;">Nenhum usuário encontrado.</p>';
        return;
    }

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '10px';
        
        // Cor do status
        let statusColor = '#f57c00'; // Pendente
        if (user.status === 'aprovado') statusColor = '#00b894';
        if (user.status === 'bloqueado') statusColor = '#d32f2f';

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <h3 style="font-size: 1rem; font-weight: bold;">${user.name}</h3>
                    <p style="font-size: 0.85rem; color: var(--text-secondary);">${user.email}</p>
                    <span style="font-size: 0.75rem; background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 10px;">
                        ${user.status.toUpperCase()}
                    </span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 5px;">
                        ${user.role === 'admin' ? '(Admin)' : ''}
                    </span>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                ${user.status !== 'aprovado' ? 
                    `<button class="btn btn-primary" style="padding: 5px 10px; font-size: 0.8rem;" onclick="updateUserStatus('${user.id}', 'aprovado')">Aprovar</button>` : ''}
                
                ${user.status !== 'bloqueado' ? 
                    `<button class="btn btn-secondary" style="padding: 5px 10px; font-size: 0.8rem; color: #d32f2f; border-color: #d32f2f;" onclick="updateUserStatus('${user.id}', 'bloqueado')">Bloquear</button>` : ''}

                ${user.status === 'bloqueado' ? 
                     `<button class="btn btn-secondary" style="padding: 5px 10px; font-size: 0.8rem;" onclick="updateUserStatus('${user.id}', 'pendente')">Resetar</button>` : ''}
            </div>
        `;
        usersListEl.appendChild(div);
    });
}

// Expor função globalmente para o HTML acessar
window.updateUserStatus = async (uid, newStatus) => {
    if (!confirm(`Tem certeza que deseja mudar para: ${newStatus}?`)) return;

    try {
        await updateDoc(doc(db, "users", uid), { status: newStatus });
        // Atualiza localmente para não precisar recarregar
        const user = allUsers.find(u => u.id === uid);
        if (user) user.status = newStatus;
        renderUsers(allUsers);
    } catch (error) {
        console.error(error);
        alert("Erro ao atualizar status.");
    }
};

// Filtros
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); // CSS precisa de ajuste se quiser estilo active
        btn.classList.add('active'); // Adicione estilo .active no CSS se quiser visual
        
        const filter = btn.dataset.filter;
        if (filter === 'all') renderUsers(allUsers);
        else renderUsers(allUsers.filter(u => u.status === filter));
    });
});