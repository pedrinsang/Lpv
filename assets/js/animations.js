/**
 * LPV — SISTEMA DE ANIMAÇÕES v1.0
 * Aplica animações de entrada em elementos renderizados dinamicamente.
 * Usa requestAnimationFrame para garantir que o elemento já está no DOM
 * antes de disparar a animação — evita o "pop" sem movimento.
 */

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const ANIMATION_CONFIG = {
    // Mapeamento: seletor CSS → animação que ele recebe
    selectors: {
        '.mural-card':       { animation: 'cardSlideIn', duration: '0.45s', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        '.admin-card':       { animation: 'springUp',    duration: '0.5s',  easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        '.info-card':        { animation: 'springUp',    duration: '0.45s', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
    staggerDelay: 55, // ms entre cada elemento filho
};

function getSiblingIndex(el) {
    if (!el?.parentElement) return 0;
    return Array.from(el.parentElement.children).indexOf(el);
}

// ============================================================
// MOTOR DE ANIMAÇÃO
// ============================================================

/**
 * Anima um elemento individual.
 * Usa dois frames de rAF para garantir que o browser já pintou o elemento.
 */
function animateElement(el, animationName, duration, easing, delay = 0) {
    // Esconde antes de animar para evitar flash
    el.style.opacity = '0';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.style.opacity = '';
            el.style.animation = 'none';

            // Força reflow para resetar qualquer animação anterior
            void el.offsetHeight;

            el.style.animation = `${animationName} ${duration} ${easing} ${delay}ms both`;

            // Limpa o estilo inline após terminar para não travar re-animações
            const totalMs = parseFloat(duration) * 1000 + delay;
            setTimeout(() => {
                el.style.animation = '';
            }, totalMs + 100);
        });
    });
}

// ============================================================
// AUTO-ANIMAÇÃO — MutationObserver
// Detecta quando novos cards são inseridos no DOM e os anima automaticamente
// ============================================================

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue; // ignora texto/comentários

            // Verifica se o próprio nó inserido corresponde a algum seletor configurado
            for (const [selector, config] of Object.entries(ANIMATION_CONFIG.selectors)) {
                if (node.matches && node.matches(selector)) {
                    const index = getSiblingIndex(node);
                    animateElement(
                        node,
                        config.animation,
                        config.duration,
                        config.easing,
                        index * ANIMATION_CONFIG.staggerDelay
                    );
                }

                // Quando um bloco inteiro entra no DOM, anima também os filhos relevantes.
                if (node.querySelectorAll) {
                    const descendants = node.querySelectorAll(selector);
                    descendants.forEach((desc, idx) => {
                        const index = getSiblingIndex(desc);
                        const finalIndex = index >= 0 ? index : idx;
                        animateElement(
                            desc,
                            config.animation,
                            config.duration,
                            config.easing,
                            finalIndex * ANIMATION_CONFIG.staggerDelay
                        );
                    });
                }
            }
        }
    }
});

function startObserver() {
    if (!document.body) return;
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

if (document.body) {
    startObserver();
} else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
}

