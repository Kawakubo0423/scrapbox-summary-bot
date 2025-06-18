// scrapbox-summary-dry-run.mjs
// -----------------------------------------------
// テスト専用スクリプト：Scrapbox ページを取得し、
// 発表者ごと → G1〜G6 ブロックごとの "送る予定テキスト"
// を標準出力に表示するだけで終了します。
// （OpenAI 要約も Slack 投稿も行いません）
// -----------------------------------------------

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const PROJECT = process.env.SCRAPBOX_PROJECT;       // 例: playful
const COOKIE  = process.env.SCRAPBOX_COOKIE;
const PAGE    = process.argv[2];                    // ページタイトル
if (!PROJECT || !COOKIE || !PAGE) {
  console.error('使い方: node scrapbox-summary-dry-run.mjs "ページタイトル"');
  process.exit(1);
}

// ---- 1. Scrapbox ページ取得 ----------------------------------------
const url = `https://scrapbox.io/api/pages/${PROJECT}/${encodeURIComponent(PAGE)}`;
const r   = await fetch(url, { headers: { Cookie: COOKIE } });
if (!r.ok) {
  console.error('Scrapbox fetch error:', await r.text());
  process.exit(1);
}
const page = await r.json();

// ---- 2. 行を発表者→グループで分割 ---------------------------------
const AUTHOR_RE = /^\s*\|?>?\s*\[\*\*\s*🎤\s*(.+?)\]/; // [** 📖名前]
const GROUP_RE  = /^\s*\|?>?\s*\[\*\s*G([1-6])\]/;      // [* G1]〜[* G6]

const result = [];                 // [{author, groups:{G1:[...], G2:[...]}}]
let curAuthor = null;
let curGroup  = null;

for (const l of page.lines.slice(1)) {              // 0 行目はタイトル
  const indent = l.text.match(/^\t*/)[0].length;   // タブ数
  const raw    = l.text.replace(/^\t*/, '');       // タブ除去

  const aMatch = indent === 0 ? raw.match(AUTHOR_RE) : null;
  if (aMatch) {
    if (curAuthor) result.push(curAuthor);
    curAuthor = { author: aMatch[1].trim(), groups: {} };
    curGroup  = null;
    continue;
  }

  const gMatch = indent <= 1 ? raw.match(GROUP_RE) : null;
  if (gMatch && curAuthor) {
    curGroup = 'G' + gMatch[1];
    curAuthor.groups[curGroup] ??= [];
    continue;
  }

  if (curAuthor && curGroup) {
    curAuthor.groups[curGroup].push(raw);
  }
}
if (curAuthor) result.push(curAuthor);

// ---- 3. 出力 -------------------------------------------------------
for (const a of result) {
  console.log(`\n===== ${a.author} =====`);
  const groups = Object.keys(a.groups).sort();
  for (const g of groups) {
    console.log(`\n${g}`);
    console.log(a.groups[g].join('\n'));
  }
}

console.log('\n✅ ドライラン完了（OpenAI / Slack には送信していません）');
