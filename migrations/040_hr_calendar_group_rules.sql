-- Calendário persistente e regras de descoberta/entrada em grupos de chat.
-- Migração aditiva e idempotente.

ALTER TABLE eduall_calendar_events
  ADD COLUMN IF NOT EXISTS ed_calendar_event_created_by INT NULL
    AFTER ed_calendar_event_employee_id,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_all_day TINYINT(1) NOT NULL DEFAULT 0
    AFTER ed_calendar_event_end,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_privacy VARCHAR(20) NOT NULL DEFAULT 'public'
    AFTER ed_calendar_event_status,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_rrule VARCHAR(255) NULL
    AFTER ed_calendar_event_privacy,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_exdates LONGTEXT NULL
    AFTER ed_calendar_event_rrule,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_attendees LONGTEXT NULL
    AFTER ed_calendar_event_exdates,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_location VARCHAR(255) NULL
    AFTER ed_calendar_event_attendees,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_meeting_link VARCHAR(1000) NULL
    AFTER ed_calendar_event_location,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_series_id BIGINT NULL
    AFTER ed_calendar_event_meeting_link,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_updated_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    AFTER ed_calendar_event_registerdate;

UPDATE eduall_calendar_events
   SET ed_calendar_event_created_by = ed_calendar_event_employee_id
 WHERE ed_calendar_event_created_by IS NULL
   AND ed_calendar_event_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hr_calendar_employee_range
  ON eduall_calendar_events (
    ed_calendar_event_institute_code(100),
    ed_calendar_event_employee_id,
    ed_calendar_event_deleted,
    ed_calendar_event_start(32)
  );

ALTER TABLE eduall_hr_chat_conversations
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_description VARCHAR(500) NULL
    AFTER ed_hr_chat_conversation_name,
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_visibility VARCHAR(20) NOT NULL DEFAULT 'private'
    AFTER ed_hr_chat_conversation_description,
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_join_policy VARCHAR(20) NOT NULL DEFAULT 'invite'
    AFTER ed_hr_chat_conversation_visibility;

CREATE INDEX IF NOT EXISTS idx_hr_chat_group_discovery
  ON eduall_hr_chat_conversations (
    ed_hr_chat_conversation_institute_code,
    ed_hr_chat_conversation_type,
    ed_hr_chat_conversation_visibility,
    ed_hr_chat_conversation_deleted
  );
