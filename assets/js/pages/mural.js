import { db } from '../core.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const list = document.getElementById('mural-list');

async function loadMural() {
    try {
        const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        list.innerHTML = '';
        if (snapshot.empty) {
            list.innerHTML = '<div style="text-align:center; padding:2rem;">Nenhuma tarefa encontrada.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const t = doc.data();
            const html = `
                <div class="sample-ticket">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="width:40px; height:40px; background:var(--bg-glass-heavy); border-radius:50%; display:flex; align-items:center; justify-content:center;">
                            <i class="fas fa-vial" style="color:var(--color-primary);"></i>
                        </div>
                        <div>
                            <div style="font-weight:700;">${t.title || 'Tarefa'}</div>
                            <div style="font-size:0.8rem; opacity:0.7;">${t.patientName || 'N/A'}</div>
                        </div>
                    </div>
                    <div class="ticket-status-badge badge-process">${t.status}</div>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', html);
        });
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div style="text-align:center;">Erro ao carregar.</div>';
    }
}
loadMural();