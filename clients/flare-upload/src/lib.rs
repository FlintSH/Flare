//! `flare-upload`: the command-line upload client of Flare's end-to-end
//! encryption (docs/e2ee-spec.md, section 10.2).
//!
//! The `crypto` modules are pure functions that mirror the procedures of
//! the specification. Each random value is a parameter, so each output is
//! fixed and the shared test vectors apply. Thin wrappers add randomness.
//!
//! The library can also decrypt (a file, a stanza with a given private
//! key). The tests and the self-test use that. The command-line program has
//! no option, configuration field or environment variable that takes a
//! private key.

#![forbid(unsafe_code)]

pub mod cli;
pub mod clipboard;
pub mod config;
pub mod ed2curve;
pub mod error;
pub mod file;
pub mod kat;
pub mod keys;
pub mod link;
pub mod mime;
pub mod password;
pub mod primitives;
pub mod records;
pub mod stanza;
pub mod upload;

/// The protocol version this client writes (section 1.5.2, rule 1).
pub const PROTOCOL_VERSION: u32 = 1;
