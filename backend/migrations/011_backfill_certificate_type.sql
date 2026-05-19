-- Backfill food_safety_certificate_type from the stored bytes.
-- Earlier uploads trusted the client-declared multipart MIME, so PDFs
-- could be persisted as image/jpeg (or NULL / application/octet-stream).
-- Correct existing rows by their magic-byte signature. Idempotent:
-- rows already carrying the right type are skipped by the `<>` guards.

UPDATE users SET food_safety_certificate_type = 'application/pdf'
 WHERE food_safety_certificate IS NOT NULL
   AND substr(food_safety_certificate, 1, 5) = X'255044462D'
   AND (food_safety_certificate_type IS NULL
        OR food_safety_certificate_type <> 'application/pdf');

UPDATE users SET food_safety_certificate_type = 'image/jpeg'
 WHERE food_safety_certificate IS NOT NULL
   AND substr(food_safety_certificate, 1, 3) = X'FFD8FF'
   AND (food_safety_certificate_type IS NULL
        OR food_safety_certificate_type <> 'image/jpeg');

UPDATE users SET food_safety_certificate_type = 'image/png'
 WHERE food_safety_certificate IS NOT NULL
   AND substr(food_safety_certificate, 1, 8) = X'89504E470D0A1A0A'
   AND (food_safety_certificate_type IS NULL
        OR food_safety_certificate_type <> 'image/png');
