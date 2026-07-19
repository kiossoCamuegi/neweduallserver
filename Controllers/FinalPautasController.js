/*
 * ══════════════════════════════════════════════════════════════════
 *  FinalPautasController.js — Histórico de Pautas Finais
 *  Módulo: Relatórios / Pautas Finais
 * ══════════════════════════════════════════════════════════════════
 *
 *  TABELA NECESSÁRIA — executar no MySQL antes de usar:
 *
 *  CREATE TABLE `eduall_final_pautas` (
 *    `ed_pauta_id`            INT(11)      NOT NULL AUTO_INCREMENT,
 *    `ed_pauta_name`          VARCHAR(255) NOT NULL,
 *    `ed_pauta_class_id`      INT(11)      DEFAULT NULL,
 *    `ed_pauta_class_title`   VARCHAR(255) DEFAULT NULL,
 *    `ed_pauta_level_title`   VARCHAR(255) DEFAULT NULL,
 *    `ed_pauta_model`         ENUM('normal','exame','iniciacao') NOT NULL DEFAULT 'normal',
 *    `ed_pauta_snapshot`      LONGTEXT     DEFAULT NULL,
 *    `ed_pauta_institute_code` VARCHAR(100) NOT NULL,
 *    `ed_pauta_created_by`    INT(11)      DEFAULT NULL,
 *    `ed_pauta_user_name`     VARCHAR(255) DEFAULT NULL,
 *    `ed_pauta_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
 *    `ed_pauta_created_at`    DATETIME     DEFAULT CURRENT_TIMESTAMP,
 *    `ed_pauta_updated_at`    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *    PRIMARY KEY (`ed_pauta_id`),
 *    KEY `idx_pauta_institute` (`ed_pauta_institute_code`),
 *    KEY `idx_pauta_class`     (`ed_pauta_class_id`),
 *    KEY `idx_pauta_deleted`   (`ed_pauta_deleted`)
 *  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
 *
 * ══════════════════════════════════════════════════════════════════
 *  ROTAS (adicionar ao ficheiro de rotas principal):
 *
 *  // ========== PAUTAS FINAIS ==========
 *  router.get( '/eduall-final-pautas/get',         VerifyToken, GetFinalPautas);
 *  router.get( '/eduall-final-pautas/get/:ID',     VerifyToken, GetSingleFinalPauta);
 *  router.post('/eduall-final-pautas/post',         VerifyToken, RegisterFinalPauta);
 *  router.put( '/eduall-final-pautas/update/:ID',  VerifyToken, UpdateFinalPauta);
 *  router.put( '/eduall-final-pautas/delete/:ID',  VerifyToken, DeleteFinalPauta);
 *
 * ══════════════════════════════════════════════════════════════════
 */

const ExecuteQuery    = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ─────────────────────────────────────────────────────────────────
   HELPER — resolve o nome do utilizador da sessão de forma segura
───────────────────────────────────────────────────────────────── */
function resolveUserName(session) {
   if (!session?.user) return null;
   const u = session.user;
   return (
      u.eduall_user_name           ||
      u.eduall_user_session_name   ||
      u.ed_employee_name           ||
      u.name                       ||
      null
   );
}

