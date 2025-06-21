export default {
  async fetch(request, env, ctx) {   // ← ctx を受け取る
    /* ---------- 署名検証 ---------- */
const rawBody = await request.text();
const ts  = request.headers.get("x-slack-request-timestamp");
const sig = request.headers.get("x-slack-signature");

const enc   = new TextEncoder();
const key   = await crypto.subtle.importKey(
  "raw",
  enc.encode(env.SLACK_SIGNING_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const data  = enc.encode(`v0:${ts}:${rawBody}`);
const buf   = await crypto.subtle.sign("HMAC", key, data);
const hex   = [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");

if (`v0=${hex}` !== sig) {
  return new Response("Invalid signature", { status: 401 });
}

    /* ---------- 2. payload を取り出す ----------------------- */
    const params   = new URLSearchParams(rawBody);
    const payload  = JSON.parse(params.get("payload"));

	// ボタン value に詰めた JSON を取り出す
	const meta = payload.actions?.[0]?.value
	? JSON.parse(payload.actions[0].value)
	: {};

	const channel   = meta.channel ?? payload.channel.id;
	const thread_ts = meta.thread_ts
					?? payload.message.thread_ts   // ボタンが親を押すパターン
					?? payload.message.ts;         // フォールバック

    /* ---------- 3. 先に「再生成中…」へ即レス --------------- */
    await slackUpdate(env.SLACK_BOT_TOKEN, {
      channel, ts: thread_ts,
      text: "🔄 再生成中…",
      blocks:[{ type:"section",
        text:{ type:"mrkdwn", text:"🔄 再生成中…"} }]
    });

	// 重い処理をバックグラウンドで実行
	ctx.waitUntil(processReSummary({ ...meta, channel, thread_ts }, env));
	return new Response("OK");   // 3 秒以内に即レス
  }
};

/* 共通ヘルパ */
async function slackUpdate(token, data){
  const res = await fetch("https://slack.com/api/chat.update",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${token}`
    },
    body: JSON.stringify(data)
  }).then(r=>r.json());

  if(!res.ok){
    console.log("chat.update error:", res);
  }
}


async function fetchSection(project, page, anchor, cookie) {
  const res = await fetch(
    `https://scrapbox.io/api/pages/${project}/${encodeURIComponent(page)}`,
    { headers: { Cookie: `connect.sid=${cookie}` } }
  );
  const pageJson = await res.json();

    // ここで lines が無ければ原因を stdout に出して早期エラー
  if (!pageJson.lines) {
    console.log("❌ Scrapbox error JSON:", JSON.stringify(pageJson));
    throw new Error("Scrapbox API did not return lines");
  }

  const start = pageJson.lines.findIndex(l => l.id === anchor);
  let lines = [];
  for (let i = start + 1; i < pageJson.lines.length; i++) {
    const t = pageJson.lines[i].text.replace(/^\t*/, "");
    // 次見出しで終了
    if (/^\s*\|?>?\s*\[\*\*\s*🎤|\s*\|?>\s*メタなこと/.test(t)) break;
    lines.push(t);
  }
  return lines.join("\n");
}

async function callOpenAI(prompt, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature: 0.2
    })
  }).then(r => r.json());
  return res.choices?.[0]?.message?.content?.trim() ?? "";
}



async function processReSummary(meta, env) {
	// A. 元ページリンク
	const jumpURL =
		`https://scrapbox.io/${env.SCRAPBOX_PROJECT}/` +
		`${encodeURIComponent(meta.page)}#${meta.anchor}`;

  // C. Scrapbox 生テキスト取得
  const rawText = await fetchSection(
    env.SCRAPBOX_PROJECT, meta.page, meta.anchor, env.SCRAPBOX_COOKIE
  );

  // D. OpenAI
  const overall = await callOpenAI(`以下を 3 行以内で要約…\n###\n${rawText}`, env.OPENAI_API_KEY);
  const catPrompt = `
	以下のフィードバックを 5 つのカテゴリにまとめてください。
	**各カテゴリの行頭を必ず「1)」「2)」「3)」「4)」「5)」の数字と括弧で始め**、
	そのあとにカテゴリ名を書き、2〜4 行の箇条書き（•）を付けてください。
	1) よかった点
	2) 気づき / 新しい視点
	3) 改善点
	4) 次回までに修正
	5) 質問・不明点
	###
	${rawText}`;
	const catText = await callOpenAI(catPrompt, env.OPENAI_API_KEY);
  

  // E. 親メッセージを update
  await slackUpdate(env.SLACK_BOT_TOKEN, {
    channel: meta.channel,
    ts:      meta.thread_ts,
    text:    "✅ 再生成完了",
    blocks: [
      { type:"section",
        text:{ type:"mrkdwn",
               text:`*${meta.author} さんへの全体要約* :memo:`}},
      { type:"section",
        text:{ type:"mrkdwn", text: overall }},
		      { type:"context",
        elements:[{ type:"mrkdwn",
        	text:`<${jumpURL}|Scrapbox の元ページへ>`}] }
    ]
  });

   // ===== 既存の返信を一旦クリア =====================
	await cleanThread(meta.channel, meta.thread_ts, env.SLACK_BOT_TOKEN);

  // F. 5 カテゴリ返信
  await postFiveCats(catText, meta.channel, meta.thread_ts, env.SLACK_BOT_TOKEN);
}

async function postFiveCats(catText, channel, thread_ts, token) {
    // 「1) 」「### 」どちらでも区切れるように
  const SPLIT_RE = /\n(?=(?:[1-5]\)|###))/u;
  const blocksByCat = catText.split(SPLIT_RE);
  for (const block of blocksByCat) {
    const [titleLine, ...lines] = block.trim().split(/\n+/);
	if (!titleLine) continue;   // ← 空ブロック除去

	// タイトルの整形。番号を残したいなら replace 行を削除
		const title = titleLine
		.replace(/^###\s*/,"")   // 「### 」だけ除去。1) は残る
		.trim();
		if (!lines.length) continue;

    await fetch("https://slack.com/api/chat.postMessage", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${token}`
      },
      body: JSON.stringify({
        channel,
        thread_ts,
        blocks:[
          { type:"section",
            text:{ type:"mrkdwn", text:`*${title}*`}},
          { type:"section",
            text:{ type:"mrkdwn",
                   text: lines.map(l=>l.replace(/^[-•・]\s*/, "• ")).join("\n") }}
        ]
      })
    });
  }
}


async function cleanThread(channel, thread_ts, token){
  // スレッド内のメッセージ一覧を取得
  // ① channel と ts をクエリに付ける
  const resp = await fetch(
    "https://slack.com/api/conversations.replies" +
    `?channel=${encodeURIComponent(channel)}` +
    `&ts=${encodeURIComponent(thread_ts)}` +
    "&limit=200",
    {
      method:"GET",
      headers:{ "Authorization":`Bearer ${token}` }
    }
  ).then(r=>r.json());

  if(!resp.ok) { console.log("cleanThread error:", resp); return; }

  // 親(ts==thread_ts) と直近のボタン付きメッセージは残し、
  // それ以外(5カテゴリ返信など)を削除
  for(const msg of resp.messages){
    if (msg.ts === thread_ts) continue;           // 親
    if (msg.blocks?.[0]?.type === "actions") continue; // ボタン付き
    await fetch("https://slack.com/api/chat.delete", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${token}`
      },
      body: JSON.stringify({ channel: channel, ts:      msg.ts })
    });
  }
}
