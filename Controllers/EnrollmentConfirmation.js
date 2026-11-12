// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
// ─────────────────────────────────────────────────────────────────────────────
//  EnrollmentConfirmations.js  (Backend Controller – COM CACHE INTEGRADO)
//  ✅ TPA + Borderô agora funcionam corretamente
//  ✅ Propinas integradas
//  ✅ Saldo do aluno suportado
//  ✅ CACHE SYSTEM INTEGRADO (padrão AcademicYear.js)
// ─────────────────────────────────────────────────────────────────────────────

const ExecuteQuery            = require("../Functions/ExecuteQuery");
const { invalidateStudentCaches } = require("../Functions/StudentCache");
const { RegisterAuditAction } = require("./Auditory");
const axios                   = require("axios");
const { getSingleStudentByInstitute } = require("./Students");
const { printInvoiceAndRegistry }  = require("./logger");
const { VENDUS_CreateInvoiceCodeAndDoc, getPaymentMethods, resolvePaymentMethod } = require("../Functions/VENDUS");

// ════════════════════════════════════════════════════════════════════════════════
// 🔥 FUNÇÃO AUXILIAR: VERIFICAR SE MÉTODO REQUER BORDERÔ
// Inclui: Transfer, Transferência, Deposito, TPA, Cheque, etc.
// ════════════════════════════════════════════════════════════════════════════════

function requiresBordereau(methodName) {
  const name = String(methodName || "").toLowerCase().trim();
  
  const requiresIt = [
    "transfer",        // English
    "transferência",   // Portuguese
    "deposito",        // Deposit (Portuguese)
    "deposit",         // English
    "tpa",             // ✅ Mobile payment (Angola/Africa)
    "referência",      // Reference number
    "reference",       // English
    "bordereau",       // Bordereau itself
    "cheque",          // Cheque
    "mbway",           // MBWay (Portugal)
  ];

  return requiresIt.some(req => name.includes(req));
}

// ════════════════════════════════════════════════════════════════════════════════
// ── GET ENROLLMENT CONFIRMATIONS (Lista completa)
// ════════════════════════════════════════════════════════════════════════════════

