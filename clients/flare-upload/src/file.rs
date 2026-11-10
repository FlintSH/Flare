//! The encrypted file format of section 7: the 26-byte header and chunks of
//! 64 KiB, each with its own tag.

use std::io::{self, Read, Write};

use zeroize::{Zeroize, Zeroizing};

use crate::error::CryptoError;
use crate::keys::{FileKey, HeaderHash};
use crate::primitives::{blake3_derive_key, blake3_hash, constant_time_eq, xchacha20, TAG_LENGTH};

pub const MAGIC: &[u8; 8] = b"FLAREE2E";
pub const FORMAT_VERSION: u8 = 0x01;
pub const CHUNK_SIZE_LOG2: u8 = 16;
pub const CHUNK_SIZE: usize = 1 << CHUNK_SIZE_LOG2;
pub const HEADER_LENGTH: usize = 26;
pub const NONCE_PREFIX_LENGTH: usize = 16;
/// A full stored chunk: 65536 bytes of ciphertext and the tag.
pub const STORED_CHUNK_SIZE: usize = CHUNK_SIZE + TAG_LENGTH;

pub const CONTEXT_CONTENT_CIPHER: &str = "flare e2ee v1 content cipher";
pub const CONTEXT_CONTENT_MAC: &str = "flare e2ee v1 content mac";

/// The header of section 7.2.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Header {
    bytes: [u8; HEADER_LENGTH],
}

impl Header {
    /// `magic || format_version || chunk_size_log2 || nonce_prefix`.
    pub fn new(nonce_prefix: [u8; NONCE_PREFIX_LENGTH]) -> Self {
        let mut bytes = [0u8; HEADER_LENGTH];
        bytes[..8].copy_from_slice(MAGIC);
        bytes[8] = FORMAT_VERSION;
        bytes[9] = CHUNK_SIZE_LOG2;
        bytes[10..].copy_from_slice(&nonce_prefix);
        Self { bytes }
    }

    /// Steps 1 and 9 of section 7.4.
    pub fn parse(bytes: &[u8]) -> Result<Self, CryptoError> {
        let bytes: [u8; HEADER_LENGTH] =
            bytes.try_into().map_err(|_| CryptoError::InvalidHeader)?;
        if &bytes[..8] != MAGIC {
            return Err(CryptoError::InvalidHeader);
        }
        if bytes[8] != FORMAT_VERSION {
            return Err(CryptoError::UnknownVersion);
        }
        if bytes[9] != CHUNK_SIZE_LOG2 {
            return Err(CryptoError::InvalidHeader);
        }
        Ok(Self { bytes })
    }

    pub fn as_bytes(&self) -> &[u8; HEADER_LENGTH] {
        &self.bytes
    }

    pub fn nonce_prefix(&self) -> [u8; NONCE_PREFIX_LENGTH] {
        let mut prefix = [0u8; NONCE_PREFIX_LENGTH];
        prefix.copy_from_slice(&self.bytes[10..]);
        prefix
    }

    /// `header_hash = blake3_hash(header)`.
    pub fn hash(&self) -> HeaderHash {
        HeaderHash::from_bytes(blake3_hash(&self.bytes))
    }
}

/// `content_cipher_key` and `content_mac_key` of one file (section 7.1).
pub struct ContentKeys {
    cipher_key: Zeroizing<[u8; 32]>,
    mac_key: Zeroizing<[u8; 32]>,
}

impl ContentKeys {
    pub fn derive(file_key: &FileKey) -> Self {
        Self {
            cipher_key: blake3_derive_key(CONTEXT_CONTENT_CIPHER, file_key.expose()),
            mac_key: blake3_derive_key(CONTEXT_CONTENT_MAC, file_key.expose()),
        }
    }
}

fn chunk_nonce(nonce_prefix: &[u8; NONCE_PREFIX_LENGTH], chunk_index: u64) -> [u8; 24] {
    let mut nonce = [0u8; 24];
    nonce[..NONCE_PREFIX_LENGTH].copy_from_slice(nonce_prefix);
    nonce[NONCE_PREFIX_LENGTH..].copy_from_slice(&chunk_index.to_le_bytes());
    nonce
}

fn chunk_tag(
    mac_key: &[u8; 32],
    header_hash: &HeaderHash,
    chunk_index: u64,
    is_final: bool,
    chunk_ciphertext: &[u8],
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_keyed(mac_key);
    hasher.update(header_hash.as_bytes());
    hasher.update(&chunk_index.to_le_bytes());
    hasher.update(&[is_final as u8]);
    hasher.update(chunk_ciphertext);
    *hasher.finalize().as_bytes()
}

/// Encrypts one chunk in place and adds its tag (section 7.3). `chunk`
/// holds the plaintext at the start and `chunk_ciphertext || chunk_tag` at
/// the end.
pub fn encrypt_chunk_in_place(
    keys: &ContentKeys,
    header: &Header,
    header_hash: &HeaderHash,
    chunk_index: u64,
    is_final: bool,
    chunk: &mut Vec<u8>,
) {
    let nonce = chunk_nonce(&header.nonce_prefix(), chunk_index);
    xchacha20(&keys.cipher_key, &nonce, chunk);
    let tag = chunk_tag(&keys.mac_key, header_hash, chunk_index, is_final, chunk);
    chunk.extend_from_slice(&tag);
}

