-- Add banner_url column to platforms table.
-- Upload banner images via Supabase Storage (or any CDN) and paste the
-- public URL into this column for each platform row.
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS banner_url text;
