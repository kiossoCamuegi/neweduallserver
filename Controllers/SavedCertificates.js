const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ═══════════════════════════════════════════════════════════════════
   CERTIFICATES — Controller
   Componente: PdCertificates
   Baseado no padrão: QualificationsStatementController.js

   Tabela  : eduall_certificates
   Prefixo : ed_cert_
   Ver estrutura SQL completa e rotas no final deste ficheiro.
═══════════════════════════════════════════════════════════════════ */

const TABLE      = "eduall_certificates";
const AUDIT_FORM = "Certificados Escolares";


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
  if (!val)               return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
};


/* ═══════════════════════════════════════════════════════════════════
   GET ALL — Listar todos os certificados do instituto atual
   Endpoint : GET /eduall-certificates/get
   Devolve  : Array ordenado pelo mais recente (updated_at DESC)
═══════════════════════════════════════════════════════════════════ */
const GetAllCertificates = async (req, res) => {
  try {
    const query = `
      SELECT
        ed_cert_id,
        ed_cert_class_id,
        ed_cert_class_title,
        ed_cert_academic_year,
        ed_cert_model,
        ed_cert_pass_value,
        ed_cert_font_size,
        ed_cert_border_mode,
        ed_cert_logo_url,
        ed_cert_header_lines,
        ed_cert_subjects,
        ed_cert_columns,
        ed_cert_students,
        ed_cert_grades,
        ed_cert_overrides,
        ed_cert_student_names,
        ed_cert_student_codes,
        ed_cert_student_pics,
        ed_cert_institute_code,
        ed_cert_created_at,
        ed_cert_updated_at
      FROM ${TABLE}
      WHERE ed_cert_deleted        = 0
        AND ed_cert_institute_code = ?
      ORDER BY ed_cert_updated_at DESC
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db:   TABLE,
      type: "select",
      data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao listar certificados escolares!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   GET SINGLE — Obter um certificado pelo ID
   Endpoint : GET /eduall-certificates/get/:ID
   Devolve  : Array com um registo (padrão Eduall)
═══════════════════════════════════════════════════════════════════ */
const GetCertificateById = async (req, res) => {
  try {
    const { ID } = req.params;
    const query  = `
      SELECT *
      FROM ${TABLE}
      WHERE ed_cert_deleted        = 0
        AND ed_cert_id             = ?
        AND ed_cert_institute_code = ?
    `;
    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db:   TABLE,
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg:     "Certificado escolar não encontrado.",
      });
    }

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao obter o certificado escolar!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   POST — Registar novo certificado escolar
   Endpoint : POST /eduall-certificates/post
   Devolve  : { success, inserted_id, msg }

   Body esperado (JSON):
   {
     class_id        : number | null   — ID da turma selecionada
     class_title     : string          — Nome/label da turma
     academic_year   : string          — Ex: "2024/2025"
     cert_model      : string          — "primario" | "secundario"
     pass_value      : 10 | 20         — Escala de avaliação
     font_size       : number          — Tamanho de fonte (9–13pt)
     border_mode     : string          — "none" | "single" | "double" | "certificate"
     logo_url        : string | null   — Base64 ou URL do logótipo
     header_lines    : array           — [{text: string, bold: boolean}]
     subjects        : array           — [{id: string|number, name: string}]
     columns         : array           — [{id: string, label: string, sublabel?: string}]
     students        : array           — snapshot completo dos alunos selecionados
     student_grades  : object          — { studentId: [{id, name, grades:{colId: val}}] }
     overrides       : object          — { studentId: { campo: valor, ... } }
     student_names   : array           — ["Nome 1", "Nome 2"]  (pesquisa rápida)
     student_codes   : array           — ["001", "002"]         (pesquisa rápida)
     student_pics    : array           — ["url1", null]          (avatares histórico)
   }
═══════════════════════════════════════════════════════════════════ */
const RegisterCertificate = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      class_id,
      class_title,
      academic_year,
      cert_model,
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
        msg:     "É necessário selecionar pelo menos um aluno para registar o certificado.",
      });
    }

    const validModels = ["primario", "secundario"];
    if (!validModels.includes(cert_model)) {
      return res.status(400).json({
        success: false,
        msg:     `Modelo de certificado inválido. Use: ${validModels.join(" | ")}.`,
      });
    }

    /* ── Inserir ──────────────────────────────────────────────── */
    const query = `
      INSERT INTO ${TABLE} (
        ed_cert_class_id,
        ed_cert_class_title,
        ed_cert_academic_year,
        ed_cert_model,
        ed_cert_pass_value,
        ed_cert_font_size,
        ed_cert_border_mode,
        ed_cert_logo_url,
        ed_cert_header_lines,
        ed_cert_subjects,
        ed_cert_columns,
        ed_cert_students,
        ed_cert_grades,
        ed_cert_overrides,
        ed_cert_student_names,
        ed_cert_student_codes,
        ed_cert_student_pics,
        ed_cert_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      cert_model    || "primario",
      pass_value    || 10,
      font_size     || 11,
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
      db:   TABLE,
      type: "insert",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    const modelLabel = cert_model === "secundario" ? "Ensino Secundário" : "Ensino Primário";
    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        AUDIT_FORM,
      description: `Registou novo certificado de ${modelLabel} — turma "${class_title || "—"}", ${students.length} aluno(s).`,
    });

    res.status(200).json({
      success:     true,
      inserted_id: result.insertId || null,
      msg:         "Certificado escolar guardado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao registar o certificado escolar!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT — Atualizar certificado escolar existente
   Endpoint : PUT /eduall-certificates/update/:ID
   Devolve  : { success, updated_id, msg }

   Body     : mesmo formato do POST acima.
   Atualiza todos os campos de configuração + dados dos alunos.
   Verifica se o registo pertence ao instituto antes de alterar.
═══════════════════════════════════════════════════════════════════ */
const UpdateCertificate = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_cert_id FROM ${TABLE}
      WHERE ed_cert_id             = ?
        AND ed_cert_institute_code = ?
        AND ed_cert_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db:   TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg:     "Certificado não encontrado ou sem permissão para editar.",
      });
    }

    const {
      class_id,
      class_title,
      academic_year,
      cert_model,
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
        msg:     "É necessário pelo menos um aluno para atualizar o certificado.",
      });
    }

    /* ── Atualizar ────────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE} SET
        ed_cert_class_id      = ?,
        ed_cert_class_title   = ?,
        ed_cert_academic_year = ?,
        ed_cert_model         = ?,
        ed_cert_pass_value    = ?,
        ed_cert_font_size     = ?,
        ed_cert_border_mode   = ?,
        ed_cert_logo_url      = ?,
        ed_cert_header_lines  = ?,
        ed_cert_subjects      = ?,
        ed_cert_columns       = ?,
        ed_cert_students      = ?,
        ed_cert_grades        = ?,
        ed_cert_overrides     = ?,
        ed_cert_student_names = ?,
        ed_cert_student_codes = ?,
        ed_cert_student_pics  = ?,
        ed_cert_updated_at    = NOW()
      WHERE ed_cert_id             = ?
        AND ed_cert_institute_code = ?
        AND ed_cert_deleted        = 0
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      cert_model    || "primario",
      pass_value    || 10,
      font_size     || 11,
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
      db:   TABLE,
      type: "update",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    const modelLabel = cert_model === "secundario" ? "Ensino Secundário" : "Ensino Primário";
    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        AUDIT_FORM,
      description: `Atualizou certificado de ${modelLabel} ID ${ID} — turma "${class_title || "—"}", ${students.length} aluno(s).`,
    });

    res.status(200).json({
      success:    true,
      updated_id: parseInt(ID),
      msg:        "Certificado escolar atualizado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar o certificado escolar!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT (soft delete) — Eliminar certificado escolar
   Endpoint : PUT /eduall-certificates/delete/:ID
   Devolve  : { success, deleted_id, msg }

   Usa soft delete (ed_cert_deleted = 1), igual ao padrão dos Ciclos.
   Verifica se pertence ao instituto antes de marcar como eliminado.
═══════════════════════════════════════════════════════════════════ */
const DeleteCertificate = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_cert_id, ed_cert_class_title, ed_cert_model FROM ${TABLE}
      WHERE ed_cert_id             = ?
        AND ed_cert_institute_code = ?
        AND ed_cert_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db:   TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg:     "Certificado não encontrado ou já eliminado.",
      });
    }

    const classTitle = existing[0]?.ed_cert_class_title || "—";
    const certModel  = existing[0]?.ed_cert_model       || "—";

    /* ── Soft delete ──────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE}
      SET ed_cert_deleted    = 1,
          ed_cert_updated_at = NOW()
      WHERE ed_cert_id             = ?
        AND ed_cert_institute_code = ?
        AND ed_cert_deleted        = 0
    `;
    await ExecuteQuery(res, query, [ID, institute], false, {
      db:   TABLE,
      type: "update",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        AUDIT_FORM,
      description: `Eliminou certificado ID ${ID} — modelo "${certModel}", turma "${classTitle}".`,
    });

    res.status(200).json({
      success:    true,
      deleted_id: parseInt(ID),
      msg:        "Certificado escolar eliminado com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao eliminar o certificado escolar!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════ */
