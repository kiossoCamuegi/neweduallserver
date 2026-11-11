// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

const ACADEMIC_LEVEL_CACHE_TTL = 3600;
const ACADEMIC_LEVEL_SUMMARY_CACHE_TTL = 120; // agregação: TTL curto

const normalizeTitle = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ºª]/g, "")
    .replace(/[^a-z0-9]/g, "");
};

const FetchAcademicLevels = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_academic_level",
    type: "select",
    data: req,
  });
};

const GetAcademicLevel = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await Cache.eduallWithCache(
      CacheKeys.academicLevel.list(instituteCode),
      ACADEMIC_LEVEL_CACHE_TTL,
      () => FetchAcademicLevels(req, res, instituteCode)
    );
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to !", error: error.message });
  }
};

const GetStudentsByAcademicLevel = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const result = await Cache.eduallWithCache(
      CacheKeys.academicLevel.studentsSummary(instituteCode),
      ACADEMIC_LEVEL_SUMMARY_CACHE_TTL,
      async () => {
        // Duas queries independentes em paralelo (antes: 1 query por nível = N+1)
        const [academicLevels, studentCounts] = await Promise.all([
          ExecuteQuery(
            res,
            `SELECT ed_academic_level_id, ed_academic_level_name
             FROM eduall_academic_level
             WHERE ed_academic_level_deleted = 0
               AND ed_academic_level_institute_code = ?`,
            [instituteCode],
            true,
            { db: "eduall_academic_level", type: "select", data: req }
          ),
          ExecuteQuery(
            res,
            `SELECT c.ed_class_academic_level AS ed_academic_level_id,
                    s.ed_student_gender,
                    COUNT(*) AS total
             FROM eduall_students s
             JOIN eduall_class c ON s.ed_student_class = c.ed_class_id
             WHERE s.ed_student_deleted = 0
               AND c.ed_class_deleted = 0
               AND s.ed_student_institute_code = ?
             GROUP BY c.ed_class_academic_level, s.ed_student_gender`,
            [instituteCode],
            true,
            { db: "eduall_students", type: "select", data: req }
          ),
        ]);

        const countsByLevel = new Map();
        (studentCounts || []).forEach((item) => {
          const levelId = Number(item.ed_academic_level_id);
          if (!countsByLevel.has(levelId)) countsByLevel.set(levelId, []);
          countsByLevel.get(levelId).push(item);
        });

        return (academicLevels || []).map((level) => {
          const summary = { academicLevel: level.ed_academic_level_name, male: 0, female: 0 };
          (countsByLevel.get(Number(level.ed_academic_level_id)) || []).forEach((item) => {
            if (item.ed_student_gender === "male") summary.male = item.total;
            if (item.ed_student_gender === "female") summary.female = item.total;
          });
          return summary;
        });
      }
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch students by academic level!", error: error.message });
  }
};

