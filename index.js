import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import TwitterApiClient from "./twitterapi-client.js";
import dotenv from "dotenv";
import cron from "node-cron";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });



const SELF_URL = process.env.SERVER_URL || "https://twitterapi-7313.onrender.com";
// ========================
// Helpers
// ========================
function containsTelugu(text) {
  return /[\u0C00-\u0C7F]/.test(text);
}

async function processWithGemini(text) {
  try {
    let prompt;

    if (containsTelugu(text)) {
      prompt = `You are a professional Telugu journalist. Summarize the following Telugu news text into a concise news-style title and summary in Telugu. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    } else {
      prompt = `You are a professional Telugu journalist. Translate the following English news text into Telugu and create a short Telugu news title and summary. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    }

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let content = response.text().trim();

    // Clean ```json fences
    content = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(content);
    return {
      title: parsed.title || text.slice(0, 50),
      summary: parsed.summary || text,
    };
  } catch (err) {
    console.error("Gemini processing error:", err.message);
    return { title: text.slice(0, 50), summary: text };
  }
}

// ========================
// MongoDB Models
// ========================
const articleSchema = new mongoose.Schema(
  {
    title: String,
    summary: String,
    url: { type: String, unique: true },
    source: String,
    isCreatedBy: { type: String, default: "twitter_scraper" },
    publishedAt: Date,
    media: media: [
      {
        type: { type: String, default: "photo" },
        url: String,
        variants: [
          {
            bitrate: Number,
            url: String,
          },
        ],
      },
    ],
  },
  { timestamps: true }
);
const Article = mongoose.model("Article", articleSchema);

const cacheSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  tweets: Array,
  lastFetched: Date,
});
const TweetCache = mongoose.model("TweetCache", cacheSchema);

const formattedTweetSchema = new mongoose.Schema(
  {
    tweetId: { type: String, unique: true, required: true },
    url: String,
    twitterUrl: String,
    text: String,
    title: String,
    summary: String,
    createdAt: Date,
    lang: String,
    media: [
      {
        type: { type: String },
        url: String,
        variants: [
          {
            bitrate: Number,
            url: String,
          },
        ],
      },
    ],
  },
  { timestamps: true, collection: "formatted_tweets" }
);
const FormattedTweet = mongoose.model("FormattedTweet", formattedTweetSchema);

// ========================
// Express + MongoDB Setup
// ========================
const app = express();
app.use(express.json());
const PORT = 4000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// ========================
// Twitter Client
// ========================
const client = new TwitterApiClient(process.env.TWITTER_API_KEY);

// ========================
// Hugging Face APIs
// ========================
const HF_API_TOKEN = process.env.HF_API_TOKEN;


// 🔄 Self-ping every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const res = await fetch(SELF_URL);
    console.log("Self-ping status:", res.status, new Date());
  } catch (err) {
    console.error("Self-ping failed:", err);
  }
});


async function summarizeText(text) {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/facebook/bart-large-cnn",
      { inputs: text },
      { headers: { Authorization: `Bearer ${HF_API_TOKEN}` } }
    );
    return res.data[0]?.summary_text || text;
  } catch (err) {
    console.error("Summarizer API error:", err.message);
    return text;
  }
}

async function translateText(text, sourceLang = "te", targetLang = "en") {
  try {
    const model =
      sourceLang === "te" && targetLang === "en"
        ? "Helsinki-NLP/opus-mt-te-en"
        : `Helsinki-NLP/opus-mt-${sourceLang}-${targetLang}`;

    const res = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: text },
      { headers: { Authorization: `Bearer ${HF_API_TOKEN}` } }
    );
    return res.data[0]?.translation_text || text;
  } catch (err) {
    console.error(
      `Translator API error (${sourceLang}→${targetLang}):`,
      err.message
    );
    return text;
  }
}

