/**
 * ETAPAS DO LAUDO — analisar e corrigir.
 *
 * São dois marcadores independentes, e não um estágio único que anda para a
 * frente: uma amostra pode estar esperando só a análise das lâminas, só a
 * correção do texto, as duas coisas ao mesmo tempo ou nenhuma delas. Quem põe o
 * caso em cada fila é a ficha da amostra; o Hub só lê.
 *
 * Cada marcador vive num campo próprio (`etapaAnalise`, `etapaCorrecao`) com
 * três estados:
 *
 *   ausente     — o caso não está nessa fila
 *   'pendente'  — está na fila, esperando
 *   'feito'     — já foi, e o cartão mostra a etiqueta com o certo
 *
 * Campo ausente em vez de `null` é de propósito: é o que o Firestore grava para
 * todo caso antigo, e ler "não marcado" como ausência não exige migração nenhuma.
 *
 * O estado 'feito' não tira o caso da fila geral de biópsias e necropsias — o
 * que tira um caso de lá é o laudo liberado. Ele só apaga o caso dos contadores
 * do cabeçalho e troca a etiqueta de "ANALISAR" para "ANALISADO ✅".
 */

export const PENDENTE = 'pendente';
export const FEITO = 'feito';

/** Emoji de certo na etiqueta concluída — pedido de quem usa, não decoração. */
const CERTO = '✅';

/**
 * Rótulo, ícone e campo de cada etapa. `chave` é o que o filtro do Hub usa;
 * `campo` é o nome no documento do caso.
 */
export const ETAPAS = {
    analise: {
        chave: 'analise',
        campo: 'etapaAnalise',
        rotulo: 'Analisar',
        rotuloFeito: `Analisado ${CERTO}`,
        rotuloAcao: 'Analisado',
        rotuloFila: 'para analisar',
        titulo: 'Análise',
        icone: 'fa-microscope',
        classe: 'is-analise'
    },
    correcao: {
        chave: 'correcao',
        campo: 'etapaCorrecao',
        rotulo: 'Corrigir',
        rotuloFeito: `Corrigido ${CERTO}`,
        rotuloAcao: 'Corrigido',
        rotuloFila: 'para corrigir',
        titulo: 'Correção',
        icone: 'fa-file-signature',
        classe: 'is-correcao'
    }
};

/** Na ordem em que aparecem nos filtros e nas etiquetas. */
export const CHAVES_ETAPA = ['analise', 'correcao'];

/** 'pendente' | 'feito' | null (não marcado). */
export function estadoDaEtapa(task, chave) {
    const etapa = ETAPAS[chave];
    if (!task || !etapa) return null;
    const valor = task[etapa.campo];
    return valor === PENDENTE || valor === FEITO ? valor : null;
}

/** O caso está nesta fila (marcado, feito ou não)? É o que o filtro pergunta. */
export function estaNaEtapa(task, chave) {
    return estadoDaEtapa(task, chave) !== null;
}

/** O caso ainda espera esta etapa? É o que os contadores do cabeçalho contam. */
export function etapaPendente(task, chave) {
    return estadoDaEtapa(task, chave) === PENDENTE;
}

/** As etapas marcadas no caso, cada uma com o seu estado. Vazio = caso comum. */
export function etapasDaAmostra(task) {
    return CHAVES_ETAPA
        .map((chave) => ({ ...ETAPAS[chave], estado: estadoDaEtapa(task, chave) }))
        .filter((etapa) => etapa.estado !== null);
}

/** Rótulo da etiqueta conforme o estado: "ANALISAR" ou "ANALISADO ✅". */
export function rotuloDaEtiqueta(etapa) {
    return etapa.estado === FEITO ? etapa.rotuloFeito : etapa.rotulo;
}

/**
 * Etiquetas de etapa dos cartões do Hub. `extraClasse` é o nome que cada lista
 * dá ao elemento (u-tag, q-tag), no mesmo espírito de `bandeiraDoNivel`.
 *
 * O ícone sai quando a etapa está feita: quem lê a linha precisa distinguir o
 * que falta do que já foi, e aí o certo é que carrega o recado.
 */
export function etiquetasDeEtapa(task, extraClasse) {
    return etapasDaAmostra(task).map((etapa) => {
        const feito = etapa.estado === FEITO;
        const icone = feito ? '' : `<i class="fas ${etapa.icone}"></i>`;
        return `<span class="${extraClasse} ${etapa.classe}${feito ? ' is-done' : ''}">`
            + `${icone}${rotuloDaEtiqueta(etapa)}</span>`;
    }).join('');
}

/**
 * Gravação do marcador. `estado` null apaga o campo — tirar o caso da fila é
 * diferente de marcá-lo como feito, e o documento precisa dizer qual dos dois
 * aconteceu.
 */
export function valorParaGravar(estado) {
    return estado === PENDENTE || estado === FEITO ? estado : null;
}
