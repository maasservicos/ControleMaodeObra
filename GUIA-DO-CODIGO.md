# Guia do Código — Maas Controle de Mão de Obra

Este documento explica como cada parte do sistema funciona, como os arquivos se relacionam e como os dados fluem. O objetivo é que você consiga fazer melhorias e correções com autonomia.

---

## Como o Sistema se Conecta

```
Navegador
   │
   ├── index.html  ──► js/operacional.js
   ├── dashboard.html ──► js/dashboard.js
   └── consulta-os.html ──► js/consulta-os.js
                               │
                        (todos importam)
                               │
                        js/supabaseClient.js
                               │
                          Supabase (banco)
```

Cada página HTML tem um arquivo JS correspondente. Todos se conectam ao Supabase através do `supabaseClient.js`, que é o único arquivo que conhece as credenciais.

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
2. Se não encontrar → mostra erro
3. Se encontrar → busca o último registro dele em `SistemaOS_Maas`
4. Analisa o `status_cod` do último registro:
   - `1` ou `4` → `ativarModoTrabalhando()`
   - `3` → `ativarModoPausado()`
   - Outros (`2`, `5`, `6`, `7`) → `ativarModoLivre()` com aviso
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

---

### Exclusão de Apontamento

**`abrirModalExclusao(id, os, hora, status)`** — Chamada pelo botão de lixeira em cada linha do histórico. Guarda o `id` do registro em `idParaExcluir` e preenche o modal com os dados da linha.

**`confirmarExclusao()`** — Ao clicar em "Excluir" no modal:
1. Lê matrícula e senha digitados
2. Busca a matrícula na tabela `Admin_Maas`
3. Compara a senha — se não bater, mostra erro e para
4. Se bater, executa `DELETE` no Supabase pelo `id`
5. Fecha o modal e recarrega a lista

**Segurança:** A tabela `Admin_Maas` tem RLS ativado com política de somente leitura. A tabela `SistemaOS_Maas` tem uma política de DELETE liberada — a validação de quem pode deletar é feita no código JS antes de chamar o banco.

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

### `calcularMetricasMO(matricula, os)`

Usa o `mapaHistoricoOS` para calcular tempo trabalhado e custo de um colaborador em uma O.S. específica. Mesma lógica do `calcularHorasTrabalhadas` do operacional, mas retorna o valor em **horas decimais** (ex: 2.5 = 2h30) para poder multiplicar pelo `valor_hora` do funcionário.

```javascript
custoTotal = horasDecimais * valorHora
```

### Exportação Excel

Usa a biblioteca **SheetJS** (carregada via CDN no HTML). Para cada linha da tabela, chama `calcularMetricasMO()` garantindo que os valores do Excel batem com os da tela.

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

## Dicas para Depurar Erros

- **Abra o console do navegador (F12 → Console)** — a maioria dos erros aparece lá
- **Erros do Supabase** ficam no objeto `error` retornado pelas queries — o código já loga com `console.error`
- **Se uma função não for encontrada** (ex: `definirAcao is not defined`) → verifique se ela está como `window.nomeFuncao`
- **Se o dado não aparecer** → verifique o RLS no Supabase (pode estar bloqueando a leitura)
- **`npm run build` antes de commitar** — garante que não há erros que quebram o deploy
