# Guia do Código — Maas Controle de Mão de Obra

Este documento explica como cada parte do sistema funciona, como os arquivos se relacionam e como os dados fluem. O objetivo é que você consiga fazer melhorias e correções com autonomia.

---

## Como o Sistema se Conecta

```
Navegador
   │
   ├── index.html         ──► js/operacional.js
   ├── dashboard.html      ──► js/dashboard.js
   ├── consulta-os.html    ──► js/consulta-os.js
   └── funcionarios.html   ──► js/funcionarios.js
                               │         │
                               │  (operacional e dashboard também importam)
                               │         │
                               │   js/erros.js  (regras de inconsistência, sem Supabase)
                               │
                        (todos importam)
                               │
                        js/supabaseClient.js
                               │
                          Supabase (banco + Edge Functions)
```

Cada página HTML tem um arquivo JS correspondente. Todos se conectam ao Supabase através do `supabaseClient.js`, que é o único arquivo que conhece as credenciais. `js/erros.js` é um módulo à parte, sem dependência do Supabase: só recebe listas de registros e devolve inconsistências — por isso pode ser importado tanto pelo `operacional.js` (autocorreção) quanto pelo `dashboard.js` (auditoria/KPI de Erros).

---

## `js/supabaseClient.js` — A Conexão

```javascript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

const client = createClient(SUPABASE_URL, SUPABASE_KEY);

export { client };
```

**O que faz:** Cria uma única conexão com o banco e exporta o objeto `client`.

**`import.meta.env`** é como o Vite lê as variáveis do arquivo `.env`. Em produção (Vercel), ele lê as variáveis configuradas no painel. Qualquer variável que o Vite injeta precisa começar com `VITE_`.

**Como usar em qualquer outro arquivo JS:**
```javascript
import { client } from './supabaseClient.js';
```

---

## `js/operacional.js` — Tela de Apontamento

Este é o arquivo mais complexo. Ele controla toda a lógica da tela principal (`index.html`).

### Variáveis globais

```javascript
let statusPendente = null;       // guarda qual ação está aguardando confirmação no modal
let apontamentosAnteriores = []; // guarda colaboradores em aberto na mesma O.S.
let avulsoAtivoId = null;        // guarda o id do serviço avulso selecionado
let idParaExcluir = null;        // guarda o id do apontamento que será excluído
```

---

### Os 3 Modos de Tela

A tela tem 3 estados visuais controlados por funções:

**`ativarModoLivre()`** — Estado inicial. Campos editáveis, botão "Iniciar O.S." visível.

**`ativarModoTrabalhando(dados)`** — Colaborador está em uma O.S. Campos bloqueados (readOnly), mostra botões de pausa/término.

**`ativarModoPausado(dados)`** — Colaborador está pausado. Mostra botão de retorno.

Esses modos são ativados automaticamente quando o colaborador digita a matrícula, com base no **último registro** dele no banco.

---

### O Cérebro: evento `blur` da Matrícula

```javascript
txtMatricula.addEventListener('blur', async function() { ... });
```

**`blur`** dispara quando o usuário sai do campo matrícula (clica em outro lugar ou aperta Tab).

**O que acontece na sequência:**
1. Busca o colaborador na tabela `Funcionarios_Maas`
2. Se não encontrar → mostra erro e marca `matriculaValida = false`
3. Se encontrar → marca `matriculaValida = true` e busca o último registro dele em `SistemaOS_Maas`
4. Analisa o `status_cod` do último registro:
   - `1` ou `4` → `ativarModoTrabalhando()`
   - `3` → `ativarModoPausado()`
   - Outros (`2`, `5`, `6`, `7`) → `ativarModoLivre()` com aviso

### Validação de matrícula (`matriculaValida`)

O campo `txtMatricula` é `<input type="text" inputmode="numeric">` com `oninput` filtrando só dígitos (igual ao campo O.S.) — antes aceitava qualquer coisa (`type="number"` permite `-`, `.`, `e`), o que já gerou registros com matrícula tipo `"-0.604909"` no banco.

Além disso, `definirAcao()` bloqueia **qualquer** ação (Iniciar, Pausa, Intervalo, Peças, Retorno, Término, Fim de Expediente) se `matriculaValida` não for `true`:

```javascript
if (!matriculaValida) {
    alert("Matrícula não encontrada. Verifique o número digitado antes de continuar.");
    return;
}
```

