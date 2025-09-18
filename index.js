import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import TwitterApiClient from "./twitterapi-client.js";
import dotenv from "dotenv";
import cron from "node-cron";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Expo } from "expo-server-sdk";

dotenv.config();

const expo = new Expo();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const SELF_URL =
  process.env.SERVER_URL || "https://twitterapi-7313.onrender.com";

// Helper functions
function containsTelugu(text) {
  return /[\u0C00-\u0C7F]/.test(text);
}
async function processWithGemini(text) {
  try {
    let prompt;
    if (containsTelugu(text)) {
      prompt = `You are a professional Telugu journalist. Summarize the following Telugu news text into a concise news-style title and summary in Telugu. use regular using words in noramal news papers. Return strictly JSON with keys: title, summary.  Do not add anything else.\n\n${text}`;
    } else {
      prompt = `You are a professional Telugu journalist. Translate the following English news text into Telugu and create a short Telugu news title and summary. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    }
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let content = response.text().trim();
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


// In server.js, replace your existing sendTargetedNotification function

async function sendTargetedNotification({ title, body, category, data }) {
  try {
    console.log(`\n[DIAGNOSTIC] 1. Starting notification process for category: "${category}"`);

    // Find tokens subscribed to the specific category
    const savedTokens = await ExpoPushToken.find({ subscribedCategories: category });
    const pushTokens = savedTokens.map(t => t.token);
    
    console.log(`[DIAGNOSTIC] 2. Found ${pushTokens.length} token(s) for this category.`);

    if (pushTokens.length === 0) {
      console.log(`[DIAGNOSTIC] --> Process stopped. No devices to notify.`);
      return;
    }

    // Create messages
    let messages = [];
    for (let pushToken of pushTokens) {
      if (Expo.isExpoPushToken(pushToken)) {
        messages.push({
          to: pushToken,
          sound: 'default',
          title: `[${category}] ${title}`,
          body: body,
          data: data || {},
        });
      }
    }
    console.log(`[DIAGNOSTIC] 3. Created ${messages.length} valid notification messages.`);

    // Chunk and send notifications
    const chunks = expo.chunkPushNotifications(messages);
    console.log(`[DIAGNOSTIC] 4. Split messages into ${chunks.length} chunk(s). Sending now...`);
    
    for (let chunk of chunks) {
      let tickets = await expo.sendPushNotificationsAsync(chunk);
      
      tickets.forEach((ticket, index) => {
        const pushToken = chunk[index].to; 
        if (ticket.status === 'ok') {
          console.log(`✅ Notification for token ${pushToken} accepted by Expo. Ticket ID: ${ticket.id}`);
        } else {
          console.error(`❌ Notification for token ${pushToken} failed. Reason: ${ticket.details.error}`);
          if (ticket.details.error === 'DeviceNotRegistered') {
            console.log(`Removing inactive token: ${pushToken}`);
            ExpoPushToken.deleteOne({ token: pushToken }).catch(e => console.error(e));
          }
        }
      });
    }

  } catch (error) {
    console.error(`[DIAGNOSTIC] --> An error occurred during the process for category '${category}':`, error);
  }
}
const app = express();
const allowedOrigins = [
  "https://vijay-ixl.onrender.com",
  "https://news-dashboard-ob0p.onrender.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
};
app.use(cors(corsOptions));
app.use(express.json());

// ========================
// MongoDB Models
// ========================

// UPDATED: Schema now includes subscribedCategories
const expoPushTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    subscribedCategories: [{ type: String }], // Array to store user preferences
  },
  { timestamps: true }
);
const ExpoPushToken = mongoose.model("ExpoPushToken", expoPushTokenSchema);

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
        type: { type: String, default: "photo" },
        url: String,
        variants: [{ bitrate: Number, url: String }],
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
const mediaSchema = new mongoose.Schema({
  type: { type: String, required: true },
  url: { type: String },
  variants: [{ bitrate: { type: Number }, url: { type: String } }],
  width: { type: Number },
  height: { type: Number },
});
const formattedTweetSchema = new mongoose.Schema(
  {
    tweetId: { type: String, unique: true, required: true },
    url: String,
    twitterUrl: String,
    text: String,
    title: String,
    imageUrl: String,
    summary: String,
    type: String,
    createdAt: Date,
    lang: String,
    media: [mediaSchema],
    isBookmarked: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true },
    categories: [{ type: String }],
  },
  { timestamps: true, collection: "formatted_tweets" }
);
const FormattedTweet = mongoose.model("FormattedTweet", formattedTweetSchema);

// ========================
// Express + MongoDB Setup
// ========================
app.use(express.json());
const PORT = 4000;
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));
const client = new TwitterApiClient(process.env.TWITTER_API_KEY);

// ========================
// Helper functions and Cron Jobs
// ========================
const HF_API_TOKEN = process.env.HF_API_TOKEN;
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
// API Endpoints
// ========================

// UPDATED: Endpoint now saves categories along with the token
app.post("/api/register-token", async (req, res) => {
  const { token, categories } = req.body;

  if (!Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: "Invalid Expo Push Token." });
  }

  try {
    await ExpoPushToken.findOneAndUpdate(
      { token: token },
      { $set: { token: token, subscribedCategories: categories || [] } },
      { upsert: true }
    );
    console.log(
      `Token registered/updated: ${token} with categories: ${categories}`
    );
    res.status(200).json({ message: "Token and preferences registered." });
  } catch (error) {
    console.error("Error registering token:", error);
    res.status(500).json({ error: "Failed to register token." });
  }
});

// Replace your existing /api/broadcast endpoint with this simplified version

app.post("/api/broadcast", async (req, res) => {
  const { title, body, data, category } = req.body; 

  if (!title || !body || !category) {
    return res.status(400).json({ error: "Title, body, and category are required." });
  }
  
  // Call the reusable function
  sendTargetedNotification({ title, body, data, category });

  res.status(202).json({ 
      message: `Broadcast to '${category}' category initiated successfully!`
  });
});

// ... (your other API endpoints)
app.get("/api/articles/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const count = parseInt(req.query.count) || 5;
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

// Replace your entire /api/formatted-tweet endpoint with this corrected version

app.post("/api/formatted-tweet1", async (req, res) => {
  try {
    const { tweet_ids, categories, withGemini = true } = req.body;

    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res.status(400).json({ error: "tweet_ids must be a non-empty array." });
    }

    const processingPromises = tweet_ids.map(async (tweetId) => {
      const existingTweet = await FormattedTweet.findOne({ tweetId: tweetId }).lean();
      
      const response = await fetch(
        `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
        { headers: { "x-api-key": process.env.TWITTER_API_KEY } }
      );
      const data = await response.json();

      if (data.status !== "success" || !data.tweets || !data.tweets.length) {
        console.warn(`Could not fetch tweet with ID: ${tweetId}`);
        return null;
      }

      const tweet = data.tweets[0];
      
      // Prepare the data to be saved/updated
      const updateData = {
        tweetId: tweet.id,
        url: tweet.url,
        twitterUrl: tweet.twitterUrl,
        text: tweet.text,
        createdAt: new Date(tweet.createdAt),
        lang: tweet.lang,
        type: "tweet",
        // >>> CORRECTED: The full media mapping logic is now here
        media: tweet.extendedEntities?.media?.map((m) => {
            if (m.type === "photo") {
              return {
                type: "photo",
                url: m.media_url_https || m.media_url,
                width: m.sizes?.large?.w || null,
                height: m.sizes?.large?.h || null,
              };
            } else if (m.type === "video" || m.type === "animated_gif") {
              let height = 720;
              let width = null;
              if (m.video_info?.aspect_ratio) {
                const [arW, arH] = m.video_info.aspect_ratio;
                width = Math.round((arW / arH) * height);
              }
              return {
                type: m.type,
                variants: m.video_info?.variants?.map((v) => ({
                    bitrate: v.bitrate || null,
                    url: v.url,
                  })) || [],
                width,
                height,
              };
            }
            return null;
          }).filter(Boolean) || [],
      };

      if (withGemini) {
        const geminiResult = await processWithGemini(updateData.text);
        updateData.title = geminiResult.title;
        updateData.summary = geminiResult.summary;
      }

      const savedPost = await FormattedTweet.findOneAndUpdate(
        { tweetId: updateData.tweetId }, 
        { 
          $set: updateData,
          $addToSet: { categories: { $each: categories || [] } }
        }, 
        { upsert: true, new: true }
      );

      if (!existingTweet && savedPost.categories && savedPost.categories.length > 0) {
        console.log(`New post created (${savedPost.tweetId}). Triggering notifications.`);
        for (const category of savedPost.categories) {
          sendTargetedNotification({
            title: savedPost.title,
            category: category,
            data: { url: `/post/${savedPost._id}` }
          });
        }
      }
      return savedPost;
    });

    const processedTweets = (await Promise.all(processingPromises)).filter(Boolean);

    res.json({
      status: "success",
      message: `Processed ${processedTweets.length} tweets.`,
      tweets: processedTweets,
    });

  } catch (err) {
    console.error("Error processing tweets:", err);
    // Send back the specific error message for easier debugging
    res.status(500).json({ error: "Server error", details: err.message });
  }
});


