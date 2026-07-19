const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");

const ADMISSION_CACHE_TTL = 3600;

/** ---------------------------------------------------------------------
 *  Chaves de cache, uma "família" por entidade, para poder limpar cada
 *  uma sem afetar as outras (ex: registar um exame não deve limpar a
 *  cache dos alunos).
 * --------------------------------------------------------------------- */
const StudentCacheKeys = {
  list: (instituteCode) => `admission_student:list:${instituteCode}`,
  single: (id, instituteCode) => `admission_student:single:${id}:${instituteCode}`,
  all: () => "admission_student:*",
};

const ExamCacheKeys = {
  list: (instituteCode) => `admission_exam:list:${instituteCode}`,
  single: (id, instituteCode) => `admission_exam:single:${id}:${instituteCode}`,
  all: () => "admission_exam:*",
};

const ExamSubjectCacheKeys = {
  list: (instituteCode) => `admission_exam_subject:list:${instituteCode}`,
  byExam: (code, instituteCode) => `admission_exam_subject:by_exam:${code}:${instituteCode}`,
  all: () => "admission_exam_subject:*",
};

const ResultCacheKeys = {
  list: (instituteCode) => `admission_result:list:${instituteCode}`,
  single: (id, instituteCode) => `admission_result:single:${id}:${instituteCode}`,
  all: () => "admission_result:*",
};

/** =======================================================================
 *  1 --- STUDENT ADMISSION
 * ======================================================================= */

const FetchAdmissionStudents = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_admission_students         
    LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_admission_students.ed_adm_academic_course
    LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_admission_students.ed_adm_academic_level 
    LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_admission_students.ed_adm_academic_year
    WHERE ed_adm_academic_deleted = 0 AND ed_adm_academic_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_admission_students", type: "select", data: req });
};

const RefreshAdmissionStudentCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(StudentCacheKeys.all());
  console.log(`📦🧹 CACHE -> admission_student limpa para institute ${instituteCode}`);

  const rows = await FetchAdmissionStudents(req, res, instituteCode);
  await Cache.eduallSet(StudentCacheKeys.list(instituteCode), rows, ADMISSION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> admission_student reposta em ${duration}ms`);

  return rows;
};

const GetAdmissionStudents = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = StudentCacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAdmissionStudents demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAdmissionStudents(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAdmissionStudents demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const RegisterAdmissionStudent = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `INSERT INTO eduall_admission_students (ed_adm_academic_full_name, ed_adm_academic_birth_date, ed_adm_academic_gender, 
    ed_adm_academic_identity_doc, ed_adm_academic_phone, ed_adm_academic_email, ed_adm_academic_previus_school, ed_adm_academic_graduation_year, ed_adm_academic_average_grade,
    ed_adm_academic_level, ed_adm_academic_course, ed_adm_academic_year, ed_adm_academic_exam, ed_adm_academic_institute_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const PARAMS = [
      req.body.adm_full_name, req.body.adm_birth_date, req.body.adm_gender,
      req.body.adm_identity_doc, req.body.adm_phone, req.body.adm_email,
      req.body.adm_prev_school, req.body.adm_graduation_year, req.body.adm_average_grade,
      req.body.adm_level, req.body.adm_course, req.body.adm_year, req.body.adm_exam,
      instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_admission_students", type: "register", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAdmissionStudent: aluno registado`);
    await RefreshAdmissionStudentCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const GetSingleAdmissionStudent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = StudentCacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleAdmissionStudent demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_admission_students
    LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_admission_students.ed_adm_academic_course
    LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_admission_students.ed_adm_academic_level 
    LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_admission_students.ed_adm_academic_year
    WHERE ed_adm_academic_deleted = 0 AND ed_adm_academic_id = ? AND ed_adm_academic_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, { db: "eduall_admission_students", type: "select", data: req });

    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleAdmissionStudent demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const DeleteAdmissionStudent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_admission_students SET ed_adm_academic_deleted = 1 
    WHERE ed_adm_academic_deleted = 0 AND ed_adm_academic_id = ? AND ed_adm_academic_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_admission_students", type: "delete", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteAdmissionStudent: registo ${ID} eliminado`);
    await RefreshAdmissionStudentCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const UpdateAdmissionStudent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_admission_students SET 
    ed_adm_academic_full_name = ?, ed_adm_academic_birth_date = ?, ed_adm_academic_gender = ?, 
    ed_adm_academic_identity_doc = ?, ed_adm_academic_phone = ?, ed_adm_academic_email = ?, 
    ed_adm_academic_previus_school = ?, ed_adm_academic_graduation_year = ?, ed_adm_academic_average_grade = ?, 
    ed_adm_academic_level = ?, ed_adm_academic_course = ?, ed_adm_academic_year = ?, ed_adm_academic_exam = ?
    WHERE ed_adm_academic_deleted = 0 AND ed_adm_academic_id = ? AND ed_adm_academic_institute_code = ?`;
    const PARAMS = [
      req.body.adm_full_name, req.body.adm_birth_date, req.body.adm_gender,
      req.body.adm_identity_doc, req.body.adm_phone, req.body.adm_email,
      req.body.adm_high_school, req.body.adm_graduation_year, req.body.adm_average_grade,
      req.body.adm_level, req.body.adm_course, req.body.adm_year, req.body.adm_exam,
      ID, instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_admission_students", type: "update", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateAdmissionStudent: registo ${ID} atualizado`);
    await RefreshAdmissionStudentCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

/** =======================================================================
 *  2 --- ADMISSION EXAMS
 * ======================================================================= */

const FetchAdmissionExams = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_admission_exams WHERE ed_adm_exam_deleted = 0 AND ed_adm_exam_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_admission_exams", type: "select", data: req });
};

const RefreshAdmissionExamCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(ExamCacheKeys.all());
  console.log(`📦🧹 CACHE -> admission_exam limpa para institute ${instituteCode}`);

  const rows = await FetchAdmissionExams(req, res, instituteCode);
  await Cache.eduallSet(ExamCacheKeys.list(instituteCode), rows, ADMISSION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> admission_exam reposta em ${duration}ms`);

  return rows;
};

const GetAdmissionExams = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ExamCacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAdmissionExams demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAdmissionExams(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAdmissionExams demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const RegisterAdmissionExam = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `INSERT INTO eduall_admission_exams(ed_adm_exam_title, ed_adm_exam_date_start, ed_adm_exam_date_end, 
    ed_adm_exam_location, ed_adm_exam_code, ed_adm_exam_institute_code) VALUES (?, ?, ?, ?, ?, ?)`;
    const PARAMS = [
      req.body.adm_exam_title, req.body.adm_exam_date_start, req.body.adm_exam_end,
      req.body.adm_exam_location, req.body.adm_exam_code, instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_admission_exams", type: "register", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAdmissionExam: exame registado`);
    await RefreshAdmissionExamCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const GetSingleAdmissionExam = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ExamCacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleAdmissionExam demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_admission_exams WHERE ed_adm_exam_deleted = 0 AND ed_adm_exam_id = ? AND ed_adm_exam_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, { db: "eduall_admission_exams", type: "select", data: req });

    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleAdmissionExam demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const DeleteAdmissionExam = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_admission_exams SET ed_adm_exam_deleted = 1 
    WHERE ed_adm_exam_deleted = 0 AND ed_adm_exam_id = ? AND ed_adm_exam_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_admission_exams", type: "delete", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteAdmissionExam: registo ${ID} eliminado`);
    await RefreshAdmissionExamCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const UpdateAdmissionExam = async (req, res) => {
  try {
    const { ID } = req.params;
    const { adm_subject, adm_date_start, adm_date_end, adm_location } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_admission_exams SET ed_adm_exam_subject = ?, ed_adm_exam_date_start = ?, ed_adm_exam_date_end = ?, ed_adm_exam_location = ? 
    WHERE ed_adm_exam_deleted = 0 AND ed_adm_exam_id = ? AND ed_adm_exam_institute_code = ?`;
    const PARAMS = [adm_subject, adm_date_start, adm_date_end, adm_location, ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_admission_exams", type: "update", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateAdmissionExam: registo ${ID} atualizado`);
    await RefreshAdmissionExamCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

/** =======================================================================
 *  3 --- ADMISSION EXAM SUBJECTS
 * ======================================================================= */

const FetchAdmissionExamSubjects = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_adm_exam_subjects  
    LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_adm_exam_subjects.ed_adm_ex_sub_code
    WHERE ed_adm_ex_sub_deleted = 0 AND ed_adm_ex_sub_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_adm_exam_subjects", type: "select", data: req });
};

const RefreshAdmissionExamSubjectCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(ExamSubjectCacheKeys.all());
  console.log(`📦🧹 CACHE -> admission_exam_subject limpa para institute ${instituteCode}`);

  const rows = await FetchAdmissionExamSubjects(req, res, instituteCode);
  await Cache.eduallSet(ExamSubjectCacheKeys.list(instituteCode), rows, ADMISSION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> admission_exam_subject reposta em ${duration}ms`);

  return rows;
};

const RegisterAdmissionExamSubject = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `INSERT INTO eduall_adm_exam_subjects(ed_adm_ex_sub_examcode, ed_adm_ex_sub_code, ed_adm_ex_sub_institute_code) VALUES (?, ?, ?)`;
    const PARAMS = [req.body.adm_exam_sub_examcode, req.body.adm_exam_sub_code, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_adm_exam_subjects", type: "register", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAdmissionExamSubject: disciplina de exame registada`);
    await RefreshAdmissionExamSubjectCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const GetAdmissionExamSubjects = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ExamSubjectCacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAdmissionExamSubjects demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAdmissionExamSubjects(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAdmissionExamSubjects demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const GetAdmissionExamSubjectsByExam = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ExamSubjectCacheKeys.byExam(CODE, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAdmissionExamSubjectsByExam demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_adm_exam_subjects  
      LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_adm_exam_subjects.ed_adm_ex_sub_code
      WHERE ed_adm_ex_sub_deleted = 0 AND ed_adm_ex_sub_examcode = ? AND ed_adm_ex_sub_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [CODE, instituteCode], true, { db: "eduall_adm_exam_subjects", type: "select", data: req });

    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAdmissionExamSubjectsByExam demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const DeleteAdmissionExamSubject = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_adm_exam_subjects SET ed_adm_ex_sub_deleted = 1 
    WHERE ed_adm_ex_sub_deleted = 0 AND ed_adm_ex_sub_id = ? AND ed_adm_ex_sub_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_adm_exam_subjects", type: "delete", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteAdmissionExamSubject: registo ${ID} eliminado`);
    await RefreshAdmissionExamSubjectCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

/** =======================================================================
 *  4 --- ADMISSION RESULTS
 * ======================================================================= */

const FetchAdmissionResults = async (req, res, instituteCode) => {
  const studentsQuery = `
    SELECT 
        s.ed_adm_academic_id AS student_id, 
        s.ed_adm_academic_full_name AS student_name, 
        s.ed_adm_academic_gender AS student_gender, 
        e.ed_adm_exam_title AS student_exam_title, 
        e.ed_adm_exam_code AS exam_code
    FROM eduall_admission_students s
    JOIN eduall_admission_exams e ON s.ed_adm_academic_exam = e.ed_adm_exam_id
    WHERE s.ed_adm_academic_deleted = 0 
    AND s.ed_adm_academic_institute_code = ?;
  `;
  const students = await ExecuteQuery(res, studentsQuery, [instituteCode], true, { db: "eduall_admission_students", type: "select", data: req });

  const subjectsQuery = `
    SELECT 
        es.ed_adm_ex_sub_examcode AS exam_code, 
        sub.ed_subject_title AS subject_title,
        es.ed_adm_ex_sub_code AS subject_id
    FROM eduall_adm_exam_subjects es
    JOIN eduall_subjects sub ON sub.ed_subject_id = es.ed_adm_ex_sub_code
    WHERE es.ed_adm_ex_sub_deleted = 0 
    AND es.ed_adm_ex_sub_institute_code = ?;
  `;
  const subjects = await ExecuteQuery(res, subjectsQuery, [instituteCode], true, { db: "eduall_adm_exam_subjects", type: "select", data: req });

  const resultsQuery = `
    SELECT 
        r.ed_adm_result_student_id AS student_id, 
        r.ed_adm_result_exam_id AS exam_id, 
        r.ed_adm_result_subject_id AS subject_id, 
        r.ed_adm_result_score AS score, 
        r.ed_adm_result_passed AS passed
    FROM eduall_admission_results r
    WHERE r.ed_adm_result_deleted = 0 
    AND r.ed_adm_result_institute_code = ?;
  `;
  const results = await ExecuteQuery(res, resultsQuery, [instituteCode], true, { db: "eduall_admission_results", type: "select", data: req });

  return students.map((student) => {
    const studentResults = results.filter((result) => result.student_id === student.student_id);

    const studentSubjects = studentResults
      .map((result) => {
        const subject = subjects.find((sub) => sub.subject_id === result.subject_id);
        return subject ? { [subject.subject_title]: { passed: result.passed, score: result.score } } : null;
      })
      .filter(Boolean);

    return {
      student_name: student.student_name,
      student_gender: student.student_gender,
      student_exam_title: student.student_exam_title,
      student_exams_scores_by_subject: studentSubjects,
      student_final_result: null,
    };
  });
};

const RefreshAdmissionResultCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(ResultCacheKeys.all());
  console.log(`📦🧹 CACHE -> admission_result limpa para institute ${instituteCode}`);

  const formattedResults = await FetchAdmissionResults(req, res, instituteCode);
  await Cache.eduallSet(ResultCacheKeys.list(instituteCode), formattedResults, ADMISSION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> admission_result reposta em ${duration}ms`);

  return formattedResults;
};

const GetAdmissionResults = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ResultCacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAdmissionResults demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const formattedResults = await FetchAdmissionResults(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, formattedResults, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAdmissionResults demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(formattedResults);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const RegisterAdmissionResult = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `INSERT INTO eduall_admission_results (ed_adm_result_student_id, ed_adm_result_exam_id, ed_adm_result_subject_id, ed_adm_result_score, 
    ed_adm_result_passed, ed_adm_result_institute_code) VALUES (?, ?, ?, ?, ?, ?)`;
    const PARAMS = [
      req.body.result_student_id, req.body.result_exam_id, req.body.result_subject, req.body.result_score,
      req.body.result_passed, instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_admission_results", type: "register", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAdmissionResult: resultado registado`);
    await RefreshAdmissionResultCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const GetSingleAdmissionResult = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = ResultCacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleAdmissionResult demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_admission_results WHERE ed_adm_result_deleted = 0 AND ed_adm_result_id = ? AND ed_adm_result_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, { db: "eduall_admission_results", type: "select", data: req });

    await Cache.eduallSet(cacheKey, rows, ADMISSION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleAdmissionResult demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

const DeleteAdmissionResult = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const query = `UPDATE eduall_admission_results SET ed_adm_result_deleted = 1 
    WHERE ed_adm_result_deleted = 0 AND ed_adm_result_id = ? AND ed_adm_result_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_admission_results", type: "delete", data: req });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteAdmissionResult: registo ${ID} eliminado`);
    await RefreshAdmissionResultCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed!", error: error.message });
  }
};

module.exports = {
  GetAdmissionStudents, RegisterAdmissionStudent, GetSingleAdmissionStudent, DeleteAdmissionStudent, UpdateAdmissionStudent,
  GetAdmissionExams, RegisterAdmissionExam, GetSingleAdmissionExam, DeleteAdmissionExam, UpdateAdmissionExam,
  RegisterAdmissionExamSubject, GetAdmissionExamSubjects, GetAdmissionExamSubjectsByExam, DeleteAdmissionExamSubject,
  GetAdmissionResults, RegisterAdmissionResult, GetSingleAdmissionResult, DeleteAdmissionResult,
};