`matriculaValida` só vira `true` dentro do `blur` da matrícula, quando o colaborador é encontrado em `Funcionarios_Maas`. Ela volta pra `false` sempre que o campo é editado (`input` listener) ou em `limparTela()` — assim, se o colaborador muda a matrícula depois de validada, precisa sair do campo de novo (novo `blur`) antes de conseguir apontar. Antes dessa trava, dava pra ver o aviso "❌ Colaborador Não encontrado" e mesmo assim clicar em Iniciar — o apontamento era salvo com a matrícula errada, e como nenhum colaborador real acompanha aquele número, o registro nunca era fechado (aparecia como "Em andamento" há dias no KPI de Erros do dashboard).

### Bloqueio de tela por matrícula não encontrada

Não basta impedir o clique em `definirAcao()` — se a matrícula não existe, a tela inteira trava e o foco volta pro campo de matrícula, pra deixar claro que não dá pra seguir em frente:

- **`bloquearPorMatriculaInvalida()`** — chamada no ramo `!func` do `blur`. Desabilita o campo O.S. (`txtOS.disabled = true`), todos os chips de Serviço Avulso (`[id^="avulso-"]`) e o botão `#btnIniciarAcao`; em seguida devolve o foco pro campo de matrícula (`focus()` + `select()`, pra já deixar o número errado selecionado e fácil de substituir).
- **`desbloquearCamposLivres()`** — o oposto; chamada assim que uma matrícula válida é encontrada, e também dentro de `ativarModoLivre()` (que roda sempre que a tela volta pro estado "pronta pra nova matrícula", inclusive no "Limpar Tela").
- Os botões de Pausa/Intervalo/Peças/Retorno/Fim de Expediente/Término não precisam desse bloqueio adicional: eles só ficam visíveis dentro de `ativarModoTrabalhando`/`ativarModoPausado`, que só são chamados depois que a matrícula já foi validada.
5. Chama `carregarLista()` para mostrar o histórico recente

---

### Salvando um Apontamento: `definirAcao(codigoStatus)`

Chamada pelos botões da tela (ex: `onclick="definirAcao(1)"`).

**Fluxo:**
```
definirAcao(codigo)
    │
    ├── Se código 1 (Início): verifica se tem outros colaboradores em aberto na O.S.
    │       └── Se tiver → abre modal de continuação
    │       └── Se não tiver → vai direto para executarSalvamento(1)
    │
    ├── Se código 5 (Término) ou 7 (Fim Expediente):
    │       └── Abre modal de confirmação
    │       └── Usuário confirma → confirmarEnvio() → executarSalvamento()
    │
    └── Outros códigos (2, 3, 4, 6): salva direto em executarSalvamento()
```

---

### `executarSalvamento(codigoStatus)`

Função que de fato grava o registro no Supabase.

**Para status 5 (Término) e 7 (Fim Expediente):**
Antes de salvar, chama `calcularHorasTrabalhadas()` que percorre todo o histórico daquela O.S. somando os períodos trabalhados e salva o resultado no campo `horas_trabalhadas`.

**Dados salvos na tabela `SistemaOS_Maas`:**
```javascript
{
    matricula,          // ex: "142"
    os,                 // ex: "004521" ou "SEINFRA"
    status_cod,         // ex: 1
    obs: "Web",
    created_at,         // data e hora atual
    horas_trabalhadas   // só preenchido no término (ex: "02:30")
}
```

---

### Cálculo de Horas: `calcularHorasTrabalhadas(matricula, os)`

Percorre todos os registros de um colaborador em uma O.S. em ordem cronológica.

**Lógica:**
- Status `1` (Início) ou `4` (Retorno) → marca o início de um período
- Status `2`, `3`, `6` (pausas) → fecha o período, soma a diferença
- Se terminou sem fechar (ainda trabalhando) → usa o horário atual

```
Início 08:00 → Peças 10:30 = 2h30 trabalhadas
Retorno 11:00 → Término 12:00 = 1h trabalhada
Total = 3h30
```

---

### Serviço Avulso

**`carregarServicosAvulsos()`** — Executada ao carregar a página. Busca os serviços com `ativo = true` na tabela `ServicosAvulsos_Maas` e renderiza como chips clicáveis.

**`selecionarAvulso(id, nome)`** — Ao clicar num chip:
1. Aumenta o `maxLength` do campo O.S. para 50
2. Preenche o campo O.S. com o **nome** do serviço (ex: "SEINFRA")
3. Bloqueia o campo O.S. (readOnly)
4. Destaca o chip selecionado em azul

