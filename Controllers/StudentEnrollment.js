const ExecuteQuery = require("../Functions/ExecuteQuery");
const { invalidateStudentCaches } = require("../Functions/StudentCache");
const { RegisterAuditAction } = require("./Auditory");

const GetStudentEnrollments = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_enrollment_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar matrículas!", error: error.message });
    }
};

const GetSingleStudentEnrollment = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar matrícula!", error: error.message });
    }
};

const CheckExistentStudentEnrollment = async (req, res) => {
    try {
        const { STUDENT } = req.params;
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_studentcode = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [STUDENT, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao verificar matrícula existente!", error: error.message });
    }
};


const RegisterStudentEnrollment = async (req, res) => {
  // ============================================================
  // Cores ANSI
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

  try {
    // ─────────────────────────────────────────────────────────
    // 0. LOG DO PAYLOAD
    // ─────────────────────────────────────────────────────────
    console.log(`\n${C.cyan}${C.bold}📥 RECEBIDO PAYLOAD DE MATRÍCULA INDIVIDUAL${C.reset}`);
    console.log(`${C.dim}${JSON.stringify(req.body, null, 2)}${C.reset}\n`);

    // ─────────────────────────────────────────────────────────
    // 1. EXTRAIR E VALIDAR PAYLOAD
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Validando payload...${C.reset}`);

    const institute   = req.session?.user?.eduall_user_session_curentinstitute;
    const studentCode = req.body.student_enrollment_code;
    const service     = req.body.student_enrollment_service;
    const newClass    = req.body.student_enrollment_class;

    // Validar obrigatórios
    if (!institute) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Instituto não encontrado na sessão`);
      return res.status(401).json({
        success: false,
        msg: "Sessão inválida: instituto não identificado!",
        code: "MISSING_INSTITUTE"
      });
    }

    if (!studentCode) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Código do aluno não fornecido`);
      return res.status(400).json({
        success: false,
        msg: "Código do aluno inválido!",
        code: "NO_STUDENT_CODE"
      });
    }

    if (!service) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Serviço não fornecido`);
      return res.status(400).json({
        success: false,
        msg: "Serviço inválido!",
        code: "NO_SERVICE"
      });
    }

    if (!newClass) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Turma não fornecida`);
      return res.status(400).json({
        success: false,
        msg: "Turma inválida!",
        code: "NO_CLASS"
      });
    }

    console.log(`${C.green}✓${C.reset} Payload validado`);
    console.log(`  ${C.white}Instituto:${C.reset} ${institute}`);
    console.log(`  ${C.white}Aluno (código):${C.reset} ${studentCode}`);
    console.log(`  ${C.white}Serviço:${C.reset} ${service}`);
    console.log(`  ${C.white}Turma:${C.reset} ${newClass}\n`);

    // ─────────────────────────────────────────────────────────
    // 2. VALIDAR QUE TURMA EXISTE E PERTENCE AO INSTITUTO
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Validando turma...${C.reset}`);
    const classExists = await ExecuteQuery(
      res,
      `SELECT ed_class_id, ed_class_title, ed_class_year
       FROM eduall_class
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [newClass, institute],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classExists || classExists.length === 0) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Turma ${newClass} não encontrada`);
      return res.status(404).json({
        success: false,
        msg: "Turma selecionada não existe ou não pertence ao seu instituto!",
        code: "INVALID_CLASS"
      });
    }
    console.log(`${C.green}✓${C.reset} Turma validada: ${classExists[0].ed_class_title}\n`);

    // ─────────────────────────────────────────────────────────
    // 3. VALIDAR QUE SERVIÇO EXISTE E PERTENCE AO INSTITUTO
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Validando serviço...${C.reset}`);
    const serviceExists = await ExecuteQuery(
      res,
      `SELECT ed_service_id, ed_service_title
       FROM eduall_services
       WHERE ed_service_id = ? AND ed_service_institute_code = ?`,
      [service, institute],
      true,
      { db: "eduall_services", type: "select", data: req }
    );

    if (!serviceExists || serviceExists.length === 0) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Serviço ${service} não encontrado`);
      return res.status(404).json({
        success: false,
        msg: "Serviço selecionado não existe ou não pertence ao seu instituto!",
        code: "INVALID_SERVICE"
      });
    }
    console.log(`${C.green}✓${C.reset} Serviço validado: ${serviceExists[0].ed_service_name}\n`);

    // ─────────────────────────────────────────────────────────
    // 4. BUSCAR ALUNO (POR CÓDIGO)
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Buscando aluno...${C.reset}`);
    const studentQuery = `
      SELECT ed_student_id, ed_student_name, ed_student_class
      FROM eduall_students
      WHERE ed_student_code = ?
        AND ed_student_institute_code = ?
        AND ed_student_deleted = 0
      LIMIT 1
    `;

    const studentRows = await ExecuteQuery(
      res,
      studentQuery,
      [studentCode, institute],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (!studentRows || studentRows.length === 0) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Aluno com código ${studentCode} não encontrado`);
      return res.status(404).json({
        success: false,
        msg: "Aluno não encontrado no seu instituto!",
        code: "STUDENT_NOT_FOUND"
      });
    }

    const student = studentRows[0];
    const studentId = student.ed_student_id;
    const oldClass = student.ed_student_class;

    console.log(`${C.green}✓${C.reset} Aluno encontrado: ${student.ed_student_name} (ID: ${studentId})\n`);

    // ─────────────────────────────────────────────────────────
    // 5. VERIFICAR SE JÁ ESTÁ MATRICULADO
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Verificando matrículas existentes...${C.reset}`);
    const enrollmentExists = await ExecuteQuery(
      res,
      `SELECT ed_student_enrollment_id FROM eduall_student_enrollment
       WHERE ed_student_enrollment_deleted = 0
         AND ed_student_enrollment_studentcode = ?
         AND ed_enrollment_institute_code = ?`,
      [studentCode, institute],
      true,
      { db: "eduall_student_enrollment", type: "select", data: req }
    );

    if (enrollmentExists && enrollmentExists.length > 0) {
      console.warn(`${C.yellow}⚠ AVISO ${C.reset} Aluno já está matriculado`);
      return res.status(200).json({
        success: false,
        msg: "Este aluno já possui uma matrícula ativa!",
        code: "ALREADY_ENROLLED"
      });
    }
    console.log(`${C.green}✓${C.reset} Aluno não possui matrícula anterior\n`);

    // ─────────────────────────────────────────────────────────
    // 6. REGISTRAR MATRÍCULA NA TABELA eduall_student_enrollment
    // ─────────────────────────────────────────────────────────
    console.log(`${C.magenta}➕ Registrando matrícula...${C.reset}`);
    const insertQuery = `
      INSERT INTO eduall_student_enrollment
      (ed_student_enrollment_studentcode, ed_student_enrollment_service, 
       ed_student_enrollment_class, ed_enrollment_institute_code)
      VALUES (?, ?, ?, ?)
    `;

    const insertParams = [studentCode, service, newClass, institute];

    const insertResult = await ExecuteQuery(
      res,
      insertQuery,
      insertParams,
      false,
      { db: "eduall_student_enrollment", type: "insert", data: req }
    );

    console.log(`${C.green}✓${C.reset} Matrícula inserida na base de dados\n`);

    // ─────────────────────────────────────────────────────────
    // 7. RECUPERAR ID DA MATRÍCULA CRIADA
    // ─────────────────────────────────────────────────────────
    console.log(`${C.yellow}🔍 Recuperando ID da matrícula...${C.reset}`);
    const createdEnrollment = await ExecuteQuery(
      res,
      `SELECT ed_student_enrollment_id FROM eduall_student_enrollment
       WHERE ed_student_enrollment_studentcode = ?
         AND ed_enrollment_institute_code = ?
         AND ed_student_enrollment_deleted = 0
       ORDER BY ed_student_enrollment_id DESC
       LIMIT 1`,
      [studentCode, institute],
      true,
      { db: "eduall_student_enrollment", type: "select", data: req }
    );

    if (!createdEnrollment || createdEnrollment.length === 0) {
      console.error(`${C.bgRed} ✖ ERRO ${C.reset} Falha ao confirmar matrícula na BD`);
      return res.status(500).json({
        success: false,
        msg: "Erro: a matrícula não foi confirmada na base de dados!",
        code: "ENROLLMENT_NOT_CONFIRMED"
      });
    }

    const enrollmentId = createdEnrollment[0].ed_student_enrollment_id;
    console.log(`${C.green}✓${C.reset} ID da matrícula: ${enrollmentId}\n`);

    // ─────────────────────────────────────────────────────────
    // 8. PROCESSAR MUDANÇA DE TURMA (SE NECESSÁRIO)
    // ─────────────────────────────────────────────────────────
    console.log(`${C.magenta}🔄 Processando turma...${C.reset}`);

    let classChanged = false;

    if (oldClass && oldClass !== newClass) {
      classChanged = true;
      console.log(`   Aluno mudou de turma: ${oldClass} → ${newClass}`);

      // Buscar anos lectivos
      const oldYearResult = await ExecuteQuery(
        res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
        [oldClass],
        true
      );

      const newYearResult = await ExecuteQuery(
        res,
        `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ?`,
        [newClass],
        true
      );

      // Se anos diferentes, registar turma antiga
      if (
        oldYearResult && oldYearResult.length > 0 &&
        newYearResult && newYearResult.length > 0 &&
        oldYearResult[0].ed_class_year !== newYearResult[0].ed_class_year
      ) {
        console.log(`   Anos lectivos diferentes: ${oldYearResult[0].ed_class_year} → ${newYearResult[0].ed_class_year}`);

        await ExecuteQuery(
          res,
          `INSERT INTO eduall_student_old_classes
           (ed_student_old_class_student, ed_student_old_class)
           VALUES (?, ?)`,
          [studentId, oldClass],
          false
        );
        console.log(`   ✓ Turma antiga registrada`);
      }
    } else if (!oldClass) {
      console.log(`   Primeira matrícula do aluno (sem turma anterior)`);
    } else {
      console.log(`   Aluno mantém a mesma turma`);
    }

    // Atualizar turma actual do aluno
    await ExecuteQuery(
      res,
      `UPDATE eduall_students SET ed_student_class = ? WHERE ed_student_id = ?`,
      [newClass, studentId],
      false
    );
    await invalidateStudentCaches(institute);
    console.log(`${C.green}✓${C.reset} Turma do aluno atualizada\n`);

    // ─────────────────────────────────────────────────────────
    // 9. AUDITORIA
    // ─────────────────────────────────────────────────────────
    console.log(`${C.magenta}📋 Registrando auditoria...${C.reset}`);
    Promise.resolve(
      RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Matrículas",
        description: `Registrou matrícula para o estudante #${studentCode} – ${student.ed_student_name}`,
      })
    ).catch(err => console.error(`   ${C.red}⚠${C.reset} Erro ao registar auditoria: ${err.message}`));
    console.log(`${C.green}✓${C.reset} Auditoria registrada\n`);

    // ─────────────────────────────────────────────────────────
    // 10. IMPRIMIR CARTÃO DE CONFIRMAÇÃO
    // ─────────────────────────────────────────────────────────
    printEnrollmentCard({
      student,
      enrollmentId,
      service: serviceExists[0].ed_service_name,
      newClass: classExists[0].ed_class_title,
      oldClass,
      classChanged,
    }, C);

    // ─────────────────────────────────────────────────────────
    // 11. RESPONDER AO CLIENTE
    // ─────────────────────────────────────────────────────────
    console.log(`${C.green}${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.green}${C.bold}✔ MATRÍCULA EFETUADA COM SUCESSO${C.reset}`);
    console.log(`${C.green}${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

    return res.status(200).json({
      success: true,
      msg: "Matrícula registrada e turma do aluno atualizada com sucesso.",
      code: "SUCCESS",
      data: {
        enrollmentId: enrollmentId,
        studentId: studentId,
        studentCode: studentCode,
        studentName: student.ed_student_name,
        newClass: classExists[0].ed_class_title,
        classChanged: classChanged,
      }
    });

  } catch (error) {
    console.error(`\n${C.bgRed} ✖ ERRO ${C.reset} ${C.red}${error.message}${C.reset}`);
    console.error(error.stack);

    return res.status(500).json({
      success: false,
      msg: "Erro ao efetuar matrícula!",
      error: error.message,
      code: "INTERNAL_ERROR"
    });
  }
};

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

/**
 * Imprime cartão colorido de confirmação de matrícula
 */
function printEnrollmentCard({ student, enrollmentId, service, newClass, oldClass, classChanged }, C) {
  console.log(`\n${C.cyan}┌───────────────────────────────────────────────────────────┐${C.reset}`);
  console.log(`${C.cyan}│${C.reset} ${C.bold}${C.white}👤 ${student.ed_student_name}${C.reset}`);
  console.log(`${C.cyan}│${C.reset} ${C.dim}ID:${C.reset} ${C.yellow}${student.ed_student_id}${C.reset}   ${C.bgGreen} ✔ CONFIRMADA ${C.reset}`);
  console.log(`${C.cyan}├───────────────────────────────────────────────────────────┤${C.reset}`);
  console.log(
    `${C.cyan}│${C.reset} ${C.magenta}🏫 Turma:${C.reset} ${
      classChanged
        ? `${C.dim}${oldClass ?? "—"}${C.reset} ${C.blue}→${C.reset} ${C.green}${newClass}${C.reset}`
        : `${C.green}${newClass}${C.reset}`
    }`
  );
  console.log(`${C.cyan}│${C.reset} ${C.magenta}📄 Serviço:${C.reset} ${C.white}${service}${C.reset}`);
  console.log(`${C.cyan}│${C.reset} ${C.magenta}🆔 ID Matrícula:${C.reset} ${C.green}${enrollmentId}${C.reset}`);
  console.log(`${C.cyan}└───────────────────────────────────────────────────────────┘${C.reset}`);
}
 









const StudentEnrollmentDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_student_enrollment SET ed_student_enrollment_deleted = 1 WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_enrollment", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Matrículas",
            description: `Eliminou a matrícula com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Matrícula excluída com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao excluir matrícula!", error: error.message });
    }
};

const StudentEnrollmentUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { enrollment_service, enrollment_class } = req.body;
        const query = `UPDATE eduall_student_enrollment SET ed_student_enrollment_service = ? WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [enrollment_service, ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_enrollment", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Matrículas",
            description: `Atualizou a matrícula com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Matrícula atualizada com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao atualizar matrícula!", error: error.message });
    }
};

module.exports = {
    GetStudentEnrollments,
    GetSingleStudentEnrollment,
    CheckExistentStudentEnrollment,
    RegisterStudentEnrollment,
    StudentEnrollmentDelete,
    StudentEnrollmentUpdate
};
 