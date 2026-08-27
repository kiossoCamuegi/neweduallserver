/**
 * lessonPlanningRouter.js — eduall · Dosificação / Plano Curricular
 *
 * Versão estendida do router original, para servir de backend REAL ao
 * componente de frontend `TeacherClassPlaning` (Dosificacao.jsx).
 *
 * ── O que mudou em relação ao ficheiro original ─────────────────────────
 *  1. BUG CORRIGIDO: `saveFileToDBFromDriveResp` gravava o link do Drive
 *     na coluna `ed_file_name` (devia ser o nome original do ficheiro).
 *     Agora `ed_file_name` = nome original e os links vivem em colunas
 *     próprias (`ed_file_link` / `ed_file_download_link`).
 *  2. BUG CORRIGIDO: `updateLessonTitle` estava declarada DUAS vezes no
 *     ficheiro original (a segunda sobrepunha-se à primeira). Ficou só
 *     uma versão.
 *  3. PERFORMANCE: `createTables`/`ensureSchema` deixaram de correr em
 *     TODOS os pedidos (middleware síncrono a cada request) — agora só
 *     correm uma vez, no arranque do processo (flag `schemaReady`).
 *  4. NOVO ESQUEMA: `eduall_lesson_content` ganhou colunas para suportar
 *     tudo o que o frontend precisa por aula: tipo (Teórica/Prática/
 *     Laboratório/Avaliação), data, realizada, registo (assinado/lida/
 *     nenhum) + metadados reais do registo (hora, método, tipo de
 *     picagem, professor), descrição (HTML) e vídeo (URL embed).
 *     As colunas são adicionadas com `ALTER TABLE` guardado (idempotente),
 *     por isso não parte instalações já existentes.
 *  5. NOVA TABELA: `eduall_lesson_content_files` — associação N:N entre
 *     aulas e ficheiros, para o separador "Ficheiros" do modal de edição.
 *  6. NOVOS ENDPOINTS:
 *      GET    /api/lesson/lesson/:id            → detalhe completo de uma aula
 *                                                  (descrição, vídeo, ficheiros,
 *                                                  timeline real de registo)
 *      PUT    /api/lesson/lesson/:id/full        → grava todos os metadados
 *                                                  editáveis no modal admin
 *      DELETE /api/lesson/lesson/:id             → apaga (soft) uma aula
 *      PUT    /api/lesson/section/:id/move       → reparent de um subcapítulo
 *                                                  (drag & drop entre capítulos)
 *      PUT    /api/lesson/lesson/:id/move        → reparent de uma aula
 *                                                  (drag & drop entre secções);
 *                                                  cria "Aulas Gerais" quando
 *                                                  o destino é um capítulo sem
 *                                                  subcapítulos, tal como o
 *                                                  frontend já fazia em memória
 *      POST   /api/lesson/lesson/:id/files       → upload real de ficheiros
 *                                                  anexados a uma aula
 *      GET    /api/lesson/lesson/:id/files       → lista ficheiros da aula
 *      DELETE /api/lesson/files/:fileId          → remove ficheiro
 *  7. `GET /api/lesson/content/:groupCode` passou a devolver DIRETAMENTE
 *     o formato que o frontend consome (array de capítulos → subcapítulos
 *     → aulas, já com `id` em cada nível e campos completos de cada aula
 *     exceto `descricao`, que é pedida à parte só quando o modal abre —
 *     mantém a listagem leve).
 * ─────────────────────────────────────────────────────────────────────
 */

const express = require("express");
const fs = require("fs");
const fsPromises = require("fs").promises;
const multer = require("multer");
const path = require("path");
const { google } = require("googleapis");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const VerifyToken = require("../middleware/VerifyToken");

// ------------------- Sockets -------------------
let ioRef = null;
const setIO = (io) => { ioRef = io; };
const emit = (event, payload) => { if (ioRef) ioRef.emit(event, payload); };
const institute = (req) => req.session?.user?.eduall_user_session_curentinstitute;
const currentUserName = (req) =>
  req.session?.user?.eduall_user_session_name ||
  req.session?.user?.name ||
  "Administrador";

