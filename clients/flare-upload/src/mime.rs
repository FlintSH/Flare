//! A small table from a file extension to a MIME type.
//!
//! The type of an encrypted file goes into `sealed_metadata` (section 9.1),
//! so only a person with the file key reads it. The viewer uses it to pick
//! how to show the file. An extension that is not in the table gives
//! `application/octet-stream`, which the viewer offers as a download.

/// The type of a file that the table does not know.
pub const DEFAULT_MIME_TYPE: &str = "application/octet-stream";

/// Extension (lower case, without the dot) and MIME type. Sorted by
/// extension, so the lookup is a binary search and a test can check it.
const TABLE: &[(&str, &str)] = &[
    ("7z", "application/x-7z-compressed"),
    ("aac", "audio/aac"),
    ("apng", "image/apng"),
    ("avi", "video/x-msvideo"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("bz2", "application/x-bzip2"),
    ("c", "text/plain"),
    ("cpp", "text/plain"),
    ("css", "text/css"),
    ("csv", "text/csv"),
    ("doc", "application/msword"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("epub", "application/epub+zip"),
    ("flac", "audio/flac"),
    ("gif", "image/gif"),
    ("go", "text/plain"),
    ("gz", "application/gzip"),
    ("h", "text/plain"),
    ("heic", "image/heic"),
    ("htm", "text/html"),
    ("html", "text/html"),
    ("ico", "image/x-icon"),
    ("java", "text/plain"),
    ("jpeg", "image/jpeg"),
    ("jpg", "image/jpeg"),
    ("js", "text/javascript"),
    ("json", "application/json"),
    ("jxl", "image/jxl"),
    ("log", "text/plain"),
    ("m4a", "audio/mp4"),
    ("m4v", "video/mp4"),
    ("md", "text/markdown"),
    ("mkv", "video/x-matroska"),
    ("mov", "video/quicktime"),
    ("mp3", "audio/mpeg"),
    ("mp4", "video/mp4"),
    ("odt", "application/vnd.oasis.opendocument.text"),
    ("oga", "audio/ogg"),
    ("ogg", "audio/ogg"),
    ("ogv", "video/ogg"),
    ("opus", "audio/opus"),
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("ppt", "application/vnd.ms-powerpoint"),
    (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    ("py", "text/plain"),
    ("rar", "application/vnd.rar"),
    ("rs", "text/plain"),
    ("rtf", "application/rtf"),
    ("sh", "text/plain"),
    ("svg", "image/svg+xml"),
    ("tar", "application/x-tar"),
    ("tif", "image/tiff"),
    ("tiff", "image/tiff"),
    ("toml", "text/plain"),
    ("ts", "text/plain"),
    ("tsv", "text/tab-separated-values"),
    ("txt", "text/plain"),
    ("wav", "audio/wav"),
    ("weba", "audio/webm"),
    ("webm", "video/webm"),
    ("webp", "image/webp"),
    ("xls", "application/vnd.ms-excel"),
    (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    ("xml", "application/xml"),
    ("yaml", "text/plain"),
    ("yml", "text/plain"),
    ("zip", "application/zip"),
    ("zst", "application/zstd"),
];

/// The MIME type of a file name, from its last extension.
pub fn mime_type_of(file_name: &str) -> &'static str {
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return DEFAULT_MIME_TYPE;
    };
    // `.bashrc` has no extension.
    if stem.is_empty() || extension.is_empty() || extension.len() > 8 {
        return DEFAULT_MIME_TYPE;
    }
    let extension = extension.to_ascii_lowercase();
    TABLE
        .binary_search_by(|(known, _)| (*known).cmp(extension.as_str()))
        .map(|index| TABLE[index].1)
        .unwrap_or(DEFAULT_MIME_TYPE)
}

/// Whether the browser of the owner can find text in the file later
/// (section 9.7). The server cannot look at the file, so the uploader says.
pub fn is_image(mime_type: &str) -> bool {
    mime_type.starts_with("image/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_sorted_and_lower_case() {
        for pair in TABLE.windows(2) {
            assert!(pair[0].0 < pair[1].0, "{} before {}", pair[0].0, pair[1].0);
        }
        for (extension, mime_type) in TABLE {
            assert_eq!(*extension, extension.to_ascii_lowercase());
            assert!(mime_type.contains('/'));
        }
    }

    #[test]
    fn common_types() {
        assert_eq!(mime_type_of("shot.png"), "image/png");
        assert_eq!(mime_type_of("Shot.PNG"), "image/png");
        assert_eq!(mime_type_of("photo.final.jpeg"), "image/jpeg");
        assert_eq!(mime_type_of("clip.mp4"), "video/mp4");
        assert_eq!(mime_type_of("notes.txt"), "text/plain");
        assert_eq!(mime_type_of("archive.tar.gz"), "application/gzip");
    }

    #[test]
    fn unknown_names() {
        assert_eq!(mime_type_of("README"), DEFAULT_MIME_TYPE);
        assert_eq!(mime_type_of(".bashrc"), DEFAULT_MIME_TYPE);
        assert_eq!(mime_type_of("file."), DEFAULT_MIME_TYPE);
        assert_eq!(mime_type_of("data.unknownext"), DEFAULT_MIME_TYPE);
    }

    #[test]
    fn images() {
        assert!(is_image("image/png"));
        assert!(is_image("image/svg+xml"));
        assert!(!is_image("video/mp4"));
        assert!(!is_image(DEFAULT_MIME_TYPE));
    }
}
