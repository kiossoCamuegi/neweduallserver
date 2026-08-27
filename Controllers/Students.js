const multer = require(`multer`);
const path = require(`path`);
const fs = require(`fs`);
const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database");
const { GetCurrentUserData } = require("./GetCurrentUserData");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");
const { checkClassCapacity } = require("./ServicePayments");

// ═════════════════════════════════════════════════════════════════════════════
//  MULTER CONFIGURATION - SEGURO COM VALIDACOES
// ═════════════════════════════════════════════════════════════════════════════

// 1. Storage: Nomes únicos + pasta segura
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/students/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitizar nome original
    const sanitized = SanitizeFilename(file.originalname);
    // Nome único: timestamp + random
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(sanitized).toLowerCase();
    const name = path.basename(sanitized, ext);
    cb(null, `${name}-${unique}${ext}`);
  }
});

// 2. File Filter: Validar tipos + tamanho
const fileFilter = (req, file, cb) => {
  // Tipos permitidos (apenas imagens)
  const ALLOWED_MIMES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ];

  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    console.warn(`FICHEIRO REJEITADO: Tipo não permitido - ${file.mimetype}`);
    return cb(new Error(`Tipo de ficheiro não permitido: ${file.mimetype}. Apenas JPG, PNG, GIF e WebP.`));
  }

  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExts.includes(ext)) {
    console.warn(`FICHEIRO REJEITADO: Extensão não permitida - ${ext}`);
    return cb(new Error(`Extensão não permitida: ${ext}`));
  }

  cb(null, true);
};

// 3. Multer instance
const uploadStd = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024  // 5MB máximo
  }
});

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

// Sanitizar filename contra ataques
function SanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')  // Remover caracteres perigosos
    .replace(/\.{2,}/g, '_')            // Remover ..
    .slice(0, 100);                     // Limitar tamanho
}

// Validar email
function IsValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Validar telefone
function IsValidPhone(phone) {
  const cleaned = phone.replace(/\s/g, '');
  return /^\d{9,}$/.test(cleaned);
}

// Validar data
function IsValidDate(dateStr) {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

// Validar idade
function ValidateAge(birthday) {
  const today = new Date();
  const birthDate = new Date(birthday);
  const age = today.getFullYear() - birthDate.getFullYear();
  
  if (age < 5) return { valid: false, msg: 'Aluno deve ter pelo menos 5 anos' };
  if (age > 120) return { valid: false, msg: 'Data de nascimento inválida' };
  
  return { valid: true };
}

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION (same pattern as AcademicYear.js) ─────
// ──────────────────────────────────────────────────────────────
const STUDENTS_CACHE_TTL = 3600; // 1 hour

const CacheKeys = {
  list: (instituteCode) => `students:list:${instituteCode}`,
  byClass: (classId, instituteCode) => `students:byclass:${classId}:${instituteCode}`,
  single: (id, instituteCode) => `students:single:${id}:${instituteCode}`,
  byCode: (code) => `students:bycode:${code}`,
  byIdentityCard: (card, instituteCode) => `students:byidentity:${card}:${instituteCode}`,
  allGlobal: () => "students:*",
};

/**
 * ──────────────────────────────────────────────────────────────
 * REFRESH CACHE FUNCTION — called after writes
 * ──────────────────────────────────────────────────────────────
 */
const RefreshStudentCache = async (req, res, instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear(CacheKeys.allGlobal());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} (Students)`);
  
  const duration = Date.now() - startTime;
  console.log(`🗄️🧹 CACHE CLEAR (Students) demorou ${duration}ms para institute ${instituteCode}`);
};
 
// ──────────────────────────────────────────────────────────────
// ── GET STUDENTS (Lista completa)
// ──────────────────────────────────────────────────────────────
const GetStudents = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const isNormalSchool = (req.session.user.eduall_user_session_curentinstitute_type * 1) === 0;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetStudents demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const BASE_SELECT = `SELECT s.*, c.*, ci.*, cr.*, ay.*, co.*, al.*`;

    const BASE_JOINS = `
      FROM eduall_students s

      LEFT JOIN eduall_class c
        ON s.ed_student_class = c.ed_class_id
       AND c.ed_class_deleted = 0

      LEFT JOIN eduall_cicles ci
        ON ci.ed_cicle_id = c.ed_class_cicle
       AND ci.ed_cicle_deleted = 0

      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room
       AND cr.ed_classroom_deleted = 0

      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
       AND ay.ed_academic_year_deleted = 0

      LEFT JOIN eduall_courses co
        ON co.ed_course_id = c.ed_class_course
       AND co.ed_course_deleted = 0

      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
       AND al.ed_academic_level_deleted = 0
    `;

    // Condição que oculta alunos sem turma quando existe outro
    // com o mesmo nome que já tem turma atribuída
    const DUPLICATE_FILTER = `
      AND NOT (
        s.ed_student_class = 0
        AND EXISTS (
          SELECT 1
          FROM eduall_students s2
          WHERE s2.ed_student_name           = s.ed_student_name
            AND s2.ed_student_institute_code = s.ed_student_institute_code
            AND s2.ed_student_deleted        = 0
            AND s2.ed_student_class         != 0
            AND s2.ed_student_id            != s.ed_student_id
        )
      )
    `;

    let query, PARAMS;

    if (isNormalSchool) {
      query = `
        ${BASE_SELECT}
        ${BASE_JOINS}
        WHERE s.ed_student_deleted          = 0
          AND s.ed_student_institute_code   = ?
        ${DUPLICATE_FILTER}
        ORDER BY s.ed_student_name ASC
      `;
      PARAMS = [instituteCode];
    } else {
      query = `
        ${BASE_SELECT}, sd.*
        ${BASE_JOINS}

        LEFT JOIN eduall_students_details sd
          ON sd.ed_detail_student_code = s.ed_student_id

        WHERE s.ed_student_deleted          = 0
          AND s.ed_student_institute_code   = ?
        ${DUPLICATE_FILTER}
        ORDER BY s.ed_student_name ASC
      `;
      PARAMS = [instituteCode];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_students", type: "select", data: req
    });

    // ──────────────────────────────────────────────────────────
    // ── Histórico de matrículas (eduall_enrollment) ──
    // Feito numa segunda consulta (agrupada em JS por aluno) em vez
    // de um JOIN direto na query principal, porque um aluno pode ter
    // várias matrículas/confirmações ao longo do tempo — um JOIN
    // 1-para-muitos duplicaria as linhas da listagem principal.
    // ──────────────────────────────────────────────────────────
    const enrollmentQuery = `
      SELECT
        e.ed_enrollment_id,
        e.ed_enrollment_student,
        e.ed_enrollment_service,
        e.ed_enrollment_class,
        e.ed_enrollment_academic_year,
        e.ed_enrollment_invoice_code,
        e.ed_enrollment_invoice_file,
        e.ed_enrollment_registerDate,
        e.ed_enrollment_paid_value,
        e.ed_enrollment_currency,
        e.ed_enrollment_payment_method_id,
        e.ed_enrollment_payment_bank,
        e.ed_enrollment_payment_place,
        e.ed_enrollment_bordereau,
        e.ed_enrollment_bordereau_amount,
        e.ed_enrollment_balance_used,
        ay.ed_academic_year_title,
        cl.ed_class_title AS ed_enrollment_class_title

      FROM eduall_enrollment e

      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = e.ed_enrollment_academic_year
       AND ay.ed_academic_year_deleted = 0

      LEFT JOIN eduall_class cl
        ON cl.ed_class_id = e.ed_enrollment_class
       AND cl.ed_class_deleted = 0

      WHERE e.ed_enrollment_deleted        = 0
        AND e.ed_enrollment_institute_code = ?

      ORDER BY e.ed_enrollment_registerDate DESC
    `;

    const enrollmentRows = await ExecuteQuery(res, enrollmentQuery, [instituteCode], true, {
      db: "eduall_enrollment", type: "select", data: req
    });

    // Agrupa o histórico de matrículas por aluno
    const enrollmentsByStudent = new Map();
    (enrollmentRows || []).forEach(e => {
      const studentId = e.ed_enrollment_student;
      if (!enrollmentsByStudent.has(studentId)) enrollmentsByStudent.set(studentId, []);
      enrollmentsByStudent.get(studentId).push(e);
    });

    // Anexa o histórico completo + o estado "matriculado" a cada
    // aluno da listagem principal, sem alterar os campos já
    // devolvidos anteriormente (apenas adiciona os novos).
    const rowsWithEnrollment = rows.map(student => {
      const history = enrollmentsByStudent.get(student.ed_student_id) || [];
      return {
        ...student,
        // histórico completo de matrículas/confirmações do aluno
        ed_student_enrollments: history,
        // 1 quando existe pelo menos um registo em eduall_enrollment
        ed_student_is_enrolled: history.length > 0 ? 1 : 0,
        // registo mais recente, para acesso rápido sem percorrer o array
        ed_student_last_enrollment: history[0] || null,
      };
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rowsWithEnrollment, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudents demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rowsWithEnrollment);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch students!",
      error: error.message
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET STUDENTS BY CLASS
// ──────────────────────────────────────────────────────────────

const GetStudentsByClass = async (req, res) => {
  try {
    const CLASS = parseInt(req.params.CLASS, 10);
 
    if (isNaN(CLASS)) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro CLASS inválido."
      });
    }
 
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const isNormalSchool = (req.session.user.eduall_user_session_curentinstitute_type * 1) === 0;
    const cacheKey = CacheKeys.byClass(CLASS, instituteCode);
    const startTime = Date.now();
 
    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetStudentsByClass demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }
 
    const BASE_SELECT = `SELECT s.*, c.*, ci.*, cr.*, ay.*, co.*, al.*`;
 
    const BASE_JOINS = `
      FROM eduall_students s
 
      LEFT JOIN eduall_class c
        ON s.ed_student_class = c.ed_class_id
 
      LEFT JOIN eduall_cicles ci
        ON ci.ed_cicle_id = c.ed_class_cicle
       AND ci.ed_cicle_deleted = 0
 
      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room
       AND cr.ed_classroom_deleted = 0
 
      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
       AND ay.ed_academic_year_deleted = 0
 
      LEFT JOIN eduall_courses co
        ON co.ed_course_id = c.ed_class_course
       AND co.ed_course_deleted = 0
 
      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
       AND al.ed_academic_level_deleted = 0
 
      LEFT JOIN eduall_transport_passengers tp
        ON tp.ed_transport_passenger_code = s.ed_student_id
    `;
 
    // Mesma condição anti-duplicado
    const DUPLICATE_FILTER = `
      AND NOT (
        s.ed_student_class = 0
        AND EXISTS (
          SELECT 1
          FROM eduall_students s2
          WHERE s2.ed_student_name           = s.ed_student_name
            AND s2.ed_student_institute_code = s.ed_student_institute_code
            AND s2.ed_student_deleted        = 0
            AND s2.ed_student_class         != 0
            AND s2.ed_student_id            != s.ed_student_id
        )
      )
    `;
 
    // ═════════════════════════════════════════════════════════════════════════════
    // 1️⃣ ALUNOS ATUAIS
    // ═════════════════════════════════════════════════════════════════════════════
    let query, PARAMS;
 
    if (isNormalSchool) {
      query = `
        ${BASE_SELECT}, 'current' AS enrollment_type
        ${BASE_JOINS}
        WHERE s.ed_student_deleted          = 0
          AND s.ed_student_institute_code   = ?
          AND s.ed_student_class            = ?
          AND c.ed_class_deleted            = 0
        ${DUPLICATE_FILTER}
        ORDER BY s.ed_student_name ASC
      `;
      PARAMS = [instituteCode, CLASS];
    } else {
      query = `
        ${BASE_SELECT}, sd.*, 'current' AS enrollment_type
        ${BASE_JOINS}
 
        LEFT JOIN eduall_students_details sd
          ON sd.ed_detail_student_code = s.ed_student_id
 
        WHERE s.ed_student_deleted          = 0
          AND s.ed_student_institute_code   = ?
          AND s.ed_student_class            = ?
          AND c.ed_class_deleted            = 0
        ${DUPLICATE_FILTER}
        ORDER BY s.ed_student_name ASC
      `;
      PARAMS = [instituteCode, CLASS];
    }
 
    const currentStudents = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_students", type: "select", data: req
    });
 
    // ═════════════════════════════════════════════════════════════════════════════
    // 2️⃣ ALUNOS ANTIGOS (que já saíram da turma mas ainda existem no sistema)
    // ═════════════════════════════════════════════════════════════════════════════
    const oldStudentIdQuery = `
      SELECT DISTINCT ed_student_old_class_student AS ed_student_id
      FROM eduall_student_old_classes
      WHERE ed_student_old_class = ?
    `;
    const oldStudentIds = await ExecuteQuery(res, oldStudentIdQuery, [CLASS], true, {
      db: "eduall_students", type: "select", data: req
    });
 
    const oldIds = oldStudentIds ? oldStudentIds.map(o => Number(o.ed_student_id)) : [];
    const currentIds = currentStudents.map(s => Number(s.ed_student_id));
    const oldOnlyIds = oldIds.filter(id => !currentIds.includes(id));
 
    let historicalStudents = [];
    if (oldOnlyIds.length > 0) {
      const ph = oldOnlyIds.map(() => "?").join(",");
      const historicalQuery = isNormalSchool
        ? `
          ${BASE_SELECT}, 'historical' AS enrollment_type
          ${BASE_JOINS}
          WHERE s.ed_student_deleted        = 0
            AND s.ed_student_id            IN (${ph})
          ORDER BY s.ed_student_name ASC
        `
        : `
          ${BASE_SELECT}, sd.*, 'historical' AS enrollment_type
          ${BASE_JOINS}
          LEFT JOIN eduall_students_details sd
            ON sd.ed_detail_student_code = s.ed_student_id
          WHERE s.ed_student_deleted        = 0
            AND s.ed_student_id            IN (${ph})
          ORDER BY s.ed_student_name ASC
        `;
      historicalStudents = await ExecuteQuery(res, historicalQuery, oldOnlyIds, true, {
        db: "eduall_students", type: "select", data: req
      });
    }
 
    // ═════════════════════════════════════════════════════════════════════════════
    // 3️⃣ COMBINAR + ORDENAR ALFABETICAMENTE + CACHE
    // ═════════════════════════════════════════════════════════════════════════════
    
    // Helper para ordenar por nome (Português)
    const sortByName = (arr) => arr.sort((a, b) => 
      (a.ed_student_name || "").localeCompare(b.ed_student_name || "", "pt")
    );
    
    // Ordenar cada grupo alfabeticamente
    const sortedCurrentStudents = sortByName([...currentStudents]);
    const sortedHistoricalStudents = sortByName([...historicalStudents]);
    
    // Combinar: atuais primeiro (A-Z), depois antigos (A-Z)
    const allRows = [...sortedCurrentStudents, ...sortedHistoricalStudents];
 
    // ── Set cache ──
    await Cache.eduallSet(cacheKey, allRows, STUDENTS_CACHE_TTL);
 
    const duration = Date.now() - startTime;
    
    // ═════════════════════════════════════════════════════════════════════════════
    // 📊 CONSOLE LOGS COM CORES E ORDEM ALFABÉTICA
    // ═════════════════════════════════════════════════════════════════════════════
    console.log(`\n${"═".repeat(80)}`);
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudentsByClass demorou ${duration}ms`);
    console.log(`${"═".repeat(80)}`);
    console.log(`\n📌 TURMA: ${CLASS} | Instituto: ${instituteCode}\n`);
    
    // Alunos atuais (roxo) — ordem alfabética A-Z
    if (sortedCurrentStudents.length > 0) {
      console.log(`\x1b[35m┌─────────────────────────────────────────────────────┐\x1b[0m`);
      console.log(`\x1b[35m│ 👥 ALUNOS ATUAIS (${String(sortedCurrentStudents.length).padStart(2)}) — Ordem A-Z     \x1b[0m`);
      console.log(`\x1b[35m├─────────────────────────────────────────────────────┤\x1b[0m`);
      sortedCurrentStudents.forEach((s, idx) => {
        const name = (s.ed_student_name || "—").padEnd(40);
        const id = String(s.ed_student_id).padStart(6);
        console.log(`\x1b[35m│ [${String(idx + 1).padStart(2)}] ${name} (ID: ${id}) \x1b[0m`);
      });
      console.log(`\x1b[35m└─────────────────────────────────────────────────────┘\x1b[0m\n`);
    }
 
    // Alunos antigos (rosa) — ordem alfabética A-Z
    if (sortedHistoricalStudents.length > 0) {
      console.log(`\x1b[38;5;219m┌─────────────────────────────────────────────────────┐\x1b[0m`);
      console.log(`\x1b[38;5;219m│ 📜 ALUNOS ANTIGOS (${String(sortedHistoricalStudents.length).padStart(2)}) — Ordem A-Z   \x1b[0m`);
      console.log(`\x1b[38;5;219m├─────────────────────────────────────────────────────┤\x1b[0m`);
      sortedHistoricalStudents.forEach((s, idx) => {
        const name = (s.ed_student_name || "—").padEnd(40);
        const id = String(s.ed_student_id).padStart(6);
        console.log(`\x1b[38;5;219m│ [${String(idx + 1).padStart(2)}] ${name} (ID: ${id}) \x1b[0m`);
      });
      console.log(`\x1b[38;5;219m└─────────────────────────────────────────────────────┘\x1b[0m\n`);
    }
 
    // Resumo
    console.log(`\x1b[36m┌─ RESUMO ─────────────────────────────────────────────┐\x1b[0m`);
    console.log(`\x1b[36m│ 👥 Atuais:   ${String(sortedCurrentStudents.length).padStart(3)}                                 \x1b[0m`);
    console.log(`\x1b[36m│ 📜 Antigos:  ${String(sortedHistoricalStudents.length).padStart(3)}                                 \x1b[0m`);
    console.log(`\x1b[36m│ 📊 TOTAL:    ${String(allRows.length).padStart(3)}  (Atuais A-Z → Antigos A-Z)  \x1b[0m`);
    console.log(`\x1b[36m└───────────────────────────────────────────────────────┘\x1b[0m\n`);
 
    res.status(200).json(allRows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch students by class!",
      error: error.message
    });
  }
};
 

