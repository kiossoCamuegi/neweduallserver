// ─────────────────────────────────────────────────────────────────────────────
//  Enrollment.js  (Backend Controller – COM CACHE INTEGRADO)
//  Handles: Enrollment CRUD + Enrollment Documents + SMS notifications
//  ✅ CACHE SYSTEM INTEGRADO (padrão AcademicYear.js)
// ─────────────────────────────────────────────────────────────────────────────

const ExecuteQuery        = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const axios               = require("axios");
const Cache = require("../Functions/CacheRoutes");

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION (same pattern as AcademicYear.js) ─────
// ──────────────────────────────────────────────────────────────
const ENROLLMENT_CACHE_TTL = 3600; // 1 hour

const CacheKeys = {
  list: (instituteCode) => `enrollment:list:${instituteCode}`,
  single: (id, instituteCode) => `enrollment:single:${id}:${instituteCode}`,
  byCode: (code, instituteCode) => `enrollment:bycode:${code}:${instituteCode}`,
  docs: (enrollmentId, instituteCode) => `enrollment:docs:${enrollmentId}:${instituteCode}`,
  allGlobal: () => "enrollment:*",
};

/**
 * ──────────────────────────────────────────────────────────────
 * REFRESH CACHE FUNCTION — called after writes
 * ──────────────────────────────────────────────────────────────
 */
