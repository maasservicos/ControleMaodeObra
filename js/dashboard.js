import { client } from './supabaseClient.js';

// --- ELEMENTOS ---
const tabela = document.getElementById('tabelaDashboard');
const kpiTotal = document.getElementById('kpiTotal');
const kpiAndamento = document.getElementById('kpiAndamento');
const kpiPausadas = document.getElementById('kpiPausadas');
const kpiFinalizadas = document.getElementById('kpiFinalizadas');

// Filtros
const dtInicio = document.getElementById('dashDtInicio');
const dtFim = document.getElementById('dashDtFim');
const inpMatricula = document.getElementById('dashMatricula');
const inpOS = document.getElementById('dashOS');

// Modal
const modalHist = document.getElementById('modalHistorico');
const lblOSModal = document.getElementById('lblOSModal');
const tabelaHist = document.getElementById('tabelaHistorico');

// Variáveis Globais
let dadosBrutos = [];
let dadosResumidos = [];
let mapaFuncionarios = {}; 
let mapaHistoricoOS = {};
let filtroKPIAtual = 'TODOS';

// --- INICIALIZAÇÃO ---
window.addEventListener('DOMContentLoaded', () => {
    limparFiltros();
});

window.limparFiltros = function() {
    const hoje = new Date().toISOString().split('T')[0];
    if(dtInicio) dtInicio.value = hoje;
    if(dtFim) dtFim.value = hoje;
    if(inpMatricula) inpMatricula.value = "";
    if(inpOS) inpOS.value = "";
    carregarDashboard();
}

// --- FILTRO DE KPI (VISUAL COM CSS PURO) ---
window.filtrarKPI = function(tipo) {
    filtroKPIAtual = tipo;
    resetarEstilosCards();
    
    const mapIds = { 'TODOS': 'cardTotal', 'ANDAMENTO': 'cardAndamento', 'PAUSADAS': 'cardPausadas', 'FINALIZADAS': 'cardFinalizadas' };
    const cardId = mapIds[tipo];
    
    const el = document.getElementById(cardId);
    if(el) {
        // Usa a classe .active definida no CSS novo (simula o ring do tailwind)
        el.classList.add('active');
    }
    
    renderizarTabelaPrincipal();
}

function resetarEstilosCards() {
    ['cardTotal', 'cardAndamento', 'cardPausadas', 'cardFinalizadas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
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
        let query = client.from('SistemaOS_Maas')
            .select('*')
            .gte('created_at', inicio + ' 00:00:00')
            .lte('created_at', fim + ' 23:59:59')
            .order('created_at', { ascending: false });

        if (matricula) query = query.eq('matricula', matricula);
        if (os) query = query.ilike('os', `%${os}%`);

        const { data, error } = await query; 
        if (error) throw error;

        dadosBrutos = data || [];

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

        if (!mapaUnico.has(chaveIndex)) {
            mapaUnico.set(chaveIndex, item); 
        }
    });
    
    dadosResumidos = Array.from(mapaUnico.values());
}


