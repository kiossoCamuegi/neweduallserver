# CACHE_REPORT_V5 — CACHE-OPT v5

Gerado por `apply_cache_optimizations.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `NotesRestrictions.js` | alterado | CreateQuarterlyNoteRestrictionsTable (CREATE TABLE + consulta information_schema + ALTER) passa a correr uma só vez por processo (antes: em todas as funções, incluindo as 4 Check*Permission chamadas a cada lançamento de nota/presença); GetCurrentEmployeeId (conta de sistema -> funcionário) cacheado 300s por utilizador e escola |
| `NotifyController.js` | alterado | ensureSchema (consulta information_schema + CREATE TABLE) passa a correr uma só vez por processo — antes corria em CADA chamada a RegisterAuditAction deste ficheiro; lista de destinatários da escola (120s) e dados do autor (300s) em cache; o botão de preferências limpa `notify:*`; interruptor `NOTIFY_USE_AI=0`: salta a chamada ao Gemini (usa já o texto de fallback). Por defeito nada muda |
| `OldPayments.js` | alterado | cache (300s) em GetOldPayments e GetSingleOldPayment; Register/Update/Delete invalidam `oldPayments:<escola>:*` (histórico de pagamentos: só este controller escreve, por isso a invalidação é exata) |
| `Parents.js` | alterado | cache em Getparents / GetSingleparent (600s) e GetParentKids / GetKidsParents (120s, fazem JOIN a alunos); todas as escritas deste ficheiro invalidam `parents:<escola>:*` (ParentUpdate nos dois ramos, com e sem foto) |
| `ParentsChilds.js` | alterado | cache em ChewckSingleUserChilds / GetUserChilds / GetParentsUserChildsByInstitute (300s) e GetSingleUserChilds (120s, usado ao abrir a app do encarregado; a validade da licença é verificada com NOW() no SQL, por isso o TTL é curto); RegisterUserChilds e UserChildDelete limpam `parentChilds:*` (global, porque estas escritas não estão ligadas a uma escola) |
| `ParentsPickup.js` | alterado | 3 blocos DDL (ALTER TABLE + information_schema) passam a correr uma só vez por processo (GetFrequenciaHistorico, RegistrarFrequencia e RegisterResponsavelPortaria corriam-nos em cada pedido); cache (120s) em GetAllResponsaveisByStudent (família `parents:<escola>:*`, partilhada com Parents.js); RegisterResponsavelPortaria invalida `parents:<escola>:*` |
| `PedagogicalEvaluationControllers.js` | alterado | chaves de cache passam a `pedagogicalEvaluation:<escola>:...` e a invalidação a `pedagogicalEvaluation:<escola>:*` (antes: cada Register/Update/Delete limpava `pedagogicalEvaluation:*` de TODAS as escolas) |
| `PrincipalPortal.js` | alterado | ensurePrincipalPortalSchema (7x CREATE TABLE IF NOT EXISTS) passa a correr uma só vez por processo — antes corria em 18 funções, em cada pedido; GetApprovalRules: os 7 INSERT IGNORE das regras por omissão passam a correr uma vez por escola e processo (antes: em cada GET); RequirePrincipalPortalAccess: resultado positivo cacheado 60 s (era uma consulta a eduall_system_accounts em CADA pedido do portal); cache em GetGoals / GetAnnouncements / GetAgenda / GetPreferences / GetApprovalRules (300s) e GetApprovals / GetInsights / GetSignableDocuments (60s); todas as escritas do portal invalidam `principalPortal:<escola>:*` |
| `ProductCategory.js` | alterado | cache (600s) em GetProductCategories e GetSingleProductCategory; escritas invalidam categorias e produtos (a lista de produtos mostra o nome da categoria) |
| `ProductSalles.js` | alterado | RegisterSale invalida `products:<escola>:*` a cada baixa de stock (evita mostrar stock antigo na lista de produtos em cache). As listas de vendas não são cacheadas (dados financeiros, mudam a cada venda). |
| `Products.js` | alterado | cache (300s) em GetProducts (4 tabelas com JOIN) e GetSingleProduct; Register/Update/Delete invalidam `products:<escola>:*` |
| `Provider.js` | alterado | cache (600s) em GetProviders e GetSingleProvider; Register/Update/Delete invalidam `providers:<escola>:*` e `products:<escola>:*` (a lista de produtos mostra o nome do fornecedor) |
| `Pages.js` | ignorado | legado (DATABASERUN, responde dentro do callback): conteúdo de páginas editado noutro sítio e sem como invalidar; só índice (ver TODOs) |
| `Posts.js` | ignorado | legado e com erros (ver TODOs): cachear aqui esconderia os problemas; só índices |
| `ProfilePageViews.js` | ignorado | só escreve (1 INSERT por visita): nada para cachear; só índice |

## 2. Chaves de cache criadas

| Família | Chaves | TTL |
|---|---|---|
| `providers:<escola>:` | list, single:<id> | 600 s |
| `productCategories:<escola>:` | list, single:<id> | 600 s |
| `products:<escola>:` | list, single:<id> | 300 s |
| `oldPayments:<escola>:` | list, single:<id> | 300 s |
| `parents:<escola>:` | list, single:<id> (600 s); kids:<id>, kidsParents:<id>, byStudent:<id> (120 s) | 120–600 s |
| `parentChilds:` | check/user/inst (300 s); me:<userId> (120 s) | 120–300 s |
| `principalPortal:<escola>:` | goals, rules, announcements, agenda, preferences (300 s); approvals, insights, documents, access:<userId> (60 s) | 60–300 s |
| `notify:` | <escola>:recipients (120 s); actor:<userId> (300 s) | 120–300 s |
| `notesRestrictions:<escola>:` | emp:<userId> | 300 s |
| `pedagogicalEvaluation:<escola>:` | list, single, byProfessor, byPeriod, dashboard (já existiam; agora por escola) | 3600 s |

## 3. TODOs manuais

- [ ] NotesRestrictions.js: as permissões em si (restrições por professor) NÃO são cacheadas — decidem se um professor pode lançar notas; só se cacheou a ligação conta->funcionário. Se alguém mudar essa ligação, o efeito pode demorar até 5 min.
- [ ] NotesRestrictions.js: IsPedagogicalDirector faz 2 consultas por chamada (conta->funcionário e instituto->diretor). Não foi cacheado por ser uma verificação de autorização.
- [ ] NotesRestrictions.js: GetQuarterlyNotesPermissions faz `res.status(500).json(error)` (expõe o objeto de erro).
- [ ] ⚠ NotifyController.js: o ficheiro enviado NÃO exporta nada (os `module.exports` do fim estão dentro de um comentário) e os controllers deste lote importam RegisterAuditAction de `./Auditory`. Confirmar se Auditory.js é (ou copia) este código: se for uma cópia, aplicar nela as mesmas alterações (ensureSchema uma vez, cache de destinatários/autor, NOTIFY_USE_AI).
- [ ] ⚠ NotifyController.js: se RegisterAuditAction for `await`ed pelos controllers (como em Provider.js, Products.js…), cada escrita espera: chamada HTTP ao Gemini (timeout 8 s) + 1 INSERT com uma linha por utilizador da escola (body_html repetido em cada linha). Recomendado: NOTIFY_USE_AI=0 já, e a médio prazo gravar a auditoria e responder, deixando a geração do texto e o fan-out das notificações para depois (fila/`setImmediate`), ou guardar 1 linha por evento e calcular a leitura por utilizador.
- [ ] NotifyController.js: a consulta a INFORMATION_SCHEMA.COLUMNS não filtra por TABLE_SCHEMA (pode encontrar a coluna noutra BD e nunca criá-la). Acrescentar `AND TABLE_SCHEMA = DATABASE()`.
- [ ] NotifyController.js: a lista de destinatários pode ficar até 2 min desatualizada (utilizador novo ou preferência alterada diretamente na BD).
- [ ] OldPayments.js: `!isNaN(client)` é falso para string vazia/espaços e verdadeiro para números; um cliente '' faz uma consulta inútil a eduall_students. Validar `String(client).trim() !== ''`.
- [ ] Parents.js: GetParentKids / GetKidsParents usam `SELECT *` com JOIN a eduall_students (nome/turma do aluno). Se o nome do aluno for alterado em Students.js, estas listas podem ficar até 2 min desatualizadas (TTL curto de propósito). Se for visível, invalidar `parents:<escola>:*` nas escritas de alunos.
- [ ] Parents.js: se existirem outros controllers que escrevem em eduall_parents / eduall_parents_kids (além de Parents.js e ParentsPickup.js), acrescentar neles `await Cache.eduallClear(`parents:${instituteCode}:*`)`.
- [ ] ⚠ ParentsChilds.js: GetParentsUserChildsByInstitute faz `SELECT *` com JOIN a eduall_user_accounts: devolve TODAS as colunas da conta (incluindo, muito provavelmente, ed_user_account_password) ao cliente — e, com esta otimização, também as guarda no cache. Selecionar só nome/foto/id do utilizador. Mesmo problema (JOIN a institutos/licenças) em GetSingleUserChilds.
- [ ] ⚠ ParentsChilds.js: RegisterUserChilds, UserChildDelete, ChewckSingleUserChilds e GetUserChilds não filtram por instituto: um administrador de uma escola pode ver/criar/apagar ligações encarregado↔aluno de outra (UserChildDelete filtra só por ID).
- [ ] ParentsChilds.js: alterações a alunos/institutos/licenças/contas noutros controllers só aparecem nestas listas depois do TTL (2–5 min).
- [ ] ParentsPickup.js: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` não existe em MySQL (só MariaDB; o comentário diz MySQL 8). O código tem fallback por information_schema, mas o ideal é um ficheiro SQL de migração e remover o DDL dos pedidos.
- [ ] ParentsPickup.js: o flag é posto mesmo que o ALTER tenha falhado (os erros já eram ignorados antes); reiniciar a aplicação repete a verificação.
- [ ] ⚠ ParentsPickup.js: RegistrarFrequencia / RegistrarResponsavelTemporario usam `req.session.user.eduall_user_id` e `eduall_user_name`, enquanto o resto do sistema usa `eduall_user_session_ID`: se estas chaves não existirem na sessão, registered_by fica vazio/NULL. Confirmar.
- [ ] ParentsPickup.js: SearchStudent usa `LOWER(nome) LIKE '%x%'` (não usa índice; limitado a 20 linhas e a uma escola, aceitável). Frequência da portaria (histórico/geral) não é cacheada: é um registo em tempo real. RegistrarFrequencia (SMS + descontos de crédito) não foi analisado a fundo.
- [ ] PedagogicalEvaluationControllers.js: as chaves antigas (`pedagogicalEvaluation:list:<escola>` …) ficam órfãs no cache até expirarem (TTL 3600 s); deixam de ser lidas. Sem impacto funcional.
- [ ] PedagogicalEvaluationControllers.js: RefreshEvaluationCache refaz a lista completa (JOIN a funcionários) dentro de cada escrita, mesmo que ninguém a peça a seguir. Se as escritas parecerem lentas, trocar por apenas limpar (a lista volta ao cache no próximo GET). Não alterado.
- [ ] ⚠ PrincipalPortal.js: RequirePrincipalPortalAccess só exige uma conta de dashboard ativa — QUALQUER utilizador do dashboard (não só a Direção) pode aprovar/rejeitar pedidos, criar metas/comunicados e assinar documentos. Validar o cargo/perfil da Direção. Com a cache, uma conta desativada mantém acesso até 60 s.
- [ ] ⚠ PrincipalPortal.js SignDocument: o «PIN» é comparado com o hash da PALAVRA-PASSE da conta (bcrypt) e não há limite de tentativas: permite força bruta da palavra-passe. Usar um PIN próprio e limitar tentativas.
- [ ] PrincipalPortal.js: GetDashboardSummary não foi cacheado (a resposta inclui anoLetivo/periodo vindos do query string — chaves arbitrárias); são 4 COUNT por escola, aceleráveis pelos índices. GetAuditLog também não (pesquisa LIKE livre).
- [ ] PrincipalPortal.js: eduall_principal_approvals é preenchida por outros módulos (aqui só é lida/atualizada), por isso GetApprovals/GetInsights usam TTL de 60 s e podem demorar até 1 min a mostrar novos pedidos.
- [ ] ⚠ ProductSalles.js RegisterSale: emite a fatura (Vendus) e insere a venda ANTES de validar o stock; se faltar stock a meio, responde 400 com a fatura já emitida, a venda gravada e parte do stock já descontado (sem transação). Validar todo o stock antes de emitir/gravar, e usar `UPDATE ... SET stock = stock - ? WHERE stock >= ?` para evitar vender a mais em pedidos simultâneos.
- [ ] ProductSalles.js GetProductSales: faz LEFT JOIN a eduall_user_accounts pelo utilizador ATUAL e mostra-o como `operator` em todas as vendas (em vez de ps.ed_product_sale_operator, gravado em cada venda). O LEFT JOIN a eduall_coins por instituto repete linhas (e produtos) se a escola tiver mais de uma moeda.
- [ ] ProductSalles.js: DeleteSale e GetSingleSale filtram só por ID/referência (sem instituto), e DeleteSale não repõe o stock. generateSaleReference (500 caracteres) não é usada.
- [ ] Products.js: GetProducts devolve `SELECT *` de 4 tabelas (colunas com o mesmo nome — *_deleted, institute_code — sobrepõem-se). Listar só as colunas usadas pelo frontend reduz dados e evita ambiguidades (não alterado: muda o resultado).
- [ ] Products.js: a lista de produtos também mostra a moeda (eduall_coins); se as moedas forem editadas noutro controller, a lista pode ficar até 5 min desatualizada. Se for visível, invalidar `products:<escola>:*` no controller das moedas.
- [ ] Products.js: ProductUpdate chama ExecuteQuery com o 4º argumento `true` (flag de SELECT) num UPDATE, e altera ed_product_stock_amount sem atualizar ed_product_stock_left (só preenchido no registo). O nome do ficheiro usa `Math.random(1, 3893…)` (ignora os argumentos).
- [ ] Neste lote não foi preciso Functions/CacheKeys.js. Requer Functions/CacheRoutes.js com eduallGet (null se não existe), eduallSet(chave, valor, ttl) e eduallClear(padrão com `*` no fim) — exatamente como PedagogicalEvaluationControllers.js já usa.
- [ ] Se existirem outros controllers que escrevem nas mesmas tabelas (alunos, moedas, contas de utilizador, declarações), a cache só se atualiza ao fim do TTL; para ser imediata, acrescentar neles `Cache.eduallClear(...)` com o padrão da entidade (`parents:<escola>:*`, `products:<escola>:*`, …).
- [ ] ⚠ Posts.js: RegisterPublication usa a variável `ID` que não existe (ReferenceError; como a função é async e não tem try/catch o pedido fica sem resposta). GetUserPostsByContacts tem `const ID = 25` fixo, ~5 níveis de callbacks com uma consulta por post/comentário/reação/partilha (N+1) e faz `.length` de resultados mesmo quando há erro (rebenta). GetPostsForCurrentUser / GetCurrentUserPosts: sem filtro de escola nem paginação, e `GROUP BY ed_post_registerdate` junta posts diferentes com a mesma data. `require('../routes/Auth')` importa `post` sem uso (risco de dependência circular).
- [ ] Pages.js / Posts.js / ProfilePageViews.js: DATABASERUN responde com status 300 e devolve o objeto de erro SQL ao cliente; GetSingleCpPageByCode ainda faz console.log do código. Migrar para ExecuteQuery como os restantes controllers.

## 4. Riscos conhecidos

- Cada escrita invalida a família inteira da escola (simples e seguro, mas apaga também entradas que não mudaram).
- Dados que mudam noutros controllers (alunos, moedas, contas, declarações) só aparecem nas listas cacheadas depois do TTL.
- O acesso ao portal da Direção fica em cache 60 s: uma conta desativada mantém acesso até 1 minuto.
- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.

## 5. Como validar

1. Reiniciar a aplicação e abrir duas vezes uma lista (ex.: fornecedores): o 2.º pedido não deve gerar consulta SQL.
2. Criar/editar/apagar um registo e confirmar que a lista mostra logo a alteração.
3. Vender um produto e confirmar que o stock na lista de produtos desce de imediato.
4. Fazer uma escrita qualquer (ex.: registar fornecedor) e medir o tempo de resposta: a auditoria já não deve repetir CREATE TABLE/ALTER.

## 6. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v5/` de volta (mesma estrutura).

