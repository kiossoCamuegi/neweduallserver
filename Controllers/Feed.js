'use strict'; 
const express               = require('express');
const http                  = require('http');
const socketIo              = require('socket.io');
const multer                = require('multer');
const path                  = require('path');
const moment                = require('moment');
const cron                  = require('node-cron');
const cloudinary            = require('cloudinary').v2;
const axios                 = require('axios');

const ExecuteQuery          = require('../Functions/ExecuteQuery');
const { RegisterAuditAction } = require('../Auditory');

require('dotenv').config();
moment.locale('pt');

// ─────────────────────────────────────────────────────────────────────────────
//  CLOUDINARY CONFIG
// ─────────────────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || '',
  api_key:    process.env.CLOUDINARY_KEY  || '',
  api_secret: process.env.CLOUDINARY_SECRET || '',
});

// ─────────────────────────────────────────────────────────────────────────────
//  APP + SERVER + SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, {
  cors: { origin: process.env.APP_CLIENT_URL || '*', credentials: true },
});

// ─────────────────────────────────────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer: upload de media (images + videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'assets/feed'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
    cb(null, `feed_${Date.now()}_${Math.random().toString(36).slice(2)}_${safe}`);
  }
});

const uploadMedia = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    const isImg = file.mimetype.startsWith('image/');
    const isVid = file.mimetype.startsWith('video/');
    if (isImg || isVid) return cb(null, true);
    cb(new Error('Apenas imagens ou vídeos são permitidos.'));
  }
}).fields([
  { name: 'images', maxCount: 10 },
  { name: 'video',  maxCount: 1 },
]);

// ═══════════════════════════════════════════════════════════════════════════════
//  DDL — TABELAS DO FEED
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * TABELA: eduall_feed_posts
 * ─────────────────────────────────────────────────────────────────────────────
 * Posts do feed (capas, textos, media)
 */
