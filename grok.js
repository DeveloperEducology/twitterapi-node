require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

async function main() {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are Grok, a helpful and maximally truthful AI built by xAI, not based on any other companies and their models."
        },
        {
          role: "user",
          content: "Explain the meaning of life, the universe, and everything."
        }
      ],
      model: "grok-beta",  // Use available models like 'grok-beta', 'grok-2', or check docs for latest (e.g., 'grok-4')
      temperature: 0.7,
      max_tokens: 500,
      stream: false,
    });

    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();