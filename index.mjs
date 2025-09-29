// index.mjs  (anchor‑link & category feedback版)
// ------------------------------------------------------------
// Scrapbox ⇒ OpenAI (GPT‑4o) ⇒ Slack スレッド投稿
//   1.  [** 🎤名前] で発表者ブロックを検出（anchor 取得）
//   2.  行全体を AI に渡し
//        ① 全体要約（親）
//        ② 5 カテゴリ別要約（スレッド返信）
//      を送信します
//      ─ カテゴリ ────────────────
//        👏 よかった点
//        🔍 気づき / 新しい視点
//        ⚠ 改善点
//        🚧 次回までに修正
//        ❓ 質問・不明点
// ------------------------------------------------------------
import fetch from 'node-fetch';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

/* --------- 0. 基本設定 ------------------------------------ */
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// ★ workflow_dispatch で渡した SELECT_AUTHORS を配列化
//    - 空文字列や未設定なら null にして「全員対象」
const SELECT_AUTHORS = process.env.SELECT_AUTHORS
  ? process.env.SELECT_AUTHORS.split(',').map(s => s.trim()).filter(Boolean)
  : null;
const PROJECT = process.env.SCRAPBOX_PROJECT;
const COOKIE  = process.env.SCRAPBOX_COOKIE;
function getZemiWeekTitle() {
  const baseDate = new Date('2025-09-29'); // Week 5 の月曜
  const now = new Date(); // 現在の日付
  const diffWeeks = Math.floor((now - baseDate) / (7 * 24 * 60 * 60 * 1000));
  const weekNum = 1 + diffWeeks;
  return `2025後期_Playfulゼミ_Week_${weekNum}`;
}

const PAGE = process.argv[2] || getZemiWeekTitle();

if (!PROJECT || !COOKIE || !PAGE) {
  console.error('使い方: node index.mjs "ページタイトル" または引数なしで実行');
  process.exit(1);
}


/* 日本語名 → 英字キー */
const ALIAS = {
    '佐藤': 'SATO',
    '牧野': 'MAKINO',
    '臼井': 'USUI',
    '田中': 'TANAKA',
    '山下': 'YAMASHITA',
    '川久保': 'KAWAKUBO',
    '末永': 'SUENAGA',
    '岡茂': 'OKAMO',
    '美馬': 'MIMA',
    '脇坂': 'WAKISAKA',
    'LIU': 'LIU',
    '上田': 'UEDA',
    '小川': 'OGAWA',
    '加藤': 'KATO',
    '木越': 'KIGOSHI',
    '久保田': 'KUBOTA',
    '坂本': 'SAKAMOTO',
    '高木': 'TAKAGI',
    '竹内': 'TAKEUCHI',
    '西本': 'NISHIMOTO',
    '松野': 'MATSUNO',
    '丸橋': 'MARUHASHI',
};


/* 1. Scrapbox ページ取得 ------------------------------------ */
const sbURL = `https://scrapbox.io/api/pages/${PROJECT}/${encodeURIComponent(PAGE)}`;
const sbRes = await fetch(sbURL, { headers: { Cookie: COOKIE } });
if (!sbRes.ok) { console.error(await sbRes.text()); process.exit(1); }
const page = await sbRes.json();

/* 2. 発表者ごとに行を束ねる -------------------------------- */
const AUTHOR_RE = /^\s*\|?>?\s*\[\*\*\s*🎤\s*(.+?)\]/; // [** 🎤名前]
const META_RE   = /^\s*\|?>\s*メタなこと/;          // [* メタなこと]
const authors = [];          // [{author, anchor, lines:[] }]
let curAuthor = null;

for (const l of page.lines.slice(1)) {
  const indent = l.text.match(/^\t*/)[0].length;
  const raw    = l.text.replace(/^\t*/, '');

  const am = indent === 0 ? raw.match(AUTHOR_RE) : null;
  if (am) {
    if (curAuthor) authors.push(curAuthor);
    curAuthor = { author: am[1].trim(), anchor: l.id, lines: [] };
    continue;
  }

  const mm = indent === 0 ? raw.match(META_RE) : null; // ② メタブロック
  if (mm) {
    if (curAuthor) authors.push(curAuthor);
    curAuthor = { author: 'メタなこと', anchor: l.id, lines: [] };
    continue;
  }

  if (curAuthor) curAuthor.lines.push(raw);
}
if (curAuthor) authors.push(curAuthor);

/* 3. 要約ヘルパ -------------------------------------------- */
async function summarize(text){
  const r = await openai.chat.completions.create({
    model:'gpt-4o',
    messages:[
      {role:'system',content:'あなたは大学ゼミの議事録要約AIです。'},
      {role:'user',  content:`以下を3行程度で、後で見返したときに分かりやすい全体要約を作成してください。\n\n###\n${text}`}
    ],
    max_tokens:256, temperature:0.2,
  });
  return r.choices[0].message.content.trim();
}

async function categorize(text){
  const prompt=`以下のフィードバックを5つのカテゴリに分類し、各カテゴリ3〜4行で箇条書き要約してください。\n1) よかった点\n2) 気づき / 新しい視点\n3) 改善点\n4) 次回までに修正\n5) 質問・不明点\n\n###\n${text}`;
  const r = await openai.chat.completions.create({
    model:'gpt-4o',
    messages:[{role:'user',content:prompt}],
    max_tokens:512, temperature:0.2,
  });
  return r.choices[0].message.content.trim();
}