**`limparSelecaoAvulso()`** — Desfaz tudo acima. Chamada quando o usuário digita manualmente no campo O.S. ou clica em "Limpar Tela".

### Texto dinâmico dos botões Início/Término

Os botões de Início (`#txtBtnIniciar`) e Término (`#txtBtnTermino`) trocam de texto conforme o tipo de apontamento, para deixar claro que não é uma O.S. real:

- **`atualizarTextoBotaoIniciar()`** — olha o valor atual de `txtOS` e decide "Iniciar Serviço Avulso" (se não for só dígitos, via `ehOSNumerica`) ou "Iniciar Ordem de Serviço". Chamada em `selecionarAvulso`, `limparSelecaoAvulso` (cobre digitação manual e `limparTela`) e ao final do fluxo de `blur` da matrícula (cobre os casos em que o sistema pré-preenche `txtOS` sozinho, ex: retomando Peças/Pausa ou Fim de Expediente).
- **`atualizarTextoBotaoTermino(os)`** — chamada dentro de `ativarModoTrabalhando(dados)`, decide "Terminar Serviço Avulso" ou "Término da Ordem de Serviço" com base no `os` do registro em andamento.
- O texto de confirmação do modal (`definirAcao(5)`) segue a mesma regra: "Confirma o Término do Serviço Avulso?" quando aplicável.

**Por pedido do usuário, os botões de parada/retorno (Pausa, Intervalo, Aguardando Peças, Fim de Expediente, Retomar) não mudam de texto** — só Início e Término diferenciam O.S. real de Serviço Avulso.

---

### Exclusão de Apontamento

**`abrirModalExclusao(id, os, hora, status)`** — Chamada pelo botão de lixeira em cada linha do histórico. Guarda o `id` do registro em `idParaExcluir` e preenche o modal com os dados da linha.

O evento do botão é capturado via **event delegation** no elemento pai `listaApontamentos` — não existe `onclick` embutido na string do HTML. Os dados (`id`, `os`, `hora`, `texto`) ficam em atributos `data-*` do botão.

**`confirmarExclusao()`** — Ao clicar em "Excluir" no modal:
1. Lê matrícula e senha digitados
2. **Chama a Edge Function `excluir-apontamento` no servidor** — não acessa o banco direto
3. A Edge Function valida a matrícula e senha usando a `SUPABASE_SERVICE_ROLE_KEY` (que só existe no servidor)
4. Se inválido, retorna `401` com mensagem de erro
5. Se válido, a Edge Function executa o `DELETE` e retorna `200`
6. O browser fecha o modal e recarrega a lista

**Por que Edge Function?** Se a validação fosse feita no browser (JS do cliente), qualquer pessoa com o DevTools aberto poderia inspecionar o código, ver a lógica de comparação de senha e contorná-la. Na Edge Function, o código roda no servidor do Supabase e o browser nunca vê a senha do admin nem a Service Role Key.

```
Browser:
  matricula + senha + id  →  POST /functions/v1/excluir-apontamento
                                        │
                               Supabase Edge Function (servidor):
                                 - consulta Admin_Maas (com service role)
                                 - compara senha
                                 - executa DELETE se válido
                                        │
                                   ← { success: true } ou { error: "..." }
```

---

## `js/erros.js` — Detecção de Inconsistências (compartilhado)

Módulo puro (não importa `supabaseClient.js`): recebe o histórico de registros de uma O.S./matrícula já ordenado por data e devolve uma lista de inconsistências. É a mesma regra usada em dois lugares diferentes:

- **`js/dashboard.js`** — para o KPI "Erros" e o alerta ⚠️ no histórico (auditoria pelo gestor).
- **`js/operacional.js`** — para o card de autocorreção que aparece pro próprio colaborador quando ele digita a matrícula (`verificarErrosMatricula`).

### `detectarInconsistencias(historicoOrdenado)`

Repete a mesma máquina de estados de `calcularHorasTrabalhadas` (entrada aberta/fechada), mas em vez de somar tempo, sinaliza transições inválidas:

| Situação detectada | Motivo gerado |
|---|---|
| Início/Retorno (`1`/`4`) apontado com um período já aberto | "Início/Retorno apontado em duplicidade, sem pausa/término do período anterior" |
| Peças/Intervalo/Término/Pausa/Fim (`2,3,5,6,7`) sem Início/Retorno antes | "\<status\> apontado sem Início/Retorno anterior" |
| Qualquer apontamento novo depois de um Término (`5`) numa **O.S. numérica** | "Apontamento registrado após o Término da O.S." |
| Período aberto há mais de `LIMITE_HORAS_ABERTO` (12h) sem pausa | "Ficou X.Xh em andamento sem pausa (limite 12h)" |
| Ainda em aberto até agora, já passando de 12h | "Em andamento há X.Xh sem pausa/finalização" |

