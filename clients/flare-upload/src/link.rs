//! The share link of section 10.3. The part after `#` carries the secret.
//! A browser does not send that part to the server, and this program never
//! puts it in a request.

use crate::keys::{FileKey, LinkSecret};
use crate::primitives::{base64url_decode_32, base64url_encode};

/// The prefix of a link that carries a `link_secret`.
pub const PASSWORD_LINK_PREFIX: &str = "p";

/// The secret of a share link.
#[derive(Debug)]
pub enum ShareSecret {
    /// A file without a password: `#{base64url(file_key)}`.
    FileKey(FileKey),
    /// A file with a password: `#p.{base64url(link_secret)}`.
    LinkSecret(LinkSecret),
}

/// What the part after `#` holds.
#[derive(Debug)]
pub enum ParsedFragment {
    Secret(ShareSecret),
    /// The link has no part after `#`.
    Missing,
    /// A prefix of a later protocol version. The user must update.
    UnknownVersion,
    /// Not 32 bytes of base64url.
    Malformed,
}

/// The text after `#`, without the `#`.
pub fn share_fragment(secret: &ShareSecret) -> String {
    match secret {
        ShareSecret::FileKey(file_key) => base64url_encode(file_key.expose()),
        ShareSecret::LinkSecret(link_secret) => format!(
            "{PASSWORD_LINK_PREFIX}.{}",
            base64url_encode(link_secret.expose())
        ),
    }
}

/// `{page address}#{fragment}`. The page address is the one that the
/// server gave for the file. It must not have a fragment of its own.
pub fn share_link(page_url: &str, secret: &ShareSecret) -> String {
    format!("{page_url}#{}", share_fragment(secret))
}

/// Reads the text after `#`. A leading `#` is accepted.
pub fn parse_fragment(fragment: &str) -> ParsedFragment {
    let text = fragment.strip_prefix('#').unwrap_or(fragment);
    if text.is_empty() {
        return ParsedFragment::Missing;
    }
    let secret = |text: &str| {
        if text.len() == 43 {
            base64url_decode_32(text).ok()
        } else {
            None
        }
    };
    match text.split_once('.') {
        None => secret(text)
            .map(|bytes| ParsedFragment::Secret(ShareSecret::FileKey(FileKey::from_bytes(bytes))))
            .unwrap_or(ParsedFragment::Malformed),
        Some((PASSWORD_LINK_PREFIX, rest)) => secret(rest)
            .map(|bytes| {
                ParsedFragment::Secret(ShareSecret::LinkSecret(LinkSecret::from_bytes(bytes)))
            })
            .unwrap_or(ParsedFragment::Malformed),
        Some(_) => ParsedFragment::UnknownVersion,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_key_link() {
        let secret = ShareSecret::FileKey(FileKey::from_bytes([0xfb; 32]));
        let link = share_link(
            "https://flare.example/birb/e_AAAAAAAAAAAAAAAAAAAAAA",
            &secret,
        );
        assert_eq!(
            link,
            "https://flare.example/birb/e_AAAAAAAAAAAAAAAAAAAAAA#-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s"
        );
        let fragment = link.split_once('#').unwrap().1;
        assert_eq!(fragment.len(), 43);
        assert!(!fragment.contains('.') && !fragment.contains('='));
        match parse_fragment(fragment) {
            ParsedFragment::Secret(ShareSecret::FileKey(key)) => {
                assert_eq!(key.expose(), &[0xfb; 32])
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn password_link() {
        let secret = ShareSecret::LinkSecret(LinkSecret::from_bytes([1; 32]));
        let link = share_link("https://flare.example/birb/e_x", &secret);
        let fragment = link.split_once('#').unwrap().1;
        assert!(fragment.starts_with("p."));
        assert_eq!(fragment.len(), 45);
        match parse_fragment(&format!("#{fragment}")) {
            ParsedFragment::Secret(ShareSecret::LinkSecret(secret)) => {
                assert_eq!(secret.expose(), &[1; 32])
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn other_fragments() {
        assert!(matches!(parse_fragment(""), ParsedFragment::Missing));
        assert!(matches!(parse_fragment("#"), ParsedFragment::Missing));
        assert!(matches!(parse_fragment("abc"), ParsedFragment::Malformed));
        let key = base64url_encode(&[7; 32]);
        assert!(matches!(
            parse_fragment(&format!("q.{key}")),
            ParsedFragment::UnknownVersion
        ));
        assert!(matches!(
            parse_fragment(&format!("p.{key}=")),
            ParsedFragment::Malformed
        ));
        // 44 characters: one more than 32 bytes need.
        assert!(matches!(
            parse_fragment(&format!("{key}A")),
            ParsedFragment::Malformed
        ));
    }

    #[test]
    fn secrets_do_not_print() {
        let text = format!("{:?}", ShareSecret::FileKey(FileKey::from_bytes([9; 32])));
        assert_eq!(text, "FileKey(FileKey(secret))");
    }
}
