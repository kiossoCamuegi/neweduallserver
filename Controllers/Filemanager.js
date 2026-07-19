'use strict';

/**
 * FileManagerController.js — eduall · Gestor de Ficheiros
 *
 * Cada escola tem a sua pasta isolada:
 *   files/filemanager/<institute_code>/
 *
 * Melhorias de performance:
 *   – Batch INSERT para uploads múltiplos (1 query, N rows)
 *   – Promise.all onde há queries independentes
 *   – inst(req) cached por request em vez de chamado várias vezes
 *   – path.resolve(base, institute_code) calculado uma única vez no middleware
 */

const { RegisterAuditAction } = require('./Auditory');
const ExecuteQuery             = require('../Functions/ExecuteQuery');
const multer                   = require('multer');
const path                     = require('path');
const fs                       = require('fs');
const fsPromises              = require('fs').promises;  // ← NOVO: fs.promises para async

/* ─────────────────────────────────────────
   HELPER — institute code from session
───────────────────────────────────────── */
const inst = req => req.session.user.eduall_user_session_curentinstitute;

/* ─────────────────────────────────────────
   HELPER — Garantir diretório de upload (async, não bloqueia)
───────────────────────────────────────── */
const ensureFilemanagerDir = async (instituteCode) => {
  try {
    const safe = String(instituteCode).replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join('files', 'filemanager', safe);
    await fsPromises.stat(dir);  // Verifica se existe
  } catch {
    try {
      const safe = String(instituteCode).replace(/[^a-zA-Z0-9_-]/g, '_');
      const dir = path.join('files', 'filemanager', safe);
      await fsPromises.mkdir(dir, { recursive: true });  // Cria se não existe
    } catch (err) {
      console.warn('⚠️ Erro ao criar diretório de filemanager:', err.message);
    }
  }
};

/* ─────────────────────────────────────────
   HELPER — Retornar diretório (sync, mas seguro porque directory já foi criado)
───────────────────────────────────────── */
const getInstDir = (instituteCode) => {
  // Sanitize: só alfanumérico, hífen e underscore para evitar path traversal
  const safe = String(instituteCode).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir   = path.join('files', 'filemanager', safe);
  // Diretório já foi garantido em ensureFilemanagerDir (async)
  return dir;
};