**Duas exceções importantes na regra:**
- **Serviço Avulso** (`ehOSNumerica` retorna `false` para nomes como `"SEINFRA"`) pode ter várias rodadas Início→Término no mesmo dia — não é tratado como "apontamento após o término".
- **`obs === 'Encerrado por continuidade'`** — registro inserido automaticamente pelo sistema quando outro colaborador assume a mesma O.S./avulso (ver `confirmarContinuacao` em `operacional.js`). Não é uma ação do colaborador, então nunca vira "erro" nem conta como "ficou X horas aberto".

### Outras exportações
- `LIMITE_HORAS_ABERTO` — constante (12 horas), usada nas duas regras de "tempo aberto demais".
- `ehOSNumerica(os)` — `true` se o valor da O.S. for só dígitos (O.S. real) vs. nome de Serviço Avulso.
- `isoParaDatetimeLocalBRT(isoUTC)` / `datetimeLocalBRTParaISO(valor)` — conversão entre o formato ISO (UTC, como salvo no banco) e o formato do `<input type="datetime-local">`, sempre assumindo Brasília (UTC-3) fixo, usadas nos modais de edição/correção de apontamento.

---

## Autocorreção no Operacional (`verificarErrosMatricula`)

Disparada junto com o evento `blur` da matrícula (mesmo gatilho que decide o modo de tela). Busca todo o histórico daquela matrícula, roda `detectarInconsistencias` por O.S. e, se houver erro, mostra um card (`cardErroApontamento`) com a lista de problemas.

O colaborador (ou admin, dependendo do caso) pode abrir o **modal de correção** (`abrirModalCorrecao`), que pede matrícula + senha de admin e oferece, para cada erro:
- **Excluir este registro** (`corrigirExcluirErro`) — quando o erro tem um registro específico (`e.item` existe) → chama a Edge Function `excluir-apontamento`.
- **Confirmar término** (`corrigirEncerrarErro`) — quando o erro é "ainda em aberto" (sem `e.item`, só `dataAbertura`) → pede a data/hora real do término num `<input type="datetime-local">` e grava via Edge Function.

---

## `js/dashboard.js` — Painel de Gestão

### Fluxo de Dados

```
carregarDashboard()
    │
    ├── Busca todos os funcionários → monta mapaFuncionarios{}
    │       (chave: matrícula, valor: { nome, valor_hora })
    │
    ├── Busca apontamentos com filtros aplicados → dadosBrutos[]
    │
    ├── processarDados()
    │       └── Para cada par (OS + matrícula), guarda apenas o registro mais recente
    │       └── Monta mapaHistoricoOS{} com todos os registros por par
    │
    ├── calcularKPIs()
    │       └── Conta O.S. únicas e classifica: Andamento / Pausadas / Finalizadas
    │
    └── filtrarKPI('TODOS') → renderizarTabelaPrincipal()
```

A busca em `SistemaOS_Maas` sempre filtra `.eq('excluido_dashboard', false)` — registros com esse soft-delete marcado (ver seção "Soft-delete" abaixo) somam-se ao histórico do banco, mas nunca aparecem no dashboard.

### `calcularMetricasMO(matricula, os)`

Usa o `mapaHistoricoOS` para calcular tempo trabalhado e custo de um colaborador em uma O.S. específica. A soma dos períodos trabalhados vive em `horasDecimaisDeHistorico()` (extraída à parte porque é reaproveitada no resumo de time do modal — ver abaixo) e retorna o valor em **horas decimais** (ex: 2.5 = 2h30) para poder multiplicar pelo `valor_hora` do funcionário.

```javascript
custoTotal = ehOSNumerica(os) ? horasDecimais * valorHora : 0
```

**Serviço Avulso não gera custo** — só O.S. numérica (`ehOSNumerica`, de `js/erros.js`) tem `custoTotal` calculado; para avulso o valor é sempre `0` e a célula de custo na tabela/Excel fica em branco (não "R$ 0,00", pra não parecer erro de cálculo).

### KPI "Erros" (`processarErros`, `mapaErros`, `osComErro`)

Depois de montar `mapaHistoricoOS` (registros agrupados por `os-matricula`), `processarErros()` roda `detectarInconsistencias` (de `js/erros.js`) em cada grupo:

