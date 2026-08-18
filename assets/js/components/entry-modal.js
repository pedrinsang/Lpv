import { db, auth } from '../core.js';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { camposDerivados, formatarProtocolo, parseProtocolo, montarProtocolo } from '../lib/protocolo.js';
import {
    prepararSerie, ultimoDaSerie, proximoDaSerie, protocoloJaUsado, registrarNaSerie
} from '../lib/serie-protocolo.js';
import { infoDoNivel } from '../lib/prioridade.js';
import { registrarCaso, moverCaso } from '../lib/livro-indice.js';
import { formatarContato } from '../lib/contato.js';

// --- ELEMENTOS DO DOM ---
const modal = document.getElementById('entry-modal');
const closeBtn = document.getElementById('close-modal-btn');
const openBtns = document.querySelectorAll('.btn-sidebar-new, .nav-fab');
const modalTitle = document.getElementById('entry-modal-title');

const form = document.getElementById('form-new-entry');
const protocoloInput = document.getElementById('entry-protocolo');
const urgentInput = document.getElementById('entry-urgent');
const priorityInput = document.getElementById('entry-priority');
const typePill = document.getElementById('entry-type-pill');
const typeText = document.getElementById('entry-type-text');
const serieHint = document.getElementById('entry-protocolo-serie');
const dateInput = document.getElementById('date-entrada');

const selectDocente = document.getElementById('select-docente');
const selectPos = document.getElementById('select-pos');
const hiddenPosUid = document.getElementById('select-pos-uid');

// --- ESTADO LOCAL ---
let editingTaskId = null; // null = Modo Criação | ID = Modo Edição
// Documento completo do caso em edição. O formulário só conhece os campos da
// entrada, mas o Livro de Registros precisa do caso inteiro (data do laudo,
// diagnóstico, releasedAt) para redesenhar a linha sem reler o Firestore — e o
// índice do livro precisa do protocolo antigo para mover a contagem de ano.
let editingTaskData = null;

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

// ==========================================================================
// 1b. NÚMERO SUGERIDO PELA SÉRIE
//
//     A numeração é sequencial por tipo e por ano, então o número seguinte é
//     dedutível: assim que o prefixo identifica a série (V ou VN), o campo se
//     completa com o último número usado + 1 — contando tanto o que já está no
//     Livro quanto as amostras ainda pendentes no Mural.
//
//     O trecho completado entra SELECIONADO, como faz o autocompletar do
//     navegador: aceitar é seguir em frente, recusar é digitar por cima. É isso
//     que deixa "V" virar "VN" sem atrapalhar — o "N" cai sobre a seleção, e a
//     sugestão se refaz para a série de necropsia.
// ==========================================================================

/**
 * O campo tem só o prefixo, sem número — é aqui que a sugestão entra. O
 * separador opcional cobre quem digita "VN-" antes do número.
 */
const SO_PREFIXO = /^\s*(vn|v)\s*[-–/]?\s*$/i;

/**
 * Ano da série. Sai da data de entrada (e não do relógio) para que uma amostra
 * lançada com atraso em janeiro continue recebendo o número da série do ano em
 * que entrou no laboratório.
 */
function anoDaSerie() {
    const ano = Number(String(dateInput?.value || '').slice(0, 4));
    return ano >= 1980 ? ano : new Date().getFullYear();
}

/** Mostra onde a série parou; sem tipo, esconde a linha. */
function mostrarSerie(tipo, ano) {
    if (!serieHint) return;

    if (!tipo) {
        serieHint.hidden = true;
        serieHint.textContent = '';
        return;
    }

    const ultimo = ultimoDaSerie(tipo, ano);
    const nome = tipo === 'necropsia' ? 'necropsia' : 'biópsia';

    serieHint.textContent = ultimo
        ? `Última ${nome} registrada: ${montarProtocolo(tipo, ultimo, ano)}. Digite por cima para usar outro número.`
        : `Nenhuma ${nome} na série de ${String(ano).slice(-2)} ainda — a numeração começa em 001.`;
    serieHint.hidden = false;
}