// ──────────────────────────────────────────────────────────────
// ── GET STUDENTS (GLOBAL - sem instituição específica)
// ──────────────────────────────────────────────────────────────
const GetSTDS = async (req, res) => {
  try {
    const cacheKey = CacheKeys.allGlobal() + ":global";
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSTDS demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_students 
                   LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
                   LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle  
                   WHERE ed_student_deleted = 0 
                   ORDER BY ed_student_name ASC`;
    const PARAMS = [];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { 
      db: "eduall_students", 
      type: "select", 
      data: req 
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSTDS demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch student details!", 
      error: error.message 
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET STUDENTS BY INSTITUTE
// ──────────────────────────────────────────────────────────────
const GetStudentsByInstitute = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const instituteType = req.session.user.eduall_user_session_curentinstitute_type;
    const cacheKey = CacheKeys.list(CODE);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetStudentsByInstitute demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let query, PARAMS;

    if (instituteType * 1 === 0) {
      query = `SELECT * FROM eduall_students 
               LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
               LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle 
               WHERE ed_student_deleted = 0 AND eduall_students.ed_student_institute_code = ? 
               ORDER BY ed_student_name ASC`;
      PARAMS = [CODE];
    } else {
      query = `SELECT * FROM eduall_students 
               LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
               LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle 
               LEFT JOIN eduall_students_details ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
               WHERE ed_student_deleted = 0 AND eduall_students.ed_student_institute_code = ?  
               AND eduall_students_details.ed_detail_deleted = 0 
               ORDER BY ed_student_name ASC`;
      PARAMS = [CODE];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, true, { 
      db: "eduall_students", 
      type: "select", 
      data: req 
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudentsByInstitute demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch students by institute!", 
      error: error.message 
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET SINGLE STUDENT
// ──────────────────────────────────────────────────────────────
const GetSingleStudent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const instituteType = req.session.user.eduall_user_session_curentinstitute_type;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudent demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let query, PARAMS;

    if (instituteType * 1 === 0) {
      query = `
        SELECT * FROM eduall_students
        LEFT JOIN eduall_institutes ON ed_institute_code = ed_student_institute_code
        LEFT JOIN eduall_students_details ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
        LEFT JOIN eduall_class ON ed_class_id = ed_student_class AND ed_class_deleted = 0
        LEFT JOIN eduall_faculty ON ed_faculty_id = ed_class_faculty AND ed_faculty_deleted = 0
        LEFT JOIN eduall_classrooms ON ed_classroom_id = ed_class_room AND ed_classroom_deleted = 0
        LEFT JOIN eduall_cicles ON ed_cicle_id = ed_class_cicle AND ed_cicle_deleted = 0
        LEFT JOIN eduall_courses ON ed_course_id = ed_class_course AND ed_course_deleted = 0
        LEFT JOIN eduall_academic_level ON ed_academic_level_id = ed_class_academic_level AND ed_academic_level_deleted = 0
        LEFT JOIN eduall_academic_year ON ed_academic_year_id = ed_class_year AND ed_academic_year_deleted = 0
        WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?
      `;
      PARAMS = [ID, instituteCode];
    } else {
      query = `
        SELECT * FROM eduall_students
        LEFT JOIN eduall_students_details ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
        LEFT JOIN eduall_institutes ON ed_institute_code = ed_student_institute_code
        LEFT JOIN eduall_class ON ed_class_id = ed_student_class AND ed_class_deleted = 0
        LEFT JOIN eduall_faculty ON ed_faculty_id = ed_class_faculty AND ed_faculty_deleted = 0
        LEFT JOIN eduall_classrooms ON ed_classroom_id = ed_class_room AND ed_classroom_deleted = 0
        LEFT JOIN eduall_cicles ON ed_cicle_id = ed_class_cicle AND ed_cicle_deleted = 0
        LEFT JOIN eduall_courses ON ed_course_id = ed_class_course AND ed_course_deleted = 0
        LEFT JOIN eduall_academic_level ON ed_academic_level_id = ed_class_academic_level AND ed_academic_level_deleted = 0
        LEFT JOIN eduall_academic_year ON ed_academic_year_id = ed_class_year AND ed_academic_year_deleted = 0
        WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?
      `;
      PARAMS = [ID, instituteCode];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_students",
      type: "select",
      data: req,
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudent demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch student!",
      error: error.message,
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET SINGLE STUDENT BY IDENTITY CARD
// ──────────────────────────────────────────────────────────────
const GetSingleStudentByIdentityCard = async (req, res) => {
  try {
    const { IDENTITITYCARD } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const instituteType = req.session.user.eduall_user_session_curentinstitute_type;
    const identityCard = IDENTITITYCARD.toLowerCase();
    const cacheKey = CacheKeys.byIdentityCard(identityCard, instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudentByIdentityCard demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let query, PARAMS;

    if (instituteType * 1 === 0) {
      query = `SELECT * FROM eduall_students 
               WHERE ed_student_deleted = 0 AND ed_student_identityCard = ? 
               AND ed_student_institute_code = ?`;
      PARAMS = [identityCard, instituteCode];
    } else {
      query = `SELECT * FROM eduall_students 
               LEFT JOIN eduall_students_details ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
               WHERE ed_student_deleted = 0 AND ed_student_identityCard = ? 
               AND eduall_students_details.ed_detail_deleted = 0 
               AND ed_student_institute_code = ?`;
      PARAMS = [identityCard, instituteCode];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, true, { 
      db: "eduall_students", 
      type: "select", 
      data: req 
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudentByIdentityCard demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch student by identity card!", 
      error: error.message 
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET SINGLE STUDENT BY CODE
// ──────────────────────────────────────────────────────────────
const GetSingleStudentByCode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const cacheKey = CacheKeys.byCode(CODE);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudentByCode demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let query, PARAMS;

    if (req.session.user.eduall_user_session_curentinstitute_type * 1 === 0) {
      query = `SELECT * FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_code = ?`;
      PARAMS = [CODE];
    } else {
      query = `SELECT * FROM eduall_students LEFT JOIN eduall_students_details 
               ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
               WHERE ed_student_deleted = 0 AND eduall_students_details.ed_detail_deleted = 0 AND ed_student_code = ?`;
      PARAMS = [CODE];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, true, { 
      db: "eduall_students", 
      type: "select", 
      data: req 
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudentByCode demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch student by code!", 
      error: error.message 
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET TRANSPORT PASSENGERS BY CLASS
// ──────────────────────────────────────────────────────────────
const GetTransportPassengersByClass = async (req, res) => {
  try {
    const { CLASS } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CLASS ? CacheKeys.byClass(CLASS, institute) : CacheKeys.list(institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetTransportPassengersByClass demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let query = `
      SELECT tp.ed_transport_passenger_id, tp.ed_transport_passenger_code, tp.ed_transport_passenger_startMonth,
             s.ed_student_id, s.ed_student_name, s.ed_student_class, s.ed_student_picture,
             c.ed_class_title
      FROM eduall_transport_passengers tp
      INNER JOIN eduall_students s ON s.ed_student_id = tp.ed_transport_passenger_code
      INNER JOIN eduall_class c ON s.ed_student_class = c.ed_class_id
      WHERE tp.ed_transport_passenger_deleted = 0
        AND s.ed_student_deleted = 0
        AND tp.ed_transport_passenger_institute_code = ?
        AND s.ed_student_institute_code = ?
    `;

    const params = [institute, institute];

    if (CLASS) {
      query += ` AND s.ed_student_class = ?`;
      params.push(CLASS);
    }

    query += ` ORDER BY s.ed_student_name ASC`;

    const rows = await ExecuteQuery(res, query, params, true, { 
      db: "eduall_students", 
      type: "select", 
      data: req 
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetTransportPassengersByClass demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch transport passengers!",
      error: error.message
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET EMAILS (used for notifications, etc)
// ──────────────────────────────────────────────────────────────
const GetEmails = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = "students:emails:" + instituteCode;
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEmails demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT ed_student_id, ed_student_name, ed_student_email, 
             ed_student_father_email, ed_student_mother_email, ed_student_guardion_email
      FROM eduall_students
      WHERE ed_student_deleted = 0 
        AND ed_student_institute_code = ?
        AND ed_student_email IS NOT NULL
      ORDER BY ed_student_name ASC
    `;

    const rows = await ExecuteQuery(res, query, [instituteCode], true, {
      db: "eduall_students",
      type: "select",
      data: req,
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEmails demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch emails!",
      error: error.message,
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── REGISTER STUDENT
// ──────────────────────────────────────────────────────────────

/**
 * Cores ANSI para console colorido
 * @type {Object}
 */
const Colors = {
  RED:     '\x1b[31m',
  GREEN:   '\x1b[32m',
  YELLOW:  '\x1b[33m',
  BLUE:    '\x1b[34m',
  CYAN:    '\x1b[36m',
  GREY:    '\x1b[90m',
  RESET:   '\x1b[0m',
  BOLD:    '\x1b[1m',
  DIM:     '\x1b[2m',
};
 
/**
 * BackendErrorLogger - Sistema centralizado de logging com cores
 * 
 * Uso:
 *   BackendErrorLogger.log('REGISTER_STUDENT', error, { studentName, instituteCode });
 *   BackendErrorLogger.success('CACHE_REFRESH', { cached: 152, time: '45ms' });
 *   BackendErrorLogger.warn('MISSING_FIELD', { field: 'student_email' });
 */
const BackendErrorLogger = {
  /**
   * Log de erro (vermelho) com structure
   */
  log: (category, error, context = {}) => {
    const timestamp = new Date().toLocaleTimeString('pt-PT');
    
    console.log(`\n${Colors.RED}${Colors.BOLD}❌ ERROR${Colors.RESET} ${Colors.GREY}[${timestamp}]${Colors.RESET}`);
    console.log(`${Colors.RED}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}`);
    console.log(`${Colors.CYAN}Category:${Colors.RESET} ${Colors.BOLD}${category}${Colors.RESET}`);
    
    if (error) {
      console.log(`${Colors.CYAN}Message:${Colors.RESET} ${Colors.RED}${error.message || error}${Colors.RESET}`);
      
      if (error.code) {
        console.log(`${Colors.CYAN}Code:${Colors.RESET} ${Colors.YELLOW}${error.code}${Colors.RESET}`);
      }
      
      if (error.status) {
        console.log(`${Colors.CYAN}Status:${Colors.RESET} ${Colors.YELLOW}${error.status}${Colors.RESET}`);
      }
      
      if (error.sql) {
        console.log(`${Colors.CYAN}SQL:${Colors.RESET}`);
        console.log(`${Colors.DIM}${error.sql}${Colors.RESET}`);
      }
      
      if (error.sqlState) {
        console.log(`${Colors.CYAN}SQL State:${Colors.RESET} ${Colors.YELLOW}${error.sqlState}${Colors.RESET}`);
      }
    }
    
    if (Object.keys(context).length > 0) {
      console.log(`${Colors.CYAN}Context:${Colors.RESET}`);
      console.table(context);
    }
    
    console.log(`${Colors.RED}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}\n`);
  },
 
  /**
   * Log de sucesso (verde)
   */
  success: (category, context = {}, msg = '') => {
    const timestamp = new Date().toLocaleTimeString('pt-PT');
    
    console.log(`\n${Colors.GREEN}${Colors.BOLD}✅ SUCCESS${Colors.RESET} ${Colors.GREY}[${timestamp}]${Colors.RESET}`);
    console.log(`${Colors.GREEN}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}`);
    console.log(`${Colors.CYAN}Category:${Colors.RESET} ${Colors.BOLD}${category}${Colors.RESET}`);
    
    if (msg) {
      console.log(`${Colors.CYAN}Message:${Colors.RESET} ${Colors.GREEN}${msg}${Colors.RESET}`);
    }
    
    if (Object.keys(context).length > 0) {
      console.log(`${Colors.CYAN}Data:${Colors.RESET}`);
      console.table(context);
    }
    
    console.log(`${Colors.GREEN}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}\n`);
  },
 
  /**
   * Log de aviso (amarelo)
   */
  warn: (category, context = {}, msg = '') => {
    const timestamp = new Date().toLocaleTimeString('pt-PT');
    
    console.log(`\n${Colors.YELLOW}${Colors.BOLD}⚠️  WARN${Colors.RESET} ${Colors.GREY}[${timestamp}]${Colors.RESET}`);
    console.log(`${Colors.YELLOW}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}`);
    console.log(`${Colors.CYAN}Category:${Colors.RESET} ${Colors.BOLD}${category}${Colors.RESET}`);
    
    if (msg) {
      console.log(`${Colors.CYAN}Message:${Colors.RESET} ${Colors.YELLOW}${msg}${Colors.RESET}`);
    }
    
    if (Object.keys(context).length > 0) {
      console.log(`${Colors.CYAN}Context:${Colors.RESET}`);
      console.table(context);
    }
    
    console.log(`${Colors.YELLOW}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}\n`);
  },
 
  /**
   * Log de info (cyan)
   */
  info: (category, context = {}, msg = '') => {
    const timestamp = new Date().toLocaleTimeString('pt-PT');
    
    console.log(`\n${Colors.CYAN}${Colors.BOLD}ℹ️  INFO${Colors.RESET} ${Colors.GREY}[${timestamp}]${Colors.RESET}`);
    console.log(`${Colors.CYAN}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}`);
    console.log(`${Colors.CYAN}Category:${Colors.RESET} ${Colors.BOLD}${category}${Colors.RESET}`);
    
    if (msg) {
      console.log(`${Colors.CYAN}Message:${Colors.RESET} ${Colors.BLUE}${msg}${Colors.RESET}`);
    }
    
    if (Object.keys(context).length > 0) {
      console.log(`${Colors.CYAN}Data:${Colors.RESET}`);
      console.table(context);
    }
    
    console.log(`${Colors.CYAN}${Colors.BOLD}────────────────────────────────────────────${Colors.RESET}\n`);
  },
 
  /**
   * Get user-friendly message baseado no erro
   */
  getUserMessage: (error, operation = 'operação') => {
    if (!error) return `Erro ao ${operation}.`;
    
    const status = error.status;
    const code = error.code;
    const message = error.message || '';
 
    // SQL errors
    if (code === 'ER_DUP_ENTRY') {
      return 'Este registro já existe no sistema.';
    }
    if (code === 'ER_NO_REFERENCED_ROW' || code === 'ER_NO_REFERENCED_ROW_2') {
      return 'Referência inválida. Verifique os dados.';
    }
    if (code === 'ER_BAD_NULL_ERROR') {
      return 'Campo obrigatório não preenchido.';
    }
    if (code === 'ER_TRUNCATED_WRONG_VALUE') {
      return 'Formato de dados inválido.';
    }
    if (code?.startsWith('ER_')) {
      return 'Erro na base de dados. Tente novamente.';
    }
 
    // HTTP status
    if (status === 400) return 'Dados inválidos. Verifique todos os campos.';
    if (status === 401) return 'Sessão expirada. Por favor, faça login novamente.';
    if (status === 403) return 'Você não tem permissão para esta ação.';
    if (status === 404) return 'Recurso não encontrado.';
    if (status === 409) return 'Conflito de dados. Este registro pode já existir.';
    if (status === 500) return 'Lamentamos mas não foi possivel executar está operação . Tente novamente mais tarde.';
 
    // Connection errors
    if (message.includes('ECONNREFUSED')) return 'Base de dados indisponível.';
    if (message.includes('ENOTFOUND')) return 'Servidor não encontrado.';
    if (message.includes('TIMEOUT')) return 'Requisição expirou. Tente novamente.';
 
    // Default
    return `Não foi possível ${operation}. Tente novamente.`;
  }
};
 
// ═════════════════════════════════════════════════════════════════════════════════
//  REGISTER STUDENT COM ERRORLOGGER
// ═════════════════════════════════════════════════════════════════════════════════
  
 

 
const RegisterStudent = async (req, res) => {
  const startTime = Date.now();
  let inTransaction = false;
 
   
 
  try {
    // ── Session validation ──────────────────────────────────────────────
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute; 
 
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        msg: "Instituição não encontrada na sessão.",
      });
    }
 
    // ── Extract all fields ──────────────────────────────────────────────
    const {
      student_name,
      student_address,
      student_nacionality,
      student_gender,
      student_religion,
      student_birthday,
      student_phone,
      student_phone2,
      student_email,
      student_class,
      student_identityCard,
      student_health_problems,
      student_health_problems_description,
      student_status,
      student_naturalness,
      student_code,
      father_name,
      father_phone,
      father_email,
      father_job,
      mother_name,
      mother_phone,
      mother_email,
      mother_job,
      guardion_name,
      guardion_phone,
      guardion_email,
      guardion_job,
      guardion_degree_of_kinship,
      // ── Campos de matrícula (opcionais) ──
      student_enrollment_service,   // se vier preenchido, activa a matrícula
      // ... outros campos que tem
    } = req.body;
 
    const wantsEnrollment = !!student_enrollment_service;
 
    // Turma agora é OPCIONAL no registo do aluno.
    // '0' ou vazio conta como "sem turma atribuída".
    const hasClass = !!student_class && student_class !== '0';
 
    // ── VALIDAÇÕES ───────────────────────────────────────────────────────
    const errors = {};
 
    if (!student_name?.trim())          errors.student_name = 'Nome obrigatório';
    if (!student_address?.trim())       errors.student_address = 'Endereço obrigatório';
    if (!student_nacionality?.trim())   errors.student_nacionality = 'Nacionalidade obrigatória';
    if (!student_gender?.trim())        errors.student_gender = 'Género obrigatório';
 
    if (!student_birthday?.trim()) {
      errors.student_birthday = 'Data de nascimento obrigatória';
    } else {
      const bd = new Date(student_birthday);
      const today = new Date();
      if (isNaN(bd.getTime())) {
        errors.student_birthday = 'Data inválida';
      } else if (bd > today) {
        errors.student_birthday = 'Data não pode ser futuro';
      }
    }
 
    if (!student_phone?.trim())         errors.student_phone = 'Telefone obrigatório';
    if (!student_identityCard?.trim())  errors.student_identityCard = 'BI obrigatório';
 
    // ✅ Turma deixou de ser obrigatória para registar o aluno.
    // Mas se o utilizador pedir matrícula (wantsEnrollment), aí sim precisa de turma.
    if (!hasClass && wantsEnrollment) {
      errors.student_class = 'Turma obrigatória para efectuar a matrícula';
    }
 
    if (Object.keys(errors).length > 0) {
      console.error('VALIDACAO_FALHOU:', errors);
      return res.status(400).json({
        success: false,
        msg: 'Validação falhou. Verifique os campos obrigatórios.',
        errors: errors,
      });
    }
 
    console.log('VALIDACOES_PASSARAM: OK');
 
    // ── VALIDAÇÃO 2: Arquivo (Multer) ───────────────────────────────────
    let picturePath = null;
    if (req.file) {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimes.includes(req.file.mimetype)) {
        console.error('ARQUIVO_TIPO_INVALIDO:', req.file.mimetype);
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          success: false,
          msg: 'Tipo de ficheiro inválido. Apenas JPG, PNG, GIF e WebP.',
        });
      }
 
      const maxSize = 5 * 1024 * 1024;
      if (req.file.size > maxSize) {
        console.error('ARQUIVO_TAMANHO_INVALIDO:', req.file.size);
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          success: false,
          msg: 'Ficheiro muito grande. Máximo 5MB.',
        });
      }
 
      picturePath = "images/students/" + req.file.filename;
    }
 
    // ── Verificar duplicate BI ──────────────────────────────────────────
    const duplicateBI = await ExecuteQuery(
      res,
      `SELECT ed_student_id FROM eduall_students
       WHERE ed_student_identityCard = ?
       AND ed_student_institute_code = ?
       LIMIT 1`,
      [student_identityCard.trim(), instituteCode],
      true
    );
 
    if (duplicateBI && duplicateBI.length > 0) {
      return res.status(409).json({
        success: false,
        msg: `Bilhete de identidade ${student_identityCard} já existe no sistema.`,
      });
    }
  
    // ── Se turma foi indicada (com ou sem matrícula), validar ANTES de
    //    tocar na base de dados de escrita: existência da turma + vagas
    //    disponíveis (via checkClassCapacity). Se for pedida matrícula,
    //    validar também o serviço. ──
    let classInfo = null;
    let serviceInfo = null;
 
    if (hasClass) {
      const classRows = await ExecuteQuery(
        res,
        `SELECT ed_class_id, ed_class_title, ed_class_year, ed_class_student_limit
         FROM eduall_class
         WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
        [student_class, instituteCode],
        true
      );
 
      if (!classRows || classRows.length === 0) {
        return res.status(404).json({
          success: false,
          msg: "Turma selecionada não existe ou não pertence ao seu instituto!",
          code: "INVALID_CLASS",
        });
      }
      classInfo = classRows[0];
 
      // ── ✅ Validar limite máximo de alunos na turma (via helper) ──────
      // Aluno é novo (ainda não tem ed_student_id), por isso não há
      // excludeStudentId a passar.
      const capacity = await checkClassCapacity(res, student_class, instituteCode);
 
      if (capacity.isFull) {
        console.error(`❌ TURMA LOTADA: ${capacity.title || student_class} | ${capacity.current}/${capacity.limit}`);
        return res.status(409).json({
          success: false,
          msg: `A turma "${capacity.title || classInfo.ed_class_title}" já atingiu o limite máximo de ${capacity.limit} aluno(s).`,
          code: "CLASS_FULL",
          classId: classInfo.ed_class_id,
          maxStudents: capacity.limit,
          currentOccupancy: capacity.current,
        });
      }
 
      if (wantsEnrollment) {
        const serviceRows = await ExecuteQuery(
          res,
          `SELECT ed_service_id, ed_service_title
           FROM eduall_services
           WHERE ed_service_id = ? AND ed_service_institute_code = ?`,
          [student_enrollment_service, instituteCode],
          true
        );
 
        if (!serviceRows || serviceRows.length === 0) {
          return res.status(404).json({
            success: false,
            msg: "Serviço de matrícula selecionado não existe ou não pertence ao seu instituto!",
            code: "INVALID_SERVICE",
          });
        }
        serviceInfo = serviceRows[0];
      }
    }
 
    // ── A partir daqui: escrita na BD → usar transação ───────────────────
    await ExecuteQuery(res, "START TRANSACTION", [], false);
    inTransaction = true;
 
    // ── ✅ Reconfirmar capacidade DENTRO da transação ─────────────────────
    // Protege contra pedidos concorrentes que possam ter preenchido a
    // última vaga entre a validação inicial (acima) e este ponto.
    if (hasClass) {
      const capacityRecheck = await checkClassCapacity(res, student_class, instituteCode);
      if (capacityRecheck.isFull) {
        throw Object.assign(
          new Error(`A turma "${capacityRecheck.title || classInfo.ed_class_title}" ficou lotada enquanto este registo era processado (${capacityRecheck.current}/${capacityRecheck.limit}). Aluno NAO foi registado.`),
          { code: "CLASS_FULL", status: 409 }
        );
      }
    }
 
    // ── Generate student code ────────────────────────────────────────────
    let finalCode = String(student_code || "").trim();
 
    if (!finalCode) {
      let counter = await ExecuteQuery(
        res,
        `SELECT ed_lastest_student_code FROM eduall_institute_counters
         WHERE ed_institute_code = ? FOR UPDATE`,
        [instituteCode],
        true
      );
 
      // ── Self-healing: se o instituto ainda não tem contador criado
      //    (ex: escola nova), cria-se automaticamente com valor 0 em vez
      //    de falhar o registo do aluno. ──────────────────────────────
      if (!counter || !counter.length) {
        console.warn(`⚠️ Contador não encontrado para instituto ${instituteCode} — a criar automaticamente.`);
 
        await ExecuteQuery(
          res,
          `INSERT INTO eduall_institute_counters (ed_institute_code, ed_lastest_student_code)
           VALUES (?, 0)
           ON DUPLICATE KEY UPDATE ed_lastest_student_code = ed_lastest_student_code`,
          [instituteCode],
          false
        );
 
        counter = await ExecuteQuery(
          res,
          `SELECT ed_lastest_student_code FROM eduall_institute_counters
           WHERE ed_institute_code = ? FOR UPDATE`,
          [instituteCode],
          true
        );
 
        if (!counter || !counter.length) {
          // Só acontece se a própria criação falhar (ex: problema de permissões/BD)
          throw new Error('Contador não encontrado e não foi possível criá-lo automaticamente');
        }
      }
 
      const next = ((counter[0]?.ed_lastest_student_code ?? 0) * 1) + 1;
      finalCode = String(next).padStart(6, "0");
 
      await ExecuteQuery(
        res,
        `UPDATE eduall_institute_counters SET ed_lastest_student_code = ?
         WHERE ed_institute_code = ?`,
        [next, instituteCode],
        false
      );
    } else {
      // Código veio explícito no payload — garantir que não colide
      const dupCode = await ExecuteQuery(
        res,
        `SELECT ed_student_id FROM eduall_students
         WHERE ed_student_code = ? AND ed_student_institute_code = ? LIMIT 1`,
        [finalCode, instituteCode],
        true
      );
      if (dupCode && dupCode.length > 0) {
        throw Object.assign(
          new Error(`Já existe um estudante com a matrícula ${finalCode} neste instituto.`),
          { code: 'ER_DUP_ENTRY', status: 409 }
        );
      }
    }
 
    // ── INSERT STUDENT ────────────────────────────────────────────────────
    const insertResult = await ExecuteQuery(
      res,
      `INSERT INTO eduall_students(
        ed_student_name,
        ed_student_address,
        ed_student_nacionality,
        ed_student_gender,
        ed_student_religion,
        ed_student_birthday,
        ed_student_phone,
        ed_student_phone2,
        ed_student_email,
        ed_student_class,
        ed_student_code,
        ed_student_identityCard,
        ed_student_health_problems,
        ed_student_health_problems_description,
        ed_student_status,
        ed_student_naturalness,
        ed_student_picture,
        ed_student_institute_code,
        ed_student_type,
        ed_student_father_name,
        ed_student_father_phone,
        ed_student_father_email,
        ed_student_father_job,
        ed_student_mother_name,
        ed_student_mother_phone,
        ed_student_mother_email,
        ed_student_mother_job,
        ed_student_guardion_name,
        ed_student_guardion_phone,
        ed_student_guardion_email,
        ed_student_guardion_job,
        ed_student_guardion_degree
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        student_name,
        student_address,
        student_nacionality,
        student_gender,
        student_religion,
        student_birthday,
        student_phone,
        student_phone2,
        student_email,
        hasClass ? student_class : null,  
        finalCode,
        student_identityCard,
        student_health_problems,
        student_health_problems_description,
        student_status,
        student_naturalness,
        picturePath,
        instituteCode,
        req.session.user.eduall_user_session_curentinstitute_type || 0,
        father_name,
        father_phone,
        father_email,
        father_job,
        mother_name,
        mother_phone,
        mother_email,
        mother_job,
        guardion_name,
        guardion_phone,
        guardion_email,
        guardion_job,
        guardion_degree_of_kinship,
      ],
      false,
      {
        db: "eduall_students",
        type: "insert",
        data: { student_name, student_code: finalCode, student_identityCard },
      }
    );
 
    const studentId = insertResult.insertId;
 
    // ── MATRÍCULA (se pedida) ────────────────────────────────────────────
    let enrollmentId = null;
    let enrollmentServiceTitle = null;
 
    if (wantsEnrollment) {
      const insertEnrollment = await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_enrollment
         (ed_student_enrollment_studentcode, ed_student_enrollment_service,
          ed_student_enrollment_class, ed_enrollment_institute_code)
         VALUES (?, ?, ?, ?)`,
        [finalCode, student_enrollment_service, student_class, instituteCode],
        false,
        { db: "eduall_student_enrollment", type: "insert", data: req }
      );
 
      enrollmentId = insertEnrollment.insertId;
      enrollmentServiceTitle = serviceInfo.ed_service_title;
 
      // Marcar o aluno como matriculado (mesmo padrão usado noutros
      // endpoints de matrícula do sistema)
      await ExecuteQuery(
        res,
        `UPDATE eduall_students SET ed_student_enrolled = 1
         WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
        [studentId, instituteCode],
        false
      );
    }
 
    // ── Audit log ─────────────────────────────────────────────────────────
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Estudantes",
      description: wantsEnrollment
        ? `Registou novo estudante "${student_name}" (matrícula: ${finalCode}) e efectuou matrícula no serviço "${enrollmentServiceTitle}"${picturePath ? ' com imagem' : ''}`
        : `Registou novo estudante "${student_name}" (matrícula: ${finalCode})${picturePath ? ' com imagem' : ''}`,
    });
 
    // ── Commit ────────────────────────────────────────────────────────────
    await ExecuteQuery(res, "COMMIT", [], false);
    inTransaction = false;
 
    // ── Refresh cache (fora da transação, não é crítico) ────────────────
    await RefreshStudentCache(req, res, instituteCode);
 
    const duration = Date.now() - startTime;
 
    console.log('REGISTRO_SUCESSO:', {
      studentCode: finalCode,
      studentName: student_name,
      studentId,
      hasClass,
      enrolled: wantsEnrollment,
      enrollmentId,
      temImagem: !!picturePath,
      duration: `${duration}ms`,
    });
 
    return res.status(201).json({
      success: true,
      msg: wantsEnrollment
        ? "Estudante registado e matriculado com sucesso!"
        : (picturePath
            ? "Estudante registado com sucesso! Imagem enviada."
            : "Estudante registado com sucesso!"),
      student_code: finalCode,
      student_id: studentId,
      student_identity_card: student_identityCard,
      picture_path: picturePath,
      class_assigned: hasClass,
      class_title: hasClass ? classInfo.ed_class_title : null,
      enrolled: wantsEnrollment,
      enrollment_id: enrollmentId,
      enrollment_service: enrollmentServiceTitle,
      enrollment_class: wantsEnrollment ? classInfo.ed_class_title : null,
    });
 
  } catch (error) {
    if (inTransaction) {
      try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch (_) {}
    }
 
    const duration = Date.now() - startTime;
 
    console.error('REGISTRO_ERRO:', {
      message: error.message,
      stack: error.stack,
      studentName: req.body?.student_name,
      duration: `${duration}ms`,
    });
 
    const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
 
    return res.status(status).json({
      success: false,
      msg: error.code === 'ER_DUP_ENTRY' || error.code === 'CLASS_FULL'
        ? error.message
        : 'Erro ao registar estudante. Tente novamente.',
      error_code: error.code || 'UNKNOWN_ERROR',
    });
  }
};
 

 

 
// ─── Helper: Email validation ──
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
 
