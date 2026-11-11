const ExecuteQuery = require("../Functions/ExecuteQuery");

/* ════════════════════════════════════════════════════════════════════
   TABELA: eduall_quarterly_note_restrictions
   -----------------------------------------------------------------
   1 registo POR PROFESSOR (ed_quarterly_restriction_employee_id),
   permitindo restringir o lançamento de notas/presenças individualmente.
   Chave única: (institute_code, employee_id)
════════════════════════════════════════════════════════════════════ */

const CreateQuarterlyNoteRestrictionsTable = async (instituteCode) => {
  try {
    if (!instituteCode) throw new Error("Código da escola não fornecido.");

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS eduall_quarterly_note_restrictions (
        ed_quarterly_restriction_id INT PRIMARY KEY AUTO_INCREMENT,
        ed_quarterly_restriction_employee_id INT NOT NULL,
        ed_quarterly_restriction_first_quarter BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_second_quarter BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_third_quarter BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_presence BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_specialexam BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_exam BOOLEAN DEFAULT FALSE,
        ed_quarterly_restriction_institute_code VARCHAR(255),
        ed_quarterly_restriction_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_institute_employee (ed_quarterly_restriction_institute_code, ed_quarterly_restriction_employee_id)
      )
    `;
    await ExecuteQuery(null, createTableQuery, [], false, {
      db: "eduall_quarterly_note_restrictions",
      type: "create",
    });

    /* ─── Migração automática para bases antigas ───
       Se a tabela já existia (versão genérica, sem employee_id),
       adiciona a coluna e troca a chave única. */
    const checkColumnQuery = `
      SELECT COUNT(*) AS total
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'eduall_quarterly_note_restrictions'
        AND COLUMN_NAME = 'ed_quarterly_restriction_employee_id'
    `;
    const colCheck = await ExecuteQuery(null, checkColumnQuery, [], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
    });

    if (!colCheck || colCheck[0]?.total === 0) {
      await ExecuteQuery(
        null,
        `ALTER TABLE eduall_quarterly_note_restrictions
         ADD COLUMN ed_quarterly_restriction_employee_id INT NULL AFTER ed_quarterly_restriction_id`,
        [],
        false,
        { db: "eduall_quarterly_note_restrictions", type: "alter" }
      );

      // Remove a antiga unique key (institute_code sozinho), se existir
      try {
        await ExecuteQuery(
          null,
          `ALTER TABLE eduall_quarterly_note_restrictions
           DROP INDEX ed_quarterly_restriction_institute_code`,
          [],
          false,
          { db: "eduall_quarterly_note_restrictions", type: "alter" }
        );
      } catch (e) {
        // índice pode já não existir com esse nome — ignora
      }

      // Cria a nova unique key composta (institute_code + employee_id)
      try {
        await ExecuteQuery(
          null,
          `ALTER TABLE eduall_quarterly_note_restrictions
           ADD UNIQUE KEY uq_institute_employee (ed_quarterly_restriction_institute_code, ed_quarterly_restriction_employee_id)`,
          [],
          false,
          { db: "eduall_quarterly_note_restrictions", type: "alter" }
        );
      } catch (e) {
        // já pode existir
      }
    }
  } catch (error) {
    console.error("Erro ao criar/migrar tabela de restrições:", error.message);
    throw error;
  }
};

/* ─── Helper: obtém o ed_employee_id ligado à conta de sistema atual ─── */
const GetCurrentEmployeeId = async (req, res, instituteCode) => {
  const currentSystemAccountId = req?.session?.user?.eduall_user_session_ID;
  if (!currentSystemAccountId) return null;

  const query = `
    SELECT ed_system_account_employee
    FROM eduall_system_accounts
    WHERE ed_system_account_userid = ?
      AND ed_system_account_institute_code = ?
      AND ed_system_account_deleted = 0
  `;
  const result = await ExecuteQuery(res, query, [currentSystemAccountId, instituteCode], true, {
    db: "eduall_system_accounts",
    type: "select",
    data: req,
  });

  return result.length ? result[0].ed_system_account_employee : null;
};

/* ─── Helper: verifica se o utilizador atual é o Diretor Pedagógico ─── */
const IsPedagogicalDirector = async (req, res, instituteCode) => {
  const currentEmployeeId = await GetCurrentEmployeeId(req, res, instituteCode);
  if (!currentEmployeeId) return { isDirector: false, employeeId: null };

  const checkDirectorQuery = `
    SELECT ed_institute_pedagogical_director
    FROM eduall_institutes
    WHERE ed_institute_code = ? AND ed_institute_deleted = 0
  `;
  const instituteResult = await ExecuteQuery(res, checkDirectorQuery, [instituteCode], true, {
    db: "eduall_institutes",
    type: "select",
    data: req,
  });

  const isDirector = !!(
    instituteResult.length &&
    instituteResult[0].ed_institute_pedagogical_director == currentEmployeeId
  );

  return { isDirector, employeeId: currentEmployeeId };
};

/* ════════════════════════════════════════════════════════════════════
   GET — Lista todos os professores da instituição + as respetivas
   restrições (para renderizar os cards no frontend).
   Professores sem registo próprio aparecem com tudo "permitido" (1),
   que é o valor por defeito.
   Rota: GET /edualllistallteacherrestrictions/get
════════════════════════════════════════════════════════════════════ */
const GetAllTeachersRestrictions = async (req, res) => {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(400).json({ success: false, msg: "Sessão inválida. Instituição não encontrada." });
    }

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    // NOTA: o filtro abaixo assume que o cargo (job title) do professor
    // contém "professor"/"teacher". Se a instituição tiver outra forma
    // de identificar professores (ex: tabela de atribuição de disciplinas),
    // ajuste este WHERE para refletir essa lógica.
    const query = `
      SELECT
        e.ed_employee_id,
        e.ed_employee_name,
        e.ed_employee_email,
        e.ed_employee_picture,
        COALESCE(j.ed_job_title, 'Não atribuído') AS job_title,
        COALESCE(r.ed_quarterly_restriction_first_quarter, 0)  AS ed_quarterly_restriction_first_quarter,
        COALESCE(r.ed_quarterly_restriction_second_quarter, 0) AS ed_quarterly_restriction_second_quarter,
        COALESCE(r.ed_quarterly_restriction_third_quarter, 0)  AS ed_quarterly_restriction_third_quarter,
        COALESCE(r.ed_quarterly_restriction_presence, 0)       AS ed_quarterly_restriction_presence,
        COALESCE(r.ed_quarterly_restriction_specialexam, 0)    AS ed_quarterly_restriction_specialexam,
        COALESCE(r.ed_quarterly_restriction_exam, 0)           AS ed_quarterly_restriction_exam
      FROM eduall_employees e
      LEFT JOIN eduall_job_titles j
        ON j.ed_job_title_id = e.ed_employee_charge
      LEFT JOIN eduall_quarterly_note_restrictions r
        ON r.ed_quarterly_restriction_employee_id = e.ed_employee_id
        AND r.ed_quarterly_restriction_institute_code = ?
      WHERE e.ed_employee_deleted = 0
        AND e.ed_employee_institute_code = ?
        AND (j.ed_job_title LIKE '%rofessor%' OR j.ed_job_title LIKE '%eacher%')
      ORDER BY e.ed_employee_name ASC
    `;

    const rows = await ExecuteQuery(res, query, [instituteCode, instituteCode], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    const { isDirector } = await IsPedagogicalDirector(req, res, instituteCode);

    return res.status(200).json({ success: true, isDirector, data: rows });
  } catch (error) {
    console.error("Erro ao buscar restrições dos professores:", error.message);
    return res.status(500).json({
      success: false,
      msg: "Falha ao buscar restrições dos professores.",
      error: error.message,
    });
  }
};

/* ════════════════════════════════════════════════════════════════════
   PUT — Atualiza (upsert) a restrição de UM professor específico.
   Só o Diretor Pedagógico pode fazer esta alteração.
   Body esperado: { employeeId, firstQuarter, secondQuarter, thirdQuarter,
                     presence, SpecialExam, Exam }
   Rota: PUT /eduallpedagogyrestriction/update
════════════════════════════════════════════════════════════════════ */
const UpdateQuarterlyNoteRestriction = async (req, res) => {
  try {
    const { employeeId, firstQuarter, secondQuarter, thirdQuarter, presence, SpecialExam, Exam } = req.body;
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(400).json({ success: false, msg: "Sessão inválida. Instituição não encontrada." });
    }
    if (!employeeId) {
      return res.status(400).json({ success: false, msg: "Professor não especificado." });
    }

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const { isDirector } = await IsPedagogicalDirector(req, res, instituteCode);
    if (!isDirector) {
      return res.status(403).json({
        success: false,
        msg: "Apenas o diretor pedagógico pode alterar as restrições de lançamento de notas !",
      });
    }

    const upsertQuery = `
      INSERT INTO eduall_quarterly_note_restrictions (
        ed_quarterly_restriction_employee_id,
        ed_quarterly_restriction_first_quarter,
        ed_quarterly_restriction_second_quarter,
        ed_quarterly_restriction_third_quarter,
        ed_quarterly_restriction_presence,
        ed_quarterly_restriction_specialexam,
        ed_quarterly_restriction_exam,
        ed_quarterly_restriction_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        ed_quarterly_restriction_first_quarter  = VALUES(ed_quarterly_restriction_first_quarter),
        ed_quarterly_restriction_second_quarter = VALUES(ed_quarterly_restriction_second_quarter),
        ed_quarterly_restriction_third_quarter  = VALUES(ed_quarterly_restriction_third_quarter),
        ed_quarterly_restriction_presence       = VALUES(ed_quarterly_restriction_presence),
        ed_quarterly_restriction_specialexam    = VALUES(ed_quarterly_restriction_specialexam),
        ed_quarterly_restriction_exam           = VALUES(ed_quarterly_restriction_exam)
    `;

    const params = [
      employeeId,
      firstQuarter ? 1 : 0,
      secondQuarter ? 1 : 0,
      thirdQuarter ? 1 : 0,
      presence ? 1 : 0,
      SpecialExam ? 1 : 0,
      Exam ? 1 : 0,
      instituteCode,
    ];

    const result = await ExecuteQuery(res, upsertQuery, params, false, {
      db: "eduall_quarterly_note_restrictions",
      type: "insert",
      data: req,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Erro ao atualizar restrição:", error.message);
    return res.status(500).json({
      success: false,
      msg: "Falha ao atualizar as restrições de lançamento de notas.",
      error: error.message,
    });
  }
};

/* ════════════════════════════════════════════════════════════════════
   Funções de verificação — usadas noutras partes do sistema para saber
   se O PRÓPRIO utilizador (professor) logado pode lançar notas/presenças.
   Sem registo próprio na tabela = sem restrição (permitido).
════════════════════════════════════════════════════════════════════ */

const CheckQuarterlyNotePermission = async (req, res, quarter) => {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return { allowed: false };

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);
    const employeeId = await GetCurrentEmployeeId(req, res, instituteCode);
    if (!employeeId) return { allowed: false };

    const query = `
      SELECT ed_quarterly_restriction_first_quarter,
             ed_quarterly_restriction_second_quarter,
             ed_quarterly_restriction_third_quarter
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
        AND ed_quarterly_restriction_employee_id = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode, employeeId], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    if (result.length === 0) return { allowed: true }; // sem registo -> sem restrição

    const restriction = result[0];
    if (quarter === 1) return { allowed: restriction.ed_quarterly_restriction_first_quarter === 0 };
    if (quarter === 2) return { allowed: restriction.ed_quarterly_restriction_second_quarter === 0 };
    if (quarter === 3) return { allowed: restriction.ed_quarterly_restriction_third_quarter === 0 };

    return { allowed: false };
  } catch (error) {
    console.log("Erro ao verificar permissão de lançamento de notas: ", error.message);
    return { allowed: false };
  }
};

