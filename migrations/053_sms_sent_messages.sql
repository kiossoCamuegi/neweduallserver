-- 053_sms_sent_messages.sql
-- Tabela usada por Controllers/Enrollments.js e
-- Controllers/EnrollmentConfirmation.js para registar SMS enviados/falhados.
--
-- Em produção a tabela não existe; os INSERT falham mas o erro é apanhado
-- pelo helper (o SMS em si não é bloqueado). Criar a tabela ativa o histórico.
--
-- NÃO foi aplicado em produção.

CREATE TABLE IF NOT EXISTS eduall_sms_sent_messages (
  ed_sms_message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ed_sms_message_institute VARCHAR(100) NULL,
  ed_sms_message_status TINYINT(1) NOT NULL DEFAULT 0,
  ed_sms_message_body TEXT NULL,
  ed_sms_message_phone VARCHAR(40) NULL,
  ed_sms_message_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_sms_message_id),
  INDEX idx_sms_msg_institute_date (ed_sms_message_institute, ed_sms_message_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