const GetSingleAcademicLevel = async (req, res) => {
  try {
    const { ID } = req.params;
    const levelId = CacheKeys.parseId(ID);
    if (levelId === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Lista pequena: filtra a partir da lista em cache (uma só chave para invalidar)
    const list = await Cache.eduallWithCache(
      CacheKeys.academicLevel.list(instituteCode),
      ACADEMIC_LEVEL_CACHE_TTL,
      () => FetchAcademicLevels(req, res, instituteCode)
    );
    const rows = (list || []).filter((row) => Number(row.ed_academic_level_id) === levelId);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to !", error: error.message });
  }
};

const AcademicLevelDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const checkQuery = `SELECT COUNT(*) AS total FROM eduall_class 
                        WHERE ed_class_academic_level = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`;
    const checkResult = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    const classCount = checkResult[0]?.total || 0;

    if (classCount > 0) {
      return res.status(400).json({
        success: false,
        msg: `Não é possível eliminar. Existem ${classCount} turmas ainda associadas a este nível acadêmico.`,
      });
    }

    const query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1 
                   WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? AND ed_academic_level_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, institute], false, {
      db: "eduall_academic_level",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Níveis acadêmico",
      description: `Eliminou o nível acadêmico com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AcademicLevelDelete: registo ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.academicLevel.list(institute), CacheKeys.academicLevel.studentsSummary(institute)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao eliminar o nível acadêmico!",
      error: error.message,
    });
  }
};

const RegisterAcademicLevel = async (req, res) => {
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
        msg: "Nenhum nível acadêmico enviado.",
      });
    }

    const results = { success: [], failed: [] };

    for (const item of items) {
      try {
        const title = String(item.academic_level_title || "").trim();

        if (!title) {
          throw new Error("Nome da classe inválido.");
        }

        const checkQuery = `
          SELECT ed_academic_level_title
          FROM eduall_academic_level
          WHERE
            LOWER(REPLACE(REPLACE(REPLACE(ed_academic_level_title,' ',''),'ª',''),'º',''))
            =
            LOWER(REPLACE(REPLACE(REPLACE(?,' ',''),'ª',''),'º',''))
            AND ed_academic_level_institute_code = ?
            AND ed_academic_level_deleted = 0
        `;

        const exists = await ExecuteQuery(res, checkQuery, [title, instituteCode], true, {
          db: "eduall_academic_level",
          type: "select",
          data: req,
        });

        if (exists.length > 0) {
          throw new Error("Classe com nome semelhante já existe.");
        }

        const insertQuery = `
          INSERT INTO eduall_academic_level (
            ed_academic_level_title,
            ed_academic_level_forExam,
            ed_academic_level_forFt,
            ed_academic_level_avaliationtype_endat,
            ed_academic_level_institute_code
          )
          VALUES (?, ?, ?, ?, ?)
        `;

        const params = [
          title,
          item.academic_level_forExam ?? 0,
          item.academic_level_forFt ?? 0,
          item.academic_level_avaliationtype_endat ?? 20,
          instituteCode,
        ];

        await ExecuteQuery(res, insertQuery, params, false, {
          db: "eduall_academic_level",
          type: "insert",
          data: req,
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Níveis acadêmicos",
          description: `Registrou a classe ${title}`,
        });

        results.success.push(title);
      } catch (err) {
        results.failed.push({
          title: item.academic_level_title,
          error: err.message,
        });
      }
    }

    if (results.success.length > 0) {
      console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAcademicLevel: ${results.success.length} registo(s) gravado(s)`);
      await CacheKeys.safeInvalidate(() => [CacheKeys.academicLevel.list(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
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
      msg: "Erro interno ao registrar classes.",
      error: error.message,
    });
  }
};

const AcademicLevelUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { academic_level_title, academic_level_forExam, academic_level_forFt } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const currentTitleQuery = `SELECT ed_academic_level_title FROM eduall_academic_level 
      WHERE ed_academic_level_id = ? AND ed_academic_level_institute_code = ? AND ed_academic_level_deleted = 0`;
    const currentTitleResult = await ExecuteQuery(res, currentTitleQuery, [ID, instituteCode], true, {
      db: "eduall_academic_level",
      type: "select",
      data: req,
    });

    if (currentTitleResult.length === 0) {
      return res.status(404).json({ status: 404, success: false, msg: "Nível acadêmico não encontrado." });
    }

    const currentNormalized = normalizeTitle(currentTitleResult[0].ed_academic_level_title);
    const newNormalized = normalizeTitle(academic_level_title);

    if (currentNormalized !== newNormalized) {
      const checkQuery = `
        SELECT ed_academic_level_id FROM eduall_academic_level 
        WHERE 
          LOWER(REPLACE(REPLACE(REPLACE(ed_academic_level_title, ' ', ''), 'ª', ''), 'º', '')) = LOWER(REPLACE(REPLACE(REPLACE(?, ' ', ''), 'ª', ''), 'º', ''))
          AND ed_academic_level_institute_code = ?
          AND ed_academic_level_deleted = 0
          AND ed_academic_level_id != ?
      `;
      const existing = await ExecuteQuery(res, checkQuery, [academic_level_title.trim(), instituteCode, ID], true, {
        db: "eduall_academic_level",
        type: "select",
        data: req,
      });

      if (existing.length > 0) {
        return res.status(400).json({
          status: 400,
          success: false,
          msg: `Já existe um nível acadêmico com um nome muito similar. Por favor, utilize um nome diferente.`,
        });
      }
    }

    const query = `UPDATE eduall_academic_level SET 
      ed_academic_level_title = ?, ed_academic_level_forExam = ?, ed_academic_level_forFt = ? , ed_academic_level_avaliationtype_endat = ?
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? AND ed_academic_level_institute_code = ?`;
    const rows = await ExecuteQuery(
      res,
      query,
      [
        academic_level_title,
        academic_level_forExam,
        academic_level_forFt,
        req.body.academic_level_avaliationtype_endat,
        ID,
        instituteCode,
      ],
      false,
      { db: "eduall_academic_level", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Níveis acadêmico",
      description: `Atualizou o nível acadêmico (${academic_level_title}) com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AcademicLevelUpdate: registo ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.academicLevel.list(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar o nível acadêmico!", error: error.message });
  }
};

module.exports = {
  GetAcademicLevel,
  RegisterAcademicLevel,
  GetSingleAcademicLevel,
  AcademicLevelDelete,
  AcademicLevelUpdate,
  GetStudentsByAcademicLevel,
};