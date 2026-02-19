// js/supabaseClient.js


const SUPABASE_URL = "https://ooudzxszovimsmfypckz.supabase.co";
const SUPABASE_KEY = "sb_publishable_8WyuhLagGwQZFaaWKqXqYA_UJ6toANR";

// Cria a conexão e exporta para os outros arquivos usarem
// (O 'supabase' vem do link CDN no HTML)
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export { client };