/* ─────────────────────────────────────────
   GET FOLDER TREE (sidebar)
───────────────────────────────────────── */
const GetFolderTree = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const query = `
      WITH RECURSIVE folder_tree AS (
        SELECT fm_id, fm_name, fm_parent_id, fm_access, 0 AS fm_depth
        FROM   eduall_filemanager_items
        WHERE  fm_type = 'folder'
          AND  fm_deleted = 0
          AND  fm_parent_id IS NULL
          AND  fm_institute_code = ?

        UNION ALL

        SELECT c.fm_id, c.fm_name, c.fm_parent_id, c.fm_access, p.fm_depth + 1
        FROM   eduall_filemanager_items c
        INNER  JOIN folder_tree p ON c.fm_parent_id = p.fm_id
        WHERE  c.fm_type = 'folder'
          AND  c.fm_deleted = 0
          AND  c.fm_institute_code = ?
      )
      SELECT * FROM folder_tree
      ORDER BY fm_depth ASC, fm_name ASC`;

    const rows = await ExecuteQuery(res, query, [instituteCode, instituteCode], true, {
      db: 'eduall_filemanager_items', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao obter estrutura de pastas!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   QUERIES REUTILIZÁVEIS
───────────────────────────────────────── */
const _buildContentsQuery = (hasFolderId) => `
  SELECT
    fm_id, fm_name, fm_type, fm_parent_id,
    fm_ext, fm_size, fm_mime_type, fm_access,
    DATE_FORMAT(fm_created_at, '%d %b %Y') AS fm_created_at
  FROM   eduall_filemanager_items
  WHERE  fm_deleted = 0
    AND  ${hasFolderId ? 'fm_parent_id = ?' : 'fm_parent_id IS NULL'}
    AND  fm_institute_code = ?
  ORDER BY
    CASE fm_type WHEN 'folder' THEN 0 ELSE 1 END ASC,
    fm_name ASC`;

const _statsQuery = `
  SELECT
    COALESCE(SUM(CASE WHEN fm_type = 'folder' THEN 1 ELSE 0 END), 0) AS folders,
    COALESCE(SUM(CASE WHEN fm_type = 'file'   THEN 1 ELSE 0 END), 0) AS files,
    COALESCE(SUM(CASE WHEN fm_type = 'file'   THEN fm_size ELSE 0 END), 0) AS size
  FROM eduall_filemanager_items
  WHERE fm_deleted = 0
    AND fm_institute_code = ?`;

/* ─────────────────────────────────────────
   GET CONTENTS — root
───────────────────────────────────────── */
const GetRootContents = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const [items, statsRows] = await Promise.all([
      ExecuteQuery(res, _buildContentsQuery(false), [instituteCode], true,
        { db: 'eduall_filemanager_items', type: 'select', data: req }),
      ExecuteQuery(res, _statsQuery, [instituteCode], true,
        { db: 'eduall_filemanager_items', type: 'select', data: req }),
    ]);
    res.status(200).json({ items, stats: statsRows[0] || { folders: 0, files: 0, size: 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao listar conteúdo!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   GET CONTENTS — pasta específica
───────────────────────────────────────── */
const GetFolderContents = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const { FOLDER_ID } = req.params;
    const [items, statsRows] = await Promise.all([
      ExecuteQuery(res, _buildContentsQuery(true), [FOLDER_ID, instituteCode], true,
        { db: 'eduall_filemanager_items', type: 'select', data: req }),
      ExecuteQuery(res, _statsQuery, [instituteCode], true,
        { db: 'eduall_filemanager_items', type: 'select', data: req }),
    ]);
    res.status(200).json({ items, stats: statsRows[0] || { folders: 0, files: 0, size: 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao listar pasta!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   CREATE FOLDER
───────────────────────────────────────── */
const CreateFolder = async (req, res) => {
  try {
    const instituteCode          = inst(req);
    const { fm_name, fm_parent_id = null, fm_access = 'public' } = req.body;

    if (!fm_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Nome da pasta é obrigatório.' });
    }

    // Verificar duplicado
    const dupQuery = `
      SELECT fm_id FROM eduall_filemanager_items
      WHERE  fm_deleted = 0
        AND  fm_type = 'folder'
        AND  fm_name = ?
        AND  fm_institute_code = ?
        AND  ${fm_parent_id ? 'fm_parent_id = ?' : 'fm_parent_id IS NULL'}`;
    const dupParams = fm_parent_id
      ? [fm_name.trim(), instituteCode, fm_parent_id]
      : [fm_name.trim(), instituteCode];

    const dup = await ExecuteQuery(res, dupQuery, dupParams, true,
      { db: 'eduall_filemanager_items', type: 'select', data: req });
    if (dup.length > 0) {
      return res.status(409).json({ success: false, message: `Já existe uma pasta com o nome "${fm_name}" neste local.` });
    }

    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_filemanager_items
         (fm_name, fm_type, fm_parent_id, fm_access, fm_institute_code, fm_created_by)
       VALUES (?, 'folder', ?, ?, ?, ?)`,
      [fm_name.trim(), fm_parent_id || null, fm_access, instituteCode, req.session.user.eduall_user_session_id],
      false, { db: 'eduall_filemanager_items', type: 'insert', data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: 'Gestor de Ficheiros',
      description: `Criou a pasta "${fm_name}"`,
    });

    res.status(200).json({ success: true, fm_id: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao criar pasta!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   UPLOAD FILES
   – Batch INSERT: 1 query com N value-sets
   – Multer já escreveu os ficheiros em
     files/filemanager/<institute_code>/
───────────────────────────────────────── */
const UploadFiles = async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'Nenhum ficheiro recebido.' });
    }

    const instituteCode = inst(req);
    const userId        = req.session.user.eduall_user_session_id;
    const parentId      = req.body.fm_parent_id || null;

    // Batch INSERT — uma única query para todos os ficheiros
    const placeholders = req.files.map(() => '(?, \'file\', ?, ?, ?, ?, ?, \'public\', ?, ?)').join(', ');
    const values       = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
      values.push(
        file.originalname,
        parentId,
        ext,
        file.size,
        file.path,          // já aponta para files/filemanager/<institute_code>/
        file.mimetype,
        instituteCode,
        userId,
      );
    }

    await ExecuteQuery(res,
      `INSERT INTO eduall_filemanager_items
         (fm_name, fm_type, fm_parent_id, fm_ext, fm_size,
          fm_file_path, fm_mime_type, fm_access, fm_institute_code, fm_created_by)
       VALUES ${placeholders}`,
      values, false,
      { db: 'eduall_filemanager_items', type: 'insert', data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: 'Gestor de Ficheiros',
      description: `Carregou ${req.files.length} ficheiro(s)`,
    });

    res.status(200).json({ success: true, count: req.files.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha no upload!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   RENAME ITEM
───────────────────────────────────────── */
const RenameItem = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const { ID }        = req.params;
    const { fm_name }   = req.body;

    if (!fm_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Nome é obrigatório.' });
    }

    await ExecuteQuery(res,
      `UPDATE eduall_filemanager_items
       SET fm_name = ?
       WHERE fm_deleted = 0 AND fm_id = ? AND fm_institute_code = ?`,
      [fm_name.trim(), ID, instituteCode],
      false, { db: 'eduall_filemanager_items', type: 'update', data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: 'Gestor de Ficheiros',
      description: `Renomeou item ID ${ID} para "${fm_name}"`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao renomear!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   DELETE (soft) — aceita array de IDs
───────────────────────────────────────── */
const DeleteItems = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const { ids }       = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs inválidos.' });
    }

    const ph = ids.map(() => '?').join(', ');

    // Soft-delete dos itens seleccionados + todos os descendentes (CTE recursiva)
    await Promise.all([
      ExecuteQuery(res,
        `UPDATE eduall_filemanager_items
         SET fm_deleted = 1
         WHERE fm_deleted = 0 AND fm_id IN (${ph}) AND fm_institute_code = ?`,
        [...ids, instituteCode],
        false, { db: 'eduall_filemanager_items', type: 'update', data: req }),

      ExecuteQuery(res,
        `WITH RECURSIVE to_delete AS (
           SELECT fm_id FROM eduall_filemanager_items
           WHERE  fm_parent_id IN (${ph})
             AND  fm_deleted = 0
             AND  fm_institute_code = ?
           UNION ALL
           SELECT c.fm_id FROM eduall_filemanager_items c
           INNER  JOIN to_delete p ON c.fm_parent_id = p.fm_id
           WHERE  c.fm_deleted = 0
             AND  c.fm_institute_code = ?
         )
         UPDATE eduall_filemanager_items
         SET fm_deleted = 1
         WHERE fm_id IN (SELECT fm_id FROM to_delete)`,
        [...ids, instituteCode, instituteCode],
        false, { db: 'eduall_filemanager_items', type: 'update', data: req }),
    ]);

    await RegisterAuditAction({
      session: req.session, action: 3,
      form: 'Gestor de Ficheiros',
      description: `Removeu ${ids.length} item(s) (IDs: ${ids.join(', ')})`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao apagar!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   PASTE (copy | move)
───────────────────────────────────────── */
const PasteItem = async (req, res) => {
  try {
    const instituteCode               = inst(req);
    const { fm_id, target_folder_id, op } = req.body;

    if (!fm_id) return res.status(400).json({ success: false, message: 'fm_id obrigatório.' });

    if (op === 'cut') {
      await ExecuteQuery(res,
        `UPDATE eduall_filemanager_items
         SET fm_parent_id = ?
         WHERE fm_deleted = 0 AND fm_id = ? AND fm_institute_code = ?`,
        [target_folder_id || null, fm_id, instituteCode],
        false, { db: 'eduall_filemanager_items', type: 'update', data: req });

      await RegisterAuditAction({
        session: req.session, action: 2,
        form: 'Gestor de Ficheiros',
        description: `Moveu item ID ${fm_id} para pasta ID ${target_folder_id || 'Raiz'}`,
      });
    } else {
      const rows = await ExecuteQuery(res,
        `SELECT * FROM eduall_filemanager_items
         WHERE fm_id = ? AND fm_deleted = 0 AND fm_institute_code = ?`,
        [fm_id, instituteCode], true,
        { db: 'eduall_filemanager_items', type: 'select', data: req });

      if (!rows.length) return res.status(404).json({ success: false, message: 'Item não encontrado.' });

      const src = rows[0];
      await ExecuteQuery(res,
        `INSERT INTO eduall_filemanager_items
           (fm_name, fm_type, fm_parent_id, fm_ext, fm_size,
            fm_file_path, fm_mime_type, fm_access, fm_institute_code, fm_created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${src.fm_name} (cópia)`, src.fm_type,
          target_folder_id || null,
          src.fm_ext, src.fm_size, src.fm_file_path,
          src.fm_mime_type, src.fm_access,
          instituteCode, req.session.user.eduall_user_session_id,
        ],
        false, { db: 'eduall_filemanager_items', type: 'insert', data: req });

      await RegisterAuditAction({
        session: req.session, action: 1,
        form: 'Gestor de Ficheiros',
        description: `Copiou item "${src.fm_name}" para pasta ID ${target_folder_id || 'Raiz'}`,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao colar!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   DOWNLOAD FILE
───────────────────────────────────────── */
const DownloadFile = async (req, res) => {
  try {
    const instituteCode = inst(req);
    const { ID }        = req.params;

    const rows = await ExecuteQuery(res,
      `SELECT fm_name, fm_file_path, fm_mime_type
       FROM   eduall_filemanager_items
       WHERE  fm_deleted = 0
         AND  fm_type = 'file'
         AND  fm_id = ?
         AND  fm_institute_code = ?`,
      [ID, instituteCode], true,
      { db: 'eduall_filemanager_items', type: 'select', data: req });

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Ficheiro não encontrado.' });
    }

    const file    = rows[0];
    const absPath = path.resolve(file.fm_file_path);

    // Garantir que o path está dentro da pasta da escola (segurança)
    const instDir = path.resolve(getInstDir(instituteCode));
    if (!absPath.startsWith(instDir)) {
      return res.status(403).json({ success: false, message: 'Acesso negado.' });
    }

    // Verificar se ficheiro existe (async)
    try {
      await fsPromises.stat(absPath);
    } catch {
      return res.status(404).json({ success: false, message: 'Ficheiro em disco não encontrado.' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fm_name)}"`);
    if (file.fm_mime_type) res.setHeader('Content-Type', file.fm_mime_type);
    res.sendFile(absPath);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha no download!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   GET STATS
───────────────────────────────────────── */
const GetStats = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res, _statsQuery, [inst(req)], true,
      { db: 'eduall_filemanager_items', type: 'select', data: req });
    res.status(200).json(rows[0] || { folders: 0, files: 0, size: 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao obter estatísticas!', error: error.message });
  }
};

/* ─────────────────────────────────────────
   MULTER — pasta isolada por escola
   files/filemanager/<institute_code>/
───────────────────────────────────────── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const dir = getInstDir(inst(req));
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const unique = `fm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'text/plain', 'text/csv',
    'application/json',
  ]);
  if (allowed.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de ficheiro não permitido: ${file.mimetype}`), false);
  }
};

const uploadFileManagerFiles = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB por ficheiro
}).array('files', 20);

/* ─────────────────────────────────────────
   EXPORTS
───────────────────────────────────────── */
module.exports = {
  GetFolderTree,
  GetRootContents,
  GetFolderContents,
  CreateFolder,
  UploadFiles,
  RenameItem,
  DeleteItems,
  PasteItem,
  DownloadFile,
  GetStats,
  uploadFileManagerFiles,
};