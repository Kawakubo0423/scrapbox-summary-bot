# Scrapbox Summary Bot 🤖📝
- Scrapbox のゼミページを要約し、Slack にスレッド形式で自動投稿する Node.js 製のボットです。
- GitHub Actions を使って定期実行（例：毎週月曜13時）も可能です。

---

## 📂 ディレクトリ構成）

```
scrapbox-summary-bot/
├── .env                         # ★Git には入れない個人用環境変数
├── .gitignore
├── .editorconfig
├── .prettierrc
├── index.mjs                    # Scrapbox → Slack 本体
├── scrapbox-summary-dry-run.mjs # ローカル確認用スクリプト
├── server.mjs                   # （任意）簡易ローカルサーバ
├── test-openai.mjs              # テスト用
├── package.json
├── package-lock.json
├── README.md
├── .github/
│   └── workflows/
│       ├── summarize.yml        # 定期 & 手動実行で index.mjs を回す
│       └── worker-deploy.yml    # push 時に Cloudflare Workers へ自動デプロイ
└── your-worker/                 # Cloudflare Workers プロジェクト
    ├── wrangler.jsonc           # Worker のメタ設定（Secrets は未記載）
    ├── .dev.vars                # ローカル wrangler dev 用環境変数（Git追跡外推奨）
    ├── src/
    │   └── index.js             # Slack “要約を再生成” を処理する Worker 本体
    ├── test/                    # Worker 用テスト（任意）
    ├── .vscode/                 # VS Code 推奨設定（任意）
    └── node_modules/            # Worker 側の依存（Git には含めない）

```

---

## 🤖 Slack Bot の設定方法（初回のみ）
- Slack API にアクセスし、新しいアプリを作成
- OAuth & Permissions の「Bot Token Scopes」に以下を追加：
- chat:write
- channels:read
- 「Install App to Workspace」で Bot をワークスペースに追加
- SLACK_BOT_TOKEN に Bot Token（xoxb-...）を設定
- 投稿したい Slack チャンネルに Bot を招待（/invite @Bot名）

---

## 📦 主な機能

- Scrapbox の指定ページから `[** 🎤名前]` セクションを検出
- 各発表者のテキストを GPT-4o で要約
  - 全体要約（親メッセージ）
  - 5カテゴリ別のスレッド返信（👏/🔍/⚠/🚧/❓）
- Slack にスレッド形式で自動投稿
- GitHub Actions による定期自動実行（例：毎週月曜13時）
- ページ名（例：`2025前期_Playfulゼミ_Week_11`）を日付から自動生成
- GitHub Actions → Run workflow → “authors” に 佐藤,田中 などを入力 → 実行で選択した人にだけ通知

---

## 🛠 使用技術

- Node.js
- OpenAI API
- Scrapbox API
- Slack Bot API
- GitHub Actions

---

## 📝 環境変数
`.env` をプロジェクト直下に作成し、以下の情報を記述してください：
- SLACK_BOT_TOKEN=<YOUR_SLACK_BOT_TOKEN>
- SCRAPBOX_PROJECT=プロジェクト名
- SCRAPBOX_COOKIE=connect.sid=xxxxx
- SLACK_SIGNING_SECRET=<.envに記載>
- WEBHOOK_KAWAKUBO=https://hooks.slack.com/services/xxxxx
- CHANNEL_KAWAKUBO=チャンネルID（例: C01234567）


---

## 📤 変更をコミット・プッシュする

```bash
# いま your-worker/ の中にいる
cd ..              # ← repo ルートへ戻る
git add your-worker .github/workflows/worker-deploy.yml
git commit -m "feat(worker): add Cloudflare Worker and workflow"
git push origin main


```

---

## 🚀 実行方法（ローカル手動）

```bash
cd scrapbox-summary-bot
node index.mjs "ページタイトル"  # 例: node index.mjs "2025前期_Playfulゼミ_Week_XX"
SELECT_AUTHORS="佐藤,山下" node index.mjs "ページタイトル". #発表者を指定する場合

```

---

## 🚀 デプロイ方法（ローカル手動）

```bash
cd your-worker
wrangler deploy
wrangler tail   #ログ確認

```

---

## ⚠️注意点・詰まった点
- .env を GitHub に push しないこと（push すると自動ブロックされます）
- .gitignore に .env を必ず追加
- 一度 push してしまった場合、履歴から削除する必要あり（git filter-repo 推奨）
- cron の時刻は UTC 時間なので JST に変換すること（+9時間）
- Slack に投稿されない場合、Bot がチャンネルに招待されているか確認
- CHANNEL_名前 の環境変数（例：CHANNEL_KAWAKUBO）を忘れず .env に追加
- index.mjsのALIASに名前の対応表を追加する

---

## ⏰ GitHub Actions による定期実行
- .github/workflows/summarize.yml を編集し、任意の時刻に定期実行を設定できます。
- また、手動実行も可能(GitHubの Actionsタブ にて Run workflow をクリック)

---

## 📘 主要ファイルの説明

| ファイル | 説明 |
----|----
| .env | APIキー・チャンネルID等の秘密情報（Git管理外） |
| index.mjs | Scrapbox要約とSlack投稿の本体スクリプト |
| summarize.yml | GitHub Actions で自動実行する設定 |
| .gitignore | .env などをリポジトリに含めないための設定 |


---

## 🙋‍♂️ 補足

- Scrapbox ページタイトルは index.mjs 側で自動計算できます（ゼミ第〇週）
- GitHub Actions のエラーは Actionsタブ から確認できます
- 複数チャンネルに投げる場合は .env に複数の CHANNEL_◯◯ を登録することで拡張可能



