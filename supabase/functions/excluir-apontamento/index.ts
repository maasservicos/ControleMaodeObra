import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verificarBloqueio, registrarTentativaFalha, limparTentativas } from '../_shared/rateLimit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, senha, id } = await req.json();

    if (!matricula || !senha || !id) {
      return new Response(
        JSON.stringify({ error: 'Dados incompletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Usa a Service Role Key — fica no servidor, nunca exposta ao browser
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const matriculaStr = String(matricula);

    const bloqueio = await verificarBloqueio(supabase, matriculaStr);
    if (bloqueio) {
      return new Response(
        JSON.stringify({ error: bloqueio }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Valida credenciais no servidor
    const { data: admin } = await supabase
      .from('Admin_Maas')
      .select('senha')
      .eq('matricula', matriculaStr)
      .maybeSingle();

    if (!admin || admin.senha !== senha) {
      await registrarTentativaFalha(supabase, matriculaStr);
      return new Response(
        JSON.stringify({ error: 'Matrícula ou senha incorretos. Acesso negado.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await limparTentativas(supabase, matriculaStr);

    // Executa o DELETE
    const { error } = await supabase
      .from('SistemaOS_Maas')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('excluir-apontamento:', error.message);
      return new Response(
        JSON.stringify({ error: 'Erro ao excluir o apontamento. Tente novamente.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch {
    return new Response(
      JSON.stringify({ error: 'Erro interno no servidor.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
