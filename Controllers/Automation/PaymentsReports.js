 /**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EduallFeeAlerts.backend.js — v2
 *  Sistema de Alertas Automáticos de Propinas e Transportes — Eduall
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * NOVIDADES v2:
 *  • Configuração passa a suportar VÁRIOS dias de envio (ex: 5, 3 e 1 dia antes
 *    do vencimento) + HORA específica de envio para cada tipo de alerta.
 *  • Gestão completa de contactos por aluno: listar (pai/mãe/encarregado +
 *    extras), editar, apagar e VALIDAR (email/telefone) — usado pelo separador
 *    "Contactos" do frontend.
 *  • Toda a configuração continua persistida por instituto na tabela
 *    eduall_fee_alert_config — o frontend só a lê uma vez e mostra o que já
 *    está guardado, nunca é preciso reconfigurar.
 * ════════════════════════════════════════════════════════════════════════════════
 */

const ExecuteQuery = require("../../Functions/ExecuteQuery");
const Cache         = require("../../Functions/CacheRoutes");
const { RegisterAuditAction } = require("../Auditory");
const nodeMailer   = require("nodemailer");
const axios        = require("axios");
const cron         = require("node-cron");
const { MailOptions } = require("../../Functions/MailOptions");

// ════════════════════════════════════════════════════════════════════════════════
// 1. TABELAS — auto-criação + auto-migração (idempotente)
// ════════════════════════════════════════════════════════════════════════════════

