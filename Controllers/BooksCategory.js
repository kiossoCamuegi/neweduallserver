// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

const BOOK_CATEGORY_CACHE_TTL = 3600;

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchBookCategories = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_library_categories
    WHERE ed_library_category_deleted = 0
      AND ed_library_category_institute_code = ?
    ORDER BY ed_library_category_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_categories",
    type: "select",
    data: req,
  });
};

// ─── GET todas as categorias ──────────────────────────────────────────────────
const GetBookCategories = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await Cache.eduallWithCache(
      CacheKeys.bookCategory.list(instituteCode),
      BOOK_CATEGORY_CACHE_TTL,
      () => FetchBookCategories(req, res, instituteCode)
    );
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar categorias de livros!", error: error.message });
  }
};

// ─── GET categoria individual ─────────────────────────────────────────────────
const GetSingleBookCategory = async (req, res) => {
  try {
    const { ID } = req.params;
    const recordId = CacheKeys.parseId(ID);
    if (recordId === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Lista pequena: filtra a partir da lista em cache (uma só chave para invalidar)
    const list = await Cache.eduallWithCache(
      CacheKeys.bookCategory.list(instituteCode),
      BOOK_CATEGORY_CACHE_TTL,
      () => FetchBookCategories(req, res, instituteCode)
    );
    const rows = (list || []).filter((row) => Number(row.ed_library_category_id) === recordId);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Categoria de livro não encontrada." });
    }
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar categoria de livro!", error: error.message });
  }
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateBookCategoryFields = (body) => {
  const errors = [];

  if (!body.category_title || body.category_title.trim() === "")
    errors.push("Título da categoria é obrigatório.");

  if (body.category_title && body.category_title.trim().length < 2)
    errors.push("Título da categoria deve ter pelo menos 2 caracteres.");

  return errors;
};

// ─── POST registar categoria ──────────────────────────────────────────────────
const RegisterBookCategory = async (req, res) => {
  try {
    const { category_title } = req.body;

    // Validações
    const errors = ValidateBookCategoryFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_library_category_id FROM eduall_library_categories
      WHERE ed_library_category_deleted = 0
        AND LOWER(TRIM(ed_library_category_title)) = LOWER(TRIM(?))
        AND ed_library_category_institute_code = ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [category_title.trim(), instituteCode], true, {
      db: "eduall_library_categories",
      type: "select",
      data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe uma categoria com o título "${category_title.trim()}".` });

    const query = `
      INSERT INTO eduall_library_categories (ed_library_category_title, ed_library_category_institute_code) 
      VALUES (?, ?)
    `;
    const PARAMS = [category_title.trim(), instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_categories",
      type: "insert",
      data: req,
    });

    // Registrar auditoria para a ação de registro
    await RegisterAuditAction({
      session: req.session,
      action: 1, // Ação de registro
      form: "Categoria de Livro",
      description: `Registou a categoria de livro "${category_title.trim()}".`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterBookCategory: categoria "${category_title.trim()}" registada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCategory.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Categoria de livro registada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar categoria de livro!", error: error.message });
  }
};

// ─── PUT atualizar categoria ──────────────────────────────────────────────────
const BookCategoryUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { category_title } = req.body;

    // Validações
    const errors = ValidateBookCategoryFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único (excluindo o próprio registo)
    const checkQuery = `
      SELECT ed_library_category_id FROM eduall_library_categories
      WHERE ed_library_category_deleted = 0
        AND LOWER(TRIM(ed_library_category_title)) = LOWER(TRIM(?))
        AND ed_library_category_institute_code = ?
        AND ed_library_category_id != ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [category_title.trim(), instituteCode, ID], true, {
      db: "eduall_library_categories",
      type: "select",
      data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe outra categoria com o título "${category_title.trim()}".` });

    const query = `
      UPDATE eduall_library_categories 
      SET ed_library_category_title = ? 
      WHERE ed_library_category_deleted = 0 
        AND ed_library_category_id = ? 
        AND ed_library_category_institute_code = ?
    `;
    const PARAMS = [category_title.trim(), ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_categories",
      type: "update",
      data: req,
    });

    // Registrar auditoria para a ação de atualização
    await RegisterAuditAction({
      session: req.session,
      action: 2, // Ação de atualização
      form: "Categoria de Livro",
      description: `Atualizou a categoria de livro com ID "${ID}" para "${category_title.trim()}".`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BookCategoryUpdate: registo ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCategory.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Categoria de livro atualizada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar categoria de livro!", error: error.message });
  }
};

// ─── DELETE (soft-delete) categoria ───────────────────────────────────────────
const BookCategoryDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_library_category_title FROM eduall_library_categories
      WHERE ed_library_category_deleted = 0
        AND ed_library_category_id = ?
        AND ed_library_category_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_library_categories",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Categoria de livro não encontrada ou já foi removida." });

    const categoryTitle = found[0].ed_library_category_title;

    const query = `
      UPDATE eduall_library_categories 
      SET ed_library_category_deleted = 1
      WHERE ed_library_category_deleted = 0 
        AND ed_library_category_id = ? 
        AND ed_library_category_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_categories",
      type: "update",
      data: req,
    });

    // Registrar auditoria para a ação de deleção
    await RegisterAuditAction({
      session: req.session,
      action: 3, // Ação de deleção
      form: "Categoria de Livro",
      description: `Removeu a categoria de livro "${categoryTitle}" (ID: ${ID}).`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BookCategoryDelete: registo ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.bookCategory.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Categoria de livro removida com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover categoria de livro!", error: error.message });
  }
};

module.exports = {
  GetBookCategories,
  GetSingleBookCategory,
  RegisterBookCategory,
  BookCategoryDelete,
  BookCategoryUpdate,
};