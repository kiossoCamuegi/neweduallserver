// controllers/excelImportControllers.js
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/** -----------------------
 * Helpers
 * ----------------------*/
const getInstitute = (req) => req.session?.user?.eduall_user_session_curentinstitute;
const getInstituteType = (req) => req.session?.user?.eduall_user_session_curentinstitute_type;

const normalize = (str = "") =>
  String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[ºª]/g, "")
    .replace(/[^a-z0-9]/g, "");

const isEmpty = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

const toISODate = (v) => {
  if (!v && v !== 0) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const fail = (index, message) => ({ index, errors: [{ message }] });

/** -----------------------
 * CLASSROOMS (salas)
 * Frontend fields: class_room_db, capacity, teacher_in_charge
 * Tabela: eduall_classrooms(ed_classroom_title, ed_classroom_code, ed_classroom_description, ed_classroom_institute_code, ed_classroom_deleted)
 * ----------------------*/
async function ClassroomsCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const titles = list.map((row) => ({ title: row.title || "", index: row.index ?? -1 }));
    const normalized = titles.map((t) => normalize(t.title)).filter((t) => !!t);

    let existing = [];
    if (normalized.length) {
      const placeholders = normalized.map(() => "?").join(",");
      const q = `
        SELECT ed_classroom_title FROM eduall_classrooms
        WHERE ed_classroom_deleted = 0 AND ed_classroom_institute_code = ?
      `;
      const rows = await ExecuteQuery(res, q, [ins], true, { db: "eduall_classrooms", type: "select", data: req });
      existing = rows.map((r) => normalize(r.ed_classroom_title));
    }

    console.log(list);
    
    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      if (isEmpty(row.title)) {
        duplicates.push(fail(idx, "Sala é obrigatória"));
        return;
      }
      const key = normalize(row.title);
      if (existing.includes(key)) {
        duplicates.push(fail(idx, `Sala já existe: ${row.title}`));
      } else {
        valid.push({ ...row });
      }
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de salas", error: e.message });
  }
}

async function ClassroomsInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.title)) {
          failed.push(fail(i, "Sala é obrigatória"));
          continue;
        }
        const code = `CLS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const descExtras = [];
        if (!isEmpty(row.capacity)) descExtras.push(`Capacidade: ${row.capacity}`);
        if (!isEmpty(row.teacher_in_charge)) descExtras.push(`Responsável: ${row.teacher_in_charge}`);
        const description = descExtras.length ? descExtras.join(" | ") : null;

        const q = `
          INSERT INTO eduall_classrooms(ed_classroom_title, ed_classroom_code, ed_classroom_description, ed_classroom_institute_code)
          VALUES(?,?,?,?)
        `;
        await ExecuteQuery(res, q, [row.title, code, description, ins], false, {
          db: "eduall_classrooms",
          type: "insert",
          data: req
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Salas da instituição (importação)",
          description: `Importou sala "${row.title}" (code ${code})`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir sala"));
      }
    }
    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de salas", error: e.message });
  }
}

/** -----------------------
 * STUDENTS (estudantes) — import “mínimo”
 * Frontend fields: student_name, dob, course
 * Tabelas: eduall_students, eduall_students_details (opcional)
 * ----------------------*/


// === utilidades ===
 

 
function parseDateFlexible(input) {
  if (!input) return null;
  let str = String(input).trim();

  // uniformizar separadores
  str = str.replace(/[\/.]/g, "-");

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? null : str;
  }

  // dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split("-");
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    return isNaN(d) ? null : `${yyyy}-${mm}-${dd}`;
  }

  // tentar parse nativo
  const d = new Date(str);
  if (!isNaN(d)) {
    return d.toISOString().split("T")[0];
  }

  return null;
}

// === CHECK ===
async function StudentsCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const existingRows = await ExecuteQuery(
      res,
      `SELECT ed_student_name, ed_student_birthday, ed_student_identityCard, ed_student_code
       FROM eduall_students
       WHERE ed_student_deleted = 0 AND ed_student_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    const existingByNameDob = new Set(
      existingRows
        .filter(r => r.ed_student_name && r.ed_student_birthday)
        .map(r => `${normalize(r.ed_student_name)}|${parseDateFlexible(r.ed_student_birthday)}`)
    );

    const existingByBI = new Set(
      existingRows
        .filter(r => r.ed_student_identityCard)
        .map(r => normalize(r.ed_student_identityCard))
    );

    const existingByMatricula = new Set(
      existingRows
        .filter(r => r.ed_student_code)
        .map(r => normalize(r.ed_student_code))
    );

    const today = new Date();
    const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());

    const duplicates = [];
    const valid = [];

    list.forEach((row, idx) => {
      const errs = [];

      if (isEmpty(row.student_name)) errs.push("student_name é obrigatório");

      const dobISO = parseDateFlexible(row.student_birthday) || "2000-01-01";
      if (!dobISO) {
        errs.push("Data de aniversario inválida");
      } else if (new Date(dobISO) > today || new Date(dobISO) > twoYearsAgo) {
        errs.push("Estudante deve ter >= 2 anos");
      }

      const biNorm = row.student_identityCard ? normalize(row.student_identityCard) : null;
      const matriculaNorm = row.student_code ? normalize(row.student_code) : null;

      if (!errs.length) {
        if (biNorm && existingByBI.has(biNorm)) {
          errs.push("Já existe estudante com este BI");
        }
        if (matriculaNorm && existingByMatricula.has(matriculaNorm)) {
          errs.push("Já existe estudante com este Nº de matrícula");
        }
        if (!biNorm && !matriculaNorm) {
          const key = `${normalize(row.student_name)}|${dobISO}`;
          if (existingByNameDob.has(key)) {
            errs.push("Já existe estudante com mesmo Nome + Data Nasc.");
          }
        }
      }

      if (errs.length) {
        duplicates.push({ index: idx, errors: errs.map(m => ({ message: m })) });
      } else {
        valid.push({ ...row, dob: dobISO });
      }
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "Falha no check de estudantes",
      error: e.message
    });
  }
}

 




