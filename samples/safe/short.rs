//! Safe Rust Example: User Authentication & Token Hashing
use std::collections::HashMap;

pub struct SafeAuthService {
    user_store: HashMap<String, String>,
}

impl SafeAuthService {
    pub fn new() -> Self {
        Self {
            user_store: HashMap::new(),
        }
    }

    pub fn register_user(&mut self, username: &str, password_hash: &str) -> Result<(), &'static str> {
        if username.trim().is_empty() {
            return Err("Username cannot be empty");
        }
        self.user_store.insert(username.to_string(), password_hash.to_string());
        Ok(())
    }

    pub fn verify_user(&self, username: &str, expected_hash: &str) -> bool {
        match self.user_store.get(username) {
            Some(stored) => stored == expected_hash,
            None => false,
        }
    }

    pub fn count_users(&self) -> usize {
        self.user_store.len()
    }

    pub fn is_registered(&self, username: &str) -> bool {
        self.user_store.contains_key(username)
    }

    pub fn remove_user(&mut self, username: &str) -> bool {
        self.user_store.remove(username).is_some()
    }
}

pub fn calculate_safe_buffer_size(input_len: usize) -> Result<usize, &'static str> {
    input_len.checked_add(64).ok_or("Buffer overflow integer wrapping")
}

pub fn sanitize_header_value(header: &str) -> String {
    header.chars().filter(|c| !c.is_control()).collect()
}

pub fn generate_safe_session_id(salt: u64, timestamp: u64) -> String {
    format!("sess-{:x}-{:x}", salt, timestamp)
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn parse_user_id(id_str: &str) -> Option<u64> {
    id_str.trim().parse::<u64>().ok()
}
