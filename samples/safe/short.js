// Safe JavaScript Example: User Authentication & Profile
const express = require('express');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pool = require('./db');

const router = express.Router();
router.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Safe login handler using parameterized query and bcrypt
router.post('/login', limiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input types' });
    }

    // Parameterized SQL query prevents SQL injection
    const query = 'SELECT id, username, password_hash FROM users WHERE username = $1';
    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    return res.json({ message: 'Login successful', userId: user.id });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Safe ping handler using strict input validation and no shell execution
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Safe profile retrieval with input validation
router.get('/profile/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(result.rows[0]);
});

module.exports = router;
