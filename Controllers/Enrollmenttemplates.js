// CACHE-OPT v2 (aplicado por apply_cache_optimizations_v2.py)
// ─────────────────────────────────────────────────────────────────────────────
//  Enrollmenttemplates.js  (Backend Controller – COM CACHE INTEGRADO)
//  Handles: Enrollment Template CRUD operations
//  ✅ CACHE SYSTEM INTEGRADO (padrão AcademicYear.js)
// ─────────────────────────────────────────────────────────────────────────────

const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery            = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION (same pattern as AcademicYear.js) ─────
// ──────────────────────────────────────────────────────────────
const ENROLLMENT_TEMPLATE_CACHE_TTL = 3600; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// ── GET ALL TEMPLATES FOR CURRENT INSTITUTE
// ─────────────────────────────────────────────────────────────────────────────

const GetEnrollmentTemplates = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await Cache.eduallWithCache(
      CacheKeys.enrollmentTemplate.list(instituteCode),
      ENROLLMENT_TEMPLATE_CACHE_TTL,
      () => ExecuteQuery(
        res,
        `
      SELECT * FROM eduall_enrollment_templates
      WHERE ed_enroll_tpl_deleted = 0
        AND ed_enroll_tpl_institute_code = ?
      ORDER BY ed_enroll_tpl_updated_at DESC
    `,
        [instituteCode],
        true,
        { db: "eduall_enrollment_templates", type: "select", data: req }
      )
    );
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar modelos de matrícula!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── GET SINGLE TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

const GetSingleEnrollmentTemplate = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_enrollment_templates
      WHERE ed_enroll_tpl_deleted = 0
        AND ed_enroll_tpl_id = ?
        AND ed_enroll_tpl_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_templates", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o modelo!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── GET ACTIVE TEMPLATE BY MODEL KEY (e.g. "sol") FOR CURRENT INSTITUTE
// ─────────────────────────────────────────────────────────────────────────────

const GetActiveTemplateByModel = async (req, res) => {
  try {
    const { MODEL } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_enrollment_templates
      WHERE ed_enroll_tpl_deleted = 0
        AND ed_enroll_tpl_model_key = ?
        AND ed_enroll_tpl_institute_code = ?
        AND ed_enroll_tpl_is_active = 1
      ORDER BY ed_enroll_tpl_updated_at DESC
      LIMIT 1
    `;
    const PARAMS = [MODEL, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_templates", type: "select", data: req,
    });

    const resultData = rows[0] || null;

    // Return first or empty object — frontend handles missing gracefully
    res.status(200).json(resultData);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar modelo activo!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── INSERT NEW TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

const RegisterEnrollmentTemplate = async (req, res) => {
  try {
    const {
      tpl_name,       // display name, e.g. "Ficha Monte Sol 2025"
      tpl_model_key,  // "sol" | "classico" | future keys
      tpl_data,       // JSON string with all editable text fields
      tpl_is_active,  // 1 | 0
    } = req.body;

    const inst = req.session.user.eduall_user_session_curentinstitute;

    // If marking as active, deactivate previous active templates of same model
    if (Number(tpl_is_active) === 1) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_enrollment_templates
         SET ed_enroll_tpl_is_active = 0
         WHERE ed_enroll_tpl_model_key = ? AND ed_enroll_tpl_institute_code = ? AND ed_enroll_tpl_deleted = 0`,
        [tpl_model_key, inst],
        false,
        { db: "eduall_enrollment_templates", type: "update", data: req }
      );
    }

    const query = `
      INSERT INTO eduall_enrollment_templates
        (ed_enroll_tpl_name, ed_enroll_tpl_model_key, ed_enroll_tpl_data,
         ed_enroll_tpl_is_active, ed_enroll_tpl_institute_code)
      VALUES (?, ?, ?, ?, ?)
    `;
    const PARAMS = [tpl_name, tpl_model_key, tpl_data, tpl_is_active ?? 1, inst];
    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_enrollment_templates", type: "insert", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Modelo de Matrícula",
      description: `Registou o modelo "${tpl_name}" (${tpl_model_key})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterEnrollmentTemplate: modelo "${tpl_name}" criado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.enrollmentTemplate.list(inst)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar modelo!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── UPDATE EXISTING TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

const UpdateEnrollmentTemplate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { tpl_name, tpl_data, tpl_is_active } = req.body;
    const inst = req.session.user.eduall_user_session_curentinstitute;

    // First get model key so we can deactivate others of same type
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_enroll_tpl_model_key FROM eduall_enrollment_templates WHERE ed_enroll_tpl_id = ? AND ed_enroll_tpl_institute_code = ?`,
      [ID, inst],
      true,
      { db: "eduall_enrollment_templates", type: "select", data: req }
    );
    const modelKey = existing?.[0]?.ed_enroll_tpl_model_key;

    if (Number(tpl_is_active) === 1 && modelKey) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_enrollment_templates
         SET ed_enroll_tpl_is_active = 0
         WHERE ed_enroll_tpl_model_key = ? AND ed_enroll_tpl_institute_code = ? AND ed_enroll_tpl_deleted = 0`,
        [modelKey, inst],
        false,
        { db: "eduall_enrollment_templates", type: "update", data: req }
      );
    }

    const query = `
      UPDATE eduall_enrollment_templates
      SET ed_enroll_tpl_name      = ?,
          ed_enroll_tpl_data      = ?,
          ed_enroll_tpl_is_active = ?,
          ed_enroll_tpl_updated_at = NOW()
      WHERE ed_enroll_tpl_deleted  = 0
        AND ed_enroll_tpl_id       = ?
        AND ed_enroll_tpl_institute_code = ?
    `;
    const PARAMS = [tpl_name, tpl_data, tpl_is_active ?? 1, ID, inst];
    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_enrollment_templates", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Modelo de Matrícula",
      description: `Actualizou o modelo "${tpl_name}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateEnrollmentTemplate: modelo ID ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.enrollmentTemplate.list(inst)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao actualizar modelo!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── SOFT DELETE
// ─────────────────────────────────────────────────────────────────────────────

const DeleteEnrollmentTemplate = async (req, res) => {
  try {
    const { ID } = req.params;
    const inst = req.session.user.eduall_user_session_curentinstitute;
    const query = `
      UPDATE eduall_enrollment_templates
      SET ed_enroll_tpl_deleted = 1
      WHERE ed_enroll_tpl_deleted = 0
        AND ed_enroll_tpl_id = ?
        AND ed_enroll_tpl_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID, inst], false, {
      db: "eduall_enrollment_templates", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Modelo de Matrícula",
      description: `Removeu o modelo de matrícula com ID "${ID}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteEnrollmentTemplate: modelo ID ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.enrollmentTemplate.list(inst)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover modelo!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ── EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  GetEnrollmentTemplates,
  GetSingleEnrollmentTemplate,
  GetActiveTemplateByModel,
  RegisterEnrollmentTemplate,
  UpdateEnrollmentTemplate,
  DeleteEnrollmentTemplate,
};