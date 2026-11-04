// Vulnerable JavaScript Example: Auth & Diagnostic Utility
const express = require('express');
const { exec } = require('child_process');
const mysql = require('mysql2/promise');

const router = express.Router();

// VULNERABILITY 1: Hardcoded credentials in source code
const dbConfig = {
  host: 'internal-db.example.com',
  user: 'admin_root',
  password: 'SuperSecretProductionPassword!2026',
  database: 'production_users'
};

// VULNERABILITY 2: SQL Injection via string interpolation
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const connection = await mysql.createConnection(dbConfig);

    // Unsanitized input directly concatenated into SQL query string
    const sql = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
    const [rows] = await connection.query(sql);

    if (rows.length > 0) {
      return res.json({ success: true, token: 'session_token_' + rows[0].id });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

// VULNERABILITY 3: Command Injection via exec
router.get('/ping', (req, res) => {
  const host = req.query.host;
  // User-supplied query parameter directly passed to shell execution
  exec(`ping -c 3 ${host}`, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).send(stderr);
    }
    return res.send(stdout);
  });
});

// VULNERABILITY 4: Eval-based formula evaluator
router.post('/calculate', (req, res) => {
  const formula = req.body.formula;
  // Dangerously evaluating untrusted expression from user input
  const result = eval(formula);
  res.json({ result });
});

// VULNERABILITY 5: Reflected XSS vulnerability
router.get('/welcome', (req, res) => {
  const name = req.query.name || 'Guest';
  // Directly writing unsanitized HTML
  res.send('<h1>Welcome back, ' + name + '!</h1>');
});

module.exports = router;
