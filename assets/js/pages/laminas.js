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
 * Totais, marcos da bateria e a fila de "cortadas esperando coloração" são
 * todos derivados desses documentos, somados no cliente. Nada é gravado
 * pré-somado — número pré-somado e log divergem no primeiro desfazer.
 *
 * A BATERIA DE ÁLCOOL
 *
 * Colorir gasta a bateria, e ela tem uma vida contada em lâminas: a cada 80
 * coradas se faz o rodízio dos álcoois, e em 320 a bateria inteira é trocada.
 * A conta é do laboratório, não de uma pessoa — soma V e VN, soma o que todo
 * mundo corou, e ignora quem lançou.
 *
 * Enquanto o marco não é confirmado a página não deixa lançar nada. É o único
 * ponto do app que trava a bancada de propósito: lançar por cima de uma bateria
 * vencida é gravar lâmina ruim como se fosse boa.
 *
 * As confirmações moram em `slide_maintenance`, também append-only, e cada uma
 * carrega quem fez a troca. Elas são o relógio do ciclo: a parcial é o que se
 * corou **depois da última troca**, e por isso zera sozinha em 320 sem ninguém
 * escrever um contador. O total do semestre, esse não zera em 320 — só na
 * virada de julho e na de janeiro.
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
import { formatarProtocolo, montarProtocolo, parseProtocolo, pesoProtocolo } from '../lib/protocolo.js';
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

/**
 * A BUSCA DO PROTOCOLO
 *
 * A lista de sugestões cobre o Livro de Registros inteiro, e não só os casos
 * abertos no Mural — a bancada também recorta e recora caso já laudado.
 * Cobrir o acervo sem pagar por ele é feito em duas camadas:
 *
 * 1. Este ano e o passado saem de graça. A página já assina essas duas séries
 *    para as sugestões, e antes descartava metade do que recebia (os casos com
 *    laudo liberado). Agora guarda tudo; são zero leituras a mais.
 *
 * 2. Anos anteriores são consultados sob demanda, e só pelo número digitado.
 *    `protocoloPeso` é determinístico ((ano * 10000 + número) * 2 + tipo), então
 *    dá para calcular o peso exato de um número em cada ano do acervo e pedir a
 *    lista de uma vez com um único `in`. Uma consulta devolve um punhado de
 *    documentos, e não o acervo: o custo não cresce com o tamanho do livro.
 *
 * A resolução do atalho digitado ("142" sozinho) continua olhando **só os casos
 * abertos**. É de propósito: com décadas de acervo quase todo número curto
 * existe em vários anos, e resolver contra tudo transformaria o atalho da
 * bancada num "escreva o protocolo inteiro" permanente.
 */

/** Teto do operador `in` do Firestore. */
const MAX_PESOS_BUSCA = 30;

/** Espera antes de ir ao Firestore, para não consultar a cada tecla. */
const ESPERA_BUSCA = 350;

/** Sem o índice do Livro, quantos anos para trás a busca ainda tenta. */
const ANOS_SEM_INDICE = 10;

const ICONE_TIPO = { necropsia: 'fas fa-skull', biopsia: 'fas fa-microscope' };
const ROTULO_ACAO = { corte: 'cortadas', coloracao: 'coradas' };
const ICONE_ACAO = { corte: 'fas fa-scissors', coloracao: 'fas fa-droplet' };

/**
 * Os marcos da bateria, em lâminas coradas desde a última troca completa.
 *
 * Os três primeiros pedem o rodízio dos álcoois; o último é a troca da bateria
 * inteira, e é ele que fecha o ciclo e devolve a parcial para zero.
 */
const MARCOS = [80, 160, 240, 320];
const MARCO_TROCA = MARCOS[MARCOS.length - 1];

/** A partir de quantas lâminas do marco a página começa a avisar. */
const AVISO_ANTECEDENCIA = 15;

/**
 * Quantos protocolos da leva ficam à mostra na linha de chips.
 *
 * Na maioria dos dias a leva tem meia dúzia e cabe inteira. Nos dias de
 * mutirão ela passava de trinta, quebrava em seis linhas e empurrava o
 * "Lançar" para fora da tela — justamente quando conferir o que entrou
 * importa mais. Passando daqui, o excedente vai para o modal.
 *
 * São menos no celular porque lá cada linha leva dois chips, e não cinco: com
 * o botão ocupando uma célula, três fecham em duas fileiras exatas.
 */
const CHIPS_VISIVEIS = { celular: 3, desktop: 5 };

/** O mesmo limiar do CSS: daqui para baixo a página é a versão de celular. */
const TELA_CELULAR = window.matchMedia('(max-width: 1024px)');

