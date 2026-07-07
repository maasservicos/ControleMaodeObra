-- Admin_Maas estava com SELECT e INSERT liberados para qualquer client anonimo,
-- ou seja, a senha de qualquer admin (texto puro) podia ser lida via a chave
-- publica do site, e qualquer um podia inserir um "admin" falso. A partir daqui,
-- nenhum acesso publico direto: toda leitura/escrita passa por edge function
-- com service role, que faz a validacao no servidor.
drop policy if exists "Permitir leitura para todos" on "Admin_Maas";
drop policy if exists "Somente leitura" on "Admin_Maas";
drop policy if exists "Permitir inserção para todos" on "Admin_Maas";
