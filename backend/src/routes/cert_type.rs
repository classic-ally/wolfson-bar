//! Content-type detection for uploaded food-safety certificates.
//!
//! Clients (browsers, mobile share-sheets, scanner apps) routinely
//! mislabel an exported PDF as `image/jpeg`, or send an empty type that
//! becomes `application/octet-stream`. Trusting the multipart-declared
//! MIME meant a PDF could be stored/served as an image, so the viewer
//! rendered it in an `<img>` tag — works on Apple ImageIO, broken on
//! Chromium. We sniff the leading bytes instead and treat that as
//! authoritative.

/// Detect a certificate's content type from its magic bytes.
///
/// Returns a static MIME string for the formats we accept, or `None`
/// when the bytes match nothing recognised (caller rejects the upload /
/// falls back).
pub fn sniff_certificate_type(bytes: &[u8]) -> Option<&'static str> {
    // PDF: `%PDF-`, optionally preceded by a BOM or whitespace. The spec
    // only requires `%PDF-` within the first 1 KB.
    let pdf_window = &bytes[..bytes.len().min(1024)];
    if pdf_window
        .windows(5)
        .any(|w| w == b"%PDF-")
    {
        return Some("application/pdf");
    }

    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }

    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }

    // GIF87a / GIF89a
    if bytes.starts_with(b"GIF8") {
        return Some("image/gif");
    }

    // RIFF....WEBP
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }

    // ISO-BMFF `ftyp` brand at offset 4 for HEIC/HEIF.
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        match &bytes[8..12] {
            b"heic" | b"heix" | b"heif" | b"mif1" => return Some("image/heic"),
            _ => {}
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pdf() {
        assert_eq!(sniff_certificate_type(b"%PDF-1.7\n..."), Some("application/pdf"));
    }

    #[test]
    fn detects_pdf_with_leading_whitespace() {
        // Some producers emit a BOM/newline before the signature.
        let mut data = vec![0xEF, 0xBB, 0xBF, b'\n', b' '];
        data.extend_from_slice(b"%PDF-1.4 rest");
        assert_eq!(sniff_certificate_type(&data), Some("application/pdf"));
    }

    #[test]
    fn detects_jpeg() {
        assert_eq!(
            sniff_certificate_type(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]),
            Some("image/jpeg")
        );
    }

    #[test]
    fn detects_png() {
        assert_eq!(
            sniff_certificate_type(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]),
            Some("image/png")
        );
    }

    #[test]
    fn detects_gif() {
        assert_eq!(sniff_certificate_type(b"GIF89a..."), Some("image/gif"));
        assert_eq!(sniff_certificate_type(b"GIF87a..."), Some("image/gif"));
    }

    #[test]
    fn detects_webp() {
        let mut data = b"RIFF".to_vec();
        data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // size
        data.extend_from_slice(b"WEBPVP8 ");
        assert_eq!(sniff_certificate_type(&data), Some("image/webp"));
    }

    #[test]
    fn detects_heic() {
        let mut data = vec![0x00, 0x00, 0x00, 0x18];
        data.extend_from_slice(b"ftypheic");
        data.extend_from_slice(b"....");
        assert_eq!(sniff_certificate_type(&data), Some("image/heic"));
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(sniff_certificate_type(&[]), None);
    }

    #[test]
    fn rejects_truncated() {
        assert_eq!(sniff_certificate_type(&[0x89, 0x50]), None);
        assert_eq!(sniff_certificate_type(&[0xFF, 0xD8]), None);
    }

    #[test]
    fn rejects_text_and_garbage() {
        assert_eq!(sniff_certificate_type(b"<html><body>nope</body></html>"), None);
        assert_eq!(sniff_certificate_type(b"just some plain text"), None);
        assert_eq!(sniff_certificate_type(&[0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), None);
    }

    #[test]
    fn riff_without_webp_is_not_image() {
        let mut data = b"RIFF".to_vec();
        data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        data.extend_from_slice(b"WAVEfmt ");
        assert_eq!(sniff_certificate_type(&data), None);
    }
}
