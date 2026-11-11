// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
 /* -------------------------------------------------------------------------- */
/*                           NEWS VIDEOS CONTROLLER                            */
/* -------------------------------------------------------------------------- */

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* -------------------------------------------------------------------------- */
/*     FUNÇÃO INTERNA — Garante que as tabelas necessárias existem            */
/* -------------------------------------------------------------------------- */
let _newsTablesReady = false; // CACHE-OPT: CREATE TABLE só uma vez por processo
async function EnsureNewsTables() {
  if (_newsTablesReady) return;
  try {
    /* -------------------- Tabela principal das notícias -------------------- */
    await ExecuteQuery(
      null,
      `
      CREATE TABLE IF NOT EXISTS eduall_news_videos (
        ed_news_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_news_title VARCHAR(255) NOT NULL,
        ed_news_description TEXT,
        ed_news_video_link VARCHAR(500) NOT NULL,
        ed_news_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ed_news_deleted TINYINT(1) DEFAULT 0
      );
      `
    );

    /* ----------- Tabela que registra se o usuário já viu a notícia ----------- */
    await ExecuteQuery(
      null,
      `
      CREATE TABLE IF NOT EXISTS eduall_news_views (
        ed_view_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_view_user_id INT NOT NULL,
        ed_view_news_id INT NOT NULL,
        ed_view_seen TINYINT(1) DEFAULT 0,
        ed_view_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_news (ed_view_user_id, ed_view_news_id)
      );
      `
    );
    _newsTablesReady = true;
  } catch (err) {
    console.error("Erro ao garantir tabelas de novidades:", err.message);
  }
}

/* -------------------------------------------------------------------------- */
/*                      1. LISTAR NOVIDADES + ESTADO                          */
/* -------------------------------------------------------------------------- */

const GetNewsVideos = async (req, res) => {
  try {
    await EnsureNewsTables();

    const userId = req.session.user.eduall_user_session_ID;

    const query = `
      SELECT
        nv.*,
        COALESCE(v.ed_view_seen, 0) AS seen
      FROM eduall_news_videos nv
      LEFT JOIN eduall_news_views v
        ON v.ed_view_news_id = nv.ed_news_id
       AND v.ed_view_user_id = ?
      WHERE nv.ed_news_deleted = 0
      ORDER BY nv.ed_news_created_at DESC
    `;

    const rows = await ExecuteQuery(res, query, [userId], true);

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Erro ao carregar novidades",
      error: err.message,
    });
  }
};

/* -------------------------------------------------------------------------- */
/*                           2. REGISTRAR NOVIDADE                            */
/* -------------------------------------------------------------------------- */

const RegisterNewsVideo = async (req, res) => {
  try {
    await EnsureNewsTables();

    const { title, description, video_link } = req.body;

    const query = `
      INSERT INTO eduall_news_videos
        (ed_news_title, ed_news_description, ed_news_video_link)
      VALUES (?, ?, ?)
    `;

    const params = [title, description, video_link];

    const rows = await ExecuteQuery(res, query, params, false);

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Novidades",
      description: `Registrou uma nova novidade em vídeo: ${title}`,
    });

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Erro ao registrar novidade",
      error: err.message,
    });
  }
};

/* -------------------------------------------------------------------------- */
/*                            3. MARCAR COMO VISTA                            */
/* -------------------------------------------------------------------------- */

const MarkNewsAsSeen = async (req, res) => {
  try {
    await EnsureNewsTables();

    const { ID } = req.params;
    const userId = req.session.user.eduall_user_session_ID;

    const query = `
      INSERT INTO eduall_news_views
        (ed_view_user_id, ed_view_news_id, ed_view_seen)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE
        ed_view_seen = 1,
        ed_view_date = NOW()
    `;

    const params = [userId, ID];

    const rows = await ExecuteQuery(res, query, params, false);

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Novidades",
      description: `Marcou como vista a novidade ${ID}`,
    });

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Erro ao marcar novidade como vista",
      error: err.message,
    });
  }
};

/* -------------------------------------------------------------------------- */
/*       4. OBTER A NOTÍCIA MAIS RECENTE QUE O USUÁRIO AINDA NÃO VIU          */
/* -------------------------------------------------------------------------- */

const GetLatestUnseenNews = async (req, res) => {
  try {
    await EnsureNewsTables();

    const userId = req.session.user.eduall_user_session_ID;

    const query = `
      SELECT 
        nv.*
      FROM eduall_news_videos nv
      LEFT JOIN eduall_news_views v
        ON v.ed_view_news_id = nv.ed_news_id
       AND v.ed_view_user_id = ?
      WHERE nv.ed_news_deleted = 0
        AND (v.ed_view_seen IS NULL OR v.ed_view_seen = 0)
      ORDER BY nv.ed_news_created_at DESC
      LIMIT 1
    `;

    const rows = await ExecuteQuery(res, query, [userId], true);

    return res.status(200).json({
      success: true,
      data: rows.length ? rows[0] : null
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: "Erro ao procurar novidade não vista",
      error: err.message,
    });
  }
};

/* -------------------------------------------------------------------------- */
/*                                 EXPORTAR                                   */
/* -------------------------------------------------------------------------- */

module.exports = {
  GetNewsVideos,
  RegisterNewsVideo,
  MarkNewsAsSeen,
  GetLatestUnseenNews
};
