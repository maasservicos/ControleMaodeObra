import { client } from './supabaseClient.js';

// Elementos
const txtMatricula = document.getElementById('txtMatricula');
const txtOS = document.getElementById('txtOS');
const painelDados = document.getElementById('painelDados');
const cardAviso = document.getElementById('cardAviso');
const listaApontamentos = document.getElementById('listaApontamentos');

let statusPendente = null;
let apontamentosAnteriores = [];

// --- FUNÇÕES AUXILIARES ---
function mostrarAviso(titulo, detalhe) {
    document.getElementById('msgAvisoTitulo').innerText = titulo;
    document.getElementById('msgAvisoDetalhe').innerText = detalhe;
    cardAviso.classList.remove('hidden');
}

// 🆕 FUNÇÃO DE LIMPEZA
window.limparTela = function() {
    // 1. Limpa os campos visuais
    txtMatricula.value = "";
    txtOS.value = "";
    document.getElementById('lblNomeFuncionario').innerText = "";
    
    // 2. Destrava a tela
    ativarModoLivre();
    
    // 3. Limpa avisos e foca na matrícula
    listaApontamentos.innerHTML = "";
    cardAviso.classList.add('hidden');
    txtMatricula.focus();
}

// MODO 1: TRABALHANDO
function ativarModoTrabalhando(dados) {
    document.getElementById('divInicio').classList.add('hidden');
    document.getElementById('divTrabalhando').classList.remove('hidden');
    document.getElementById('divPausado').classList.add('hidden');
    
    txtMatricula.readOnly = true;
    txtOS.readOnly = true ;
    painelDados.disabled = true;
    txtOS.value = dados.os;
    mostrarAviso("O.S em Andamento", `O.S. ${dados.os} iniciada.`);
}

// MODO 2: PAUSADO
function ativarModoPausado(dados) {
    document.getElementById('divInicio').classList.add('hidden');
    document.getElementById('divTrabalhando').classList.add('hidden');
    document.getElementById('divPausado').classList.remove('hidden');
    
    txtMatricula.readOnly = true;
    txtOS.readOnly = true ;
    painelDados.disabled = true;
    txtOS.value = dados.os;
    mostrarAviso("O.S Pausada", `Aguardando retorno.`);
}

// MODO 3: LIVRE
function ativarModoLivre() {
    document.getElementById('divInicio').classList.remove('hidden');
    document.getElementById('divTrabalhando').classList.add('hidden');
    document.getElementById('divPausado').classList.add('hidden');
    
    txtMatricula.readOnly = false;
    txtOS.disabled = false;
    painelDados.disabled = false;
    cardAviso.classList.add('hidden');
}