// ------------------- Google Drive -------------------
const driveAuth = new google.auth.JWT(
  process.env.GOOGLE_SA_CLIENT_EMAIL,
  null,
  (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive']
);
const drive = google.drive({ version: 'v3', auth: driveAuth });

async function uploadToDrive({ filePath, originalname, mimetype, folderId, makePublic = true }) {
  try {
    await fsPromises.stat(filePath);
  } catch {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const parents = [folderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID];
  if (!parents[0]) throw new Error("Nenhuma pasta destino definida para o upload.");

  const metadata = { name: originalname, parents };
  const media = { mimeType: mimetype, body: fs.createReadStream(filePath) };

  const resFile = await drive.files.create({ requestBody: metadata, media, fields: 'id', supportsAllDrives: true });
  const created = resFile.data;

  if (makePublic) {
    await drive.permissions.create({
      fileId: created.id,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true
    });
  }

  const info = await drive.files.get({
    fileId: created.id,
    fields: 'id, name, mimeType, size, webViewLink, webContentLink',
    supportsAllDrives: true
  });

  return {
    id: info.data.id,
    name: info.data.name,
    mimeType: info.data.mimeType,
    size: Number(info.data.size || 0),
    viewLink: info.data.webViewLink,
    downloadLink: info.data.webContentLink
  };
}

// ------------------- Multer -------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'assets'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `eduall_${Date.now()}_${Math.random().toString(36).slice(2)}_${safe}`);
  }
});
const uploadMixed = multer({ storage }).fields([
  { name: 'docs', maxCount: 20 },
  { name: 'video', maxCount: 1 },
  { name: 'thumb', maxCount: 1 }
]);
const uploadDocs = multer({ storage }).fields([{ name: 'docs', maxCount: 20 }]);

// NOTA (correção): `ed_file_name` grava agora o nome ORIGINAL do ficheiro
// (antes gravava, por engano, o link do Drive). Os links vivem em colunas
// próprias `ed_file_link` / `ed_file_download_link`.
async function saveFileToDBFromDriveResp({ file, useType, req, res }) {
  const uploaded = await uploadToDrive({
    filePath: file.path,
    originalname: file.originalname,
    mimetype: file.mimetype,
    folderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
  });

  const q = `INSERT INTO eduall_files
      (ed_file_name, ed_file_code, ed_file_size, ed_file_type, ed_file_extension,
       ed_file_type_of_use, ed_file_institute_code, ed_file_link, ed_file_download_link)
     VALUES(?,?,?,?,?,?,?,?,?)`;
  const params = [
    file.originalname, uploaded.id, uploaded.size, uploaded.mimeType,
    path.extname(file.originalname), useType, institute(req),
    uploaded.viewLink, uploaded.downloadLink
  ];
  const r = await ExecuteQuery(res, q, params, false, { db: "eduall_files", type: "insert", data: req });

  try { await fsPromises.unlink(file.path); } catch (_) { /* noop */ }

  return {
    id: r?.insertId, driveId: uploaded.id, url: uploaded.viewLink,
    downloadUrl: uploaded.downloadLink, size: uploaded.size, type: uploaded.mimeType,
    name: file.originalname,
  };
}