async function sugerirNumero() {
    if (!protocoloInput) return;

    // Em edição o protocolo já é o do caso: renumerar aqui trocaria a
    // identidade de uma amostra que já existe.
    if (editingTaskId) return;

    const prefixo = protocoloInput.value.match(SO_PREFIXO);
    if (!prefixo) {
        mostrarSerie(null);
        return;
    }

    const tipo = prefixo[1].toUpperCase() === 'VN' ? 'necropsia' : 'biopsia';
    const ano = anoDaSerie();

    // Sem a varredura não há série conhecida — e chutar o 001 faria a pessoa
    // repetir um protocolo. Nesse caso o campo fica como ela digitou.
    const serie = await prepararSerie();
    if (!serie) return;

    // A varredura é assíncrona: entre pedir e receber, a pessoa pode ter
    // continuado a digitar (ou desistido do campo). Só completa se o campo
    // ainda estiver esperando exatamente esta sugestão.
    if (document.activeElement !== protocoloInput) return;
    const agora = protocoloInput.value.match(SO_PREFIXO);
    if (!agora || agora[1].toUpperCase() !== prefixo[1].toUpperCase()) return;

    const sugestao = proximoDaSerie(tipo, ano);
    const sigla = tipo === 'necropsia' ? 'Vn' : 'V';

    protocoloInput.value = sugestao;
    protocoloInput.setSelectionRange(sigla.length, sugestao.length);

    updateTypePill();
    mostrarSerie(tipo, ano);
}

if (protocoloInput) {
    protocoloInput.addEventListener('input', (evento) => {
        updateTypePill();

        // Apagar não pode chamar a sugestão de volta: o número reapareceria a
        // cada Backspace e o campo ficaria impossível de limpar.
        if (String(evento.inputType || '').startsWith('delete')) {
            mostrarSerie(null);
            return;
        }

        sugerirNumero();
    });
}

// ==========================================================================
// 1c. NÍVEL DE PRIORIDADE
//
//     Urgente e prioritária são degraus da mesma escala, então marcar os dois
//     não quer dizer nada: marcar um desmarca o outro. São dois checkboxes e
//     não um select porque o normal é a amostra comum — nenhum dos dois — e
//     assim esse caso continua sendo não fazer nada.
// ==========================================================================
function exclusividadeDosNiveis(marcado, outro) {
    if (!marcado || !outro) return;
    marcado.addEventListener('change', () => {
        if (marcado.checked) outro.checked = false;
    });
}

exclusividadeDosNiveis(urgentInput, priorityInput);
exclusividadeDosNiveis(priorityInput, urgentInput);

// ==========================================================================
// 1d. CONTATO: TELEFONE OU E-MAIL NO MESMO CAMPO
//
//     A forma só pode ser imposta quando a pessoa termina de escrever, e não a
//     cada tecla: enquanto ela digita, "123" tanto pode virar um telefone
//     quanto o começo de "123joao@ufsm.br". Formatar durante a digitação
//     encheria o e-mail de parênteses que ficariam lá depois do "@" chegar.
//     Por isso a normalização acontece na saída do campo.
// ==========================================================================
const CAMPOS_CONTATO = ['remetenteContato', 'proprietarioContato'];

CAMPOS_CONTATO.forEach((nome) => {
    const campo = form && form.elements[nome];
    if (!campo) return;
    campo.addEventListener('blur', () => {
        campo.value = formatarContato(campo.value);
    });
});

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
    editingTaskData = null;
    modal.classList.remove('hidden');

    if (modalTitle) modalTitle.textContent = 'Nova Entrada';

    form.reset();
    if (hiddenPosUid) hiddenPosUid.value = '';

    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    setupSubmitButton('Salvar Entrada');
    updateTypePill();
    mostrarSerie(null);
    // Adianta a varredura da série para que o número já esteja pronto quando a
    // pessoa terminar de digitar o prefixo.
    prepararSerie();
    loadTeamData();
}

function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    editingTaskId = null;
    editingTaskData = null;
    if (form) form.reset();
    updateTypePill();
    mostrarSerie(null);
}

