# CACHE_REPORT_V6 — CACHE-OPT v6

Gerado por `apply_cache_optimizations_v6.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `Publishers.js` | alterado | cache (600s) em GetPublishers e GetSinglePublisher; Register/Update/Delete invalidam `publishers:<escola>:*` |
| `RFIDMovements.js` | alterado | cache (300s) só em GetAntennas (configuração quase estática); Register/Update/Delete invalidam `rfidAntennas:<escola>:*`. Movimentos, KPIs e anomalias NÃO são cacheados: são eventos em tempo real |
| `Recicle.js` | alterado | chaves de cache passam a `deleted:<escola>:...` e a invalidação a `deleted:<escola>:*` (antes: cada restauro/eliminação definitiva limpava `deleted:*` de TODAS as escolas) |
| `Referralcontroller.js` | alterado | cache (120s) em GetAllReferrals e GetSingleReferral; Register/UpdateStatus/Delete limpam `referrals:*` (chaves globais: a tabela eduall_referrals não tem escola) |
| `Requests.js` | alterado | cache (120s) em GetRequests (JOIN a alunos), GetsingleRequest e GetsingleUserRequests; escritas invalidam `requests:<escola>:*` (TTL curto: são pedidos com estado que muda) |
| `SavedCertificates.js` | alterado | cache (300s) em GetAllCertificates e GetCertificateById (o 404 não é cacheado); Register/Update/Delete invalidam `certificates:<escola>:*` |
| `SavedDeclarations.js` | alterado | cache (300s) em GetAllQualificationsStatements e GetQualificationsStatementById (o 404 não é cacheado); Register/Update/Delete invalidam `qualificationsStatements:<escola>:*` |
| `SavedMaps.js` | alterado | cache (300s) em GetSavedPerformanceMaps (lista sem o JSON pesado); SavePerformanceMap e DeleteSavedPerformanceMap invalidam `performanceMaps:<escola>:*` |
| `SavedTransferGuide.js` | alterado | cache (300s) em GetAllTransferGuides e GetTransferGuideById (o 404 não é cacheado); Register/Update/Delete invalidam `transferGuides:<escola>:*` |
| `SchoolsOfProvenance.js` | alterado | cache (600s) em GetSchoolsOfProvenance e GetSingleSchoolsOfProvenance; escritas invalidam `schoolsOfProvenance:<escola>:*` |
| `ScientificPublications.js` | alterado | cache (300s) em GetScientificPublications (JOIN a autores) e GetSingleScientificPublication; Register/Update/Delete invalidam `scientificPublications:<escola>:*` |
| `SendEmail.js` | alterado | cache (120s) em GetAllSentEmails (JOIN a 3 tabelas com GROUP_CONCAT); o envio de um email invalida `sentEmails:<escola>:*`; `send();` -> `await send();`: antes, uma falha do SMTP dentro de send() era uma promise rejeitada sem tratamento (o pedido ficava pendente e, em Node ≥ 15, pode terminar o processo); agora cai no catch e responde 400 |
| `schoolExpenses.js` | alterado | cache (300s) só em GetExpensesSummary (3 agregações por ano); Register/Update/UpdateStatus/Delete invalidam `expenses:<escola>:*`. As listas (GetExpenses / GetSingleExpense) NÃO são cacheadas: são dados financeiros com muitas combinações de filtros |
| `QuarterlyNotes.js` | ignorado | notas dos alunos: o professor tem de ver de imediato o que lançou, e as notas também são escritas noutros controllers (exames/recurso, NotesRestrictions). Cachear listas de notas sem uma invalidação global arrisca mostrar notas antigas; só TODOs/índices |
| `Racks.js` | ignorado | GetRacks/GetSingleRack devolvem as prateleiras COM os livros embutidos; os livros são escritos noutro controller (RegisterBook/BookUpdate/MoveBook), por isso uma cache aqui mostraria posições de livros desatualizadas; só índices |
| `RefreshToken.js` | ignorado | corre uma vez por utilizador a cada 15 min (TTL do access token) e decide licença/acesso: cachear aqui só atrasaria o bloqueio de licenças expiradas e de contas desativadas; só índices |
| `Replacetenant.js` | ignorado | não é um controller: é um script de manutenção que EXECUTA ao ser carregado (`replaceTenantInDB(...)` no fim do ficheiro); nada para cachear |
| `Saidasdecaixa.js` | ignorado | saídas de caixa são dados financeiros (cada saída tem de aparecer de imediato e os relatórios têm de bater certo com a base de dados); só índices |
| `SemesterNotes.js` | ignorado | notas dos alunos (mesmas razões de QuarterlyNotes.js: têm de aparecer de imediato e há escritas em vários controllers); só TODOs/índices |

## 2. Chaves de cache criadas

| Família | Chaves | TTL |
|---|---|---|
| `publishers:<escola>:` | list, single:<id> | 600 s |
| `schoolsOfProvenance:<escola>:` | list, single:<id> | 600 s |
| `requests:<escola>:` | list, single:<id>, byUser:<id> | 120 s |
| `scientificPublications:<escola>:` | list, single:<id> | 300 s |
| `certificates:<escola>:` | list, single:<id> | 300 s |
| `qualificationsStatements:<escola>:` | list, single:<id> | 300 s |
| `transferGuides:<escola>:` | list, single:<id> | 300 s |
| `expenses:<escola>:` | summary:<ano> | 300 s |
| `rfidAntennas:<escola>:` | list | 300 s |
| `performanceMaps:<escola>:` | list | 300 s |
| `referrals:` | list, single:<id> (globais, sem escola) | 120 s |
| `sentEmails:<escola>:` | list | 120 s |
| `deleted:<escola>:` | list, type:<tipo>, single:<id>:<tipo> (já existiam; agora por escola) | 1800 s |

## 3. TODOs manuais

- [ ] Publishers.js: a invalidação assume que só este controller escreve em eduall_library_publishers. Se outro controller o fizer (importações, migrações), acrescentar nele `Cache.eduallClear(`publishers:${instituteCode}:*`)`.
- [ ] QuarterlyNotes.js: ficheiro com ~2700 linhas, 51 chamadas a ExecuteQuery, 11 `SELECT *` e 64 `console.log` (incluindo blocos de log coloridos nas funções de mini-pauta). Os logs síncronos em pedidos de relatório custam tempo; protegê-los com uma variável de ambiente (ex.: `DEBUG_NOTES=1`).
- [ ] QuarterlyNotes.js: há consultas dentro de ciclos (N+1): cerca das linhas 808→826 e 1129→1151 (ciclo / primeira consulta dentro). Trocar por uma consulta com `IN (...)` ou JOIN.
- [ ] QuarterlyNotes.js: as funções de mini-pauta (GetQuarterlyMiniPautaFullData, GetFinalMiniPautaFullData…, 300+ linhas cada) são as candidatas certas a cache, mas só com TTL curto (30–60 s) e invalidação em TODAS as escritas de notas (Register/Update/Delete aqui, SemesterNotes e controllers de exames).
- [ ] QuarterlyNotes.js: RegisterQuarterlyNote tem ~300 linhas; a verificação de permissões (CheckQuarterlyNotePermission, em NotesRestrictions.js) só beneficia da cache de GetCurrentEmployeeId se o lote v5 tiver sido aplicado.
- [ ] ⚠ RFIDMovements.js: `uid = req.session.user.eduall_user_id`, enquanto o resto do sistema usa `eduall_user_session_ID`. Se essa chave não existir na sessão, o utilizador dos movimentos fica NULL. Confirmar.
- [ ] RFIDMovements.js: RegisterRFIDEvent e RegisterRFIDBatch fazem várias consultas e escritas em sequência sem transação (não analisadas a fundo): uma falha a meio deixa movimento gravado sem o respetivo empréstimo/anomalia.
- [ ] RFIDMovements.js: a lista de antenas só é escrita neste controller (RegisterAntenna/UpdateAntenna/DeleteAntenna); nenhuma outra função atualiza eduall_library_rfid_antennas, por isso a invalidação é exata.
- [ ] Racks.js: ReorderRacks faz 1 UPDATE por prateleira num ciclo; um único UPDATE com `CASE WHEN` (ou transação) reduz idas à base de dados.
- [ ] Racks.js: RackDelete liberta os livros (UPDATE) e depois apaga a prateleira, sem transação: uma falha entre os dois passos deixa livros soltos com a prateleira ainda ativa.
- [ ] Racks.js: se um dia se cachear, invalidar também a partir do controller de livros (a lista depende de ed_library_book_rack/order).
- [ ] Recicle.js: o TTL é de 30 min e a lista só é invalidada por RestoreDeletedItem/PermanentlyDeleteItem. Quando OUTROS controllers eliminam (confirmações de matrícula, pagamentos de propinas/serviços), o «lixo» só mostra o novo item depois de expirar. Reduzir o TTL (ex.: 120 s) ou invalidar `deleted:<escola>:*` nesses controllers.
- [ ] Recicle.js: as chaves antigas (`deleted:list:<escola>` …) ficam órfãs até expirarem (1800 s); deixam de ser lidas. Sem impacto funcional.
- [ ] Recicle.js: getOperatorData faz `SELECT *` a eduall_user_accounts e faz spread do utilizador completo (`...operator`, que provavelmente inclui o hash da palavra-passe). Hoje só se usa `operator.name`, mas é um risco se alguém devolver o objeto; selecionar só id e nome.
- [ ] 🔥 URGENTE Referralcontroller.js: as credenciais do Cloudinary (cloud_name, api_key e api_secret) estão escritas no código. Quem tiver acesso ao repositório pode apagar/enviar ficheiros na conta. Rodar a chave no painel do Cloudinary AGORA e ler de process.env (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET). Remover do histórico do Git se o repositório for partilhado. Não foi alterado automaticamente para não deixar a aplicação sem credenciais.
- [ ] Referralcontroller.js: RegisterReferral recebe os ficheiros (multer) ANTES de validar; nas respostas 422 (validação) e 409 (duplicado) os ficheiros temporários de images/referrals não são apagados (acumulam-se). Fazer `req.files.forEach(f => fs.unlink(f.path, () => {}))` nesses ramos.
- [ ] ⚠ Referralcontroller.js: GetAllReferrals / GetSingleReferral / UpdateReferralStatus / DeleteReferral não filtram por escola nem validam perfil. Confirmar que as rotas estão protegidas (só administração Eduall).
- [ ] Referralcontroller.js: RegisterAuditAction recebe `req.session`; se o formulário de recomendação for público (sem sessão), a auditoria pode falhar DEPOIS do INSERT e a resposta ser 500 com o registo já gravado (o utilizador repete e recebe 409). Confirmar.
- [ ] Referralcontroller.js: a verificação de duplicados (SELECT + INSERT) não é atómica; um índice único parcial/lock evita duplicados em pedidos simultâneos.
- [ ] Referralcontroller.js: o estado `paid` pode ser definido por qualquer chamada a UpdateReferralStatus (sem registo de quem pagou/quando); o log de auditoria existe, mas não há transição válida de estados.
- [ ] ⚠ RefreshToken.js: quando não há sessão devolve `{ data: null, sessions: req.session }` — expõe o objeto da sessão (cookie, dados do utilizador se existirem). Devolver só `{ data: null }`.
- [ ] RefreshToken.js: SQL_USERNAME_LOOKUP e SQL_USER_BY_REFRESH fazem `SELECT *` com 4 JOINs (traz todas as colunas da conta, provavelmente incluindo o hash da palavra-passe, em cada refresh). Listar só as colunas usadas.
- [ ] RefreshToken.js: a licença é validada duas vezes (SQL_USERNAME_LOOKUP já junta a licença e SQL_ACCOUNT_AND_LICENCE volta a consultá-la); a segunda consulta só acrescenta a verificação do instituto/conta e pode fundir-se na primeira.
- [ ] RefreshToken.js: `console.log` de `appType` em cada refresh (ruído nos logs). A configuração Cloudinary/segredos não estão aqui; os JWT usam variáveis de ambiente (correto).
- [ ] 🔥 URGENTE Replacetenant.js: host, utilizador e PALAVRA-PASSE da base de dados (`ws5.angoweb.net`, `eduallao_andre`) estão escritos no ficheiro, além de um token de tenant de 100 caracteres. Alterar a palavra-passe da BD AGORA, mover para variáveis de ambiente e tirar o ficheiro do repositório (e do histórico).
- [ ] ⚠ Replacetenant.js: o ficheiro corre sozinho quando é `require`d. Se estiver na pasta de controllers e alguma rota/loader o importar, o UPDATE em massa executa no arranque da aplicação. Mover para `scripts/` e proteger com `if (require.main === module)`.
- [ ] Replacetenant.js: faz `UPDATE ... WHERE coluna = ?` em TODAS as colunas varchar/text/char do schema, sem transação, sem `--dry-run` e sem backup. Usar `START TRANSACTION`, um modo dry-run (só o SELECT COUNT) e receber os valores por argumentos de linha de comandos.
- [ ] ⚠ Requests.js: RegisterRequest grava `request_made_by` vindo do body (qualquer utilizador pode registar pedidos em nome de outro) e GetsingleUserRequests aceita `:USERCODE` arbitrário (qualquer utilizador lê os pedidos de outro). Usar o utilizador da sessão ou validar o perfil.
- [ ] Requests.js: GetRequests faz `SELECT *` com JOIN a eduall_students (devolve a ficha completa do aluno em cada pedido, e com esta otimização também a guarda no cache). Selecionar só nome/foto/id do aluno.
- [ ] Requests.js: se o nome do aluno mudar em Students.js, a lista pode mostrar o nome antigo até 2 min.
- [ ] Saidasdecaixa.js: a tabela eduall_cash_outflow só tem índices de uma coluna (instituto, data, apagado…); as listagens filtram por instituto + apagado e ordenam por data — um índice composto (ver cache_indexes_v6.sql) evita o filesort.
- [ ] Saidasdecaixa.js: se alguma vez se cachear o relatório (GetCashOutflowReport), usar TTL curto e invalidar em Register/Update/Delete.
- [ ] SavedCertificates.js: cada registo guarda JSON pesado (alunos, notas, logótipo em base64/URL). A cache passa a manter a lista inteira em memória/Redis por escola (TTL 300 s). Se o tamanho preocupar, não devolver o logótipo/notas na lista e carregá-los só no GET por ID.
- [ ] SavedCertificates.js: Update e Delete fazem um SELECT de verificação antes de escrever (2 consultas por escrita); aceitável, não alterado.
- [ ] SavedDeclarations.js: cada registo guarda JSON pesado (alunos, notas, logótipo em base64/URL). A cache passa a manter a lista inteira em memória/Redis por escola (TTL 300 s). Se o tamanho preocupar, não devolver o logótipo/notas na lista e carregá-los só no GET por ID.
- [ ] SavedDeclarations.js: Update e Delete fazem um SELECT de verificação antes de escrever (2 consultas por escrita); aceitável, não alterado.
- [ ] SavedMaps.js: GetSingleSavedPerformanceMap não foi cacheado (a resposta é construída em linha com 4 JSON.parse; o mapa completo é pesado). GetPerformanceMap (5 consultas, ~280 linhas) também não: depende das notas, que são escritas noutros controllers. Se for lento, cachear com TTL curto e invalidar nas escritas de notas.
- [ ] SavedMaps.js: GetAcademicYearTermDates não foi cacheado (1 consulta simples e o ano académico é escrito também pelo AcademicYearController).
- [ ] SavedMaps.js: ficheiro marcado como «adições ao AcademicYearController.js»: confirmar que as 7 funções estão registadas nas rotas e que não ficaram duplicadas no controller original.
- [ ] SavedTransferGuide.js: cada registo guarda JSON pesado (alunos, notas, logótipo em base64/URL). A cache passa a manter a lista inteira em memória/Redis por escola (TTL 300 s). Se o tamanho preocupar, não devolver o logótipo/notas na lista e carregá-los só no GET por ID.
- [ ] SavedTransferGuide.js: Update e Delete fazem um SELECT de verificação antes de escrever (2 consultas por escrita); aceitável, não alterado.
- [ ] SchoolsOfProvenance.js: a lista é pequena e quase estática (boa candidata a cache). Se a ficha do aluno (Students.js) fizer JOIN a esta tabela, o nome da escola só aparece atualizado nessa lista depois do TTL dela.
- [ ] ScientificPublications.js: o multer não tem `fileFilter` nem `limits` (o comentário diz «aceita PDF, EPUB, DOCX» mas aceita qualquer ficheiro de qualquer tamanho). Limitar tipo e tamanho.
- [ ] ScientificPublications.js: Update (com novo ficheiro) e Delete não apagam o ficheiro antigo de files/scientific_publications (ficheiros órfãos).
- [ ] ScientificPublications.js: a lista mostra dados do autor (JOIN a eduall_library_authors); se o autor for editado noutro controller, a lista pode ficar até 5 min desatualizada. Se for visível, invalidar `scientificPublications:<escola>:*` no controller dos autores.
- [ ] ScientificPublications.js: `SELECT *` com JOIN: as colunas com o mesmo nome nas duas tabelas (institute_code, deleted…) sobrepõem-se; listar só as necessárias.
- [ ] SemesterNotes.js: 13 `SELECT *` com JOIN a eduall_students (devolvem a ficha completa do aluno por cada nota); listar só as colunas usadas.
- [ ] SemesterNotes.js: consultas dentro de ciclos (N+1): cerca das linhas 253→287 e 669→680 (ciclo / primeira consulta dentro). Trocar por `IN (...)`/JOIN.
- [ ] SemesterNotes.js: GetAllSubjectsNotesByStudent (~290 linhas) é a função mais pesada; se for lenta, cachear com TTL curto e invalidar nas escritas de notas.
- [ ] 🔥 URGENTE SendEmail.js: a chave do textflow/RapidAPI está escrita no código (linha 2) e a biblioteca nem é usada neste ficheiro. Rodar a chave e remover as linhas `textflow` do ficheiro.
- [ ] ⚠ SendEmail.js: `to: EmailsValues` coloca TODOS os destinatários no campo «Para» — cada pessoa vê os emails de todas as outras (fuga de dados pessoais). Usar `bcc` ou enviar um a um.
- [ ] ⚠ SendEmail.js GetAllSentEmails: `GROUP_CONCAT(JSON_OBJECT(...))` é truncado em `group_concat_max_len` (por defeito 1024 bytes); com poucos destinatários o `JSON.parse(`[${...}]`)` rebenta ou perde contactos. Usar `JSON_ARRAYAGG` ou `SET SESSION group_concat_max_len`.
- [ ] SendEmail.js: `Message` é inserido como HTML sem sanitizar no email institucional (risco de phishing/HTML injetado). Sanitizar (ex.: sanitize-html).
- [ ] SendEmail.js: `generateRandomString(700)` para o código do email: 700 caracteres excede muitas colunas VARCHAR e é desnecessário (20–32 chegam, com crypto.randomBytes).
- [ ] SendEmail.js: `console.log` de emails/mensagens (dados pessoais) e `console.clear()` no catch apaga os logs; `file.buffer` só existe com multer.memoryStorage().
- [ ] SendEmail.js: o INSERT por destinatário é feito num ciclo (1 consulta por contacto); um único INSERT com várias linhas é mais rápido.
- [ ] schoolExpenses.js GetExpenses / GetSingleExpense: o LEFT JOIN a eduall_user_accounts usa o utilizador ATUAL e mostra-o como `operator` em TODAS as despesas (em vez do utilizador que a registou, `ed_expense_created_by`) — mesmo problema que ProductSalles.js. O valor `"operator:null"` é texto literal devolvido ao frontend.
- [ ] schoolExpenses.js: GetExpenses/RegisterExpense/UpdateExpense/DeleteExpense fazem 1 consulta extra (getOperatorData) por pedido só para obter o nome; pode vir da sessão ou de cache.
- [ ] schoolExpenses.js: erros de servidor/SQL respondem 400 (deviam ser 500) e devolvem `err.message` ao cliente.
- [ ] Requer Functions/CacheRoutes.js com eduallGet (null se não existe), eduallSet(chave, valor, ttl) e eduallClear(padrão com `*` no fim) — exatamente como Recicle.js e v5 já usam.
- [ ] Se existirem outros controllers que escrevem nas mesmas tabelas (alunos, autores, contas de utilizador), a cache só se atualiza ao fim do TTL; para ser imediata, acrescentar neles `Cache.eduallClear(...)` com o padrão da entidade (`publishers:<escola>:*`, `requests:<escola>:*`, …).
- [ ] 🔥 Segredos no código (rodar e mover para variáveis de ambiente): Referralcontroller.js (Cloudinary), Replacetenant.js (palavra-passe da BD), SendEmail.js (chave textflow/RapidAPI). Mesmo depois de removidos do ficheiro, continuam no histórico do Git: rodar as chaves é obrigatório.

## 4. Riscos conhecidos

- Cada escrita invalida a família inteira da escola (simples e seguro, mas apaga também entradas que não mudaram).
- Dados que mudam noutros controllers (alunos, autores, contas) só aparecem nas listas cacheadas depois do TTL.
- As listas de documentos guardados (certificados, declarações, guias) guardam JSON pesado em cache: vigiar a memória do Redis/processo.
- Notas (QuarterlyNotes/SemesterNotes), saídas de caixa, despesas (listas) e movimentos RFID NÃO foram cacheados de propósito.
- A invalidação corre imediatamente antes da resposta, DEPOIS da auditoria: se RegisterAuditAction lançar um erro, a escrita já está feita mas a cache só expira ao fim do TTL.
- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.

## 5. Como validar

1. Reiniciar a aplicação e abrir duas vezes uma lista (ex.: editores): o 2.º pedido não deve gerar consulta SQL.
2. Criar/editar/apagar um registo e confirmar que a lista mostra logo a alteração.
3. Enviar um email a contactos e confirmar que aparece de imediato na lista de enviados.
4. Restaurar um item no Recicle de uma escola e confirmar que a lista de OUTRA escola continua em cache (não é limpa).
5. Forçar um erro de SMTP em SendEmailToContacts e confirmar que a resposta é 400 (e não fica pendente).

## 6. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v6/` de volta (mesma estrutura).

