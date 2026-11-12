# Performance — alterações preparadas localmente

> Estado: **nada foi publicado em produção**. Os únicos cambios já aplicados na
> BD de produção foram os 20 índices aditivos (`migrations/051_performance_indexes.sql`),
> aprovados anteriormente. Não houve alteração de dados nem deploy de código.

## 1. O que está preparado

### Base de dados
- `migrations/051_performance_indexes.sql` — 20 índices aditivos.
- `migrations/051_performance_indexes.down.sql` — reversão apenas dos índices.
- Já aplicados em produção: índices + `ANALYZE TABLE`.

### Servidor (Node)
- `config/DatabaseCredentials.js` — usa socket local do MySQL ou `127.0.0.1`
  (evita ~174 ms por query quando Node e MySQL estão no mesmo servidor).
  Override: `MYSQL_HOST=...`.
- `config/Database.js` — pool 10, `keepAlive`, `idleTimeout` 30 s, reconexão
  que fecha o pool antigo.
- `app.js` — pool de sessão 10; `saveUninitialized:false`; `disableTouch:true`;
  estáticos antes da sessão.
- `Functions/ExecuteQuery.js` — sem `console.log` por query; log opcional de
  queries lentas (`SLOW_QUERY_MS`).
- `Controllers/Auditory.js` — Gemini fora do caminho crítico (`AUDIT_AI=false`)
  e `ensureSchema` uma vez por processo.
- `Functions/CacheRoutes.js` — cache inicializa automaticamente (antes nunca
  era chamada); `CACHE_ENABLED=false` desliga; `CACHE_MAX_MB` limita o disco.
- `Controllers/Students.js` — cache por escola; `FORCE INDEX` com fallback;
  endpoints leves.

### Endpoints novos (só locais, ainda não publicados)
- `GET /eduallstudentsapi/get-lite` — lista com 19 campos (≈1,4 MB → ≈131 KB gzip).
- `GET /eduallstudentsapi/class-gender` — só turma/género (≈125 KB → ≈2 KB gzip).

### Frontend
- `scripts/patch-students-lite.js` — liga lista/tabela/seletor/presenças/notas/
  impressão ao `get-lite` e os gráficos ao `class-gender`.
- O bundle local (`static/js/main.5d21f856.js`) foi patcheado.
- **Atenção:** o bundle em produção é outro (`main.cc14106b.js`). O patch tem de
  ser aplicado ao build publicado ou, preferencialmente, ao código-fonte React.

## 2. Deploy seguro (quando decidirem)

1. **Backup** da BD e do `.env`.
2. Copiar os ficheiros alterados para o servidor (sem alterar o `.env` de produção):
   - `app.js`
   - `config/Database.js`
   - `config/DatabaseCredentials.js`
   - `Functions/ExecuteQuery.js`
   - `Functions/CacheRoutes.js`
   - `Controllers/Auditory.js`
   - `Controllers/Students.js`
   - `Controllers/TransportPayments.js`
   - `Controllers/Admission.js`
   - `Controllers/NotifyController.js`
   - `routes/index.js`
3. Reiniciar o Node (Passenger/cPanel).
4. Confirmar nos logs:
   - `[DB] a ligar a socket /var/lib/mysql/mysql.sock` (ou `127.0.0.1`)
   - `[CACHE:...] ✅ Self-test PASSOU`
   - `/health` com `bootErrors: 0`
5. Testar: login → trocar escola → lista de alunos → gravar presença/nota/pagamento.

### Frontend
- No código-fonte React, trocar nas páginas de lista/tabela/seletor/presenças/
  notas/impressão:
  - `eduallstudentsapi/get/` → `eduallstudentsapi/get-lite/`
- Nos gráficos do dashboard:
  - `eduallstudentsapi/get` → `eduallstudentsapi/class-gender`
- Rebuild e deploy do frontend.
- Alternativa imediata: aplicar as mesmas substituições no bundle publicado
  (equivalente ao que `scripts/patch-students-lite.js` faz no bundle local).

## 3. Reversão

| Problema | Ação |
|---|---|
| Não liga à BD no servidor | `MYSQL_HOST=127.0.0.1` ou `MYSQL_HOST=cpanel154.dnscpanel.com` |
| Dados desatualizados na cache | `CACHE_ENABLED=false` + reiniciar |
| Problema no índice forçado | `STUDENTS_FORCE_INDEX=false` + reiniciar |
| Reverter índices | `migrations/051_performance_indexes.down.sql` |