async function StudentsInsert(req, res) {
  const pad = (n, w = 6) => String(n).padStart(w, "0");

  const formatName = (name) => {
    if (!name) return "";
    return name.trim()
      .split(/\s+/)
      .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  };

  const normalizeGender = (input) => {
    if (!input) return "male";
    const val = String(input).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s]/g, "");
    const maleSet = new Set(["male","masculino","homem","m"]);
    const femaleSet = new Set(["female","feminino","mulher","f","femenino"]);
    if (maleSet.has(val)) return "male";
    if (femaleSet.has(val)) return "female";
    return "male";
  };

  const normalizeBI = (bi) => bi ? String(bi).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s]/g,"") : "";

  const defaultVal = (val, type) => type === "number" ? (Number.isFinite(+val) ? +val : 0) : (val ? String(val) : "");

  const parseDateFlexible = (date) => {
    if (!date) return "2000-01-01";
    let d = date.replace(/[-.]/g,"/").split("/");
    if (d.length === 3) {
      let [day, month, year] = d.map(Number);
      if (year < 100) year += 2000;
      const dt = new Date(year, month-1, day);
      if (!isNaN(dt)) return dt.toISOString().split("T")[0];
    }
    const dt = new Date(date);
    return isNaN(dt) ? "2000-01-01" : dt.toISOString().split("T")[0];
  };

  try {
    const list = Array.isArray(req.body) ? req.body : [];
    if (!list.length) return res.json({ inserted: 0, failed: [] });

    const ins = getInstitute(req);
    const instType = getInstituteType(req)*1 || 0;

    // === obter último código de matrícula ===
    const lastRow = await ExecuteQuery(res,
      `SELECT ed_lastest_student_code FROM eduall_institute_counters WHERE ed_institute_code=?`,
      [ins], true,
      { db: "eduall_institute_counters", type: "select", data: req }
    );
    let lastCode = (lastRow[0]?.ed_lastest_student_code ?? 0) * 1;

    const insertedRows = [];
    const failed = [];

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.student_name)) throw new Error("Nome é obrigatório");

        const dobISO = parseDateFlexible(row.student_birthday);
        const gender = normalizeGender(row.student_gender);
        const biNorm = normalizeBI(row.student_identityCard);

        // Determinar código de matrícula
        let codeNum = 0;
        if (row.student_code && String(row.student_code).trim() !== "") {
          codeNum = parseInt(String(row.student_code).replace(/\D/g,""),10);
          if (!Number.isFinite(codeNum) || codeNum < 0) throw new Error("Código de matrícula inválido.");
        } else {
          codeNum = ++lastCode;
        }
        const finalCode = pad(codeNum,6);
        lastCode = Math.max(lastCode, codeNum);

        insertedRows.push({
          student_name: formatName(defaultVal(row.student_name,"string")),
          student_address: defaultVal(row.student_address,"string"),
          student_nacionality: defaultVal(row.student_nacionality,"string"),
          gender,
          student_religion: defaultVal(row.student_religion,"string"),
          dobISO,
          student_phone: defaultVal(row.student_phone,"string"),
          student_email: defaultVal(row.student_email,"string"),
          student_class: defaultVal(row.student_class,"number"),
          finalCode,
          biNorm,
          student_health_problems: defaultVal(row.student_health_problems,"number"),
          student_health_problems_description: defaultVal(row.student_health_problems_description,"string"),
          student_status: defaultVal(row.student_status,"number"),
          student_naturalness: defaultVal(row.student_naturalness,"string"),
          student_details: {
            lastschool_course: defaultVal(row.student_lastschool_course,"string"),
            lastschool_score: defaultVal(row.student_lastschool_score,"number"),
            lastschool_formationfield: defaultVal(row.student_lastschool_formationfield,"string"),
            lastschool_conclusionyear: defaultVal(row.student_lastschool_conclusionyear,"number"),
            lifeconditions: defaultVal(row.student_lifeconditions,"string"),
            socialsecurity: defaultVal(row.student_socialsecurity,"string"),
            sociallevel: defaultVal(row.student_sociallevel,"string")
          }
        });

      } catch(err) {
        failed.push(fail(i, err.message));
      }
    }

    if (!insertedRows.length) return res.json({ inserted: 0, failed });

    // === Inserir todos os estudantes ===
    for (const student of insertedRows) {
      const studentParams = [
        student.student_name, student.student_address, student.student_nacionality, student.gender,
        student.student_religion, student.dobISO, student.student_phone, student.student_email,
        student.student_class, student.finalCode, "", student.biNorm,
        student.student_health_problems, student.student_health_problems_description,
        student.student_status, student.student_naturalness, ins, instType
      ];
      const insertStudent = await ExecuteQuery(res,
        `INSERT INTO eduall_students(
          ed_student_name, ed_student_address, ed_student_nacionality, ed_student_gender,
          ed_student_religion, ed_student_birthday, ed_student_phone, ed_student_email,
          ed_student_class, ed_student_code, ed_student_picture, ed_student_identityCard,
          ed_student_health_problems, ed_student_health_problems_description, ed_student_status,
          ed_student_naturalness, ed_student_institute_code, ed_student_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        studentParams, false,
        { db: "eduall_students", type: "insert", data: req }
      );

      // Inserir detalhes do estudante
      const det = student.student_details;
      await ExecuteQuery(res,
        `INSERT INTO eduall_students_details(
          ed_detail_student_code, ed_detail_lastschool_course, ed_detail_lastschool_score,
          ed_detail_lastschool_formationfield, ed_detail_lastschool_conclusionyear,
          ed_detail_lifeconditions, ed_detail_socialsecurity, ed_detail_sociallevel
        ) VALUES(?,?,?,?,?,?,?,?)`,
        [insertStudent.insertId, det.lastschool_course, det.lastschool_score, det.lastschool_formationfield,
         det.lastschool_conclusionyear, det.lifeconditions, det.socialsecurity, det.sociallevel],
        false,
        { db: "eduall_students_details", type: "insert", data: req }
      );

      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Estudantes (importação)",
        description: `Importou estudante (${student.student_name}) com code ${student.finalCode}`
      });
    }

    // Atualizar último código
    await ExecuteQuery(res,
      `UPDATE eduall_institute_counters SET ed_lastest_student_code=? WHERE ed_institute_code=?`,
      [lastCode, ins],
      false,
      { db: "eduall_institute_counters", type: "update", data: req }
    );

    res.json({ inserted: insertedRows.length, failed });

  } catch(e) {
    res.status(500).json({ success:false, message:"Falha na inserção de estudantes", error:e.message });
  }
}





/** -----------------------
 * ACADEMIC LEVEL (níveis académicos)
 * Front: (quando usares) -> { academic_level_title, academic_level_forExam, academic_level_forFt }
 * ----------------------*/
async function AcademicLevelCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_academic_level_title FROM eduall_academic_level
       WHERE ed_academic_level_deleted = 0 AND ed_academic_level_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_academic_level", type: "select", data: req }
    );
    const existing = new Set(rows.map(r => normalize(r.ed_academic_level_title)));

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      if (isEmpty(row.academic_level_title)) {
        duplicates.push(fail(idx, "academic_level_title é obrigatório"));
        return;
      }
      const key = normalize(row.academic_level_title);
      if (existing.has(key)) duplicates.push(fail(idx, `Nível académico duplicado: ${row.academic_level_title}`));
      else valid.push(row);
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de níveis académicos", error: e.message });
  }
}

async function AcademicLevelInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.academic_level_title)) {
          failed.push(fail(i, "academic_level_title é obrigatório"));
          continue;
        }
        const q = `
          INSERT INTO eduall_academic_level(
            ed_academic_level_title, ed_academic_level_forExam, ed_academic_level_forFt, ed_academic_level_institute_code
          ) VALUES(?,?,?,?)
        `;
        const params = [
          row.academic_level_title,
          row.academic_level_forExam ? 1 : 0,
          row.academic_level_forFt ? 1 : 0,
          ins
        ];
        await ExecuteQuery(res, q, params, false, { db: "eduall_academic_level", type: "register", data: req });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Níveis académico (importação)",
          description: `Importou nível "${row.academic_level_title}"`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir nível académico"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de níveis académicos", error: e.message });
  }
}

/** -----------------------
 * ACADEMIC YEAR (anos académicos)
 * Front: { title, year_date_start, year_date_finish }
 * ----------------------*/
async function AcademicYearCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_academic_year_title, ed_academic_year_startDate, ed_academic_year_endDate
       FROM eduall_academic_year
       WHERE ed_academic_year_deleted = 0 AND ed_academic_year_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_academic_year", type: "select", data: req }
    );

    const byTitle = new Set(rows.map(r => normalize(r.ed_academic_year_title)));
    const byDates = new Set(rows.map(r => `${toISODate(r.ed_academic_year_startDate)}|${toISODate(r.ed_academic_year_endDate)}`));

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      const errs = [];
      if (isEmpty(row.title)) errs.push("title é obrigatório");
      const startISO = toISODate(row.year_date_start);
      const endISO = toISODate(row.year_date_finish);
      if (!startISO || !endISO) errs.push("datas inválidas");
      if (!errs.length) {
        if (byTitle.has(normalize(row.title))) errs.push(`Ano académico duplicado: ${row.title}`);
        if (byDates.has(`${startISO}|${endISO}`)) errs.push("Datas já usadas noutro ano académico");
      }
      if (errs.length) duplicates.push({ index: idx, errors: errs.map(m => ({ message: m })) });
      else valid.push({ ...row, year_date_start: startISO, year_date_finish: endISO });
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de anos académicos", error: e.message });
  }
}

async function AcademicYearInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        const startISO = toISODate(row.year_date_start);
        const endISO = toISODate(row.year_date_finish);
        if (isEmpty(row.title) || !startISO || !endISO) {
          failed.push(fail(i, "title/year_date_start/year_date_finish inválidos"));
          continue;
        }
        const q = `
          INSERT INTO eduall_academic_year(
            ed_academic_year_title, ed_academic_year_startDate, ed_academic_year_endDate, ed_academic_year_institute_code
          ) VALUES(?,?,?,?)
        `;
        await ExecuteQuery(res, q, [row.title, startISO, endISO, ins], false, {
          db: "eduall_academic_year", type: "register", data: req
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Ano Académico (importação)",
          description: `Importou ano académico "${row.title}"`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir ano académico"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de anos académicos", error: e.message });
  }
}

/** -----------------------
 * ACCOUNTS PAYABLE & RECEIVABLE (contas)
 * Front: { ac_pay_rec_competence_date, ac_pay_rec_description, ac_pay_rec_client_or_supplier, ac_pay_rec_payment_method,
 *          ac_pay_rec_amount_payable, ac_pay_rec_amount_receivable }
 * ----------------------*/
async function AccountsCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_account_payable_and_receivable_competence_date AS d, ed_accounts_payable_and_receivable_description AS descp,
              ed_accounts_payable_and_receivable_client_or_supplier AS cos,
              ed_accounts_payable_and_receivable_amount_payable AS pay,
              ed_accounts_payable_and_receivable_amount_receivable AS rec
       FROM eduall_accounts_payable_and_receivable
       WHERE ed_accounts_payable_and_receivable_deleted = 0 AND ed_accounts_payable_and_receivable_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_accounts_payable_and_receivable", type: "select", data: req }
    );

    const existing = new Set(
      rows.map(r =>
        `${toISODate(r.d)}|${normalize(r.descp)}|${normalize(r.cos || "")}|${r.pay || 0}|${r.rec || 0}`
      )
    );

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      const dateISO = toISODate(row.ac_pay_rec_competence_date);
      if (!dateISO) {
        duplicates.push(fail(idx, "ac_pay_rec_competence_date inválida"));
        return;
      }
      if (isEmpty(row.ac_pay_rec_description)) {
        duplicates.push(fail(idx, "ac_pay_rec_description é obrigatória"));
        return;
      }
      const key = `${dateISO}|${normalize(row.ac_pay_rec_description)}|${normalize(row.ac_pay_rec_client_or_supplier || "")}|${row.ac_pay_rec_amount_payable || 0}|${row.ac_pay_rec_amount_receivable || 0}`;
      if (existing.has(key)) duplicates.push(fail(idx, "Conta já registada (mesma data/descrição/valores)"));
      else valid.push({ ...row, ac_pay_rec_competence_date: dateISO });
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de contas", error: e.message });
  }
}

async function AccountsInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        const dateISO = toISODate(row.ac_pay_rec_competence_date);
        if (!dateISO || isEmpty(row.ac_pay_rec_description)) {
          failed.push(fail(i, "Dados obrigatórios em falta"));
          continue;
        }
        const q = `
          INSERT INTO eduall_accounts_payable_and_receivable(
            ed_account_payable_and_receivable_competence_date, ed_accounts_payable_and_receivable_description,
            ed_accounts_payable_and_receivable_client_or_supplier, ed_accounts_payable_and_receivable_payment_method,
            ed_accounts_payable_and_receivable_amount_payable, ed_accounts_payable_and_receivable_amount_receivable,
            ed_accounts_payable_and_receivable_institute_code
          ) VALUES(?,?,?,?,?,?,?)
        `;
        const params = [
          dateISO, row.ac_pay_rec_description, row.ac_pay_rec_client_or_supplier || null,
          row.ac_pay_rec_payment_method || null,
          row.ac_pay_rec_amount_payable || 0, row.ac_pay_rec_amount_receivable || 0,
          ins
        ];
        await ExecuteQuery(res, q, params, false, {
          db: "eduall_accounts_payable_and_receivable", type: "insert", data: req
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Contas a pagar/receber (importação)",
          description: `Importou conta: ${row.ac_pay_rec_description}`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir conta"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de contas", error: e.message });
  }
}

/** -----------------------
 * CICLES (ciclos)
 * Front: { cicle_title, cicle_code }
 * ----------------------*/
async function CiclesCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_cicle_title FROM eduall_cicles WHERE ed_cicle_deleted = 0 AND ed_cicle_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_cicles", type: "select", data: req }
    );
    const existing = new Set(rows.map(r => normalize(r.ed_cicle_title)));

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      if (isEmpty(row.cicle_title)) {
        duplicates.push(fail(idx, "cicle_title é obrigatório"));
        return;
      }
      if (existing.has(normalize(row.cicle_title))) {
        duplicates.push(fail(idx, `Ciclo duplicado: ${row.cicle_title}`));
      } else {
        valid.push(row);
      }
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de ciclos", error: e.message });
  }
}

async function CiclesInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.cicle_title)) {
          failed.push(fail(i, "cicle_title é obrigatório"));
          continue;
        }
        const q = `
          INSERT INTO eduall_cicles (ed_cicle_title, ed_cicle_code, ed_cicle_institute_code)
          VALUES (?,?,?)
        `;
        await ExecuteQuery(res, q, [row.cicle_title, row.cicle_code || null, ins], false, {
          db: "eduall_cicles", type: "insert", data: req
        });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Ciclos (importação)",
          description: `Importou ciclo "${row.cicle_title}"`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir ciclo"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de ciclos", error: e.message });
  }
}

/** -----------------------
 * CLASSES (turmas)
 * Front: { class_title, class_faculty, class_code, class_course, class_period, class_year, class_room,
 *          class_cicle, class_academic_level, class_description, class_subjects }
 * ----------------------*/
async function ClassesCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_class_title FROM eduall_class WHERE ed_class_deleted = 0 AND ed_class_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_class", type: "select", data: req }
    );
    const existing = new Set(rows.map(r => normalize(r.ed_class_title)));

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      if (isEmpty(row.class_title)) {
        duplicates.push(fail(idx, "class_title é obrigatório"));
        return;
      }
      if (existing.has(normalize(row.class_title))) {
        duplicates.push(fail(idx, `Turma duplicada: ${row.class_title}`));
      } else {
        valid.push(row);
      }
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de turmas", error: e.message });
  }
}

async function ClassesInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.class_title)) {
          failed.push(fail(i, "class_title é obrigatório"));
          continue;
        }

        const q = `
          INSERT INTO eduall_class(
            ed_class_title, ed_class_faculty, ed_class_code, ed_class_course, ed_class_period, ed_class_year,
            ed_class_room, ed_class_cicle, ed_class_academic_level, ed_class_description, ed_class_subjects, ed_class_institute_code
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        `;
        const params = [
          row.class_title, row.class_faculty || null, row.class_code || null, row.class_course || null, row.class_period || null, row.class_year || null,
          row.class_room || null, row.class_cicle || null, row.class_academic_level || null,
          row.class_description || null, row.class_subjects || null, ins
        ];
        await ExecuteQuery(res, q, params, false, { db: "eduall_class", type: "insert", data: req });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Turmas (importação)",
          description: `Importou turma "${row.class_title}"`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir turma"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de turmas", error: e.message });
  }
}

/** -----------------------
 * EMPLOYEES (funcionários)
 * Front (mínimo sazonal): { employee_name, employee_email, employee_code, employee_birthday, employee_identityCard, employee_charge }
 * ----------------------*/
async function EmployeesCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_employee_email, ed_employee_identityCard, ed_employee_code
       FROM eduall_employees
       WHERE ed_employee_deleted = 0 AND ed_employee_institute_code = ?`,
      [ins],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );
    const byEmail = new Set(rows.filter(r => r.ed_employee_email).map(r => normalize(r.ed_employee_email)));
    const byBI = new Set(rows.filter(r => r.ed_employee_identityCard).map(r => normalize(r.ed_employee_identityCard)));
    const byCode = new Set(rows.filter(r => r.ed_employee_code).map(r => normalize(r.ed_employee_code)));

    const duplicates = [];
    const valid = [];
    list.forEach((row, idx) => {
      const errs = [];
      if (isEmpty(row.employee_name)) errs.push("employee_name é obrigatório");
      if (!isEmpty(row.employee_email) && byEmail.has(normalize(row.employee_email))) errs.push("email já existe");
      if (!isEmpty(row.employee_identityCard) && byBI.has(normalize(row.employee_identityCard))) errs.push("BI já existe");
      if (!isEmpty(row.employee_code) && byCode.has(normalize(row.employee_code))) errs.push("Código já existe");

      if (errs.length) duplicates.push({ index: idx, errors: errs.map(m => ({ message: m })) });
      else valid.push(row);
    });

    res.json({ valid, duplicates });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha no check de funcionários", error: e.message });
  }
}

