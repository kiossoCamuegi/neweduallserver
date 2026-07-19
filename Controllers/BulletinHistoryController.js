const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const TABLE = "eduall_bulletin_history";
const AUDIT_FORM = "Histórico de Boletins";
const BULLETIN_HISTORY_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `bulletinHistory:list:${instituteCode}`,
  single: (id, instituteCode) => `bulletinHistory:single:${id}:${instituteCode}`,
  all: () => "bulletinHistory:*",
};

// ─── Helpers para serialização ────────────────────────────────────────────────
const toJson = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  return JSON.stringify(val);
};

const toCommaSeparated = (val) => {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateBulletinHistoryFields = (body) => {
  const errors = [];

  if (!body.students || !Array.isArray(body.students) || body.students.length === 0)
    errors.push("É necessário selecionar pelo menos um aluno.");

  if (!body.bulletin_type || body.bulletin_type.trim() === "")
    errors.push("Tipo de boletim é obrigatório.");

  if (!body.academic_year)
    errors.push("Ano letivo é obrigatório.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchBulletinHistory = async (req, res, instituteCode) => {
  const query = `
    SELECT
      ed_bh_id,
      ed_bh_class_id,
      ed_bh_class_title,
      ed_bh_academic_year,
      ed_bh_bulletin_type,
      ed_bh_ind_type,
      ed_bh_quarter,
      ed_bh_pass_value,
      ed_bh_max_value,
      ed_bh_font_size,
      ed_bh_border_mode,
      ed_bh_zero_fill,
      ed_bh_round_mode,
      ed_bh_bulletin_title,
      ed_bh_logo_url,
      ed_bh_subject_order,
      ed_bh_global_overrides,
      ed_bh_student_overrides,
      ed_bh_removed_cols,
      ed_bh_removed_rows,
      ed_bh_removed_blocks,
      ed_bh_evaluation_mode,
      ed_bh_qualitative_grades,
      ed_bh_class_subject_rules,
      ed_bh_students,
      ed_bh_student_names,
      ed_bh_student_codes,
      ed_bh_color_grades,
      ed_bh_created_at,
      ed_bh_updated_at
    FROM ${TABLE}
    WHERE ed_bh_deleted = 0
      AND ed_bh_institute_code = ?
    ORDER BY ed_bh_updated_at DESC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: TABLE,
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshBulletinHistoryCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchBulletinHistory(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, BULLETIN_HISTORY_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todos os boletins do instituto
 */
const GetAllBulletinHistory = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetAllBulletinHistory demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const rows = await FetchBulletinHistory(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, BULLETIN_HISTORY_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetAllBulletinHistory demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao listar histórico de boletins!",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter um boletim pelo ID
 */
const GetBulletinHistoryById = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetBulletinHistoryById demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT *
      FROM ${TABLE}
      WHERE ed_bh_deleted = 0
        AND ed_bh_id = ?
        AND ed_bh_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: TABLE,
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Boletim não encontrado.",
      });
    }

    await Cache.eduallSet(cacheKey, rows, BULLETIN_HISTORY_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetBulletinHistoryById demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao obter boletim!",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar novo histórico de boletim
 */
const RegisterBulletinHistory = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      class_id,
      class_title,
      academic_year,
      bulletin_type,
      ind_type,
      quarter,
      pass_value,
      max_value,
      font_size,
      border_mode,
      zero_fill,
      round_mode,
      bulletin_title,
      logo_url,
      subject_order,
      global_overrides,
      student_overrides,
      removed_cols,
      removed_rows,
      removed_blocks,
      evaluation_mode,
      qualitative_grades,
      class_subject_rules,
      students,
      student_names,
      student_codes,
      color_grades,
    } = req.body;

    // Validações
    const errors = ValidateBulletinHistoryFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const query = `
      INSERT INTO ${TABLE} (
        ed_bh_class_id,
        ed_bh_class_title,
        ed_bh_academic_year,
        ed_bh_bulletin_type,
        ed_bh_ind_type,
        ed_bh_quarter,
        ed_bh_pass_value,
        ed_bh_max_value,
        ed_bh_font_size,
        ed_bh_border_mode,
        ed_bh_zero_fill,
        ed_bh_round_mode,
        ed_bh_bulletin_title,
        ed_bh_logo_url,
        ed_bh_subject_order,
        ed_bh_global_overrides,
        ed_bh_student_overrides,
        ed_bh_removed_cols,
        ed_bh_removed_rows,
        ed_bh_removed_blocks,
        ed_bh_evaluation_mode,
        ed_bh_qualitative_grades,
        ed_bh_class_subject_rules,
        ed_bh_students,
        ed_bh_student_names,
        ed_bh_student_codes,
        ed_bh_color_grades,
        ed_bh_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      class_id || null,
      class_title || null,
      academic_year || null,
      bulletin_type || "individual",
      ind_type || "mac",
      quarter || 1,
      pass_value || 10,
      max_value || 20,
      font_size || 12,
      border_mode || "none",
      zero_fill ? 1 : 0,
      round_mode || "default",
      bulletin_title || "BOLETIM DE NOTAS",
      logo_url || null,
      toJson(subject_order),
      toJson(global_overrides),
      toJson(student_overrides),
      toJson(removed_cols),
      toJson(removed_rows),
      toJson(removed_blocks),
      evaluation_mode || "quantitative",
      toJson(qualitative_grades),
      toJson(class_subject_rules),
      toJson(students),
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      color_grades ? 1 : 0,
      institute,
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: TABLE,
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: AUDIT_FORM,
      description: `Registou novo histórico de boletim ${bulletin_type} — turma "${
        class_title || "—"
      }", ${students.length} aluno(s).`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterBulletinHistory: boletim registado para turma "${class_title}"`
    );
    await RefreshBulletinHistoryCache(req, res, institute);

    res.status(200).json({
      success: true,
      inserted_id: result.insertId || null,
      msg: "Boletim guardado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao registar boletim!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar histórico de boletim
 */
const UpdateBulletinHistory = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateBulletinHistoryFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar existência
    const checkQuery = `
      SELECT ed_bh_id, ed_bh_class_title FROM ${TABLE}
      WHERE ed_bh_id = ?
        AND ed_bh_institute_code = ?
        AND ed_bh_deleted = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: TABLE,
      type: "select",
      data: req,
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Boletim não encontrado.",
      });
    }

    const {
      class_id,
      class_title,
      academic_year,
      bulletin_type,
      ind_type,
      quarter,
      pass_value,
      max_value,
      font_size,
      border_mode,
      zero_fill,
      round_mode,
      bulletin_title,
      logo_url,
      subject_order,
      global_overrides,
      student_overrides,
      removed_cols,
      removed_rows,
      removed_blocks,
      evaluation_mode,
      qualitative_grades,
      class_subject_rules,
      students,
      student_names,
      student_codes,
      color_grades,
    } = req.body;

    const query = `
      UPDATE ${TABLE} SET
        ed_bh_class_id = ?,
        ed_bh_class_title = ?,
        ed_bh_academic_year = ?,
        ed_bh_bulletin_type = ?,
        ed_bh_ind_type = ?,
        ed_bh_quarter = ?,
        ed_bh_pass_value = ?,
        ed_bh_max_value = ?,
        ed_bh_font_size = ?,
        ed_bh_border_mode = ?,
        ed_bh_zero_fill = ?,
        ed_bh_round_mode = ?,
        ed_bh_bulletin_title = ?,
        ed_bh_logo_url = ?,
        ed_bh_subject_order = ?,
        ed_bh_global_overrides = ?,
        ed_bh_student_overrides = ?,
        ed_bh_removed_cols = ?,
        ed_bh_removed_rows = ?,
        ed_bh_removed_blocks = ?,
        ed_bh_evaluation_mode = ?,
        ed_bh_qualitative_grades = ?,
        ed_bh_class_subject_rules = ?,
        ed_bh_students = ?,
        ed_bh_student_names = ?,
        ed_bh_student_codes = ?,
        ed_bh_color_grades = ?,
        ed_bh_updated_at = NOW()
      WHERE ed_bh_id = ?
        AND ed_bh_institute_code = ?
        AND ed_bh_deleted = 0
    `;
    const PARAMS = [
      class_id || null,
      class_title || null,
      academic_year || null,
      bulletin_type || "individual",
      ind_type || "mac",
      quarter || 1,
      pass_value || 10,
      max_value || 20,
      font_size || 12,
      border_mode || "none",
      zero_fill ? 1 : 0,
      round_mode || "default",
      bulletin_title || "BOLETIM DE NOTAS",
      logo_url || null,
      toJson(subject_order),
      toJson(global_overrides),
      toJson(student_overrides),
      toJson(removed_cols),
      toJson(removed_rows),
      toJson(removed_blocks),
      evaluation_mode || "quantitative",
      toJson(qualitative_grades),
      toJson(class_subject_rules),
      toJson(students),
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      color_grades ? 1 : 0,
      ID,
      institute,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: TABLE,
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: AUDIT_FORM,
      description: `Atualizou boletim ID ${ID}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateBulletinHistory: boletim ${ID} atualizado`);
    await RefreshBulletinHistoryCache(req, res, institute);

    res.status(200).json({
      success: true,
      updated_id: parseInt(ID),
      msg: "Boletim atualizado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar boletim!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE — Soft delete de boletim
 */
const DeleteBulletinHistory = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_bh_id, ed_bh_class_title FROM ${TABLE}
      WHERE ed_bh_id = ?
        AND ed_bh_institute_code = ?
        AND ed_bh_deleted = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: TABLE,
      type: "select",
      data: req,
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Boletim não encontrado.",
      });
    }

    const classTitle = existing[0]?.ed_bh_class_title || "—";

    const query = `
      UPDATE ${TABLE}
      SET ed_bh_deleted = 1,
          ed_bh_updated_at = NOW()
      WHERE ed_bh_id = ?
        AND ed_bh_institute_code = ?
        AND ed_bh_deleted = 0
    `;
    await ExecuteQuery(res, query, [ID, institute], false, {
      db: TABLE,
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: AUDIT_FORM,
      description: `Eliminou boletim ID ${ID} (turma: "${classTitle}").`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteBulletinHistory: boletim ${ID} eliminado`);
    await RefreshBulletinHistoryCache(req, res, institute);

    res.status(200).json({
      success: true,
      deleted_id: parseInt(ID),
      msg: "Boletim eliminado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao eliminar boletim!",
      error: error.message,
    });
  }
};

module.exports = {
  GetAllBulletinHistory,
  GetBulletinHistoryById,
  RegisterBulletinHistory,
  UpdateBulletinHistory,
  DeleteBulletinHistory,
};