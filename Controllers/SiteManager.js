 const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;  // ← NOVO: fs.promises para async
const multer = require('multer');
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");


let ioRef = null;
const setIO = (io) => { ioRef = io; };
const emit = (event, payload) => { if (ioRef) ioRef.emit(event, payload); };
const institute = (req) => req.session?.user?.eduall_user_session_curentinstitute;

// ---------------- Storage uploads simples ----------------
// Garantir diretório assets (async)
let assetsInitialized = false;
const ensureAssetsDir = async () => {
  if (assetsInitialized) return;
  try { await fsPromises.stat(path.resolve('assets')); assetsInitialized = true; }
  catch { try { await fsPromises.mkdir(path.resolve('assets'), { recursive: true }); assetsInitialized = true; } catch (err) { console.warn('⚠️ assets error:', err.message); } }
};
ensureAssetsDir().catch(err => console.error('assets init:', err));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'assets'),
  filename: (req, file, cb) => cb(null, `site_${Date.now()}_${Math.random().toString(36).slice(2)}_${file.originalname.replace(/\s+/g,'_')}`)
function isValidDomain(d){
  // muito simples: rótulos a-z0-9-, TLD 2-24
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,24})+$/.test((d||'').toLowerCase());
}
function uniq(arr){ return Array.from(new Set(arr)); }
function suggestDomains(base){
  base = (base||'').toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/\s+/g,'').replace(/_/g,'-');
  const [name, ...tldsParts] = base.split('.');
  const tld = tldsParts.join('.') || 'pt';
  const stem = name.replace(/[^a-z0-9-]/g,'').replace(/^-+|-+$/g,'').slice(0,50) || 'escola';
  const variants = [
    stem, `${stem}-edu`, `${stem}-school`, `${stem}-academy`, `${stem}edu`, `${stem}school`,
    `${stem}${new Date().getFullYear()}`, `${stem}-online`, `go-${stem}`, `${stem}-portal`,
    `${stem}-campus`, `${stem}-net`, `${stem}-web`, `${stem}-site`, `${stem}-oficial`
  ];
  const tlds = [tld, 'ao'];
  const combos = [];
  variants.forEach(v => tlds.forEach(t => combos.push(`${v}.${t}`)));
  return uniq(combos).slice(0, 20);
}

