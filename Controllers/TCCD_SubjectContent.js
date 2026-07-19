const express = require("express");
const fs = require("fs");
const fsPromises = require("fs").promises;  // ← NOVO: fs.promises para async
const multer = require("multer");
const path = require("path");
const { google } = require("googleapis");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const VerifyToken = require("../middleware/VerifyToken");

// ------------------- Sockets -------------------
let ioRef = null;
const setIO = (io) => { ioRef = io; };
const emit = (event, payload) => { if(ioRef) ioRef.emit(event, payload); };
const institute = (req) => req.session?.user?.eduall_user_session_curentinstitute;

// ------------------- Google Drive -------------------
const driveAuth = new google.auth.JWT(
  process.env.GOOGLE_SA_CLIENT_EMAIL,
  null,
  (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive']
);
const drive = google.drive({ version: 'v3', auth: driveAuth });

async function uploadToDrive({ filePath, originalname, mimetype, folderId, makePublic = true }) {
  // Verificar se ficheiro existe (async, não bloqueia)
  try {
    await fsPromises.stat(filePath);
  } catch {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const parents = [folderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID];
  if(!parents[0]) throw new Error("Nenhuma pasta destino definida para o upload.");

  const metadata = { name: originalname, parents };
  const media = { mimeType: mimetype, body: fs.createReadStream(filePath) };

  const resFile = await drive.files.create({ requestBody: metadata, media, fields:'id', supportsAllDrives:true });
  const created = resFile.data;

  if(makePublic) {
    await drive.permissions.create({
      fileId: created.id,
      requestBody: { role:'reader', type:'anyone' },
      supportsAllDrives:true
    });
  }

  const info = await drive.files.get({
    fileId: created.id,
    fields:'id, name, mimeType, size, webViewLink, webContentLink',
    supportsAllDrives:true
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
  { name:'docs', maxCount:20 },
  { name:'video', maxCount:1 },
  { name:'thumb', maxCount:1 }
]);

async function saveFileToDBFromDriveResp({ file, useType, req, res }) {
  const uploaded = await uploadToDrive({ filePath:file.path, originalname:file.originalname, mimetype:file.mimetype, folderId:process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID });
  const q = `INSERT INTO eduall_files(ed_file_name, ed_file_code, ed_file_size, ed_file_type, ed_file_extension, ed_file_type_of_use, ed_file_institute_code)
             VALUES(?,?,?,?,?,?,?)`;
  const params = [uploaded.viewLink, uploaded.id, uploaded.size, uploaded.mimeType, path.extname(file.originalname), useType, institute(req)];
  const r = await ExecuteQuery(res, q, params, false, { db:"eduall_files", type:"insert", data:req });
  
  // Apagar ficheiro local (async, não bloqueia)
  try { 
    await fsPromises.unlink(file.path);
  } catch(_) {}
  
  return { id:r?.insertId, driveId:uploaded.id, url:uploaded.viewLink, downloadUrl:uploaded.downloadLink, size:uploaded.size, type:uploaded.mimeType };
}

// ------------------- Create Tables -------------------
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    )`
  ];

  for(const q of tables) await ExecuteQuery(res, q, [], false, { db:"default", type:"create" });
}

// ------------------- Sections -------------------
async function createSection(req, res) {
  try {
    const { title, groupCode, parentSectionId = null } = req.body;
    const qOrder = `SELECT COALESCE(MAX(ed_lesson_section_order),0) AS m
                    FROM eduall_lesson_sections
                    WHERE ed_lesson_section_deleted=0 AND ed_lesson_section_groupCode=? 
                      AND ed_lesson_section_institute_code=? 
                      AND ${parentSectionId?'ed_lesson_section_parent=?':'ed_lesson_section_parent IS NULL'}`;
    const max = await ExecuteQuery(res, qOrder, parentSectionId?[groupCode,parentSectionId,institute(req)]:[groupCode,institute(req)], true);
    const nextOrder = (max?.[0]?.m||0)+1;

    const q = `INSERT INTO eduall_lesson_sections(ed_lesson_section_title, ed_lesson_section_groupCode, ed_lesson_section_parent, ed_lesson_section_order, ed_lesson_section_institute_code)
               VALUES(?,?,?,?,?)`;
    const params = [title, groupCode, parentSectionId, nextOrder, institute(req)];
    const r = await ExecuteQuery(res, q, params, false, { db:'eduall_lesson_sections', type:'insert', data:req });

    await RegisterAuditAction({ session:req.session, res, req, action:1, form: parentSectionId?"Subcapítulo":"Capítulo", description:`Criou ${parentSectionId?"subcapítulo":"capítulo"} (${title})` });
    emit('section:created', { groupCode });
    res.json({ success:true, id:r.insertId });
  } catch(e){ console.error(e); res.status(500).json({ success:false, message:'Falha ao criar seção' }); }
}

async function updateSectionTitle(req, res) {
  try {
    const { title, groupCode } = req.body;
    const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_title=? WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`;
    await ExecuteQuery(res, q, [title, req.params.id, institute(req)], false, { db:'eduall_lesson_sections', type:'update', data:req });
    await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Seção", description:`Atualizou título da seção ID ${req.params.id} (${title})` });
    emit('section:updated', { groupCode });
    res.json({ success:true });
  } catch(e){ res.status(500).json({ success:false, message:'Falha ao atualizar título' }); }
}

