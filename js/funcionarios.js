import { client } from './supabaseClient.js';

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const loginBox = document.getElementById('loginBox');
const conteudoFuncionarios = document.getElementById('conteudoFuncionarios');
const tabelaFuncionarios = document.getElementById('tabelaFuncionarios');

// Credenciais do admin logado ficam só em memória (nunca em localStorage/sessionStorage)
// e são reenviadas a cada escrita, porque a validação real acontece no servidor a cada chamada.
let adminLogado = null;
let listaFuncionarios = [];

async function chamarFuncao(nome, payload) {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nome}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_KEY,
        },
        body: JSON.stringify(payload),
    });
    const result = await resp.json();
    return { ok: resp.ok, result };
}

window.entrarAdmin = async function() {
    const matricula = document.getElementById('loginMatricula').value.trim();
    const senha = document.getElementById('loginSenha').value.trim();
    const erroEl = document.getElementById('loginErro');
    erroEl.innerText = '';

    if (!matricula || !senha) {
        erroEl.innerText = 'Preencha matrícula e senha.';
        return;
    }

    const { ok, result } = await chamarFuncao('validar-admin', { matricula, senha });

    if (!ok) {
        erroEl.innerText = result.error || 'Acesso negado.';
        return;
    }

    adminLogado = { matricula, senha, nome: result.nome };
    loginBox.classList.add('hidden');
    conteudoFuncionarios.classList.remove('hidden');
    carregarFuncionarios();
}

async function carregarFuncionarios() {
    const { data } = await client
        .from('Funcionarios_Maas')
        .select('id, matricula, nome, funcao, valor_hora')
        .order('nome');

    listaFuncionarios = data || [];
    renderizarFuncionarios();
}

window.renderizarFuncionarios = function() {
    const termo = document.getElementById('buscaFuncionario').value.trim().toLowerCase();

    const filtrados = !termo ? listaFuncionarios : listaFuncionarios.filter(f =>
        String(f.nome ?? '').toLowerCase().includes(termo) ||
        String(f.matricula ?? '').toLowerCase().includes(termo)
    );

    if (filtrados.length === 0) {
        tabelaFuncionarios.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400">Nenhum funcionário encontrado.</td></tr>';
        return;
    }

    tabelaFuncionarios.innerHTML = filtrados.map(f => `
        <tr class="tr-hover">
            <td style="font-family:monospace; font-weight:600;">${esc(f.matricula)}</td>
            <td>${esc(f.nome)}</td>
            <td>${esc(f.funcao)}</td>
            <td style="text-align:right;">R$ ${Number(f.valor_hora || 0).toFixed(2)}</td>
            <td style="text-align:center;">
                <button class="btn btn-clean" style="height:auto; padding:0.35rem 0.75rem;" onclick="abrirModalFuncionario(${Number(f.id)})">Editar</button>
            </td>
        </tr>
    `).join('');
}

window.abrirModalFuncionario = function(id) {
    const funcionario = id ? listaFuncionarios.find(f => Number(f.id) === Number(id)) : null;

    document.getElementById('modalFuncionarioTitulo').innerText = funcionario ? 'Editar Funcionário' : 'Novo Funcionário';
    document.getElementById('funcId').value = funcionario ? funcionario.id : '';
    document.getElementById('funcMatricula').value = funcionario ? funcionario.matricula : '';
    document.getElementById('funcNome').value = funcionario ? funcionario.nome : '';
    document.getElementById('funcFuncao').value = funcionario ? funcionario.funcao : '';
    document.getElementById('funcValorHora').value = funcionario ? funcionario.valor_hora : '';
    document.getElementById('funcErro').innerText = '';

    document.getElementById('modalFuncionario').classList.add('open');
}

window.fecharModalFuncionario = function() {
    document.getElementById('modalFuncionario').classList.remove('open');
}

window.salvarFuncionario = async function() {
    const erroEl = document.getElementById('funcErro');
    const id = document.getElementById('funcId').value;
    const funcionario = {
        matricula: document.getElementById('funcMatricula').value.trim(),
        nome: document.getElementById('funcNome').value.trim(),
        funcao: document.getElementById('funcFuncao').value.trim(),
        valor_hora: document.getElementById('funcValorHora').value,
    };
    if (id) funcionario.id = Number(id);

    if (!funcionario.matricula || !funcionario.nome) {
        erroEl.innerText = 'Matrícula e nome são obrigatórios.';
        return;
    }

    const { ok, result } = await chamarFuncao('gerenciar-funcionario', {
        matricula: adminLogado.matricula,
        senha: adminLogado.senha,
        acao: id ? 'atualizar' : 'criar',
        funcionario,
    });

    if (!ok) {
        erroEl.innerText = result.error || 'Erro ao salvar.';
        return;
    }

    window.fecharModalFuncionario();
    carregarFuncionarios();
}