```javascript
function processarErros() {
    Object.keys(mapaHistoricoOS).forEach(chave => {
        const historico = [...mapaHistoricoOS[chave]].sort(/* por created_at */);
        const erros = detectarInconsistencias(historico);
        if (erros.length > 0) {
            mapaErros[chave] = erros;        // usado para o ⚠️ na linha da tabela
            osComErro.add(String(erros[0].os)); // usado para contar o card "Erros" e o filtro
        }
    });
}
```

- **`mapaErros`** (chave `os-matricula`) alimenta o ícone ⚠️ na tabela principal (title com os motivos) e o alerta detalhado dentro do modal de histórico (`verHistorico`, que roda `detectarInconsistencias` de novo, mas agrupado só por matrícula daquela O.S.).
- **`osComErro`** (Set de números de O.S.) é o que popula o KPI "Erros" (`kpiErros`, em `atualizarKPIs`) e o filtro `filtrarKPI('ERROS')` na tabela principal — uma O.S. entra nesse Set assim que **qualquer** colaborador nela tiver pelo menos um erro.
- **Alterar as regras do KPI de Erros = alterar `detectarInconsistencias` em `js/erros.js`** (é o único lugar onde a lógica vive; dashboard e operacional só consomem o resultado).

### Resumo por categoria (`resumoErrosKPI`, `contagemPorCategoria`, `osPorCategoria`)

Cada erro devolvido por `detectarInconsistencias` tem um campo `categoria` (slug estável, ex: `aberto_excedido`) além do `motivo` (texto livre com números variáveis) — ver `CATEGORIAS_ERRO` em `js/erros.js` pros 5 valores possíveis. O label de cada categoria é o próprio texto do `motivo` daquela regra, só sem a parte numérica (que muda a cada caso, tipo "23.0h") — assim a pílula do resumo usa a mesma linguagem que já aparece no ⚠️ da tabela e no alerta do modal de histórico, em vez de um nome inventado à parte.

`processarErros()` também monta:
- **`contagemPorCategoria`** — `{ categoria: quantidade de erros brutos }`, usado só pra calcular o `%` de cada pílula.
- **`osPorCategoria`** — `{ categoria: Set de O.S. }`, usado pra filtrar a tabela quando uma pílula está selecionada.

**`renderizarResumoErros()`** desenha uma pílula clicável por categoria presente (ex: "67 (77%) Ficou em andamento sem pausa (>12h)") dentro do card de filtros (`#resumoErrosKPI` em `dashboard.html`), e só fica visível quando o filtro "Erros" está ativo. Clicar numa pílula chama `filtrarKPI('ERROS', categoria)`, que:
- Restringe a tabela principal só às O.S. daquela categoria (via `osPorCategoria`), em vez de todas as O.S. com qualquer erro (`osComErro`).
- Clicar de novo na mesma pílula desmarca (volta a mostrar todos os erros) — é um toggle, não uma seleção fixa.
- Clicar no card "Com Erro" (o card principal, não uma pílula) sempre reseta pra "todas as categorias".

Isso é só uma lente de leitura/filtro sobre o mesmo resultado de `detectarInconsistencias` — não muda quais O.S. contam como erro nem o número total do KPI "Erros".

### Filtro O.S. x Serviço Avulso (`#dashTipoOS`)

Select no card de filtros com 3 opções: Todos / Só O.S. / Só Avulso. Igual aos cards de KPI e às pílulas de categoria de erro, é um filtro **client-side** sobre `dadosResumidos` já carregado — não recarrega do Supabase, então some/aparece na hora (`change` → `renderizarTabelaPrincipal()`), sem precisar clicar em "Filtrar".

Usa `ehOSNumerica(item.os)` (de `js/erros.js`) pra decidir o tipo, e some **por cima** do filtro de KPI ativo (Total/Andamento/Pausadas/Finalizadas/Erros) — os dois se combinam com E, não um substitui o outro. Ex: "Pausadas" + "Só Avulso" mostra só os Serviços Avulsos pausados.

### Editar/Excluir apontamento a partir do histórico

No modal de histórico (`verHistorico`), cada linha tem botões ✏️ (editar) e 🗑️ (excluir), capturados por event delegation em `tabelaHist`:

- **`abrirModalEditar(id)` → `salvarEdicaoApontamento()`** — pede matrícula+senha de admin e chama a Edge Function `editar-apontamento`, que permite mudar `status_cod`, `created_at` (via `datetimeLocalBRTParaISO`) e `obs` de um registro existente.
- **`abrirModalExcluirDash(id)` → `confirmarExclusaoDash()`** — mesma Edge Function `excluir-apontamento` usada no operacional.

