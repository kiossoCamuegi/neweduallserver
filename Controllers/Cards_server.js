// cardDesigner.routes.js
// Requisitos no projeto servidor: express, multer, path
// Este ficheiro exporta um Router para ser montado com app.use(require('./cardDesigner.routes')).
// Usa o teu ExecuteQuery e sessão já existentes.

const express = require("express");
const path = require("path");
const multer = require("multer");

const ExecuteQuery = require("../Functions/ExecuteQuery"); // já tens no teu projeto
const router = express.Router();

// ====== Uploads (assets para cartões) ======
const storage = multer.diskStorage({
  destination: path.join(__dirname, "../images/card-assets"),
  filename: (req, file, cb) => cb(null, `card_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// ====== Helpers ======
const nowIso = () => new Date().toISOString().slice(0,19).replace("T"," ");
const ok = (res, data) => res.status(200).json({ success: true, data });
const fail = (res, msg, code=500) => res.status(code).json({ success:false, message: msg });

// ====== Ensure tables (idempotente) ======
async function ensureTables(req, res) {
  // Tabela de templates de cartões
  await ExecuteQuery(res, `
    CREATE TABLE IF NOT EXISTS eduall_card_templates (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      institute_code VARCHAR(64) NOT NULL,
      title VARCHAR(160) NOT NULL,
      front_json LONGTEXT NOT NULL,
      back_json LONGTEXT NOT NULL,
      preview_png LONGTEXT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted TINYINT DEFAULT 0
    )
  `, [], false, { db: "eduall_card_templates", type: "schema", data: req });

  await ExecuteQuery(res, `
    CREATE INDEX IF NOT EXISTS idx_cardtpl_inst ON eduall_card_templates(institute_code, deleted)
  `, [], false, { db: "eduall_card_templates", type: "index", data: req });
}

// ====== Middleware de instituto ======
function getInstitute(req) {
  const inst = req?.session?.user?.eduall_user_session_curentinstitute;
  if (!inst) throw new Error("Instituto não identificado.");
  return String(inst);
}

// ====== ROTAS ======

// Listar alunos (campos mínimos para o designer).
router.get("/api/students-for-cards", async (req, res) => {
  try {
    const inst = getInstitute(req);
    // Podes substituir por um dos teus métodos GetStudents do próprio projeto
    const rows = await ExecuteQuery(
      res,
      `SELECT s.*, c.ed_class_title, cr.ed_course_title
       FROM eduall_students s
       LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
       LEFT JOIN eduall_courses cr ON cr.ed_course_id = c.ed_class_course
       WHERE s.ed_student_deleted = 0 AND s.ed_student_institute_code = ?
       ORDER BY s.ed_student_name ASC`,
      [inst],
      true,
      { db: "eduall_students", type: "select", data: req }
    );
    return res.status(200).json(rows);
  } catch (e) { return fail(res, e.message); }
});

// ====== CRUD Templates ======
router.get("/api/card-templates", async (req, res) => {
  try {
    await ensureTables(req, res);
    const inst = getInstitute(req);
    const rows = await ExecuteQuery(
      res,
      `SELECT id, title, preview_png, created_at, updated_at
       FROM eduall_card_templates
       WHERE deleted = 0 AND institute_code = ?
       ORDER BY updated_at DESC`,
      [inst],
      true,
      { db: "eduall_card_templates", type: "select", data: req }
    );
    ok(res, rows);
  } catch (e) { fail(res, e.message); }
});

router.post("/api/card-templates", async (req, res) => {
  try {
    await ensureTables(req, res);
    const inst = getInstitute(req);
    const { title, front_json, back_json, preview_png } = req.body;
    if (!title || !front_json || !back_json) return fail(res, "Dados incompletos.", 400);

    const q = `
      INSERT INTO eduall_card_templates (institute_code, title, front_json, back_json, preview_png, created_at, updated_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `;
    const params = [inst, String(title).trim(), String(front_json), String(back_json), preview_png || null, nowIso(), nowIso()];
    const resp = await ExecuteQuery(res, q, params, false, { db: "eduall_card_templates", type: "insert", data: req });
    return res.status(201).json({ success: true, id: resp.insertId });
  } catch (e) { return fail(res, e.message); }
});

router.get("/api/card-templates/:id", async (req, res) => {
  try {
    await ensureTables(req, res);
    const inst = getInstitute(req);
    const id = Number(req.params.id);
    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_card_templates WHERE id = ? AND institute_code = ? AND deleted = 0 LIMIT 1`,
      [id, inst],
      true,
      { db: "eduall_card_templates", type: "select", data: req }
    );
    if (!rows || rows.length === 0) return fail(res, "Template não encontrado.", 404);
    ok(res, rows[0]);
  } catch (e) { fail(res, e.message); }
});

router.put("/api/card-templates/:id", async (req, res) => {
  try {
    await ensureTables(req, res);
    const inst = getInstitute(req);
    const id = Number(req.params.id);
    const { title, front_json, back_json, preview_png } = req.body;
    const q = `
      UPDATE eduall_card_templates
      SET title = COALESCE(?, title),
          front_json = COALESCE(?, front_json),
          back_json = COALESCE(?, back_json),
          preview_png = COALESCE(?, preview_png),
          updated_at = ?
      WHERE id = ? AND institute_code = ? AND deleted = 0
    `;
    await ExecuteQuery(res, q, [title || null, front_json || null, back_json || null, preview_png || null, nowIso(), id, inst], false, { db: "eduall_card_templates", type: "update", data: req });
    ok(res, { id });
  } catch (e) { fail(res, e.message); }
});

router.delete("/api/card-templates/:id", async (req, res) => {
  try {
    await ensureTables(req, res);
    const inst = getInstitute(req);
    const id = Number(req.params.id);
    await ExecuteQuery(
      res,
      `UPDATE eduall_card_templates SET deleted = 1, updated_at = ? WHERE id = ? AND institute_code = ?`,
      [nowIso(), id, inst],
      false,
      { db: "eduall_card_templates", type: "update", data: req }
    );
    ok(res, { id, deleted: true });
  } catch (e) { fail(res, e.message); }
});

// Upload de imagens para usar no designer (logos, fundos, etc.)
router.post("/api/card-assets/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = `images/card-assets/${req.file.filename}`;
    // opcional: podes gravar em DB se quiseres auditar
    res.status(201).json({ success: true, path: filePath, url: `/${filePath}` });
  } catch (e) { fail(res, e.message); }
});

module.exports = router;



/*
usage :

// index.js (exemplo de montagem)
const express = require("express");
const session = require("express-session");
const cardRoutes = require("./routes/cardDesigner.routes");

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/images", express.static(require("path").join(__dirname, "images"))); // servir assets
app.use(session({ secret: "x", resave: false, saveUninitialized: true }));

app.use(cardRoutes);

app.listen(4000, () => console.log("API up 4000"));



*/