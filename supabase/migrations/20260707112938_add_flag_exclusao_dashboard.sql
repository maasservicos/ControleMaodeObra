-- Soft-delete para o dashboard: registros problematicos (duplo-clique, testes)
-- ficam ocultos no dashboard sem serem removidos da tabela, mantendo o
-- historico completo disponivel para quem consultar o banco diretamente.
alter table "SistemaOS_Maas"
  add column if not exists excluido_dashboard boolean not null default false;

alter table "SistemaOS_Maas"
  add column if not exists motivo_exclusao_dashboard text;

comment on column "SistemaOS_Maas".excluido_dashboard is
  'Quando true, o registro fica oculto no dashboard mas permanece no banco.';
comment on column "SistemaOS_Maas".motivo_exclusao_dashboard is
  'Motivo da exclusao no dashboard (ex: duplo-clique, registro de teste).';