Depois de qualquer uma das duas ações, o histórico do modal e o dashboard são recarregados.

### Resumo de time no Serviço Avulso (`resumoAvulsoModal`)

Como o `os` de um Serviço Avulso é compartilhado por todo mundo que apontou o mesmo serviço no mesmo dia (ex: `"SEINFRA - 03/08/2026"`), `verHistorico` já trazia o histórico de **todos** os colaboradores daquela instância (query por `os`, sem filtro de matrícula). Além de rodar `detectarInconsistencias` por matrícula, agora também calcula `horasDecimaisDeHistorico()` por matrícula e, se a O.S. não for numérica (`!ehOSNumerica(osAlvo)`) e houver **mais de um colaborador envolvido**, mostra uma faixa informativa (azul, para não confundir com o alerta de erro em vermelho) logo acima do histórico:

```
⏱️ Tempo total do time neste serviço: 05:30
João: 03:00 | Maria: 02:30
```

Isso não mexe na tabela principal do dashboard, que continua mostrando uma linha por colaborador (cada um com seu próprio tempo, sem custo) — o resumo é só um complemento dentro do modal, para responder "quanto tempo o time todo gastou nisso" sem precisar somar manualmente.

### Soft-delete (`excluido_dashboard`)

Coluna booleana em `SistemaOS_Maas` (migration `20260707112938_add_flag_exclusao_dashboard.sql`). Quando `true`, o registro some do dashboard (e da autocorreção do operacional) mas **continua no banco** — usado para casos como duplo-clique ou registro de teste, sem perder o histórico bruto para quem consulta direto no Supabase.

### Exportação Excel

Usa a biblioteca **SheetJS** (carregada via CDN no HTML). Duas variações:

- **`exportarExcelDashboard()`** — uma linha por par O.S./colaborador (`dadosResumidos`), chamando `calcularMetricasMO()` para garantir que os valores batem com os da tela.
- **`exportarExcelDetalhado()`** — uma linha por apontamento bruto (`dadosBrutos`), ordenado por O.S. → matrícula → data/hora, com coluna "Alerta" preenchida a partir de `mapaErros`. Gera uma segunda aba ("OS_Com_Erro") só com o resumo das inconsistências encontradas.

---

## `js/consulta-os.js` — Consulta de O.S.

Mais simples que os outros. O usuário digita um número de O.S. e o sistema:

1. Busca todos os registros daquela O.S. em `SistemaOS_Maas`
2. Agrupa por matrícula
3. Para cada colaborador mostra: abertura, fechamento e tempo trabalhado
4. Se qualquer colaborador tiver status diferente de 5 ou 7 → badge "Em Andamento"

### `calcularHoras(registros)`

Mesma lógica das outras telas, mas retorna no formato `"HH:MM"`.

---

## `js/funcionarios.js` — Cadastro de Funcionários

Tela protegida por login de admin (matrícula + senha de `Admin_Maas`, validado no servidor). Nada de sessão persistida: `adminLogado` fica só em memória (variável JS), nunca em `localStorage`/`sessionStorage` — a cada gravação a matrícula/senha são reenviadas, porque quem realmente valida é a Edge Function.

**Fluxo:**
1. **`entrarAdmin()`** — chama a Edge Function `validar-admin` com matrícula+senha. Se `ok`, guarda `{ matricula, senha, nome }` em `adminLogado`, esconde o `loginBox` e mostra `conteudoFuncionarios`.
2. **`carregarFuncionarios()`** — `SELECT` direto em `Funcionarios_Maas` (leitura é pública, RLS permite) e guarda em `listaFuncionarios`.
3. **`renderizarFuncionarios()`** — filtra por nome/matrícula (busca local, client-side) e monta a tabela.
4. **`abrirModalFuncionario(id)`** — `id` vazio = modal de "Novo Funcionário"; `id` preenchido = "Editar".
5. **`salvarFuncionario()`** — chama a Edge Function `gerenciar-funcionario` com `acao: 'criar'` ou `'atualizar'`, reenviando as credenciais de `adminLogado` a cada chamada (a Edge Function valida de novo, não confia em estado do cliente).

Toda escrita (criar/editar funcionário) passa pela Edge Function — a tabela `Funcionarios_Maas` não tem policy de INSERT/UPDATE pública.

---

## Padrões Usados no Código