## 4. Baseline medido em produção (apenas leitura)

| Teste | Resultado |
|---|---|
| `GET /health` (um `SELECT 1`) | 0,58 s |
| `GET /testdb` | 0,56 s |
| Lista de alunos (conta testada) | 2,88 s / 800 KB / 174 colunas / 110 alunos |

Isto confirma: a latência da BD e o payload grande são os dois gargalos.
O `get-lite` reduz a lista para ~131 KB gzip; o dashboard para ~2 KB gzip.

## 5. Dashboard — frescura dos dados

O dashboard escolar chamava `eduallstudentsapi/get` (lista completa) e só
carregava **uma vez ao montar**. A lista estava em cache 1 h e as escritas de
turmas/matrículas/confirmações não a invalidavam.

Correções locais:
- `Functions/StudentCache.js` — invalidação única das caches de alunos.
- Chamada após escritas de: alunos, turmas (`Class.js`), matrículas
  (`Enrollments.js`), confirmações (`EnrollmentConfirmation.js`), matrícula
  configurável (`GetStudentsFullOverview.js`), matrícula de aluno
  (`StudentEnrollment.js`) e restauro (`Recicle.js`).
- `students:list`/`list-lite` → TTL **300 s** (rede de segurança).
- `students:class-gender` (dashboard) → TTL **60 s**.
- `class-gender` devolve agora os 7 campos que o dashboard usa:
  `ed_student_id`, `ed_student_class`, `ed_student_gender`,
  `ed_student_dropout`, `ed_student_scholarshipHolder`,
  `ed_student_status`, `ed_student_rfid_code` — payload de poucos KB.
- Corrigido o `POST /eduallenrollmentreport/get` (devolvia **500** em
  produção): tabela `eduall_enrollment_confirmations` (plural), colunas de
  data reais (`..._registerDate` / `..._registerdate`), filtros por escola,
  joins de turma/curso/classe e ordem correta de `ExecuteQuery`.
  Distribuição por turma passa a usar a turma atual do aluno quando a
  matrícula não tem turma.

### Frontend (fonte React)
Trocar o fetch do dashboard para `eduallstudentsapi/class-gender` e refrescar
periodicamente/ao voltar ao separador:

```js
useEffect(() => {
  let cancelled = false;
  const load = () => { if (!cancelled) Ne(); };
  load();
  const id = setInterval(load, 60_000);          // 60 s
  const onFocus = () => load();
  const onVisible = () => { if (!document.hidden) load(); };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    cancelled = true;
    clearInterval(id);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
}, [Ne]);
```

Depois de gravar (aluno, matrícula, confirmação), o ideal é chamar o mesmo
`load()` ou emitir um evento global para o dashboard refrescar.

## 6. Próximos ganhos (preparados, não aplicados)

- `migrations/052_students_details_index.sql` — índice em
  `eduall_students_details(ed_detail_student_code, ed_detail_deleted)`.
  Corrige o JOIN que fazia full scan por aluno em escolas não-normais.
  **Não aplicado em produção.**
- `MYSQL_SOCKET` — permite indicar o caminho exacto do socket do cPanel
  (ex.: `/var/lib/mysql/mysql.sock`). Se não for acessível, cai para
  `127.0.0.1` e depois para o host público.
- `LOG_HTTP=tiny` (default) — log HTTP mais leve. `LOG_HTTP=dev` para o
  formato verboso.
- Frontend: o maior ganho restante é **code splitting/lazy loading** e
  **Brotli**. O bundle de produção tem ~21,6 MB (5,5 MB gzip). Ver
  `FRONTEND_PERFORMANCE_REPORT.md` e `deploy/`.
- `eduall_students_details` é o próximo índice a aplicar; os restantes
  endpoints já ficaram pequenos com gzip.

## 7. O que NÃO fazer

- Não ativar cluster/mais processos Node antes de a BD estar local (cada
  processo abre 10 ligações; o limite do utilizador é 90).
- Não montar `middleware/performanceMonitor.js` como está (cria um
  `setInterval` por pedido).
- Não remover `CACHE_ENABLED` nem o fallback do índice sem testar.
- Não versionar `cache/cache.db*` (runtime). Sugestão: `git rm --cached` e
  adicionar ao `.gitignore`.
