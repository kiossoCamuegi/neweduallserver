-- Preserva histórico de reações removidas sem DELETE físico.
ALTER TABLE eduall_hr_post_reactions
  ADD COLUMN IF NOT EXISTS ed_hr_post_reaction_deleted TINYINT(1) NOT NULL DEFAULT 0
    AFTER ed_hr_post_reaction_created_at;

ALTER TABLE eduall_hr_post_reactions
  DROP INDEX uq_hr_post_reaction_user,
  ADD UNIQUE KEY uq_hr_post_reaction_user (
    ed_hr_post_reaction_institute_code,
    ed_hr_post_reaction_post_id,
    ed_hr_post_reaction_user_id,
    ed_hr_post_reaction_deleted
  );
