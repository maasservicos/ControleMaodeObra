import { client } from './supabaseClient.js';
import { detectarInconsistencias, isoParaDatetimeLocalBRT, datetimeLocalBRTParaISO, ehOSNumerica, CATEGORIAS_ERRO } from './erros.js';

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- ELEMENTOS ---
const tabela = document.getElementById('tabelaDashboard');

// KPIs — dois conjuntos independentes (O.S. real x Serviço Avulso), nunca somados juntos.
const kpiEls = {
    OS: {
        total: document.getElementById('kpiTotalOS'),
        andamento: document.getElementById('kpiAndamentoOS'),
        pausadas: document.getElementById('kpiPausadasOS'),
        finalizadas: document.getElementById('kpiFinalizadasOS'),
        erros: document.getElementById('kpiErrosOS'),
    },
    AVULSO: {
        total: document.getElementById('kpiTotalAvulso'),
        andamento: document.getElementById('kpiAndamentoAvulso'),
        pausadas: document.getElementById('kpiPausadasAvulso'),
        finalizadas: document.getElementById('kpiFinalizadasAvulso'),
        erros: document.getElementById('kpiErrosAvulso'),
    },
};
const cardIds = {
    OS: { TODOS: 'cardTotalOS', ANDAMENTO: 'cardAndamentoOS', PAUSADAS: 'cardPausadasOS', FINALIZADAS: 'cardFinalizadasOS', ERROS: 'cardErrosOS' },
    AVULSO: { TODOS: 'cardTotalAvulso', ANDAMENTO: 'cardAndamentoAvulso', PAUSADAS: 'cardPausadasAvulso', FINALIZADAS: 'cardFinalizadasAvulso', ERROS: 'cardErrosAvulso' },
};

// Filtros
const dtInicio = document.getElementById('dashDtInicio');
const dtFim = document.getElementById('dashDtFim');
const inpMatricula = document.getElementById('dashMatricula');
const inpOS = document.getElementById('dashOS');
const selTipoOS = document.getElementById('dashTipoOS');

// Filtro rápido O.S. x Serviço Avulso — client-side, sobre os dados já carregados
// (não recarrega do Supabase, igual aos cards de KPI e às pílulas de categoria de erro).
// Também recalcula o resumo de categorias, já que ele reflete o Tipo selecionado no momento.
if (selTipoOS) {
    selTipoOS.addEventListener('change', function() {
        paginaAtual = 1;
        renderizarResumoErros();
        renderizarTabelaPrincipal();
    });
}

// Modal
const modalHist = document.getElementById('modalHistorico');
const lblOSModal = document.getElementById('lblOSModal');
const tabelaHist = document.getElementById('tabelaHistorico');
const alertaErrosModal = document.getElementById('alertaErrosModal');
const resumoAvulsoModal = document.getElementById('resumoAvulsoModal');

// Variáveis Globais
let dadosBrutos = [];

if (tabela) {
    tabela.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-icon-hist');
        if (!btn) return;
        verHistorico(btn.dataset.os);
    });
}
let dadosResumidos = [];
let mapaFuncionarios = {};
let mapaHistoricoOS = {};
let mapaErros = {};
let osComErro = new Set();
let filtroKPIAtual = 'TODOS';
// Lista bruta de todos os erros detectados (cada um com .categoria e .os) — o resumo
// por categoria é recalculado dela na hora, filtrado pelo Tipo (O.S./Avulso) atual.
let todosOsErros = [];
let osPorCategoria = {};
let filtroCategoriaErro = null;

// Paginação da tabela principal — evita renderizar milhares de linhas de uma vez.
const ITENS_POR_PAGINA = 25;
let paginaAtual = 1;

const resumoErrosKPI = document.getElementById('resumoErrosKPI');
if (resumoErrosKPI) {
    resumoErrosKPI.addEventListener('click', function(e) {
        const btn = e.target.closest('.resumo-erro-item');
        if (!btn) return;
        const categoria = btn.dataset.categoria;
        filtrarKPI('ERROS', filtroCategoriaErro === categoria ? null : categoria);
    });
}

// Edição/exclusão de apontamento a partir do modal de histórico
let osAtualModal = null;
let historicoAtualPorId = new Map();
let idParaExcluirDash = null;

if (tabelaHist) {
    tabelaHist.addEventListener('click', function(e) {
        const btnEditar = e.target.closest('.btn-editar-hist');
        if (btnEditar) { abrirModalEditar(btnEditar.dataset.id); return; }
        const btnExcluir = e.target.closest('.btn-excluir-hist');
        if (btnExcluir) { abrirModalExcluirDash(btnExcluir.dataset.id); return; }
    });
}

// --- INICIALIZAÇÃO ---
window.addEventListener('DOMContentLoaded', () => {
    limparFiltros();
});

window.limparFiltros = function() {
    if(dtInicio) dtInicio.value = "";
    if(dtFim) dtFim.value = "";
    if(inpMatricula) inpMatricula.value = "";
    if(inpOS) inpOS.value = "";
    if(selTipoOS) selTipoOS.value = "TODOS";
    carregarDashboard();
}

