const SUPABASE_URL = "https://rcubcruyviybpbeqtist.supabase.co";
const SUPABASE_KEY = "sb_publishable_KcCjsfIFepc3O4YG7CNr8Q_kudJ6Rfi";
    
// Cria a conexão e exporta para os outros arquivos usarem
// (O 'supabase' vem do link CDN no HTML)
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export { client };