/// One stored chunk of a plaintext chunk.
pub fn encrypt_chunk(
    file_key: &FileKey,
    header: &Header,
    chunk_index: u64,
    is_final: bool,
    chunk_plaintext: &[u8],
) -> Vec<u8> {
    let mut chunk = Vec::with_capacity(chunk_plaintext.len() + TAG_LENGTH);
    chunk.extend_from_slice(chunk_plaintext);
    encrypt_chunk_in_place(
        &ContentKeys::derive(file_key),
        header,
        &header.hash(),
        chunk_index,
        is_final,
        &mut chunk,
    );
    chunk
}

/// Verifies and decrypts one stored chunk (section 7.4, steps 3, 4, 6, 8).
/// No plaintext is released before the tag is correct.
pub fn decrypt_chunk(
    keys: &ContentKeys,
    header: &Header,
    header_hash: &HeaderHash,
    chunk_index: u64,
    is_final: bool,
    stored_chunk: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if stored_chunk.len() < TAG_LENGTH || stored_chunk.len() > STORED_CHUNK_SIZE {
        return Err(CryptoError::InvalidLayout);
    }
    let (ciphertext, tag) = stored_chunk.split_at(stored_chunk.len() - TAG_LENGTH);
    if !is_final && ciphertext.len() != CHUNK_SIZE {
        return Err(CryptoError::InvalidLayout);
    }
    if is_final && ciphertext.is_empty() && chunk_index != 0 {
        return Err(CryptoError::InvalidLayout);
    }
    let expected_tag = chunk_tag(
        &keys.mac_key,
        header_hash,
        chunk_index,
        is_final,
        ciphertext,
    );
    if !constant_time_eq(&expected_tag, tag) {
        return Err(CryptoError::Authentication);
    }
    let mut plaintext = Zeroizing::new(ciphertext.to_vec());
    xchacha20(
        &keys.cipher_key,
        &chunk_nonce(&header.nonce_prefix(), chunk_index),
        &mut plaintext,
    );
    Ok(plaintext)
}

/// The number of chunks of a plaintext. An empty file has one chunk.
pub fn chunk_count(plaintext_length: u64) -> u64 {
    plaintext_length.div_ceil(CHUNK_SIZE as u64).max(1)
}

/// The length of the encrypted file: the header and all stored chunks.
/// `None` if the value does not fit in 64 bits.
pub fn stored_length(plaintext_length: u64) -> Option<u64> {
    chunk_count(plaintext_length)
        .checked_mul(TAG_LENGTH as u64)?
        .checked_add(plaintext_length)?
        .checked_add(HEADER_LENGTH as u64)
}

/// The plaintext length of a stored length, if an encrypted file can have
/// that length (section 7.4, steps 6 to 8).
pub fn plaintext_length_of(stored_length: u64) -> Option<u64> {
    let body = stored_length.checked_sub(HEADER_LENGTH as u64)?;
    let full_chunks = body / STORED_CHUNK_SIZE as u64;
    let rest = body % STORED_CHUNK_SIZE as u64;
    let last = match rest {
        // The last chunk is a full one.
        0 if full_chunks > 0 => return Some(full_chunks * CHUNK_SIZE as u64),
        0 => return None,
        rest if rest < TAG_LENGTH as u64 => return None,
        rest => rest - TAG_LENGTH as u64,
    };
    // A last chunk of length zero is valid only for an empty file.
    if last == 0 && full_chunks > 0 {
        return None;
    }
    Some(full_chunks * CHUNK_SIZE as u64 + last)
}

/// Reads until the buffer is full or the source ends.
fn read_full(source: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match source.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

/// The encrypted file as a stream: the header, then each stored chunk. It
/// holds one chunk in memory, never the whole file.
///
/// The plaintext length is fixed at the start, because an upload announces
/// its size first. If the source gives fewer or more bytes, the read fails.
pub struct EncryptingReader<R: Read> {
    source: R,
    keys: ContentKeys,
    header: Header,
    header_hash: HeaderHash,
    remaining_plaintext: u64,
    next_chunk_index: u64,
    finished: bool,
    buffer: Vec<u8>,
    position: usize,
}

impl<R: Read> EncryptingReader<R> {
    pub fn new(source: R, file_key: &FileKey, header: Header, plaintext_length: u64) -> Self {
        let mut buffer = Vec::with_capacity(STORED_CHUNK_SIZE);
        buffer.extend_from_slice(header.as_bytes());
        Self {
            source,
            keys: ContentKeys::derive(file_key),
            header_hash: header.hash(),
            header,
            remaining_plaintext: plaintext_length,
            next_chunk_index: 0,
            finished: false,
            buffer,
            position: 0,
        }
    }

    fn next_chunk(&mut self) -> io::Result<()> {
        let length = self.remaining_plaintext.min(CHUNK_SIZE as u64) as usize;
        self.buffer.zeroize();
        self.buffer.resize(length, 0);
        self.position = 0;
        if read_full(&mut self.source, &mut self.buffer)? != length {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                CryptoError::LengthMismatch,
            ));
        }
        self.remaining_plaintext -= length as u64;
        let is_final = self.remaining_plaintext == 0;
        if is_final {
            let mut probe = [0u8; 1];
            if read_full(&mut self.source, &mut probe)? != 0 {
                probe.zeroize();
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    CryptoError::LengthMismatch,
                ));
            }
        }
        encrypt_chunk_in_place(
            &self.keys,
            &self.header,
            &self.header_hash,
            self.next_chunk_index,
            is_final,
            &mut self.buffer,
        );
        self.next_chunk_index += 1;
        self.finished = is_final;
        Ok(())
    }
}

