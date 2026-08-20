/**
 * LAYOUTS DO HUB — o mesmo painel, dois arranjos.
 *
 * "Como o Hub deveria ficar" não tem uma resposta só: quem fecha laudo quer a
 * fila inteira à vista e quem coordena o dia quer a semana grande. Em vez de
 * escolher por todo mundo, o painel guarda os dois arranjos e a pessoa escolhe
 * no botão "Layout".
 *
 * A troca é só CSS: o HTML é um só e os mesmos cartões mudam de lugar conforme
 * o `data-hub-layout` do <html>. Nada é redesenhado nem relido do Firestore ao
 * trocar — a fila e a semana que já estavam na tela continuam ali.
 *
 * A escolha é da pessoa e viaja com a conta: quem prefere o foco dividido o
 * encontra assim no computador do laboratório, no da sala e no celular, sem
 * ter que reescolher a cada máquina. Quem grava no Firestore é o hub.js, que
 * é quem tem o documento do usuário na mão.
 *
 * O localStorage continua aqui, mas como cache e não como dono: o layout tem
 * de estar aplicado antes da primeira pintura, e a conta só chega depois do
 * login resolver. Sem essa cópia local, toda abertura começaria no arranjo
 * padrão e pularia para o certo na frente de quem está olhando.
 */

export const CHAVE_LAYOUT = 'lpv-hub-layout';

/**
 * `blocos` é quantos retângulos o desenho em miniatura do menu tem — o
 * arranjo de cada um está no CSS, em `[data-layout-preview]`.
 */
export const LAYOUTS = [
    {
        id: 'completo',
        nome: 'Painel completo',
        resumo: 'Prioridades, biópsias e necropsias lado a lado; semana e estoque embaixo.',
        icone: 'fa-table-cells-large',
        blocos: 4
    },
    {
        id: 'foco',
        nome: 'Foco dividido',
        resumo: 'Só urgências e prioridades em cima, a semana embaixo — metade da tela para cada.',
        icone: 'fa-grip-lines',
        blocos: 2
    }
];

export const LAYOUT_PADRAO = LAYOUTS[0].id;

const IDS = LAYOUTS.map((l) => l.id);

/** Nome de layout desconhecido (versão antiga, dedo errado) volta ao padrão. */
export function layoutValido(id) {
    return IDS.includes(id) ? id : LAYOUT_PADRAO;
}

export function layoutAtual() {
    return layoutValido(document.documentElement.getAttribute('data-hub-layout'));
}

/**
 * Redesenha as marcas do menu. Fica aqui, e não dentro do
 * `initSeletorDeLayout`, porque o layout também muda por fora dele — quando a
 * escolha guardada na conta chega — e o certinho do menu tem que acompanhar.
 */
let marcarEscolhido = () => {};

export function aplicarLayout(id) {
    const escolhido = layoutValido(id);
    document.documentElement.setAttribute('data-hub-layout', escolhido);
    try {
        localStorage.setItem(CHAVE_LAYOUT, escolhido);
    } catch (e) { /* aparelho sem armazenamento: vale só para esta sessão */ }
    marcarEscolhido();
    return escolhido;
}

/**
 * Monta o menu do botão "Layout" e devolve o layout em vigor.
 *
 * `aoEscolher` recebe o layout depois de cada clique — é por ele que o Hub
 * guarda a escolha na conta. Só dispara em clique: sincronizar o que veio da
 * conta não pode devolver a mesma escrita para o Firestore.
 */
export function initSeletorDeLayout(aoEscolher) {
    const botao = document.getElementById('layout-btn');
    const menu = document.getElementById('layout-menu');
    if (!botao || !menu) return layoutAtual();

    menu.innerHTML = LAYOUTS.map((layout) => `
        <button type="button" class="layout-option" role="menuitemradio" data-layout="${layout.id}">
            <span class="layout-preview" data-layout-preview="${layout.id}">
                ${'<span></span>'.repeat(layout.blocos)}
            </span>
            <span class="layout-option-text">
                <strong><i class="fas ${layout.icone}"></i>${layout.nome}</strong>
                <small>${layout.resumo}</small>
            </span>
            <i class="fas fa-check layout-option-check"></i>
        </button>`).join('');

    marcarEscolhido = () => {
        const atual = layoutAtual();
        menu.querySelectorAll('.layout-option').forEach((opcao) => {
            const escolhido = opcao.dataset.layout === atual;
            opcao.classList.toggle('is-active', escolhido);
            opcao.setAttribute('aria-checked', escolhido ? 'true' : 'false');
        });
    };

    const fechar = () => {
        menu.classList.add('hidden');
        botao.setAttribute('aria-expanded', 'false');
    };

    botao.addEventListener('click', (evento) => {
        evento.stopPropagation();
        const abrindo = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !abrindo);
        botao.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
        if (abrindo) marcarEscolhido();
    });

    menu.addEventListener('click', (evento) => {
        const opcao = evento.target.closest('.layout-option');
        if (!opcao) return;
        aplicarLayout(opcao.dataset.layout);
        fechar();
        if (typeof aoEscolher === 'function') aoEscolher(layoutAtual());
    });

    // Clique fora e Esc fecham — menu que só fecha no próprio botão prende o
    // clique seguinte de quem desistiu.
    document.addEventListener('click', (evento) => {
        if (!menu.classList.contains('hidden') && !menu.contains(evento.target)) fechar();
    });
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape') fechar();
    });

    marcarEscolhido();
    return layoutAtual();
}
