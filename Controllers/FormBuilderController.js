// FormBuilderController.js
// Rotas + Sockets para o Form Builder (CRUD de formulários, entradas e importações)
// Depende das tuas helpers existentes:
const express = require("express");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const GetSocketIo = require("../Sockets/GetSocketIo");
const { RegisterAuditAction } = require("./Auditory");

// ====== Utils ======
const nowIso = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const needSession = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ success: false, message: "Sessão inválida" });
  next();
};
 

// ====== Esquema (padrão eduall_* + ed_*_id, etc) ======
async function ensureSchema(res, req) {
  const createForms = `
    CREATE TABLE IF NOT EXISTS eduall_formbuilder_forms (
      ed_form_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ed_form_institute_code VARCHAR(100) NOT NULL,
      ed_form_name VARCHAR(180) NOT NULL,
      ed_form_layout ENUM('stack','two') NOT NULL DEFAULT 'stack',
      ed_form_schema JSON NOT NULL,
      ed_form_deleted TINYINT(1) NOT NULL DEFAULT 0,
      ed_form_created_by BIGINT UNSIGNED NULL,
      ed_form_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ed_form_updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_inst_name (ed_form_institute_code, ed_form_name),
      INDEX idx_inst_deleted (ed_form_institute_code, ed_form_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createEntries = `
    CREATE TABLE IF NOT EXISTS eduall_formbuilder_entries (
      ed_form_entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ed_form_id BIGINT UNSIGNED NOT NULL,
      ed_form_entry_user_id BIGINT UNSIGNED NULL,
      ed_form_entry_data JSON NOT NULL,
      ed_form_entry_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ed_form_entry_updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_form (ed_form_id),
      CONSTRAINT fk_entries_form FOREIGN KEY (ed_form_id) REFERENCES eduall_formbuilder_forms(ed_form_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createImportJobs = `
    CREATE TABLE IF NOT EXISTS eduall_formbuilder_import_jobs (
      ed_form_import_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ed_form_id BIGINT UNSIGNED NOT NULL,
      ed_form_import_total_rows INT UNSIGNED NOT NULL DEFAULT 0,
      ed_form_import_processed_rows INT UNSIGNED NOT NULL DEFAULT 0,
      ed_form_import_status ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
      ed_form_import_created_by BIGINT UNSIGNED NULL,
      ed_form_import_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_form_status (ed_form_id, ed_form_import_status),
      CONSTRAINT fk_import_form FOREIGN KEY (ed_form_id) REFERENCES eduall_formbuilder_forms(ed_form_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await ExecuteQuery(res, createForms, [], false, { db: "eduall_formbuilder_forms", type: "create", data: req });
  await ExecuteQuery(res, createEntries, [], false, { db: "eduall_formbuilder_entries", type: "create", data: req });
  await ExecuteQuery(res, createImportJobs, [], false, { db: "eduall_formbuilder_import_jobs", type: "create", data: req });
}

// ====== Helpers ======
function toClientForm(row) {
  return {
    id: Number(row.ed_form_id),
    institute_code: row.ed_form_institute_code,
    name: row.ed_form_name,
    layout: row.ed_form_layout,
    schema: safeParse(row.ed_form_schema) || [],
    created_at: row.ed_form_created_at,
    updated_at: row.ed_form_updated_at,
  };
}
function toClientEntry(row) {
  return {
    id: Number(row.ed_form_entry_id),
    form_id: Number(row.ed_form_id),
    user_id: row.ed_form_entry_user_id ? Number(row.ed_form_entry_user_id) : null,
    data: safeParse(row.ed_form_entry_data) || {},
    created_at: row.ed_form_entry_created_at,
    updated_at: row.ed_form_entry_updated_at,
  };
}
function safeParse(j) {
  try { return typeof j === "string" ? JSON.parse(j) : j; } catch { return null; }
}

// ====== Controller Builder ======
function buildFormBuilderController() {
  const router = express.Router();

  // Listar formulários
  router.get("/formbuilder/forms", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const rows = await ExecuteQuery(
        res,
        `SELECT * FROM eduall_formbuilder_forms WHERE ed_form_institute_code = ? AND ed_form_deleted = 0 ORDER BY ed_form_created_at DESC`,
        [inst],
        true,
        { db: "eduall_formbuilder_forms", type: "select", data: req }
      );
      res.json(rows.map(toClientForm));
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Criar formulário
  router.post("/formbuilder/forms", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const uid = req.session.user.eduall_user_session_ID;
      const { name, layout = "stack", schema = [] } = req.body;

      const sql = `
        INSERT INTO eduall_formbuilder_forms
        (ed_form_institute_code, ed_form_name, ed_form_layout, ed_form_schema, ed_form_created_by)
        VALUES (?, ?, ?, ?, ?)
      `;
      const r = await ExecuteQuery(res, sql, [inst, name, layout, JSON.stringify(schema), uid || null], false, {
        db: "eduall_formbuilder_forms",
        type: "insert",
        data: req,
      });

      await RegisterAuditAction({
        session: req.session, action: 1, form: "FormBuilder", description: `Criou formulário "${name}"`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:form:created", { form: { id: r?.insertId, name, layout, schema } });

      res.status(201).json({ id: r?.insertId });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Obter formulário
  router.get("/formbuilder/forms/:id", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const id = Number(req.params.id);
      const [row] = await ExecuteQuery(
        res,
        `SELECT * FROM eduall_formbuilder_forms WHERE ed_form_institute_code = ? AND ed_form_id = ? AND ed_form_deleted = 0 LIMIT 1`,
        [inst, id],
        true,
        { db: "eduall_formbuilder_forms", type: "select", data: req }
      );
      if (!row) return res.status(404).json({ message: "Formulário não encontrado" });
      res.json(toClientForm(row));
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Atualizar formulário
  router.put("/formbuilder/forms/:id", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const id = Number(req.params.id);
      const { name, layout = "stack", schema = [] } = req.body;

      const up = `
        UPDATE eduall_formbuilder_forms
        SET ed_form_name = ?, ed_form_layout = ?, ed_form_schema = ?, ed_form_updated_at = ?
        WHERE ed_form_institute_code = ? AND ed_form_id = ? AND ed_form_deleted = 0
        LIMIT 1
      `;
      await ExecuteQuery(res, up, [name, layout, JSON.stringify(schema), nowIso(), inst, id], false, {
        db: "eduall_formbuilder_forms", type: "update", data: req
      });

      await RegisterAuditAction({
        session: req.session, action: 2, form: "FormBuilder", description: `Atualizou formulário "${name}" (#${id})`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:form:updated", { form: { id, name, layout, schema } });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Apagar formulário (soft-delete)
  router.delete("/formbuilder/forms/:id", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const id = Number(req.params.id);
      await ExecuteQuery(
        res,
        `UPDATE eduall_formbuilder_forms SET ed_form_deleted = 1, ed_form_updated_at = ? WHERE ed_form_institute_code = ? AND ed_form_id = ? AND ed_form_deleted = 0 LIMIT 1`,
        [nowIso(), inst, id],
        false,
        { db: "eduall_formbuilder_forms", type: "update", data: req }
      );

      await RegisterAuditAction({
        session: req.session, action: 3, form: "FormBuilder", description: `Eliminou formulário #${id}`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:form:deleted", { form_id: id });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Listar entradas
  router.get("/formbuilder/forms/:id/entries", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const formId = Number(req.params.id);
      const limit = Math.min(Number(req.query.limit) || 50, 500);

      // garante o form no instituto
      const [exists] = await ExecuteQuery(
        res,
        `SELECT 1 FROM eduall_formbuilder_forms WHERE ed_form_institute_code = ? AND ed_form_id = ? AND ed_form_deleted = 0 LIMIT 1`,
        [inst, formId],
        true,
        { db: "eduall_formbuilder_forms", type: "select", data: req }
      );
      if (!exists) return res.status(404).json({ message: "Formulário não encontrado" });

      const rows = await ExecuteQuery(
        res,
        `SELECT * FROM eduall_formbuilder_entries WHERE ed_form_id = ? ORDER BY ed_form_entry_created_at DESC LIMIT ?`,
        [formId, limit],
        true,
        { db: "eduall_formbuilder_entries", type: "select", data: req }
      );
      res.json({ items: rows.map(toClientEntry) });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Criar entrada
  router.post("/formbuilder/forms/:id/entries", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const uid = req.session.user.eduall_user_session_ID;
      const formId = Number(req.params.id);
      const { data } = req.body;

      const [exists] = await ExecuteQuery(
        res,
        `SELECT 1 FROM eduall_formbuilder_forms WHERE ed_form_institute_code = ? AND ed_form_id = ? AND ed_form_deleted = 0 LIMIT 1`,
        [inst, formId],
        true,
        { db: "eduall_formbuilder_forms", type: "select", data: req }
      );
      if (!exists) return res.status(404).json({ message: "Formulário não encontrado" });

      const ins = `
        INSERT INTO eduall_formbuilder_entries (ed_form_id, ed_form_entry_user_id, ed_form_entry_data)
        VALUES (?, ?, ?)
      `;
      const r = await ExecuteQuery(res, ins, [formId, uid || null, JSON.stringify(data || {})], false, {
        db: "eduall_formbuilder_entries", type: "insert", data: req
      });

      await RegisterAuditAction({
        session: req.session, action: 1, form: "FormBuilder - Entry", description: `Criou registo no form #${formId}`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:entry:changed", { form_id: formId, entry_id: r?.insertId, action: "created" });

      res.status(201).json({ id: r?.insertId });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Atualizar entrada
  router.put("/formbuilder/forms/:id/entries/:entryId", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const formId = Number(req.params.id);
      const entryId = Number(req.params.entryId);
      const { data } = req.body;

      const up = `
        UPDATE eduall_formbuilder_entries
        SET ed_form_entry_data = ?, ed_form_entry_updated_at = ?
        WHERE ed_form_id = ? AND ed_form_entry_id = ?
        LIMIT 1
      `;
      await ExecuteQuery(res, up, [JSON.stringify(data || {}), nowIso(), formId, entryId], false, {
        db: "eduall_formbuilder_entries", type: "update", data: req
      });

      await RegisterAuditAction({
        session: req.session, action: 2, form: "FormBuilder - Entry", description: `Atualizou registo #${entryId} do form #${formId}`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:entry:changed", { form_id: formId, entry_id: entryId, action: "updated" });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Apagar entrada
  router.delete("/formbuilder/forms/:id/entries/:entryId", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const formId = Number(req.params.id);
      const entryId = Number(req.params.entryId);

      await ExecuteQuery(res, `DELETE FROM eduall_formbuilder_entries WHERE ed_form_id = ? AND ed_form_entry_id = ? LIMIT 1`,
        [formId, entryId], false, { db: "eduall_formbuilder_entries", type: "delete", data: req });

      await RegisterAuditAction({
        session: req.session, action: 3, form: "FormBuilder - Entry", description: `Eliminou registo #${entryId} do form #${formId}`, res, req,
      });

      const io = GetSocketIo.get?.();
      io?.to(`inst:${inst}`)?.emit("formbuilder:entry:changed", { form_id: formId, entry_id: entryId, action: "deleted" });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // Importação de dados (JSON rows já mapeadas pelo FE)
  router.post("/formbuilder/forms/:id/import", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const uid = req.session.user.eduall_user_session_ID;
      const formId = Number(req.params.id);
      const { rows = [] } = req.body;

      const insJob = `
        INSERT INTO eduall_formbuilder_import_jobs (ed_form_id, ed_form_import_total_rows, ed_form_import_processed_rows, ed_form_import_status, ed_form_import_created_by)
        VALUES (?, ?, 0, 'queued', ?)
      `;
      const job = await ExecuteQuery(res, insJob, [formId, rows.length, uid || null], false, {
        db: "eduall_formbuilder_import_jobs", type: "insert", data: req
      });

      const jobId = job?.insertId;
      const io = GetSocketIo.get?.();
      res.json({ job_id: jobId });

      // Processamento “em background” (inline, mas não bloqueia a resposta)
      (async () => {
        try {
          await ExecuteQuery(res, `UPDATE eduall_formbuilder_import_jobs SET ed_form_import_status='running' WHERE ed_form_import_id=? LIMIT 1`,
            [jobId], false, { db: "eduall_formbuilder_import_jobs", type:"update", data: req });

          let processed = 0;
          for (const r of rows) {
            const ins = `
              INSERT INTO eduall_formbuilder_entries (ed_form_id, ed_form_entry_user_id, ed_form_entry_data)
              VALUES (?, ?, ?)
            `;
            await ExecuteQuery(res, ins, [formId, uid || null, JSON.stringify(r)], false, {
              db: "eduall_formbuilder_entries", type: "insert", data: req
            });
            processed++;

            // Atualiza progresso a cada 50 (ou no fim)
            if (processed % 50 === 0 || processed === rows.length) {
              await ExecuteQuery(res, `UPDATE eduall_formbuilder_import_jobs SET ed_form_import_processed_rows=? WHERE ed_form_import_id=? LIMIT 1`,
                [processed, jobId], false, { db: "eduall_formbuilder_import_jobs", type:"update", data: req });

              io?.to(`inst:${inst}`)?.emit("formbuilder:import:progress", {
                job_id: jobId, form_id: formId, total_rows: rows.length, processed_rows: processed
              });
            }
          }

          await ExecuteQuery(res, `UPDATE eduall_formbuilder_import_jobs SET ed_form_import_status='done' WHERE ed_form_import_id=? LIMIT 1`,
            [jobId], false, { db: "eduall_formbuilder_import_jobs", type:"update", data: req });

          io?.to(`inst:${inst}`)?.emit("formbuilder:entry:changed", { form_id: formId, action: "import:done" });
        } catch (err) {
          await ExecuteQuery(res, `UPDATE eduall_formbuilder_import_jobs SET ed_form_import_status='failed' WHERE ed_form_import_id=? LIMIT 1`,
            [jobId], false, { db: "eduall_formbuilder_import_jobs", type:"update", data: req });
          io?.to(`inst:${inst}`)?.emit("formbuilder:import:progress", {
            job_id: jobId, form_id: formId, error: err.message
          });
        }
      })();

    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // ====== Sockets ======
  const attachSockets = () => {
    const io = GetSocketIo.get?.();
    if (!io) return;

    io.on?.("connection", (socket) => {
      const inst = socket.handshake.auth?.instituteCode;
      const uid = socket.handshake.auth?.userId;
      if (inst) socket.join(`inst:${inst}`);
      if (uid) socket.join(`user:${uid}`);

      // Poderíamos ter eventos socket específicos (ex.: fetch por cursor)
      socket.on("formbuilder:forms:list", async () => {
        try {
          const rows = await ExecuteQuery(
            { status: () => ({ json: () => {} }) },
            `SELECT * FROM eduall_formbuilder_forms WHERE ed_form_institute_code = ? AND ed_form_deleted = 0 ORDER BY ed_form_created_at DESC`,
            [inst],
            true,
            { db: "eduall_formbuilder_forms", type: "select", data: {} }
          );
          socket.emit("formbuilder:forms", rows.map(toClientForm));
        } catch (e) {
          socket.emit("formbuilder:forms", []);
        }
      });
    });
  };

  return { router, attachSockets };
}

module.exports = buildFormBuilderController;


/*

const buildFormBuilderController = require("./controllers/FormBuilderController");
const { router: formBuilderRouter, attachSockets: formBuilderSockets } = buildFormBuilderController();
app.use("/api", formBuilderRouter);
formBuilderSockets(); // depois de inicializar o socket.io no teu GetSocketIo


*/