// ─────────────────────────────────────────────────────────────────────────────
//  Faculties.js  (Backend Controller – COM CACHE INTEGRADO)
//  Handles: Faculty CRUD operations
//  ✅ CACHE SYSTEM INTEGRADO (padrão AcademicYear.js)
// ─────────────────────────────────────────────────────────────────────────────

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION (same pattern as AcademicYear.js) ─────
// ──────────────────────────────────────────────────────────────
const FACULTY_CACHE_TTL = 3600; // 1 hour

const CacheKeys = {
  list: (instituteCode) => `faculty:list:${instituteCode}`,
  single: (id) => `faculty:single:${id}`,
  allGlobal: () => "faculty:*",
};

/**
 * ──────────────────────────────────────────────────────────────
 * REFRESH CACHE FUNCTION — called after writes
 * ──────────────────────────────────────────────────────────────
 */
const RefreshFacultyCache = async (req, res, instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear(CacheKeys.allGlobal());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} (Faculty)`);
  
  const duration = Date.now() - startTime;
  console.log(`🗄️🧹 CACHE CLEAR (Faculty) demorou ${duration}ms para institute ${instituteCode}`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET ALL FACULTIES
// ═══════════════════════════════════════════════════════════════════════════════

const GetFaculties = async (req, res) => {
   try {
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;
      const cacheKey = CacheKeys.list(instituteCode);
      const startTime = Date.now();

      // ── Check cache ──
      const cached = await Cache.eduallGet(cacheKey);
      if (cached !== null) {
        const duration = Date.now() - startTime;
        console.log(`📦⚡ CACHE (rápido) -> GetFaculties demorou ${duration}ms (${cacheKey})`);
        return res.status(200).json(cached);
      }

      const query = 'SELECT * FROM eduall_faculty WHERE ed_faculty_deleted = 0 AND ed_faculty_institute_code = ? ORDER BY ed_faculty_title ASC';
      const PARAMS = [instituteCode];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_faculty", type: "select", data: req });

      // ── Set cache ──
      await Cache.eduallSet(cacheKey, rows, FACULTY_CACHE_TTL);

      const duration = Date.now() - startTime;
      console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetFaculties demorou ${duration}ms (${cacheKey})`);

      res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao buscar faculdades!", error: error.message });
   }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE FACULTY
// ═══════════════════════════════════════════════════════════════════════════════

