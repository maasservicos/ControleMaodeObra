# Banco de Dados (Supabase)

Documentação das tabelas usadas pelo sistema. Não há migrations completas no repositório (as tabelas foram criadas direto no painel do Supabase) — este documento foi reconstruído a partir do uso real no código (`js/*.js`, `supabase/functions/*`).

---

## 1. `Funcionarios_Maas`

Cadastro dos colaboradores (mão de obra) que apontam horas no sistema.

| Campo | Uso |
|---|---|
| `id` | PK |
| `matricula` | Identificador usado para login/consulta (chave de busca) |
| `nome` | Nome do colaborador |
| `funcao` | Cargo/função |
| `valor_hora` | Valor pago por hora trabalhada, usado no cálculo de custo de M.O. |

**RLS:** leitura pública liberada (o quiosque operacional precisa consultar nome/função pela matrícula sem login). Escrita (INSERT/UPDATE) bloqueada para o client anônimo — passa exclusivamente pela edge function `gerenciar-funcionario`, que exige senha de admin.

---

## 2. `SistemaOS_Maas`

Tabela central do sistema: cada linha é **um evento de apontamento** (não um registro por OS). O histórico de uma OS é reconstruído juntando várias linhas em ordem cronológica.

| Campo | Uso |
|---|---|
| `id` | PK |
| `matricula` | Colaborador que apontou |
| `os` | Número da OS (ex: `"004521"`) ou nome de serviço avulso (ex: `"SEINFRA"`) |
| `status_cod` | Código do evento: `1` Início, `2` Peças, `3` Intervalo, `4` Retorno, `5` Término, `6` Pausa, `7` Fim de Expediente |
| `obs` | Observação livre (normalmente `"Web"` ou motivo de correção manual) |
| `created_at` | Data/hora do evento |
| `horas_trabalhadas` | Só preenchido nos eventos de término (5/7); soma os períodos entre Início/Retorno e as pausas |
| `excluido_dashboard` | Soft-delete: `true` oculta o registro no dashboard sem apagar do banco (adicionado em `20260707112938`) |
| `motivo_exclusao_dashboard` | Motivo da ocultação (ex: duplo-clique, teste) |

**RLS:** leitura e INSERT liberados para o client anônimo (é assim que o quiosque grava os apontamentos direto). Não há política de UPDATE nem DELETE para anon — edição e exclusão só acontecem via edge functions (`editar-apontamento`, `excluir-apontamento`), que validam a senha do admin no servidor com a Service Role Key.

---

## 3. `ServicosAvulsos_Maas`

Lista de serviços avulsos (trabalhos que não têm número de OS formal, ex: "SEINFRA") exibidos como chips clicáveis na tela operacional.

| Campo | Uso |
|---|---|
| `id` | PK |
| `nome` | Nome do serviço, usado para preencher o campo "OS" quando selecionado |
| `ativo` | Filtro — só os `ativo = true` aparecem na tela |

**RLS:** leitura pública. Sem escrita pelo client (gerenciamento é manual, direto no banco).

---

## 4. `Admin_Maas`

Credenciais dos administradores — usadas para autorizar ações sensíveis (editar/excluir apontamento, cadastrar/editar funcionário).

| Campo | Uso |
|---|---|
| `id` | PK |
| `matricula` | Login do admin |
| `senha` | Senha em **texto puro** (limitação conhecida e aceita — ver observação de segurança abaixo) |
| `nome` | Nome exibido após login |

**RLS:** nenhum acesso público (nem leitura). Desde a migration `20260707114456`, toda consulta a esta tabela passa por edge function com Service Role Key (`validar-admin`, `gerenciar-funcionario`, `editar-apontamento`, `excluir-apontamento`) — o browser nunca vê a senha de ninguém além da própria durante o login.

⚠️ **Senhas em texto puro:** decisão consciente para o escopo atual do sistema (ver memória do projeto). Se o volume/criticidade crescer, migrar para hash (bcrypt) é a próxima melhoria de segurança recomendada.

---

## Relacionamento entre as tabelas

```
Funcionarios_Maas (matricula) ──┐
                                 ├─→ SistemaOS_Maas (matricula, os)
ServicosAvulsos_Maas (nome) ────┘        ↑
                                          │ editado/excluído somente via
Admin_Maas (matricula, senha) ───────────┘ edge function autenticada
```

Não há foreign keys formais entre as tabelas — a ligação é feita por valor (`matricula`, `os`), não por constraint no banco.

## Edge Functions relacionadas

| Function | Tabelas que toca | Propósito |
|---|---|---|
| `validar-admin` | `Admin_Maas` | Login do admin no dashboard |
| `gerenciar-funcionario` | `Admin_Maas`, `Funcionarios_Maas` | Criar/atualizar funcionário (autenticado) |
| `editar-apontamento` | `Admin_Maas`, `SistemaOS_Maas` | Corrigir status/data de um apontamento |
| `excluir-apontamento` | `Admin_Maas`, `SistemaOS_Maas` | Excluir (hard delete) um apontamento |