// ========================
// Convert Tweet → Article
// ========================
async function tweetToArticle(tweet, username) {
  const id = tweet.id_str || tweet.id;
  const text = tweet.full_text || tweet.text || "";

  const publishedAt = tweet.created_at
    ? new Date(tweet.created_at).toISOString()
    : new Date().toISOString();

  const media =
    tweet.entities?.media?.map((m, idx) => ({
      mediaType: m.type || "image",
      url: m.media_url_https || m.media_url || m.url,
      _id: `${id}_${idx}`,
    })) ||
    tweet.extended_entities?.media?.map((m, idx) => ({
      mediaType: m.type || "image",
      url: m.media_url_https || m.media_url || m.url,
      _id: `${id}_${idx}`,
    })) ||
    [];

  let englishText = text;
  let teluguText = containsTelugu(text) ? text : "";

  if (teluguText) {
    try {
      englishText = await translateText(teluguText, "te", "en");
    } catch (err) {
      console.warn(
        "Translation failed, using Telugu as fallback:",
        err.message
      );
      englishText = "";
    }
  }

  const finalText = englishText?.trim() ? englishText : teluguText;
  const summary = await summarizeText(finalText);

  return {
    title: summary.length > 60 ? summary.slice(0, 60) + "..." : summary,
    summary,
    url: `https://twitter.com/${username}/status/${id}`,
    source: username,
    isCreatedBy: "twitter_scraper",
    publishedAt,
    media,
  };
}

// ========================
// Fetch & Save Tweets (Cache + Dedup)
// ========================
async function fetchAndSaveTweets(username, count = 5) {
  const cache = await TweetCache.findOne({ username });
  const now = new Date();

  if (cache && now - cache.lastFetched < 10 * 60 * 1000) {
    return cache.tweets;
  }

  const response = await client.getUserLastTweets(username, count);
  const tweets = response?.data?.tweets || [];
  const articles = [];

  for (const tweet of tweets) {
    const article = await tweetToArticle(tweet, username);

    const existing = await Article.findOne({ url: article.url });
    if (!existing) {
      const saved = await Article.create(article);
      articles.push(saved);
    } else {
      articles.push(existing);
    }
  }

  const uniqueArticles = Array.from(
    new Map(articles.map((a) => [a.url, a])).values()
  );

  await TweetCache.findOneAndUpdate(
    { username },
    { tweets: uniqueArticles, lastFetched: new Date() },
    { upsert: true }
  );

  return uniqueArticles;
}

// ========================
// API Endpoints
// ========================
app.get("/api/articles/:username", async (req, res) => {
  const { username } = req.params;
  const count = parseInt(req.query.count) || 5;

  try {
    const articles = await fetchAndSaveTweets(username, count);
    res.json({ status: "success", source: username, articles });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch tweets" });
  }
});

app.post("/api/fetch-multiple", async (req, res) => {
  const usernames = req.body.usernames || [];
  const count = parseInt(req.body.count) || 5;
  const intervalMs = parseInt(req.body.intervalMs) || 60 * 1000;

  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res
      .status(400)
      .json({ status: "error", message: "No usernames provided" });
  }

  usernames.forEach((username, index) => {
    setTimeout(async () => {
      try {
        const articles = await fetchAndSaveTweets(username, count);
        console.log(`✅ Fetched ${articles.length} tweets for ${username}`);
      } catch (err) {
        console.error(`❌ Error fetching tweets for ${username}:`, err.message);
      }
    }, index * intervalMs);
  });

  res.json({
    status: "success",
    message: `Fetching tweets for ${
      usernames.length
    } usernames in intervals of ${intervalMs / 1000} seconds`,
  });
});

// Cron tasks
cron.schedule("*/6 * * * *", () => {
  console.log("⏰ Cron: Waking server to prevent sleep");
});

const AUTO_USERS = process.env.AUTO_USERS
  ? process.env.AUTO_USERS.split(",")
  : [];
cron.schedule("*/10 * * * *", async () => {
  console.log("⏰ Cron: Auto-fetching tweets for predefined users");
  for (const username of AUTO_USERS) {
    try {
      const articles = await fetchAndSaveTweets(username, 5);
      console.log(`✅ Auto-fetched ${articles.length} tweets for ${username}`);
    } catch (err) {
      console.error(`❌ Auto-fetch error for ${username}:`, err.message);
    }
  }
});