function chipsVisiveis() {
    return TELA_CELULAR.matches ? CHIPS_VISIVEIS.celular : CHIPS_VISIVEIS.desktop;
}

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
    leva: document.getElementById('lam-leva'),
    levaRotulo: document.getElementById('lam-leva-rotulo'),
    levaModal: document.getElementById('leva-modal'),
    levaModalLista: document.getElementById('leva-modal-lista'),
    levaModalResumo: document.getElementById('leva-modal-resumo'),
    lancar: document.getElementById('lam-lancar'),
    lancarTexto: document.getElementById('lam-lancar-texto'),
    fila: document.getElementById('lam-fila'),
    filaTotal: document.getElementById('lam-fila-total'),
    resumo: document.getElementById('lam-resumo'),
    dados: document.getElementById('lam-dados'),
    vazio: document.getElementById('lam-vazio'),
    trocas: document.getElementById('lam-trocas'),
    log: document.getElementById('lam-log'),
    toast: document.getElementById('lam-toast'),
    headCortadas: document.getElementById('head-cortadas'),
    headCoradas: document.getElementById('head-coradas'),
    headGeral: document.getElementById('head-geral'),

    marcos: document.getElementById('lam-marcos'),
    marcosIcone: document.getElementById('lam-marcos-icone'),
    marcosTitulo: document.getElementById('lam-marcos-titulo'),
    marcosSub: document.getElementById('lam-marcos-sub'),
    marcosParcial: document.getElementById('lam-marcos-parcial'),
    marcosBtn: document.getElementById('lam-marcos-btn'),
    marcosBtnTexto: document.getElementById('lam-marcos-btn-texto'),
    marcosPreenchida: document.getElementById('lam-marcos-preenchida'),
    marcosSemestre: document.getElementById('lam-marcos-semestre'),

    trocaModal: document.getElementById('troca-modal'),
    trocaIcone: document.getElementById('troca-modal-icone'),
    trocaTitulo: document.getElementById('troca-modal-titulo'),
    trocaTexto: document.getElementById('troca-modal-texto'),
    trocaResponsavel: document.getElementById('troca-responsavel'),
    trocaConfirmar: document.getElementById('troca-confirmar')
};

const totais = {
    corte: document.getElementById('total-corte'),
    coloracao: document.getElementById('total-coloracao')
};

let usuarioAtual = null;
let podeLancar = false;
let registros = [];
let manutencoes = [];
let casosAbertos = [];
let casosRecentes = [];
let casosAcervo = [];
let anosAcervo = [];
let termoBuscado = null;
let timerBusca = null;
const cacheAcervo = new Map();
let equipe = [];
let leva = [];
let acao = 'corte';
let periodo = 'semana';
let ultimoChip = null;
let sugestoesVisiveis = [];
let toastTimer = null;
let pulseTimer = null;
let rafTween = null;
let exibidos = { corte: 0, coloracao: 0 };

/** O que `calcularBateria()` devolveu por último — a fonte do bloqueio. */
let bateria = { parcial: 0, semestre: 0, proximoMarco: MARCOS[0], bloqueado: false };

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

    carregarUsuarios();
    carregarAnosDoAcervo();
    assinarRegistros();
    assinarManutencoes();
    assinarCasosAbertos();
});

document.getElementById('btn-logout')?.addEventListener('click', logout);
document.getElementById('logout-btn-header')?.addEventListener('click', logout);


// ==========================================================================
// DADOS
// ==========================================================================

/**
 * A equipe inteira, sem filtro de papel: quem corta lâmina não é só quem tem
 * uma role específica, e quem faz o rodízio dos álcoois muito menos.
 *
 * Alimenta os dois selects — o responsável da leva e o da troca. O valor é o
 * uid, e o nome vai junto no `data-nome`: gravar os dois deixa o histórico
 * legível mesmo se alguém trocar de nome depois.
 */
