// test-openai.mjs
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();                           // .env から OPENAI_API_KEY を読む

if (!process.env.OPENAI_API_KEY) {
  console.error('❌  .env に OPENAI_API_KEY がありません');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-0125',
      messages: [
        { role: 'system', content: 'あなたは要約AIです。' },
        { role: 'user',   content: 'これはテストメッセージです。1行で要約してください。' }
      ],
      max_tokens: 32,
      temperature: 0.2,
    });
    console.log('✅ OpenAI からの応答:', resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('❌ OpenAI 呼び出しで例外:', err);
  }
}

main();
