// Protecao contra forca bruta na senha de admin, compartilhada pelas 4 edge
// functions que validam matricula+senha contra Admin_Maas. Estado fica na tabela
// AdminTentativas_Maas (sem policy publica, so a service role acessa).

const LIMITE_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

// Retorna uma mensagem de erro se a matricula estiver bloqueada, ou null se pode prosseguir.
export async function verificarBloqueio(supabase: any, matricula: string): Promise<string | null> {
  const { data } = await supabase
    .from('AdminTentativas_Maas')
    .select('bloqueado_ate')
    .eq('matricula', matricula)
    .maybeSingle();

  if (data?.bloqueado_ate && new Date(data.bloqueado_ate).getTime() > Date.now()) {
    const minutosRestantes = Math.ceil((new Date(data.bloqueado_ate).getTime() - Date.now()) / 60000);
    return `Muitas tentativas incorretas. Tente novamente em ${minutosRestantes} minuto(s).`;
  }
  return null;
}

export async function registrarTentativaFalha(supabase: any, matricula: string): Promise<void> {
  const { data } = await supabase
    .from('AdminTentativas_Maas')
    .select('tentativas')
    .eq('matricula', matricula)
    .maybeSingle();

  const tentativas = (data?.tentativas ?? 0) + 1;

  if (tentativas >= LIMITE_TENTATIVAS) {
    const bloqueado_ate = new Date(Date.now() + BLOQUEIO_MINUTOS * 60000).toISOString();
    await supabase.from('AdminTentativas_Maas').upsert({ matricula, tentativas: 0, bloqueado_ate });
  } else {
    await supabase.from('AdminTentativas_Maas').upsert({ matricula, tentativas, bloqueado_ate: null });
  }
}

export async function limparTentativas(supabase: any, matricula: string): Promise<void> {
  await supabase.from('AdminTentativas_Maas').delete().eq('matricula', matricula);
}
