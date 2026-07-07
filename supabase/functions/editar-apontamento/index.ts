import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STATUS_VALIDOS = [1, 2, 3, 4, 5, 6, 7];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { matricula, senha, id, status_cod, created_at, obs } = await req.json();

    if (!matricula || !senha || !id || !status_cod || !created_at) {
      return new Response(
        JSON.stringify({ error: 'Dados incompletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!STATUS_VALIDOS.includes(Number(status_cod))) {
      return new Response(
        JSON.stringify({ error: 'Status inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (Number.isNaN(new Date(created_at).getTime())) {
      return new Response(
        JSON.stringify({ error: 'Data/hora inválida.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Usa a Service Role Key — fica no servidor, nunca exposta ao browser
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Valida credenciais no servidor
    const { data: admin } = await supabase
      .from('Admin_Maas')
      .select('senha')
      .eq('matricula', String(matricula))
      .maybeSingle();

    if (!admin || admin.senha !== senha) {
      return new Response(
        JSON.stringify({ error: 'Matrícula ou senha incorretos. Acesso negado.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error } = await supabase
      .from('SistemaOS_Maas')
      .update({
        status_cod: Number(status_cod),
        created_at,
        obs: obs != null ? String(obs) : undefined,
      })
      .eq('id', id);

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Erro ao editar: ' + error.message }),
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
