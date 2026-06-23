import { client } from './supabaseClient.js';

const telaConsulta  = document.getElementById('telaConsulta');
const telaLoading   = document.getElementById('telaLoading');
const telaResultado = document.getElementById('telaResultado');
const inputOS       = document.getElementById('inputOS');
const msgErro       = document.getElementById('msgErro');
const lblOS         = document.getElementById('lblOSResultado');
const badgeStatus   = document.getElementById('badgeStatus');
const tabelaConsulta = document.getElementById('tabelaConsulta');

inputOS.addEventListener('keydown', e => {
    if (e.key === 'Enter') consultarOS();
});

function mostrarErro(msg) {
    msgErro.textContent = msg;
    msgErro.classList.remove('hidden');
}

function esconderErro() {
    msgErro.classList.add('hidden');
}

function fmtDataHora(dtString) {
    const d = new Date(dtString);
    const data = d.toLocaleDateString('pt-BR');
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${data} ${hora}`;
}

function calcularHoras(registros) {
    let tempoMs = 0;
    let entrada = null;

    registros.forEach(r => {
        const st = Number(r.status_cod);
        const dt = new Date(r.created_at);

        if (st === 1 || st === 4) {
            entrada = dt;
        } else if ((st === 2 || st === 3 || st === 5 || st === 6 || st === 7) && entrada) {
            tempoMs += dt - entrada;
            entrada = null;
        }
    });

    if (entrada) tempoMs += new Date() - entrada;

    const horasDecimais = tempoMs / (1000 * 60 * 60);
    const h = Math.floor(horasDecimais);
    const m = Math.floor((horasDecimais - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

window.consultarOS = async function() {
    const os = inputOS.value.trim();
    if (!os) {
        mostrarErro('Informe o número da O.S.');
        inputOS.focus();
        return;
    }

    esconderErro();
    telaConsulta.classList.add('hidden');
    telaLoading.classList.remove('hidden');

    try {
        const { data: funcs } = await client
            .from('Funcionarios_Maas')
            .select('matricula, nome');

        const mapaFuncs = {};
        if (funcs) funcs.forEach(f => { mapaFuncs[f.matricula] = f.nome; });

        const { data, error } = await client
            .from('SistemaOS_Maas')
            .select('*')
            .eq('os', os)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            telaLoading.classList.add('hidden');
            telaConsulta.classList.remove('hidden');
            mostrarErro(`Nenhum registro encontrado para a O.S. ${os}.`);
            return;
        }

        // Agrupa registros por matrícula
        const porMatricula = {};
        data.forEach(item => {
            if (!porMatricula[item.matricula]) porMatricula[item.matricula] = [];
            porMatricula[item.matricula].push(item);
        });

        let alguemAberto = false;
        let linhas = '';

        for (const matricula in porMatricula) {
            const registros = porMatricula[matricula];
            const nome = mapaFuncs[matricula] || `Matrícula ${matricula}`;

            // Abertura = primeiro registro de início (status 1)
            const recAbertura = registros.find(r => Number(r.status_cod) === 1);

            // Fechamento = último registro finalizado (status 5 ou 7)
            const recsFechamento = registros.filter(r => Number(r.status_cod) === 5 || Number(r.status_cod) === 7);
            const recFechamento = recsFechamento.length ? recsFechamento[recsFechamento.length - 1] : null;

            // Último status para saber se está aberto
            const ultimoStatus = Number(registros[registros.length - 1].status_cod);
            if (ultimoStatus !== 5 && ultimoStatus !== 7) alguemAberto = true;

            const aberturaFmt  = recAbertura  ? fmtDataHora(recAbertura.created_at)  : '—';
            const fechamentoFmt = recFechamento ? fmtDataHora(recFechamento.created_at) : '<span class="em-aberto">Em Aberto</span>';
            const horas = calcularHoras(registros);

            linhas += `
                <tr>
                    <td class="td-nome">${nome}</td>
                    <td class="td-mono">${aberturaFmt}</td>
                    <td class="td-mono">${fechamentoFmt}</td>
                    <td class="td-horas">${horas}</td>
                </tr>
            `;
        }

        lblOS.textContent = os;

        if (alguemAberto) {
            badgeStatus.textContent = 'Em Andamento';
            badgeStatus.className = 'badge badge-andamento';
        } else {
            badgeStatus.textContent = 'Liberada';
            badgeStatus.className = 'badge badge-liberada';
        }

        tabelaConsulta.innerHTML = linhas;

        telaLoading.classList.add('hidden');
        telaResultado.classList.remove('hidden');

    } catch (err) {
        console.error('Erro na consulta:', err);
        telaLoading.classList.add('hidden');
        telaConsulta.classList.remove('hidden');
        mostrarErro('Erro ao consultar. Verifique a conexão.');
    }
};

window.novaConsulta = function() {
    telaResultado.classList.add('hidden');
    telaConsulta.classList.remove('hidden');
    inputOS.value = '';
    esconderErro();
    inputOS.focus();
};