// --- CÉREBRO: DIGITOU MATRÍCULA ---
txtMatricula.addEventListener('blur', async function() {
    // ✅ CORREÇÃO: Limpeza de espaços e zeros à esquerda
    const matriculaBruta = txtMatricula.value.trim();
    if (!matriculaBruta) return;
    
    const matriculaValor = Number(matriculaBruta).toString();
    const lblNome = document.getElementById('lblNomeFuncionario'); 

    lblNome.innerText = "🔍 Buscando...";
    
    // 1. Busca Funcionário
    const { data: func } = await client.from('Funcionarios_Maas').select('*').eq('matricula', matriculaValor).maybeSingle();
    
    if (!func) {
        lblNome.innerText = "❌ Colaborador Não encontrado";
        lblNome.className = "text-center text-red-500 font-bold text-sm mt-2";
        return; 
    }

    lblNome.innerText = `👤 ${func.nome} - ${func.funcao}`;
    lblNome.className = "text-center text-maas-blue font-bold text-sm mt-2";

    // 2. Busca Último Status
    const { data: historico } = await client.from('SistemaOS_Maas').select('*').eq('matricula', matriculaValor).order('created_at', { ascending: false }).limit(1);

    if (historico && historico.length > 0) {
        const last = historico[0];
        const st = Number(last.status_cod);

        if (st === 1 || st === 4) {
            ativarModoTrabalhando(last);
            const osAbertas = await buscarOSsEmAberto(matriculaValor, last.os);
            if (osAbertas.length > 0) {
                const lista = osAbertas.map(o => {
                    const s = Number(o.status_cod) === 2 ? 'Peças' : 'Pausa';
                    return `O.S. ${o.os} (${s})`;
                }).join(' | ');
                document.getElementById('msgAvisoDetalhe').innerText = `⚠️ Tem outra O.S. em aberto: ${lista}`;
            }
        } else if (st === 3) {
            ativarModoPausado(last);
        } else {
            ativarModoLivre();
            if (st === 2 || st === 6) {
                // Peças ou Pausa: pode retomar a mesma O.S. ou iniciar outra
                txtOS.value = last.os;
                const textoStatus = st === 2 ? "PEÇAS" : "PAUSA";
                const osAbertas = await buscarOSsEmAberto(matriculaValor, last.os);
                let detalhe = `Último: ${textoStatus} na O.S. ${last.os}. Retome ou digite nova O.S.`;
                if (osAbertas.length > 0) {
                    const lista = osAbertas.map(o => {
                        const s = Number(o.status_cod) === 2 ? 'Peças' : 'Pausa';
                        return `O.S. ${o.os} (${s})`;
                    }).join(' | ');
                    detalhe += ` ⚠️ Também em aberto: ${lista}`;
                }
                mostrarAviso("PODE INICIAR OUTRA O.S.", detalhe);
            } else if (st === 7) {
                txtOS.value = last.os;
                mostrarAviso("PRONTO PARA RETOMAR", `Último registro: FIM DE EXPEDIENTE. Clique em INICIAR.`);
            } else {
                txtOS.value = "";
            }
        }
    } else {
        txtOS.value = "";
        ativarModoLivre();
    }
    carregarLista();
});

// --- LISTAGEM DE HISTÓRICO ---
async function carregarLista() {
    // ✅ CORREÇÃO: Limpeza de espaços e zeros à esquerda
    const matriculaBruta = txtMatricula.value.trim();
    if(!matriculaBruta) return;

    const matricula = Number(matriculaBruta).toString();
    const osFiltro = txtOS.value.trim();

    let query = client.from('SistemaOS_Maas')
        .select('*')
        .eq('matricula', matricula)
        .order('created_at', {ascending:false})
        .limit(5);

    if (osFiltro) query = query.ilike('os', `%${osFiltro}%`);

    const { data } = await query;
    listaApontamentos.innerHTML = "";
    
    if(data && data.length > 0) {
        data.forEach(item => {
            const dataObj = new Date(item.created_at);
            dataObj.setHours(dataObj.getHours() - 3);
            const hora = dataObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            
            let badgeClass = "badge badge-gray";
            let texto = item.status_cod;
            
            if(item.status_cod == 1) { badgeClass = "badge badge-blue"; texto = "Início"; }
            if(item.status_cod == 2) { badgeClass = "badge badge-yellow"; texto = "Peças"; }
            if(item.status_cod == 3) { badgeClass = "badge badge-orange"; texto = "Intervalo"; }
            if(item.status_cod == 4) { badgeClass = "badge badge-blue"; texto = "Retorno"; }
            if(item.status_cod == 5) { badgeClass = "badge badge-green"; texto = "Fim"; }
            if(item.status_cod == 6) { badgeClass = "badge badge-yellow"; texto = "Pausa"; }
            if(item.status_cod == 7) { badgeClass = "badge badge-red"; texto = "Saída"; }

            listaApontamentos.innerHTML += `
                <tr class="tr-hover">
                    <td style="font-family:monospace; font-weight:500; color:#1f2937;">${hora}</td>
                    <td style="font-weight:bold; color:#111827;">${item.os}</td>
                    <td style="text-align:right;">
                        <span class="${badgeClass}">${texto}</span>
                    </td>
                </tr>`;
        });
    } else {
        if (osFiltro) listaApontamentos.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:1rem; color:#9ca3af; font-size:0.75rem;">Nenhum registro para O.S. ${osFiltro}</td></tr>`;
    }
}

