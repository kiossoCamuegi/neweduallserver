-- Chat completo do RH: conversas diretas/grupos, participantes, leitura e mensagens multimédia.

ALTER TABLE eduall_chat_messages
  ADD COLUMN IF NOT EXISTS ed_hr_chat_message_uid BIGINT NOT NULL AUTO_INCREMENT UNIQUE
    AFTER ed_chat_message_id,
  ADD COLUMN IF NOT EXISTS ed_chat_message_conversation_id BIGINT NULL
    AFTER ed_chat_message_group_code,
  ADD COLUMN IF NOT EXISTS ed_chat_message_type VARCHAR(30) NOT NULL DEFAULT 'text'
    AFTER ed_chat_message_content,
  ADD COLUMN IF NOT EXISTS ed_chat_message_attachments LONGTEXT NULL
    AFTER ed_chat_message_gif,
  ADD COLUMN IF NOT EXISTS ed_chat_message_reply_to_uid BIGINT NULL
    AFTER ed_chat_message_attachments,
  ADD COLUMN IF NOT EXISTS ed_chat_message_edited_at DATETIME NULL
    AFTER ed_chat_message_registertime;

CREATE TABLE IF NOT EXISTS eduall_hr_chat_conversations (
  ed_hr_chat_conversation_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_chat_conversation_institute_code VARCHAR(100) NOT NULL,
  ed_hr_chat_conversation_type VARCHAR(20) NOT NULL DEFAULT 'direct',
  ed_hr_chat_conversation_name VARCHAR(180) NULL,
  ed_hr_chat_conversation_direct_key VARCHAR(255) NULL,
  ed_hr_chat_conversation_created_by INT NOT NULL,
  ed_hr_chat_conversation_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_chat_conversation_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_chat_conversation_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_chat_conversation_id),
  UNIQUE KEY uq_hr_chat_direct (
    ed_hr_chat_conversation_institute_code,
    ed_hr_chat_conversation_direct_key
  ),
  KEY idx_hr_chat_conversation_updated (
    ed_hr_chat_conversation_institute_code,
    ed_hr_chat_conversation_deleted,
    ed_hr_chat_conversation_updated_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_chat_participants (
  ed_hr_chat_participant_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_chat_participant_conversation_id BIGINT NOT NULL,
  ed_hr_chat_participant_user_id INT NOT NULL,
  ed_hr_chat_participant_role VARCHAR(20) NOT NULL DEFAULT 'member',
  ed_hr_chat_participant_added_by INT NULL,
  ed_hr_chat_participant_joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_chat_participant_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_chat_participant_id),
  UNIQUE KEY uq_hr_chat_participant (
    ed_hr_chat_participant_conversation_id,
    ed_hr_chat_participant_user_id
  ),
  KEY idx_hr_chat_participant_user (
    ed_hr_chat_participant_user_id,
    ed_hr_chat_participant_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_chat_reads (
  ed_hr_chat_read_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_chat_read_conversation_id BIGINT NOT NULL,
  ed_hr_chat_read_user_id INT NOT NULL,
  ed_hr_chat_read_last_message_uid BIGINT NOT NULL DEFAULT 0,
  ed_hr_chat_read_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_chat_read_id),
  UNIQUE KEY uq_hr_chat_read (
    ed_hr_chat_read_conversation_id,
    ed_hr_chat_read_user_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_hr_chat_message_conversation
  ON eduall_chat_messages (
    ed_chat_message_institute_code(100),
    ed_chat_message_conversation_id,
    ed_chat_message_deleted,
    ed_chat_message_registertime
  );