async function carregarUsuarios() {
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        equipe = snapshot.docs
            .map((docSnap) => ({ uid: docSnap.id, nome: (docSnap.data().name || '').trim() }))
            .filter((u) => u.nome)
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

        const opcoes = equipe
            .map((u) => `<option value="${esc(u.uid)}" data-nome="${esc(u.nome)}">${esc(u.nome)}</option>`)
            .join('');

        els.responsavel.insertAdjacentHTML('beforeend', opcoes);
        els.trocaResponsavel.insertAdjacentHTML('beforeend', opcoes);

        // Quase sempre quem lança é quem cortou; deixar pré-escolhido poupa um
        // toque por leva sem impedir a troca para outra pessoa.
        if (equipe.some((u) => u.uid === usuarioAtual?.uid)) {
            els.responsavel.value = usuarioAtual.uid;
        }
    } catch (erro) {
        console.warn('Não foi possível carregar a lista de responsáveis.', erro);
        mostrarToast('Lista de responsáveis indisponível. Recarregue a página.', true);
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

/** Rodízios e trocas confirmados. Mesma janela de anos dos lançamentos. */
function assinarManutencoes() {
    const consulta = query(
        collection(db, 'slide_maintenance'),
        where('ano', '>=', PRIMEIRO_ANO_CARREGADO())
    );

    onSnapshot(consulta, (snapshot) => {
        manutencoes = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        renderTudo();
    }, (erro) => {
        console.warn('Não foi possível carregar as trocas da bateria.', erro);
        mostrarToast('Não foi possível carregar o histórico de trocas.', true);
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
            // Sem o filtro de laudo pendente: caso já liberado também volta para
            // a bancada, e estes documentos já estavam sendo lidos de qualquer
            // jeito. Fica de fora só o que nunca foi amostra — o compromisso de
            // agenda que o Planner grava na mesma coleção.
            fontesCasos[fonte] = snapshot.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                .filter((task) => task && task.type !== 'agendamento_rapido');
            juntarCasos();
        }, (erro) => console.warn('Sugestões de protocolo indisponíveis.', erro));
    });
}

/**
 * Os anos que o acervo tem, do índice do Livro de Registros — o mesmo
 * `meta/livroRegistros` que monta o filtro de ano lá. É uma leitura só, na
 * abertura, e evita chutar em que anos procurar.
 */
async function carregarAnosDoAcervo() {
    let anos = [];

    try {
        const snap = await getDoc(doc(db, 'meta', 'livroRegistros'));
        anos = Object.keys((snap.exists() && snap.data().anos) || {})
            .map(Number)
            .filter(Number.isFinite);
    } catch (erro) {
        console.warn('Índice do Livro indisponível; a busca vai tentar os últimos anos.', erro);
    }

    // Sem índice a busca não para: tenta uma janela fixa para trás. Ano que não
    // existe simplesmente não devolve documento nenhum.
    if (!anos.length) {
        const base = PRIMEIRO_ANO_CARREGADO();
        anos = Array.from({ length: ANOS_SEM_INDICE }, (_, i) => base - 1 - i);
    }

    // Só o que **não** está em memória: este ano e o passado já vieram inteiros
    // pelas assinaturas, e consultá-los de novo seria leitura paga duas vezes.
    anosAcervo = anos
        .filter((ano) => ano > 0 && ano < PRIMEIRO_ANO_CARREGADO())
        .sort((a, b) => b - a);
}

function juntarCasos() {
    const porId = new Map();
    [...fontesCasos.recentes, ...fontesCasos.semAno, ...fontesCasos.reabertos]
        .forEach((task) => porId.set(task.id, task));

    casosRecentes = [...porId.values()]
        .map((task) => paraSugestao(task))
        .filter(Boolean)
        .sort(porMaisRecente);

    // A lista curta, só do que está em aberto: é contra ela que o atalho
    // digitado se resolve. Ver o comentário longo em "A BUSCA DO PROTOCOLO".
    casosAbertos = casosRecentes.filter((c) => c.aberto);
}

/** Task do Firestore -> item da lista de sugestões. `null` se o protocolo não é legível. */
function paraSugestao(task) {
    const lido = parseProtocolo(task.protocolo);
    if (!lido) return null;

    return {
        protocolo: formatarProtocolo(task.protocolo),
        tipo: lido.tipo,
        numero: lido.numero,
        ano: lido.ano,
        desc: descreverCaso(task),
        aberto: laudoPendente(task)
    };
}

function porMaisRecente(a, b) {
    return b.ano - a.ano || b.numero - a.numero;
}


/**
 * Procura um número nos anos que não estão em memória.
 *
 * O peso do protocolo é uma função do ano, do número e do tipo, então o
 * conjunto de pesos possíveis de "88" é pequeno e conhecido: um por ano por
 * tipo. Um `in` resolve todos de uma vez, e o resultado é um punhado de
 * documentos — nunca o acervo inteiro.
 */