// --- BOTÕES DE AÇÃO ---
window.definirAcao = async function(codigoStatus) {
    // Validação básica
    if (!txtMatricula.value || !txtOS.value) {
        alert("Preencha todos os campos antes de clicar!");
        return;
    }

    // Início de O.S: verifica se tem apontamento anterior em aberto na mesma OS
    if (codigoStatus === 1) {
        const os = txtOS.value.trim().padStart(6, '0');
        const matricula = Number(txtMatricula.value.trim()).toString();
        const anteriores = await buscarApontamentosAbertosNaOS(os, matricula);
        if (anteriores.length > 0) {
            apontamentosAnteriores = anteriores;
            const nomes = anteriores.map(a => a.nome).join(', ');
            const plural = anteriores.length > 1 ? 'apontamentos anteriores' : 'apontamento anterior';
            document.getElementById('txtContinuacaoMsg').innerText =
                `Existe um ${plural} de ${nomes} nesta O.S. Deseja continuar o serviço?`;
            document.getElementById('modalContinuacao').classList.remove('hidden');
            return;
        }
        executarSalvamento(1);
        return;
    }

    // Término (5) ou Fim Expediente (7) -> abre modal de confirmação
    if (codigoStatus === 5 || codigoStatus === 7) {
        statusPendente = codigoStatus;
        const modal = document.getElementById('modalConfirmacao');
        const texto = document.getElementById('textoConfirmacao');
        if (modal) {
            if (codigoStatus === 5) texto.innerText = "Confirma o Término da Ordem de Serviço?";
            if (codigoStatus === 7) texto.innerText = "Confirma o Fim do Expediente?";
            modal.classList.remove('hidden');
        }
    } else {
        executarSalvamento(codigoStatus);
    }
}

window.confirmarContinuacao = async function() {
    document.getElementById('modalContinuacao').classList.add('hidden');
    const os = txtOS.value.trim().padStart(6, '0');

    // Grava Término (status 5) para cada apontamento anterior em aberto
    for (const anterior of apontamentosAnteriores) {
        await client.from('SistemaOS_Maas').insert([{
            matricula: anterior.matricula,
            os: os,
            status_cod: 5,
            obs: `Encerrado por continuidade`,
            created_at: new Date().toISOString()
        }]);
    }
    apontamentosAnteriores = [];
    executarSalvamento(1);
}

window.cancelarContinuacao = function() {
    document.getElementById('modalContinuacao').classList.add('hidden');
    apontamentosAnteriores = [];
}

// Funções que o Modal chama quando clica em "Cancelar" ou "Confirmar"
window.fecharModal = function() {
    document.getElementById('modalConfirmacao').classList.add('hidden');
    statusPendente = null;
}

window.confirmarEnvio = function() {
    console.log("Confirmado no modal! Ação pendente:", statusPendente);
    if (statusPendente) {
        executarSalvamento(statusPendente);
        window.fecharModal();
    }
}

async function executarSalvamento(codigoStatus) {
    console.log("--- INICIANDO SALVAMENTO ---");
    console.log("Botão clicado:", codigoStatus);

    // ✅ CORREÇÃO: Limpeza de espaços e zeros à esquerda
    const matriculaBruta = txtMatricula.value.trim();
    const matricula = Number(matriculaBruta).toString();
    const os = txtOS.value.trim().padStart(6, '0');
    const dataHoraClick = new Date().toISOString();

    let horasCalculadas = null; 

    document.body.style.cursor = 'wait';

    if (codigoStatus === 5 || codigoStatus === 7) {
        console.log("✅ Entrou no IF de cálculo (Status 5 ou 7 detectado)");
        
        try {
            console.log(`🔍 Chamando calculadora para Matrícula: ${matricula}, OS: ${os}`);
            horasCalculadas = await calcularHorasTrabalhadas(matricula, os);
            console.log("💰 RESULTADO DO CÁLCULO:", horasCalculadas); 
        } catch (erro) {
            console.error("❌ ERRO NA CALCULADORA:", erro);
        }
    } else {
        console.log("⏩ Pulou o cálculo (Status não é de finalização)");
    }

    const dadosParaSalvar = { 
        matricula, 
        os, 
        status_cod: codigoStatus, 
        obs: "Web",
        created_at: dataHoraClick,
        horas_trabalhadas: horasCalculadas 
    };

    console.log("📦 ENVIANDO PARA O SUPABASE:", dadosParaSalvar);

    const { error } = await client.from('SistemaOS_Maas').insert([dadosParaSalvar]);
    
    document.body.style.cursor = 'default';

    if (!error) {
        let mensagem = "✅ SALVO!";
        if (horasCalculadas) mensagem += `\nTempo: ${horasCalculadas}`;
        
        console.log("Sucesso! Mensagem:", mensagem);
        mostrarAviso(mensagem, "Reiniciando...");
        
        setTimeout(() => window.limparTela(), 3000);
    } else {
        console.error("❌ ERRO DO SUPABASE:", error);
        alert("Erro ao salvar: " + error.message);
    }
}

