-- Funcionarios_Maas tinha INSERT liberado para qualquer client anonimo (sem
-- senha nenhuma). Cadastro/edicao agora passa exclusivamente pela edge function
-- gerenciar-funcionario, que valida a senha de admin no servidor antes de
-- escrever (com service role). SELECT continua publico: o quiosque precisa
-- consultar nome/funcao pela matricula sem exigir login.
drop policy if exists "Permitir inserção para todos" on "Funcionarios_Maas";
