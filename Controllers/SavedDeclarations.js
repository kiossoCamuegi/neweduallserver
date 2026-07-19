 const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ═══════════════════════════════════════════════════════════════════
   QUALIFICATIONS STATEMENT — Controller
   Componente: PdQualificationsStatement
   Baseado no padrão: CiclesController.js

   Tabela  : eduall_qualifications_statements
   Prefixo : ed_qs_
   Ver estrutura SQL completa e rotas no final deste ficheiro.
═══════════════════════════════════════════════════════════════════ */

const TABLE  = "eduall_qualifications_statements";
const AUDIT_FORM = "Declarações de Habilitações";


/* ─────────────────────────────────────────────────────────────────
   UTIL — Serializa qualquer valor para JSON string seguro.
   Se já for string, devolve tal qual (evita double-stringify).
───────────────────────────────────────────────────────────────── */
const toJson = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === "string")           return val;
  return JSON.stringify(val);
};

/* ─────────────────────────────────────────────────────────────────
   UTIL — Converte array de strings numa string separada por vírgula.
   Usado para os campos de pesquisa rápida (names, codes).
───────────────────────────────────────────────────────────────── */
const toCommaSeparated = (val) => {
  if (!val) return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
};


/* ═══════════════════════════════════════════════════════════════════
   GET ALL — Listar todas as declarações do instituto atual
   Endpoint : GET /eduall-qualifications-statement/get
   Devolve  : Array ordenado pela mais recente (updated_at DESC)
═══════════════════════════════════════════════════════════════════ */
const GetAllQualificationsStatements = async (req, res) => {
  try {
    const query = `
      SELECT
        ed_qs_id,
        ed_qs_class_id,
        ed_qs_class_title,
        ed_qs_academic_year,
        ed_qs_with_notes,
        ed_qs_pass_value,
        ed_qs_font_size,
        ed_qs_border_mode,
        ed_qs_logo_url,
        ed_qs_header_lines,
        ed_qs_subjects,
        ed_qs_columns,
        ed_qs_students,
        ed_qs_student_grades,
        ed_qs_overrides,
        ed_qs_student_names,
        ed_qs_student_codes,
        ed_qs_student_pics,
        ed_qs_institute_code,
        ed_qs_created_at,
        ed_qs_updated_at
      FROM ${TABLE}
      WHERE ed_qs_deleted = 0
        AND ed_qs_institute_code = ?
      ORDER BY ed_qs_updated_at DESC
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: TABLE,
      type: "select",
      data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao listar declarações de habilitações!",
      error: error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   GET SINGLE — Obter uma declaração pelo ID
   Endpoint : GET /eduall-qualifications-statement/get/:ID
   Devolve  : Array com um registo (padrão Eduall)
═══════════════════════════════════════════════════════════════════ */
const GetQualificationsStatementById = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      SELECT *
      FROM ${TABLE}
      WHERE ed_qs_deleted       = 0
        AND ed_qs_id            = ?
        AND ed_qs_institute_code = ?
    `;
    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: TABLE,
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Declaração de habilitações não encontrada.",
      });
    }

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao obter a declaração de habilitações!",
      error: error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   POST — Registar nova declaração de habilitações
   Endpoint : POST /eduall-qualifications-statement/post
   Devolve  : { success, inserted_id, msg }

   Body esperado (JSON):
   {
     class_id        : number | null   — ID da turma selecionada
     class_title     : string          — Nome/label da turma
     academic_year   : string          — Ex: "2024/2025"
     with_notes      : boolean         — true = com notas | false = sem notas
     pass_value      : 10 | 20         — Escala de avaliação
     font_size       : number          — Tamanho de fonte (9–14pt)
     border_mode     : string          — "none" | "single" | "double" | "certificate"
     logo_url        : string | null   — Base64 ou URL do logótipo
     header_lines    : array           — [{text: string, bold: boolean}]
     subjects        : array           — [{id: number, name: string}]
     columns         : array           — [{id: number, label: string}]  (máx 4)
     students        : array           — snapshot completo dos alunos selecionados
     student_grades  : object          — { studentId: [{id, name, grades:{colId: val}}] }
     overrides       : object          — { studentId: { campo: valor, ... } }
     student_names   : array           — ["Nome 1", "Nome 2"]  (pesquisa rápida)
     student_codes   : array           — ["001", "002"]         (pesquisa rápida)
     student_pics    : array           — ["url1", null]          (avatares histórico)
   }