// --- TOGGLE ENTRE AS DUAS FILEIRAS DE KPI (O.S. x Serviço Avulso) ---
// Só uma fileira fica visível por vez. Reaproveita filtrarKPI() pra também ajustar
// o filtro Tipo, re-destacar o card certo e recalcular o resumo de erros.
window.mostrarKpiTipo = function(tipo) {
    const secOS = document.getElementById('kpiSectionOS');
    const secAvulso = document.getElementById('kpiSectionAvulso');
    if (secOS) secOS.classList.toggle('hidden', tipo !== 'OS');
    if (secAvulso) secAvulso.classList.toggle('hidden', tipo !== 'AVULSO');

    document.querySelectorAll('.kpi-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tipo === tipo);
    });

    filtrarKPI(filtroKPIAtual, filtroCategoriaErro, tipo);
}

// --- FILTRO DE KPI (VISUAL COM CSS PURO) ---
// `categoria` só faz sentido junto com tipo 'ERROS' — vem do clique num item do
// resumo (ex: "Ainda aberto"), pra restringir a tabela só àquele tipo de erro.
// `tipoOS` ('OS' ou 'AVULSO') vem do clique num card de uma das duas fileiras de KPI —
// ele também ajusta o filtro "Tipo" pra combinar com a fileira clicada. Quando omitido
// (ex: clique numa pílula de categoria), o Tipo atual não é mexido.
window.filtrarKPI = function(tipo, categoria, tipoOS) {
    filtroKPIAtual = tipo;
    filtroCategoriaErro = tipo === 'ERROS' ? (categoria || null) : null;
    if (tipoOS && selTipoOS) selTipoOS.value = tipoOS;
    paginaAtual = 1;

    resetarEstilosCards();

    // Só destaca um card se o Tipo atual for especificamente O.S. ou Avulso — não existe
    // mais um card "combinado", então com Tipo="Todos" nenhum card fica marcado como ativo.
    const tipoAtivo = selTipoOS ? selTipoOS.value : 'TODOS';
    if (cardIds[tipoAtivo]) {
        const cardId = cardIds[tipoAtivo][tipo];
        const el = cardId ? document.getElementById(cardId) : null;
        if (el) el.classList.add('active');
    }

    // O resumo por categoria só faz sentido (e só aparece) quando o filtro "Erros" está ativo.
    if (resumoErrosKPI) resumoErrosKPI.classList.toggle('hidden', tipo !== 'ERROS');

    renderizarResumoErros();
    renderizarTabelaPrincipal();
}

function resetarEstilosCards() {
    Object.values(cardIds.OS).concat(Object.values(cardIds.AVULSO)).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
}

function atualizarEstiloResumoErros() {
    if (!resumoErrosKPI) return;
    resumoErrosKPI.querySelectorAll('.resumo-erro-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.categoria === filtroCategoriaErro);
    });
}

// O Supabase/PostgREST limita cada resposta a 1000 linhas por padrão. Sem paginação,
// carregarDashboard() só via os 1000 registros mais recentes e silenciosamente cortava
// o resto — o que gerava "erros fantasma" (ex: Término aparecendo sem o Início real,
// que tinha ficado de fora do corte) em qualquer intervalo com mais de 1000 apontamentos.
async function buscarTodosApontamentos({ inicio, fim, matricula, os }) {
    const pageSize = 1000;
    let from = 0;
    let todos = [];

    while (true) {
        // Desempate por `id` (chave única) além de `created_at`: dois registros podem ter
        // o mesmo timestamp (inserts muito próximos), e sem um critério de desempate a
        // ordem entre páginas não é garantida — o que poderia pular ou duplicar linhas.
        let query = client.from('SistemaOS_Maas')
            .select('*')
            .eq('excluido_dashboard', false)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + pageSize - 1);

        if (inicio) query = query.gte('created_at', inicio + ' 00:00:00');
        if (fim) query = query.lte('created_at', fim + ' 23:59:59');
        if (matricula) query = query.eq('matricula', matricula);
        if (os) query = query.ilike('os', `%${os}%`);

        const { data, error } = await query;
        if (error) throw error;

        todos = todos.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }

    return todos;
}

// --- CARREGAMENTO DE DADOS ---
window.carregarDashboard = async function() {
    if(tabela) tabela.innerHTML = '<tr><td colspan="7" class="text-center animate-pulse" style="padding:2rem; color:#6b7280;">📡 Calculando custos...</td></tr>';
    
    try {
        const inicio = dtInicio ? dtInicio.value : new Date().toISOString().split('T')[0];
        const fim = dtFim ? dtFim.value : new Date().toISOString().split('T')[0];
        const matricula = inpMatricula ? inpMatricula.value : "";
        const os = inpOS ? inpOS.value : "";

        // 1. Busca Funcionários
        const { data: funcs } = await client.from('Funcionarios_Maas').select('matricula, nome, valor_hora');
        mapaFuncionarios = {};
        if(funcs) {
            funcs.forEach(f => {
                mapaFuncionarios[f.matricula] = {
                    nome: f.nome,
                    valor: Number(f.valor_hora) || 0 
                };
            });
        }

        // 2. Busca Histórico
        // Exclui registros marcados como excluido_dashboard (duplo-clique, testes):
        // permanecem no banco, só não aparecem aqui.
        dadosBrutos = await buscarTodosApontamentos({ inicio, fim, matricula, os });

        // 3. Processa
        processarDados(); 
        calcularKPIs();   
        filtrarKPI('TODOS'); 

    } catch (erro) {
        console.error("ERRO:", erro);
        if(tabela) tabela.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2rem; color:#ef4444; font-weight:bold;">❌ Erro ao processar dados.</td></tr>';
    }
}