async function EnsureFeeAlertTables() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS eduall_fee_alert_config (
      id INT AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      obligation_type ENUM('propina','transporte','confirmacao') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      due_day INT NOT NULL DEFAULT 10,
      before_enabled TINYINT(1) NOT NULL DEFAULT 0,
      before_days INT NOT NULL DEFAULT 3,
      before_message TEXT,
      dueday_enabled TINYINT(1) NOT NULL DEFAULT 0,
      dueday_message TEXT,
      after_enabled TINYINT(1) NOT NULL DEFAULT 0,
      after_days INT NOT NULL DEFAULT 3,
      after_message TEXT,
      recurring_enabled TINYINT(1) NOT NULL DEFAULT 0,
      recurring_every_days INT NOT NULL DEFAULT 7,
      recurring_message TEXT,
      confirmation_enabled TINYINT(1) NOT NULL DEFAULT 0,
      confirmation_message TEXT,
      receipt_enabled TINYINT(1) NOT NULL DEFAULT 0,
      receipt_delay_minutes INT NOT NULL DEFAULT 10,
      receipt_message TEXT,
      channels VARCHAR(64) NOT NULL DEFAULT 'email',
      recipients VARCHAR(64) NOT NULL DEFAULT 'guardian',
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_inst_type (institute_code, obligation_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS eduall_fee_alert_extra_contacts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      student_id INT NOT NULL,
      contact_label VARCHAR(120) NOT NULL,
      email VARCHAR(190) NULL,
      phone VARCHAR(30) NULL,
      whatsapp VARCHAR(30) NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_student (student_id, institute_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS eduall_fee_alert_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      student_id INT NOT NULL,
      obligation_type ENUM('propina','transporte') NOT NULL,
      alert_type ENUM('before','dueday','after','recurring','confirmation','receipt') NOT NULL,
      reference_period VARCHAR(20) NULL,
      invoice_code VARCHAR(64) NULL,
      channel ENUM('email','sms','whatsapp') NOT NULL,
      recipient_type VARCHAR(20) NOT NULL,
      recipient_name VARCHAR(190) NULL,
      recipient_contact VARCHAR(190) NULL,
      message TEXT,
      amount DECIMAL(14,2) NULL,
      scheduled_at DATETIME NOT NULL,
      sent_at DATETIME NULL,
      status ENUM('pending','processing','sent','delivered','failed','cancelled') NOT NULL DEFAULT 'pending',
      error_code VARCHAR(60) NULL,
      error_message VARCHAR(255) NULL,
      attempts INT NOT NULL DEFAULT 0,
      dedupe_key VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dedupe (dedupe_key),
      INDEX idx_inst_status (institute_code, status),
      INDEX idx_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS eduall_fee_alert_cron_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      job_key ENUM('evaluate_due','evaluate_new_payments','process_pending','process_receipts') NOT NULL,
      cron_expression VARCHAR(60) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      description VARCHAR(190) NULL,
      UNIQUE KEY uq_inst_job (institute_code, job_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  for (const sql of stmts) {
    try { await ExecuteQuery(null, sql, [], false); }
    catch (e) { console.warn("[FeeAlerts] EnsureTables aviso:", e.message); }
  }

  // ── Migração: novas colunas de dias múltiplos + hora de envio ──
  // (ALTER TABLE ... ADD COLUMN, cada um isolado num try/catch porque o
  // MySQL rebenta se a coluna já existir; assim o boot nunca falha)
  const alters = [
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN before_days_list VARCHAR(255) NOT NULL DEFAULT '3'`,
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN before_send_time VARCHAR(5) NOT NULL DEFAULT '08:00'`,
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN dueday_send_time VARCHAR(5) NOT NULL DEFAULT '08:00'`,
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN after_days_list VARCHAR(255) NOT NULL DEFAULT '3'`,
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN after_send_time VARCHAR(5) NOT NULL DEFAULT '08:00'`,
    `ALTER TABLE eduall_fee_alert_config ADD COLUMN recurring_send_time VARCHAR(5) NOT NULL DEFAULT '08:00'`,
  ];
  for (const sql of alters) {
    try { await ExecuteQuery(null, sql, [], false); }
    catch (e) { /* coluna já existe — normal a partir da 2ª vez que o servidor arranca */ }
  }
}
EnsureFeeAlertTables();

// ════════════════════════════════════════════════════════════════════════════════
// 2. HELPERS GENÉRICOS
// ════════════════════════════════════════════════════════════════════════════════

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function labelMonth(monthCode) {
  const [m, y] = String(monthCode).split(".").map(Number);
  return `${MONTH_NAMES[m] || `Mês ${m}`} de ${y}`;
}

function renderTemplate(template, vars) {
  if (!template) return "";
  return template.replace(/\[([^\]]+)\]/g, (_, key) => {
    const k = key.trim().toLowerCase();
    return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : "";
  });
}

const TEMPLATE_VARIABLES = [
  "Nome do Aluno", "Numero de Matricula", "Nome do Encarregado", "Tipo de Obrigacao",
  "Periodo", "Valor", "Data de Vencimento", "Valor Pendente", "Valor Pago",
  "Saldo Atual", "Data do Pagamento", "Numero do Recibo",
];

function buildTemplateVars({ student, obligationLabel, period, amount, dueDate,
  pendingAmount, paidAmount, currentBalance, paymentDate, receiptNumber, recipientName }) {
  return {
    "nome do aluno":        student?.ed_student_name || "",
    "numero de matricula":  student?.ed_student_code || "",
    "nome do encarregado":  recipientName || "Encarregado de Educação",
    "tipo de obrigacao":    obligationLabel || "",
    "periodo":              period || "",
    "valor":                amount != null ? formatMoney(amount) : "",
    "data de vencimento":   dueDate || "",
    "valor pendente":       pendingAmount != null ? formatMoney(pendingAmount) : "",
    "valor pago":           paidAmount != null ? formatMoney(paidAmount) : "",
    "saldo atual":          currentBalance != null ? formatMoney(currentBalance) : "",
    "data do pagamento":    paymentDate || "",
    "numero do recibo":     receiptNumber || "",
  };
}

function formatMoney(v) {
  return Number(v || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Kz";
}

/** csv "email,sms" → ["email","sms"] */
const csvToArr = (csv) => String(csv || "").split(",").map(s => s.trim()).filter(Boolean);

/** "5, 3 ,1" → [5,3,1] (inteiros positivos, sem duplicados, ordenados desc) */
function parseDaysList(csv) {
  const arr = String(csv || "")
    .split(",")
    .map(s => parseInt(String(s).trim(), 10))
    .filter(n => Number.isInteger(n) && n > 0);
  return [...new Set(arr)].sort((a, b) => b - a);
}

/** "HH:MM" → true se a hora actual (local do servidor) bate certo com a hora configurada */
function hourMatchesNow(sendTime, now = new Date()) {
  const h = parseInt(String(sendTime || "08:00").split(":")[0], 10);
  return now.getHours() === (Number.isInteger(h) ? h : 8);
}

/** Validação simples e prática — não substitui verificação de entrega real */
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}
function isValidAngolaPhone(v) {
  return /^9\d{8}$/.test(String(v || "").replace(/\s+/g, ""));
}

/** Recolhe os contactos disponíveis de um aluno: pai / mãe / encarregado (dados
 *  já existentes na tabela eduall_students), mais contactos extra. */
async function getStudentRecipients(studentId, instituteCode, allowedTypes) {
  const [student] = await ExecuteQuery(null,
    `SELECT ed_student_id, ed_student_name, ed_student_code,
            ed_student_father_name, ed_student_father_email, ed_student_father_phone,
            ed_student_mother_name, ed_student_mother_email, ed_student_mother_phone,
            ed_student_guardion_name, ed_student_guardion_email, ed_student_guardion_phone
     FROM eduall_students
     WHERE ed_student_id = ? AND ed_student_institute_code = ? AND COALESCE(ed_student_deleted,0)=0
     LIMIT 1`,
    [studentId, instituteCode], true);

  if (!student) return { student: null, recipients: [] };

  const candidates = [
    { type: "father",   name: student.ed_student_father_name,   email: student.ed_student_father_email,   phone: student.ed_student_father_phone },
    { type: "mother",    name: student.ed_student_mother_name,   email: student.ed_student_mother_email,   phone: student.ed_student_mother_phone },
    { type: "guardian",  name: student.ed_student_guardion_name, email: student.ed_student_guardion_email, phone: student.ed_student_guardion_phone },
  ].filter(c => allowedTypes.includes(c.type) && (c.email || c.phone));

  let extras = [];
  try {
    extras = await ExecuteQuery(null,
      `SELECT id, contact_label, email, phone, whatsapp FROM eduall_fee_alert_extra_contacts
       WHERE student_id = ? AND institute_code = ? AND deleted = 0`,
      [studentId, instituteCode], true);
  } catch { /* ignora se a tabela ainda não existir na 1ª execução */ }

  if (allowedTypes.includes("extra")) {
    extras.forEach(e => candidates.push({
      type: "extra", name: e.contact_label, email: e.email, phone: e.phone, whatsapp: e.whatsapp,
    }));
  }

  return { student, recipients: candidates };
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. CONFIGURAÇÃO — CRUD (persistida por instituto — só se configura 1 vez)
// ════════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG_ROW = (obligationType) => ({
  obligation_type: obligationType, enabled: 0, due_day: 10,

  before_enabled: 0, before_days_list: "3", before_send_time: "08:00", before_message:
    "Prezado(a) [Nome do Encarregado], a [Tipo de Obrigacao] do aluno [Nome do Aluno] (matrícula [Numero de Matricula]), referente a [Periodo], no valor de [Valor], vence em [Data de Vencimento].",

  dueday_enabled: 0, dueday_send_time: "08:00", dueday_message:
    "Prezado(a) [Nome do Encarregado], a [Tipo de Obrigacao] do aluno [Nome do Aluno] referente a [Periodo] vence hoje. Valor: [Valor].",

  after_enabled: 0, after_days_list: "3", after_send_time: "08:00", after_message:
    "Prezado(a) [Nome do Encarregado], a [Tipo de Obrigacao] do aluno [Nome do Aluno] referente a [Periodo] encontra-se em atraso. Valor pendente: [Valor Pendente]. Agradecemos a regularização.",

  recurring_enabled: 0, recurring_every_days: 7, recurring_send_time: "08:00", recurring_message:
    "Prezado(a) [Nome do Encarregado], lembramos que a [Tipo de Obrigacao] do aluno [Nome do Aluno] referente a [Periodo] continua pendente. Valor: [Valor Pendente].",

  confirmation_enabled: 0, confirmation_message:
    "Informamos que foi registado o pagamento de [Valor Pago] referente a [Tipo de Obrigacao] do aluno [Nome do Aluno], período [Periodo].",

  receipt_enabled: 0, receipt_delay_minutes: 10, receipt_message:
    "Segue o comprovativo do pagamento nº [Numero do Recibo] do aluno [Nome do Aluno], no valor de [Valor Pago].",

  channels: "email", recipients: "guardian",
});

const CONFIG_COLS = [
  "enabled","due_day",
  "before_enabled","before_days_list","before_send_time","before_message",
  "dueday_enabled","dueday_send_time","dueday_message",
  "after_enabled","after_days_list","after_send_time","after_message",
  "recurring_enabled","recurring_every_days","recurring_send_time","recurring_message",
  "confirmation_enabled","confirmation_message",
  "receipt_enabled","receipt_delay_minutes","receipt_message",
  "channels","recipients",
];

/** GET /eduallfeealertsconfig/get — devolve as 3 configs já guardadas para esta escola */
const GetFeeAlertConfig = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const cacheKey = `feealerts:config:${institute}`;
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) return res.status(200).json(cached);

    const rows = await ExecuteQuery(null,
      `SELECT * FROM eduall_fee_alert_config WHERE institute_code = ?`, [institute], true);

    const byType = {};
    ["propina", "transporte", "confirmacao"].forEach(t => {
      const found = rows.find(r => r.obligation_type === t);
      byType[t] = found ? found : DEFAULT_CONFIG_ROW(t);
    });

    const result = { success: true, config: byType, availableVariables: TEMPLATE_VARIABLES };
    await Cache.eduallSet(cacheKey, result, 1800);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[GetFeeAlertConfig]", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/** PUT /eduallfeealertsconfig/put — grava e fica disponível para sempre (até ser mudada de novo) */
const UpdateFeeAlertConfig = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    if (!institute) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const { obligation_type } = req.body;
    if (!["propina", "transporte", "confirmacao"].includes(obligation_type)) {
      return res.status(400).json({ success: false, msg: "Tipo de obrigação inválido." });
    }

    const defaults = DEFAULT_CONFIG_ROW(obligation_type);
    const merged = { ...defaults, ...req.body };

    // Sanitização das listas de dias — nunca deixa gravar lixo na BD
    if (merged.before_days_list != null) merged.before_days_list = parseDaysList(merged.before_days_list).join(",") || "3";
    if (merged.after_days_list  != null) merged.after_days_list  = parseDaysList(merged.after_days_list).join(",")  || "3";

    const setClause = CONFIG_COLS.map(c => `${c} = VALUES(${c})`).join(", ");
    const insertCols = ["institute_code", "obligation_type", ...CONFIG_COLS, "updated_by"].join(", ");
    const placeholders = insertCols.split(", ").map(() => "?").join(", ");
    const values = [
      institute, obligation_type,
      ...CONFIG_COLS.map(c => merged[c] ?? defaults[c]),
      operatorId || null,
    ];

    await ExecuteQuery(null,
      `INSERT INTO eduall_fee_alert_config (${insertCols}) VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${setClause}, updated_by = VALUES(updated_by)`,
      values, false);

    await Cache.eduallClear(`feealerts:config:${institute}`);

    await RegisterAuditAction({
      session: req.session, action: 2, form: "Alertas de Propinas/Transporte",
      description: `Atualizou a configuração de alertas para "${obligation_type}".`,
    });

    return res.status(200).json({ success: true, msg: "Configuração guardada com sucesso." });
  } catch (err) {
    console.error("[UpdateFeeAlertConfig]", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 4. CONTACTOS — listar / adicionar / editar / apagar / validar
// ════════════════════════════════════════════════════════════════════════════════

/** GET /eduallfeealertscontacts/get/:STUDENTID
 *  Devolve pai/mãe/encarregado (do cadastro do aluno, não editáveis aqui) +
 *  contactos extra (editáveis), cada um já com flags de validade. */
const GetStudentAlertContacts = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { STUDENTID } = req.params;

    const [student] = await ExecuteQuery(null,
      `SELECT ed_student_id, ed_student_name, ed_student_code,
              ed_student_father_name, ed_student_father_email, ed_student_father_phone,
              ed_student_mother_name, ed_student_mother_email, ed_student_mother_phone,
              ed_student_guardion_name, ed_student_guardion_email, ed_student_guardion_phone
       FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND COALESCE(ed_student_deleted,0)=0
       LIMIT 1`,
      [STUDENTID, institute], true);

    if (!student) return res.status(404).json({ success: false, msg: "Aluno não encontrado." });

    const builtIn = [
      { source: "cadastro", type: "father",   label: "Pai",          name: student.ed_student_father_name,   email: student.ed_student_father_email,   phone: student.ed_student_father_phone },
      { source: "cadastro", type: "mother",    label: "Mãe",          name: student.ed_student_mother_name,   email: student.ed_student_mother_email,   phone: student.ed_student_mother_phone },
      { source: "cadastro", type: "guardian",  label: "Encarregado",  name: student.ed_student_guardion_name, email: student.ed_student_guardion_email, phone: student.ed_student_guardion_phone },
    ].filter(c => c.name || c.email || c.phone);

    const extras = await ExecuteQuery(null,
      `SELECT id, contact_label, email, phone, whatsapp FROM eduall_fee_alert_extra_contacts
       WHERE student_id = ? AND institute_code = ? AND deleted = 0 ORDER BY id DESC`,
      [STUDENTID, institute], true);

    const withFlags = (arr) => arr.map(c => ({
      ...c,
      emailValid: c.email ? isValidEmail(c.email) : null,
      phoneValid: c.phone ? isValidAngolaPhone(c.phone) : null,
    }));

    return res.status(200).json({
      success: true,
      student: { id: student.ed_student_id, name: student.ed_student_name, code: student.ed_student_code },
      builtIn: withFlags(builtIn),
      extra: withFlags(extras.map(e => ({
        id: e.id, source: "extra", type: "extra",
        label: e.contact_label, name: e.contact_label,
        email: e.email, phone: e.phone, whatsapp: e.whatsapp,
      }))),
    });
  } catch (err) {
    console.error("[GetStudentAlertContacts]", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/** POST /eduallfeealertscontacts/post — cria contacto extra (validado) */
const SaveExtraContact = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { student_id, contact_label, email, phone, whatsapp } = req.body;

    if (!student_id || !contact_label || !String(contact_label).trim()) {
      return res.status(400).json({ success: false, msg: "Aluno e nome do contacto são obrigatórios." });
    }
    if (!email && !phone && !whatsapp) {
      return res.status(400).json({ success: false, msg: "Indique pelo menos um meio de contacto." });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ success: false, msg: "O email indicado não parece válido." });
    }
    if (phone && !isValidAngolaPhone(phone)) {
      return res.status(400).json({ success: false, msg: "O telefone deve ter 9 dígitos e começar por 9 (ex: 923456789)." });
    }
    if (whatsapp && !isValidAngolaPhone(whatsapp)) {
      return res.status(400).json({ success: false, msg: "O WhatsApp deve ter 9 dígitos e começar por 9 (ex: 923456789)." });
    }

    await ExecuteQuery(null,
      `INSERT INTO eduall_fee_alert_extra_contacts
        (institute_code, student_id, contact_label, email, phone, whatsapp)
       VALUES (?,?,?,?,?,?)`,
      [institute, student_id, String(contact_label).trim(), email || null, phone || null, whatsapp || null], false);

    await RegisterAuditAction({
      session: req.session, action: 1, form: "Alertas de Propinas/Transporte",
      description: `Adicionou contacto extra "${contact_label}" para o aluno #${student_id}.`,
    });

    return res.status(200).json({ success: true, msg: "Contacto adicionado." });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/** PUT /eduallfeealertscontacts/update/:ID — edita contacto extra (validado) */
const UpdateExtraContact = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { ID } = req.params;
    const { contact_label, email, phone, whatsapp } = req.body;

    if (!contact_label || !String(contact_label).trim()) {
      return res.status(400).json({ success: false, msg: "Nome do contacto é obrigatório." });
    }
    if (!email && !phone && !whatsapp) {
      return res.status(400).json({ success: false, msg: "Indique pelo menos um meio de contacto." });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ success: false, msg: "O email indicado não parece válido." });
    }
    if (phone && !isValidAngolaPhone(phone)) {
      return res.status(400).json({ success: false, msg: "O telefone deve ter 9 dígitos e começar por 9 (ex: 923456789)." });
    }
    if (whatsapp && !isValidAngolaPhone(whatsapp)) {
      return res.status(400).json({ success: false, msg: "O WhatsApp deve ter 9 dígitos e começar por 9 (ex: 923456789)." });
    }

    await ExecuteQuery(null,
      `UPDATE eduall_fee_alert_extra_contacts
       SET contact_label = ?, email = ?, phone = ?, whatsapp = ?
       WHERE id = ? AND institute_code = ? AND deleted = 0`,
      [String(contact_label).trim(), email || null, phone || null, whatsapp || null, ID, institute], false);

    return res.status(200).json({ success: true, msg: "Contacto atualizado." });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/** DELETE /eduallfeealertscontacts/delete/:ID — apaga (soft delete) contacto extra */
const DeleteExtraContact = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    await ExecuteQuery(null,
      `UPDATE eduall_fee_alert_extra_contacts SET deleted = 1 WHERE id = ? AND institute_code = ?`,
      [ID, institute], false);
    return res.status(200).json({ success: true, msg: "Contacto removido." });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 5. MOTOR DE REGRAS — múltiplos dias + hora de envio
// ════════════════════════════════════════════════════════════════════════════════

function currentMonthCode(date = new Date()) {
  return `${date.getMonth()}.${date.getFullYear()}`;
}
function daysBetween(dateA, dateB) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((dateA.setHours(0,0,0,0) - dateB.setHours(0,0,0,0)) / MS);
}

