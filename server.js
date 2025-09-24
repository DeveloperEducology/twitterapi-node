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
const TWITTER_API_IO_KEY = process.env.TWITTER_API_KEY;
const PORT = process.env.PORT || 4000;
const SELF_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// --- Source Lists ---
const AUTO_FETCH_USERS = process.env.AUTO_USERS
  ? process.env.AUTO_USERS.split(",")
  : [];
const RSS_SOURCES = [
  { url: "https://ntvtelugu.com/feed", name: "NTV Telugu" },
  { url: "https://tv9telugu.com/feed", name: "TV9 Telugu" },
  { url: "https://www.ntnews.com/rss", name: "Namasthe Telangana" },
  {
    url: "https://www.thehindu.com/news/national/feeder/default.rss",
    name: "The Hindu",
  },
  { url: "https://feeds.feedburner.com/ndtvnews-latest", name: "NDTV News" },
];

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// =================================================================
// 2. MONGODB SETUP & MODELS
// =================================================================

// --- Main Unified Post Schema ---
const mediaSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ["photo", "video", "animated_gif", "youtube_link"],
  },
  url: { type: String },
  variants: [{ bitrate: { type: Number }, url: { type: String } }],
});

const postSchema = new mongoose.Schema(
  {
    // Core Content
    title: { type: String, required: true },
    summary: String,
    text: String,
    url: { type: String, unique: true, sparse: true }, // sparse allows multiple docs to have null
    imageUrl: String,
    media: [mediaSchema],
    videoUrl: String,

    // Metadata
    source: String,
    sourceType: {
      type: String,
      enum: ["rss", "tweet_api", "manual", "youtube"],
      required: true,
    },
    publishedAt: { type: Date, default: Date.now, index: true },
    lang: String,

    // Classification & Flags
    categories: [{ type: String, index: true }],
    topCategory: { type: String, index: true },
    isPublished: { type: Boolean, default: true, index: true },
    type: { type: String, default: "normal_post" },
    // Source-Specific Data
    tweetId: { type: String, unique: true, sparse: true },
    twitterUrl: String,
  },
  { timestamps: true, collection: "posts" }
);

const Post = mongoose.model("Post", postSchema);

// --- Push Notification Token Schema ---
const expoPushTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    subscribedCategories: [{ type: String }],
  },
  { timestamps: true }
);
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
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json());

// =================================================================
// 4. HELPER FUNCTIONS
// =================================================================

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

function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch (error) {
    return urlString;
  }
}

function containsTelugu(text) {
  if (!text) return false;
  return /[\u0C00-\u0C7F]/.test(text);
}

