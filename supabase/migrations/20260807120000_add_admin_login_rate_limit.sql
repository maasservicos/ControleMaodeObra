-- As edge functions que validam senha de admin (validar-admin, excluir-apontamento,
-- editar-apontamento, gerenciar-funcionario) nao tinham nenhum limite de tentativas,
-- ou seja, a senha em texto puro do Admin_Maas podia ser atacada por forca bruta sem
-- nenhum bloqueio. Esta tabela guarda tentativas por matricula; so a service role
-- (dentro das edge functions) acessa ela.
create table if not exists "AdminTentativas_Maas" (
  matricula text primary key,
  tentativas integer not null default 0,
  bloqueado_ate timestamptz
);

alter table "AdminTentativas_Maas" enable row level security;
-- Nenhuma policy publica: sem SELECT/INSERT/UPDATE/DELETE para anon/authenticated.