const CheckExamPermission = async (req, res) => {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return { allowed: false };

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);
    const employeeId = await GetCurrentEmployeeId(req, res, instituteCode);
    if (!employeeId) return { allowed: false };

    const query = `
      SELECT ed_quarterly_restriction_exam
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
        AND ed_quarterly_restriction_employee_id = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode, employeeId], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    if (result.length === 0) return { allowed: true };
    return { allowed: result[0].ed_quarterly_restriction_exam === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para exame: ", error.message);
    return { allowed: false };
  }
};

const CheckSpecialExamPermission = async (req, res) => {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return { allowed: false };

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);
    const employeeId = await GetCurrentEmployeeId(req, res, instituteCode);
    if (!employeeId) return { allowed: false };

    const query = `
      SELECT ed_quarterly_restriction_specialexam
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
        AND ed_quarterly_restriction_employee_id = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode, employeeId], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    if (result.length === 0) return { allowed: true };
    return { allowed: result[0].ed_quarterly_restriction_specialexam === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para exame especial: ", error.message);
    return { allowed: false };
  }
};

const CheckPresencePermission = async (req, res) => {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return { allowed: false };

    await CreateQuarterlyNoteRestrictionsTable(instituteCode);
    const employeeId = await GetCurrentEmployeeId(req, res, instituteCode);
    if (!employeeId) return { allowed: false };

    const query = `
      SELECT ed_quarterly_restriction_presence
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
        AND ed_quarterly_restriction_employee_id = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode, employeeId], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    if (result.length === 0) return { allowed: true };
    return { allowed: result[0].ed_quarterly_restriction_presence === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para presença: ", error.message);
    return { allowed: false };
  }
};

/* ════════════════════════════════════════════════════════════════════
   GET — Restrições do próprio utilizador logado (mantido por
   compatibilidade com outras páginas que já consomem este endpoint,
   ex: ecrã de lançamento de notas do professor).
   Rota: GET /eduallgetquarterpermittions/get
════════════════════════════════════════════════════════════════════ */
const GetQuarterlyNotesPermissions = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const employeeId = await GetCurrentEmployeeId(req, res, instituteCode);
    if (!employeeId) return res.status(200).json([]);

    const query = `
      SELECT * FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
        AND ed_quarterly_restriction_employee_id = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode, employeeId], true, {
      db: "eduall_quarterly_note_restrictions",
      type: "select",
      data: req,
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json(error);
  }
};

module.exports = {
  UpdateQuarterlyNoteRestriction,
  GetAllTeachersRestrictions,
  CheckQuarterlyNotePermission,
  GetQuarterlyNotesPermissions,
  CheckPresencePermission,
  CheckSpecialExamPermission,
  CheckExamPermission,
};
 