async function buscarNoAcervo(termo) {
    if (cacheAcervo.has(termo)) {
        casosAcervo = cacheAcervo.get(termo);
        return;
    }

    const atalho = termo.match(/^(VN|V)?(\d{1,4})$/);
    if (!atalho || !anosAcervo.length) {
        casosAcervo = [];
        return;
    }

    const numero = Number(atalho[2]);
    // "VN" fecha em necropsia; "V" e o número sozinho abrem os dois, como no
    // filtro da lista — quem digitou "V" pode estar a caminho de "Vn".
    const tipos = atalho[1] === 'VN' ? ['necropsia'] : ['biopsia', 'necropsia'];

    const pesos = [];
    for (const ano of anosAcervo) {
        for (const tipo of tipos) {
            if (pesos.length >= MAX_PESOS_BUSCA) break;
            pesos.push(pesoProtocolo(montarProtocolo(tipo, numero, ano)));
        }
        if (pesos.length >= MAX_PESOS_BUSCA) break;
    }

    try {
        const snapshot = await getDocs(query(
            collection(db, 'tasks'),
            where('protocoloPeso', 'in', pesos)
        ));

        const achados = snapshot.docs
            .map((docSnap) => docSnap.data())
            .filter((task) => task && task.type !== 'agendamento_rapido')
            .map(paraSugestao)
            .filter(Boolean)
            .sort(porMaisRecente);

        cacheAcervo.set(termo, achados);
        casosAcervo = achados;
    } catch (erro) {
        console.warn('Busca no acervo indisponível.', erro);
        casosAcervo = [];
    }
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
    // O bloqueio vem antes de tudo: com a bateria vencida não há leva válida,
    // nem de corte. Quem estiver na bancada resolve o álcool e volta.
    if (bateria.bloqueado) {
        mostrarToast(textoBloqueio(), true, 'fas fa-flask-vial');
        return;
    }

    if (!leva.length) {
        mostrarToast('Adicione ao menos um protocolo à leva.', true);
        els.protocolo.focus();
        return;
    }

    const uid = els.responsavel.value;
    const nome = nomeDoSelect(els.responsavel);
    if (!uid || !nome) {
        mostrarToast('Escolha quem cortou ou corou.', true);
        els.responsavel.focus();
        return;
    }

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
                responsavelUid: uid,
                responsavelNome: nome,
                createdByUid: usuarioAtual.uid,
                createdAt: serverTimestamp()
            });
        });
        await batch.commit();

        const laminas = leva.reduce((soma, item) => soma + item.quantidade, 0);
        const protocolos = leva.length;

        leva = [];
        ultimoChip = null;
        renderLeva();   // com a leva vazia, isto também fecha o modal da lista
        renderFila();
        pulsar();

        mostrarToast(`${protocolos} ${plural(protocolos, 'protocolo', 'protocolos')} · ${laminas} ${plural(laminas, 'lâmina', 'lâminas')} ${ROTULO_ACAO[acao]}.`);
    } catch (erro) {
        console.error('Falha ao lançar a leva:', erro);
        mostrarToast('Não foi possível lançar a leva. Tente de novo.', true);
    } finally {
        // E não `false`: a leva que acabou de entrar pode ter sido justamente
        // a que estourou o marco. O snapshot chega logo e corrige, mas até lá
        // o botão já fica no estado certo.
        els.lancar.disabled = bateria.bloqueado;
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
// A BATERIA DE ÁLCOOL
// ==========================================================================

/**
 * O relógio do ciclo é a última troca completa: tudo que foi corado depois dela
 * conta na parcial, e as confirmações posteriores a ela são os marcos já
 * cumpridos. Sem contador gravado, e por isso sem contador para divergir do log
 * quando alguém desfaz uma leva.
 *
 * `proximoMarco` é o menor marco ainda não confirmado neste ciclo, e o bloqueio
 * acontece quando a parcial alcança esse marco. Uma leva grande pode passar de
 * dois marcos de uma vez; nesse caso eles são cobrados um de cada vez, na
 * ordem, que é a ordem em que o trabalho teria que ter sido feito.
 */
function calcularBateria() {
    const trocas = manutencoes
        .filter((m) => m.tipo === 'troca')
        .sort((a, b) => quandoFoi(a) - quandoFoi(b));

    const inicioCiclo = trocas.length ? quandoFoi(trocas[trocas.length - 1]) : 0;

    const parcial = registros
        .filter((r) => r.acao === 'coloracao' && quandoFoi(r) > inicioCiclo)
        .reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);

    const cumpridos = new Set(
        manutencoes
            .filter((m) => quandoFoi(m) > inicioCiclo)
            .map((m) => Number(m.marco))
    );

    const proximoMarco = MARCOS.find((m) => !cumpridos.has(m)) || MARCO_TROCA;

    const desde = inicioSemestre();
    const semestre = registros
        .filter((r) => r.acao === 'coloracao' && quandoFoi(r) >= desde)
        .reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);

    return {
        parcial,
        semestre,
        proximoMarco,
        bloqueado: parcial >= proximoMarco,
        faltam: Math.max(0, proximoMarco - parcial)
    };
}

/** 1º de janeiro ou 1º de julho — o que estiver mais perto para trás. */
function inicioSemestre() {
    const agora = new Date();
    return new Date(agora.getFullYear(), agora.getMonth() < 6 ? 0 : 6, 1).getTime();
}

function rotuloSemestre() {
    const agora = new Date();
    return `${agora.getMonth() < 6 ? 1 : 2}º semestre de ${agora.getFullYear()}`;
}

function ehTroca(marco) {
    return marco === MARCO_TROCA;
}