// ─── Helper: User friendly messages ──
function GetUserFriendlyMessage(error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return 'Registo duplicado. Verifique os dados.';
  }
  if (error.message.includes('FOREIGN KEY')) {
    return 'Referência inválida. Verifique os dados relacionados.';
  }
  if (error.message.includes('Contador')) {
    return 'Erro ao gerar matrícula. Contacte o suporte.';
  }
  return 'Erro ao registar estudante. Tente novamente.';
}
// ═════════════════════════════════════════════════════════════════════════════════
//  EXEMPLOS DE USO DO ERRORLOGGER
// ═════════════════════════════════════════════════════════════════════════════════
 
/**
 * Exemplo 1: Log de Sucesso
 */
const ExampleSuccess = () => {
  BackendErrorLogger.success('CACHE_REFRESH',
    {
      cached: 152,
      duration: '45ms',
      students: 3420,
    },
    'Cache de alunos atualizado'
  );
};
 
/**
 * Exemplo 2: Log de Aviso
 */
const ExampleWarn = () => {
  BackendErrorLogger.warn('SLOW_QUERY',
    {
      query: 'SELECT * FROM eduall_students WHERE ed_student_institute_code = ?',
      duration: '2340ms',
      rows: 1250,
    },
    'Query lenta detectada'
  );
};
 
