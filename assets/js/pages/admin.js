import { db, auth, logout, normalizeRoles, hasAnyRole } from '../core.js';
import { 
    collection, 
    query, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Elementos
const pendingGrid = document.getElementById('pending-grid');
const pendingSection = document.getElementById('pending-section');
const activeGrid = document.getElementById('active-list');
const searchInput = document.getElementById('admin-search');

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    const btnLogoutSidebar = document.getElementById('btn-logout');
    const btnLogoutHeader = document.getElementById('logout-btn-header');
    if (btnLogoutSidebar) btnLogoutSidebar.addEventListener('click', logout);
    if (btnLogoutHeader) btnLogoutHeader.addEventListener('click', logout);
});

// --- SEGURANÇA ---
setTimeout(() => {
    if (window.currentUserRole) {
        checkPermission(window.currentUserRole);
    } else {
        const checkInterval = setInterval(() => {
            if (window.currentUserRole) {
                clearInterval(checkInterval);
                checkPermission(window.currentUserRole);
            }
        }, 500);
    }
}, 1000);

function checkPermission(role) {
    const roles = window.currentUserRoles || normalizeRoles(role);
    if (!roles.some(r => ['professor','admin','pós graduando','pos-graduando'].includes(r))) {
        alert("Acesso Negado: Área restrita.");
        window.location.href = 'hub.html';
    }
}

// --- DADOS EM TEMPO REAL ---
const q = query(collection(db, "users"));
let allUsers = [];

onSnapshot(q, (snapshot) => {
    const pending = [];
    const active = [];

    snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const user = { id: docSnap.id, ...data };
        if (data.status === 'pending') pending.push(user);
        else active.push(user);
    });

    allUsers = active; 
    renderPending(pending);
    renderActive(active);
}, (error) => {
    console.error("Erro:", error);
    activeGrid.innerHTML = `<div class="empty-state" style="color:var(--color-error)">Erro de permissão.</div>`;
});