function processarDados() {
    const mapaUnico = new Map();
    mapaHistoricoOS = {};

    dadosBrutos.forEach(item => {
        const chaveIndex = `${item.os}-${item.matricula}`;

        if (!mapaHistoricoOS[chaveIndex]) {
            mapaHistoricoOS[chaveIndex] = [];
        }
        mapaHistoricoOS[chaveIndex].push(item);

        // Sempre mantém o registro com o created_at mais recente
        const atual = mapaUnico.get(chaveIndex);
        if (!atual || new Date(item.created_at) > new Date(atual.created_at)) {
            mapaUnico.set(chaveIndex, item);
        }
    });

    dadosResumidos = Array.from(mapaUnico.values());
    processarErros();
}

function processarErros() {
    mapaErros = {};
    const novoOsComErro = new Set();
    const novoOsPorCategoria = {};
    const novosTodosErros = [];

    Object.keys(mapaHistoricoOS).forEach(chave => {
        const historico = [...mapaHistoricoOS[chave]].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const erros = detectarInconsistencias(historico);
        if (erros.length > 0) {
            mapaErros[chave] = erros;
            const osStr = String(erros[0].os);
            novoOsComErro.add(osStr);

            erros.forEach(e => {
                novosTodosErros.push(e);
                if (!novoOsPorCategoria[e.categoria]) novoOsPorCategoria[e.categoria] = new Set();
                novoOsPorCategoria[e.categoria].add(osStr);
            });
        }
    });

    osComErro = novoOsComErro;
    osPorCategoria = novoOsPorCategoria;
    todosOsErros = novosTodosErros;
    renderizarResumoErros();
}

// Quebra clicável do KPI "Erros" por categoria (ex: "67 (77%) Fechado após ficar aberto").
// Clicar de novo na mesma categoria desmarca (volta a mostrar todos os erros). Os números
// refletem só o Tipo atual (O.S./Avulso/Todos) — já que agora os KPIs de O.S. e Avulso são
// contados separadamente, o resumo de erros segue a mesma separação.
function renderizarResumoErros() {
    if (!resumoErrosKPI) return;

    const tipoAtivo = selTipoOS ? selTipoOS.value : 'TODOS';
    const errosFiltrados = todosOsErros.filter(e => {
        if (tipoAtivo === 'OS') return ehOSNumerica(e.os);
        if (tipoAtivo === 'AVULSO') return !ehOSNumerica(e.os);
        return true;
    });

    if (errosFiltrados.length === 0) {
        resumoErrosKPI.innerHTML = '';
        atualizarEstiloResumoErros();
        return;
    }

    const contagem = {};
    errosFiltrados.forEach(e => { contagem[e.categoria] = (contagem[e.categoria] || 0) + 1; });

    resumoErrosKPI.innerHTML = Object.entries(CATEGORIAS_ERRO)
        .filter(([categoria]) => contagem[categoria] > 0)
        .map(([categoria, label]) => {
            const n = contagem[categoria];
            const pct = Math.round((n / errosFiltrados.length) * 100);
            return `<button type="button" class="resumo-erro-item" data-categoria="${categoria}">${n} (${pct}%) ${esc(label)}</button>`;
        })
        .join('');

    atualizarEstiloResumoErros();
}


// Percorre um histórico já ordenado cronologicamente e soma os períodos trabalhados
// (Início/Retorno até a próxima pausa/término). Usada tanto para O.S. reais quanto
// para Serviço Avulso — o tempo é sempre calculado, só o custo (abaixo) não se aplica ao avulso.
function horasDecimaisDeHistorico(historicoOrdenado) {
    let tempoTrabalhadoMs = 0;
    let entrada = null;

    historicoOrdenado.forEach(registro => {
        const st = Number(registro.status_cod);
        const dataReg = new Date(registro.created_at);

        if (st === 1 || st === 4) {
            entrada = dataReg;
        }
        else if ((st === 2 || st === 3 || st === 5 || st === 6 || st === 7) && entrada) {
            tempoTrabalhadoMs += (dataReg - entrada);
            entrada = null;
        }
    });

    if (entrada) {
        tempoTrabalhadoMs += (new Date() - entrada);
    }

    return tempoTrabalhadoMs / (1000 * 60 * 60);
}

function calcularMetricasMO(matricula, os) {

    const chaveIndex = `${os}-${matricula}`;
    let historico = mapaHistoricoOS[chaveIndex] || [];

    historico.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const horasDecimais = horasDecimaisDeHistorico(historico);
    const valorHora = mapaFuncionarios[matricula]?.valor || 0;

    // Serviço Avulso não representa uma O.S. real com orçamento — só contabiliza tempo, nunca custo.
    const custoTotal = ehOSNumerica(os) ? horasDecimais * valorHora : 0;

    return {
        horasDecimais: horasDecimais,
        custoTotal: custoTotal
    };
}

