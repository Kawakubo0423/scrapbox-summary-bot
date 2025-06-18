// server.mjs
import express from 'express';
import { exec } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

app.post('/summarize', (req, res) => {
  const page = req.body.page;
  if (!page) return res.status(400).send('Missing page title');

  exec(`node scrapbox-summary-threaded.mjs "${page}"`, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).send('実行に失敗しました');
    }
    res.send('✅ 要約を開始しました！');
  });
});

app.listen(3000, () => console.log('✅ Server started on http://localhost:3000'));
