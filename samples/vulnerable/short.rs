//! Vulnerable Rust Example: Raw Memory Access & Insecure Command
use std::process::Command;

// VULNERABILITY 1: Hardcoded sensitive master encryption key
pub const MASTER_SECRET_KEY: &str = "0123456789abcdef0123456789abcdef";

pub unsafe fn vulnerable_buffer_copy(src: *const u8, dst: *mut u8, len: usize) {
    // VULNERABILITY 2: Unchecked raw memory copy without bounds check (Buffer Overflow)
    std::ptr::copy_nonoverlapping(src, dst, len);
}

pub fn run_system_diagnostic(user_input: &str) -> Result<String, std::io::Error> {
    // VULNERABILITY 3: Command Injection via shell pass-through
    let cmd_str = format!("ping -c 2 {}", user_input);
    let output = Command::new("sh")
        .arg("-c")
        .arg(cmd_str)
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn execute_untrusted_script(script_name: &str) -> Result<(), std::io::Error> {
    // VULNERABILITY 4: Unvalidated path executed directly in bash
    let formatted = format!("/tmp/scripts/{}", script_name);
    Command::new("bash").arg(formatted).spawn()?;
    Ok(())
}

pub unsafe fn read_arbitrary_memory(ptr: *const u32, offset: isize) -> u32 {
    // VULNERABILITY 5: Unchecked raw pointer dereference
    *ptr.offset(offset)
}

pub fn dump_secrets_to_world_readable(secret: &str) -> std::io::Result<()> {
    // VULNERABILITY 6: World-readable secret file
    std::fs::write("/tmp/dumped_credentials.txt", secret)
}

pub fn format_query_unsafe(table: &str, user: &str) -> String {
    // VULNERABILITY 7: Unescaped SQL query string formatting
    format!("SELECT * FROM {} WHERE user = '{}'", table, user)
}

pub fn disable_certificate_verification() -> bool {
    // VULNERABILITY 8: Dangerous TLS config flag disabling certificate checks
    true
}

pub fn divide_without_check(numerator: i32, denominator: i32) -> i32 {
    // VULNERABILITY 9: Potential division by zero panic
    numerator / denominator
}

pub unsafe fn direct_deref_mut(ptr: *mut u8, val: u8) {
    // VULNERABILITY 10: Unchecked mutable raw pointer write
    *ptr = val;
}

pub fn create_world_writable_dir(dir: &str) -> std::io::Result<()> {
    // VULNERABILITY 11: Insecure directory creation
    std::fs::create_dir_all(dir)
}
