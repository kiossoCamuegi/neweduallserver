 const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");


const GetAllTeacherTiming = async (req, res) => {
   try {
       const { CODE } = req.params;
       const query = `SELECT * FROM eduall_teacher_timings 
       LEFT JOIN eduall_timing ON eduall_teacher_timings.ed_tch_timing_code = eduall_timing.ed_timing_id
       LEFT JOIN eduall_subjects ON eduall_teacher_timings.ed_tch_timing_subject = eduall_subjects.ed_subject_id  
       LEFT JOIN eduall_class ON eduall_teacher_timings.ed_tch_timing_class = eduall_class.ed_class_id
       WHERE eduall_teacher_timings.ed_tch_timing_deleted = 0 AND eduall_teacher_timings.ed_tch_timing_teacher_code = ? AND eduall_teacher_timings.ed_tch_timing_institute_code = ?`;
       const PARAMS = [CODE, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_timings", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(400).json({ success: false, msg: error.message });
   }
};


const GetTeacherTimingsData = async (req, res) => {
    try {
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const teachersQuery = `
            SELECT * FROM eduall_employees 
            WHERE ed_employee_deleted = 0 AND ed_employee_institute_code = ?;
        `;
        const teachers = await ExecuteQuery(res, teachersQuery, [instituteCode], true, { db: "eduall_employees", type: "select", data: req });

        const teacherTimingsQuery = `
            SELECT * FROM eduall_teacher_timings WHERE ed_tch_timing_deleted = 0;
        `;
        const teacherTimings = await ExecuteQuery(res, teacherTimingsQuery, [], true, { db: "eduall_teacher_timings", type: "select", data: req });

        const timingsQuery = `
            SELECT * FROM eduall_timing WHERE ed_timing_deleted = 0;
        `;
        const timings = await ExecuteQuery(res, timingsQuery, [], true, { db: "eduall_timing", type: "select", data: req });

        //  FIX: added missing WHERE keyword
        const subjectsQuery = `
            SELECT * FROM eduall_subjects WHERE ed_subject_deleted = 0;
        `;
        const subjects = await ExecuteQuery(res, subjectsQuery, [], true, { db: "eduall_subjects", type: "select", data: req });

        const classesQuery = `
            SELECT * FROM eduall_class WHERE ed_class_deleted = 0;
        `;
        const classes = await ExecuteQuery(res, classesQuery, [], true, { db: "eduall_class", type: "select", data: req });

        const result = teachers.map(teacher => {
            const assignedTimings = teacherTimings.filter(tt => tt.ed_tch_timing_teacher_code === teacher.ed_employee_code);

            const timingsData = assignedTimings.map(tt => {
                const timingDetail = timings.find(t => t.ed_timing_id === tt.ed_tch_timing_code);
                const subjectDetail = subjects.find(s => s.ed_subject_id === tt.ed_tch_timing_subject);
                const classDetail = classes.find(c => c.ed_class_code === tt.ed_tch_timing_class);

                return {
                    ed_tch_timing_code: tt.ed_tch_timing_code,
                    ed_class_code: tt.ed_tch_timing_class,
                    ed_class_title: classDetail?.ed_class_title || null,
                    ed_class_faculty: classDetail?.ed_class_faculty || null,
                    ed_class_course: classDetail?.ed_class_course || null,
                    ed_class_period: classDetail?.ed_class_period || null,
                    ed_class_year: classDetail?.ed_class_year || null,
                    ed_class_room: classDetail?.ed_class_room || null,
                    ed_class_cicle: classDetail?.ed_class_cicle || null,
                    ed_class_academic_level: classDetail?.ed_class_academic_level || null,
                    ed_class_description: classDetail?.ed_class_description || null,
                    ed_class_subjects: classDetail?.ed_class_subjects || null,
                    ed_subject_title: subjectDetail?.ed_subject_title || null,
                    ed_subject_category: subjectDetail?.ed_subject_category || null,
                    ed_subject_type: subjectDetail?.ed_subject_type || null,
                    timing: timingDetail
                        ? `${timingDetail.ed_timing_hour_start}H : ${timingDetail.ed_timing_minute_start} MN | ${timingDetail.ed_timing_hour_end}H : ${timingDetail.ed_timing_minute_end} MN`
                        : null
                };
            });

            return {
                employee: {
                    ed_employee_name: teacher.ed_employee_name,
                    ed_employee_address: teacher.ed_employee_address,
                    ed_employee_nacionality: teacher.ed_employee_nacionality,
                    ed_employee_naturalness: teacher.ed_employee_naturalness,
                    ed_employee_gender: teacher.ed_employee_gender,
                    ed_employee_religion: teacher.ed_employee_religion,
                    ed_employee_birthday: teacher.ed_employee_birthday,
                    ed_employee_phone: teacher.ed_employee_phone,
                    ed_employee_phone2: teacher.ed_employee_phone2,
                    ed_employee_nif: teacher.ed_employee_nif,
                    ed_employee_email: teacher.ed_employee_email,
                    ed_employee_civil_state: teacher.ed_employee_civil_state,
                    ed_employee_code: teacher.ed_employee_code,
                    ed_employee_picture: teacher.ed_employee_picture,
                    ed_employee_identityCard: teacher.ed_employee_identityCard,
                    ed_employee_charge: teacher.ed_employee_charge,
                    ed_employee_subjects: teacher.ed_employee_subjects,
                    ed_employee_status: teacher.ed_employee_status,
                    ed_employee_institute_code: teacher.ed_employee_institute_code,
                },
                timings: timingsData
            };
        });

        res.status(200).json(result);
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Erro ao obter dados", error: err.message });
    }
};


const GetAllClassTimings = async (req, res) => {
   try {
       const { CODE } = req.params;
       const query = `SELECT * FROM eduall_teacher_timings 
       LEFT JOIN eduall_timing ON eduall_teacher_timings.ed_tch_timing_code = eduall_timing.ed_timing_id
       LEFT JOIN eduall_subjects ON eduall_teacher_timings.ed_tch_timing_subject = eduall_subjects.ed_subject_id  
       LEFT JOIN eduall_class ON eduall_teacher_timings.ed_tch_timing_class = eduall_class.ed_class_id
       WHERE eduall_teacher_timings.ed_tch_timing_deleted = 0 AND eduall_teacher_timings.ed_tch_timing_class = ? AND eduall_teacher_timings.ed_tch_timing_institute_code = ?`;
       const PARAMS = [CODE, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_timings", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(400).json({ success: false, msg: error.message });
   }
};

//  FIX: corrected last condition from `ed_tch_timing_teacher_code ?` to `ed_tch_timing_institute_code = ?`
const GetTeacherTimingByClassSub = async (req, res) => {
   try {
       const { ID, CODE, CLASS, SUBJECT } = req.params;
       const query = `SELECT * FROM eduall_teacher_timings WHERE ed_tch_timing_deleted = 0 AND 
       ed_tch_timing_teacher_code = ? AND ed_tch_timing_code = ? AND ed_tch_timing_class = ? AND ed_tch_timing_subject = ? AND ed_tch_timing_institute_code = ?`;
       const PARAMS = [CODE, ID, CLASS, SUBJECT, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_timings", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(400).json({ success: false, msg: error.message });
   }
};

//  FIX: same correction as GetTeacherTimingByClassSub
const GetSingleTeacherTiming = async (req, res) => {
   try {
       const { ID, CODE, CLASS, SUBJECT } = req.params;
       const query = `SELECT * FROM eduall_teacher_timings WHERE ed_tch_timing_deleted = 0 AND 
       ed_tch_timing_teacher_code = ? AND ed_tch_timing_code = ? AND ed_tch_timing_class = ? AND ed_tch_timing_subject = ? AND ed_tch_timing_institute_code = ?`;
       const PARAMS = [CODE, ID, CLASS, SUBJECT, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_timings", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(400).json({ success: false, msg: error.message });
   }
};


const TeacherTimingDelete = async (req, res) => {
   try {
       const { ID } = req.params;
       console.log("ID = ", ID);
       const query = `UPDATE eduall_teacher_timings SET ed_tch_timing_deleted = 1
       WHERE ed_tch_timing_deleted = 0 AND ed_tch_timing_id = ? AND ed_tch_timing_institute_code = ?`;
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_teacher_timings", type: "update", data: req });

       await RegisterAuditAction({
           session: req.session,
           action: 3,
           form: "Horários dos Professores",
           description: `Deletou um horário atribuido a um professor`,
       });
       res.status(200).json({ success: true, msg: "Horário do professor deletado com sucesso!" });
   } catch (error) {
       res.status(400).json({ success: false, msg: error.message });
   }
};


const isFilled = (v) => String(v ?? "").trim() !== "";

const sendError = (res, httpStatus, code, msg, details = null) => {
    const payload = { success: false, code, msg };
    if (details) payload.details = details;
    return res.status(httpStatus).json(payload);
};

const sendOk = (res, payload = {}) => res.status(200).json({ success: true, ...payload });

const dbFailMsg = "Ocorreu um erro ao comunicar com a base de dados.";


const RegisterTeacherTiming = async (req, res) => {
    try {
        const institute = req?.session?.user?.eduall_user_session_curentinstitute;

        const teacherCode = String(req.body.teacher_timing_teacher_code ?? "").trim();
        const classId     = String(req.body.teacher_timing_class ?? "").trim();
        const subjectId   = String(req.body.teacher_timing_subject ?? "").trim();
        const weekday     = String(req.body.teacher_timing_weekday ?? "").trim();
        const timingCode  = String(req.body.teacher_timing_code ?? "").trim();

        if (!isFilled(institute)) {
            return sendError(res, 401, "SEM_INSTITUICAO", "Sessão inválida. Volte a iniciar sessão.");
        }

        if (!isFilled(teacherCode) || !isFilled(classId) || !isFilled(subjectId) || !isFilled(weekday) || !isFilled(timingCode)) {
            return sendError(res, 400, "CAMPOS_EM_FALTA", "Faltam dados. Escolha turma, disciplina, dia e horário.");
        }

        // 1) professor tem disciplina atribuída para a turma?
        const subjectExists = await ExecuteQuery(
            res,
            `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
             WHERE ed_tch_subject_class = ?
               AND ed_tch_subject_teacher_code = ?
               AND ed_tch_subject_code = ?
               AND ed_tch_subject_institute_code = ?
               AND ed_tch_subject_deleted = 0
             LIMIT 1`,
            [classId, teacherCode, subjectId, institute],
            true,
            { db: "eduall_teacher_subjects", type: "select", data: req }
        );

        if (!Array.isArray(subjectExists) || subjectExists.length === 0) {
            return sendError(res, 400, "SEM_DISCIPLINA_ATRIBUIDA", "Este professor ainda não tem esta disciplina atribuída nesta turma.");
        }

        // 2) duplicado (mesmo professor, mesma combinação)
        const existing = await ExecuteQuery(
            res,
            `SELECT ed_tch_timing_id FROM eduall_teacher_timings
             WHERE ed_tch_timing_code = ?
               AND ed_tch_timing_weekday = ?
               AND ed_tch_timing_class = ?
               AND ed_tch_timing_subject = ?
               AND ed_tch_timing_teacher_code = ?
               AND ed_tch_timing_institute_code = ?
               AND ed_tch_timing_deleted = 0
             LIMIT 1`,
            [timingCode, weekday, classId, subjectId, teacherCode, institute],
            true,
            { db: "eduall_teacher_timings", type: "select", data: req }
        );

        if (Array.isArray(existing) && existing.length > 0) {
            return sendError(res, 400, "DUPLICADO_PROFESSOR", "Este professor já tem este horário registado para esta turma e disciplina.");
        }

        // 3) conflito (outro professor já ocupa turma+disciplina+dia+horário)
        const conflict = await ExecuteQuery(
            res,
            `SELECT ed_tch_timing_id FROM eduall_teacher_timings
             WHERE ed_tch_timing_code = ?
               AND ed_tch_timing_weekday = ?
               AND ed_tch_timing_class = ?
               AND ed_tch_timing_subject = ?
               AND ed_tch_timing_teacher_code != ?
               AND ed_tch_timing_institute_code = ?
               AND ed_tch_timing_deleted = 0
             LIMIT 1`,
            [timingCode, weekday, classId, subjectId, teacherCode, institute],
            true,
            { db: "eduall_teacher_timings", type: "select", data: req }
        );

        if (Array.isArray(conflict) && conflict.length > 0) {
            return sendError(res, 400, "CONFLITO_OUTRO_PROFESSOR", "Este horário já está ocupado por outro professor nesta turma e disciplina.");
        }

        // 4) inserir
        await ExecuteQuery(
            res,
            `INSERT INTO eduall_teacher_timings
              (ed_tch_timing_code, ed_tch_timing_weekday, ed_tch_timing_class, ed_tch_timing_subject,
               ed_tch_timing_teacher_code, ed_tch_timing_institute_code)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [timingCode, weekday, classId, subjectId, teacherCode, institute],
            false,
            { db: "eduall_teacher_timings", type: "insert", data: req }
        );

        await RegisterAuditAction({
            session: req.session,
            action: 1,
            form: "Horários dos Professores",
            description: `Atribuiu um horário ao professor (ID: ${teacherCode})`,
        });

        return sendOk(res, { msg: "Horário atribuído com sucesso." });
    } catch (error) {
        return sendError(res, 500, "ERRO_SERVIDOR", dbFailMsg, error?.message ? { debug: error.message } : null);
    }
};


const UpdateTeacherTiming = async (req, res) => {
    try {
        const { ID }    = req.params;
        const institute = req?.session?.user?.eduall_user_session_curentinstitute;

        const classId    = String(req.body.teacher_timing_class ?? "").trim();
        const subjectId  = String(req.body.teacher_timing_subject ?? "").trim();
        const weekday    = req.body.teacher_timing_weekday;
        const timingCode = String(req.body.teacher_timing_code ?? "").trim();

        if (!isFilled(institute)) {
            return sendError(res, 401, "SEM_INSTITUICAO", "Sessão inválida. Volte a iniciar sessão.");
        }
        if (!isFilled(ID)) {
            return sendError(res, 400, "ID_INVALIDO", "ID inválido.");
        }
        if (!isFilled(classId) || !isFilled(subjectId) || weekday === undefined || weekday === null || !isFilled(timingCode)) {
            return sendError(res, 400, "CAMPOS_EM_FALTA", "Faltam dados. Escolha turma, disciplina, dia e horário.");
        }

        // 1) buscar registo atual
        const current = await ExecuteQuery(
            res,
            `SELECT ed_tch_timing_id, ed_tch_timing_teacher_code
               FROM eduall_teacher_timings
              WHERE ed_tch_timing_id = ?
                AND ed_tch_timing_institute_code = ?
                AND ed_tch_timing_deleted = 0
              LIMIT 1`,
            [ID, institute],
            true,
            { db: "eduall_teacher_timings", type: "select", data: req }
        );

        if (!Array.isArray(current) || !current.length) {
            return sendError(res, 404, "NAO_ENCONTRADO", "Não foi possível encontrar este registo.");
        }

        const teacherCode = String(current[0].ed_tch_timing_teacher_code ?? "").trim();

        // 2) professor tem disciplina atribuída para a turma?
        const subjectExists = await ExecuteQuery(
            res,
            `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
             WHERE ed_tch_subject_deleted = 0
               AND ed_tch_subject_institute_code = ?
               AND ed_tch_subject_teacher_code = ?
               AND ed_tch_subject_class = ?
               AND ed_tch_subject_code = ?
             LIMIT 1`,
            [institute, teacherCode, classId, subjectId],
            true,
            { db: "eduall_teacher_subjects", type: "select", data: req }
        );

        if (!Array.isArray(subjectExists) || !subjectExists.length) {
            return sendError(res, 400, "SEM_DISCIPLINA_ATRIBUIDA", "Este professor ainda não tem esta disciplina atribuída nesta turma.");
        }

        // 3) duplicado do mesmo professor
        const dup = await ExecuteQuery(
            res,
            `SELECT ed_tch_timing_id FROM eduall_teacher_timings
             WHERE ed_tch_timing_deleted = 0
               AND ed_tch_timing_institute_code = ?
               AND ed_tch_timing_teacher_code = ?
               AND ed_tch_timing_class = ?
               AND ed_tch_timing_subject = ?
               AND ed_tch_timing_weekday = ?
               AND ed_tch_timing_code = ?
               AND ed_tch_timing_id != ?
             LIMIT 1`,
            [institute, teacherCode, classId, subjectId, weekday, timingCode, ID],
            true,
            { db: "eduall_teacher_timings", type: "select", data: req }
        );

        if (Array.isArray(dup) && dup.length) {
            return sendError(res, 400, "DUPLICADO_PROFESSOR", "Este professor já tem este horário registado.");
        }

        // 4) conflito com outro professor
        const conflict = await ExecuteQuery(
            res,
            `SELECT ed_tch_timing_id FROM eduall_teacher_timings
             WHERE ed_tch_timing_deleted = 0
               AND ed_tch_timing_institute_code = ?
               AND ed_tch_timing_class = ?
               AND ed_tch_timing_subject = ?
               AND ed_tch_timing_weekday = ?
               AND ed_tch_timing_code = ?
               AND ed_tch_timing_teacher_code != ?
             LIMIT 1`,
            [institute, classId, subjectId, weekday, timingCode, teacherCode],
            true,
            { db: "eduall_teacher_timings", type: "select", data: req }
        );

        if (Array.isArray(conflict) && conflict.length) {
            return sendError(res, 400, "CONFLITO_OUTRO_PROFESSOR", "Este horário já está ocupado por outro professor nesta turma e disciplina.");
        }

        // 5) atualizar
        await ExecuteQuery(
            res,
            `UPDATE eduall_teacher_timings
                SET ed_tch_timing_class = ?, ed_tch_timing_subject = ?, ed_tch_timing_weekday = ?, ed_tch_timing_code = ?
              WHERE ed_tch_timing_id = ?
                AND ed_tch_timing_institute_code = ?
                AND ed_tch_timing_deleted = 0`,
            [classId, subjectId, weekday, timingCode, ID, institute],
            false,
            { db: "eduall_teacher_timings", type: "update", data: req }
        );

        await RegisterAuditAction({
            session: req.session,
            action: 2,
            form: "Horários dos Professores",
            description: `Atualizou horário do professor (ID: ${ID})`,
        });

        return sendOk(res, { msg: "Atualizado com sucesso." });
    } catch (err) {
        return sendError(res, 500, "ERRO_SERVIDOR", dbFailMsg, err?.message ? { debug: err.message } : null);
    }
};


const RegisterTeacherAssignmentsBulk = async (req, res) => {
    try {
        console.log("\n");
        console.log("╔══════════════════════════════════════════════════════════════╗");
        console.log("║         RegisterTeacherAssignmentsBulk — INÍCIO             ║");
        console.log("╚══════════════════════════════════════════════════════════════╝");

        const institute = req.session.user.eduall_user_session_curentinstitute;
        const subjects  = Array.isArray(req.body.subjects) ? req.body.subjects : [];
        const timings   = Array.isArray(req.body.timings)  ? req.body.timings  : [];

        console.log("📥  PAYLOAD RECEBIDO");
        console.log("    institute       :", institute);
        console.log("    subjects.length :", subjects.length);
        console.log("    timings.length  :", timings.length);
        console.log("    subjects        :", JSON.stringify(subjects, null, 4));
        console.log("    timings         :", JSON.stringify(timings, null, 4));

        if (!subjects.length && !timings.length) {
            console.log("⚠️  ABORTADO — payload vazio (sem subjects nem timings)");
            return res.status(400).json({
                success: false,
                msg: "<strong>Nenhuma informação foi enviada.</strong> Por favor preencha pelo menos uma atribuição antes de guardar.",
            });
        }

        const getEmployeeName = async (employeeCode) => {
            try {
                const rows = await ExecuteQuery(
                    res,
                    `SELECT ed_employee_name
                       FROM eduall_employees
                      WHERE ed_employee_id = ?
                        AND ed_employee_institute_code = ?
                      LIMIT 1`,
                    [employeeCode, institute],
                    true,
                    { db: "eduall_employees", type: "select", data: req }
                );
                const name = rows.length ? rows[0].ed_employee_name : "outro docente";
                console.log(`    🔍  getEmployeeName(${employeeCode}) →`, name);
                return name;
            } catch {
                console.log(`    🔍  getEmployeeName(${employeeCode}) → ERRO, a usar fallback "outro docente"`);
                return "outro docente";
            }
        };

        let insertedSubjects = 0, insertedTimings = 0;
        const failedSubjects = [], failedTimings = [];

        /* ══════════════════════════════════════════════════════════
           PASSO 1 — Registar disciplinas
        ══════════════════════════════════════════════════════════ */
        console.log("\n────────────────────────────────────────────────────────────────");
        console.log(`📚  PASSO 1 — DISCIPLINAS (${subjects.length} item(s))`);
        console.log("────────────────────────────────────────────────────────────────");

        for (const [idx, it] of subjects.entries()) {
            const teacher   = it.teacher_subject_teacher_code;
            const classId   = it.teacher_subject_class;
            const subjectId = it.teacher_subject_code;

            console.log(`\n  [disciplina #${idx + 1}]`);
            console.log("    teacher   :", teacher   || "(vazio)");
            console.log("    classId   :", classId   || "(vazio)");
            console.log("    subjectId :", subjectId || "(vazio)");

            if (!teacher || !classId || !subjectId) {
                console.log("      FALHOU — campos em falta");
                failedSubjects.push({
                    item: it,
                    error: "<strong>Informação incompleta.</strong> Uma das atribuições de disciplina ficou por preencher. Por favor verifique se selecionou a turma, a disciplina e o professor corretamente.",
                });
                continue;
            }

            console.log("    🔎  a verificar duplicado (mesmo professor)...");
            const own = await ExecuteQuery(
                res,
                `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
                 WHERE ed_tch_subject_class = ?
                   AND ed_tch_subject_teacher_code = ?
                   AND ed_tch_subject_code = ?
                   AND ed_tch_subject_institute_code = ?
                   AND ed_tch_subject_deleted = 0
                 LIMIT 1`,
                [classId, teacher, subjectId, institute],
                true,
                { db: "eduall_teacher_subjects", type: "select", data: req }
            );

            if (own.length) {
                console.log("      FALHOU — disciplina já atribuída a este professor (id:", own[0].ed_tch_subject_id, ")");
                failedSubjects.push({
                    item: it,
                    error: "<strong>Esta disciplina já se encontra atribuída a este professor.</strong> Não é possível atribuir a mesma disciplina duas vezes na mesma turma ao mesmo docente.",
                });
                continue;
            }

            console.log("    🔎  a verificar conflito com outro docente...");
            const otherRow = await ExecuteQuery(
                res,
                `SELECT ed_tch_subject_teacher_code FROM eduall_teacher_subjects
                 WHERE ed_tch_subject_class = ?
                   AND ed_tch_subject_code = ?
                   AND ed_tch_subject_institute_code = ?
                   AND ed_tch_subject_teacher_code != ?
                   AND ed_tch_subject_deleted = 0
                 LIMIT 1`,
                [classId, subjectId, institute, teacher],
                true,
                { db: "eduall_teacher_subjects", type: "select", data: req }
            );

            if (otherRow.length) {
                const ownerCode = otherRow[0].ed_tch_subject_teacher_code;
                console.log("    🔎  conflito encontrado — a buscar nome do docente (código:", ownerCode, ")");
                const ownerName = await getEmployeeName(ownerCode);
                console.log(`      FALHOU — disciplina já pertence a "${ownerName}"`);
                failedSubjects.push({
                    item: it,
                    error: `<strong>Esta disciplina já foi entregue ao docente <u>${ownerName}</u> nesta turma.</strong> Cada disciplina só pode pertencer a um professor por turma. Se pretende fazer uma substituição, utilize a opção de transferência de dados.`,
                });
                continue;
            }

            console.log("      sem conflitos — a inserir...");
            await ExecuteQuery(
                res,
                `INSERT INTO eduall_teacher_subjects(
                  ed_tch_subject_code,
                  ed_tch_subject_class,
                  ed_tch_subject_teacher_code,
                  ed_tch_subject_institute_code
                ) VALUES (?,?,?,?)`,
                [subjectId, classId, teacher, institute],
                false,
                { db: "eduall_teacher_subjects", type: "insert", data: req }
            );
            insertedSubjects++;
            console.log(`      INSERIDO (total inseridos até agora: ${insertedSubjects})`);
        }

        /* ══════════════════════════════════════════════════════════
           PASSO 2 — Registar horários
        ══════════════════════════════════════════════════════════ */
        console.log("\n────────────────────────────────────────────────────────────────");
        console.log(`🕐  PASSO 2 — HORÁRIOS (${timings.length} item(s))`);
        console.log("────────────────────────────────────────────────────────────────");

        for (const [idx, it] of timings.entries()) {
            const teacher    = it.teacher_timing_teacher_code;
            const classId    = it.teacher_timing_class;
            const subjectId  = it.teacher_timing_subject;
            const timingCode = it.teacher_timing_code;
            const weekday    = it.teacher_timing_weekday;

            console.log(`\n  [horário #${idx + 1}]`);
            console.log("    teacher    :", teacher    || "(vazio)");
            console.log("    classId    :", classId    || "(vazio)");
            console.log("    subjectId  :", subjectId  || "(vazio)");
            console.log("    timingCode :", timingCode || "(vazio)");
            console.log("    weekday    :", weekday !== undefined ? weekday : "(undefined)");

            if (!teacher || !classId || !subjectId || !timingCode || weekday === undefined) {
                console.log("      FALHOU — campos em falta no horário");
                failedTimings.push({
                    item: it,
                    error: "<strong>Horário incompleto.</strong> Algum dos campos do horário não foi preenchido. Certifique-se de que escolheu o dia da semana e a hora de início e fim.",
                });
                continue;
            }

            console.log("    🔎  a verificar se professor tem a disciplina nesta turma...");
            const hasSub = await ExecuteQuery(
                res,
                `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
                 WHERE ed_tch_subject_class = ?
                   AND ed_tch_subject_teacher_code = ?
                   AND ed_tch_subject_code = ?
                   AND ed_tch_subject_institute_code = ?
                   AND ed_tch_subject_deleted = 0
                 LIMIT 1`,
                [classId, teacher, subjectId, institute],
                true,
                { db: "eduall_teacher_subjects", type: "select", data: req }
            );

            if (!hasSub.length) {
                console.log("      FALHOU — professor não tem a disciplina atribuída nesta turma");
                failedTimings.push({
                    item: it,
                    error: "<strong>Não é possível adicionar este horário.</strong> Para registar um horário, o professor tem de ter primeiro a disciplina atribuída nessa turma. Adicione a disciplina e tente novamente.",
                });
                continue;
            }

            console.log("    🔎  a verificar duplicado de horário (mesmo professor)...");
            const dup = await ExecuteQuery(
                res,
                `SELECT ed_tch_timing_id FROM eduall_teacher_timings
                 WHERE ed_tch_timing_code = ?
                   AND ed_tch_timing_weekday = ?
                   AND ed_tch_timing_class = ?
                   AND ed_tch_timing_subject = ?
                   AND ed_tch_timing_teacher_code = ?
                   AND ed_tch_timing_institute_code = ?
                   AND ed_tch_timing_deleted = 0
                 LIMIT 1`,
                [timingCode, weekday, classId, subjectId, teacher, institute],
                true,
                { db: "eduall_teacher_timings", type: "select", data: req }
            );

            if (dup.length) {
                console.log("      FALHOU — horário duplicado para este professor (id:", dup[0].ed_tch_timing_id, ")");
                failedTimings.push({
                    item: it,
                    error: "<strong>Este horário já existe para este professor.</strong> O docente já tem este dia e hora registados para esta disciplina e turma. Não é necessário adicionar novamente.",
                });
                continue;
            }

            console.log("    🔎  a verificar conflito com outro docente no mesmo horário...");
            const conflictRow = await ExecuteQuery(
                res,
                `SELECT ed_tch_timing_teacher_code FROM eduall_teacher_timings
                 WHERE ed_tch_timing_code = ?
                   AND ed_tch_timing_weekday = ?
                   AND ed_tch_timing_class = ?
                   AND ed_tch_timing_subject = ?
                   AND ed_tch_timing_teacher_code != ?
                   AND ed_tch_timing_institute_code = ?
                   AND ed_tch_timing_deleted = 0
                 LIMIT 1`,
                [timingCode, weekday, classId, subjectId, teacher, institute],
                true,
                { db: "eduall_teacher_timings", type: "select", data: req }
            );

            if (conflictRow.length) {
                const ownerCode = conflictRow[0].ed_tch_timing_teacher_code;
                console.log("    🔎  conflito encontrado — a buscar nome do docente (código:", ownerCode, ")");
                const ownerName = await getEmployeeName(ownerCode);
                console.log(`      FALHOU — horário já ocupado por "${ownerName}"`);
                failedTimings.push({
                    item: it,
                    error: `<strong>Este horário já está ocupado pelo docente <u>${ownerName}</u>.</strong> Neste dia e hora, esta disciplina já tem esse docente registado nesta turma. Escolha um horário diferente ou verifique com a coordenação.`,
                });
                continue;
            }

            console.log("      sem conflitos — a inserir horário...");
            await ExecuteQuery(
                res,
                `INSERT INTO eduall_teacher_timings(
                  ed_tch_timing_code,
                  ed_tch_timing_weekday,
                  ed_tch_timing_class,
                  ed_tch_timing_subject,
                  ed_tch_timing_teacher_code,
                  ed_tch_timing_institute_code
                ) VALUES (?,?,?,?,?,?)`,
                [timingCode, weekday, classId, subjectId, teacher, institute],
                false,
                { db: "eduall_teacher_timings", type: "insert", data: req }
            );
            insertedTimings++;
            console.log(`      INSERIDO (total inseridos até agora: ${insertedTimings})`);
        }

        /* ══════════════════════════════════════════════════════════
           Auditoria
        ══════════════════════════════════════════════════════════ */
        if (insertedSubjects > 0 || insertedTimings > 0) {
            console.log("\n📝  AUDITORIA — a registar ação...");
            await RegisterAuditAction({
                session: req.session,
                action: 1,
                form: "Atribuições em Lote",
                description: `Registou ${insertedSubjects} disciplina(s) e ${insertedTimings} horário(s) em lote.`,
            });
            console.log("      auditoria registada");
        } else {
            console.log("\n📝  AUDITORIA — ignorada (nenhuma inserção foi feita)");
        }

        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log("║           RegisterTeacherAssignmentsBulk — RESULTADO        ║");
        console.log("╠══════════════════════════════════════════════════════════════╣");
        console.log(`║  disciplinas inseridas : ${String(insertedSubjects).padEnd(36)}║`);
        console.log(`║  disciplinas falhadas  : ${String(failedSubjects.length).padEnd(36)}║`);
        console.log(`║  horários inseridos    : ${String(insertedTimings).padEnd(36)}║`);
        console.log(`║  horários falhados     : ${String(failedTimings.length).padEnd(36)}║`);
        console.log("╠══════════════════════════════════════════════════════════════╣");

        if (failedSubjects.length) {
            console.log("║  ERROS — DISCIPLINAS                                         ║");
            failedSubjects.forEach((f, i) => {
                const msg = f.error.replace(/<[^>]+>/g, "").substring(0, 55);
                console.log(`║    #${i + 1} ${msg.padEnd(57)}║`);
                console.log(`║       payload: ${JSON.stringify(f.item).substring(0, 46).padEnd(46)}║`);
            });
            console.log("╠══════════════════════════════════════════════════════════════╣");
        }

        if (failedTimings.length) {
            console.log("║  ERROS — HORÁRIOS                                            ║");
            failedTimings.forEach((f, i) => {
                const msg = f.error.replace(/<[^>]+>/g, "").substring(0, 55);
                console.log(`║    #${i + 1} ${msg.padEnd(57)}║`);
                console.log(`║       payload: ${JSON.stringify(f.item).substring(0, 46).padEnd(46)}║`);
            });
            console.log("╠══════════════════════════════════════════════════════════════╣");
        }

        console.log("║  STATUS: 200 OK                                            ║");
        console.log("╚══════════════════════════════════════════════════════════════╝\n");

        return res.status(200).json({
            success: true,
            insertedSubjects,
            failedSubjects: failedSubjects.length,
            insertedTimings,
            failedTimings: failedTimings.length,
            details: { failedSubjects, failedTimings },
        });

    } catch (err) {
        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log("║  RegisterTeacherAssignmentsBulk — ERRO INESPERADO          ║");
        console.log("╚══════════════════════════════════════════════════════════════╝");
        console.error("  erro:", err);
        return res.status(400).json({
            success: false,
            msg: "<strong>Ocorreu um erro inesperado ao tentar guardar.</strong> Por favor tente novamente. Se o problema persistir, contacte o suporte técnico.",
        });
    }
};


//  FIX: req and res are now parameters instead of captured from outer scope
const transferTeacherSubjects = async (req, res, fromTeacher, toTeacher) => {
    await ExecuteQuery(
        res,
        `UPDATE eduall_teacher_subjects
         SET ed_tch_subject_teacher_code = ?
         WHERE ed_tch_subject_teacher_code = ?
           AND ed_tch_subject_deleted = 0`,
        [toTeacher, fromTeacher],
        false,
        { db: "eduall_teacher_subjects", type: "update", data: req }
    );

    await ExecuteQuery(
        res,
        `UPDATE eduall_teacher_timings
         SET ed_tch_timing_teacher_code = ?
         WHERE ed_tch_timing_teacher_code = ?
           AND ed_tch_timing_deleted = 0`,
        [toTeacher, fromTeacher],
        false,
        { db: "eduall_teacher_timings", type: "update", data: req }
    );

    console.log(` Transferência concluída: professor ${fromTeacher} → ${toTeacher}`);
};

//  FIX: proper route handler instead of bare auto-execution
const TransferTeacherSubjects = async (req, res) => {
    try {
        const { fromTeacher, toTeacher } = req.body;

        if (!fromTeacher || !toTeacher) {
            return res.status(400).json({ success: false, msg: "fromTeacher e toTeacher são obrigatórios." });
        }

        await transferTeacherSubjects(req, res, fromTeacher, toTeacher);

        await RegisterAuditAction({
            session: req.session,
            action: 2,
            form: "Transferência de Docente",
            description: `Transferiu disciplinas e horários do professor ${fromTeacher} para ${toTeacher}.`,
        });

        return res.status(200).json({ success: true, msg: "Transferência concluída com sucesso." });
    } catch (err) {
        return res.status(500).json({ success: false, msg: "Erro na transferência.", error: err.message });
    }
};


module.exports = {
    GetSingleTeacherTiming,
    GetTeacherTimingByClassSub,
    GetAllTeacherTiming,
    TeacherTimingDelete,
    RegisterTeacherTiming,
    GetAllClassTimings,
    GetTeacherTimingsData,
    UpdateTeacherTiming,
    RegisterTeacherAssignmentsBulk,
    TransferTeacherSubjects,  
};