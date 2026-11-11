# CACHE_REPORT_V7 — CACHE-OPT v7

Gerado por `apply_cache_optimizations_v7.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `SeedLibraryBooks.js` | alterado | no fim da importação (antes de gravar o relatório) limpa `publishers:<escola>:*`: getOrCreateLookupId pode criar editoras novas e a lista de editoras (cache do v6, 600 s) ficava desatualizada |
| `Services.js` | alterado | chaves passam a `services:<escola>:list` / `services:<escola>:single:<id>` e a limpeza a `services:<escola>:*`. Antes, o padrão de limpeza (`services:<escola>:<user>:*`) não correspondia a nenhuma chave real (`services:list:<escola>:<user>`): as escritas só repunham a lista do próprio utilizador, a ficha individual nunca era limpa e os outros utilizadores da escola viam dados antigos até 1 h (TTL); os chamadores continuam a passar `userId` (ignorado pelos novos builders): sem outras alterações |
| `Shelves.js` | alterado | cache (600s) em GetBookcases e GetSingleBookcase; Register/Update/Delete/Reorder invalidam `bookcases:<escola>:*` |
| `StudentBehavior.js` | alterado | cache (120s) só em GetAllStudentBehavior (lista geral, sem JOIN); Register/Delete/Update invalidam `studentBehavior:<escola>:*`. GetAllStudentBehaviorByStudentCode NÃO foi cacheado (ver TODOs) |
| `StudentExamsCalendar.js` | alterado | cache (120s) em GetExamsCalendar e GetCalendarBlocks (JOIN a disciplinas/turmas/horários); Register/Update/Delete invalidam `examsCalendar:<escola>:*`. GetExamsCalendarByClass e GetSingleExamCalendar NÃO foram cacheados (ver TODOs) |
| `SendEmail.js` | ignorado | já otimizado no v6 (cache em GetAllSentEmails + `await send()`); só um TODO novo |
| `SendEmailMessage.js` | ignorado | só envia um email (sem leituras nem escritas na base de dados): não há nada para cachear nem indexar |
| `SendSms.js` | ignorado | créditos e registos de SMS mudam a cada envio: o saldo e o histórico em cache ficariam errados; só TODOs/índices |
| `ServicePayments.js` | ignorado | pagamentos de serviços/propinas: dados financeiros que têm de aparecer de imediato nos recibos e relatórios, escritos em várias tabelas; só TODOs/índices |
| `StudenBalanceController.js` | ignorado | saldos e movimentos são dados financeiros: o saldo mostrado tem de bater certo com a base de dados em cada pedido; só TODOs/índices |
| `StudentAttendance.js` | ignorado | as presenças são lançadas pelo professor e têm de aparecer de imediato; as listas deste ficheiro devolvem a escola inteira sem filtros (cachear iria guardar tudo por escola) e a tabela pode ser escrita por outros caminhos; só TODOs/índices |
| `StudentEnrollment.js` | ignorado | matrículas são escritas por vários controllers (ServicePayments, confirmações) e comandam pagamentos/turmas: uma cache aqui arriscaria matrículas antigas; só TODOs/índices |
| `StudentEnrollmentConfirmation.js` | ignorado | código legado: não usa ExecuteQuery e há ramos que referem um modelo não importado; nada para cachear (ver TODOs) |
| `StudentExams.js` | ignorado | notas dos alunos (mesmas razões do QuarterlyNotes/SemesterNotes no v6): têm de aparecer de imediato e são escritas em vários controllers; só TODOs/índices |
| `StudentExamsAndFeaturesNotes.js` | ignorado | notas dos alunos (mesmas razões do StudentExams.js); só TODOs/índices |
| `StudentFeaturedNotes.js` | ignorado | notas dos alunos (mesmas razões do StudentExams.js); só TODOs/índices |
| `StudentGradeHistory.js` | ignorado | histórico de notas de um aluno: leitura rara (ficha do aluno) e função com 3 respostas de sucesso diferentes; o ganho de cache é pequeno e o risco de mostrar notas antigas é real; só TODOs/índices |
| `SiteManager.js` | não aplicado | não aplicado: o ficheiro ORIGINAL já não passa `node --check` (corrigir primeiro): /private/var/folders/wx/t8qht7dx01x0_6d2g4fh223h0000gn/T/tmplfqqd7jd/SiteManager.js:28 | function isValidDomain(d){ | ^^^^^^^^ | SyntaxError: Unexpected token 'function' | at wrapSafe (node:internal/modules/cjs/loader:17 |

## 2. Chaves de cache criadas / alteradas

| Família | Chaves | TTL |
|---|---|---|
| `bookcases:<escola>:` | list, single:<id> | 600 s |
| `services:<escola>:` | list, single:<id> (chaves corrigidas; antes `services:list:<escola>:<user>`) | 3600 s (já existia) |
| `examsCalendar:<escola>:` | list, blocks | 120 s |
| `studentBehavior:<escola>:` | list | 120 s |
| `site:<escola>:` | contacts, courses, slides, sections, branding, posts, settings | 300 s |
| `site:global:` | templates (sem escola) | 600 s |
| `publishers:<escola>:` | (do v6) agora também limpa no fim de SeedLibraryBooks | — |

## 3. TODOs manuais

- [ ] SeedLibraryBooks.js: a importação também cria autores, tipos de livro e fornecedores (eduall_library_authors / _typeofbooks / _providers). Se esses controllers tiverem cache (lotes v1–v5), acrescentar a mesma linha `await _cacheClear(`<família>:${instituteCode}:*`)` com a chave da família respetiva.
- [ ] SeedLibraryBooks.js: quando corre sem sessão (modo automático, `buildFakeContext`) o `require` de Functions/CacheRoutes pode abrir uma ligação (Redis) que mantém o processo vivo; se correr como script isolado, chamar `process.exit()` no fim ou fechar o cliente de cache.
- [ ] SeedLibraryBooks.js: getOrCreateLookupId e getOrCreateAuthor comparam `LOWER(TRIM(coluna)) = LOWER(TRIM(?))`, o que impede o uso de índice na coluna do nome: com muitas editoras/autores torna-se lento. Com collation `_ci` basta `coluna = ?`.
- [ ] SeedLibraryBooks.js: o ficheiro de lock (`.seed-books.lock`) só protege um único servidor; com vários processos/instâncias depende da UNIQUE KEY (external_id, institute_code) — confirmar que existe (add_external_id_column.sql).
- [ ] SeedLibraryBooks.js: `console.table` dos livros registados/ignorados/falhados e o relatório JSON em `__dirname` crescem a cada execução; limpar relatórios antigos.
- [ ] SendEmail.js: GetAllSentEmailsByUser filtra por `ed_sent_email_to` e ordena por `ed_sent_email_date`, colunas que não aparecem em mais nenhum ponto do ficheiro (o INSERT usa title/message/code/institutecode e a lista usa `ed_sent_email_sentdate` + tabela de contactos). Confirmar com SHOW COLUMNS: se não existirem, esta rota falha sempre.
- [ ] ⚠ SendEmailMessage.js: `Header` e `Message` entram no HTML do email sem sanitizar e `Email` sem validar: se a rota não exigir sessão/perfil, qualquer pessoa pode enviar emails com o domínio da Eduall (phishing/relay). Exigir autenticação, validar o formato do email e limitar a taxa de pedidos.
- [ ] SendEmailMessage.js: o HTML tem marcação partida: `<a/>` (devia ser `</a>`) depois do logótipo e `<div>${Message}<div>` (o 2.º `<div>` devia fechar `</div>`); alguns clientes de email desformatam a mensagem.
- [ ] SendEmailMessage.js: o `catch` devolve o objeto de erro inteiro (`res.status(400).json(error)`), incluindo detalhes do SMTP; devolver `{ success:false, msg }` genérico com 500.
- [ ] SendEmailMessage.js: `from` usa `process.env.MAIL_APP_USER` enquanto SendEmail.js usa `noreply@eduall.site`: unificar o remetente. URLs (eduall.vercel.app, eduall@gmail.com) e ícones do Google Drive (`drive-viewer`, podem expirar/ser bloqueados) estão escritos no código: servir os ícones do próprio domínio.
- [ ] SendEmailMessage.js: importa DB_SQLITE, DATABASE, GetCurrentUserData e CheckInternet sem os usar (carregam a configuração da base de dados para nada); remover.
- [ ] 🔥 URGENTE SendSms.js: a chave da API da Telcosms (`api_key_app`) está escrita no código, em SendSms e em ResendSms. Rodar a chave no painel do fornecedor e ler de process.env (TELCOSMS_API_KEY); continua no histórico do Git: a rotação é obrigatória.
- [ ] ⚠ SendSms.js: o número é validado depois de retirar espaços (`numeroFormatado`), mas o pedido à API envia `phone` ORIGINAL (com espaços). Enviar `numeroFormatado`. ResendSms não valida o número de todo.
- [ ] ⚠ SendSms.js: ResendSms faz `creditRows[0].ed_sms_credit_total` — se a escola não tiver linha de créditos (array vazio) dá TypeError e responde 500. Validar `creditRows.length` (como SendSms faz).
- [ ] ⚠ SendSms.js: verificar créditos (SELECT), enviar e só depois descontar (UPDATE com `AND total >= ?`) não é atómico: dois envios simultâneos podem passar a verificação e o 2.º desconto afetar 0 linhas (mensagem enviada e não cobrada, sem erro). Reservar primeiro com UPDATE atómico, conferir `affectedRows` e devolver os créditos se o envio falhar.
- [ ] SendSms.js: cada falha (créditos insuficientes, número inválido, API em baixo) insere um registo novo com estado 1, e a falha de ResendSms cria um SEGUNDO registo em vez de manter o original: a tabela enche-se de duplicados.
- [ ] SendSms.js: `calculateSmsParts` está copiada 4 vezes; mover para um helper. Usa 160/70 caracteres por parte — mensagens concatenadas têm 153/67 por segmento (conta a menos) e qualquer acento (ã, ç) faz a mensagem contar como Unicode (limite 70). Confirmar como o fornecedor cobra.
- [ ] SendSms.js GetAllSentSmS: `SELECT *` com JOIN a eduall_contacts (colunas com o mesmo nome sobrepõem-se) e `ORDER BY ... ASC` sem LIMIT: cresce sem limite. Paginar/limitar por data e devolver os mais recentes primeiro.
- [ ] SendSms.js: `console.log` da resposta da API e dos números em cada envio; proteger com variável de ambiente.
- [ ] 🔥 ServicePayments.js: RegisterServicePayment faz `ExecuteQuery(null, "START TRANSACTION")` … `COMMIT/ROLLBACK`. Com um pool de ligações cada `ExecuteQuery` pode usar uma ligação diferente, pelo que a transação NÃO envolve as escritas (o ROLLBACK não desfaz nada). Obter uma ligação dedicada (`pool.getConnection()`) e fazer todas as queries dessa função nela.
- [ ] ⚠ ServicePayments.js: FetchServicePayments filtra com `COALESCE(sp.ed_service_payment_deleted, 0) = 0`, que impede o uso de índice na coluna. Se a coluna for `NOT NULL DEFAULT 0` usar `= 0` simples; caso contrário, `(col = 0 OR col IS NULL)`.
- [ ] ServicePayments.js: a função RegisterServicePayment tem ~1400 linhas (696→2075) com 5 ciclos que fazem consultas dentro (linhas ~839, 975, 1225, 1463, 1699, 1890: N+1 por serviço/mês). Dividir em funções e trocar as consultas dos ciclos por `IN (...)`/JOIN — é aqui que está o maior ganho de tempo do ficheiro.
- [ ] ServicePayments.js: ~85 `console.log` (incluindo dados de alunos e valores) em pedidos de pagamento; os logs síncronos custam tempo e expõem dados pessoais. Proteger com `DEBUG_PAYMENTS=1`.
- [ ] ServicePayments.js: `getOperatorData` (SELECT a eduall_user_accounts) é chamada por pedido só para obter o nome do operador; pode vir da sessão ou de cache por utilizador (sem a palavra-passe).
- [ ] ServicePayments.js: o ficheiro usa fim de linha CRLF (o script preserva); Se um dia se cachear GetServicePayments, só com TTL de 30–60 s e invalidando em Register/Update/Delete/DeleteServiceWithFees.
- [ ] Services.js: as chaves antigas (`services:list:<escola>:<user>` …) ficam órfãs até expirarem (3600 s); deixam de ser lidas. Sem impacto funcional.
- [ ] Services.js: o TTL é de 1 h e a lista inclui `eduall_coins` e `eduall_providers` (JOIN). Se a moeda da escola ou um fornecedor forem editados noutro controller, a lista só mostra o novo valor depois do TTL: invalidar `services:<escola>:*` nesses controllers (ou baixar o TTL para 300 s).
- [ ] Services.js: ServicePayments.js (pagamentos/matrículas) lê eduall_services por JOIN diretamente (não passa por esta cache): sem impacto, mas se um dia for cacheado invalidar `services:<escola>:*`.
- [ ] Services.js: o LEFT JOIN `eduall_coins ON ed_coin_institute_code = ?` não tem relação com o serviço; se a escola tiver mais de uma moeda, cada serviço aparece duplicado por moeda.
- [ ] Services.js: `console.log("DADOS = ", PARAMS)` em RegisterService e logs de `rows[0]` em GetSingleService escrevem dados para os logs em cada pedido; proteger com variável de ambiente.
- [ ] Services.js: GetSingleService guarda em cache também a resposta vazia (`[]`), por isso um ID inexistente fica 1 h como «não encontrado» mesmo que seja criado entretanto — só afeta IDs criados por outro caminho; as escritas deste ficheiro limpam tudo.
- [ ] Shelves.js: BookcaseDelete e ReorderBookcases fazem várias escritas em sequência sem transação (Reorder = 1 UPDATE por estante num ciclo; Delete = solta as prateleiras e depois apaga a estante). Um único UPDATE com `CASE WHEN` ou uma transação evita estados a meio.
- [ ] Shelves.js: GetBookcases/GetSingleBookcase não passam `data: req` ao ExecuteQuery (as restantes funções passam); confirmar se isso afeta o registo/auditoria de queries.
- [ ] Shelves.js: a lista de estantes só é escrita neste controller. Se Racks.js (sem cache desde o v6) ou outro controller devolver nome/cor da estante num JOIN, mostra sempre o valor atual; se alguma vez for cacheado, invalidar também `bookcases:<escola>:*` aí.
- [ ] Shelves.js: RegisterBookcase calcula `maxOrder + 1` com SELECT + INSERT (não atómico): dois registos simultâneos podem receber a mesma ordem.
- [ ] 🔥 StudenBalanceController.js: DepositStudentBalance e DeductStudentBalance fazem ler saldo → calcular → UPDATE do saldo → INSERT do movimento SEM transação nem bloqueio: dois descontos simultâneos leem o mesmo saldo e ambos passam (saldo negativo/duplo gasto). Usar transação com `SELECT ... FOR UPDATE`, ou `UPDATE ... SET sb_balance = sb_balance - ? WHERE ... AND sb_balance >= ?` e conferir `affectedRows`.
- [ ] ⚠ StudenBalanceController.js: `ensureBalanceRow` depende de `ON DUPLICATE KEY UPDATE`; se a tabela eduall_student_balance não tiver UNIQUE (sb_student_id, sb_institute_code) cria linhas duplicadas por aluno (ver cache_indexes_v7.sql — verificar com SHOW INDEX).
- [ ] StudenBalanceController.js: o saldo fica guardado em duas formas (coluna `sb_balance` e soma dos movimentos em `recalculateBalance`); se uma escrita falhar entre as duas, divergem. A transação acima resolve isto.
- [ ] StudenBalanceController.js: Update/DeleteBalanceLog alteram movimentos antigos e recalculam; confirmar que o histórico de auditoria guarda o valor anterior.
- [ ] 🔥 StudentAttendance.js: GetStudentAttendanceByTeacherAndClassSub, GetSingleStudentAttendance, CheckExistentSingleStudentAttendance, GetStudentAttendanceByClassSubStuQrt, GetAllStudentAttendance, UpdateExistentSingleStudentAttendance, StudentAttendanceUpdate e StudentAttendanceDelete NÃO filtram por escola (`ed_student_attd_institute_code`): quem conhecer/adivinhar IDs lê, edita ou apaga presenças de outras escolas. Acrescentar o filtro com a escola da sessão em todas.
- [ ] StudentAttendance.js: GetStudentAttendance e GetStudentAttendanceByTeacher executam EXATAMENTE a mesma consulta (todas as presenças da escola) — a «ByTeacher» não filtra por professor. Devolver só o necessário (por turma/data) ou paginar.
- [ ] StudentAttendance.js: StudentAttendanceUpdate regista na auditoria `req.body.student_attendance_code`, que o UPDATE nem usa (pode vir `undefined` → «#undefined»). Ler o código da linha atualizada.
- [ ] StudentAttendance.js: RegisterStudentAttendance não verifica duplicados (mesmo aluno, turma, horário, disciplina e data): duplo clique = duas presenças. Um índice único parcial (ou verificação prévia) evita-o.
- [ ] StudentAttendance.js: `console.log(rows)` em GetAllStudentAttendance escreve todas as presenças do aluno nos logs; importa CheckQuarterlyNotePermission sem usar; os `catch` devolvem `error.message` ao cliente.
- [ ] StudentAttendance.js: se um dia se cachear, só com TTL curto (30–60 s) e invalidando em Register/Update/Delete aqui e em qualquer outro controller que escreva em eduall_student_attendence.
- [ ] 🔥 StudentBehavior.js: GetSingleStudentBehavior, StudentBehaviorDelete e StudentBehaviorUpdate filtram por `ed_academic_year_id = ?` numa tabela de COMPORTAMENTOS (copiado do controller de anos letivos). Se a coluna não existir dá «Unknown column» (editar/eliminar/ver um comportamento falha sempre); se existir, o ID recebido é o do ano letivo e a escrita atinge TODOS os comportamentos desse ano. Trocar por `ed_student_behavior_id = ?` (confirmar o nome da chave primária com SHOW COLUMNS).
- [ ] 🔥 StudentBehavior.js GetAllStudentBehaviorByStudentCode: `SELECT *` com LEFT JOIN a `eduall_user_accounts` devolve ao cliente TODAS as colunas da conta do utilizador (provavelmente incluindo o hash da palavra-passe e tokens). Listar só nome/foto. Enquanto assim estiver, NÃO cachear esta função (o hash iria para o Redis).
- [ ] StudentBehavior.js: depois de corrigir o SELECT, cachear GetAllStudentBehaviorByStudentCode com `K("studentBehavior", "byStudent:${req.params.ID}")` e TTL 120 s (a invalidação já está feita).
- [ ] StudentBehavior.js: os `catch` devolvem `error.message` ao cliente e mistura `message`/`msg` nas respostas (o frontend lê `msg` nas restantes rotas).
- [ ] StudentBehavior.js: a lista geral guarda o nome do funcionário só pelo código; se mostrar o nome por JOIN noutro sítio, o nome só atualiza depois do TTL.
- [ ] StudentEnrollment.js: RegisterStudentEnrollment tem ~360 linhas numa única função (linhas 40→405) com `printEnrollmentCard` para logs coloridos; os logs síncronos em cada matrícula custam tempo — protegê-los com variável de ambiente.
- [ ] StudentEnrollment.js: StudentEnrollmentUpdate lê `enrollment_class` do body mas só atualiza o serviço (a turma nunca muda); confirmar se é intencional.
- [ ] StudentEnrollment.js: as 3 listas fazem `SELECT *` sem LIMIT; GetStudentEnrollments devolve TODAS as matrículas da escola — paginar ou filtrar por ano letivo.
- [ ] StudentEnrollment.js: os `catch` devolvem `error.message` ao cliente (SQL/colunas); o ficheiro usa fim de linha CRLF (o script preserva).
- [ ] 🔥 StudentEnrollmentConfirmation.js: no ramo OFFLINE, StudentEnrollmentConfirmationUpdate (e Delete) executam `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1` — atualizar uma confirmação de matrícula elimina (soft-delete) um NÍVEL ACADÉMICO. O Register offline insere em eduall_academic_level, o Get offline lê da mesma tabela: é cópia do controller de níveis.
- [ ] ⚠ StudentEnrollmentConfirmation.js: o ramo online usa `StudentEnrollmentConfirmationModel`, que NÃO é importado: dá ReferenceError em todas as funções (a resposta fica com `res.json(error)`). Além disso, as queries do modelo não filtram por escola (leitura/alteração entre escolas).
- [ ] StudentEnrollmentConfirmation.js: confirmar se este ficheiro está nas rotas. Se não estiver, apagar; se estiver, migrar para ExecuteQuery como StudentEnrollment.js (com filtro por escola) — só então faz sentido cache/índices. `DATABASERUN` está definido e nunca é usado.
- [ ] StudentExams.js: BulkUpsertStudentExamNotes (linha ~325) e BulkUpsertStudentFeaturedNotes (~584) fazem SELECT + UPDATE/INSERT por cada nota dentro de um ciclo (N+1, até 3 consultas por aluno). Um `INSERT ... ON DUPLICATE KEY UPDATE` (com índice único) ou um SELECT `IN (...)` + INSERT em lote resolve com 2 consultas.
- [ ] ⚠ StudentExams.js: RegisterStudentFeaturedNotes / UpdateStudentFeaturedNotes / DeleteStudentFeaturedNotes existem TAMBÉM em StudentFeaturedNotes.js (mesmos nomes, lógica ligeiramente diferente), e os bulk upserts existem TAMBÉM em StudentExamsAndFeaturesNotes.js. Confirmar qual está nas rotas e eliminar as cópias: as regras (permissões, duplicados, `deleted`) já divergem.
- [ ] StudentExams.js: 7 JOIN a eduall_academic_level + 5 SELECT a eduall_class repetem a mesma pergunta «esta turma permite exame/recurso?». Extrair para um helper com cache curto por (escola, turma) é a otimização certa aqui.
- [ ] StudentExams.js: nenhuma transação nos bulk upserts: uma falha a meio deixa metade das notas gravadas.
- [ ] ⚠ StudentExamsAndFeaturesNotes.js: BulkUpsertStudentExamNote usa as colunas `ed_student_exam_studentCode / _class / _subject / _score / _id / _deleted` em eduall_student_exam_notes, enquanto StudentExams.js usa `ed_student_exam_note_*` na MESMA tabela. Uma das duas versões está errada (a desta parece copiada da tabela do calendário, `eduall_student_exams`). Confirmar com SHOW COLUMNS FROM eduall_student_exam_notes: se esta versão estiver em uso, dá «Unknown column».
- [ ] StudentExamsAndFeaturesNotes.js: BulkUpsertStudentExamNote (ciclo ~95) e BulkUpsertStudentFeaturedNote (~302) são N+1 (SELECT + UPDATE/INSERT por item); ver sugestão em StudentExams.js. GetAllNotesByClassSubject (~180 linhas) é a candidata a cache, só com TTL curto e invalidação em todas as escritas de notas.
- [ ] StudentExamsAndFeaturesNotes.js: duplicado de funções de StudentExams.js (ver TODO desse ficheiro).
- [ ] ⚠ StudentExamsCalendar.js: GetExamsCalendarByClass, GetSingleExamCalendar, UpdateStudentExamCalendar e DeleteStudentExamCalendar NÃO filtram por escola (`WHERE ... class = ?` / `exam_id = ?`): quem adivinhar um ID lê, edita ou apaga provas de outra escola. Acrescentar `AND ed_student_exam_institute_code = ?` com a escola da sessão. Por esse motivo estas funções não foram cacheadas.
- [ ] StudentExamsCalendar.js: `ADD COLUMN IF NOT EXISTS` (comentário de migração no topo) só existe em MariaDB; em MySQL a migração falha — usar o script com verificação em information_schema ou executar uma coluna de cada vez.
- [ ] StudentExamsCalendar.js GetCalendarBlocks: `FIELD(ed_exam_period, 'Manhã', 'Manhã/Tarde', 'Tarde', NULL)` — `NULL` na lista não tem efeito e as provas SEM turno (FIELD = 0) ficam PRIMEIRO, ao contrário do pretendido. Usar `ORDER BY ed_exam_period IS NULL, FIELD(ed_exam_period, 'Manhã', 'Manhã/Tarde', 'Tarde')`.
- [ ] StudentExamsCalendar.js: os nomes da turma/disciplina/horário vêm de JOIN; se forem editados noutro controller, a lista pode mostrar o valor antigo até 2 min.
- [ ] StudentExamsCalendar.js: todos os `catch` devolvem `error.message` (SQL/colunas) ao cliente; devolver mensagem genérica e registar no servidor.
- [ ] StudentExamsCalendar.js: a tabela `eduall_student_exams` (calendário) é distinta de `eduall_student_exam_notes` (notas, StudentExams.js): a invalidação é exata, só este controller escreve no calendário.
- [ ] ⚠ StudentFeaturedNotes.js: a verificação de duplicado em RegisterStudentFeaturedNotes não tem `ed_student_featured_note_deleted = 0`: uma nota de recurso ELIMINADA (soft-delete) bloqueia para sempre um novo registo com 409. Acrescentar o filtro.
- [ ] ⚠ StudentFeaturedNotes.js: UpdateStudentFeaturedNotes e DeleteStudentFeaturedNotes filtram só por `note_id` (sem escola): quem adivinhar o ID altera/apaga notas de outra escola. Update também permite mudar aluno/turma/disciplina para uma combinação que já existe (sem verificar duplicados).
- [ ] StudentFeaturedNotes.js: Register e Update repetem as mesmas 2 consultas (turma → nível académico → `forFt`); um único SELECT com JOIN poupa uma ida à base de dados.
- [ ] StudentFeaturedNotes.js: a função com o mesmo nome também existe em StudentExams.js (ver TODO desse ficheiro).
- [ ] StudentFeaturedNotes.js: GetsingleStudentFeaturedNotebYSubStCls faz `SELECT *` com 2 JOINs (colunas com o mesmo nome, ex. institute_code/deleted, sobrepõem-se).
- [ ] ⚠ StudentGradeHistory.js: `uid = req.session.user.eduall_user_session_id` (minúsculas), enquanto o resto do sistema usa `eduall_user_session_ID`. Se a chave não existir na sessão, o utilizador da auditoria/registos fica `undefined`. Confirmar.
- [ ] StudentGradeHistory.js: CreateGradeHistory/UpdateGradeHistory/DeleteGradeHistory fazem várias escritas em sequência (cabeçalho + grupos + disciplinas) sem transação: uma falha a meio deixa um histórico meio gravado. _upsertRecords faz 1 INSERT por disciplina num ciclo; um INSERT com várias linhas é muito mais rápido.
- [ ] StudentGradeHistory.js: o histórico tem `UNIQUE KEY uq_student (ed_gh_student_id, ed_gh_institute_code)` e a eliminação é lógica (`ed_gh_deleted = 1`): depois de eliminar, CreateGradeHistory (que só procura `deleted = 0`) tenta INSERT e bate na chave única (ER_DUP_ENTRY → 500). Reativar a linha eliminada em vez de inserir, ou incluir `ed_gh_deleted` na chave.
- [ ] StudentGradeHistory.js: `console.log("hellow !!")` esquecido no início de CreateGradeHistory; `SELECT *` nas leituras de grupos e disciplinas.
- [ ] StudentGradeHistory.js: se um dia se cachear GetGradeHistory, usar `gradeHistory:<escola>:<aluno>` e invalidar essa chave em Create/Update/Delete (todas neste ficheiro).
- [ ] Requer Functions/CacheRoutes.js com eduallGet (null se não existe), eduallSet(chave, valor, ttl) e eduallClear(padrão com `*` no fim) — exatamente como o v6 já usa.
- [ ] Se existirem outros controllers que escrevem nas mesmas tabelas (cursos/slides/posts do site, estantes, calendário de provas, comportamentos, serviços), a cache só se atualiza ao fim do TTL; para ser imediata, acrescentar neles `Cache.eduallClear(...)` com o padrão da entidade (`site:<escola>:*`, `bookcases:<escola>:*`, `examsCalendar:<escola>:*`, `studentBehavior:<escola>:*`, `services:<escola>:*`).
- [ ] 🔥 Segredos no código (rodar e mover para variáveis de ambiente): SendSms.js (chave da Telcosms). Os do v6 continuam por tratar: Referralcontroller.js (Cloudinary), Replacetenant.js (palavra-passe da BD), SendEmail.js (textflow/RapidAPI). Mesmo depois de removidos do ficheiro, continuam no histórico do Git: rodar as chaves é obrigatório.

## 4. Riscos conhecidos

- Cada escrita invalida a família inteira da escola (simples e seguro, mas apaga também entradas que não mudaram).
- Dados que mudam noutros controllers (turmas, disciplinas, horários, funcionários, moeda/fornecedores) só aparecem nas listas cacheadas depois do TTL.
- Notas, presenças, matrículas, saldos, pagamentos, SMS e emails NÃO foram cacheados de propósito (dados que têm de aparecer de imediato e que mudam por vários caminhos).
- listPosts (SiteManager) guarda em cache o HTML completo de todos os posts da escola: vigiar a memória do Redis/processo.
- Services.js: as chaves antigas ficam órfãs até expirarem (3600 s); a primeira leitura depois de aplicar vai à base de dados.
- A invalidação corre imediatamente antes da resposta, DEPOIS da auditoria: se RegisterAuditAction lançar um erro, a escrita já está feita mas a cache só expira ao fim do TTL.
- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.

## 5. Como validar

1. Reiniciar a aplicação e abrir duas vezes uma lista (ex.: estantes): o 2.º pedido não deve gerar consulta SQL.
2. Criar/editar/apagar uma estante, um serviço, uma prova ou um slide e confirmar que a lista mostra logo a alteração.
3. Serviços: editar um serviço com o utilizador A e abrir a lista com o utilizador B da mesma escola: B tem de ver a alteração de imediato (antes só ao fim de 1 h).
4. Editar a ficha de um serviço e reabrir a ficha individual (GetSingleService): deve mostrar os dados novos.
5. Correr a importação de livros e confirmar que as editoras novas aparecem logo na lista de editoras.

## 6. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v7/` de volta (mesma estrutura).