// ---------------- DDL / Setup ----------------
async function ensureSiteTables(req, res) {
  try {
    // CONTACTS
    const ddlContacts = `
      CREATE TABLE IF NOT EXISTS eduall_website_contacts (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_phone VARCHAR(64), 
        ed_whatsapp VARCHAR(64), 
        ed_email VARCHAR(128), 
        ed_address VARCHAR(255),
        ed_map_iframe MEDIUMTEXT, 
        ed_institute_code VARCHAR(64) NOT NULL,
        UNIQUE KEY uniq_inst (ed_institute_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // COURSES
    const ddlCourses = `
      CREATE TABLE IF NOT EXISTS eduall_website_courses (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_name VARCHAR(255) NOT NULL,
        ed_description_html MEDIUMTEXT NULL,
        ed_image_url TEXT NULL,
        ed_deleted TINYINT(1) NOT NULL DEFAULT 0,
        ed_institute_code VARCHAR(64) NOT NULL,
        ed_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inst_del (ed_institute_code, ed_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // SLIDES
    const ddlSlides = `
      CREATE TABLE IF NOT EXISTS eduall_slides (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_title VARCHAR(255) NULL, 
        ed_description VARCHAR(1024) NULL, 
        ed_link TEXT NULL, 
        ed_image_url TEXT NULL,
        ed_order INT NOT NULL DEFAULT 1, 
        ed_deleted TINYINT(1) NOT NULL DEFAULT 0,
        ed_institute_code VARCHAR(64) NOT NULL, 
        ed_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inst_del (ed_institute_code, ed_deleted), 
        INDEX idx_order (ed_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // SECTIONS (30)
    const ddlSections30 = `
      CREATE TABLE IF NOT EXISTS eduall_sections30 (
        ed_id INT AUTO_INCREMENT PRIMARY KEY, 
        ed_idx INT NOT NULL, 
        ed_title VARCHAR(255) NULL,
        ed_image_url TEXT NULL, 
        ed_description_html MEDIUMTEXT NULL, 
        ed_link TEXT NULL,
        ed_institute_code VARCHAR(64) NOT NULL, 
        UNIQUE KEY uniq_inst_idx (ed_institute_code, ed_idx)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // BRANDING
    const ddlBranding = `
      CREATE TABLE IF NOT EXISTS eduall_branding (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_school_name VARCHAR(255) NULL, 
        ed_slogan VARCHAR(255) NULL, 
        ed_logo_url TEXT NULL,
        ed_institute_code VARCHAR(64) NOT NULL, 
        UNIQUE KEY uniq_inst (ed_institute_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // POSTS
    const ddlPosts = `
      CREATE TABLE IF NOT EXISTS eduall_website_posts (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_title VARCHAR(255) NOT NULL, 
        ed_description VARCHAR(1024) NULL, 
        ed_content_html MEDIUMTEXT NULL,
        ed_image_url TEXT NULL, 
        ed_status ENUM('draft','scheduled','published') DEFAULT 'draft',
        ed_published_at DATE NULL, 
        ed_deleted TINYINT(1) NOT NULL DEFAULT 0,
        ed_institute_code VARCHAR(64) NOT NULL, 
        ed_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inst_del (ed_institute_code, ed_deleted), 
        INDEX idx_status (ed_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // TEMPLATES
    const ddlTemplates = `
      CREATE TABLE IF NOT EXISTS eduall_templates (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_code VARCHAR(32) NOT NULL,
        ed_title VARCHAR(255) NULL,
        ed_image_url TEXT NULL,
        ed_description VARCHAR(1024) NULL,
        ed_is_active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uniq_code (ed_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // SCHOOL SITE (template + dominio)
    const ddlSchoolSite = `
      CREATE TABLE IF NOT EXISTS eduall_school_site (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_institute_code VARCHAR(64) NOT NULL,
        ed_template_code VARCHAR(32) NULL,
        ed_domain VARCHAR(253) NULL,
        UNIQUE KEY uniq_inst (ed_institute_code),
        UNIQUE KEY uniq_domain (ed_domain),
        INDEX idx_template (ed_template_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // PRE-ENROLLMENTS (caso não exista ainda)
    const ddlPreEnrollments = `
      CREATE TABLE IF NOT EXISTS eduall_pre_enrollments (
        ed_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_student_name VARCHAR(255) NOT NULL,
        ed_email VARCHAR(255) NULL,
        ed_phone VARCHAR(64) NULL,
        ed_course VARCHAR(255) NULL,
        ed_institute_code VARCHAR(64) NOT NULL,
        ed_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inst (ed_institute_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

    // Executa DDLs
    await ExecuteQuery(res, ddlContacts, [], false, { db:"eduall_website_contacts", type:"create", data:req });
    await ExecuteQuery(res, ddlCourses, [], false, { db:"eduall_website_courses", type:"create", data:req });
    await ExecuteQuery(res, ddlSlides, [], false, { db:"eduall_slides", type:"create", data:req });
    await ExecuteQuery(res, ddlSections30, [], false, { db:"eduall_sections30", type:"create", data:req });
    await ExecuteQuery(res, ddlBranding, [], false, { db:"eduall_branding", type:"create", data:req });
    await ExecuteQuery(res, ddlPosts, [], false, { db:"eduall_website_posts", type:"create", data:req }); 
    await ExecuteQuery(res, ddlTemplates, [], false, { db:"eduall_templates", type:"create", data:req });
    await ExecuteQuery(res, ddlSchoolSite, [], false, { db:"eduall_school_site", type:"create", data:req });
    await ExecuteQuery(res, ddlPreEnrollments, [], false, { db:"eduall_pre_enrollments", type:"create", data:req });

    // Seed 30 secções por escola
    const inst = institute(req);
    if (!inst) return res.status(400).json({ success:false, message:"Sessão inválida (institute)." });
    const csec = await ExecuteQuery(res, `SELECT COUNT(*) c FROM eduall_sections30 WHERE ed_institute_code=?`, [inst], true, { db:"eduall_sections30", type:"select", data:req });
    if ((csec?.[0]?.c||0) < 30) {
      for (let i=1;i<=30;i++){
        await ExecuteQuery(res, `INSERT IGNORE INTO eduall_sections30 (ed_idx, ed_institute_code) VALUES(?,?)`, [i, inst], false, { db:"eduall_sections30", type:"insert", data:req });
      }
    }

    // Seed 10 templates (se vazio)
    const ctpl = await ExecuteQuery(res, `SELECT COUNT(*) c FROM eduall_templates`, [], true, { db:"eduall_templates", type:"select", data:req });
    if ((ctpl?.[0]?.c||0) === 0) {
      const base = [
        { ed_code:'TPL001', ed_title:'Clássico',   ed_image_url:'/assets/tpl/classic.jpg',   ed_description:'Layout clássico, navegação superior.' },
        { ed_code:'TPL002', ed_title:'Moderno',    ed_image_url:'/assets/tpl/modern.jpg',    ed_description:'Visual moderno com cards.' },
        { ed_code:'TPL003', ed_title:'Minimal',    ed_image_url:'/assets/tpl/minimal.jpg',   ed_description:'Minimalista, foco no conteúdo.' },
        { ed_code:'TPL004', ed_title:'Edu Pro',    ed_image_url:'/assets/tpl/edupro.jpg',    ed_description:'Para escolas de médio/grande porte.' },
        { ed_code:'TPL005', ed_title:'OnePage',    ed_image_url:'/assets/tpl/onepage.jpg',   ed_description:'Site em página única.' },
        { ed_code:'TPL006', ed_title:'Vibrante',   ed_image_url:'/assets/tpl/vibrant.jpg',   ed_description:'Cores fortes e secções dinâmicas.' },
        { ed_code:'TPL007', ed_title:'Sereno',     ed_image_url:'/assets/tpl/serene.jpg',    ed_description:'Tons suaves e tipografia clean.' },
        { ed_code:'TPL008', ed_title:'Tech',       ed_image_url:'/assets/tpl/tech.jpg',      ed_description:'Estilo tecnológico, grid responsivo.' },
        { ed_code:'TPL009', ed_title:'Magazine',   ed_image_url:'/assets/tpl/mag.jpg',       ed_description:'Forte foco em blog/notícias.' },
        { ed_code:'TPL010', ed_title:'Academy',    ed_image_url:'/assets/tpl/academy.jpg',   ed_description:'Ideal para cursos e turmas.' },
      ];
      for (const t of base) {
        await ExecuteQuery(
          res,
          `INSERT INTO eduall_templates (ed_code, ed_title, ed_image_url, ed_description) VALUES(?,?,?,?)`,
          [t.ed_code, t.ed_title, t.ed_image_url, t.ed_description],
          false, { db:"eduall_templates", type:"insert", data:req }
        );
      }
    }

    // Seed registo escola no site (linha vazia)
    await ExecuteQuery(
      res,
      `INSERT IGNORE INTO eduall_school_site (ed_institute_code) VALUES(?)`,
      [inst], false, { db:"eduall_school_site", type:"insert", data:req }
    );

    res.json({ success:true, message:"Tabelas OK + seeds executados." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success:false, message:"Falha ao criar/verificar tabelas.", error:e.message });
  }
}

// ---------------- Upload simples ----------------
async function uploadHandler(req, res) {
  try { const f = req.file; if(!f) return res.status(400).json({ success:false, message:"Ficheiro ausente." });
    return res.json({ success:true, url:`/assets/${path.basename(f.path)}` });
  } catch(e){ res.status(500).json({ success:false, message:"Falha no upload.", error:e.message }); }
}

// ---------------- Contactos ----------------
async function getContacts(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_phone, ed_whatsapp, ed_email, ed_address, ed_map_iframe 
     FROM eduall_website_contacts WHERE ed_institute_code=? LIMIT 1`,
    [institute(req)], true, { db:"eduall_website_contacts", type:"select", data:req }
  );
  res.json(rows?.[0] || { ed_phone:"", ed_whatsapp:"", ed_email:"", ed_address:"", ed_map_iframe:"" });
} catch(e){ res.status(500).json({ success:false, message:"Falha a obter contactos." }); } }

async function saveContacts(req,res){ try{
  const inst=institute(req); const { ed_phone, ed_whatsapp, ed_email, ed_address, ed_map_iframe } = req.body||{};
  const ex = await ExecuteQuery(res, `SELECT ed_id FROM eduall_website_contacts WHERE ed_institute_code=? LIMIT 1`, [inst], true, { db:"eduall_website_contacts", type:"select", data:req });
  if (ex?.length){
    await ExecuteQuery(
      res,
      `UPDATE eduall_website_contacts 
       SET ed_phone=?, ed_whatsapp=?, ed_email=?, ed_address=?, ed_map_iframe=? 
       WHERE ed_institute_code=?`,
      [ed_phone||null, ed_whatsapp||null, ed_email||null, ed_address||null, ed_map_iframe||null, inst],
      false, { db:"eduall_website_contacts", type:"update", data:req }
    );
  } else {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_website_contacts (ed_phone, ed_whatsapp, ed_email, ed_address, ed_map_iframe, ed_institute_code) 
       VALUES(?,?,?,?,?,?)`,
      [ed_phone||null, ed_whatsapp||null, ed_email||null, ed_address||null, ed_map_iframe||null, inst],
      false, { db:"eduall_website_contacts", type:"insert", data:req }
    );
  }
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Contactos", description:`Guardou contactos.` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a guardar contactos." }); } }

// ---------------- Cursos ----------------
async function listCourses(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_id, ed_name, ed_description_html, ed_image_url 
     FROM eduall_website_courses WHERE ed_deleted=0 AND ed_institute_code=? ORDER BY ed_id DESC`,
    [institute(req)], true, { db:"eduall_website_courses", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar cursos." }); } }

async function createCourse(req,res){ try{
  const { ed_name, ed_description_html, ed_image_url } = req.body||{};
  const r = await ExecuteQuery(
    res,
    `INSERT INTO eduall_website_courses (ed_name, ed_description_html, ed_image_url, ed_institute_code) 
     VALUES(?,?,?,?)`,
    [ed_name, ed_description_html||null, ed_image_url||null, institute(req)],
    false, { db:"eduall_website_courses", type:"insert", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:1, form:"Site — Cursos", description:`Criou curso ${ed_name}` });
  res.json({ success:true, ed_id:r.insertId });
} catch(e){ res.status(500).json({ success:false, message:"Falha a criar curso." }); } }

async function updateCourse(req,res){ try{
  const { ed_name, ed_description_html, ed_image_url } = req.body||{};
  await ExecuteQuery(
    res,
    `UPDATE eduall_website_courses SET ed_name=?, ed_description_html=?, ed_image_url=? 
     WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [ed_name, ed_description_html||null, ed_image_url||null, req.params.id, institute(req)],
    false, { db:"eduall_website_courses", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Cursos", description:`Atualizou curso ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a atualizar curso." }); } }

async function deleteCourse(req,res){ try{
  await ExecuteQuery(
    res,
    `UPDATE eduall_website_courses SET ed_deleted=1 WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [req.params.id, institute(req)],
    false, { db:"eduall_website_courses", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:3, form:"Site — Cursos", description:`Eliminou curso ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a eliminar curso." }); } }

// ---------------- Slides ----------------
async function listSlides(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_id, ed_title, ed_description, ed_link, ed_image_url, ed_order 
     FROM eduall_slides WHERE ed_deleted=0 AND ed_institute_code=? 
     ORDER BY ed_order ASC, ed_id DESC`,
    [institute(req)], true, { db:"eduall_slides", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar slides." }); } }

async function createSlide(req,res){ try{
  const { ed_title, ed_description, ed_link, ed_image_url, ed_order=1 } = req.body||{};
  const r = await ExecuteQuery(
    res,
    `INSERT INTO eduall_slides (ed_title, ed_description, ed_link, ed_image_url, ed_order, ed_institute_code) 
     VALUES(?,?,?,?,?,?)`,
    [ed_title||null, ed_description||null, ed_link||null, ed_image_url||null, Number(ed_order)||1, institute(req)],
    false, { db:"eduall_slides", type:"insert", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:1, form:"Site — Slides", description:`Criou slide ${ed_title||''}` });
  res.json({ success:true, ed_id:r.insertId });
} catch(e){ res.status(500).json({ success:false, message:"Falha a criar slide." }); } }

async function updateSlide(req,res){ try{
  const { ed_title, ed_description, ed_link, ed_image_url, ed_order=1 } = req.body||{};
  await ExecuteQuery(
    res,
    `UPDATE eduall_slides SET ed_title=?, ed_description=?, ed_link=?, ed_image_url=?, ed_order=? 
     WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [ed_title||null, ed_description||null, ed_link||null, ed_image_url||null, Number(ed_order)||1, req.params.id, institute(req)],
    false, { db:"eduall_slides", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Slides", description:`Atualizou slide ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a atualizar slide." }); } }

async function deleteSlide(req,res){ try{
  await ExecuteQuery(
    res,
    `UPDATE eduall_slides SET ed_deleted=1 WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [req.params.id, institute(req)],
    false, { db:"eduall_slides", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:3, form:"Site — Slides", description:`Eliminou slide ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a eliminar slide." }); } }

// ---------------- Secções 30 ----------------
async function listSections30(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_idx, ed_title, ed_image_url, ed_description_html, ed_link 
     FROM eduall_sections30 WHERE ed_institute_code=? ORDER BY ed_idx ASC`,
    [institute(req)], true, { db:"eduall_sections30", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar secções." }); } }

async function updateSectionByIdx(req,res){ try{
  const { ed_title, ed_image_url, ed_description_html, ed_link } = req.body||{};
  await ExecuteQuery(
    res,
    `UPDATE eduall_sections30 
     SET ed_title=?, ed_image_url=?, ed_description_html=?, ed_link=? 
     WHERE ed_institute_code=? AND ed_idx=?`,
    [ed_title||null, ed_image_url||null, ed_description_html||null, ed_link||null, institute(req), Number(req.params.idx)],
    false, { db:"eduall_sections30", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Secções", description:`Guardou secção #${req.params.idx}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a guardar secção." }); } }

// ---------------- Branding ----------------
async function getBranding(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_school_name, ed_slogan, ed_logo_url 
     FROM eduall_branding WHERE ed_institute_code=? LIMIT 1`,
    [institute(req)], true, { db:"eduall_branding", type:"select", data:req }
  );
  res.json(rows?.[0] || { ed_school_name:"", ed_slogan:"", ed_logo_url:"" });
} catch(e){ res.status(500).json({ success:false, message:"Falha a obter branding." }); } }

async function saveBranding(req,res){ try{
  const inst=institute(req); const { ed_school_name, ed_slogan, ed_logo_url } = req.body||{};
  const ex = await ExecuteQuery(res, `SELECT ed_id FROM eduall_branding WHERE ed_institute_code=? LIMIT 1`, [inst], true, { db:"eduall_branding", type:"select", data:req });
  if (ex?.length){
    await ExecuteQuery(
      res,
      `UPDATE eduall_branding SET ed_school_name=?, ed_slogan=?, ed_logo_url=? WHERE ed_institute_code=?`,
      [ed_school_name||null, ed_slogan||null, ed_logo_url||null, inst],
      false, { db:"eduall_branding", type:"update", data:req }
    );
  } else {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_branding (ed_school_name, ed_slogan, ed_logo_url, ed_institute_code) VALUES(?,?,?,?)`,
      [ed_school_name||null, ed_slogan||null, ed_logo_url||null, inst],
      false, { db:"eduall_branding", type:"insert", data:req }
    );
  }
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Branding", description:`Guardou branding.` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a guardar branding." }); } }

// ---------------- Blog ----------------
async function listPosts(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_id, ed_title, ed_description, ed_content_html, ed_image_url, ed_status, ed_published_at 
     FROM eduall_website_posts WHERE ed_deleted=0 AND ed_institute_code=? ORDER BY ed_id DESC`,
    [institute(req)], true, { db:"eduall_website_posts", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar posts." }); } }

async function createPost(req,res){ try{
  const { ed_title, ed_description, ed_content_html, ed_image_url, ed_status='draft', ed_published_at=null } = req.body||{};
  const r = await ExecuteQuery(
    res,
    `INSERT INTO eduall_website_posts (ed_title, ed_description, ed_content_html, ed_image_url, ed_status, ed_published_at, ed_institute_code) 
     VALUES(?,?,?,?,?,?,?)`,
    [ed_title, ed_description||null, ed_content_html||null, ed_image_url||null, ed_status, ed_published_at||null, institute(req)],
    false, { db:"eduall_website_posts", type:"insert", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:1, form:"Site — Blog", description:`Criou post ${ed_title}` });
  res.json({ success:true, ed_id:r.insertId });
} catch(e){ res.status(500).json({ success:false, message:"Falha a criar post." }); } }

async function updatePost(req,res){ try{
  const { ed_title, ed_description, ed_content_html, ed_image_url, ed_status='draft', ed_published_at=null } = req.body||{};
  await ExecuteQuery(
    res,
    `UPDATE eduall_website_posts 
     SET ed_title=?, ed_description=?, ed_content_html=?, ed_image_url=?, ed_status=?, ed_published_at=? 
     WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [ed_title, ed_description||null, ed_content_html||null, ed_image_url||null, ed_status, ed_published_at||null, req.params.id, institute(req)],
    false, { db:"eduall_website_posts", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Blog", description:`Atualizou post ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a atualizar post." }); } }

async function deletePost(req,res){ try{
  await ExecuteQuery(
    res,
    `UPDATE eduall_website_posts SET ed_deleted=1 WHERE ed_id=? AND ed_institute_code=? AND ed_deleted=0`,
    [req.params.id, institute(req)],
    false, { db:"eduall_website_posts", type:"update", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:3, form:"Site — Blog", description:`Eliminou post ID ${req.params.id}` });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a eliminar post." }); } }

// ---------------- Pré-matrículas (listagem) ----------------
async function listPreEnrollments(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_id, ed_student_name, ed_email, ed_phone, ed_course, ed_created_at 
     FROM eduall_pre_enrollments WHERE ed_institute_code=? ORDER BY ed_id DESC`,
    [institute(req)], true, { db:"eduall_pre_enrollments", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar pré-matrículas." }); } }

// ---------------- Templates & Domínio ----------------
async function listTemplates(req,res){ try{
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_code, ed_title, ed_image_url, ed_description 
     FROM eduall_templates WHERE ed_is_active=1 ORDER BY ed_id ASC`,
    [], true, { db:"eduall_templates", type:"select", data:req }
  );
  res.json(rows);
} catch(e){ res.status(500).json({ success:false, message:"Falha a listar templates." }); } }

async function getSettings(req,res){ try{
  const inst = institute(req);
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_template_code, ed_domain 
     FROM eduall_school_site WHERE ed_institute_code=? LIMIT 1`,
    [inst], true, { db:"eduall_school_site", type:"select", data:req }
  );
  res.json(rows?.[0] || { ed_template_code:"", ed_domain:"" });
} catch(e){ res.status(500).json({ success:false, message:"Falha a obter definições." }); } }

async function selectTemplate(req,res){ try{
  const inst = institute(req);
  const { ed_template_code } = req.body||{};
  if (!ed_template_code) return res.status(400).json({ success:false, message:"ed_template_code obrigatório." });
  const ok = await ExecuteQuery(
    res,
    `SELECT 1 FROM eduall_templates WHERE ed_code=? AND ed_is_active=1`,
    [ed_template_code], true, { db:"eduall_templates", type:"select", data:req }
  );
  if (!ok?.length) return res.status(400).json({ success:false, message:"Template inválido." });
  await ExecuteQuery(
    res,
    `INSERT INTO eduall_school_site (ed_institute_code, ed_template_code) VALUES(?,?)
     ON DUPLICATE KEY UPDATE ed_template_code=VALUES(ed_template_code)`,
    [inst, ed_template_code], false, { db:"eduall_school_site", type:"upsert", data:req }
  );
  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Template", description:`Definiu template ${ed_template_code}` });
  emit('site:template', { ed_institute_code: inst, ed_template_code });
  res.json({ success:true });
} catch(e){ res.status(500).json({ success:false, message:"Falha a selecionar template." }); } }

async function checkDomain(req,res){ try{
  const { ed_domain } = req.body||{};
  if (!ed_domain) return res.status(400).json({ success:false, message:"ed_domain obrigatório." });
  const d = ed_domain.toLowerCase();
  if (!isValidDomain(d)) {
    return res.json({ available:false, reason:"Formato de domínio inválido. Use apenas letras, números e hífen; inclua TLD (ex.: .pt, .com).", suggestions: suggestDomains(d) });
  }
  const exists = await ExecuteQuery(
    res,
    `SELECT 1 FROM eduall_school_site WHERE ed_domain=?`,
    [d], true, { db:"eduall_school_site", type:"select", data:req }
  );
  if (exists?.length) return res.json({ available:false, reason:"Este domínio já está registado no sistema.", suggestions: suggestDomains(d) });
  res.json({ available:true, suggestions: suggestDomains(d) });
} catch(e){ res.status(500).json({ success:false, message:"Falha na verificação de domínio." }); } }

async function registerDomain(req,res){ try{
  const inst = institute(req);
  const { ed_domain } = req.body||{};
  if (!ed_domain) return res.status(400).json({ success:false, message:"ed_domain obrigatório." });
  const d = ed_domain.toLowerCase();
  if (!isValidDomain(d)) return res.status(400).json({ success:false, message:"Formato de domínio inválido." });
  const exists = await ExecuteQuery(
    res,
    `SELECT 1 FROM eduall_school_site WHERE ed_domain=? AND ed_institute_code<>?`,
    [d, inst], true, { db:"eduall_school_site", type:"select", data:req }
  );
  if (exists?.length) return res.status(409).json({ success:false, message:"Domínio já registado noutra escola." });

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_school_site (ed_institute_code, ed_domain) VALUES(?,?)
     ON DUPLICATE KEY UPDATE ed_domain=VALUES(ed_domain)`,
    [inst, d], false, { db:"eduall_school_site", type:"upsert", data:req }
  );

  await RegisterAuditAction({ session:req.session, res, req, action:2, form:"Site — Domínio", description:`Registou domínio ${d}` });
  emit('site:domain', { ed_institute_code: inst, ed_domain: d });
  res.json({ success:true, ed_domain: d });
} catch(e){ res.status(500).json({ success:false, message:"Falha ao registar domínio." }); } }

// ---------------- Router builder ----------------
function buildSiteRouter(io){
  setIO(io);
  const router = express.Router();

  router.post('/api/site/upload', upload.single('file'), uploadHandler);
  router.get('/api/site/setup/ensure-tables', ensureSiteTables);

  // contactos
  router.get('/api/site/contacts', getContacts);
  router.post('/api/site/contacts', express.json(), saveContacts);

  // cursos
  router.get('/api/site/courses', listCourses);
  router.post('/api/site/courses', express.json(), createCourse);
  router.put('/api/site/courses/:id', express.json(), updateCourse);
  router.delete('/api/site/courses/:id', deleteCourse);

  // slides
  router.get('/api/site/slides', listSlides);
  router.post('/api/site/slides', express.json(), createSlide);
  router.put('/api/site/slides/:id', express.json(), updateSlide);
  router.delete('/api/site/slides/:id', deleteSlide);

  // secções 30
  router.get('/api/site/sections/30', listSections30);
  router.put('/api/site/sections/:idx', express.json(), updateSectionByIdx);

  // branding
  router.get('/api/site/branding', getBranding);
  router.post('/api/site/branding', express.json(), saveBranding);

  // blog
  router.get('/api/site/posts', listPosts);
  router.post('/api/site/posts', express.json(), createPost);
  router.put('/api/site/posts/:id', express.json(), updatePost);
  router.delete('/api/site/posts/:id', deletePost);

  // pré-matrículas
  router.get('/api/site/pre-enrollments', listPreEnrollments);

  // templates & domínio
  router.get('/api/site/templates', listTemplates);
  router.get('/api/site/settings', getSettings);
  router.post('/api/site/template/select', express.json(), selectTemplate);
  router.post('/api/site/domain/check', express.json(), checkDomain);
  router.post('/api/site/domain/register', express.json(), registerDomain);

  return router;
}

module.exports = buildSiteRouter;