// ========================
// Endpoint: Formatted Tweet Fetch
// ========================
app.get("/api/formatted-tweet/:tweetIds", async (req, res) => {
  try {
    const tweet_ids = req.params.tweetIds || req.query.tweet_ids;
    if (!tweet_ids)
      return res.status(400).json({ error: "tweet_ids required" });

    const withGemini = req.query.withGemini !== "false";

    const response = await fetch(
      `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweet_ids}`,
      {
        headers: {
          "x-api-key": process.env.TWITTER_API_KEY,
        },
      }
    );

    const data = await response.json();

    if (data.status !== "success" || !data.tweets || !data.tweets.length) {
      return res.status(404).json({
        error: "Tweet(s) not found or API returned error",
        rawResponse: data,
      });
    }

    const formattedTweets = [];

    for (const tweet of data.tweets) {
      const ft = {
        tweetId: tweet.id,
        url: tweet.url,
        twitterUrl: tweet.twitterUrl,
        text: tweet.text,
        createdAt: new Date(tweet.createdAt),
        lang: tweet.lang,
        media:
          tweet.extendedEntities?.media
            ?.map((m) => {
              if (m.type === "photo") {
                return { type: "photo", url: m.media_url_https || m.media_url };
              } else if (m.type === "video" || m.type === "animated_gif") {
                return {
                  type: m.type,
                  variants:
                    m.video_info?.variants?.map((v) => ({
                      bitrate: v.bitrate || null,
                      url: v.url,
                    })) || [],
                };
              }
              return null;
            })
            .filter(Boolean) || [],
      };

      if (withGemini) {
        const geminiResult = await processWithGemini(ft.text);
        ft.title = geminiResult.title;
        ft.summary = geminiResult.summary;
      }

      await FormattedTweet.findOneAndUpdate({ tweetId: ft.tweetId }, ft, {
        upsert: true,
        new: true,
      });

      formattedTweets.push(ft);
    }

    res.json({ status: "success", withGemini, tweets: formattedTweets });
  } catch (err) {
    console.error("Error fetching tweets:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ========================
// Summarization Endpoint (Telugu Headline + Summary)
// ========================
app.post("/api/summarize", async (req, res) => {
  try {
    const { text, url, source } = req.body;
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    if (!!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const isTelugu = /[\u0C00-\u0C7F]/.test(text);

    const prompt = isTelugu
      ? `
You are a professional Telugu news journalist.  

Task: Create TWO outputs in Telugu from the following text:  

1. **Title** → A short, catchy news headline in Telugu (8–12 words).  
   - Must feel like a professional Telugu newspaper headline.  
   - No English, no transliteration.  
   - No quotes or section labels.  

2. **Summary** → A news-style article body (65–80 words).  
   - Formal, informative, neutral journalistic tone.  
   - Undestand the context of each word
   - Clear, concise, newspaper-ready style.  
   - No headings, no extra formatting. 
    

Text:
${text}

Return result strictly in JSON:
{
  "title": "…",
  "summary": "…"
}
      `
      : `
You are a professional Telugu news journalist.  

The input is in English. Translate it into Telugu and then create TWO outputs:  

1. **Title** → A short, catchy Telugu news headline (8–12 words).  
   - Must feel like a professional Telugu newspaper headline.  
   - No English, no transliteration.  
   - No quotes or section labels.  

2. **Summary** → A news-style article body (65–80 words).  
   - Formal, informative, neutral journalistic tone.  
   - Clear, concise, newspaper-ready style.  
   - No headings, no extra formatting.  

English Text:
${text}

Return result strictly in JSON:
{
  "title": "…",
  "summary": "…"
}
      `;

    const response = await genAI
      .getGenerativeModel({ model: "gemini-1.5-flash" })
      .generateContent(prompt);

    let content = response.response.text().trim();

    // Clean JSON fences
    content = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn("⚠️ Gemini did not return JSON, fallback to raw text");
      parsed = { title: "", summary: content };
    }

    let { title, summary } = parsed;
const fallbackImage = "https://cdn.pixabay.com/photo/2017/06/26/19/03/news-2444778_960_720.jpg"
    // Fallbacks
    if (!title) {
      title = isTelugu ? text.slice(0, 50) : "తెలుగు వార్త శీర్షిక";
    }
    if (!summary) {
      summary = text.slice(0, 200) + "...";
    }

    // Save into DB
    const article = await Article.findOneAndUpdate(
      { url },
      {
        title,
        summary,
        url,
        source: source || "manual",
        media: [{ type: "image", url: fallbackImage }],

        publishedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ status: "success", article });
  } catch (err) {
    console.error("❌ Summarize error:", err);
    res.status(500).json({
      error: "Failed to summarize text",
      details: err.message,
    });
  }
});

app.get("/api/saved-tweets", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    // Fetch tweets and articles
    const [tweets, articles] = await Promise.all([
      FormattedTweet.find().lean(),
      Article.find({ source: "manual" }).lean(),
    ]);

    // Merge both arrays and sort by createdAt descending
    const combined = [...tweets, ...articles].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const total = combined.length;

    // Paginate the combined array
    const paginated = combined.slice(skip, skip + limit);

    res.json({
      status: "success",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      posts: paginated, // unified feed
    });
  } catch (err) {
    console.error("Error fetching saved tweets and articles:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ========================
// Start Server
// ========================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