async function EmployeesInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const failed = [];
    let inserted = 0;

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        if (isEmpty(row.employee_name)) {
          failed.push(fail(i, "employee_name é obrigatório"));
          continue;
        }
        const q = `
          INSERT INTO eduall_employees(
            ed_employee_name, ed_employee_address, ed_employee_nacionality, ed_employee_naturalness,
            ed_employee_gender, ed_employee_religion, ed_employee_birthday, ed_employee_phone,
            ed_employee_phone2, ed_employee_nif, ed_employee_email, ed_employee_civil_state, ed_employee_code,
            ed_employee_picture, ed_employee_identityCard, ed_employee_charge, ed_employee_subjects,
            ed_employee_status, ed_employee_institute_code
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `;
        const params = [
          row.employee_name, row.employee_address || null, row.employee_nacionality || null, row.employee_naturalness || null,
          row.employee_gender || null, row.employee_religion || null, toISODate(row.employee_birthday), row.employee_phone || null,
          row.employee_landline || null, row.employee_nif || null, row.employee_email || null, row.employee_civil_state || null, row.employee_code || null,
          "", row.employee_identityCard || null, row.employee_charge || null, row.employee_subjects || null,
          row.employee_status ?? 1, ins
        ];
        await ExecuteQuery(res, q, params, false, { db: "eduall_employees", type: "insert", data: req });

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Funcionários (importação)",
          description: `Importou funcionário "${row.employee_name}"`,
          res, req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir funcionário"));
      }
    }

    res.json({ inserted, failed });
  } catch (e) {
    res.status(500).json({ success: false, message: "Falha na inserção de funcionários", error: e.message });
  }
}


 

