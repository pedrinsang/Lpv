/**
 * LÂMINAS — produção de corte e coloração.
 *
 * A bancada corta e cora lâminas o dia inteiro, várias de um protocolo só, e
 * quase sempre de vários protocolos na mesma ida ao micrótomo. Lançar uma
 * lâmina por vez seria trabalho novo em cima do trabalho; por isso a unidade
 * daqui é a **leva**: a pessoa monta a lista de protocolos com a quantidade de
 * cada um e lança tudo de uma vez.
 *
 * Cada protocolo da leva vira um documento em `slide_records`, e todos carregam
 * o mesmo `loteId`. É o que permite desfazer a leva inteira com um toque sem
 * precisar de um documento de "lote" separado.
 *
 * O log é append-only, como o `inventory_events`: erro não se corrige com
 * update, se corrige desfazendo a leva e lançando de novo. As regras do
 * Firestore recusam update nesta coleção.
 *
 * Totais, quebra por pessoa e a fila de "cortadas esperando coloração" são
 * todos derivados desses documentos, somados no cliente. Nada é gravado
 * pré-somado — número pré-somado e log divergem no primeiro desfazer.
 */
import { auth, db, logout, hasAnyRole, ROLES_LAMINAS } from '../core.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { formatarProtocolo, montarProtocolo, parseProtocolo } from '../lib/protocolo.js';
import { CAMPO_REABERTO, laudoPendente } from '../lib/reabertura.js';

const DIA = 86400000;

/**
 * A janela que a página carrega: a série deste ano e a do ano passado.
 *
 * É o mesmo corte do Mural, e pelo mesmo motivo — ler a coleção inteira a cada
 * abertura é o que faz a conta de leitura crescer sem ninguém perceber. O `>=`
 * (em vez de uma lista de anos) faz a virada do ano funcionar sozinha.
 *
 * A consequência aparece no filtro "Tudo": ele mostra tudo o que está
 * carregado, e o rodapé do período diz desde quando. Lâmina cortada há dois
 * anos e nunca corada também sai da fila de pendências — o que é o
 * comportamento certo: aquilo não é mais pendência, é história.
 */
const PRIMEIRO_ANO_CARREGADO = () => new Date().getFullYear() - 1;

const ICONE_TIPO = { necropsia: 'fas fa-skull', biopsia: 'fas fa-microscope' };
const ROTULO_ACAO = { corte: 'cortadas', coloracao: 'coradas' };
const ICONE_ACAO = { corte: 'fas fa-scissors', coloracao: 'fas fa-droplet' };

const els = {
    bloqueio: document.getElementById('laminas-bloqueio'),
    conteudo: document.getElementById('laminas-conteudo'),
    tabs: document.querySelectorAll('.laminas-tabs button'),
    panes: {
        registro: document.getElementById('pane-registro'),
        historico: document.getElementById('pane-historico')
    },
    segAcao: document.getElementById('seg-acao'),
    segPeriodo: document.getElementById('seg-periodo'),
    protocolo: document.getElementById('lam-protocolo'),
    sugestoes: document.getElementById('lam-sugestoes'),
    sugestoesLista: document.getElementById('lam-sugestoes-lista'),
    qtd: document.getElementById('lam-qtd'),
    menos: document.getElementById('lam-menos'),
    mais: document.getElementById('lam-mais'),
    adicionar: document.getElementById('lam-adicionar'),
    responsavel: document.getElementById('lam-responsavel'),
    usuarios: document.getElementById('lam-usuarios'),
    leva: document.getElementById('lam-leva'),
    levaRotulo: document.getElementById('lam-leva-rotulo'),
    lancar: document.getElementById('lam-lancar'),
    lancarTexto: document.getElementById('lam-lancar-texto'),
    fila: document.getElementById('lam-fila'),
    filaTotal: document.getElementById('lam-fila-total'),
    resumo: document.getElementById('lam-resumo'),
    dados: document.getElementById('lam-dados'),
    vazio: document.getElementById('lam-vazio'),
    pessoas: document.getElementById('lam-pessoas'),
    log: document.getElementById('lam-log'),
    toast: document.getElementById('lam-toast'),
    headVn: document.getElementById('head-vn'),
    headV: document.getElementById('head-v'),
    headGeral: document.getElementById('head-geral')
};

