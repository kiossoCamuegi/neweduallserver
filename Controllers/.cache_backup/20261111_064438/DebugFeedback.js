const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;  // ← NOVO: fs.promises para async
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

const FEEDBACK_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `feedback:list:${instituteCode}`,
  single: (id, instituteCode) => `feedback:single:${id}:${instituteCode}`,
  all: () => "feedback:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateFeedbackFields = (body) => {
  const errors = [];

  if (!body.type || body.type.trim() === "")
    errors.push("Tipo de feedback é obrigatório.");

  if (!body.description || body.description.trim() === "")
    errors.push("Descrição do feedback é obrigatória.");

  if (body.description && body.description.trim().length < 5)
    errors.push("Descrição deve ter pelo menos 5 caracteres.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchFeedbacks = async (req, res, instituteCode) => {
  const query = `
    SELECT
      f.*,
      u.ed_user_account_name,
      i.ed_institute_name,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'file_id', ff.ed_debug_feedback_file_id,
            'url', ff.ed_debug_feedback_file_url,
            'public_id', ff.ed_debug_feedback_file_public_id,
            'type', ff.ed_debug_feedback_file_type
          )
        ),
        JSON_ARRAY()
      ) AS files
    FROM eduall_debug_feedbacks f
    JOIN eduall_user_accounts u
      ON f.ed_debug_feedback_user_id = u.ed_user_account_id
    JOIN eduall_institutes i
      ON f.ed_debug_feedback_institute_code = i.ed_institute_code
    LEFT JOIN eduall_debug_feedback_files ff
      ON f.ed_debug_feedback_id = ff.ed_debug_feedback_file_feedback_id
    WHERE f.ed_debug_feedback_deleted = 0
      AND f.ed_debug_feedback_institute_code = ?
    GROUP BY f.ed_debug_feedback_id
    ORDER BY f.ed_debug_feedback_created_at DESC
  `;

  let rows = await ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_debug_feedbacks",
    type: "select",
    data: req,
  });

  // Converter string JSON → array (caso o driver MySQL devolva como string)
  rows = rows.map((r) => ({
    ...r,
    files: typeof r.files === "string" ? JSON.parse(r.files) : r.files,
  }));

  return rows;
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshFeedbackCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchFeedbacks(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, FEEDBACK_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todos os feedbacks com ficheiros agregados
 */
const GetFeedbacks = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetFeedbacks demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json({
        success: true,
        msg: "Feedbacks carregados com sucesso.",
        data: cached,
      });
    }

    const rows = await FetchFeedbacks(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, FEEDBACK_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetFeedbacks demorou ${duration}ms (${cacheKey})`);

    res.status(200).json({
      success: true,
      msg: "Feedbacks carregados com sucesso.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Erro ao carregar feedbacks.",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter feedback individual com ficheiros
 */
const GetSingleFeedback = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleFeedback demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json({
        success: true,
        msg: "Feedback carregado com sucesso.",
        data: cached,
      });
    }

    const query = `
      SELECT
        f.*,
        u.ed_user_account_name,
        i.ed_institute_name,
        COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'file_id', ff.ed_debug_feedback_file_id,
              'url', ff.ed_debug_feedback_file_url,
              'public_id', ff.ed_debug_feedback_file_public_id,
              'type', ff.ed_debug_feedback_file_type
            )
          ),
          JSON_ARRAY()
        ) AS files
      FROM eduall_debug_feedbacks f
      JOIN eduall_user_accounts u
        ON f.ed_debug_feedback_user_id = u.ed_user_account_id
      JOIN eduall_institutes i
        ON f.ed_debug_feedback_institute_code = i.ed_institute_code
      LEFT JOIN eduall_debug_feedback_files ff
        ON f.ed_debug_feedback_id = ff.ed_debug_feedback_file_feedback_id
      WHERE f.ed_debug_feedback_deleted = 0
        AND f.ed_debug_feedback_id = ?
        AND f.ed_debug_feedback_institute_code = ?
      GROUP BY f.ed_debug_feedback_id
    `;

    const PARAMS = [ID, instituteCode];
    let rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_debug_feedbacks",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, msg: "Feedback não encontrado." });

    rows = rows.map((r) => ({
      ...r,
      files: typeof r.files === "string" ? JSON.parse(r.files) : r.files,
    }));

    const result = rows[0];
    await Cache.eduallSet(cacheKey, result, FEEDBACK_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetSingleFeedback demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json({
      success: true,
      msg: "Feedback carregado com sucesso.",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Erro ao buscar feedback.",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar feedback com upload de múltiplos ficheiros
 */
const RegisterFeedback = async (req, res) => {
  try {
    const { type, description } = req.body;
    const userId = req.session.user.eduall_user_session_ID;
    let instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    // Fallback se instituto não estiver na sessão
    if (!instituteCode || instituteCode.trim() === "") {
      instituteCode = `INST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Validações
    const errors = ValidateFeedbackFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Inserir feedback base
    const query = `
      INSERT INTO eduall_debug_feedbacks (
        ed_debug_feedback_type,
        ed_debug_feedback_description,
        ed_debug_feedback_user_id,
        ed_debug_feedback_institute_code
      ) VALUES (?, ?, ?, ?)
    `;
    const PARAMS = [type.trim(), description.trim(), userId, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_debug_feedbacks",
      type: "insert",
      data: req,
    });

    const feedbackId = rows.insertId;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterFeedback: feedback ID ${feedbackId} criado`);

    // Upload de arquivos (se existirem)
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const cloudinaryResult = await cloudinary.uploader.upload(file.path, {
            folder: "eduall_feedbacks",
            resource_type: "auto",
          });

          await ExecuteQuery(
            res,
            `INSERT INTO eduall_debug_feedback_files (
              ed_debug_feedback_file_feedback_id,
              ed_debug_feedback_file_url,
              ed_debug_feedback_file_public_id,
              ed_debug_feedback_file_type
            ) VALUES (?, ?, ?, ?)`,
            [feedbackId, cloudinaryResult.secure_url, cloudinaryResult.public_id, file.mimetype],
            false,
            { db: "eduall_debug_feedback_files", type: "insert", data: req }
          );

          uploadedFiles.push({
            fileName: file.originalname,
            url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id,
          });

          // Apagar ficheiro local após upload bem-sucedido (async, não bloqueia)
          try {
            await fsPromises.unlink(file.path);
          } catch (_) {
            // Ficheiro já não existe, ignore
          }
        } catch (uploadError) {
          console.error(`Erro ao fazer upload de ${file.originalname}:`, uploadError.message);
          // Continuar com o próximo ficheiro em caso de erro
        }
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Feedback",
      description: `Registou feedback/erro (ID ${feedbackId}) do tipo ${type.trim()} com ${uploadedFiles.length} ficheiro(s)`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterFeedback: ${uploadedFiles.length} ficheiro(s) enviado(s) para Cloudinary`
    );
    await RefreshFeedbackCache(req, res, instituteCode);

    res.status(201).json({
      success: true,
      msg: "Feedback registado com sucesso.",
      data: { feedbackId, uploadedFiles },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Erro ao registar feedback.",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar feedback
 */
const DeleteFeedback = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_debug_feedback_id FROM eduall_debug_feedbacks
      WHERE ed_debug_feedback_deleted = 0
        AND ed_debug_feedback_id = ?
        AND ed_debug_feedback_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_debug_feedbacks",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Feedback não encontrado ou já foi removido.",
        });

    // Soft delete
    const query = `
      UPDATE eduall_debug_feedbacks
      SET ed_debug_feedback_deleted = 1
      WHERE ed_debug_feedback_deleted = 0
        AND ed_debug_feedback_id = ?
        AND ed_debug_feedback_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_debug_feedbacks",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Feedback",
      description: `Eliminou feedback (ID ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteFeedback: feedback ${ID} eliminado`);
    await RefreshFeedbackCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      msg: "Feedback removido com sucesso.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Erro ao apagar feedback.",
      error: error.message,
    });
  }
};

module.exports = {
  GetFeedbacks,
  GetSingleFeedback,
  RegisterFeedback,
  DeleteFeedback,
};