// tenta carregar helpers pedagógicos, se não existirem permite por defeito
let pedagogy = {};
try { pedagogy = require("./Pedagogy"); } catch (_) {}
const safeCheckQuarterPerm = async (req, res, quarter) => {
  try {
    if (typeof pedagogy?.CheckQuarterlyNotePermission === "function") {
      return await pedagogy.CheckQuarterlyNotePermission(req, res, quarter);
    }
  } catch (_) {}
  return { allowed: true };
};
const safeCheckExamPerm = async (req, res) => {
  try {
    if (typeof pedagogy?.CheckExamPermission === "function") {
      return await pedagogy.CheckExamPermission(req, res);
    }
  } catch (_) {}
  return { allowed: true };
};

/* =========================================================
 * 1) AUTORES (biblioteca)
 *    Campos: { author_name, author_status }
 *    Tabela: eduall_library_authors
 * =======================================================*/
async function AuthorsCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_library_author_name FROM eduall_library_authors
       WHERE ed_library_author_deleted = 0 AND ed_library_author_institute_code = ?`,
      [ins], true, { db: "eduall_library_authors", type: "select", data: req });
    const existing = new Set(rows.map(r => normalize(r.ed_library_author_name)));
    const duplicates = [], valid = [];
    list.forEach((row, idx) => {
      if (isEmpty(row.author_name)) { duplicates.push(fail(idx, "author_name é obrigatório")); return; }
      if (existing.has(normalize(row.author_name))) duplicates.push(fail(idx, `Autor duplicado: ${row.author_name}`));
      else valid.push(row);
    });
    res.json({ valid, duplicates });
  } catch (e) { res.status(500).json({ success:false, message:"Falha no check de autores", error: e.message }); }
}
async function AuthorsInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : []; const ins = getInstitute(req);
    const failed = []; let inserted = 0;
    for (let i=0;i<list.length;i++){
      const row = list[i];
      try {
        if (isEmpty(row.author_name)) { failed.push(fail(i,"author_name é obrigatório")); continue; }
        const q = `INSERT INTO eduall_library_authors(ed_library_author_name, ed_library_author_status, ed_library_author_institute_code) VALUES(?,?,?)`;
        await ExecuteQuery(res, q, [row.author_name, row.author_status ?? 1, ins], false, { db:"eduall_library_authors", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Autor (importação)", description:`Importou autor "${row.author_name}"`, res, req });
        inserted++;
      } catch(err){ failed.push(fail(i, err.message || "Falha ao inserir autor")); }
    }
    res.json({ inserted, failed });
  } catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de autores", error:e.message }); }
}

/* =========================================================
 * 2) LIVROS
 *    Campos principais: ver RegisterBook (título, autor, ano, etc)
 *    Dedupe: título + autor + ano + copy
 * =======================================================*/
async function BooksCheck(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_library_book_title, ed_library_book_author, ed_library_book_year, ed_library_book_copy
       FROM eduall_library_books
       WHERE ed_library_book_deleted = 0 AND ed_library_book_institute_code = ?`,
      [ins], true, { db:"eduall_library_books", type:"select", data:req });
    const existing = new Set(rows.map(r => `${normalize(r.ed_library_book_title)}|${normalize(r.ed_library_book_author||"")}|${r.ed_library_book_year||""}|${normalize(r.ed_library_book_copy||"")}`));
    const duplicates=[], valid=[];
    list.forEach((row, idx)=>{
      if (isEmpty(row.book_title)) { duplicates.push(fail(idx,"book_title é obrigatório")); return; }
      const key = `${normalize(row.book_title)}|${normalize(row.book_author||"")}|${row.book_year||""}|${normalize(row.book_copy||"")}`;
      if (existing.has(key)) duplicates.push(fail(idx,"Livro duplicado (título/autor/ano/exemplar)"));
      else valid.push(row);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de livros", error:e.message }); }
}
async function BooksInsert(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req); const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const b = list[i];
      try{
        if (isEmpty(b.book_title)) { failed.push(fail(i,"book_title é obrigatório")); continue; }
        const q = `INSERT INTO eduall_library_books(
          ed_library_book_title, ed_library_book_type, ed_library_book_publisher, ed_library_book_colection, 
          ed_library_book_place_of_publication, ed_library_book_classification, ed_library_book_copy, 
          ed_library_book_subtitle, ed_library_book_author, ed_library_book_subject,
          ed_library_book_price, ed_library_book_year, ed_library_book_acquisition_date, ed_library_book_acquisition_type, 
          ed_library_book_provider, ed_library_book_pages, ed_library_book_rack, ed_library_book_notes, 
          ed_library_book_picture, ed_library_book_institute_code
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        const params = [
          b.book_title, b.book_type||null, b.book_publisher||null, b.book_colection||null,
          b.book_place_of_publication||null, b.book_classification||null, b.book_copy||null,
          b.book_subtitle||null, b.book_author||null, b.book_subject||null,
          b.book_price ?? null, b.book_year ?? null, toISODate(b.book_acquisition_date), b.book_acquisition_type||null,
          b.book_provider||null, b.book_pages ?? null, b.book_rack||null, b.book_description||null,
          "", ins
        ];
        await ExecuteQuery(res, q, params, false, { db:"eduall_library_books", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Livro (importação)", description:`Importou livro "${b.book_title}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir livro")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de livros", error:e.message }); }
}

/* =========================================================
 * 3) CATEGORIAS DE LIVROS
 * =======================================================*/