function nomeDoMarco(marco) {
    return ehTroca(marco) ? 'Troca da bateria completa' : 'Rodízio de álcool';
}

function textoBloqueio() {
    return ehTroca(bateria.proximoMarco)
        ? `${bateria.parcial} lâminas coradas: troque a bateria completa e confirme para voltar a lançar.`
        : `${bateria.parcial} lâminas coradas: faça o rodízio de álcool e confirme para voltar a lançar.`;
}

function abrirTroca() {
    if (!bateria.bloqueado) return;

    const marco = bateria.proximoMarco;
    const troca = ehTroca(marco);

    els.trocaIcone.innerHTML = `<i class="${troca ? 'fas fa-flask-vial' : 'fas fa-rotate'}"></i>`;
    els.trocaTitulo.textContent = nomeDoMarco(marco);
    els.trocaTexto.textContent = troca
        ? `A bancada chegou a ${bateria.parcial} lâminas coradas. Confirme a troca da bateria inteira — a contagem parcial volta a zero e a bancada é liberada.`
        : `A bancada passou do marco de ${marco} lâminas coradas. Confirme o rodízio dos álcoois para liberar os lançamentos.`;

    // Palpite honesto, não escolha: quem confirma costuma ser quem fez, mas
    // ninguém é obrigado a assinar pelo colega.
    els.trocaResponsavel.value = equipe.some((u) => u.uid === usuarioAtual?.uid)
        ? usuarioAtual.uid
        : '';

    els.trocaModal.classList.remove('hidden');
    els.trocaResponsavel.focus();
}

async function confirmarTroca() {
    const marco = bateria.proximoMarco;
    const uid = els.trocaResponsavel.value;
    const nome = nomeDoSelect(els.trocaResponsavel);

    if (!uid || !nome) {
        mostrarToast('Escolha quem fez a troca.', true);
        els.trocaResponsavel.focus();
        return;
    }

    els.trocaConfirmar.disabled = true;

    try {
        const batch = writeBatch(db);
        batch.set(doc(collection(db, 'slide_maintenance')), {
            tipo: ehTroca(marco) ? 'troca' : 'rodizio',
            marco,
            parcial: bateria.parcial,
            ano: new Date().getFullYear(),
            responsavelUid: uid,
            responsavelNome: nome,
            createdByUid: usuarioAtual.uid,
            createdAt: serverTimestamp()
        });
        await batch.commit();

        els.trocaModal.classList.add('hidden');
        mostrarToast(
            ehTroca(marco)
                ? `Bateria trocada por ${nome}. A contagem parcial recomeça do zero.`
                : `Rodízio confirmado por ${nome}. Pode voltar a lançar.`,
            false,
            'fas fa-flask-vial'
        );
    } catch (erro) {
        console.error('Falha ao confirmar a troca:', erro);
        mostrarToast('Não foi possível registrar a troca. Tente de novo.', true);
    } finally {
        els.trocaConfirmar.disabled = false;
    }
}

/**
 * Confirmação errada trava ou destrava a bancada na hora errada, e o log é
 * append-only: o conserto é apagar, como no "Desfazer" da leva. Só quem
 * confirmou (ou um admin) consegue — a regra do Firestore é que decide.
 */