function calcularMetricasMO(matricula, os) {

    const chaveIndex = `${os}-${matricula}`;
    let historico = mapaHistoricoOS[chaveIndex] || [];

    historico.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let tempoTrabalhadoMs = 0;
    let entrada = null;

    historico.forEach(registro => {
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

    const horasDecimais = tempoTrabalhadoMs / (1000 * 60 * 60);
    const valorHora = mapaFuncionarios[matricula]?.valor || 0;

    return {
        horasDecimais: horasDecimais,
        custoTotal: horasDecimais * valorHora
    };
}

function calcularKPIs() {
    if (!dadosBrutos.length) {
        atualizarKPIs(0,0,0,0);
        return;
    }

    const osStatusMap = {}; 
    dadosResumidos.forEach(item => {
        if (!osStatusMap[item.os]) osStatusMap[item.os] = [];
        osStatusMap[item.os].push(Number(item.status_cod));
    });

    let countAndamento = 0;
    let countPausadas = 0;
    let countFinalizadas = 0;
    let totalOSUnicas = Object.keys(osStatusMap).length;

    for (const os in osStatusMap) {
        const statuses = osStatusMap[os];
        const alguemTrabalhando = statuses.some(s => s === 1 || s === 4);
        const alguemPausado = statuses.some(s => s === 2 || s === 3 || s === 6);
        const todosFinalizados = statuses.every(s => s === 5 || s === 7);

        if (alguemTrabalhando) countAndamento++;
        else if (alguemPausado) countPausadas++;
        else if (todosFinalizados) countFinalizadas++;
    }

    atualizarKPIs(totalOSUnicas, countAndamento, countPausadas, countFinalizadas);
}

// COPIE DAQUI 👇
function renderizarTabelaPrincipal() {
    // Essa linha aqui (o return) só funciona se estiver dentro das chaves { } da função
    if (!tabela) return;

    if (!dadosResumidos || dadosResumidos.length === 0) {
        tabela.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:2rem; color:#9ca3af;">🔍 Nenhum registro encontrado.</td></tr>';
        return;
    }

    let htmlLinhas = '';
    let temDado = false;

    dadosResumidos.forEach(item => {
        const st = Number(item.status_cod);
        
        let mostrar = false;
        if (filtroKPIAtual === 'TODOS') mostrar = true;
        else if (filtroKPIAtual === 'ANDAMENTO' && (st === 1 || st === 4)) mostrar = true;
        else if (filtroKPIAtual === 'PAUSADAS' && (st === 2 || st === 3 || st === 6)) mostrar = true;
        else if (filtroKPIAtual === 'FINALIZADAS' && (st === 5 || st === 7)) mostrar = true;

        if (mostrar) {
            temDado = true;
            
            const dataObj = new Date(item.created_at);
            dataObj.setHours(dataObj.getHours() - 3);
            const hora = dataObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            const dataFmt = dataObj.toLocaleDateString('pt-BR');
            
            const infoFunc = mapaFuncionarios[item.matricula] || { nome: "Desconhecido", valor: 0 };
            const nomeFunc = infoFunc.nome;

            const metricas = calcularMetricasMO(item.matricula, item.os);
            const custoFormatado = metricas.custoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            const horasInt = Math.floor(metricas.horasDecimais);
            const minutosInt = Math.floor((metricas.horasDecimais - horasInt) * 60);
            const tempoFormatado = `${String(horasInt).padStart(2, '0')}:${String(minutosInt).padStart(2, '0')}`;

            let badgeClass = "badge badge-gray";
            let textoStatus = st;
            
            if(st === 1) { badgeClass = "badge badge-blue"; textoStatus = "Início"; }
            if(st === 2) { badgeClass = "badge badge-yellow"; textoStatus = "Peças"; }
            if(st === 3) { badgeClass = "badge badge-orange"; textoStatus = "Intervalo"; }
            if(st === 4) { badgeClass = "badge badge-blue"; textoStatus = "Retorno"; }
            if(st === 5) { badgeClass = "badge badge-green"; textoStatus = "Finalizado"; }
            if(st === 6) { badgeClass = "badge badge-yellow"; textoStatus = "Pausa"; }
            if(st === 7) { badgeClass = "badge badge-red"; textoStatus = "Fim Exp."; }

            htmlLinhas += `
                <tr class="tr-hover group">
                    <td style="padding:1rem 1.5rem; font-family:monospace; font-size:0.75rem; color:#6b7280;">${dataFmt} ${hora}</td>
                    <td style="padding:1rem 1.5rem; font-weight:bold; color:#374151;">${item.matricula}</td>
                    <td style="padding:1rem 1.5rem; font-weight:500; color:#111827;">${nomeFunc}</td>
                    <td style="padding:1rem 1.5rem; font-family:monospace; color:#2563eb; font-weight:bold; display:flex; align-items:center; gap:0.5rem;">
                        ${item.os}
                        <button onclick="verHistorico('${item.os}')" class="btn-icon-hist" title="Ver Histórico">📜</button>
                    </td>
                    <td style="padding:1rem 1.5rem; text-align:right; font-family:monospace; font-weight:bold; color:#d97706;">${tempoFormatado}</td>
                    <td style="padding:1rem 1.5rem; text-align:right; font-family:monospace; font-weight:bold; color:#059669;">${custoFormatado}</td>
                    <td style="padding:1rem 1.5rem; text-align:center;">
                        <span class="${badgeClass}">${textoStatus}</span>
                    </td>
                </tr>
            `;
        }
    });

    if(!temDado) {
        tabela.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:2rem; color:#9ca3af;">Nenhum registro com status "${filtroKPIAtual}".</td></tr>`;
    } else {
        tabela.innerHTML = htmlLinhas;
    }
}

function atualizarKPIs(t, a, p, f) {
    if(kpiTotal) kpiTotal.innerText = t;
    if(kpiAndamento) kpiAndamento.innerText = a;
    if(kpiPausadas) kpiPausadas.innerText = p;
    if(kpiFinalizadas) kpiFinalizadas.innerText = f;
}

window.verHistorico = function(osAlvo) {
    if(lblOSModal) lblOSModal.innerText = osAlvo;
    if(tabelaHist) tabelaHist.innerHTML = '';
    
    const historicoOS = dadosBrutos.filter(i => i.os === osAlvo);

    historicoOS.forEach(item => {
        const dataObj = new Date(item.created_at);
        dataObj.setHours(dataObj.getHours() - 3);
        const dh = `${dataObj.toLocaleDateString()} ${dataObj.toLocaleTimeString()}`;
        
        const info = mapaFuncionarios[item.matricula] || { nome: item.matricula };
        
        let txtStatus = item.status_cod;
        let cor = "color:#4b5563;";
        if(item.status_cod == 1) { txtStatus="Início"; cor="color:#1C1C1C; font-weight:bold;"; }
        if(item.status_cod == 2) { txtStatus="Peças"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 3) { txtStatus="Intervalo"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 4) { txtStatus="Retorno"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 5) { txtStatus="Finalizado"; cor="color:#008000; font-weight:bold;"; }
        if(item.status_cod == 6) { txtStatus="Pausa"; cor="color:#2563eb; font-weight:bold;"; }
        if(item.status_cod == 7) { txtStatus="Fim Expediente"; cor="color:#FF0000; font-weight:bold;"; }
        
        if(tabelaHist) {
            tabelaHist.innerHTML += `
                <tr style="border-bottom:1px solid #f3f4f6;">
                    <td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.75rem; color:#6b7280;">${dh}</td>
                    <td style="padding:0.75rem 1rem; font-weight:bold; color:#374151;">${info.nome}</td>
                    <td style="padding:0.75rem 1rem; text-align:center; font-size:0.75rem; ${cor}">${txtStatus} (${item.status_cod})</td>
                </tr>
            `;
        }
    });

    if(modalHist) modalHist.classList.add('open');
}

window.fecharHistorico = function() {
    if(modalHist) modalHist.classList.remove('open');
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
            dataObj.setHours(dataObj.getHours() - 3); // Fuso Brasil
            
            const info = mapaFuncionarios[item.matricula] || { nome: "N/D" };
            
            // 2. O CÉREBRO: Chamamos a mesma função da tabela!
            // Isso garante que o Excel bata 100% com a tela.
            const metricas = calcularMetricasMO(item.matricula, item.os);

            // 3. Formatação do Tempo para Excel (HH:MM)
            const horasInt = Math.floor(metricas.horasDecimais);
            const minutosInt = Math.floor((metricas.horasDecimais - horasInt) * 60);
            const tempoExcel = `${String(horasInt).padStart(2, '0')}:${String(minutosInt).padStart(2, '0')}`;

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
                "Custo M.O. (R$)": metricas.custoTotal // Coluna I (vai como número puro para permitir soma no Excel)
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