async function BookCategoriesCheck(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_library_category_title, ed_library_category_code
       FROM eduall_library_categories
       WHERE ed_library_category_deleted = 0 AND ed_library_category_institute_code = ?`,
      [ins], true, { db:"eduall_library_categories", type:"select", data:req });
    const byTitle = new Set(rows.map(r=>normalize(r.ed_library_category_title)));
    const byCode  = new Set(rows.filter(r=>r.ed_library_category_code).map(r=>normalize(r.ed_library_category_code)));
    const duplicates=[], valid=[];
    list.forEach((row, idx)=>{
      if (isEmpty(row.category_title)) { duplicates.push(fail(idx,"category_title é obrigatório")); return; }
      if (byTitle.has(normalize(row.category_title))) duplicates.push(fail(idx,"Categoria duplicada (title)"));
      else if (row.category_code && byCode.has(normalize(row.category_code))) duplicates.push(fail(idx,"Categoria duplicada (code)"));
      else valid.push(row);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de categorias de livros", error:e.message }); }
}
async function BookCategoriesInsert(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req); const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const row = list[i];
      try{
        if (isEmpty(row.category_title)) { failed.push(fail(i,"category_title é obrigatório")); continue; }
        const q = `INSERT INTO eduall_library_categories(ed_library_category_title, ed_library_category_code, ed_library_category_institute_code) VALUES (?,?,?)`;
        await ExecuteQuery(res, q, [row.category_title, row.category_code||null, ins], false, { db:"eduall_library_categories", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Categoria de Livro (importação)", description:`Importou categoria "${row.category_title}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir categoria")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de categorias", error:e.message }); }
}

/* =========================================================
 * 4) CONTACTOS
 * =======================================================*/
async function ContactsCheck(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_contact_email, ed_contact_phone FROM eduall_contacts
       WHERE ed_contact_deleted = 0 AND ed_contact_instituteCode = ?`,
      [ins], true, { db:"eduall_contacts", type:"select", data:req });
    const byEmail = new Set(rows.filter(r=>r.ed_contact_email).map(r=>normalize(r.ed_contact_email)));
    const byPhone = new Set(rows.filter(r=>r.ed_contact_phone).map(r=>normalize(r.ed_contact_phone)));
    const duplicates=[], valid=[];
    list.forEach((row, idx)=>{
      if (isEmpty(row.contact_name)) { duplicates.push(fail(idx,"contact_name é obrigatório")); return; }
      if (row.contact_email && byEmail.has(normalize(row.contact_email))) duplicates.push(fail(idx,"Email já existe"));
      else if (row.contact_phone && byPhone.has(normalize(row.contact_phone))) duplicates.push(fail(idx,"Telefone já existe"));
      else valid.push(row);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de contactos", error:e.message }); }
}
async function ContactsInsert(req, res){
  try{
    const list = Array.isArray(req.body) ? req.body : []; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const c=list[i];
      try{
        if (isEmpty(c.contact_name)) { failed.push(fail(i,"contact_name é obrigatório")); continue; }
        const q = `INSERT INTO eduall_contacts(ed_contact_name, ed_contact_email, ed_contact_phone, ed_contact_address, ed_contact_avatar, ed_contact_type, ed_contact_picture, ed_contact_instituteCode)
                   VALUES(?,?,?,?,?,?,?,?)`;
        const params = [c.contact_name, c.contact_email||null, c.contact_phone||null, c.contact_address||null, c.contact_avatar||null, c.contact_type||null, "", ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_contacts", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Contactos (importação)", description:`Importou contacto "${c.contact_name}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir contacto")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de contactos", error:e.message }); }
}

/* =========================================================
 * 5) CURSOS
 * =======================================================*/
async function CoursesCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_course_title FROM eduall_courses WHERE ed_course_deleted = 0 AND ed_course_institute_code = ?`,
      [ins], true, { db:"eduall_courses", type:"select", data:req });
    const existing=new Set(rows.map(r=>normalize(r.ed_course_title)));
    const duplicates=[], valid=[];
    list.forEach((row,idx)=>{
      if (isEmpty(row.course_title)) { duplicates.push(fail(idx,"course_title é obrigatório")); return; }
      if (existing.has(normalize(row.course_title))) duplicates.push(fail(idx,"Curso duplicado"));
      else valid.push(row);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de cursos", error:e.message }); }
}
async function CoursesInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const r=list[i];
      try{
        if (isEmpty(r.course_title)) { failed.push(fail(i,"course_title é obrigatório")); continue; }
        const q=`INSERT INTO eduall_courses (ed_course_title, ed_course_category, ed_course_institute_code) VALUES (?,?,?)`;
        await ExecuteQuery(res, q, [r.course_title, r.course_category||null, ins], false, { db:"eduall_courses", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Cursos (importação)", description:`Importou curso "${r.course_title}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir curso")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de cursos", error:e.message }); }
}

/* =========================================================
 * 6) PRODUTOS
 * =======================================================*/
async function ProductsCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_product_name, ed_product_provider FROM eduall_products
       WHERE ed_product_deleted = 0 AND ed_product_institute_code = ?`,
      [ins], true, { db:"eduall_products", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${normalize(r.ed_product_name)}|${normalize(r.ed_product_provider||"")}`));
    const duplicates=[], valid=[];
    list.forEach((p,idx)=>{
      if (isEmpty(p.product_title)) { duplicates.push(fail(idx,"product_title é obrigatório")); return; }
      const key = `${normalize(p.product_title)}|${normalize(p.product_provider||"")}`;
      if (existing.has(key)) duplicates.push(fail(idx,"Produto duplicado (nome/provedor)"));
      else valid.push(p);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de produtos", error:e.message }); }
}
async function ProductsInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const p=list[i];
      try{
        if (isEmpty(p.product_title)) { failed.push(fail(i,"product_title é obrigatório")); continue; }
        const q = `INSERT INTO eduall_products(ed_product_name, ed_product_category, ed_product_purchase_price, ed_product_sale_price, ed_product_provider,
          ed_product_coin, ed_product_stock_amount, ed_product_stock_left, ed_product_picture, ed_product_description, ed_product_institute_code)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
        const params = [p.product_title, p.product_category||null, p.product_purchase_price ?? null, p.product_sales_price ?? null,
          p.product_provider||null, p.product_type_of_coin||null, p.product_stock_amount ?? 0, p.product_stock_amount ?? 0, "", p.product_description||null, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_products", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Produtos (importação)", description:`Importou produto "${p.product_title}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir produto")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de produtos", error:e.message }); }
}

/* =========================================================
 * 7) FORNECEDORES
 * =======================================================*/
async function ProvidersCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_provider_title, ed_provider_nif FROM eduall_providers
       WHERE ed_provider_deleted = 0 AND ed_provider_institute_code = ?`,
      [ins], true, { db:"eduall_providers", type:"select", data:req });
    const byNIF=new Set(rows.filter(r=>r.ed_provider_nif).map(r=>normalize(r.ed_provider_nif)));
    const byName=new Set(rows.map(r=>normalize(r.ed_provider_title)));
    const duplicates=[], valid=[];
    list.forEach((r,idx)=>{
      if (isEmpty(r.provider_name)) { duplicates.push(fail(idx,"provider_name é obrigatório")); return; }
      if (r.provider_nif && byNIF.has(normalize(r.provider_nif))) duplicates.push(fail(idx,"NIF já existe"));
      else if (byName.has(normalize(r.provider_name))) duplicates.push(fail(idx,"Fornecedor já existe (nome)"));
      else valid.push(r);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de fornecedores", error:e.message }); }
}
async function ProvidersInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for(let i=0;i<list.length;i++){
      const r=list[i];
      try{
        if (isEmpty(r.provider_name)) { failed.push(fail(i,"provider_name é obrigatório")); continue; }
        const q=`INSERT INTO eduall_providers(ed_provider_title, ed_provider_phone, ed_provider_nif, ed_provider_website, ed_provider_address, ed_provider_city, ed_provider_country, ed_provider_email, ed_provider_description, ed_provider_institute_code)
                 VALUES(?,?,?,?,?,?,?,?,?,?)`;
        const params=[r.provider_name, r.provider_phone||null, r.provider_nif||null, r.provider_website||null, r.provider_address||null, r.provider_city||null, r.provider_country||null, r.provider_email||null, r.provider_description||null, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_providers", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Fornecedores (importação)", description:`Importou fornecedor "${r.provider_name}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir fornecedor")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de fornecedores", error:e.message }); }
}

/* =========================================================
 * 8) EDITORES (publishers)
 * =======================================================*/