/**
 * Exemplo 3: Log de Info
 */
const ExampleInfo = () => {
  BackendErrorLogger.info('SCHEDULED_JOB',
    {
      job: 'RefreshAllCaches',
      institutes: 5,
      totalStudents: 15000,
    },
    'Job agendado iniciado'
  );
};
 
/**
 * Exemplo 4: Log de Erro com SQL error
 */
const ExampleError = () => {
  const sqlError = new Error('Duplicate entry for key "primary"');
  sqlError.code = 'ER_DUP_ENTRY';
  sqlError.status = 400;
  sqlError.sql = 'INSERT INTO eduall_students (ed_student_code) VALUES (?)';
  sqlError.sqlState = '23000';
 
  BackendErrorLogger.log('REGISTER_STUDENT', sqlError,
    {
      studentCode: '000001',
      studentName: 'João Silva',
      instituteCode: 'INST-001',
    }
  );
};
 
/**
 * Exemplo 5: Get user message
 */
const ExampleGetUserMessage = () => {
  const err1 = new Error('Duplicate entry');
  err1.code = 'ER_DUP_ENTRY';
  console.log(BackendErrorLogger.getUserMessage(err1));
  // Output: "Este registro já existe no sistema."
 
  const err2 = new Error('Connection refused');
  err2.message = 'Connection ECONNREFUSED';
  console.log(BackendErrorLogger.getUserMessage(err2));
  // Output: "Base de dados indisponível."
 
  const err3 = new Error('Unknown');
  console.log(BackendErrorLogger.getUserMessage(err3, 'salvar dados'));
  // Output: "Não foi possível salvar dados. Tente novamente."
};
 