// ------------------- Schema (tabelas + migrações idempotentes) -------------------
async function createTables(res) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS eduall_lesson_sections (
      ed_lesson_section_id INT AUTO_INCREMENT PRIMARY KEY,
      ed_lesson_section_title VARCHAR(255) NOT NULL,
      ed_lesson_section_groupCode VARCHAR(100) NOT NULL,
      ed_lesson_section_parent INT DEFAULT NULL,
      ed_lesson_section_order INT DEFAULT 0,
      ed_lesson_section_deleted TINYINT(1) DEFAULT 0,
      ed_lesson_section_institute_code VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lesson_section_group (ed_lesson_section_groupCode, ed_lesson_section_institute_code),
      INDEX idx_lesson_section_parent (ed_lesson_section_parent)
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_lesson_content (
      ed_lesson_content_id INT AUTO_INCREMENT PRIMARY KEY,
      ed_lesson_content_title VARCHAR(255) NOT NULL,
      ed_lesson_content_section INT NOT NULL,
      ed_lesson_content_order INT DEFAULT 0,
      ed_lesson_content_type VARCHAR(50) DEFAULT 'doc',
      ed_lesson_content_files_code TEXT DEFAULT NULL,
      ed_lesson_content_deleted TINYINT(1) DEFAULT 0,
      ed_lesson_content_institute_code VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lesson_content_section (ed_lesson_content_section)
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_files (
      ed_file_id INT AUTO_INCREMENT PRIMARY KEY,
      ed_file_name VARCHAR(255),
      ed_file_code VARCHAR(255),
      ed_file_size BIGINT,
      ed_file_type VARCHAR(50),
      ed_file_extension VARCHAR(20),
      ed_file_type_of_use VARCHAR(50),
      ed_file_institute_code VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_lesson_content_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content_id INT NOT NULL,
      file_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lcf_content (content_id),
      INDEX idx_lcf_file (file_id)
    )`
  ];
  for (const q of tables) await ExecuteQuery(res, q, [], false, { db: "default", type: "create" });
}

async function ensureColumn(res, table, column, definition) {
  const checkQ = `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`;
  const r = await ExecuteQuery(res, checkQ, [table, column], true);
  if (!r?.[0]?.cnt) {
    await ExecuteQuery(res, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, [], false, { db: table, type: "alter" });
  }
}

async function ensureSchema(res) {
  const alterations = [
    ['eduall_lesson_content', 'ed_lesson_content_aula_tipo', `VARCHAR(30) DEFAULT 'Teórica'`],
    ['eduall_lesson_content', 'ed_lesson_content_data', `DATE NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_realizada', `TINYINT(1) DEFAULT 0`],
    ['eduall_lesson_content', 'ed_lesson_content_registo', `VARCHAR(20) DEFAULT 'nenhum'`],
    ['eduall_lesson_content', 'ed_lesson_content_registo_data', `DATETIME NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_registo_hora', `VARCHAR(5) NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_registo_metodo', `VARCHAR(150) NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_registo_tipo_picagem', `VARCHAR(150) NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_registo_professor', `VARCHAR(150) NULL`],
    ['eduall_lesson_content', 'ed_lesson_content_descricao', `LONGTEXT`],
    ['eduall_lesson_content', 'ed_lesson_content_video', `VARCHAR(500) NULL`],
    ['eduall_files', 'ed_file_link', `VARCHAR(500) NULL`],
    ['eduall_files', 'ed_file_download_link', `VARCHAR(500) NULL`],
  ];
  for (const [table, column, definition] of alterations) {
    await ensureColumn(res, table, column, definition);
  }
}

// ------------------- Sections (Capítulos / Subcapítulos) -------------------
async function createSection(req, res) {
  try {
    const { title, groupCode, parentSectionId = null } = req.body;
    const qOrder = `SELECT COALESCE(MAX(ed_lesson_section_order),0) AS m
                    FROM eduall_lesson_sections
                    WHERE ed_lesson_section_deleted=0 AND ed_lesson_section_groupCode=?
                      AND ed_lesson_section_institute_code=?
                      AND ${parentSectionId ? 'ed_lesson_section_parent=?' : 'ed_lesson_section_parent IS NULL'}`;
    const max = await ExecuteQuery(res, qOrder, parentSectionId ? [groupCode, parentSectionId, institute(req)] : [groupCode, institute(req)], true);
    const nextOrder = (max?.[0]?.m || 0) + 1;

    const q = `INSERT INTO eduall_lesson_sections(ed_lesson_section_title, ed_lesson_section_groupCode, ed_lesson_section_parent, ed_lesson_section_order, ed_lesson_section_institute_code)
               VALUES(?,?,?,?,?)`;
    const params = [title, groupCode, parentSectionId, nextOrder, institute(req)];
    const r = await ExecuteQuery(res, q, params, false, { db: 'eduall_lesson_sections', type: 'insert', data: req });

    await RegisterAuditAction({ session: req.session, res, req, action: 1, form: parentSectionId ? "Subcapítulo" : "Capítulo", description: `Criou ${parentSectionId ? "subcapítulo" : "capítulo"} (${title})` });
    emit('section:created', { groupCode });
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao criar seção' }); }
}

async function updateSectionTitle(req, res) {
  try {
    const { title, groupCode } = req.body;
    const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_title=? WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`;
    await ExecuteQuery(res, q, [title, req.params.id, institute(req)], false, { db: 'eduall_lesson_sections', type: 'update', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Seção", description: `Atualizou título da seção ID ${req.params.id} (${title})` });
    emit('section:updated', { groupCode });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao atualizar título' }); }
}

async function deleteSection(req, res) {
  try {
    const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_deleted=1 WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`;
    await ExecuteQuery(res, q, [req.params.id, institute(req)], false, { db: 'eduall_lesson_sections', type: 'update', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 3, form: "Seção", description: `Eliminou seção ID ${req.params.id}` });
    emit('section:deleted', { groupCode: req.query.groupCode });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao apagar seção' }); }
}

async function updateSectionOrder(req, res) {
  try {
    const { groupCode, parentSectionId = null, newOrder } = req.body;
    if (!Array.isArray(newOrder)) return res.status(400).json({ success: false, message: 'newOrder deve ser um array' });

    for (let i = 0; i < newOrder.length; i++) {
      const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_order = ?
                 WHERE ed_lesson_section_id = ? AND ed_lesson_section_institute_code = ?`;
      await ExecuteQuery(res, q, [i + 1, newOrder[i], institute(req)], false, { db: 'eduall_lesson_sections', type: 'update', data: req });
    }

    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: parentSectionId ? "Subcapítulo" : "Capítulo", description: `Reordenou ${parentSectionId ? 'subcapítulos' : 'capítulos'}` });
    emit('section:reordered', { groupCode });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao atualizar ordem' }); }
}

/**
 * PUT /api/lesson/section/:id/move
 * Reparent de um subcapítulo (drag & drop para outro capítulo, ou para
 * antes de outro subcapítulo dentro do mesmo/outro capítulo).
 * body: { groupCode, newParentId, beforeSectionId? }
 */
async function moveSection(req, res) {
  try {
    const { groupCode, newParentId = null, beforeSectionId = null } = req.body;
    const sectionId = Number(req.params.id);
    const inst = institute(req);

    const siblingsQ = `SELECT ed_lesson_section_id AS id FROM eduall_lesson_sections
                        WHERE ed_lesson_section_groupCode=? AND ed_lesson_section_institute_code=?
                          AND ed_lesson_section_deleted=0 AND ed_lesson_section_id<>?
                          AND ${newParentId ? 'ed_lesson_section_parent=?' : 'ed_lesson_section_parent IS NULL'}
                        ORDER BY ed_lesson_section_order`;
    const params = newParentId ? [groupCode, inst, sectionId, newParentId] : [groupCode, inst, sectionId];
    const siblings = (await ExecuteQuery(res, siblingsQ, params, true)) || [];

    const ids = siblings.map((s) => s.id);
    let insertAt = ids.length;
    if (beforeSectionId != null) {
      const idx = ids.indexOf(Number(beforeSectionId));
      if (idx >= 0) insertAt = idx;
    }
    ids.splice(insertAt, 0, sectionId);

    await ExecuteQuery(res,
      `UPDATE eduall_lesson_sections SET ed_lesson_section_parent=? WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`,
      [newParentId, sectionId, inst], false, { db: 'eduall_lesson_sections', type: 'update', data: req });

    for (let i = 0; i < ids.length; i++) {
      await ExecuteQuery(res,
        `UPDATE eduall_lesson_sections SET ed_lesson_section_order=? WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`,
        [i + 1, ids[i], inst], false, { db: 'eduall_lesson_sections', type: 'update', data: req });
    }

    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Subcapítulo", description: `Moveu subcapítulo ID ${sectionId}` });
    emit('section:reordered', { groupCode });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao mover subcapítulo' }); }
}

// ------------------- Lessons (Aulas) -------------------
async function createLesson(req, res) {
  try {
    const { title, tipo, data, sectionId, groupCode, descricao, video } = req.body;
    const qMax = `SELECT COALESCE(MAX(ed_lesson_content_order),0) AS m
                  FROM eduall_lesson_content
                  WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=?`;
    const max = await ExecuteQuery(res, qMax, [sectionId, institute(req)], true);
    const nextOrder = (max?.[0]?.m || 0) + 1;

    const q = `INSERT INTO eduall_lesson_content
        (ed_lesson_content_title, ed_lesson_content_section, ed_lesson_content_order,
         ed_lesson_content_aula_tipo, ed_lesson_content_data, ed_lesson_content_realizada,
         ed_lesson_content_registo, ed_lesson_content_descricao, ed_lesson_content_video,
         ed_lesson_content_institute_code)
       VALUES(?,?,?,?,?,0,'nenhum',?,?,?)`;
    const params = [title, sectionId, nextOrder, tipo || 'Teórica', data || null, descricao || '', video || null, institute(req)];
    const r = await ExecuteQuery(res, q, params, false, { db: 'eduall_lesson_content', type: 'insert', data: req });

    await RegisterAuditAction({ session: req.session, res, req, action: 1, form: "Aulas", description: `Criou aula (${title})` });
    emit('content:created', { groupCode, sectionId });
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao criar aula' }); }
}

async function updateLessonTitle(req, res) {
  try {
    const { title, sectionId } = req.body;
    const q = `UPDATE eduall_lesson_content SET ed_lesson_content_title=? WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`;
    await ExecuteQuery(res, q, [title, req.params.id, institute(req)], false, { db: 'eduall_lesson_content', type: 'update', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Aulas", description: `Atualizou título da aula ID ${req.params.id} (${title})` });
    emit('content:updated', { sectionId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao atualizar título da aula' }); }
}

/**
 * PUT /api/lesson/lesson/:id/full — grava todos os campos editáveis no
 * modal admin. Quando `registo` muda para 'assinado'/'lida', a data/hora/
 * método/professor do registo são gravados no servidor (dados reais, não
 * gerados no frontend).
 */
async function updateLessonFull(req, res) {
  try {
    const id = req.params.id;
    const inst = institute(req);
    const { titulo, tipo, data, realizada, registo, descricao, video, sectionId } = req.body;

    const prevRows = await ExecuteQuery(res,
      `SELECT ed_lesson_content_registo AS registo FROM eduall_lesson_content WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`,
      [id, inst], true);
    const prevRegisto = prevRows?.[0]?.registo;
    const registoChanged = !!registo && registo !== prevRegisto && registo !== 'nenhum';

    let q = `UPDATE eduall_lesson_content SET
        ed_lesson_content_title=?, ed_lesson_content_aula_tipo=?, ed_lesson_content_data=?,
        ed_lesson_content_realizada=?, ed_lesson_content_registo=?, ed_lesson_content_descricao=?,
        ed_lesson_content_video=?`;
    const params = [titulo, tipo || 'Teórica', data || null, realizada ? 1 : 0, registo || 'nenhum', descricao || '', video || null];

    if (registoChanged) {
      q += `, ed_lesson_content_registo_data=NOW(), ed_lesson_content_registo_hora=TIME_FORMAT(NOW(),'%H:%i'),
             ed_lesson_content_registo_metodo=?, ed_lesson_content_registo_tipo_picagem=?, ed_lesson_content_registo_professor=?`;
      params.push(
        registo === 'assinado' ? 'Registo Manual (Painel Administrativo)' : 'Marcação Manual (Painel Administrativo)',
        registo === 'assinado' ? 'Confirmação Manual' : null,
        currentUserName(req)
      );
    }
    q += ` WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`;
    params.push(id, inst);

    await ExecuteQuery(res, q, params, false, { db: 'eduall_lesson_content', type: 'update', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Aulas", description: `Atualizou dados da aula ID ${id} (${titulo})` });
    emit('content:updated', { sectionId });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao guardar aula' }); }
}

async function deleteLesson(req, res) {
  try {
    const q = `UPDATE eduall_lesson_content SET ed_lesson_content_deleted=1 WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`;
    await ExecuteQuery(res, q, [req.params.id, institute(req)], false, { db: 'eduall_lesson_content', type: 'update', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 3, form: "Aulas", description: `Eliminou aula ID ${req.params.id}` });
    emit('content:deleted', { sectionId: req.query.sectionId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao apagar aula' }); }
}

async function updateLessonOrder(req, res) {
  try {
    const { sectionId, newOrder } = req.body;
    if (!Array.isArray(newOrder)) return res.status(400).json({ success: false, message: 'newOrder deve ser um array' });

    for (let i = 0; i < newOrder.length; i++) {
      const q = `UPDATE eduall_lesson_content SET ed_lesson_content_order = ?
                 WHERE ed_lesson_content_id = ? AND ed_lesson_content_institute_code = ?`;
      await ExecuteQuery(res, q, [i + 1, newOrder[i], institute(req)], false, { db: 'eduall_lesson_content', type: 'update', data: req });
    }

    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Aulas", description: `Reordenou aulas da seção ID ${sectionId}` });
    emit('content:reordered', { sectionId });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao atualizar ordem das aulas' }); }
}

/**
 * PUT /api/lesson/lesson/:id/move — reparent de uma aula (drag & drop).
 * body: { groupCode, newSectionId, beforeLessonId? }
 * Se `newSectionId` for um CAPÍTULO (sem subcapítulo pai) sem subcapítulos,
 * cria automaticamente "Aulas Gerais" — tal como o frontend já fazia em
 * memória — e devolve `destSectionId` para o cliente saber onde ficou.
 */
async function moveLesson(req, res) {
  try {
    const { groupCode, newSectionId, beforeLessonId = null } = req.body;
    const lessonId = Number(req.params.id);
    const inst = institute(req);
    let destSectionId = Number(newSectionId);

    const destRows = await ExecuteQuery(res,
      `SELECT ed_lesson_section_id, ed_lesson_section_parent FROM eduall_lesson_sections WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`,
      [destSectionId, inst], true);
    const dest = destRows?.[0];

    if (dest && dest.ed_lesson_section_parent === null) {
      const subRows = await ExecuteQuery(res,
        `SELECT ed_lesson_section_id AS id FROM eduall_lesson_sections
         WHERE ed_lesson_section_parent=? AND ed_lesson_section_deleted=0 AND ed_lesson_section_institute_code=?
         ORDER BY ed_lesson_section_order LIMIT 1`,
        [destSectionId, inst], true);
      if (subRows?.length) {
        destSectionId = subRows[0].id;
      } else {
        const insRes = await ExecuteQuery(res,
          `INSERT INTO eduall_lesson_sections(ed_lesson_section_title, ed_lesson_section_groupCode, ed_lesson_section_parent, ed_lesson_section_order, ed_lesson_section_institute_code)
           VALUES(?,?,?,?,?)`,
          ['Aulas Gerais', groupCode, destSectionId, 1, inst], false, { db: 'eduall_lesson_sections', type: 'insert', data: req });
        destSectionId = insRes.insertId;
      }
    }

    const siblings = (await ExecuteQuery(res,
      `SELECT ed_lesson_content_id AS id FROM eduall_lesson_content
       WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=? AND ed_lesson_content_id<>?
       ORDER BY ed_lesson_content_order`,
      [destSectionId, inst, lessonId], true)) || [];

    const ids = siblings.map((s) => s.id);
    let insertAt = ids.length;
    if (beforeLessonId != null) {
      const idx = ids.indexOf(Number(beforeLessonId));
      if (idx >= 0) insertAt = idx;
    }
    ids.splice(insertAt, 0, lessonId);

    await ExecuteQuery(res,
      `UPDATE eduall_lesson_content SET ed_lesson_content_section=? WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`,
      [destSectionId, lessonId, inst], false, { db: 'eduall_lesson_content', type: 'update', data: req });

    for (let i = 0; i < ids.length; i++) {
      await ExecuteQuery(res,
        `UPDATE eduall_lesson_content SET ed_lesson_content_order=? WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`,
        [i + 1, ids[i], inst], false, { db: 'eduall_lesson_content', type: 'update', data: req });
    }

    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: "Aulas", description: `Moveu aula ID ${lessonId}` });
    emit('content:reordered', { sectionId: destSectionId });
    res.json({ success: true, destSectionId });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao mover aula' }); }
}

/**
 * GET /api/lesson/lesson/:id — detalhe completo de uma aula: descrição,
 * vídeo, ficheiros anexados e a timeline REAL de registo/picagem (nada
 * de dados gerados/fake no frontend).
 */
async function getLessonDetails(req, res) {
  try {
    const id = req.params.id;
    const inst = institute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_lesson_content_id AS id, ed_lesson_content_title AS titulo, ed_lesson_content_section AS sectionId,
              ed_lesson_content_aula_tipo AS tipo, DATE_FORMAT(ed_lesson_content_data,'%Y-%m-%d') AS data,
              ed_lesson_content_realizada AS realizada, ed_lesson_content_registo AS registo,
              ed_lesson_content_descricao AS descricao, ed_lesson_content_video AS video,
              DATE_FORMAT(ed_lesson_content_registo_data,'%Y-%m-%d') AS registoData,
              ed_lesson_content_registo_hora AS registoHora,
              ed_lesson_content_registo_metodo AS registoMetodo,
              ed_lesson_content_registo_tipo_picagem AS registoTipoPicagem,
              ed_lesson_content_registo_professor AS registoProfessor
       FROM eduall_lesson_content
       WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=? AND ed_lesson_content_deleted=0`,
      [id, inst], true);
    const row = rows?.[0];
    if (!row) return res.status(404).json({ success: false, message: 'Aula não encontrada' });

    const filesRows = (await ExecuteQuery(res,
      `SELECT f.ed_file_id AS id, f.ed_file_name AS name, f.ed_file_size AS size,
              f.ed_file_type AS mimeType, f.ed_file_link AS viewLink, f.ed_file_download_link AS downloadLink
       FROM eduall_lesson_content_files lcf
       JOIN eduall_files f ON f.ed_file_id = lcf.file_id
       WHERE lcf.content_id=?`, [id], true)) || [];

    let registoTimeline = null;
    if (row.registo === 'assinado' || row.registo === 'lida') {
      registoTimeline = {
        assinado: row.registo === 'assinado',
        metodo: row.registoMetodo,
        tipoPicagem: row.registoTipoPicagem,
        hora: row.registoHora,
        professor: row.registoProfessor,
        data: row.registoData,
      };
    }

    res.json({
      id: row.id,
      titulo: row.titulo,
      sectionId: row.sectionId,
      tipo: row.tipo,
      data: row.data,
      realizada: !!row.realizada,
      registo: row.registo,
      descricao: row.descricao || '',
      video: row.video || null,
      files: filesRows,
      registoTimeline,
    });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao obter detalhes da aula' }); }
}

// ------------------- Ficheiros por aula -------------------
async function uploadLessonFiles(req, res) {
  try {
    const lessonId = req.params.id;
    const results = [];
    for (const f of (req.files?.docs || [])) {
      const saved = await saveFileToDBFromDriveResp({ file: f, useType: 'lesson-doc', req, res });
      await ExecuteQuery(res,
        `INSERT INTO eduall_lesson_content_files(content_id, file_id) VALUES(?,?)`,
        [lessonId, saved.id], false, { db: 'eduall_lesson_content_files', type: 'insert', data: req });
      results.push({ id: saved.id, name: saved.name, size: saved.size, viewLink: saved.url, downloadLink: saved.downloadUrl });
    }
    await RegisterAuditAction({ session: req.session, res, req, action: 1, form: "Ficheiros", description: `Anexou ${results.length} ficheiro(s) à aula ID ${lessonId}` });
    res.json({ success: true, files: results });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Falha ao enviar ficheiros' }); }
}

async function getLessonFiles(req, res) {
  try {
    const rows = (await ExecuteQuery(res,
      `SELECT f.ed_file_id AS id, f.ed_file_name AS name, f.ed_file_size AS size,
              f.ed_file_link AS viewLink, f.ed_file_download_link AS downloadLink
       FROM eduall_lesson_content_files lcf
       JOIN eduall_files f ON f.ed_file_id = lcf.file_id
       WHERE lcf.content_id=?`, [req.params.id], true)) || [];
    res.json({ success: true, files: rows });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao obter ficheiros' }); }
}

async function deleteLessonFile(req, res) {
  try {
    const fileId = req.params.fileId;
    await ExecuteQuery(res, `DELETE FROM eduall_lesson_content_files WHERE file_id=?`, [fileId], false, { db: 'eduall_lesson_content_files', type: 'delete', data: req });
    await ExecuteQuery(res, `DELETE FROM eduall_files WHERE ed_file_id=?`, [fileId], false, { db: 'eduall_files', type: 'delete', data: req });
    await RegisterAuditAction({ session: req.session, res, req, action: 3, form: "Ficheiros", description: `Removeu ficheiro ID ${fileId}` });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Falha ao remover ficheiro' }); }
}

// ------------------- Get Content (formato pronto a consumir pelo frontend) -------------------
async function GetContent(req, res) {
  try {
    const groupCode = req.params.groupCode;
    const inst = institute(req);

    const chapters = (await ExecuteQuery(res,
      `SELECT ed_lesson_section_id AS id, ed_lesson_section_title AS titulo, ed_lesson_section_order AS ordem
       FROM eduall_lesson_sections
       WHERE ed_lesson_section_groupCode=? AND ed_lesson_section_deleted=0 AND ed_lesson_section_institute_code=? AND ed_lesson_section_parent IS NULL
       ORDER BY ed_lesson_section_order`, [groupCode, inst], true)) || [];

    const lessonFields = `ed_lesson_content_id AS id, ed_lesson_content_title AS titulo,
      ed_lesson_content_aula_tipo AS tipo, DATE_FORMAT(ed_lesson_content_data,'%Y-%m-%d') AS data,
      ed_lesson_content_realizada AS realizada, ed_lesson_content_registo AS registo,
      ed_lesson_content_video AS video, ed_lesson_content_order AS ordem`;

    const out = [];
    for (const chap of chapters) {
      const subRows = (await ExecuteQuery(res,
        `SELECT ed_lesson_section_id AS id, ed_lesson_section_title AS nome, ed_lesson_section_order AS ordem
         FROM eduall_lesson_sections
         WHERE ed_lesson_section_parent=? AND ed_lesson_section_deleted=0 AND ed_lesson_section_institute_code=?
         ORDER BY ed_lesson_section_order`, [chap.id, inst], true)) || [];

      const directLessonsRows = (await ExecuteQuery(res,
        `SELECT ${lessonFields} FROM eduall_lesson_content
         WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=?
         ORDER BY ed_lesson_content_order`, [chap.id, inst], true)) || [];

      const subcapitulos = [];
      for (const sub of subRows) {
        const lessonsRows = (await ExecuteQuery(res,
          `SELECT ${lessonFields} FROM eduall_lesson_content
           WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=?
           ORDER BY ed_lesson_content_order`, [sub.id, inst], true)) || [];
        subcapitulos.push({
          id: sub.id,
          nome: sub.nome,
          aulas: lessonsRows.map((l) => ({ ...l, realizada: !!l.realizada, video: l.video || null })),
        });
      }

      // Aulas presas diretamente ao capítulo (sem subcapítulo) aparecem
      // como um subcapítulo virtual "Aulas Gerais" — o seu `id` é o
      // próprio id do capítulo, para que criar/mover aulas continue a
      // funcionar sem casos especiais no frontend.
      if (directLessonsRows.length) {
        subcapitulos.push({
          id: chap.id,
          nome: 'Aulas Gerais',
          isDirect: true,
          aulas: directLessonsRows.map((l) => ({ ...l, realizada: !!l.realizada, video: l.video || null })),
        });
      }

      out.push({ id: chap.id, capitulo: chap.titulo, subcapitulos });
    }

    res.json(out);
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Falha ao listar conteúdo" }); }
}

// ------------------- Build Router -------------------
function buildLessonRouter(io) {
  setIO(io);
  const router = express.Router();

  // Inicializar/migrar tabelas — só uma vez por processo, não em cada pedido.
  let schemaReady = false;
  router.use(async (req, res, next) => {
    if (!schemaReady) {
      try {
        await createTables(res);
        await ensureSchema(res);
        schemaReady = true;
      } catch (e) {
        console.error('Falha ao preparar esquema do plano curricular', e);
      }
    }
    next();
  });

  // Sections
  router.post('/api/lesson/section', VerifyToken, createSection);
  router.put('/api/lesson/section/:id', VerifyToken, updateSectionTitle);
  router.delete('/api/lesson/section/:id', VerifyToken, deleteSection);
  router.put('/api/lesson/section/:id/move', VerifyToken, moveSection);
  router.put('/api/lesson/section-order', VerifyToken, updateSectionOrder);

  // Lessons
  router.post('/api/lesson/lesson', VerifyToken, createLesson);
  router.get('/api/lesson/lesson/:id', VerifyToken, getLessonDetails);
  router.put('/api/lesson/lesson/:id', VerifyToken, updateLessonTitle);
  router.put('/api/lesson/lesson/:id/full', VerifyToken, updateLessonFull);
  router.put('/api/lesson/lesson/:id/move', VerifyToken, moveLesson);
  router.delete('/api/lesson/lesson/:id', VerifyToken, deleteLesson);
  router.put('/api/lesson/lesson-order', VerifyToken, updateLessonOrder);

  // Ficheiros por aula
  router.post('/api/lesson/lesson/:id/files', VerifyToken, uploadDocs, uploadLessonFiles);
  router.get('/api/lesson/lesson/:id/files', VerifyToken, getLessonFiles);
  router.delete('/api/lesson/files/:fileId', VerifyToken, deleteLessonFile);

  // Get Content (árvore completa por cadeira/turma)
  router.get('/api/lesson/content/:groupCode', VerifyToken, GetContent);

  // Upload genérico (mantido do ficheiro original — docs/video/thumb soltos)
  router.post('/api/files/upload-mixed', VerifyToken, uploadMixed, async (req, res) => {
    const results = { docs: [], video: null, thumb: null };
    for (const f of (req.files?.docs || [])) results.docs.push(await saveFileToDBFromDriveResp({ file: f, useType: 'doc', req, res }));
    if (req.files?.video?.[0]) results.video = await saveFileToDBFromDriveResp({ file: req.files.video[0], useType: 'video', req, res });
    if (req.files?.thumb?.[0]) results.thumb = await saveFileToDBFromDriveResp({ file: req.files.thumb[0], useType: 'thumb', req, res });
    res.json(results);
  });

  return router;
}

module.exports = buildLessonRouter;