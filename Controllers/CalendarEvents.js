// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { RegisterAuditAction } = require("./Auditory");

const CALENDAR_EVENT_CACHE_TTL = 600;

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchCalendarEvents = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_calendar_events
    WHERE ed_calendar_event_deleted = 0
      AND ed_calendar_event_institute_code = ?
    ORDER BY ed_calendar_event_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_calendar_events",
    type: "select",
    data: req,
  });
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateCalendarEventFields = (body) => {
  const errors = [];

  if (!body.cev_title || body.cev_title.trim() === "")
    errors.push("Título do evento é obrigatório.");

  if (body.cev_title && body.cev_title.trim().length < 2)
    errors.push("Título do evento deve ter pelo menos 2 caracteres.");

  if (!body.cev_start)
    errors.push("Data/hora de início é obrigatória.");

  if (!body.cev_end)
    errors.push("Data/hora de fim é obrigatória.");

  if (!body.cev_audience || body.cev_audience.trim() === "")
    errors.push("Audiência do evento é obrigatória.");

  return errors;
};

// ─── GET todos os eventos ─────────────────────────────────────────────────────
const GetCalendarEvents = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await Cache.eduallWithCache(
      CacheKeys.calendarEvent.list(instituteCode),
      CALENDAR_EVENT_CACHE_TTL,
      () => FetchCalendarEvents(req, res, instituteCode)
    );
    res.status(200).json(rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Falha ao buscar eventos de calendário!", error: error.message });
  }
};

// ─── GET evento individual ────────────────────────────────────────────────────
const GetSingleCalendarEvent = async (req, res) => {
  try {
    const { ID } = req.params;
    const recordId = CacheKeys.parseId(ID);
    if (recordId === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Lista pequena: filtra a partir da lista em cache (uma só chave para invalidar)
    const list = await Cache.eduallWithCache(
      CacheKeys.calendarEvent.list(instituteCode),
      CALENDAR_EVENT_CACHE_TTL,
      () => FetchCalendarEvents(req, res, instituteCode)
    );
    const rows = (list || []).filter((row) => Number(row.ed_calendar_event_id) === recordId);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Evento de calendário não encontrado." });
    }
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar evento de calendário!", error: error.message });
  }
};

// ─── POST registar evento ──────────────────────────────────────────────────────
const RegisterCalendarEvent = async (req, res) => {
  try {
    const {
      cev_audience,
      cev_title,
      cev_color,
      cev_start,
      cev_end,
      cev_description,
    } = req.body;

    // Validações
    const errors = ValidateCalendarEventFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_calendar_event_id FROM eduall_calendar_events
      WHERE ed_calendar_event_deleted = 0
        AND LOWER(TRIM(ed_calendar_event_title)) = LOWER(TRIM(?))
        AND ed_calendar_event_institute_code = ?
    `;
    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [cev_title.trim(), instituteCode],
      true,
      { db: "eduall_calendar_events", type: "select", data: req }
    );
    if (existing && existing.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe um evento com o título "${cev_title.trim()}".`,
      });

    const query = `
      INSERT INTO eduall_calendar_events (
        ed_calendar_event_audience,
        ed_calendar_event_title,
        ed_calendar_event_color,
        ed_calendar_event_start,
        ed_calendar_event_end,
        ed_calendar_event_description,
        ed_calendar_event_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      cev_audience.trim(),
      cev_title.trim(),
      cev_color || "#6352ff",
      cev_start,
      cev_end,
      cev_description ? cev_description.trim() : null,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_calendar_events",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Eventos de Calendário",
      description: `Registrou evento de calendário novo (${cev_title.trim()})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterCalendarEvent: evento "${cev_title.trim()}" registado`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.calendarEvent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Evento de calendário registado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao registar evento de calendário!",
        error: error.message,
      });
  }
};

// ─── PUT atualizar evento ──────────────────────────────────────────────────────
const CalendarEventUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      cev_audience,
      cev_title,
      cev_color,
      cev_start,
      cev_end,
      cev_description,
    } = req.body;

    // Validações
    const errors = ValidateCalendarEventFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar que o evento existe
    const checkQuery = `
      SELECT ed_calendar_event_id FROM eduall_calendar_events
      WHERE ed_calendar_event_deleted = 0
        AND ed_calendar_event_id = ?
        AND ed_calendar_event_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_calendar_events",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Evento de calendário não encontrado ou já foi removido.",
        });

    // Verificar nome único (excluindo o próprio registo)
    const checkTitleQuery = `
      SELECT ed_calendar_event_id FROM eduall_calendar_events
      WHERE ed_calendar_event_deleted = 0
        AND LOWER(TRIM(ed_calendar_event_title)) = LOWER(TRIM(?))
        AND ed_calendar_event_institute_code = ?
        AND ed_calendar_event_id != ?
    `;
    const existingTitle = await ExecuteQuery(
      res,
      checkTitleQuery,
      [cev_title.trim(), instituteCode, ID],
      true,
      { db: "eduall_calendar_events", type: "select", data: req }
    );
    if (existingTitle && existingTitle.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe outro evento com o título "${cev_title.trim()}".`,
      });

    const query = `
      UPDATE eduall_calendar_events SET
        ed_calendar_event_audience = ?,
        ed_calendar_event_title = ?,
        ed_calendar_event_color = ?,
        ed_calendar_event_start = ?,
        ed_calendar_event_end = ?,
        ed_calendar_event_description = ?
      WHERE ed_calendar_event_deleted = 0
        AND ed_calendar_event_id = ?
        AND ed_calendar_event_institute_code = ?
    `;
    const PARAMS = [
      cev_audience.trim(),
      cev_title.trim(),
      cev_color || "#6352ff",
      cev_start,
      cev_end,
      cev_description ? cev_description.trim() : null,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_calendar_events",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Eventos de Calendário",
      description: `Atualizou evento de calendário (${cev_title.trim()}) com ID ${ID}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> CalendarEventUpdate: evento ${ID} atualizado`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.calendarEvent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Evento de calendário atualizado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao atualizar evento de calendário!",
        error: error.message,
      });
  }
};

// ─── DELETE (soft-delete) evento ───────────────────────────────────────────────
const CalendarEventDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_calendar_event_title FROM eduall_calendar_events
      WHERE ed_calendar_event_deleted = 0
        AND ed_calendar_event_id = ?
        AND ed_calendar_event_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_calendar_events",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Evento de calendário não encontrado ou já foi removido.",
        });

    const eventTitle = found[0].ed_calendar_event_title;

    const query = `
      UPDATE eduall_calendar_events
      SET ed_calendar_event_deleted = 1
      WHERE ed_calendar_event_deleted = 0
        AND ed_calendar_event_id = ?
        AND ed_calendar_event_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_calendar_events",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Eventos de Calendário",
      description: `Eliminou evento de calendário "${eventTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CalendarEventDelete: evento ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.calendarEvent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Evento de calendário removido com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao remover evento de calendário!",
        error: error.message,
      });
  }
};

module.exports = {
  GetCalendarEvents,
  RegisterCalendarEvent,
  GetSingleCalendarEvent,
  CalendarEventDelete,
  CalendarEventUpdate,
};