// ──────────────────────────────────────────────────────────────
// ── STUDENT UPDATE  
// ──────────────────────────────────────────────────────────────
const StudentUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      student_name, student_address, student_nacionality, student_gender,
      student_religion, student_birthday, student_phone, student_phone2,
      student_email, student_class, student_code, student_identityCard,
      student_health_problems, student_health_problems_description, student_status,
      student_naturalness, student_lastschool_course, student_lastschool_score,
      student_lastschool_formationfield, student_lastschool_conclusionyear,
      student_lifeconditions, student_socialsecurity, student_sociallevel,
      student_lastclass, student_lastschool,
      student_workstatus, student_workplace, student_worktitle,
      student_scholarshipHolder,
      // Pai
      father_name, father_phone, father_email, father_job,
      father_emergency_phone, father_address, father_is_guardion,
      // Mãe
      mother_name, mother_phone, mother_email, mother_job,
      mother_emergency_phone, mother_address, mother_is_guardion,
      // Responsável
      guardion_name, guardion_phone, guardion_email, guardion_job,
      guardion_emergency_phone, guardion_address,
      guardion_gender, guardion_degree_of_kinship, guardion_is_guardion,
    } = req.body;
 
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
 
    // ── Validação de data ────────────────────────────────────────
    const birthday = new Date(student_birthday);
    const today = new Date();
    if (isNaN(birthday.getTime()) || birthday > today) {
      return res.status(400).json({ success: false, msg: "Data de nascimento inválida." });
    }
    if ((today - birthday) / 86400000 < 4) {
      return res.status(400).json({ success: false, msg: "A data de nascimento deve ter pelo menos 4 dias." });
    }
 
    // ── Buscar estudante atual ───────────────────────────────────
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_student_code, ed_student_class
       FROM eduall_students
       WHERE ed_student_deleted = 0
         AND ed_student_id = ?
         AND ed_student_institute_code = ?`,
      [ID, instituteCode],
      true
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }
 
    const oldClass    = existing[0].ed_student_class;
    const currentCode = String(existing[0].ed_student_code || "").trim();
    let   newCode     = String(student_code || "").trim();
 
    // Turma efetivamente a mudar? (comparação solta porque um dos lados
    // pode vir como string do body e o outro como número da BD)
    const hasNewClass = !!student_class && student_class !== '0';
    const isClassChanging = hasNewClass && (!oldClass || String(oldClass) !== String(student_class));
 
    // ── ✅ NOVO — Validar existência + capacidade da turma de destino ────
    // Só faz sentido verificar quando a turma está de facto a mudar: se
    // o aluno já está nesta turma, ele já ocupa essa vaga e não há
    // necessidade (nem seria correto) reavaliar a capacidade.
    if (isClassChanging) {
      const capacity = await checkClassCapacity(res, student_class, instituteCode, ID);
 
      if (!capacity.exists) {
        return res.status(404).json({
          success: false,
          msg: "Turma selecionada não existe ou não pertence ao seu instituto!",
          code: "INVALID_CLASS",
        });
      }
 
      if (capacity.isFull) {
        console.error(`❌ TURMA LOTADA (update): ${capacity.title || student_class} | ${capacity.current}/${capacity.limit}`);
        return res.status(409).json({
          success: false,
          msg: `A turma "${capacity.title}" já atingiu o limite máximo de ${capacity.limit} aluno(s).`,
          code: "CLASS_FULL",
          maxStudents: capacity.limit,
          currentOccupancy: capacity.current,
        });
      }
    }
 
    // ── Verificar mudança de turma (histórico por ano lectivo) ─────
    if (oldClass && student_class && oldClass != student_class) {
      const [oldYear] = await ExecuteQuery(res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [oldClass], true);
      const [newYear] = await ExecuteQuery(res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [student_class], true);
      if (oldYear?.ed_class_year && newYear?.ed_class_year && oldYear.ed_class_year !== newYear.ed_class_year) {
        await ExecuteQuery(res,
          `INSERT INTO eduall_student_old_classes (ed_student_old_class_student, ed_student_old_class) VALUES (?,?)`,
          [ID, oldClass], false);
      }
    }
 
    // ── Gerar código se necessário ───────────────────────────────
    if (!newCode) {
      const counter = await ExecuteQuery(res,
        `SELECT ed_lastest_student_code FROM eduall_institute_counters WHERE ed_institute_code = ? FOR UPDATE`,
        [instituteCode], true);
      let next = ((counter[0]?.ed_lastest_student_code ?? 0) * 1) + 1;
      newCode = String(next).padStart(6, "0");
      await ExecuteQuery(res,
        `UPDATE eduall_institute_counters SET ed_lastest_student_code = ? WHERE ed_institute_code = ?`,
        [next, instituteCode], false);
    }
 
    // ── Verificar duplicação de matrícula ────────────────────────
    if (newCode !== currentCode) {
      const dup = await ExecuteQuery(res,
        `SELECT 1 FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_institute_code = ?
         AND ed_student_code = ? AND ed_student_id <> ? LIMIT 1`,
        [instituteCode, newCode, ID], true);
      if (dup.length > 0) {
        return res.status(409).json({ success: false, msg: `Já existe outro estudante com o número ${newCode}.` });
      }
    }
 
    // ── VALIDAÇÃO 3: Arquivo (Multer) ────────────────────────────────────────
    console.log('\n3️⃣  VALIDANDO ARQUIVO...');
    
    let picturePath = null;
    if (req.file) {
      console.log(`  ✅ Arquivo recebido: ${req.file.filename}`);
      console.log(`  ✅ Tipo: ${req.file.mimetype}`);
      console.log(`  ✅ Tamanho: ${(req.file.size / 1024).toFixed(2)}KB`);
      
      // Validar tipo de ficheiro (dupla verificação)
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimes.includes(req.file.mimetype)) {
        console.error('ARQUIVO_TIPO_INVALIDO:', req.file.mimetype);
        if (req.file) fs.unlink(req.file.path, (err) => {});
        return res.status(400).json({
          success: false,
          msg: 'Tipo de ficheiro inválido. Apenas JPG, PNG, GIF e WebP.',
        });
      }
 
      // Validar tamanho (máx 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (req.file.size > maxSize) {
        console.error('ARQUIVO_TAMANHO_INVALIDO:', req.file.size);
        if (req.file) fs.unlink(req.file.path, (err) => {});
        return res.status(400).json({
          success: false,
          msg: 'Ficheiro muito grande. Máximo 5MB.',
        });
      }
 
      picturePath = "images/students/" + req.file.filename;
      console.log(`  ✅ Path final: ${picturePath}`);
    } else {
      console.log(`  ⚠️  Nenhuma imagem foi enviada`);
    }
 
    const updateQuery = `
      UPDATE eduall_students SET
        ed_student_lastclass                   = ?,
        ed_student_lastschool                  = ?,
        ed_student_name                        = ?,
        ed_student_address                     = ?,
        ed_student_nacionality                 = ?,
        ed_student_gender                      = ?,
        ed_student_religion                    = ?,
        ed_student_birthday                    = ?,
        ed_student_phone                       = ?,
        ed_student_phone2                      = ?,
        ed_student_email                       = ?,
        ed_student_class                       = ?,
        ed_student_code                        = ?,
        ed_student_identityCard                = ?,
        ed_student_health_problems             = ?,
        ed_student_health_problems_description = ?,
        ed_student_status                      = ?,
        ed_student_naturalness                 = ?,
        ed_student_scholarshipHolder           = ?,
        ed_student_father_name                 = ?,
        ed_student_father_phone                = ?,
        ed_student_father_email                = ?,
        ed_student_father_job                  = ?,
        ed_student_father_emergency_phone      = ?,
        ed_student_father_address              = ?,
        ed_student_father_is_guardion          = ?,
        ed_student_mother_name                 = ?,
        ed_student_mother_phone                = ?,
        ed_student_mother_email                = ?,
        ed_student_mother_job                  = ?,
        ed_student_mother_emergency_phone      = ?,
        ed_student_mother_address              = ?,
        ed_student_mother_is_guardion          = ?,
        ed_student_guardion_name               = ?,
        ed_student_guardion_phone              = ?,
        ed_student_guardion_email              = ?,
        ed_student_guardion_job                = ?,
        ed_student_guardion_emergency_phone    = ?,
        ed_student_guardion_address            = ?,
        ed_student_guardion_gender             = ?,
        ed_student_guardion_degree             = ?,
        ed_student_guardion_is_guardion        = ?
        ${picturePath ? ", ed_student_picture = ?" : ""}
      WHERE ed_student_id = ?
        AND ed_student_deleted = 0
        AND ed_student_institute_code = ?`;
 
    await ExecuteQuery(res, updateQuery, [
      // Dados do aluno
      student_lastclass            ?? '',
      student_lastschool           ?? '',
      student_name,
      student_address,
      student_nacionality,
      student_gender,
      student_religion             ?? '',
      student_birthday,
      student_phone,
      student_phone2               ?? '',
      student_email                ?? '',
      student_class,
      newCode,
      student_identityCard,
      student_health_problems             ?? 0,
      student_health_problems_description ?? '',
      student_status               ?? 1,
      student_naturalness          ?? '',
      student_scholarshipHolder    ?? 0,
      // Pai
      father_name            ?? null,
      father_phone           ?? null,
      father_email           ?? null,
      father_job             ?? null,
      father_emergency_phone ?? null,
      father_address         ?? null,
      father_is_guardion === '1' ? 1 : 0,
      // Mãe
      mother_name            ?? null,
      mother_phone           ?? null,
      mother_email           ?? null,
      mother_job             ?? null,
      mother_emergency_phone ?? null,
      mother_address         ?? null,
      mother_is_guardion === '1' ? 1 : 0,
      // Responsável
      guardion_name              ?? null,
      guardion_phone             ?? null,
      guardion_email             ?? null,
      guardion_job               ?? null,
      guardion_emergency_phone   ?? null,
      guardion_address           ?? null,
      guardion_gender            ?? 0,
      guardion_degree_of_kinship ?? 0,
      guardion_is_guardion === '1' ? 1 : 0,
      // Foto (condicional)
      ...(picturePath ? [picturePath] : []),
      // WHERE
      ID,
      instituteCode
    ], false, { db: "eduall_students", type: "update", data: req });
 
    // ── Upsert detalhes — eduall_students_details ────────────────
    await ExecuteQuery(res,
      `INSERT INTO eduall_students_details (
         ed_detail_student_code,
         ed_detail_lastschool_course, ed_detail_lastschool_score,
         ed_detail_lastschool_formationfield, ed_detail_lastschool_conclusionyear,
         ed_detail_lifeconditions, ed_detail_socialsecurity, ed_detail_sociallevel,
         ed_detail_work, ed_detail_workplace, ed_detail_workfunction
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         ed_detail_lastschool_course         = VALUES(ed_detail_lastschool_course),
         ed_detail_lastschool_score          = VALUES(ed_detail_lastschool_score),
         ed_detail_lastschool_formationfield = VALUES(ed_detail_lastschool_formationfield),
         ed_detail_lastschool_conclusionyear = VALUES(ed_detail_lastschool_conclusionyear),
         ed_detail_lifeconditions            = VALUES(ed_detail_lifeconditions),
         ed_detail_socialsecurity            = VALUES(ed_detail_socialsecurity),
         ed_detail_sociallevel               = VALUES(ed_detail_sociallevel),
         ed_detail_work                      = VALUES(ed_detail_work),
         ed_detail_workplace                 = VALUES(ed_detail_workplace),
         ed_detail_workfunction              = VALUES(ed_detail_workfunction)`,
      [
        ID,
        student_lastschool_course         ?? null,
        student_lastschool_score          ?? null,
        student_lastschool_formationfield ?? null,
        student_lastschool_conclusionyear ?? null,
        student_lifeconditions ?? 0,
        student_socialsecurity ?? 0,
        student_sociallevel    ?? 0,
        student_workstatus     ?? 0,
        student_workplace      ?? null,
        student_worktitle      ?? null
      ], false, { db: "eduall_students_details", type: "update", data: req });
 
    // ── Auditoria ────────────────────────────────────────────────
    await RegisterAuditAction({
      session: req.session, action: 2, form: "Estudantes",
      description: `Atualizou dados do estudante #${ID} (matrícula: ${newCode})`
    });
 
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentUpdate: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);
 
    return res.status(200).json({
      success: true,
      msg: "Estudante atualizado com sucesso!",
      student_code: newCode
    });
 
  } catch (err) {
    console.error("Erro ao atualizar estudante:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};










// ──────────────────────────────────────────────────────────────
// ── STUDENT DELETE
// ──────────────────────────────────────────────────────────────
const StudentDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    
    const query = `UPDATE eduall_students SET ed_student_deleted = 1 WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?`;
    const PARAMS = [ID, instituteCode];

    const query1 = `UPDATE eduall_students_details SET ed_detail_deleted = 1 WHERE ed_detail_deleted = 0 AND ed_detail_student_code = ?`;
    const PARAMS1 = [ID];

    await ExecuteQuery(res, query1, PARAMS1, false, { 
      db: "eduall_students_details", 
      type: "update", 
      data: req 
    });
    
    const resp = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_students",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,  // Ação de delete
      form: "Estudantes",
      description: `Removeu um  estudante com o nº de matrícula #${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentDelete: registo ${ID} eliminado`);
    await RefreshStudentCache(req, res, instituteCode);

    res.status(200).json({ success: true, msg: "Student successfully deleted." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT UPDATE CLASS
// ──────────────────────────────────────────────────────────────
const StudentUpdateClass = async (req, res) => {
  try {
    const { ID } = req.params;
    const { student_class } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `UPDATE eduall_students SET ed_student_class = ?
    WHERE ed_student_deleted = 0 AND ed_student_id = ?  AND ed_student_institute_code = ?`;
    const PARAMS = [student_class, ID, instituteCode];

    await ExecuteQuery(res, query, PARAMS, false, { 
      db: "eduall_students", 
      type: "update", 
      data: req 
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,  // Ação de atualização
      form: "Estudantes",
      description: `Atualizou a turma do estudante com o nº de matrícula #${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentUpdateClass: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    res.status(200).json({ success: true, msg: "Student class updated successfully." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT UPDATE ENROLLMENT
// ──────────────────────────────────────────────────────────────
const StudentUpdateEnrollment = async (req, res) => {
  try {
    const { ID } = req.params;
    const { enrollment_service, enrollment_class } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `UPDATE eduall_students SET ed_student_enrolled_service = ?, 
     ed_student_class = ?, ed_student_enrolled = 1
     WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?`;
    const PARAMS = [enrollment_service, enrollment_class, ID, instituteCode];

    await ExecuteQuery(res, query, PARAMS, false, { 
      db: "eduall_students", 
      type: "update", 
      data: req 
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,  // Ação de atualização
      form: "Estudantes",
      description: `Atualizou os dados de matrícula do estudante com o nº de matrícula #${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentUpdateEnrollment: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    res.status(200).json({ success: true, msg: "Student enrollment updated successfully." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT ENROLLMENT CONFIRMATION UPDATE
// ──────────────────────────────────────────────────────────────
const StudentEnrollmentConfirmationUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { enrollment_service_code, enrollment_class } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `UPDATE eduall_students SET ed_student_enrolled = 2, ed_student_enrolledConfirmation_service = ?,
    ed_student_class = ? WHERE ed_student_deleted = 0 AND ed_student_id = ?`;
    const PARAMS = [enrollment_service_code, enrollment_class, ID];

    await ExecuteQuery(res, query, PARAMS, false, { 
      db: "eduall_students", 
      type: "update", 
      data: req 
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,  // Ação de atualização
      form: "Estudantes",
      description: `Atualizou os dados de confirmação de matrícula do estudante com o nº de matrícula #${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentEnrollmentConfirmationUpdate: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    res.status(200).json({ success: true, msg: "Enrollment confirmation updated successfully." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET SINGLE STUDENT BY INSTITUTE (utility)
// ──────────────────────────────────────────────────────────────
async function getSingleStudentByInstitute(instituteCode, instituteType, ID) {
  try {
    let query;
    if (instituteType === 0) {
      query = `SELECT * FROM eduall_students 
               WHERE ed_student_id = ? 
               AND ed_student_institute_code = ? 
               AND ed_student_deleted = 0`;
    } else {
      query = `SELECT * FROM eduall_students 
               LEFT JOIN eduall_students_details 
               ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id 
               WHERE ed_student_id = ? 
               AND ed_student_institute_code = ? 
               AND ed_student_deleted = 0
               AND eduall_students_details.ed_detail_deleted = 0`;
    }

    const results = await ExecuteQuery(
      null,
      query,
      [ID, instituteCode],
      true
    );

     
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error("Erro ao buscar aluno:", error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// ── UPLOAD STUDENT PICTURE
// ──────────────────────────────────────────────────────────────
const uploadStudentPicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const { studentId } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!studentId) {
      return res.status(400).json({ success: false, message: "Student ID is required" });
    }

    const picturePath = "images/students/" + req.file.filename;

    await ExecuteQuery(
      res,
      `UPDATE eduall_students 
       SET ed_student_picture = ? 
       WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
      [picturePath, studentId, instituteCode],
      false,
      { db: "eduall_students", type: "update", data: req }
    );

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> uploadStudentPicture: registo ${studentId} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Picture uploaded successfully",
      picturePath: picturePath
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to upload picture",
      error: error.message
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── DUPLICATE STUDENT
// ──────────────────────────────────────────────────────────────
const DuplicateStudent = async (req, res) => {
  const pad = (n, len) => String(n).padStart(len, "0");

  const ensureCounterRow = async (inst) => {
    const check = await ExecuteQuery(
      res,
      `SELECT 1 FROM eduall_institute_counters WHERE ed_institute_code = ? LIMIT 1`,
      [inst],
      true
    );
    if (!check.length) {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_institute_counters (ed_institute_code, ed_lastest_student_code) 
         VALUES (?, 0)`,
        [inst],
        false
      );
    }
  };

  const lockAndGenerateCode = async (inst) => {
    const row = await ExecuteQuery(
      res,
      `SELECT ed_lastest_student_code FROM eduall_institute_counters 
       WHERE ed_institute_code = ? FOR UPDATE`,
      [inst],
      true
    );

    let next = ((row[0]?.ed_lastest_student_code ?? 0) * 1) + 1;
    const codeStr = pad(next, 6);

    await ExecuteQuery(
      res,
      `UPDATE eduall_institute_counters 
          SET ed_lastest_student_code = ? 
        WHERE ed_institute_code = ?`,
      [next, inst],
      false
    );

    return codeStr;
  };

  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const instituteType = req.session.user.eduall_user_session_curentinstitute_type * 1;
    const studentId = Number(req.params.id || 0);

    if (!studentId) {
      return res.status(400).json({ success: false, msg: "Aluno inválido." });
    }

    await ensureCounterRow(instituteCode);

    await ExecuteQuery(res, "START TRANSACTION", [], false);

    const studentRows = await ExecuteQuery(
      res,
      `SELECT * 
         FROM eduall_students 
        WHERE ed_student_id = ? 
          AND ed_student_institute_code = ?
          AND ed_student_deleted = 0
        LIMIT 1`,
      [studentId, instituteCode],
      true
    );

    if (!studentRows.length) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      return res.status(404).json({ success: false, msg: "Aluno não encontrado." });
    }

    const base = studentRows[0];

    const detailsRows = await ExecuteQuery(
      res,
      `SELECT * 
         FROM eduall_students_details
        WHERE ed_detail_student_code = ?
        LIMIT 1`,
      [studentId],
      true
    );

    const details = detailsRows[0] || null;

    const newCode = await lockAndGenerateCode(instituteCode);

    const insertStudent = await ExecuteQuery(
      res,
      `INSERT INTO eduall_students (
        ed_student_lastclass,  ed_student_lastschool,
        ed_student_name, ed_student_address, ed_student_nacionality, ed_student_gender,
        ed_student_religion, ed_student_birthday, ed_student_phone, ed_student_email,
        ed_student_class, ed_student_code, ed_student_picture, ed_student_identityCard,
        ed_student_health_problems, ed_student_health_problems_description, ed_student_status,
        ed_student_naturalness, ed_student_institute_code, ed_student_type
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        base.ed_student_lastclass,
        base.ed_student_lastschool,
        base.ed_student_name,
        base.ed_student_address,
        base.ed_student_nacionality,
        base.ed_student_gender,
        base.ed_student_religion,
        base.ed_student_birthday,
        base.ed_student_phone,
        base.ed_student_email,
        base.ed_student_class,
        newCode,
        base.ed_student_picture,
        "",
        base.ed_student_health_problems,
        base.ed_student_health_problems_description,
        base.ed_student_status,
        base.ed_student_naturalness,
        instituteCode,
        instituteType,
      ],
      false,
      { db: "eduall_students", type: "insert", data: req }
    );

    const newStudentId = insertStudent.insertId;

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_students_details (
        ed_detail_student_code, ed_detail_lastschool_course, ed_detail_lastschool_score,
        ed_detail_lastschool_formationfield, ed_detail_lastschool_conclusionyear,
        ed_detail_lifeconditions, ed_detail_socialsecurity, ed_detail_sociallevel,
        ed_detail_work, ed_detail_workplace, ed_detail_workfunction
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newStudentId,
        details ? details.ed_detail_lastschool_course : "",
        details ? details.ed_detail_lastschool_score : "",
        details ? details.ed_detail_lastschool_formationfield : "",
        details ? details.ed_detail_lastschool_conclusionyear : "",
        details ? details.ed_detail_lifeconditions : "",
        details ? details.ed_detail_socialsecurity : "",
        details ? details.ed_detail_sociallevel : "",
        details ? details.ed_detail_work : "",
        details ? details.ed_detail_workplace : "",
        details ? details.ed_detail_workfunction : "",
      ],
      false,
      { db: "eduall_students_details", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Estudantes",
      description: `Duplicou estudante (${base.ed_student_name}) -> Nova Matrícula: ${newCode}`,
    });

    await ExecuteQuery(res, "COMMIT", [], false);

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DuplicateStudent: registo ${newStudentId} criado`);
    await RefreshStudentCache(req, res, instituteCode);

    return res.status(201).json({
      success: true,
      msg: "Aluno duplicado com sucesso!",
      student_id: newStudentId,
      student_code: newCode,
    });
  } catch (error) {
    try {
      await ExecuteQuery(res, "ROLLBACK", [], false);
    } catch {}
    console.error("Erro ao duplicar estudante:", error);
    return res.status(500).json({
      success: false,
      msg: "Erro ao duplicar estudante.",
      error: error.message,
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT CLASS UPDATE (Individual)
// ──────────────────────────────────────────────────────────────
const StudentClassUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { student_class } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!student_class) {
      return res.status(400).json({ success: false, msg: "Turma inválida." });
    }

    // Verificar se o estudante existe
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_class
       FROM eduall_students
       WHERE ed_student_deleted = 0
         AND ed_student_id = ?
         AND ed_student_institute_code = ?`,
      [ID, instituteCode],
      true
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    const oldClass = existing[0].ed_student_class;

    // Verificar mudança de ano letivo
    if (oldClass && student_class && oldClass != student_class) {
      const [oldYear] = await ExecuteQuery(res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [oldClass], true);
      const [newYear] = await ExecuteQuery(res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [student_class], true);
      if (oldYear?.ed_class_year && newYear?.ed_class_year && oldYear.ed_class_year !== newYear.ed_class_year) {
        await ExecuteQuery(res,
          `INSERT INTO eduall_student_old_classes (ed_student_old_class_student, ed_student_old_class) VALUES (?,?)`,
          [ID, oldClass], false);
      }
    }

    await ExecuteQuery(res,
      `UPDATE eduall_students
       SET ed_student_class = ?
       WHERE ed_student_id = ?
         AND ed_student_deleted = 0
         AND ed_student_institute_code = ?`,
      [student_class, ID, instituteCode],
      false,
      { db: "eduall_students", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Estudantes",
      description: `Atualizou turma do estudante #${ID} para a turma #${student_class}`
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentClassUpdate: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    return res.status(200).json({ success: true, msg: "Turma atualizada com sucesso!" });

  } catch (err) {
    console.error("Erro ao atualizar turma do estudante:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT BULK UPDATE
// ──────────────────────────────────────────────────────────────
const StudentBulkUpdate = async (req, res) => {
  try {
    const {
      student_ids,
      student_class,
      student_gender,
      student_status,
      student_scholarshipHolder,
    } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // ── Validações básicas ──────────────────────────────────
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ success: false, msg: "Nenhum aluno selecionado." });
    }

    const hasAnyField =
      student_class              !== undefined ||
      student_gender             !== undefined ||
      student_status             !== undefined ||
      student_scholarshipHolder  !== undefined;

    if (!hasAnyField) {
      return res.status(400).json({ success: false, msg: "Nenhum campo para atualizar foi fornecido." });
    }

    // Garantir que os IDs são números inteiros válidos
    const safeIds = student_ids
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id) && id > 0);

    if (safeIds.length === 0) {
      return res.status(400).json({ success: false, msg: "IDs de alunos inválidos." });
    }

    // ── Verificar turma (se fornecida) ─────────────────────
    if (student_class !== undefined) {
      const classExists = await ExecuteQuery(res,
        `SELECT ed_class_id FROM eduall_class WHERE ed_class_id = ? LIMIT 1`,
        [student_class], true);
      if (!classExists || classExists.length === 0) {
        return res.status(400).json({ success: false, msg: "Turma selecionada não encontrada." });
      }
    }

    // ── Construir SET dinâmico ─────────────────────────────
    const setClauses = [];
    const setValues  = [];

    if (student_class !== undefined) {
      setClauses.push("ed_student_class = ?");
      setValues.push(student_class);
    }
    if (student_gender !== undefined) {
      setClauses.push("ed_student_gender = ?");
      setValues.push(student_gender);
    }
    if (student_status !== undefined) {
      setClauses.push("ed_student_status = ?");
      setValues.push(student_status);
    }
    if (student_scholarshipHolder !== undefined) {
      setClauses.push("ed_student_scholarshipHolder = ?");
      setValues.push(student_scholarshipHolder);
    }

    // Placeholders para o IN clause
    const placeholders = safeIds.map(() => "?").join(", ");

    const updateQuery = `
      UPDATE eduall_students
      SET ${setClauses.join(", ")}
      WHERE ed_student_deleted = 0
        AND ed_student_institute_code = ?
        AND ed_student_id IN (${placeholders})`;

    await ExecuteQuery(res, updateQuery,
      [...setValues, instituteCode, ...safeIds],
      false,
      { db: "eduall_students", type: "update", data: req }
    );

    // ── Histórico de turmas (se mudou a turma) ─────────────
    if (student_class !== undefined) {
      const [newYear] = await ExecuteQuery(res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
        [student_class], true);

      if (newYear?.ed_class_year) {
        const currentClasses = await ExecuteQuery(res,
          `SELECT ed_student_id, ed_student_class
           FROM eduall_students
           WHERE ed_student_deleted = 0
             AND ed_student_institute_code = ?
             AND ed_student_id IN (${placeholders})`,
          [instituteCode, ...safeIds], true);

        for (const row of currentClasses) {
          if (!row.ed_student_class || row.ed_student_class == student_class) continue;
          const [oldYear] = await ExecuteQuery(res,
            `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
            [row.ed_student_class], true);
          if (oldYear?.ed_class_year && oldYear.ed_class_year !== newYear.ed_class_year) {
            await ExecuteQuery(res,
              `INSERT INTO eduall_student_old_classes (ed_student_old_class_student, ed_student_old_class)
               VALUES (?,?)`,
              [row.ed_student_id, row.ed_student_class], false);
          }
        }
      }
    }

    // ── Auditoria ──────────────────────────────────────────
    const fieldsChanged = [];
    if (student_class             !== undefined) fieldsChanged.push(`turma → #${student_class}`);
    if (student_gender            !== undefined) fieldsChanged.push(`género → ${student_gender}`);
    if (student_status            !== undefined) fieldsChanged.push(`status → ${student_status == 1 ? "activo" : "inactivo"}`);
    if (student_scholarshipHolder !== undefined) fieldsChanged.push(`bolseiro → ${student_scholarshipHolder == 1 ? "sim" : "não"}`);

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Estudantes",
      description: `Atualização em massa de ${safeIds.length} aluno(s): ${fieldsChanged.join(", ")} | IDs: [${safeIds.join(", ")}]`
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentBulkUpdate: ${safeIds.length} registos atualizados`);
    await RefreshStudentCache(req, res, instituteCode);

    return res.status(200).json({
      success:  true,
      msg:      `${safeIds.length} aluno(s) atualizado(s) com sucesso!`,
      updated:  safeIds.length,
    });

  } catch (err) {
    console.error("Erro na atualização em massa:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT DROPOUT UPDATE
// ──────────────────────────────────────────────────────────────
const StudentDropoutUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { dropout, dropout_date, dropout_reason } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // ── Validação básica ────────────────────────────────────
    const dropoutVal = parseInt(dropout, 10);
    if (isNaN(dropoutVal) || (dropoutVal !== 0 && dropoutVal !== 1)) {
      return res.status(400).json({
        success: false,
        msg: "Valor de dropout inválido. Use 0 (activo) ou 1 (desistente).",
      });
    }

    // ── Verificar se o estudante existe ─────────────────────
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_dropout, ed_student_transferred
       FROM eduall_students
       WHERE ed_student_deleted       = 0
         AND ed_student_id            = ?
         AND ed_student_institute_code = ?
       LIMIT 1`,
      [ID, instituteCode],
      true
    );

    if (!existing.length) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    const studentName = existing[0].ed_student_name;

    // ── Incompatibilidade: aluno já transferido não pode ser marcado
    //    como desistente (são estados mutuamente exclusivos) ─────────
    if (dropoutVal === 1 && existing[0].ed_student_transferred * 1 === 1) {
      return res.status(409).json({
        success: false,
        msg: "Este estudante está marcado como Transferido. Reverta a transferência antes de registar uma desistência.",
      });
    }

    // ── Construir SET dinâmico consoante a operação ─────────
    let query, params, auditDescription;

    if (dropoutVal === 1) {
      // Registar desistência — data e motivo obrigatórios
      if (!dropout_date || !dropout_reason || String(dropout_reason).trim() === "") {
        return res.status(400).json({
          success: false,
          msg: "Data e motivo da desistência são obrigatórios.",
        });
      }

      // Validar data (não pode ser futura)
      const parsedDate = new Date(dropout_date);
      const today      = new Date();
      today.setHours(23, 59, 59, 999);
      if (isNaN(parsedDate.getTime()) || parsedDate > today) {
        return res.status(400).json({
          success: false,
          msg: "Data de desistência inválida ou no futuro.",
        });
      }

      query = `
        UPDATE eduall_students
        SET ed_student_dropout        = 1,
            ed_student_dropout_date   = ?,
            ed_student_dropout_reason = ?
        WHERE ed_student_deleted        = 0
          AND ed_student_id             = ?
          AND ed_student_institute_code = ?`;

      params           = [dropout_date, String(dropout_reason).trim(), ID, instituteCode];
      auditDescription = `Registou desistência do estudante ${studentName} (#${ID}) — data: ${dropout_date}`;

    } else {
      // Reverter desistência — limpa data e motivo
      query = `
        UPDATE eduall_students
        SET ed_student_dropout        = 0,
            ed_student_dropout_date   = NULL,
            ed_student_dropout_reason = NULL
        WHERE ed_student_deleted        = 0
          AND ed_student_id             = ?
          AND ed_student_institute_code = ?`;

      params           = [ID, instituteCode];
      auditDescription = `Reverteu desistência do estudante ${studentName} (#${ID}) — marcado como activo`;
    }

    await ExecuteQuery(res, query, params, false, {
      db: "eduall_students", type: "update", data: req,
    });

    // ── Auditoria ────────────────────────────────────────────
    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Estudantes",
      description: auditDescription,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentDropoutUpdate: registo ${ID} atualizado`);
    await RefreshStudentCache(req, res, instituteCode);

    return res.status(200).json({
      success:        true,
      msg:            dropoutVal === 1
                        ? "Estudante marcado como desistente."
                        : "Desistência revertida. Estudante marcado como activo.",
      dropout:        dropoutVal,
      dropout_date:   dropoutVal === 1 ? dropout_date    : null,
      dropout_reason: dropoutVal === 1 ? String(dropout_reason).trim() : null,
    });

  } catch (err) {
    console.error("Erro ao actualizar estado de desistência:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── STUDENT TRANSFER UPDATE
// ──────────────────────────────────────────────────────────────
const StudentTransferUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { transferred, transfer_date, transfer_destination, transfer_reason } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // ── Validação básica do valor recebido ──────────────────────────
    const transferredVal = parseInt(transferred, 10);
    if (isNaN(transferredVal) || (transferredVal !== 0 && transferredVal !== 1)) {
      return res.status(400).json({
        success: false,
        msg: "Valor de transferred inválido. Use 0 (activo) ou 1 (transferido).",
      });
    }

    // ── Verificar se o estudante existe e obter estado actual ──────
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_transferred, ed_student_dropout
       FROM eduall_students
       WHERE ed_student_deleted        = 0
         AND ed_student_id             = ?
         AND ed_student_institute_code = ?
       LIMIT 1`,
      [ID, instituteCode],
      true
    );

    if (!existing.length) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    const studentName        = existing[0].ed_student_name;
    const alreadyTransferred = existing[0].ed_student_transferred * 1 === 1;
    const isDropout          = existing[0].ed_student_dropout * 1 === 1;

    // ── Impedir actualizações duplicadas/ inválidas ─────────────────
    if (transferredVal === 1 && alreadyTransferred) {
      return res.status(409).json({
        success: false,
        msg: "Este estudante já se encontra marcado como Transferido.",
      });
    }
    if (transferredVal === 0 && !alreadyTransferred) {
      return res.status(409).json({
        success: false,
        msg: "Este estudante não está transferido — nada para reverter.",
      });
    }

    // ── Incompatibilidade: não é possível transferir um aluno desistente ─
    if (transferredVal === 1 && isDropout) {
      return res.status(409).json({
        success: false,
        msg: "Este estudante está marcado como Desistente. Reverta a desistência antes de registar uma transferência.",
      });
    }

    let query, params, auditDescription;

    if (transferredVal === 1) {
      // ── Registar transferência — data obrigatória, destino/motivo opcionais ──
      if (!transfer_date) {
        return res.status(400).json({
          success: false,
          msg: "Data de transferência é obrigatória.",
        });
      }

      const parsedDate = new Date(transfer_date);
      const today       = new Date();
      today.setHours(23, 59, 59, 999);
      if (isNaN(parsedDate.getTime()) || parsedDate > today) {
        return res.status(400).json({
          success: false,
          msg: "Data de transferência inválida ou no futuro.",
        });
      }

      const destination = transfer_destination ? String(transfer_destination).trim() : null;
      const reason       = transfer_reason       ? String(transfer_reason).trim()       : null;

      query = `
        UPDATE eduall_students
        SET ed_student_transferred          = 1,
            ed_student_transfer_date        = ?,
            ed_student_transfer_destination = ?,
            ed_student_transfer_reason      = ?
        WHERE ed_student_deleted        = 0
          AND ed_student_id             = ?
          AND ed_student_institute_code = ?`;

      params = [transfer_date, destination, reason, ID, instituteCode];

      auditDescription =
        `Registou transferência do estudante ${studentName} (#${ID}) — data: ${transfer_date}` +
        (destination ? ` | destino: ${destination}` : "");

      await ExecuteQuery(res, query, params, false, {
        db: "eduall_students", type: "update", data: req,
      });

      // ── Histórico ────────────────────────────────────────────────
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_transfer_history
           (ed_transfer_history_student, ed_transfer_history_institute_code, ed_transfer_history_action,
            ed_transfer_history_date, ed_transfer_history_destination, ed_transfer_history_reason)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [ID, instituteCode, transfer_date, destination, reason],
        false,
        { db: "eduall_student_transfer_history", type: "insert", data: req }
      );

      await RegisterAuditAction({
        session: req.session, action: 2, form: "Estudantes", description: auditDescription,
      });

      console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentTransferUpdate: registo ${ID} transferido`);
      await RefreshStudentCache(req, res, instituteCode);

      return res.status(200).json({
        success:               true,
        msg:                   "Estudante marcado como transferido.",
        transferred:           1,
        transfer_date,
        transfer_destination:  destination,
        transfer_reason:       reason,
      });

    } else {
      // ── Reverter transferência — limpa data, destino e motivo ──────
      query = `
        UPDATE eduall_students
        SET ed_student_transferred          = 0,
            ed_student_transfer_date        = NULL,
            ed_student_transfer_destination = NULL,
            ed_student_transfer_reason      = NULL
        WHERE ed_student_deleted        = 0
          AND ed_student_id             = ?
          AND ed_student_institute_code = ?`;

      params           = [ID, instituteCode];
      auditDescription = `Reverteu transferência do estudante ${studentName} (#${ID}) — marcado como activo`;

      await ExecuteQuery(res, query, params, false, {
        db: "eduall_students", type: "update", data: req,
      });

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_transfer_history
           (ed_transfer_history_student, ed_transfer_history_institute_code, ed_transfer_history_action,
            ed_transfer_history_date)
         VALUES (?, ?, 0, CURDATE())`,
        [ID, instituteCode],
        false,
        { db: "eduall_student_transfer_history", type: "insert", data: req }
      );

      await RegisterAuditAction({
        session: req.session, action: 2, form: "Estudantes", description: auditDescription,
      });

      console.log(`🗄️🐢 BASE DE DADOS (lento) -> StudentTransferUpdate: registo ${ID} reverso`);
      await RefreshStudentCache(req, res, instituteCode);

      return res.status(200).json({
        success:               true,
        msg:                   "Transferência revertida. Estudante marcado como activo.",
        transferred:           0,
        transfer_date:         null,
        transfer_destination:  null,
        transfer_reason:       null,
      });
    }

  } catch (err) {
    console.error("Erro ao actualizar estado de transferência:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET STUDENT TRANSFER STATUS
// ──────────────────────────────────────────────────────────────
const GetStudentTransferStatus = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = "student:transfer:" + ID;
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetStudentTransferStatus demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_transferred,
              ed_student_transfer_date, ed_student_transfer_destination, ed_student_transfer_reason
         FROM eduall_students
        WHERE ed_student_id             = ?
          AND ed_student_institute_code = ?
          AND ed_student_deleted        = 0
        LIMIT 1`,
      [ID, instituteCode],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows[0], STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudentTransferStatus demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar estado de transferência!",
      error: error.message,
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET STUDENT TRANSFER HISTORY
// ──────────────────────────────────────────────────────────────
const GetStudentTransferHistory = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = "student:transfer:history:" + ID;
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetStudentTransferHistory demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT *
         FROM eduall_student_transfer_history
        WHERE ed_transfer_history_student        = ?
          AND ed_transfer_history_institute_code  = ?
        ORDER BY ed_transfer_history_created_at DESC`,
      [ID, instituteCode],
      true,
      { db: "eduall_student_transfer_history", type: "select", data: req }
    );

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudentTransferHistory demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar histórico de transferências!",
      error: error.message,
    });
  }
};

// ──────────────────────────────────────────────────────────────
// ── GET TRANSFERRED STUDENTS
// ──────────────────────────────────────────────────────────────
const GetTransferredStudents = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = "students:transferred:" + instituteCode;
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetTransferredStudents demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT s.*, c.ed_class_title
         FROM eduall_students s
         LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
        WHERE s.ed_student_deleted        = 0
          AND s.ed_student_institute_code = ?
          AND s.ed_student_transferred    = 1
        ORDER BY s.ed_student_transfer_date DESC`,
      [instituteCode],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, STUDENTS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetTransferredStudents demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar estudantes transferidos!",
      error: error.message,
    });
  }
};


const GetStudentOldClasses = async (req, res) => {
  try {
    const { student_id, student_class } = req.query; // ambos opcionais
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    let query = `SELECT * FROM eduall_student_old_classes
        WHERE ed_student_old_class_institute_code = ?`;
    const PARAMS = [instituteCode];

    if (student_id) {
      query += ` AND ed_student_old_class_student = ?`;
      PARAMS.push(student_id);
    }

    if (student_class) {
      query += ` AND ed_student_old_class = ?`;
      PARAMS.push(student_class);
    }

    query += ` ORDER BY ed_student_old_class_id DESC`;

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_students",
      type: "select",
      data: req
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetStudentOldClasses: histórico listado (student_id=${student_id || "todos"}, class=${student_class || "todas"})`);

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

module.exports = {
  GetStudents, GetSingleStudent,
  GetSingleStudentByCode, GetStudentsByClass,
  RegisterStudent, StudentDelete,
  getSingleStudentByInstitute, StudentDropoutUpdate,
  StudentUpdate, StudentUpdateClass,
  StudentUpdateEnrollment, StudentEnrollmentConfirmationUpdate,
  uploadStudentPicture, GetSingleStudentByIdentityCard, GetEmails,
  GetStudentsByInstitute, GetSTDS, GetTransportPassengersByClass,
  DuplicateStudent, StudentClassUpdate, StudentBulkUpdate,
  // Módulo de Transferência
  StudentTransferUpdate, GetStudentTransferStatus,
  GetStudentTransferHistory, GetTransferredStudents,
  GetStudentOldClasses,
  // Multer - para usar em routes
  uploadStd, SanitizeFilename, IsValidEmail, IsValidPhone, IsValidDate, ValidateAge
};