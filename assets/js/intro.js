/**
 * ANIMAÇÃO DE ABERTURA (intro) — logo com as bolinhas em órbita.
 *
 * Era código solto dentro do index.html. Virou arquivo próprio para rodar
 * também em pages/auth.html: o PWA instalado abre direto no login e nunca
 * passava pelo index, então quem usava o app nunca via a animação.
 *
 * POR QUE SCRIPT CLÁSSICO (e não `type="module"`)
 * Módulo é sempre adiado até o fim do parse: o overlay entraria depois da
 * página já ter aparecido, e a pessoa veria um pisca do conteúdo antes da
 * animação. Clássico executa na posição em que está — por isso a tag vai como
 * PRIMEIRO elemento do <body>, e o overlay já faz parte da primeira pintura.
 *
 * COMO USAR
 *   <script src="../assets/js/intro.js" data-modo="app"></script>
 *
 *   data-modo="sempre"  → toca em toda visita (uma vez por sessão). É o index.
 *   data-modo="app"     → só no aplicativo instalado E só se a pessoa tiver
 *                         ligado a animação em Meu Perfil. É o login.
 *   data-modo="forcado" → toca sempre, sem condição nenhuma. Serve ao botão
 *                         "Ver agora" de Meu Perfil, que injeta este script na
 *                         hora para a pessoa conferir como ficou sem precisar
 *                         fechar e reabrir o aplicativo. `?intro=1` no endereço
 *                         tem o mesmo efeito.
 *
 * AO TERMINAR (tendo tocado ou tendo sido pulada) põe `page-revealed` no
 * <body> e dispara o evento `lpv:intro-fim` — é assim que o index revela o
 * conteúdo dele.
 */