const GetSingleFaculty = async (req, res) => {
   try {
       const { ID } = req.params;
       const cacheKey = CacheKeys.single(ID);
       const startTime = Date.now();

       // ── Check cache ──
       const cached = await Cache.eduallGet(cacheKey);
       if (cached !== null) {
         const duration = Date.now() - startTime;
         console.log(`📦⚡ CACHE (rápido) -> GetSingleFaculty demorou ${duration}ms (${cacheKey})`);
         return res.status(200).json(cached);
       }

       const query = 'SELECT * FROM eduall_faculty WHERE ed_faculty_deleted = 0 AND ed_faculty_id = ?';
       const PARAMS = [ID];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_faculty", type: "select", data: req });

       // ── Set cache ──
       await Cache.eduallSet(cacheKey, rows, FACULTY_CACHE_TTL);

       const duration = Date.now() - startTime;
       console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleFaculty demorou ${duration}ms (${cacheKey})`);

       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao buscar a faculdade!", error: error.message });
   }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── REGISTER FACULTY
// ═══════════════════════════════════════════════════════════════════════════════

const RegisterFaculty = async (req, res) => {
    try {
      const { faculty_title } = req.body;
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;
      const facultyTitleLowerCase = faculty_title.trim().toLowerCase();
  
      // Verificar se já existe uma faculdade com o mesmo nome
      const checkQuery = `
        SELECT * FROM eduall_faculty 
        WHERE LOWER(ed_faculty_title) = ? AND ed_faculty_deleted = 0
        AND ed_faculty_institute_code = ?
      `;
      const checkParams = [facultyTitleLowerCase, instituteCode];
      const existingFaculty = await ExecuteQuery(res, checkQuery, checkParams, true, {
        db: "eduall_faculty",
        type: "select",
        data: req
      });
  
      if (existingFaculty.length > 0) {
        return res.status(400).json({
          success: false,
          msg: "Já existe uma faculdade com o mesmo nome!"
        });
      }
  
      // Inserir a nova faculdade
      const query = `INSERT INTO eduall_faculty (ed_faculty_title, ed_faculty_institute_code) VALUES(?, ?)`;
      const PARAMS = [faculty_title, instituteCode];
      const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_faculty", type: "insert", data: req });
  
      // Registrar a ação de auditoria
      await RegisterAuditAction({
        session: req.session,
        action: 1,  // Ação de registro
        form: "Faculdades",
        description: `Registrou uma nova faculdade (${faculty_title})`,
      });
  
      console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterFaculty: faculdade "${faculty_title}" criada`);
      await RefreshFacultyCache(req, res, instituteCode);
  
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ success: false, msg: "Falha ao registar a faculdade!", error: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── UPDATE FACULTY
// ═══════════════════════════════════════════════════════════════════════════════

const FacultyUpdate = async (req, res) => {
    try {
      const { ID } = req.params;
      const { faculty_title } = req.body;
      const instituteCode = req.session.user.eduall_user_session_curentinstitute;
      const facultyTitleLowerCase = faculty_title.trim().toLowerCase();
  
      // Verificar se já existe uma faculdade com o mesmo nome
      const checkQuery = `
        SELECT * FROM eduall_faculty 
        WHERE LOWER(ed_faculty_title) = ? AND ed_faculty_deleted = 0
        AND ed_faculty_institute_code = ? AND ed_faculty_id != ?
      `;
      const checkParams = [facultyTitleLowerCase, instituteCode, ID];
      const existingFaculty = await ExecuteQuery(res, checkQuery, checkParams, true, {
        db: "eduall_faculty",
        type: "select",
        data: req
      });
  
      if (existingFaculty.length > 0) {
        return res.status(400).json({
          success: false,
          msg: "Já existe uma faculdade com o mesmo nome!"
        });
      }
  
      // Se não houver faculdade com o mesmo nome, proceder com a atualização
      const query = `UPDATE eduall_faculty SET ed_faculty_title = ? 
      WHERE ed_faculty_deleted = 0 AND ed_faculty_id = ? AND ed_faculty_institute_code = ?`;
      const PARAMS = [faculty_title, ID, instituteCode];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_faculty", type: "update", data: req });
  
      // Registrar a ação de auditoria
      await RegisterAuditAction({
        session: req.session,
        action: 2,  // Ação de atualização
        form: "Faculdades",
        description: `Atualizou a faculdade com o título ${faculty_title} e ID ${ID}`,
      });
  
      console.log(`🗄️🐢 BASE DE DADOS (lento) -> FacultyUpdate: faculdade ID ${ID} atualizada`);
      await RefreshFacultyCache(req, res, instituteCode);
  
      res.status(200).json(rows);
    } catch (error) {
      res.status(500).json({ success: false, msg: "Falha ao atualizar a faculdade!", error: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── DELETE FACULTY
// ═══════════════════════════════════════════════════════════════════════════════

const FacultyDelete = async (req, res) => {
   try {
       const { ID } = req.params;
       const institute = req.session.user.eduall_user_session_curentinstitute;

       const checkQuery = `SELECT COUNT(*) AS total FROM eduall_class 
                           WHERE ed_class_faculty = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`;
       const checkParams = [ID, institute];
       const checkResult = await ExecuteQuery(res, checkQuery, checkParams, true, {
         db: "eduall_class",
         type: "select",
         data: req,
       });

       const classCount = checkResult[0]?.total || 0;

       if (classCount > 0) {
           return res.status(400).json({
               success: false,
               msg: `Não é possível eliminar. Existem ${classCount} turmas ainda associadas a esta faculdade.`,
           });
       }

       const query = `UPDATE eduall_faculty SET ed_faculty_deleted = 1 
                      WHERE ed_faculty_deleted = 0 AND ed_faculty_id = ?`;
       const PARAMS = [ID];
       const rows = await ExecuteQuery(res, query, PARAMS, false, {
         db: "eduall_faculty",
         type: "update",
         data: req,
       });

       // Registrar a ação de auditoria
       await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Faculdades",
         description: `Eliminou a faculdade com ID ${ID}`,
       });

       console.log(`🗄️🐢 BASE DE DADOS (lento) -> FacultyDelete: faculdade ID ${ID} eliminada`);
       await RefreshFacultyCache(req, res, institute);

       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({
           success: false,
           msg: "Falha ao eliminar a faculdade!",
           error: error.message,
       });
   }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { 
  GetFaculties, 
  GetSingleFaculty, 
  RegisterFaculty, 
  FacultyDelete, 
  FacultyUpdate 
};