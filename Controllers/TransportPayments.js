const ExecuteQuery = require("../Functions/ExecuteQuery");
const { FACTPLUS_decodificarMesEAno } = require("../Functions/FACTPLUS_HELPERS");
const { VENDUS_CreateInvoiceCodeAndDoc } = require("../Functions/VENDUS");
const { RegisterAuditAction } = require("./Auditory");
const { getSingleStudentByInstitute } = require("./Students");

const PAYMENT_TYPE_BALANCE = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Helper — operador
// ─────────────────────────────────────────────────────────────────────────────

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
      db: "eduall_user_accounts", type: "select", data: { operatorLookup: true }
    });
    if (operator) {
      return {
        id:   operator.ed_user_account_id,
        name: operator.ed_user_account_name || "Operador Desconhecido",
      };
    }
    return null;
  } catch (error) {
    console.warn("Erro ao buscar dados do operador:", error.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subquery reutilizável — extras por invoice_code
// COLLATE aplicado para evitar "Illegal mix of collations"
// ─────────────────────────────────────────────────────────────────────────────
const EXTRAS_SUBQUERY = (invoiceCodeCol, instituteCol) => `
  (
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'id',          tai.ed_transport_additional_id,
        'description', tai.ed_transport_additional_description,
        'amount',      tai.ed_transport_additional_amount,
        'is_fine',     tai.ed_transport_additional_is_fine,
        'created_at',  tai.ed_transport_additional_registerDate
      )
    )
    FROM eduall_transport_additional_items tai
    WHERE CONVERT(tai.ed_transport_additional_invoice_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(${invoiceCodeCol} USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND CONVERT(tai.ed_transport_additional_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
        = CONVERT(${instituteCol} USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND COALESCE(tai.ed_transport_additional_deleted, 0) = 0
  ) AS extras
`;
 

// ════════════════════════════════════════════════════════════════════════════════
// GET — Listagem geral
// ════════════════════════════════════════════════════════════════════════════════

const GetTransportPayments = async (req, res) => {
  try {
    const institute  = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);

    // FIX: ed_transport_payment_student guarda agora o ed_student_id directamente.
    // Os registos antigos guardavam o ed_transport_passenger_id.
    // COALESCE garante que ambos funcionam:
    //   - Tenta primeiro o JOIN directo aluno → ed_transport_payment_student (novos)
    //   - Fallback via passageiro → ed_transport_passenger_code (antigos)
    const query = `
      SELECT
        etp.*,
        etp2.ed_transport_passenger_id,
        etp2.ed_transport_passenger_code,
        COALESCE(st_direct.ed_student_id,   st_via.ed_student_id)   AS ed_student_id,
        COALESCE(st_direct.ed_student_name, st_via.ed_student_name) AS ed_student_name,
        COALESCE(st_direct.ed_student_code, st_via.ed_student_code) AS ed_student_code,
        s.ed_service_id,
        s.ed_service_title,
        c.ed_coin_code,
        ua.ed_user_account_name AS operator_name,
        ua.ed_user_account_id   AS operator_id,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_transport_passengers etp2
        ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st_via
        ON st_via.ed_student_id = etp2.ed_transport_passenger_code
      LEFT JOIN eduall_students st_direct
        ON st_direct.ed_student_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON c.ed_coin_id = s.ed_service_coin
      LEFT JOIN eduall_user_accounts ua
        ON ua.ed_user_account_id = ?
       AND ua.ed_user_account_deleted = 0
      WHERE etp.ed_transport_payment_deleted = 0
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      ORDER BY etp.ed_transport_payment_registerDate DESC
    `;

    const rows = await ExecuteQuery(res, query, [operatorId, institute], true, {
      db: "eduall_transport_payments", type: "select", data: req,
    });

    const enrichedRows = rows.map(row => ({
      ...row,
      operator:    operator?.name || null,
      operator_id: operator?.id   || null,
    }));

    res.status(200).json(enrichedRows);
  } catch (err) {
    console.error("GetTransportPayments erro:", err);
    res.status(500).json({ success: false, msg: "Não foi possível carregar os pagamentos." });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Por código de fatura (invoice_code)
// ════════════════════════════════════════════════════════════════════════════════

const GetTransportPaymentsByInvoiceCode = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        etp.*,
        etp2.ed_transport_passenger_id,
        etp2.ed_transport_passenger_code,
        COALESCE(st_direct.ed_student_id,   st_via.ed_student_id)   AS ed_student_id,
        COALESCE(st_direct.ed_student_name, st_via.ed_student_name) AS ed_student_name,
        COALESCE(st_direct.ed_student_code, st_via.ed_student_code) AS ed_student_code,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_transport_passengers etp2
        ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st_via
        ON st_via.ed_student_id = etp2.ed_transport_passenger_code
      LEFT JOIN eduall_students st_direct
        ON st_direct.ed_student_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON c.ed_coin_id = s.ed_service_coin
      WHERE etp.ed_transport_payment_deleted = 0
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND CONVERT(etp.ed_transport_payment_invoiceCode USING utf8mb4) COLLATE utf8mb4_unicode_ci = (
          SELECT CONVERT(ed_transport_payment_invoiceCode USING utf8mb4) COLLATE utf8mb4_unicode_ci
          FROM eduall_transport_payments
          WHERE ed_transport_payment_id = ?
            AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          LIMIT 1
        )
    `;

    const rows = await ExecuteQuery(res, query, [institute, ID, institute], true, {
      db: "eduall_transport_payments", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    console.error("GetTransportPaymentsByInvoiceCode erro:", err);
    res.status(500).json({ success: false, msg: "Não foi possível carregar os dados da fatura." });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Pagamento singular
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleTransportPayment = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        etp.*,
        etp2.ed_transport_passenger_id,
        etp2.ed_transport_passenger_code,
        COALESCE(st_direct.ed_student_name, st_via.ed_student_name) AS ed_student_name,
        COALESCE(st_direct.ed_student_code, st_via.ed_student_code) AS ed_student_code,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_transport_passengers etp2
        ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st_via
        ON st_via.ed_student_id = etp2.ed_transport_passenger_code
      LEFT JOIN eduall_students st_direct
        ON st_direct.ed_student_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON c.ed_coin_id = s.ed_service_coin
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_id = ?
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(res, query, [ID, institute], true, {
      db: "eduall_transport_payments", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    console.error("GetSingleTransportPayment erro:", err);
    res.status(500).json({ success: false, msg: "Não foi possível carregar o pagamento." });
  }
};


// ════════════════════════════════════════════════════════════════════════════════
// GET — Mês pago (verificação de duplicata)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleTransportPaidMonth = async (req, res) => {
  try {
    const { MONTH, STUDENTCODE, YEAR } = req.params;

    const query = `
      SELECT
        etp.*,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON c.ed_coin_id = s.ed_service_coin
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_month = ?
        AND etp.ed_transport_payment_student = ?
        AND etp.ed_transport_payment_academic_year = ?
    `;

    const rows = await ExecuteQuery(res, query, [MONTH, STUDENTCODE, YEAR], true, {
      db: "eduall_transport_payments", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Pagamento singular de um aluno (por ID do pagamento)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleStudentTransportPayment = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        etp.*,
        etp2.ed_transport_passenger_id,
        etp2.ed_transport_passenger_code,
        st.ed_student_name,
        st.ed_student_code,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_transport_passengers etp2
        ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st
        ON st.ed_student_id = etp2.ed_transport_passenger_code
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON c.ed_coin_id = s.ed_service_coin
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_id = ?
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
    `;

    const rows = await ExecuteQuery(res, query, [ID, institute], true, {
      db: "eduall_transport_payments", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Todos os pagamentos de um passageiro num ano letivo (por passenger_id)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleStudentTransportPayments = async (req, res) => {
  try {
    const { ACADEMICYEAR, PASSENGERCODE } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        etp.*,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON CONVERT(c.ed_coin_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_student = ?
        AND etp.ed_transport_payment_academic_year = ?
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
    `;

    const rows = await ExecuteQuery(res, query,
      [institute, PASSENGERCODE, ACADEMICYEAR, institute], true,
      { db: "eduall_transport_payments", type: "select", data: req }
    );
    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Todos os pagamentos de um aluno num ano letivo (por student_id)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleStudentTransportPaymentsByCode = async (req, res) => {
  try {
    const { ACADEMICYEAR, STUDENTCODE } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        etp.*,
        etp2.ed_transport_passenger_id,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON CONVERT(c.ed_coin_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      LEFT JOIN eduall_transport_passengers etp2
        ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st
        ON st.ed_student_id = etp2.ed_transport_passenger_code
      WHERE etp.ed_transport_payment_deleted = 0
        AND st.ed_student_id = ?
        AND etp.ed_transport_payment_academic_year = ?
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
    `;

    const rows = await ExecuteQuery(res, query,
      [institute, STUDENTCODE, ACADEMICYEAR, institute], true,
      { db: "eduall_transport_payments", type: "select", data: req }
    );

    console.log(rows)
    res.status(200).json(rows);
  } catch (err) {
    console.log(err);
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET — Por RFID
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleStudentTransportPaymentsByRFID = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) {
      return res.status(400).json({ status: 300, success: false, msg: "Instituto não encontrado na sessão." });
    }

    const RFIDCODE = (req.params?.RFIDCODE || "").trim();
    if (!RFIDCODE) {
      return res.status(400).json({ status: 300, success: false, msg: "RFID inválido." });
    }

    const studentQuery = `
      SELECT
        s.ed_student_id, s.ed_student_name, s.ed_student_picture,
        s.ed_student_class, s.ed_student_code,
        c.ed_class_title, c.ed_class_year,
        y.ed_academic_year_title
      FROM eduall_students s
      INNER JOIN eduall_class c
        ON c.ed_class_id = s.ed_student_class AND COALESCE(c.ed_class_deleted,0)=0
      INNER JOIN eduall_academic_year y
        ON y.ed_academic_year_id = c.ed_class_year AND COALESCE(y.ed_academic_year_deleted,0)=0
      WHERE CONVERT(s.ed_student_rfid_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND CONVERT(s.ed_student_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND COALESCE(s.ed_student_deleted,0)=0
      LIMIT 1
    `;
    const [student] = await ExecuteQuery(res, studentQuery, [RFIDCODE, institute], true, {
      db: "eduall_students", type: "select", data: req,
    });
    if (!student) {
      return res.status(404).json({ status: 300, success: false, msg: "Cartão não associado a nenhum aluno." });
    }

    const ACADEMICYEAR  = student.ed_class_year;
    const PASSENGERCODE = student.ed_student_id;

    const passengerQuery = `
      SELECT tp.*
      FROM eduall_transport_passengers tp
      WHERE tp.ed_transport_passenger_deleted = 0
        AND CONVERT(tp.ed_transport_passenger_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND tp.ed_transport_passenger_code = ?
      LIMIT 1
    `;
    const [passenger] = await ExecuteQuery(res, passengerQuery, [institute, PASSENGERCODE], true, {
      db: "eduall_transport_passengers", type: "select", data: req,
    });
    if (!passenger) {
      return res.status(404).json({ status: 300, success: false, msg: "Aluno não está registado como passageiro de transporte." });
    }

    const paymentsQuery = `
      SELECT
        etp.*,
        s.ed_service_title,
        c.ed_coin_code,
        ${EXTRAS_SUBQUERY(
          "etp.ed_transport_payment_invoiceCode",
          "etp.ed_transport_payment_institute_code"
        )}
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_services s
        ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c
        ON CONVERT(c.ed_coin_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_student = ?
        AND etp.ed_transport_payment_academic_year = ?
        AND CONVERT(etp.ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
    `;
    const rows = await ExecuteQuery(res, paymentsQuery,
      [institute, passenger.ed_transport_passenger_id, ACADEMICYEAR, institute], true,
      { db: "eduall_transport_payments", type: "select", data: req }
    );

    return res.status(200).json({
      success: true,
      data: {
        student: {
          id: student.ed_student_id, name: student.ed_student_name,
          picture: student.ed_student_picture, class_id: student.ed_student_class,
          class_title: student.ed_class_title, code: student.ed_student_code,
          academic_year: ACADEMICYEAR, year_title: student.ed_academic_year_title,
        },
        passenger: {
          id: passenger.ed_transport_passenger_id,
          startMonth: passenger.ed_transport_passenger_startMonth || null,
        },
        payments: rows || [],
      },
    });
  } catch (err) {
    return res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// REGISTER
// ════════════════════════════════════════════════════════════════════════════════
const RegisterTransportPayments = async (req, res) => {

  // ── DEBUG: log grande e colorido ─────────────────────────────────────────
  console.log("\x1b[44m\x1b[97m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
  console.log("\x1b[44m\x1b[97m\x1b[1m%s\x1b[0m", "   REGISTER TRANSPORT PAYMENTS — BODY RECEBIDO          ");
  console.log("\x1b[44m\x1b[97m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_student_code :", req.body.transportpayment_student_code);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ student_code                  :", req.body.student_code);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_servicecode  :", req.body.transportpayment_servicecode);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_months       :", req.body.transportpayment_months);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_academic_year:", req.body.transportpayment_academic_year);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_type         :", req.body.transportpayment_type);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ transportpayment_price        :", req.body.transportpayment_price);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ balanceUsed                   :", req.body.balanceUsed);
  console.log("\x1b[36m\x1b[1m%s\x1b[0m", "→ extraServices                 :", JSON.stringify(req.body.extraServices));
  console.log("\x1b[44m\x1b[97m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");

  // ── Helpers ───────────────────────────────────────────────────────────────
  function monthLabel(mdotY) {
    const m = String(mdotY).split(".")[0] * 1;
    const y = String(mdotY).split(".")[1] * 1;
    const N = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
               "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    if (Number.isFinite(m) && Number.isFinite(y)) return `${N[m]} / ${y}`;
    return String(mdotY);
  }

  function sanitizeExtras(extras) {
    if (!Array.isArray(extras)) return [];
    return extras
      .map(e => ({
        name:   String(e?.name  || "").trim(),
        value:  Number(String(e?.value ?? "").replace(",", ".")),
        isFine: Boolean(e?.isFine),
      }))
      .filter(e => e.name.length > 0 && Number.isFinite(e.value) && e.value > 0);
  }

  /**
   * Normaliza transportpayment_months para array de strings.
   * Aceita:
   *   "0.2025"              → ["0.2025"]
   *   ",0.2025,1.2025"      → ["0.2025","1.2025"]   (formato do modal antigo)
   *   ["0.2025","1.2025"]   → ["0.2025","1.2025"]
   */
  function parseMonths(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    return String(raw).split(",").map(s => s.trim()).filter(Boolean);
  }

  try {
    const sessionInstitute = req.session.user.eduall_user_session_curentinstitute;
    const operatorId       = req.session?.user?.eduall_user_session_ID;
    const operator         = await getOperatorData(res, operatorId);

    const {
      transportpayment_student_code,
      student_code,
      transportpayment_servicecode,
      transportpayment_price,
      transportpayment_months,
      transportpayment_discount,
      transportpayment_type,
      transportpayment_bank             = "",
      transportpayment_academic_year,
      transportpayment_place            = "",
      transportpayment_balance,
      transportpayment_bordereux_number = "",
      transportpayment_iva              = 0,
      transportpayment_code,
      transportpayment_fineType         = 0,
      transportpayment_fineValue        = 0,
      transportpayment_invoiceCode,
      balanceUsed: balanceUsedRaw       = 0,
      extraServices                     = [],
    } = req.body;

    // transportpayment_student_code → ed_student_id do aluno
    // student_code                  → ed_transport_passenger_id
    const resolvedStudentId = transportpayment_student_code || null;
    const monthsList        = parseMonths(transportpayment_months);

    console.log("\x1b[43m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
    console.log("\x1b[43m\x1b[30m\x1b[1m%s\x1b[0m", "   IDs E MESES RESOLVIDOS                               ");
    console.log("\x1b[43m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
    console.log("\x1b[33m\x1b[1m%s\x1b[0m", "→ resolvedStudentId :", resolvedStudentId);
    console.log("\x1b[33m\x1b[1m%s\x1b[0m", "→ monthsList        :", monthsList);
    console.log("\x1b[43m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");

    if (!resolvedStudentId) {
      return res.status(400).json({ success: false, msg: "Aluno não identificado. Tente novamente." });
    }
    if (!monthsList.length) {
      return res.status(400).json({ success: false, msg: "Seleccione pelo menos um mês." });
    }

    const balanceUsed  = Math.max(0, parseFloat(balanceUsedRaw) || 0);
    const addons       = sanitizeExtras(extraServices);
    const fineAddon    = addons.find(e => e.isFine) || null;
    const manualAddons = addons.filter(e => !e.isFine);

    // ── Calcular preço por linha ──────────────────────────────────────────────
    const basePrice      = parseFloat(transportpayment_price) || 0;
    const discountPct    = parseFloat(transportpayment_discount || 0);
    const discountAmt    = discountPct > 0 ? (basePrice * discountPct) / 100 : 0;
    const priceAfterDisc = Math.max(0, basePrice - discountAmt);
    const ivaAmt         = transportpayment_iva * 1 > 0
      ? (priceAfterDisc * (transportpayment_iva * 1)) / 100 : 0;
    const lineTotal      = priceAfterDisc + ivaAmt;

    const resolvedFineValue = fineAddon
      ? Number(fineAddon.value)
      : transportpayment_fineValue * 1;

    const extrasTotal = addons.reduce((s, e) => s + e.value, 0);

    // grandTotal = (linha × nº meses) + multa (1×) + extras (1×)
    const grandTotal = lineTotal * monthsList.length + resolvedFineValue + extrasTotal;

    // ── Verificar duplicatas ──────────────────────────────────────────────────
    const dupPlaceholders = monthsList.map(() => "?").join(",");
    const dupRows = await ExecuteQuery(res, `
      SELECT ed_transport_payment_month AS month
      FROM eduall_transport_payments
      WHERE ed_transport_payment_deleted = 0
        AND ed_transport_payment_student = ?
        AND ed_transport_payment_academic_year = ?
        AND ed_transport_payment_month IN (${dupPlaceholders})
        AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      GROUP BY ed_transport_payment_month
    `, [transportpayment_student_code, transportpayment_academic_year, ...monthsList, sessionInstitute], true);

    if (dupRows?.length) {
      const labels = dupRows.map(r => monthLabel(r.month));
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_MONTHS",
        msg: `${labels.length === 1 ? "O mês" : "Os meses"} ${labels.join(", ")} já ${labels.length === 1 ? "foi pago" : "foram pagos"}.`,
        monthsPaid: dupRows.map(r => String(r.month)),
      });
    }

    // ── Dados do aluno ────────────────────────────────────────────────────────
    console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ A procurar aluno id:", resolvedStudentId, "| instituto:", sessionInstitute);

    const CLIENT_DATA = await getSingleStudentByInstitute(
      sessionInstitute,
      req.session.user.eduall_user_session_curentinstitute_type,
      resolvedStudentId
    );

    console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ Aluno (length):", CLIENT_DATA.length);
    if (CLIENT_DATA.length > 0) {
      console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ Nome:", CLIENT_DATA[0].ed_student_name);
    } else {
      console.log("\x1b[41m\x1b[97m\x1b[1m%s\x1b[0m", "   ERRO: Aluno não encontrado! id=" + resolvedStudentId);
    }

    if (!CLIENT_DATA.length) {
      return res.status(404).json({ success: false, msg: "Aluno não encontrado. Verifique os dados e tente novamente." });
    }

    // ── Dados da turma ────────────────────────────────────────────────────────
    let classInfo = null;
    if (CLIENT_DATA[0].ed_student_class) {
      const classRows = await ExecuteQuery(null, `
        SELECT eduall_class.*,
               eduall_classrooms.ed_classroom_title,
               eduall_courses.ed_course_title,
               eduall_academic_year.ed_academic_year_title,
               eduall_institutes.ed_institute_name
        FROM eduall_class
        LEFT JOIN eduall_classrooms    ON eduall_classrooms.ed_classroom_id    = eduall_class.ed_class_room
        LEFT JOIN eduall_courses       ON eduall_courses.ed_course_id          = eduall_class.ed_class_course
        LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
        LEFT JOIN eduall_institutes    ON CONVERT(eduall_institutes.ed_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
                                       = CONVERT(eduall_class.ed_class_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
        WHERE eduall_class.ed_class_deleted = 0
          AND eduall_class.ed_class_id = ?
          AND CONVERT(eduall_class.ed_class_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND eduall_academic_year.ed_academic_year_deleted = 0
          AND eduall_courses.ed_course_deleted = 0
          AND eduall_classrooms.ed_classroom_deleted = 0
          AND eduall_institutes.ed_institute_deleted = 0
      `, [CLIENT_DATA[0].ed_student_class, sessionInstitute], true);
      if (classRows.length > 0) classInfo = classRows[0];
    }

    // ── Itens da fatura — uma linha por mês ───────────────────────────────────
    const Items = monthsList.map((m, i) => ({
      itemcode: `EDTRANS-${transportpayment_servicecode}-${String(i + 1).padStart(2, "0")}`,
      title:    "Pag. transporte - " + FACTPLUS_decodificarMesEAno(m),
      price:    Number(priceAfterDisc.toFixed(2)),
      tax:      transportpayment_iva * 1 > 0,
      discount: 0,
      quantity: "1",
    }));

    if (resolvedFineValue > 0) {
      Items.push({
        itemcode: "FINE001",
        title:    fineAddon?.name || "Multa por atraso no transporte",
        price:    Number(resolvedFineValue.toFixed(2)),
        quantity: "1", tax: false, discount: "0",
      });
    }

    manualAddons.forEach((ex, idx) => {
      Items.push({
        itemcode: `EXTRA-${String(idx + 1).padStart(2, "0")}`,
        title:    ex.name,
        price:    Number(Number(ex.value).toFixed(2)),
        quantity: "1", tax: false, discount: "0",
      });
    });

    // ── Observações ───────────────────────────────────────────────────────────
    const obsParts = [" "];
    if (classInfo?.ed_class_title)         obsParts.push(`Turma: ${classInfo.ed_class_title}`);
    if (CLIENT_DATA[0]?.ed_student_code)   obsParts.push(`Nº matrícula: ${CLIENT_DATA[0].ed_student_code}`);
    if (classInfo?.ed_classroom_title)     obsParts.push(`Sala: ${classInfo.ed_classroom_title}`);
    if (classInfo?.ed_course_title)        obsParts.push(`Curso: ${classInfo.ed_course_title}`);
    if (classInfo?.ed_academic_year_title) obsParts.push(`Ano lectivo: ${classInfo.ed_academic_year_title}`);
    if (classInfo?.ed_institute_name)      obsParts.push(`Nome da instituição: ${classInfo.ed_institute_name}`);
    if (operator)                          obsParts.push(`Operador: ${operator.name}`);
    if (monthsList.length > 1)             obsParts.push(`Meses: ${monthsList.map(monthLabel).join(", ")}`);

    if (manualAddons.length > 0) {
      obsParts.push("---");
      obsParts.push("Valores adicionais:");
      manualAddons.forEach(ex => obsParts.push(`  • ${ex.name}: ${ex.value.toFixed(2)}`));
    }
    if (fineAddon) {
      obsParts.push("---");
      obsParts.push(`Multa aplicada: ${fineAddon.name} — ${fineAddon.value.toFixed(2)}`);
    }
    if (Number(transportpayment_type) === PAYMENT_TYPE_BALANCE && balanceUsed > 0) {
      const remaining = Math.max(0, grandTotal - balanceUsed);
      obsParts.push("---");
      obsParts.push("Forma de pagamento: Saldo do aluno");
      obsParts.push(`Total da fatura: ${grandTotal.toFixed(2)}`);
      obsParts.push(`Saldo utilizado: ${balanceUsed.toFixed(2)}`);
      if (remaining > 0) obsParts.push(`Restante (outro método): ${remaining.toFixed(2)}`);
      else               obsParts.push("Fatura totalmente coberta pelo saldo do aluno.");
    }
    const obs = obsParts.join("\n");

    // ── Fatura ────────────────────────────────────────────────────────────────
    const invoiceData = await VENDUS_CreateInvoiceCodeAndDoc(req, {
      name:      CLIENT_DATA[0].ed_student_name,
      fiscal_id: CLIENT_DATA[0].ed_student_identityCard,
      address:   CLIENT_DATA[0].ed_student_address,
      email:     CLIENT_DATA[0].ed_student_email,
    }, Items, transportpayment_type, obs);

    if (!invoiceData.number) {
      return res.status(500).json({ success: false, msg: "Não foi possível emitir a fatura. Tente novamente." });
    }

    // ── Garantir colunas do operador ─────────────────────────────────────────
    try {
      await ExecuteQuery(null, `
        ALTER TABLE eduall_transport_payments
          ADD COLUMN IF NOT EXISTS ed_transport_payment_operator    VARCHAR(255) NULL DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS ed_transport_payment_operator_id INT          NULL DEFAULT NULL
      `, [], false);
    } catch (alterErr) {
      console.warn("\x1b[33m\x1b[1m%s\x1b[0m", "→ ALTER TABLE ignorado:", alterErr?.message || alterErr);
    }

    // ── Transacção ────────────────────────────────────────────────────────────
    await ExecuteQuery(res, "START TRANSACTION", [], false);

    try {
      // 1) Inserir uma linha por mês — mesmo invoiceCode em todas
      const insertSql = `
        INSERT INTO eduall_transport_payments (
          ed_transport_payment_student,
          ed_transport_payment_service,
          ed_transport_payment_price,
          ed_transport_payment_month,
          ed_transport_payment_discount,
          ed_transport_payment_type,
          ed_transport_payment_bank,
          ed_transport_payment_academic_year,
          ed_transport_payment_place,
          ed_transport_payment_balance,
          ed_transport_payment_bordereux,
          ed_transport_payment_iva,
          ed_transport_payment_code,
          ed_transport_payment_fineType,
          ed_transport_payment_fineValue,
          ed_transport_payment_invoiceCode,
          ed_transport_payment_invoiceFile,
          ed_transport_payment_institute_code,
          ed_transport_payment_operator,
          ed_transport_payment_operator_id
        ) VALUES ${monthsList.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}
      `;

      const insertParams = [];
      monthsList.forEach((m, i) => {
        insertParams.push(
          transportpayment_student_code,
          transportpayment_servicecode,
          transportpayment_price,
          m,
          transportpayment_discount,
          transportpayment_type,
          transportpayment_bank,
          transportpayment_academic_year,
          transportpayment_place,
          Number(lineTotal.toFixed(2)),
          transportpayment_bordereux_number,
          transportpayment_iva,
          transportpayment_code,
          transportpayment_fineType,
          i === 0 ? Number(resolvedFineValue.toFixed(2)) : 0, // multa só na 1ª linha
          invoiceData.number,                                  // mesmo invoiceCode
          invoiceData.id,
          sessionInstitute,
          operator?.name || null,
          operator?.id   || null
        );
      });

      const QueryResult = await ExecuteQuery(res, insertSql, insertParams, false, {
        db: "eduall_transport_payments", type: "insert", data: req,
      });

      // 2) Persistir extras — uma vez por fatura
      if (addons.length > 0) {
        try {
          const addSql = `
            INSERT INTO eduall_transport_additional_items (
              ed_transport_additional_student_id,
              ed_transport_additional_passenger_id,
              ed_transport_additional_academic_year,
              ed_transport_additional_description,
              ed_transport_additional_amount,
              ed_transport_additional_is_fine,
              ed_transport_additional_invoice_code,
              ed_transport_additional_invoice_id,
              ed_transport_additional_institute_code,
              ed_transport_additional_operator,
              ed_transport_additional_operator_id
            ) VALUES ${addons.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}
          `;
          const addParams = [];
          addons.forEach(a => {
            addParams.push(
              resolvedStudentId,
              transportpayment_student_code,
              transportpayment_academic_year,
              a.name,
              Number(Number(a.value).toFixed(2)),
              a.isFine ? 1 : 0,
              invoiceData.number,
              invoiceData.id,
              sessionInstitute,
              operator?.name || null,
              operator?.id   || null
            );
          });
          await ExecuteQuery(res, addSql, addParams, false);
        } catch (auxErr) {
          console.warn("Persistência de extras ignorada:", auxErr?.message || auxErr);
        }
      }

      // 3) Debitar saldo
      if (Number(transportpayment_type) === PAYMENT_TYPE_BALANCE && balanceUsed > 0) {
        try {
          await ensureBalanceRow(res, resolvedStudentId, sessionInstitute);

          const [current] = await ExecuteQuery(res,
            `SELECT sb_balance, sb_currency FROM eduall_student_balance
             WHERE sb_student_id = ?
               AND CONVERT(sb_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
             FOR UPDATE`,
            [resolvedStudentId, sessionInstitute], true
          );

          const balanceBefore = parseFloat(current?.sb_balance ?? 0);
          const currency      = current?.sb_currency || "AOA";

          if (balanceUsed > balanceBefore) {
            await ExecuteQuery(res, "ROLLBACK", [], false);
            return res.status(422).json({
              success: false,
              msg: `Saldo insuficiente. Disponível: ${balanceBefore} ${currency}.`,
              balance: balanceBefore,
            });
          }

          const balanceAfter = Number((balanceBefore - balanceUsed).toFixed(2));
          const remaining    = Math.max(0, grandTotal - balanceUsed);

          let deductDesc  = `Pagamento de transporte — Fatura ${invoiceData.number}. `;
          deductDesc     += `Créditos usados: ${balanceUsed.toFixed(2)} ${currency}`;
          deductDesc     += ` (total: ${grandTotal.toFixed(2)} ${currency})`;
          deductDesc     += remaining > 0
            ? `. Restante por outro método: ${remaining.toFixed(2)} ${currency}.`
            : `. Totalmente coberta pelo saldo.`;

          await ExecuteQuery(res,
            `UPDATE eduall_student_balance SET sb_balance = ?
             WHERE sb_student_id = ?
               AND CONVERT(sb_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?`,
            [balanceAfter, resolvedStudentId, sessionInstitute], false
          );

          await ExecuteQuery(res,
            `INSERT INTO eduall_student_balance_logs
               (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
                sb_log_amount, sb_log_balance_before, sb_log_balance_after,
                sb_log_description, sb_log_reference, sb_log_user_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [resolvedStudentId, sessionInstitute, "deduct", "transporte",
             balanceUsed, balanceBefore, balanceAfter,
             deductDesc, invoiceData.number || null, operatorId || null], false
          );
        } catch (balanceErr) {
          console.error("Erro ao debitar saldo (não crítico):", balanceErr?.message || balanceErr);
        }
      }

      // 4) Auditoria
      await RegisterAuditAction({
        session:     req.session,
        action:      1,
        form:        "Pagamentos de Transporte",
        description: [
          `[${operator?.name || "Desconhecido"}]`,
          `Registou ${monthsList.length} linha(s) de transporte para passageiro ${transportpayment_student_code}`,
          `(aluno ${resolvedStudentId}).`,
          `Fatura ${invoiceData.number}. Total: ${grandTotal.toFixed(2)}.`,
          addons.length > 0 ? `Extras: ${addons.length} item(ns).` : "",
          balanceUsed > 0 ? `Saldo usado: ${balanceUsed.toFixed(2)}.` : "",
        ].filter(Boolean).join(" "),
      });

      await ExecuteQuery(res, "COMMIT", [], false);

      console.log("\x1b[42m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
      console.log("\x1b[42m\x1b[30m\x1b[1m%s\x1b[0m", "   PAGAMENTO DE TRANSPORTE REGISTADO COM SUCESSO        ");
      console.log("\x1b[42m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
      console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ Fatura  :", invoiceData.number);
      console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ Meses   :", monthsList.join(", "));
      console.log("\x1b[32m\x1b[1m%s\x1b[0m", "→ Total   :", grandTotal.toFixed(2));
      console.log("\x1b[42m\x1b[30m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");

      return res.status(200).json({
        ...QueryResult,
        invoice:        invoiceData,
        operator:       operator?.name || null,
        inserted:       monthsList.length,
        extrasInserted: addons.length,
        total:          Number(grandTotal.toFixed(2)),
        balanceUsed:    balanceUsed > 0 ? Number(balanceUsed.toFixed(2)) : 0,
        remaining:      Math.max(0, grandTotal - balanceUsed),
      });

    } catch (txErr) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      throw txErr;
    }

  } catch (error) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    console.log("\x1b[41m\x1b[97m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
    console.log("\x1b[41m\x1b[97m\x1b[1m%s\x1b[0m", "   ERRO FATAL — RegisterTransportPayments               ");
    console.log("\x1b[41m\x1b[97m\x1b[1m%s\x1b[0m", "════════════════════════════════════════════════════════");
    console.error("\x1b[31m\x1b[1m%s\x1b[0m", error);
    res.status(500).json({ success: false, msg: "Não foi possível registar o pagamento. Tente novamente." });
  }
};
// ════════════════════════════════════════════════════════════════════════════════
// DELETE — soft delete do pagamento + extras
// ════════════════════════════════════════════════════════════════════════════════

const TransportPaymentsDelete = async (req, res) => {
  const { ID }    = req.params;
  const institute = req.session?.user?.eduall_user_session_curentinstitute;

  if (!institute) {
    return res.status(400).json({ success: false, message: "Instituto inválido na sessão." });
  }

  try {
    await ExecuteQuery(res, "START TRANSACTION", [], false);

    // 1) Buscar invoice_code antes de apagar
    const [payment] = await ExecuteQuery(res, `
      SELECT ed_transport_payment_invoiceCode AS invoice_code
      FROM eduall_transport_payments
      WHERE ed_transport_payment_id = ?
        AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND COALESCE(ed_transport_payment_deleted,0)=0
      LIMIT 1
    `, [ID, institute], true, { db: "eduall_transport_payments", type: "select", data: req });

    if (!payment) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      return res.status(404).json({ success: false, message: "Pagamento não encontrado ou já eliminado." });
    }

    const invoiceCode = payment.invoice_code;

    // 2) Soft delete do pagamento
    await ExecuteQuery(res, `
      UPDATE eduall_transport_payments
      SET ed_transport_payment_deleted = 1
      WHERE ed_transport_payment_id = ?
        AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
        AND COALESCE(ed_transport_payment_deleted,0)=0
    `, [ID, institute], false, { db: "eduall_transport_payments", type: "update", data: req });

    // 3) Soft delete dos extras associados à fatura
    if (invoiceCode) {
      await ExecuteQuery(res, `
        UPDATE eduall_transport_additional_items
        SET ed_transport_additional_deleted = 1
        WHERE CONVERT(ed_transport_additional_invoice_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND CONVERT(ed_transport_additional_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND COALESCE(ed_transport_additional_deleted,0)=0
      `, [invoiceCode, institute], false, {
        db: "eduall_transport_additional_items", type: "update", data: req,
      });
    }

    // 4) Auditoria
    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Pagamentos de Transporte",
      description: `Eliminou o pagamento de transporte com ID ${ID}${invoiceCode ? ` (fatura ${invoiceCode})` : ""}, incluindo valores adicionais associados.`,
    });

    await ExecuteQuery(res, "COMMIT", [], false);

    res.status(200).json({
      success: true,
      message: `Pagamento (ID ${ID}) e valores adicionais associados eliminados com sucesso.`,
    });

  } catch (error) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    console.error("Erro ao deletar pagamento de transporte:", error);
    res.status(500).json({
      success: false,
      message: "Falha ao deletar o pagamento e seus valores adicionais!",
      error:   error.message || error,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════════════════════════

const TransportPaymentsUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      transportpayment_student_code, transportpayment_servicecode,
      transportpayment_price, transportpayment_months, transportpayment_discount,
      transportpayment_type, transportpayment_bank, transportpayment_academic_year,
      transportpayment_place, transportpayment_balance, transportpayment_bordereux_number,
      transportpayment_iva, transportpayment_fineValue, transportpayment_fineType,
    } = req.body;

    await ExecuteQuery(res, `
      UPDATE eduall_transport_payments SET
        ed_transport_payment_student       = ?,
        ed_transport_payment_service       = ?,
        ed_transport_payment_price         = ?,
        ed_transport_payment_month         = ?,
        ed_transport_payment_discount      = ?,
        ed_transport_payment_type          = ?,
        ed_transport_payment_bank          = ?,
        ed_transport_payment_academic_year = ?,
        ed_transport_payment_place         = ?,
        ed_transport_payment_balance       = ?,
        ed_transport_payment_bordereux     = ?,
        ed_transport_payment_iva           = ?,
        ed_transport_payment_fineValue     = ?,
        ed_transport_payment_fineType      = ?
      WHERE ed_transport_payment_deleted = 0
        AND ed_transport_payment_id = ?
    `, [
      transportpayment_student_code, transportpayment_servicecode,
      transportpayment_price, transportpayment_months, transportpayment_discount,
      transportpayment_type, transportpayment_bank, transportpayment_academic_year,
      transportpayment_place, transportpayment_balance, transportpayment_bordereux_number,
      transportpayment_iva, transportpayment_fineValue, transportpayment_fineType, ID,
    ], false, { db: "eduall_transport_payments", type: "update", data: req });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Pagamentos de Transporte",
      description: `Atualizou o pagamento de transporte com código ${req.body.transportpayment_code} e ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Pagamento atualizado com sucesso." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// STATUS — Todas as turmas
// ════════════════════════════════════════════════════════════════════════════════

const GetAllClassesTransportPaymentsStatus = async (req, res) => {
  try {
    console.time("GetAllClassesTransportPaymentsStatus");
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) {
      return res.status(400).json({ success: false, message: "Instituto não encontrado na sessão." });
    }

    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

    const buildMonths = (startDate, endDate) => {
      if (!startDate || !endDate || !startDate.includes("-") || !endDate.includes("-")) return [];
      const [Y1, M1] = startDate.split("-").map(Number);
      const [Y2, M2] = endDate.split("-").map(Number);
      const months = [];
      const push = (m, y) => months.push({ month: `${MonthsList[m - 1]} de ${y}`, code: parseFloat(`${m}.${y}`), status: "other" });
      if (Y2 > Y1) {
        for (let i = M1; i <= 12; i++) push(i, Y1);
        for (let i = 1; i <= M2;  i++) push(i, Y2);
      } else {
        for (let i = M1; i <= M2; i++) push(i, Y1);
      }
      return months;
    };

    const [classes, passengers, allPayments] = await Promise.all([
      ExecuteQuery(res, `
        SELECT c.*, y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
        FROM eduall_class c
        INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year
        WHERE c.ed_class_deleted = 0
          AND CONVERT(c.ed_class_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND CONVERT(y.ed_academic_year_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      `, [institute, institute], true, { db: "eduall_class", type: "select", data: req }),

      ExecuteQuery(res, `
        SELECT tp.*, s.ed_student_name, s.ed_student_class, s.ed_student_picture,
               s.ed_student_id, s.ed_student_code
        FROM eduall_transport_passengers tp
        INNER JOIN eduall_students s ON s.ed_student_id = tp.ed_transport_passenger_code
        WHERE CONVERT(tp.ed_transport_passenger_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND s.ed_student_deleted = 0 AND tp.ed_transport_passenger_deleted = 0
        ORDER BY s.ed_student_name ASC
      `, [institute], true, { db: "eduall_students", type: "select", data: req }),

      ExecuteQuery(res, `
        SELECT * FROM eduall_transport_payments
        WHERE ed_transport_payment_deleted = 0
          AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      `, [institute], true, { db: "eduall_transport_payments", type: "select", data: req }),
    ]);

    if (!Array.isArray(classes) || classes.length === 0) {
      return res.status(404).json({ success: false, message: "Nenhuma turma encontrada!" });
    }

    const paymentsByPassenger = allPayments.reduce((acc, p) => {
      const key = p.ed_transport_payment_student;
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});

    const currentYear  = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const finalResult = classes.map(cls => {
      const months   = buildMonths(cls.ed_academic_year_startDate, cls.ed_academic_year_endDate);
      const students = passengers.filter(p => p.ed_student_class === cls.ed_class_id);

      const studentsData = students.map(st => {
        const passengerPayments   = paymentsByPassenger[st.ed_transport_passenger_id] || [];
        const passengerStartMonth = parseInt(st.ed_transport_passenger_startMonth) || null;

        const monthsStatus = months.map(m => {
          const [mMonth, mYear] = m.code.toString().split(".").map(Number);
          if (passengerStartMonth && mMonth < passengerStartMonth
              && mYear === parseInt(cls.ed_academic_year_startDate?.split("-")[0])) {
            return { ...m, status: "null" };
          }
          const payment = passengerPayments.find(p => parseFloat(p.ed_transport_payment_month) === m.code);
          if (payment) return { ...m, status: payment.ed_transport_payment_status === "canceled" ? "canceled" : "paid" };
          if (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth)) return { ...m, status: "notpaid" };
          return { ...m, status: "other" };
        });

        return { id: st.ed_student_id, name: st.ed_student_name, picture: st.ed_student_picture, code: st.ed_student_code, months: monthsStatus };
      });

      return {
        class_id: cls.ed_class_id, class_title: cls.ed_class_title,
        academic_year: { id: cls.ed_academic_year_id, startDate: cls.ed_academic_year_startDate, endDate: cls.ed_academic_year_endDate },
        students: studentsData,
      };
    });

    console.timeEnd("GetAllClassesTransportPaymentsStatus");
    res.status(200).json(finalResult);
  } catch (error) {
    console.error("Erro em GetAllClassesTransportPaymentsStatus:", error);
    res.status(500).json({ success: false, message: "Erro ao carregar pagamentos de transporte das turmas!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// STATUS — Turma singular
// ════════════════════════════════════════════════════════════════════════════════

const GetClassTransportPaymentsStatus = async (req, res) => {
  try {
    console.time("GetClassTransportPaymentsStatus");
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const { classId } = req.params;
    if (!classId) return res.status(400).json({ success: false, message: "ID da turma é obrigatório!" });

    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

    const buildMonths = (startDate, endDate) => {
      if (!startDate || !endDate || !startDate.includes("-") || !endDate.includes("-")) return [];
      const [Y1, M1] = startDate.split("-").map(Number);
      const [Y2, M2] = endDate.split("-").map(Number);
      const months = [];
      const push = (m, y) => months.push({ month: `${MonthsList[m - 1]} de ${y}`, code: parseFloat(`${m}.${y}`), status: "other" });
      if (Y2 > Y1) {
        for (let i = M1; i <= 12; i++) push(i, Y1);
        for (let i = 1; i <= M2;  i++) push(i, Y2);
      } else {
        for (let i = M1; i <= M2; i++) push(i, Y1);
      }
      return months;
    };

    const [[cls], passengers, allPayments] = await Promise.all([
      ExecuteQuery(res, `
        SELECT c.*, y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
        FROM eduall_class c
        INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year
        WHERE c.ed_class_deleted = 0 AND c.ed_class_id = ?
          AND CONVERT(c.ed_class_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND CONVERT(y.ed_academic_year_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      `, [classId, institute, institute], true, { db: "eduall_class", type: "select", data: req }),

      ExecuteQuery(res, `
        SELECT tp.*, s.ed_student_name, s.ed_student_class, s.ed_student_picture, s.ed_student_id
        FROM eduall_transport_passengers tp
        INNER JOIN eduall_students s ON s.ed_student_id = tp.ed_transport_passenger_code
        WHERE CONVERT(tp.ed_transport_passenger_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
          AND s.ed_student_class = ? AND s.ed_student_deleted = 0
          AND tp.ed_transport_passenger_deleted = 0
        ORDER BY s.ed_student_name ASC
      `, [institute, classId], true, { db: "eduall_students", type: "select", data: req }),

      ExecuteQuery(res, `
        SELECT * FROM eduall_transport_payments
        WHERE ed_transport_payment_deleted = 0
          AND CONVERT(ed_transport_payment_institute_code USING utf8mb4) COLLATE utf8mb4_unicode_ci = ?
      `, [institute], true, { db: "eduall_transport_payments", type: "select", data: req }),
    ]);

    if (!cls) return res.status(404).json({ success: false, message: "Turma não encontrada!" });

    const currentYear  = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const months       = buildMonths(cls.ed_academic_year_startDate, cls.ed_academic_year_endDate);

    const studentsData = passengers.map(st => {
      const passengerStartMonth = st.ed_transport_passenger_startMonth ? parseInt(st.ed_transport_passenger_startMonth) : null;
      const monthsStatus = months.map(m => {
        const [mMonth, mYear] = m.code.toString().split(".").map(Number);
        if (passengerStartMonth && mMonth < passengerStartMonth
            && mYear === parseInt(cls.ed_academic_year_startDate.split("-")[0])) {
          return { ...m, status: "null" };
        }
        const payment = allPayments.find(p => p.ed_transport_payment_student === st.ed_transport_passenger_id && parseFloat(p.ed_transport_payment_month) === m.code);
        if (payment) return { ...m, status: payment.ed_transport_payment_status === "canceled" ? "canceled" : "paid" };
        if (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth)) return { ...m, status: "notpaid" };
        return { ...m, status: "other" };
      });
      return { id: st.ed_student_id, name: st.ed_student_name, picture: st.ed_student_picture, months: monthsStatus };
    });

    console.timeEnd("GetClassTransportPaymentsStatus");
    res.status(200).json({
      class_id: cls.ed_class_id, class_title: cls.ed_class_title,
      academic_year: { id: cls.ed_academic_year_id, startDate: cls.ed_academic_year_startDate, endDate: cls.ed_academic_year_endDate },
      students: studentsData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao carregar pagamentos de transporte da turma!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetTransportPayments,
  GetTransportPaymentsByInvoiceCode,
  GetSingleTransportPayment,
  GetSingleTransportPaidMonth,
  GetSingleStudentTransportPayment,
  GetSingleStudentTransportPayments,
  GetSingleStudentTransportPaymentsByCode,
  GetSingleStudentTransportPaymentsByRFID,
  RegisterTransportPayments,
  TransportPaymentsDelete,
  TransportPaymentsUpdate,
  GetAllClassesTransportPaymentsStatus,
  GetClassTransportPaymentsStatus,
};