// ★ メタ専用：話題ごとに 1 行箇条書き
async function summarizeMeta(text){
  const prompt = `
次のテキストを「話題ごと」にまとめ、各話題を・（中黒）から始めて 1 行以内の日本語にしてください。順序は原文のまま、箇条書きのみを返してください。###${text}`;
  const r = await openai.chat.completions.create({
    model:'gpt-4o',
    messages:[{role:'user',content:prompt}],
    max_tokens:512, temperature:0.2,
  });
  return r.choices[0].message.content.trim();
}

/* 4. Slack 投稿ヘルパ (Bot Token) --------------------------- */
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('SLACK_BOT_TOKEN missing'); process.exit(1);} 

async function postMessage({channel, blocks, thread_ts=null}){
  const body={channel, blocks, text:'_summary_', ...(thread_ts && {thread_ts})};
  const r = await fetch('https://slack.com/api/chat.postMessage',{
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${BOT_TOKEN}`},
    body:JSON.stringify(body)
  }).then(r=>r.json());
  if(!r.ok){throw new Error('Slack error '+JSON.stringify(r));}
  return r.ts;
}

/* 5. 送信ループ -------------------------------------------- */
const CAT_ORDER=[
  {key:'👏 よかった点',        emoji:'👏'},
  {key:'🔍 気づき / 新しい視点',emoji:'🔍'},
  {key:'⚠ 改善点',            emoji:'⚠'},
  {key:'🚧 次回までに修正',    emoji:'🚧'},
  {key:'❓ 質問・不明点',      emoji:'❓'},
];

for (const a of authors){

    // ★ まず「メタなこと」を最優先で処理 --------------------
    if (a.author === 'メタなこと') {
        const channel = process.env.CHANNEL_META
                    || process.env.CHANNEL_ALL
                    || process.env.CHANNEL_ZENTAI;
        if (!channel) { console.warn('⚠️ CHANNEL_META 未設定'); continue; }

        const overall  = await summarizeMeta(a.lines.join('\n'));
        const jumpURL  = `https://scrapbox.io/${PROJECT}/${encodeURIComponent(PAGE)}#${a.anchor}`;
        await postMessage({
        channel,
        blocks:[
            { type:'section', text:{ type:'mrkdwn',
            text:'*:information_source:  今週の「メタなこと」まとめ*'} },
            { type:'section', text:{ type:'mrkdwn',
            text: overall.replace(/^・/gm,'• ') } },   // 要約本体
            { type:'context',  elements:[               // ← 追加ブロック
            { type:'mrkdwn',
                text:`<${jumpURL}|Scrapbox の元ページ（メタなことへ）>` }
            ] }
        ]
        });
        console.log('✅ メタなことを投稿しました');
        continue;                  // 発表者ロジックへ進まない
    }

    // ★ 対象者フィルタリング（メタ以外） --------------------
    if (SELECT_AUTHORS &&
        !SELECT_AUTHORS.includes(a.author) &&
        !SELECT_AUTHORS.includes(ALIAS[a.author] || '')) {
        console.log(`⏭️ スキップ: ${a.author}`);
        continue;
    }


  const key     = ALIAS[a.author];   // 以下は従来どおり発表者処理

  if (!key) { console.warn(`🔸 ALIAS 未登録: ${a.author}`); continue; }
  const channel = process.env['CHANNEL_'+key];
  if(!channel){ console.warn(`⚠️ CHANNEL_${key} 未設定`); continue; }

  /* (i) 全体要約 */
  const rawText = a.lines.join('\n');
  const overall = await summarize(rawText);

  const jumpURL = `https://scrapbox.io/${PROJECT}/${encodeURIComponent(PAGE)}#${a.anchor}`;

// まず最初に postMessage をして parent_ts を取得
let parent_ts = await postMessage({
  channel,
  blocks:[
    { type: 'section', text: { type: 'mrkdwn', text: `*${a.author} さんへの全体要約* :memo:` }},
    { type: 'section', text: { type: 'mrkdwn', text: overall }},
    { type: 'context', elements: [{ type: 'mrkdwn', text: `<${jumpURL}|元ページ（${a.author} セクションへ）>` }] }
  ]
});

// そのあと「ボタン付き」ブロックを追加送信（親メッセージに返信）
await postMessage({
  channel,
  thread_ts: parent_ts,
  blocks: [
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🔄 要約を再生成' },
        style: 'primary',
        action_id: 'retry-summary',
        value: JSON.stringify({
            page: PAGE,
            anchor: a.anchor,
            author: a.author,
            channel,
            thread_ts: parent_ts
            })
      }]
    }
  ]
});

  /* (ii) 5 カテゴリ別要約 */
  const catText = await categorize(rawText);
  const blocksByCat = catText.split(/\n(?=\p{Emoji_Presentation}|\d\))/u); // 分割

  for (const block of blocksByCat){
    const [title,...lines]=block.split(/\n+/);
    const pretty=lines.map(l=>l.replace(/^[-•・]\s*/, '• ')).join('\n');
    if (!pretty.trim()) {
    console.warn(`⚠️ 空のカテゴリ要約をスキップ: ${title}`);
        continue;
    }
    await postMessage({
      channel, thread_ts:parent_ts,
      blocks:[
        {type:'section',text:{type:'mrkdwn',text:`*${title.trim()}*`}},
        {type:'section',text:{type:'mrkdwn',text:pretty}}
      ]
    });
  }
  console.log(`✅ スレッド送信完了: ${a.author}`);
}

console.log('✨ All done.');
