//! Round trips and changed files (section 7.4): each change must be found.

use std::io::Read;

use flare_upload::ed2curve::ed2curve_private;
use flare_upload::file::{
    decrypt_stream, encrypt_to_vec, plaintext_length_of, stored_length, EncryptingReader, Header,
    CHUNK_SIZE, HEADER_LENGTH, STORED_CHUNK_SIZE,
};
use flare_upload::keys::{AccountPublicKey, FileKey, X25519PrivateKey};
use flare_upload::primitives::blake3_hash;
use flare_upload::records::{decode_record, encode_record, open_sealed_metadata, sealed_metadata};
use flare_upload::stanza::{account_stanza, account_stanza_unwrap};

fn plaintext(length: usize) -> Vec<u8> {
    (0..length)
        .map(|offset| (offset * 31 % 253) as u8)
        .collect()
}

fn decrypt(file_key: &FileKey, stored: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::new();
    decrypt_stream(file_key, stored, &mut output)?;
    Ok(output)
}

#[test]
fn round_trips_at_each_boundary() {
    let file_key = FileKey::from_bytes([7; 32]);
    for length in [
        0,
        1,
        31,
        32,
        33,
        CHUNK_SIZE - 1,
        CHUNK_SIZE,
        CHUNK_SIZE + 1,
        3 * CHUNK_SIZE,
        200_000,
    ] {
        let content = plaintext(length);
        let stored = encrypt_to_vec(&file_key, Header::new([9; 16]), &content).unwrap();
        assert_eq!(Some(stored.len() as u64), stored_length(length as u64));
        assert_eq!(
            plaintext_length_of(stored.len() as u64),
            Some(length as u64)
        );
        assert_eq!(decrypt(&file_key, &stored).unwrap(), content, "{length}");
    }
}

#[test]
fn the_stream_reads_in_small_pieces() {
    // An HTTP client reads the body with buffers of any size.
    let file_key = FileKey::from_bytes([3; 32]);
    let content = plaintext(150_000);
    let whole = encrypt_to_vec(&file_key, Header::new([1; 16]), &content).unwrap();
    for buffer_size in [1usize, 7, 4096, 65_568, 100_000] {
        let mut reader = EncryptingReader::new(
            content.as_slice(),
            &file_key,
            Header::new([1; 16]),
            content.len() as u64,
        );
        let mut stored = Vec::new();
        let mut buffer = vec![0u8; buffer_size];
        loop {
            let count = reader.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            stored.extend_from_slice(&buffer[..count]);
            if buffer_size == 1 && stored.len() > 70_000 {
                // One byte at a time is slow; the first chunk boundary is enough.
                break;
            }
        }
        assert_eq!(stored, whole[..stored.len()], "{buffer_size}");
    }
}

#[test]
fn a_file_that_changes_while_it_is_read_fails() {
    let file_key = FileKey::from_bytes([3; 32]);
    let content = plaintext(1000);
    // The announced length is longer than the source.
    let mut short =
        EncryptingReader::new(content.as_slice(), &file_key, Header::new([1; 16]), 2000);
    assert!(short.read_to_end(&mut Vec::new()).is_err());
    // The source is longer than the announced length.
    let mut long = EncryptingReader::new(content.as_slice(), &file_key, Header::new([1; 16]), 500);
    assert!(long.read_to_end(&mut Vec::new()).is_err());
}

#[test]
fn each_change_is_rejected() {
    let file_key = FileKey::from_bytes([7; 32]);
    let content = plaintext(2 * CHUNK_SIZE + 100);
    let stored = encrypt_to_vec(&file_key, Header::new([9; 16]), &content).unwrap();
    assert_eq!(decrypt(&file_key, &stored).unwrap(), content);

    // A different key.
    assert!(decrypt(&FileKey::from_bytes([8; 32]), &stored).is_err());
    // One changed bit in the header, in each chunk, in a tag.
    for index in [
        0,
        8,
        9,
        10,
        25,
        HEADER_LENGTH,
        HEADER_LENGTH + STORED_CHUNK_SIZE - 1,
        stored.len() - 1,
    ] {
        let mut changed = stored.clone();
        changed[index] ^= 0x01;
        assert!(decrypt(&file_key, &changed).is_err(), "byte {index}");
    }
    // Truncation at a chunk boundary, and inside a chunk.
    assert!(decrypt(&file_key, &stored[..HEADER_LENGTH + STORED_CHUNK_SIZE]).is_err());
    assert!(decrypt(&file_key, &stored[..HEADER_LENGTH + 2 * STORED_CHUNK_SIZE]).is_err());
    assert!(decrypt(&file_key, &stored[..stored.len() - 1]).is_err());
    assert!(decrypt(&file_key, &stored[..HEADER_LENGTH]).is_err());
    assert!(decrypt(&file_key, &stored[..10]).is_err());
    // Data after the last chunk.
    let mut longer = stored.clone();
    longer.push(0);
    assert!(decrypt(&file_key, &longer).is_err());
    // Two chunks in the wrong sequence.
    let mut swapped = stored.clone();
    let (first, second) = swapped[HEADER_LENGTH..].split_at_mut(STORED_CHUNK_SIZE);
    first.swap_with_slice(&mut second[..STORED_CHUNK_SIZE]);
    assert!(decrypt(&file_key, &swapped).is_err());
    // A chunk of a different file with the same key.
    let other = encrypt_to_vec(&file_key, Header::new([10; 16]), &content).unwrap();
    let mut mixed = stored.clone();
    mixed[HEADER_LENGTH..HEADER_LENGTH + STORED_CHUNK_SIZE]
        .copy_from_slice(&other[HEADER_LENGTH..HEADER_LENGTH + STORED_CHUNK_SIZE]);
    assert!(decrypt(&file_key, &mixed).is_err());
}

#[test]
fn one_upload_opens_with_the_account_private_key() {
    // What the browser of the owner does with what this program made.
    let seed = blake3_hash(b"flare-upload test account");
    let account_public_key = AccountPublicKey::from_bytes(
        ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes(),
    )
    .unwrap();
    let file_key = FileKey::random().unwrap();
    let header = Header::new([4; 16]);
    let header_hash = header.hash();
    let stanza =
        encode_record(&account_stanza(&account_public_key, &header_hash, &file_key).unwrap());
    let metadata =
        encode_record(&sealed_metadata(&file_key, &header_hash, "shot.png", "image/png").unwrap());
    assert_eq!(stanza.len(), 97);
    assert_eq!(stanza[0], 0x01);

    let exchange_private_key = X25519PrivateKey::from_bytes(*ed2curve_private(&seed));
    let opened = account_stanza_unwrap(
        &exchange_private_key,
        &header_hash,
        decode_record(&stanza).unwrap(),
    )
    .unwrap();
    assert_eq!(opened.expose(), file_key.expose());
    let text =
        open_sealed_metadata(&opened, &header_hash, decode_record(&metadata).unwrap()).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&text).unwrap();
    assert_eq!(json["name"], "shot.png");
    assert_eq!(json["type"], "image/png");

    // Two stanzas for one file are different (a new ephemeral key each time)
    // and both open.
    let second = account_stanza(&account_public_key, &header_hash, &file_key).unwrap();
    assert_ne!(encode_record(&second), stanza);
    assert!(account_stanza_unwrap(&exchange_private_key, &header_hash, &second).is_ok());
    // A stanza does not open for a different file.
    let other_file = Header::new([5; 16]).hash();
    assert!(account_stanza_unwrap(&exchange_private_key, &other_file, &second).is_err());
}
