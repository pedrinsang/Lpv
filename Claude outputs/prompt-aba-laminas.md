# Prompt para o Claude Code — Aba "Lâminas" (corte/coloração)

Cole este prompt numa sessão do Claude Code aberta na raiz de `W:\Projetos\Github\Lpv`.

---

## Contexto

O Lpv é um organizador de laboratório (HTML estático multipágina em `pages/*.html` + `assets/js` + `assets/css`, Firebase Auth/Firestore). O design system fica em `assets/css/global.css` (importa `base/`, `components/`, `layout/`, `pages/`) — v7.0, tema dark único, tokens em `assets/css/base/variables.css`. Animações reutilizáveis estão em `assets/css/base/animations.css` e `assets/js/animations.js`.

O sistema de papéis já existe em `assets/js/core.js`: `normalizeRoles`, `hasAnyRole`, `applyRolePermissions`. Os protocolos das amostras já seguem o padrão **VN = necropsia** e **V = biópsia** (ver `assets/js/components/entry-modal.js`, função `detectTypeFromProtocolo`, e o hint do formulário em `entry-form.js`: `V = biópsia · VN = necropsia`). Os tokens `--color-necro` (azul) e `--color-bio` (rosa) em `variables.css` já existem exatamente para diferenciar esses dois tipos visualmente — use-os.

O Firestore já reserva uma coleção para isso e nunca foi usada: `firestore.rules` tem `match /slide_records/{recordId} { allow read, write: if isApprovedUser(); }`. Construa a feature em cima dela.

## Objetivo

Criar uma nova aba/página só para registrar e visualizar a produção de **lâminas cortadas e coradas**, com contagem separada por tipo de amostra (VN/necropsia e V/biópsia) e por responsável.

## Quem pode ver essa aba

**Somente** as roles `admin`, `professor` e `estagiario` (use `hasAnyRole` com essa lista exata — não reutilize `FULL_CONTROL_ROLES` nem `isLaudoManager`, porque ambas excluem estagiário ou incluem pós-graduando, que fica de fora aqui por pedido explícito). O link no sidebar deve nascer `hidden` e ser revelado em `applyRolePermissions` (mesmo padrão do `#sidebar-admin-link`), e a própria página deve redirecionar/bloquear quem não tem uma dessas três roles (não confiar só em esconder o link).

## Requisitos funcionais

1. **Registro de produção** (formulário rápido, pensado para lançar em segundos):
   - Tipo de amostra: **VN (necropsia)** ou **V (biópsia)** — dois pills/toggle, mesma linguagem visual de `is-necro`/`is-bio` já usada no pill de tipo do modal de nova entrada.
   - Ação: **corte** ou **coloração** — outro toggle.
   - Quantidade: campo numérico, default 1, mas precisa suportar lançar **mais de uma lâmina de uma vez** (ex.: "+5" cortadas na mesma leva) — não forçar um clique por lâmina.
   - Responsável: campo de nome com autocomplete. Vem **pré-preenchido com o nome do usuário logado** (`window.currentUser`/dado equivalente já exposto por `core.js`), mas precisa ser possível trocar e escolher **qualquer nome cadastrado no app** (coleção `users`) — reaproveite o padrão de carregamento de nomes já usado nos selects `#select-docente` / `#select-pos` do formulário de nova entrada (`entry-modal.js` + os libs em `assets/js/lib/`) como referência de como buscar/popular a lista de usuários. Implemente como combobox/input + `<datalist>` (texto livre não deve ser bloqueado, mas a lista de sugestões deve vir dos usuários cadastrados).
   - Botão "Registrar", com feedback de sucesso animado (ex.: pulso na leitura correspondente do dashboard, toast, ou similar ao que o app já usa em outras confirmações).

2. **Painel de totais gerais** (sempre visível, não depende de quem fez):
   - 2×2 (ou equivalente): VN cortadas · VN coradas · V cortadas · V coradas, com número grande, contagem animada (count-up) na entrada da página, cores `--color-necro`/`--color-bio` para diferenciar os dois tipos.

3. **Filtro de período**: hoje / semana / mês / tudo (ou intervalo de datas) — aplicado tanto ao painel de totais gerais quanto à quebra por pessoa. Recalcule os dois ao trocar o filtro.

4. **Quebra por pessoa** (ranking/tabela): cada responsável com seus próprios contadores de VN/V cortadas/coradas no período selecionado, ordenado por total (maior produção primeiro). Reaproveite o visual de card do design system (`--bg-card`, `--border-glass`, `border-radius` dos tokens) em vez de uma tabela HTML crua — pense em algo no espírito dos cards de `admin.html`/`admin.js`, mas adaptado a números.

## Modelo de dados (Firestore)

