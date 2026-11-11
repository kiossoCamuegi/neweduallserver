// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

const BOOK_COLLECTION_CACHE_TTL = 3600;

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchBookCollections = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_library_collections
    WHERE ed_library_collection_deleted = 0
      AND ed_library_collection_institute_code = ?
    ORDER BY ed_library_collection_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_collections",
    type: "select",
    data: req,
  });
};

// ─── GET todas as coleções ───────────────────────────────────────────────────
const GetBookCollections = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await Cache.eduallWithCache(
      CacheKeys.bookCollection.list(instituteCode),
      BOOK_COLLECTION_CACHE_TTL,
      () => FetchBookCollections(req, res, instituteCode)
    );
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar coleções de livros!", error: error.message });
  }
};

// ─── GET coleção individual ──────────────────────────────────────────────────
const GetSingleBookCollection = async (req, res) => {
  try {
    const { ID } = req.params;
    const recordId = CacheKeys.parseId(ID);
    if (recordId === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Lista pequena: filtra a partir da lista em cache (uma só chave para invalidar)
    const list = await Cache.eduallWithCache(
      CacheKeys.bookCollection.list(instituteCode),
      BOOK_COLLECTION_CACHE_TTL,
      () => FetchBookCollections(req, res, instituteCode)
    );
    const rows = (list || []).filter((row) => Number(row.ed_library_collection_id) === recordId);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Coleção de livros não encontrada." });
    }
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar coleção de livros!", error: error.message });
  }
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateBookCollectionFields = (body) => {
  const errors = [];

  if (!body.collection_title || body.collection_title.trim() === "")
    errors.push("Título da coleção é obrigatório.");

  if (body.collection_title && body.collection_title.trim().length < 2)
    errors.push("Título da coleção deve ter pelo menos 2 caracteres.");

  return errors;
};

// ─── POST registar coleção ───────────────────────────────────────────────────
const RegisterBookCollection = async (req, res) => {
  try {
    const { collection_title } = req.body;

    // Validações
    const errors = ValidateBookCollectionFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_library_collection_id FROM eduall_library_collections
      WHERE ed_library_collection_deleted = 0
        AND LOWER(TRIM(ed_library_collection_title)) = LOWER(TRIM(?))
        AND ed_library_collection_institute_code = ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [collection_title.trim(), instituteCode], true, {
      db: "eduall_library_collections",
      type: "select",
      data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe uma coleção com o título "${collection_title.trim()}".` });

    const query = `
      INSERT INTO eduall_library_collections (ed_library_collection_title, ed_library_collection_institute_code) 
      VALUES (?, ?)
    `;
    const PARAMS = [collection_title.trim(), instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_collections",
      type: "insert",
      data: req,
    });

    // Registrar auditoria para a ação de registro
    await RegisterAuditAction({
      session: req.session,
      action: 1, // Ação de registro
      form: "Coleção de Livro",
      description: `Registrou a coleção de livros "${collection_title.trim()}".`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterBookCollection: coleção "${collection_title.trim()}" registada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCollection.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Coleção de livros registada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registrar coleção de livros!", error: error.message });
  }
};

// ─── PUT atualizar coleção ───────────────────────────────────────────────────
const BookCollectionUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { collection_title } = req.body;

    // Validações
    const errors = ValidateBookCollectionFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único (excluindo o próprio registo)
    const checkQuery = `
      SELECT ed_library_collection_id FROM eduall_library_collections
      WHERE ed_library_collection_deleted = 0
        AND LOWER(TRIM(ed_library_collection_title)) = LOWER(TRIM(?))
        AND ed_library_collection_institute_code = ?
        AND ed_library_collection_id != ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [collection_title.trim(), instituteCode, ID], true, {
      db: "eduall_library_collections",
      type: "select",
      data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe outra coleção com o título "${collection_title.trim()}".` });

    const query = `
      UPDATE eduall_library_collections 
      SET ed_library_collection_title = ? 
      WHERE ed_library_collection_deleted = 0 
        AND ed_library_collection_id = ? 
        AND ed_library_collection_institute_code = ?
    `;
    const PARAMS = [collection_title.trim(), ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_collections",
      type: "update",
      data: req,
    });

    // Registrar auditoria para a ação de atualização
    await RegisterAuditAction({
      session: req.session,
      action: 2, // Ação de atualização
      form: "Coleção de Livro",
      description: `Atualizou a coleção de livros com ID "${ID}" para "${collection_title.trim()}".`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BookCollectionUpdate: registo ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCollection.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Coleção de livros atualizada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar coleção de livros!", error: error.message });
  }
};

// ─── DELETE (soft-delete) coleção ────────────────────────────────────────────
const BookCollectionDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_library_collection_title FROM eduall_library_collections
      WHERE ed_library_collection_deleted = 0
        AND ed_library_collection_id = ?
        AND ed_library_collection_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_library_collections",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Coleção de livros não encontrada ou já foi removida." });

    const collectionTitle = found[0].ed_library_collection_title;

    const query = `
      UPDATE eduall_library_collections 
      SET ed_library_collection_deleted = 1
      WHERE ed_library_collection_deleted = 0 
        AND ed_library_collection_id = ? 
        AND ed_library_collection_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_collections",
      type: "update",
      data: req,
    });

    // Registrar auditoria para a ação de deleção
    await RegisterAuditAction({
      session: req.session,
      action: 3, // Ação de deleção
      form: "Coleção de Livro",
      description: `Deletou a coleção de livros "${collectionTitle}" (ID: ${ID}).`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BookCollectionDelete: registo ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCollection.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Coleção de livros removida com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao excluir coleção de livros!", error: error.message });
  }
};

module.exports = {
  GetBookCollections,
  GetSingleBookCollection,
  RegisterBookCollection,
  BookCollectionDelete,
  BookCollectionUpdate,
};