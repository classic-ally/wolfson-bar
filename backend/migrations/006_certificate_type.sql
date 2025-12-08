-- Add content type column for food safety certificates to support PDFs
ALTER TABLE users ADD COLUMN food_safety_certificate_type TEXT;