module.exports = {
  GetAllCertificates,
  GetCertificateById,
  RegisterCertificate,
  UpdateCertificate,
  DeleteCertificate,
};


/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ROUTES — Adicionar ao ficheiro de rotas principal (ex: routes.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const {
  GetAllCertificates,
  GetCertificateById,
  RegisterCertificate,
  UpdateCertificate,
  DeleteCertificate,
} = require("../Controllers/CertificatesController");

// ========== CERTIFICADOS ESCOLARES ==========
router.get ('/eduall-certificates/get',          VerifyToken, GetAllCertificates);
router.get ('/eduall-certificates/get/:ID',      VerifyToken, GetCertificateById);
router.post('/eduall-certificates/post',         VerifyToken, RegisterCertificate);
router.put ('/eduall-certificates/update/:ID',   VerifyToken, UpdateCertificate);
router.put ('/eduall-certificates/delete/:ID',   VerifyToken, DeleteCertificate);


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SQL — Estrutura da tabela (MySQL / MariaDB)
   Executar uma única vez na base de dados do instituto.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS `eduall_certificates` (

  -- ── Identificação ──────────────────────────────────────────────
  `ed_cert_id`             INT(11)       NOT NULL AUTO_INCREMENT,
  `ed_cert_institute_code` VARCHAR(50)   NOT NULL COMMENT 'Código do instituto — filtra por tenant',

  -- ── Configuração do certificado ────────────────────────────────
  `ed_cert_class_id`       INT(11)       DEFAULT NULL  COMMENT 'ID da turma selecionada',
  `ed_cert_class_title`    VARCHAR(255)  DEFAULT NULL  COMMENT 'Nome/label da turma (snapshot)',
  `ed_cert_academic_year`  VARCHAR(20)   DEFAULT NULL  COMMENT 'Ano lectivo, ex: 2024/2025',
  `ed_cert_model`          VARCHAR(20)   NOT NULL DEFAULT 'primario'
                             COMMENT 'Modelo: primario | secundario',
  `ed_cert_pass_value`     TINYINT(2)    NOT NULL DEFAULT 10
                             COMMENT 'Escala de avaliação: 10 ou 20',
  `ed_cert_font_size`      DECIMAL(4,1)  NOT NULL DEFAULT 11
                             COMMENT 'Tamanho de fonte em pt (9–13)',
  `ed_cert_border_mode`    VARCHAR(20)   NOT NULL DEFAULT 'none'
                             COMMENT 'Borda: none | single | double | certificate',
  `ed_cert_logo_url`       MEDIUMTEXT    DEFAULT NULL  COMMENT 'Base64 ou URL do logótipo',

  -- ── Configurações de layout (JSON) ────────────────────────────
  `ed_cert_header_lines`   JSON          DEFAULT NULL
                             COMMENT 'Linhas do cabeçalho: [{text, bold}]',
  `ed_cert_subjects`       JSON          DEFAULT NULL
                             COMMENT 'Disciplinas da tabela: [{id, name}]',
  `ed_cert_columns`        JSON          DEFAULT NULL
                             COMMENT 'Colunas da tabela: [{id, label, sublabel}]',

  -- ── Dados dos alunos (snapshot + notas) ───────────────────────
  `ed_cert_students`       JSON          DEFAULT NULL
                             COMMENT 'Snapshot completo dos alunos selecionados',
  `ed_cert_grades`         JSON          DEFAULT NULL
                             COMMENT 'Notas por aluno: {studentId:[{id,name,grades:{colId:val}}]}',
  `ed_cert_overrides`      JSON          DEFAULT NULL
                             COMMENT 'Overrides de texto por aluno: {studentId:{campo:valor}}',

  -- ── Campos de pesquisa rápida (texto simples) ─────────────────
  `ed_cert_student_names`  TEXT          DEFAULT NULL  COMMENT 'Nomes separados por vírgula',
  `ed_cert_student_codes`  TEXT          DEFAULT NULL  COMMENT 'Matrículas separadas por vírgula',
  `ed_cert_student_pics`   JSON          DEFAULT NULL  COMMENT 'URLs/base64 das fotos dos alunos',

  -- ── Controlo de estado e auditoria ────────────────────────────
  `ed_cert_deleted`        TINYINT(1)    NOT NULL DEFAULT 0  COMMENT 'Soft delete: 0=activo, 1=eliminado',
  `ed_cert_created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ed_cert_updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  -- ── Chaves ────────────────────────────────────────────────────
  PRIMARY KEY (`ed_cert_id`),
  KEY `idx_cert_institute`  (`ed_cert_institute_code`),
  KEY `idx_cert_class`      (`ed_cert_class_id`),
  KEY `idx_cert_model`      (`ed_cert_model`),
  KEY `idx_cert_deleted`    (`ed_cert_deleted`),
  KEY `idx_cert_updated`    (`ed_cert_updated_at`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Certificados escolares gerados pelo módulo PdCertificates';

*/