// ==========================================================================
// 3. ABRIR PARA EDIÇÃO (ACESSO EXTERNO)
// ==========================================================================
window.openEditEntry = function(task) {
    if (!modal || !form) return;

    editingTaskId = task.id;
    editingTaskData = { ...task };
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
    if (priorityInput) priorityInput.checked = !!data.isPriority && !data.isUrgent;
    if (hiddenPosUid) hiddenPosUid.value = data.posResponsavelUid || '';

    syncPosResponsavelUid();
    updateTypePill();
    mostrarSerie(null);
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

    // O protocolo tem que ser legível por inteiro, não só ter o prefixo certo: o
    // número e o ano da série são o que põe o caso num ano do Livro de Registros.
    // Sem eles a amostra é cadastrada mas cai no balde “Sem ano” do livro.
    const protocoloLido = parseProtocolo(protocoloInput?.value);
    if (!protocoloLido) {
        alert('Protocolo inválido.\n\nUse "V" para biópsia e "VN" para necropsia, seguidos do número e do ano da série:\nV-123/26, V123-26, VN-7/2026.');
        protocoloInput?.focus();
        return;
    }
    const taskType = protocoloLido.tipo;

    // A sugestão trabalha com o que a última varredura viu; se alguém cadastrou
    // o mesmo número em outra máquina nesse meio-tempo, o número repetido só
    // apareceria depois, no Livro, com dois casos disputando a mesma linha.
    // O aviso é conferência, não trava: repetir pode ser proposital (recadastro
    // de um caso excluído, por exemplo).
    if (!editingTaskId && protocoloJaUsado(protocoloInput?.value)) {
        const formatado = formatarProtocolo(protocoloInput.value);
        const seguir = confirm(
            `Já existe um caso com o protocolo ${formatado}.\n\nDeseja cadastrar assim mesmo?`
        );
        if (!seguir) {
            protocoloInput?.focus();
            return;
        }
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    btn.disabled = true;

    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        syncPosResponsavelUid();
        data.posResponsavelUid = hiddenPosUid?.value || '';
        // Rede de segurança para quem cola o número e envia sem sair do campo:
        // o `blur` não chega a acontecer e o telefone iria cru para o Firestore.
        CAMPOS_CONTATO.forEach((nome) => { data[nome] = formatarContato(data[nome]); });
        // O checkbox só entra no FormData quando marcado — lemos direto do input.
        data.isUrgent = !!urgentInput?.checked;
        data.isPriority = !data.isUrgent && !!priorityInput?.checked;

        if (editingTaskId) {
            // --- MODO EDIÇÃO ---
            // A cor do cassete é gerenciada no Mural/Task Manager, então não é
            // sobrescrita aqui mesmo quando o protocolo muda de tipo.
            const alteracoes = {
                ...data,
                protocolo: formatarProtocolo(data.protocolo),
                ...camposDerivados(data.protocolo),
                type: taskType,
                financialStatus: data.situacao || undefined,
                lastEditedAt: new Date().toISOString(),
                lastEditor: auth.currentUser ? auth.currentUser.uid : 'anon'
            };

            const updatedId = editingTaskId;
            const anterior = { ...(editingTaskData || {}) };
            const casoCompleto = { ...anterior, ...alteracoes, id: updatedId };

            await updateDoc(doc(db, "tasks", updatedId), alteracoes);
            registrarNaSerie(alteracoes.protocolo);

            // Corrigir o protocolo pode mudar o ano da série ou o tipo do caso,
            // e o índice do livro conta por ano e por tipo: sem mover a
            // contagem, o caso passa a ser oferecido num ano e contado noutro.
            await moverCaso(anterior, casoCompleto);

            // Mural e Hub se corrigem pelo onSnapshot; o Livro de Registros lê
            // por ano e guarda em cache, então precisa do aviso para não deixar
            // a linha antiga na tela.
            document.dispatchEvent(new CustomEvent('lpv:caso-atualizado', {
                detail: { id: updatedId, task: casoCompleto }
            }));

            alert('Entrada atualizada com sucesso!');

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

        const criado = await addDoc(collection(db, "tasks"), taskData);

        // O próximo cadastro já sai com o número seguinte, sem esperar a
        // próxima varredura da série.
        registrarNaSerie(taskData.protocolo);

        // A amostra entra no Livro de Registros agora, com tudo o que a entrada
        // sabe dela; a liberação só acrescenta a data do laudo e o diagnóstico à
        // linha que já está lá. Por isso o índice do livro (que monta o filtro
        // de ano e os contadores do acervo) é somado aqui, e não na liberação.
        await registrarCaso(taskData);

        // Mural e Hub escutam o Firestore e veem o caso sozinhos. O Livro lê por
        // ano e guarda em cache, de propósito: sem este aviso, a amostra recém
        // cadastrada só apareceria lá na próxima recarga da página.
        document.dispatchEvent(new CustomEvent('lpv:caso-criado', {
            detail: { id: criado.id, task: { ...taskData, id: criado.id } }
        }));

        const nivel = infoDoNivel(taskData);
        const avisoNivel = nivel ? `\n\nMarcada como ${nivel.rotulo.toUpperCase()}.` : '';

        alert(`Entrada de ${taskType.toUpperCase()} registrada!${avisoNivel}`);
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
