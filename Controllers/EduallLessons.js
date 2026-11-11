// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

const LESSON_CACHE_TTL = 3600;

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateLessonFields = (body) => {
  const errors = [];

  if (!body.ed_video_title || body.ed_video_title.trim() === "")
    errors.push("Título da aula é obrigatório.");

  if (body.ed_video_title && body.ed_video_title.trim().length < 3)
    errors.push("Título da aula deve ter pelo menos 3 caracteres.");

  if (!body.ed_video_modulo || body.ed_video_modulo.trim() === "")
    errors.push("Módulo/categoria é obrigatório.");

  return errors;
};

// ═══════════════════════════════════════════════════════════════════════════
// === [Garantir existência da tabela e colunas] ===
// ═══════════════════════════════════════════════════════════════════════════
let _lessonsTableReady = false; // CACHE-OPT: CREATE TABLE / verificação de coluna só uma vez por processo
async function EnsureLessonsTable(res, req) {
  if (_lessonsTableReady) return;
  try {
    // Criar tabela se não existir
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS eduall_tutorial_lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ed_video_title VARCHAR(255) NOT NULL,
        ed_video_description TEXT,
        ed_video_modulo VARCHAR(255),
        ed_link_video TEXT,
        ed_video_time VARCHAR(50),
        ed_video_image TEXT,
        ed_video_favorite_status TINYINT DEFAULT 0,
        ed_video_added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    
    await ExecuteQuery(res, createTableSql, [], false, {
      db: "eduall_tutorial_lessons",
      type: "create",
      data: req,
    });

    // Verificar se a coluna 'deleted' existe
    const checkColumnSql = `
      SELECT COUNT(*) as col_count 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME='eduall_tutorial_lessons' 
      AND COLUMN_NAME='deleted'
    `;
    
    const result = await ExecuteQuery(res, checkColumnSql, [], true, {
      db: "eduall_tutorial_lessons",
      type: "select",
      data: req,
    });

    // Se a coluna não existe, adicionar
    if (result && result[0] && result[0].col_count === 0) {
      console.log(
        "⚠️  Coluna 'deleted' não encontrada. Adicionando automaticamente..."
      );
      
      const addColumnSql = `
        ALTER TABLE eduall_tutorial_lessons
        ADD COLUMN deleted TINYINT DEFAULT 0 
        AFTER ed_video_favorite_status
      `;
      
      await ExecuteQuery(res, addColumnSql, [], false, {
        db: "eduall_tutorial_lessons",
        type: "alter",
        data: req,
      });
      
      console.log(" Coluna 'deleted' adicionada com sucesso!");
    }
    _lessonsTableReady = true;
  } catch (error) {
    console.error("Erro ao garantir tabela de aulas:", error);
    // Não lançar erro - deixar continuar
  }
}

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchLessons = async (res, req) => {
  const query = `
    SELECT * FROM eduall_tutorial_lessons
    WHERE deleted = 0
    ORDER BY ed_video_added_date DESC
  `;
  return ExecuteQuery(res, query, [], true, {
    db: "eduall_tutorial_lessons",
    type: "select",
    data: req,
  });
};

/* ═════════════════════════════════════════════════════════════════════════════
   GET OPERATIONS (COM CACHE)
═════════════════════════════════════════════════════════════════════════════ */

/**
 * GET ALL — Listar todas as aulas
 */
const GetLessons_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);

    const rows = await Cache.eduallWithCache(
      CacheKeys.lesson.list(),
      LESSON_CACHE_TTL,
      () => FetchLessons(res, req)
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Erro ao buscar aulas:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao buscar aulas.",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter aula individual
 */
const GetSingleLesson_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }

    const query =
      "SELECT * FROM eduall_tutorial_lessons WHERE id = ? AND deleted = 0";
    const rows = await ExecuteQuery(res, query, [ID], true, {
      db: "eduall_tutorial_lessons",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Aula não encontrada.",
      });
    }

    const result = rows[0];

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Erro ao buscar aula:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao buscar aula.",
      error: error.message,
    });
  }
};

/* ═════════════════════════════════════════════════════════════════════════════
   POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH)
═════════════════════════════════════════════════════════════════════════════ */

/**
 * POST — Registar nova aula
 */