const DDL_POSTS = `
CREATE TABLE IF NOT EXISTS eduall_feed_posts (
  ed_post_id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_post_code               VARCHAR(80) NOT NULL UNIQUE,
  ed_post_institute_code     VARCHAR(120) NOT NULL,
  ed_post_author_id          BIGINT NOT NULL,
  ed_post_author_name        VARCHAR(200),
  ed_post_author_avatar      VARCHAR(500),
  ed_post_author_verified    TINYINT(1) DEFAULT 0,
  ed_post_text               MEDIUMTEXT,
  ed_post_background         VARCHAR(100),
  ed_post_feeling            VARCHAR(100),
  ed_post_location           VARCHAR(200),
  ed_post_visibility         ENUM('public','private','friends') DEFAULT 'public',
  ed_post_school_tag         VARCHAR(200),
  ed_post_reactions_count    INT DEFAULT 0,
  ed_post_comments_count     INT DEFAULT 0,
  ed_post_shares_count       INT DEFAULT 0,
  ed_post_saved_count        INT DEFAULT 0,
  ed_post_views_count        INT DEFAULT 0,
  ed_post_liked_by_current   TINYINT(1) DEFAULT 0,
  ed_post_created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_post_updated_at         DATETIME NULL,
  ed_post_deleted            TINYINT(1) DEFAULT 0,
  ed_post_pinned             TINYINT(1) DEFAULT 0,
  ed_post_reported           TINYINT(1) DEFAULT 0,
  
  INDEX idx_institute        (ed_post_institute_code),
  INDEX idx_author           (ed_post_author_id),
  INDEX idx_visibility       (ed_post_visibility),
  INDEX idx_created          (ed_post_created_at DESC),
  INDEX idx_deleted          (ed_post_deleted),
  INDEX idx_pinned           (ed_post_pinned),
  INDEX idx_code             (ed_post_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_media
 * ─────────────────────────────────────────────────────────────────────────────
 * Imagens e vídeos associados aos posts
 */
const DDL_MEDIA = `
CREATE TABLE IF NOT EXISTS eduall_feed_media (
  ed_media_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_media_post_id           BIGINT NOT NULL,
  ed_media_institute_code    VARCHAR(120) NOT NULL,
  ed_media_type              ENUM('image','video') DEFAULT 'image',
  ed_media_src               VARCHAR(500) NOT NULL,
  ed_media_cloudinary_url    VARCHAR(500),
  ed_media_caption           VARCHAR(500),
  ed_media_order             INT DEFAULT 0,
  ed_media_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (ed_media_post_id) REFERENCES eduall_feed_posts(ed_post_id) ON DELETE CASCADE,
  INDEX idx_post             (ed_media_post_id),
  INDEX idx_institute        (ed_media_institute_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_reactions
 * ─────────────────────────────────────────────────────────────────────────────
 * Reações (likes, love, haha, etc.) aos posts
 */
const DDL_REACTIONS = `
CREATE TABLE IF NOT EXISTS eduall_feed_reactions (
  ed_reaction_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_reaction_post_id        BIGINT NOT NULL,
  ed_reaction_user_id        BIGINT NOT NULL,
  ed_reaction_institute_code VARCHAR(120) NOT NULL,
  ed_reaction_type           VARCHAR(50) DEFAULT 'heart',
  ed_reaction_created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_reaction     (ed_reaction_post_id, ed_reaction_user_id),
  FOREIGN KEY (ed_reaction_post_id) REFERENCES eduall_feed_posts(ed_post_id) ON DELETE CASCADE,
  INDEX idx_post             (ed_reaction_post_id),
  INDEX idx_user             (ed_reaction_user_id),
  INDEX idx_institute        (ed_reaction_institute_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_comments
 * ─────────────────────────────────────────────────────────────────────────────
 * Comentários nos posts
 */
const DDL_COMMENTS = `
CREATE TABLE IF NOT EXISTS eduall_feed_comments (
  ed_comment_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_comment_code            VARCHAR(80) NOT NULL UNIQUE,
  ed_comment_post_id         BIGINT NOT NULL,
  ed_comment_institute_code  VARCHAR(120) NOT NULL,
  ed_comment_author_id       BIGINT NOT NULL,
  ed_comment_author_name     VARCHAR(200),
  ed_comment_author_avatar   VARCHAR(500),
  ed_comment_author_verified TINYINT(1) DEFAULT 0,
  ed_comment_text            TEXT NOT NULL,
  ed_comment_parent_id       BIGINT NULL,
  ed_comment_liked_count     INT DEFAULT 0,
  ed_comment_created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_comment_updated_at      DATETIME NULL,
  ed_comment_deleted         TINYINT(1) DEFAULT 0,
  
  FOREIGN KEY (ed_comment_post_id) REFERENCES eduall_feed_posts(ed_post_id) ON DELETE CASCADE,
  FOREIGN KEY (ed_comment_parent_id) REFERENCES eduall_feed_comments(ed_comment_id) ON DELETE CASCADE,
  INDEX idx_post             (ed_comment_post_id),
  INDEX idx_author           (ed_comment_author_id),
  INDEX idx_parent           (ed_comment_parent_id),
  INDEX idx_created          (ed_comment_created_at DESC),
  INDEX idx_deleted          (ed_comment_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_comment_likes
 * ─────────────────────────────────────────────────────────────────────────────
 * Likes em comentários
 */
const DDL_COMMENT_LIKES = `
CREATE TABLE IF NOT EXISTS eduall_feed_comment_likes (
  ed_comment_like_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_comment_like_comment_id BIGINT NOT NULL,
  ed_comment_like_user_id    BIGINT NOT NULL,
  ed_comment_like_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_like         (ed_comment_like_comment_id, ed_comment_like_user_id),
  FOREIGN KEY (ed_comment_like_comment_id) REFERENCES eduall_feed_comments(ed_comment_id) ON DELETE CASCADE,
  INDEX idx_comment          (ed_comment_like_comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_stories
 * ─────────────────────────────────────────────────────────────────────────────
 * Stories (status temporários)
 */
const DDL_STORIES = `
CREATE TABLE IF NOT EXISTS eduall_feed_stories (
  ed_story_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_story_code              VARCHAR(80) NOT NULL UNIQUE,
  ed_story_institute_code    VARCHAR(120) NOT NULL,
  ed_story_author_id         BIGINT NOT NULL,
  ed_story_author_name       VARCHAR(200),
  ed_story_author_avatar     VARCHAR(500),
  ed_story_media_src         VARCHAR(500) NOT NULL,
  ed_story_media_cloudinary  VARCHAR(500),
  ed_story_text              VARCHAR(500),
  ed_story_background        VARCHAR(100),
  ed_story_views_count       INT DEFAULT 0,
  ed_story_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_story_expires_at        DATETIME,
  
  INDEX idx_institute        (ed_story_institute_code),
  INDEX idx_author           (ed_story_author_id),
  INDEX idx_expires          (ed_story_expires_at),
  INDEX idx_created          (ed_story_created_at DESC),
  INDEX idx_code             (ed_story_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_story_views
 * ─────────────────────────────────────────────────────────────────────────────
 * Quem viu cada story
 */
const DDL_STORY_VIEWS = `
CREATE TABLE IF NOT EXISTS eduall_feed_story_views (
  ed_story_view_id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_story_view_story_id     BIGINT NOT NULL,
  ed_story_view_user_id      BIGINT NOT NULL,
  ed_story_view_created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_view         (ed_story_view_story_id, ed_story_view_user_id),
  FOREIGN KEY (ed_story_view_story_id) REFERENCES eduall_feed_stories(ed_story_id) ON DELETE CASCADE,
  INDEX idx_story            (ed_story_view_story_id),
  INDEX idx_user             (ed_story_view_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_saves
 * ─────────────────────────────────────────────────────────────────────────────
 * Posts guardados pelos utilizadores
 */
const DDL_SAVES = `
CREATE TABLE IF NOT EXISTS eduall_feed_saves (
  ed_save_id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_save_post_id            BIGINT NOT NULL,
  ed_save_user_id            BIGINT NOT NULL,
  ed_save_institute_code     VARCHAR(120) NOT NULL,
  ed_save_created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_save         (ed_save_post_id, ed_save_user_id),
  FOREIGN KEY (ed_save_post_id) REFERENCES eduall_feed_posts(ed_post_id) ON DELETE CASCADE,
  INDEX idx_user             (ed_save_user_id),
  INDEX idx_post             (ed_save_post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_reports
 * ─────────────────────────────────────────────────────────────────────────────
 * Reportes de posts/comentários impróprios
 */
const DDL_REPORTS = `
CREATE TABLE IF NOT EXISTS eduall_feed_reports (
  ed_report_id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_report_code             VARCHAR(80) NOT NULL UNIQUE,
  ed_report_institute_code   VARCHAR(120) NOT NULL,
  ed_report_type             ENUM('post','comment') DEFAULT 'post',
  ed_report_target_id        BIGINT NOT NULL,
  ed_report_reporter_id      BIGINT NOT NULL,
  ed_report_reason           VARCHAR(500),
  ed_report_status           ENUM('open','reviewing','resolved','dismissed') DEFAULT 'open',
  ed_report_created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_report_resolved_at      DATETIME NULL,
  
  INDEX idx_institute        (ed_report_institute_code),
  INDEX idx_target           (ed_report_target_id),
  INDEX idx_status           (ed_report_status),
  INDEX idx_created          (ed_report_created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_feed_shares
 * ─────────────────────────────────────────────────────────────────────────────
 * Log de partilhas de posts
 */
const DDL_SHARES = `
CREATE TABLE IF NOT EXISTS eduall_feed_shares (
  ed_share_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_share_post_id           BIGINT NOT NULL,
  ed_share_user_id           BIGINT NOT NULL,
  ed_share_institute_code    VARCHAR(120) NOT NULL,
  ed_share_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (ed_share_post_id) REFERENCES eduall_feed_posts(ed_post_id) ON DELETE CASCADE,
  INDEX idx_post             (ed_share_post_id),
  INDEX idx_user             (ed_share_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// ─────────────────────────────────────────────────────────────────────────────
//  INICIALIZAÇÃO DE TABELAS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureFeedTables(req, res) {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = req || { session: { user: {} } };

    await ExecuteQuery(fakeRes, DDL_POSTS,          [], false, { db: 'eduall_feed_posts',          type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_MEDIA,          [], false, { db: 'eduall_feed_media',          type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_REACTIONS,      [], false, { db: 'eduall_feed_reactions',      type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_COMMENTS,       [], false, { db: 'eduall_feed_comments',       type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_COMMENT_LIKES,  [], false, { db: 'eduall_feed_comment_likes',  type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_STORIES,        [], false, { db: 'eduall_feed_stories',        type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_STORY_VIEWS,    [], false, { db: 'eduall_feed_story_views',    type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_SAVES,          [], false, { db: 'eduall_feed_saves',          type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_REPORTS,        [], false, { db: 'eduall_feed_reports',        type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_SHARES,         [], false, { db: 'eduall_feed_shares',         type: 'ddl', data: fakeReq });

    if (res) return res.status(200).json({ success: true, msg: 'Tabelas do feed verificadas.' });
  } catch (e) {
    console.error('[ensureFeedTables]', e.message);
    if (res) return res.status(500).json({ success: false, msg: 'Erro ao criar tabelas do feed.' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS — UTILIDADES
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gera código único — O(1)
 */
function generateCode(prefix = '') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

/**
 * Extrai instituo da sessão — O(1)
 */
function getInstitute(req) {
  return req.session?.user?.eduall_user_session_curentinstitute || '';
}

/**
 * Extrai ID do utilizador da sessão — O(1)
 */
function getUserId(req) {
  return req.session?.user?.eduall_user_session_ID || null;
}

/**
 * Upload para Cloudinary — I/O async
 */
async function uploadToCloudinary(file, { folder = 'feed' }) {
  if (!process.env.CLOUDINARY_NAME || !process.env.CLOUDINARY_KEY)
    throw new Error('Cloudinary não configurado.');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `eduall/${folder}`,
        resource_type: 'auto',
        eager: [{ width: 1024, height: 1024, crop: 'fill' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result?.secure_url || result?.url,
          public_id: result?.public_id,
          width: result?.width,
          height: result?.height,
        });
      }
    );
    stream.end(file.buffer);
  });
}

/**
 * Emite evento real-time — O(1)
 */
function emitToRoom(room, event, data) {
  io.to(room).emit(event, data);
}

/**
 * Formata data — O(1)
 */
function formatDate(dt) {
  return moment(dt).fromNow();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — POSTS
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/posts
 * Criar novo post com media e reações
 */
app.post('/api/feed/posts', uploadMedia, async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const { text, background, feeling, location, audience, author_name, author_avatar, author_verified, school_tag } = req.body;
    const postCode = generateCode('POST_');
    const visibility = audience === 'Apenas eu' ? 'private' : audience === 'Amigos' ? 'friends' : 'public';

    // Upload de media (O(n) onde n = número de ficheiros, mas max 10)
    const mediaList = [];
    if (req.files?.images) {
      for (let i = 0; i < req.files.images.length; i++) {
        const f = req.files.images[i];
        try {
          const uploaded = await uploadToCloudinary(f, { folder: 'feed/posts/images' });
          mediaList.push({ type: 'image', src: uploaded.url, order: i });
        } catch (e) {
          console.error('[uploadMedia]', e.message);
        }
      }
    }
    if (req.files?.video && req.files.video[0]) {
      try {
        const uploaded = await uploadToCloudinary(req.files.video[0], { folder: 'feed/posts/videos' });
        mediaList.push({ type: 'video', src: uploaded.url, order: 0 });
      } catch (e) {
        console.error('[uploadVideo]', e.message);
      }
    }

    // Insere o post — O(1)
    const result = await ExecuteQuery(res, `
      INSERT INTO eduall_feed_posts
        (ed_post_code, ed_post_institute_code, ed_post_author_id, ed_post_author_name, ed_post_author_avatar, 
         ed_post_author_verified, ed_post_text, ed_post_background, ed_post_feeling, ed_post_location, 
         ed_post_visibility, ed_post_school_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [postCode, institute, userId, author_name, author_avatar, author_verified ? 1 : 0, text, background, 
       feeling, location, visibility, school_tag],
      false,
      { db: 'eduall_feed_posts', type: 'insert', data: req }
    );

    const postId = result.insertId;

    // Insere media — O(n)
    for (const m of mediaList) {
      await ExecuteQuery(res, `
        INSERT INTO eduall_feed_media (ed_media_post_id, ed_media_institute_code, ed_media_type, ed_media_src, ed_media_cloudinary_url, ed_media_order)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [postId, institute, m.type, m.src, m.src, m.order],
        false,
        { db: 'eduall_feed_media', type: 'insert', data: req }
      );
    }

    // Audit
    await RegisterAuditAction({
      session: req.session, res, req,
      action: 1, form: 'Feed',
      description: `Criou post ${postCode} (${mediaList.length} media).`
    }).catch(() => null);

    // Real-time
    emitToRoom(`feed_${institute}`, 'post:created', {
      id: postId,
      code: postCode,
      author: { name: author_name, avatar: author_avatar, verified: author_verified },
      text, background, feeling, location, visibility, media: mediaList
    });

    res.status(200).json({ success: true, postId, postCode, media: mediaList });
  } catch (e) {
    console.error('[POST /api/feed/posts]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao criar post.' });
  }
});

/**
 * GET /api/feed/posts
 * Listar posts do feed com paginação e filtros
 */
app.get('/api/feed/posts', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Number(req.query.limit || 20));
    const offset = (page - 1) * limit;
    const tab = req.query.tab || 'foryou'; // foryou, following, groups, favorites, mentions

    // Query base — O(1) com índices
    let where = `WHERE p.ed_post_deleted = 0 AND p.ed_post_institute_code = ?
                 AND (p.ed_post_visibility = 'public' OR p.ed_post_author_id = ?)`;
    let params = [institute, userId];

    // Filtros por tab (simplificado, em produção integrar com graph de relações)
    if (tab === 'favorites') {
      where = `WHERE p.ed_post_deleted = 0 AND p.ed_post_institute_code = ?
               AND p.ed_post_pinned = 1`;
      params = [institute];
    }

    const posts = await ExecuteQuery(res, `
      SELECT p.*, 
             GROUP_CONCAT(CONCAT(m.ed_media_type, '|', m.ed_media_cloudinary_url) ORDER BY m.ed_media_order) AS media_list,
             (SELECT GROUP_CONCAT(r.ed_reaction_type) FROM eduall_feed_reactions r WHERE r.ed_reaction_post_id = p.ed_post_id LIMIT 10) AS reactions_sample,
             (SELECT COUNT(*) FROM eduall_feed_saves s WHERE s.ed_save_post_id = p.ed_post_id AND s.ed_save_user_id = ?) AS is_saved,
             (SELECT ed_reaction_type FROM eduall_feed_reactions r WHERE r.ed_reaction_post_id = p.ed_post_id AND r.ed_reaction_user_id = ? LIMIT 1) AS user_reaction
      FROM eduall_feed_posts p
      LEFT JOIN eduall_feed_media m ON m.ed_media_post_id = p.ed_post_id
      ${where}
      GROUP BY p.ed_post_id
      ORDER BY p.ed_post_pinned DESC, p.ed_post_created_at DESC
      LIMIT ?, ?`,
      [...params, userId, userId, offset, limit],
      true,
      { db: 'eduall_feed_posts', type: 'select', data: req }
    );

    const formatted = (posts || []).map(p => ({
      id: p.ed_post_id,
      code: p.ed_post_code,
      author: {
        name: p.ed_post_author_name,
        avatar: p.ed_post_author_avatar,
        verified: p.ed_post_author_verified
      },
      text: p.ed_post_text,
      background: p.ed_post_background,
      feeling: p.ed_post_feeling,
      location: p.ed_post_location,
      visibility: p.ed_post_visibility,
      schoolTag: p.ed_post_school_tag,
      media: p.media_list ? p.media_list.split(',').map(m => {
        const [type, src] = m.split('|');
        return { type, src };
      }) : [],
      reactionsCount: p.ed_post_reactions_count,
      commentsCount: p.ed_post_comments_count,
      sharesCount: p.ed_post_shares_count,
      userReaction: p.user_reaction,
      isSaved: Number(p.is_saved) > 0,
      time: formatDate(p.ed_post_created_at)
    }));

    res.status(200).json({ success: true, posts: formatted, page, limit });
  } catch (e) {
    console.error('[GET /api/feed/posts]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar posts.' });
  }
});

/**
 * PUT /api/feed/posts/:postId
 * Editar post
 */
app.put('/api/feed/posts/:postId', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const { text } = req.body;
    const postId = Number(req.params.postId);

    // Verifica propriedade — O(1)
    const post = await ExecuteQuery(res, `
      SELECT * FROM eduall_feed_posts WHERE ed_post_id = ? AND ed_post_institute_code = ? LIMIT 1`,
      [postId, institute], true, { db: 'eduall_feed_posts', type: 'select', data: req }
    );

    if (!post || post[0].ed_post_author_id !== userId)
      return res.status(403).json({ success: false, msg: 'Não é dono deste post.' });

    // Atualiza — O(1)
    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_text = ?, ed_post_updated_at = NOW()
      WHERE ed_post_id = ? AND ed_post_institute_code = ?`,
      [text, postId, institute], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    // Real-time
    emitToRoom(`feed_${institute}`, 'post:updated', { id: postId, text });

    res.status(200).json({ success: true, msg: 'Post atualizado.' });
  } catch (e) {
    console.error('[PUT /api/feed/posts/:postId]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao atualizar post.' });
  }
});

/**
 * DELETE /api/feed/posts/:postId
 * Apagar post
 */
app.delete('/api/feed/posts/:postId', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const postId = Number(req.params.postId);

    const post = await ExecuteQuery(res, `
      SELECT * FROM eduall_feed_posts WHERE ed_post_id = ? AND ed_post_institute_code = ? LIMIT 1`,
      [postId, institute], true, { db: 'eduall_feed_posts', type: 'select', data: req }
    );

    if (!post || post[0].ed_post_author_id !== userId)
      return res.status(403).json({ success: false, msg: 'Não é dono deste post.' });

    // Soft delete — O(1)
    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_deleted = 1 WHERE ed_post_id = ?`,
      [postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    // Real-time
    emitToRoom(`feed_${institute}`, 'post:deleted', { id: postId });

    res.status(200).json({ success: true, msg: 'Post apagado.' });
  } catch (e) {
    console.error('[DELETE /api/feed/posts/:postId]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao apagar post.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — REAÇÕES
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/posts/:postId/reaction
 * Adicionar/atualizar reação
 */ 
app.post('/api/feed/posts/:postId/reaction', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const postId = Number(req.params.postId);
    const { type } = req.body; // heart, thumbs-up, haha, wow, sad, angry

    // Verifica se post existe — O(1)
    const post = await ExecuteQuery(res, `
      SELECT ed_post_id FROM eduall_feed_posts WHERE ed_post_id = ? LIMIT 1`,
      [postId], true, { db: 'eduall_feed_posts', type: 'select', data: req }
    );

    if (!post)
      return res.status(404).json({ success: false, msg: 'Post não encontrado.' });

    // Insere ou atualiza — O(1) com UNIQUE KEY
    await ExecuteQuery(res, `
      INSERT INTO eduall_feed_reactions (ed_reaction_post_id, ed_reaction_user_id, ed_reaction_institute_code, ed_reaction_type)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE ed_reaction_type = VALUES(ed_reaction_type)`,
      [postId, userId, institute, type], false, { db: 'eduall_feed_reactions', type: 'insert', data: req }
    );

    // Atualiza contador — O(1)
    const count = await ExecuteQuery(res, `
      SELECT COUNT(*) AS cnt FROM eduall_feed_reactions WHERE ed_reaction_post_id = ?`,
      [postId], true, { db: 'eduall_feed_reactions', type: 'select', data: req }
    );

    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_reactions_count = ? WHERE ed_post_id = ?`,
      [count[0].cnt, postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    // Real-time
    emitToRoom(`feed_${institute}`, 'post:reaction', { postId, type, count: count[0].cnt });

    res.status(200).json({ success: true, type, count: count[0].cnt });
  } catch (e) {
    console.error('[POST /api/feed/posts/:postId/reaction]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao adicionar reação.' });
  }
});

/**
 * DELETE /api/feed/posts/:postId/reaction
 * Remover reação
 */
app.delete('/api/feed/posts/:postId/reaction', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const postId = Number(req.params.postId);

    await ExecuteQuery(res, `
      DELETE FROM eduall_feed_reactions WHERE ed_reaction_post_id = ? AND ed_reaction_user_id = ?`,
      [postId, userId], false, { db: 'eduall_feed_reactions', type: 'delete', data: req }
    );

    const count = await ExecuteQuery(res, `
      SELECT COUNT(*) AS cnt FROM eduall_feed_reactions WHERE ed_reaction_post_id = ?`,
      [postId], true, { db: 'eduall_feed_reactions', type: 'select', data: req }
    );

    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_reactions_count = ? WHERE ed_post_id = ?`,
      [count[0].cnt, postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    emitToRoom(`feed_${institute}`, 'post:reaction-removed', { postId, count: count[0].cnt });

    res.status(200).json({ success: true, count: count[0].cnt });
  } catch (e) {
    console.error('[DELETE /api/feed/posts/:postId/reaction]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao remover reação.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — COMENTÁRIOS
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/posts/:postId/comments
 * Adicionar comentário
 */
app.post('/api/feed/posts/:postId/comments', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const postId = Number(req.params.postId);
    const { text, author_name, author_avatar, author_verified, parentCommentId } = req.body;

    const commentCode = generateCode('COM_');

    // Insere comentário — O(1)
    const result = await ExecuteQuery(res, `
      INSERT INTO eduall_feed_comments
        (ed_comment_code, ed_comment_post_id, ed_comment_institute_code, ed_comment_author_id, 
         ed_comment_author_name, ed_comment_author_avatar, ed_comment_author_verified, ed_comment_text, ed_comment_parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [commentCode, postId, institute, userId, author_name, author_avatar, author_verified ? 1 : 0, text, parentCommentId || null],
      false,
      { db: 'eduall_feed_comments', type: 'insert', data: req }
    );

    const commentId = result.insertId;

    // Incrementa contador — O(1)
    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_comments_count = ed_post_comments_count + 1 WHERE ed_post_id = ?`,
      [postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    // Real-time
    emitToRoom(`post_${postId}`, 'comment:added', {
      id: commentId, code: commentCode, postId, text, author: { name: author_name, avatar: author_avatar, verified: author_verified },
      parentId: parentCommentId, time: 'Agora mesmo'
    });

    res.status(200).json({ success: true, commentId, commentCode });
  } catch (e) {
    console.error('[POST /api/feed/posts/:postId/comments]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao adicionar comentário.' });
  }
});

/**
 * GET /api/feed/posts/:postId/comments
 * Listar comentários de um post
 */
app.get('/api/feed/posts/:postId/comments', async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const userId = getUserId(req);

    const comments = await ExecuteQuery(res, `
      SELECT c.*,
             (SELECT COUNT(*) FROM eduall_feed_comment_likes cl WHERE cl.ed_comment_like_comment_id = c.ed_comment_id) AS liked_count,
             (SELECT COUNT(*) FROM eduall_feed_comment_likes cl WHERE cl.ed_comment_like_comment_id = c.ed_comment_id AND cl.ed_comment_like_user_id = ?) AS user_liked
      FROM eduall_feed_comments c
      WHERE c.ed_comment_post_id = ? AND c.ed_comment_deleted = 0
      ORDER BY c.ed_comment_parent_id IS NOT NULL, c.ed_comment_created_at ASC
      LIMIT 500`,
      [userId, postId], true, { db: 'eduall_feed_comments', type: 'select', data: req }
    );

    const formatted = (comments || []).map(c => ({
      id: c.ed_comment_id, code: c.ed_comment_code, author: { name: c.ed_comment_author_name, avatar: c.ed_comment_author_avatar, verified: c.ed_comment_author_verified },
      text: c.ed_comment_text, liked: Number(c.user_liked) > 0, likedCount: c.liked_count, time: formatDate(c.ed_comment_created_at)
    }));

    res.status(200).json({ success: true, comments: formatted });
  } catch (e) {
    console.error('[GET /api/feed/posts/:postId/comments]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar comentários.' });
  }
});

/**
 * DELETE /api/feed/comments/:commentId
 * Apagar comentário
 */
app.delete('/api/feed/comments/:commentId', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const commentId = Number(req.params.commentId);

    const comment = await ExecuteQuery(res, `
      SELECT * FROM eduall_feed_comments WHERE ed_comment_id = ? LIMIT 1`,
      [commentId], true, { db: 'eduall_feed_comments', type: 'select', data: req }
    );

    if (!comment || comment[0].ed_comment_author_id !== userId)
      return res.status(403).json({ success: false, msg: 'Não é dono deste comentário.' });

    await ExecuteQuery(res, `
      UPDATE eduall_feed_comments SET ed_comment_deleted = 1 WHERE ed_comment_id = ?`,
      [commentId], false, { db: 'eduall_feed_comments', type: 'update', data: req }
    );

    const postId = comment[0].ed_comment_post_id;
    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_comments_count = GREATEST(0, ed_post_comments_count - 1) WHERE ed_post_id = ?`,
      [postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    emitToRoom(`post_${postId}`, 'comment:deleted', { id: commentId });

    res.status(200).json({ success: true, msg: 'Comentário apagado.' });
  } catch (e) {
    console.error('[DELETE /api/feed/comments/:commentId]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao apagar comentário.' });
  }
});

/**
 * POST /api/feed/comments/:commentId/like
 * Like em comentário
 */
app.post('/api/feed/comments/:commentId/like', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const commentId = Number(req.params.commentId);

    await ExecuteQuery(res, `
      INSERT IGNORE INTO eduall_feed_comment_likes (ed_comment_like_comment_id, ed_comment_like_user_id)
      VALUES (?, ?)`,
      [commentId, userId], false, { db: 'eduall_feed_comment_likes', type: 'insert', data: req }
    );

    const count = await ExecuteQuery(res, `
      SELECT COUNT(*) AS cnt FROM eduall_feed_comment_likes WHERE ed_comment_like_comment_id = ?`,
      [commentId], true, { db: 'eduall_feed_comment_likes', type: 'select', data: req }
    );

    await ExecuteQuery(res, `
      UPDATE eduall_feed_comments SET ed_comment_liked_count = ? WHERE ed_comment_id = ?`,
      [count[0].cnt, commentId], false, { db: 'eduall_feed_comments', type: 'update', data: req }
    );

    res.status(200).json({ success: true, count: count[0].cnt });
  } catch (e) {
    console.error('[POST /api/feed/comments/:commentId/like]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao adicionar like.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — STORIES
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/stories
 * Criar novo story
 */
app.post('/api/feed/stories', uploadMedia, async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    if (!institute || !userId)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const { text, background, author_name, author_avatar } = req.body;
    const storyCode = generateCode('STORY_');

    let mediaSrc = '';
    if (req.files?.images && req.files.images[0]) {
      const up = await uploadToCloudinary(req.files.images[0], { folder: 'feed/stories' });
      mediaSrc = up.url;
    } else if (req.files?.video && req.files.video[0]) {
      const up = await uploadToCloudinary(req.files.video[0], { folder: 'feed/stories' });
      mediaSrc = up.url;
    }

    if (!mediaSrc)
      return res.status(400).json({ success: false, msg: 'Story requer media.' });

    // Insere — O(1)
    const result = await ExecuteQuery(res, `
      INSERT INTO eduall_feed_stories
        (ed_story_code, ed_story_institute_code, ed_story_author_id, ed_story_author_name, ed_story_author_avatar, 
         ed_story_media_src, ed_story_media_cloudinary, ed_story_text, ed_story_background, ed_story_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [storyCode, institute, userId, author_name, author_avatar, mediaSrc, mediaSrc, text, background],
      false,
      { db: 'eduall_feed_stories', type: 'insert', data: req }
    );

    const storyId = result.insertId;

    // Real-time
    emitToRoom(`feed_${institute}`, 'story:created', {
      id: storyId, code: storyCode, author: { name: author_name, avatar: author_avatar },
      media: mediaSrc, text, background
    });

    res.status(200).json({ success: true, storyId, storyCode });
  } catch (e) {
    console.error('[POST /api/feed/stories]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao criar story.' });
  }
});

/**
 * GET /api/feed/stories
 * Listar stories ativas
 */
app.get('/api/feed/stories', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);

    const stories = await ExecuteQuery(res, `
      SELECT s.*,
             (SELECT COUNT(DISTINCT ed_story_view_user_id) FROM eduall_feed_story_views sv WHERE sv.ed_story_view_story_id = s.ed_story_id) AS views_count,
             (SELECT COUNT(*) FROM eduall_feed_story_views sv WHERE sv.ed_story_view_story_id = s.ed_story_id AND sv.ed_story_view_user_id = ?) AS user_viewed
      FROM eduall_feed_stories s
      WHERE s.ed_story_institute_code = ? AND s.ed_story_expires_at > NOW()
      ORDER BY s.ed_story_created_at DESC LIMIT 100`,
      [userId, institute], true, { db: 'eduall_feed_stories', type: 'select', data: req }
    );

    const formatted = (stories || []).map(s => ({
      id: s.ed_story_id, code: s.ed_story_code, author: { name: s.ed_story_author_name, avatar: s.ed_story_author_avatar },
      media: s.ed_story_media_cloudinary, text: s.ed_story_text, background: s.ed_story_background,
      viewsCount: s.views_count, viewed: Number(s.user_viewed) > 0
    }));

    res.status(200).json({ success: true, stories: formatted });
  } catch (e) {
    console.error('[GET /api/feed/stories]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar stories.' });
  }
});

/**
 * POST /api/feed/stories/:storyId/view
 * Registar visualização de story
 */
app.post('/api/feed/stories/:storyId/view', async (req, res) => {
  try {
    const userId = getUserId(req);
    const storyId = Number(req.params.storyId);

    await ExecuteQuery(res, `
      INSERT IGNORE INTO eduall_feed_story_views (ed_story_view_story_id, ed_story_view_user_id)
      VALUES (?, ?)`,
      [storyId, userId], false, { db: 'eduall_feed_story_views', type: 'insert', data: req }
    );

    const count = await ExecuteQuery(res, `
      SELECT COUNT(DISTINCT ed_story_view_user_id) AS cnt FROM eduall_feed_story_views WHERE ed_story_view_story_id = ?`,
      [storyId], true, { db: 'eduall_feed_story_views', type: 'select', data: req }
    );

    await ExecuteQuery(res, `
      UPDATE eduall_feed_stories SET ed_story_views_count = ? WHERE ed_story_id = ?`,
      [count[0].cnt, storyId], false, { db: 'eduall_feed_stories', type: 'update', data: req }
    );

    res.status(200).json({ success: true });
  } catch (e) {
    console.error('[POST /api/feed/stories/:storyId/view]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao registar visualização.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — GUARDAR / FAVORITES
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/posts/:postId/save
 * Guardar post
 */
app.post('/api/feed/posts/:postId/save', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    const postId = Number(req.params.postId);

    await ExecuteQuery(res, `
      INSERT IGNORE INTO eduall_feed_saves (ed_save_post_id, ed_save_user_id, ed_save_institute_code)
      VALUES (?, ?, ?)`,
      [postId, userId, institute], false, { db: 'eduall_feed_saves', type: 'insert', data: req }
    );

    const count = await ExecuteQuery(res, `
      SELECT COUNT(*) AS cnt FROM eduall_feed_saves WHERE ed_save_post_id = ?`,
      [postId], true, { db: 'eduall_feed_saves', type: 'select', data: req }
    );

    await ExecuteQuery(res, `
      UPDATE eduall_feed_posts SET ed_post_saved_count = ? WHERE ed_post_id = ?`,
      [count[0].cnt, postId], false, { db: 'eduall_feed_posts', type: 'update', data: req }
    );

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, msg: 'Erro ao guardar post.' });
  }
});

/**
 * DELETE /api/feed/posts/:postId/save
 * Remover post guardado
 */
app.delete('/api/feed/posts/:postId/save', async (req, res) => {
  try {
    const userId = getUserId(req);
    const postId = Number(req.params.postId);

    await ExecuteQuery(res, `
      DELETE FROM eduall_feed_saves WHERE ed_save_post_id = ? AND ed_save_user_id = ?`,
      [postId, userId], false, { db: 'eduall_feed_saves', type: 'delete', data: req }
    );

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, msg: 'Erro ao remover save.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS — REPORTES
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/feed/report
 * Reportar post ou comentário
 */
app.post('/api/feed/report', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const userId = getUserId(req);
    const { type, targetId, reason } = req.body; // type: 'post' ou 'comment'

    const reportCode = generateCode('REP_');

    await ExecuteQuery(res, `
      INSERT INTO eduall_feed_reports
        (ed_report_code, ed_report_institute_code, ed_report_type, ed_report_target_id, ed_report_reporter_id, ed_report_reason)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [reportCode, institute, type, targetId, userId, reason],
      false,
      { db: 'eduall_feed_reports', type: 'insert', data: req }
    );

    res.status(200).json({ success: true, msg: 'Reportado com sucesso. Obrigado pelo feedback.' });
  } catch (e) {
    res.status(500).json({ success: false, msg: 'Erro ao reportar.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO — REAL-TIME
//  ═══════════════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log(`[Socket] Novo cliente: ${socket.id}`);

  // Junta-se a sala do feed
  socket.on('feed:join', (data) => {
    const { institute } = data;
    socket.join(`feed_${institute}`);
    socket.join(`user_${data.userId}`);
    console.log(`[Socket] ${socket.id} entrou em feed_${institute}`);
  });

  // Junta-se a sala de post (para comentários real-time)
  socket.on('post:join', (data) => {
    const { postId } = data;
    socket.join(`post_${postId}`);
  });

  // Typing indicator
  socket.on('user:typing', (data) => {
    io.to(`post_${data.postId}`).emit('user:typing', { userId: data.userId, userName: data.userName });
  });

  // Desconexão
  socket.on('disconnect', () => {
    console.log(`[Socket] Desconexão: ${socket.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRON JOBS — LIMPEZA E MANUTENÇÃO
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * Limpa stories expirados — Executa a cada 1 hora
 */
cron.schedule('0 * * * *', async () => {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = { session: { user: {} } };

    await ExecuteQuery(fakeRes, `
      DELETE FROM eduall_feed_stories WHERE ed_story_expires_at <= NOW()`,
      [], false, { db: 'eduall_feed_stories', type: 'delete', data: fakeReq }
    );

    console.log('[Cron] Stories expirados removidos.');
  } catch (e) {
    console.error('[Cron] Erro ao limpar stories:', e.message);
  }
});

/**
 * Atualiza contadores de posts — Executa a cada 30 min
 */
cron.schedule('*/30 * * * *', async () => {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = { session: { user: {} } };

    // Atualiza contadores de reações
    await ExecuteQuery(fakeRes, `
      UPDATE eduall_feed_posts p
      SET ed_post_reactions_count = (SELECT COUNT(*) FROM eduall_feed_reactions r WHERE r.ed_reaction_post_id = p.ed_post_id)
      WHERE ed_post_deleted = 0`,
      [], false, { db: 'eduall_feed_posts', type: 'update', data: fakeReq }
    );

    console.log('[Cron] Contadores atualizados.');
  } catch (e) {
    console.error('[Cron] Erro ao atualizar contadores:', e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
//  ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.FEED_PORT || 5000;

app.get('/api/setup/ensure-feed-tables', async (req, res) => {
  await ensureFeedTables(req, res);
});

server.listen(PORT, async () => {
  console.log(`\n✓ Feed Backend ativo em porta ${PORT}`);
  const fakeReq = { session: { user: {} } };
  const fakeRes = { status: () => ({ json: () => {} }) };
  await ensureFeedTables(fakeReq, fakeRes);
});

module.exports = { app, server, io, ensureFeedTables }; 