const totais = {
    vnCorte: document.getElementById('total-vn-corte'),
    vnColoracao: document.getElementById('total-vn-coloracao'),
    vCorte: document.getElementById('total-v-corte'),
    vColoracao: document.getElementById('total-v-coloracao')
};

let usuarioAtual = null;
let podeLancar = false;
let registros = [];
let casosAbertos = [];
let leva = [];
let acao = 'corte';
let periodo = 'semana';
let ultimoChip = null;
let abertos = {};
let sugestoesVisiveis = [];
let toastTimer = null;
let pulseTimer = null;
let rafTween = null;
let exibidos = { vnCorte: 0, vnColoracao: 0, vCorte: 0, vColoracao: 0 };

// As três consultas do Mural, cada uma cobrindo um buraco da outra. Ver o
// comentário longo em pages/mural.js: ano recente, protocolo ilegível e
// reabertos de qualquer ano.
const fontesCasos = { recentes: [], semAno: [], reabertos: [] };


// ==========================================================================
// SESSÃO E PERMISSÃO
// ==========================================================================

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'auth.html';
        return;
    }

    usuarioAtual = user;

    const perfil = await getDoc(doc(db, 'users', user.uid));
    const dados = perfil.exists() ? perfil.data() : {};

    // Esconder o link do menu não é controle de acesso: quem digita o endereço
    // chega aqui do mesmo jeito. O corte de verdade é este.
    podeLancar = hasAnyRole(dados.role, ROLES_LAMINAS);
    if (!podeLancar) {
        els.conteudo?.classList.add('hidden');
        els.bloqueio?.classList.remove('hidden');
        document.getElementById('sidebar-laminas-link')?.classList.add('hidden');
        return;
    }

    els.responsavel.value = dados.name || '';
    carregarUsuarios();
    assinarRegistros();
    assinarCasosAbertos();
});

document.getElementById('btn-logout')?.addEventListener('click', logout);
document.getElementById('logout-btn-header')?.addEventListener('click', logout);


// ==========================================================================
// DADOS
// ==========================================================================

/** Nomes para o autocomplete do responsável — a equipe inteira, sem filtro de
 *  papel: quem corta lâmina não é só quem tem uma role específica. */
async function carregarUsuarios() {
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        const nomes = snapshot.docs
            .map((docSnap) => ({ uid: docSnap.id, nome: (docSnap.data().name || '').trim() }))
            .filter((u) => u.nome)
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        els.usuarios.innerHTML = nomes
            .map((u) => `<option value="${esc(u.nome)}" data-uid="${esc(u.uid)}"></option>`)
            .join('');
    } catch (erro) {
        console.warn('Não foi possível carregar a lista de responsáveis.', erro);
    }
}

function assinarRegistros() {
    const consulta = query(
        collection(db, 'slide_records'),
        where('ano', '>=', PRIMEIRO_ANO_CARREGADO())
    );

    onSnapshot(consulta, (snapshot) => {
        registros = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        renderTudo();
    }, (erro) => {
        console.warn('Não foi possível carregar a produção de lâminas.', erro);
        mostrarToast('Não foi possível carregar os lançamentos.', true);
    });
}

/** Casos com laudo pendente, para sugerir o protocolo enquanto se digita. */
function assinarCasosAbertos() {
    const consultas = {
        recentes: query(collection(db, 'tasks'), where('protocoloAno', '>=', PRIMEIRO_ANO_CARREGADO())),
        semAno: query(collection(db, 'tasks'), where('protocoloAno', '==', 0)),
        reabertos: query(collection(db, 'tasks'), where(CAMPO_REABERTO, '==', true))
    };

    Object.entries(consultas).forEach(([fonte, consulta]) => {
        onSnapshot(consulta, (snapshot) => {
            fontesCasos[fonte] = snapshot.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                .filter(laudoPendente);
            juntarCasos();
        }, (erro) => console.warn('Sugestões de protocolo indisponíveis.', erro));
    });
}

