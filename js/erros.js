// Detecção de apontamentos suspeitos no histórico do SistemaOS_Maas.
// Compartilhado pelo dashboard (auditoria) e pelo operacional (autocorreção
// pelo próprio colaborador) — qualquer ajuste na regra vale pros dois.

// Limite de horas "em andamento" sem pausa para considerar apontamento suspeito
export const LIMITE_HORAS_ABERTO = 12;

// O.S. numérica de verdade (ex: "036849"), diferente de um Serviço Avulso (ex: "SEINFRA - 06/07/2026")
export function ehOSNumerica(os) {
    return /^\d+$/.test(String(os).trim());
}

// Reaplica a mesma máquina de estados de calcularHorasTrabalhadas (entrada aberta/fechada),
// mas em vez de somar tempo, sinaliza transições que não deveriam acontecer.
export function detectarInconsistencias(historicoOrdenado) {
    const erros = [];
    if (!historicoOrdenado || historicoOrdenado.length === 0) return erros;

    const osRef = historicoOrdenado[0].os;
    const matriculaRef = historicoOrdenado[0].matricula;
    const nomesFechamento = { 2: 'Peças', 3: 'Intervalo', 5: 'Término', 6: 'Pausa', 7: 'Fim de Expediente' };
    const osNumerica = ehOSNumerica(osRef);

    let entrada = null;
    let finalizado = false;

    historicoOrdenado.forEach(registro => {
        const st = Number(registro.status_cod);
        const dataReg = new Date(registro.created_at);

        if (st === 1 || st === 4) {
            // Reabertura legítima da O.S. depois de um Término anterior (retrabalho, garantia,
            // continuação em outro dia): um novo Início/Retorno inicia um ciclo novo, não é
            // "apontamento após o término" — por isso zera `finalizado` em vez de mantê-lo para sempre.
            finalizado = false;
            if (entrada) {
                const rotulo = st === 1 ? 'Início' : 'Retorno';
                erros.push({ item: registro, os: osRef, matricula: matriculaRef, motivo: `${rotulo} apontado em duplicidade, sem pausa/término do período anterior` });
            }
            entrada = dataReg;
        } else if (st === 2 || st === 3 || st === 5 || st === 6 || st === 7) {
            // Serviço Avulso pode ter várias rodadas (Início > Término > Início de novo) no mesmo dia — isso é normal.
            // Só se aplica a O.S. numéricas de verdade, que representam um único job.
            if (finalizado && osNumerica) {
                erros.push({ item: registro, os: osRef, matricula: matriculaRef, motivo: 'Apontamento registrado após o Término da O.S.' });
            }

            // "Encerrado por continuidade" é inserido automaticamente pelo sistema quando outro
            // colaborador assume a mesma O.S./rótulo de avulso (ver confirmarContinuacao em
            // operacional.js) — não é uma ação do colaborador, então não deve virar "erro" nem
            // "ficou X horas aberto": o horário do registro é o do OUTRO colaborador que assumiu,
            // não reflete quanto tempo este colaborador realmente trabalhou.
            const encerramentoPorContinuidade = st === 5 && registro.obs === 'Encerrado por continuidade';

            if (!entrada) {
                if (!encerramentoPorContinuidade) {
                    erros.push({ item: registro, os: osRef, matricula: matriculaRef, motivo: `${nomesFechamento[st]} apontado sem Início/Retorno anterior` });
                }
            } else {
                const horasAberto = (dataReg - entrada) / (1000 * 60 * 60);
                if (horasAberto > LIMITE_HORAS_ABERTO && !encerramentoPorContinuidade) {
                    erros.push({ item: registro, os: osRef, matricula: matriculaRef, motivo: `Ficou ${horasAberto.toFixed(1)}h em andamento sem pausa (limite ${LIMITE_HORAS_ABERTO}h)` });
                }
            }
            entrada = null;
            // "Encerrado por continuidade" é um handoff administrativo (outro colaborador assumiu a O.S.),
            // não uma finalização real do job — não deve travar uma reabertura legítima depois.
            if (st === 5 && registro.obs !== 'Encerrado por continuidade') finalizado = true;
        }
    });

    // Ainda em aberto (sem pausa/término) até agora
    if (entrada && !finalizado) {
        const horasAberto = (new Date() - entrada) / (1000 * 60 * 60);
        if (horasAberto > LIMITE_HORAS_ABERTO) {
            erros.push({ item: null, os: osRef, matricula: matriculaRef, dataAbertura: entrada.toISOString(), motivo: `Em andamento há ${horasAberto.toFixed(1)}h sem pausa/finalização (limite ${LIMITE_HORAS_ABERTO}h)` });
        }
    }

    return erros;
}

// O app assume Brasília (UTC-3) fixo em vez do fuso do navegador (ver carregarLista em
// operacional.js), então a conversão de/para <input type="datetime-local"> segue a mesma
// convenção em vez de confiar no fuso local do browser.
export function isoParaDatetimeLocalBRT(isoUTC) {
    const d = new Date(isoUTC);
    d.setUTCHours(d.getUTCHours() - 3);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function datetimeLocalBRTParaISO(valor) {
    const [data, hora] = valor.split('T');
    const [ano, mes, dia] = data.split('-').map(Number);
    const [h, m] = hora.split(':').map(Number);
    return new Date(Date.UTC(ano, mes - 1, dia, h + 3, m)).toISOString();
}
