/**
 * PRIORIDADE DA AMOSTRA — urgente, prioritária ou comum.
 *
 * São dois marcadores na entrada, não um só: `isUrgent` já existia e continua
 * como está (é o que os casos antigos gravaram), e `isPriority` entra ao lado
 * dele. Um campo único de nível seria mais bonito, mas o Firestore não devolve
 * documento que não tem o campo — todo caso urgente já cadastrado sumiria da
 * fila do Hub no dia da migração.
 *
 * A escala é uma só, então marcar os dois é contradição: o formulário desmarca
 * um ao marcar o outro, e aqui o urgente ganha de qualquer jeito.
 */

/** Rótulo, ícone e classe de cada nível. Vermelho grita; âmbar chama. */
export const NIVEIS = {
    urgente: {
        chave: 'urgente',
        rotulo: 'Urgente',
        plural: 'urgentes',
        icone: 'fa-triangle-exclamation',
        classe: 'is-urgent',
        titulo: 'Amostra urgente'
    },
    prioritaria: {
        chave: 'prioritaria',
        rotulo: 'Prioritária',
        plural: 'prioritárias',
        icone: 'fa-flag',
        classe: 'is-priority',
        titulo: 'Amostra prioritária'
    }
};

/** 'urgente' | 'prioritaria' | null (comum). */
export function nivelDaAmostra(task) {
    if (!task) return null;
    if (task.isUrgent) return 'urgente';
    if (task.isPriority) return 'prioritaria';
    return null;
}

/** Metadados do nível, ou null para amostra comum. */
export function infoDoNivel(task) {
    const nivel = nivelDaAmostra(task);
    return nivel ? NIVEIS[nivel] : null;
}

/** A amostra fura a fila? É o que decide quem aparece no painel do Hub. */
export function temPrioridade(task) {
    return nivelDaAmostra(task) !== null;
}

/** Peso para ordenar: urgente (0) antes de prioritária (1) antes de comum (2). */
export function pesoPrioridade(task) {
    const nivel = nivelDaAmostra(task);
    if (nivel === 'urgente') return 0;
    if (nivel === 'prioritaria') return 1;
    return 2;
}

/** Classe do cartão: `is-urgent`, `is-priority` ou vazio. */
export function classeDoNivel(task) {
    const info = infoDoNivel(task);
    return info ? info.classe : '';
}

/**
 * Bandeirinha que vai ao lado do protocolo nos cartões do Hub e do Mural.
 * `extraClasse` é o nome que cada tela dá ao ícone (u-flag, m-flag).
 */
export function bandeiraDoNivel(task, extraClasse) {
    const info = infoDoNivel(task);
    if (!info) return '';
    return `<i class="fas ${info.icone} ${extraClasse} ${info.classe}" title="${info.titulo}"></i>`;
}