function juntarCasos() {
    const porId = new Map();
    [...fontesCasos.recentes, ...fontesCasos.semAno, ...fontesCasos.reabertos]
        .forEach((task) => porId.set(task.id, task));

    casosAbertos = [...porId.values()]
        .map((task) => {
            const lido = parseProtocolo(task.protocolo);
            if (!lido) return null;
            return {
                protocolo: formatarProtocolo(task.protocolo),
                tipo: lido.tipo,
                numero: lido.numero,
                ano: lido.ano,
                desc: descreverCaso(task)
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.ano - a.ano || b.numero - a.numero);
}

function descreverCaso(task) {
    return [task.especie, task.raca].map((v) => (v || '').trim()).filter(Boolean).join(' · ')
        || (task.animalNome || '').trim()
        || (task.proprietario || '').trim()
        || 'sem descrição';
}


// ==========================================================================
// LEITURA DO PROTOCOLO DIGITADO
// ==========================================================================

/**
 * Aceita a grafia completa ("V088-26", "VN-142/26") e também o atalho da
 * bancada: só o número, ou o número com a sigla mas sem ano ("142", "vn142").
 *
 * O atalho é resolvido contra os casos abertos, e é aí que ele para de ser um
 * chute: se existe um Vn142 e um V142 abertos, "142" é ambíguo e a página pede
 * a sigla em vez de escolher um dos dois no escuro.
 *
 * Devolve { protocolo, tipo } ou { erro }.
 */
function lerProtocolo(texto) {
    const bruto = String(texto || '').trim();
    if (!bruto) return { erro: 'Digite o protocolo antes de adicionar.' };

    const completo = parseProtocolo(bruto);
    if (completo) {
        return { protocolo: formatarProtocolo(bruto), tipo: completo.tipo };
    }

    const atalho = bruto.toUpperCase().replace(/[\s.-]/g, '').match(/^(VN|V)?(\d{1,4})$/);
    if (!atalho) {
        return { erro: 'Protocolo inválido — use V088-26 (biópsia) ou Vn142-26 (necropsia).' };
    }

    const tipoPedido = atalho[1] === 'VN' ? 'necropsia' : (atalho[1] === 'V' ? 'biopsia' : null);
    const numero = Number(atalho[2]);
    const candidatos = casosAbertos.filter(
        (c) => c.numero === numero && (!tipoPedido || c.tipo === tipoPedido)
    );

    if (candidatos.length === 1) {
        return { protocolo: candidatos[0].protocolo, tipo: candidatos[0].tipo };
    }
    if (candidatos.length > 1) {
        return { erro: `Existe mais de um caso aberto com o número ${numero}. Escreva o protocolo inteiro.` };
    }
    if (!tipoPedido) {
        return { erro: 'Falta a sigla: V para biópsia, Vn para necropsia.' };
    }

    // Sigla e número, sem caso aberto correspondente: é lâmina de caso antigo ou
    // já laudado, e o ano corrente é o palpite honesto.
    return {
        protocolo: montarProtocolo(tipoPedido, numero, new Date().getFullYear()),
        tipo: tipoPedido
    };
}


// ==========================================================================
// A LEVA
// ==========================================================================

function porNaLeva(protocolo, tipo, quantidade) {
    const existente = leva.find((item) => item.protocolo === protocolo);

    if (existente) {
        // Repetir o protocolo é corrigir a quantidade, não somar às cegas: quem
        // digitou de novo está reabrindo o número, não pedindo o dobro.
        existente.quantidade = quantidade;
        mostrarToast(`${protocolo} atualizado para ${quantidade} ${plural(quantidade, 'lâmina', 'lâminas')}.`, false, 'fas fa-rotate');
    } else {
        leva.push({ protocolo, tipo, quantidade });
    }

    ultimoChip = protocolo;
    els.protocolo.value = '';
    els.qtd.value = 1;
    esconderSugestoes();
    renderLeva();
    renderFila();
    els.protocolo.focus();
}

function adicionar() {
    const lido = lerProtocolo(els.protocolo.value);
    if (lido.erro) {
        mostrarToast(lido.erro, true);
        els.protocolo.focus();
        return;
    }
    porNaLeva(lido.protocolo, lido.tipo, lerQuantidade());
}

function lerQuantidade() {
    const n = Math.round(Number(els.qtd.value) || 1);
    return Math.max(1, Math.min(999, n));
}

function ajustarQuantidade(delta) {
    els.qtd.value = Math.max(1, Math.min(999, lerQuantidade() + delta));
}

async function lancarLeva() {
    if (!leva.length) {
        mostrarToast('Adicione ao menos um protocolo à leva.', true);
        els.protocolo.focus();
        return;
    }

    const nome = (els.responsavel.value || '').trim();
    if (!nome) {
        mostrarToast('Diga quem cortou ou corou.', true);
        els.responsavel.focus();
        return;
    }

    const opcao = els.usuarios.querySelector(`option[value="${cssEscape(nome)}"]`);
    const lote = `lote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ano = new Date().getFullYear();

    els.lancar.disabled = true;

    try {
        const batch = writeBatch(db);
        leva.forEach((item) => {
            batch.set(doc(collection(db, 'slide_records')), {
                protocolo: item.protocolo,
                tipo: item.tipo,
                acao,
                quantidade: item.quantidade,
                loteId: lote,
                ano,
                responsavelUid: opcao?.dataset.uid || null,
                responsavelNome: nome,
                createdByUid: usuarioAtual.uid,
                createdAt: serverTimestamp()
            });
        });
        await batch.commit();

        const laminas = leva.reduce((soma, item) => soma + item.quantidade, 0);
        const protocolos = leva.length;
        const tipos = new Set(leva.map((item) => item.tipo));

        leva = [];
        ultimoChip = null;
        renderLeva();
        renderFila();
        pulsar(tipos);

        mostrarToast(`${protocolos} ${plural(protocolos, 'protocolo', 'protocolos')} · ${laminas} ${plural(laminas, 'lâmina', 'lâminas')} ${ROTULO_ACAO[acao]}.`);
    } catch (erro) {
        console.error('Falha ao lançar a leva:', erro);
        mostrarToast('Não foi possível lançar a leva. Tente de novo.', true);
    } finally {
        els.lancar.disabled = false;
    }
}

async function desfazerLeva(loteId) {
    const doLote = registros.filter((r) => r.loteId === loteId);
    if (!doLote.length) return;

    if (!confirm(`Desfazer esta leva apaga ${doLote.length} ${plural(doLote.length, 'lançamento', 'lançamentos')}. Continuar?`)) return;

    try {
        const batch = writeBatch(db);
        doLote.forEach((r) => batch.delete(doc(db, 'slide_records', r.id)));
        await batch.commit();
        mostrarToast('Leva desfeita.', false, 'fas fa-rotate-left');
    } catch (erro) {
        console.error('Falha ao desfazer a leva:', erro);
        mostrarToast('Só quem lançou a leva (ou um admin) pode desfazê-la.', true);
    }
}


// ==========================================================================
// PERÍODO E SOMAS
// ==========================================================================

function inicioDoPeriodo() {
    const agora = new Date();
    if (periodo === 'hoje') return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
    if (periodo === 'semana') return Date.now() - 7 * DIA;
    if (periodo === 'mes') return Date.now() - 30 * DIA;
    return 0;
}

/**
 * `createdAt` é `serverTimestamp()`, e entre o clique e a confirmação do
 * servidor o campo chega nulo no snapshot local. Tratar nulo como "agora"
 * mantém o lançamento visível durante esse intervalo em vez de fazê-lo piscar
 * para fora do período.
 */
function quandoFoi(registro) {
    return registro.createdAt?.toMillis ? registro.createdAt.toMillis() : Date.now();
}

function doPeriodo() {
    const desde = inicioDoPeriodo();
    return registros.filter((r) => quandoFoi(r) >= desde);
}

/** 'vnCorte' | 'vnColoracao' | 'vCorte' | 'vColoracao' */
function celula(registro) {
    const tipo = registro.tipo === 'necropsia' ? 'vn' : 'v';
    return tipo + (registro.acao === 'corte' ? 'Corte' : 'Coloracao');
}


// ==========================================================================
// RENDER
// ==========================================================================

function renderTudo() {
    renderTotais();
    renderPessoas();
    renderLog();
    renderFila();
}

function renderTotais() {
    const noPeriodo = doPeriodo();
    const soma = { vnCorte: 0, vnColoracao: 0, vCorte: 0, vColoracao: 0 };
    const protocolos = { vnCorte: new Set(), vnColoracao: new Set(), vCorte: new Set(), vColoracao: new Set() };

    noPeriodo.forEach((r) => {
        const chave = celula(r);
        soma[chave] += Number(r.quantidade) || 0;
        protocolos[chave].add(r.protocolo);
    });

    Object.entries(totais).forEach(([chave, el]) => {
        const n = protocolos[chave].size;
        el.querySelector('[data-prot]').textContent = `${n} ${plural(n, 'protocolo', 'protocolos')}`;
    });

    contarAte(soma);

    const lotes = new Set(noPeriodo.map((r) => r.loteId || r.id));
    const distintos = new Set(noPeriodo.map((r) => r.protocolo));
    const laminas = noPeriodo.reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
    els.resumo.textContent = noPeriodo.length
        ? `${lotes.size} ${plural(lotes.size, 'leva', 'levas')} · ${distintos.size} ${plural(distintos.size, 'protocolo', 'protocolos')} · ${laminas} ${plural(laminas, 'lâmina', 'lâminas')} ${rotuloPeriodo()}`
        : `Nenhum lançamento ${rotuloPeriodo()}`;

    const temDados = noPeriodo.length > 0;
    els.dados.classList.toggle('hidden', !temDados);
    els.vazio.classList.toggle('hidden', temDados);
}

function rotuloPeriodo() {
    if (periodo === 'hoje') return 'hoje';
    if (periodo === 'semana') return 'nos últimos 7 dias';
    if (periodo === 'mes') return 'nos últimos 30 dias';
    return `desde janeiro de ${PRIMEIRO_ANO_CARREGADO()}`;
}

/**
 * Count-up dos quatro números. Sai do valor que está na tela, e não de zero:
 * ao trocar o período a leitura anda de um total para o outro, que é a
 * informação — zerar e subir de novo faria toda troca parecer um recomeço.
 */
function contarAte(alvo) {
    cancelAnimationFrame(rafTween);
    const de = { ...exibidos };
    const t0 = performance.now();

    const passo = (agora) => {
        const p = Math.min(1, (agora - t0) / 650);
        const suave = 1 - Math.pow(1 - p, 3);

        Object.keys(alvo).forEach((chave) => {
            exibidos[chave] = Math.round(de[chave] + (alvo[chave] - de[chave]) * suave);
            totais[chave].querySelector('strong').textContent = exibidos[chave];
        });

        els.headVn.textContent = exibidos.vnCorte + exibidos.vnColoracao;
        els.headV.textContent = exibidos.vCorte + exibidos.vColoracao;
        els.headGeral.textContent = exibidos.vnCorte + exibidos.vnColoracao + exibidos.vCorte + exibidos.vColoracao;

        if (p < 1) rafTween = requestAnimationFrame(passo);
    };

    rafTween = requestAnimationFrame(passo);
}

function renderLeva() {
    const laminas = leva.reduce((s, item) => s + item.quantidade, 0);
    const necro = leva.filter((item) => item.tipo === 'necropsia').length;

    els.levaRotulo.textContent = leva.length
        ? `Nesta leva · ${necro} VN / ${leva.length - necro} V`
        : 'Nesta leva';

    els.lancarTexto.textContent = leva.length
        ? `Lançar ${laminas} ${plural(laminas, 'lâmina', 'lâminas')}`
        : 'Lançar leva';

    if (!leva.length) {
        els.leva.innerHTML = '<span class="laminas-vazio-inline">Nenhum protocolo ainda — digite acima e toque em Adicionar. Pode misturar V e VN livremente.</span>';
        return;
    }

    els.leva.innerHTML = leva.map((item) => `
        <span class="laminas-pill ${classeTipo(item.tipo)}${item.protocolo === ultimoChip ? ' is-nova' : ''}">
            <i class="${ICONE_TIPO[item.tipo]}"></i>
            ${esc(item.protocolo)}
            <em>${item.quantidade}×</em>
            <button type="button" class="laminas-pill-x" data-remover="${esc(item.protocolo)}" aria-label="Remover ${esc(item.protocolo)} da leva"><i class="fas fa-xmark"></i></button>
        </span>
    `).join('');
}

/**
 * Saldo por protocolo: cortadas menos coradas. Só protocolo com saldo positivo
 * entra, e o que já está na leva em montagem sai da lista para não ser
 * adicionado duas vezes.
 */
function calcularFila() {
    const saldo = new Map();

    registros.forEach((r) => {
        const atual = saldo.get(r.protocolo) || { protocolo: r.protocolo, tipo: r.tipo, corte: 0, coloracao: 0, ts: 0 };
        atual[r.acao] += Number(r.quantidade) || 0;
        atual.ts = Math.max(atual.ts, quandoFoi(r));
        saldo.set(r.protocolo, atual);
    });

    const naLeva = new Set(leva.map((item) => item.protocolo));

    return [...saldo.values()]
        .map((s) => ({ ...s, restante: s.corte - s.coloracao }))
        .filter((s) => s.restante > 0)
        .sort((a, b) => a.ts - b.ts)
        .map((s) => ({ ...s, naLeva: naLeva.has(s.protocolo) }));
}

function renderFila() {
    const fila = calcularFila();
    els.filaTotal.textContent = fila.reduce((s, item) => s + item.restante, 0);

    const disponiveis = fila.filter((item) => !item.naLeva);
    if (!disponiveis.length) {
        els.fila.innerHTML = '<span class="laminas-vazio-inline">Tudo o que foi cortado já está corado.</span>';
        return;
    }

    els.fila.innerHTML = disponiveis.map((item) => `
        <button type="button" class="laminas-pill laminas-fila-item ${classeTipo(item.tipo)}"
                data-corar="${esc(item.protocolo)}" data-restante="${item.restante}" data-tipo="${item.tipo}"
                title="Adicionar à leva de coloração">
            <i class="${ICONE_TIPO[item.tipo]}"></i>
            ${esc(item.protocolo)}
            <em>${item.restante}×</em>
        </button>
    `).join('');
}

function renderPessoas() {
    const porPessoa = new Map();

    doPeriodo().forEach((r) => {
        const nome = r.responsavelNome || 'Sem responsável';
        const atual = porPessoa.get(nome) || {
            nome, vnCorte: 0, vnColoracao: 0, vCorte: 0, vColoracao: 0,
            necro: 0, bio: 0, total: 0, protocolos: new Map()
        };
        const qtd = Number(r.quantidade) || 0;

        atual[celula(r)] += qtd;
        atual[r.tipo === 'necropsia' ? 'necro' : 'bio'] += qtd;
        atual.total += qtd;

        const prot = atual.protocolos.get(r.protocolo) || { protocolo: r.protocolo, tipo: r.tipo, corte: 0, coloracao: 0 };
        prot[r.acao] += qtd;
        atual.protocolos.set(r.protocolo, prot);

        porPessoa.set(nome, atual);
    });

    const lista = [...porPessoa.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

    if (!lista.length) {
        els.pessoas.innerHTML = '<p class="laminas-painel-vazio">Ninguém lançou lâminas neste período.</p>';
        return;
    }

    const maior = lista[0].total || 1;

    els.pessoas.innerHTML = lista.map((p) => {
        const aberto = !!abertos[p.nome];
        const cortadas = p.vnCorte + p.vCorte;
        const coradas = p.vnColoracao + p.vColoracao;

        const protocolos = [...p.protocolos.values()]
            .sort((a, b) => a.protocolo.localeCompare(b.protocolo, 'pt-BR'))
            .map((prot) => `
                <span class="laminas-pill is-sm ${classeTipo(prot.tipo)}">
                    <i class="${ICONE_TIPO[prot.tipo]}"></i>
                    ${esc(prot.protocolo)}
                    <em>${[prot.corte ? `${prot.corte} cort.` : '', prot.coloracao ? `${prot.coloracao} cor.` : ''].filter(Boolean).join(' · ')}</em>
                </span>
            `).join('');

        return `
        <div class="laminas-pessoa">
            <button type="button" class="laminas-pessoa-head" data-pessoa="${esc(p.nome)}" aria-expanded="${aberto}">
                <span class="laminas-avatar">${esc(iniciais(p.nome))}</span>
                <span>
                    <span class="laminas-pessoa-nome">${esc(p.nome)}</span>
                    <span class="laminas-barra">
                        <span class="is-necro" style="width: ${(p.necro / maior * 100).toFixed(1)}%"></span>
                        <span class="is-bio" style="width: ${(p.bio / maior * 100).toFixed(1)}%"></span>
                    </span>
                    <span class="laminas-pessoa-resumo">${cortadas} cortadas · ${coradas} coradas · ${p.protocolos.size} ${plural(p.protocolos.size, 'protocolo', 'protocolos')}</span>
                </span>
                <span class="laminas-pessoa-num">
                    <span class="is-necro"><strong>${p.vnCorte}</strong> VN cort.</span>
                    <span class="is-necro"><strong>${p.vnColoracao}</strong> VN cor.</span>
                    <span class="is-bio"><strong>${p.vCorte}</strong> V cort.</span>
                    <span class="is-bio"><strong>${p.vColoracao}</strong> V cor.</span>
                </span>
                <span class="laminas-pessoa-total">
                    <strong>${p.total}</strong>
                    <small>lâminas</small>
                </span>
                <i class="fas fa-chevron-${aberto ? 'up' : 'down'}"></i>
            </button>
            ${aberto ? `<div class="laminas-pessoa-protocolos">${protocolos}</div>` : ''}
        </div>`;
    }).join('');
}

function renderLog() {
    const lotes = new Map();

    [...doPeriodo()].sort((a, b) => quandoFoi(b) - quandoFoi(a)).forEach((r) => {
        const chave = r.loteId || r.id;
        const atual = lotes.get(chave) || {
            loteId: chave,
            acao: r.acao,
            responsavel: r.responsavelNome || 'Sem responsável',
            criadoPor: r.createdByUid,
            quando: quandoFoi(r),
            itens: [],
            laminas: 0
        };
        atual.itens.push({ protocolo: r.protocolo, tipo: r.tipo, quantidade: Number(r.quantidade) || 0 });
        atual.laminas += Number(r.quantidade) || 0;
        lotes.set(chave, atual);
    });

    // O artboard corta em 12: é um log de conferência da bancada, não o
    // acervo. Quem quer o histórico inteiro troca o período.
    const lista = [...lotes.values()].slice(0, 12);
    if (!lista.length) {
        els.log.innerHTML = '<p class="laminas-painel-vazio">Nenhuma leva lançada neste período.</p>';
        return;
    }

    els.log.innerHTML = lista.map((l) => {
        // O botão só aparece habilitado para quem lançou; admin também pode, mas
        // isso quem decide é a regra do Firestore — aqui é só o caminho comum.
        const meu = l.criadoPor === usuarioAtual?.uid;
        return `
        <div class="laminas-leva-log">
            <div class="laminas-leva-log-head">
                <span class="laminas-leva-icone"><i class="${ICONE_ACAO[l.acao]}"></i></span>
                <span>
                    <span class="laminas-leva-titulo">${l.laminas} ${plural(l.laminas, 'lâmina', 'lâminas')} ${ROTULO_ACAO[l.acao]} · ${l.itens.length} ${plural(l.itens.length, 'protocolo', 'protocolos')}</span>
                    <span class="laminas-leva-detalhe">${esc(l.responsavel)} · ${haQuanto(l.quando)}</span>
                </span>
                <button type="button" class="laminas-desfazer" data-desfazer="${esc(l.loteId)}" ${meu ? '' : 'disabled title="Só quem lançou pode desfazer"'}>Desfazer</button>
            </div>
            <div class="laminas-leva-itens">
                ${l.itens.map((item) => `
                    <span class="laminas-pill is-xs ${classeTipo(item.tipo)}">
                        ${esc(item.protocolo)}
                        <em>${item.quantidade}×</em>
                    </span>
                `).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderSugestoes() {
    const busca = String(els.protocolo.value || '').toUpperCase().replace(/[\s.-]/g, '');

    sugestoesVisiveis = busca
        ? casosAbertos
            .filter((c) => {
                const limpo = c.protocolo.toUpperCase().replace(/[\s.-]/g, '');
                return limpo.startsWith(busca) || String(c.numero).startsWith(busca.replace(/^VN?/, ''));
            })
            .slice(0, 5)
        : [];

    if (!sugestoesVisiveis.length) {
        esconderSugestoes();
        return;
    }

    els.sugestoesLista.innerHTML = sugestoesVisiveis.map((c, i) => `
        <button type="button" class="laminas-sugestao" data-sugestao="${i}">
            <i class="${ICONE_TIPO[c.tipo]}"></i>
            <strong>${esc(c.protocolo)}</strong>
            <small>${esc(c.desc)}</small>
        </button>
    `).join('');

    els.sugestoes.classList.remove('hidden');
}

function esconderSugestoes() {
    els.sugestoes.classList.add('hidden');
    sugestoesVisiveis = [];
}


// ==========================================================================
// FEEDBACK
// ==========================================================================

/** Pulso nas leituras que a leva acabou de mexer, na cor do tipo. */
function pulsar(tipos) {
    clearTimeout(pulseTimer);
    const alvos = [];
    if (tipos.has('necropsia')) alvos.push([totais[acao === 'corte' ? 'vnCorte' : 'vnColoracao'], 'pulse-necro']);
    if (tipos.has('biopsia')) alvos.push([totais[acao === 'corte' ? 'vCorte' : 'vColoracao'], 'pulse-bio']);

    alvos.forEach(([el, classe]) => el.classList.remove(classe));
    requestAnimationFrame(() => alvos.forEach(([el, classe]) => el.classList.add(classe)));
    pulseTimer = setTimeout(() => alvos.forEach(([el, classe]) => el.classList.remove(classe)), 1000);
}

function mostrarToast(mensagem, erro = false, icone = null) {
    if (!mensagem) return;
    clearTimeout(toastTimer);

    els.toast.querySelector('i').className = icone || (erro ? 'fas fa-triangle-exclamation' : 'fas fa-circle-check');
    els.toast.querySelector('span').textContent = mensagem;
    els.toast.classList.toggle('error', erro);
    els.toast.classList.add('show');

    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}


// ==========================================================================
// EVENTOS
// ==========================================================================

els.tabs.forEach((botao) => {
    botao.addEventListener('click', () => {
        const alvo = botao.dataset.aba;
        els.tabs.forEach((b) => {
            const ativo = b === botao;
            b.classList.toggle('is-on', ativo);
            b.setAttribute('aria-selected', String(ativo));
        });
        Object.entries(els.panes).forEach(([nome, pane]) => {
            pane.classList.toggle('is-ativa', nome === alvo);
        });
    });
});

els.segAcao?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (!botao) return;
    acao = botao.dataset.acao;
    els.segAcao.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === botao));
});