// --- VERSÃO CORRIGIDA: PROTEÇÃO CONTRA FUSO HORÁRIO ---
async function calcularHorasTrabalhadas(matricula, os) {
    const { data: historico } = await client
        .from('SistemaOS_Maas')
        .select('created_at, status_cod')
        .eq('matricula', matricula)
        .eq('os', os)
        .order('created_at', { ascending: true });

    if (!historico || historico.length === 0) return "00:00";

    let milissegundosTrabalhados = 0;
    let inicioUltimoPeriodo = null;

    for (let registro of historico) {
        const status = Number(registro.status_cod);

        let dataString = registro.created_at;
        if (!dataString.endsWith('Z') && !dataString.includes('+')) {
             dataString += 'Z'; 
        }
        
        const dataRegistro = new Date(dataString).getTime();

        if (status === 1 || status === 4) {
            inicioUltimoPeriodo = dataRegistro;
        }
        else if ((status === 2 || status === 3 || status === 6) && inicioUltimoPeriodo !== null) {
            if (dataRegistro > inicioUltimoPeriodo) {
                milissegundosTrabalhados += (dataRegistro - inicioUltimoPeriodo);
            }
            inicioUltimoPeriodo = null;
        }
    }

    if (inicioUltimoPeriodo !== null) {
        const agora = new Date().getTime(); 
        
        if (agora > inicioUltimoPeriodo) {
            milissegundosTrabalhados += (agora - inicioUltimoPeriodo);
        }
    }

    milissegundosTrabalhados = Math.max(0, milissegundosTrabalhados);

    const totalMinutos = Math.floor(milissegundosTrabalhados / 1000 / 60);
    const horas = Math.floor(totalMinutos / 60);
    const minutos = totalMinutos % 60;

    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

// Busca outros colaboradores com apontamento em aberto na mesma O.S.
async function buscarApontamentosAbertosNaOS(os, matriculaAtual) {
    const { data } = await client
        .from('SistemaOS_Maas')
        .select('matricula, status_cod, created_at')
        .eq('os', os)
        .order('created_at', { ascending: false });

    if (!data) return [];

    // Status mais recente por matrícula nessa O.S.
    const mapaMatricula = {};
    data.forEach(item => {
        if (!mapaMatricula[item.matricula]) mapaMatricula[item.matricula] = item;
    });

    // Outros colaboradores cujo último status não é Término (5)
    const abertos = Object.values(mapaMatricula).filter(item =>
        item.matricula !== matriculaAtual && Number(item.status_cod) !== 5
    );

    if (abertos.length === 0) return [];

    // Busca os nomes
    const { data: funcs } = await client
        .from('Funcionarios_Maas')
        .select('matricula, nome')
        .in('matricula', abertos.map(a => a.matricula));

    const mapaFuncs = {};
    if (funcs) funcs.forEach(f => mapaFuncs[f.matricula] = f.nome);

    return abertos.map(a => ({ ...a, nome: mapaFuncs[a.matricula] || a.matricula }));
}

// Busca O.S. em aberto (Peças ou Pausa) do colaborador, excluindo a O.S. atual
async function buscarOSsEmAberto(matricula, osAtual) {
    const { data } = await client
        .from('SistemaOS_Maas')
        .select('os, status_cod, created_at')
        .eq('matricula', matricula)
        .order('created_at', { ascending: false });

    if (!data) return [];

    // Pega o status mais recente por O.S.
    const mapaOS = {};
    data.forEach(item => {
        if (!mapaOS[item.os]) mapaOS[item.os] = item;
    });

    // Retorna apenas as O.S. diferentes da atual que estão em Peças (2) ou Pausa (6)
    return Object.values(mapaOS).filter(item =>
        item.os !== osAtual && (Number(item.status_cod) === 2 || Number(item.status_cod) === 6)
    );
}