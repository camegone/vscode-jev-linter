// 安全なコード例
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

// 安全な例1: コマンド実行を行わず、適切なバリデーション
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 安全な例2: プレースホルダーを使用したプリペアドステートメント
app.post('/user', async (req, res) => {
  const userId = parseInt(req.body.id, 10);
  if (isNaN(userId)) {
    return res.status(400).send('Invalid user ID');
  }

  const [rows] = await db.execute('SELECT id, name FROM users WHERE id = ?', [userId]);
  res.json(rows);
});

module.exports = app;