/* ─────────────────────────────────────────────────────────────────
   GET ALL — lista todas as pautas da instituição (não eliminadas)
   Ordenadas por data de actualização descendente (mais recente primeiro)
───────────────────────────────────────────────────────────────── */
const GetFinalPautas = async (req, res) => {
   try {
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;

      const query = `
         SELECT
            ed_pauta_id,
            ed_pauta_name,
            ed_pauta_class_id,
            ed_pauta_class_title,
            ed_pauta_level_title,
            ed_pauta_model,
            ed_pauta_snapshot,
            ed_pauta_institute_code,
            ed_pauta_created_by,
            ed_pauta_user_name,
            ed_pauta_deleted,
            ed_pauta_created_at,
            ed_pauta_updated_at
         FROM eduall_final_pautas
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_institute_code = ?
         ORDER BY ed_pauta_updated_at DESC
      `;

      const PARAMS = [instituteCode];
      const rows   = await ExecuteQuery(res, query, PARAMS, true, {
         db:   "eduall_final_pautas",
         type: "select",
         data: req,
      });

      return res.status(200).json(rows);
   } catch (err) {
      return res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ─────────────────────────────────────────────────────────────────
   GET SINGLE — devolve uma pauta pelo ID
───────────────────────────────────────────────────────────────── */
const GetSingleFinalPauta = async (req, res) => {
   try {
      const { ID }        = req.params;
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;

      const query = `
         SELECT *
         FROM eduall_final_pautas
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_id = ?
           AND ed_pauta_institute_code = ?
         LIMIT 1
      `;

      const PARAMS = [ID, instituteCode];
      const rows   = await ExecuteQuery(res, query, PARAMS, true, {
         db:   "eduall_final_pautas",
         type: "select",
         data: req,
      });

      if (!rows || rows.length === 0) {
         return res.status(404).json({ success: false, msg: "Pauta não encontrada." });
      }

      return res.status(200).json(rows[0]);
   } catch (err) {
      return res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ─────────────────────────────────────────────────────────────────
   REGISTER — cria uma nova pauta no histórico
   Body esperado:
     { name, class_id, class_title, level_title, pauta_model, snapshot }
───────────────────────────────────────────────────────────────── */
const RegisterFinalPauta = async (req, res) => {
   try {
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;
      const userId        = req.session.user.eduall_user_id || req.session.user.id || null;
      const userName      = resolveUserName(req.session);

      const {
         name         = "",
         class_id     = null,
         class_title  = "",
         level_title  = "",
         pauta_model  = "normal",
         snapshot     = null,
      } = req.body;

      if (!name || !name.trim()) {
         return res.status(400).json({ success: false, msg: "O nome da pauta é obrigatório." });
      }

      // Validar modelo
      const validModels = ["normal", "exame", "iniciacao"];
      const safeModel   = validModels.includes(pauta_model) ? pauta_model : "normal";

      // Serializar o snapshot (pode já vir como string ou como objecto)
      const snapshotStr = snapshot
         ? (typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot))
         : null;

      const query = `
         INSERT INTO eduall_final_pautas (
            ed_pauta_name,
            ed_pauta_class_id,
            ed_pauta_class_title,
            ed_pauta_level_title,
            ed_pauta_model,
            ed_pauta_snapshot,
            ed_pauta_institute_code,
            ed_pauta_created_by,
            ed_pauta_user_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const PARAMS = [
         name.trim(),
         class_id  || null,
         class_title  || "",
         level_title  || "",
         safeModel,
         snapshotStr,
         instituteCode,
         userId,
         userName,
      ];

      const result = await ExecuteQuery(res, query, PARAMS, false, {
         db:   "eduall_final_pautas",
         type: "insert",
         data: req,
      });

      // Registo de auditoria
      await RegisterAuditAction({
         session:     req.session,
         action:      1,
         form:        "Pautas Finais",
         description: `Guardou a pauta final "${name.trim()}" (${safeModel}) — turma: ${class_title || "—"}`,
      });

      return res.status(200).json({
         success:     true,
         msg:         "Pauta guardada com sucesso!",
         inserted_id: result?.insertId || null,
      });
   } catch (err) {
      return res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ─────────────────────────────────────────────────────────────────
   UPDATE — actualiza uma pauta existente (nome, modelo, snapshot)
   Body esperado (todos opcionais):
     { name, pauta_model, class_title, level_title, snapshot }
   Quando apenas o nome muda (rename inline do histórico),
   o snapshot pode não ser enviado — nesse caso só actualiza o nome.
───────────────────────────────────────────────────────────────── */
const UpdateFinalPauta = async (req, res) => {
   try {
      const { ID }        = req.params;
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;

      // Verificar que a pauta pertence à instituição
      const checkQuery  = `
         SELECT ed_pauta_id, ed_pauta_name
         FROM eduall_final_pautas
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_id = ?
           AND ed_pauta_institute_code = ?
         LIMIT 1
      `;
      const existing = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
         db: "eduall_final_pautas", type: "select", data: req,
      });

      if (!existing || existing.length === 0) {
         return res.status(404).json({ success: false, msg: "Pauta não encontrada ou sem permissão." });
      }

      const {
         name,
         pauta_model,
         class_id,
         class_title,
         level_title,
         snapshot,
      } = req.body;

      // Construir SET dinamicamente — só actualiza o que foi enviado
      const setClauses = [];
      const PARAMS     = [];

      if (name !== undefined && name !== null) {
         if (!String(name).trim()) {
            return res.status(400).json({ success: false, msg: "O nome da pauta não pode estar vazio." });
         }
         setClauses.push("ed_pauta_name = ?");
         PARAMS.push(String(name).trim());
      }

      if (pauta_model !== undefined) {
         const validModels = ["normal", "exame", "iniciacao"];
         const safeModel   = validModels.includes(pauta_model) ? pauta_model : "normal";
         setClauses.push("ed_pauta_model = ?");
         PARAMS.push(safeModel);
      }

      if (class_id !== undefined) {
         setClauses.push("ed_pauta_class_id = ?");
         PARAMS.push(class_id || null);
      }

      if (class_title !== undefined) {
         setClauses.push("ed_pauta_class_title = ?");
         PARAMS.push(class_title || "");
      }

      if (level_title !== undefined) {
         setClauses.push("ed_pauta_level_title = ?");
         PARAMS.push(level_title || "");
      }

      if (snapshot !== undefined && snapshot !== null) {
         const snapshotStr = typeof snapshot === "string"
            ? snapshot
            : JSON.stringify(snapshot);
         setClauses.push("ed_pauta_snapshot = ?");
         PARAMS.push(snapshotStr);
      }

      if (setClauses.length === 0) {
         return res.status(400).json({ success: false, msg: "Nenhum campo para actualizar." });
      }

      // ed_pauta_updated_at é actualizado automaticamente pelo ON UPDATE CURRENT_TIMESTAMP
      const updateQuery = `
         UPDATE eduall_final_pautas
         SET ${setClauses.join(", ")}
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_id = ?
           AND ed_pauta_institute_code = ?
      `;
      PARAMS.push(ID, instituteCode);

      await ExecuteQuery(res, updateQuery, PARAMS, false, {
         db:   "eduall_final_pautas",
         type: "update",
         data: req,
      });

      // Registo de auditoria
      const pautaName = (name !== undefined ? String(name).trim() : existing[0].ed_pauta_name) || `ID ${ID}`;
      await RegisterAuditAction({
         session:     req.session,
         action:      2,
         form:        "Pautas Finais",
         description: `Actualizou a pauta final "${pautaName}" (ID ${ID})`,
      });

      return res.status(200).json({
         success: true,
         msg:     "Pauta actualizada com sucesso!",
      });
   } catch (err) {
      return res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ─────────────────────────────────────────────────────────────────
   DELETE — soft delete (ed_pauta_deleted = 1)
───────────────────────────────────────────────────────────────── */
const DeleteFinalPauta = async (req, res) => {
   try {
      const { ID }        = req.params;
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;

      // Verificar existência e obter nome para auditoria
      const checkQuery = `
         SELECT ed_pauta_id, ed_pauta_name
         FROM eduall_final_pautas
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_id = ?
           AND ed_pauta_institute_code = ?
         LIMIT 1
      `;
      const existing = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
         db: "eduall_final_pautas", type: "select", data: req,
      });

      if (!existing || existing.length === 0) {
         return res.status(404).json({ success: false, msg: "Pauta não encontrada ou sem permissão." });
      }

      const deleteQuery = `
         UPDATE eduall_final_pautas
         SET ed_pauta_deleted = 1
         WHERE ed_pauta_deleted = 0
           AND ed_pauta_id = ?
           AND ed_pauta_institute_code = ?
      `;

      await ExecuteQuery(res, deleteQuery, [ID, instituteCode], false, {
         db:   "eduall_final_pautas",
         type: "update",
         data: req,
      });

      // Registo de auditoria
      await RegisterAuditAction({
         session:     req.session,
         action:      3,
         form:        "Pautas Finais",
         description: `Eliminou a pauta final "${existing[0].ed_pauta_name}" (ID ${ID})`,
      });

      return res.status(200).json({
         success: true,
         msg:     "Pauta eliminada com sucesso!",
      });
   } catch (err) {
      return res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ─────────────────────────────────────────────────────────────────
   EXPORTS
───────────────────────────────────────────────────────────────── */
module.exports = {
   GetFinalPautas,
   GetSingleFinalPauta,
   RegisterFinalPauta,
   UpdateFinalPauta,
   DeleteFinalPauta,
};

/*
 * ══════════════════════════════════════════════════════════════════
 *  ROTAS — adicionar ao ficheiro de rotas (ex: routes/index.js)
 *
 *  const {
 *     GetFinalPautas,
 *     GetSingleFinalPauta,
 *     RegisterFinalPauta,
 *     UpdateFinalPauta,
 *     DeleteFinalPauta,
 *  } = require("../Controllers/FinalPautasController");
 *
 *  // ========== PAUTAS FINAIS ==========
 *  router.get( '/eduall-final-pautas/get',        VerifyToken, GetFinalPautas);
 *  router.get( '/eduall-final-pautas/get/:ID',    VerifyToken, GetSingleFinalPauta);
 *  router.post('/eduall-final-pautas/post',        VerifyToken, RegisterFinalPauta);
 *  router.put( '/eduall-final-pautas/update/:ID', VerifyToken, UpdateFinalPauta);
 *  router.put( '/eduall-final-pautas/delete/:ID', VerifyToken, DeleteFinalPauta);
 *
 * ══════════════════════════════════════════════════════════════════
 */