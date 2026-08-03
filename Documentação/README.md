# Maas — Controle de Mao de Obra

Sistema web para apontamento e controle de produtividade de colaboradores, desenvolvido para a **MAAS Servicos**.

---

## Tecnologias

| Tecnologia | Funcao |
|---|---|
| HTML / CSS / JavaScript | Interface do sistema (sem framework) |
| [Vite](https://vitejs.dev/) | Ferramenta de build e servidor de desenvolvimento |
| [Supabase](https://supabase.com/) | Banco de dados e backend (PostgreSQL + Edge Functions) |
| [Vercel](https://vercel.com/) | Hospedagem e deploy automatico |
| [SheetJS](https://sheetjs.com/) | Exportacao de relatorios em Excel |

---

## Estrutura de Arquivos

```
ControleMaodeObra/
├── index.html               -> Tela de apontamento operacional
├── dashboard.html           -> Painel de gestao com KPIs
├── consulta-os.html         -> Consulta de Ordens de Servico
├── funcionarios.html        -> Cadastro de funcionarios (protegido por login de admin)
│
├── js/
│   ├── supabaseClient.js    -> Conexao com o Supabase
│   ├── operacional.js       -> Logica da tela de apontamento
│   ├── dashboard.js         -> Logica do painel de gestao
│   ├── consulta-os.js       -> Logica da consulta de O.S.
│   ├── funcionarios.js      -> Logica do cadastro de funcionarios
│   └── erros.js             -> Regras de deteccao de inconsistencias (compartilhado)
│
├── css/
│   ├── operacional.css
│   ├── dashboard.css
│   └── consulta-os.css
│
├── supabase/
│   ├── functions/
│   │   ├── excluir-apontamento/    -> Exclusao segura de apontamento
│   │   ├── editar-apontamento/     -> Edicao segura de apontamento
│   │   ├── validar-admin/          -> Login de admin (funcionarios.html)
│   │   └── gerenciar-funcionario/  -> Criar/editar funcionario
│   └── migrations/                 -> Historico de alteracoes no schema/RLS
│
├── Imagens/
├── .env                     -> Variaveis de ambiente (NAO sobe pro GitHub)
├── .env.example             -> Modelo do .env (sobe pro GitHub)
├── .gitignore
├── vite.config.js
└── package.json
```

---

## Tabelas no Supabase

| Tabela | Descricao |
|---|---|
| `Funcionarios_Maas` | Cadastro de colaboradores (matricula, nome, funcao, valor_hora) |
| `SistemaOS_Maas` | Todos os apontamentos realizados (com soft-delete via `excluido_dashboard`) |
| `Admin_Maas` | Usuarios autorizados a excluir/editar apontamentos e gerenciar funcionarios (matricula, senha, nome) |
| `ServicosAvulsos_Maas` | Servicos avulsos disponiveis para apontamento (nome, ativo) |

---

## Codigos de Status (`status_cod`)

| Codigo | Significado |
|---|---|
| `1` | Inicio de O.S. |
| `2` | Aguardando Pecas |
| `3` | Intervalo |
| `4` | Retorno |
| `5` | Termino de O.S. |
| `6` | Pausa |
| `7` | Fim de Expediente |

---

## Seguranca

### Credenciais fora do codigo
As chaves do Supabase ficam no arquivo `.env` (ignorado pelo Git) e nas variaveis de ambiente do Vercel. O codigo-fonte nunca contem credenciais.

### Protecao contra XSS
Todos os valores vindos do banco de dados que sao inseridos no HTML passam pela funcao `esc()`, que neutraliza caracteres especiais (`<`, `>`, `"`, `'`, `&`). Botoes dinamicos usam atributos `data-*` com event listeners em vez de `onclick` com dados embutidos.

### Excluir/editar apontamento e gerenciar funcionarios via Edge Functions
Toda escrita que exige senha de admin e feita em **Supabase Edge Functions** (servidor), nunca no browser:

| Function | Uso |
|---|---|
| `excluir-apontamento` | Exclui um registro de `SistemaOS_Maas` |
| `editar-apontamento` | Atualiza status/data/obs de um registro de `SistemaOS_Maas` |
| `validar-admin` | Login de admin em `funcionarios.html` (so valida, nao escreve) |
| `gerenciar-funcionario` | Cria/atualiza registros em `Funcionarios_Maas` |

Fluxo (mesmo padrao nas quatro):
```
Browser envia: matricula + senha + dados da acao
      ↓
Edge Function (servidor):
  - Consulta Admin_Maas com Service Role Key
  - Compara a senha
  - Se valida: executa a acao (INSERT/UPDATE/DELETE)
  - Retorna sucesso ou erro
```
A senha nunca e enviada de volta ao browser. A Service Role Key fica exclusivamente no servidor do Supabase.

### RLS (Row Level Security)
Todas as tabelas tem RLS ativo no Supabase:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `Funcionarios_Maas` | Publico | Apenas via Edge Function | Apenas via Edge Function | Nao |
| `SistemaOS_Maas` | Publico | Publico | Apenas via Edge Function | Apenas via Edge Function |
| `Admin_Maas` | Nao | Nao | Nao | Nao |
| `ServicosAvulsos_Maas` | Publico | Nao | Nao | Nao |

`Admin_Maas` nao tem nenhuma policy publica — toda validacao passa pelas Edge Functions acima com Service Role Key.

---

## Como Rodar Localmente

**1. Instalar dependencias:**
```bash
npm install
```

**2. Criar o arquivo `.env`** na raiz do projeto (copie o `.env.example`):
```
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_KEY=sua-chave-publica
```

**3. Iniciar o servidor de desenvolvimento:**
```bash
npm run dev
```
Acesse `http://localhost:5173`

**4. Gerar build de producao:**
```bash
npm run build
```

---

## Deploy

### Vercel (frontend)
O deploy e automatico a cada `git push` na branch `main`.

Variaveis de ambiente necessarias no painel do Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_KEY`

### Supabase Edge Functions
Para publicar ou atualizar uma Edge Function (repita para cada uma: `excluir-apontamento`, `editar-apontamento`, `validar-admin`, `gerenciar-funcionario`):
```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy excluir-apontamento
```

---

## Funcionalidades

- **Apontamento operacional** — colaborador digita matricula e O.S., registra Inicio, Pausa, Intervalo, Pecas, Termino e Fim de Expediente
- **Servico Avulso** — chips clicaveis para apontar servicos sem O.S. especifica (ex: SEINFRA)
- **Autocorrecao no operacional** — ao digitar a matricula, o sistema detecta apontamentos com inconsistencia (ver regras em `js/erros.js`) e permite corrigir na hora (excluir registro ou confirmar termino), com senha de admin
- **Exclusao/edicao de apontamento** — requer autenticacao com matricula + senha, validada no servidor via Edge Function (disponivel no operacional e no historico do dashboard)
- **Cadastro de funcionarios** (`funcionarios.html`) — protegido por login de admin, permite criar/editar colaboradores
- **Dashboard** — KPIs de O.S. em andamento, pausadas, finalizadas **e com erro**, com calculo de tempo e custo de mao de obra; soft-delete (`excluido_dashboard`) permite ocultar registros problematicos sem apagar do banco
- **Consulta de O.S.** — busca todos os apontamentos de uma O.S. com tempo trabalhado por colaborador
- **Exportacao Excel** — relatorio resumido (`exportarExcelDashboard`) e detalhado linha-a-linha com aba de inconsistencias (`exportarExcelDetalhado`)
