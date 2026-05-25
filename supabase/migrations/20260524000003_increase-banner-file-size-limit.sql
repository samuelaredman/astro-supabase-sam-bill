-- Raise banners bucket file size limit to 15 MB to match app-level validation
UPDATE storage.buckets
SET file_size_limit = 15728640
WHERE id = 'banners';
