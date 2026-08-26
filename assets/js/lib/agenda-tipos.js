/**
 * TIPOS DA AGENDA — a paleta do calendário, em um lugar só.
 *
 * A mesma tabela serve o Planner (onde a agenda é editada) e a semana do Hub
 * (onde ela é lida de relance). Estavam separados: o Planner conhecia quatro
 * tipos e o Hub só três classes de CSS, então "Aula" chegava no Hub como cinza
 * de "outros" — a cor dizia uma coisa numa tela e outra coisa na tela ao lado.
 *
 * Cada tipo tem duas cores porque elas fazem trabalhos diferentes:
 *
 *   `cor`      — o traço e a borda: saturada, para marcar o cartão.
 *   `corTexto` — a mesma matiz clareada, para o texto ficar legível sobre o
 *                fundo escuro. O azul de necropsia (#3b82f6) como texto sobre
 *                #0f172a não se lê.
 */

export const TIPOS_AGENDA = [
    {
        id: 'necropsia',
        rotulo: 'Necropsia',
        curto: 'NECRO',
        cor: '#3b82f6',
        corTexto: '#93bbfd'
    },
    {
        id: 'biopsia',
        rotulo: 'Biópsia',
        curto: 'BIO',
        cor: '#ec4899',
        corTexto: '#f9a8d4'
    },
    {
        id: 'aula',
        rotulo: 'Aula',
        curto: 'AULA',
        cor: '#10b981',
        corTexto: '#6ee7b7'
    },
    {
        /**
         * Pós-graduandos: o que é da rotina de quem está na pós — reunião de
         * orientação, defesa, plantão do pós — e não é caso de laboratório.
         *
         * Laranja (#f97316, o mesmo `swatch.orange` do formulário de entrada) e
         * não âmbar: âmbar (#f59e0b/#fbbf24) já significa "prioritária" nos
         * cartões da fila do Hub, e duas coisas diferentes na mesma matiz numa
         * tela que mostra as duas seria só confusão.
         */
        id: 'posgrad',
        rotulo: 'Pós-graduandos',
        curto: 'PÓS',
        cor: '#f97316',
        corTexto: '#fdba74'
    },
    {
        /**
         * Estágio: tarefa de estagiário, falta, troca de turno — o que é da
         * rotina de quem está estagiando e não é caso de laboratório.
         *
         * Roxo porque é a única matiz que sobrava: azul e rosa são os dois tipos
         * de amostra, verde é aula, laranja é a pós, âmbar e vermelho já
         * significam prazo (prioritária e urgente) nos cartões da fila, e o
         * ciano é a cor da marca. Ver a legenda da semana em hub.js — cor sem
         * legenda é enfeite.
         */
        id: 'estagio',
        rotulo: 'Estagiários',
        curto: 'ESTAGS',
        cor: '#a855f7',
        corTexto: '#d8b4fe'
    },
    {
        id: 'outro',
        rotulo: 'Outros',
        curto: 'GERAL',
        cor: '#94a3b8',
        corTexto: '#cbd5e1'
    }
];

export const TIPO_AGENDA = Object.fromEntries(TIPOS_AGENDA.map((t) => [t.id, t]));

/** O tipo padrão de quem não se encaixa em nada. */
export const TIPO_PADRAO = 'outro';

/**
 * Descobre o tipo de agenda de uma tarefa.
 *
 * Agendamento criado no Planner guarda `plannerTipo`; entrada do Mural usa
 * `type`; e o cadastro antigo só tem a cor do cassete (`k7Color`).
 */
export function tipoDaAgenda(task) {
    if (!task) return TIPO_PADRAO;
    if (task.plannerTipo && TIPO_AGENDA[task.plannerTipo]) return task.plannerTipo;
    if (task.type === 'necropsia') return 'necropsia';
    if (task.type === 'biopsia') return 'biopsia';
    if (task.type === 'aula') return 'aula';
    if (!task.type && task.k7Color === 'azul') return 'necropsia';
    if (!task.type && task.k7Color === 'rosa') return 'biopsia';
    return TIPO_PADRAO;
}

/** Metadados do tipo, com o fallback já resolvido. */
export function infoDoTipo(tipo) {
    return TIPO_AGENDA[tipo] || TIPO_AGENDA[TIPO_PADRAO];
}

/**
 * Pinta um elemento com as variáveis do tipo. As duas telas leem os mesmos
 * nomes, então um cartão do Planner e um chip do Hub nunca saem de cor um do
 * outro.
 *
 * O alfa vai como sufixo hexadecimal (`1f`, `26`, `55`) em vez de `rgba()`
 * porque a cor já chega como hex — converter para rgb aqui só criaria mais uma
 * peça para dar errado.
 */
export function pintarPorTipo(node, tipo, forte) {
    const { cor, corTexto } = infoDoTipo(tipo);
    node.style.setProperty('--card-color', cor);
    node.style.setProperty('--card-text', corTexto);
    node.style.setProperty('--card-tint', `${cor}1f`);
    node.style.setProperty('--card-edge', `${cor}55`);
    node.style.setProperty('--card-chip', `${cor}26`);
    if (forte) node.style.setProperty('--card-tint-strong', `${cor}33`);
}