async function deleteSection(req, res) {
  try {
    const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_deleted=1 WHERE ed_lesson_section_id=? AND ed_lesson_section_institute_code=?`;
    await ExecuteQuery(res, q, [req.params.id, institute(req)], false, { db:'eduall_lesson_sections', type:'update', data:req });
    await RegisterAuditAction({ session:req.session, res, req, action:3, form:"Seção", description:`Eliminou seção ID ${req.params.id}` });
    emit('section:deleted', { groupCode:req.query.groupCode });
    res.json({ success:true });
  } catch(e){ res.status(500).json({ success:false, message:'Falha ao apagar seção' }); }
}

// ------------------- Lessons -------------------
async function createLesson(req, res) {
  try {
    const { title, type, sectionId, groupCode, files } = req.body;
    const qMax = `SELECT COALESCE(MAX(ed_lesson_content_order),0) AS m 
                  FROM eduall_lesson_content 
                  WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=?`;
    const max = await ExecuteQuery(res, qMax, [sectionId, institute(req)], true);
    const nextOrder = (max?.[0]?.m||0)+1;

    const q = `INSERT INTO eduall_lesson_content(ed_lesson_content_title, ed_lesson_content_section, ed_lesson_content_order, ed_lesson_content_type, ed_lesson_content_files_code, ed_lesson_content_institute_code)
               VALUES(?,?,?,?,?,?)`;
    const r = await ExecuteQuery(res, q, [title, sectionId, nextOrder, type||'doc', files?JSON.stringify(files):null, institute(req)], false, { db:'eduall_lesson_content', type:'insert', data:req });

    await RegisterAuditAction({ session:req.session, res, req, action:1, form:"Aulas", description:`Criou aula (${title})` });
    emit('content:created', { groupCode });
    res.json({ success:true, id:r.insertId });
  } catch(e){ console.error(e); res.status(500).json({ success:false, message:'Falha ao criar aula' }); }
}

async function updateLessonTitle(req, res) {
  try {
    const { title, sectionId } = req.body;
    const q = `UPDATE eduall_lesson_content SET ed_lesson_content_title=? WHERE ed_lesson_content_id=? AND ed_lesson_content_institute_code=?`;
    await ExecuteQuery(res, q, [title, req.params.id, institute(req)], false, { db:'eduall_lesson_content', type:'update', data:req });
    await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Aulas", description:`Atualizou título da aula ID ${req.params.id} (${title})` });
    emit('content:updated', { sectionId });
    res.json({ success:true });
  } catch(e){ res.status(500).json({ success:false, message:'Falha ao atualizar título da aula' }); }
}

// ------------------- Get Content -------------------
async function GetContent(req, res){
  try {
    const groupCode = req.params.groupCode;
    const inst = institute(req);

    const chaptersQuery = `
      SELECT * FROM eduall_lesson_sections
      WHERE ed_lesson_section_groupCode=? AND ed_lesson_section_deleted=0 AND ed_lesson_section_institute_code=? AND ed_lesson_section_parent IS NULL
      ORDER BY ed_lesson_section_order`;
    const chapters = await ExecuteQuery(res, chaptersQuery, [groupCode, inst], true);

    const data = { chaptersOrder: [], chapters: {} };

    for(const chap of chapters){
      const chapId = `chap-${chap.ed_lesson_section_id}`;
      data.chaptersOrder.push(chapId);

      // Subcapítulos
      const subQuery = `SELECT * FROM eduall_lesson_sections WHERE ed_lesson_section_parent=? AND ed_lesson_section_deleted=0 AND ed_lesson_section_institute_code=? ORDER BY ed_lesson_section_order`;
      const subchaptersRes = await ExecuteQuery(res, subQuery, [chap.ed_lesson_section_id, inst], true);

      // Aulas do capítulo
      const lessonsQuery = `SELECT * FROM eduall_lesson_content WHERE ed_lesson_content_section=? AND ed_lesson_content_deleted=0 AND ed_lesson_content_institute_code=? ORDER BY ed_lesson_content_order`;
      const lessonsRes = await ExecuteQuery(res, lessonsQuery, [chap.ed_lesson_section_id, inst], true);

      const lessons = lessonsRes.map(l=>({ id:`lesson-${l.ed_lesson_content_id}`, title:l.ed_lesson_content_title, type:l.ed_lesson_content_type||"doc" }));

      const subchapters = {};
      for(const sub of subchaptersRes){
        const subId = `sub-${sub.ed_lesson_section_id}`;
        const subLessonsRes = await ExecuteQuery(res, lessonsQuery, [sub.ed_lesson_section_id, inst], true);
        const subLessons = subLessonsRes.map(l=>({ id:`lesson-${l.ed_lesson_content_id}`, title:l.ed_lesson_content_title, type:l.ed_lesson_content_type||"doc" }));

        subchapters[subId] = { id:subId, title:sub.ed_lesson_section_title, lessons:subLessons };
      }

      data.chapters[chapId] = { id:chapId, title:chap.ed_lesson_section_title, subchapters, lessons };
    }

    res.json(data);
  } catch(err){ console.error(err); res.status(500).json({ success:false, message:"Falha ao listar conteúdo" }); }
}
 
 
// Atualizar ordem de seções (capítulos ou subcapítulos)
async function updateSectionOrder(req, res) {
  try {
    const { groupCode, parentSectionId = null, newOrder } = req.body;
    if (!Array.isArray(newOrder)) return res.status(400).json({ success:false, message:'newOrder deve ser um array' });

    for (let i = 0; i < newOrder.length; i++) {
      const q = `UPDATE eduall_lesson_sections SET ed_lesson_section_order = ?
                 WHERE ed_lesson_section_id = ? AND ed_lesson_section_institute_code = ?`;
      await ExecuteQuery(res, q, [i+1, newOrder[i], institute(req)], false, { db:'eduall_lesson_sections', type:'update', data:req });
    }

    await RegisterAuditAction({ session: req.session, res, req, action: 2, form: parentSectionId ? "Subcapítulo" : "Capítulo", description: `Reordenou ${parentSectionId ? 'subcapítulos' : 'capítulos'}` });
    emit('section:reordered', { groupCode });
    res.json({ success:true });
  } catch (e) { console.error(e); res.status(500).json({ success:false, message:'Falha ao atualizar ordem' }); }
}
 

// Atualizar ordem de aulas dentro de uma seção
async function updateLessonOrder(req, res) {
  try {
    const { sectionId, newOrder } = req.body;
    if (!Array.isArray(newOrder)) return res.status(400).json({ success:false, message:'newOrder deve ser um array' });

    for (let i = 0; i < newOrder.length; i++) {
      const q = `UPDATE eduall_lesson_content SET ed_lesson_content_order = ?
                 WHERE ed_lesson_content_id = ? AND ed_lesson_content_institute_code = ?`;
      await ExecuteQuery(res, q, [i+1, newOrder[i], institute(req)], false, { db:'eduall_lesson_content', type:'update', data:req });
    }

    await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Aulas", description:`Reordenou aulas da seção ID ${sectionId}` });
    emit('content:reordered', { sectionId });
    res.json({ success:true });
  } catch(e){ console.error(e); res.status(500).json({ success:false, message:'Falha ao atualizar ordem das aulas' }); }
}

// Atualizar título de aula
async function updateLessonTitle(req, res) {
  try {
    const { title, sectionId } = req.body;
    const q = `UPDATE eduall_lesson_content SET ed_lesson_content_title = ?
               WHERE ed_lesson_content_id = ? AND ed_lesson_content_institute_code = ?`;
    await ExecuteQuery(res, q, [title, req.params.id, institute(req)], false, { db:'eduall_lesson_content', type:'update', data:req });
    await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Aulas", description:`Atualizou título da aula ID ${req.params.id} (${title})` });
    emit('content:updated', { sectionId });
    res.json({ success:true });
  } catch(e){ res.status(500).json({ success:false, message:'Falha ao atualizar título da aula' }); }
}

 



// ------------------- Build Router -------------------
function buildLessonRouter(io){
  setIO(io);
  const router = express.Router();

  // Inicializar tabelas
  router.use(async (req,res,next)=>{ await createTables(res); next(); });
 
 

  // Sections
  router.post('/api/lesson/section', VerifyToken, createSection);
  router.put('/api/lesson/section/:id', VerifyToken, updateSectionTitle);
  router.delete('/api/lesson/section/:id', VerifyToken, deleteSection);

  // Lessons
  router.post('/api/lesson/lesson', VerifyToken, createLesson);
  router.put('/api/lesson/lesson/:id', VerifyToken, updateLessonTitle);

  // Get Content
  router.get('/api/lesson/content/:groupCode', VerifyToken, GetContent);


    // Sections / Subsections  
  router.put('/api/lesson/section-order', updateSectionOrder); 
  router.put('/api/lesson/lesson-order', updateLessonOrder);

  

  // File Upload
  router.post('/api/files/upload-mixed', VerifyToken, uploadMixed, async (req,res)=>{
    const results = { docs:[], video:null, thumb:null };
    for(const f of (req.files?.docs||[])) results.docs.push(await saveFileToDBFromDriveResp({ file:f, useType:'doc', req, res }));
    if(req.files?.video?.[0]) results.video = await saveFileToDBFromDriveResp({ file:req.files.video[0], useType:'video', req, res });
    if(req.files?.thumb?.[0]) results.thumb = await saveFileToDBFromDriveResp({ file:req.files.thumb[0], useType:'thumb', req, res });
    res.json(results);
  });

  return router;
}

module.exports = buildLessonRouter;