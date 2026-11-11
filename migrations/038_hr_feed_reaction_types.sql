-- Compatibiliza as reações existentes com os seis tipos suportados pelo feed.
ALTER TABLE eduall_hr_post_reactions
  ADD COLUMN IF NOT EXISTS ed_hr_post_reaction_updated_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    AFTER ed_hr_post_reaction_created_at;

ALTER TABLE eduall_hr_comment_reactions
  ADD COLUMN IF NOT EXISTS ed_hr_comment_reaction_updated_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    AFTER ed_hr_comment_reaction_created_at;

UPDATE eduall_hr_post_reactions
   SET ed_hr_post_reaction_type = 'love'
 WHERE LOWER(TRIM(ed_hr_post_reaction_type)) IN ('like', 'gosto', 'amor', 'adoro');

UPDATE eduall_hr_post_reactions
   SET ed_hr_post_reaction_type = 'care'
 WHERE LOWER(TRIM(ed_hr_post_reaction_type)) IN ('forca', 'força');

UPDATE eduall_hr_post_reactions
   SET ed_hr_post_reaction_type = 'wow'
 WHERE LOWER(TRIM(ed_hr_post_reaction_type)) = 'uau';

UPDATE eduall_hr_post_reactions
   SET ed_hr_post_reaction_type = 'sad'
 WHERE LOWER(TRIM(ed_hr_post_reaction_type)) = 'triste';

UPDATE eduall_hr_post_reactions
   SET ed_hr_post_reaction_type = 'angry'
 WHERE LOWER(TRIM(ed_hr_post_reaction_type)) IN ('raiva', 'grr');

UPDATE eduall_hr_comment_reactions
   SET ed_hr_comment_reaction_type = 'love'
 WHERE LOWER(TRIM(ed_hr_comment_reaction_type)) IN ('like', 'gosto', 'amor', 'adoro');

UPDATE eduall_hr_comment_reactions
   SET ed_hr_comment_reaction_type = 'care'
 WHERE LOWER(TRIM(ed_hr_comment_reaction_type)) IN ('forca', 'força');

UPDATE eduall_hr_comment_reactions
   SET ed_hr_comment_reaction_type = 'wow'
 WHERE LOWER(TRIM(ed_hr_comment_reaction_type)) = 'uau';

UPDATE eduall_hr_comment_reactions
   SET ed_hr_comment_reaction_type = 'sad'
 WHERE LOWER(TRIM(ed_hr_comment_reaction_type)) = 'triste';

UPDATE eduall_hr_comment_reactions
   SET ed_hr_comment_reaction_type = 'angry'
 WHERE LOWER(TRIM(ed_hr_comment_reaction_type)) IN ('raiva', 'grr');
