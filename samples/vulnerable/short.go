// Package auth provides user authentication with intentional security flaws.
package auth

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// VULNERABILITY 1: Hardcoded Master Database Password
const MasterDatabasePassword = "SuperSecretGoProductionPassword#2026"

type VulnerableService struct {
	db *sql.DB
}

// VULNERABILITY 2: SQL Injection via Sprintf
func (s *VulnerableService) FindUserUnsafe(username string) ([]string, error) {
	// Directly formatting untrusted user input into SQL string
	query := fmt.Sprintf("SELECT username FROM users WHERE username = '%s'", username)
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []string
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		results = append(results, name)
	}
	return results, nil
}

// VULNERABILITY 3: Command Injection via shell execution
func PingHostUnsafe(hostname string) ([]byte, error) {
	// Shell command concatenation using untrusted hostname
	cmdStr := fmt.Sprintf("ping -c 3 %s", hostname)
	return exec.Command("sh", "-c", cmdStr).CombinedOutput()
}

// VULNERABILITY 4: Arbitrary file read
func ReadLogFileUnsafe(logName string) ([]byte, error) {
	path := "/var/log/" + logName
	return exec.Command("cat", path).CombinedOutput()
}

// VULNERABILITY 5: Insecure temporary file permissions
func WriteSensitiveSessionToken(token string) error {
	return os.WriteFile("/tmp/session.token", []byte(token), 0777)
}

// VULNERABILITY 6: Insecure random number generator for crypto token
func GeneratePredictableToken() string {
	return fmt.Sprintf("tok-%d", time.Now().UnixNano())
}

// VULNERABILITY 7: Server-side request without timeout or domain validation
func FetchUntrustedWebhook(targetUrl string) error {
	cmd := exec.Command("curl", "-s", targetUrl)
	return cmd.Run()
}