async function PublishersCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_library_publisher_name FROM eduall_library_publishers
       WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_institute_code = ?`,
      [ins], true, { db:"eduall_library_publishers", type:"select", data:req });
    const existing=new Set(rows.map(r=>normalize(r.ed_library_publisher_name)));
    const duplicates=[], valid=[];
    list.forEach((r,idx)=>{
      if (isEmpty(r.publisher_name)) { duplicates.push(fail(idx,"publisher_name é obrigatório")); return; }
      if (existing.has(normalize(r.publisher_name))) duplicates.push(fail(idx,"Editor duplicado"));
      else valid.push(r);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de editores", error:e.message }); }
}
async function PublishersInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const r=list[i];
      try{
        if (isEmpty(r.publisher_name)) { failed.push(fail(i,"publisher_name é obrigatório")); continue; }
        const q=`INSERT INTO eduall_library_publishers(ed_library_publisher_name, ed_library_publisher_status, ed_library_publisher_institute_code) VALUES(?,?,?)`;
        await ExecuteQuery(res, q, [r.publisher_name, r.publisher_status ?? 1, ins], false, { db:"eduall_library_publishers", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Editores (importação)", description:`Importou editor "${r.publisher_name}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir editor")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de editores", error:e.message }); }
}

/* =========================================================
 * 9) PRATELEIRAS (racks)
 * =======================================================*/
async function RacksCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_library_rack_name FROM eduall_library_racks
       WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = ?`,
      [ins], true, { db:"eduall_library_racks", type:"select", data:req });
    const existing=new Set(rows.map(r=>normalize(r.ed_library_rack_name)));
    const duplicates=[], valid=[];
    list.forEach((r,idx)=>{
      if (isEmpty(r.rack_name)) { duplicates.push(fail(idx,"rack_name é obrigatório")); return; }
      if (existing.has(normalize(r.rack_name))) duplicates.push(fail(idx,"Prateleira já existe"));
      else valid.push(r);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de prateleiras", error:e.message }); }
}
async function RacksInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const r=list[i];
      try{
        if (isEmpty(r.rack_name)) { failed.push(fail(i,"rack_name é obrigatório")); continue; }
        const q=`INSERT INTO eduall_library_racks(ed_library_rack_name, ed_library_rack_status, ed_library_rack_institute_code) VALUES(?,?,?)`;
        await ExecuteQuery(res, q, [r.rack_name, r.rack_status ?? 1, ins], false, { db:"eduall_library_racks", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Prateleiras (importação)", description:`Importou prateleira "${r.rack_name}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir prateleira")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de prateleiras", error:e.message }); }
}

/* =========================================================
 * 10) NOTAS TRIMESTRAIS (quarterly_notes)
 *    Dedupe: student + subject + quarter + class
 *    Permissão: tenta usar CheckQuarterlyNotePermission
 * =======================================================*/
async function QuarterlyNotesCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_quarter, ed_quarter_note_class
       FROM eduall_quarterly_notes
       WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_institute_code = ?`,
      [ins], true, { db:"eduall_quarterly_notes", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${r.ed_quarter_note_studentcode}|${r.ed_quarter_note_subject}|${r.ed_quarter_note_quarter}|${r.ed_quarter_note_class}`));
    const duplicates=[], valid=[];
    list.forEach((n,idx)=>{
      const errs=[];
      if (isEmpty(n.quarterly_note_student_code)) errs.push("quarterly_note_student_code é obrigatório");
      if (isEmpty(n.quarterly_note_subject)) errs.push("quarterly_note_subject é obrigatório");
      if (isEmpty(n.quarterly_note_quarter) && n.quarterly_note_quarter!==0) errs.push("quarterly_note_quarter é obrigatório");
      if (isEmpty(n.quarterly_note_class)) errs.push("quarterly_note_class é obrigatório");
      if (!errs.length){
        const key = `${n.quarterly_note_student_code}|${n.quarterly_note_subject}|${n.quarterly_note_quarter}|${n.quarterly_note_class}`;
        if (existing.has(key)) errs.push("Nota trimestral já registada");
      }
      if (errs.length) duplicates.push({ index: idx, errors: errs.map(m=>({message:m})) });
      else valid.push(n);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de notas trimestrais", error:e.message }); }
}
async function QuarterlyNotesInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const n=list[i];
      try{
        const { allowed } = await safeCheckQuarterPerm(req, res, n.quarterly_note_quarter);
        if (!allowed) { failed.push(fail(i,"Ação não permitida (restrição pedagógica)")); continue; }
        if (isEmpty(n.quarterly_note_student_code) || isEmpty(n.quarterly_note_subject) || isEmpty(n.quarterly_note_class)) {
          failed.push(fail(i,"Campos obrigatórios em falta (student/subject/class)")); continue;
        }
        const q=`INSERT INTO eduall_quarterly_notes(ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npp, ed_quarter_note_class, ed_quarter_note_npt, ed_quarter_note_institute_code)
                 VALUES(?,?,?,?,?,?,?,?)`;
        const params=[n.quarterly_note_student_code, n.quarterly_note_subject, n.quarterly_note_quarter, n.quarterly_note_mac ?? null, n.quarterly_note_npp ?? null, n.quarterly_note_class, n.quarterly_note_npt ?? null, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_quarterly_notes", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Notas trimestrais (importação)", description:`Importou notas trimestrais do estudante #${n.quarterly_note_student_code}`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir nota trimestral")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de notas trimestrais", error:e.message }); }
}

/* =========================================================
 * 11) NOTAS SEMESTRAIS
 *    Dedupe: student + subject + semester + class
 * =======================================================*/
async function SemesterNotesCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_semester_note_studentcode, ed_semester_note_subject, ed_semester_note_semester, ed_semester_note_class
       FROM eduall_semester_notes
       WHERE ed_semester_note_deleted = 0 AND ed_semester_note_institute_code = ?`,
      [ins], true, { db:"eduall_semester_notes", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${r.ed_semester_note_studentcode}|${r.ed_semester_note_subject}|${r.ed_semester_note_semester}|${r.ed_semester_note_class}`));
    const duplicates=[], valid=[];
    list.forEach((n,idx)=>{
      const errs=[];
      if (isEmpty(n.semester_note_student_code)) errs.push("semester_note_student_code é obrigatório");
      if (isEmpty(n.semester_note_subject)) errs.push("semester_note_subject é obrigatório");
      if (isEmpty(n.semester_note_semester) && n.semester_note_semester!==0) errs.push("semester_note_semester é obrigatório");
      if (isEmpty(n.semester_note_class)) errs.push("semester_note_class é obrigatório");
      const key = `${n.semester_note_student_code}|${n.semester_note_subject}|${n.semester_note_semester}|${n.semester_note_class}`;
      if (!errs.length && existing.has(key)) errs.push("Nota semestral já registada");
      if (errs.length) duplicates.push({ index: idx, errors: errs.map(m=>({message:m})) }); else valid.push(n);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de notas semestrais", error:e.message }); }
}
async function SemesterNotesInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const n=list[i];
      try{
        if (isEmpty(n.semester_note_student_code) || isEmpty(n.semester_note_subject) || isEmpty(n.semester_note_class)) {
          failed.push(fail(i,"Campos obrigatórios em falta (student/subject/class)")); continue;
        }
        const q = `INSERT INTO eduall_semester_notes(ed_semester_note_studentcode, ed_semester_note_subject, ed_semester_note_semester, ed_semester_note_p1, ed_semester_note_p2, ed_semester_note_exam, ed_semester_note_specialexam, ed_semester_note_class, ed_semester_note_institute_code)
                   VALUES(?,?,?,?,?,?,?,?,?)`;
        const params = [n.semester_note_student_code, n.semester_note_subject, n.semester_note_semester, n.semester_note_p1 ?? null, n.semester_note_p2 ?? null, n.semester_note_exam ?? null, n.semester_note_special_test ?? null, n.semester_note_class, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_semester_notes", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Notas semestrais (importação)", description:`Importou nota semestral do estudante #${n.semester_note_student_code}`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir nota semestral")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de notas semestrais", error:e.message }); }
}

/* =========================================================
 * 12) SERVIÇOS
 * =======================================================*/