els.segPeriodo?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-periodo]');
    if (!botao) return;
    periodo = botao.dataset.periodo;
    els.segPeriodo.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === botao));
    renderTudo();
});

els.menos?.addEventListener('click', () => ajustarQuantidade(-1));
els.mais?.addEventListener('click', () => ajustarQuantidade(1));
els.qtd?.addEventListener('change', () => { els.qtd.value = lerQuantidade(); });
els.adicionar?.addEventListener('click', adicionar);
els.lancar?.addEventListener('click', lancarLeva);

els.protocolo?.addEventListener('input', renderSugestoes);
els.protocolo?.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
        evento.preventDefault();
        adicionar();
    }
    if (evento.key === 'Escape') {
        els.protocolo.value = '';
        esconderSugestoes();
    }
});

els.sugestoesLista?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-sugestao]');
    if (!botao) return;
    const caso = sugestoesVisiveis[Number(botao.dataset.sugestao)];
    if (caso) porNaLeva(caso.protocolo, caso.tipo, lerQuantidade());
});

// Clicar fora fecha a lista de sugestões.
document.addEventListener('click', (evento) => {
    if (!evento.target.closest('.laminas-field.is-proto')) esconderSugestoes();
});

els.leva?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-remover]');
    if (!botao) return;
    leva = leva.filter((item) => item.protocolo !== botao.dataset.remover);
    renderLeva();
    renderFila();
});

