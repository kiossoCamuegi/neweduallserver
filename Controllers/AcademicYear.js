const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");

const ACADEMIC_YEAR_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `academic_year:list:${instituteCode}`,
  single: (id, instituteCode) => `academic_year:single:${id}:${instituteCode}`,
  all: () => "academic_year:*",
};

const FetchAcademicYears = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_academic_year 
                 WHERE ed_academic_year_deleted = 0 
                 AND ed_academic_year_institute_code = ? 
                 ORDER BY ed_academic_year_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_academic_year",
    type: "select",
    data: req,
  });
};

const RefreshAcademicYearCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchAcademicYears(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, ACADEMIC_YEAR_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows; 
};
 
const GetAcademicYear = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAcademicYear demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAcademicYears(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ACADEMIC_YEAR_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAcademicYear demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao carregar os anos académicos!", error: error.message });
  }
};

const GetSingleAcademicYear = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleAcademicYear demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_academic_year 
                   WHERE ed_academic_year_deleted = 0 
                   AND ed_academic_year_id = ?  
                   AND ed_academic_year_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, {
      db: "eduall_academic_year",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, ACADEMIC_YEAR_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleAcademicYear demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao obter o ano académico!", error: error.message });
  }
};

const AcademicyearDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const checkQuery = `SELECT COUNT(*) AS total FROM eduall_class 
    WHERE ed_class_year = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`;
    const checkResult = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    const classCount = checkResult[0]?.total || 0;
    if (classCount > 0) {
      return res.status(400).json({
        success: false,
        msg: `Não é possível eliminar. Existem ${classCount} turmas ainda associadas a este ano académico.`,
      });
    }

    const getTitleQuery = `
      SELECT ed_academic_year_title 
      FROM eduall_academic_year 
      WHERE ed_academic_year_id = ? 
      AND ed_academic_year_institute_code = ?
    `;
    const titleResult = await ExecuteQuery(res, getTitleQuery, [ID, institute], true, {
      db: "eduall_academic_year",
      type: "select",
      data: req,
    });

    const yearTitle = titleResult[0]?.ed_academic_year_title || "Desconhecido";

    const query = `UPDATE eduall_academic_year 
                   SET ed_academic_year_deleted = 1 
                   WHERE ed_academic_year_deleted = 0 
                   AND ed_academic_year_id = ? 
                   AND ed_academic_year_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, institute], false, {
      db: "eduall_academic_year",
      type: "delete",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Ano Académico",
      description: `Eliminou o ano académico "${yearTitle}" (ID ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AcademicyearDelete: registo ${ID} eliminado`);
    await RefreshAcademicYearCache(req, res, institute);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao eliminar o ano académico!",
      error: error.message,
    });
  }
};

const RegisterAcademicYear = async (req, res) => {
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
        msg: "Nenhum ano lectivo enviado.",
      });
    }

    const results = { success: [], failed: [] };

    for (const item of items) {
      try {
        const title = String(item.title || "").trim();
        const year_date_start = String(item.year_date_start || "").trim();
        const year_date_finish = String(item.year_date_finish || "").trim();

        if (!title) throw new Error("Ano lectivo inválido.");
        if (!year_date_start) throw new Error("Data inicial inválida.");
        if (!year_date_finish) throw new Error("Data final inválida.");

        const s = new Date(year_date_start);
        const f = new Date(year_date_finish);
        if (Number.isFinite(s.getTime()) && Number.isFinite(f.getTime()) && f <= s) {
          throw new Error("A data final deve ser maior que a data inicial.");
        }

        const checkQuery = `
          SELECT ed_academic_year_id
          FROM eduall_academic_year
          WHERE ed_academic_year_deleted = 0
            AND ed_academic_year_institute_code = ?
            AND (
              LOWER(ed_academic_year_title) = LOWER(?)
              OR (ed_academic_year_startDate = ? AND ed_academic_year_endDate = ?)
            )
        `;
        const checkParams = [instituteCode, title, year_date_start, year_date_finish];

        const existingYear = await ExecuteQuery(res, checkQuery, checkParams, true, {
          db: "eduall_academic_year",
          type: "select",
          data: req,
        });

        if (existingYear.length > 0) {
          throw new Error("Já existe um ano académico com esse título ou com as mesmas datas!");
        }

        const query = `
          INSERT INTO eduall_academic_year(
            ed_academic_year_title,
            ed_academic_year_startDate,
            ed_academic_year_endDate,
            ed_academic_year_institute_code
          ) VALUES (?, ?, ?, ?)
        `;

        const PARAMS = [title, year_date_start, year_date_finish, instituteCode];

        await ExecuteQuery(res, query, PARAMS, false, {
          db: "eduall_academic_year",
          type: "register",
          data: req,
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Ano Académico",
          description: `Registou o ano académico "${title}"`,
        });

        results.success.push(title);
      } catch (err) {
        results.failed.push({
          title: item.title,
          error: err.message,
        });
      }
    }

    if (results.success.length > 0) {
      console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAcademicYear: ${results.success.length} registo(s) gravado(s)`);
      await RefreshAcademicYearCache(req, res, instituteCode);
    }

    return res.status(200).json({
      success: true,
      total: items.length,
      inserted: results.success.length,
      failed: results.failed.length,
      details: results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Falha ao registrar o ano académico!",
      error: error.message,
    });
  }
};

const AcademicyearUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { title, year_date_start, year_date_finish } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const checkQuery = `
      SELECT * FROM eduall_academic_year
      WHERE ed_academic_year_deleted = 0
        AND ed_academic_year_institute_code = ?
        AND ed_academic_year_id != ?
        AND (
          LOWER(ed_academic_year_title) = LOWER(?)
          OR (ed_academic_year_startDate = ? AND ed_academic_year_endDate = ?)
        )
    `;
    const existingYear = await ExecuteQuery(
      res,
      checkQuery,
      [instituteCode, ID, title, year_date_start, year_date_finish],
      true,
      { db: "eduall_academic_year", type: "select", data: req }
    );

    if (existingYear.length > 0) {
      return res.status(400).json({
        success: false,
        msg: "Já existe um ano académico com esse título ou com as mesmas datas!",
      });
    }

    const query = `
      UPDATE eduall_academic_year 
      SET ed_academic_year_title = ?,
          ed_academic_year_startDate = ?, 
          ed_academic_year_endDate = ?
      WHERE ed_academic_year_deleted = 0 
        AND ed_academic_year_id = ?  
        AND ed_academic_year_institute_code = ?
    `;
    const rows = await ExecuteQuery(
      res,
      query,
      [title, year_date_start, year_date_finish, ID, instituteCode],
      false,
      { db: "eduall_academic_year", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Ano Académico",
      description: `Atualizou o ano académico "${title}" (ID ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AcademicyearUpdate: registo ${ID} atualizado`);
    await RefreshAcademicYearCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar o ano académico!",
      error: error.message,
    });
  }
};

module.exports = {
  GetAcademicYear,
  RegisterAcademicYear,
  GetSingleAcademicYear,
  AcademicyearDelete,
  AcademicyearUpdate,
};