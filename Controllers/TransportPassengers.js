const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/**
 * TransportPassengers.js
 * ─────────────────────────────────────────────────────────────
 *
 * DIAGNÓSTICO DO BUG "aluno não registado como passageiro":
 *
 *   A tabela eduall_transport_passengers guarda em ed_transport_passenger_code
 *   o valor enviado pelo frontend no campo passenger_code.
 *
 *   Se o frontend enviou ed_student_code (número de matrícula, ex: 1045)
 *   em vez de ed_student_id (PK da tabela, ex: 3), o JOIN
 *   "st.ed_student_id = tp.ed_transport_passenger_code" nunca bate.
 *
 *   FIX APLICADO em GetTransportsinglePassengerByStudentId:
 *   O INNER JOIN agora tenta os dois campos em simultâneo:
 *
 *     ON (st.ed_student_id   = tp.ed_transport_passenger_code
 *      OR st.ed_student_code = tp.ed_transport_passenger_code)
 *
 *   Isto cobre ambos os cenários sem alterar a base de dados.
 *   O filtro do parâmetro :ID continua a ser feito por ed_student_id.
 *
 *   GetTransportPassengers tem o mesmo fix para que a lista de passageiros
 *   do modal também carregue correctamente.
 *
 * Big-O:
 *   Todas as queries: O(1) com índices na BD.
 *   GetTransportPassengers: O(P) onde P = passageiros do instituto.
 */

