-- A tabela legada de comentários também não possui chave própria.
-- Adiciona identidade e relação de resposta estáveis para as novas threads.

ALTER TABLE eduall_post_comments
  ADD COLUMN IF NOT EXISTS ed_post_comment_uid BIGINT NOT NULL AUTO_INCREMENT UNIQUE
    AFTER ed_post_comment_id,
  ADD COLUMN IF NOT EXISTS ed_post_comment_parent_uid BIGINT NULL
    AFTER ed_post_comment_parent_id;

UPDATE eduall_post_comments child
JOIN (
  SELECT ed_post_comment_id AS legacyId,
         MIN(ed_post_comment_uid) AS commentUid
    FROM eduall_post_comments
   GROUP BY ed_post_comment_id
  HAVING COUNT(*) = 1
) parent ON parent.legacyId = child.ed_post_comment_parent_id
SET child.ed_post_comment_parent_uid = parent.commentUid
WHERE child.ed_post_comment_parent_uid IS NULL;

CREATE INDEX IF NOT EXISTS idx_hr_comment_parent_uid
  ON eduall_post_comments (
    ed_post_comment_institute_code(100),
    ed_post_comment_post_uid,
    ed_post_comment_parent_uid,
    ed_post_comment_deleted
  );

ALTER TABLE eduall_hr_post_reactions
  DROP INDEX uq_hr_post_reaction_user,
  ADD UNIQUE KEY uq_hr_post_reaction_post_uid_user (
    ed_hr_post_reaction_institute_code,
    ed_hr_post_reaction_post_uid,
    ed_hr_post_reaction_user_id,
    ed_hr_post_reaction_deleted
  );