const RefreshEnrollmentCache = async (req, res, instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear(CacheKeys.allGlobal());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} (Enrollment)`);
  
  const duration = Date.now() - startTime;
  console.log(`🗄️🧹 CACHE CLEAR (Enrollment) demorou ${duration}ms para institute ${instituteCode}`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET ENROLLED STUDENTS (Lista completa)
// ═══════════════════════════════════════════════════════════════════════════════

const GetEnrolledStudents = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEnrolledStudents demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT 
        e.*, s.*, c.*, ay.*, srv.*, cr.*, co.*, fc.*, coin.*, al.*
      FROM eduall_enrollment e
      LEFT JOIN eduall_students       s    ON e.ed_enrollment_student        = s.ed_student_id          AND s.ed_student_deleted        = 0
      LEFT JOIN eduall_class          c    ON c.ed_class_id                  = s.ed_student_class        AND c.ed_class_deleted           = 0
      LEFT JOIN eduall_academic_year  ay   ON ay.ed_academic_year_id         = c.ed_class_year           AND ay.ed_academic_year_deleted  = 0
      LEFT JOIN eduall_services       srv  ON srv.ed_service_id              = e.ed_enrollment_service   AND srv.ed_service_deleted        = 0
      LEFT JOIN eduall_classrooms     cr   ON cr.ed_classroom_id             = c.ed_class_room           AND cr.ed_classroom_deleted       = 0
      LEFT JOIN eduall_courses        co   ON co.ed_course_id                = c.ed_class_course         AND co.ed_course_deleted          = 0
      LEFT JOIN eduall_faculty        fc   ON fc.ed_faculty_id               = c.ed_class_faculty        AND fc.ed_faculty_deleted         = 0
      LEFT JOIN eduall_coins          coin ON coin.ed_coin_institute_code    = ?                         AND coin.ed_coin_deleted          = 0
      LEFT JOIN eduall_academic_level al   ON al.ed_academic_level_id        = c.ed_class_academic_level AND al.ed_academic_level_deleted  = 0
      WHERE e.ed_enrollment_deleted    = 0
        AND e.ed_enrollment_institute_code = ?
      ORDER BY s.ed_student_name ASC
    `;
    const PARAMS = [instituteCode, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_enrollment", type: "select", data: req });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, ENROLLMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEnrolledStudents demorou ${duration}ms (${cacheKey})`);
    console.log("Dados =", rows.length);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ status: 500, success: false, message: "Erro ao buscar os alunos matriculados!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE ENROLLED STUDENT
// ═══════════════════════════════════════════════════════════════════════════════

const GetSingleEnrolledStudent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();
    console.log(`%cID A PROCURAR = ${ID}`, "color: #ff69b4; font-size: 14px; font-weight: bold;");
    console.log(`%cID DA ESCOLA = ${instituteCode}`, "color: #8a69ff; font-size: 14px; font-weight: bold;");

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleEnrolledStudent demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_enrollment
      LEFT JOIN eduall_students       ON eduall_enrollment.ed_enrollment_student = eduall_students.ed_student_id
      LEFT JOIN eduall_class          ON eduall_class.ed_class_id               = eduall_students.ed_student_class
      LEFT JOIN eduall_academic_year  ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_services       ON eduall_services.ed_service_id          = eduall_enrollment.ed_enrollment_service
      LEFT JOIN eduall_classrooms     ON eduall_classrooms.ed_classroom_id      = eduall_class.ed_class_room
      LEFT JOIN eduall_courses        ON eduall_courses.ed_course_id            = eduall_class.ed_class_course
      LEFT JOIN eduall_faculty        ON eduall_faculty.ed_faculty_id           = eduall_class.ed_class_faculty
      LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_year
      WHERE ed_enrollment_deleted = 0
        AND ed_enrollment_student = ?
        AND ed_enrollment_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_enrollment", type: "select", data: req });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, ENROLLMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleEnrolledStudent demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ status: 500, success: false, message: "Erro ao buscar o aluno matriculado!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE ENROLLED STUDENT BY CODE
// ═══════════════════════════════════════════════════════════════════════════════

const GetSingleEnrolledStudentByCode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.byCode(CODE, instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleEnrolledStudentByCode demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_enrollment
      WHERE ed_enrollment_deleted = 0
        AND ed_enrollment_student = ?
        AND ed_enrollment_institute_code = ?
    `;
    const PARAMS = [CODE, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_enrollment", type: "select", data: req });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, ENROLLMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleEnrolledStudentByCode demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ status: 500, success: false, msg: "Erro ao buscar o aluno matriculado pelo código!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── REGISTER ENROLLMENT
// ═══════════════════════════════════════════════════════════════════════════════

const RegisterEnrollment = async (req, res) => {
  // ============================================================
  // Cores ANSI (sem dependências externas)
  // ============================================================
  const C = {
    reset:   "\x1b[0m",
    bold:    "\x1b[1m",
    dim:     "\x1b[2m",

    green:   "\x1b[32m",
    cyan:    "\x1b[36m",
    yellow:  "\x1b[33m",
    red:     "\x1b[31m",
    magenta: "\x1b[35m",
    blue:    "\x1b[34m",
    white:   "\x1b[37m",

    bgGreen: "\x1b[42m\x1b[30m",
    bgRed:   "\x1b[41m\x1b[37m",
  };

  // Imprime um "cartão" colorido no console com os dados da matrícula de um aluno
  function printEnrollmentCard({ student, enrollment, service, newClass, oldClass, docsCount, classChanged }) {
    const idOk = !!enrollment?.ed_enrollment_id;

    const statusTag = idOk
      ? `${C.bgGreen} ✔ MATRÍCULA CONFIRMADA ${C.reset}`
      : `${C.bgRed} ✖ FALHA AO CONFIRMAR ${C.reset}`;

    console.log(`\n${C.cyan}┌───────────────────────────────────────────────────────────┐${C.reset}`);
    console.log(`${C.cyan}│${C.reset} ${C.bold}${C.white}👤 ${student.ed_student_name}${C.reset}`);
    console.log(`${C.cyan}│${C.reset} ${C.dim}Código:${C.reset} ${C.yellow}${student.ed_student_id}${C.reset}   ${statusTag}`);
    console.log(`${C.cyan}├───────────────────────────────────────────────────────────┤${C.reset}`);
    console.log(
      `${C.cyan}│${C.reset} ${C.magenta}🏫 Turma:${C.reset} ${
        classChanged
          ? `${C.dim}${oldClass ?? "—"}${C.reset} ${C.blue}→${C.reset} ${C.green}${newClass}${C.reset}`
          : `${C.green}${newClass}${C.reset} ${C.dim}(sem alteração)${C.reset}`
      }`
    );
    console.log(`${C.cyan}│${C.reset} ${C.magenta}📄 Serviço:${C.reset} ${C.white}${service}${C.reset}`);
    console.log(
      `${C.cyan}│${C.reset} ${C.magenta}🆔 ID Matrícula:${C.reset} ${
        idOk ? C.green + enrollment.ed_enrollment_id + C.reset : C.red + "N/D" + C.reset
      }`
    );
    console.log(`${C.cyan}│${C.reset} ${C.magenta}📎 Documentos anexados:${C.reset} ${C.white}${docsCount}${C.reset}`);
    console.log(`${C.cyan}└───────────────────────────────────────────────────────────┘${C.reset}`);
  }

  // Imprime o resumo geral no final
  function printSummaryBanner({ total, confirmed, failed, alreadyEnrolledCount }) {
    const allOk = failed === 0;
    console.log(`\n${allOk ? C.green : C.red}${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}${allOk ? C.green + "✔ RESUMO DA OPERAÇÃO" : C.red + "⚠ RESUMO DA OPERAÇÃO (COM FALHAS)"}${C.reset}`);
    console.log(`${C.dim}───────────────────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.white}Total processado:${C.reset}      ${total}`);
    console.log(`  ${C.green}Matrículas confirmadas:${C.reset} ${confirmed}`);
    if (failed > 0) console.log(`  ${C.red}Falhas na confirmação:${C.reset}   ${failed}`);
    if (alreadyEnrolledCount > 0)
      console.log(`  ${C.yellow}Já matriculados (ignorados):${C.reset} ${alreadyEnrolledCount}`);
    console.log(`${allOk ? C.green : C.red}${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);
  }

  // ============================================================
  // Lógica principal
  // ============================================================
  try {
    const students  = req.body.enrollment_students || [req.body.enrollment_student];
    const service   = req.body.enrollment_service;
    const newClass  = req.body.enrollment_class;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const docsPayload = Array.isArray(req.body.enrollment_docs) ? req.body.enrollment_docs : [];

    if (!students || students.length === 0)
      return res.status(400).json({ success: false, msg: "Nenhum estudante selecionado!" });

    // Buscar estudantes
    const studentRows = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_code, ed_student_name, ed_student_class
       FROM eduall_students
       WHERE ed_student_deleted = 0
         AND ed_student_institute_code = ?
         AND ed_student_id IN (${students.map(() => "?").join(",")})`,
      [institute, ...students],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (!studentRows || studentRows.length === 0)
      return res.status(404).json({ success: false, msg: "Nenhum estudante encontrado!" });

    // Verificar já matriculados
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_student FROM eduall_enrollment
       WHERE ed_enrollment_deleted = 0
         AND ed_enrollment_institute_code = ?
         AND ed_enrollment_student IN (${students.map(() => "?").join(",")})`,
      [institute, ...students],
      true,
      { db: "eduall_enrollment", type: "select", data: req }
    );

    const alreadyEnrolledIds = new Set(existing.map(e => e.ed_enrollment_student));
    const toEnroll        = studentRows.filter(s => !alreadyEnrolledIds.has(s.ed_student_id));
    const alreadyEnrolled = studentRows.filter(s =>  alreadyEnrolledIds.has(s.ed_student_id));

    if (toEnroll.length === 0)
      return res.status(200).json({
        success: false,
        msg: `Os ${alreadyEnrolled.length} estudante(s) selecionados já estão matriculados!`,
      });

    // Ano lectivo da nova turma
    const newClassYear = await ExecuteQuery(
      res,
      `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
      [newClass]
    );

    // Inserir matrículas
    const valuesPlaceholders = toEnroll.map(() => "(?, ?, ?)").join(",");
    const insertParams = [];
    toEnroll.forEach(s => insertParams.push(s.ed_student_id, service, institute));

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_enrollment(ed_enrollment_student, ed_enrollment_service, ed_enrollment_institute_code)
       VALUES ${valuesPlaceholders}`,
      insertParams,
      false,
      { db: "eduall_enrollment", type: "insert", data: req }
    );

    // Buscar IDs das matrículas recém-criadas para associar documentos
    // *** Esta consulta é também a nossa GARANTIA de que a matrícula foi realmente gravada ***
    const insertedEnrollments = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_id, ed_enrollment_student FROM eduall_enrollment
       WHERE ed_enrollment_deleted = 0
         AND ed_enrollment_institute_code = ?
         AND ed_enrollment_student IN (${toEnroll.map(() => "?").join(",")})
       ORDER BY ed_enrollment_id DESC`,
      [institute, ...toEnroll.map(s => s.ed_student_id)],
      true,
      { db: "eduall_enrollment", type: "select", data: req }
    );

    // ------------------------------------------------------------
    // VERIFICAÇÃO DE INTEGRIDADE: cada aluno de toEnroll TEM de ter
    // uma matrícula correspondente em insertedEnrollments.
    // ------------------------------------------------------------
    const missingEnrollments = toEnroll.filter(
      s => !insertedEnrollments.some(e => e.ed_enrollment_student == s.ed_student_id)
    );

    if (missingEnrollments.length > 0) {
      console.log(
        `${C.bgRed} ⚠ ATENÇÃO ${C.reset} ${C.red}${missingEnrollments.length} aluno(s) NÃO tiveram a matrícula confirmada na base de dados:${C.reset}`
      );
      missingEnrollments.forEach(s =>
        console.log(`   ${C.red}✖ ${s.ed_student_name} (cod: ${s.ed_student_id})${C.reset}`)
      );
    }

    // Processar turmas dos estudantes
    const cardData = [];

    for (const student of toEnroll) {
      const oldClass = student.ed_student_class;
      let classChanged = false;

      if (oldClass && oldClass != newClass) {
        classChanged = true;
        const oldClassYear = await ExecuteQuery(
          res,
          `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
          [oldClass]
        );
        if (
          oldClassYear.length &&
          newClassYear.length &&
          oldClassYear[0].ed_class_year !== newClassYear[0].ed_class_year
        ) {
          await ExecuteQuery(
            res,
            `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) VALUES (?, ?)`,
            [student.ed_student_id, oldClass]
          );
        }
      }

      await ExecuteQuery(
        res,
        `UPDATE eduall_students SET ed_student_class = ? WHERE ed_student_id = ?`,
        [newClass, student.ed_student_id]
      );

      const enrollment = insertedEnrollments.find(
        e => e.ed_enrollment_student == student.ed_student_id
      );

      // Inserir documentos para cada matrícula criada (se existirem no payload)
      if (docsPayload.length > 0 && enrollment) {
        for (const doc of docsPayload) {
          await ExecuteQuery(
            res,
            `INSERT INTO eduall_enrollment_docs
             (ed_enroll_doc_enrollment, ed_enroll_doc_name, ed_enroll_doc_status,
              ed_enroll_doc_file, ed_enroll_doc_file_name, ed_enroll_doc_institute)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              enrollment.ed_enrollment_id,
              doc.name   || "Documento",
              doc.status ?? 0,
              doc.file   || null,
              doc.fileName || null,
              institute,
            ]
          );
        }
      }

      cardData.push({
        student,
        enrollment,
        service,
        newClass,
        oldClass,
        docsCount: enrollment ? docsPayload.length : 0,
        classChanged,
      });
    }

    // ------------------------------------------------------------
    // Console colorido, um cartão por aluno
    // ------------------------------------------------------------
    cardData.forEach(printEnrollmentCard);

    printSummaryBanner({
      total: toEnroll.length,
      confirmed: toEnroll.length - missingEnrollments.length,
      failed: missingEnrollments.length,
      alreadyEnrolledCount: alreadyEnrolled.length,
    });

    // Auditoria
    Promise.all(
      toEnroll.map(student =>
        RegisterAuditAction({
          session:     req.session,
          action:      1,
          form:        "Matrículas",
          description: `Registrou matrícula para o estudante nº #${student.ed_student_code} – ${student.ed_student_name}`,
        })
      )
    ).catch(err => console.error("Erro ao registar auditoria:", err));

    await RefreshEnrollmentCache(req, res, institute);

    // Se houve falhas de confirmação, devolvemos isso na resposta também
    if (missingEnrollments.length > 0) {
      return res.status(207).json({
        success: true,
        msg: `Matrícula processada, mas ${missingEnrollments.length} aluno(s) não foram confirmados na base de dados. Verifique os logs.`,
        failedStudents: missingEnrollments.map(s => ({
          id: s.ed_student_id,
          code: s.ed_student_code,
          name: s.ed_student_name,
        })),
      });
    }

    const message =
      alreadyEnrolled.length > 0
        ? `Matrícula efetuada para ${toEnroll.length} estudante(s). ${alreadyEnrolled.length} já estavam matriculados e foram ignorados.`
        : `Matrícula efetuada com sucesso para ${toEnroll.length} estudante(s)!`;

    return res.status(200).json({ success: true, msg: message });

  } catch (error) {
    console.error(`\x1b[41m\x1b[37m ✖ ERRO \x1b[0m \x1b[31mErro ao registar matrículas: ${error.message}\x1b[0m`);
    res.status(500).json({ success: false, msg: "Erro ao efetuar matrícula!", error: error.message });
  }
};