async function ServicesCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_service_title, ed_service_provider, ed_service_price
       FROM eduall_services
       WHERE ed_service_deleted = 0 AND ed_service_institute_code = ?`,
      [ins], true, { db:"eduall_services", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${normalize(r.ed_service_title)}|${normalize(r.ed_service_provider||"")}|${r.ed_service_price||0}`));
    const duplicates=[], valid=[];
    list.forEach((s,idx)=>{
      if (isEmpty(s.service_title)) { duplicates.push(fail(idx,"service_title é obrigatório")); return; }
      const key=`${normalize(s.service_title)}|${normalize(s.service_provider||"")}|${s.service_price||0}`;
      if (existing.has(key)) duplicates.push(fail(idx,"Serviço duplicado (título/provedor/preço)"));
      else valid.push(s);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de serviços", error:e.message }); }
}
async function ServicesInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const s=list[i];
      try{
        if (isEmpty(s.service_title)) { failed.push(fail(i,"service_title é obrigatório")); continue; }
        const q = `INSERT INTO eduall_services (ed_service_title, ed_service_type, ed_service_provider, ed_service_price, ed_service_iva, ed_service_description, ed_service_coin, ed_service_institute_code)
                   VALUES (?,?,?,?,?,?,?,?)`;
        const params=[s.service_title, s.service_type||null, s.service_provider||null, s.service_price ?? null, s.service_iva ?? null, s.service_description||null, s.service_coin||null, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_services", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Serviços (importação)", description:`Importou serviço "${s.service_title}"`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir serviço")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de serviços", error:e.message }); }
}

/* =========================================================
 * 13) NOTAS DE EXAME
 *    Dedupe: student + subject + class
 *    Permissão: tenta usar CheckExamPermission e valida nível da turma para exame
 * =======================================================*/
