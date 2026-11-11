-- Metadados normalizados do vídeo otimizado no feed.

ALTER TABLE eduall_posts
  ADD COLUMN IF NOT EXISTS ed_post_video_storage_key VARCHAR(180) NULL
    AFTER ed_post_location,
  ADD COLUMN IF NOT EXISTS ed_post_video_poster_key VARCHAR(180) NULL
    AFTER ed_post_video_storage_key,
  ADD COLUMN IF NOT EXISTS ed_post_video_duration DECIMAL(10,3) NULL
    AFTER ed_post_video_poster_key,
  ADD COLUMN IF NOT EXISTS ed_post_video_size BIGINT NULL
    AFTER ed_post_video_duration,
  ADD COLUMN IF NOT EXISTS ed_post_video_width INT NULL
    AFTER ed_post_video_size,
  ADD COLUMN IF NOT EXISTS ed_post_video_height INT NULL
    AFTER ed_post_video_width;