═══════════════════════════════════════════════════════════════════ */
const RegisterQualificationsStatement = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      class_id,
      class_title,
      academic_year,
      with_notes,
      pass_value,
      font_size,
      border_mode,
      logo_url,
      header_lines,
      subjects,
      columns,
      students,
      student_grades,
      overrides,
      student_names,
      student_codes,
      student_pics,
    } = req.body;

    /* ── Validação mínima ─────────────────────────────────────── */
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "É necessário selecionar pelo menos um aluno para registar a declaração.",
      });
    }

    /* ── Inserir ──────────────────────────────────────────────── */
    const query = `
      INSERT INTO ${TABLE} (
        ed_qs_class_id,
        ed_qs_class_title,
        ed_qs_academic_year,
        ed_qs_with_notes,
        ed_qs_pass_value,
        ed_qs_font_size,
        ed_qs_border_mode,
        ed_qs_logo_url,
        ed_qs_header_lines,
        ed_qs_subjects,
        ed_qs_columns,
        ed_qs_students,
        ed_qs_student_grades,
        ed_qs_overrides,
        ed_qs_student_names,
        ed_qs_student_codes,
        ed_qs_student_pics,
        ed_qs_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      with_notes    ? 1 : 0,
      pass_value    || 10,
      font_size     || 12,
      border_mode   || "none",
      logo_url      || null,
      toJson(header_lines),
      toJson(subjects),
      toJson(columns),
      toJson(students),
      toJson(student_grades),
      toJson(overrides),
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      toJson(student_pics),
      institute,
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: TABLE,
      type: "insert",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: AUDIT_FORM,
      description: `Registou nova declaração de habilitações ${with_notes ? "com notas" : "sem notas"} — turma "${class_title || "—"}", ${students.length} aluno(s).`,
    });

    res.status(200).json({
      success:     true,
      inserted_id: result.insertId || null,
      msg:         "Declaração de habilitações guardada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao registar a declaração de habilitações!",
      error: error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT — Atualizar declaração de habilitações existente
   Endpoint : PUT /eduall-qualifications-statement/update/:ID
   Devolve  : { success, updated_id, msg }

   Body     : mesmo formato do POST acima.
   Atualiza todos os campos de configuração + dados dos alunos.
   Verifica se o registo pertence ao instituto antes de alterar.
═══════════════════════════════════════════════════════════════════ */
const UpdateQualificationsStatement = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_qs_id FROM ${TABLE}
      WHERE ed_qs_id            = ?
        AND ed_qs_institute_code = ?
        AND ed_qs_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Declaração não encontrada ou sem permissão para editar.",
      });
    }

    const {
      class_id,
      class_title,
      academic_year,
      with_notes,
      pass_value,
      font_size,
      border_mode,
      logo_url,
      header_lines,
      subjects,
      columns,
      students,
      student_grades,
      overrides,
      student_names,
      student_codes,
      student_pics,
    } = req.body;

    /* ── Validação mínima ─────────────────────────────────────── */
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "É necessário pelo menos um aluno para atualizar a declaração.",
      });
    }

    /* ── Atualizar ────────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE} SET
        ed_qs_class_id       = ?,
        ed_qs_class_title    = ?,
        ed_qs_academic_year  = ?,
        ed_qs_with_notes     = ?,
        ed_qs_pass_value     = ?,
        ed_qs_font_size      = ?,
        ed_qs_border_mode    = ?,
        ed_qs_logo_url       = ?,
        ed_qs_header_lines   = ?,
        ed_qs_subjects       = ?,
        ed_qs_columns        = ?,
        ed_qs_students       = ?,
        ed_qs_student_grades = ?,
        ed_qs_overrides      = ?,
        ed_qs_student_names  = ?,
        ed_qs_student_codes  = ?,
        ed_qs_student_pics   = ?,
        ed_qs_updated_at     = NOW()
      WHERE ed_qs_id            = ?
        AND ed_qs_institute_code = ?
        AND ed_qs_deleted        = 0
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      with_notes    ? 1 : 0,
      pass_value    || 10,
      font_size     || 12,
      border_mode   || "none",
      logo_url      || null,
      toJson(header_lines),
      toJson(subjects),
      toJson(columns),
      toJson(students),
      toJson(student_grades),
      toJson(overrides),
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      toJson(student_pics),
      ID,
      institute,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: TABLE,
      type: "update",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: AUDIT_FORM,
      description: `Atualizou declaração de habilitações ID ${ID} — turma "${class_title || "—"}", ${students.length} aluno(s).`,
    });

    res.status(200).json({
      success:    true,
      updated_id: parseInt(ID),
      msg:        "Declaração de habilitações atualizada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar a declaração de habilitações!",
      error: error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT (soft delete) — Eliminar declaração de habilitações
   Endpoint : PUT /eduall-qualifications-statement/delete/:ID
   Devolve  : { success, deleted_id, msg }

   Usa soft delete (ed_qs_deleted = 1), igual ao padrão dos Ciclos.
   Verifica se pertence ao instituto antes de marcar como eliminado.
═══════════════════════════════════════════════════════════════════ */
const DeleteQualificationsStatement = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_qs_id, ed_qs_class_title FROM ${TABLE}
      WHERE ed_qs_id            = ?
        AND ed_qs_institute_code = ?
        AND ed_qs_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Declaração não encontrada ou já eliminada.",
      });
    }

    const classTitle = existing[0]?.ed_qs_class_title || "—";

    /* ── Soft delete ──────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE}
      SET ed_qs_deleted    = 1,
          ed_qs_updated_at = NOW()
      WHERE ed_qs_id            = ?
        AND ed_qs_institute_code = ?
        AND ed_qs_deleted        = 0
    `;
    await ExecuteQuery(res, query, [ID, institute], false, {
      db: TABLE,
      type: "update",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: AUDIT_FORM,
      description: `Eliminou declaração de habilitações ID ${ID} (turma: "${classTitle}").`,
    });

    res.status(200).json({
      success:    true,
      deleted_id: parseInt(ID),
      msg:        "Declaração de habilitações eliminada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao eliminar a declaração de habilitações!",
      error: error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════ */
module.exports = {
  GetAllQualificationsStatements,
  GetQualificationsStatementById,
  RegisterQualificationsStatement,
  UpdateQualificationsStatement,
  DeleteQualificationsStatement,
};


/*


// ========== DECLARAÇÕES DE HABILITAÇÕES ==========
router.get ('/eduall-qualifications-statement/get',          VerifyToken, GetAllQualificationsStatements);
router.get ('/eduall-qualifications-statement/get/:ID',      VerifyToken, GetQualificationsStatementById);
router.post('/eduall-qualifications-statement/post',         VerifyToken, RegisterQualificationsStatement);
router.put ('/eduall-qualifications-statement/update/:ID',   VerifyToken, UpdateQualificationsStatement);
router.put ('/eduall-qualifications-statement/delete/:ID',   VerifyToken, DeleteQualificationsStatement);
*/