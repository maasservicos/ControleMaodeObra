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

### 4. Edge Function para exclusão autenticada

**Onde:** `supabase/functions/excluir-apontamento/index.ts`

Detalhado na seção "Exclusão de Apontamento" acima. O ponto central: **nenhuma lógica de validação de senha existe no browser**. O browser apenas envia os dados e recebe sucesso ou erro.

A `SUPABASE_SERVICE_ROLE_KEY` (que tem permissão total no banco, bypassando RLS) existe **apenas** nas variáveis de ambiente do servidor do Supabase. Nunca no código do frontend.

---

### 5. RLS (Row Level Security) no Supabase

Cada tabela tem suas políticas configuradas para limitar o que a chave pública (anon key) pode fazer:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `Funcionarios_Maas` | ✅ Sim | ❌ Não | ❌ Não | ❌ Não |
| `SistemaOS_Maas` | ✅ Sim | ✅ Sim | ❌ Não | ❌ Não (só via Edge Function) |
| `Admin_Maas` | ✅ Sim (apenas `nome`) | ❌ Não | ❌ Não | ❌ Não |
| `ServicosAvulsos_Maas` | ✅ Sim | ❌ Não | ❌ Não | ❌ Não |

A tabela `SistemaOS_Maas` **não tem política de DELETE para anon**. Isso significa que mesmo que alguém tente fazer um DELETE direto com a chave pública, o Supabase bloqueia. O único caminho de exclusão é via Edge Function, que usa a Service Role Key no servidor.

**Para consultar as políticas ativas no Supabase:**
```sql
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename;
```

---

### Limitação conhecida: senhas em texto plano

As senhas na tabela `Admin_Maas` estão armazenadas sem hash (texto puro). Isso significa que quem tiver acesso direto ao banco consegue ler as senhas. Em um sistema maior, as senhas deveriam ser hasheadas com `bcrypt` ou similar antes de serem salvas. Para o escopo atual do sistema, isso foi aceito como limitação consciente.

---

## Dicas para Depurar Erros

- **Abra o console do navegador (F12 → Console)** — a maioria dos erros aparece lá
- **Erros do Supabase** ficam no objeto `error` retornado pelas queries — o código já loga com `console.error`
- **Se uma função não for encontrada** (ex: `definirAcao is not defined`) → verifique se ela está como `window.nomeFuncao`
- **Se o dado não aparecer** → verifique o RLS no Supabase (pode estar bloqueando a leitura)
- **Se a exclusão retornar 401** → matrícula ou senha incorretos na tabela `Admin_Maas`
- **Se a Edge Function retornar 500** → verifique os logs no painel do Supabase em Functions → Logs
- **`npm run build` antes de commitar** — garante que não há erros que quebram o deploy
