-- A tabela legada eduall_posts não tem chave primária nem auto-incremento.
-- Cria uma identidade estável e aditiva para o feed, preservando ed_post_id.

ALTER TABLE eduall_posts
  ADD COLUMN IF NOT EXISTS ed_hr_post_uid BIGINT NOT NULL AUTO_INCREMENT UNIQUE
    AFTER ed_post_id;

ALTER TABLE eduall_post_comments
  ADD COLUMN IF NOT EXISTS ed_post_comment_post_uid BIGINT NULL
    AFTER ed_post_comment_postCode;

ALTER TABLE eduall_hr_post_reactions
  ADD COLUMN IF NOT EXISTS ed_hr_post_reaction_post_uid BIGINT NULL
    AFTER ed_hr_post_reaction_post_id;

UPDATE eduall_post_comments c
JOIN (
  SELECT ed_post_id AS legacyId,
         MIN(ed_hr_post_uid) AS postUid
    FROM eduall_posts
   GROUP BY ed_post_id
  HAVING COUNT(*) = 1
) p ON p.legacyId = c.ed_post_comment_postCode
SET c.ed_post_comment_post_uid = p.postUid
WHERE c.ed_post_comment_post_uid IS NULL;

UPDATE eduall_hr_post_reactions r
JOIN (
  SELECT ed_post_id AS legacyId,
         MIN(ed_hr_post_uid) AS postUid
    FROM eduall_posts
   GROUP BY ed_post_id
  HAVING COUNT(*) = 1
) p ON p.legacyId = r.ed_hr_post_reaction_post_id
SET r.ed_hr_post_reaction_post_uid = p.postUid
WHERE r.ed_hr_post_reaction_post_uid IS NULL;

CREATE INDEX IF NOT EXISTS idx_hr_comment_post_uid
  ON eduall_post_comments (
    ed_post_comment_institute_code(100),
    ed_post_comment_post_uid,
    ed_post_comment_deleted
  );

CREATE INDEX IF NOT EXISTS idx_hr_reaction_post_uid
  ON eduall_hr_post_reactions (
    ed_hr_post_reaction_institute_code(100),
    ed_hr_post_reaction_post_uid,
    ed_hr_post_reaction_deleted
  );
