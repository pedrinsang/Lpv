import { db } from '../core.js';
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ALTERAÇÃO: Importa nova função PDF
import { generateLaudoPDF } from '../components/docx-generator.js';

console.log("Public Results Loaded - PDF Enabled");

const searchInput = document.getElementById('access-code'); 
const searchBtn = document.getElementById('btn-search');
const resultContainer = document.getElementById('result-container');
const btnDownload = document.getElementById('btn-download-public');

let foundTask = null;

if (searchBtn) {
    searchBtn.addEventListener('click', handleSearch);
}

if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
}

async function handleSearch() {
    const code = searchInput.value.trim(); 
    
    if (!code) return alert("Por favor, digite o código de acesso.");

    const originalBtnContent = searchBtn.innerHTML;
    searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    searchBtn.disabled = true;

    try {
        const q = query(collection(db, "tasks"), where("accessCode", "==", code));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert("Protocolo não encontrado. Verifique o código.");
            resultContainer.classList.add('hidden');
        } else {
            foundTask = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
            renderResult(foundTask);
        }

    } catch (error) {
        console.error("Erro busca:", error);
        alert("Erro ao buscar. Tente novamente.");
    } finally {
        searchBtn.innerHTML = originalBtnContent;
        searchBtn.disabled = false;
    }
}

function renderResult(task) {
    resultContainer.classList.remove('hidden');

    document.getElementById('res-pet-name').innerText = task.animalNome || "Pet";
    document.getElementById('res-owner').innerText = `Tutor: ${task.proprietario || "---"}`;
    
    const dateStr = task.dataEntrada 
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR') 
        : new Date(task.createdAt).toLocaleDateString('pt-BR');
    document.getElementById('res-date').innerText = dateStr;

    updateStepper(task);
}

function updateStepper(task) {
    const status = task.status || 'clivagem'; 
    const finStatus = task.financialStatus || 'pendente';

    let currentStep = 1;
    const processingSteps = ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao'];
    const analysisSteps = ['analise', 'liberar'];

    if (processingSteps.includes(status)) currentStep = 2;
    else if (analysisSteps.includes(status)) currentStep = 3;
    else if (status === 'concluido') currentStep = 4;

    document.querySelectorAll('.step-item').forEach(el => el.className = 'step-item');
    const progressLine = document.getElementById('progress-line');
    const msgBox = document.getElementById('status-message');
    const step4Label = document.getElementById('label-step-4');
    const step4Icon = document.querySelector('#step-4 .step-circle i');

    if (currentStep === 1) {
        setStepStatus(1, 'active');
        progressLine.style.width = '15%';
        msgBox.innerHTML = "Amostra recebida. Aguardando processamento.";
        btnDownload.classList.add('hidden');
        step4Label.innerText = "Laudo";
    }
    else if (currentStep === 2) {
        setStepStatus(1, 'completed'); setStepStatus(2, 'active');
        progressLine.style.width = '40%';
        msgBox.innerHTML = "Em processamento técnico (laboratório).";
        btnDownload.classList.add('hidden');
        step4Label.innerText = "Laudo";
    }
    else if (currentStep === 3) {
        setStepStatus(1, 'completed'); setStepStatus(2, 'completed'); setStepStatus(3, 'active');
        progressLine.style.width = '65%';
        msgBox.innerHTML = "Em análise pelo patologista.";
        btnDownload.classList.add('hidden');
        step4Label.innerText = "Laudo";
    }
    else if (currentStep === 4) {
        setStepStatus(1, 'completed'); setStepStatus(2, 'completed'); setStepStatus(3, 'completed');
        progressLine.style.width = '100%';

        if (finStatus === 'pendente') {
            setStepStatus(4, 'warning');
            step4Label.innerText = "Pagamento";
            step4Icon.className = "fas fa-exclamation-triangle";
            msgBox.innerHTML = `<span style="color:#f59e0b; font-weight:bold;">Pagamento Pendente.</span> Entre em contato para liberar o laudo.`;
            btnDownload.classList.add('hidden');
        } else {
            setStepStatus(4, 'success');
            step4Label.innerText = "Liberado";
            step4Icon.className = "fas fa-check";
            msgBox.innerHTML = `<span style="color:#10b981; font-weight:bold;">Laudo Disponível!</span>`;
            
            // ALTERAÇÃO: Texto do botão para PDF
            btnDownload.innerHTML = '<i class="fas fa-file-pdf"></i> BAIXAR LAUDO (PDF)';
            btnDownload.classList.remove('hidden');
        }
    }
}

function setStepStatus(stepNum, status) {
    const el = document.getElementById(`step-${stepNum}`);
    if (el) el.classList.add(status);
}

if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
        if (!foundTask) return;
        
        const originalText = btnDownload.innerHTML;
        btnDownload.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GERANDO PDF...';
        btnDownload.disabled = true;

        try {
            const reportData = foundTask.report || {};
            const finalData = { ...reportData, ...foundTask };
            // ALTERAÇÃO: Chama geração PDF
            await generateLaudoPDF(foundTask, finalData);
        } catch (e) {
            console.error(e);
            alert("Erro ao baixar: " + e.message);
        } finally {
            btnDownload.innerHTML = originalText;
            btnDownload.disabled = false;
        }
    });
}