// Calcula os 5 números (Total/Andamento/Pausadas/Finalizadas/Erros) só pra um dos dois
// tipos por vez — O.S. real e Serviço Avulso nunca são somados juntos em nenhum KPI.
function calcularKPIsPorTipo(pertenceAoTipo) {
    const osStatusMap = {};
    dadosResumidos.forEach(item => {
        if (!pertenceAoTipo(item.os)) return;
        if (!osStatusMap[item.os]) osStatusMap[item.os] = [];
        osStatusMap[item.os].push(Number(item.status_cod));
    });

    let andamento = 0, pausadas = 0, finalizadas = 0;
    const total = Object.keys(osStatusMap).length;

    for (const os in osStatusMap) {
        const statuses = osStatusMap[os];
        const alguemTrabalhando = statuses.some(s => s === 1 || s === 4);
        const alguemPausado = statuses.some(s => s === 2 || s === 3 || s === 6);
        const todosFinalizados = statuses.every(s => s === 5 || s === 7);

        if (alguemTrabalhando) andamento++;
        else if (alguemPausado) pausadas++;
        else if (todosFinalizados) finalizadas++;
    }

    const erros = [...osComErro].filter(pertenceAoTipo).length;
    return { total, andamento, pausadas, finalizadas, erros };
}

function calcularKPIs() {
    atualizarKPIs('OS', calcularKPIsPorTipo(ehOSNumerica));
    atualizarKPIs('AVULSO', calcularKPIsPorTipo(os => !ehOSNumerica(os)));
}

// Aplica o filtro de KPI + Tipo (O.S./Avulso) sobre dadosResumidos, sem paginar ainda.
function filtrarDadosResumidos() {
    return dadosResumidos.filter(item => {
        const st = Number(item.status_cod);

        let mostrar = false;
        if (filtroKPIAtual === 'TODOS') mostrar = true;
        else if (filtroKPIAtual === 'ANDAMENTO' && (st === 1 || st === 4)) mostrar = true;
        else if (filtroKPIAtual === 'PAUSADAS' && (st === 2 || st === 3 || st === 6)) mostrar = true;
        else if (filtroKPIAtual === 'FINALIZADAS' && (st === 5 || st === 7)) mostrar = true;
        else if (filtroKPIAtual === 'ERROS') {
            mostrar = filtroCategoriaErro
                ? (osPorCategoria[filtroCategoriaErro]?.has(String(item.os)) || false)
                : osComErro.has(String(item.os));
        }

        // Filtro O.S. x Serviço Avulso — some por cima do filtro de KPI acima, não substitui.
        if (mostrar && selTipoOS) {
            const tipoOS = selTipoOS.value;
            if (tipoOS === 'OS' && !ehOSNumerica(item.os)) mostrar = false;
            if (tipoOS === 'AVULSO' && ehOSNumerica(item.os)) mostrar = false;
        }

        return mostrar;
    });
}

window.mudarPagina = function(delta) {
    paginaAtual += delta;
    renderizarTabelaPrincipal();
}

function renderizarPaginacao(totalItens) {
    const info = document.getElementById('paginacaoInfo');
    const atualEl = document.getElementById('paginacaoAtual');
    const btnAnterior = document.getElementById('btnPaginaAnterior');
    const btnProxima = document.getElementById('btnPaginaProxima');
    if (!info || !atualEl || !btnAnterior || !btnProxima) return;

    const totalPaginas = Math.max(1, Math.ceil(totalItens / ITENS_POR_PAGINA));
    const inicio = totalItens === 0 ? 0 : (paginaAtual - 1) * ITENS_POR_PAGINA + 1;
    const fim = Math.min(paginaAtual * ITENS_POR_PAGINA, totalItens);

    info.textContent = `Mostrando ${inicio}–${fim} de ${totalItens}`;
    atualEl.textContent = `Página ${paginaAtual} de ${totalPaginas}`;
    btnAnterior.disabled = paginaAtual <= 1;
    btnProxima.disabled = paginaAtual >= totalPaginas;
}

