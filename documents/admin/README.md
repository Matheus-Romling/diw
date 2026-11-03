Para executar, use `npm start` na raiz do projeto. Se o JSON Server antigo estiver rodando, encerre-o antes de iniciar o novo servidor.

O HTML, CSS e JavaScript do navegador estão em `public/`, incluindo `public/login/` e `public/admin/`. O servidor, banco, testes e estas anotações ficam fora da pasta pública. Os endereços no navegador continuam os mesmos.

Use o formulário normal em `login/index.html`. As três contas em `db.json > administradores` são redirecionadas automaticamente para o painel. Não existe cadastro de administradores. As credenciais de demonstração estão anotadas em comentários em `credenciais.example.js`; esse arquivo e o banco não são servidos pelo aplicativo.

O servidor verifica as permissões de cada operação. Clientes podem consultar e alterar apenas suas contas e reservas. Administradores podem cadastrar, editar e remover veículos, alterar disponibilidade, aprovar ou cancelar reservas e consultar ou excluir clientes. Veículos e clientes vinculados a reservas são preservados.

A sessão tem duração máxima de 30 minutos e fica em memória no navegador. Recarregar a página exige novo login, mantendo o comportamento do protótipo. As senhas no banco usam PBKDF2 com salt individual. As credenciais comentadas são destinadas ao projeto acadêmico local.

Executar `json-server db.json --static .` diretamente ignora as verificações de acesso implementadas em `server.mjs`. Use sempre `npm start`.