async function desfazerTroca(id) {
    const evento = manutencoes.find((m) => m.id === id);
    if (!evento) return;

    const rotulo = nomeDoMarco(Number(evento.marco)).toLowerCase();
    if (!confirm(`Apagar este registro de ${rotulo}? A contagem volta a considerar o marco como não feito.`)) return;

    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'slide_maintenance', id));
        await batch.commit();
        mostrarToast('Registro apagado.', false, 'fas fa-rotate-left');
    } catch (erro) {
        console.error('Falha ao apagar a troca:', erro);
        mostrarToast('Só quem confirmou (ou um admin) pode apagar.', true);
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

function doPeriodoManutencoes() {
    const desde = inicioDoPeriodo();
    return manutencoes.filter((m) => quandoFoi(m) >= desde);
}


// ==========================================================================
// RENDER
// ==========================================================================

function renderTudo() {
    bateria = calcularBateria();
    renderBateria();
    renderTotais();
    renderTrocas();
    renderLog();
    renderFila();
}

/**
 * A faixa da bateria. Três estados, e a diferença entre eles é o que a pessoa
 * pode fazer: em dia (só a leitura), perto do marco (aviso, ainda lança) e
 * vencida (bloqueio, com o botão de confirmar no lugar do número).
 */
function renderBateria() {
    const { parcial, proximoMarco, bloqueado, faltam } = bateria;
    const troca = ehTroca(proximoMarco);
    const perto = !bloqueado && faltam <= AVISO_ANTECEDENCIA;

    els.marcos.classList.toggle('is-bloqueada', bloqueado);
    els.marcos.classList.toggle('is-troca', bloqueado && troca);
    els.marcos.classList.toggle('is-perto', perto);

    els.marcosIcone.innerHTML = `<i class="${bloqueado ? 'fas fa-triangle-exclamation' : 'fas fa-flask-vial'}"></i>`;
    els.marcosParcial.textContent = parcial;
    els.marcosPreenchida.style.width = `${Math.min(100, parcial / MARCO_TROCA * 100).toFixed(1)}%`;
    els.marcosSemestre.textContent = `${bateria.semestre} ${plural(bateria.semestre, 'lâmina corada', 'lâminas coradas')} no ${rotuloSemestre()}`;

    if (bloqueado) {
        els.marcosTitulo.textContent = troca ? 'Troque a bateria completa' : 'Faça o rodízio de álcool';
        els.marcosSub.textContent = troca
            ? `${parcial} lâminas coradas desde a última troca. Nenhum lançamento entra até a troca ser confirmada.`
            : `A bancada passou do marco de ${proximoMarco}. Nenhum lançamento entra até o rodízio ser confirmado.`;
        els.marcosBtnTexto.textContent = troca ? 'Confirmar troca' : 'Confirmar rodízio';
        els.marcosBtn.classList.remove('hidden');
    } else {
        els.marcosTitulo.textContent = 'Bateria de álcool';
        els.marcosSub.textContent = perto
            ? `Faltam ${faltam} ${plural(faltam, 'lâmina', 'lâminas')} para ${troca ? 'a troca completa' : `o rodízio de ${proximoMarco}`}.`
            : `Próximo ${troca ? 'marco: troca completa' : `rodízio: ${proximoMarco}`} · faltam ${faltam} ${plural(faltam, 'lâmina', 'lâminas')}.`;
        els.marcosBtn.classList.add('hidden');
    }

    // O botão de lançar acompanha o bloqueio: travar só no clique deixaria a
    // pessoa montar a leva inteira para descobrir no fim que não podia.
    els.lancar.disabled = bloqueado;
    els.lancar.title = bloqueado ? textoBloqueio() : '';
}

function renderTotais() {
    const noPeriodo = doPeriodo();
    const soma = { corte: 0, coloracao: 0 };
    const protocolos = { corte: new Set(), coloracao: new Set() };

    noPeriodo.forEach((r) => {
        const chave = r.acao === 'corte' ? 'corte' : 'coloracao';
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

    // Uma troca sem lançamento no período é raro mas possível (a leva que
    // fechou os 320 pode estar do lado de fora da janela); esconder o painel
    // nesse caso apagaria justamente o registro que se foi procurar.
    const temDados = noPeriodo.length > 0 || doPeriodoManutencoes().length > 0;
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
 * Count-up dos dois números. Sai do valor que está na tela, e não de zero:
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

        els.headCortadas.textContent = exibidos.corte;
        els.headCoradas.textContent = exibidos.coloracao;
        els.headGeral.textContent = exibidos.corte + exibidos.coloracao;

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

    // Antes do atalho da leva vazia: é justamente aí que o modal precisa saber
    // que não há mais lista para mostrar.
    renderLevaModal();

    if (!leva.length) {
        els.leva.innerHTML = '<span class="laminas-vazio-inline">Nenhum protocolo ainda — digite acima e toque em Adicionar. Pode misturar V e VN livremente.</span>';
        return;
    }

    // O corte guarda o **fim** da lista, não o começo: o protocolo que a pessoa
    // acabou de adicionar tem que aparecer, senão o toque em Adicionar não
    // devolve resposta nenhuma. Os mais antigos vão para trás do botão.
    const limite = chipsVisiveis();
    const ocultos = Math.max(0, leva.length - limite);
    const visiveis = ocultos ? leva.slice(-limite) : leva;

    const botao = ocultos
        ? `<button type="button" class="laminas-leva-mais" id="lam-leva-mais"
                   title="Ver os ${leva.length} protocolos desta leva">
               <i class="fas fa-list-ul"></i> +${ocultos} · <span>ver lista</span>
           </button>`
        : '';

    els.leva.innerHTML = botao + visiveis.map(chipDaLeva).join('');
}

/** O chip de um protocolo da leva. Serve na linha e dentro do modal. */
function chipDaLeva(item) {
    return `
        <span class="laminas-pill ${classeTipo(item.tipo)}${item.protocolo === ultimoChip ? ' is-nova' : ''}">
            <i class="${ICONE_TIPO[item.tipo]}"></i>
            <b>${esc(item.protocolo)}</b>
            <em>${item.quantidade}×</em>
            <button type="button" class="laminas-pill-x" data-remover="${esc(item.protocolo)}" aria-label="Remover ${esc(item.protocolo)} da leva"><i class="fas fa-xmark"></i></button>
        </span>`;
}

/**
 * A leva inteira, em ordem de entrada. Só monta o conteúdo quando o modal está
 * aberto — fora disso ninguém está olhando, e `renderLeva()` roda a cada toque
 * em Adicionar.
 */
function renderLevaModal() {
    if (els.levaModal.classList.contains('hidden')) return;

    // Esvaziou com o modal aberto (ao remover o último, ou ao lançar): não há
    // mais lista para ver.
    if (!leva.length) {
        fecharModal('leva-modal');
        return;
    }

    const laminas = leva.reduce((soma, item) => soma + item.quantidade, 0);
    const necro = leva.filter((item) => item.tipo === 'necropsia').length;

    els.levaModalResumo.textContent =
        `${leva.length} ${plural(leva.length, 'protocolo', 'protocolos')} · `
        + `${necro} VN / ${leva.length - necro} V · `
        + `${laminas} ${plural(laminas, 'lâmina', 'lâminas')}`;

    els.levaModalLista.innerHTML = leva.map(chipDaLeva).join('');
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

/**
 * O histórico de trocas toma o lugar da quebra por pessoa. Quantas lâminas cada
 * estagiário fez não muda decisão nenhuma; quem fez o último rodízio, sim — é a
 * pergunta que aparece quando a bateria some ou quando alguém duvida do marco.
 */
function renderTrocas() {
    const lista = doPeriodoManutencoes().sort((a, b) => quandoFoi(b) - quandoFoi(a));

    if (!lista.length) {
        els.trocas.innerHTML = '<p class="laminas-painel-vazio">Nenhum rodízio ou troca registrado neste período.</p>';
        return;
    }

    els.trocas.innerHTML = lista.map((m) => {
        const marco = Number(m.marco) || 0;
        const troca = ehTroca(marco);
        const meu = m.createdByUid === usuarioAtual?.uid;

        return `
        <div class="laminas-troca">
            <span class="laminas-troca-icone ${troca ? 'is-troca' : ''}">
                <i class="${troca ? 'fas fa-flask-vial' : 'fas fa-rotate'}"></i>
            </span>
            <span>
                <span class="laminas-troca-titulo">${troca ? 'Troca da bateria completa' : 'Rodízio de álcool'}</span>
                <span class="laminas-troca-detalhe">
                    ${esc(m.responsavelNome || 'Sem responsável')} · marco ${marco} · ${haQuanto(quandoFoi(m))}
                </span>
            </span>
            <button type="button" class="laminas-desfazer" data-apagar-troca="${esc(m.id)}"
                    ${meu ? '' : 'disabled title="Só quem confirmou pode apagar"'}>Apagar</button>
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

/** Como a página e o caso são comparados: sem espaço, ponto, barra ou traço. */
function limparBusca(texto) {
    return String(texto || '').toUpperCase().replace(/[\s./-]/g, '');
}

/**
 * A sugestão casa por prefixo, e por dois caminhos.
 *
 * O primeiro é o protocolo escrito como ele aparece — "V088", "VN142-26" —
 * comparado letra a letra. O segundo é o atalho da bancada: sigla, número, ou
 * os dois ("VN", "142", "V88"), em que a sigla digitada tem que ser prefixo da
 * sigla do caso e o número prefixo do número. É esse caminho que faz "V88"
 * encontrar o V088-26, que o padding de três dígitos esconde do primeiro.
 *
 * Ele precisa dessa forma de duas partes: comparar só o número, como se fazia
 * antes, deixava a sigla de fora da conta — e como "VN" sem dígito nenhum vira
 * prefixo vazio, e todo número começa com prefixo vazio, digitar "Vn" casava
 * com o acervo inteiro. As cinco primeiras da lista vinham ordenadas por
 * número, quase sempre biópsias, e nenhuma necropsia aparecia.
 */
function casaComABusca(caso, busca, atalho) {
    if (limparBusca(caso.protocolo).startsWith(busca)) return true;
    if (!atalho) return false;

    const [, sigla, digitos] = atalho;
    const siglaDoCaso = caso.tipo === 'necropsia' ? 'VN' : 'V';

    // "VN" só casa com necropsia; "V" casa com as duas, porque quem digitou
    // pode estar a meio caminho de "Vn".
    if (sigla && !siglaDoCaso.startsWith(sigla)) return false;

    return digitos ? String(caso.numero).startsWith(digitos) : true;
}

function renderSugestoes() {
    const busca = limparBusca(els.protocolo.value);
    const atalho = busca.match(/^(VN|V)?(\d*)$/);

    if (busca !== termoBuscado) agendarBuscaNoAcervo(busca);

    // Memória primeiro: quando o mesmo protocolo vem das duas fontes, vale o que
    // está vivo na assinatura, e não o que ficou no cache da busca.
    const porProtocolo = new Map();
    [...casosRecentes, ...casosAcervo].forEach((caso) => {
        if (!porProtocolo.has(caso.protocolo)) porProtocolo.set(caso.protocolo, caso);
    });

    sugestoesVisiveis = busca
        ? [...porProtocolo.values()]
            .filter((c) => casaComABusca(c, busca, atalho))
            .sort(porMaisRecente)
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
            ${c.aberto ? '' : '<span class="laminas-sugestao-tag">laudado</span>'}
        </button>
    `).join('');

    els.sugestoes.classList.remove('hidden');
}

/**
 * A ida ao Firestore espera a pessoa parar de digitar. Sem isso "Vn142" seriam
 * cinco consultas, quatro delas para um número que ninguém quis procurar.
 */
function agendarBuscaNoAcervo(termo) {
    clearTimeout(timerBusca);
    termoBuscado = termo;

    if (!termo) {
        casosAcervo = [];
        return;
    }

    timerBusca = setTimeout(async () => {
        await buscarNoAcervo(termo);

        // Se a pessoa continuou digitando, o resultado que chegou é de outra
        // busca: desenhar com ele faria a lista piscar para trás.
        if (limparBusca(els.protocolo.value) === termo) renderSugestoes();
    }, ESPERA_BUSCA);
}

function esconderSugestoes() {
    els.sugestoes.classList.add('hidden');
    sugestoesVisiveis = [];
}


// ==========================================================================
// FEEDBACK
// ==========================================================================

/** Pulso na leitura que a leva acabou de mexer — cortadas ou coradas. */
function pulsar() {
    clearTimeout(pulseTimer);
    const chave = acao === 'corte' ? 'corte' : 'coloracao';
    const el = totais[chave];
    const classe = `pulse-${chave}`;

    el.classList.remove(classe);
    requestAnimationFrame(() => el.classList.add(classe));
    pulseTimer = setTimeout(() => el.classList.remove(classe), 1000);
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

/**
 * Escolher na lista é acabar de escrever o protocolo, e só isso.
 *
 * Antes a sugestão ia direto para a leva, o que transformava um toque de
 * autocomplete — muitas vezes só para ver a descrição do caso e conferir se
 * era aquele mesmo — num lançamento com a quantidade que estivesse no campo.
 * Quem entra na leva é quem passou pelo "Adicionar à leva".
 *
 * O foco volta para o campo do protocolo: de lá o Enter já adiciona, então
 * quem lança pelo teclado não perde nada com a mudança.
 */
els.sugestoesLista?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-sugestao]');
    if (!botao) return;

    const caso = sugestoesVisiveis[Number(botao.dataset.sugestao)];
    if (!caso) return;

    els.protocolo.value = caso.protocolo;
    esconderSugestoes();
    els.protocolo.focus();
    els.protocolo.setSelectionRange(caso.protocolo.length, caso.protocolo.length);
});

// Clicar fora fecha a lista de sugestões.
document.addEventListener('click', (evento) => {
    if (!evento.target.closest('.laminas-field.is-proto')) esconderSugestoes();
});

/** O X do chip tira o protocolo da leva — na linha ou dentro do modal. */
function ligarRemocao(container) {
    container?.addEventListener('click', (evento) => {
        const botao = evento.target.closest('[data-remover]');
        if (!botao) return;
        leva = leva.filter((item) => item.protocolo !== botao.dataset.remover);
        renderLeva();
        renderFila();
    });
}

ligarRemocao(els.leva);
ligarRemocao(els.levaModalLista);

TELA_CELULAR.addEventListener('change', renderLeva);

els.leva?.addEventListener('click', (evento) => {
    if (!evento.target.closest('#lam-leva-mais')) return;
    els.levaModal.classList.remove('hidden');
    renderLevaModal();
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

els.trocas?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-apagar-troca]');
    if (!botao || botao.disabled) return;
    desfazerTroca(botao.dataset.apagarTroca);
});

els.marcosBtn?.addEventListener('click', abrirTroca);
els.trocaConfirmar?.addEventListener('click', confirmarTroca);

function fecharModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

document.querySelectorAll('[data-close-modal]').forEach((botao) => {
    botao.addEventListener('click', () => fecharModal(botao.dataset.closeModal));
});

// Clicar no fundo escuro fecha, como no Estoque.
document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (evento) => {
        if (evento.target === modal) fecharModal(modal.id);
    });
});

document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    fecharModal('troca-modal');
    fecharModal('leva-modal');
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

/** O nome que está no `data-nome` da opção escolhida, ou '' se não há uma. */
function nomeDoSelect(select) {
    return (select.selectedOptions[0]?.dataset.nome || '').trim();
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

renderLeva();