function renderizarTabelaPrincipal() {
    if (!tabela) return;

    if (!dadosResumidos || dadosResumidos.length === 0) {
        tabela.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2rem; color:#9ca3af;">🔍 Nenhum registro encontrado.</td></tr>';
        renderizarPaginacao(0);
        return;
    }

    const itensFiltrados = filtrarDadosResumidos();

    if (itensFiltrados.length === 0) {
        tabela.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:2rem; color:#9ca3af;">Nenhum registro com status "${filtroKPIAtual}".</td></tr>`;
        renderizarPaginacao(0);
        return;
    }

    // Corrige a página atual se ela ficou fora do intervalo (ex: filtro reduziu o total).
    const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / ITENS_POR_PAGINA));
    if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
    if (paginaAtual < 1) paginaAtual = 1;

    const inicioIndice = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const itensPagina = itensFiltrados.slice(inicioIndice, inicioIndice + ITENS_POR_PAGINA);

    let htmlLinhas = '';

    itensPagina.forEach(item => {
        const st = Number(item.status_cod);
        const dataObj = new Date(item.created_at);
            const hora = dataObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            const dataFmt = dataObj.toLocaleDateString('pt-BR');

            const infoFunc = mapaFuncionarios[item.matricula] || { nome: "Desconhecido", valor: 0 };
            const nomeFunc = infoFunc.nome;

            const chaveIndex = `${item.os}-${item.matricula}`;
            const errosItem = mapaErros[chaveIndex];
            const alertaHtml = errosItem
                ? `<span class="icon-alerta" title="${esc(errosItem.map(e => e.motivo).join(' | '))}">⚠️</span>`
                : '';

            const metricas = calcularMetricasMO(item.matricula, item.os);
            // Serviço Avulso não tem custo — deixa a célula em branco em vez de "R$ 0,00" (que pareceria erro).
            const custoFormatado = ehOSNumerica(item.os)
                ? metricas.custoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : '';

            const horasInt = Math.floor(metricas.horasDecimais);
            const minutosInt = Math.floor((metricas.horasDecimais - horasInt) * 60);
            const segundosInt = Math.floor(((metricas.horasDecimais - horasInt) * 60 - minutosInt) * 60);
            const tempoFormatado = `${String(horasInt).padStart(2, '0')}:${String(minutosInt).padStart(2, '0')}:${String(segundosInt).padStart(2, '0')}`;

            let badgeClass = "badge badge-gray";
            let textoStatus = st;
            
            if(st === 1) { badgeClass = "badge badge-blue"; textoStatus = "Início da O.S."; }
            if(st === 2) { badgeClass = "badge badge-yellow"; textoStatus = "Pausa (Peças)"; }
            if(st === 3) { badgeClass = "badge badge-orange"; textoStatus = "Pausa (Intervalo)"; }
            if(st === 4) { badgeClass = "badge badge-blue"; textoStatus = "Retorno para O.S."; }
            if(st === 5) { badgeClass = "badge badge-green"; textoStatus = "Término da O.S."; }
            if(st === 6) { badgeClass = "badge badge-yellow"; textoStatus = "Pausa (Pausa)"; }
            if(st === 7) { badgeClass = "badge badge-red"; textoStatus = "Fim do Expediente"; }

            htmlLinhas += `
                <tr class="tr-hover group">
                    <td style="padding:1rem 1.5rem; font-family:monospace; font-size:0.75rem; color:#6b7280;">${esc(dataFmt)} ${esc(hora)}</td>
                    <td style="padding:1rem 1.5rem; font-weight:bold; color:#374151;">${esc(item.matricula)}</td>
                    <td style="padding:1rem 1.5rem; font-weight:500; color:#111827;">${esc(nomeFunc)}</td>
                    <td style="padding:1rem 1.5rem; font-family:monospace; color:#2563eb; font-weight:bold; display:flex; align-items:center; gap:0.5rem;">
                        ${alertaHtml}
                        ${esc(item.os)}
                        <button class="btn-icon-hist" data-os="${esc(item.os)}" title="Ver Histórico">📜</button>
                    </td>
                    <td style="padding:1rem 1.5rem; text-align:right; font-family:monospace; font-weight:bold; color:#d97706;">${esc(tempoFormatado)}</td>
                    <td style="padding:1rem 1.5rem; text-align:right; font-family:monospace; font-weight:bold; color:#059669;">${esc(custoFormatado)}</td>
                    <td style="padding:1rem 1.5rem; text-align:center;">
                        <span class="${esc(badgeClass)}">${esc(textoStatus)}</span>
                    </td>
                </tr>
            `;
    });

    tabela.innerHTML = htmlLinhas;
    renderizarPaginacao(itensFiltrados.length);
}

function atualizarKPIs(tipo, stats) {
    const els = kpiEls[tipo];
    if (!els) return;
    if (els.total) els.total.innerText = stats.total;
    if (els.andamento) els.andamento.innerText = stats.andamento;
    if (els.pausadas) els.pausadas.innerText = stats.pausadas;
    if (els.finalizadas) els.finalizadas.innerText = stats.finalizadas;
    if (els.erros) els.erros.innerText = stats.erros;
}