(function () {
    'use strict';

    // Preferência por dispositivo, ligada em Meu Perfil. Fica no localStorage e
    // não no Firestore de propósito: a animação roda ANTES do login, quando
    // ainda não há usuário para consultar.
    var CHAVE_PREFERENCIA = 'lpv-intro-app';

    // Sem clique, o jingle não toca (o navegador bloqueia áudio sem gesto) e o
    // overlay não pode ficar no caminho para sempre. Passado esse tempo a
    // animação segue sozinha, calada. Não vale para o index — veja o fim do
    // arquivo.
    var ESPERA_ATE_SEGUIR_SOZINHO = 5000;

    var script = document.currentScript;
    var modo = (script && script.dataset.modo) || 'sempre';

    // Caminho dos arquivos a partir do próprio script (.../assets/js/intro.js),
    // não da página: o mesmo arquivo serve o index (raiz) e as páginas de
    // /pages/, e continua válido numa subpasta como o /Lpv/ do GitHub Pages.
    var base = script ? script.src : location.href;
    var imagemCentro = new URL('../images/centro.png', base).href;
    var jingle = new URL('../audio/jingle lpv.wav', base).href;

    // =============================
    // CONFIGURAÇÃO DAS ÓRBITAS DO LOGO
    // Edite os valores abaixo para ajustar manualmente as órbitas das bolinhas:
    // =============================
    // Ângulos de órbita (graus) de cada bolinha
    var orbitOffsets = [0, 40, 80, 120, 160, 200, 240, 280, 320];

    // Tamanhos das bolinhas como fração do fontSize (ex: 0.112 = 11.2% do fontSize)
    var orbSizeFractions = [0.112, 0.156, 0.201, 0.246, 0.268, 0.290, 0.290, 0.268, 0.246]
        .map(function (f) { return f * 0.8; });

    // Posições finais (ao clicar) como fração do fontSize
    // xF: fração horizontal, yF: fração vertical
    var positionFractions = [
        { xF: 1.563, yF: -0.580 },
        { xF: 1.741, yF: -0.313 },
        { xF: 1.830, yF:  0.045 },
        { xF: 1.741, yF:  0.402 },
        { xF: 1.518, yF:  0.714 },
        { xF: 1.205, yF:  0.893 },
        { xF: 0.848, yF:  0.893 },
        { xF: 0.536, yF:  0.737 },
        { xF: 0.313, yF:  0.491 }
    ];

    // ─── DECISÃO: toca ou não? ───────────────────────────────────────────────

    function rodandoComoApp() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }

    function animacaoLigadaNesteAparelho() {
        try {
            return localStorage.getItem(CHAVE_PREFERENCIA) === '1';
        } catch (e) {
            return false;   // navegação privada / armazenamento bloqueado
        }
    }

    function prefereMenosMovimento() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function jaViuNestaSessao() {
        try {
            return sessionStorage.getItem('lpv-intro-seen') === 'true';
        } catch (e) {
            return false;
        }
    }

    function marcarComoVista() {
        try {
            sessionStorage.setItem('lpv-intro-seen', 'true');
        } catch (e) { /* sem sessionStorage, toca de novo — não é problema */ }
    }

    function encerrar() {
        document.body.classList.add('page-revealed');
        document.dispatchEvent(new CustomEvent('lpv:intro-fim'));
    }

    var forcada = modo === 'forcado' ||
                  new URLSearchParams(location.search).get('intro') === '1';

    if (!forcada) {
        if (jaViuNestaSessao() || prefereMenosMovimento()) {
            encerrar();
            return;
        }
        if (modo === 'app' && !(rodandoComoApp() && animacaoLigadaNesteAparelho())) {
            encerrar();
            return;
        }
    }

    // ─── MONTAGEM DO OVERLAY ─────────────────────────────────────────────────

    var overlay = document.createElement('div');
    overlay.className = 'intro-overlay';
    overlay.id = 'intro-overlay';
    overlay.innerHTML =
        '<audio id="intro-audio" preload="auto"></audio>' +
        '<div class="intro-text">LPV</div>' +
        '<div class="intro-logo-container">' +
            '<div class="intro-center"><img alt="LPV"></div>' +
        '</div>' +
        '<div class="intro-orbs-wrapper">' +
            '<div class="intro-orb blue"></div><div class="intro-orb blue"></div>' +
            '<div class="intro-orb blue"></div><div class="intro-orb green"></div>' +
            '<div class="intro-orb green"></div><div class="intro-orb green"></div>' +
            '<div class="intro-orb green"></div><div class="intro-orb green"></div>' +
            '<div class="intro-orb green"></div>' +
        '</div>' +
        '<div class="intro-cta"><i class="fas fa-hand-pointer"></i>Toque para entrar</div>';

    // src via propriedade, e não escrito no HTML: o nome do jingle tem espaço e
    // precisa sair codificado — deixar o navegador resolver a URL evita o 404.
    overlay.querySelector('.intro-center img').src = imagemCentro;
    var audio = overlay.querySelector('#intro-audio');
    audio.src = jingle;

    document.body.appendChild(overlay);

    // ─── ANIMAÇÃO ────────────────────────────────────────────────────────────

    // Fatores para ajuste manual
    // offsetX: move o conjunto para a direita/esquerda (em px)
    // offsetY: move o conjunto para cima/baixo (em px)
    // radiusScale: aumenta/diminui o raio do conjunto
    var offsetX, offsetY, radiusScale, orbitRadius;
    var noCelular = window.innerWidth <= 900;

    // O font-size calculado do texto é a régua de tudo (sem a inflação que o
    // line-height traria).
    var textEl = overlay.querySelector('.intro-text');
    var fontSize = parseFloat(getComputedStyle(textEl).fontSize);

    if (noCelular) {
        offsetX = 50;
        offsetY = 0;
        radiusScale = 0.7;
        orbitRadius = fontSize * 1;
    } else {
        offsetX = 120;
        offsetY = 0;
        radiusScale = 0.8;
        orbitRadius = fontSize * 0.7;
    }

    function computeFinalPositions() {
        return positionFractions.map(function (p) {
            return {
                x: (p.xF * radiusScale * fontSize) + offsetX,
                y: (p.yF * radiusScale * fontSize) + offsetY
            };
        });
    }

    var orbs = overlay.querySelectorAll('.intro-orb');

    // Tamanho das bolinhas proporcional ao fontSize
    orbs.forEach(function (orb, i) {
        var size = Math.max(6, Math.round(fontSize * orbSizeFractions[i]));
        orb.style.width = size + 'px';
        orb.style.height = size + 'px';
    });

    var orbitAngle = 0;
    var orbiting = true;
    var speed = 0.8; // graus por quadro

    function animateOrbit() {
        if (!orbiting) return;
        orbitAngle += speed;
        orbs.forEach(function (orb, i) {
            var angle = (orbitAngle + orbitOffsets[i]) * Math.PI / 180;
            var x = Math.cos(angle) * orbitRadius;
            var y = Math.sin(angle) * orbitRadius;
            orb.style.transform = 'translate(' + (x - orb.offsetWidth / 2) + 'px, ' +
                                                 (y - orb.offsetHeight / 2) + 'px)';
            orb.style.opacity = 0.8 + 0.2 * Math.sin(angle);
        });
        requestAnimationFrame(animateOrbit);
    }
    requestAnimationFrame(animateOrbit);

    var started = false;
    var temporizador;

    /**
     * @param {boolean} comSom  Só é true quando quem disparou foi um clique de
     *                          verdade. Áudio sem gesto do usuário é bloqueado
     *                          pelo navegador — tentar iria só encher o console.
     */
    function startIntro(comSom) {
        if (started) return;
        started = true;
        orbiting = false;
        clearTimeout(temporizador);

        var finalPositions = computeFinalPositions();

        if (comSom) {
            audio.muted = false;
            audio.currentTime = 0;
            audio.volume = 1;
            var playPromise = audio.play();
            if (playPromise) {
                playPromise.catch(function (e) {
                    console.warn('Não foi possível tocar o jingle:', e);
                });
            }
        }

        // Cada bolinha viaja da posição atual até o lugar dela no logo
        orbs.forEach(function (orb, index) {
            var currentTransform = getComputedStyle(orb).transform;
            var currentX = 0, currentY = 0;
            if (currentTransform !== 'none') {
                var matrix = new DOMMatrix(currentTransform);
                currentX = matrix.m41;
                currentY = matrix.m42;
            }

            var final = finalPositions[index];
            var finalX = final.x - orb.offsetWidth / 2;
            var finalY = final.y - orb.offsetHeight / 2;

            orb.animate([
                { transform: 'translate(' + currentX + 'px, ' + currentY + 'px)', opacity: 1 },
                { transform: 'translate(' + finalX + 'px, ' + finalY + 'px)', opacity: 1 }
            ], {
                duration: 1200,
                delay: index * 50,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'forwards'
            });
        });

        overlay.classList.add('playing');

        setTimeout(function () {
            overlay.classList.add('fade-out');
            // Uma pré-visualização não conta como "já vi nesta sessão" — senão
            // conferir a animação em Meu Perfil cancelaria a de verdade.
            if (!forcada) marcarComoVista();
            encerrar();
            setTimeout(function () { overlay.remove(); }, 800);
        }, 3000);
    }

    overlay.addEventListener('click', function () { startIntro(true); });
    overlay.addEventListener('touchstart', function () { startIntro(true); });

    // Rede de segurança, só fora do index: no app instalado ninguém "chega" com
    // um clique, e um overlay parado em cima do login seria, para quem olha, um
    // aplicativo travado.
    //
    // No index (`sempre`) o overlay continua esperando o clique pelo tempo que
    // for — é assim desde sempre, e é o clique que libera o jingle.
    if (modo !== 'sempre') {
        temporizador = setTimeout(function () {
            startIntro(false);
        }, ESPERA_ATE_SEGUIR_SOZINHO);
    }
})();
