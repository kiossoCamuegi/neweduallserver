// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");
const bcrypt = require("bcryptjs");

const getInstituteCode = (req) => req.session?.user?.eduall_user_session_curentinstitute;
const getUserId = (req) => req.session?.user?.eduall_user_session_ID;

const RequirePrincipalPortalAccess = async (req, res, next) => {
  try {
    const instituteCode = getInstituteCode(req);
    const userId = getUserId(req);
    if (!instituteCode || !userId) return res.status(401).json({ message: "Sessão inválida." });
    const _accessKey = `principalPortal:${instituteCode}:access:${userId}`; // CACHE-OPT v5
    if ((await _cacheGet(_accessKey)) === 1) return next();

    const accounts = await ExecuteQuery(res, `SELECT ed_system_account_id FROM eduall_system_accounts WHERE ed_system_account_userid = ? AND ed_system_account_institute_code = ? AND ed_system_account_app_type IS NULL AND ed_system_account_deleted = 0 LIMIT 1`, [userId, instituteCode], true, { db: "eduall_system_accounts", type: "select", data: req });
    if (!accounts?.length) return res.status(403).json({ message: "É necessária uma conta activa de dashboard para aceder ao Portal da Direção." });
    await _cacheSet(_accessKey, 1, 60);
    return next();
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível validar o acesso ao Portal da Direção.", error: error.message });
  }
};