window.verHistorico = async function(osAlvo) {
    osAtualModal = osAlvo;
    if(lblOSModal) lblOSModal.innerText = osAlvo;
    if(tabelaHist) tabelaHist.innerHTML = '<tr><td colspan="4" style="padding:1rem; text-align:center; color:#9ca3af;">Carregando...</td></tr>';
    if(alertaErrosModal) { alertaErrosModal.innerHTML = ''; alertaErrosModal.classList.add('hidden'); }
    if(resumoAvulsoModal) { resumoAvulsoModal.innerHTML = ''; resumoAvulsoModal.classList.add('hidden'); }
    if(modalHist) modalHist.classList.add('open');

    const { data: historicoOS, error } = await client
        .from('SistemaOS_Maas')
        .select('*')
        .eq('os', osAlvo)
        .eq('excluido_dashboard', false)
        .order('created_at', { ascending: true });

    if(error || !historicoOS || historicoOS.length === 0) {
        if(tabelaHist) tabelaHist.innerHTML = '<tr><td colspan="4" style="padding:1rem; text-align:center; color:#9ca3af;">Nenhum registro encontrado.</td></tr>';
        return;
    }

    // Valida cada colaborador separadamente (a máquina de estados é por matrícula)
    const porMatricula = {};
    historicoOS.forEach(item => {
        if (!porMatricula[item.matricula]) porMatricula[item.matricula] = [];
        porMatricula[item.matricula].push(item);
    });

    const motivoPorItem = new Map();
    const motivosGerais = [];
    const horasPorMatricula = new Map();

    Object.keys(porMatricula).forEach(matricula => {
        const historicoOrdenado = [...porMatricula[matricula]].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const erros = detectarInconsistencias(historicoOrdenado);
        erros.forEach(erro => {
            const nomeColab = mapaFuncionarios[matricula]?.nome || matricula;
            motivosGerais.push(`${nomeColab}: ${erro.motivo}`);
            if (erro.item) motivoPorItem.set(erro.item, erro.motivo);
        });
        horasPorMatricula.set(matricula, horasDecimaisDeHistorico(historicoOrdenado));
    });

    if (alertaErrosModal) {
        if (motivosGerais.length > 0) {
            alertaErrosModal.innerHTML = `⚠️ <strong>${motivosGerais.length} possível(is) apontamento(s) com erro:</strong><ul>${motivosGerais.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`;
            alertaErrosModal.classList.remove('hidden');
        } else {
            alertaErrosModal.innerHTML = '';
            alertaErrosModal.classList.add('hidden');
        }
    }

    // Serviço Avulso não tem O.S. dedicada por pessoa — quando mais de um colaborador aponta
    // o mesmo serviço/dia, mostra o tempo total do time (soma), já que não há custo a somar aqui.
    if (resumoAvulsoModal) {
        const matriculasEnvolvidas = Object.keys(porMatricula);
        if (!ehOSNumerica(osAlvo) && matriculasEnvolvidas.length > 1) {
            const formatarHM = h => {
                const hInt = Math.floor(h);
                const mInt = Math.round((h - hInt) * 60);
                return `${String(hInt).padStart(2, '0')}:${String(mInt).padStart(2, '0')}`;
            };
            const totalHoras = matriculasEnvolvidas.reduce((soma, m) => soma + (horasPorMatricula.get(m) || 0), 0);
            const detalhe = matriculasEnvolvidas
                .map(m => `${esc(mapaFuncionarios[m]?.nome || m)}: ${formatarHM(horasPorMatricula.get(m) || 0)}`)
                .join(' &nbsp;|&nbsp; ');

            resumoAvulsoModal.innerHTML = `⏱️ <strong>Tempo total do time neste serviço: ${formatarHM(totalHoras)}</strong><br><span style="opacity:0.85;">${detalhe}</span>`;
            resumoAvulsoModal.classList.remove('hidden');
        } else {
            resumoAvulsoModal.innerHTML = '';
            resumoAvulsoModal.classList.add('hidden');
        }
    }

    let linhasHist = '';
    historicoAtualPorId = new Map();
    historicoOS.forEach(item => {
        historicoAtualPorId.set(String(item.id), item);
        const dataObj = new Date(item.created_at);
        const dh = `${dataObj.toLocaleDateString()} ${dataObj.toLocaleTimeString()}`;

        const info = mapaFuncionarios[item.matricula] || { nome: item.matricula };

        let txtStatus = item.status_cod;
        let cor = "color:#4b5563;";
        if(item.status_cod == 1) { txtStatus="Início da O.S."; cor="color:#1C1C1C; font-weight:bold;"; }
        if(item.status_cod == 2) { txtStatus="Pausa (Peças)"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 3) { txtStatus="Pausa (Intervalo)"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 4) { txtStatus="Retorno para O.S."; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 5) { txtStatus="Término da O.S."; cor="color:#008000; font-weight:bold;"; }
        if(item.status_cod == 6) { txtStatus="Pausa (Pausa)"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 7) { txtStatus="Fim do Expediente"; cor="color:#FF0000; font-weight:bold;"; }

        const motivoErro = motivoPorItem.get(item);
        const alertaLinha = motivoErro
            ? `<br><span style="color:#dc2626; font-size:0.65rem;">⚠️ ${esc(motivoErro)}</span>`
            : '';

        linhasHist += `
            <tr style="border-bottom:1px solid #f3f4f6; ${motivoErro ? 'background-color:#fef2f2;' : ''}">
                <td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.75rem; color:#6b7280;">${esc(dh)}</td>
                <td style="padding:0.75rem 1rem; font-weight:bold; color:#374151;">${esc(info.nome)}</td>
                <td style="padding:0.75rem 1rem; text-align:center; font-size:0.75rem; ${esc(cor)}">${esc(txtStatus)} (${esc(String(item.status_cod))})${alertaLinha}</td>
                <td style="padding:0.75rem 1rem; text-align:center; white-space:nowrap;">
                    <button class="btn-editar-hist" data-id="${esc(String(item.id))}" title="Editar"
                        style="background:none; border:none; cursor:pointer; padding:0.3rem; font-size:0.9rem;">✏️</button>
                    <button class="btn-excluir-hist" data-id="${esc(String(item.id))}" title="Excluir"
                        style="background:none; border:none; cursor:pointer; padding:0.3rem; font-size:0.9rem;">🗑️</button>
                </td>
            </tr>
        `;
    });
    if(tabelaHist) tabelaHist.innerHTML = linhasHist;
}

