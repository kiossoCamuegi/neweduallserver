// CACHE-OPT v6 (aplicado por apply_cache_optimizations_v6.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v6: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

/* ═══════════════════════════════════════════════════════════════════
   TRANSFER GUIDES — Controller
   Componente : PdTransferGuide
   Baseado no padrão : CertificatesController.js

   Tabela  : eduall_transfer_guides
   Prefixo : ed_tg_
   Ver estrutura SQL completa e rotas no final deste ficheiro.
═══════════════════════════════════════════════════════════════════ */

const TABLE      = "eduall_transfer_guides";
const AUDIT_FORM = "Guias de Transferência";


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
───────────────────────────────────────────────────────────────── */
const toCommaSeparated = (val) => {
  if (!val)               return "";
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
};


/* ═══════════════════════════════════════════════════════════════════
   GET ALL — Listar todas as guias de transferência do instituto atual
   Endpoint : GET /eduall-transfer-guides/get
   Devolve  : Array ordenado pelo mais recente (updated_at DESC)
═══════════════════════════════════════════════════════════════════ */
const GetAllTransferGuides = async (req, res) => {
  try {
      const _ck = `transferGuides:${req.session.user.eduall_user_session_curentinstitute}:list`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.status(200).json(_hit);
    const query = `
      SELECT
        ed_tg_id,
        ed_tg_class_id,
        ed_tg_class_title,
        ed_tg_academic_year,
        ed_tg_font_size,
        ed_tg_border_mode,
        ed_tg_logo_url,
        ed_tg_coat_url,
        ed_tg_logo_position,
        ed_tg_header_lines,
        ed_tg_docs,
        ed_tg_students,
        ed_tg_overrides,
        ed_tg_student_name,
        ed_tg_student_names,
        ed_tg_student_codes,
        ed_tg_institute_code,
        ed_tg_created_at,
        ed_tg_updated_at
      FROM ${TABLE}
      WHERE ed_tg_deleted        = 0
        AND ed_tg_institute_code = ?
      ORDER BY ed_tg_updated_at DESC
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db:   TABLE,
      type: "select",
      data: req,
    });
    await _cacheSet(_ck, rows, 300);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao listar guias de transferência!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   GET SINGLE — Obter uma guia pelo ID
   Endpoint : GET /eduall-transfer-guides/get/:ID
   Devolve  : Array com um registo (padrão Eduall)
═══════════════════════════════════════════════════════════════════ */
const GetTransferGuideById = async (req, res) => {
  try {
      const _ck = `transferGuides:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.status(200).json(_hit);
    const { ID } = req.params;
    const query  = `
      SELECT *
      FROM ${TABLE}
      WHERE ed_tg_deleted        = 0
        AND ed_tg_id             = ?
        AND ed_tg_institute_code = ?
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
        msg:     "Guia de transferência não encontrada.",
      });
    }

    await _cacheSet(_ck, rows, 300);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao obter a guia de transferência!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   POST — Registar nova guia de transferência
   Endpoint : POST /eduall-transfer-guides/post
   Devolve  : { success, inserted_id, msg }

   Body esperado (JSON):
   {
     class_id        : number | null   — ID da turma selecionada
     class_title     : string          — Nome/label da turma
     academic_year   : string          — Ex: "2024/2025"
     font_size       : number          — Tamanho de fonte (9–13pt)
     border_mode     : string          — "none" | "single" | "double" | "certificate"
     logo_url        : string | null   — Base64 ou URL do logótipo da escola
     coat_url        : string | null   — Base64 ou URL das armas de Angola
     logo_position   : string          — "coat_only" | "coat_left" | "coat_right" | "coat_center" | "logo_only"
     header_lines    : array           — [{text: string, bold: boolean}]
     docs            : array           — [{id: string, description: string, qty: string}]
     students        : array           — snapshot completo dos alunos selecionados
     overrides       : object          — { studentId: { campo: valor, ... } }
     student_names   : array           — ["Nome 1", "Nome 2"]  (pesquisa rápida)
     student_codes   : array           — ["001", "002"]         (pesquisa rápida)
   }
═══════════════════════════════════════════════════════════════════ */
const RegisterTransferGuide = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      class_id,
      class_title,
      academic_year,
      font_size,
      border_mode,
      logo_url,
      coat_url,
      logo_position,
      header_lines,
      docs,
      students,
      overrides,
      student_names,
      student_codes,
    } = req.body;

    /* ── Validação mínima ─────────────────────────────────────── */
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        msg:     "É necessário selecionar pelo menos um aluno para registar a guia de transferência.",
      });
    }

    const validPositions = ["coat_only", "coat_left", "coat_right", "coat_center", "logo_only"];
    const safePosition   = validPositions.includes(logo_position) ? logo_position : "coat_left";

    /* ── Extrair nome do primeiro aluno para pesquisa rápida ──── */
    const firstStudentName = students[0]?.student_name || students[0]?.label || null;

    /* ── Inserir ──────────────────────────────────────────────── */
    const query = `
      INSERT INTO ${TABLE} (
        ed_tg_class_id,
        ed_tg_class_title,
        ed_tg_academic_year,
        ed_tg_font_size,
        ed_tg_border_mode,
        ed_tg_logo_url,
        ed_tg_coat_url,
        ed_tg_logo_position,
        ed_tg_header_lines,
        ed_tg_docs,
        ed_tg_students,
        ed_tg_overrides,
        ed_tg_student_name,
        ed_tg_student_names,
        ed_tg_student_codes,
        ed_tg_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      font_size     || 11,
      border_mode   || "none",
      logo_url      || null,
      coat_url      || null,
      safePosition,
      toJson(header_lines),
      toJson(docs),
      toJson(students),
      toJson(overrides),
      firstStudentName,
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      institute,
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db:   TABLE,
      type: "insert",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        AUDIT_FORM,
      description: `Registou nova guia de transferência — turma "${class_title || "—"}", ${students.length} aluno(s): ${toCommaSeparated(student_names)}.`,
    });

    await _cacheClear(`transferGuides:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json({
      success:     true,
      inserted_id: result.insertId || null,
      msg:         "Guia de transferência guardada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao registar a guia de transferência!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT — Atualizar guia de transferência existente
   Endpoint : PUT /eduall-transfer-guides/update/:ID
   Devolve  : { success, updated_id, msg }

   Body     : mesmo formato do POST acima.
   Atualiza todos os campos de configuração + dados dos alunos.
   Verifica se o registo pertence ao instituto antes de alterar.
═══════════════════════════════════════════════════════════════════ */
const UpdateTransferGuide = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_tg_id FROM ${TABLE}
      WHERE ed_tg_id             = ?
        AND ed_tg_institute_code = ?
        AND ed_tg_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db:   TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg:     "Guia não encontrada ou sem permissão para editar.",
      });
    }

    const {
      class_id,
      class_title,
      academic_year,
      font_size,
      border_mode,
      logo_url,
      coat_url,
      logo_position,
      header_lines,
      docs,
      students,
      overrides,
      student_names,
      student_codes,
    } = req.body;

    /* ── Validação mínima ─────────────────────────────────────── */
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        msg:     "É necessário pelo menos um aluno para atualizar a guia.",
      });
    }

    const validPositions = ["coat_only", "coat_left", "coat_right", "coat_center", "logo_only"];
    const safePosition   = validPositions.includes(logo_position) ? logo_position : "coat_left";
    const firstStudentName = students[0]?.student_name || students[0]?.label || null;

    /* ── Atualizar ────────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE} SET
        ed_tg_class_id      = ?,
        ed_tg_class_title   = ?,
        ed_tg_academic_year = ?,
        ed_tg_font_size     = ?,
        ed_tg_border_mode   = ?,
        ed_tg_logo_url      = ?,
        ed_tg_coat_url      = ?,
        ed_tg_logo_position = ?,
        ed_tg_header_lines  = ?,
        ed_tg_docs          = ?,
        ed_tg_students      = ?,
        ed_tg_overrides     = ?,
        ed_tg_student_name  = ?,
        ed_tg_student_names = ?,
        ed_tg_student_codes = ?,
        ed_tg_updated_at    = NOW()
      WHERE ed_tg_id             = ?
        AND ed_tg_institute_code = ?
        AND ed_tg_deleted        = 0
    `;
    const PARAMS = [
      class_id      || null,
      class_title   || null,
      academic_year || null,
      font_size     || 11,
      border_mode   || "none",
      logo_url      || null,
      coat_url      || null,
      safePosition,
      toJson(header_lines),
      toJson(docs),
      toJson(students),
      toJson(overrides),
      firstStudentName,
      toCommaSeparated(student_names),
      toCommaSeparated(student_codes),
      ID,
      institute,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db:   TABLE,
      type: "update",
      data: req,
    });

    /* ── Auditoria ────────────────────────────────────────────── */
    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        AUDIT_FORM,
      description: `Atualizou guia de transferência ID ${ID} — turma "${class_title || "—"}", ${students.length} aluno(s).`,
    });

    await _cacheClear(`transferGuides:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json({
      success:    true,
      updated_id: parseInt(ID),
      msg:        "Guia de transferência actualizada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar a guia de transferência!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   PUT (soft delete) — Eliminar guia de transferência
   Endpoint : PUT /eduall-transfer-guides/delete/:ID
   Devolve  : { success, deleted_id, msg }

   Usa soft delete (ed_tg_deleted = 1), igual ao padrão do sistema.
   Verifica se pertence ao instituto antes de marcar como eliminado.
═══════════════════════════════════════════════════════════════════ */
const DeleteTransferGuide = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    /* ── Verificar existência e propriedade ───────────────────── */
    const checkQuery = `
      SELECT ed_tg_id, ed_tg_class_title, ed_tg_student_name FROM ${TABLE}
      WHERE ed_tg_id             = ?
        AND ed_tg_institute_code = ?
        AND ed_tg_deleted        = 0
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db:   TABLE,
      type: "select",
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        msg:     "Guia não encontrada ou já eliminada.",
      });
    }

    const classTitle   = existing[0]?.ed_tg_class_title   || "—";
    const studentName  = existing[0]?.ed_tg_student_name  || "—";

    /* ── Soft delete ──────────────────────────────────────────── */
    const query = `
      UPDATE ${TABLE}
      SET ed_tg_deleted    = 1,
          ed_tg_updated_at = NOW()
      WHERE ed_tg_id             = ?
        AND ed_tg_institute_code = ?
        AND ed_tg_deleted        = 0
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
      description: `Eliminou guia de transferência ID ${ID} — aluno "${studentName}", turma "${classTitle}".`,
    });

    await _cacheClear(`transferGuides:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json({
      success:    true,
      deleted_id: parseInt(ID),
      msg:        "Guia de transferência eliminada com sucesso!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao eliminar a guia de transferência!",
      error:   error.message,
    });
  }
};


