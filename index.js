// index.js
import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import TwitterApiClient from "./twitterapi-client.js";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config(); // load .env variables

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
    media: [
      {
        mediaType: String,
        url: String,
        _id: String,
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
// Hugging Face API
// ========================
const HF_API_TOKEN = process.env.HF_API_TOKEN;

// ========================
// Helper: Summarize Text
// ========================
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

// ========================
// Helper: Translate Telugu → English
// ========================
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
    console.error(`Translator API error (${sourceLang}→${targetLang}):`, err.message);
    return text;
  }
}

// ========================
// Helper: Detect Telugu
// ========================
function containsTelugu(text) {
  return /[\u0C00-\u0C7F]/.test(text);
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
      console.warn("Translation failed, using Telugu as fallback:", err.message);
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
// Endpoint: Single Username
// ========================
app.get("/api/articles/:username", async (req, res) => {
  const { username } = req.params;
  const count = parseInt(req.query.count) || 5;

  try {
    const articles = await fetchAndSaveTweets(username, count);
    res.json({ status: "success", source: username, articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "Failed to fetch tweets" });
  }
});

// ========================
// Endpoint: Multiple Usernames (Interval Fetch)
// ========================
app.post("/api/fetch-multiple", async (req, res) => {
  const usernames = req.body.usernames || [];
  const count = parseInt(req.body.count) || 5;
  const intervalMs = parseInt(req.body.intervalMs) || 60 * 1000;

  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ status: "error", message: "No usernames provided" });
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
    message: `Fetching tweets for ${usernames.length} usernames in intervals of ${intervalMs / 1000} seconds`,
  });
});

// ========================
// Cron Endpoint: Wake Server Every 6 Minutes
// ========================
cron.schedule("30 18 * * *", () => {
  console.log("⏰ Cron: Waking server to prevent sleep");
});

// ========================
// Cron: Auto Fetch Some Users Every 10 Minutes
// ========================
const AUTO_USERS = process.env.AUTO_USERS ? process.env.AUTO_USERS.split(",") : [];
cron.schedule("0 9 * * 1", async () => {
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
// Start Server
// ========================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