window.fecharHistorico = function() {
    if(modalHist) modalHist.classList.remove('open');
}

// --- EDITAR/EXCLUIR APONTAMENTO (a partir do histórico da O.S.) ---

window.abrirModalEditar = function(id) {
    const item = historicoAtualPorId.get(String(id));
    if (!item) return;

    document.getElementById('editar_id').value = item.id;
    document.getElementById('editar_status').value = String(item.status_cod);
    document.getElementById('editar_data').value = isoParaDatetimeLocalBRT(item.created_at);
    document.getElementById('editar_obs').value = item.obs || '';
    document.getElementById('editar_admin_matricula').value = '';
    document.getElementById('editar_admin_senha').value = '';
    document.getElementById('editar_erro').innerText = '';

    document.getElementById('modalEditarApontamento').classList.add('open');
}

window.fecharModalEditar = function() {
    document.getElementById('modalEditarApontamento').classList.remove('open');
}

window.salvarEdicaoApontamento = async function() {
    const erroEl = document.getElementById('editar_erro');
    const id = document.getElementById('editar_id').value;
    const status_cod = document.getElementById('editar_status').value;
    const dataValor = document.getElementById('editar_data').value;
    const obs = document.getElementById('editar_obs').value;
    const matricula = document.getElementById('editar_admin_matricula').value.trim();
    const senha = document.getElementById('editar_admin_senha').value.trim();

    if (!matricula || !senha) {
        erroEl.innerText = '⚠️ Preencha a matrícula e a senha do admin.';
        return;
    }
    if (!dataValor) {
        erroEl.innerText = '⚠️ Informe a data/hora.';
        return;
    }

    try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/editar-apontamento`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_KEY,
            },
            body: JSON.stringify({
                matricula, senha, id,
                status_cod,
                created_at: datetimeLocalBRTParaISO(dataValor),
                obs,
            }),
        });
        const result = await resp.json();

        if (!resp.ok) {
            erroEl.innerText = `⚠️ ${result.error || 'Erro ao salvar.'}`;
            return;
        }

        window.fecharModalEditar();
        if (osAtualModal) verHistorico(osAtualModal);
        carregarDashboard();
    } catch {
        erroEl.innerText = '❌ Erro de conexão. Tente novamente.';
    }
}

window.abrirModalExcluirDash = function(id) {
    idParaExcluirDash = id;
    document.getElementById('excluirDash_matricula').value = '';
    document.getElementById('excluirDash_senha').value = '';
    document.getElementById('excluirDash_erro').innerText = '';
    document.getElementById('modalExcluirApontamentoDash').classList.add('open');
}

window.fecharModalExcluirDash = function() {
    document.getElementById('modalExcluirApontamentoDash').classList.remove('open');
}

window.confirmarExclusaoDash = async function() {
    const erroEl = document.getElementById('excluirDash_erro');
    const matricula = document.getElementById('excluirDash_matricula').value.trim();
    const senha = document.getElementById('excluirDash_senha').value.trim();

    if (!matricula || !senha) {
        erroEl.innerText = '⚠️ Preencha a matrícula e a senha do admin.';
        return;
    }

    try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/excluir-apontamento`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_KEY,
            },
            body: JSON.stringify({ matricula, senha, id: idParaExcluirDash }),
        });
        const result = await resp.json();

        if (!resp.ok) {
            erroEl.innerText = `⚠️ ${result.error || 'Erro ao excluir.'}`;
            return;
        }

        window.fecharModalExcluirDash();
        if (osAtualModal) verHistorico(osAtualModal);
        carregarDashboard();
    } catch {
        erroEl.innerText = '❌ Erro de conexão. Tente novamente.';
    }
}

