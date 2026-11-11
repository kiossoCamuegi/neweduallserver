// CACHE-OPT v7 (aplicado por apply_cache_optimizations_v7.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v7: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");
const fs = require("fs");
const path = require("path");

// ─── CONFIGURAÇÃO ───────────────────────────────────────────────────────────
const MIN_BOOKS = 100;
const IMAGES_DIR = path.join(__dirname, "../images/books"); // mesmo diretório usado pelo multer em uploadBookCover
const DEFAULT_INSTITUTE_CODE = process.env.INSTITUTE_CODE || "INST-0001"; // usado só quando corre sem req (standalone)
const SUBJECTS = [
  "fiction",
  "fantasy",
  "science_fiction",
  "history",
  "romance",
  "biography",
  "poetry",
  "mystery_and_detective_stories",
];

// ─── CONTEXTO (real, vindo de req/res, ou falso para correr standalone) ───────
function buildFakeContext() {
  const fakeRes = {
    status() { return this; },
    json(payload) {
      if (payload && payload.success === false) {
        console.error("\n  Erro na query:", payload.message || payload);
      }
      return this;
    },
  };
  const fakeReq = {
    session: {
      user: {
        eduall_user_session_curentinstitute: DEFAULT_INSTITUTE_CODE,
        eduall_user_session_id: null,
      },
    },
  };
  return { fakeReq, fakeRes };
}

// ─── PROGRESSO EM TEMPO REAL ──────────────────────────────────────────────────
function printProgress(state) {
  const { total, processed, loaded, failed, skipped, current } = state;
  const line = `Progresso: ${processed}/${total} | ✓ carregados: ${loaded} | ✗ falhados: ${failed} | ↷ ignorados: ${skipped}` +
    (current ? ` | atual: ${current.slice(0, 40)}` : "");
  process.stdout.write(`\r${line.padEnd(140, " ")}`);
}