// Tocar num protocolo da fila põe o restante na leva e já vira a etapa para
// coloração — é sempre o que se quer ao clicar ali.
els.fila?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-corar]');
    if (!botao) return;

    if (acao !== 'coloracao') {
        acao = 'coloracao';
        els.segAcao.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.acao === 'coloracao'));
    }
    porNaLeva(botao.dataset.corar, botao.dataset.tipo, Number(botao.dataset.restante) || 1);
});

els.pessoas?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-pessoa]');
    if (!botao) return;
    const nome = botao.dataset.pessoa;
    abertos[nome] = !abertos[nome];
    renderPessoas();
});

els.log?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-desfazer]');
    if (!botao || botao.disabled) return;
    desfazerLeva(botao.dataset.desfazer);
});


// ==========================================================================
// UTILIDADES
// ==========================================================================

function classeTipo(tipo) {
    return tipo === 'necropsia' ? 'is-necro' : 'is-bio';
}

function plural(n, singular, plural_) {
    return n === 1 ? singular : plural_;
}

function iniciais(nome) {
    return nome.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function haQuanto(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const horas = Math.round(min / 60);
    if (horas < 24) return `há ${horas}h`;
    const dias = Math.round(horas / 24);
    return `há ${dias} ${plural(dias, 'dia', 'dias')}`;
}

function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

/** Escapa aspas para uso dentro de um seletor de atributo. */
function cssEscape(valor) {
    return String(valor).replace(/["\\]/g, '\\$&');
}

renderLeva();
