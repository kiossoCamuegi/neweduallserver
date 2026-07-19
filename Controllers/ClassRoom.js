const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const CLASSROOM_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `classroom:list:${instituteCode}`,
  single: (id, instituteCode) => `classroom:single:${id}:${instituteCode}`,
  all: () => "classroom:*",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const normalizeClassroomTitle = (title) => {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateClassroomFields = (body) => {
  const errors = [];

  if (!body.title || body.title.trim() === "")
    errors.push("Título da sala é obrigatório.");

  if (body.title && body.title.trim().length < 2)
    errors.push("Título da sala deve ter pelo menos 2 caracteres.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchClassrooms = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_classrooms
    WHERE ed_classroom_deleted = 0
      AND ed_classroom_institute_code = ?
    ORDER BY ed_classroom_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_classrooms",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshClassroomCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchClassrooms(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, CLASSROOM_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as salas
 */
const GetClassroom = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetClassroom demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchClassrooms(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, CLASSROOM_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetClassroom demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar salas!",
        error: error.message,
      });
  }
};

/**
 * GET SINGLE — Obter uma sala individual
 */
const GetSingleClassroom = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleClassroom demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_classrooms
      WHERE ed_classroom_deleted = 0
        AND ed_classroom_id = ?
        AND ed_classroom_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_classrooms",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Sala não encontrada." });

    await Cache.eduallSet(cacheKey, rows, CLASSROOM_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleClassroom demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar sala!",
        error: error.message,
      });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar sala (single ou bulk)
 */
const RegisterClassRoom = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        msg: "Instituição não encontrada na sessão.",
      });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];

    if (!items.length) {
      return res.status(400).json({
        success: false,
        msg: "Nenhuma sala enviada.",
      });
    }

    // ── Inserção de uma sala ─────────────────────────────────────────────────
    const insertClassroom = async (payload) => {
      const title = String(payload.title || "").trim();
      const description = String(payload.description || "");

      // Validações
      const errors = ValidateClassroomFields({ title, description });
      if (errors.length > 0) {
        return { success: false, status: 422, msg: errors.join(" ") };
      }

      // Verificar duplicação (ignora espaços e case)
      const checkQuery = `
        SELECT ed_classroom_id
        FROM eduall_classrooms
        WHERE REPLACE(LOWER(TRIM(ed_classroom_title)), ' ', '') = REPLACE(LOWER(TRIM(?)), ' ', '')
          AND ed_classroom_institute_code = ?
          AND ed_classroom_deleted = 0
      `;

      const existing = await ExecuteQuery(
        res,
        checkQuery,
        [title, instituteCode],
        true,
        { db: "eduall_classrooms", type: "select", data: req }
      );

      if (existing && existing.length > 0) {
        return {
          success: false,
          status: 409,
          msg: "Já existe uma sala com este nome (verifique espaços ou letras maiúsculas/minúsculas).",
        };
      }

      const insertQuery = `
        INSERT INTO eduall_classrooms (
          ed_classroom_title,
          ed_classroom_code,
          ed_classroom_description,
          ed_classroom_institute_code
        ) VALUES (?, ?, ?, ?)
      `;

      const code = payload.code ?? null;

      const rows = await ExecuteQuery(res, insertQuery, [title, code, description, instituteCode], false, {
        db: "eduall_classrooms",
        type: "insert",
        data: req,
      });

      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Salas da instituição",
        description: `Registrou sala (${title})`,
      });

      return { success: true, status: 200, rows };
    };

    // ── Single vs Bulk ───────────────────────────────────────────────────────
    const isBulk = Array.isArray(req.body?.items);

    if (!isBulk) {
      const result = await insertClassroom(req.body);
      if (!result.success) {
        return res.status(result.status || 400).json({
          status: result.status || 400,
          success: false,
          msg: result.msg || "Erro ao registar sala.",
        });
      }
      console.log(
        `🗄️🐢 BASE DE DADOS (lento) -> RegisterClassRoom: sala "${req.body.title}" registada`
      );
      await RefreshClassroomCache(req, res, instituteCode);
      return res.status(200).json(result.rows);
    }

    // Bulk
    const details = [];
    let ok = 0,
      fail = 0;

    for (let i = 0; i < items.length; i++) {
      try {
        const r = await insertClassroom(items[i] || {});
        if (r.success) {
          ok++;
          details.push({ index: i, status: "ok", title: items[i].title });
        } else {
          fail++;
          details.push({
            index: i,
            status: "fail",
            title: items[i].title,
            msg: r.msg || "Falha ao registar sala.",
          });
        }
      } catch (err) {
        fail++;
        details.push({
          index: i,
          status: "fail",
          title: items[i].title,
          msg: err?.message || "Erro interno ao registar sala.",
        });
      }
    }

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterClassRoom (bulk): ${ok} salas registadas`);
    await RefreshClassroomCache(req, res, instituteCode);

    return res.status(200).json({
      status: 200,
      success: true,
      total: items.length,
      inserted: ok,
      failed: fail,
      details,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      msg: "Falha ao registar sala!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar sala
 */
const ClassRoomUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { title, code, description } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateClassroomFields({ title, description });
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que a sala existe
    const checkExistQuery = `
      SELECT ed_classroom_id FROM eduall_classrooms
      WHERE ed_classroom_deleted = 0
        AND ed_classroom_id = ?
        AND ed_classroom_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_classrooms",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Sala não encontrada ou já foi removida.",
        });

    // Verificar duplicação (excluindo a própria sala)
    const checkQuery = `
      SELECT ed_classroom_id FROM eduall_classrooms
      WHERE REPLACE(LOWER(TRIM(ed_classroom_title)), ' ', '') = REPLACE(LOWER(TRIM(?)), ' ', '')
        AND ed_classroom_institute_code = ?
        AND ed_classroom_deleted = 0
        AND ed_classroom_id != ?
    `;
    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [title.trim(), instituteCode, ID],
      true,
      { db: "eduall_classrooms", type: "select", data: req }
    );

    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        msg: "Já existe outra sala com este nome (verifique espaços ou letras maiúsculas/minúsculas).",
      });
    }

    // Atualizar sala
    const query = `
      UPDATE eduall_classrooms
      SET ed_classroom_title = ?, ed_classroom_code = ?, ed_classroom_description = ?
      WHERE ed_classroom_deleted = 0
        AND ed_classroom_id = ?
        AND ed_classroom_institute_code = ?
    `;
    const PARAMS = [title.trim(), code || null, description || "", ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_classrooms",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Salas da instituição",
      description: `Atualizou sala (${title.trim()})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ClassRoomUpdate: sala ${ID} atualizada`);
    await RefreshClassroomCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        msg: "Falha ao atualizar sala!",
        error: error.message,
      });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar sala
 */
const ClassRoomDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkTitleQuery = `
      SELECT ed_classroom_title FROM eduall_classrooms
      WHERE ed_classroom_deleted = 0
        AND ed_classroom_id = ?
        AND ed_classroom_institute_code = ?
    `;
    const foundClassroom = await ExecuteQuery(
      res,
      checkTitleQuery,
      [ID, institute],
      true,
      { db: "eduall_classrooms", type: "select", data: req }
    );

    if (!foundClassroom || foundClassroom.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Sala não encontrada ou já foi removida.",
        });

    const classroomTitle = foundClassroom[0].ed_classroom_title;

    // Verificar se há classes associadas
    const checkQuery = `
      SELECT COUNT(*) AS total FROM eduall_class
      WHERE ed_class_room = ?
        AND ed_class_institute_code = ?
        AND ed_class_deleted = 0
    `;
    const checkResult = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    const classCount = checkResult[0]?.total || 0;

    if (classCount > 0) {
      return res.status(400).json({
        success: false,
        msg: `Não é possível eliminar. Existem ${classCount} turma(s) ainda associada(s) a esta sala.`,
      });
    }

    // Soft delete
    const query = `
      UPDATE eduall_classrooms
      SET ed_classroom_deleted = 1
      WHERE ed_classroom_deleted = 0
        AND ed_classroom_id = ?
        AND ed_classroom_institute_code = ?
    `;
    const PARAMS = [ID, institute];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_classrooms",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Salas da instituição",
      description: `Eliminou sala "${classroomTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ClassRoomDelete: sala ${ID} eliminada`);
    await RefreshClassroomCache(req, res, institute);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        msg: "Falha ao eliminar sala!",
        error: error.message,
      });
  }
};

module.exports = {
  GetClassroom,
  GetSingleClassroom,
  RegisterClassRoom,
  ClassRoomUpdate,
  ClassRoomDelete,
};