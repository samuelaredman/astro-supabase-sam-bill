-- Allow list owners to upload a custom cover image, overriding the
-- auto-generated collage built from the list's game covers.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS cover_image_url TEXT;