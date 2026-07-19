const ExecuteQuery = require("../Functions/ExecuteQuery");

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_LOGO   = "https://ik.imagekit.io/zks5iegia/eduall-logo%20(2).png?updatedAt=1765578949231";
const TERM_LABEL     = { 1: "Iº", 2: "IIº", 3: "IIIº" };
const QUARTER_LABEL  = { 1: "1º", 2: "2º", 3: "3º" };
const PERIOD_MAP     = { "0": "Manhã", "1": "Tarde", "2": "Noturno" };

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS CORE  (objecto "u")
// ─────────────────────────────────────────────────────────────────────────────
const u = {
  num: (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },

  round: (n, mode) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    if (mode === "ceil") return Math.ceil(n);
    return Math.round(n * 100) / 100;
  },

  format: (n, mode) => {
    const r = u.round(n, mode);
    if (r === null) return "";
    return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
  },

  color: (n, max, mode) => {
    const r = u.round(n, mode);
    if (r === null || max == null) return "#000";
    return r < max / 2 ? "#DC2626" : "#072AC8";
  },

  parseIds: (csv) => {
    if (!csv) return [];
    return String(csv).split(",").map(x => Number(String(x).trim())).filter(n => Number.isFinite(n) && n > 0);
  },

  /** Parse "subjectId:behavior,..." → Map<number, string> */
  parseBehaviors: (csv) => {
    const map = new Map();
    if (!csv || typeof csv !== "string") return map;
    String(csv).split(",").filter(Boolean).forEach(pair => {
      const [id, behavior] = pair.trim().split(":");
      const idNum = Number(id);
      if (!isNaN(idNum) && behavior) map.set(idNum, behavior.trim());
    });
    return map;
  },

  serializeBehaviors: (map) => {
    const parts = [];
    map.forEach((behavior, id) => parts.push(`${id}:${behavior}`));
    return parts.join(",");
  },

  approve: (mt, behavior) => {
    if (mt === null || mt === undefined) return null;
    const n = Number(mt);
    if (!Number.isFinite(n)) return null;
    return behavior === "approve_anyway" ? true : n >= 10;
  },

  getStatus: (isApproved, useTransita = false) => {
    if (isApproved === null) return "";
    if (useTransita) return isApproved ? "Transita" : "Não Transita";
    return isApproved ? "Aprova" : "Reprova";
  },

  getStatusColor: (isApproved) => {
    if (isApproved === null) return "#000";
    return isApproved ? "#072AC8" : "#DC2626";
  },

  isFemale: (g) => g === "F" || g === "f" || g === "Feminino" || Number(g) === 1,

  pct: (num, den) =>
    den > 0 ? ((num / den) * 100).toFixed(2).replace(".", ",") : "0,00",

  shortName: (fullName) => {
    if (!fullName) return "";
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return parts.length <= 2 ? fullName.trim() : `${parts[0]} ${parts[parts.length - 1]}`;
  },

  formatDate: (d, opts = {}) => {
    if (!d) return opts.fallback ?? "-";
    const dt = new Date(d);
    if (isNaN(dt)) return opts.fallback ?? "-";
    return opts.long
      ? dt.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" })
      : dt.toLocaleDateString("pt-PT");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CSS REUTILIZÁVEL
// ─────────────────────────────────────────────────────────────────────────────
const css = {
  table:    "border-collapse:collapse;border:2px solid #000;width:100%;font-size:12px;margin:15px 0;",
  th:       "border:1.5px solid #000;padding:6px 8px;background:#f0f0f0;font-weight:bold;text-align:center;",
  td:       "border:1px solid #000;padding:5px 8px;",
  body:     "font-family:Arial,sans-serif;margin:20px;background:#fff;",
  header:   "text-align:center;margin-bottom:20px;border-bottom:2px solid #000;padding-bottom:15px;",
  logo:     "height:80px;width:auto;margin-bottom:10px;",
  title:    "font-size:16px;font-weight:bold;margin:10px 0;",
  subtitle: "font-size:12px;color:#555;margin:5px 0;",
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILDERS DE RESPOSTA (GenerateClassGrades)
// ─────────────────────────────────────────────────────────────────────────────
function buildSchool(INST) {
  return {
    institute_code:   INST.ed_institute_code      || null,
    institute_name:   INST.ed_institute_name      || null,
    principal:        INST.ed_institute_principal || null,
    nif:              INST.ed_institute_nif       || null,
    state:            INST.ed_institute_state     || null,
    address:          INST.ed_institute_address   || null,
    phone:            INST.ed_institute_phone     || null,
    email:            INST.ed_institute_email     || null,
    logo_url:         INST.ed_logo_urlcloudinary  || null,
    coat_of_arms_url: INST.ed_institute_coat_of_arms || null,
    doc_header:       INST.ed_institute_docheader || null,
  };
}

function buildClass(CLASS, maxVal, subjectsDetail, periodLabel) {
  return {
    class_id:     Number(CLASS.ed_class_id),
    class_code:   CLASS.ed_class_code  || null,
    class_title:  CLASS.ed_class_title || null,
    class_period: periodLabel          || CLASS.ed_class_period || null,
    class_shift:  CLASS.ed_class_shift || null,
    academic_level: {
      id:             CLASS.ed_academic_level_id    || null,
      title:          CLASS.ed_academic_level_title || null,
      max_value:      maxVal,
      pass_threshold: maxVal / 2,
    },
    cicle:         { id: CLASS.ed_cicle_id    || null, title: CLASS.ed_cicle_title    || null },
    academic_year: { id: CLASS.ed_academic_year_id || null, title: CLASS.ed_academic_year_title || null },
    classroom:     { id: CLASS.ed_classroom_id    || null, title: CLASS.ed_classroom_title    || null },
    class_director:{ id: CLASS.director_id   || null, name:  CLASS.director_name  || null },
    subjects: subjectsDetail,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY HELPERS  (evitam repetição de JOINs)
// ─────────────────────────────────────────────────────────────────────────────
const CLASS_FULL_QUERY = `
  SELECT
    c.*,
    al.ed_academic_level_id,
    al.ed_academic_level_title,
    al.ed_academic_level_avaliationtype_endat AS max_value,
    ci.ed_cicle_id,
    ci.ed_cicle_title,
    ay.ed_academic_year_id,
    ay.ed_academic_year_title,
    cr.ed_classroom_id,
    cr.ed_classroom_title,
    emp.ed_employee_id   AS director_id,
    emp.ed_employee_name AS director_name
  FROM eduall_class c
  LEFT JOIN eduall_academic_level al  ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
  LEFT JOIN eduall_cicles         ci  ON ci.ed_cicle_id          = c.ed_class_cicle          AND ci.ed_cicle_deleted = 0
  LEFT JOIN eduall_academic_year  ay  ON ay.ed_academic_year_id  = c.ed_class_year           AND ay.ed_academic_year_deleted = 0
  LEFT JOIN eduall_classrooms     cr  ON cr.ed_classroom_id      = c.ed_class_room           AND cr.ed_classroom_deleted = 0
  LEFT JOIN eduall_employees      emp ON emp.ed_employee_id      = c.ed_class_director       AND emp.ed_employee_deleted = 0
  WHERE c.ed_class_id = ? AND c.ed_class_institute_code = ? AND c.ed_class_deleted = 0
  LIMIT 1`;

/** Carrega disciplinas em batch → Map<id, title> */
async function loadSubjects(res, ids) {
  if (!ids.length) return new Map();
  const rows = await ExecuteQuery(res,
    `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects
     WHERE ed_subject_id IN (${ids.map(() => "?").join(",")}) AND ed_subject_deleted = 0`,
    ids, true);
  return new Map(rows.map(s => [Number(s.ed_subject_id), s.ed_subject_title]));
}

/** Carrega alunos de uma turma em batch */
async function loadStudents(res, classId) {
  return ExecuteQuery(res,
    `SELECT * FROM eduall_students
     WHERE ed_student_class = ? AND ed_student_deleted = 0 ORDER BY ed_student_name ASC`,
    [classId], true);
}

/** Carrega notas trimestrais em batch → Map<"studentId_subjectId_quarter", {mac,npt}> */
async function loadQuarterly(res, classId, studentIds, extraFilter = "") {
  if (!studentIds.length) return new Map();
  const ph   = studentIds.map(() => "?").join(",");
  const rows = await ExecuteQuery(res,
    `SELECT ed_quarter_note_studentcode AS student_id,
            ed_quarter_note_subject     AS subject_id,
            ed_quarter_note_quarter     AS quarter,
            ed_quarter_note_mac         AS mac,
            ed_quarter_note_npt         AS npt
     FROM eduall_quarterly_notes
     WHERE ed_quarter_note_class = ?
       AND ed_quarter_note_studentcode IN (${ph})
       AND ed_quarter_note_deleted = 0
       ${extraFilter}`,
    [classId, ...studentIds], true);
  const map = new Map();
  rows.forEach(n =>
    map.set(`${n.student_id}_${n.subject_id}_${n.quarter}`, { mac: u.num(n.mac), npt: u.num(n.npt) })
  );
  return map;
}

/** Carrega notas de exame em batch → Map<"studentId_subjectId", score> */
async function loadExams(res, classId, studentIds) {
  if (!studentIds.length) return new Map();
  const ph   = studentIds.map(() => "?").join(",");
  const rows = await ExecuteQuery(res,
    `SELECT ed_student_exam_studentCode AS student_id,
            ed_student_exam_subject     AS subject_id,
            ed_student_exam_score       AS score
     FROM eduall_student_exam_notes
     WHERE ed_student_exam_class = ? AND ed_student_exam_studentCode IN (${ph}) AND ed_student_exam_deleted = 0`,
    [classId, ...studentIds], true);
  const map = new Map();
  rows.forEach(e => map.set(`${e.student_id}_${e.subject_id}`, u.num(e.score)));
  return map;
}

/** Carrega notas de recurso (featured) em batch → Map<"studentId_subjectId", score> */
async function loadFeatured(res, classId, studentIds) {
  if (!studentIds.length) return new Map();
  const ph = studentIds.map(() => "?").join(",");
  const rows = await ExecuteQuery(res,
    `SELECT ed_student_featured_note_studentCode AS student_id,
            ed_student_featured_note_subject     AS subject_id,
            ed_student_featured_note_score       AS score
     FROM eduall_student_featured_notes
     WHERE ed_student_featured_note_class = ?
       AND ed_student_featured_note_studentCode IN (${ph})
       AND ed_student_featured_note_deleted = 0`,
    [classId, ...studentIds], true).catch(() => []);
  const map = new Map();
  (rows || []).forEach(r => map.set(`${r.student_id}_${r.subject_id}`, u.num(r.score)));
  return map;
}

/** Carrega faltas em batch → Map<"studentId_subjectId", total> */
async function loadAbsences(res, classId, studentIds) {
  if (!studentIds.length) return new Map();
  const ph   = studentIds.map(() => "?").join(",");
  const rows = await ExecuteQuery(res,
    `SELECT ed_student_attd_student_code AS student_id,
            ed_student_attd_subject      AS subject_id,
            COUNT(*)                     AS total_absences
     FROM eduall_student_attendence
     WHERE ed_student_attd_deleted = 0
       AND ed_student_attd_status  = 1
       AND ed_student_attd_teacherSubClass = ?
       AND ed_student_attd_student_code IN (${ph})
     GROUP BY ed_student_attd_student_code, ed_student_attd_subject`,
    [classId, ...studentIds], true).catch(() => []);
  const map = new Map();
  (rows || []).forEach(a => map.set(`${a.student_id}_${a.subject_id}`, Number(a.total_absences)));
  return map;
}

/** Carrega a instituição */
async function loadInstitute(res, instituteCode) {
  const rows = await ExecuteQuery(res,
    `SELECT * FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`,
    [instituteCode], true);
  return rows?.[0] || null;
}

/** Carrega subdiretor pedagógico */
async function loadSubDirector(res, instituteCode) {
  const rows = await ExecuteQuery(res,
    `SELECT ed_employee_name FROM eduall_employees
     WHERE ed_employee_institute_code = ?
       AND ed_employee_deleted = 0
       AND ed_employee_charge IN ('55','56','91')
     ORDER BY ed_employee_id ASC LIMIT 1`,
    [instituteCode], true);
  return rows?.[0]?.ed_employee_name || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: carrega MÚLTIPLAS turmas + disciplinas sem N+1
// ─────────────────────────────────────────────────────────────────────────────
async function loadClassesBatch(res, classIds, instituteCode) {
  if (!classIds.length) return [];
  const ph = classIds.map(() => "?").join(",");
  return ExecuteQuery(res,
    `SELECT c.*, al.ed_academic_level_avaliationtype_endat AS max_value
     FROM eduall_class c
     LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
     WHERE c.ed_class_id IN (${ph}) AND c.ed_class_institute_code = ? AND c.ed_class_deleted = 0`,
    [...classIds, instituteCode], true);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: formata nota com cor HTML
// ─────────────────────────────────────────────────────────────────────────────
function formatNote(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (isNaN(n)) return "";
  const color = n >= 10 ? "#0a8f2f" : "#c40000";
  return `<span style="color:${color} !important;font-weight:700 !important;">${n}</span>`;
}

function dynamicField(value, placeholder = "", minWidth = 60, isRed = false) {
  if (value && value !== "-" && value !== "#") {
    return isRed
      ? `<span style="color:red !important;font-weight:700 !important;">${value}</span>`
      : value;
  }
  return `<span contenteditable="true" data-placeholder="${placeholder}" style="display:inline-block !important;min-width:${minWidth}px !important;padding:2px 4px !important;font-weight:700 !important;outline:none !important;border-bottom:1px solid #000 !important;background:transparent !important;color:${isRed ? "red" : "#000"} !important;" oninput="this.style.width=(this.scrollWidth+2)+'px';"></span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE ESTATÍSTICAS (GeneratePerformanceMap)
// ─────────────────────────────────────────────────────────────────────────────
function emptyStats() {
  return { matMF: 0, matF: 0, drpMF: 0, drpF: 0, evalMF: 0, evalF: 0, aprvMF: 0, aprvF: 0, repMF: 0, repF: 0, pctAprv: "0,00", pctRep: "0,00" };
}

function cycleSubtotal(classes) {
  return classes.reduce((acc, cls) => {
    const s = cls.stats || {};
    acc.matMF  += s.matMF  ?? 0; acc.matF  += s.matF  ?? 0;
    acc.drpMF  += s.drpMF  ?? 0; acc.drpF  += s.drpF  ?? 0;
    acc.evalMF += s.evalMF ?? 0; acc.evalF += s.evalF ?? 0;
    acc.aprvMF += s.aprvMF ?? 0; acc.aprvF += s.aprvF ?? 0;
    acc.repMF  += s.repMF  ?? 0; acc.repF  += s.repF  ?? 0;
    return acc;
  }, { matMF:0, matF:0, drpMF:0, drpF:0, evalMF:0, evalF:0, aprvMF:0, aprvF:0, repMF:0, repF:0 });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GenerateFrequencyTerm
// ═════════════════════════════════════════════════════════════════════════════
const GenerateFrequencyTerm = async (req, res) => {
  try {
    const { classId, students } = req.body;
    if (!classId || !Array.isArray(students))
      return res.status(400).json({ success: false, message: "classId e students obrigatórios." });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const SERVER_DOMAIN = "http://localhost:5000/";

    const INSTITUTE = await loadInstitute(res, instituteCode);
    if (!INSTITUTE) return res.status(404).json({ success: false, message: "Instituição não encontrada." });

    const classRes = await ExecuteQuery(res,
      `SELECT * FROM eduall_class
       LEFT JOIN eduall_classrooms     ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room
       LEFT JOIN eduall_academic_year  ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
       WHERE eduall_class.ed_class_id = ? AND eduall_class.ed_class_deleted = 0`,
      [classId], true);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });
    const CLASS = classRes[0];

    const subjectsList = u.parseIds(CLASS.ed_class_subjects);
    const subjectTitles = await loadSubjects(res, subjectsList);

    // Carrega TODAS as notas e exames em batch
    const quarterlyNotes = await ExecuteQuery(res,
      `SELECT * FROM eduall_quarterly_notes
       WHERE ed_quarter_note_class = ? AND ed_quarter_note_deleted = 0`,
      [classId], true);

    const exams = await ExecuteQuery(res,
      `SELECT * FROM eduall_student_exam_notes
       WHERE ed_student_exam_class = ? AND ed_student_exam_deleted = 0`,
      [classId], true);

    // Carrega TODOS os alunos em batch (evita N+1)
    if (!students.length) return res.status(200).json({ success: true, data: [] });
    const phSt = students.map(() => "?").join(",");
    const allStudentsRes = await ExecuteQuery(res,
      `SELECT * FROM eduall_students WHERE ed_student_id IN (${phSt}) AND ed_student_deleted = 0`,
      students, true);
    const studentMap = new Map(allStudentsRes.map(s => [Number(s.ed_student_id), s]));

    const province = INSTITUTE.ed_institute_state || "Luanda";
    const results = [];

    for (const studentId of students) {
      const STUDENT = studentMap.get(Number(studentId));
      if (!STUDENT) continue;

      const studentPhoto = STUDENT.ed_student_picture
        ? SERVER_DOMAIN + STUDENT.ed_student_picture
        : "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png?20170328184010";
      const birthday = u.formatDate(STUDENT.ed_student_birthday);

      let tableRows = "";

      for (const subjectId of subjectsList) {
        const subjectName = subjectTitles.get(subjectId) || "";

        const getNote = (quarter, field) => {
          const note = quarterlyNotes.find(n =>
            n.ed_quarter_note_studentcode == studentId &&
            n.ed_quarter_note_subject == subjectId &&
            n.ed_quarter_note_quarter == quarter
          );
          return note?.[field] != null ? note[field] : null;
        };

        const q1_mac = getNote(1, "ed_quarter_note_mac");
        const q1_npt = getNote(1, "ed_quarter_note_npt");
        const q2_mac = getNote(2, "ed_quarter_note_mac");
        const q2_npt = getNote(2, "ed_quarter_note_npt");
        const q3_mac = getNote(3, "ed_quarter_note_mac");
        const q3_npt = getNote(3, "ed_quarter_note_npt");

        const examNote = exams.find(e =>
          e.ed_student_exam_studentCode == studentId && e.ed_student_exam_subject == subjectId
        );
        const exam = examNote ? examNote.ed_student_exam_score : "#";

        const numeric = [q1_npt, q2_npt, q3_npt]
          .filter(n => n !== null && n !== undefined)
          .map(Number)
          .filter(n => !isNaN(n));
        const avg = numeric.length
          ? Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length)
          : null;

        // Calcula MT1, MT2, MT3 corretamente
        const calcMt = (mac, npt) => {
          const m = u.num(mac), n = u.num(npt);
          return m !== null && n !== null ? Math.round((m + n) / 2) : null;
        };
        const mt1 = calcMt(q1_mac, q1_npt);
        const mt2 = calcMt(q2_mac, q2_npt);
        const mt3 = calcMt(q3_mac, q3_npt);

        tableRows += `
        <tr>
          <td style="border:1px solid #000 !important;padding:4px !important;text-align:left !important;font-weight:bold !important;">${subjectName}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q1_mac)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q1_npt)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(mt1)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q2_mac)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q2_npt)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(mt2)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q3_mac)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(q3_npt)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(mt3)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(avg)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(exam)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;">${formatNote(avg)}</td>
          <td style="border:1px solid #000 !important;padding:4px !important;font-weight:bold !important;">
            ${avg !== null && avg >= 10
              ? `<span style="color:#0a8f2f !important;font-weight:700 !important;">Transita</span>`
              : `<span style="color:#c40000 !important;font-weight:700 !important;">Não Transita</span>`}
          </td>
        </tr>`;
      }

      const html = `
<div class="student-term-paper" style="width:100%;padding:50px;font-family:Montserrat,Arial,sans-serif;font-size:13px;color:#000;position:relative;line-height:1.6;">

  <div style="position:absolute;left:50px;top:50px;border:3px solid #000;padding:8px 22px;font-weight:600;font-size:14px;">
    PROCESSO Nº ${dynamicField("", "Nº Processo", 80, true)}
  </div>

  <div style="position:absolute;right:50px;top:50px;width:150px;height:150px;border:3px solid #000;overflow:hidden;">
    <img src="${studentPhoto}" style="width:150px;height:150px;object-fit:cover;"/>
  </div>

  <div style="text-align:center;margin-top:40px;">
    <img class="dinamic-term-logo" src="${INSTITUTE.ed_logo_urlcloudinary || ''}" style="width:130px;height:130px;object-fit:contain;"/>
    <div style="font-weight:700;margin-top:10px;">REPÚBLICA DE ANGOLA</div>
    <div style="font-weight:700;">MINISTÉRIO DA EDUCAÇÃO</div>
    <div style="font-weight:600;">GOVERNO DA PROVÍNCIA DE ${province.toUpperCase()}</div>
    <div style="font-weight:600;">DIRECÇÃO MUNICIPAL DA EDUCAÇÃO</div>
    <div style="font-weight:600;">"${dynamicField(INSTITUTE.ed_institute_name, "Nome da Instituição", 120)}"</div>
  </div>

  <div style="text-align:center;font-size:18px;font-weight:700;text-decoration:underline;margin-top:25px;letter-spacing:1px;">
    TERMO DE FREQUÊNCIA
  </div>

  <div style="margin-top:20px;text-align:justify;">
    Nome do Aluno(a): <span class="frequency-term-span-student-name" style="color:red;font-weight:700;">${dynamicField(STUDENT.ed_student_name, "Nome do Aluno", 100)}</span>,
    filho(a) de ${dynamicField("", "Nome do Pai", 100)} e ${dynamicField("", "Nome da Mãe", 100)},
    natural de ${dynamicField(STUDENT.ed_student_naturalness, "Naturalidade")},
    Município de ${dynamicField("", "Município")},
    Província de ${province},
    nascido(a) aos ${dynamicField(birthday, "Data de Nascimento", 100)},
    portador(a) do Bilhete de Identidade nº ${dynamicField(STUDENT.ed_student_identityCard, "Nº do BI", 100)}.
    <br/><br/>
    Contacto Telefónico ${dynamicField(STUDENT.ed_student_phone, "Telefone", 90)}
    &nbsp;|&nbsp;
    Residência ${dynamicField(STUDENT.ed_student_address, "Morada", 150)}.
    <br/><br/>
    Classe: <b>${dynamicField(CLASS.ed_class_title, "Classe", 100)}</b> |
    Sala nº <b>${dynamicField(CLASS.ed_classroom_title, "Sala", 80)}</b> |
    Ano Lectivo <b>${dynamicField(CLASS.ed_academic_year_title, "Ano Lectivo", 120)}</b>
  </div>

  <table style="width:100%;border-collapse:collapse;border:3px solid #000;margin-top:30px;font-size:14px;">
    <thead>
      <tr style="background:#ffff;">
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;vertical-align:middle;" rowspan="2">DISCIPLINAS</th>
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;" colspan="3">I º TRIMESTRE</th>
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;" colspan="3">II º TRIMESTRE</th>
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;" colspan="3">III º TRIMESTRE</th>
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;" colspan="3">CLASSIFICAÇÃO FINAL</th>
        <th style="border:1.5px solid #000;padding:10px;font-weight:700;text-align:center;vertical-align:middle;" rowspan="2">OBSERVAÇÃO</th>
      </tr>
      <tr style="background:#fff;">
        <th style="border:1.5px solid #000;padding:8px;text-align:center;">MAC</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">NPT</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">MT1</th>
        <th style="border:1.5px solid #000;padding:8px;text-align:center;">MAC</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">NPT</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">MT2</th>
        <th style="border:1.5px solid #000;padding:8px;text-align:center;">MAC</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">NPT</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">MT3</th>
        <th style="border:1.5px solid #000;padding:8px;text-align:center;">MFD</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">PE</th><th style="border:1.5px solid #000;padding:8px;text-align:center;">MF</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:60px;">
    <div style="text-align:center;width:30%;">O SUB-DIRECTOR PEDAGÓGICO<div style="border-top:1.5px solid #000;margin-top:60px;"></div></div>
    <div style="text-align:center;width:30%;font-weight:600;">${province}, ${new Date().toLocaleDateString("pt-PT")}</div>
    <div style="text-align:center;width:30%;">O DIRECTOR GERAL<div style="border-top:1.5px solid #000;margin-top:60px;"></div></div>
  </div>
</div>`;

      results.push({ student_id: studentId, student_name: STUDENT.ed_student_name, html });
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 2. GeneratePerformanceMap
// ═════════════════════════════════════════════════════════════════════════════
const GeneratePerformanceMap = async (req, res) => {
  try {
    const term           = Number(req.body.term);
    const template       = Number(req.body.template);
    const academicYearId = req.body.academicYearId ? Number(req.body.academicYearId) : null;

    if (![1, 2, 3].includes(term))
      return res.status(400).json({ success: false, code: "INVALID_TERM", message: "Trimestre inválido. Escolha 1, 2 ou 3." });
    if (![1, 2].includes(template))
      return res.status(400).json({ success: false, code: "INVALID_TEMPLATE", message: "Modelo inválido. Escolha 1 ou 2." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode)
      return res.status(401).json({ success: false, code: "NO_SESSION", message: "Sessão expirada." });

    const institute = await loadInstitute(res, instituteCode);
    if (!institute)
      return res.status(404).json({ success: false, code: "INSTITUTE_NOT_FOUND", message: "Instituição não encontrada." });

    // Estrutura completa (todos os anos)
    const allStructureRows = await ExecuteQuery(res,
      `SELECT DISTINCT ci.ed_cicle_id, ci.ed_cicle_title, al.ed_academic_level_id, al.ed_academic_level_title, al.ed_academic_level_avaliationtype_endat AS max_value
       FROM eduall_class c
       LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
       LEFT JOIN eduall_cicles ci         ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
       ORDER BY ci.ed_cicle_id ASC, al.ed_academic_level_title ASC`,
      [instituteCode], true);

    if (!allStructureRows.length)
      return res.status(200).json({ success: false, code: "NO_STRUCTURE", message: "Sem turmas registadas." });

    const yearFilter = academicYearId ? "AND c.ed_class_year = ?" : "";
    const yearParams = academicYearId ? [academicYearId] : [];

    const classesOfYear = await ExecuteQuery(res,
      `SELECT c.ed_class_id, c.ed_class_year, al.ed_academic_level_id, ci.ed_cicle_id,
              al.ed_academic_level_avaliationtype_endat AS max_value, ay.ed_academic_year_title
       FROM eduall_class c
       LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
       LEFT JOIN eduall_cicles ci         ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
       LEFT JOIN eduall_academic_year ay  ON ay.ed_academic_year_id = c.ed_class_year AND ay.ed_academic_year_deleted = 0
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ? ${yearFilter}
       ORDER BY ci.ed_cicle_id ASC, al.ed_academic_level_title ASC`,
      [instituteCode, ...yearParams], true);

    let schoolYearLabel = classesOfYear[0]?.ed_academic_year_title ?? null;
    if (!schoolYearLabel && academicYearId) {
      const [ayRow] = await ExecuteQuery(res,
        `SELECT ed_academic_year_title FROM eduall_academic_year WHERE ed_academic_year_id = ? LIMIT 1`,
        [academicYearId], true);
      schoolYearLabel = ayRow?.ed_academic_year_title ?? null;
    }
    schoolYearLabel = schoolYearLabel ?? String(new Date().getFullYear());

    const statsByClass = {};

    if (classesOfYear.length) {
      const classIds = classesOfYear.map(c => c.ed_class_id);
      const phC      = classIds.map(() => "?").join(",");

      // Carrega alunos actuais em batch
      const currentStudents = await ExecuteQuery(res,
        `SELECT ed_student_id, ed_student_gender, ed_student_class, COALESCE(ed_student_dropout, 0) AS is_dropout
         FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_class IN (${phC})`,
        classIds, true);

      // Carrega alunos históricos em batch
      const oldRecords = await ExecuteQuery(res,
        `SELECT oc.ed_student_old_class_student AS student_id, oc.ed_student_old_class AS class_id,
                s.ed_student_gender, COALESCE(s.ed_student_dropout, 0) AS is_dropout
         FROM eduall_student_old_classes oc
         LEFT JOIN eduall_students s ON s.ed_student_id = oc.ed_student_old_class_student AND s.ed_student_deleted = 0
         WHERE oc.ed_student_old_class IN (${phC})`,
        classIds, true);

      const currentByClass = new Map();
      for (const s of currentStudents) {
        if (!currentByClass.has(s.ed_student_class)) currentByClass.set(s.ed_student_class, []);
        currentByClass.get(s.ed_student_class).push(s);
      }
      const oldByClass = new Map();
      for (const s of oldRecords) {
        if (!oldByClass.has(s.class_id)) oldByClass.set(s.class_id, []);
        oldByClass.get(s.class_id).push({ ...s, ed_student_class: s.class_id });
      }

      // Carrega notas trimestrais em batch
      const notes = await ExecuteQuery(res,
        `SELECT q.ed_quarter_note_studentcode AS student_id, q.ed_quarter_note_class AS class_id, q.ed_quarter_note_npt AS npt
         FROM eduall_quarterly_notes q
         WHERE q.ed_quarter_note_deleted = 0 AND q.ed_quarter_note_quarter = ? AND q.ed_quarter_note_class IN (${phC})`,
        [term, ...classIds], true);

      for (const cls of classesOfYear) {
        const cid     = cls.ed_class_id;
        const maxVal  = Number(cls.max_value) || 20;
        const half    = maxVal / 2;
        const clsSt   = (currentByClass.get(cid) || []).length > 0
          ? (currentByClass.get(cid) || [])
          : (oldByClass.get(cid) || []);

        const noteMap = new Map(
          notes.filter(n => n.class_id === cid).map(n => [n.student_id, Number(n.npt ?? 0)])
        );

        let matMF=0, matF=0, drpMF=0, drpF=0, evalMF=0, evalF=0, aprvMF=0, aprvF=0, repMF=0, repF=0;

        for (const st of clsSt) {
          const fem = u.isFemale(st.ed_student_gender);
          matMF++; if (fem) matF++;
          if (Number(st.is_dropout) === 1) { drpMF++; if (fem) drpF++; continue; }
          const npt = noteMap.get(Number(st.ed_student_id ?? st.student_id));
          if (npt === undefined) continue;
          evalMF++; if (fem) evalF++;
          if (npt >= half) { aprvMF++; if (fem) aprvF++; }
          else             { repMF++;  if (fem) repF++;  }
        }

        statsByClass[cid] = {
          matMF, matF, drpMF, drpF, evalMF, evalF, aprvMF, aprvF, repMF, repF,
          pctAprv: u.pct(aprvMF, evalMF),
          pctRep:  u.pct(repMF, evalMF),
        };
      }
    }

    const classesByCicleLevel = new Map();
    for (const cls of classesOfYear) {
      const ck = `${cls.ed_cicle_id ?? "NULL"}|${cls.ed_academic_level_id ?? "NULL"}`;
      if (!classesByCicleLevel.has(ck)) classesByCicleLevel.set(ck, []);
      classesByCicleLevel.get(ck).push(cls.ed_class_id);
    }

    const cicleMap = new Map();
    for (const row of allStructureRows) {
      const ck = row.ed_cicle_id != null ? String(row.ed_cicle_id) : "NO_CYCLE";
      if (!cicleMap.has(ck)) cicleMap.set(ck, { key: ck, label: row.ed_cicle_title ?? "Sem Ciclo", levels: [] });
      const lk = row.ed_academic_level_id != null ? String(row.ed_academic_level_id) : "NO_LEVEL";
      const cycle = cicleMap.get(ck);
      if (!cycle.levels.find(l => l.id === lk))
        cycle.levels.push({ id: lk, name: row.ed_academic_level_title ?? "–" });
    }

    const cyclesData = [];
    for (const [, cycle] of cicleMap) {
      const classesArr = [];
      for (const lvl of cycle.levels) {
        const idxKey = `${cycle.key === "NO_CYCLE" ? "NULL" : cycle.key}|${lvl.id === "NO_LEVEL" ? "NULL" : lvl.id}`;
        const cids   = classesByCicleLevel.get(idxKey) || [];
        const stats  = emptyStats();
        for (const cid of cids) {
          const s = statsByClass[cid] ?? {};
          stats.matMF  += s.matMF  ?? 0; stats.matF  += s.matF  ?? 0;
          stats.drpMF  += s.drpMF  ?? 0; stats.drpF  += s.drpF  ?? 0;
          stats.evalMF += s.evalMF ?? 0; stats.evalF += s.evalF ?? 0;
          stats.aprvMF += s.aprvMF ?? 0; stats.aprvF += s.aprvF ?? 0;
          stats.repMF  += s.repMF  ?? 0; stats.repF  += s.repF  ?? 0;
        }
        stats.pctAprv = u.pct(stats.aprvMF, stats.evalMF);
        stats.pctRep  = u.pct(stats.repMF, stats.evalMF);
        classesArr.push({ id: lvl.id, name: lvl.name, stats });
      }
      const sub = cycleSubtotal(classesArr);
      sub.pctAprv = u.pct(sub.aprvMF, sub.evalMF);
      sub.pctRep  = u.pct(sub.repMF, sub.evalMF);
      cyclesData.push({ key: cycle.key, label: cycle.label, classes: classesArr, subtotal: sub });
    }

    const grand = Object.values(statsByClass).reduce(
      (acc, s) => {
        acc.matMF  += s.matMF;  acc.matF  += s.matF;
        acc.drpMF  += s.drpMF;  acc.drpF  += s.drpF;
        acc.evalMF += s.evalMF; acc.evalF += s.evalF;
        acc.aprvMF += s.aprvMF; acc.aprvF += s.aprvF;
        acc.repMF  += s.repMF;  acc.repF  += s.repF;
        return acc;
      },
      { matMF:0, matF:0, drpMF:0, drpF:0, evalMF:0, evalF:0, aprvMF:0, aprvF:0, repMF:0, repF:0 }
    );
    grand.pctAprv = u.pct(grand.aprvMF, grand.evalMF);
    grand.pctRep  = u.pct(grand.repMF, grand.evalMF);

    return res.status(200).json({
      success: true,
      mapData: {
        institute: {
          ed_institute_name:      institute.ed_institute_name      || "",
          ed_institute_state:     institute.ed_institute_state     || "",
          ed_institute_address:   institute.ed_institute_address   || "",
          ed_logo_urlcloudinary:  (institute.ed_logo_urlcloudinary || "").trim() || DEFAULT_LOGO,
          ed_institute_docheader: institute.ed_institute_docheader || "",
        },
        cyclesData,
        grand,
        schoolYear: schoolYearLabel,
        termLabel:  TERM_LABEL[term],
        term,
        template,
        today: new Date().toLocaleDateString("pt-PT"),
      },
    });
  } catch (err) {
    console.error("GeneratePerformanceMap:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Erro inesperado ao gerar o mapa." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 3. GenerateCertificate
// ═════════════════════════════════════════════════════════════════════════════
const GenerateCertificate = async (req, res) => {
  try {
    const { students, levelIds } = req.body;
    if (!Array.isArray(students) || !students.length)
      return res.status(400).json({ success: false, message: "students obrigatório." });
    if (!Array.isArray(levelIds) || !levelIds.length)
      return res.status(400).json({ success: false, message: "levelIds obrigatório." });
    if (levelIds.length > 4)
      return res.status(400).json({ success: false, message: "Máximo 4 academic levels." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ success: false, message: "Sessão inválida." });

    const INSTITUTE = await loadInstitute(res, instituteCode);
    if (!INSTITUTE) return res.status(404).json({ success: false, message: "Instituição não encontrada." });
    const LOGO     = INSTITUTE.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const province = INSTITUTE.ed_institute_state || "Luanda";

    const phLevels = levelIds.map(() => "?").join(",");
    const levelsRes = await ExecuteQuery(res,
      `SELECT ed_academic_level_id, ed_academic_level_title, ed_academic_level_avaliationtype_endat AS max_value
       FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id IN (${phLevels})`,
      levelIds, true);
    const levelsMap    = new Map(levelsRes.map(l => [Number(l.ed_academic_level_id), l]));
    const orderedLevels = levelIds.map(id => levelsMap.get(Number(id))).filter(Boolean);
    if (!orderedLevels.length)
      return res.status(404).json({ success: false, message: "Nenhum academic level encontrado." });

    const classesRes = await ExecuteQuery(res,
      `SELECT c.*, al.ed_academic_level_title, al.ed_academic_level_avaliationtype_endat AS max_value,
              ci.ed_cicle_title, ay.ed_academic_year_title, cr.ed_classroom_title
       FROM eduall_class c
       LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
       LEFT JOIN eduall_cicles ci         ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
       LEFT JOIN eduall_academic_year ay  ON ay.ed_academic_year_id = c.ed_class_year AND ay.ed_academic_year_deleted = 0
       LEFT JOIN eduall_classrooms cr     ON cr.ed_classroom_id = c.ed_class_room AND cr.ed_classroom_deleted = 0
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ? AND c.ed_class_academic_level IN (${phLevels})`,
      [instituteCode, ...levelIds], true);

    if (!classesRes.length)
      return res.status(404).json({ success: false, message: "Nenhuma turma encontrada." });

    const classSubjectsMap = new Map();
    const allSubjectIds    = new Set();
    for (const cls of classesRes) {
      const ids = u.parseIds(cls.ed_class_subjects);
      classSubjectsMap.set(Number(cls.ed_class_id), ids);
      ids.forEach(id => allSubjectIds.add(id));
    }

    const subjectTitlesMap = await loadSubjects(res, [...allSubjectIds]);
    const allClassIds      = classesRes.map(c => Number(c.ed_class_id));
    const phClasses        = allClassIds.map(() => "?").join(",");
    const phStudents       = students.map(() => "?").join(",");

    // Batch: notas trimestrais + exames
    const quarterlyNotes = await ExecuteQuery(res,
      `SELECT q.ed_quarter_note_studentcode AS student_id, q.ed_quarter_note_class AS class_id,
              q.ed_quarter_note_subject AS subject_id, q.ed_quarter_note_quarter AS quarter,
              q.ed_quarter_note_npt AS npt, q.ed_quarter_note_mac AS mac
       FROM eduall_quarterly_notes q
       WHERE q.ed_quarter_note_deleted = 0 AND q.ed_quarter_note_class IN (${phClasses}) AND q.ed_quarter_note_studentcode IN (${phStudents})`,
      [...allClassIds, ...students], true);

    const examNotes = await ExecuteQuery(res,
      `SELECT ed_student_exam_studentCode AS student_id, ed_student_exam_class AS class_id,
              ed_student_exam_subject AS subject_id, ed_student_exam_score AS score
       FROM eduall_student_exam_notes
       WHERE ed_student_exam_deleted = 0 AND ed_student_exam_institute_code = ?
         AND ed_student_exam_class IN (${phClasses}) AND ed_student_exam_studentCode IN (${phStudents})`,
      [instituteCode, ...allClassIds, ...students], true);

    // Batch: todos os alunos de uma vez
    const allStudentsRes = await ExecuteQuery(res,
      `SELECT * FROM eduall_students WHERE ed_student_id IN (${phStudents}) AND ed_student_deleted = 0`,
      students, true);
    const studentMap = new Map(allStudentsRes.map(s => [Number(s.ed_student_id), s]));

    const firstClass  = classesRes[0] || {};
    const cicleTitle  = firstClass.ed_cicle_title || "";
    const anoLetivo   = firstClass.ed_academic_year_title || "";

    const numberToWords = (n) => {
      const units = ["Zero","Um","Dois","Três","Quatro","Cinco","Seis","Sete","Oito","Nove","Dez","Onze","Doze","Treze","Catorze","Quinze","Dezasseis","Dezassete","Dezoito","Dezenove"];
      const tens  = ["","","Vinte","Trinta","Quarenta","Cinquenta","Sessenta","Setenta","Oitenta","Noventa"];
      if (n < 20) return units[Math.max(0, Math.min(n, 19))];
      const t = Math.floor(n / 10), un = n % 10;
      return un === 0 ? tens[t] : `${tens[t]} e ${units[un]}`;
    };

    const hoje = new Date().toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
    const TD   = "border:1px solid #ccc;padding:6px 10px;text-align:center;font-size:12px;";
    const TH   = "border:1px solid #999;padding:7px 10px;text-align:center;font-size:12px;font-weight:700;background:#f4f4f4;";

    const getAvgForClass = (studentId, classId, subjectId) => {
      const notes = quarterlyNotes.filter(n => n.student_id == studentId && n.class_id == classId && n.subject_id == subjectId);
      const exam  = examNotes.find(e => e.student_id == studentId && e.class_id == classId && e.subject_id == subjectId);
      const npts  = notes.map(n => Number(n.npt)).filter(v => !isNaN(v));
      const mfd   = npts.length ? Math.round(npts.reduce((a, b) => a + b, 0) / npts.length) : null;
      const pe    = exam ? Number(exam.score) : null;
      if (mfd !== null && pe !== null) return Math.round((mfd + pe) / 2);
      return mfd ?? pe;
    };

    const results = [];
    for (const studentId of students) {
      const ST = studentMap.get(Number(studentId));
      if (!ST) continue;

      const subjectsForCert = [...new Set(
        orderedLevels.flatMap(lv => {
          const lvClasses = classesRes.filter(c => Number(c.ed_class_academic_level) === Number(lv.ed_academic_level_id));
          return lvClasses.flatMap(c => classSubjectsMap.get(Number(c.ed_class_id)) || []);
        })
      )];

      const headerCols = orderedLevels.map(lv => `<th style="${TH}">${lv.ed_academic_level_title}</th>`).join("");

      let tableRows    = "";
      let totalMedias  = 0, countMedias = 0;
      const subjectsData = [];

      for (const subjectId of subjectsForCert) {
        const subjectName = subjectTitlesMap.get(subjectId) || "-";
        const levelAvgs = orderedLevels.map(lv => {
          const lvClasses = classesRes.filter(c => Number(c.ed_class_academic_level) === Number(lv.ed_academic_level_id));
          const avgs = lvClasses.map(c => getAvgForClass(studentId, Number(c.ed_class_id), subjectId)).filter(v => v !== null);
          return avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;
        });

        let wSum = 0, wCount = 0;
        levelAvgs.forEach((avg, i) => {
          if (avg === null) return;
          const maxVal = Number(orderedLevels[i].max_value) || 20;
          wSum += Math.round((avg / maxVal) * 20); wCount++;
        });
        const mediaFinal = wCount > 0 ? Math.round(wSum / wCount) : null;
        if (mediaFinal !== null) { totalMedias += mediaFinal; countMedias++; }

        const noteColor     = (v) => v === null ? "#e0e0e0" : v < 10 ? "#ffeeee" : "#eeffee";
        const noteTextColor = (v) => v === null ? "#aaa"    : v < 10 ? "#c00"    : "#080";

        const cells = levelAvgs.map((avg) =>
          `<td style="${TD}background:${noteColor(avg)};color:${noteTextColor(avg)};font-weight:700;">${avg ?? ""}</td>`
        ).join("");

        tableRows += `<tr><td style="${TD}text-align:left;font-weight:600;">${subjectName}</td>${cells}<td style="${TD}background:${noteColor(mediaFinal)};color:${noteTextColor(mediaFinal)};font-weight:800;">${mediaFinal ?? ""}</td><td style="${TD}text-align:left;">${mediaFinal !== null ? numberToWords(mediaFinal) + " Valores" : ""}</td></tr>`;
        subjectsData.push({ subject_name: subjectName, class_avgs: levelAvgs, media_final: mediaFinal });
      }

      const mediaGeralFinal = countMedias > 0 ? Math.round(totalMedias / countMedias) : 0;
      const mgBg = mediaGeralFinal < 10 ? "#c00" : "#080";

      const html = `
<div class="cert-page" style="width:100%;max-width:820px;margin:0 auto;padding:60px 70px;font-family:'Times New Roman',Times,serif;font-size:13px;color:#000;background:#fff;line-height:1.75;box-sizing:border-box;">
  <div style="text-align:center;margin-bottom:8px;">
    <img class="cert-logo" src="${LOGO}" style="height:80px;object-fit:contain;"/>
    <div style="margin-top:8px;font-size:12px;">REPÚBLICA DE ANGOLA</div>
    <div style="font-size:12px;">MINISTÉRIO DA EDUCAÇÃO</div>
    <div style="font-size:13px;font-weight:700;">${cicleTitle.toUpperCase()}</div>
  </div>
  <div style="text-align:center;margin:28px 0 22px;font-size:16px;font-weight:700;letter-spacing:2px;">CERTIFICADO</div>
  <div style="text-align:justify;margin-bottom:18px;font-size:13px;">
    <p style="margin-bottom:12px;">
      <strong>a)&nbsp;&nbsp;&nbsp;<span style="display:inline-block;border-bottom:1.5px solid #000;font-weight:700;padding:0 4px;">${INSTITUTE.ed_institute_principal || "___________________________"}</span></strong>,
      Director(a) do ${INSTITUTE.ed_institute_name || "Complexo Escolar Nº"}
      <strong><span style="border-bottom:1.5px solid #000;padding:0 4px;">${INSTITUTE.ed_institute_nif || "XXXXXXX"}</span></strong>,
      em ${province}, certifica que <strong style="color:#c00;border-bottom:1.5px solid #c00;padding:0 2px;">${ST.ed_student_name || "___________________________"}</strong>,
      filho(a) de <span style="border-bottom:1.5px solid #000;min-width:120px;display:inline-block;padding:0 4px;">${ST.ed_student_father_name || "___________________________"}</span>
      e de <span style="border-bottom:1.5px solid #000;min-width:120px;display:inline-block;padding:0 4px;">${ST.ed_student_mother_name || "___________________________"}</span>,
      nascido(a) aos ${u.formatDate(ST.ed_student_birthday)}, natural de ${ST.ed_student_naturalness || "___________"},
      Província de ${province}, portador do B.I nº <strong><span style="border-bottom:1.5px solid #000;padding:0 4px;">${ST.ed_student_identityCard || "___________________________"}</span></strong>.
    </p>
    <p style="margin-bottom:14px;">
      Concluiu no ano lectivo de <strong>${anoLetivo}</strong> o <strong>${cicleTitle.toUpperCase()}</strong>,
      no <strong>(${INSTITUTE.ed_institute_name || "___________________________"})</strong>,
      com a <strong>Média Final de <span style="color:${mgBg}">${mediaGeralFinal}</span>&nbsp;valores</strong>:
    </p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:12.5px;">
    <thead><tr><th style="${TH}text-align:left;min-width:160px;">Disciplinas</th>${headerCols}<th style="${TH}">Média Final</th><th style="${TH}min-width:140px;">Média por Extenso</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div style="text-align:justify;margin-bottom:28px;font-size:13px;">Para efeitos legais lhe é passado o presente <strong>CERTIFICADO</strong>.</div>
  <div style="text-align:center;font-weight:700;margin-bottom:48px;">${INSTITUTE.ed_institute_name || "Complexo Escolar"}, em ${province}, aos ${hoje}</div>
  <div style="display:flex;justify-content:space-between;margin-top:16px;">
    <div style="text-align:center;width:42%;"><div style="font-weight:700;">Conferido por</div><div style="border-top:1.5px solid #000;margin-top:50px;"></div></div>
    <div style="text-align:center;width:42%;"><div style="font-weight:700;">O Director da Escola</div><div style="border-top:1.5px solid #000;margin-top:50px;"></div></div>
  </div>
  <div style="margin-top:36px;font-weight:700;font-size:11px;">Mod. 01/MED-CE ${INSTITUTE.ed_institute_nif || ""}</div>
</div>`;

      results.push({
        student_id: studentId, student_name: ST.ed_student_name,
        institute_name: INSTITUTE.ed_institute_name, institute_logo: LOGO,
        school_year: anoLetivo, cicle_title: cicleTitle,
        subjects: subjectsData, level_labels: orderedLevels.map(l => l.ed_academic_level_title),
        media_geral: mediaGeralFinal, html,
      });
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("GenerateCertificate:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor.", error: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 4. GenerateQualificationsStatement
// ═════════════════════════════════════════════════════════════════════════════
const GenerateQualificationsStatement = async (req, res) => {
  try {
    const { students, classId, withNotes } = req.body;
    if (!Array.isArray(students) || !students.length)
      return res.status(400).json({ success: false, message: "students obrigatório." });
    if (!classId)
      return res.status(400).json({ success: false, message: "classId obrigatório." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ success: false, message: "Sessão inválida." });

    const includeNotes = withNotes === true || withNotes === 1 || withNotes === "true";
    const INSTITUTE    = await loadInstitute(res, instituteCode);
    if (!INSTITUTE) return res.status(404).json({ success: false, message: "Instituição não encontrada." });
    const LOGO     = INSTITUTE.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const province = INSTITUTE.ed_institute_state || "Luanda";

    const classRes = await ExecuteQuery(res,
      `SELECT c.*, al.ed_academic_level_title, al.ed_academic_level_avaliationtype_endat AS max_value,
              ci.ed_cicle_title, ay.ed_academic_year_title, cr.ed_classroom_title, cr.ed_classroom_id
       FROM eduall_class c
       LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
       LEFT JOIN eduall_cicles ci         ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
       LEFT JOIN eduall_academic_year ay  ON ay.ed_academic_year_id = c.ed_class_year AND ay.ed_academic_year_deleted = 0
       LEFT JOIN eduall_classrooms cr     ON cr.ed_classroom_id = c.ed_class_room AND cr.ed_classroom_deleted = 0
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ? AND c.ed_class_id = ? LIMIT 1`,
      [instituteCode, classId], true);
    if (!classRes.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const CLASS       = classRes[0];
    const anoLetivo   = CLASS.ed_academic_year_title || "";
    const classLabel  = CLASS.ed_academic_level_title || CLASS.ed_class_title || "";
    const salaLabel   = CLASS.ed_classroom_title || "";
    const maxVal      = Number(CLASS.max_value) || 20;
    const subjectsList = u.parseIds(CLASS.ed_class_subjects);
    const subjectTitlesMap = await loadSubjects(res, subjectsList);

    const phStudents = students.map(() => "?").join(",");

    // Batch: todos os alunos
    const allStudentsRes = await ExecuteQuery(res,
      `SELECT * FROM eduall_students WHERE ed_student_id IN (${phStudents}) AND ed_student_deleted = 0`,
      students, true);
    const studentMap = new Map(allStudentsRes.map(s => [Number(s.ed_student_id), s]));

    const quarterlyNotes = includeNotes ? await ExecuteQuery(res,
      `SELECT ed_quarter_note_studentcode AS student_id, ed_quarter_note_subject AS subject_id,
              ed_quarter_note_quarter AS quarter, ed_quarter_note_npt AS npt, ed_quarter_note_mac AS mac
       FROM eduall_quarterly_notes
       WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_class = ? AND ed_quarter_note_studentcode IN (${phStudents})`,
      [classId, ...students], true) : [];

    const examNotes = includeNotes ? await ExecuteQuery(res,
      `SELECT ed_student_exam_studentCode AS student_id, ed_student_exam_subject AS subject_id, ed_student_exam_score AS score
       FROM eduall_student_exam_notes
       WHERE ed_student_exam_deleted = 0 AND ed_student_exam_institute_code = ?
         AND ed_student_exam_class = ? AND ed_student_exam_studentCode IN (${phStudents})`,
      [instituteCode, classId, ...students], true) : [];

    const noteToQualitativo = (n) => {
      if (n === null) return "-";
      const v = Number(n);
      if (isNaN(v)) return "-";
      if (v >= 18) return "Muito Bom";
      if (v >= 14) return "Bom";
      if (v >= 10) return "Suficiente";
      if (v >= 5)  return "Medíocre";
      return "Mau";
    };

    const hoje = new Date().toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
    const B    = "border:1px solid #000;";
    const TD   = `${B}padding:6px 12px;font-size:13px;font-family:'Montserrat',Arial,sans-serif;`;

    const results = [];
    for (const studentId of students) {
      const ST = studentMap.get(Number(studentId));
      if (!ST) continue;

      let tableRows = "";
      for (const subjectId of subjectsList) {
        const subjectName = subjectTitlesMap.get(subjectId) || "-";
        let noteDisplay = "-";
        if (includeNotes) {
          const npts  = quarterlyNotes.filter(n => n.student_id == studentId && n.subject_id == subjectId).map(n => Number(n.npt)).filter(v => !isNaN(v));
          const exam  = examNotes.find(e => e.student_id == studentId && e.subject_id == subjectId);
          const mfd   = npts.length ? Math.round(npts.reduce((a, b) => a + b, 0) / npts.length) : null;
          const pe    = exam ? Number(exam.score) : null;
          const mf    = mfd !== null && pe !== null ? Math.round((mfd + pe) / 2) : mfd ?? pe;
          noteDisplay = mf !== null ? (maxVal <= 20 ? String(mf) : noteToQualitativo(mf)) : "-";
        }
        tableRows += `<tr><td style="${TD}text-align:left;">${subjectName}</td><td style="${TD}text-align:center;">${noteDisplay}</td></tr>`;
      }

      const html = `
<div style="width:100%;max-width:780px;margin:0 auto;padding:50px 60px;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#000;background:#fff;line-height:1.8;box-sizing:border-box;border:1.5px solid #000;">
  <div style="text-align:center;margin-bottom:14px;">
    <img src="${LOGO}" style="height:70px;object-fit:contain;"/>
    <div style="margin-top:8px;">República de Angola</div>
    <div>Ministério da Educação</div>
    <div>${CLASS.ed_cicle_title || "Ensino Geral"}</div>
  </div>
  <div style="text-align:center;margin:22px 0 28px;"><span style="font-size:16px;font-weight:700;font-style:italic;text-decoration:underline;">DECLARAÇÃO DE HABILITAÇÕES</span></div>
  <div style="text-align:justify;margin-bottom:18px;">
    <p style="text-indent:30px;">
      <strong>a)&nbsp;<span style="border-bottom:1px solid #000;padding:0 2px;min-width:100px;display:inline-block;">${INSTITUTE.ed_institute_principal || "___________________________"}</span></strong>,
      Director(a) do ${INSTITUTE.ed_institute_name || "___________"} <span style="border-bottom:1px solid #000;padding:0 2px;display:inline-block;">${INSTITUTE.ed_institute_nif || "___________"}</span>,
      em ${province} Declara que <strong style="color:#cc0000;">${ST.ed_student_name || "___________________________"},</strong>
      filho(a) de <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${ST.ed_student_father_name || "___________________________"}</span>
      e de <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${ST.ed_student_mother_name || "___________________________"}</span>,
      nascido(a) aos ${u.formatDate(ST.ed_student_birthday, { long: true })},
      natural de ${ST.ed_student_naturalness || "___________"}, Província de ${province},
      portador(a) do documento nº <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${ST.ed_student_identityCard || "_______________"}</span>.
    </p>
  </div>
  <div style="margin-bottom:16px;">
    Frequentou no ano Lectivo de <strong>${anoLetivo}</strong> a <strong style="color:#cc0000;">${classLabel}</strong>,
    Turma: <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${CLASS.ed_class_title || "___"}</span>
    Sala nº <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${salaLabel || "__"}</span>
    sob o nº <span style="border-bottom:1px solid #000;display:inline-block;padding:0 2px;">${ST.ed_student_code || "__"}</span>:
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
    <thead><tr><th style="${TD}text-align:center;font-style:italic;font-weight:400;background:#fff;">Disciplinas</th><th style="${TD}text-align:center;font-style:italic;font-weight:400;background:#fff;">Notas</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div style="text-align:justify;margin-bottom:30px;">
    <div>A presente declaração destina-se para: <strong style="color:#cc0000;">Efeitos Legais.</strong></div>
    <div style="margin-top:6px;">Por ser verdade e me ter sido solicitada, mandei passar a presente declaração, autenticada com o carimbo a óleo desta Escola.</div>
  </div>
  <div style="text-align:center;font-weight:700;margin-bottom:40px;">${INSTITUTE.ed_institute_name || "Complexo Escolar"}, em ${province}, aos ${hoje}</div>
  <div style="display:flex;justify-content:space-between;margin-top:10px;">
    <div style="width:40%;">Buscas <span style="display:inline-block;border-bottom:1px solid #000;width:140px;"></span></div>
    <div style="text-align:center;width:40%;">
      <div>O Director(a) do Complexo</div>
      <div style="border-top:1px solid #000;margin-top:50px;margin-bottom:4px;"></div>
      <div style="font-weight:700;">${INSTITUTE.ed_institute_principal || ""}</div>
    </div>
  </div>