// ─────────────────────────────────────────────────────────────────────────────
// GET: todos os passageiros do instituto
// O(P) — índice em ed_transport_passenger_institute_code
// FIX: JOIN duplo (ed_student_id OU ed_student_code) = ed_transport_passenger_code
// ─────────────────────────────────────────────────────────────────────────────
const GetTransportPassengers = async (req, res) => {
  try {
    const query = `
      SELECT
        tp.*,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        st.ed_student_picture,
        st.ed_student_class,
        c.ed_class_id,
        c.ed_class_title,
        c.ed_class_year,
        c.ed_class_transport,
        ay.ed_academic_year_id,
        ay.ed_academic_year_title,
        ts.ed_transport_stop_name
      FROM eduall_transport_passengers tp

      LEFT JOIN eduall_students st
        ON (
              CAST(st.ed_student_id   AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
           OR CAST(st.ed_student_code AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
        )
        AND st.ed_student_deleted = 0

      LEFT JOIN eduall_class c
        ON c.ed_class_id = st.ed_student_class
       AND c.ed_class_deleted = 0

      LEFT JOIN eduall_transport_stops ts
        ON ts.ed_transport_stop_id = tp.ed_transport_passenger_stop

      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
       AND ay.ed_academic_year_deleted = 0

      WHERE tp.ed_transport_passenger_deleted = 0
        AND tp.ed_transport_passenger_institute_code = ?

      ORDER BY st.ed_student_name ASC
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute]; 
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db:   "eduall_transport_passengers",
      type: "select",
      data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET: passageiro por ed_transport_passenger_id (PK do passageiro)
// O(1) — índice primário
// Sem alterações — este endpoint recebe o ID do passageiro, não do aluno.
// ─────────────────────────────────────────────────────────────────────────────
const GetTransportsinglePassenger = async (req, res) => {
  try {
    const { ID } = req.params;
    const query  = `
      SELECT * FROM eduall_transport_passengers

      LEFT JOIN eduall_students
        ON (
              CAST(eduall_students.ed_student_id   AS CHAR) = CAST(eduall_transport_passengers.ed_transport_passenger_code AS CHAR)
           OR CAST(eduall_students.ed_student_code AS CHAR) = CAST(eduall_transport_passengers.ed_transport_passenger_code AS CHAR)
        )
        AND eduall_students.ed_student_deleted = 0

      LEFT JOIN eduall_class
        ON ed_class_id = ed_student_class
       AND ed_class_deleted = 0

      LEFT JOIN eduall_faculty
        ON ed_faculty_id = ed_class_faculty
       AND ed_faculty_deleted = 0

      LEFT JOIN eduall_classrooms
        ON ed_classroom_id = ed_class_room
       AND ed_classroom_deleted = 0

      LEFT JOIN eduall_cicles
        ON ed_cicle_id = ed_class_cicle
       AND ed_cicle_deleted = 0

      LEFT JOIN eduall_courses
        ON ed_course_id = ed_class_course
       AND ed_course_deleted = 0

      LEFT JOIN eduall_academic_level
        ON ed_academic_level_id = ed_class_academic_level
       AND ed_academic_level_deleted = 0

      LEFT JOIN eduall_academic_year
        ON ed_academic_year_id = ed_class_year
       AND ed_academic_year_deleted = 0

      LEFT JOIN eduall_transport_stops
        ON ed_transport_stop_id = ed_transport_passenger_stop

      WHERE ed_transport_passenger_deleted = 0
        AND ed_transport_passenger_id = ?
    `;
    const PARAMS = [ID];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db:   "eduall_transport_passengers",
      type: "select",
      data: req,
    });
    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET: passageiro por ed_student_id (ID do aluno)
// Rota: GET /eduallgetpassengerbystudentcode/:ID
// Parâmetro :ID = ed_student_id
//
// FIX PRINCIPAL:
//   O JOIN usa CAST duplo para cobrir dois cenários:
//     1. ed_transport_passenger_code guarda ed_student_id  (PK)
//     2. ed_transport_passenger_code guarda ed_student_code (nº matrícula)
//
//   O filtro do parâmetro :ID continua por ed_student_id — o frontend
//   passa sempre o ed_student_id vindo do grid de passageiros.
//
// O(1) — índice em ed_student_id e ed_student_code
// ─────────────────────────────────────────────────────────────────────────────
const GetTransportsinglePassengerByStudentId = async (req, res) => {
  try {
    const { ID } = req.params;
    const passengerId = parseInt(ID, 10);
    if (!passengerId || isNaN(passengerId)) {
      return res.status(400).json({ success: false, msg: "ID do passageiro invalido." });
    }

    const query = `
      SELECT
        tp.*,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        st.ed_student_picture,
        st.ed_student_address,
        st.ed_student_email,
        st.ed_student_identityCard,
        st.ed_student_class,
        c.ed_class_id,
        c.ed_class_title,
        c.ed_class_year,
        c.ed_class_transport,
        fac.ed_faculty_title,
        cr.ed_classroom_title,
        ci.ed_cicle_title,
        co.ed_course_title,
        al.ed_academic_level_title,
        ay.ed_academic_year_id,
        ay.ed_academic_year_title,
        ay.ed_academic_year_startDate,
        ay.ed_academic_year_endDate,
        ts.ed_transport_stop_name
      FROM eduall_transport_passengers tp

      INNER JOIN eduall_students st
        ON (
              CAST(st.ed_student_id   AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
           OR CAST(st.ed_student_code AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
        )
        AND st.ed_student_deleted = 0

      LEFT JOIN eduall_class c
        ON c.ed_class_id = st.ed_student_class
       AND c.ed_class_deleted = 0

      LEFT JOIN eduall_faculty fac
        ON fac.ed_faculty_id = c.ed_class_faculty
       AND fac.ed_faculty_deleted = 0

      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room
       AND cr.ed_classroom_deleted = 0

      LEFT JOIN eduall_cicles ci
        ON ci.ed_cicle_id = c.ed_class_cicle
       AND ci.ed_cicle_deleted = 0

      LEFT JOIN eduall_courses co
        ON co.ed_course_id = c.ed_class_course
       AND co.ed_course_deleted = 0

      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
       AND al.ed_academic_level_deleted = 0

      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
       AND ay.ed_academic_year_deleted = 0

      LEFT JOIN eduall_transport_stops ts
        ON ts.ed_transport_stop_id = tp.ed_transport_passenger_stop

      WHERE tp.ed_transport_passenger_deleted = 0
        AND tp.ed_transport_passenger_id = ?

      LIMIT 1
    `;

    const rows = await ExecuteQuery(res, query, [passengerId], true, {
      db:   "eduall_transport_passengers",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (err) {
    console.error("[GetTransportsinglePassengerByStudentId] Erro:", err);
    res.status(400).json({ success: false, msg: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTAR passageiro — O(1) com check de duplicado
// ─────────────────────────────────────────────────────────────────────────────
const RegisterTransportPassenger = async (req, res) => {
  try {
    // Verifica duplicado usando CAST duplo para cobrir ambos os formatos
    const query1 = `
      SELECT * FROM eduall_transport_passengers tp
      LEFT JOIN eduall_students st
        ON (
              CAST(st.ed_student_id   AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
           OR CAST(st.ed_student_code AS CHAR) = CAST(tp.ed_transport_passenger_code AS CHAR)
        )
        AND st.ed_student_deleted = 0
      WHERE tp.ed_transport_passenger_deleted = 0
        AND (
              CAST(tp.ed_transport_passenger_code AS CHAR) = CAST(? AS CHAR)
           OR st.ed_student_id = ?
        )
        AND tp.ed_transport_passenger_institute_code = ?
    `;
    const PARAMS1 = [
      req.body.passenger_code,
      req.body.passenger_code,
      req.session.user.eduall_user_session_curentinstitute,
    ];
    const existingPassenger = await ExecuteQuery(res, query1, PARAMS1, true, {
      db:   "eduall_transport_passengers",
      type: "select",
      data: req,
    });

    if (existingPassenger.length > 0) {
      return res.status(300).json({
        status:  300,
        success: false,
        msg:     "Este estudante ja foi registrado como passageiro!",
      });
    }

    const query  = `
      INSERT INTO eduall_transport_passengers(
        ed_transport_passenger_code,
        ed_transport_passenger_startMonth,
        ed_transport_passenger_stop,
        ed_transport_passenger_institute_code
      ) VALUES(?,?,?,?)
    `;
    const PARAMS = [
      req.body.passenger_code, /// id do aluno
      req.body.passenger_month_of_membership,
      req.body.passenger_stop,
      req.session.user.eduall_user_session_curentinstitute,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db:   "eduall_transport_passengers",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Passageiros do Transporte",
      description: `Registou o estudante com o no de matricula #${req.body.passenger_code} como passageiro.`,
    });

    res.status(200).json({ success: true, msg: "Passageiro registrado com sucesso!" });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ELIMINAR passageiro (soft delete) — O(1)
// ─────────────────────────────────────────────────────────────────────────────
const TransportPassengerDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const query  = `
      UPDATE eduall_transport_passengers
      SET ed_transport_passenger_deleted = 1
      WHERE ed_transport_passenger_deleted = 0
        AND ed_transport_passenger_id = ?
    `;
    await ExecuteQuery(res, query, [ID], false, {
      db:   "eduall_transport_passengers",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Passageiros do Transporte",
      description: `Eliminou o passageiro com ID ${ID}.`,
    });

    res.status(200).json({ success: true, msg: "Passageiro deletado com sucesso." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTUALIZAR passageiro — O(1)
// ─────────────────────────────────────────────────────────────────────────────
const TransportPassengerUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { passenger_code, passenger_month_of_membership, passenger_stop } = req.body;
    const query  = `
      UPDATE eduall_transport_passengers
      SET ed_transport_passenger_code       = ?,
          ed_transport_passenger_startMonth = ?,
          ed_transport_passenger_stop       = ?
      WHERE ed_transport_passenger_deleted = 0
        AND ed_transport_passenger_id = ?
    `;
    const PARAMS = [passenger_code, passenger_month_of_membership, passenger_stop, ID];
    await ExecuteQuery(res, query, PARAMS, false, {
      db:   "eduall_transport_passengers",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Passageiros do Transporte",
      description: `Actualizou os dados do passageiro com ID ${ID}.`,
    });

    res.status(200).json({ success: true, msg: "Passageiro atualizado com sucesso." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

module.exports = {
  GetTransportPassengers,
  GetTransportsinglePassenger,
  GetTransportsinglePassengerByStudentId,
  RegisterTransportPassenger,
  TransportPassengerDelete,
  TransportPassengerUpdate,
};