module.exports = { RegisterEnrollment };

// ═══════════════════════════════════════════════════════════════════════════════
// ── DELETE ENROLLED STUDENT
// ═══════════════════════════════════════════════════════════════════════════════

const EnrolledStudentDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query  = `UPDATE eduall_enrollment SET ed_enrollment_deleted = 1
                    WHERE ed_enrollment_deleted = 0 AND ed_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
    const PARAMS = [ID, instituteCode];
    await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_enrollment", type: "update", data: req });

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Matrículas",
      description: `Eliminou a matrícula do estudante com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EnrolledStudentDelete: registo ${ID} eliminado`);
    await RefreshEnrollmentCache(req, res, instituteCode);

    res.status(200).json({ status: 200, success: true, message: "Matrícula deletada com sucesso!" });
  } catch (error) {
    res.status(500).json({ status: 500, success: false, message: "Erro ao deletar matrícula!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── UPDATE ENROLLED STUDENT
// ═══════════════════════════════════════════════════════════════════════════════

const EnrolledStudentUpdate = async (req, res) => {
  try {
    const { ID }     = req.params;
    const { enrollment_class, enrollment_service } = req.body;
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    const enrollment = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_student FROM eduall_enrollment
       WHERE ed_enrollment_deleted = 0 AND ed_enrollment_id = ? AND ed_enrollment_institute_code = ?`,
      [ID, institute]
    );

    if (!enrollment.length)
      return res.status(404).json({ success: false, message: "Matrícula não encontrada." });

    const studentId = enrollment[0].ed_enrollment_student;

    const student = await ExecuteQuery(
      res,
      `SELECT ed_student_class FROM eduall_students WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
      [studentId, institute]
    );

    const oldClass = student[0]?.ed_student_class;

    if (oldClass && oldClass != enrollment_class) {
      const oldClassYear = await ExecuteQuery(res, `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [oldClass]);
      const newClassYear = await ExecuteQuery(res, `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`, [enrollment_class]);

      if (
        oldClassYear.length && newClassYear.length &&
        oldClassYear[0].ed_class_year !== newClassYear[0].ed_class_year
      ) {
        await ExecuteQuery(
          res,
          `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) VALUES (?, ?)`,
          [studentId, oldClass]
        );
      }
    }

    await ExecuteQuery(res, `UPDATE eduall_students SET ed_student_class = ? WHERE ed_student_id = ?`, [enrollment_class, studentId]);

    await ExecuteQuery(
      res,
      `UPDATE eduall_enrollment SET ed_enrollment_service = ?
       WHERE ed_enrollment_deleted = 0 AND ed_enrollment_id = ? AND ed_enrollment_institute_code = ?`,
      [enrollment_service, ID, institute],
      false,
      { db: "eduall_enrollment", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Matrículas",
      description: `Atualizou matrícula do estudante com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EnrolledStudentUpdate: registo ${ID} atualizado`);
    await RefreshEnrollmentCache(req, res, institute);

    res.status(200).json({ status: 200, success: true, message: "Matrícula atualizada com sucesso!" });

  } catch (error) {
    res.status(500).json({ status: 500, success: false, message: "Erro ao atualizar matrícula!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── GET ENROLLMENT DOCS
// ═══════════════════════════════════════════════════════════════════════════════

const GetEnrollmentDocs = async (req, res) => {
  try {
    const { ENROLLMENT_ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.docs(ENROLLMENT_ID, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEnrollmentDocs demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_enrollment_docs
       WHERE ed_enroll_doc_deleted = 0
         AND ed_enroll_doc_enrollment = ?
         AND ed_enroll_doc_institute  = ?
       ORDER BY ed_enroll_doc_id ASC`,
      [ENROLLMENT_ID, institute],
      true,
      { db: "eduall_enrollment_docs", type: "select", data: req }
    );

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, ENROLLMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEnrollmentDocs demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao buscar documentos!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── ADD ENROLLMENT DOC
// ═══════════════════════════════════════════════════════════════════════════════

const AddEnrollmentDoc = async (req, res) => {
  try {
    const { enrollment_id, doc_name, doc_status, doc_file, doc_file_name } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!enrollment_id || !doc_name)
      return res.status(400).json({ success: false, msg: "Dados insuficientes!" });

    // Validate file size (base64 ~4/3 of original, 3MB → ~4MB base64)
    if (doc_file && doc_file.length > 4 * 1024 * 1024)
      return res.status(400).json({ success: false, msg: "Ficheiro excede o tamanho máximo de 3 MB!" });

    // Validate file type (data-url must be image or pdf)
    if (doc_file) {
      const allowed = ["data:image/", "data:application/pdf"];
      const isAllowed = allowed.some(prefix => doc_file.startsWith(prefix));
      if (!isAllowed)
        return res.status(400).json({ success: false, msg: "Tipo de ficheiro não permitido! Apenas imagens ou PDF." });
    }

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_enrollment_docs
       (ed_enroll_doc_enrollment, ed_enroll_doc_name, ed_enroll_doc_status,
        ed_enroll_doc_file, ed_enroll_doc_file_name, ed_enroll_doc_institute)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [enrollment_id, doc_name, doc_status ?? 0, doc_file || null, doc_file_name || null, institute],
      false,
      { db: "eduall_enrollment_docs", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Documentos de Matrícula",
      description: `Adicionou documento "${doc_name}" à matrícula ID ${enrollment_id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AddEnrollmentDoc: documento adicionado à matrícula ${enrollment_id}`);
    await RefreshEnrollmentCache(req, res, institute);

    res.status(200).json({ success: true, msg: "Documento adicionado com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao adicionar documento!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── UPDATE ENROLLMENT DOC
// ═══════════════════════════════════════════════════════════════════════════════

const UpdateEnrollmentDoc = async (req, res) => {
  try {
    const { DOC_ID }  = req.params;
    const { doc_status, doc_name, doc_file, doc_file_name } = req.body;
    const institute   = req.session.user.eduall_user_session_curentinstitute;

    // Build dynamic SET clause
    const fields  = [];
    const params  = [];

    if (doc_status !== undefined) { fields.push("ed_enroll_doc_status = ?");    params.push(doc_status);    }
    if (doc_name)                 { fields.push("ed_enroll_doc_name = ?");       params.push(doc_name);      }
    if (doc_file !== undefined)   { fields.push("ed_enroll_doc_file = ?");       params.push(doc_file);      }
    if (doc_file_name)            { fields.push("ed_enroll_doc_file_name = ?");  params.push(doc_file_name); }

    if (fields.length === 0)
      return res.status(400).json({ success: false, msg: "Nenhum campo para atualizar!" });

    params.push(DOC_ID, institute);

    await ExecuteQuery(
      res,
      `UPDATE eduall_enrollment_docs SET ${fields.join(", ")}
       WHERE ed_enroll_doc_id = ? AND ed_enroll_doc_institute = ? AND ed_enroll_doc_deleted = 0`,
      params,
      false,
      { db: "eduall_enrollment_docs", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Documentos de Matrícula",
      description: `Atualizou documento ID ${DOC_ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateEnrollmentDoc: documento ${DOC_ID} atualizado`);
    await RefreshEnrollmentCache(req, res, institute);

    res.status(200).json({ success: true, msg: "Documento atualizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao atualizar documento!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── DELETE ENROLLMENT DOC
// ═══════════════════════════════════════════════════════════════════════════════

const DeleteEnrollmentDoc = async (req, res) => {
  try {
    const { DOC_ID } = req.params;
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    await ExecuteQuery(
      res,
      `UPDATE eduall_enrollment_docs SET ed_enroll_doc_deleted = 1
       WHERE ed_enroll_doc_id = ? AND ed_enroll_doc_institute = ?`,
      [DOC_ID, institute],
      false,
      { db: "eduall_enrollment_docs", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Documentos de Matrícula",
      description: `Removeu documento ID ${DOC_ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteEnrollmentDoc: documento ${DOC_ID} eliminado`);
    await RefreshEnrollmentCache(req, res, institute);

    res.status(200).json({ success: true, msg: "Documento removido com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao remover documento!", error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── SMS SEND (sem cache - operação especial)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST  /eduallsms/send
 * Body (option A – direct phone): { phone, message }
 * Body (option B – by student):   { student_id, message, doc_name? }
 * Body (option C – batch):        { student_ids: [], message, doc_name? }
 */
const SendSms = async (req, res) => {
  try {
    const { phone, message, student_id, student_ids } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!message || !message.trim())
      return res.status(400).json({ success: false, msg: "Mensagem não pode estar vazia!" });

    // Block links
    if (/(https?:\/\/[^\s]+)/gi.test(message))
      return res.status(400).json({ success: false, msg: "Não é permitido enviar mensagens com links!" });

    // ── Helper: check credits ─────────────────────────────────────────────
    const calculateSmsParts = (msg) => {
      const isSpecialChar = /[^\x00-\x7F]/.test(msg);
      const maxLen = isSpecialChar ? 70 : 160;
      return Math.ceil(msg.length / maxLen);
    };

    const creditRows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ?`,
      [institute],
      true,
      { db: "eduall_sms_credits", type: "select", data: req }
    );

    if (!creditRows || creditRows.length === 0) {
      await RegisterSentMessage(req, res, institute, 1, message);
      return res.status(400).json({ success: false, msg: "Créditos não encontrados!" });
    }

    const smsParts      = calculateSmsParts(message);
    const currentCredits = creditRows[0].ed_sms_credit_total * 1;

    // ── Build list of phone numbers to send ──────────────────────────────
    let phones = [];

    if (phone) {
      // Direct phone number provided
      phones = [phone.replace(/\s+/g, "")];
    } else if (student_id) {
      // Single student – fetch phone from DB
      const sRow = await ExecuteQuery(
        res,
        `SELECT ed_student_phone FROM eduall_students WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
        [student_id, institute],
        true,
        { db: "eduall_students", type: "select", data: req }
      );
      if (!sRow.length || !sRow[0].ed_student_phone)
        return res.status(404).json({ success: false, msg: "Número do aluno não encontrado!" });
      phones = [sRow[0].ed_student_phone.replace(/\s+/g, "")];
    } else if (Array.isArray(student_ids) && student_ids.length > 0) {
      // Batch – fetch phones for all students
      const sRows = await ExecuteQuery(
        res,
        `SELECT ed_student_phone FROM eduall_students
         WHERE ed_student_deleted = 0
           AND ed_student_institute_code = ?
           AND ed_student_id IN (${student_ids.map(() => "?").join(",")})`,
        [institute, ...student_ids],
        true,
        { db: "eduall_students", type: "select", data: req }
      );
      phones = sRows
        .map(r => r.ed_student_phone?.replace(/\s+/g, ""))
        .filter(Boolean);
    } else {
      return res.status(400).json({ success: false, msg: "Destinatário não especificado!" });
    }

    if (phones.length === 0)
      return res.status(400).json({ success: false, msg: "Nenhum número de telefone válido encontrado!" });

    // ── Validate credit sufficiency for all sends ─────────────────────────
    const totalParts = smsParts * phones.length;
    if (currentCredits < totalParts) {
      await RegisterSentMessage(req, res, institute, 1, message);
      return res.status(400).json({
        success: false,
        msg: `Os seus créditos (${currentCredits}) não são suficientes para enviar para ${phones.length} número(s)!`,
      });
    }

    // ── Send to each number ───────────────────────────────────────────────
    const results = { sent: 0, failed: 0, invalid: 0 };

    for (const num of phones) {
      const isValido = /^9\d{8}$/.test(num);
      if (!isValido) {
        results.invalid++;
        await RegisterSentMessage(req, res, institute, 1, message, num);
        continue;
      }

      try {
        const { status } = await axios.post("https://www.telcosms.co.ao/send_message", {
          message: {
            api_key_app:  "prdd0cf231ad82fcfa9c4c8654742",
            phone_number: num,
            message_body: message,
          },
        }, { headers: { "Content-Type": "application/json" } });

        if (status === 200 || status === 201) {
          await RegisterSentMessage(req, res, institute, 0, message, num);
          // Deduct credits
          await ExecuteQuery(
            res,
            `UPDATE eduall_sms_credits
             SET ed_sms_credit_total = ed_sms_credit_total - ?
             WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`,
            [smsParts, institute, smsParts]
          );
          results.sent++;
        } else {
          await RegisterSentMessage(req, res, institute, 1, message, num);
          results.failed++;
        }
      } catch {
        await RegisterSentMessage(req, res, institute, 1, message, num);
        results.failed++;
      }
    }

    const successMsg =
      results.sent === phones.length
        ? "Mensagem(ns) enviada(s) com sucesso!"
        : `Enviadas: ${results.sent} | Falhadas: ${results.failed} | Inválidas: ${results.invalid}`;

    res.status(200).json({ success: true, msg: successMsg, results });

  } catch (error) {
    console.error("❌ Erro ao enviar SMS:", error.message);
    res.status(500).json({ success: false, msg: "Erro interno ao enviar a mensagem!" });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── HELPER: Register sent SMS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper – register sent/failed message in the eduall_sms_sent_messages table
 */
const RegisterSentMessage = async (req, res, institute, status, message, phone = null) => {
  try {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_sms_sent_messages
       (ed_sms_message_institute, ed_sms_message_status, ed_sms_message_body, ed_sms_message_phone)
       VALUES (?, ?, ?, ?)`,
      [institute, status, message, phone],
      false,
      { db: "eduall_sms_sent_messages", type: "insert", data: req }
    );
  } catch (err) {
    console.error("Erro ao registar mensagem enviada:", err.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Enrollment
  GetEnrolledStudents,
  GetSingleEnrolledStudent,
  GetSingleEnrolledStudentByCode,
  RegisterEnrollment,
  EnrolledStudentDelete,
  EnrolledStudentUpdate,

  // Enrollment Documents
  GetEnrollmentDocs,
  AddEnrollmentDoc,
  UpdateEnrollmentDoc,
  DeleteEnrollmentDoc,

  // SMS
  SendSms,
};