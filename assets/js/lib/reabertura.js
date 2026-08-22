/**
 * REABERTURA — trazer um caso do Livro de Registros de volta para a fila.
 *
 * Laudo liberado tira o caso do Mural e do Hub: ele vira acervo, e quem responde
 * por ele passa a ser o Livro de Registros. Só que caso antigo volta a ser
 * trabalho — o pós que quer rever as lâminas de um V079-24 antes da defesa, o
 * professor montando aula com um caso do ano passado. Sem um caminho de volta, a
 * única forma de pôr o caso de novo à vista seria desfazer a liberação, o que
 * apagaria a data do laudo e o diagnóstico da linha do livro: estragar o
 * registro para resolver um problema de organização.
 *
 * `reaberto` é um segundo marcador, ao lado de `releasedAt`, não no lugar dele.
 * O livro continua dizendo que o laudo saiu, com data e diagnóstico intactos; o
 * Mural e o Hub voltam a mostrar o caso, etiquetado como reaberto, e as etapas
 * (analisar/corrigir) voltam a valer — é nelas que a organização acontece.
 * Devolver ao livro é apagar o campo; nada mais se desfaz.
 *
 * O marcador é booleano de propósito. O Mural e o Hub só leem a janela recente
 * do acervo (`protocoloAno >= ano - 1`), então um caso de 2023 reaberto não
 * apareceria em lugar nenhum — `where('reaberto', '==', true)` é a consulta que
 * traz os reabertos de qualquer ano, e ela só é barata porque o campo não existe
 * em quem nunca foi reaberto.
 */

/** Nome do campo no documento do caso — usado também na consulta do Firestore. */
export const CAMPO_REABERTO = 'reaberto';

export function estaReaberto(task) {
    return !!task && task[CAMPO_REABERTO] === true;
}

/**
 * O caso vale como laudo pendente? É o corte do Mural e do Hub, um só para os
 * dois — antes cada um tinha a sua cópia da mesma regra.
 *
 * A ordem importa: agendamento do Planner nunca entra na fila, nem reaberto; e a
 * reabertura vem antes de `releasedAt` porque é justamente ela que passa por
 * cima da liberação.
 */
export function laudoPendente(task) {
    if (!task) return false;
    if (task.type === 'agendamento_rapido') return false;
    if (estaReaberto(task)) return true;
    if (task.releasedAt) return false;
    if (task.status === 'concluido' || task.status === 'arquivado') return false;
    return true;
}

/**
 * Etiqueta do cartão. `extraClasse` é o nome que cada lista dá ao elemento
 * (u-tag no Hub, m-tag no Mural), no mesmo espírito de `etiquetasDeEtapa`.
 *
 * Sem ela o caso reaberto se confunde com amostra nova, e ninguém entende por
 * que um protocolo de dois anos atrás está na fila.
 */
export function etiquetaReaberto(task, extraClasse) {
    if (!estaReaberto(task)) return '';
    return `<span class="${extraClasse} is-reaberta" title="Caso já laudado, trazido de volta do livro">`
        + '<i class="fas fa-rotate-left"></i>Reaberta</span>';
}

/**
 * Peso de ordenação: reaberto vai para o fim da fila.
 *
 * O prazo dele já foi cumprido — pela data de entrada, um caso de 2023 aparece
 * como centenas de dias em atraso e empurraria para baixo todo o trabalho que
 * ainda tem prazo correndo. Ele está na lista para ser encontrado, não para
 * cobrar ninguém.
 */
export function pesoReabertura(task) {
    return estaReaberto(task) ? 1 : 0;
}