app.post("/api/formatted-tweet", async (req, res) => {
  try {
    const { tweet_ids, categories, withGemini = true } = req.body;

    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res.status(400).json({ error: "tweet_ids must be a non-empty array." });
    }

    const processingPromises = tweet_ids.map(async (tweetId) => {
      const existingTweet = await FormattedTweet.findOne({ tweetId: tweetId }).lean();
      
      const response = await fetch(
        `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
        { headers: { "x-api-key": process.env.TWITTER_API_KEY } }
      );
      const data = await response.json();

      if (data.status !== "success" || !data.tweets || !data.tweets.length) {
        console.warn(`Could not fetch tweet with ID: ${tweetId}`);
        return null;
      }

      const tweet = data.tweets[0];
      
      // Prepare the data to be saved/updated
      const updateData = {
        tweetId: tweet.id,
        url: tweet.url,
        twitterUrl: tweet.twitterUrl,
        text: tweet.text,
        createdAt: new Date(tweet.createdAt),
        lang: tweet.lang,
        type: "normal_post",
        imageUrl: tweet.extendedEntities?.media?.[0]?.media_url_https 
                  || tweet.media_url_https 
                  || null,
        media: tweet.extendedEntities?.media?.map((m) => {
            if (m.type === "photo") {
              return {
                type: "photo",
                url: m.media_url_https || m.media_url,
                width: m.sizes?.large?.w || null,
                height: m.sizes?.large?.h || null,
              };
            } else if (m.type === "video" || m.type === "animated_gif") {
              // >>> CORRECTED: Find and save only the lowest bitrate video variant
              const validVariants = m.video_info?.variants?.filter(v => typeof v.bitrate === 'number' && v.url) || [];

              if (validVariants.length === 0) {
                  return null; // No valid variants found
              }

              // Find the variant with the lowest bitrate
              const lowestBitrateVariant = validVariants.reduce((lowest, current) => {
                return current.bitrate < lowest.bitrate ? current : lowest;
              });

              let height = 720;
              let width = null;
              if (m.video_info?.aspect_ratio) {
                const [arW, arH] = m.video_info.aspect_ratio;
                width = Math.round((arW / arH) * height);
              }

              return {
                type: m.type,
                // Store only the lowest bitrate variant in an array for consistent schema
                variants: [{
                    bitrate: lowestBitrateVariant.bitrate,
                    url: lowestBitrateVariant.url,
                }],
                width,
                height,
              };
            }
            return null;
          }).filter(Boolean) || [],
      };

      if (withGemini) {
        const geminiResult = await processWithGemini(updateData.text);
        updateData.title = geminiResult.title;
        updateData.summary = geminiResult.summary;
      }

      const savedPost = await FormattedTweet.findOneAndUpdate(
        { tweetId: updateData.tweetId }, 
        { 
          $set: updateData,
          $addToSet: { categories: { $each: categories || [] } }
        }, 
        { upsert: true, new: true }
      );

      if (!existingTweet && savedPost.categories && savedPost.categories.length > 0) {
        console.log(`New post created (${savedPost.tweetId}). Triggering notifications.`);
        for (const category of savedPost.categories) {
          sendTargetedNotification({
            title: savedPost.title,
            category: category,
            data: { url: `/post/${savedPost._id}` }
          });
        }
      }
      return savedPost;
    });

    const processedTweets = (await Promise.all(processingPromises)).filter(Boolean);

    res.json({
      status: "success",
      message: `Processed ${processedTweets.length} tweets.`,
      tweets: processedTweets,
    });

  } catch (err) {
    console.error("Error processing tweets:", err);
    // Send back the specific error message for easier debugging
    res.status(500).json({ error: "Server error", details: err.message });
  }
});




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
      ? ` You are a professional Telugu news journalist. Task: Create TWO outputs in Telugu from the following text: 1. **Title** → A short, catchy news headline in Telugu (8–12 words). - Must feel like a professional Telugu newspaper headline. - No English, no transliteration. - No quotes or section labels. 2. **Summary** → A news-style article body (65–80 words). - Formal, informative, neutral journalistic tone. - Undestand the context of each word - Clear, concise, newspaper-ready style. - No headings, no extra formatting. Text: ${text} Return result strictly in JSON: { "title": "…", "summary": "…" } `
      : ` You are a professional Telugu news journalist. The input is in English. Translate it into Telugu and then create TWO outputs: 1. **Title** → A short, catchy Telugu news headline (8–12 words). - Must feel like a professional Telugu newspaper headline. - No English, no transliteration. - No quotes or section labels. 2. **Summary** → A news-style article body (65–80 words). - clearly understand user intent. -Think in what context he is saying. -write user name, as he shares his context - Formal, informative, neutral journalistic tone. - Clear underastanding of english to telugu translating relevently. - Clear, concise, newspaper-ready style. - No headings, no extra formatting. English Text: ${text} Return result strictly in JSON: { "title": "…", "summary": "…" } `;
    const response = await genAI
      .getGenerativeModel({ model: "gemini-1.5-flash" })
      .generateContent(prompt);
    let content = response.response.text().trim();
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
    const fallbackImage =
      "https://cdn.pixabay.com/photo/2017/06/26/19/03/news-2444778_960_720.jpg";
    if (!title) {
      title = isTelugu ? text.slice(0, 50) : "తెలుగు వార్త శీర్షిక";
    }
    if (!summary) {
      summary = text.slice(0, 200) + "...";
    }
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
    res
      .status(500)
      .json({ error: "Failed to summarize text", details: err.message });
  }
});
app.get("/api/saved-tweets", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    const [tweets, articles] = await Promise.all([
      FormattedTweet.find().lean(),
      Article.find({ source: "manual" }).lean(),
    ]);
    const combined = [...tweets, ...articles].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const total = combined.length;
    const paginated = combined.slice(skip, skip + limit);
    res.json({
      status: "success",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      posts: paginated,
    });
  } catch (err) {
    console.error("Error fetching saved tweets and articles:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Add this new endpoint to your server.js

app.get("/api/post/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Post ID format." });
    }

    // Try to find the post in the FormattedTweet collection first
    let post = await FormattedTweet.findById(id).lean();

    // If not found, try the Article collection
    if (!post) {
      post = await Article.findById(id).lean();
    }

    if (!post) {
      return res.status(404).json({ error: "Post not found." });
    }

    res.json({ status: "success", post });

  } catch (err) {
    console.error("❌ Error fetching single post:", err);
    res.status(500).json({ error: "Failed to fetch post", details: err.message });
  }
});


app.put("/api/saved-tweets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }
    const {
      title,
      summary,
      text,
      categories,
      media,
      isBookmarked,
      isPublished,
    } = req.body;
    if (categories && !Array.isArray(categories)) {
      return res.status(400).json({ error: "categories must be an array" });
    }
    if (media && !Array.isArray(media)) {
      return res.status(400).json({ error: "media must be an array" });
    }
    const updateData = {
      ...(title && { title }),
      ...(summary && { summary }),
      ...(text && { text }),
      ...(categories && { categories }),
      ...(typeof isBookmarked === "boolean" && { isBookmarked }),
      ...(typeof isPublished === "boolean" && { isPublished }),
    };
    let updated;
    if (media) {
      const doc = await FormattedTweet.findById(id);
      if (!doc) {
        updated = await Article.findById(id);
        if (!updated) return res.status(404).json({ error: "Post not found" });
      }
      media.forEach((newMedia) => {
        const index = doc.media.findIndex((m) => m.url === newMedia.url);
        if (index > -1) {
          Object.assign(doc.media[index], newMedia);
        } else {
          doc.media.push(newMedia);
        }
      });
      Object.assign(doc, updateData);
      updated = await doc.save();
    } else {
      updated = await FormattedTweet.findByIdAndUpdate(id, updateData, {
        new: true,
      });
      if (!updated) {
        updated = await Article.findByIdAndUpdate(id, updateData, {
          new: true,
        });
      }
    }
    res.json({ status: "success", post: updated });
  } catch (err) {
    console.error("❌ Error updating post:", err);
    res
      .status(500)
      .json({ error: "Failed to update post", details: err.message });
  }
});
app.get("/api/curated-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const categories = req.query.categories
      ? req.query.categories.split(",").map((c) => c.trim())
      : [];
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;
    let posts = [];
    let nextCursor = null;
    let usedCategories = false;
    const dedupe = (arr) => {
      const seen = new Set();
      return arr.filter((p) => {
        const key = String(p._id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    if (categories.length > 0) {
      usedCategories = true;
      const tweetQuery = { categories: { $in: categories } };
      const articleQuery = {
        categories: { $in: categories },
        source: "manual",
      };
      if (cursor) {
        tweetQuery.createdAt = { $lt: cursor };
        articleQuery.createdAt = { $lt: cursor };
      }
      const [tweets, articles] = await Promise.all([
        FormattedTweet.find(tweetQuery)
          .sort({ createdAt: -1 })
          .limit(limit * 2)
          .lean(),
        Article.find(articleQuery)
          .sort({ createdAt: -1 })
          .limit(limit * 2)
          .lean(),
      ]);
      posts = dedupe([...tweets, ...articles])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
      if (posts.length > 0) {
        nextCursor = posts[posts.length - 1].createdAt;
      }
    }
    if (posts.length === 0) {
      const tweetQuery = {};
      const articleQuery = { source: "manual" };
      if (cursor) {
        tweetQuery.createdAt = { $lt: cursor };
        articleQuery.createdAt = { $lt: cursor };
      }
      const [tweets, articles] = await Promise.all([
        FormattedTweet.find(tweetQuery)
          .sort({ createdAt: -1 })
          .limit(limit * 2)
          .lean(),
        Article.find(articleQuery)
          .sort({ createdAt: -1 })
          .limit(limit * 2)
          .lean(),
      ]);
      posts = dedupe([...tweets, ...articles])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
      if (posts.length > 0) {
        nextCursor = posts[posts.length - 1].createdAt;
      }
    }
    res.json({
      status: "success",
      limit,
      posts,
      nextCursor,
      usedCategories,
      fallback: posts.length === 0 && categories.length > 0,
    });
  } catch (err) {
    console.error("Error fetching curated feed:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});
app.post("/api/youtube-post", async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url || !title) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Both 'url' and 'title' are required in the request body.",
        });
    }
    if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid YouTube URL provided." });
    }
    const newYoutubePost = {
      tweetId: `yt_${new Date().getTime()}`,
      type: "youtube_video",
      title: title,
      text: title,
      summary: "",
      createdAt: new Date(),
      isPublished: true,
      categories: req.body.categories || [],
      media: [{ type: "youtube_link", url: url }],
    };
    const savedPost = await FormattedTweet.create(newYoutubePost);
    res.status(201).json({ status: "success", post: savedPost });
  } catch (err) {
    console.error("❌ Error creating YouTube post:", err);
    res
      .status(500)
      .json({ error: "Failed to create YouTube post", details: err.message });
  }
});
app.delete("/api/saved-tweets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let deleted = await FormattedTweet.findByIdAndDelete(id);
    if (!deleted) {
      deleted = await Article.findByIdAndDelete(id);
    }
    if (!deleted) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json({
      status: "success",
      message: "Post deleted successfully",
      post: deleted,
    });
  } catch (err) {
    console.error("❌ Error deleting post:", err);
    res
      .status(500)
      .json({ error: "Failed to delete post", details: err.message });
  }
});
app.patch("/api/saved-tweets/:id/publish", async (req, res) => {
  try {
    const { id } = req.params;
    const { published } = req.body;

    if (typeof published !== "boolean") {
      return res.status(400).json({ error: "published must be a boolean" });
    }

    // --- Find and update the post in either collection ---
    let updatedPost = await FormattedTweet.findByIdAndUpdate(
      id,
      { isPublished: published }, // Corrected field name to 'isPublished'
      { new: true }
    );

    if (!updatedPost) {
      updatedPost = await Article.findByIdAndUpdate(
        id,
        { isPublished: published }, // Assuming Article schema also has 'isPublished'
        { new: true }
      );
    }

    if (!updatedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    // --- THIS IS THE NEW PART ---
    // Trigger notifications only if the post is being published
    if (published === true) {
      console.log(`Post ${updatedPost._id} was published. Triggering notifications.`);
      
      const { title, summary, categories } = updatedPost;

      if (categories && categories.length > 0) {
        for (const category of categories) {
          // Call your reusable notification function
          sendTargetedNotification({
            title: title,
            body: summary,
            category: category,
            data: { url: `/post/${updatedPost._id}` } 
          });
        }
      } else {
        console.log("Post has no categories, no notifications sent.");
      }
    }
    // ----------------------------

    res.json({
      status: "success",
      message: `Post ${published ? "published" : "unpublished"} successfully`,
      post: updatedPost,
    });
  } catch (err) {
    console.error("❌ Error updating publish status:", err);
    res
      .status(500)
      .json({ error: "Failed to update publish status", details: err.message });
  }
});

// ========================
// Start Server
// ========================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
