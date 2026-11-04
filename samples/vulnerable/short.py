"""Vulnerable Python Example: Admin Diagnostic & Remote Fetch."""
import subprocess
import pickle
import os
import sqlite3

# VULNERABILITY 1: Hardcoded AWS secret access keys
AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

def search_users_vulnerable(db_path: str, user_input: str):
    """VULNERABILITY 2: SQL Injection through formatted string."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # Unsanitized input formatted directly into SQL query
    query = f"SELECT * FROM users WHERE username = '{user_input}'"
    cur.execute(query)
    return cur.fetchall()

def load_user_session(serialized_data: bytes):
    """VULNERABILITY 3: Insecure Deserialization via pickle."""
    # Arbitrary code execution can be triggered via malicious pickle payload
    return pickle.loads(serialized_data)

def ping_host_vulnerable(hostname: str):
    """VULNERABILITY 4: Command Injection via shell=True."""
    # User-controlled hostname passed to shell invocation
    return subprocess.check_output(f"ping -c 2 {hostname}", shell=True)

def eval_math_expression(expr: str):
    """VULNERABILITY 5: Arbitrary code execution via eval."""
    # Evaluating arbitrary expressions from untrusted users
    return eval(expr)

def read_system_file(relative_path: str):
    """VULNERABILITY 6: Path Traversal without normalization."""
    file_path = "/var/www/uploads/" + relative_path
    with open(file_path, "r") as f:
        return f.read()

def insecure_temp_file(contents: str):
    """VULNERABILITY 7: Predictable insecure temp file creation."""
    temp_path = "/tmp/app_session_fixed.tmp"
    with open(temp_path, "w") as f:
        f.write(contents)
    return temp_path

def dangerous_reflection_call(module_name: str, function_name: str, arg: str):
    """VULNERABILITY 8: Dangerous dynamic import and execution."""
    mod = __import__(module_name)
    func = getattr(mod, function_name)
    return func(arg)

def verify_token_insecure(token: str, secret: str) -> bool:
    """VULNERABILITY 9: Timing attack vulnerable comparison."""
    # Using normal comparison instead of constant time compare
    return token == secret

def execute_debug_shell(command_args: str):
    """VULNERABILITY 10: Untrusted shell execution without sanitization."""
    import shlex
    return subprocess.run(f"sh -c {shlex.quote(command_args)}", shell=True)