const GetEnrollmentConfirmations = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_enrollment_confirmations
      LEFT JOIN eduall_students      ON eduall_enrollment_confirmations.ed_enrollment_confirmation_student = eduall_students.ed_student_id
      LEFT JOIN eduall_class         ON eduall_class.ed_class_id            = eduall_enrollment_confirmations.ed_enrollment_confirmation_class
      LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_services      ON eduall_services.ed_service_id       = eduall_enrollment_confirmations.ed_enrollment_confirmation_service
      LEFT JOIN eduall_coins         ON eduall_coins.ed_coin_institute_code = ?
      WHERE eduall_enrollment_confirmations.ed_enrollment_confirmation_deleted = 0
        AND eduall_enrollment_confirmations.ed_enrollment_confirmation_institute_code = ?
      ORDER BY eduall_students.ed_student_name ASC
    `;
    const PARAMS = [instituteCode, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_confirmations", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar confirmações de matrícula!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE ENROLLMENT CONFIRMATION
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleEnrollmentConfirmation = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_enrollment_confirmations
      LEFT JOIN eduall_students      ON eduall_enrollment_confirmations.ed_enrollment_confirmation_student = eduall_students.ed_student_id
      LEFT JOIN eduall_class         ON eduall_class.ed_class_id            = eduall_enrollment_confirmations.ed_enrollment_confirmation_class
      LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_services      ON eduall_services.ed_service_id       = eduall_enrollment_confirmations.ed_enrollment_confirmation_service
      WHERE eduall_enrollment_confirmations.ed_enrollment_confirmation_deleted = 0
        AND eduall_enrollment_confirmations.ed_enrollment_confirmation_id = ?
        AND eduall_enrollment_confirmations.ed_enrollment_confirmation_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_confirmations", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar a confirmação de matrícula!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE ENROLLED CONFIRMATION (Dados completos)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleEnrolledConfirmation = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    console.log("ID = ", ID);

    const query = `
      SELECT
        ec.*,
        s.ed_student_id, s.ed_student_name, s.ed_student_code, s.ed_student_phone, s.ed_student_class,
        c.ed_class_id, c.ed_class_title, c.ed_class_year, c.ed_class_room, c.ed_class_course, c.ed_class_academic_level,
        ay.ed_academic_year_title,
        srv.ed_service_id, srv.ed_service_name, srv.ed_service_price,
        cr.ed_classroom_title,
        al.ed_academic_level_title,
        co.ed_course_title
      FROM eduall_enrollment_confirmations ec
      LEFT JOIN eduall_students       s   ON ec.ed_enrollment_confirmation_student = s.ed_student_id
      LEFT JOIN eduall_class          c   ON c.ed_class_id             = ec.ed_enrollment_confirmation_class
      LEFT JOIN eduall_academic_year  ay  ON ay.ed_academic_year_id    = c.ed_class_year
      LEFT JOIN eduall_services       srv ON srv.ed_service_id         = ec.ed_enrollment_confirmation_service
      LEFT JOIN eduall_classrooms     cr  ON cr.ed_classroom_id        = c.ed_class_room
      LEFT JOIN eduall_academic_level al  ON al.ed_academic_level_id   = c.ed_class_academic_level
      LEFT JOIN eduall_courses        co  ON co.ed_course_id           = c.ed_class_course
      WHERE ec.ed_enrollment_confirmation_id = ?
        AND ec.ed_enrollment_confirmation_institute_code = ?
        AND ec.ed_enrollment_confirmation_deleted = 0
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_confirmations", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar a confirmação de matrícula do aluno!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── GET SINGLE ENROLLED CONFIRMATION BY CODE
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleEnrolledConfirmationByCode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_enrollment_confirmations
      LEFT JOIN eduall_students       ON eduall_enrollment_confirmations.ed_enrollment_confirmation_student = eduall_students.ed_student_id
      LEFT JOIN eduall_class          ON eduall_class.ed_class_id              = eduall_enrollment_confirmations.ed_enrollment_confirmation_class
      LEFT JOIN eduall_academic_year  ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_services       ON eduall_services.ed_service_id         = eduall_enrollment_confirmations.ed_enrollment_confirmation_service
      LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_courses        ON eduall_courses.ed_course_id           = eduall_class.ed_class_course
      LEFT JOIN eduall_classrooms     ON eduall_classrooms.ed_classroom_id     = eduall_class.ed_class_room
      WHERE ed_enrollment_confirmation_code = ?
        AND ed_enrollment_confirmation_institute_code = ?
        AND ed_enrollment_confirmation_deleted = 0
    `;
    const PARAMS = [CODE, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_enrollment_confirmations", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar a confirmação de matrícula por código!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Obter dados do operador
// ════════════════════════════════════════════════════════════════════════════════

async function getOperatorData(res, userId) {
  if (!userId) return null;

  try {
    const query = `
      SELECT ed_user_account_id, ed_user_account_name
      FROM eduall_user_accounts
      WHERE ed_user_account_id = ?
        AND ed_user_account_deleted = 0
      LIMIT 1
    `;

    const [operator] = await ExecuteQuery(res, query, [userId], true, {
      db: "eduall_user_accounts",
      type: "select",
      data: { operatorLookup: true }
    });

    if (operator) {
      return {
        id: operator.ed_user_account_id,
        name: operator.ed_user_account_name || "Operador Desconhecido"
      };
    }

    return null;
  } catch (error) {
    console.warn("Erro ao buscar dados do operador:", error.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Debitar Borderô (com validação dentro de transacção)
// ════════════════════════════════════════════════════════════════════════════════

async function debitBordereau(res, { bordereauNumber, instituteCode, amountToDebit, studentId, invoiceCode, operatorName, operatorId, paymentMethodName }) {
  if (!bordereauNumber || !amountToDebit || amountToDebit <= 0) return null;

  try {
    await ExecuteQuery(
      res,
      `INSERT IGNORE INTO eduall_bordereau_control
         (ed_bordereau_number, ed_bordereau_original_value, ed_bordereau_used_value, ed_bordereau_institute_code)
       VALUES (?, 0, 0, ?)`,
      [bordereauNumber, instituteCode], false
    );

    await ExecuteQuery(res, "START TRANSACTION", [], false);

    const [row] = await ExecuteQuery(
      res,
      `SELECT ed_bordereau_original_value, ed_bordereau_used_value
       FROM eduall_bordereau_control
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ? FOR UPDATE`,
      [bordereauNumber, instituteCode], true
    );

    const available = Math.max(0, parseFloat(row?.ed_bordereau_original_value ?? 0) - parseFloat(row?.ed_bordereau_used_value ?? 0));

    if (amountToDebit > available + 0.001) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      throw new Error(`Saldo insuficiente: ${available.toFixed(2)}`);
    }

    const usedAfter = Number((parseFloat(row?.ed_bordereau_used_value ?? 0) + amountToDebit).toFixed(2));

    await ExecuteQuery(
      res,
      `UPDATE eduall_bordereau_control
       SET ed_bordereau_used_value = ?
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?`,
      [usedAfter, bordereauNumber, instituteCode], false
    );

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_bordereau_usage_logs
         (ed_bl_bordereau_number, ed_bl_institute_code, ed_bl_student_id, ed_bl_invoice_code, ed_bl_amount_used, ed_bl_balance_before, ed_bl_balance_after, ed_bl_operator, ed_bl_operator_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [bordereauNumber, instituteCode, studentId || null, invoiceCode || null, amountToDebit, available, Math.max(0, available - amountToDebit), operatorName || null, operatorId || null],
      false
    );

    await ExecuteQuery(res, "COMMIT", [], false);

    return { balanceBefore: available, balanceAfter: Math.max(0, available - amountToDebit) };
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// 🔥 MAIN: REGISTAR CONFIRMAÇÃO DE MATRÍCULA
// ════════════════════════════════════════════════════════════════════════════════

const RegisterEnrollmentConfirmation = async (req, res) => {
  try {
    // ════════════════════════════════════════════════════════════════════════
    // SETUP INICIAL
    // ════════════════════════════════════════════════════════════════════════
    const students    = req.body.enrollment_students || [req.body.enrollment_student];
    const classId     = req.body.enrollment_class;
    const service     = req.body.enrollment_service;
    const institute   = req.session.user.eduall_user_session_curentinstitute;
    const docsPayload = Array.isArray(req.body.enrollment_docs) ? req.body.enrollment_docs : [];

    const paymentMethodIndex = req.body.paymentMethod !== undefined ? Number(req.body.paymentMethod) : 0;
    const borderereauNumber    = (req.body.bordereauNumber || "").trim();
    const paymentBank        = (req.body.paymentBank || "").trim();
    const paymentPlace       = (req.body.paymentPlace || "").trim();
    const bordereauAmountUsed = Math.max(0, parseFloat(req.body.bordereauAmountUsed) || 0);
    const balanceUsed        = Math.max(0, parseFloat(req.body.balanceUsed) || 0);

    // 🔥 Buscar métodos de pagamento da BD
    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods || paymentMethods.length === 0) {
      console.error("❌ ERRO: Nenhum método de pagamento configurado!");
      return res.status(400).json({
        success: false,
        msg: "Nenhum método de pagamento configurado no sistema!",
        error: "NO_PAYMENT_METHODS",
        details: "Contacte o administrador para configurar os métodos de pagamento."
      });
    }

    // 🔥 Resolver o método selecionado
    const selectedPaymentMethod = resolvePaymentMethod(paymentMethodIndex, paymentMethods);
    if (!selectedPaymentMethod) {
      console.error(`❌ ERRO: Método de pagamento inválido: ${paymentMethodIndex}`);
      return res.status(400).json({
        success: false,
        msg: "Método de pagamento inválido!",
        error: "INVALID_PAYMENT_METHOD",
        details: `Selecione um método de pagamento válido entre os disponíveis.`
      });
    }

    console.log(` Método de pagamento selecionado: ${selectedPaymentMethod.name} (ID: ${selectedPaymentMethod.vendus_id})`);

    // 🔥 Suportar serviço único OU array
    let services = req.body.services || [];
    if (service && (!Array.isArray(services) || services.length === 0)) {
      services = [{
        code: service,
        amount: 1,
        price: 0,
        discount: 0
      }];
      console.log(`Convertendo serviço único (${service}) em array`);
    }

    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    // ════════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 1: SERVIÇOS SÃO OBRIGATÓRIOS
    // ════════════════════════════════════════════════════════════════════════
    if (!Array.isArray(services) || services.length === 0) {
      console.error("❌ ERRO: Tentativa de registar sem serviços/fatura!");
      return res.status(400).json({
        success: false,
        msg: "Serviço é obrigatório! Não é possível registar confirmação sem emitir fatura.",
        error: "MISSING_SERVICE",
        details: "Selecione um serviço antes de confirmar a matrícula."
      });
    }

    console.log(" Validação 1 passou: Serviços obrigatórios presentes");

    // ════════════════════════════════════════════════════════════════════════
    // ✅ VALIDAÇÃO 2 CORRIGIDA: USAR requiresBordereau (SUPORTA TPA!)
    // ════════════════════════════════════════════════════════════════════════
    const needsBordereau = requiresBordereau(selectedPaymentMethod.name);

    if (needsBordereau && !borderereauNumber) {
      console.error("❌ ERRO: Nº de borderô obrigatório para este método!");
      return res.status(400).json({
        success: false,
        msg: "Nº de borderô/referência é obrigatório para este método de pagamento!",
        error: "MISSING_BORDEREAU",
        details: `O método "${selectedPaymentMethod.name}" requer número de borderô/referência.`
      });
    }

    console.log(` Validação 2 passou: Método de pagamento válido (${selectedPaymentMethod.name})`);

    // ════════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 3: ALUNOS
    // ════════════════════════════════════════════════════════════════════════
    if (!students || students.length === 0)
      return res.status(400).json({
        success: false,
        msg: "Nenhum estudante selecionado!"
      });

    const studentRows = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_code, ed_student_class, 
              ed_student_identityCard, ed_student_address, ed_student_email
       FROM eduall_students
       WHERE ed_student_deleted = 0
         AND ed_student_institute_code = ?
         AND ed_student_id IN (${students.map(() => "?").join(",")})`,
      [institute, ...students],
      true
    );

    if (studentRows.length !== students.length)
      return res.status(404).json({
        success: false,
        msg: "Um ou mais alunos não encontrados!"
      });

    const alreadyConfirmed = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_code
       FROM eduall_students
       WHERE ed_student_deleted = 0
         AND ed_student_institute_code = ?
         AND ed_student_enrolled >= 2
         AND ed_student_id IN (${students.map(() => "?").join(",")})`,
      [institute, ...students],
      true
    );

    const toConfirm = studentRows.filter(
      row => !alreadyConfirmed.some(ac => ac.ed_student_id === row.ed_student_id)
    );

    if (toConfirm.length === 0)
      return res.status(409).json({
        success: false,
        msg: `Todos os ${alreadyConfirmed.length} estudante(s) já estão confirmados!`,
        already_confirmed: alreadyConfirmed.map(s => ({
          id: s.ed_student_id,
          code: s.ed_student_code,
          name: s.ed_student_name
        })),
      });

    console.log(` Validação 3 passou: ${toConfirm.length} estudante(s) para confirmar`);

    // ════════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 4: PRÉ-VALIDAÇÃO DO SALDO DO BORDERÔ
    // ════════════════════════════════════════════════════════════════════════
    if (borderereauNumber && bordereauAmountUsed > 0) {
      const [bcRow] = await ExecuteQuery(res,
        `SELECT ed_bordereau_original_value, ed_bordereau_used_value
         FROM eduall_bordereau_control
         WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?
           AND COALESCE(ed_bordereau_deleted,0) = 0
         LIMIT 1`,
        [borderereauNumber, institute], true
      );
      if (bcRow) {
        const available = Math.max(0,
          parseFloat(bcRow.ed_bordereau_original_value) - parseFloat(bcRow.ed_bordereau_used_value)
        );
        if (bordereauAmountUsed > available + 0.001) {
          return res.status(422).json({
            success: false,
            msg: `Saldo insuficiente no borderô ${borderereauNumber}. Disponível: ${available.toFixed(2)}. Tentou usar: ${bordereauAmountUsed.toFixed(2)}.`,
            bordereauAvailable: available,
            requested: bordereauAmountUsed,
          });
        }
      }
    }

    console.log(" Validação 4 passou: Borderô validado (se aplicável)");

    // ════════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 5: BUSCAR PREÇO DO SERVIÇO
    // ════════════════════════════════════════════════════════════════════════

    console.log("🔍 Processando serviços...");

    for (let i = 0; i < services.length; i++) {
      const s = services[i];

      if (!s.price || s.price === 0) {
        try {
          const serviceCode = s.code;
          const isNumeric = /^\d+$/.test(String(serviceCode));

          const serviceSql = `
            SELECT ed_service_id, ed_service_title, ed_service_price
            FROM eduall_services
            WHERE COALESCE(ed_service_deleted, 0) = 0
              AND ed_service_institute_code = ?
              AND ${isNumeric ? "ed_service_id = ?" : "(ed_service_code = ? OR ed_service_title = ?)"}
            LIMIT 1
          `;

          const params = isNumeric ? [institute, serviceCode] : [institute, serviceCode, serviceCode];
          const [serviceRow] = await ExecuteQuery(res, serviceSql, params, true);

          if (serviceRow) {
            services[i].price = serviceRow.ed_service_price || s.price || 0;
            services[i].service_id = serviceRow.ed_service_id;
            services[i].service_title = serviceRow.ed_service_title;
            console.log(`    Serviço encontrado: ${serviceRow.ed_service_title} - ${serviceRow.ed_service_price} AOA`);
          } else {
            console.warn(`   ⚠️  Serviço ${serviceCode} não encontrado`);
          }
        } catch (err) {
          console.error(`   ❌ Erro ao buscar serviço:`, err.message);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 6: GERAR FATURAS ANTES DE REGISTAR
    // ════════════════════════════════════════════════════════════════════════

    console.log("📄 Iniciando geração de faturas...");

    const invoiceByStudent = {};
    const failedInvoices = [];

    const instSql = `SELECT ed_institute_name FROM eduall_institutes WHERE ed_institute_code=? LIMIT 1`;
    const [inst] = await ExecuteQuery(res, instSql, [institute], true);
    const instituteName = inst?.ed_institute_name || "";

    const classSql = `
      SELECT ed_class_title, ed_classroom_title, ed_course_title, ed_academic_year_title
      FROM eduall_class
      LEFT JOIN eduall_classrooms ON ed_classroom_id = ed_class_room AND COALESCE(ed_classroom_deleted,0)=0
      LEFT JOIN eduall_courses ON ed_course_id = ed_class_course AND COALESCE(ed_course_deleted,0)=0
      LEFT JOIN eduall_academic_year ON ed_academic_year_id = ed_class_year AND COALESCE(ed_academic_year_deleted,0)=0
      WHERE ed_class_id = ? AND COALESCE(ed_class_deleted,0)=0
      LIMIT 1
    `;
    const [classData] = await ExecuteQuery(res, classSql, [classId], true);

    for (const student of toConfirm) {
      const Items = [];

      for (const s of services) {
        Items.push({
          itemcode: `SV-${s.service_id || s.code}`,
          title: `Confirmação de Matrícula - ${s.service_title || s.code}`,
          price: Number(s.price) || 0,
          quantity: Number(s.amount) || 1,
          tax: false,
          discount: Number(s.discount) || 0,
          service_id: s.service_id || s.code,
          service_title: s.service_title || "Serviço"
        });
      }

      if (Items.length === 0) {
        failedInvoices.push({
          student: student.ed_student_name,
          reason: "Nenhum serviço válido encontrado"
        });
        console.error(`Nenhum serviço para ${student.ed_student_name}`);
        continue;
      }

      const customerfilterData = {
        name: student.ed_student_name || "",
        fiscal_id: student.ed_student_identityCard || "",
        address: student.ed_student_address || "",
        email: student.ed_student_email || ""
      };

      // ══════════════════════════════════════════════════════════════════════
      // OBSERVAÇÕES COM INFORMAÇÕES DE PAGAMENTO (MÉTODO CORRETO)
      // ══════════════════════════════════════════════════════════════════════
      const obsParts = [];
      obsParts.push(`Confirmação de Matrícula`);
      obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
      if (classData?.ed_class_title) obsParts.push(`Turma: ${classData.ed_class_title}`);
      if (classData?.ed_classroom_title) obsParts.push(`Sala: ${classData.ed_classroom_title}`);
      if (classData?.ed_course_title) obsParts.push(`Curso: ${classData.ed_course_title}`);
      if (classData?.ed_academic_year_title) obsParts.push(`Ano letivo: ${classData.ed_academic_year_title}`);
      if (instituteName) obsParts.push(`Instituição: ${instituteName}`);
      if (operator) obsParts.push(`Operador: ${operator.name}`);

      obsParts.push("---");
      obsParts.push(`Forma de pagamento: ${selectedPaymentMethod.name}`);

      if (borderereauNumber) {
        obsParts.push(`Nº Borderô/Referência: ${borderereauNumber}`);
        if (paymentBank) obsParts.push(`Banco: ${paymentBank}`);
        if (paymentPlace) obsParts.push(`Local: ${paymentPlace}`);
        if (bordereauAmountUsed > 0) {
          obsParts.push(`Valor do borderô aplicado: ${bordereauAmountUsed.toFixed(2)} AOA`);
        }
      } else if (balanceUsed > 0) {
        obsParts.push(`Saldo do aluno utilizado: ${balanceUsed.toFixed(2)} AOA`);
      }

      const obs = obsParts.join("\n");

      try {
        const invoiceData = await VENDUS_CreateInvoiceCodeAndDoc(
          req,
          customerfilterData,
          Items,
          req.body.enrollment_invoice_type || "01",
          obs
        );

        if (!invoiceData || !invoiceData.number) {
          failedInvoices.push({
            student: student.ed_student_name,
            reason: "Falha ao gerar fatura na VENDUS"
          });
          console.error(`   ❌ Fatura falhou para ${student.ed_student_name}:`, invoiceData);
          continue;
        }

        invoiceByStudent[student.ed_student_id] = invoiceData;
        console.log(`    Fatura criada: ${invoiceData.number} (${student.ed_student_name})`);

      } catch (invoiceError) {
        failedInvoices.push({
          student: student.ed_student_name,
          reason: `Erro ao gerar fatura: ${invoiceError.message}`
        });
        console.error(`   ❌ Erro ao criar fatura para ${student.ed_student_name}:`, invoiceError);
      }
    }

    if (failedInvoices.length > 0) {
      console.error("❌ OPERAÇÃO CANCELADA: Algumas faturas falharam!");

      return res.status(400).json({
        success: false,
        msg: "Operação cancelada! Não foi possível emitir fatura para todos os estudantes.",
        error: "INVOICE_GENERATION_FAILED",
        failedInvoices: failedInvoices,
        details: "Todos os alunos precisam de fatura emitida com sucesso antes de registar a confirmação."
      });
    }

    console.log(" TODAS AS FATURAS GERADAS COM SUCESSO! Registando no banco...");

    const oldClassInsert = [];

    for (const s of toConfirm) {
      if (s.ed_student_class !== classId) {
        oldClassInsert.push(`(${s.ed_student_id}, ${s.ed_student_class})`);
      }
    }

    await ExecuteQuery(res, "START TRANSACTION", [], false);

    try {
      const confirmValues = toConfirm
        .map(s => {
          const inv = invoiceByStudent[s.ed_student_id];
          return `(${s.ed_student_id}, ${classId}, ${service}, '${institute}', '${inv.number}', '${inv.id}', ${selectedPaymentMethod.vendus_id}, '${paymentBank || ""}', '${paymentPlace || ""}', '${borderereauNumber || ""}', ${bordereauAmountUsed}, ${balanceUsed})`;
        })
        .join(",");

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_enrollment_confirmations(
           ed_enrollment_confirmation_student,
           ed_enrollment_confirmation_class,
           ed_enrollment_confirmation_service,
           ed_enrollment_confirmation_institute_code,
           ed_enrollment_confirmation_invoice_code,
           ed_enrollment_confirmation_invoice_file,
           ed_enrollment_confirmation_payment_method_id,
           ed_enrollment_confirmation_payment_bank,
           ed_enrollment_confirmation_payment_place,
           ed_enrollment_confirmation_bordereau,
           ed_enrollment_confirmation_bordereau_amount,
           ed_enrollment_confirmation_balance_used
         ) VALUES ${confirmValues}`,
        [],
        false
      );

      if (oldClassInsert.length > 0) {
        await ExecuteQuery(
          res,
          `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class)
           VALUES ${oldClassInsert.join(",")}`,
          [],
          false
        );
      }

      // Marcar todos os alunos como confirmados e na turma, DENTRO da transação.
      // Antes, as atualizações corriam fora da transação e não marcavam enrolled=2,
      // o que permitia confirmações duplicadas.
      const studentPlaceholders = toConfirm.map(() => "?").join(",");
      await ExecuteQuery(
        res,
        `UPDATE eduall_students
            SET ed_student_class = ?, ed_student_enrolled = 2
          WHERE ed_student_institute_code = ?
            AND ed_student_id IN (${studentPlaceholders})`,
        [classId, institute, ...toConfirm.map((s) => s.ed_student_id)],
        false
      );

      // 🔥 Debitar saldo do aluno (dentro da transação)
      if (balanceUsed > 0) {
        try {
          await ExecuteQuery(res,
            `INSERT IGNORE INTO eduall_student_balance (sb_student_id, sb_institute_code, sb_balance, sb_currency)
             VALUES (?, ?, 0, 'AOA')`,
            [toConfirm[0].ed_student_id, institute], false
          );
          const [current] = await ExecuteQuery(res,
            `SELECT sb_balance, sb_currency FROM eduall_student_balance
             WHERE sb_student_id = ? AND sb_institute_code = ? FOR UPDATE`,
            [toConfirm[0].ed_student_id, institute], true
          );
          const balanceBefore = parseFloat(current?.sb_balance ?? 0);
          const currency      = current?.sb_currency || "AOA";

          if (balanceUsed > balanceBefore) {
            await ExecuteQuery(res, "ROLLBACK", [], false);
            return res.status(422).json({
              success: false,
              msg: `Saldo insuficiente. Saldo atual: ${balanceBefore} ${currency}. Tentou usar: ${balanceUsed} ${currency}.`,
              balance: balanceBefore, requested: balanceUsed,
            });
          }

          const balanceAfter = Number((balanceBefore - balanceUsed).toFixed(2));
          let deductDesc = `Confirmação de matrícula — Fatura ${invoiceByStudent[toConfirm[0].ed_student_id]?.number || "?"}. Saldo utilizado: ${balanceUsed.toFixed(2)} ${currency}.`;

          await ExecuteQuery(res,
            `UPDATE eduall_student_balance SET sb_balance = ?
             WHERE sb_student_id = ? AND sb_institute_code = ?`,
            [balanceAfter, toConfirm[0].ed_student_id, institute], false
          );

          await ExecuteQuery(res,
            `INSERT INTO eduall_student_balance_logs
               (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
                sb_log_amount, sb_log_balance_before, sb_log_balance_after,
                sb_log_description, sb_log_reference, sb_log_user_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [toConfirm[0].ed_student_id, institute, "deduct", "confirmacoes", balanceUsed, balanceBefore, balanceAfter, deductDesc, invoiceByStudent[toConfirm[0].ed_student_id]?.number || null, operatorId || null],
            false
          );
        } catch (balanceErr) {
          console.error("Erro ao debitar saldo (não crítico):", balanceErr?.message || balanceErr);
        }
      }

      await ExecuteQuery(res, "COMMIT", [], false);
      // A turma do aluno mudou: o dashboard/listas não podem ficar com cache velha.
      await invalidateStudentCaches(institute);

    } catch (txError) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      console.error("❌ Erro na transação:", txError);
      throw txError;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔥 DEBITAR BORDERÔ — APÓS COMMIT (na sua própria transacção)
    // ════════════════════════════════════════════════════════════════════════
    let bordereauResult = null;
    if (borderereauNumber && bordereauAmountUsed > 0) {
      try {
        bordereauResult = await debitBordereau(res, {
          bordereauNumber: borderereauNumber,
          instituteCode:   institute,
          amountToDebit:   bordereauAmountUsed,
          studentId:       toConfirm[0].ed_student_id,
          invoiceCode:     invoiceByStudent[toConfirm[0].ed_student_id]?.number || null,
          operatorName:    operator?.name || null,
          operatorId:      operatorId     || null,
          paymentMethodName: selectedPaymentMethod.name,
        });
        console.log(` Borderô ${borderereauNumber} debitado com sucesso: ${bordereauAmountUsed.toFixed(2)}`);
      } catch (bErr) {
        console.error("[debitBordereau] Erro após commit:", bErr.message);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // BUSCAR DADOS E RETORNAR RESPOSTA
    // ════════════════════════════════════════════════════════════════════════

    const fullRegistryData = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_enrollment_confirmations
       WHERE ed_enrollment_confirmation_deleted = 0
         AND ed_enrollment_confirmation_institute_code = ?
         AND ed_enrollment_confirmation_class = ?
         AND ed_enrollment_confirmation_student IN (${toConfirm.map(() => "?").join(",")})
       ORDER BY ed_enrollment_confirmation_id DESC
       LIMIT ${toConfirm.length}`,
      [institute, classId, ...toConfirm.map(s => s.ed_student_id)],
      true
    );

    // ════════════════════════════════════════════════════════════════════════
    // Impressão isolada em try/catch (não derruba a resposta de sucesso)
    // ════════════════════════════════════════════════════════════════════════
    fullRegistryData.forEach((registryRecord) => {
      const student = toConfirm.find(
        s => s.ed_student_id === registryRecord.ed_enrollment_confirmation_student
      );

      if (student) {
        try {
          const invoiceData = invoiceByStudent[student.ed_student_id];
          printInvoiceAndRegistry(
            student.ed_student_name,
            student.ed_student_code,
            invoiceData,
            registryRecord
          );
        } catch (printErr) {
          console.warn("⚠️  Aviso: Não foi possível imprimir documento automático", printErr?.message);
        }
      }
    });

    console.log(`✅ SUCESSO: ${toConfirm.length} confirmação(ões) de matrícula registada(s)!`);

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterEnrollmentConfirmation: ${toConfirm.length} registo(s) inserido(s)`);

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Confirmações de Matrícula",
      description: `Registou ${toConfirm.length} confirmação(ões) de matrícula (alunos: ${toConfirm.map(s => s.ed_student_code).join(", ")})`,
    });

    res.status(200).json({
      success: true,
      msg: `${toConfirm.length} confirmação(ões) de matrícula registada(s) com sucesso!`,
      data: fullRegistryData,
      already_confirmed: alreadyConfirmed.map(s => ({
        id: s.ed_student_id,
        code: s.ed_student_code,
        name: s.ed_student_name
      })),
      bordereau_result: bordereauResult || null,
    });

  } catch (error) {
    console.error("❌ ERRO CRÍTICO em RegisterEnrollmentConfirmation:", error);
    res.status(500).json({
      success: false,
      msg: "Erro ao registar confirmação de matrícula!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── DELETE ENROLLMENT CONFIRMATION
// ════════════════════════════════════════════════════════════════════════════════

const EnrollmentConfirmationDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `UPDATE eduall_enrollment_confirmations SET ed_enrollment_confirmation_deleted = 1 
                   WHERE ed_enrollment_confirmation_deleted = 0 
                   AND ed_enrollment_confirmation_id = ? 
                   AND ed_enrollment_confirmation_institute_code = ?`;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_enrollment_confirmations", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Confirmações de Matrícula",
      description: `Removeu a confirmação de matrícula de ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EnrollmentConfirmationDelete: registo ${ID} eliminado`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao deletar a confirmação de matrícula!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── UPDATE ENROLLMENT CONFIRMATION
// ════════════════════════════════════════════════════════════════════════════════

const EnrollmentConfirmationUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { enrollment_class, enrollment_student, enrollment_service } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      UPDATE eduall_enrollment_confirmations
      SET ed_enrollment_confirmation_class   = ?,
          ed_enrollment_confirmation_student = ?,
          ed_enrollment_confirmation_service = ?
      WHERE ed_enrollment_confirmation_deleted = 0
        AND ed_enrollment_confirmation_id = ?
    `;
    const confirmationUpdate = await ExecuteQuery(res, query, [enrollment_class, enrollment_student, enrollment_service, ID], false, {
      db: "eduall_enrollment_confirmations", type: "update", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Confirmações de Matrícula",
      description: `Atualizou a confirmação de matrícula de ID ${ID} para o aluno com o nº de matrícula #${enrollment_student} na turma ${enrollment_class}`,
    });

    const student = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?`,
      [enrollment_student, institute],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (student[0].ed_student_class !== enrollment_class) {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) VALUES (?, ?)`,
        [enrollment_student, student[0].ed_student_class],
        false,
        { db: "eduall_student_old_classes", type: "insert", data: req }
      );
      await ExecuteQuery(
        res,
        `UPDATE eduall_students SET ed_student_class = ?
         WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?`,
        [enrollment_class, enrollment_student, institute],
        false,
        { db: "eduall_students", type: "update", data: req }
      );
    }

    await invalidateStudentCaches(institute);

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EnrollmentConfirmationUpdate: registo ${ID} atualizado`);

    res.status(200).json(confirmationUpdate);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar a confirmação de matrícula!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── GET CONFIRMATION DOCS
// ════════════════════════════════════════════════════════════════════════════════

const GetConfirmationDocs = async (req, res) => {
  try {
    const { CONFIRMATION_ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_enrollment_confirmation_docs
       WHERE ed_conf_doc_deleted      = 0
         AND ed_conf_doc_confirmation = ?
         AND ed_conf_doc_institute    = ?
       ORDER BY ed_conf_doc_id ASC`,
      [CONFIRMATION_ID, institute],
      true,
      { db: "eduall_enrollment_confirmation_docs", type: "select", data: req }
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao buscar documentos!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── ADD CONFIRMATION DOC
// ════════════════════════════════════════════════════════════════════════════════

