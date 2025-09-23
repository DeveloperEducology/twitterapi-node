// index.js (Merged Server File)

// =================================================================
// 1. IMPORTS & INITIALIZATIONS
// =================================================================
import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";
import cron from "node-cron";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Expo } from "expo-server-sdk";
import * as cheerio from "cheerio";

import Parser from "rss-parser";

dotenv.config();

// --- Main Initializations ---
const app = express();
const expo = new Expo();
const parser = new Parser();

// --- API Keys & Config ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const TWITTER_API_IO_KEY = process.env.TWITTER_API_KEY; // For twitterapi.io
const PORT = process.env.PORT || 4000;
const SELF_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// --- Source Lists ---
const AUTO_FETCH_USERS = process.env.AUTO_USERS ? process.env.AUTO_USERS.split(",") : [];
const RSS_SOURCES = [
  // { url: "https://ntvtelugu.com/feed", name: "NTV Telugu" },
  // { url: "https://tv9telugu.com/feed", name: "TV9 Telugu" },
  // { url: "https://www.ntnews.com/rss", name: "Namasthe Telangana" },
  // { url: "https://www.thehindu.com/news/national/feeder/default.rss", name: "The Hindu" },
  // { url: "https://feeds.feedburner.com/ndtvnews-latest", name: "NDTV News" },
];

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


// =================================================================
// 2. MONGODB SETUP & MODELS
// =================================================================

// --- Main Unified Post Schema ---
const mediaSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['photo', 'video', 'animated_gif', 'youtube_link', 'web_story'] },
  url: { type: String },
  variants: [{ bitrate: { type: Number }, url: { type: String } }],
  width: { type: Number },
  height: { type: Number },
});

const postSchema = new mongoose.Schema({
    // Core Content
    title: { type: String, required: true },
    summary: String,
    text: String, // Full body text for articles, original text for tweets
    url: { type: String, unique: true, sparse: true }, // Canonical URL, sparse allows nulls
    imageUrl: String, // Main image for quick access
    media: [mediaSchema],
  videoUrl: String,
    // Metadata
    source: String, // e.g., "NTV Telugu", "Twitter @handle", "Manual"
    sourceType: { type: String, enum: ['rss', 'tweet_api', 'tweet_scrape', 'manual', 'youtube', 'web_story'], required: true },
    publishedAt: { type: Date, default: Date.now, index: true },
    lang: String,

    // Classification & Flags
    categories: [{ type: String }],
    topCategory: { type: String, index: true },
    type: { type: String, default: 'normal_post' }, // 'full_post', 'youtube_video', etc.
    isPublished: { type: Boolean, default: true, index: true },
    isBookmarked: { type: Boolean, default: false },
    isStory: { type: Boolean, default: false },
    isShowReadButton: { type: Boolean, default: false },

    // Source-Specific Data
    tweetId: { type: String, unique: true, sparse: true }, // Only for tweets
    twitterUrl: String,
}, { timestamps: true, collection: "posts" });

const Post = mongoose.model("Post", postSchema);

// --- Push Notification Token Schema ---
const expoPushTokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    subscribedCategories: [{ type: String }],
}, { timestamps: true });
const ExpoPushToken = mongoose.model("ExpoPushToken", expoPushTokenSchema);

// --- DB Connection ---
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));


// =================================================================
// 3. MIDDLEWARE
// =================================================================
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


// =================================================================
// 4. HELPER FUNCTIONS
// =================================================================

// --- Content Processing & AI ---
function containsTelugu(text) {
  return /[\u0C00-\u0C7F]/.test(text);
}