async function EvaluateAndQueueAlerts(instituteCode, obligationType) {
  const [config] = await ExecuteQuery(null,
    `SELECT * FROM eduall_fee_alert_config WHERE institute_code = ? AND obligation_type = ?`,
    [instituteCode, obligationType], true);

  if (!config || !config.enabled) return { queued: 0, skipped: "config_disabled" };

  const table = obligationType === "propina" ? "eduall_fees_payments" : "eduall_transport_payments";
  const studentCol = obligationType === "propina" ? "ed_fee_payment_student" : "ed_transport_payment_student";
  const monthCol   = obligationType === "propina" ? "ed_fee_payment_month"   : "ed_transport_payment_month";
  const instCol    = obligationType === "propina" ? "ed_fee_payment_institute_code" : "ed_transport_payment_institute_code";
  const delCol     = obligationType === "propina" ? "ed_fee_payment_deleted" : "ed_transport_payment_deleted";

  const students = obligationType === "propina"
    ? await ExecuteQuery(null,
        `SELECT s.ed_student_id, s.ed_student_name, s.ed_student_code, s.ed_student_class
         FROM eduall_students s
         INNER JOIN eduall_class cls ON cls.ed_class_id = s.ed_student_class AND COALESCE(cls.ed_class_deleted,0)=0
         WHERE s.ed_student_institute_code = ? AND COALESCE(s.ed_student_deleted,0)=0
           AND COALESCE(s.ed_student_dropout,0)=0 AND COALESCE(s.ed_student_transferred,0)=0`,
        [instituteCode], true)
    : await ExecuteQuery(null,
        `SELECT s.ed_student_id, s.ed_student_name, s.ed_student_code
         FROM eduall_transport_passengers tp
         INNER JOIN eduall_students s ON s.ed_student_id = tp.ed_transport_passenger_code
         WHERE tp.ed_transport_passenger_institute_code = ? AND tp.ed_transport_passenger_deleted = 0
           AND COALESCE(s.ed_student_deleted,0)=0`,
        [instituteCode], true);

  if (!students.length) return { queued: 0, skipped: "no_students" };

  const dueDay = Math.min(28, Math.max(1, config.due_day || 10));
  const monthCode = currentMonthCode();
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const daysToDue = daysBetween(new Date(dueDate), new Date()); // >0 futuro, 0 hoje, <0 atrasado

  const beforeDaysList = parseDaysList(config.before_days_list);
  const afterDaysList  = parseDaysList(config.after_days_list);
  const maxAfterDay    = afterDaysList.length ? Math.max(...afterDaysList) : 0;

  let queued = 0;

  for (const st of students) {
    const [paid] = await ExecuteQuery(null,
      `SELECT 1 FROM ${table} WHERE ${studentCol} = ? AND ${monthCol} = ?
         AND ${instCol} = ? AND COALESCE(${delCol},0)=0 LIMIT 1`,
      [st.ed_student_id, monthCode, instituteCode], true);

    if (paid) continue; // nunca alertar quem já pagou

    // Determina TODOS os alertas que se aplicam agora (podem ser vários se
    // vários tipos coincidirem na mesma hora — cada um tem dedupe próprio)
    const firing = [];

    if (config.before_enabled && daysToDue > 0
        && beforeDaysList.includes(daysToDue)
        && hourMatchesNow(config.before_send_time, now)) {
      firing.push({ alertType: "before", messageTpl: config.before_message, dayTag: daysToDue });
    }
    if (config.dueday_enabled && daysToDue === 0
        && hourMatchesNow(config.dueday_send_time, now)) {
      firing.push({ alertType: "dueday", messageTpl: config.dueday_message, dayTag: 0 });
    }
    if (config.after_enabled && daysToDue < 0
        && afterDaysList.includes(Math.abs(daysToDue))
        && hourMatchesNow(config.after_send_time, now)) {
      firing.push({ alertType: "after", messageTpl: config.after_message, dayTag: daysToDue });
    }
    if (config.recurring_enabled && daysToDue < 0
        && hourMatchesNow(config.recurring_send_time, now)) {
      const lateDays = Math.abs(daysToDue);
      const every = config.recurring_every_days || 7;
      if (lateDays > maxAfterDay && (lateDays - maxAfterDay) % every === 0) {
        firing.push({ alertType: "recurring", messageTpl: config.recurring_message, dayTag: daysToDue });
      }
    }

    if (!firing.length) continue;

    const obligationLabel = obligationType === "propina" ? "Propina" : "Transporte";
    const period = labelMonth(monthCode);
    const recipientTypes = csvToArr(config.recipients);
    const channels = csvToArr(config.channels);
    const { student, recipients } = await getStudentRecipients(st.ed_student_id, instituteCode, recipientTypes);
    if (!student || !recipients.length) continue;

    const vars = buildTemplateVars({
      student, obligationLabel, period,
      dueDate: dueDate.toLocaleDateString("pt-PT"),
      pendingAmount: null, amount: null,
    });

    for (const rule of firing) {
      for (const recipient of recipients) {
        for (const channel of channels) {
          if (channel === "email" && !recipient.email) continue;
          if ((channel === "sms" || channel === "whatsapp") && !(recipient.phone || recipient.whatsapp)) continue;

          const recipientVars = { ...vars, "nome do encarregado": recipient.name || vars["nome do encarregado"] };
          const message = renderTemplate(rule.messageTpl, recipientVars);
          const dedupeKey = `${obligationType}:${st.ed_student_id}:${monthCode}:${rule.alertType}:${rule.dayTag}:${recipient.type}:${channel}`;

          try {
            const result = await ExecuteQuery(null,
              `INSERT IGNORE INTO eduall_fee_alert_notifications
                (institute_code, student_id, obligation_type, alert_type, reference_period,
                 channel, recipient_type, recipient_name, recipient_contact, message,
                 scheduled_at, status, dedupe_key)
               VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
              [instituteCode, st.ed_student_id, obligationType, rule.alertType, monthCode,
               channel, recipient.type, recipient.name || null,
               channel === "email" ? recipient.email : (recipient.whatsapp || recipient.phone),
               message, now, dedupeKey], false);
            if (result?.affectedRows) queued++;
          } catch (e) {
            console.warn("[EvaluateAndQueueAlerts] dedupe/insert aviso:", e.message);
          }
        }
      }
    }
  }

  return { queued };
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. PROCESSAMENTO / ENVIO — RE-VERIFICA antes de enviar
// ════════════════════════════════════════════════════════════════════════════════

async function sendAlertEmail(to, subject, htmlBody) {
  const transporter = nodeMailer.createTransport(MailOptions());
  await transporter.sendMail({ from: process.env.MAIL_APP_USER, to, subject, html: htmlBody });
}

async function sendAlertSms(phone, message) {
  const numeroFormatado = String(phone).replace(/\s+/g, "");
  if (!isValidAngolaPhone(numeroFormatado)) {
    const e = new Error("Número de telefone inválido."); e.code = "INVALID_PHONE"; throw e;
  }
  const { status, data } = await axios.post("https://www.telcosms.co.ao/send_message", {
    message: { api_key_app: "prdd0cf231ad82fcfa9c4c8654742", phone_number: numeroFormatado, message_body: message },
  }, { headers: { "Content-Type": "application/json" } });
  if (status !== 200 && status !== 201) {
    const e = new Error("Falha ao enviar SMS."); e.code = "SMS_GATEWAY_FAILED"; throw e;
  }
  return data;
}

async function sendAlertWhatsapp() {
  const e = new Error("Canal WhatsApp ainda não está configurado nesta instituição.");
  e.code = "WHATSAPP_NOT_CONFIGURED";
  throw e;
}

async function isStillPending(obligationType, studentId, referencePeriod, instituteCode) {
  const table = obligationType === "propina" ? "eduall_fees_payments" : "eduall_transport_payments";
  const studentCol = obligationType === "propina" ? "ed_fee_payment_student" : "ed_transport_payment_student";
  const monthCol   = obligationType === "propina" ? "ed_fee_payment_month"   : "ed_transport_payment_month";
  const instCol    = obligationType === "propina" ? "ed_fee_payment_institute_code" : "ed_transport_payment_institute_code";
  const delCol     = obligationType === "propina" ? "ed_fee_payment_deleted" : "ed_transport_payment_deleted";

  const [paid] = await ExecuteQuery(null,
    `SELECT 1 FROM ${table} WHERE ${studentCol} = ? AND ${monthCol} = ? AND ${instCol} = ?
       AND COALESCE(${delCol},0) = 0 LIMIT 1`,
    [studentId, referencePeriod, instituteCode], true);
  return !paid;
}

async function ProcessPendingNotifications(instituteCode, limit = 200) {
  const pending = await ExecuteQuery(null,
    `SELECT * FROM eduall_fee_alert_notifications
     WHERE institute_code = ? AND status IN ('pending') AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC LIMIT ?`,
    [instituteCode, limit], true);

  let sent = 0, cancelled = 0, failed = 0;

  for (const n of pending) {
    try {
      const lockResult = await ExecuteQuery(null,
        `UPDATE eduall_fee_alert_notifications SET status='processing', attempts = attempts + 1
         WHERE id = ? AND status = 'pending'`, [n.id], false);
      if (!lockResult?.affectedRows) continue;

      if (["before", "dueday", "after", "recurring"].includes(n.alert_type)) {
        const stillPending = await isStillPending(n.obligation_type, n.student_id, n.reference_period, instituteCode);
        if (!stillPending) {
          await ExecuteQuery(null,
            `UPDATE eduall_fee_alert_notifications SET status='cancelled', error_message='Obrigação já paga antes do envio.' WHERE id = ?`,
            [n.id], false);
          cancelled++;
          continue;
        }
      }

      if (!n.recipient_contact) {
        throw Object.assign(new Error("Contacto do destinatário não disponível."), { code: "NO_CONTACT" });
      }

      if (n.channel === "email") {
        await sendAlertEmail(n.recipient_contact, `Eduall — ${obligationLabelOf(n.obligation_type, n.alert_type)}`, n.message.replace(/\n/g, "<br/>"));
      } else if (n.channel === "sms") {
        await sendAlertSms(n.recipient_contact, n.message);
      } else if (n.channel === "whatsapp") {
        await sendAlertWhatsapp(n.recipient_contact, n.message);
      }

      await ExecuteQuery(null,
        `UPDATE eduall_fee_alert_notifications SET status='sent', sent_at = NOW() WHERE id = ?`, [n.id], false);
      sent++;

    } catch (err) {
      failed++;
      const friendly = mapErrorToFriendlyMessage(err);
      try {
        await ExecuteQuery(null,
          `UPDATE eduall_fee_alert_notifications
           SET status='failed', error_code = ?, error_message = ? WHERE id = ?`,
          [err.code || "SEND_FAILED", friendly, n.id], false);
      } catch { /* nunca deixar um erro de log derrubar o loop */ }
    }
  }

  return { processed: pending.length, sent, cancelled, failed };
}

function obligationLabelOf(type, alertType) {
  const base = type === "propina" ? "Propina" : "Transporte";
  const map = { before: "Aviso de vencimento", dueday: "Vence hoje", after: "Pagamento em atraso",
    recurring: "Lembrete", confirmation: "Confirmação de pagamento", receipt: "Recibo" };
  return `${base} — ${map[alertType] || ""}`;
}

function mapErrorToFriendlyMessage(err) {
  const code = err.code || "";
  const msg = String(err.message || "");
  if (code === "NO_CONTACT") return "Contacto do encarregado não disponível para este canal.";
  if (code === "INVALID_PHONE") return "Número de telefone inválido.";
  if (code === "SMS_GATEWAY_FAILED") return "Falha na plataforma de envio de SMS.";
  if (code === "WHATSAPP_NOT_CONFIGURED") return "WhatsApp não está configurado para esta instituição.";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("timeout"))
    return "Serviço externo temporariamente indisponível.";
  if (msg.toLowerCase().includes("credit") || msg.toLowerCase().includes("crédito"))
    return "Créditos de SMS insuficientes.";
  return "Não foi possível concluir o envio.";
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. GANCHO DE PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════

async function QueuePaymentConfirmation({ instituteCode, studentId, obligationType, invoiceCode, amountPaid, months = [], session }) {
  try {
    const [config] = await ExecuteQuery(null,
      `SELECT * FROM eduall_fee_alert_config WHERE institute_code = ? AND obligation_type = 'confirmacao'`,
      [instituteCode], true);
    if (!config || !config.enabled) return { queued: 0, skipped: "config_disabled" };
    if (!config.confirmation_enabled && !config.receipt_enabled) return { queued: 0, skipped: "nothing_enabled" };

    const recipientTypes = csvToArr(config.recipients);
    const channels = csvToArr(config.channels);
    const { student, recipients } = await getStudentRecipients(studentId, instituteCode, recipientTypes);
    if (!student || !recipients.length) return { queued: 0, skipped: "no_recipients" };

    const period = months.length ? months.map(labelMonth).join(", ") : "-";
    const obligationLabel = obligationType === "propina" ? "Propina" : "Transporte";
    const vars = buildTemplateVars({
      student, obligationLabel, period, paidAmount: amountPaid,
      paymentDate: new Date().toLocaleDateString("pt-PT"), receiptNumber: invoiceCode,
    });

    const delayMs = Math.max(0, Number(config.receipt_delay_minutes || 0)) * 60 * 1000;
    const scheduledAt = new Date(Date.now() + delayMs);
    let queued = 0;

    const jobs = [];
    if (config.confirmation_enabled) jobs.push({ alertType: "confirmation", tpl: config.confirmation_message });
    if (config.receipt_enabled)      jobs.push({ alertType: "receipt",      tpl: config.receipt_message });

    for (const recipient of recipients) {
      for (const channel of channels) {
        if (channel === "email" && !recipient.email) continue;
        if ((channel === "sms" || channel === "whatsapp") && !(recipient.phone || recipient.whatsapp)) continue;

        for (const job of jobs) {
          const recipientVars = { ...vars, "nome do encarregado": recipient.name || vars["nome do encarregado"] };
          const message = renderTemplate(job.tpl, recipientVars);
          const dedupeKey = `${obligationType}:${studentId}:${invoiceCode}:${job.alertType}:${recipient.type}:${channel}`;

          const result = await ExecuteQuery(null,
            `INSERT IGNORE INTO eduall_fee_alert_notifications
              (institute_code, student_id, obligation_type, alert_type, reference_period, invoice_code,
               channel, recipient_type, recipient_name, recipient_contact, message, amount,
               scheduled_at, status, dedupe_key)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
            [instituteCode, studentId, obligationType, job.alertType, period, invoiceCode,
             channel, recipient.type, recipient.name || null,
             channel === "email" ? recipient.email : (recipient.whatsapp || recipient.phone),
             message, amountPaid || null, scheduledAt, dedupeKey], false);
          if (result?.affectedRows) queued++;
        }
      }
    }

    if (session) {
      await RegisterAuditAction({
        session, action: 1, form: "Alertas de Propinas/Transporte",
        description: `Agendou ${queued} comunicação(ões) de confirmação/recibo para o aluno #${studentId} (fatura ${invoiceCode}).`,
      }).catch(() => {});
    }

    return { queued };
  } catch (err) {
    console.error("[QueuePaymentConfirmation] erro (não crítico):", err.message);
    return { queued: 0, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// 8. NODE-CRON — agora corre a cada 15min para respeitar a hora configurada
// ════════════════════════════════════════════════════════════════════════════════

const scheduledTasks = new Map();
const RUN_LOCK_TTL_SECONDS = 12 * 60;

async function withCronLock(jobKey, fn) {
  const lockKey = `feealerts:lock:${jobKey}`;
  const already = await Cache.eduallGet(lockKey).catch(() => null);
  if (already) { console.log(`[FeeAlerts cron] "${jobKey}" já está a correr — a saltar.`); return; }
  await Cache.eduallSet(lockKey, true, RUN_LOCK_TTL_SECONDS);
  try { await fn(); }
  finally { await Cache.eduallClear(lockKey).catch(() => {}); }
}

async function getActiveInstitutes() {
  const rows = await ExecuteQuery(null,
    `SELECT ed_institute_code FROM eduall_institutes WHERE COALESCE(ed_institute_deleted,0)=0`, [], true)
    .catch(() => []);
  return (rows || []).map(r => r.ed_institute_code);
}

async function runEvaluateDueJob() {
  await withCronLock("evaluate_due", async () => {
    const institutes = await getActiveInstitutes();
    for (const inst of institutes) {
      for (const type of ["propina", "transporte"]) {
        try {
          const r = await EvaluateAndQueueAlerts(inst, type);
          if (r.queued) console.log(`[FeeAlerts cron] evaluate_due ${inst}/${type} → ${JSON.stringify(r)}`);
        } catch (e) { console.warn(`[FeeAlerts cron] evaluate_due erro ${inst}/${type}:`, e.message); }
      }
    }
  });
}

async function runProcessPendingJob() {
  await withCronLock("process_pending", async () => {
    const institutes = await getActiveInstitutes();
    for (const inst of institutes) {
      try {
        const r = await ProcessPendingNotifications(inst);
        if (r.processed) console.log(`[FeeAlerts cron] process_pending ${inst} → ${JSON.stringify(r)}`);
      } catch (e) { console.warn(`[FeeAlerts cron] process_pending erro ${inst}:`, e.message); }
    }
  });
}

/** Corre a cada 15min entre as 06h-22h — permite respeitar a hora escolhida
 *  pela escola para cada tipo de alerta (o gate de hora está em hourMatchesNow). */
function StartFeeAlertsScheduler() {
  scheduledTasks.set("evaluate_due", cron.schedule("*/15 6-22 * * *", runEvaluateDueJob));
  scheduledTasks.set("process_pending", cron.schedule("*/15 6-22 * * *", runProcessPendingJob));
  console.log("[FeeAlerts] Agendador (node-cron) iniciado — evaluate_due & process_pending a cada 15min (06h-22h).");
}

// ════════════════════════════════════════════════════════════════════════════════
// 9. ENDPOINTS — histórico / agendamentos / falhas / indicadores / execução manual
// ════════════════════════════════════════════════════════════════════════════════

const GetNotificationHistory = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { status, channel, obligationType, studentId, from, to, page = 1, pageSize = 30 } = req.query;

    const where = [`n.institute_code = ?`, `n.status IN ('sent','delivered','failed','cancelled')`];
    const params = [institute];

    if (status && status !== "all")         { where.push(`n.status = ?`); params.push(status); }
    if (channel && channel !== "all")        { where.push(`n.channel = ?`); params.push(channel); }
    if (obligationType && obligationType !== "all") { where.push(`n.obligation_type = ?`); params.push(obligationType); }
    if (studentId)                           { where.push(`n.student_id = ?`); params.push(studentId); }
    if (from)                                { where.push(`n.scheduled_at >= ?`); params.push(from); }
    if (to)                                  { where.push(`n.scheduled_at <= ?`); params.push(to); }

    const offset = (Math.max(1, page) - 1) * pageSize;

    const rows = await ExecuteQuery(null,
      `SELECT n.*, s.ed_student_name, s.ed_student_code
       FROM eduall_fee_alert_notifications n
       LEFT JOIN eduall_students s ON s.ed_student_id = n.student_id
       WHERE ${where.join(" AND ")}
       ORDER BY n.scheduled_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), Number(offset)], true);

    const [{ total }] = await ExecuteQuery(null,
      `SELECT COUNT(*) AS total FROM eduall_fee_alert_notifications n WHERE ${where.join(" AND ")}`,
      params, true);

    return res.status(200).json({ success: true, data: rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) {
    console.error("[GetNotificationHistory]", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const GetUpcomingAlerts = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const rows = await ExecuteQuery(null,
      `SELECT n.*, s.ed_student_name, s.ed_student_code
       FROM eduall_fee_alert_notifications n
       LEFT JOIN eduall_students s ON s.ed_student_id = n.student_id
       WHERE n.institute_code = ? AND n.status = 'pending'
       ORDER BY n.scheduled_at ASC
       LIMIT 100`,
      [institute], true);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const GetFailedNotifications = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const rows = await ExecuteQuery(null,
      `SELECT n.*, s.ed_student_name, s.ed_student_code
       FROM eduall_fee_alert_notifications n
       LEFT JOIN eduall_students s ON s.ed_student_id = n.student_id
       WHERE n.institute_code = ? AND n.status = 'failed'
       ORDER BY n.scheduled_at DESC
       LIMIT 150`,
      [institute], true);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const RetryFailedNotification = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { id } = req.body;
    await ExecuteQuery(null,
      `UPDATE eduall_fee_alert_notifications
       SET status = 'pending', scheduled_at = NOW(), error_code = NULL, error_message = NULL
       WHERE id = ? AND institute_code = ? AND status = 'failed'`,
      [id, institute], false);
    return res.status(200).json({ success: true, msg: "Notificação reagendada para reenvio." });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const GetAlertIndicators = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const cacheKey = `feealerts:indicators:${institute}`;
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) return res.status(200).json(cached);

    const [counts] = await ExecuteQuery(null,
      `SELECT
         SUM(status='pending')   AS pending,
         SUM(status='sent')      AS sent,
         SUM(status='delivered') AS delivered,
         SUM(status='failed')    AS failed,
         SUM(status='cancelled') AS cancelled,
         COUNT(DISTINCT CASE WHEN status IN ('sent','delivered') THEN student_id END) AS notified_guardians
       FROM eduall_fee_alert_notifications
       WHERE institute_code = ?`, [institute], true);

    const recoveryRows = await ExecuteQuery(null,
      `SELECT n.student_id, n.reference_period, n.sent_at
       FROM eduall_fee_alert_notifications n
       WHERE n.institute_code = ? AND n.obligation_type = 'propina'
         AND n.alert_type IN ('after','recurring') AND n.status IN ('sent','delivered')`,
      [institute], true);

    let recovered = 0;
    for (const r of recoveryRows) {
      const [paidAfter] = await ExecuteQuery(null,
        `SELECT 1 FROM eduall_fees_payments
         WHERE ed_fee_payment_student = ? AND ed_fee_payment_month = ?
           AND ed_fee_payment_institute_code = ? AND COALESCE(ed_fee_payment_deleted,0)=0
           AND ed_fee_payment_registerDate >= ? LIMIT 1`,
        [r.student_id, r.reference_period, institute, r.sent_at], true);
      if (paidAfter) recovered++;
    }
    const recoveryRate = recoveryRows.length ? Math.round((recovered / recoveryRows.length) * 100) : null;

    const result = {
      success: true,
      indicators: {
        pending:   Number(counts?.pending || 0),
        sent:      Number(counts?.sent || 0),
        delivered: Number(counts?.delivered || 0),
        failed:    Number(counts?.failed || 0),
        cancelled: Number(counts?.cancelled || 0),
        notifiedGuardians: Number(counts?.notified_guardians || 0),
        recoveryRate,
      },
    };
    await Cache.eduallSet(cacheKey, result, 600);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[GetAlertIndicators]", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const ManualRunProcessing = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const propina     = await EvaluateAndQueueAlerts(institute, "propina");
    const transporte   = await EvaluateAndQueueAlerts(institute, "transporte");
    const processed    = await ProcessPendingNotifications(institute);

    await Cache.eduallClear(`feealerts:indicators:${institute}`);

    await RegisterAuditAction({
      session: req.session, action: 1, form: "Alertas de Propinas/Transporte",
      description: `Executou processamento manual. Agendados: propina=${propina.queued||0}, transporte=${transporte.queued||0}. Processados: ${JSON.stringify(processed)}.`,
    });

    return res.status(200).json({ success: true, propina, transporte, processed });
  } catch (err) {
    console.error("[ManualRunProcessing]", err);
    return res.status(500).json({ success: false, msg: "Erro ao processar alertas.", error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 10. EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetFeeAlertConfig, UpdateFeeAlertConfig,
  GetStudentAlertContacts, SaveExtraContact, UpdateExtraContact, DeleteExtraContact,
  GetNotificationHistory, GetUpcomingAlerts, GetFailedNotifications, RetryFailedNotification,
  GetAlertIndicators,
  StartFeeAlertsScheduler,
  ManualRunProcessing,
  QueuePaymentConfirmation,
  EvaluateAndQueueAlerts, ProcessPendingNotifications,
};