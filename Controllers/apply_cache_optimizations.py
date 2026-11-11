#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply_cache_optimizations_v7.py  (CACHE-OPT v7)

Continuação de apply_cache_optimizations_v6.py (v1..v6). Só biblioteca standard do Python 3.
Nunca executa SQL nem instala pacotes.

Lote v7 e o que o script faz em cada ficheiro
---------------------------------------------
CACHE nas leituras + invalidação nas escritas (chaves por escola, falha de cache nunca parte o pedido):
  Shelves.js               estantes (GetBookcases / GetSingleBookcase)
  StudentExamsCalendar.js  calendário de provas (GetExamsCalendar / GetCalendarBlocks)
  StudentBehavior.js       só a lista geral (GetAllStudentBehavior); a lista por aluno faz JOIN a contas (hash da password) e fica de fora
  SiteManager.js           CMS do site da escola (contactos, cursos, slides, secções, branding, posts, definições; templates globais)

CORREÇÕES DE CHAVES / INVALIDAÇÃO CRUZADA:
  Services.js          as chaves tinham o utilizador no fim, mas o padrão de limpeza era `services:<escola>:<user>:*`,
                       que NÃO apanhava `services:list:...` nem `services:single:...` -> as listas ficavam até 1 h desatualizadas
                       (e os outros utilizadores da escola nunca viam a alteração). Passam a `services:<escola>:...`.
  SeedLibraryBooks.js  a importação cria editoras (eduall_library_publishers) e passa a limpar `publishers:<escola>:*` (cache do v6).

SEM ALTERAÇÕES (só TODOs / índices, com a razão em cada caso):
  SendEmail.js (já tratado no v6), SendEmailMessage.js, SendSms.js, StudentAttendance.js,
  StudentEnrollment.js, StudentEnrollmentConfirmation.js, StudentExams.js, StudentExamsAndFeaturesNotes.js,
  StudentFeaturedNotes.js, StudentGradeHistory.js, StudenBalanceController.js, ServicePayments.js

Requer Functions/CacheRoutes.js com eduallGet / eduallSet / eduallClear (já usado em v1..v6).

Uso (na raiz do projeto):
    python3 apply_cache_optimizations_v7.py                 # aplica
    python3 apply_cache_optimizations_v7.py --dry-run       # só mostra diffs
    python3 apply_cache_optimizations_v7.py --only Shelves.js
    python3 apply_cache_optimizations_v7.py --root ./backend --no-backup