</div>`;

      results.push({ student_id: studentId, student_name: ST.ed_student_name, html });
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("GenerateQualificationsStatement:", error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor.", error: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 5. GenerateMiniPautaBySubject
// ═════════════════════════════════════════════════════════════════════════════
const GenerateMiniPautaBySubject = async (req, res) => {
  try {
    const { classIds, subjectId, roundMode = "default", header = "", logoUrl = "" } = req.body;
    if (!classIds || !Array.isArray(classIds) || !classIds.length || !subjectId)
      return res.status(400).json({ success: false, message: "classIds e subjectId obrigatórios." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const classIds_Num  = classIds.map(Number).filter(Number.isFinite);

    const [classRes, subjRes, instRes] = await Promise.all([
      loadClassesBatch(res, classIds_Num, instituteCode),
      ExecuteQuery(res, `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id = ? AND ed_subject_deleted = 0`, [subjectId], true),
      ExecuteQuery(res, `SELECT ed_institute_name, ed_logo_urlcloudinary FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);

    if (!classRes?.length)  return res.status(404).json({ success: false, message: "Turma não encontrada." });
    if (!subjRes?.length)   return res.status(404).json({ success: false, message: "Disciplina não encontrada." });

    const subjectTitle = subjRes[0].ed_subject_title;
    const institute    = instRes?.[0] || {};
    const finalLogo    = logoUrl || institute.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const finalHeader  = header  || institute.ed_institute_name || "INSTITUIÇÃO EDUCACIONAL";

    const pautas = [];
    for (const classInfo of classRes) {
      const classId     = Number(classInfo.ed_class_id);
      const behaviorMap = u.parseBehaviors(classInfo.ed_class_subject_behaviors);
      const behavior    = behaviorMap.get(Number(subjectId)) || "negative_reprova";

      // Batch por turma
      const [studentsRes, notesRes] = await Promise.all([
        loadStudents(res, classId),
        ExecuteQuery(res,
          `SELECT ed_quarter_note_studentcode, ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npt
           FROM eduall_quarterly_notes WHERE ed_quarter_note_class = ? AND ed_quarter_note_subject = ? AND ed_quarter_note_deleted = 0`,
          [classId, subjectId], true),
      ]);

      let tableRows = "";
      for (const student of studentsRes) {
        const sid = Number(student.ed_student_id);
        const qtrs = [1, 2, 3].map(q => {
          const note = notesRes.find(n => n.ed_quarter_note_studentcode == sid && n.ed_quarter_note_quarter == q);
          const mac = u.num(note?.ed_quarter_note_mac), npt = u.num(note?.ed_quarter_note_npt);
          return mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
        });
        const mfd        = qtrs.every(q => q !== null) ? u.round(qtrs.reduce((a, b) => a + b, 0) / 3, roundMode) : null;
        const isApproved = u.approve(mfd, behavior);
        const obsText    = u.getStatus(isApproved, false);
        tableRows += `<tr><td style="${css.td}text-align:left;font-weight:bold;">${student.ed_student_name}</td>${qtrs.map((mt, i) => `<td style="${css.td}text-align:center;color:${u.color(mt, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mt, roundMode)}</td>`).join("")}<td style="${css.td}text-align:center;color:${u.color(mfd, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mfd, roundMode)}</td><td style="${css.td}text-align:center;font-weight:bold;">${obsText}</td></tr>`;
      }

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mini Pauta - ${subjectTitle}</title><style>body{${css.body}}.header{${css.header}}.logo{${css.logo}}table{${css.table}}th{${css.th}}td{${css.td}}</style></head><body><div class="header"><img src="${finalLogo}" class="logo"><div class="title">${finalHeader}</div><div class="subtitle">MINI PAUTA - ${subjectTitle}</div><div class="subtitle">${classInfo.ed_class_title}</div></div><table><thead><tr><th>ALUNO</th><th>MT1</th><th>MT2</th><th>MT3</th><th>MFD</th><th>OBS</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
      pautas.push({ class_id: classId, class_name: classInfo.ed_class_title, html });
    }

    return res.status(200).json({ success: true, data: pautas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro ao gerar mini pauta por disciplina." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 6. GenerateMiniPautaByClass
// ═════════════════════════════════════════════════════════════════════════════
const GenerateMiniPautaByClass = async (req, res) => {
  try {
    const { classIds, quarter, roundMode = "default", header = "", logoUrl = "" } = req.body;
    if (!classIds || !Array.isArray(classIds) || !classIds.length || !quarter)
      return res.status(400).json({ success: false, message: "classIds e quarter obrigatórios." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const classIds_Num  = classIds.map(Number).filter(Number.isFinite);
    const quarterNum    = Number(quarter);

    const [classRes, instRes] = await Promise.all([
      loadClassesBatch(res, classIds_Num, instituteCode),
      ExecuteQuery(res, `SELECT ed_institute_name, ed_logo_urlcloudinary FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const institute   = instRes?.[0] || {};
    const finalLogo   = logoUrl || institute.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const finalHeader = header  || institute.ed_institute_name || "INSTITUIÇÃO EDUCACIONAL";

    const pautas = [];
    for (const classInfo of classRes) {
      const classId    = Number(classInfo.ed_class_id);
      const subjectIds = u.parseIds(classInfo.ed_class_subjects);
      const subjectMap = await loadSubjects(res, subjectIds);

      const [studentsRes, notesRes] = await Promise.all([
        loadStudents(res, classId),
        ExecuteQuery(res,
          `SELECT ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_mac, ed_quarter_note_npt
           FROM eduall_quarterly_notes WHERE ed_quarter_note_class = ? AND ed_quarter_note_quarter = ? AND ed_quarter_note_deleted = 0`,
          [classId, quarterNum], true),
      ]);

      let tableRows = "";
      for (const student of studentsRes) {
        const sid = Number(student.ed_student_id);
        tableRows += `<tr><td style="${css.td}font-weight:bold;">${student.ed_student_name}</td>`;
        for (const subjectId of subjectIds) {
          const note = notesRes.find(n => n.ed_quarter_note_studentcode == sid && n.ed_quarter_note_subject == subjectId);
          const mac  = u.num(note?.ed_quarter_note_mac), npt = u.num(note?.ed_quarter_note_npt);
          const mt   = mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
          tableRows += `<td style="${css.td}text-align:center;color:${u.color(mt, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mt, roundMode)}</td>`;
        }
        tableRows += "</tr>";
      }

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mini Pauta - ${quarterNum}º Trimestre</title><style>body{${css.body}}.header{${css.header}}.logo{${css.logo}}table{${css.table}}th{${css.th}}td{${css.td}}</style></head><body><div class="header"><img src="${finalLogo}" class="logo"><div class="title">${finalHeader}</div><div class="subtitle">MINI PAUTA - ${quarterNum}º TRIMESTRE</div><div class="subtitle">${classInfo.ed_class_title}</div></div><table><thead><tr><th>ALUNO</th>${subjectIds.map(id => `<th>${subjectMap.get(id) || ""}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
      pautas.push({ class_id: classId, class_name: classInfo.ed_class_title, quarter: quarterNum, html });
    }

    return res.status(200).json({ success: true, data: pautas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro ao gerar mini pauta por turma." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 7. GenerateFinalPauta  (sem exames)
// ═════════════════════════════════════════════════════════════════════════════
const GenerateFinalPauta = async (req, res) => {
  try {
    const { classIds, subjectFilter = 0, roundMode = "default", header = "", logoUrl = "" } = req.body;
    if (!classIds || !Array.isArray(classIds) || !classIds.length)
      return res.status(400).json({ success: false, message: "classIds obrigatório." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const classIds_Num  = classIds.map(Number).filter(Number.isFinite);

    const [classRes, instRes] = await Promise.all([
      loadClassesBatch(res, classIds_Num, instituteCode),
      ExecuteQuery(res, `SELECT ed_institute_name, ed_logo_urlcloudinary FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const institute   = instRes?.[0] || {};
    const finalLogo   = logoUrl || institute.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const finalHeader = header  || institute.ed_institute_name || "INSTITUIÇÃO EDUCACIONAL";

    const pautas = [];
    for (const classInfo of classRes) {
      const classId     = Number(classInfo.ed_class_id);
      let subjectIds    = u.parseIds(classInfo.ed_class_subjects);
      const behaviorMap = u.parseBehaviors(classInfo.ed_class_subject_behaviors);
      if (Number(subjectFilter) > 0) subjectIds = subjectIds.filter(id => id === Number(subjectFilter));

      const subjectMap = await loadSubjects(res, subjectIds);
      const [studentsRes, notesRes] = await Promise.all([
        loadStudents(res, classId),
        ExecuteQuery(res,
          `SELECT ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npt
           FROM eduall_quarterly_notes WHERE ed_quarter_note_class = ? AND ed_quarter_note_quarter IN (1,2,3) AND ed_quarter_note_deleted = 0`,
          [classId], true),
      ]);

      let tableRows = "", statsTransita = 0, statsNaoTransita = 0;
      studentsRes.forEach((student, idx) => {
        const sid = Number(student.ed_student_id);
        tableRows += `<tr><td style="${css.td}text-align:center;font-weight:bold;">${idx + 1}</td><td style="${css.td}font-weight:bold;">${student.ed_student_name}</td>`;
        let allApprove = [];
        for (const subjectId of subjectIds) {
          const behavior = behaviorMap.get(subjectId) || "negative_reprova";
          const qtrs = [1, 2, 3].map(q => {
            const note = notesRes.find(n => n.ed_quarter_note_studentcode == sid && n.ed_quarter_note_subject == subjectId && n.ed_quarter_note_quarter == q);
            const mac = u.num(note?.ed_quarter_note_mac), npt = u.num(note?.ed_quarter_note_npt);
            return mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
          });
          const mfd = qtrs.every(q => q !== null) ? u.round(qtrs.reduce((a, b) => a + b, 0) / 3, roundMode) : null;
          allApprove.push(u.approve(mfd, behavior) !== false);
          tableRows += `<td style="${css.td}text-align:center;color:${u.color(mfd, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mfd, roundMode)}</td>`;
        }
        const ok = allApprove.every(a => a);
        tableRows += `<td style="${css.td}text-align:center;font-weight:bold;color:${ok ? "#072AC8" : "#DC2626"};">${ok ? "Transita" : "Não Transita"}</td></tr>`;
        if (ok) statsTransita++; else statsNaoTransita++;
      });

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pauta Final</title><style>body{${css.body}}.header{${css.header}}.logo{${css.logo}}table{${css.table}}th{${css.th}}td{${css.td}}.stats{margin-top:15px;font-size:12px;}</style></head><body><div class="header"><img src="${finalLogo}" class="logo"><div class="title">${finalHeader}</div><div class="subtitle">PAUTA FINAL</div><div class="subtitle">${classInfo.ed_class_title}</div></div><table><thead><tr><th style="width:30px;">N</th><th>ALUNO</th>${subjectIds.map(id => `<th>${subjectMap.get(id) || ""}</th>`).join("")}<th>STATUS</th></tr></thead><tbody>${tableRows}</tbody></table><div class="stats"><strong>Estatísticas:</strong> Transita: ${statsTransita} | Não Transita: ${statsNaoTransita} | Total: ${statsTransita + statsNaoTransita}</div></body></html>`;
      pautas.push({ class_id: classId, class_name: classInfo.ed_class_title, html });
    }

    return res.status(200).json({ success: true, data: pautas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro ao gerar pauta final." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 8. GenerateFinalPautaExam  (com exames + recurso — tabela CORRIGIDA)
// ═════════════════════════════════════════════════════════════════════════════
const GenerateFinalPautaExam = async (req, res) => {
  try {
    const { classIds, subjectFilter = 0, roundMode = "default", header = "", logoUrl = "" } = req.body;
    if (!classIds || !Array.isArray(classIds) || !classIds.length)
      return res.status(400).json({ success: false, message: "classIds obrigatório." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const classIds_Num  = classIds.map(Number).filter(Number.isFinite);

    const [classRes, instRes] = await Promise.all([
      loadClassesBatch(res, classIds_Num, instituteCode),
      ExecuteQuery(res, `SELECT ed_institute_name, ed_logo_urlcloudinary FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const institute   = instRes?.[0] || {};
    const finalLogo   = logoUrl || institute.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const finalHeader = header  || institute.ed_institute_name || "INSTITUIÇÃO EDUCACIONAL";

    const pautas = [];
    for (const classInfo of classRes) {
      const classId     = Number(classInfo.ed_class_id);
      let subjectIds    = u.parseIds(classInfo.ed_class_subjects);
      const behaviorMap = u.parseBehaviors(classInfo.ed_class_subject_behaviors);
      if (Number(subjectFilter) > 0) subjectIds = subjectIds.filter(id => id === Number(subjectFilter));

      const subjectMap = await loadSubjects(res, subjectIds);
      const studentsRes = await loadStudents(res, classId);
      const studentIds  = studentsRes.map(s => Number(s.ed_student_id));

      // Batch todas as notas desta turma
      const [notesRes, examRes, resourceRes] = await Promise.all([
        ExecuteQuery(res,
          `SELECT ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npt
           FROM eduall_quarterly_notes WHERE ed_quarter_note_class = ? AND ed_quarter_note_quarter IN (1,2,3) AND ed_quarter_note_deleted = 0`,
          [classId], true),
        loadExams(res, classId, studentIds),
        loadFeatured(res, classId, studentIds),
      ]);

      let tableRows = "", statsTransita = 0, statsNaoTransita = 0;
      studentsRes.forEach((student, idx) => {
        const sid = Number(student.ed_student_id);
        tableRows += `<tr><td style="${css.td}text-align:center;font-weight:bold;">${idx + 1}</td><td style="${css.td}font-weight:bold;">${student.ed_student_name}</td>`;
        let allApprove = [];
        for (const subjectId of subjectIds) {
          const behavior = behaviorMap.get(subjectId) || "negative_reprova";
          const half     = (Number(classInfo.max_value) || 20) / 2;
          const qtrs = [1, 2, 3].map(q => {
            const note = notesRes.find(n => n.ed_quarter_note_studentcode == sid && n.ed_quarter_note_subject == subjectId && n.ed_quarter_note_quarter == q);
            const mac = u.num(note?.ed_quarter_note_mac), npt = u.num(note?.ed_quarter_note_npt);
            return mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
          });
          const mfd = qtrs.every(q => q !== null) ? u.round(qtrs.reduce((a, b) => a + b, 0) / 3, roundMode) : null;
          const ne  = examRes.get(`${sid}_${subjectId}`) ?? null;
          const rc  = resourceRes.get(`${sid}_${subjectId}`) ?? null;

          let nf = mfd;
          if (ne !== null) nf = mfd !== null ? u.round((mfd + ne) / 2, roundMode) : ne;
          if (rc !== null && nf !== null && nf < half) nf = u.round(Math.max(nf, rc), roundMode);

          allApprove.push(u.approve(nf, behavior) !== false);
          tableRows += `<td style="${css.td}text-align:center;color:${u.color(nf, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(nf, roundMode)}</td>`;
        }
        const ok = allApprove.every(a => a);
        tableRows += `<td style="${css.td}text-align:center;font-weight:bold;color:${ok ? "#072AC8" : "#DC2626"};">${ok ? "Transita" : "Não Transita"}</td></tr>`;
        if (ok) statsTransita++; else statsNaoTransita++;
      });

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pauta Final - Exame</title><style>body{${css.body}}.header{${css.header}}.logo{${css.logo}}table{${css.table}}th{${css.th}}td{${css.td}}.stats{margin-top:15px;font-size:12px;}</style></head><body><div class="header"><img src="${finalLogo}" class="logo"><div class="title">${finalHeader}</div><div class="subtitle">PAUTA FINAL - EXAME</div><div class="subtitle">${classInfo.ed_class_title}</div></div><table><thead><tr><th style="width:30px;">N</th><th>ALUNO</th>${subjectIds.map(id => `<th>${subjectMap.get(id) || ""}</th>`).join("")}<th>STATUS</th></tr></thead><tbody>${tableRows}</tbody></table><div class="stats"><strong>Estatísticas:</strong> Transita: ${statsTransita} | Não Transita: ${statsNaoTransita} | Total: ${statsTransita + statsNaoTransita}</div></body></html>`;
      pautas.push({ class_id: classId, class_name: classInfo.ed_class_title, html });
    }

    return res.status(200).json({ success: true, data: pautas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro ao gerar pauta final de exame." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 9. GenerateTeacherMiniPauta
// ═════════════════════════════════════════════════════════════════════════════
const GenerateTeacherMiniPauta = async (req, res) => {
  try {
    const { classIds, subjectId, roundMode = "default", header = "", logoUrl = "" } = req.body;
    if (!classIds || !Array.isArray(classIds) || !classIds.length || !subjectId)
      return res.status(400).json({ success: false, message: "classIds e subjectId obrigatórios." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const classIds_Num  = classIds.map(Number).filter(Number.isFinite);

    const [classRes, subjRes, instRes] = await Promise.all([
      loadClassesBatch(res, classIds_Num, instituteCode),
      ExecuteQuery(res, `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id = ? AND ed_subject_deleted = 0`, [subjectId], true),
      ExecuteQuery(res, `SELECT ed_institute_name, ed_logo_urlcloudinary FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length)  return res.status(404).json({ success: false, message: "Turma não encontrada." });
    if (!subjRes?.length)   return res.status(404).json({ success: false, message: "Disciplina não encontrada." });

    const subjectTitle = subjRes[0].ed_subject_title;
    const institute    = instRes?.[0] || {};
    const finalLogo    = logoUrl || institute.ed_logo_urlcloudinary || DEFAULT_LOGO;
    const finalHeader  = header  || institute.ed_institute_name || "INSTITUIÇÃO EDUCACIONAL";

    const pautas = [];
    for (const classInfo of classRes) {
      const classId     = Number(classInfo.ed_class_id);
      const behaviorMap = u.parseBehaviors(classInfo.ed_class_subject_behaviors);
      const behavior    = behaviorMap.get(Number(subjectId)) || "negative_reprova";

      const [teacherRes, studentsRes, notesRes] = await Promise.all([
        ExecuteQuery(res,
          `SELECT DISTINCT ts.ed_tch_subject_teacher_code, e.ed_employee_name
           FROM eduall_teacher_subjects ts
           LEFT JOIN eduall_employees e ON e.ed_employee_id = ts.ed_tch_subject_teacher_code
           WHERE ts.ed_tch_subject_class = ? AND ts.ed_tch_subject_code = ? AND ts.ed_tch_subject_deleted = 0 LIMIT 1`,
          [classId, subjectId], true),
        loadStudents(res, classId),
        ExecuteQuery(res,
          `SELECT ed_quarter_note_studentcode, ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npt
           FROM eduall_quarterly_notes WHERE ed_quarter_note_class = ? AND ed_quarter_note_subject = ? AND ed_quarter_note_deleted = 0`,
          [classId, subjectId], true),
      ]);

      const teacherName = teacherRes?.[0]?.ed_employee_name || "Sem Professor Atribuído";
      let tableRows = "";
      for (const student of studentsRes) {
        const sid  = Number(student.ed_student_id);
        const qtrs = [1, 2, 3].map(q => {
          const note = notesRes.find(n => n.ed_quarter_note_studentcode == sid && n.ed_quarter_note_quarter == q);
          const mac = u.num(note?.ed_quarter_note_mac), npt = u.num(note?.ed_quarter_note_npt);
          return mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
        });
        const mfd        = qtrs.every(q => q !== null) ? u.round(qtrs.reduce((a, b) => a + b, 0) / 3, roundMode) : null;
        const isApproved = u.approve(mfd, behavior);
        tableRows += `<tr><td style="${css.td}text-align:left;font-weight:bold;">${student.ed_student_name}</td>${qtrs.map(mt => `<td style="${css.td}text-align:center;color:${u.color(mt, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mt, roundMode)}</td>`).join("")}<td style="${css.td}text-align:center;color:${u.color(mfd, classInfo.max_value, roundMode)};font-weight:bold;">${u.format(mfd, roundMode)}</td><td style="${css.td}text-align:center;font-weight:bold;">${u.getStatus(isApproved, false)}</td></tr>`;
      }

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mini Pauta do Professor - ${subjectTitle}</title><style>body{${css.body}}.header{${css.header}}.logo{${css.logo}}table{${css.table}}th{${css.th}}td{${css.td}}.teacher-info{font-size:12px;margin-top:10px;color:#333;}</style></head><body><div class="header"><img src="${finalLogo}" class="logo"><div class="title">${finalHeader}</div><div class="subtitle">MINI PAUTA DO PROFESSOR - ${subjectTitle}</div><div class="subtitle">${classInfo.ed_class_title}</div><div class="teacher-info"><strong>Professor:</strong> ${teacherName}</div></div><table><thead><tr><th>ALUNO</th><th>MT1</th><th>MT2</th><th>MT3</th><th>MFD</th><th>OBS</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
      pautas.push({ class_id: classId, class_name: classInfo.ed_class_title, teacher_name: teacherName, html });
    }

    return res.status(200).json({ success: true, data: pautas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro ao gerar mini pauta do professor." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 10. GenerateAnnualBulletin
// ═════════════════════════════════════════════════════════════════════════════
const GenerateAnnualBulletin = async (req, res) => {
  try {
    const { classId, studentIds, roundMode = "default" } = req.body;
    if (!classId || !Array.isArray(studentIds) || !studentIds.length)
      return res.status(400).json({ success: false, message: "classId e studentIds obrigatórios." });

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    const [classRes, instRes] = await Promise.all([
      ExecuteQuery(res, CLASS_FULL_QUERY, [classId, instituteCode], true),
      ExecuteQuery(res, `SELECT * FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const classInfo   = classRes[0];
    const subjectIds  = u.parseIds(classInfo.ed_class_subjects);
    const keyIds      = u.parseIds(classInfo.ed_class_key_subjects);
    const behaviorMap = u.parseBehaviors(classInfo.ed_class_subject_behaviors);
    const maxValue    = Number(classInfo.max_value);
    const passValue   = maxValue / 2;
    const institute   = instRes?.[0] || {};

    const studentIds_Num = studentIds.map(Number).filter(Number.isFinite);

    const [subjectMap, subDirRes, studentRes, notesMap, absencesMap] = await Promise.all([
      loadSubjects(res, subjectIds),
      loadSubDirector(res, instituteCode),
      ExecuteQuery(res,
        `SELECT * FROM eduall_students WHERE ed_student_id IN (${studentIds_Num.map(() => "?").join(",")}) AND ed_student_deleted = 0 ORDER BY ed_student_name ASC`,
        studentIds_Num, true),
      loadQuarterly(res, classId, studentIds_Num),
      loadAbsences(res, classId, studentIds_Num),
    ]);

    const students = studentRes.map(student => {
      const studentId = Number(student.ed_student_id);
      const grades = subjectIds.map(subjectId => {
        const mt1 = notesMap.get(`${studentId}_${subjectId}_1`)?.npt != null
          ? u.round((notesMap.get(`${studentId}_${subjectId}_1`).mac + notesMap.get(`${studentId}_${subjectId}_1`).npt) / 2, roundMode) : null;
        // Recalcular corretamente
        const getmt = (q) => {
          const d = notesMap.get(`${studentId}_${subjectId}_${q}`);
          if (!d) return null;
          return d.mac !== null && d.npt !== null ? u.round((d.mac + d.npt) / 2, roundMode) : null;
        };
        const _mt1 = getmt(1), _mt2 = getmt(2), _mt3 = getmt(3);
        const mdf  = _mt1 !== null && _mt2 !== null && _mt3 !== null
          ? u.round((_mt1 + _mt2 + _mt3) / 3, roundMode) : null;
        const absences = absencesMap.get(`${studentId}_${subjectId}`) ?? 0;
        const isKey    = keyIds.includes(subjectId);
        const behavior = behaviorMap.get(subjectId) ?? "negative_reprova";
        let passed = null;
        if (mdf !== null) passed = behavior === "approve_anyway" ? true : mdf >= passValue;
        return { subject_id: subjectId, subject_title: subjectMap.get(subjectId) || "", is_key: isKey, behavior, mt1: _mt1, mt2: _mt2, mt3: _mt3, mdf, absences, passed };
      });

      const gradedSubjects    = grades.filter(g => g.mdf !== null);
      const allComplete       = grades.every(g => g.mt1 !== null && g.mt2 !== null && g.mt3 !== null);
      const totalFailed       = grades.filter(g => g.passed === false);
      const failedKey         = grades.filter(g => g.is_key && g.passed === false);
      const failedNormal      = grades.filter(g => !g.is_key && g.passed === false);
      const finalSituation    = totalFailed.length === 0 && allComplete ? "TRANSITA" : "NÃO TRANSITA";
      const totalAbsences     = grades.reduce((acc, g) => acc + g.absences, 0);

      return {
        student_id: studentId, student_name: student.ed_student_name || "",
        student_code: student.ed_student_code || "",
        period: student.ed_student_period ?? "",
        period_label: PERIOD_MAP[String(student.ed_student_period)] ?? "",
        grades,
        summary: { total_subjects: subjectIds.length, graded: gradedSubjects.length, passed_count: gradedSubjects.filter(g => g.passed).length, failed_count: totalFailed.length, failed_key_subjects: failedKey.map(g => g.subject_title), failed_normal_subjects: failedNormal.map(g => g.subject_title), total_absences: totalAbsences, all_quarters_complete: allComplete, final_situation: finalSituation },
      };
    });

    return res.status(200).json({
      success: true, report_type: "annual", max_value: maxValue, pass_value: passValue,
      school: { name: institute.ed_institute_name || "", state: institute.ed_institute_state || "", principal: u.shortName(institute.ed_institute_principal || ""), logo_url: institute.ed_logo_urlcloudinary || "" },
      class: { id: Number(classInfo.ed_class_id), code: classInfo.ed_class_code || "", title: classInfo.ed_class_title || "", academic_year: classInfo.ed_academic_year_title || "", classroom: classInfo.ed_classroom_title || "", director_name: u.shortName(classInfo.director_name || ""), period: PERIOD_MAP[String(classInfo.ed_class_periodo)] ?? "" },
      sub_director_pedagogical: u.shortName(subDirRes),
      students,
    });
  } catch (error) {
    console.error("[GenerateAnnualBulletin]", error);
    return res.status(500).json({ success: false, message: "Erro ao obter dados do boletim anual." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 11. GenerateIndividualBulletin
// ═════════════════════════════════════════════════════════════════════════════
const GenerateIndividualBulletin = async (req, res) => {
  try {
    const { classId, studentIds, roundMode = "default", quarter = 1 } = req.body;
    if (!classId || !Array.isArray(studentIds) || !studentIds.length)
      return res.status(400).json({ success: false, message: "classId e studentIds obrigatórios." });

    const quarterNum = Number(quarter);
    if (![1, 2, 3].includes(quarterNum))
      return res.status(400).json({ success: false, message: "Trimestre inválido." });

    const instituteCode  = req.session?.user?.eduall_user_session_curentinstitute;
    const quarterLabel   = QUARTER_LABEL[quarterNum];

    const [classRes, instRes] = await Promise.all([
      ExecuteQuery(res, CLASS_FULL_QUERY, [classId, instituteCode], true),
      ExecuteQuery(res, `SELECT * FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
    ]);
    if (!classRes?.length) return res.status(404).json({ success: false, message: "Turma não encontrada." });

    const classInfo      = classRes[0];
    const subjectIds     = u.parseIds(classInfo.ed_class_subjects);
    const studentIds_Num = studentIds.map(Number).filter(Number.isFinite);
    const institute      = instRes?.[0] || {};
    const maxValue       = Number(classInfo.max_value);

    const [subjectMap, subDirRes, studentRes] = await Promise.all([
      loadSubjects(res, subjectIds),
      loadSubDirector(res, instituteCode),
      ExecuteQuery(res,
        `SELECT * FROM eduall_students WHERE ed_student_id IN (${studentIds_Num.map(() => "?").join(",")}) AND ed_student_deleted = 0 ORDER BY ed_student_name ASC`,
        studentIds_Num, true),
    ]);

    const notesRes = await ExecuteQuery(res,
      `SELECT ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_mac, ed_quarter_note_npt
       FROM eduall_quarterly_notes
       WHERE ed_quarter_note_class = ? AND ed_quarter_note_quarter = ?
         AND ed_quarter_note_studentcode IN (${studentIds_Num.map(() => "?").join(",")}) AND ed_quarter_note_deleted = 0`,
      [classId, quarterNum, ...studentIds_Num], true);

    const notesMap = new Map();
    notesRes.forEach(n => {
      const key = `${n.ed_quarter_note_studentcode}_${n.ed_quarter_note_subject}`;
      const mac = u.num(n.ed_quarter_note_mac), npt = u.num(n.ed_quarter_note_npt);
      const mt  = mac !== null && npt !== null ? u.round((mac + npt) / 2, roundMode) : null;
      notesMap.set(key, { mac, npt, mt });
    });

    const students = studentRes.map(student => {
      const studentId = Number(student.ed_student_id);
      const grades = subjectIds.map(subjectId => {
        const d   = notesMap.get(`${studentId}_${subjectId}`) || {};
        const mac = d.mac ?? null, npt = d.npt ?? null, mt = d.mt ?? null;
        return { subject_id: subjectId, subject_title: subjectMap.get(subjectId) || "", mac, npt, mt, passed: mt !== null ? mt >= maxValue / 2 : null };
      });
      const graded = grades.filter(g => g.mt !== null);
      return { student_id: studentId, student_name: student.ed_student_name || "", student_code: student.ed_student_code || "", period: student.ed_student_period || "", course: student.ed_student_course || "", grades, summary: { total_subjects: subjectIds.length, graded: graded.length, passed: graded.filter(g => g.passed).length, failed: graded.filter(g => !g.passed).length } };
    });

    return res.status(200).json({
      success: true, quarter: quarterNum, quarter_label: quarterLabel,
      school: { name: institute.ed_institute_name || "", state: institute.ed_institute_state || "", logo_url: institute.ed_logo_urlcloudinary || "", coat_of_arms_url: institute.ed_institute_coat_of_arms || "" },
      class: { id: Number(classInfo.ed_class_id), code: classInfo.ed_class_code || "", title: classInfo.ed_class_title || "", academic_year: classInfo.ed_academic_year_title || "", classroom: classInfo.ed_classroom_title || "", director_name: u.shortName(classInfo.director_name || "") },
      sub_director_pedagogical: u.shortName(subDirRes),
      students,
    });
  } catch (error) {
    console.error("[GenerateIndividualBulletin]", error);
    return res.status(500).json({ success: false, message: "Erro ao obter dados do boletim." });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// 12. GenerateClassGrades
// ═════════════════════════════════════════════════════════════════════════════
// Helper: arredonda a 1 casa decimal, preserva null
const r1 = v => v !== null ? Math.round(v * 10) / 10 : null; 
// ─────────────────────────────────────────────────────────────────────
// HELPER: carregar alunos antigos da turma
// ─────────────────────────────────────────────────────────────────────
 // ─────────────────────────────────────────────────────────────────────
// HELPER: carregar alunos antigos da turma (COM DEBUG COMPLETO)
// ─────────────────────────────────────────────────────────────────────
const loadOldStudents = async (res, classId) => {
  try {
    console.log(`\n[🔍 DEBUG OLD STUDENTS] ────────────────────────────────────────`);
    console.log(`[🔍 DEBUG] classId=${classId}`);
    
    // Query 1: contar quantos registos existem na tabela inteira
    const countAll = await ExecuteQuery(res,
      `SELECT COUNT(*) as total FROM eduall_student_old_classes`,
      [], true);
    console.log(`[📊 DB] Total de registos em eduall_student_old_classes: ${countAll?.[0]?.total ?? 0}`);
 
    // Query 2: contar registos por turma
    const countByClass = await ExecuteQuery(res,
      `SELECT COUNT(*) as total FROM eduall_student_old_classes WHERE ed_student_old_class = ?`,
      [classId], true);
    console.log(`[📊 DB] Registos nesta turma (${classId}): ${countByClass?.[0]?.total ?? 0}`);
 
    // Query 3: ver TODOS os registos da turma (raw)
    const allRecords = await ExecuteQuery(res,
      `SELECT ed_student_old_class_id, ed_student_old_class_student, ed_student_old_class
       FROM eduall_student_old_classes 
       WHERE ed_student_old_class = ?
       ORDER BY ed_student_old_class_id DESC`,
      [classId], true);
    
    if (allRecords?.length) {
      console.log(`[📋 RECORDS] ${allRecords.length} registos encontrados:`);
      allRecords.forEach((r, idx) => {
        console.log(`   [${idx + 1}] ID=${r.ed_student_old_class_id}, student_id=${r.ed_student_old_class_student}`);
      });
    } else {
      console.log(`[⚠️  RECORDS] ❌ Nenhum registo encontrado nesta turma!`);
    }
 
    // Query 4: extrair IDs únicos
    const oldRes = await ExecuteQuery(res,
      `SELECT DISTINCT ed_student_old_class_student AS ed_student_id
       FROM eduall_student_old_classes
       WHERE ed_student_old_class = ?
       ORDER BY ed_student_id ASC`,
      [classId], true);
    
    const allOldIds = oldRes ? oldRes.map(o => Number(o.ed_student_id)) : [];
    console.log(`[✅ IDs BRUTOS] ${allOldIds.length} alunos ANTIGOS encontrados: [${allOldIds.join(", ")}]`);
 
    // Query 5: VERIFICAR se esses alunos ainda EXISTEM em eduall_students (não apagados)
    let validOldIds = [];
    if (allOldIds.length) {
      const ph = allOldIds.map(() => "?").join(",");
      const studentsExist = await ExecuteQuery(res,
        `SELECT ed_student_id, ed_student_name FROM eduall_students 
         WHERE ed_student_id IN (${ph}) AND ed_student_deleted = 0`,
        allOldIds, true);
      
      validOldIds = studentsExist?.map(s => Number(s.ed_student_id)) ?? [];
      console.log(`[👤 VALIDAÇÃO] ${validOldIds.length}/${allOldIds.length} alunos ainda existem no sistema:`);
      studentsExist?.forEach(s => {
        console.log(`   ✅ ID ${s.ed_student_id}: ${s.ed_student_name}`);
      });
 
      // Mostrar quais foram eliminados
      const deletedIds = allOldIds.filter(id => !validOldIds.includes(id));
      if (deletedIds.length) {
        console.log(`[🗑️  ELIMINADOS] ${deletedIds.length} alunos foram deletados: [${deletedIds.join(", ")}]`);
      }
    }
 
    console.log(`[🔍 DEBUG OLD STUDENTS] ✅ Retornando ${validOldIds.length} IDs válidos`);
    console.log(`[🔍 DEBUG OLD STUDENTS] ────────────────────────────────────────\n`);
    return validOldIds;
 
  } catch (err) {
    console.error("[❌ loadOldStudents] Erro crítico:", err.message);
    console.error(err.stack);
    return [];
  }
};
 
// ─────────────────────────────────────────────────────────────────────
// MAIN CONTROLLER: GenerateClassGradesWithHistory (COM MAIS DEBUG)
// ─────────────────────────────────────────────────────────────────────
const GenerateClassGrades = async (req, res) => {
  console.log("hello...");
  const t0 = Date.now();
  const tick = (label) => console.log(`[ClassGrades] ⏱ +${Date.now() - t0}ms → ${label}`);
 
  console.log("=======================================================");
  console.log("[ClassGrades] ✅ ENDPOINT CHAMADO (com histórico)");
  console.log("[ClassGrades] URL:    ", req.method, req.originalUrl);
  console.log("[ClassGrades] Body:   ", JSON.stringify(req.body));
  console.log("[ClassGrades] Session:", req.session?.user?.eduall_user_session_curentinstitute ?? "⚠️ SEM SESSÃO");
  console.log("=======================================================");
 
  try {
    const { classId, studentIds, includeHistorical = true } = req.body;
    tick("body parsed");
 
    if (!classId) {
      console.log("[ClassGrades] ❌ classId em falta");
      return res.status(400).json({ success: false, message: "classId obrigatório." });
    }
 
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      console.log("[ClassGrades] ❌ Sessão inválida — sem instituteCode");
      return res.status(401).json({ success: false, message: "Sessão inválida." });
    }
 
    // ── Instituição + Turma ──────────────────────────────────────────
    tick("a fazer queries de instituição + turma (Promise.all)...");
    const [instRes, classRes] = await Promise.all([
      ExecuteQuery(res, `SELECT * FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true),
      ExecuteQuery(res, CLASS_FULL_QUERY, [classId, instituteCode], true),
    ]);
    tick(`instituição (${instRes?.length ?? 0} rows) + turma (${classRes?.length ?? 0} rows) carregadas`);
 
    if (!instRes?.length) {
      console.log("[ClassGrades] ❌ Instituição não encontrada:", instituteCode);
      return res.status(404).json({ success: false, message: "Instituição não encontrada." });
    }
    if (!classRes?.length) {
      console.log("[ClassGrades] ❌ Turma não encontrada:", classId);
      return res.status(404).json({ success: false, message: "Turma não encontrada." });
    }
 
    const INST = instRes[0];
    const CLASS = classRes[0];
    const maxVal = Number(CLASS.max_value) || 20;
    const halfVal = maxVal / 2;
 
    const subjectIds = u.parseIds(CLASS.ed_class_subjects);
    const keyIds = u.parseIds(CLASS.ed_class_key_subjects);
    const behaviorMap = u.parseBehaviors(CLASS.ed_class_subject_behaviors);
    const classPeriodLabel = PERIOD_MAP[String(CLASS.ed_class_periodo)] ?? "";
 
    console.log(`[ClassGrades] 📚 Disciplinas: ${subjectIds.length} | Chave: ${keyIds.length}`);
    tick("a carregar disciplinas + professores...");
 
    // ── Disciplinas + Professores ────────────────────────────────────
    let subjectsDetail = [];
    if (subjectIds.length) {
      const ph = subjectIds.map(() => "?").join(",");
      const [subjRes, teacherRes] = await Promise.all([
        ExecuteQuery(res, `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id IN (${ph}) AND ed_subject_deleted = 0`, subjectIds, true),
        ExecuteQuery(res,
          `SELECT ts.ed_tch_subject_code AS subject_id, e.ed_employee_id AS teacher_id, e.ed_employee_name AS teacher_name
           FROM eduall_teacher_subjects ts
           LEFT JOIN eduall_employees e ON e.ed_employee_id = ts.ed_tch_subject_teacher_code AND e.ed_employee_deleted = 0
           WHERE ts.ed_tch_subject_class = ? AND ts.ed_tch_subject_code IN (${ph}) AND ts.ed_tch_subject_deleted = 0`,
          [classId, ...subjectIds], true),
      ]);
      tick(`disciplinas (${subjRes?.length}) + professores (${teacherRes?.length}) carregados`);
 
      const teacherBySubject = new Map();
      teacherRes.forEach(t => {
        if (!teacherBySubject.has(Number(t.subject_id))) {
          teacherBySubject.set(Number(t.subject_id), { teacher_id: t.teacher_id, teacher_name: t.teacher_name || null });
        }
      });
      const subjectMap = new Map(subjRes.map(s => [Number(s.ed_subject_id), s]));
      subjectsDetail = subjectIds.map(id => {
        const s = subjectMap.get(id) || {};
        const tch = teacherBySubject.get(id) || {};
        return {
          subject_id: id,
          subject_title: s.ed_subject_title || null,
          teacher_id: tch.teacher_id || null,
          teacher_name: tch.teacher_name || null,
          is_key: keyIds.includes(id),
          behavior: behaviorMap.get(id) ?? "negative_reprova",
        };
      });
    }
 
    // ── Alunos ATUAIS ────────────────────────────────────────────────
    let studentFilter = "", studentParams = [classId];
    if (Array.isArray(studentIds) && studentIds.length) {
      const validIds = studentIds.map(Number).filter(n => Number.isFinite(n));
      studentFilter = `AND ed_student_id IN (${validIds.map(() => "?").join(",")})`;
      studentParams.push(...validIds);
    }
 
    tick("a carregar alunos ATUAIS...");
    const studentRes = await ExecuteQuery(res,
      `SELECT ed_student_id, ed_student_name, ed_student_code, ed_student_number_of_admission, ed_student_gender, ed_student_birthday, ed_student_age, ed_student_identityCard, ed_student_picture, ed_student_naturalness, ed_student_address, ed_student_phone, ed_student_nacionality, ed_student_father_name, ed_student_mother_name
       FROM eduall_students WHERE ed_student_class = ? AND ed_student_deleted = 0 ${studentFilter} ORDER BY ed_student_name ASC`,
      studentParams, true);
    tick(`alunos ATUAIS carregados: ${studentRes?.length ?? 0}`);
    console.log(`[ClassGrades] 👥 Alunos ATUAIS encontrados: ${studentRes?.length ?? 0}`);
 
    // ── Alunos ANTIGOS (histórico) ───────────────────────────────────
    let oldStudentIds = [];
    let oldStudentsDetail = [];
    if (includeHistorical) {
      tick("a carregar IDs de alunos ANTIGOS...");
      oldStudentIds = await loadOldStudents(res, classId);
      tick(`IDs de alunos ANTIGOS: ${oldStudentIds.length}`);
 
      console.log(`\n`);
      console.log(`╔═══════════════════════════════════════════════════════╗`);
      console.log(`║  🚨 ALERTA: ALUNOS ANTIGOS ENCONTRADOS                 ║`);
      console.log(`║                                                       ║`);
      console.log(`║  Total: ${String(oldStudentIds.length).padEnd(46)} ║`);
      console.log(`╚═══════════════════════════════════════════════════════╝`);
      
      if (oldStudentIds.length === 0) {
        console.log(`\n[⚠️  AVISO] ❌ NENHUM aluno antigo encontrado!`);
        console.log(`\n    Possíveis motivos:`);
        console.log(`    1️⃣  Não há dados em 'eduall_student_old_classes'`);
        console.log(`    2️⃣  O 'ed_student_old_class_institute_code' não corresponde`);
        console.log(`    3️⃣  O 'ed_student_old_class' não corresponde`);
        console.log(`\n    🔧 DEBUG SQL: Execute manualmente:`);
        console.log(`       SELECT * FROM eduall_student_old_classes`);
        console.log(`       WHERE ed_student_old_class = ${classId}`);
        console.log(`       AND ed_student_old_class_institute_code = '${instituteCode}';`);
        console.log(`\n`);
      } else {
        console.log(`\n    ✅ Alunos antigos encontrados: ${oldStudentIds.join(", ")}`);
        console.log(`\n`);
      }
 
      if (oldStudentIds.length) {
        tick("a carregar dados dos alunos ANTIGOS...");
        const ph = oldStudentIds.map(() => "?").join(",");
        oldStudentsDetail = await ExecuteQuery(res,
          `SELECT ed_student_id, ed_student_name, ed_student_code, ed_student_number_of_admission, ed_student_gender, ed_student_birthday, ed_student_age, ed_student_identityCard, ed_student_picture, ed_student_naturalness, ed_student_address, ed_student_phone, ed_student_nacionality, ed_student_father_name, ed_student_mother_name
           FROM eduall_students WHERE ed_student_id IN (${ph}) AND ed_student_deleted = 0 ORDER BY ed_student_name ASC`,
          oldStudentIds, true);
        tick(`alunos ANTIGOS carregados: ${oldStudentsDetail?.length ?? 0}`);
        console.log(`[ClassGrades] 👤 Dados de alunos ANTIGOS carregados: ${oldStudentsDetail?.length ?? 0}/${oldStudentIds.length}`);
      }
    }
 
    // ── Combinar: ATUAIS + ANTIGOS (sem duplicatas) ──────────────────
    const currentIds = (studentRes || []).map(s => Number(s.ed_student_id));
    const oldOnlyIds = oldStudentIds.filter(id => !currentIds.includes(id));
 
    const allStudentRecords = [
      ...(studentRes || []).map(s => ({ ...s, enrollment_type: "current" })),
      ...(oldStudentsDetail || []).filter(s => oldOnlyIds.includes(Number(s.ed_student_id))).map(s => ({ ...s, enrollment_type: "historical" })),
    ];
 
    const allStudentIds = allStudentRecords.map(s => Number(s.ed_student_id));
 
    console.log(`[ClassGrades] 📊 RESUMO FINAL:`);
    console.log(`     ├─ Alunos ATUAIS: ${currentIds.length}`);
    console.log(`     ├─ Alunos ANTIGOS (histórico): ${oldOnlyIds.length}`);
    console.log(`     └─ TOTAL PROCESSADOS: ${allStudentIds.length}`);
 
    if (!allStudentIds.length) {
      console.log("[ClassGrades] ⚠️  Turma sem alunos (atual ou histórico) — a devolver resposta vazia");
      return res.status(200).json({
        success: true,
        max_value: maxVal,
        pass_value: halfVal,
        data: {
          school: buildSchool(INST),
          class: buildClass(CLASS, maxVal, subjectsDetail, classPeriodLabel),
          students: [],
          summary: { total_current: 0, total_historical: 0, total_all: 0 },
        },
      });
    }
 
    // ── Carregar notas (ATUAIS + ANTIGOS) ─────────────────────────────
    tick("a carregar notas trimestrais + exames + recursos + faltas (Promise.all)...");
    const [qMap, examMap, resourceMap, absencesMap] = await Promise.all([
      loadQuarterly(res, classId, allStudentIds),
      loadExams(res, classId, allStudentIds),
      loadFeatured(res, classId, allStudentIds),
      loadAbsences(res, classId, allStudentIds),
    ]);
    tick("notas + exames + recursos + faltas carregadas");
 
    // ── Calcular grades ──────────────────────────────────────────────
    tick("a calcular grades de cada aluno (ATUAIS + ANTIGOS)...");
    const students = allStudentRecords.map(ST => {
      const studentId = Number(ST.ed_student_id);
 
      const grades = subjectIds.map(subjectId => {
        const subjectInfo = subjectsDetail.find(s => s.subject_id === subjectId) || {};
        const isKey = keyIds.includes(subjectId);
        const behavior = behaviorMap.get(subjectId) ?? "negative_reprova";
 
        const terms = [1, 2, 3].map(q => {
          const d = qMap.get(`${studentId}_${subjectId}_${q}`) || { mac: null, npt: null };
          const mt = d.mac !== null && d.npt !== null ? r1((d.mac + d.npt) / 2) : null;
          return { quarter: q, mac: d.mac, npt: d.npt, mt };
        });
 
        const npts = terms.map(t => t.npt).filter(v => v !== null);
        const mfd = npts.length ? r1(npts.reduce((a, b) => a + b, 0) / npts.length) : null;
 
        const exam_score = examMap.get(`${studentId}_${subjectId}`) ?? null;
        const resource_score = resourceMap.get(`${studentId}_${subjectId}`) ?? null;
 
        let mf = mfd;
        if (exam_score !== null && mfd !== null) mf = r1((mfd + exam_score) / 2);
        else if (exam_score !== null) mf = exam_score;
        if (resource_score !== null && mf !== null && mf < halfVal) mf = r1(Math.max(mf, resource_score));
 
        let passed = null;
        if (mf !== null) passed = behavior === "approve_anyway" ? true : mf >= halfVal;
        const absences = absencesMap.get(`${studentId}_${subjectId}`) ?? 0;
 
        return {
          subject_id: subjectId,
          subject_title: subjectInfo.subject_title || null,
          is_key: isKey,
          behavior,
          terms,
          mfd,
          exam_score,
          resource_score,
          mf,
          passed,
          absences,
          status: passed === null ? null : passed ? "Transita" : "Não Transita",
        };
      });
 
      const graded = grades.filter(g => g.mf !== null);
      const totalFailed = grades.filter(g => g.passed === false);
      const failedKey = grades.filter(g => g.is_key && g.passed === false);
      const failedNormal = grades.filter(g => !g.is_key && g.passed === false);
      const totalAbs = grades.reduce((acc, g) => acc + g.absences, 0);
 
      let finalStatus;
      if (totalFailed.length > 0) finalStatus = "Não Transita";
      else if (graded.length < subjectIds.length) finalStatus = "Incompleto";
      else finalStatus = "Transita";
 
      return {
        student_id: studentId,
        enrollment_type: ST.enrollment_type, // ⭐ MARCA SE É ATUAL OU HISTÓRICO
        student_name: ST.ed_student_name || null,
        student_code: ST.ed_student_code || null,
        admission_number: ST.ed_student_number_of_admission || null,
        gender: ST.ed_student_gender || null,
        birthday: ST.ed_student_birthday || null,
        age: ST.ed_student_age || null,
        identity_card: ST.ed_student_identityCard || null,
        picture: ST.ed_student_picture || null,
        naturalness: ST.ed_student_naturalness || null,
        nationality: ST.ed_student_nacionality || null,
        address: ST.ed_student_address || null,
        phone: ST.ed_student_phone || null,
        father_name: ST.ed_student_father_name || null,
        mother_name: ST.ed_student_mother_name || null,
        grades,
        summary: {
          total_subjects: subjectIds.length,
          graded: graded.length,
          passed: graded.filter(g => g.passed).length,
          failed: totalFailed.length,
          failed_key_subjects: failedKey.map(g => g.subject_title),
          failed_normal_subjects: failedNormal.map(g => g.subject_title),
          total_absences: totalAbs,
          final_status: finalStatus,
        },
      };
    });
 
    tick(`grades calculadas para ${students.length} alunos`);
 
    tick("a enviar resposta...");
    console.log(`[ClassGrades] ✅ CONCLUÍDO em ${Date.now() - t0}ms`);
    console.log("=======================================================");
 
    return res.status(200).json({
      success: true,
      max_value: maxVal,
      pass_value: halfVal,
      data: {
        school: buildSchool(INST),
        class: buildClass(CLASS, maxVal, subjectsDetail, classPeriodLabel),
        students,
        summary: {
          total_current: currentIds.length,
          total_historical: oldOnlyIds.length,
          total_all: allStudentIds.length,
          include_historical: includeHistorical,
        },
      },
    });
  } catch (error) {
    console.error(`[ClassGrades] ❌ ERRO em ${Date.now() - t0}ms:`, error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor.", error: error.message });
  }
};
 

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  GenerateIndividualBulletin,
  GenerateMiniPautaBySubject,
  GenerateClassGrades,
  parseBehaviors:       u.parseBehaviors,
  serializeBehaviors:   u.serializeBehaviors,
  GenerateMiniPautaByClass,
  GenerateFinalPauta,
  GenerateFinalPautaExam,
  GenerateTeacherMiniPauta,
  GenerateAnnualBulletin,
  GenerateFrequencyTerm,
  GeneratePerformanceMap,
  GenerateCertificate,
  GenerateQualificationsStatement,
};