### Como fazer uma consulta ao Supabase

```javascript
// SELECT * FROM tabela WHERE campo = valor
const { data, error } = await client
    .from('NomeDaTabela')
    .select('*')
    .eq('campo', valor)
    .order('created_at', { ascending: false });

if (error) { /* trata o erro */ }
// data é um array com os resultados
```

### Como inserir um registro

```javascript
const { error } = await client
    .from('NomeDaTabela')
    .insert([{ campo1: valor1, campo2: valor2 }]);
```

### Como deletar um registro

```javascript
const { error } = await client
    .from('NomeDaTabela')
    .delete()
    .eq('id', idDoRegistro);
```

### Por que as funções usam `window.nomeFuncao`

No Vite, os arquivos JS são módulos isolados. Funções declaradas normalmente (`function foo()`) não ficam acessíveis no HTML (ex: `onclick="foo()"`). Ao atribuir para `window.foo`, a função fica global e o HTML consegue chamá-la.

```javascript
// Isso NÃO funciona no onclick do HTML (é privado do módulo)
function limparTela() { ... }

// Isso FUNCIONA (fica acessível globalmente)
window.limparTela = function() { ... }
```

---

## Como Adicionar uma Nova Funcionalidade

**1. Nova tabela no Supabase:**
- Crie a tabela no SQL Editor
- Ative o RLS: `alter table "Tabela" enable row level security;`
- Adicione a política de leitura: `create policy "Leitura" on "Tabela" for select using (true);`

**2. Nova tela:**
- Crie o HTML na raiz do projeto
- Crie o JS correspondente em `js/`
- Adicione a entrada no `vite.config.js`:
```javascript
input: {
    main: 'index.html',
    novaTela: 'nova-tela.html', // adicione aqui
}
```

**3. Novo campo no Supabase:**
```sql
alter table "NomeDaTabela" add column nome_campo tipo;
```

**4. Testar localmente:**
```bash
npm run dev
```

**5. Publicar:**
```bash
git add .
git commit -m "Descrição da mudança"
git push
```
O Vercel faz o deploy automaticamente.

---

## Segurança Aplicada

Esta seção documenta todas as medidas de segurança que foram implementadas no sistema e o motivo de cada uma.

---

### 1. Credenciais fora do código-fonte (`VITE_` + `.env`)

**Onde:** `js/supabaseClient.js`, arquivo `.env`, painel do Vercel.

As chaves do Supabase ficam em variáveis de ambiente, nunca escritas diretamente no código:

```javascript
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
```

O arquivo `.env` está no `.gitignore` e nunca é enviado ao GitHub. No Vercel, as variáveis são configuradas no painel. Isso evita que as chaves fiquem expostas no histórico de commits.

**Nota:** A `SUPABASE_KEY` pública (anon key) ainda é visível no browser, pois precisa ser injetada pelo Vite no build. Isso é esperado e seguro — ela só permite o que as políticas de RLS autorizam.

---

### 2. Proteção contra XSS — função `esc()`

**Onde:** `js/operacional.js`, `js/dashboard.js`, `js/consulta-os.js` (início de cada arquivo).

```javascript
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

**Por que é necessário:** Se um dado do banco contiver `<script>alert('hack')</script>` e for inserido diretamente via `innerHTML`, esse script será executado no browser de qualquer pessoa que abrir a página. A função `esc()` converte os caracteres especiais em entidades HTML inofensivas.

**Regra:** Todo valor vindo do banco que entra no HTML via `innerHTML` ou template literal passa pelo `esc()` primeiro.

---

### 3. Event Delegation no lugar de `onclick` embutido

**Onde:** Botões de excluir em `js/operacional.js`, botões de histórico em `js/dashboard.js`.

**Antes (inseguro):**
```javascript
// O valor de item.os ia direto dentro da string do onclick
htmlLinhas += `<button onclick="verHistorico('${item.os}')">...`;
```

**Depois (seguro):**
```javascript
// O valor fica num atributo data-* (escapado pelo esc())
htmlLinhas += `<button class="btn-icon-hist" data-os="${esc(item.os)}">...`;

// Um único listener no pai captura todos os cliques
tabela.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn-icon-hist');
    if (!btn) return;
    verHistorico(btn.dataset.os); // lê o valor de forma segura
});
```

**Por que é mais seguro:** Na versão antiga, se `item.os` contivesse `'); deletarTudo(); //`, isso seria executado como JavaScript. Com `data-*`, o valor é sempre tratado como texto, nunca como código.

---