// ─── OPEN LIBRARY (mesma API usada no catálogo HTML) ──────────────────────────
function coverUrl(coverId, size = "L") {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

async function fetchBooksBySubject(subject, limit = 30) {
  const url = `https://openlibrary.org/subjects/${subject}.json?limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.works || []).map((w) => ({
      externalId: w.key,
      title: w.title,
      author: (w.authors && w.authors[0] && w.authors[0].name) || "Autor desconhecido",
      year: w.first_publish_year || null,
      coverId: w.cover_id || null,
      subjects: (w.subject || []).slice(0, 5),
    }));
  } catch (err) {
    console.error(`  ✗ Falha de rede ao contactar Open Library (categoria "${subject}"): ${err.message}`);
    return [];
  }
}

async function downloadCover(coverId, destPath) {
  const url = coverUrl(coverId, "L");
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return destPath;
  } catch (err) {
    return null;
  }
}

function slugFileName() {
  return `book_${Date.now()}_${Math.random().toString().slice(2, 8)}.jpg`;
}

// ─── AUTORES ────────────────────────────────────────────────────────────────
async function getOrCreateAuthor(req, res, authorName, instituteCode) {
  const cleanName = authorName.trim();

  const checkQuery = `
    SELECT ed_library_author_id FROM eduall_library_authors
    WHERE ed_library_author_deleted = 0
      AND LOWER(TRIM(ed_library_author_name)) = LOWER(TRIM(?))
      AND ed_library_author_institute_code = ?
    LIMIT 1
  `;
  const existing = await ExecuteQuery(res, checkQuery, [cleanName, instituteCode], true, {
    db: "eduall_library_authors", type: "select", data: req,
  });

  if (existing && existing.length > 0) {
    return existing[0].ed_library_author_id;
  }

  const insertQuery = `
    INSERT INTO eduall_library_authors (
      ed_library_author_name,
      ed_library_author_pseudonym,
      ed_library_author_nationality,
      ed_library_author_birthdate,
      ed_library_author_biography,
      ed_library_author_picture,
      ed_library_author_status,
      ed_library_author_institute_code
    ) VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `;
  const result = await ExecuteQuery(res, insertQuery, [cleanName, 1, instituteCode], false, {
    db: "eduall_library_authors", type: "insert", data: req,
  });

  await RegisterAuditAction({
    session: req.session,
    action: 1,
    form: "Autor",
    description: `Registou o autor "${cleanName}" (importação automática)`,
  });

  return result.insertId;
}

// ─── LOOKUP GENÉRICO (get-or-create) ──────────────────────────────────────────
// Usado para tabelas de apoio como eduall_library_typeofbooks, onde o livro
// precisa de um ID válido (a coluna é NOT NULL) mas a API Open Library não
// fornece essa informação. Cria um registo por omissão se ainda não existir.
async function getOrCreateLookupId(req, res, { table, idColumn, nameColumn, instituteColumn, deletedColumn, defaultName, instituteCode, extraColumns = [], extraValues = [] }) {
  const checkQuery = `
    SELECT ${idColumn} AS id FROM ${table}
    WHERE ${deletedColumn} = 0
      AND LOWER(TRIM(${nameColumn})) = LOWER(TRIM(?))
      AND ${instituteColumn} = ?
    LIMIT 1
  `;
  const existing = await ExecuteQuery(res, checkQuery, [defaultName, instituteCode], true, {
    db: table, type: "select", data: req,
  });

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  const allColumns = [nameColumn, ...extraColumns, instituteColumn];
  const placeholders = allColumns.map(() => "?").join(", ");
  const insertQuery = `INSERT INTO ${table} (${allColumns.join(", ")}) VALUES (${placeholders})`;
  const result = await ExecuteQuery(res, insertQuery, [defaultName, ...extraValues, instituteCode], false, {
    db: table, type: "insert", data: req,
  });

  console.log(`  + Registo criado em ${table}: "${defaultName}"`);
  return result.insertId;
}

// ─── LIVROS ─────────────────────────────────────────────────────────────────
// Nota: a proteção definitiva contra duplicados é a UNIQUE KEY
// (ed_library_book_external_id, ed_library_book_institute_code) na BD
// — ver add_external_id_column.sql. Isto evita duplicados mesmo que duas
// execuções corram ao mesmo tempo (condição de corrida), o que um SELECT
// prévio sozinho não garante.
const DUPLICATE_ENTRY_ERRNO = "ER_DUP_ENTRY";

async function registerBook(req, res, book, authorId, typeId, publisherId, providerId, picturePath, instituteCode) {
  const query = `
    INSERT INTO eduall_library_books (
      ed_library_book_external_id,
      ed_library_book_title,
      ed_library_book_type,
      ed_library_book_publisher,
      ed_library_book_colection,
      ed_library_book_place_of_publication,
      ed_library_book_classification,
      ed_library_book_copy,
      ed_library_book_subtitle,
      ed_library_book_author,
      ed_library_book_subject,
      ed_library_book_price,
      ed_library_book_year,
      ed_library_book_acquisition_date,
      ed_library_book_acquisition_type,
      ed_library_book_provider,
      ed_library_book_pages,
      ed_library_book_rack,
      ed_library_book_notes,
      ed_library_book_picture,
      ed_library_book_institute_code
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, NULL, ?, ?, 0.00, ?, CURDATE(), 'Importação automática', ?, NULL, NULL, NULL, ?, ?)
  `;

  const PARAMS = [
    book.externalId,
    book.title,
    typeId,
    publisherId,
    authorId,
    book.subjects.join(", "),
    book.year,
    providerId,
    picturePath,
    instituteCode,
  ];

  // ExecuteQuery normalmente responde via res.json em caso de erro em vez de
  // rejeitar a promise; por isso tentamos apanhar ambos os casos.
  let result;
  try {
    result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_books", type: "insert", data: req,
    });
  } catch (err) {
    if (err && (err.code === DUPLICATE_ENTRY_ERRNO || err.errno === 1062)) {
      return { duplicate: true };
    }
    throw err;
  }

  if (!result || !result.insertId) {
    // Alguns wrappers de ExecuteQuery devolvem null/erro estruturado em vez de lançar exceção
    return { duplicate: true };
  }

  await RegisterAuditAction({
    session: req.session,
    action: 1,
    form: "Livro",
    description: `Registou o livro "${book.title}" (importação automática)`,
  });

  return { duplicate: false, insertId: result.insertId };
}

// ─── LOCK DE EXECUÇÃO ──────────────────────────────────────────────────────
// Evita que duas execuções (ex: cron + execução manual) corram ao mesmo tempo
// no mesmo servidor. Se o processo anterior morrer sem limpar o lock, um lock
// mais antigo que LOCK_MAX_AGE_MS é considerado "preso" e é ignorado.
const LOCK_FILE = path.join(__dirname, ".seed-books.lock");
const LOCK_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (age < LOCK_MAX_AGE_MS) {
      return false; // já há uma importação a decorrer
    }
    console.warn("Lock antigo encontrado (processo anterior pode ter falhado) — a ignorar e continuar.");
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

// ─── FUNÇÃO ÚNICA — corre sozinha e mostra progresso em tempo real ────────────
/**
 * Importa livros da Open Library, cria autores em falta e regista tudo na BD,
 * mostrando o progresso em tempo real na consola (carregados / falhados / ignorados).
 *
 * Pode ser chamada de duas formas:
 *   1. Automaticamente, sem argumentos — usa DEFAULT_INSTITUTE_CODE (env INSTITUTE_CODE).
 *   2. Passando um req autenticado — usa a instituição do utilizador logado
 *      (req.session.user.eduall_user_session_curentinstitute).
 *
 * @param {import('express').Request} [req] Opcional. Se omitido, corre standalone.
 * @param {import('express').Response} [res] Opcional. Se omitido, corre standalone.
 */
async function SeedLibraryBooksFromOpenLibrary(req, res) {
  if (!acquireLock()) {
    console.log("Já existe uma importação a decorrer neste servidor — a saltar esta execução.");
    return { skippedRun: true };
  }

  try {
    let ctxReq = req;
    let ctxRes = res;

    if (!ctxReq || !ctxReq.session || !ctxReq.session.user) {
      const fake = buildFakeContext();
      ctxReq = fake.fakeReq;
      ctxRes = fake.fakeRes;
      console.log(`A correr em modo automático (sem sessão) — instituto: ${DEFAULT_INSTITUTE_CODE}\n`);
    }

    const instituteCode = ctxReq.session.user.eduall_user_session_curentinstitute;

    // Verificação de conectividade antes de começar — evita gastar tempo
    // se a Open Library estiver inacessível (DNS, firewall, sem internet).
    try {
      const ping = await fetch("https://openlibrary.org", { method: "HEAD" });
      if (!ping.ok) throw new Error(`Resposta HTTP ${ping.status}`);
    } catch (err) {
      console.error(`\nNão foi possível contactar a Open Library: ${err.message}`);
      console.error("Verifica a ligação à internet / DNS deste servidor e tenta novamente.\n");
      return { error: "network_unreachable", detail: err.message };
    }

    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }

    console.log("A obter lista de livros da Open Library...");
    let allBooks = [];
    for (const subject of SUBJECTS) {
      const books = await fetchBooksBySubject(subject, 30);
      allBooks = allBooks.concat(books);
      if (allBooks.length >= MIN_BOOKS) break;
    }

    const seen = new Set();
    allBooks = allBooks.filter((b) => {
      if (!b.title || !b.externalId || seen.has(b.externalId)) return false;
      seen.add(b.externalId);
      return true;
    }).slice(0, MIN_BOOKS);

    console.log(`Livros obtidos da API: ${allBooks.length}. A iniciar importação...\n`);

    const defaultTypeId = await getOrCreateLookupId(ctxReq, ctxRes, {
      table: "eduall_library_typeofbooks",
      idColumn: "ed_library_typeofbook_id",
      nameColumn: "ed_library_typeofbook_name",
      instituteColumn: "ed_library_typeofbook_institute_code",
      deletedColumn: "ed_library_typeofbook_deleted",
      defaultName: "Importado automaticamente",
      instituteCode,
    });

    const defaultPublisherId = await getOrCreateLookupId(ctxReq, ctxRes, {
      table: "eduall_library_publishers",
      idColumn: "ed_library_publisher_id",
      nameColumn: "ed_library_publisher_name",
      instituteColumn: "ed_library_publisher_institute_code",
      deletedColumn: "ed_library_publisher_deleted",
      defaultName: "Editor anónimo",
      instituteCode,
      extraColumns: ["ed_library_publisher_status"],
      extraValues: [1],
    });

    const defaultProviderId = await getOrCreateLookupId(ctxReq, ctxRes, {
      table: "eduall_library_providers",
      idColumn: "ed_library_provider_id",
      nameColumn: "ed_library_provider_name",
      instituteColumn: "ed_library_provider_institute_code",
      deletedColumn: "ed_library_provider_deleted",
      defaultName: "Fornecedor anónimo",
      instituteCode,
      extraColumns: ["ed_library_provider_status"],
      extraValues: [1],
    });

    const state = { total: allBooks.length, processed: 0, loaded: 0, failed: 0, skipped: 0, current: null, registered: [], failedItems: [], skippedItems: [] };
    printProgress(state);

    for (const book of allBooks) {
      state.current = book.title;
      printProgress(state);

      try {
        const authorId = await getOrCreateAuthor(ctxReq, ctxRes, book.author, instituteCode);

        let relativePicturePath = null;
        if (book.coverId) {
          const fileName = slugFileName();
          const destPath = path.join(IMAGES_DIR, fileName);
          const saved = await downloadCover(book.coverId, destPath);
          if (saved) relativePicturePath = `images/books/${fileName}`;
        }

        const outcome = await registerBook(ctxReq, ctxRes, book, authorId, defaultTypeId, defaultPublisherId, defaultProviderId, relativePicturePath, instituteCode);
        if (outcome.duplicate) {
          state.skipped++;
          state.skippedItems.push({ title: book.title, externalId: book.externalId, motivo: "já existia (duplicado)" });
        } else {
          state.loaded++;
          state.registered.push({ id: outcome.insertId, title: book.title, externalId: book.externalId, author: book.author, year: book.year });
        }
      } catch (err) {
        state.failed++;
        state.failedItems.push({ title: book.title, externalId: book.externalId, erro: err.message });
        process.stdout.write(`\n  ✗ Falhou "${book.title}": ${err.message}\n`);
      }

      state.processed++;
      printProgress(state);
    }

    state.current = null;
    printProgress(state);

    console.log(
      `\n\nConcluído — instituto "${instituteCode}": ` +
      `${state.loaded} carregados, ${state.failed} falharam, ${state.skipped} ignorados (já existiam).`
    );

    if (state.registered.length > 0) {
      console.log(`\n✓ Livros registados (${state.registered.length}):`);
      console.table(state.registered.map((r) => ({ ID: r.id, Título: r.title, Ano: r.year, Autor: r.author })));
    }

    if (state.failedItems.length > 0) {
      console.log(`\n✗ Livros que falharam (${state.failedItems.length}):`);
      console.table(state.failedItems.map((f) => ({ Título: f.title, Erro: f.erro })));
    }

    if (state.skippedItems.length > 0) {
      console.log(`\n↷ Livros ignorados por já existirem (${state.skippedItems.length}):`);
      console.table(state.skippedItems.map((s) => ({ Título: s.title })));
    }

    await _cacheClear(`publishers:${instituteCode}:*`);  // CACHE-OPT v7: a importação cria editoras -> lista em cache (v6) inválida
    const reportPath = path.join(__dirname, `seed-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      instituteCode,
      executedAt: new Date().toISOString(),
      totals: { loaded: state.loaded, failed: state.failed, skipped: state.skipped, total: state.total },
      registered: state.registered,
      failed: state.failedItems,
      skipped: state.skippedItems,
    }, null, 2));
    console.log(`\nRelatório completo guardado em: ${reportPath}`);

    return {
      loaded: state.loaded,
      failed: state.failed,
      skipped: state.skipped,
      total: state.total,
      registered: state.registered,
      failedItems: state.failedItems,
      skippedItems: state.skippedItems,
      reportPath,
    };
  } catch (err) {
    console.error(`\nErro inesperado na importação: ${err.message}`);
    return { error: "unexpected_error", detail: err.message };
  } finally {
    releaseLock();
  }
}

module.exports = { SeedLibraryBooksFromOpenLibrary };

 