async function ExamNotesCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows=await ExecuteQuery(res,
      `SELECT ed_student_exam_studentCode, ed_student_exam_subject, ed_student_exam_class
       FROM eduall_student_exam_notes
       WHERE ed_student_exam_deleted = 0 AND ed_student_exam_institute_code = ?`,
      [ins], true, { db:"eduall_student_exam_notes", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${r.ed_student_exam_studentCode}|${r.ed_student_exam_subject}|${r.ed_student_exam_class}`));
    const duplicates=[], valid=[];
    list.forEach((n,idx)=>{
      const errs=[];
      if (isEmpty(n.student_exam_code)) errs.push("student_exam_code é obrigatório");
      if (isEmpty(n.student_exam_subject)) errs.push("student_exam_subject é obrigatório");
      if (isEmpty(n.student_exam_class)) errs.push("student_exam_class é obrigatório");
      if (!errs.length){
        const key = `${n.student_exam_code}|${n.student_exam_subject}|${n.student_exam_class}`;
        if (existing.has(key)) errs.push("Nota de exame já registada");
      }
      if (errs.length) duplicates.push({ index: idx, errors: errs.map(m=>({message:m})) }); else valid.push(n);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de notas de exame", error:e.message }); }
}
async function ExamNotesInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const n=list[i];
      try{
        const { allowed } = await safeCheckExamPerm(req, res);
        if (!allowed) { failed.push(fail(i,"Ação não permitida (restrição pedagógica)")); continue; }
        if (isEmpty(n.student_exam_code) || isEmpty(n.student_exam_subject) || isEmpty(n.student_exam_class)) { failed.push(fail(i,"Campos obrigatórios em falta (student/subject/class)")); continue; }

        // validar se a turma permite exame (nível académico com forExam=1)
        const classRow = await ExecuteQuery(res,
          `SELECT ed_class_academic_level FROM eduall_class WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ? LIMIT 1`,
          [n.student_exam_class, ins], true, { db:"eduall_class", type:"select", data:req });
        if (!classRow?.length) { failed.push(fail(i,"Turma inválida/fora da instituição")); continue; }
        const levelId = classRow[0].ed_class_academic_level;
        const levelRow = await ExecuteQuery(res,
          `SELECT ed_academic_level_forExam FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? AND ed_academic_level_institute_code = ? LIMIT 1`,
          [levelId, ins], true, { db:"eduall_academic_level", type:"select", data:req });
        if (!levelRow?.length || levelRow[0].ed_academic_level_forExam*1 !== 1) { failed.push(fail(i,"Nível académico não permite exame")); continue; }

        const q = `INSERT INTO eduall_student_exam_notes (ed_student_exam_studentCode, ed_student_exam_class, ed_student_exam_subject, ed_student_exam_score, ed_student_exam_institute_code)
                   VALUES (?,?,?,?,?)`;
        const params=[n.student_exam_code, n.student_exam_class, n.student_exam_subject, n.student_exam_score ?? null, ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_student_exam_notes", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Notas de Exame (importação)", description:`Importou nota de exame do estudante #${n.student_exam_code}`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir nota de exame")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de notas de exame", error:e.message }); }
}

/* =========================================================
 * 14) DISCIPLINAS (subjects)
 * =======================================================*/

async function SubjectsCheck(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_subject_title FROM eduall_subjects
       WHERE ed_subject_deleted = 0 AND ed_subject_institute_code = ?`,
      [ins],
      true
    );

    const existing = new Set(rows.map(r => normalize(r.ed_subject_title)));
    const seenInUpload = new Set();

    const duplicates = []; // erros no próprio upload
    const ignored = [];    // já existentes no banco
    const valid = [];      // novos que podem ser inseridos

    list.forEach((r, idx) => {
      const title = normalize(r.subject_title);

      if (isEmpty(title)) {
        duplicates.push(fail(idx, "Nome da disciplina é obrigatório"));
        return;
      }

      // duplicado dentro do mesmo upload
      if (seenInUpload.has(title)) {
        duplicates.push(fail(idx, "Disciplina duplicada dentro do upload"));
        return;
      }

      seenInUpload.add(title);

      // já existe no banco → vai para ignorados
      if (existing.has(title)) {
        ignored.push({
          index: idx,
          message: "Disciplina já existe na base de dados",
          rowData: r
        });
        return;
      }

      // se chegou aqui, está apto para inserção
      valid.push(r);
    });

    res.json({ valid, duplicates, ignored });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: "Falha no check de disciplinas",
      error: e.message
    });
  }
}



async function SubjectsInsert(req, res) {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const ins = getInstitute(req);

    let inserted = 0;
    const failed = [];

    for (let i = 0; i < list.length; i++) {
      const r = list[i];

      try {
        if (isEmpty(r.subject_title)) {
          failed.push(fail(i, "subject_title é obrigatório"));
          continue;
        }

        const q = `
          INSERT INTO eduall_subjects(ed_subject_title, ed_subject_institute_code)
          VALUES(?, ?)
        `;
        const params = [r.subject_title, ins];
        await ExecuteQuery(res, q, params, false);

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Disciplinas (importação)",
          description: `Importou disciplina "${r.subject_title}"`,
          res,
          req
        });

        inserted++;
      } catch (err) {
        failed.push(fail(i, err.message || "Falha ao inserir disciplina"));
      }
    }

    // 🔑 Sempre retorna de forma consistente
    res.json({ 
      inserted, 
      failed 
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      message: "Falha na inserção de disciplinas",
      error: e.message
    });
  }
}



/* =========================================================
 * 15) HORÁRIOS (timings)
 * =======================================================*/
const isValidTime = (hs, ms, he, me) => {
  const Hs=parseInt(hs), Ms=parseInt(ms), He=parseInt(he), Me=parseInt(me);
  if ([Hs,Ms,He,Me].some(n=>Number.isNaN(n))) return false;
  if (Hs<0||Hs>23||He<0||He>23||Ms<0||Ms>59||Me<0||Me>59) return false;
  if (Hs>He || (Hs===He && Ms>=Me)) return false;
  return true;
};

async function TimingsCheck(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const rows = await ExecuteQuery(res,
      `SELECT ed_timing_hour_start, ed_timing_minute_start, ed_timing_hour_end, ed_timing_minute_end
       FROM eduall_timing
       WHERE ed_timing_deleted = 0 AND ed_timing_institute_code = ?`,
      [ins], true, { db:"eduall_timing", type:"select", data:req });
    const existing=new Set(rows.map(r=>`${r.ed_timing_hour_start}:${r.ed_timing_minute_start}-${r.ed_timing_hour_end}:${r.ed_timing_minute_end}`));
    const duplicates=[], valid=[];
    list.forEach((t,idx)=>{
      if (!isValidTime(t.timing_hour_start, t.timing_minute_start, t.timing_hour_end, t.timing_minute_end)) {
        duplicates.push(fail(idx,"Horário inválido")); return;
      }
      const key=`${parseInt(t.timing_hour_start)}:${parseInt(t.timing_minute_start)}-${parseInt(t.timing_hour_end)}:${parseInt(t.timing_minute_end)}`;
      if (existing.has(key)) duplicates.push(fail(idx,"Horário duplicado"));
      else valid.push(t);
    });
    res.json({ valid, duplicates });
  }catch(e){ res.status(500).json({ success:false, message:"Falha no check de horários", error:e.message }); }
}



async function TimingsInsert(req, res){
  try{
    const list=Array.isArray(req.body)?req.body:[]; const ins=getInstitute(req);
    const failed=[]; let inserted=0;
    for (let i=0;i<list.length;i++){
      const t=list[i];
      try{
        if (!isValidTime(t.timing_hour_start, t.timing_minute_start, t.timing_hour_end, t.timing_minute_end)) { failed.push(fail(i,"Horário inválido")); continue; }
        const q = `INSERT INTO eduall_timing(ed_timing_hour_start, ed_timing_minute_start, ed_timing_hour_end, ed_timing_minute_end, ed_timing_institute_code) VALUES(?,?,?,?,?)`;
        const params=[parseInt(t.timing_hour_start), parseInt(t.timing_minute_start), parseInt(t.timing_hour_end), parseInt(t.timing_minute_end), ins];
        await ExecuteQuery(res, q, params, false, { db:"eduall_timing", type:"insert", data:req });
        await RegisterAuditAction({ session:req.session, action:1, form:"Horários (importação)", description:`Importou horário ${params[0]}:${params[1]}-${params[2]}:${params[3]}`, res, req });
        inserted++;
      }catch(err){ failed.push(fail(i, err.message || "Falha ao inserir horário")); }
    }
    res.json({ inserted, failed });
  }catch(e){ res.status(500).json({ success:false, message:"Falha na inserção de horários", error:e.message }); }
}

  
/** -------------------------------------------------------
 * EXPORTS
 * ------------------------------------------------------*/
module.exports = { 
  ClassroomsCheck,ClassroomsInsert, 
  StudentsCheck,StudentsInsert, 
  AcademicLevelCheck,AcademicLevelInsert, 
  AcademicYearCheck,AcademicYearInsert, 
  AccountsCheck,AccountsInsert, 
  CiclesCheck,CiclesInsert, 
  ClassesCheck,ClassesInsert, 
  EmployeesCheck, EmployeesInsert, 
  AuthorsCheck, AuthorsInsert,
  BooksCheck, BooksInsert,
  BookCategoriesCheck, BookCategoriesInsert,
  ContactsCheck, ContactsInsert,
  CoursesCheck, CoursesInsert,
  ProductsCheck, ProductsInsert,
  ProvidersCheck, ProvidersInsert,
  PublishersCheck, PublishersInsert,
  RacksCheck, RacksInsert,
  QuarterlyNotesCheck, QuarterlyNotesInsert,
  SemesterNotesCheck, SemesterNotesInsert,
  ServicesCheck, ServicesInsert,
  ExamNotesCheck, ExamNotesInsert,
  SubjectsCheck, SubjectsInsert,
  TimingsCheck, TimingsInsert,
};

/** -------------------------------------------------------
 * COMO LIGAR AS ROTAS (Exemplo em Express) 
 * -------------------------------------------------------
 *
 * const express = require('express');
 * const router = express.Router();
 * const excel = require('./controllers/excelImportControllers');
 *
 * 
 * add verifytoke middleware to all. VerifyToken
 * // Salas
 * router.post('/api/classrooms/check', excel.ClassroomsCheck);
 * router.post('/api/classrooms/insert', excel.ClassroomsInsert);
 *
 * // Estudantes
 * router.post('/api/students/check', excel.StudentsCheck);
 * router.post('/api/students/insert', excel.StudentsInsert);
 *
 * // Níveis académicos
 * router.post('/api/academic-level/check', excel.AcademicLevelCheck);
 * router.post('/api/academic-level/insert', excel.AcademicLevelInsert);
 *
 * // Anos académicos
 * router.post('/api/academic-year/check', excel.AcademicYearCheck);
 * router.post('/api/academic-year/insert', excel.AcademicYearInsert);
 *
 * // Contas a pagar/receber
 * router.post('/api/accounts/check', excel.AccountsCheck);
 * router.post('/api/accounts/insert', excel.AccountsInsert);
 *
 * // Ciclos
 * router.post('/api/cicles/check', excel.CiclesCheck);
 * router.post('/api/cicles/insert', excel.CiclesInsert);
 *
 * // Turmas
 * router.post('/api/classes/check', excel.ClassesCheck);
 * router.post('/api/classes/insert', excel.ClassesInsert);
 *
 * // Funcionários
 * router.post('/api/employees/check', excel.EmployeesCheck);
 * router.post('/api/employees/insert', excel.EmployeesInsert);
 *
 
 
 * // Autores
 * router.post('/api/library/authors/check', excel.AuthorsCheck);
 * router.post('/api/library/authors/insert', excel.AuthorsInsert);
 *
 * // Livros
 * router.post('/api/library/books/check', excel.BooksCheck);
 * router.post('/api/library/books/insert', excel.BooksInsert);
 *
 * // Categorias de Livros
 * router.post('/api/library/categories/check', excel.BookCategoriesCheck);
 * router.post('/api/library/categories/insert', excel.BookCategoriesInsert);
 *
 * // Contactos
 * router.post('/api/contacts/check', excel.ContactsCheck);
 * router.post('/api/contacts/insert', excel.ContactsInsert);
 *
 * // Cursos
 * router.post('/api/courses/check', excel.CoursesCheck);
 * router.post('/api/courses/insert', excel.CoursesInsert);
 *
 * // Produtos
 * router.post('/api/products/check', excel.ProductsCheck);
 * router.post('/api/products/insert', excel.ProductsInsert);
 *
 * // Fornecedores
 * router.post('/api/providers/check', excel.ProvidersCheck);
 * router.post('/api/providers/insert', excel.ProvidersInsert);
 *
 * // Editores
 * router.post('/api/library/publishers/check', excel.PublishersCheck);
 * router.post('/api/library/publishers/insert', excel.PublishersInsert);
 *
 * // Prateleiras
 * router.post('/api/library/racks/check', excel.RacksCheck);
 * router.post('/api/library/racks/insert', excel.RacksInsert);
 *
 * // Notas trimestrais
 * router.post('/api/grades/quarterly/check', excel.QuarterlyNotesCheck);
 * router.post('/api/grades/quarterly/insert', excel.QuarterlyNotesInsert);
 *
 * // Notas semestrais
 * router.post('/api/grades/semester/check', excel.SemesterNotesCheck);
 * router.post('/api/grades/semester/insert', excel.SemesterNotesInsert);
 *
 * // Serviços
 * router.post('/api/services/check', excel.ServicesCheck);
 * router.post('/api/services/insert', excel.ServicesInsert);
 *
 * // Notas de exame
 * router.post('/api/exams/notes/check', excel.ExamNotesCheck);
 * router.post('/api/exams/notes/insert', excel.ExamNotesInsert);
 *
 * // Disciplinas
 * router.post('/api/subjects/check', excel.SubjectsCheck);
 * router.post('/api/subjects/insert', excel.SubjectsInsert);
 *
 * // Horários
 * router.post('/api/timings/check', excel.TimingsCheck);
 * router.post('/api/timings/insert', excel.TimingsInsert);
 *
 */