async function processWithGemini(text) {
  try {
    const prompt = containsTelugu(text)
      ? `You are a professional Telugu journalist. Summarize the following Telugu news text into a concise news-style title and summary in Telugu. use regular using words in noramal news papers. Return strictly JSON with keys: title, summary.  Do not add anything else.\n\n${text}`
      : `You are a professional Telugu journalist. Translate the following English news text into Telugu and create a short Telugu news title and summary. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let content = response.text().trim().replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || text.slice(0, 60),
      summary: parsed.summary || text,
    };
  } catch (err) {
    console.error("Gemini processing error:", err.message);
    return { title: text.slice(0, 60), summary: text };
  }
}

// --- Web Scraping & Parsing ---
function cleanHtmlContent(htmlContent) {
  if (!htmlContent) return "";
  const $ = cheerio.load(htmlContent);
  let text = $.text();
  text = text.replace(/\[\s*…\s*\]|\[&#8230;\]/g, "").trim();
  return text;
}

function extractImageFromItem(item) {
    if (item.enclosure && item.enclosure.url) return item.enclosure.url;
    const htmlSources = [item.content, item["content:encoded"], item.description];
    for (const src of htmlSources) {
        if (!src) continue;
        const $ = cheerio.load(src);
        const img = $("img").first();
        if (img && img.attr("src")) return img.attr("src");
    }
    return null;
}

// --- Data Handling & Classification ---
function classifyArticle(text) {
    const keywords = {
        Sports: ['cricket', 'football', 'tennis', 'ipl', 'bcci', 'icc', 'sports'],
        Entertainment: ['movie', 'cinema', 'actor', 'actress', 'music', 'song', 'tollywood', 'bollywood'],
        Politics: ['election', 'minister', 'government', 'bjp', 'congress', 'modi', 'rahul', 'politics'],
        National: ['india', 'delhi', 'mumbai', 'national'],
        International: ['world', 'usa', 'china', 'un', 'war', 'international'],
        Telangana: ['telangana', 'hyderabad', 'kcr', 'ktr'],
        AndhraPradesh: ['andhra pradesh', 'amaravati', 'vizag', 'jagan'],
        Viral: ['viral', 'trending'],
    };
    const categories = new Set();
    let topCategory = 'General';
    let maxCount = 0;
    const lowerText = text.toLowerCase();

    for (const [category, words] of Object.entries(keywords)) {
        const count = words.reduce((acc, word) => acc + (lowerText.includes(word) ? 1 : 0), 0);
        if (count > 0) {
            categories.add(category);
            if (count > maxCount) {
                maxCount = count;
                topCategory = category;
            }
        }
    }
    return { categories: Array.from(categories), topCategory };
}

async function savePost(postData) {
    // Add classification
    const { categories, topCategory } = classifyArticle(postData.title + " " + (postData.text || ""));
    postData.categories = categories;
    postData.topCategory = topCategory;

    // Ensure imageUrl is set
    postData.imageUrl = postData.imageUrl || postData.media?.[0]?.url || null;

    const identifier = postData.url ? { url: postData.url } : { tweetId: postData.tweetId };
    
    try {
        const result = await Post.updateOne(
            identifier,
            { $setOnInsert: postData },
            { upsert: true }
        );
        if (result.upsertedCount > 0) {
            console.log(`✅ Saved new post: "${postData.title.slice(0,30)}..." from ${postData.source}`);
            return true;
        }
        return false;
    } catch (error) {
        // Handle potential duplicate key errors gracefully if identifier is not unique
        if (error.code === 11000) {
            console.warn(`⚠️ Post already exists, skipping: ${postData.url || postData.tweetId}`);
        } else {
            console.error("Error saving post:", error.message);
        }
        return false;
    }
}


// --- Push Notifications ---
async function sendTargetedNotification({ title, body, category, data }) {
  try {
    const savedTokens = await ExpoPushToken.find({ subscribedCategories: category });
    const pushTokens = savedTokens.map(t => t.token);
    if (pushTokens.length === 0) return;

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
    
    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      let tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, index) => {
        if (ticket.status !== 'ok' && ticket.details.error === 'DeviceNotRegistered') {
           ExpoPushToken.deleteOne({ token: chunk[index].to }).catch(e => console.error(e));
        }
      });
    }
    console.log(`🚀 Sent ${messages.length} notifications for category: ${category}`);
  } catch (error) {
    console.error(`Error sending notifications for '${category}':`, error);
  }
}


// =================================================================
// 5. CRON JOBS (Automated Tasks)
// =================================================================

// --- Keep Server Awake ---
cron.schedule("*/5 * * * *", async () => {
  try {
    await axios.get(SELF_URL);
    console.log(`Pinged self at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error("Self-ping failed:", err.message);
  }
});

// --- Fetch News from RSS and Scraped Twitter ---
async function fetchAllNewsSources() {
    console.log("⏰ Cron: Starting RSS and Twitter scrape fetch...");
    let newPostsCount = 0;

    // Fetch from RSS
    for (const source of RSS_SOURCES) {
        try {
            const feed = await parser.parseURL(source.url);
            for (const item of feed.items) {
                const imageUrl = extractImageFromItem(item);
                const saved = await savePost({
                    title: item.title || "Untitled",
                    summary: cleanHtmlContent(item.contentSnippet || item.description || ""),
                    text: cleanHtmlContent(item.content || ""),
                    url: item.link,
                    source: source.name,
                    sourceType: 'rss',
                    publishedAt: new Date(item.pubDate),
                    imageUrl,
                    media: imageUrl ? [{ type: 'photo', url: imageUrl }] : [],
                    lang: containsTelugu(item.title) ? 'te' : 'en',
                });
                if (saved) newPostsCount++;
            }
        } catch (error) {
            console.error(`Failed to fetch RSS from ${source.name}: ${error.message}`);
        }
    }
    console.log(`✅ Cron: Fetching process complete. Added ${newPostsCount} new posts.`);
}
cron.schedule("*/30 * * * *", fetchAllNewsSources);

// --- Fetch Tweets via API for specified users ---
cron.schedule("*/12 * * * *", async () => {
    console.log("⏰ Cron: Auto-fetching tweets for specified users via API...");
    for (const username of AUTO_FETCH_USERS) {
        // This part needs your specific logic from `twitterapi-client.js` or direct API call
        // For now, it's a placeholder. The `/api/formatted-tweet` endpoint contains the full logic.
        console.log(`Would fetch for ${username}... (logic in /api/formatted-tweet)`);
    }
});


// =================================================================
// 6. API ENDPOINTS
// =================================================================

app.get("/", (req, res) => res.send("API Server is running."));

