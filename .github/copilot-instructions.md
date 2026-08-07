# Instrucoes do Projeto LPV

## Regra de custo
- Nao usar Firebase Cloud Functions neste projeto.
- Motivo: recurso pago e o cliente nao deseja custo adicional.

## Preferencia tecnica
- Priorizar implementacoes sem backend pago.
- Usar integracao direta cliente -> Supabase/Firestore quando viavel.
- Ao precisar de exclusao de arquivos, garantir tentativa de exclusao no storage antes de remover metadados do Firestore.

## Excecao
- So considerar Cloud Functions se o usuario pedir explicitamente nesta conversa.
      