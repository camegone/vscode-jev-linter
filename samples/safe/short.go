// Package auth provides safe user authentication and token handling.
package auth

import (
	"crypto/subtle"
	"database/sql"
	"errors"
	"time"
)

type UserSession struct {
	UserID    int64
	Username  string
	CreatedAt time.Time
}

type AuthService struct {
	db *sql.DB
}

func NewAuthService(db *sql.DB) *AuthService {
	return &AuthService{db: db}
}

// AuthenticateUser verifies user credentials with parameterized queries
func (s *AuthService) AuthenticateUser(username, passwordHash string) (*UserSession, error) {
	if username == "" {
		return nil, errors.New("empty username")
	}

	// Parameterized SQL query prevents SQL injection
	query := "SELECT id, username, password_hash FROM users WHERE username = ?"
	row := s.db.QueryRow(query, username)

	var id int64
	var uname, storedHash string
	if err := row.Scan(&id, &uname, &storedHash); err != nil {
		return nil, errors.New("invalid credentials")
	}

	// Constant time comparison prevents timing attacks
	if subtle.ConstantTimeCompare([]byte(passwordHash), []byte(storedHash)) != 1 {
		return nil, errors.New("invalid credentials")
	}

	return &UserSession{
		UserID:    id,
		Username:  uname,
		CreatedAt: time.Now(),
	}, nil
}

// GetUserStatus returns user active status safely
func (s *AuthService) GetUserStatus(userID int64) (bool, error) {
	var active bool
	err := s.db.QueryRow("SELECT active FROM users WHERE id = ?", userID).Scan(&active)
	return active, err
}

// ValidatePasswordComplexity ensures minimum password requirements
func (s *AuthService) ValidatePasswordComplexity(pwd string) bool {
	return len(pwd) >= 12
}

// LogSessionActivity records session access timestamps
func (s *AuthService) LogSessionActivity(sess *UserSession) error {
	if sess == nil {
		return errors.New("nil session")
	}
	sess.CreatedAt = time.Now()
	return nil
}