let _principalSchemaReady = false; // CACHE-OPT v5: 7x CREATE TABLE só uma vez por processo (antes: em 18 funções)
const _approvalRulesSeeded = new Set(); // CACHE-OPT v5: regras por omissão inseridas uma vez por escola e processo
const ensurePrincipalPortalSchema = async (req, res) => {
  if (_principalSchemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS eduall_principal_goals (
      ed_principal_goal_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ed_principal_goal_name VARCHAR(150) NOT NULL,
      ed_principal_goal_category VARCHAR(40) NOT NULL,
      ed_principal_goal_initial_value DECIMAL(14,2) NOT NULL DEFAULT 0,
      ed_principal_goal_target_value DECIMAL(14,2) NOT NULL DEFAULT 0,
      ed_principal_goal_current_value DECIMAL(14,2) NOT NULL DEFAULT 0,
      ed_principal_goal_unit VARCHAR(10) NOT NULL DEFAULT '',
      ed_principal_goal_inverse TINYINT(1) NOT NULL DEFAULT 0,
      ed_principal_goal_deadline DATE NULL,
      ed_principal_goal_owner VARCHAR(150) NULL,
      ed_principal_goal_description TEXT NULL,
      ed_principal_goal_status VARCHAR(30) NOT NULL DEFAULT 'Em andamento',
      ed_principal_goal_academic_year VARCHAR(100) NULL,
      ed_principal_goal_institute_code VARCHAR(100) NOT NULL,
      ed_principal_goal_deleted TINYINT(1) NOT NULL DEFAULT 0,
      ed_principal_goal_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ed_principal_goal_updated_at DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_approvals (
      ed_principal_approval_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ed_principal_approval_type VARCHAR(80) NOT NULL,
      ed_principal_approval_requester_id BIGINT NULL,
      ed_principal_approval_requester_name VARCHAR(150) NOT NULL,
      ed_principal_approval_student_id BIGINT NULL,
      ed_principal_approval_subject_id BIGINT NULL,
      ed_principal_approval_reason TEXT NULL,
      ed_principal_approval_previous_value VARCHAR(255) NULL,
      ed_principal_approval_new_value VARCHAR(255) NULL,
      ed_principal_approval_priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
      ed_principal_approval_status VARCHAR(30) NOT NULL DEFAULT 'Pendente',
      ed_principal_approval_comment TEXT NULL,
      ed_principal_approval_academic_year VARCHAR(100) NULL,
      ed_principal_approval_institute_code VARCHAR(100) NOT NULL,
      ed_principal_approval_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ed_principal_approval_resolved_at DATETIME NULL,
      ed_principal_approval_resolved_by BIGINT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_approval_rules (
      ed_principal_approval_rule_key VARCHAR(80) NOT NULL,
      ed_principal_approval_rule_active TINYINT(1) NOT NULL DEFAULT 1,
      ed_principal_approval_rule_institute_code VARCHAR(100) NOT NULL,
      PRIMARY KEY (ed_principal_approval_rule_key, ed_principal_approval_rule_institute_code)
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_announcements (
      ed_principal_announcement_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ed_principal_announcement_subject VARCHAR(200) NOT NULL,
      ed_principal_announcement_message TEXT NOT NULL,
      ed_principal_announcement_recipients VARCHAR(255) NOT NULL,
      ed_principal_announcement_priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
      ed_principal_announcement_status VARCHAR(30) NOT NULL DEFAULT 'Registado',
      ed_principal_announcement_institute_code VARCHAR(100) NOT NULL,
      ed_principal_announcement_created_by BIGINT NOT NULL,
      ed_principal_announcement_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_agenda (
      ed_principal_agenda_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ed_principal_agenda_date DATETIME NOT NULL,
      ed_principal_agenda_title VARCHAR(200) NOT NULL,
      ed_principal_agenda_type VARCHAR(80) NOT NULL,
      ed_principal_agenda_note VARCHAR(255) NULL,
      ed_principal_agenda_institute_code VARCHAR(100) NOT NULL,
      ed_principal_agenda_created_by BIGINT NOT NULL,
      ed_principal_agenda_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_preferences (
      ed_principal_preference_key VARCHAR(80) NOT NULL,
      ed_principal_preference_value TINYINT(1) NOT NULL DEFAULT 0,
      ed_principal_preference_institute_code VARCHAR(100) NOT NULL,
      PRIMARY KEY (ed_principal_preference_key, ed_principal_preference_institute_code)
    )`,
    `CREATE TABLE IF NOT EXISTS eduall_principal_document_signatures (
      ed_principal_document_signature_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ed_principal_document_signature_declaration_id BIGINT NOT NULL,
      ed_principal_document_signature_institute_code VARCHAR(100) NOT NULL,
      ed_principal_document_signature_user_id BIGINT NOT NULL,
      ed_principal_document_signature_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_principal_document_signature (ed_principal_document_signature_declaration_id, ed_principal_document_signature_institute_code)
    )`
  ];

  for (const statement of statements) {
    await ExecuteQuery(res, statement, [], false, {
      db: "principal_portal_schema",
      type: "create",
      data: req
    });
  }
  _principalSchemaReady = true;
};

const audit = async (req, res, action, description, form) => {
  await RegisterAuditAction({ session: req.session, req, res, action, description, form });
};

const GetDashboardSummary = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    if (!instituteCode) return res.status(401).json({ message: "Sessão sem instituto seleccionado." });

    await ensurePrincipalPortalSchema(req, res);
    const [students, employees, classes, approvals] = await Promise.all([
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_students WHERE COALESCE(ed_student_deleted, 0) = 0 AND ed_student_institute_code = ?", [instituteCode], true, { db: "eduall_students", type: "select", data: req }),
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_employees WHERE COALESCE(ed_employee_deleted, 0) = 0 AND ed_employee_institute_code = ?", [instituteCode], true, { db: "eduall_employees", type: "select", data: req }),
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_class WHERE COALESCE(ed_class_deleted, 0) = 0 AND ed_class_institute_code = ?", [instituteCode], true, { db: "eduall_class", type: "select", data: req }),
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_principal_approvals WHERE ed_principal_approval_institute_code = ? AND ed_principal_approval_status = 'Pendente'", [instituteCode], true, { db: "eduall_principal_approvals", type: "select", data: req })
    ]);

    const pendingApprovals = Number(approvals?.[0]?.total || 0);
    return res.json({
      academicYear: req.query.anoLetivo || null,
      period: req.query.periodo || null,
      summary: `A instituição tem ${students?.[0]?.total || 0} estudantes, ${employees?.[0]?.total || 0} funcionários e ${pendingApprovals} processos pendentes de aprovação.`,
      kpis: {
        students: Number(students?.[0]?.total || 0),
        employees: Number(employees?.[0]?.total || 0),
        classes: Number(classes?.[0]?.total || 0),
        pendingApprovals
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível carregar o resumo da Direção.", error: error.message });
  }
};

const GetGoals = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:goals`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, `SELECT * FROM eduall_principal_goals WHERE ed_principal_goal_institute_code = ? AND ed_principal_goal_deleted = 0 ORDER BY ed_principal_goal_deadline ASC, ed_principal_goal_created_at DESC`, [instituteCode], true, { db: "eduall_principal_goals", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível carregar as metas.", error: error.message });
  }
};

const CreateGoal = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const { name, category, initialValue = 0, targetValue = 0, currentValue = initialValue, unit = "", inverse = false, deadline = null, owner = null, description = null, academicYear = null } = req.body;
    if (!name?.trim() || !category?.trim()) return res.status(400).json({ message: "Nome e categoria da meta são obrigatórios." });

    await ensurePrincipalPortalSchema(req, res);
    const result = await ExecuteQuery(res, `INSERT INTO eduall_principal_goals (ed_principal_goal_name, ed_principal_goal_category, ed_principal_goal_initial_value, ed_principal_goal_target_value, ed_principal_goal_current_value, ed_principal_goal_unit, ed_principal_goal_inverse, ed_principal_goal_deadline, ed_principal_goal_owner, ed_principal_goal_description, ed_principal_goal_academic_year, ed_principal_goal_institute_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [name.trim(), category.trim(), initialValue, targetValue, currentValue, unit, inverse ? 1 : 0, deadline, owner, description, academicYear, instituteCode], false, { db: "eduall_principal_goals", type: "insert", data: req });
    await audit(req, res, 1, `Criou a meta estratégica "${name.trim()}".`, "Portal da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.status(201).json({ id: result?.insertId });
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível criar a meta.", error: error.message });
  }
};

const UpdateGoal = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const goalId = req.params.id;
    const { name, category, initialValue, targetValue, currentValue, unit, inverse, deadline, owner, description, status } = req.body;
    await ensurePrincipalPortalSchema(req, res);
    const before = await ExecuteQuery(res, "SELECT * FROM eduall_principal_goals WHERE ed_principal_goal_id = ? AND ed_principal_goal_institute_code = ? AND ed_principal_goal_deleted = 0", [goalId, instituteCode], true, { db: "eduall_principal_goals", type: "select", data: req });
    if (!before?.length) return res.status(404).json({ message: "Meta não encontrada." });
    await ExecuteQuery(res, `UPDATE eduall_principal_goals SET ed_principal_goal_name = COALESCE(?, ed_principal_goal_name), ed_principal_goal_category = COALESCE(?, ed_principal_goal_category), ed_principal_goal_initial_value = COALESCE(?, ed_principal_goal_initial_value), ed_principal_goal_target_value = COALESCE(?, ed_principal_goal_target_value), ed_principal_goal_current_value = COALESCE(?, ed_principal_goal_current_value), ed_principal_goal_unit = COALESCE(?, ed_principal_goal_unit), ed_principal_goal_inverse = COALESCE(?, ed_principal_goal_inverse), ed_principal_goal_deadline = COALESCE(?, ed_principal_goal_deadline), ed_principal_goal_owner = COALESCE(?, ed_principal_goal_owner), ed_principal_goal_description = COALESCE(?, ed_principal_goal_description), ed_principal_goal_status = COALESCE(?, ed_principal_goal_status), ed_principal_goal_updated_at = NOW() WHERE ed_principal_goal_id = ? AND ed_principal_goal_institute_code = ?`, [name, category, initialValue, targetValue, currentValue, unit, typeof inverse === "boolean" ? (inverse ? 1 : 0) : null, deadline, owner, description, status, goalId, instituteCode], false, { db: "eduall_principal_goals", type: "update", data: req });
    await audit(req, res, 2, `Actualizou a meta estratégica "${before[0].ed_principal_goal_name}".`, "Portal da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível actualizar a meta.", error: error.message });
  }
};

const DeleteGoal = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const goalId = req.params.id;
    await ensurePrincipalPortalSchema(req, res);
    const goals = await ExecuteQuery(res, "SELECT ed_principal_goal_name FROM eduall_principal_goals WHERE ed_principal_goal_id = ? AND ed_principal_goal_institute_code = ? AND ed_principal_goal_deleted = 0", [goalId, instituteCode], true, { db: "eduall_principal_goals", type: "select", data: req });
    if (!goals?.length) return res.status(404).json({ message: "Meta não encontrada." });
    await ExecuteQuery(res, "UPDATE eduall_principal_goals SET ed_principal_goal_deleted = 1, ed_principal_goal_updated_at = NOW() WHERE ed_principal_goal_id = ? AND ed_principal_goal_institute_code = ?", [goalId, instituteCode], false, { db: "eduall_principal_goals", type: "delete", data: req });
    await audit(req, res, 3, `Arquivou a meta estratégica "${goals[0].ed_principal_goal_name}".`, "Portal da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível arquivar a meta.", error: error.message });
  }
};

const GetApprovals = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:approvals:${req.query.status === "historico" ? "history" : "pending"}`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    const history = req.query.status === "historico";
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, `SELECT * FROM eduall_principal_approvals WHERE ed_principal_approval_institute_code = ? AND ${history ? "ed_principal_approval_status <> 'Pendente'" : "ed_principal_approval_status = 'Pendente'"} ORDER BY ed_principal_approval_created_at DESC`, [instituteCode], true, { db: "eduall_principal_approvals", type: "select", data: req });
    await _cacheSet(_ck, rows, 60);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível carregar as aprovações.", error: error.message });
  }
};

const ResolveApproval = (status) => async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const approvalId = req.params.id;
    const { comment = "" } = req.body;
    await ensurePrincipalPortalSchema(req, res);
    const approvals = await ExecuteQuery(res, "SELECT * FROM eduall_principal_approvals WHERE ed_principal_approval_id = ? AND ed_principal_approval_institute_code = ?", [approvalId, instituteCode], true, { db: "eduall_principal_approvals", type: "select", data: req });
    const approval = approvals?.[0];
    if (!approval) return res.status(404).json({ message: "Pedido de aprovação não encontrado." });
    if (approval.ed_principal_approval_status !== "Pendente") return res.status(409).json({ message: "Este pedido já foi tratado." });

    await ExecuteQuery(res, "UPDATE eduall_principal_approvals SET ed_principal_approval_status = ?, ed_principal_approval_comment = ?, ed_principal_approval_resolved_at = NOW(), ed_principal_approval_resolved_by = ? WHERE ed_principal_approval_id = ? AND ed_principal_approval_institute_code = ?", [status, comment, getUserId(req), approvalId, instituteCode], false, { db: "eduall_principal_approvals", type: "update", data: req });
    await audit(req, res, 2, `${status} o pedido "${approval.ed_principal_approval_type}" #${approvalId}.`, "Aprovações da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true, status });
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível tratar o pedido.", error: error.message });
  }
};

const GetAuditLog = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const search = `%${String(req.query.search || "").trim()}%`;
    const module = String(req.query.modulo || "").trim();
    const rows = await ExecuteQuery(res, `SELECT a.*, u.ed_user_account_name AS user_name FROM eduall_auditory a LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = a.ed_auditory_user_code WHERE a.ed_auditory_institute_code = ? AND (a.ed_auditory_description LIKE ? OR u.ed_user_account_name LIKE ?) ${module ? "AND a.ed_auditory_form = ?" : ""} ORDER BY a.ed_auditory_registerDate DESC LIMIT 100`, module ? [instituteCode, search, search, module] : [instituteCode, search, search], true, { db: "eduall_auditory", type: "select", data: req });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível carregar a auditoria.", error: error.message });
  }
};

const GetInsights = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:insights`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const [pending, delayedGoals, failures] = await Promise.all([
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_principal_approvals WHERE ed_principal_approval_institute_code = ? AND ed_principal_approval_status = 'Pendente'", [instituteCode], true, { db: "eduall_principal_approvals", type: "select", data: req }),
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_principal_goals WHERE ed_principal_goal_institute_code = ? AND ed_principal_goal_deleted = 0 AND ed_principal_goal_deadline < CURDATE() AND ed_principal_goal_status <> 'Concluída'", [instituteCode], true, { db: "eduall_principal_goals", type: "select", data: req }),
      ExecuteQuery(res, "SELECT COUNT(*) AS total FROM eduall_auditory WHERE ed_auditory_institute_code = ? AND ed_auditory_action = 3 AND ed_auditory_registerDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)", [instituteCode], true, { db: "eduall_auditory", type: "select", data: req })
    ]);
    const insights = [];
    if (Number(pending[0]?.total || 0)) insights.push({ category: "Administrativo", severity: "Atenção", title: "Pedidos pendentes", evidence: `${pending[0].total} pedido(s) aguardam uma decisão da Direção.`, recommendation: "Reveja os pedidos pendentes e defina a decisão ou solicite esclarecimentos." });
    if (Number(delayedGoals[0]?.total || 0)) insights.push({ category: "Estratégico", severity: "Crítico", title: "Metas fora do prazo", evidence: `${delayedGoals[0].total} meta(s) ultrapassaram o prazo sem conclusão.`, recommendation: "Actualize o progresso, reavalie o prazo ou atribua um responsável." });
    if (Number(failures[0]?.total || 0)) insights.push({ category: "Auditoria", severity: "Informação", title: "Operações eliminadas", evidence: `${failures[0].total} operação(ões) de eliminação foram registadas nos últimos 30 dias.`, recommendation: "Consulte a auditoria para confirmar que as eliminações foram autorizadas." });
    await _cacheSet(_ck, insights, 60);
    return res.json(insights);
  } catch (error) {
    return res.status(500).json({ message: "Não foi possível gerar os insights.", error: error.message });
  }
};

const GetApprovalRules = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:rules`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const defaults = ["Cancelar matrícula", "Alterar nota encerrada", "Alterar turma", "Desconto superior a 20%", "Isenção de propina", "Reembolso", "Emissão gratuita de documento"];
    if (!_approvalRulesSeeded.has(instituteCode)) {
      for (const key of defaults) await ExecuteQuery(res, "INSERT IGNORE INTO eduall_principal_approval_rules (ed_principal_approval_rule_key, ed_principal_approval_rule_active, ed_principal_approval_rule_institute_code) VALUES (?, 1, ?)", [key, instituteCode], false, { db: "eduall_principal_approval_rules", type: "insert", data: req });
      _approvalRulesSeeded.add(instituteCode);
    }
    const rows = await ExecuteQuery(res, "SELECT * FROM eduall_principal_approval_rules WHERE ed_principal_approval_rule_institute_code = ? ORDER BY ed_principal_approval_rule_key", [instituteCode], true, { db: "eduall_principal_approval_rules", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ message: "Não foi possível carregar as regras de aprovação.", error: error.message }); }
};

