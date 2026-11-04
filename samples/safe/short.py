"""Safe Python Example: User Authentication & Service Status."""
import hashlib
import hmac
import os
import sqlite3
from typing import Optional, Dict, Any

# Secure password hashing with PBKDF2
def hash_password(password: str, salt: Optional[bytes] = None) -> Dict[str, str]:
    if salt is None:
        salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt,
        iterations=100000
    )
    return {
        "salt": salt.hex(),
        "hash": key.hex()
    }

def get_user_by_id(db_path: str, user_id: int) -> Optional[Dict[str, Any]]:
    # Parameterized query prevents SQL injection
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        query = "SELECT id, username, email FROM users WHERE id = ?"
        cursor.execute(query, (user_id,))
        row = cursor.fetchone()
        if row:
            return {"id": row[0], "username": row[1], "email": row[2]}
    return None

def verify_credentials(candidate_pass: str, user: Dict[str, str]) -> bool:
    if not candidate_pass or not user.get("salt") or not user.get("hash"):
        return False
    candidate_hash = hash_password(candidate_pass, bytes.fromhex(user["salt"]))
    return hmac.compare_digest(user["hash"], candidate_hash["hash"])

def get_server_health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "timestamp": int(os.times().system),
        "active_processes": 1
    }

def calculate_discount(price: float, rate: float) -> float:
    if price < 0 or rate < 0 or rate > 1:
        raise ValueError("Invalid price or discount rate")
    return round(price * (1 - rate), 2)

def generate_session_token() -> str:
    # Cryptographically secure random token
    return os.urandom(32).hex()

def validate_email_address(email: str) -> bool:
    return "@" in email and len(email) >= 5
