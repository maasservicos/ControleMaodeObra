# Controle de Mão de Obra — MAAS Serviços

Visão geral rápida do sistema: para que serve, como está organizado e quais tecnologias usa. Não entra em detalhes de implementação nem expõe nenhuma credencial — para isso, ver `README.md` (estrutura técnica) e `GUIA-DO-CODIGO.md` (lógica interna), ambos nesta mesma pasta.

---

## ⚠️ Natureza do sistema: solução temporária

Este sistema foi desenvolvido **internamente pela MAAS Serviços** como solução **provisória**, para suprir uma necessidade operacional imediata de apontamento e controle de mão de obra em campo (Ordens de Serviço e serviços avulsos), diante da **ausência de uma ferramenta própria da SIAN** para atender essa demanda.

A expectativa é que essa funcionalidade seja, no futuro, absorvida pelo **Sistema de Manutenção Geral** corporativo, de forma padronizada para atender a MAAS SERVICOS junto às demais unidades do grupo. Até que isso aconteça, este sistema permanece em uso como ponte operacional.

---

## Para que serve

Controlar o tempo de trabalho dos colaboradores de manutenção em campo, por Ordem de Serviço (O.S.) ou por serviço avulso (sem O.S. vinculada, ex.: apoio a outro setor), permitindo à gestão:

- Saber quem está trabalhando, pausado ou já finalizou, em tempo real;
- Calcular horas trabalhadas e custo de mão de obra por O.S.;
- Consultar o andamento de uma O.S. específica (inclusive por quem não tem acesso ao painel interno);
- Identificar apontamentos feitos de forma inconsistente (ex.: esquecimento de retomar após uma pausa) e corrigi-los.

## Quem usa

| Tela | Público | Acesso |
|---|---|---|
| Apontamento (tipo totem/quiosque) | Colaborador de campo | Livre — só digita a matrícula |
| Painel de Gestão | Supervisão/gestão de manutenção | Interno |
| Consulta de O.S. | Qualquer interessado (ex.: outro setor acompanhando uma O.S.) | Pública, somente leitura |
| Cadastro de Colaboradores | Administradores do sistema | Protegido por login |

## Como funciona, em linhas gerais

1. O colaborador digita sua matrícula e o número da O.S. (ou escolhe um serviço avulso) na tela de apontamento.
2. O sistema registra o horário de cada evento: início, pausa, retomada, intervalo, aguardando peças, fim de expediente ou término.
3. A partir dessa sequência de eventos, o sistema calcula o tempo efetivamente trabalhado (descontando pausas) e, quando aplicável, o custo de mão de obra.
4. A gestão acompanha tudo isso pelo Painel de Gestão, com indicadores (KPIs) de O.S. em andamento, pausadas, finalizadas e com algum apontamento inconsistente.
5. Qualquer pessoa pode consultar o status de uma O.S. específica pela tela pública de consulta, sem precisar de login.

## Tecnologias utilizadas

| Camada | Tecnologia |
|---|---|
| Interface (frontend) | HTML, CSS e JavaScript puro (sem framework), organizado com [Vite](https://vitejs.dev/) |
| Banco de dados e backend | [Supabase](https://supabase.com/) (PostgreSQL gerenciado + funções de servidor) |
| Hospedagem | [Vercel](https://vercel.com/), com publicação automática a cada atualização |
| Exportação de relatórios | [SheetJS](https://sheetjs.com/), gera planilhas Excel diretamente no navegador |

Todas as credenciais de acesso ao banco de dados ficam fora do código-fonte, em variáveis de ambiente configuradas na plataforma de hospedagem — nenhuma chave, senha ou token está gravado nos arquivos do projeto.

## Estrutura do projeto (visão macro)

- **4 telas independentes**, cada uma com sua própria lógica: Apontamento, Painel de Gestão, Consulta de O.S. e Cadastro de Colaboradores.
- Um módulo central de conexão com o banco de dados, reutilizado por todas as telas.
- Um conjunto de **funções de servidor** (executadas no backend, não no navegador do usuário) para qualquer operação que exige validação de senha de administrador — garantindo que essa validação nunca aconteça do lado do cliente.

---

*Última atualização: agosto/2026. Dúvidas sobre a implementação técnica: procurar o responsável pelo desenvolvimento na MAAS Serviços.*
