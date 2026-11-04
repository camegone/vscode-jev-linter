// サンプルファイル: 潜在的な脆弱性を含むコード例
const express = require('express');
const { exec } = require('child_process');
const mysql = require('mysql2');

const app = express();
app.use(express.json());

// 危険な例1: コマンドインジェクション
app.get('/ping', (req, res) => {
  const host = req.query.host;
  // 未検証の入力をそのままシェルコマンドに渡している
  exec(`ping -c 4 ${host}`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).send(stderr);
    }
    res.send(stdout);
  });
});

// 危険な例2: SQLインジェクション
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'hardcoded_super_secret_password_1234', // ハードコードされたクレデンシャル
  database: 'myapp'
});

app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  // プリペアドステートメントを使用せずに文字列連結
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  db.query(query, (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
