-- Imagem do grupo no chat.

ALTER TABLE eduall_hr_chat_conversations
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_picture VARCHAR(500) NULL
    AFTER ed_hr_chat_conversation_description;