// --- AUXILIAR: Iniciais do Nome ---
function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// --- RENDERIZAR PENDENTES ---
function renderPending(users) {
    if (users.length === 0) {
        pendingSection.classList.add('hidden');
        return;
    }
    
    pendingSection.classList.remove('hidden');
    pendingGrid.innerHTML = users.map(u => `
        <div class="admin-card pending fade-in">
            <div class="card-header">
                <div class="card-role" style="color:var(--color-warning); background:rgba(245, 158, 11, 0.1);">Pendente</div>
                <div class="card-date">${new Date(u.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</div>
            </div>
            
            <div class="card-body">
                <div class="user-avatar-initials" style="background:var(--bg-body); color:var(--text-tertiary); border-color:var(--color-warning);">?</div>
                <div class="user-details">
                    <div class="card-title">${u.name}</div>
                    <div class="card-subtitle"><i class="far fa-envelope"></i> ${u.email}</div>
                </div>
            </div>

            <div class="card-actions">
                <button class="btn btn-sm" style="background:#10b981; color:white; border:none; flex:1;" onclick="window.approveUser('${u.id}')">
                    <i class="fas fa-check"></i> Aprovar
                </button>
                <button class="btn btn-sm" style="background:#ef4444; color:white; border:none; width:40px;" onclick="window.deleteUser('${u.id}', '${u.name}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// --- RENDERIZAR ATIVOS ---
function renderActive(users) {
    if (users.length === 0) {
        activeGrid.innerHTML = '<div class="empty-state"><p>Nenhum membro ativo.</p></div>';
        return;
    }

    activeGrid.innerHTML = users.map(u => {
        const isMe = u.id === auth.currentUser?.uid;
        const initials = getInitials(u.name);
        const roles = normalizeRoles(u.role);
        const displayRole = roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' / ');
        
        return `
        <div class="admin-card fade-in">
            <div class="card-header">
                <div class="card-role">${displayRole}</div>
                ${isMe ? '<div class="card-date" style="font-weight:bold; color:var(--color-primary);">VOCÊ</div>' : `<div class="card-date">Membro</div>`}
            </div>
            
            <div class="card-body">
                <div class="user-avatar-initials">${initials}</div>
                <div class="user-details">
                    <div class="card-title">${u.name}</div>
                    <div class="card-subtitle"><i class="far fa-envelope"></i> ${u.email}</div>
                </div>
            </div>

            <div class="card-actions">
                <div class="role-checkboxes" style="display:flex;gap:8px;flex-wrap:wrap;flex:1;" ${isMe ? 'data-disabled="true"' : ''}>
                    <label class="role-check-label" style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer;color:var(--text-secondary);">
                        <input type="checkbox" value="estagiario" ${roles.includes('estagiario') ? 'checked' : ''}
                            onchange="window.toggleRole('${u.id}', this)" ${isMe ? 'disabled' : ''}> Estagiário
                    </label>
                    <label class="role-check-label" style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer;color:var(--text-secondary);">
                        <input type="checkbox" value="pós graduando" ${roles.includes('pós graduando') || roles.includes('pos-graduando') ? 'checked' : ''}
                            onchange="window.toggleRole('${u.id}', this)" ${isMe ? 'disabled' : ''}> Pós-Grad
                    </label>
                    <label class="role-check-label" style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer;color:var(--text-secondary);">
                        <input type="checkbox" value="professor" ${roles.includes('professor') ? 'checked' : ''}
                            onchange="window.toggleRole('${u.id}', this)" ${isMe ? 'disabled' : ''}> Professor
                    </label>
                    <label class="role-check-label" style="display:flex;align-items:center;gap:4px;font-size:.85rem;cursor:pointer;color:var(--text-secondary);">
                        <input type="checkbox" value="admin" ${roles.includes('admin') ? 'checked' : ''}
                            onchange="window.toggleRole('${u.id}', this)" ${isMe ? 'disabled' : ''}> Admin
                    </label>
                </div>

                ${!isMe ? `
                <button class="btn-icon-action btn-delete" onclick="window.deleteUser('${u.id}', '${u.name}')" title="Remover Acesso">
                    <i class="fas fa-trash-alt" style="color:var(--color-error);"></i>
                </button>
                ` : '<div style="width:36px;"></div>'}
            </div>
        </div>
    `}).join('');
}

// --- BUSCA ---
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
            u.name.toLowerCase().includes(term) || 
            u.email.toLowerCase().includes(term)
        );
        renderActive(filtered);
    });
}

// --- FUNÇÕES GLOBAIS ---
window.approveUser = async (uid) => {
    if (!confirm("Aprovar este usuário?")) return;
    try { 
        console.log("Aprovando usuário:", uid);
        await updateDoc(doc(db, "users", uid), { 
            status: 'active', 
            role: ['estagiario'] 
        });
        console.log("Usuário aprovado com sucesso!");
        alert("Usuário aprovado com sucesso! ✓");
    } catch (e) { 
        console.error("Erro ao aprovar usuário:", e);
        alert("Erro ao aprovar: " + (e.message || "Erro desconhecido"));
    }
};

window.toggleRole = async (uid, checkbox) => {
    try {
        // Encontra todos os checkboxes deste card
        const container = checkbox.closest('.role-checkboxes');
        const checked = Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
        if (checked.length === 0) {
            alert('O usuário precisa ter pelo menos uma role.');
            checkbox.checked = true;
            return;
        }
        await updateDoc(doc(db, "users", uid), { role: checked });
    } catch (e) {
        alert("Erro ao mudar cargo.");
        console.error(e);
    }
};

window.updateRole = async (uid, newRole) => {
    try { await updateDoc(doc(db, "users", uid), { role: Array.isArray(newRole) ? newRole : [newRole] }); } 
    catch (e) { alert("Erro ao mudar cargo."); }
};

window.deleteUser = async (uid, name) => {
    if (!confirm(`Remover ${name} do sistema?\nEssa ação é irreversível.`)) return;
    try { await deleteDoc(doc(db, "users", uid)); } 
    catch (e) { alert("Erro ao remover."); }
};