Grave cada lançamento como um **documento de evento**, no espírito de `inventory_events` (log append-only, nunca editado — erro se corrige com novo lançamento, não com update):

```
slide_records/{recordId}
  tipo: 'necropsia' | 'biopsia'
  acao: 'corte' | 'coloracao'
  quantidade: number (>= 1)
  responsavelUid: string | null   // uid do usuário escolhido, se ele existir em `users`
  responsavelNome: string          // nome mostrado/gravado, sempre presente
  createdByUid: string             // uid de quem efetivamente lançou (request.auth.uid)
  createdAt: serverTimestamp()
```

Os totais e a quebra por pessoa são **derivados** somando esses documentos (client-side, com os filtros de período aplicados na query ou em memória — decida pelo volume esperado, que é baixo).

Revise as regras do Firestore para `slide_records`: hoje está `allow read, write: if isApprovedUser()`, mais aberto que o necessário. Aperte para: leitura por `isApprovedUser()` (ok manter), criação restrita às três roles (`admin`, `professor`, `estagiario`) e validando os campos obrigatórios (`tipo`, `acao`, `quantidade > 0`, `createdByUid == request.auth.uid`), sem `update` (`allow update: if false`, como em `inventory_events`), `delete` liberado só para quem lançou ou para admin.

## Design / UX

- Siga o design system existente à risca — não crie paleta nova. Dark, `--bg-card`/`--bg-glass`, `--border-glass`, `--radius-md`/`--radius-lg`, sombras `--shadow-*`, fonte Inter.
- Anime a entrada da página com as classes/keyframes que já existem em `assets/css/base/animations.css` e `assets/js/animations.js` (ex.: `springUp`, `cardSlideIn`, `fadeInUp`) em vez de inventar transições novas.
- Números dos totais devem subir com count-up ao carregar (e ao trocar o filtro de período), não aparecer estáticos.
- Diferencie visualmente necropsia (azul, `--color-necro`) de biópsia (rosa, `--color-bio`) em todo lugar que mostrar os dois tipos lado a lado — pills, barrinhas, ícones (reaproveite os ícones já usados: `fa-skull` para necropsia, `fa-microscope` para biópsia, do `TYPE_LABELS` de `entry-modal.js`).
- Responsivo: siga os breakpoints de `assets/css/layout/responsive.css` e o padrão de bottom-nav mobile já usado nas outras páginas.
- Estado vazio (sem nenhum lançamento ainda) precisa de um empty state coerente com o resto do app, não uma tela em branco.

## Arquivos esperados

- Nova página `pages/laminas.html` (título/sidebar: algo como "Lâminas" ou "Produção"), seguindo a estrutura de cabeçalho/sidebar/bottom-nav das páginas existentes (copie a estrutura de `historico.html` ou `estoque.html` como esqueleto, incluindo o link `id="sidebar-admin-link"` como referência para o novo link, e o `migracao.js` no topo do `<head>`).
- `assets/js/pages/laminas.js` com a lógica (form, listeners, cálculo dos totais, render da quebra por pessoa, filtro de período).
- CSS específico em `assets/css/pages/laminas.css`, importado em `global.css` junto dos outros (`@import url('pages/laminas.css');`), reaproveitando tokens em vez de valores soltos.
- Ajuste em `assets/js/core.js` (`applyRolePermissions`) para revelar o novo link do sidebar às três roles corretas.
- Adicionar o link do sidebar (`hidden` por padrão) em todas as páginas que já têm `#sidebar-admin-link` hoje (`hub.html`, `historico.html`, `mural.html`, `estoque.html`, `planner.html`, `perfil.html`, `admin.html`), para manter a navegação consistente.
- Atualização em `firestore.rules` para a coleção `slide_records` conforme a seção de modelo de dados.

## Restrições

- Mudança incremental e isolada: não mexa em outras páginas além do necessário para pendurar o link do sidebar, não refatore o design system, não toque no fluxo de Registros/Mural/Planner/Estoque existentes.
- Código e UI em português (pt-BR), como o resto do projeto.
- Antes de codar, rode `code W:\Projetos\Github\Lpv` para eu acompanhar pelo Live Server do VS Code.

## Critério de aceite

- Só admin, professor e estagiário veem o link e conseguem abrir a página; qualquer outra role é bloqueada mesmo digitando a URL direto.
- Lançar um corte/coloração com quantidade > 1 soma corretamente nos totais gerais e no card da pessoa certa.
- Trocar o filtro de período recalcula totais gerais e quebra por pessoa juntos.
- Autocomplete do responsável sugere qualquer usuário cadastrado, mas já vem preenchido com quem está logado.
- Visual e animações batem com o resto do app — nenhuma cor, sombra ou easing fora dos tokens existentes.