// --- EXCEL COM CUSTO ---
// --- FUNÇÃO DE EXPORTAÇÃO ATUALIZADA ---
window.exportarExcelDashboard = async function() {
    const btn = document.querySelector('button[onclick="exportarExcelDashboard()"]');
    const txtOriginal = btn.innerHTML;
    
    // Feedback visual (UX)
    btn.innerHTML = `⏳ Gerando...`;
    btn.disabled = true;

    try {
        if (!dadosResumidos || dadosResumidos.length === 0) {
            alert("Nada para exportar. Filtre os dados primeiro.");
            return;
        }

        const tradutorStatus = { 
            1:"INÍCIO", 2:"PEÇAS", 3:"INTERVALO", 
            4:"RETORNO", 5:"FINALIZADO", 6:"PAUSA", 7:"FIM EXPEDIENTE" 
        };
        
        // --- MAP: Transforma a lista de dados brutos em linhas do Excel ---
        const dadosFormatados = dadosResumidos.map(item => {
            
            // 1. Tratamento de Data Visual
            const dataObj = new Date(item.created_at);
            
            const info = mapaFuncionarios[item.matricula] || { nome: "N/D" };
            
            // 2. O CÉREBRO: Chamamos a mesma função da tabela!
            // Isso garante que o Excel bata 100% com a tela.
            const metricas = calcularMetricasMO(item.matricula, item.os);

            // 3. Formatação do Tempo para Excel (HH:MM)
            const horasInt = Math.floor(metricas.horasDecimais);
            const minutosInt = Math.floor((metricas.horasDecimais - horasInt) * 60);
            const segundosInt = Math.floor(((metricas.horasDecimais - horasInt) * 60 - minutosInt) * 60);
            const tempoExcel = `${String(horasInt).padStart(2, '0')}:${String(minutosInt).padStart(2, '0')}:${String(segundosInt).padStart(2, '0')}`;

            // 4. Montagem da Linha do Excel
            return {
                "Data": dataObj.toLocaleDateString(),
                "Hora": dataObj.toLocaleTimeString(),
                "Matrícula": item.matricula,
                "Colaborador": info.nome,
                "O.S.": item.os,
                "Status": tradutorStatus[item.status_cod] || item.status_cod,
                
                // Nossas colunas novas:
                "Tempo Trabalhado": tempoExcel,        // Coluna H
                // Serviço Avulso não tem custo — deixa em branco em vez de 0 (metricas.custoTotal já vem 0 do calcularMetricasMO)
                "Custo M.O. (R$)": ehOSNumerica(item.os) ? metricas.custoTotal : '' // Coluna I (número puro para permitir soma no Excel)
            };
        });
        
        // Criação do arquivo (Biblioteca SheetJS)
        const ws = XLSX.utils.json_to_sheet(dadosFormatados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Relatorio_Producao`);
        XLSX.writeFile(wb, `Relatorio_Maas_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);

    } catch (erro) {
        console.error("Erro no Excel:", erro);
        alert("Erro ao criar o Excel. Veja o console (F12).");
    } finally {
        // Restaura o botão
        btn.innerHTML = txtOriginal;
        btn.disabled = false;
    }
}

// --- EXCEL DETALHADO (TODOS OS APONTAMENTOS, LINHA A LINHA) ---
window.exportarExcelDetalhado = async function() {
    const btn = document.querySelector('button[onclick="exportarExcelDetalhado()"]');
    const txtOriginal = btn.innerHTML;

    btn.innerHTML = `⏳ Gerando...`;
    btn.disabled = true;

    try {
        if (!dadosBrutos || dadosBrutos.length === 0) {
            alert("Nada para exportar. Filtre os dados primeiro.");
            return;
        }

        const tradutorStatus = {
            1:"INÍCIO", 2:"PEÇAS", 3:"INTERVALO",
            4:"RETORNO", 5:"FINALIZADO", 6:"PAUSA", 7:"FIM EXPEDIENTE"
        };

        // Ordena por O.S. > Matrícula > Data/Hora, para ler a sequência completa de cada apontamento
        const ordenado = [...dadosBrutos].sort((a, b) => {
            const cmpOS = String(a.os).localeCompare(String(b.os), undefined, { numeric: true });
            if (cmpOS !== 0) return cmpOS;
            const cmpMat = String(a.matricula).localeCompare(String(b.matricula), undefined, { numeric: true });
            if (cmpMat !== 0) return cmpMat;
            return new Date(a.created_at) - new Date(b.created_at);
        });

        const dadosFormatados = ordenado.map(item => {
            const dataObj = new Date(item.created_at);
            const info = mapaFuncionarios[item.matricula] || { nome: "N/D" };
            const chaveIndex = `${item.os}-${item.matricula}`;
            const errosDoItem = mapaErros[chaveIndex];
            const motivoDoItem = errosDoItem?.find(e => e.item === item)?.motivo || '';

            return {
                "O.S.": item.os,
                "Matrícula": item.matricula,
                "Colaborador": info.nome,
                "Data": dataObj.toLocaleDateString(),
                "Hora": dataObj.toLocaleTimeString(),
                "Status": tradutorStatus[item.status_cod] || item.status_cod,
                "Alerta": motivoDoItem
            };
        });

        const ws = XLSX.utils.json_to_sheet(dadosFormatados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Apontamentos_Detalhado");

        // Segunda aba: resumo só das O.S./colaboradores com inconsistência
        const resumoErros = [];
        Object.values(mapaErros).forEach(erros => {
            erros.forEach(e => {
                const info = mapaFuncionarios[e.matricula] || { nome: "N/D" };
                resumoErros.push({
                    "O.S.": e.os,
                    "Matrícula": e.matricula,
                    "Colaborador": info.nome,
                    "Inconsistência": e.motivo
                });
            });
        });

        if (resumoErros.length > 0) {
            const ws2 = XLSX.utils.json_to_sheet(resumoErros);
            XLSX.utils.book_append_sheet(wb, ws2, "OS_Com_Erro");
        }

        XLSX.writeFile(wb, `Relatorio_Detalhado_Maas_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);

    } catch (erro) {
        console.error("Erro no Excel Detalhado:", erro);
        alert("Erro ao criar o Excel detalhado. Veja o console (F12).");
    } finally {
        btn.innerHTML = txtOriginal;
        btn.disabled = false;
    }
}