function cleanHtmlContent(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  return $.text()
    .replace(/(\r\n|\n|\r)/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageFromItem(item) {
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image"))
    return item.enclosure.url;
  const content = item["content:encoded"] || item.content || "";
  const $ = cheerio.load(content);
  return $("img").first().attr("src") || null;
}

function classifyArticle(text) {
  const keywords = {
    Sports: ["cricket", "football", "tennis", "ipl", "sports"],
    Entertainment: ["movie", "cinema", "actor", "actress", "music"],
    Politics: ["election", "minister", "government", "bjp", "congress", "modi"],
    National: ["india", "delhi", "mumbai", "national"],
    International: ["world", "usa", "china", "un", "war"],
    Telangana: ["telangana", "hyderabad", "kcr", "ktr"],
    AndhraPradesh: ["andhra pradesh", "amaravati", "vizag", "jagan"],
  };
  const categories = new Set();
  let topCategory = "General";
  let maxCount = 0;
  const lowerText = text.toLowerCase();
  for (const [category, words] of Object.entries(keywords)) {
    const count = words.reduce(
      (acc, word) => acc + (lowerText.includes(word) ? 1 : 0),
      0
    );
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
  const { categories, topCategory } = classifyArticle(
    postData.title + " " + postData.summary
  );
  postData.categories = categories;
  postData.topCategory = topCategory;
  postData.imageUrl = postData.imageUrl || postData.media?.[0]?.url || null;

  const identifier = postData.url
    ? { url: postData.url }
    : { tweetId: postData.tweetId };

  try {
    const result = await Post.updateOne(
      identifier,
      { $setOnInsert: postData },
      { upsert: true }
    );
    if (result.upsertedCount > 0) {
      const newPost = await Post.findOne(identifier).lean();
      console.log(
        `✅ Saved new post: "${newPost.title.slice(0, 30)}..." from ${
          newPost.source
        }`
      );
      // Trigger notifications for the newly saved post
      for (const category of newPost.categories) {
        sendTargetedNotification({
          title: newPost.title,
          category,
          data: { postId: newPost._id.toString() },
        });
      }
      return true;
    }
    return false;
  } catch (error) {
    if (error.code === 11000) {
      console.warn(
        `⚠️ Post already exists, skipping: ${postData.url || postData.tweetId}`
      );
    } else {
      console.error("Error saving post:", error.message);
    }
    return false;
  }
}

async function sendTargetedNotification({ title, category, data }) {
  // ... (This function is unchanged, just ensure it's here)
}

// =================================================================
// 5. CRON JOBS
// =================================================================

cron.schedule("*/5 * * * *", async () => {
  try {
    await axios.get(SELF_URL);
    console.log(`Pinged self at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error("Self-ping failed:", err.message);
  }
});

async function fetchAllNewsSources() {
  console.log("⏰ Cron: Starting RSS feed processing...");
  let newPostsCount = 0;
  for (const source of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items) {
        try {
          if (!item.link || !item.title) continue;
          const cleanUrl = normalizeUrl(item.link);
          const saved = await savePost({
            title: item.title,
            summary: cleanHtmlContent(
              item.contentSnippet || item.description || ""
            ),
            text: cleanHtmlContent(item.content || ""),
            url: cleanUrl,
            source: source.name,
            sourceType: "rss",
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            imageUrl: extractImageFromItem(item),
            lang: containsTelugu(item.title) ? "te" : "en",
          });
          if (saved) newPostsCount++;
        } catch (itemError) {
          console.error(
            `   ❌ Failed to process item: "${item.title?.slice(0, 50)}..."`,
            itemError.message
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ Failed to fetch RSS feed from ${source.name}: ${error.message}`
      );
    }
  }
  console.log(
    `✅ Cron: RSS fetching complete. Added ${newPostsCount} new posts.`
  );
}
cron.schedule("*/30 * * * *", fetchAllNewsSources);

// =================================================================
// 6. API ENDPOINTS
// =================================================================

app.get("/", (req, res) => res.send("API Server is running."));

app.post("/api/formatted-tweet", async (req, res) => {
  try {
    const { tweet_ids, categories, withGemini = true } = req.body;

    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res
        .status(400)
        .json({ error: "tweet_ids must be a non-empty array." });
    }

    const processingPromises = tweet_ids.map(async (tweetId) => {
      const existingTweet = await Post.findOne({
        tweetId: tweetId,
      }).lean();

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
      let lowestBitrateVideoUrl = null;
      const mediaEntities = tweet.extendedEntities?.media || [];
      const videoMedia = mediaEntities.find(
        (m) =>
          (m.type === "video" || m.type === "animated_gif") &&
          m.video_info?.variants
      );

      if (videoMedia) {
        const mp4Variants = videoMedia.video_info.variants.filter(
          (v) =>
            v.content_type === "video/mp4" && typeof v.bitrate !== "undefined"
        );

        if (mp4Variants.length > 0) {
          mp4Variants.sort((a, b) => a.bitrate - b.bitrate);
          lowestBitrateVideoUrl = mp4Variants[0].url;
        }
      }

      const updateData = {
        tweetId: tweet.id,
        url: tweet.url,
        twitterUrl: tweet.twitterUrl,
        text: tweet.text,
        createdAt: new Date(tweet.createdAt),
        lang: tweet.lang,
        type: tweet.type,
        videoUrl: lowestBitrateVideoUrl,
        imageUrl:
          tweet.extendedEntities?.media?.[0]?.media_url_https ||
          tweet.media_url_https ||
          null,
        media:
          mediaEntities
            .map((m) => {
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
                  variants:
                    m.video_info?.variants?.map((v) => ({
                      bitrate: v.bitrate || null,
                      url: v.url,
                    })) || [],
                  width,
                  height,
                };
              }
              return null;
            })
            .filter(Boolean) || [],
      };

      if (withGemini) {
        const geminiResult = await processWithGemini(updateData.text);
        updateData.title = geminiResult.title;
        updateData.summary = geminiResult.summary;
      }

      const savedPost = await Post.findOneAndUpdate(
        { tweetId: updateData.tweetId },
        {
          $set: updateData,
          $addToSet: { categories: { $each: categories || [] } },
        },
        { upsert: true, new: true }
      );

      if (
        !existingTweet &&
        savedPost.categories &&
        savedPost.categories.length > 0
      ) {
        console.log(
          `New post created (${savedPost.tweetId}). Triggering notifications.`
        );
        for (const category of savedPost.categories) {
          sendTargetedNotification({
            title: savedPost.title,
            category: category,
            data: { url: `/post/${savedPost._id}` },
          });
        }
      }
      return savedPost;
    });

    const processedTweets = (await Promise.all(processingPromises)).filter(
      Boolean
    );

    res.json({
      status: "success",
      message: `Processed ${processedTweets.length} tweets.`,
      tweets: processedTweets,
    });
  } catch (err) {
    console.error("Error processing tweets:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.get("/api/fetch-news-manual", async (req, res) => {
  await fetchAllNewsSources();
  res.json({ message: "Manual news fetch process initiated." });
});

app.get("/api/curated-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const categories = req.query.categories
      ? req.query.categories.split(",").map((c) => c.trim())
      : [];
    const cursor = req.query.cursor ? new Date(req.query.cursor) : new Date();

    const query = { isPublished: true, publishedAt: { $lt: cursor } };
    if (categories.length > 0) {
      query.categories = { $in: categories };
    }

    const posts = await Post.find(query)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .lean();

    let nextCursor = null;
    if (posts.length === limit) {
      nextCursor = posts[posts.length - 1].publishedAt;
    }

    res.json({ status: "success", posts, nextCursor });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid Post ID format." });
    }
    const post = await Post.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({ status: "success", post });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch post", details: err.message });
  }
});

app.put("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }
    const updatedPost = await Post.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updatedPost) return res.status(404).json({ error: "Post not found" });
    res.json({ status: "success", post: updatedPost });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to update post", details: err.message });
  }
});

app.delete("/api/post/:id", async (req, res) => {
  try {
    const deleted = await Post.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Post not found" });
    res.json({ status: "success", message: "Post deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to delete post", details: err.message });
  }
});

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

// =================================================================
// 7. START SERVER
// =================================================================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