const AddConfirmationDoc = async (req, res) => {
  try {
    const { confirmation_id, doc_name, doc_status, doc_file, doc_file_name } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!confirmation_id || !doc_name)
      return res.status(400).json({ success: false, msg: "Dados insuficientes!" });

    if (doc_file && doc_file.length > 4 * 1024 * 1024)
      return res.status(400).json({ success: false, msg: "Ficheiro excede o tamanho máximo de 3 MB!" });

    if (doc_file) {
      const allowed = ["data:image/", "data:application/pdf"];
      if (!allowed.some(prefix => doc_file.startsWith(prefix)))
        return res.status(400).json({ success: false, msg: "Tipo de ficheiro não permitido! Apenas imagens ou PDF." });
    }

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_enrollment_confirmation_docs
       (ed_conf_doc_confirmation, ed_conf_doc_name, ed_conf_doc_status,
        ed_conf_doc_file, ed_conf_doc_file_name, ed_conf_doc_institute)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [confirmation_id, doc_name, doc_status ?? 0, doc_file || null, doc_file_name || null, institute],
      false,
      { db: "eduall_enrollment_confirmation_docs", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Documentos de Confirmação de Matrícula",
      description: `Adicionou documento "${doc_name}" à confirmação ID ${confirmation_id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AddConfirmationDoc: documento adicionado à confirmação ${confirmation_id}`);

    res.status(200).json({ success: true, msg: "Documento adicionado com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao adicionar documento!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── UPDATE CONFIRMATION DOC
// ════════════════════════════════════════════════════════════════════════════════

const UpdateConfirmationDoc = async (req, res) => {
  try {
    const { DOC_ID }  = req.params;
    const { doc_status, doc_name, doc_file, doc_file_name } = req.body;
    const institute   = req.session.user.eduall_user_session_curentinstitute;

    const fields = [];
    const params = [];

    if (doc_status !== undefined) { fields.push("ed_conf_doc_status = ?");    params.push(doc_status);    }
    if (doc_name)                 { fields.push("ed_conf_doc_name = ?");       params.push(doc_name);      }
    if (doc_file !== undefined)   { fields.push("ed_conf_doc_file = ?");       params.push(doc_file);      }
    if (doc_file_name)            { fields.push("ed_conf_doc_file_name = ?");  params.push(doc_file_name); }

    if (fields.length === 0)
      return res.status(400).json({ success: false, msg: "Nenhum campo para atualizar!" });

    params.push(DOC_ID, institute);

    await ExecuteQuery(
      res,
      `UPDATE eduall_enrollment_confirmation_docs
       SET ${fields.join(", ")}
       WHERE ed_conf_doc_id = ? AND ed_conf_doc_institute = ? AND ed_conf_doc_deleted = 0`,
      params,
      false,
      { db: "eduall_enrollment_confirmation_docs", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Documentos de Confirmação de Matrícula",
      description: `Atualizou documento ID ${DOC_ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateConfirmationDoc: documento ${DOC_ID} atualizado`);

    res.status(200).json({ success: true, msg: "Documento atualizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao atualizar documento!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── DELETE CONFIRMATION DOC
// ════════════════════════════════════════════════════════════════════════════════

const DeleteConfirmationDoc = async (req, res) => {
  try {
    const { DOC_ID } = req.params;
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    await ExecuteQuery(
      res,
      `UPDATE eduall_enrollment_confirmation_docs SET ed_conf_doc_deleted = 1
       WHERE ed_conf_doc_id = ? AND ed_conf_doc_institute = ?`,
      [DOC_ID, institute],
      false,
      { db: "eduall_enrollment_confirmation_docs", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Documentos de Confirmação de Matrícula",
      description: `Removeu documento ID ${DOC_ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteConfirmationDoc: documento ${DOC_ID} eliminado`);

    res.status(200).json({ success: true, msg: "Documento removido com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Erro ao remover documento!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// ── SMS SEND (sem cache)
// ════════════════════════════════════════════════════════════════════════════════

const SendSms = async (req, res) => {
  try {
    const { phone, message, student_id, student_ids } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!message || !message.trim())
      return res.status(400).json({ success: false, msg: "Mensagem não pode estar vazia!" });

    if (/(https?:\/\/[^\s]+)/gi.test(message))
      return res.status(400).json({ success: false, msg: "Não é permitido enviar mensagens com links!" });

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
      await _registerSentMsg(req, res, institute, 1, message, null);
      return res.status(400).json({ success: false, msg: "Créditos não encontrados!" });
    }

    const smsParts       = calculateSmsParts(message);
    const currentCredits = creditRows[0].ed_sms_credit_total * 1;

    let phones = [];

    if (phone) {
      phones = [phone.replace(/\s+/g, "")];
    } else if (student_id) {
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
      phones = sRows.map(r => r.ed_student_phone?.replace(/\s+/g, "")).filter(Boolean);
    } else {
      return res.status(400).json({ success: false, msg: "Destinatário não especificado!" });
    }

    if (phones.length === 0)
      return res.status(400).json({ success: false, msg: "Nenhum número de telefone válido encontrado!" });

    const totalParts = smsParts * phones.length;
    if (currentCredits < totalParts) {
      await _registerSentMsg(req, res, institute, 1, message, null);
      return res.status(400).json({
        success: false,
        msg: `Os seus créditos (${currentCredits}) não são suficientes para enviar para ${phones.length} número(s)!`,
      });
    }

    const results = { sent: 0, failed: 0, invalid: 0 };

    for (const num of phones) {
      const isValido = /^9\d{8}$/.test(num);
      if (!isValido) {
        results.invalid++;
        await _registerSentMsg(req, res, institute, 1, message, num);
        continue;
      }

      try {
        const { status } = await axios.post(
          "https://www.telcosms.co.ao/send_message",
          {
            message: {
              api_key_app:  "prdd0cf231ad82fcfa9c4c8654742",
              phone_number: num,
              message_body: message,
            },
          },
          { headers: { "Content-Type": "application/json" } }
        );

        if (status === 200 || status === 201) {
          await _registerSentMsg(req, res, institute, 0, message, num);
          await ExecuteQuery(
            res,
            `UPDATE eduall_sms_credits
             SET ed_sms_credit_total = ed_sms_credit_total - ?
             WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`,
            [smsParts, institute, smsParts]
          );
          results.sent++;
        } else {
          await _registerSentMsg(req, res, institute, 1, message, num);
          results.failed++;
        }
      } catch {
        await _registerSentMsg(req, res, institute, 1, message, num);
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

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Register sent SMS
// ════════════════════════════════════════════════════════════════════════════════

const _registerSentMsg = async (req, res, institute, status, message, phone) => {
  try {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_sms_sent_messages
       (ed_sms_message_institute, ed_sms_message_status, ed_sms_message_body, ed_sms_message_phone)
       VALUES (?, ?, ?, ?)`,
      [institute, status, message, phone || null],
      false,
      { db: "eduall_sms_sent_messages", type: "insert", data: req }
    );
  } catch (err) {
    console.error("Erro ao registar mensagem enviada:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetEnrollmentConfirmations,
  GetSingleEnrollmentConfirmation,
  GetSingleEnrolledConfirmation,
  GetSingleEnrolledConfirmationByCode,
  RegisterEnrollmentConfirmation,
  EnrollmentConfirmationDelete,
  EnrollmentConfirmationUpdate,

  GetConfirmationDocs,
  AddConfirmationDoc,
  UpdateConfirmationDoc,
  DeleteConfirmationDoc,

  SendSms,
  
  // Helper para debug/testes
  requiresBordereau,
};