// --- Manual Trigger for News Fetch ---
app.get("/api/fetch-news-manual", async (req, res) => {
    await fetchAllNewsSources();
    res.json({ message: "Manual news fetch process initiated." });
});

// --- Post Retrieval ---
app.get("/api/saved-tweets", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    // const categories = req.query.categories ? req.query.categories.split(",") : [];

    // const filter = { isPublished: true };
    // if (categories.length > 0) {
    // //   filter.categories = { $in: categories };
    // }

    const posts = await Post.find()
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await Post.countDocuments();

    res.json({
      status: "success",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      posts,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.get("/api/post/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid Post ID format." });
        }
        const post = await Post.findById(id).lean();
        if (!post) {
            return res.status(404).json({ error: "Post not found." });
        }
        res.json({ status: "success", post });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch post", details: err.message });
    }
});

// --- Post Creation & Ingestion ---
app.post("/api/new-post", async (req, res) => {
  try {
    const postData = { ...req.body, sourceType: 'manual' };
    if (!postData.title || !postData.summary) {
      return res.status(400).json({ message: "Title and summary are required." });
    }
    // Generate a unique ID if it's a manual post without a tweetId
    if (!postData.tweetId) {
        postData.tweetId = `manual_${Date.now()}`;
    }

    const newPost = new Post(postData);
    const savedPost = await newPost.save();

    res.status(201).json({ status: "success", message: "New post created.", post: savedPost });
  } catch (err) {
    if (err.name === 'ValidationError' || err.code === 11000) {
      return res.status(400).json({ message: "Validation or Duplicate Error", details: err.message });
    }
    res.status(500).json({ message: "Server error", details: err.message });
  }
});

app.post("/api/formatted-tweet", async (req, res) => {
  try {
    const { tweet_ids, categories: reqCategories } = req.body;
    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res.status(400).json({ error: "tweet_ids must be a non-empty array." });
    }

    const processingPromises = tweet_ids.map(async (tweetId) => {
      const response = await axios.get(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`, {
        headers: { "x-api-key": TWITTER_API_IO_KEY },
      });
      const data = response.data;
      if (data.status !== "success" || !data.tweets || !data.tweets.length) return null;
      


      const tweet = data.tweets[0];

console.log('tweet', tweet)

      const { title, summary } = await processWithGemini(tweet.text);

      const postData = {
        title,
        summary,
        text: tweet.text,
        url: tweet.url,
        source: `Twitter @${tweet.user?.username || 'user'}`,
        sourceType: 'tweet_api',
        publishedAt: new Date(tweet.createdAt),
        lang: tweet.lang,
        categories: reqCategories || [],
        tweetId: tweet.id,
        twitterUrl: tweet.twitterUrl,
        media: tweet.extendedEntities?.media?.map(m => ({
            type: m.type,
            url: m.media_url_https,
            variants: m.video_info?.variants?.map(v => ({ bitrate: v.bitrate, url: v.url })) || [],
        })).filter(Boolean) || [],
      };
      
      const saved = await savePost(postData);
      if (saved) {
        const newPost = await Post.findOne({ tweetId: tweet.id });
        for (const category of newPost.categories) {
          sendTargetedNotification({ title, category, data: { url: `/post/${newPost._id}` } });
        }
        return newPost;
      }
      return await Post.findOne({ tweetId: tweet.id }); // Return existing if not saved
    });

    const processedPosts = (await Promise.all(processingPromises)).filter(Boolean);
    res.json({ status: "success", message: `Processed ${processedPosts.length} tweets.`, posts: processedPosts });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});


// --- Post Modification & Deletion ---
app.put("/api/saved-tweets/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid post ID" });
        }
        const updatedPost = await Post.findByIdAndUpdate(id, req.body, { new: true });
        if (!updatedPost) return res.status(404).json({ error: "Post not found" });
        res.json({ status: "success", post: updatedPost });
    } catch (err) {
        res.status(500).json({ error: "Failed to update post", details: err.message });
    }
});

app.delete("/api/post/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Post.findByIdAndDelete(id);
        if (!deleted) return res.status(404).json({ error: "Post not found" });
        res.json({ status: "success", message: "Post deleted successfully", post: deleted });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete post", details: err.message });
    }
});


// --- Push Notification Endpoints ---
app.post("/api/register-token", async (req, res) => {
  const { token, categories } = req.body;
  if (!Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: "Invalid Expo Push Token." });
  }
  try {
    await ExpoPushToken.findOneAndUpdate(
      { token: token },
      { $set: { subscribedCategories: categories || [] } },
      { upsert: true }
    );
    res.status(200).json({ message: "Token and preferences registered." });
  } catch (error) {
    res.status(500).json({ error: "Failed to register token." });
  }
});

app.post("/api/broadcast", async (req, res) => {
  const { title, body, data, category } = req.body;
  if (!title || !body || !category) {
    return res.status(400).json({ error: "Title, body, and category are required." });
  }
  // Asynchronously call the notification function
  sendTargetedNotification({ title, body, data, category });
  res.status(202).json({ message: `Broadcast to '${category}' category initiated.` });
});


// =================================================================
// 7. START SERVER
// =================================================================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);