const UpdateApprovalRule = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const key = String(req.params.key || "").trim();
    const active = Boolean(req.body.active);
    if (!key) return res.status(400).json({ message: "Regra inválida." });
    await ensurePrincipalPortalSchema(req, res);
    await ExecuteQuery(res, "INSERT INTO eduall_principal_approval_rules (ed_principal_approval_rule_key, ed_principal_approval_rule_active, ed_principal_approval_rule_institute_code) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ed_principal_approval_rule_active = VALUES(ed_principal_approval_rule_active)", [key, active ? 1 : 0, instituteCode], false, { db: "eduall_principal_approval_rules", type: "update", data: req });
    await audit(req, res, 2, `${active ? "Activou" : "Desactivou"} a regra de aprovação "${key}".`, "Aprovações da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true });
  } catch (error) { return res.status(500).json({ message: "Não foi possível actualizar a regra.", error: error.message }); }
};

const GetAnnouncements = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:announcements`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, "SELECT * FROM eduall_principal_announcements WHERE ed_principal_announcement_institute_code = ? ORDER BY ed_principal_announcement_created_at DESC", [instituteCode], true, { db: "eduall_principal_announcements", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ message: "Não foi possível carregar os comunicados.", error: error.message }); }
};

const CreateAnnouncement = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const { subject, message, recipients, priority = "Normal" } = req.body;
    if (!subject?.trim() || !message?.trim() || !Array.isArray(recipients) || !recipients.length) return res.status(400).json({ message: "Preencha assunto, mensagem e destinatários." });
    await ensurePrincipalPortalSchema(req, res);
    const result = await ExecuteQuery(res, "INSERT INTO eduall_principal_announcements (ed_principal_announcement_subject, ed_principal_announcement_message, ed_principal_announcement_recipients, ed_principal_announcement_priority, ed_principal_announcement_institute_code, ed_principal_announcement_created_by) VALUES (?, ?, ?, ?, ?, ?)", [subject.trim(), message.trim(), JSON.stringify(recipients), priority, instituteCode, getUserId(req)], false, { db: "eduall_principal_announcements", type: "insert", data: req });
    await audit(req, res, 1, `Registou o comunicado "${subject.trim()}" para ${recipients.join(", ")}.`, "Comunicação da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.status(201).json({ id: result?.insertId, status: "Registado" });
  } catch (error) { return res.status(500).json({ message: "Não foi possível registar o comunicado.", error: error.message }); }
};

const GetAgenda = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:agenda`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, "SELECT * FROM eduall_principal_agenda WHERE ed_principal_agenda_institute_code = ? ORDER BY ed_principal_agenda_date ASC", [instituteCode], true, { db: "eduall_principal_agenda", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ message: "Não foi possível carregar a agenda.", error: error.message }); }
};