### 4. Edge Functions para toda escrita sensível

**Onde:** `supabase/functions/*/index.ts` (4 functions).

| Function | Usada em | O que faz |
|---|---|---|
| `excluir-apontamento` | Operacional (autocorreção) e Dashboard (histórico) | Valida matrícula+senha de admin e executa `DELETE` em `SistemaOS_Maas` |
| `editar-apontamento` | Dashboard (histórico) e Operacional (correção de "término" pendente) | Valida admin e executa `UPDATE` (`status_cod`, `created_at`, `obs`) em `SistemaOS_Maas` |
| `validar-admin` | `funcionarios.html` (login) | Só valida matrícula+senha e devolve o `nome` — não escreve nada |
| `gerenciar-funcionario` | `funcionarios.html` (criar/editar) | Valida admin e executa `INSERT`/`UPDATE` em `Funcionarios_Maas` |

O ponto central, comum às quatro: **nenhuma lógica de validação de senha existe no browser**. O browser apenas envia os dados e recebe sucesso ou erro.

A `SUPABASE_SERVICE_ROLE_KEY` (que tem permissão total no banco, bypassando RLS) existe **apenas** nas variáveis de ambiente do servidor do Supabase. Nunca no código do frontend.

---

### 5. RLS (Row Level Security) no Supabase

Cada tabela tem suas políticas configuradas para limitar o que a chave pública (anon key) pode fazer:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `Funcionarios_Maas` | ✅ Sim | ❌ Não (só via Edge Function) | ❌ Não (só via Edge Function) | ❌ Não |
| `SistemaOS_Maas` | ✅ Sim | ✅ Sim | ❌ Não (só via Edge Function) | ❌ Não (só via Edge Function) |
| `Admin_Maas` | ❌ Não | ❌ Não | ❌ Não | ❌ Não |
| `ServicosAvulsos_Maas` | ✅ Sim | ❌ Não | ❌ Não | ❌ Não |

`Admin_Maas` não tem **nenhuma** policy pública desde a migration `20260707114456_lock_admin_maas_rls.sql` — toda validação de admin passa por uma das Edge Functions acima, que usa a Service Role Key no servidor. Antes dessa migration, SELECT/INSERT eram públicos (ver limitação abaixo).

**Para consultar as políticas ativas no Supabase:**
```sql
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename;
```

---

### Limitação conhecida: senhas em texto plano

As senhas na tabela `Admin_Maas` estão armazenadas sem hash (texto puro). Isso significa que quem tiver acesso direto ao banco (ou à Service Role Key) consegue ler as senhas. Em um sistema maior, as senhas deveriam ser hasheadas com `bcrypt` ou similar antes de serem salvas. Para o escopo atual do sistema, isso foi aceito como limitação consciente.

**Pendência aberta:** antes da migration de 2026-07-07, `Admin_Maas` teve SELECT/INSERT públicos por um período — qualquer pessoa com a chave anônima do site conseguia ler as senhas em texto puro. As senhas das matrículas `20693` e `21176` foram confirmadas como potencialmente expostas nesse intervalo. Foi decisão consciente **não trocar** essas senhas até o momento; enquanto isso não for feito, considere-as potencialmente comprometidas.

---

## Dicas para Depurar Erros

- **Abra o console do navegador (F12 → Console)** — a maioria dos erros aparece lá
- **Erros do Supabase** ficam no objeto `error` retornado pelas queries — o código já loga com `console.error`
- **Se uma função não for encontrada** (ex: `definirAcao is not defined`) → verifique se ela está como `window.nomeFuncao`
- **Se o dado não aparecer** → verifique o RLS no Supabase (pode estar bloqueando a leitura)
- **Se a exclusão/edição/login/cadastro de funcionário retornar 401** → matrícula ou senha incorretos na tabela `Admin_Maas` (validado em `excluir-apontamento`, `editar-apontamento`, `validar-admin` ou `gerenciar-funcionario`, respectivamente)
- **Se a Edge Function retornar 500** → verifique os logs no painel do Supabase em Functions → Logs
- **Se um apontamento não aparece no dashboard mas existe no banco** → verifique a coluna `excluido_dashboard` em `SistemaOS_Maas` (soft-delete, ver seção do `dashboard.js`)
- **Se o KPI/alerta de "Erros" parecer errado** → a regra inteira vive em `detectarInconsistencias` (`js/erros.js`); dashboard e operacional só exibem o resultado
- **`npm run build` antes de commitar** — garante que não há erros que quebram o deploy