Segurança (igual às versões anteriores): backup em .cache_backup/<timestamp>_v7/, idempotente (marcador
"// CACHE-OPT v7"), "tudo ou nada" por ficheiro (se uma âncora falhar o ficheiro não é tocado),
`node --check` com restauro byte a byte. Gera cache_indexes_v7.sql e CACHE_REPORT_V7.md.
"""

import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

MARKER_TAG = "CACHE-OPT v7"
MARKER = "// CACHE-OPT v7 (aplicado por apply_cache_optimizations_v7.py)"
MARKER_V6_TAG = "CACHE-OPT v6"
SKIP_DIRS = {"node_modules", "dist", "build", "coverage"}


class AnchorError(Exception):
    """Âncora não encontrada: o ficheiro não é alterado."""


# ═════════════════════════════════════════════════════════════════════════════
#  Utilitários de edição de texto
# ═════════════════════════════════════════════════════════════════════════════
def sub_exact(text, old, new, what, expected=1):
    n = text.count(old)
    if n != expected:
        raise AnchorError("%s: esperado %d ocorrência(s), encontrada(s) %d" % (what, expected, n))
    return text.replace(old, new)


def add_marker(text):
    if text.startswith("\ufeff"):
        return "\ufeff" + MARKER + "\n" + text[1:]
    return MARKER + "\n" + text


_FUNC_START = r"(?m)^(?:async function|const|let|function)\s+%s\b"
_TOP_LEVEL = re.compile(r"(?m)^(?:const |let |var |async function |function |module\.exports)")


def get_slice(text, name):
    """Devolve (início, fim) da função de topo `name` (até à próxima declaração de topo)."""
    m = re.search(_FUNC_START % re.escape(name), text)
    if not m:
        raise AnchorError("função `%s` não encontrada" % name)
    n = _TOP_LEVEL.search(text, m.end())
    return m.start(), (n.start() if n else len(text))


def edit_func(text, name, fn):
    s, e = get_slice(text, name)
    return text[:s] + fn(text[s:e]) + text[e:]


# ═════════════════════════════════════════════════════════════════════════════
#  Bloco JS injetado nos controllers (helpers de cache tolerantes a falhas)
# ═════════════════════════════════════════════════════════════════════════════
EXEC_RX = re.compile(
    r"(?m)^\ufeff?[ \t]*const ExecuteQuery[ \t]*=[ \t]*require\(\s*([\"'])\.\./Functions/ExecuteQuery\1\s*\);[ \t]*\n")

CACHE_HEADER = (
    '\n// CACHE-OPT v7: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido\n'
    'const Cache = require("../Functions/CacheRoutes");\n'
    "const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };\n"
    "const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };\n"
    "const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };\n"
)

C = "req.session.user.eduall_user_session_curentinstitute"
SITE_INST = "institute(req)"          # helper já existente em SiteManager.js

RESP_200 = r"res\.status\(200\)\.json\("
RESP_OK = r"res\.status\((?:200|201)\)\.json\("
RESP_SITE_OK = r"res\.json\(\{\s*success:\s*true"


def K(prefix, tail, inst=C):
    """Chave JS (template literal): <prefix>:<escola>:<tail>"""
    return "`%s:${%s}:%s`" % (prefix, inst, tail)


def P(prefix, inst=C):
    """Padrão de invalidação JS: <prefix>:<escola>:*"""
    return "`%s:${%s}:*`" % (prefix, inst)


def add_cache_header(text):
    if "const _cacheGet" in text:       # já existe (ex.: ficheiro tocado por uma versão anterior)
        return text
    ms = list(EXEC_RX.finditer(text))
    if len(ms) != 1:
        raise AnchorError("linha require ExecuteQuery: esperada 1, encontrada(s) %d" % len(ms))
    return text[:ms[0].end()] + CACHE_HEADER + text[ms[0].end():]


def _cache_read(body, name, key_js, ttl, store_var, hit_js, resp):
    mt = re.search(r"(?m)^([ \t]*)try[ \t]*\{[ \t]*\n", body)
    if not mt:
        raise AnchorError("%s: bloco `try {` não encontrado" % name)
    rx = re.compile(r"(?m)^([ \t]*)(?:return\s+)?" + resp)
    ms = list(rx.finditer(body, mt.end()))
    if len(ms) != 1:
        raise AnchorError("%s: esperada 1 resposta de sucesso, encontrada(s) %d" % (name, len(ms)))
    mm = ms[0]
    ind = mt.group(1) + "    "
    head = ("%sconst _ck = %s;\n"
            "%sconst _hit = await _cacheGet(_ck);\n"
            "%sif (_hit !== null) return %s;\n") % (ind, key_js, ind, ind, hit_js)
    store = "%sawait _cacheSet(_ck, %s, %d);\n" % (mm.group(1), store_var, ttl)
    body = body[:mm.start()] + store + body[mm.start():]   # primeiro o ponto mais à frente
    return body[:mt.end()] + head + body[mt.end():]


def _invalidate(body, name, clear_js, resp, expected):
    rx = re.compile(r"(?m)^([ \t]*)(?:return\s+)?" + resp)
    ms = list(rx.finditer(body))
    if len(ms) != expected:
        raise AnchorError("%s: esperadas %d resposta(s) de sucesso, encontrada(s) %d" % (name, expected, len(ms)))
    for mm in reversed(ms):
        body = body[:mm.start()] + "%sawait _cacheClear(%s);\n" % (mm.group(1), clear_js) + body[mm.start():]
    return body


def read_fn(t, name, key_js, ttl, var, hit="res.status(200).json(_hit)", resp=RESP_200):
    return edit_func(t, name, lambda b: _cache_read(b, name, key_js, ttl, var, hit, resp))


def write_fn(t, name, clear_js, expected=1, resp=RESP_OK):
    return edit_func(t, name, lambda b: _invalidate(b, name, clear_js, resp, expected))


# ── variante para o estilo compacto do SiteManager.js ───────────────────────
#    async function listCourses(req,res){ try{   ...   res.json(rows);   } catch(e){...} }
def site_read(t, name, key_js, ttl):
    def fn(b):
        mh = re.match(r"async function %s\s*\(\s*req\s*,\s*res\s*\)\s*\{\s*try\s*\{[ \t]*\n" % re.escape(name), b)
        if not mh:
            raise AnchorError("%s: cabeçalho `async function %s(req,res){ try{` não encontrado" % (name, name))
        ms = list(re.finditer(r"(?m)^([ \t]*)res\.json\((.*)\);[ \t]*$", b))
        if len(ms) != 1:
            raise AnchorError("%s: esperada 1 resposta `res.json(...)`, encontrada(s) %d" % (name, len(ms)))
        m = ms[0]
        ind = m.group(1)
        new = ("%sconst _payload = %s;\n"
               "%sawait _cacheSet(_ck, _payload, %d);\n"
               "%sres.json(_payload);") % (ind, m.group(2), ind, ttl, ind)
        b = b[:m.start()] + new + b[m.end():]
        head = ("  const _ck = %s;\n"
                "  const _hit = await _cacheGet(_ck);\n"
                "  if (_hit !== null) return res.json(_hit);\n") % key_js
        return b[:mh.end()] + head + b[mh.end():]
    return edit_func(t, name, fn)


# ═════════════════════════════════════════════════════════════════════════════
#  Receitas (devolvem texto novo, descrição das alterações e TODOs)
# ═════════════════════════════════════════════════════════════════════════════
def recipe_shelves(t):
    t = add_cache_header(t)
    t = read_fn(t, "GetBookcases", K("bookcases", "list"), 600, "result")
    t = read_fn(t, "GetSingleBookcase", K("bookcases", "single:${req.params.ID}"), 600, "result")
    for fn in ("RegisterBookcase", "BookcaseUpdate", "BookcaseDelete", "ReorderBookcases"):
        t = write_fn(t, fn, P("bookcases"))
    return t, [
        "cache (600s) em GetBookcases e GetSingleBookcase; Register/Update/Delete/Reorder invalidam `bookcases:<escola>:*`",
    ], [
        "Shelves.js: BookcaseDelete e ReorderBookcases fazem várias escritas em sequência sem transação (Reorder = 1 UPDATE por estante num ciclo; "
        "Delete = solta as prateleiras e depois apaga a estante). Um único UPDATE com `CASE WHEN` ou uma transação evita estados a meio.",
        "Shelves.js: GetBookcases/GetSingleBookcase não passam `data: req` ao ExecuteQuery (as restantes funções passam); confirmar se isso afeta o registo/auditoria de queries.",
        "Shelves.js: a lista de estantes só é escrita neste controller. Se Racks.js (sem cache desde o v6) ou outro controller devolver nome/cor da estante num JOIN, "
        "mostra sempre o valor atual; se alguma vez for cacheado, invalidar também `bookcases:<escola>:*` aí.",
        "Shelves.js: RegisterBookcase calcula `maxOrder + 1` com SELECT + INSERT (não atómico): dois registos simultâneos podem receber a mesma ordem.",
    ]


def recipe_services(t):
    # Sem header: Services.js já tem o seu próprio sistema de cache (Cache.eduallGet/Set/Clear).
    t = sub_exact(
        t, "  list: (instituteCode, userId) => `services:list:${instituteCode}:${userId}`,",
        "  list: (instituteCode) => `services:${instituteCode}:list`, // CACHE-OPT v7: sem userId (a query só depende da escola)",
        "CacheKeys.list")
    t = sub_exact(
        t, "  single: (id, instituteCode, userId) => `services:single:${id}:${instituteCode}:${userId}`,",
        "  single: (id, instituteCode) => `services:${instituteCode}:single:${id}`,",
        "CacheKeys.single")
    t = sub_exact(
        t, "  allByInstitute: (instituteCode, userId) => `services:${instituteCode}:${userId}:*`,",
        "  allByInstitute: (instituteCode) => `services:${instituteCode}:*`, // CACHE-OPT v7: apanha list e single de TODOS os utilizadores da escola",
        "CacheKeys.allByInstitute")
    return t, [
        "chaves passam a `services:<escola>:list` / `services:<escola>:single:<id>` e a limpeza a `services:<escola>:*`. Antes, o padrão de limpeza "
        "(`services:<escola>:<user>:*`) não correspondia a nenhuma chave real (`services:list:<escola>:<user>`): as escritas só repunham a lista do próprio utilizador, "
        "a ficha individual nunca era limpa e os outros utilizadores da escola viam dados antigos até 1 h (TTL)",
        "os chamadores continuam a passar `userId` (ignorado pelos novos builders): sem outras alterações",
    ], [
        "Services.js: as chaves antigas (`services:list:<escola>:<user>` …) ficam órfãs até expirarem (3600 s); deixam de ser lidas. Sem impacto funcional.",
        "Services.js: o TTL é de 1 h e a lista inclui `eduall_coins` e `eduall_providers` (JOIN). Se a moeda da escola ou um fornecedor forem editados noutro controller, "
        "a lista só mostra o novo valor depois do TTL: invalidar `services:<escola>:*` nesses controllers (ou baixar o TTL para 300 s).",
        "Services.js: ServicePayments.js (pagamentos/matrículas) lê eduall_services por JOIN diretamente (não passa por esta cache): sem impacto, mas se um dia for cacheado invalidar `services:<escola>:*`.",
        "Services.js: o LEFT JOIN `eduall_coins ON ed_coin_institute_code = ?` não tem relação com o serviço; se a escola tiver mais de uma moeda, cada serviço aparece duplicado por moeda.",
        "Services.js: `console.log(\"DADOS = \", PARAMS)` em RegisterService e logs de `rows[0]` em GetSingleService escrevem dados para os logs em cada pedido; proteger com variável de ambiente.",
        "Services.js: GetSingleService guarda em cache também a resposta vazia (`[]`), por isso um ID inexistente fica 1 h como «não encontrado» mesmo que seja criado entretanto — "
        "só afeta IDs criados por outro caminho; as escritas deste ficheiro limpam tudo.",
    ]


def recipe_exams_calendar(t):
    t = add_cache_header(t)
    t = read_fn(t, "GetExamsCalendar", K("examsCalendar", "list"), 120, "rows")
    t = read_fn(t, "GetCalendarBlocks", K("examsCalendar", "blocks"), 120, "rows")
    for fn in ("RegisterStudentExamCalendar", "UpdateStudentExamCalendar", "DeleteStudentExamCalendar"):
        t = write_fn(t, fn, P("examsCalendar"))
    return t, [
        "cache (120s) em GetExamsCalendar e GetCalendarBlocks (JOIN a disciplinas/turmas/horários); Register/Update/Delete invalidam `examsCalendar:<escola>:*`. "
        "GetExamsCalendarByClass e GetSingleExamCalendar NÃO foram cacheados (ver TODOs)",
    ], [
        "⚠ StudentExamsCalendar.js: GetExamsCalendarByClass, GetSingleExamCalendar, UpdateStudentExamCalendar e DeleteStudentExamCalendar NÃO filtram por escola "
        "(`WHERE ... class = ?` / `exam_id = ?`): quem adivinhar um ID lê, edita ou apaga provas de outra escola. Acrescentar `AND ed_student_exam_institute_code = ?` com a escola da sessão. "
        "Por esse motivo estas funções não foram cacheadas.",
        "StudentExamsCalendar.js: `ADD COLUMN IF NOT EXISTS` (comentário de migração no topo) só existe em MariaDB; em MySQL a migração falha — usar o script com verificação em information_schema ou executar uma coluna de cada vez.",
        "StudentExamsCalendar.js GetCalendarBlocks: `FIELD(ed_exam_period, 'Manhã', 'Manhã/Tarde', 'Tarde', NULL)` — `NULL` na lista não tem efeito e as provas SEM turno (FIELD = 0) "
        "ficam PRIMEIRO, ao contrário do pretendido. Usar `ORDER BY ed_exam_period IS NULL, FIELD(ed_exam_period, 'Manhã', 'Manhã/Tarde', 'Tarde')`.",
        "StudentExamsCalendar.js: os nomes da turma/disciplina/horário vêm de JOIN; se forem editados noutro controller, a lista pode mostrar o valor antigo até 2 min.",
        "StudentExamsCalendar.js: todos os `catch` devolvem `error.message` (SQL/colunas) ao cliente; devolver mensagem genérica e registar no servidor.",
        "StudentExamsCalendar.js: a tabela `eduall_student_exams` (calendário) é distinta de `eduall_student_exam_notes` (notas, StudentExams.js): a invalidação é exata, só este controller escreve no calendário.",
    ]


def recipe_behavior(t):
    t = add_cache_header(t)
    t = read_fn(t, "GetAllStudentBehavior", K("studentBehavior", "list"), 120, "rows")
    for fn in ("RegisterStudentBehavior", "StudentBehaviorDelete", "StudentBehaviorUpdate"):
        t = write_fn(t, fn, P("studentBehavior"))
    return t, [
        "cache (120s) só em GetAllStudentBehavior (lista geral, sem JOIN); Register/Delete/Update invalidam `studentBehavior:<escola>:*`. "
        "GetAllStudentBehaviorByStudentCode NÃO foi cacheado (ver TODOs)",
    ], [
        "🔥 StudentBehavior.js: GetSingleStudentBehavior, StudentBehaviorDelete e StudentBehaviorUpdate filtram por `ed_academic_year_id = ?` numa tabela de COMPORTAMENTOS "
        "(copiado do controller de anos letivos). Se a coluna não existir dá «Unknown column» (editar/eliminar/ver um comportamento falha sempre); se existir, o ID recebido é o do ano letivo "
        "e a escrita atinge TODOS os comportamentos desse ano. Trocar por `ed_student_behavior_id = ?` (confirmar o nome da chave primária com SHOW COLUMNS).",
        "🔥 StudentBehavior.js GetAllStudentBehaviorByStudentCode: `SELECT *` com LEFT JOIN a `eduall_user_accounts` devolve ao cliente TODAS as colunas da conta do utilizador "
        "(provavelmente incluindo o hash da palavra-passe e tokens). Listar só nome/foto. Enquanto assim estiver, NÃO cachear esta função (o hash iria para o Redis).",
        "StudentBehavior.js: depois de corrigir o SELECT, cachear GetAllStudentBehaviorByStudentCode com `K(\"studentBehavior\", \"byStudent:${req.params.ID}\")` e TTL 120 s (a invalidação já está feita).",
        "StudentBehavior.js: os `catch` devolvem `error.message` ao cliente e mistura `message`/`msg` nas respostas (o frontend lê `msg` nas restantes rotas).",
        "StudentBehavior.js: a lista geral guarda o nome do funcionário só pelo código; se mostrar o nome por JOIN noutro sítio, o nome só atualiza depois do TTL.",
    ]


SITE_READERS = (
    ("getContacts", "contacts", 300),
    ("listCourses", "courses", 300),
    ("listSlides", "slides", 300),
    ("listSections30", "sections", 300),
    ("getBranding", "branding", 300),
    ("listPosts", "posts", 300),
    ("getSettings", "settings", 300),
)
SITE_WRITERS = (
    "saveContacts", "createCourse", "updateCourse", "deleteCourse",
    "createSlide", "updateSlide", "deleteSlide", "updateSectionByIdx",
    "saveBranding", "createPost", "updatePost", "deletePost",
    "selectTemplate", "registerDomain",
)


def recipe_site_manager(t):
    t = add_cache_header(t)
    for fn, tail, ttl in SITE_READERS:
        t = site_read(t, fn, K("site", tail, SITE_INST), ttl)
    t = site_read(t, "listTemplates", "`site:global:templates`", 600)
    for fn in SITE_WRITERS:
        t = write_fn(t, fn, P("site", SITE_INST), 1, RESP_SITE_OK)
    return t, [
        "cache (300s) em getContacts, listCourses, listSlides, listSections30, getBranding, listPosts e getSettings; chave `site:<escola>:<recurso>`; "
        "as 14 escritas (contactos, cursos, slides, secções, branding, posts, template, domínio) invalidam `site:<escola>:*`",
        "cache (600s) em listTemplates (catálogo global, sem escola): chave `site:global:templates`, sem invalidação neste controller (expira sozinha)",
        "NÃO cacheados: listPreEnrollments (os pedidos entram por outro caminho/formulário público) e checkDomain (tem de ser sempre atual)",
    ], [
        "🔥 SiteManager.js: `GET /api/site/setup/ensure-tables` executa DDL (9 CREATE TABLE) e seeds, e NÃO tem middleware de autenticação visível no router. "
        "Proteger (só administração) ou retirar das rotas e correr uma vez no deploy.",
        "⚠ SiteManager.js: nenhuma rota do router tem middleware de sessão/perfil neste ficheiro; `institute(req)` devolve `undefined` sem sessão — com cache a chave seria `site:undefined:*`. "
        "Confirmar que o router é montado atrás do middleware de autenticação.",
        "⚠ SiteManager.js: `ed_description_html`, `ed_content_html` e `ed_map_iframe` são guardados e devolvidos tal como chegam (HTML/iframe sem sanitizar): risco de XSS no site público. "
        "Sanitizar à escrita (ex.: sanitize-html) e restringir o iframe do mapa ao domínio do Google Maps.",
        "SiteManager.js: o multer de `/api/site/upload` não tem `fileFilter` nem `limits` (aceita qualquer tipo e tamanho) e guarda em `assets/` relativo ao diretório de trabalho do processo.",
        "SiteManager.js: listPosts devolve o HTML completo de TODOS os posts (e agora também o guarda em cache). Devolver só título/resumo/imagem na lista e o conteúdo no GET por ID.",
        "SiteManager.js: todos os `catch(e)` respondem 500 sem registar `e` nos logs; acrescentar `console.error` (ou o LogError do Services.js) para diagnosticar.",
        "SiteManager.js: o site público (outro router/domínio) pode ler estas mesmas tabelas diretamente: nesse caso a edição aparece lá logo, mas o painel de administração só depois do TTL se a escrita for feita por outro caminho; "
        "se o site público também passar por estas funções, 5 min de atraso é o máximo.",
        "SiteManager.js: listTemplates é global (sem escola) e só é escrito pelo seed de ensureSiteTables; se um dia houver CRUD de templates, invalidar `site:global:templates`.",
        "SiteManager.js: `ON DUPLICATE KEY` em eduall_school_site depende de `uniq_inst`/`uniq_domain` (existem no DDL do próprio ficheiro): confirmar que estão na base de dados real.",
    ]


def recipe_seed_books(t):
    t = add_cache_header(t)
    t = sub_exact(
        t,
        "    const reportPath = path.join(__dirname, ",
        "    await _cacheClear(" + P("publishers", "instituteCode") + ");  // CACHE-OPT v7: a importação cria editoras -> lista em cache (v6) inválida\n"
        "    const reportPath = path.join(__dirname, ",
        "início da gravação do relatório")
    return t, [
        "no fim da importação (antes de gravar o relatório) limpa `publishers:<escola>:*`: getOrCreateLookupId pode criar editoras novas e a lista de editoras (cache do v6, 600 s) ficava desatualizada",
    ], [
        "SeedLibraryBooks.js: a importação também cria autores, tipos de livro e fornecedores (eduall_library_authors / _typeofbooks / _providers). Se esses controllers tiverem cache "
        "(lotes v1–v5), acrescentar a mesma linha `await _cacheClear(`<família>:${instituteCode}:*`)` com a chave da família respetiva.",
        "SeedLibraryBooks.js: quando corre sem sessão (modo automático, `buildFakeContext`) o `require` de Functions/CacheRoutes pode abrir uma ligação (Redis) que mantém o processo vivo; "
        "se correr como script isolado, chamar `process.exit()` no fim ou fechar o cliente de cache.",
        "SeedLibraryBooks.js: getOrCreateLookupId e getOrCreateAuthor comparam `LOWER(TRIM(coluna)) = LOWER(TRIM(?))`, o que impede o uso de índice na coluna do nome: com muitas "
        "editoras/autores torna-se lento. Com collation `_ci` basta `coluna = ?`.",
        "SeedLibraryBooks.js: o ficheiro de lock (`.seed-books.lock`) só protege um único servidor; com vários processos/instâncias depende da UNIQUE KEY (external_id, institute_code) — confirmar que existe (add_external_id_column.sql).",
        "SeedLibraryBooks.js: `console.table` dos livros registados/ignorados/falhados e o relatório JSON em `__dirname` crescem a cada execução; limpar relatórios antigos.",
    ]


RECIPES = {
    "Shelves.js": ("GetBookcases", recipe_shelves),
    "Services.js": ("CacheKeys", recipe_services),
    "StudentExamsCalendar.js": ("GetExamsCalendar", recipe_exams_calendar),
    "StudentBehavior.js": ("GetAllStudentBehavior", recipe_behavior),
    "SiteManager.js": ("buildSiteRouter", recipe_site_manager),
    "SeedLibraryBooks.js": ("SeedLibraryBooksFromOpenLibrary", recipe_seed_books),
}

# (razão, TODOs)
NO_CHANGE = {
    "SendEmail.js": (
        "já otimizado no v6 (cache em GetAllSentEmails + `await send()`); só um TODO novo",
        [
            "SendEmail.js: GetAllSentEmailsByUser filtra por `ed_sent_email_to` e ordena por `ed_sent_email_date`, colunas que não aparecem em mais nenhum ponto do ficheiro "
            "(o INSERT usa title/message/code/institutecode e a lista usa `ed_sent_email_sentdate` + tabela de contactos). Confirmar com SHOW COLUMNS: se não existirem, esta rota falha sempre.",
        ]),
    "SendEmailMessage.js": (
        "só envia um email (sem leituras nem escritas na base de dados): não há nada para cachear nem indexar",
        [
            "⚠ SendEmailMessage.js: `Header` e `Message` entram no HTML do email sem sanitizar e `Email` sem validar: se a rota não exigir sessão/perfil, qualquer pessoa pode enviar "
            "emails com o domínio da Eduall (phishing/relay). Exigir autenticação, validar o formato do email e limitar a taxa de pedidos.",
            "SendEmailMessage.js: o HTML tem marcação partida: `<a/>` (devia ser `</a>`) depois do logótipo e `<div>${Message}<div>` (o 2.º `<div>` devia fechar `</div>`); alguns clientes de email desformatam a mensagem.",
            "SendEmailMessage.js: o `catch` devolve o objeto de erro inteiro (`res.status(400).json(error)`), incluindo detalhes do SMTP; devolver `{ success:false, msg }` genérico com 500.",
            "SendEmailMessage.js: `from` usa `process.env.MAIL_APP_USER` enquanto SendEmail.js usa `noreply@eduall.site`: unificar o remetente. URLs (eduall.vercel.app, eduall@gmail.com) e ícones do Google Drive (`drive-viewer`, podem expirar/ser bloqueados) "
            "estão escritos no código: servir os ícones do próprio domínio.",
            "SendEmailMessage.js: importa DB_SQLITE, DATABASE, GetCurrentUserData e CheckInternet sem os usar (carregam a configuração da base de dados para nada); remover.",
        ]),
    "SendSms.js": (
        "créditos e registos de SMS mudam a cada envio: o saldo e o histórico em cache ficariam errados; só TODOs/índices",
        [
            "🔥 URGENTE SendSms.js: a chave da API da Telcosms (`api_key_app`) está escrita no código, em SendSms e em ResendSms. Rodar a chave no painel do fornecedor e ler de process.env (TELCOSMS_API_KEY); "
            "continua no histórico do Git: a rotação é obrigatória.",
            "⚠ SendSms.js: o número é validado depois de retirar espaços (`numeroFormatado`), mas o pedido à API envia `phone` ORIGINAL (com espaços). Enviar `numeroFormatado`. "
            "ResendSms não valida o número de todo.",
            "⚠ SendSms.js: ResendSms faz `creditRows[0].ed_sms_credit_total` — se a escola não tiver linha de créditos (array vazio) dá TypeError e responde 500. Validar `creditRows.length` (como SendSms faz).",
            "⚠ SendSms.js: verificar créditos (SELECT), enviar e só depois descontar (UPDATE com `AND total >= ?`) não é atómico: dois envios simultâneos podem passar a verificação e o 2.º desconto afetar 0 linhas "
            "(mensagem enviada e não cobrada, sem erro). Reservar primeiro com UPDATE atómico, conferir `affectedRows` e devolver os créditos se o envio falhar.",
            "SendSms.js: cada falha (créditos insuficientes, número inválido, API em baixo) insere um registo novo com estado 1, e a falha de ResendSms cria um SEGUNDO registo em vez de manter o original: a tabela enche-se de duplicados.",
            "SendSms.js: `calculateSmsParts` está copiada 4 vezes; mover para um helper. Usa 160/70 caracteres por parte — mensagens concatenadas têm 153/67 por segmento (conta a menos) e qualquer acento (ã, ç) "
            "faz a mensagem contar como Unicode (limite 70). Confirmar como o fornecedor cobra.",
            "SendSms.js GetAllSentSmS: `SELECT *` com JOIN a eduall_contacts (colunas com o mesmo nome sobrepõem-se) e `ORDER BY ... ASC` sem LIMIT: cresce sem limite. Paginar/limitar por data e devolver os mais recentes primeiro.",
            "SendSms.js: `console.log` da resposta da API e dos números em cada envio; proteger com variável de ambiente.",
        ]),
    "StudentAttendance.js": (
        "as presenças são lançadas pelo professor e têm de aparecer de imediato; as listas deste ficheiro devolvem a escola inteira sem filtros (cachear iria guardar tudo por escola) "
        "e a tabela pode ser escrita por outros caminhos; só TODOs/índices",
        [
            "🔥 StudentAttendance.js: GetStudentAttendanceByTeacherAndClassSub, GetSingleStudentAttendance, CheckExistentSingleStudentAttendance, GetStudentAttendanceByClassSubStuQrt, GetAllStudentAttendance, "
            "UpdateExistentSingleStudentAttendance, StudentAttendanceUpdate e StudentAttendanceDelete NÃO filtram por escola (`ed_student_attd_institute_code`): quem conhecer/adivinhar IDs lê, edita ou apaga presenças de outras escolas. "
            "Acrescentar o filtro com a escola da sessão em todas.",
            "StudentAttendance.js: GetStudentAttendance e GetStudentAttendanceByTeacher executam EXATAMENTE a mesma consulta (todas as presenças da escola) — a «ByTeacher» não filtra por professor. "
            "Devolver só o necessário (por turma/data) ou paginar.",
            "StudentAttendance.js: StudentAttendanceUpdate regista na auditoria `req.body.student_attendance_code`, que o UPDATE nem usa (pode vir `undefined` → «#undefined»). Ler o código da linha atualizada.",
            "StudentAttendance.js: RegisterStudentAttendance não verifica duplicados (mesmo aluno, turma, horário, disciplina e data): duplo clique = duas presenças. Um índice único parcial (ou verificação prévia) evita-o.",
            "StudentAttendance.js: `console.log(rows)` em GetAllStudentAttendance escreve todas as presenças do aluno nos logs; importa CheckQuarterlyNotePermission sem usar; os `catch` devolvem `error.message` ao cliente.",
            "StudentAttendance.js: se um dia se cachear, só com TTL curto (30–60 s) e invalidando em Register/Update/Delete aqui e em qualquer outro controller que escreva em eduall_student_attendence.",
        ]),
    "StudentEnrollment.js": (
        "matrículas são escritas por vários controllers (ServicePayments, confirmações) e comandam pagamentos/turmas: uma cache aqui arriscaria matrículas antigas; só TODOs/índices",
        [
            "StudentEnrollment.js: RegisterStudentEnrollment tem ~360 linhas numa única função (linhas 40→405) com `printEnrollmentCard` para logs coloridos; os logs síncronos em cada matrícula custam tempo — protegê-los com variável de ambiente.",
            "StudentEnrollment.js: StudentEnrollmentUpdate lê `enrollment_class` do body mas só atualiza o serviço (a turma nunca muda); confirmar se é intencional.",
            "StudentEnrollment.js: as 3 listas fazem `SELECT *` sem LIMIT; GetStudentEnrollments devolve TODAS as matrículas da escola — paginar ou filtrar por ano letivo.",
            "StudentEnrollment.js: os `catch` devolvem `error.message` ao cliente (SQL/colunas); o ficheiro usa fim de linha CRLF (o script preserva).",
        ]),
    "StudentEnrollmentConfirmation.js": (
        "código legado: não usa ExecuteQuery e há ramos que referem um modelo não importado; nada para cachear (ver TODOs)",
        [
            "🔥 StudentEnrollmentConfirmation.js: no ramo OFFLINE, StudentEnrollmentConfirmationUpdate (e Delete) executam `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1` — "
            "atualizar uma confirmação de matrícula elimina (soft-delete) um NÍVEL ACADÉMICO. O Register offline insere em eduall_academic_level, o Get offline lê da mesma tabela: é cópia do controller de níveis.",
            "⚠ StudentEnrollmentConfirmation.js: o ramo online usa `StudentEnrollmentConfirmationModel`, que NÃO é importado: dá ReferenceError em todas as funções (a resposta fica com `res.json(error)`). "
            "Além disso, as queries do modelo não filtram por escola (leitura/alteração entre escolas).",
            "StudentEnrollmentConfirmation.js: confirmar se este ficheiro está nas rotas. Se não estiver, apagar; se estiver, migrar para ExecuteQuery como StudentEnrollment.js (com filtro por escola) — só então faz sentido cache/índices. "
            "`DATABASERUN` está definido e nunca é usado.",
        ]),
    "StudentExams.js": (
        "notas dos alunos (mesmas razões do QuarterlyNotes/SemesterNotes no v6): têm de aparecer de imediato e são escritas em vários controllers; só TODOs/índices",
        [
            "StudentExams.js: BulkUpsertStudentExamNotes (linha ~325) e BulkUpsertStudentFeaturedNotes (~584) fazem SELECT + UPDATE/INSERT por cada nota dentro de um ciclo (N+1, até 3 consultas por aluno). "
            "Um `INSERT ... ON DUPLICATE KEY UPDATE` (com índice único) ou um SELECT `IN (...)` + INSERT em lote resolve com 2 consultas.",
            "⚠ StudentExams.js: RegisterStudentFeaturedNotes / UpdateStudentFeaturedNotes / DeleteStudentFeaturedNotes existem TAMBÉM em StudentFeaturedNotes.js (mesmos nomes, lógica ligeiramente diferente), "
            "e os bulk upserts existem TAMBÉM em StudentExamsAndFeaturesNotes.js. Confirmar qual está nas rotas e eliminar as cópias: as regras (permissões, duplicados, `deleted`) já divergem.",
            "StudentExams.js: 7 JOIN a eduall_academic_level + 5 SELECT a eduall_class repetem a mesma pergunta «esta turma permite exame/recurso?». Extrair para um helper com cache curto por (escola, turma) é a otimização certa aqui.",
            "StudentExams.js: nenhuma transação nos bulk upserts: uma falha a meio deixa metade das notas gravadas.",
        ]),
    "StudentExamsAndFeaturesNotes.js": (
        "notas dos alunos (mesmas razões do StudentExams.js); só TODOs/índices",
        [
            "⚠ StudentExamsAndFeaturesNotes.js: BulkUpsertStudentExamNote usa as colunas `ed_student_exam_studentCode / _class / _subject / _score / _id / _deleted` em eduall_student_exam_notes, "
            "enquanto StudentExams.js usa `ed_student_exam_note_*` na MESMA tabela. Uma das duas versões está errada (a desta parece copiada da tabela do calendário, `eduall_student_exams`). "
            "Confirmar com SHOW COLUMNS FROM eduall_student_exam_notes: se esta versão estiver em uso, dá «Unknown column».",
            "StudentExamsAndFeaturesNotes.js: BulkUpsertStudentExamNote (ciclo ~95) e BulkUpsertStudentFeaturedNote (~302) são N+1 (SELECT + UPDATE/INSERT por item); ver sugestão em StudentExams.js. GetAllNotesByClassSubject (~180 linhas) é a candidata a cache, só com TTL curto e invalidação em todas as escritas de notas.",
            "StudentExamsAndFeaturesNotes.js: duplicado de funções de StudentExams.js (ver TODO desse ficheiro).",
        ]),
    "StudentFeaturedNotes.js": (
        "notas dos alunos (mesmas razões do StudentExams.js); só TODOs/índices",
        [
            "⚠ StudentFeaturedNotes.js: a verificação de duplicado em RegisterStudentFeaturedNotes não tem `ed_student_featured_note_deleted = 0`: uma nota de recurso ELIMINADA (soft-delete) "
            "bloqueia para sempre um novo registo com 409. Acrescentar o filtro.",
            "⚠ StudentFeaturedNotes.js: UpdateStudentFeaturedNotes e DeleteStudentFeaturedNotes filtram só por `note_id` (sem escola): quem adivinhar o ID altera/apaga notas de outra escola. "
            "Update também permite mudar aluno/turma/disciplina para uma combinação que já existe (sem verificar duplicados).",
            "StudentFeaturedNotes.js: Register e Update repetem as mesmas 2 consultas (turma → nível académico → `forFt`); um único SELECT com JOIN poupa uma ida à base de dados.",
            "StudentFeaturedNotes.js: a função com o mesmo nome também existe em StudentExams.js (ver TODO desse ficheiro).",
            "StudentFeaturedNotes.js: GetsingleStudentFeaturedNotebYSubStCls faz `SELECT *` com 2 JOINs (colunas com o mesmo nome, ex. institute_code/deleted, sobrepõem-se).",
        ]),
    "StudentGradeHistory.js": (
        "histórico de notas de um aluno: leitura rara (ficha do aluno) e função com 3 respostas de sucesso diferentes; o ganho de cache é pequeno e o risco de mostrar notas antigas é real; só TODOs/índices",
        [
            "⚠ StudentGradeHistory.js: `uid = req.session.user.eduall_user_session_id` (minúsculas), enquanto o resto do sistema usa `eduall_user_session_ID`. Se a chave não existir na sessão, o utilizador da auditoria/registos fica `undefined`. Confirmar.",
            "StudentGradeHistory.js: CreateGradeHistory/UpdateGradeHistory/DeleteGradeHistory fazem várias escritas em sequência (cabeçalho + grupos + disciplinas) sem transação: uma falha a meio deixa um histórico meio gravado. "
            "_upsertRecords faz 1 INSERT por disciplina num ciclo; um INSERT com várias linhas é muito mais rápido.",
            "StudentGradeHistory.js: o histórico tem `UNIQUE KEY uq_student (ed_gh_student_id, ed_gh_institute_code)` e a eliminação é lógica (`ed_gh_deleted = 1`): depois de eliminar, CreateGradeHistory (que só procura `deleted = 0`) tenta INSERT e "
            "bate na chave única (ER_DUP_ENTRY → 500). Reativar a linha eliminada em vez de inserir, ou incluir `ed_gh_deleted` na chave.",
            "StudentGradeHistory.js: `console.log(\"hellow !!\")` esquecido no início de CreateGradeHistory; `SELECT *` nas leituras de grupos e disciplinas.",
            "StudentGradeHistory.js: se um dia se cachear GetGradeHistory, usar `gradeHistory:<escola>:<aluno>` e invalidar essa chave em Create/Update/Delete (todas neste ficheiro).",
        ]),
    "StudenBalanceController.js": (
        "saldos e movimentos são dados financeiros: o saldo mostrado tem de bater certo com a base de dados em cada pedido; só TODOs/índices",
        [
            "🔥 StudenBalanceController.js: DepositStudentBalance e DeductStudentBalance fazem ler saldo → calcular → UPDATE do saldo → INSERT do movimento SEM transação nem bloqueio: dois descontos simultâneos leem o mesmo saldo e ambos passam "
            "(saldo negativo/duplo gasto). Usar transação com `SELECT ... FOR UPDATE`, ou `UPDATE ... SET sb_balance = sb_balance - ? WHERE ... AND sb_balance >= ?` e conferir `affectedRows`.",
            "⚠ StudenBalanceController.js: `ensureBalanceRow` depende de `ON DUPLICATE KEY UPDATE`; se a tabela eduall_student_balance não tiver UNIQUE (sb_student_id, sb_institute_code) cria linhas duplicadas por aluno "
            "(ver cache_indexes_v7.sql — verificar com SHOW INDEX).",
            "StudenBalanceController.js: o saldo fica guardado em duas formas (coluna `sb_balance` e soma dos movimentos em `recalculateBalance`); se uma escrita falhar entre as duas, divergem. A transação acima resolve isto.",
            "StudenBalanceController.js: Update/DeleteBalanceLog alteram movimentos antigos e recalculam; confirmar que o histórico de auditoria guarda o valor anterior.",
        ]),
    "ServicePayments.js": (
        "pagamentos de serviços/propinas: dados financeiros que têm de aparecer de imediato nos recibos e relatórios, escritos em várias tabelas; só TODOs/índices",
        [
            "🔥 ServicePayments.js: RegisterServicePayment faz `ExecuteQuery(null, \"START TRANSACTION\")` … `COMMIT/ROLLBACK`. Com um pool de ligações cada `ExecuteQuery` pode usar uma ligação diferente, "
            "pelo que a transação NÃO envolve as escritas (o ROLLBACK não desfaz nada). Obter uma ligação dedicada (`pool.getConnection()`) e fazer todas as queries dessa função nela.",
            "⚠ ServicePayments.js: FetchServicePayments filtra com `COALESCE(sp.ed_service_payment_deleted, 0) = 0`, que impede o uso de índice na coluna. Se a coluna for `NOT NULL DEFAULT 0` usar `= 0` simples; "
            "caso contrário, `(col = 0 OR col IS NULL)`.",
            "ServicePayments.js: a função RegisterServicePayment tem ~1400 linhas (696→2075) com 5 ciclos que fazem consultas dentro (linhas ~839, 975, 1225, 1463, 1699, 1890: N+1 por serviço/mês). "
            "Dividir em funções e trocar as consultas dos ciclos por `IN (...)`/JOIN — é aqui que está o maior ganho de tempo do ficheiro.",
            "ServicePayments.js: ~85 `console.log` (incluindo dados de alunos e valores) em pedidos de pagamento; os logs síncronos custam tempo e expõem dados pessoais. Proteger com `DEBUG_PAYMENTS=1`.",
            "ServicePayments.js: `getOperatorData` (SELECT a eduall_user_accounts) é chamada por pedido só para obter o nome do operador; pode vir da sessão ou de cache por utilizador (sem a palavra-passe).",
            "ServicePayments.js: o ficheiro usa fim de linha CRLF (o script preserva); Se um dia se cachear GetServicePayments, só com TTL de 30–60 s e invalidando em Register/Update/Delete/DeleteServiceWithFees.",
        ]),
}

BASE_TODOS = [
    "Requer Functions/CacheRoutes.js com eduallGet (null se não existe), eduallSet(chave, valor, ttl) e eduallClear(padrão com `*` no fim) — exatamente como o v6 já usa.",
    "Se existirem outros controllers que escrevem nas mesmas tabelas (cursos/slides/posts do site, estantes, calendário de provas, comportamentos, serviços), a cache só se atualiza ao fim do TTL; "
    "para ser imediata, acrescentar neles `Cache.eduallClear(...)` com o padrão da entidade (`site:<escola>:*`, `bookcases:<escola>:*`, `examsCalendar:<escola>:*`, `studentBehavior:<escola>:*`, `services:<escola>:*`).",
    "🔥 Segredos no código (rodar e mover para variáveis de ambiente): SendSms.js (chave da Telcosms). Os do v6 continuam por tratar: Referralcontroller.js (Cloudinary), Replacetenant.js (palavra-passe da BD), SendEmail.js (textflow/RapidAPI). "
    "Mesmo depois de removidos do ficheiro, continuam no histórico do Git: rodar as chaves é obrigatório.",
]


# ═════════════════════════════════════════════════════════════════════════════
#  Índices (SQL gerado, nunca executado)
#  cada índice: (tabela, nome, [colunas])  ou  (tabela, nome, [colunas], "unique")
# ═════════════════════════════════════════════════════════════════════════════
INDEX_BLOCKS = [
    ("Shelves.js", [
        ("eduall_library_bookcases", "idx_bookcases_inst_del_order",
         ["ed_library_bookcase_institute_code", "ed_library_bookcase_deleted", "ed_library_bookcase_order"]),
        ("eduall_library_racks", "idx_racks_bookcase_inst", ["ed_library_rack_bookcase_id", "ed_library_rack_institute_code"]),
    ], ["EXPLAIN SELECT * FROM eduall_library_bookcases WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_institute_code = 'XXX' ORDER BY ed_library_bookcase_order, ed_library_bookcase_id;"],
     "O segundo índice serve o UPDATE de BookcaseDelete (soltar prateleiras por estante). Racks.js (v6) propõe outro índice composto na mesma tabela, com outra ordem de colunas: não colidem."),
    ("Services.js", [
        ("eduall_services", "idx_services_inst_del_title", ["ed_service_institute_code", "ed_service_deleted", "ed_service_title"]),
        ("eduall_coins", "idx_coins_inst", ["ed_coin_institute_code"]),
    ], ["EXPLAIN SELECT * FROM eduall_services WHERE ed_service_deleted = 0 AND ed_service_institute_code = 'XXX' ORDER BY ed_service_title;"],
     "O índice em eduall_coins serve o `LEFT JOIN eduall_coins ON ed_coin_institute_code = ?` (sem índice faz leitura total da tabela por pedido)."),
    ("StudentExamsCalendar.js", [
        ("eduall_student_exams", "idx_exams_inst_del_date",
         ["ed_student_exam_institute_code", "ed_student_exam_deleted", "ed_student_exam_date"]),
        ("eduall_student_exams", "idx_exams_class_del", ["ed_student_exam_class", "ed_student_exam_deleted"]),
    ], ["EXPLAIN SELECT * FROM eduall_student_exams WHERE ed_student_exam_deleted = 0 AND ed_student_exam_institute_code = 'XXX' ORDER BY ed_student_exam_date;"],
     "O segundo índice serve GetExamsCalendarByClass (que hoje nem filtra por escola)."),
    ("StudentBehavior.js", [
        ("eduall_student_behavior", "idx_behavior_inst_del", ["ed_student_behavior_instituteCode", "ed_student_behavior_deleted"]),
        ("eduall_student_behavior", "idx_behavior_student_inst_del",
         ["ed_student_behavior_Studentcode", "ed_student_behavior_instituteCode", "ed_student_behavior_deleted"]),
    ], ["EXPLAIN SELECT * FROM eduall_student_behavior WHERE ed_student_behavior_deleted = 0 AND ed_student_behavior_Studentcode = '1' AND ed_student_behavior_instituteCode = 'XXX';"], ""),
    ("SiteManager.js", [
        ("eduall_slides", "idx_slides_inst_del_order", ["ed_institute_code", "ed_deleted", "ed_order"]),
    ], ["EXPLAIN SELECT ed_id FROM eduall_slides WHERE ed_deleted = 0 AND ed_institute_code = 'XXX' ORDER BY ed_order, ed_id DESC;"],
     "As restantes tabelas do site já têm os índices certos no DDL de ensureSiteTables (idx_inst_del em cursos/posts, UNIQUE (escola) em contactos/branding/escola do site, UNIQUE (escola, idx) em secções)."),
    ("SendSms.js", [
        ("eduall_sms_records", "idx_sms_inst_date", ["ed_sms_record_instituteCode", "ed_sms_sent_date"]),
        ("eduall_sms_credits", "idx_smscred_inst", ["ed_sms_credit_institute_code"]),
    ], ["EXPLAIN SELECT * FROM eduall_sms_records WHERE ed_sms_record_instituteCode = 'XXX' ORDER BY ed_sms_sent_date;"],
     "Se não houver linhas de créditos duplicadas por escola, `idx_smscred_inst` pode ser UNIQUE (impede duas linhas de saldo para a mesma escola)."),
    ("StudentAttendance.js", [
        ("eduall_student_attendence", "idx_attd_inst_del", ["ed_student_attd_institute_code", "ed_student_attd_deleted"]),
        ("eduall_student_attendence", "idx_attd_stu_class_del",
         ["ed_student_attd_student_code", "ed_student_attd_class", "ed_student_attd_deleted"]),
        ("eduall_student_attendence", "idx_attd_teachsubclass_del", ["ed_student_attd_teacherSubClass", "ed_student_attd_deleted"]),
    ], ["EXPLAIN SELECT * FROM eduall_student_attendence WHERE ed_student_attd_deleted = 0 AND ed_student_attd_teacherSubClass = 1;"],
     "A tabela chama-se `attendence` (sic) no código: manter a grafia."),
    ("StudentEnrollment.js", [
        ("eduall_student_enrollment", "idx_enroll_inst_del", ["ed_enrollment_institute_code", "ed_student_enrollment_deleted"]),
        ("eduall_student_enrollment", "idx_enroll_stu_inst_del",
         ["ed_student_enrollment_studentcode", "ed_enrollment_institute_code", "ed_student_enrollment_deleted"]),
    ], ["EXPLAIN SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_studentcode = '1' AND ed_enrollment_institute_code = 'XXX';"],
     "Tabela partilhada com ServicePayments.js e Recicle.js: confirmar com SHOW INDEX (pode já existir um índice equivalente)."),
    ("StudentExams.js / StudentExamsAndFeaturesNotes.js", [
        ("eduall_student_exam_notes", "idx_sen_inst_stu_cls_sub_del",
         ["ed_student_exam_note_institute_code", "ed_student_exam_note_studentCode", "ed_student_exam_note_class",
          "ed_student_exam_note_subject", "ed_student_exam_note_deleted"]),
        ("eduall_student_exam_notes", "idx_sen_inst_cls_sub_del",
         ["ed_student_exam_note_institute_code", "ed_student_exam_note_class", "ed_student_exam_note_subject", "ed_student_exam_note_deleted"]),
        ("eduall_student_featured_notes", "idx_sfn_inst_stu_cls_sub_del",
         ["ed_student_featured_note_institute_code", "ed_student_featured_note_studentCode", "ed_student_featured_note_class",
          "ed_student_featured_note_subject", "ed_student_featured_note_deleted"]),
        ("eduall_student_featured_notes", "idx_sfn_inst_cls_sub_del",
         ["ed_student_featured_note_institute_code", "ed_student_featured_note_class", "ed_student_featured_note_subject", "ed_student_featured_note_deleted"]),
    ], ["EXPLAIN SELECT ed_student_exam_note_id FROM eduall_student_exam_notes WHERE ed_student_exam_note_studentCode = '1' AND ed_student_exam_note_class = 1 AND ed_student_exam_note_subject = 1 AND ed_student_exam_note_institute_code = 'XXX' AND ed_student_exam_note_deleted = 0;"],
     "Serve a verificação «já existe nota?» dos bulk upserts (a 1.ª de cada tabela) e as listas por turma+disciplina (a 2.ª). Os nomes de colunas são os de StudentExams.js; "
     "StudentExamsAndFeaturesNotes.js usa outros (ver TODO no relatório) — confirmar com SHOW COLUMNS antes de aplicar. Ideal: tornar a 1.ª UNIQUE para poder usar INSERT ... ON DUPLICATE KEY UPDATE "
     "(só se não existirem duplicados e depois de decidir como tratar as linhas eliminadas)."),
    ("StudentGradeHistory.js", [
        ("eduall_student_grade_history_records", "idx_ghr_hist_del", ["ed_ghr_history_id", "ed_ghr_deleted"]),
        ("eduall_student_grade_history_subjects", "idx_ghs_rec_del", ["ed_ghs_record_id", "ed_ghs_deleted"]),
    ], ["EXPLAIN SELECT * FROM eduall_student_grade_history_subjects WHERE ed_ghs_record_id IN (1,2,3) AND ed_ghs_deleted = 0;"],
     "As FOREIGN KEY já criam um índice no primeiro campo; o composto acrescenta `deleted` (opcional, ganho pequeno). O cabeçalho já tem UNIQUE (aluno, escola)."),
    ("StudenBalanceController.js", [
        ("eduall_student_balance", "uq_sb_student_inst", ["sb_student_id", "sb_institute_code"], "unique"),
        ("eduall_student_balance_logs", "idx_sbl_student_inst_date", ["sb_log_student_id", "sb_log_institute", "sb_log_date"]),
    ], ["EXPLAIN SELECT SUM(sb_log_amount) FROM eduall_student_balance_logs WHERE sb_log_student_id = 1 AND sb_log_institute = 'XXX';"],
     "O UNIQUE em eduall_student_balance é o que faz `ON DUPLICATE KEY UPDATE` de ensureBalanceRow funcionar: confirmar com SHOW INDEX antes. "
     "Se já houver linhas duplicadas (aluno, escola), juntar/apagar as duplicadas ANTES, ou a criação falha."),
    ("ServicePayments.js", [
        ("eduall_service_payments", "idx_sp_inst_del_date",
         ["ed_service_payment_institute_code", "ed_service_payment_deleted", "ed_service_payment_registerDate"]),
        ("eduall_service_payments", "idx_sp_student_inst", ["ed_service_payment_student_code", "ed_service_payment_institute_code"]),
        ("eduall_service_payments", "idx_sp_code", ["ed_service_payment_code"]),
    ], ["EXPLAIN SELECT ed_service_payment_id FROM eduall_service_payments WHERE ed_service_payment_deleted = 0 AND ed_service_payment_institute_code = 'XXX';"],
     "Os índices de eduall_service_payment_items (junção por código do pagamento) e de eduall_fees_payments não foram propostos: as colunas de ligação não aparecem por inteiro no código analisado — "
     "ver EXPLAIN de FetchServicePayments com dados reais. `COALESCE(deleted, 0) = 0` impede o uso do 1.º índice (ver TODO)."),
    ("SeedLibraryBooks.js", [
        ("eduall_library_books", "uq_book_external_inst", ["ed_library_book_external_id", "ed_library_book_institute_code"], "unique"),
    ], [],
     "Segundo o comentário do ficheiro (add_external_id_column.sql) esta UNIQUE KEY já deve existir: verificar com SHOW INDEX antes de a criar. É ela que impede duplicados quando duas importações correm em paralelo."),
]


def build_sql():
    lines = [
        "-- cache_indexes_v7.sql  (gerado por apply_cache_optimizations_v7.py — CACHE-OPT v7)",
        "-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.",
        "-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;",
        "-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;",
        "-- Nomes de colunas tirados do código dos controllers: se algum índice falhar com «Key column doesn't exist», a coluna tem outro nome.",
        "-- Nos ficheiros com índices UNIQUE: se a criação falhar com «Duplicate entry», há linhas duplicadas a resolver primeiro.",
        "-- SendEmail.js / SendEmailMessage.js / StudentEnrollmentConfirmation.js / StudentFeaturedNotes.js: índices já cobertos acima (notas) ou no v6 (emails); sem propostas novas.",
        "",
    ]
    seen_cols, seen_names = set(), set()
    for fname, idxs, explains, note in INDEX_BLOCKS:
        lines.append("-- " + "=" * 74)
        lines.append("-- %s" % fname)
        lines.append("-- " + "=" * 74)
        for idx in idxs:
            table, name, cols = idx[0], idx[1], idx[2]
            unique = len(idx) > 3 and idx[3] == "unique"
            key = (table, tuple(cols))
            if key in seen_cols or name in seen_names:
                lines.append("-- (já definido acima: %s em %s)" % (name, table))
                continue
            seen_cols.add(key)
            seen_names.add(name)
            lines.append("-- verificar antes: SHOW INDEX FROM %s;" % table)
            lines.append("CREATE %sINDEX %s ON %s (%s);" % ("UNIQUE " if unique else "", name, table, ", ".join(cols)))
        if note:
            lines.append("-- " + note)
        if explains:
            lines.append("-- validar:")
            lines.extend(explains)
        lines.append("")
    return "\n".join(lines) + "\n"


# ═════════════════════════════════════════════════════════════════════════════
#  Estado, I/O e utilitários
# ═════════════════════════════════════════════════════════════════════════════
class State(object):
    def __init__(self):
        self.changed, self.ignored, self.not_applied, self.errors, self.todos = [], [], [], [], []


def read_text(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    text = raw.decode("utf-8")
    crlf = "\r\n" in text
    if crlf:
        text = text.replace("\r\n", "\n")
    return raw, text, crlf


def write_text(path, text, crlf):
    if crlf:
        text = text.replace("\n", "\r\n")
    with open(path, "wb") as fh:
        fh.write(text.encode("utf-8"))


def walk_js(root):
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS and not d.startswith(".")]
        out.extend(os.path.join(dp, f) for f in fn if f.endswith(".js"))
    return sorted(out)


def rel(root, path):
    return os.path.relpath(path, root).replace("\\", "/")


NODE = shutil.which("node")


def node_check(path):
    if not NODE:
        return True, "node não encontrado (verificação ignorada)"
    r = subprocess.run([NODE, "--check", path], capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or r.stdout).strip()


def node_check_text(basename, text):
    if not NODE:
        return True, "node não encontrado (verificação ignorada)"
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, basename)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        return node_check(p)


def print_diff(name, old, new):
    sys.stdout.write("".join(difflib.unified_diff(
        old.splitlines(True), new.splitlines(True), fromfile="a/" + name, tofile="b/" + name)))
    sys.stdout.write("\n")


def backup_file(path, root, backup_dir):
    dest = os.path.join(backup_dir, rel(root, path))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(path, dest)


def process_controllers(root, files, only, dry, no_backup, backup_dir, state):
    seen = set()
    for p in files:
        base, r = os.path.basename(p), rel(root, p)
        if base not in RECIPES and base not in NO_CHANGE:
            continue
        if only and not (base == only or r.endswith(only.replace("\\", "/"))):
            continue
        seen.add(base)
        if base in NO_CHANGE:
            why, todos = NO_CHANGE[base]
            state.ignored.append((r, why))
            state.todos.extend(todos)
            continue
        sig, recipe = RECIPES[base]
        raw, text, crlf = read_text(p)
        if MARKER_TAG in text:
            state.ignored.append((r, "já aplicado, ignorado"))
            continue
        if sig not in text:
            state.not_applied.append((r, "não aplicado: assinatura `%s` não encontrada no ficheiro" % sig))
            continue
        ok0, msg0 = node_check_text(base, text)
        if not ok0:
            state.not_applied.append((r, "não aplicado: o ficheiro ORIGINAL já não passa `node --check` (corrigir primeiro): %s"
                                      % " | ".join(l.strip() for l in msg0.splitlines() if l.strip())[:220]))
            continue
        try:
            new_text, changes, todos = recipe(text)
        except AnchorError as exc:
            state.not_applied.append((r, "não aplicado: %s" % exc))
            continue
        new_text = add_marker(new_text)

        if dry:
            print("=" * 78)
            print("[dry-run] %s" % r)
            print("=" * 78)
            print_diff(r, text, new_text)
            ok, msg = node_check_text(base, new_text)
            if not ok:
                state.errors.append((r, "node --check falharia: %s" % msg))
                continue
            state.changed.append((r, changes + ["(dry-run: nada foi escrito)"]))
            state.todos.extend(todos)
            continue

        if not no_backup:
            backup_file(p, root, backup_dir)
        write_text(p, new_text, crlf)
        ok, msg = node_check(p)
        if not ok:
            with open(p, "wb") as fh:
                fh.write(raw)
            state.errors.append((r, "node --check falhou, original restaurado: %s" % msg))
            continue
        state.changed.append((r, changes))
        state.todos.extend(todos)

    if not only:
        missing = sorted((set(RECIPES) | set(NO_CHANGE)) - seen)
        for name in missing:
            state.not_applied.append((name, "ficheiro não encontrado em --root (nada a fazer)"))


def all_todos(state):
    seen, out = set(), []
    for t in state.todos + BASE_TODOS:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def build_report(state):
    L = ["# CACHE_REPORT_V7 — CACHE-OPT v7", "",
         "Gerado por `apply_cache_optimizations_v7.py`. Nenhum SQL foi executado.", "",
         "## 1. Estado por ficheiro", "", "| Ficheiro | Estado | Detalhe |", "|---|---|---|"]
    for name, ch in state.changed:
        L.append("| `%s` | alterado | %s |" % (name, "; ".join(ch)))
    for name, why in state.ignored:
        L.append("| `%s` | ignorado | %s |" % (name, why))
    for name, why in state.not_applied:
        L.append("| `%s` | não aplicado | %s |" % (name, why))
    for name, why in state.errors:
        L.append("| `%s` | ERRO | %s |" % (name, why))
    L += ["", "## 2. Chaves de cache criadas / alteradas", "",
          "| Família | Chaves | TTL |", "|---|---|---|",
          "| `bookcases:<escola>:` | list, single:<id> | 600 s |",
          "| `services:<escola>:` | list, single:<id> (chaves corrigidas; antes `services:list:<escola>:<user>`) | 3600 s (já existia) |",
          "| `examsCalendar:<escola>:` | list, blocks | 120 s |",
          "| `studentBehavior:<escola>:` | list | 120 s |",
          "| `site:<escola>:` | contacts, courses, slides, sections, branding, posts, settings | 300 s |",
          "| `site:global:` | templates (sem escola) | 600 s |",
          "| `publishers:<escola>:` | (do v6) agora também limpa no fim de SeedLibraryBooks | — |",
          "", "## 3. TODOs manuais", ""]
    L += ["- [ ] " + t for t in all_todos(state)]
    L += ["", "## 4. Riscos conhecidos", "",
          "- Cada escrita invalida a família inteira da escola (simples e seguro, mas apaga também entradas que não mudaram).",
          "- Dados que mudam noutros controllers (turmas, disciplinas, horários, funcionários, moeda/fornecedores) só aparecem nas listas cacheadas depois do TTL.",
          "- Notas, presenças, matrículas, saldos, pagamentos, SMS e emails NÃO foram cacheados de propósito (dados que têm de aparecer de imediato e que mudam por vários caminhos).",
          "- listPosts (SiteManager) guarda em cache o HTML completo de todos os posts da escola: vigiar a memória do Redis/processo.",
          "- Services.js: as chaves antigas ficam órfãs até expirarem (3600 s); a primeira leitura depois de aplicar vai à base de dados.",
          "- A invalidação corre imediatamente antes da resposta, DEPOIS da auditoria: se RegisterAuditAction lançar um erro, a escrita já está feita mas a cache só expira ao fim do TTL.",
          "- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.",
          "", "## 5. Como validar", "",
          "1. Reiniciar a aplicação e abrir duas vezes uma lista (ex.: estantes): o 2.º pedido não deve gerar consulta SQL.",
          "2. Criar/editar/apagar uma estante, um serviço, uma prova ou um slide e confirmar que a lista mostra logo a alteração.",
          "3. Serviços: editar um serviço com o utilizador A e abrir a lista com o utilizador B da mesma escola: B tem de ver a alteração de imediato (antes só ao fim de 1 h).",
          "4. Editar a ficha de um serviço e reabrir a ficha individual (GetSingleService): deve mostrar os dados novos.",
          "5. Correr a importação de livros e confirmar que as editoras novas aparecem logo na lista de editoras.",
          "", "## 6. Como reverter", "",
          "Copiar os ficheiros de `.cache_backup/<timestamp>_v7/` de volta (mesma estrutura).", ""]
    return "\n".join(L) + "\n"


def write_if_changed(path, content):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            if fh.read() == content:
                return False
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
    return True


def print_summary(state, dry):
    bar = "=" * 78
    print(bar)
    print("RELATÓRIO FINAL%s" % (" (dry-run: nada foi escrito)" if dry else ""))
    print(bar)
    print("\nFicheiros alterados (%d):" % len(state.changed))
    for name, ch in state.changed:
        print("  + %s" % name)
        for c in ch:
            print("      - %s" % c)
    print("\nFicheiros ignorados (%d):" % len(state.ignored))
    for name, why in state.ignored:
        print("  = %s: %s" % (name, why))
    print("\nAlterações não aplicadas (%d):" % len(state.not_applied))
    for name, why in state.not_applied:
        print("  ! %s: %s" % (name, why))
    if state.errors:
        print("\nERROS (%d):" % len(state.errors))
        for name, why in state.errors:
            print("  X %s: %s" % (name, why))
    print("\nTODOs manuais:")
    for t in all_todos(state):
        print("  [ ] %s" % t)
    print()


def main():
    ap = argparse.ArgumentParser(description="Aplica cache e gera índices (CACHE-OPT v7).")
    ap.add_argument("--root", default=".", help="raiz do projeto (por defeito .)")
    ap.add_argument("--dry-run", action="store_true", help="mostra diffs e não escreve nada")
    ap.add_argument("--only", default=None, help="processa só este ficheiro (nome ou caminho relativo)")
    ap.add_argument("--no-backup", action="store_true", help="não cria .cache_backup/")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print("Erro: --root %s não é uma pasta." % root)
        return 2

    state = State()
    backup_dir = os.path.join(root, ".cache_backup", datetime.now().strftime("%Y%m%d_%H%M%S") + "_v7")
    files = walk_js(root)
    print("Raiz: %s | %d ficheiros .js analisados | node: %s" % (root, len(files), NODE or "não encontrado"))

    process_controllers(root, files, args.only, args.dry_run, args.no_backup, backup_dir, state)

    if args.dry_run:
        print("[dry-run] cache_indexes_v7.sql e CACHE_REPORT_V7.md NÃO foram escritos.")
    else:
        print("Escrito: cache_indexes_v7.sql" if write_if_changed(os.path.join(root, "cache_indexes_v7.sql"), build_sql())
              else "cache_indexes_v7.sql: já aplicado, ignorado")
        rep = os.path.join(root, "CACHE_REPORT_V7.md")
        if state.changed or not os.path.exists(rep):
            write_if_changed(rep, build_report(state))
            print("Escrito: CACHE_REPORT_V7.md")
        else:
            print("CACHE_REPORT_V7.md: mantido (nenhuma alteração nesta execução)")
        if state.changed and not args.no_backup and os.path.isdir(backup_dir):
            print("Backup em: %s" % backup_dir)

    print_summary(state, args.dry_run)
    return 1 if state.errors else 0


if __name__ == "__main__":
    sys.exit(main())