const CreateAgendaEvent = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const { date, title, type, note = null } = req.body;
    if (!date || !title?.trim() || !type?.trim()) return res.status(400).json({ message: "Data, título e tipo são obrigatórios." });
    await ensurePrincipalPortalSchema(req, res);
    const result = await ExecuteQuery(res, "INSERT INTO eduall_principal_agenda (ed_principal_agenda_date, ed_principal_agenda_title, ed_principal_agenda_type, ed_principal_agenda_note, ed_principal_agenda_institute_code, ed_principal_agenda_created_by) VALUES (?, ?, ?, ?, ?, ?)", [date, title.trim(), type.trim(), note, instituteCode, getUserId(req)], false, { db: "eduall_principal_agenda", type: "insert", data: req });
    await audit(req, res, 1, `Criou o evento de agenda "${title.trim()}".`, "Comunicação da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.status(201).json({ id: result?.insertId });
  } catch (error) { return res.status(500).json({ message: "Não foi possível criar o evento.", error: error.message }); }
};

const GetPreferences = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:preferences`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, "SELECT * FROM eduall_principal_preferences WHERE ed_principal_preference_institute_code = ?", [instituteCode], true, { db: "eduall_principal_preferences", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ message: "Não foi possível carregar as preferências.", error: error.message }); }
};

const UpdatePreferences = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const preferences = req.body.preferences;
    if (!preferences || typeof preferences !== "object") return res.status(400).json({ message: "Preferências inválidas." });
    await ensurePrincipalPortalSchema(req, res);
    for (const [key, value] of Object.entries(preferences)) await ExecuteQuery(res, "INSERT INTO eduall_principal_preferences (ed_principal_preference_key, ed_principal_preference_value, ed_principal_preference_institute_code) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ed_principal_preference_value = VALUES(ed_principal_preference_value)", [key, value ? 1 : 0, instituteCode], false, { db: "eduall_principal_preferences", type: "update", data: req });
    await audit(req, res, 2, "Actualizou as preferências do Portal da Direção.", "Configurações da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true });
  } catch (error) { return res.status(500).json({ message: "Não foi possível actualizar as preferências.", error: error.message }); }
};

const GetSignableDocuments = async (req, res) => {
  try {
      const _ck = `principalPortal:${getInstituteCode(req)}:documents`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.json(_hit);
    const instituteCode = getInstituteCode(req);
    await ensurePrincipalPortalSchema(req, res);
    const rows = await ExecuteQuery(res, `SELECT d.ed_declaration_id, d.ed_declaration_effect, d.ed_declaration_with_marks, d.ed_declaration_class, s.ed_student_name, s.ed_student_code, sig.ed_principal_document_signature_created_at AS signed_at, sig.ed_principal_document_signature_user_id AS signed_by FROM eduall_declarations d LEFT JOIN eduall_students s ON s.ed_student_id = d.ed_declaration_student_code AND s.ed_student_deleted = 0 LEFT JOIN eduall_principal_document_signatures sig ON sig.ed_principal_document_signature_declaration_id = d.ed_declaration_id AND sig.ed_principal_document_signature_institute_code = d.ed_declaration_institute_code WHERE d.ed_declaration_deleted = 0 AND d.ed_declaration_institute_code = ? ORDER BY d.ed_declaration_id DESC`, [instituteCode], true, { db: "eduall_declarations", type: "select", data: req });
    await _cacheSet(_ck, rows, 60);
    return res.json(rows);
  } catch (error) { return res.status(500).json({ message: "Não foi possível carregar os documentos.", error: error.message }); }
};

const SignDocument = async (req, res) => {
  try {
    const instituteCode = getInstituteCode(req);
    const userId = getUserId(req);
    const declarationId = req.params.id;
    const pin = String(req.body.pin || "");
    if (!pin) return res.status(400).json({ message: "Introduza o PIN de confirmação." });
    await ensurePrincipalPortalSchema(req, res);
    const [document] = await ExecuteQuery(res, "SELECT ed_declaration_id, ed_declaration_effect FROM eduall_declarations WHERE ed_declaration_id = ? AND ed_declaration_institute_code = ? AND ed_declaration_deleted = 0 LIMIT 1", [declarationId, instituteCode], true, { db: "eduall_declarations", type: "select", data: req });
    if (!document) return res.status(404).json({ message: "Documento não encontrado." });
    const [user] = await ExecuteQuery(res, "SELECT ed_user_account_password FROM eduall_user_accounts WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0 LIMIT 1", [userId], true, { db: "eduall_user_accounts", type: "select", data: req });
    if (!user?.ed_user_account_password || !await bcrypt.compare(pin, user.ed_user_account_password)) return res.status(403).json({ message: "PIN inválido." });
    await ExecuteQuery(res, "INSERT INTO eduall_principal_document_signatures (ed_principal_document_signature_declaration_id, ed_principal_document_signature_institute_code, ed_principal_document_signature_user_id) VALUES (?, ?, ?)", [declarationId, instituteCode, userId], false, { db: "eduall_principal_document_signatures", type: "insert", data: req });
    await audit(req, res, 2, `Assinou internamente a declaração #${declarationId} (${document.ed_declaration_effect || "sem efeito indicado"}).`, "Documentos da Direção");
    await _cacheClear(`principalPortal:${getInstituteCode(req)}:*`);
    return res.json({ success: true });
  } catch (error) { return res.status(500).json({ message: "Não foi possível assinar o documento.", error: error.message }); }
};

module.exports = {
  RequirePrincipalPortalAccess,
  GetDashboardSummary,
  GetGoals,
  CreateGoal,
  UpdateGoal,
  DeleteGoal,
  GetApprovals,
  Approve: ResolveApproval("Aprovado"),
  Reject: ResolveApproval("Rejeitado"),
  RequestClarification: ResolveApproval("Esclarecimento"),
  GetAuditLog,
  GetInsights,
  GetApprovalRules,
  UpdateApprovalRule,
  GetAnnouncements,
  CreateAnnouncement,
  GetAgenda,
  CreateAgendaEvent,
  GetPreferences,
  UpdatePreferences,
  GetSignableDocuments,
  SignDocument
};