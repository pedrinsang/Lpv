-- LPV - Supabase Storage setup (direct upload mode)
--
-- PRÉ-REQUISITO: o Firebase precisa estar cadastrado como Third-Party Auth no
-- painel do Supabase (Authentication -> Sign In / Providers -> Third-Party
-- Auth), com o project ID `labpatvet-9e06a`. É isso que faz o Supabase validar
-- a assinatura do token antes de qualquer política ser avaliada.
--
-- POR QUE O EMISSOR, E NÃO O PAPEL `authenticated`
--
-- O caminho recomendado pelo painel do Supabase é gravar a claim
-- `role: authenticated` em cada usuário do Firebase. Só que claim se define
-- fora do navegador, com o Admin SDK — e como o cadastro aqui é self-service,
-- toda pessoa nova ficaria sem acesso até alguém lembrar de rodar um script.
-- Um sistema que quebra em silêncio quando entra gente nova é um sistema que
-- vai quebrar.
--
-- O token do Firebase já diz quem o emitiu. A chave anônima, que viaja no
-- código do navegador e é o que um estranho teria em mãos, tem
-- `iss = "supabase"` e nenhum `sub`. Um token do laboratório tem o `iss` abaixo
-- e o UID do usuário no `sub`. Checar o emissor dispensa a claim, e usuário
-- novo passa a funcionar sozinho.
--
-- Forjar um token não adianta: o Supabase verifica a assinatura contra o
-- provider cadastrado e recusa antes de chegar aqui.
--
-- Execute no SQL Editor do Supabase.

begin;

insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public;

-- Políticas antigas: acesso anônimo (qualquer pessoa com a chave pública) e a
-- versão intermediária baseada no papel `authenticated`.
drop policy if exists "reports_anon_insert" on storage.objects;
drop policy if exists "reports_anon_select" on storage.objects;
drop policy if exists "reports_anon_delete" on storage.objects;

drop policy if exists "reports_authenticated_insert" on storage.objects;
drop policy if exists "reports_authenticated_select" on storage.objects;
drop policy if exists "reports_authenticated_delete" on storage.objects;

drop policy if exists "reports_firebase_insert" on storage.objects;
drop policy if exists "reports_firebase_select" on storage.objects;
drop policy if exists "reports_firebase_delete" on storage.objects;

create policy "reports_firebase_insert"
on storage.objects
for insert
to public
with check (
  bucket_id = 'reports'
  and name like 'tasks/%'
  and (auth.jwt() ->> 'iss') = 'https://securetoken.google.com/labpatvet-9e06a'
);

create policy "reports_firebase_select"
on storage.objects
for select
to public
using (
  bucket_id = 'reports'
  and name like 'tasks/%'
  and (auth.jwt() ->> 'iss') = 'https://securetoken.google.com/labpatvet-9e06a'
);

create policy "reports_firebase_delete"
on storage.objects
for delete
to public
using (
  bucket_id = 'reports'
  and name like 'tasks/%'
  and (auth.jwt() ->> 'iss') = 'https://securetoken.google.com/labpatvet-9e06a'
);

commit;