impl<R: Read> Read for EncryptingReader<R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.position == self.buffer.len() {
            if self.finished {
                return Ok(0);
            }
            self.next_chunk()?;
        }
        let count = output.len().min(self.buffer.len() - self.position);
        output[..count].copy_from_slice(&self.buffer[self.position..self.position + count]);
        self.position += count;
        Ok(count)
    }
}

impl<R: Read> Drop for EncryptingReader<R> {
    fn drop(&mut self) {
        // The buffer can hold a plaintext chunk after a failed read.
        self.buffer.zeroize();
    }
}

/// Encrypts a whole plaintext in memory. For tests and small values.
pub fn encrypt_to_vec(
    file_key: &FileKey,
    header: Header,
    plaintext: &[u8],
) -> Result<Vec<u8>, io::Error> {
    let mut stored = Vec::new();
    EncryptingReader::new(plaintext, file_key, header, plaintext.len() as u64)
        .read_to_end(&mut stored)?;
    Ok(stored)
}

fn layout_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, CryptoError::InvalidLayout)
}

/// Decrypts an encrypted file as a stream (section 7.4). Each chunk goes
/// to `output` after its tag is correct. The caller must not use the output
/// as a complete file unless this returns `Ok`: a truncation shows only at
/// the end.
pub fn decrypt_stream(
    file_key: &FileKey,
    mut source: impl Read,
    mut output: impl Write,
) -> io::Result<u64> {
    let invalid = |error: CryptoError| io::Error::new(io::ErrorKind::InvalidData, error);
    let mut header_bytes = [0u8; HEADER_LENGTH];
    if read_full(&mut source, &mut header_bytes)? != HEADER_LENGTH {
        return Err(invalid(CryptoError::InvalidHeader));
    }
    let header = Header::parse(&header_bytes).map_err(invalid)?;
    let header_hash = header.hash();
    let keys = ContentKeys::derive(file_key);
    // One stored chunk and one byte more, to see if a chunk is the last one.
    let mut current = vec![0u8; STORED_CHUNK_SIZE];
    let mut next = vec![0u8; STORED_CHUNK_SIZE];
    let mut current_length = read_full(&mut source, &mut current)?;
    let mut chunk_index = 0u64;
    let mut total = 0u64;
    loop {
        let next_length = if current_length == STORED_CHUNK_SIZE {
            read_full(&mut source, &mut next)?
        } else {
            0
        };
        let is_final = next_length == 0;
        if current_length < TAG_LENGTH {
            return Err(layout_error());
        }
        let plaintext = decrypt_chunk(
            &keys,
            &header,
            &header_hash,
            chunk_index,
            is_final,
            &current[..current_length],
        )
        .map_err(invalid)?;
        output.write_all(&plaintext)?;
        total += plaintext.len() as u64;
        if is_final {
            return Ok(total);
        }
        std::mem::swap(&mut current, &mut next);
        current_length = next_length;
        chunk_index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_lengths_round_trip() {
        for length in [0u64, 1, 31, 65535, 65536, 65537, 131072, 200000, 10 << 20] {
            let stored = stored_length(length).unwrap();
            assert_eq!(plaintext_length_of(stored), Some(length), "{length}");
        }
        assert_eq!(stored_length(0), Some(58));
        assert_eq!(stored_length(65536), Some(26 + 65568));
        assert_eq!(stored_length(65537), Some(26 + 65568 + 33));
        assert_eq!(stored_length(u64::MAX), None);
    }

    #[test]
    fn lengths_that_no_encrypted_file_has() {
        // Shorter than a header and one tag.
        for stored in [0u64, 25, 26, 57] {
            assert_eq!(plaintext_length_of(stored), None, "{stored}");
        }
        // A zero-length last chunk after a full chunk.
        assert_eq!(plaintext_length_of(26 + 65568 + 32), None);
        // A last chunk that is shorter than a tag.
        assert_eq!(plaintext_length_of(26 + 65568 + 31), None);
        assert_eq!(plaintext_length_of(26 + 65568 + 33), Some(65537));
    }
}
