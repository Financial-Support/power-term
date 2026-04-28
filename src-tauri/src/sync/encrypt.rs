use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};

pub const KEY_LEN: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum EncryptError {
    #[error("encrypt failed")]
    Encrypt,
    #[error("decrypt failed — wrong key or corrupted data")]
    Decrypt,
    #[error("invalid ciphertext — too short")]
    TooShort,
}

/// Generate a cryptographically random 32-byte key.
pub fn generate_key() -> [u8; KEY_LEN] {
    let key = Aes256Gcm::generate_key(OsRng);
    key.into()
}

/// Encode a 32-byte key as a Base58 string (~44 chars).
pub fn key_to_base58(key: &[u8; KEY_LEN]) -> String {
    bs58::encode(key).into_string()
}

/// Decode a Base58 string back to a 32-byte key. Returns None if invalid.
pub fn key_from_base58(s: &str) -> Option<[u8; KEY_LEN]> {
    let bytes = bs58::decode(s).into_vec().ok()?;
    if bytes.len() != KEY_LEN { return None; }
    let mut arr = [0u8; KEY_LEN];
    arr.copy_from_slice(&bytes);
    Some(arr)
}

/// Encrypt plaintext with AES-256-GCM. Returns base64(12-byte nonce || ciphertext).
pub fn encrypt(plaintext: &str, key: &[u8; KEY_LEN]) -> Result<String, EncryptError> {
    use base64::Engine;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes()).map_err(|_| EncryptError::Encrypt)?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
}

/// Decrypt base64(nonce || ciphertext) with AES-256-GCM. Returns plaintext.
pub fn decrypt(encoded: &str, key: &[u8; KEY_LEN]) -> Result<String, EncryptError> {
    use base64::Engine;
    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| EncryptError::TooShort)?;
    if combined.len() < 12 { return Err(EncryptError::TooShort); }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| EncryptError::Decrypt)?;
    String::from_utf8(plaintext).map_err(|_| EncryptError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_key_is_32_bytes() {
        let k = generate_key();
        assert_eq!(k.len(), 32);
    }

    #[test]
    fn key_base58_round_trip() {
        let k = generate_key();
        let encoded = key_to_base58(&k);
        assert!(!encoded.is_empty());
        let decoded = key_from_base58(&encoded).expect("should decode");
        assert_eq!(k, decoded);
    }

    #[test]
    fn key_from_base58_rejects_wrong_length() {
        assert!(key_from_base58("tooshort").is_none());
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = generate_key();
        let plain = "s3cret-p@ssword!";
        let enc = encrypt(plain, &key).unwrap();
        let dec = decrypt(&enc, &key).unwrap();
        assert_eq!(dec, plain);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let key1 = generate_key();
        let key2 = generate_key();
        let enc = encrypt("hello", &key1).unwrap();
        assert!(decrypt(&enc, &key2).is_err());
    }

    #[test]
    fn decrypt_truncated_ciphertext_fails() {
        let key = generate_key();
        assert!(decrypt("dG9vc2hvcnQ=", &key).is_err()); // base64("tooshort") — 8 bytes
    }

    #[test]
    fn encrypt_produces_different_ciphertexts_each_time() {
        let key = generate_key();
        let enc1 = encrypt("same", &key).unwrap();
        let enc2 = encrypt("same", &key).unwrap();
        assert_ne!(enc1, enc2, "random nonce should produce unique ciphertexts");
    }
}
