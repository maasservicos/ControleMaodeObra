import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verificarBloqueio, registrarTentativaFalha, limparTentativas } from '../_shared/rateLimit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function erro(msg: string, status = 400) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, senha, acao, funcionario } = await req.json();

    if (!matricula || !senha || !acao || !funcionario) {
      return erro('Dados incompletos.');
    }
    if (acao !== 'criar' && acao !== 'atualizar') {
      return erro('Ação inválida.');
    }

    const nomeFunc = String(funcionario.nome ?? '').trim();
    const matriculaFunc = String(funcionario.matricula ?? '').trim();
    const funcaoFunc = String(funcionario.funcao ?? '').trim();
    const valorHora = Number(funcionario.valor_hora);

    if (!nomeFunc || !matriculaFunc) {
      return erro('Nome e matrícula do funcionário são obrigatórios.');
    }
    if (!Number.isFinite(valorHora) || valorHora < 0) {
      return erro('Valor da hora inválido.');
    }

    // Usa a Service Role Key — fica no servidor, nunca exposta ao browser.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const matriculaStr = String(matricula);

    const bloqueio = await verificarBloqueio(supabase, matriculaStr);
    if (bloqueio) {
      return erro(bloqueio, 429);
    }

    // Valida credenciais de admin no servidor (Admin_Maas não tem leitura pública)
    const { data: admin } = await supabase
      .from('Admin_Maas')
      .select('senha')
      .eq('matricula', matriculaStr)
      .maybeSingle();

    if (!admin || admin.senha !== senha) {
      await registrarTentativaFalha(supabase, matriculaStr);
      return erro('Matrícula ou senha incorretos. Acesso negado.', 401);
    }

    await limparTentativas(supabase, matriculaStr);

    if (acao === 'criar') {
      const { data: existente } = await supabase
        .from('Funcionarios_Maas')
        .select('id')
        .eq('matricula', matriculaFunc)
        .maybeSingle();

      if (existente) {
        return erro('Já existe um funcionário cadastrado com essa matrícula.');
      }

      const { error } = await supabase
        .from('Funcionarios_Maas')
        .insert([{ matricula: matriculaFunc, nome: nomeFunc, funcao: funcaoFunc, valor_hora: valorHora }]);

      if (error) {
        console.error('gerenciar-funcionario (criar):', error.message);
        return erro('Erro ao criar o funcionário. Tente novamente.', 500);
      }
    } else {
      if (!funcionario.id) return erro('ID do funcionário é obrigatório para atualizar.');

      const { error } = await supabase
        .from('Funcionarios_Maas')
        .update({ matricula: matriculaFunc, nome: nomeFunc, funcao: funcaoFunc, valor_hora: valorHora })
        .eq('id', funcionario.id);

      if (error) {
        console.error('gerenciar-funcionario (atualizar):', error.message);
        return erro('Erro ao atualizar o funcionário. Tente novamente.', 500);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch {
    return erro('Erro interno no servidor.', 500);
  }
});