/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════ */
module.exports = {
  GetAllTransferGuides,
  GetTransferGuideById,
  RegisterTransferGuide,
  UpdateTransferGuide,
  DeleteTransferGuide,
};


/*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ROUTES — Adicionar ao ficheiro de rotas principal (ex: routes.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const {
  GetAllTransferGuides,
  GetTransferGuideById,
  RegisterTransferGuide,
  UpdateTransferGuide,
  DeleteTransferGuide,
} = require("../Controllers/TransferGuidesController");

// ========== GUIAS DE TRANSFERÊNCIA ==========
router.get ('/eduall-transfer-guides/get',          VerifyToken, GetAllTransferGuides);
router.get ('/eduall-transfer-guides/get/:ID',      VerifyToken, GetTransferGuideById);
router.post('/eduall-transfer-guides/post',         VerifyToken, RegisterTransferGuide);
router.put ('/eduall-transfer-guides/update/:ID',   VerifyToken, UpdateTransferGuide);
router.put ('/eduall-transfer-guides/delete/:ID',   VerifyToken, DeleteTransferGuide);


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SQL — Estrutura da tabela (MySQL / MariaDB)
   Executar uma única vez na base de dados do instituto.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS `eduall_transfer_guides` (

  -- ── Identificação ──────────────────────────────────────────────
  `ed_tg_id`               INT(11)       NOT NULL AUTO_INCREMENT,
  `ed_tg_institute_code`   VARCHAR(50)   NOT NULL COMMENT 'Código do instituto — filtra por tenant',

  -- ── Configuração do documento ──────────────────────────────────
  `ed_tg_class_id`         INT(11)       DEFAULT NULL  COMMENT 'ID da turma selecionada',
  `ed_tg_class_title`      VARCHAR(255)  DEFAULT NULL  COMMENT 'Nome/label da turma (snapshot)',
  `ed_tg_academic_year`    VARCHAR(20)   DEFAULT NULL  COMMENT 'Ano lectivo, ex: 2024/2025',
  `ed_tg_font_size`        DECIMAL(4,1)  NOT NULL DEFAULT 11
                               COMMENT 'Tamanho de fonte em pt (9–13)',
  `ed_tg_border_mode`      VARCHAR(20)   NOT NULL DEFAULT 'none'
                               COMMENT 'Borda: none | single | double | certificate',

  -- ── Imagens ────────────────────────────────────────────────────
  `ed_tg_logo_url`         MEDIUMTEXT    DEFAULT NULL  COMMENT 'Base64 ou URL do logótipo da escola',
  `ed_tg_coat_url`         MEDIUMTEXT    DEFAULT NULL  COMMENT 'Base64 ou URL das Armas de Angola',
  `ed_tg_logo_position`    VARCHAR(20)   NOT NULL DEFAULT 'coat_left'
                               COMMENT 'Posição: coat_only | coat_left | coat_right | coat_center | logo_only',

  -- ── Configurações de layout (JSON) ────────────────────────────
  `ed_tg_header_lines`     JSON          DEFAULT NULL
                               COMMENT 'Linhas do cabeçalho: [{text, bold}]',
  `ed_tg_docs`             JSON          DEFAULT NULL
                               COMMENT 'Documentos a remeter: [{id, description, qty}]',

  -- ── Dados dos alunos (snapshot + overrides) ───────────────────
  `ed_tg_students`         JSON          DEFAULT NULL
                               COMMENT 'Snapshot completo dos alunos selecionados',
  `ed_tg_overrides`        JSON          DEFAULT NULL
                               COMMENT 'Overrides de texto por aluno: {studentId:{campo:valor}}',

  -- ── Campos de pesquisa rápida (texto simples) ─────────────────
  `ed_tg_student_name`     VARCHAR(255)  DEFAULT NULL  COMMENT 'Nome do primeiro aluno (pesquisa rápida)',
  `ed_tg_student_names`    TEXT          DEFAULT NULL  COMMENT 'Nomes separados por vírgula',
  `ed_tg_student_codes`    TEXT          DEFAULT NULL  COMMENT 'Matrículas separadas por vírgula',

  -- ── Controlo de estado e auditoria ────────────────────────────
  `ed_tg_deleted`          TINYINT(1)    NOT NULL DEFAULT 0  COMMENT 'Soft delete: 0=activo, 1=eliminado',
  `ed_tg_created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ed_tg_updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  -- ── Chaves ────────────────────────────────────────────────────
  PRIMARY KEY (`ed_tg_id`),
  KEY `idx_tg_institute`   (`ed_tg_institute_code`),
  KEY `idx_tg_class`       (`ed_tg_class_id`),
  KEY `idx_tg_deleted`     (`ed_tg_deleted`),
  KEY `idx_tg_updated`     (`ed_tg_updated_at`),
  FULLTEXT KEY `idx_tg_names` (`ed_tg_student_names`, `ed_tg_student_codes`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Guias de Transferência escolares geradas pelo módulo PdTransferGuide';

*/