const RegisterLesson_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);

    const {
      ed_video_title,
      ed_video_description,
      ed_video_modulo,
      ed_link_video,
      ed_video_time,
      ed_video_image,
      ed_video_favorite_status,
    } = req.body;

    // Validações
    const errors = ValidateLessonFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });

    const query = `
      INSERT INTO eduall_tutorial_lessons
      (ed_video_title, ed_video_description, ed_video_modulo, ed_link_video, ed_video_time, ed_video_image, ed_video_favorite_status, ed_video_added_date, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)
    `;

    const params = [
      ed_video_title.trim(),
      ed_video_description ? ed_video_description.trim() : null,
      ed_video_modulo.trim(),
      ed_link_video || null,
      ed_video_time || null,
      ed_video_image || null,
      ed_video_favorite_status || 0,
    ];

    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_tutorial_lessons",
      type: "insert",
      data: req,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterLesson_ED: aula "${ed_video_title.trim()}" registada com ID ${result.insertId}`
    );
    
    await CacheKeys.safeInvalidate(() => [CacheKeys.lesson.list()]);

    res.status(201).json({
      success: true,
      message: "Aula registada com sucesso.",
      id: result.insertId,
    });
  } catch (error) {
    console.error("Erro ao registar aula:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao registar aula.",
      error: error.message,
    });
  }
};

/* ═════════════════════════════════════════════════════════════════════════════
   PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH)
═════════════════════════════════════════════════════════════════════════════ */

/**
 * PUT — Atualizar aula
 */
const LessonUpdate_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);
    const { ID } = req.params;

    const {
      ed_video_title,
      ed_video_description,
      ed_video_modulo,
      ed_link_video,
      ed_video_time,
      ed_video_image,
      ed_video_favorite_status,
    } = req.body;

    // Validações
    const errors = ValidateLessonFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });

    // Confirmar que a aula existe
    const checkExistQuery =
      `SELECT id FROM eduall_tutorial_lessons WHERE id = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkExistQuery, [ID], true, {
      db: "eduall_tutorial_lessons",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res.status(404).json({
        success: false,
        msg: "Aula não encontrada ou já foi removida.",
      });

    const query = `
      UPDATE eduall_tutorial_lessons
      SET
        ed_video_title = ?,
        ed_video_description = ?,
        ed_video_modulo = ?,
        ed_link_video = ?,
        ed_video_time = ?,
        ed_video_image = ?,
        ed_video_favorite_status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted = 0
    `;

    const params = [
      ed_video_title.trim(),
      ed_video_description ? ed_video_description.trim() : null,
      ed_video_modulo.trim(),
      ed_link_video || null,
      ed_video_time || null,
      ed_video_image || null,
      ed_video_favorite_status || 0,
      ID,
    ];

    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_tutorial_lessons",
      type: "update",
      data: req,
    });

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Aula não encontrada.",
      });
    }

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> LessonUpdate_ED: aula ${ID} atualizada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.lesson.list()]);

    res.status(200).json({
      success: true,
      message: "Aula atualizada com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao atualizar aula:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar aula.",
      error: error.message,
    });
  }
};

/* ═════════════════════════════════════════════════════════════════════════════
   DELETE OPERATIONS (COM CACHE REFRESH) — SOFT DELETE
═════════════════════════════════════════════════════════════════════════════ */

/**
 * DELETE (soft-delete) — Excluir aula
 */
const LessonDelete_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);
    const { ID } = req.params;

    // Confirmar existência antes de apagar
    const checkQuery =
      `SELECT id FROM eduall_tutorial_lessons WHERE id = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [ID], true, {
      db: "eduall_tutorial_lessons",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Aula não encontrada ou já foi removida.",
      });
    }

    // Soft delete — apenas marca como deleted
    const query = `
      UPDATE eduall_tutorial_lessons
      SET deleted = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted = 0
    `;
    
    const result = await ExecuteQuery(res, query, [ID], false, {
      db: "eduall_tutorial_lessons",
      type: "update",
      data: req,
    });

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Aula não encontrada.",
      });
    }

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> LessonDelete_ED: aula ${ID} eliminada (soft-delete)`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.lesson.list()]);

    res.status(200).json({
      success: true,
      message: "Aula excluída com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao excluir aula:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao excluir aula.",
      error: error.message,
    });
  }
};

/**
 * DELETE HARD — Eliminar permanentemente (apenas para admins)
 */
const LessonHardDelete_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);
    const { ID } = req.params;

    // Verificar se o utilizador é admin (implementar conforme necessário)
    // if (!req.user || req.user.role !== 'admin') {
    //   return res.status(403).json({ success: false, message: "Acesso negado." });
    // }

    // Hard delete — remove completamente
    const query = `DELETE FROM eduall_tutorial_lessons WHERE id = ?`;
    
    const result = await ExecuteQuery(res, query, [ID], false, {
      db: "eduall_tutorial_lessons",
      type: "delete",
      data: req,
    });

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Aula não encontrada.",
      });
    }

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> LessonHardDelete_ED: aula ${ID} permanentemente eliminada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.lesson.list()]);

    res.status(200).json({
      success: true,
      message: "Aula permanentemente removida.",
    });
  } catch (error) {
    console.error("Erro ao eliminar aula permanentemente:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao eliminar aula permanentemente.",
      error: error.message,
    });
  }
};

/**
 * RESTORE — Restaurar aula eliminada (soft-delete)
 */
const LessonRestore_ED = async (req, res) => {
  try {
    await EnsureLessonsTable(res, req);
    const { ID } = req.params;

    // Verificar se a aula foi eliminada (soft-delete)
    const checkQuery =
      `SELECT id FROM eduall_tutorial_lessons WHERE id = ? AND deleted = 1`;
    const found = await ExecuteQuery(res, checkQuery, [ID], true, {
      db: "eduall_tutorial_lessons",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Aula não encontrada ou não foi eliminada.",
      });
    }

    // Restaurar
    const query = `
      UPDATE eduall_tutorial_lessons
      SET deleted = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    
    const result = await ExecuteQuery(res, query, [ID], false, {
      db: "eduall_tutorial_lessons",
      type: "update",
      data: req,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> LessonRestore_ED: aula ${ID} restaurada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.lesson.list()]);

    res.status(200).json({
      success: true,
      message: "Aula restaurada com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao restaurar aula:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao restaurar aula.",
      error: error.message,
    });
  }
};

module.exports = {
  GetLessons_ED,
  GetSingleLesson_ED,
  RegisterLesson_ED,
  LessonUpdate_ED,
  LessonDelete_ED,
  LessonHardDelete_ED,
  LessonRestore_ED,
};