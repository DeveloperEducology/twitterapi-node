// =================================================================
// 1. IMPORTS & INITIALIZATIONS
// =================================================================
import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";
import cron from "node-cron";
import cors from "cors";
import { getMessaging } from "firebase-admin/messaging"; // ✅ THIS LINE IS CRITICAL
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import fs from "fs";

dotenv.config();

// --- Main Initializations ---
const app = express();
const parser = new Parser();

// --- API Keys & Config ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 4000;
const SELF_URL = process.env.SERVER_URL || `https://twitterapi-node.onrender.com`;
const TWITTER_API_IO_KEY = process.env.TWITTER_API_KEY;

// --- Firebase Admin SDK Setup ---
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



// --- Source Lists ---
const RSS_SOURCES = [
  { url: "https://ntvtelugu.com/feed", name: "NTV Telugu" },
  { url: "https://tv9telugu.com/feed", name: "TV9 Telugu" },
  {
    url: "https://telugu.hindustantimes.com/rss/sports",
    name: "Hindustan Times Telugu",
  },
  { url: "https://feeds.feedburner.com/ndtvnews-latest", name: "NDTV News" },
];

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// =================================================================
// 2. MONGODB SETUP & MODELS
// =================================================================

const ImageSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
    unique: true,
  },
  title: {
    type: String,
    required: false,
  },
  sourceCollection: {
    type: String,
    default: 'manual_upload'
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
}, { collection: 'saved_image_data' });

const ImageModel = mongoose.model('Image', ImageSchema);

const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["photo", "video", "animated_gif"] },
    url: String,
    variants: [{ bitrate: Number, url: String }],
    width: Number,
    height: Number,
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: "text" },
    pushTitle: { type: String, required: false, index: "text" },
    summary: { type: String, index: "text" },
    text: String,
    url: { type: String, unique: true, sparse: true },
    imageUrl: String,
    relatedStories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    source: String,
    sourceType: {
      type: String,
      enum: ["rss", "manual", "tweet_api"],
      required: true,
      default: "manual",
    },
    publishedAt: { type: Date, default: Date.now, index: true },
    lang: String,
    categories: [{ type: String, index: true }],
    topCategory: { type: String, index: true },
    isPublished: { type: Boolean, default: true, index: true },
    media: [mediaSchema],
    videoUrl: String,
    isBreaking: { type: Boolean, default: false },
    type: { type: String, default: "normal_post" },
    scheduledFor: { type: Date, default: null },
    tweetId: { type: String, unique: true, sparse: true },
    twitterUrl: String,
    // =================================================================
    // ✅ PINNING FEATURE: SCHEMA UPDATE
    // =================================================================
    pinnedIndex: { type: Number, default: null, index: true },
  },
  { timestamps: true, collection: "posts" }
);

postSchema.index({ categories: 1, publishedAt: -1 });
const Post = mongoose.model("Post", postSchema);

const fcmTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    subscribedCategories: [{ type: String }],
  },
  { timestamps: true }
);
const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);

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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
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
      prompt = `You are a professional Telugu journalist. Summarize the following Telugu news text into a concise news-style title and summary in Telugu. use regular using words in noramal news papers. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    } else {
      prompt = `You are a professional Telugu journalist. Translate the following English news text into Telugu and create a short Telugu news title and summary. Return strictly JSON with keys: title, summary. Do not add anything else.\n\n${text}`;
    }
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    let content = response
      .text()
      .trim()
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
  return cheerio
    .load(html)
    .text()
    .replace(/(\r\n|\n|\r)/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageFromItem(item) {
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image"))
    return item.enclosure.url;
  const content = item["content:encoded"] || item.content || "";
  return cheerio.load(content)("img").first().attr("src") || null;
}

function classifyArticle(text) {
  const keywords = {
    Sports: ["cricket", "football", "tennis", "ipl", "sports", "hockey", "badminton", "kabaddi", "olympics", "t20", "odi", "world cup", "match", "tournament", "league", "goal", "క్రికెట్", "ఫుట్‌బాల్", "టెన్నిస్", "హాకీ", "బ్యాడ్మింటన్", "కబడ్డీ", "ఐపీఎల్", "వరల్డ్ కప్", "మ్యాచ్"],
    Entertainment: ["movie", "cinema", "film", "actor", "actress", "celebrity", "director", "music", "song", "trailer", "teaser", "box office", "Tollywood", "Bollywood", "Hollywood", "web series", "OTT", "సినిమా", "చిత్రం", "నటుడు", "నటి", "హీరో", "హీరోయిన్", "దర్శకుడు", "సంగీతం", "పాట", "ట్రైలర్"],
    Politics: ["election", "vote", "minister", "government", "mla", "mp", "parliament", "assembly", "narendra modi", "modi", "revanth reddy", "kcr", "ktr", "jagan reddy", "chandrababu naidu", "pawan kalyan", "ఎన్నికలు", "ఓటు", "మంత్రి", "ప్రభుత్వం", "పార్టీ"],
    National: ["india", "bharat", "delhi", "mumbai", "supreme court", "army", "navy", "isro", "భారతదేశం", "జాతీయ"],
    International: ["world", "global", "usa", "america", "china", "pakistan", "russia", "un", "war", "ప్రపంచం", "అంతర్జాతీయ"],
    Telangana: ["telangana", "hyderabad", "warangal", "revanth reddy", "kcr", "ktr", "తెలంగాణ", "హైదరాబాద్"],
    AndhraPradesh: ["andhra pradesh", "amaravati", "vizag", "vijayawada", "jagan reddy", "chandrababu naidu", "pawan kalyan", "ఆంధ్రప్రదేశ్", "అమరావతి", "విశాఖపట్నం"],
    Crime: ["crime", "murder", "theft", "robbery", "rape", "scam", "police", "court", "cbi", "violence", "నేరం", "హత్య", "దొంగతనం", "మోసం"],
    Technology: ["technology", "tech", "gadget", "mobile", "smartphone", "iphone", "android", "ai", "google", "apple", "microsoft", "meta", "facebook", "twitter", "x", "whatsapp", "instagram", "app", "సాంకేతికత", "టెక్నాలజీ", "మొబైల్", "స్మార్ట్‌ఫోన్"],
    Lifestyle: ["lifestyle", "fashion", "health", "fitness", "diet", "yoga", "travel", "food", "recipe", "beauty", "జీవనశైలి", "ఫ్యాషన్", "ఆరోగ్యం", "ఆహారం"],
    Spiritual: ["spiritual", "religion", "god", "temple", "church", "mosque", "puja", "festival", "diwali", "ramzan", "christmas", "ayodhya", "tirupati", "yadadri", "ఆధ్యాత్మిక", "దేవుడు", "దేవాలయం"],
  };
  const categories = new Set();
  let topCategory = "General";
  let maxCount = 0;
  const lowerText = text.toLowerCase();
  for (const [category, words] of Object.entries(keywords)) {
    const count = words.reduce(
      (acc, word) => acc + (lowerText.includes(word.toLowerCase()) ? 1 : 0),
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

  const finalCategories = Array.from(categories);
  if (finalCategories.length === 0) {
    finalCategories.push("General");
  }

  return {
    categories: finalCategories,
    topCategory: categories.size > 0 ? topCategory : "General",
  };
}

async function sendNotificationForPost(post) {
  if (!post || !post.categories || post.categories.length === 0) return;

  const categories = post.categories;
  const tokens = await FcmToken.find({
    subscribedCategories: { $in: categories },
  }).distinct("token");

  if (tokens.length === 0) return;

  const message = {
    notification: {
      title: post.pushTitle || post.title,
      body: post.summary,
    },
    data: {
      postId: post._id.toString(),
      imageUrl: post.imageUrl || "",
      source: post.source || "",
    },
    tokens: tokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log(`✅ Notification sent to ${response.successCount} devices for post: "${post.title.slice(0, 30)}..."`);

    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(resp.error.code)) {
          failedTokens.push(tokens[idx]);
        }
      });
      if (failedTokens.length > 0) {
        await FcmToken.deleteMany({ token: { $in: failedTokens } });
        console.log(`🗑️ Removed ${failedTokens.length} invalid tokens.`);
      }
    }
  } catch (error) {
    console.error("❌ Error sending multicast notification:", error);
  }
}

async function savePost(postData) {
  const { categories, topCategory } = classifyArticle(
    postData.title + " " + (postData.summary || "")
  );
  postData.categories = categories;
  postData.topCategory = topCategory;
  postData.imageUrl = postData.imageUrl || postData.media?.[0]?.url || null;

  const identifier = { url: postData.url };

  try {
    const result = await Post.updateOne(
      identifier,
      { $setOnInsert: postData },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      const newPost = await Post.findOne(identifier).lean();
      console.log(`✅ Saved new post: "${newPost.title.slice(0, 30)}..." from ${newPost.source}`);
      await sendNotificationForPost(newPost);
      return true;
    }
    return false;
  } catch (error) {
    if (error.code !== 11000) {
      console.error("Error saving post:", error.message);
    }
    return false;
  }
}

// =================================================================
// 5. CRON JOBS
// =================================================================
cron.schedule("*/5 * * * *", async () => {
  try {
    await axios.get(SELF_URL);
  } catch (err) { /* Silently fail on self-ping */ }
});

cron.schedule("*/30 * * * *", async () => {
  console.log("⏰ Cron: Starting RSS feed processing...");
  let newPostsCount = 0;
  for (const source of RSS_SOURCES) {
    const sourceUrl = typeof source === "object" ? source.url : source;
    const sourceName = typeof source === "object" ? source.name : sourceUrl;
    try {
      const feed = await parser.parseURL(sourceUrl);
      for (const item of feed.items) {
        if (!item.link || !item.title) continue;
        const saved = await savePost({
          title: item.title,
          summary: cleanHtmlContent(item.contentSnippet || item.description || ""),
          text: cleanHtmlContent(item.content || ""),
          url: normalizeUrl(item.link),
          source: sourceName,
          sourceType: "rss",
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          imageUrl: extractImageFromItem(item),
          lang: containsTelugu(item.title) ? "te" : "en",
        });
        if (saved) newPostsCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to fetch RSS feed from ${sourceName}: ${error.message}`);
    }
  }
  console.log(`✅ Cron: RSS fetching complete. Added ${newPostsCount} new posts.`);
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
            summary: cleanHtmlContent(item.contentSnippet || item.description || ""),
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
          console.error(`   ❌ Failed to process item: "${item.title?.slice(0, 50)}..."`, itemError.message);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to fetch RSS feed from ${source.name}: ${error.message}`);
    }
  }
  console.log(`✅ Cron: RSS fetching complete. Added ${newPostsCount} new posts.`);
}

async function sendSingleNotification(token, payload) {
  const { title, body, data } = payload;
  const message = {
    notification: { title, body },
    data: data || {},
    token: token,
  };

  try {
    const response = await getMessaging().send(message);
    console.log(`✅ Successfully sent message to token ${token.slice(0, 20)}...:`, response);
    return { success: true, response };
  } catch (error) {
    console.error(`❌ Error sending message to token ${token.slice(0, 20)}...:`, error.message);
    if (error.code === "messaging/registration-token-not-registered" || error.code === "messaging/invalid-registration-token") {
      await FcmToken.deleteOne({ token: token });
      console.log(`🗑️ Removed invalid token: ${token.slice(0, 20)}...`);
    }
    return { success: false, error };
  }
}

async function sendGlobalNotification(payload) {
  const { title, body, data } = payload;
  const tokens = await FcmToken.find({}).distinct("token");

  if (tokens.length === 0) {
    console.log("No FCM tokens registered. Skipping global notification.");
    return { successCount: 0, failureCount: 0, totalTokens: 0 };
  }

  const messages = tokens.map((token) => ({
    notification: { title, body },
    data: {
      title,
      body,
      ...data,
    },
    token: token,
  }));

  try {
    const response = await getMessaging().sendEach(messages);
    console.log(`✅ Global notification batch processed. Success: ${response.successCount}, Failure: ${response.failureCount}`);

    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const failedToken = tokens[idx];
          failedTokens.push(failedToken);
          const errorCode = resp.error?.code;
          if (errorCode === "messaging/registration-token-not-registered" || errorCode === "messaging/invalid-registration-token") {
            console.log(`Marking invalid token for removal: ${failedToken.slice(0, 20)}...`);
          }
        }
      });

      if (failedTokens.length > 0) {
        await FcmToken.deleteMany({ token: { $in: failedTokens } });
        console.log(`🗑️ Removed ${failedTokens.length} invalid tokens.`);
      }
    }
    return { ...response, totalTokens: tokens.length };
  } catch (error) {
    console.error("❌ Error sending global notification batch:", error);
    throw error;
  }
}

// --- TESTING ENDPOINTS ---
app.post("/api/admin/test-notify-single", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "FCM token is required." });
  }
  try {
    const result = await sendSingleNotification(token, {
      title: "Single Device Test 📲",
      body: "This is a test notification sent to only your device.",
      data: {
        type: "admin_single_test",
        timestamp: new Date().toISOString(),
        url: "/post/6515e02278a8a4457e651581",
        imageUrl: "https://placehold.co/600x400/orange/white?text=Test",
      },
    });
    if (result.success) {
      res.json({ message: "Test notification sent successfully.", details: result.response });
    } else {
      res.status(500).json({ message: "Failed to send test notification.", details: result.error.message });
    }
  } catch (error) {
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
});

app.post("/api/admin/send-test-news", async (req, res) => {
  try {
    const title = req.body.title || "GLOBAL TEST: Breaking News 📰";
    const body = req.body.body || "This is a sample news summary sent to all users for testing purposes.";
    const data = {
      type: "admin_global_test",
      timestamp: new Date().toISOString(),
      url: "/post/6515e02278a8a4457e651581",
      imageUrl: "https://placehold.co/600x400/blue/white?text=Global+Test",
      ...req.body,
    };
    const result = await sendGlobalNotification({ title, body, data });
    res.json({
      message: "Global test news notification sent.",
      totalTokensInDb: result.totalTokens,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  } catch (error) {
    res.status(500).json({ error: "An unexpected server error occurred while sending global notification." });
  }
});

app.post("/api/admin/notify/post/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: "Invalid Post ID format." });
    }
    const post = await Post.findById(postId).lean();
    if (!post) {
      return res.status(404).json({ error: "Post not found." });
    }
    const title = post.pushTitle || post.title;
    const body = "";
    const data = {
      url: `/post/${post._id}`,
      postId: post._id.toString(),
      imageUrl: post.imageUrl || "",
    };
    const result = await sendGlobalNotification({ title, body, data });
    res.json({
      message: `Global notification for post "${title}" has been sent.`,
      totalTokensInDb: result.totalTokens,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  } catch (error) {
    console.error("❌ Error sending global post notification:", error);
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
});

app.get("/api/images", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 24;
    const skip = (page - 1) * limit;

    const images = await ImageModel.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("imageUrl title _id")
      .lean();

    const totalImages = await ImageModel.countDocuments({});
    const totalPages = Math.ceil(totalImages / limit);

    res.json({
      status: "success",
      images: images,
      page,
      totalPages,
      totalImages,
    });
  } catch (err) {
    console.error("❌ Error fetching image gallery data:", err);
    res.status(500).json({ status: "error", message: "Failed to fetch image gallery data." });
  }
});

app.get('/api/migrate-image-urls', async (req, res) => {
  try {
    const postsWithUrls = await Post.find(
      { imageUrl: { $ne: null, $ne: "" } },
      { imageUrl: 1, title: 1, _id: 0 }
    ).lean();

    if (postsWithUrls.length === 0) {
      return res.status(200).json({
        status: "success",
        message: 'posts కలెక్షన్లో ఇమేజ్ URL ఉన్న డాక్యుమెంట్లు ఏవీ లేవు.'
      });
    }

    const imagesToStore = postsWithUrls.map(post => ({
      imageUrl: post.imageUrl,
      title: post.title || 'Source Post Image',
      sourceCollection: 'posts'
    }));

    let successfulInserts = 0;

    const result = await ImageModel.insertMany(imagesToStore, { ordered: false })
      .catch(error => {
        if (error.code === 11000) {
          successfulInserts = error.result?.nInserted || 0;
          console.warn(`⚠️ Warning: ${imagesToStore.length - successfulInserts} duplicate image URLs skipped.`);
          return error.result;
        }
        throw error;
      });

    successfulInserts = successfulInserts || result.length;

    res.status(200).json({
      status: "success",
      message: `${postsWithUrls.length} పోస్ట్‌ల నుండి డేటా ప్రాసెస్ చేయబడింది. ${successfulInserts} కొత్త ఇమేజ్ URL లు saved_image_data కలెక్షన్‌లో నిల్వ చేయబడ్డాయి.`,
      totalPostsChecked: postsWithUrls.length,
      storedCount: successfulInserts,
    });
  } catch (err) {
    console.error('💥 Error in /api/migrate-image-urls:', err);
    res.status(500).json({
      status: "error",
      message: 'డేటా ఫెచ్ మరియు నిల్వ చేయడంలో ఎర్రర్.',
      details: err.message
    });
  }
});

app.get('/api/store-image-url', async (req, res) => {
  const { imageUrl, title } = req.query;

  if (!imageUrl) {
    return res.status(400).send(`
            <h2>ఇమేజ్ URL స్టోర్ టెస్ట్</h2>
            <p><strong>ఎర్రర్:</strong> imageUrl పారామీటర్ అవసరం.</p>
            <p>ఉదాహరణ: <code>/api/store-image-url?imageUrl=https://example.com/test.jpg&title=MyTestImage</code></p>
        `);
  }

  try {
    const newImage = new ImageModel({
      imageUrl,
      title: title || 'Browser Upload',
      sourceCollection: 'browser_test'
    });
    const savedImage = await newImage.save();
    res.status(201).send(`
            <h2>ఇమేజ్ URL స్టోర్ టెస్ట్ - విజయవంతం</h2>
            <p><strong>విజయవంతంగా స్టోర్ చేయబడిన ఇమేజ్:</strong></p>
            <pre>${JSON.stringify(savedImage, null, 2)}</pre>
            <img src="${imageUrl}" alt="Stored Image" style="max-width: 300px; height: auto;">
        `);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send(`
                <h2>ఇమేజ్ URL స్టోర్ టెస్ట్ - విఫలం</h2>
                <p><strong>ఎర్రర్:</strong> ఈ ఇమేజ్ URL ఇప్పటికే కలెక్షన్లో ఉంది (డూప్లికేట్ కీ).</p>
                <p>URL: ${imageUrl}</p>
            `);
    }
    console.error('Error saving image URL:', error);
    res.status(500).send(`
            <h2>ఇమేజ్ URL స్టోర్ టెస్ట్ - విఫలం</h2>
            <p>సర్వర్ ఎర్రర్: ${error.message}</p>
        `);
  }
});

// =================================================================
// 6. API ENDPOINTS
// =================================================================
app.get("/", (req, res) => res.send("API Server is running."));

app.get("/api/fetch-news-manual", async (req, res) => {
  await fetchAllNewsSources();
  res.json({ message: "Manual news fetch process initiated." });
});

app.get("/api/sources", async (req, res) => {
  try {
    const sources = await Post.distinct("source");
    res.json({ status: "success", sources: sources.filter((s) => s) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch sources", details: err.message });
  }
});

app.get("/api/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.category) filter.categories = req.query.category;

    // =================================================================
    // ✅ PINNING FEATURE: LOGIC UPDATE
    // =================================================================
    // Use an aggregation pipeline to handle custom sorting
    const pipeline = [
      // 1. Match posts based on filters from the query string
      { $match: filter },
      
      // 2. Add a temporary field `pinOrder`. If `pinnedIndex` exists, use it.
      //    If it's null (not pinned), assign a very large number so it sorts last.
      {
        $addFields: {
          pinOrder: { $ifNull: ["$pinnedIndex", 999999] }
        }
      },
      
      // 3. Sort by our new field first (ascending), so pinned items 0, 1, 2...
      //    come first. Then, sort all other items by their publication date (descending).
      {
        $sort: {
          pinOrder: 1,
          publishedAt: -1
        }
      },
      
      // 4. Apply pagination to the sorted results
      { $skip: skip },
      { $limit: limit }
    ];

    // Execute the pipeline to get the posts
    const posts = await Post.aggregate(pipeline);
    
    // Get the total count of documents that match the filter for pagination purposes
    const totalPosts = await Post.countDocuments(filter);
    const totalPages = Math.ceil(totalPosts / limit);
    
    res.json({ status: "success", posts, page, totalPages, totalPosts });

  } catch (err) {
    console.error("Error in /api/posts:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});


app.get("/api/curated-feed", async (req, res) => {
  try {
    // --- Read parameters from the request URL ---
    const limit = parseInt(req.query.limit) || 20;
    const categories = req.query.categories ? req.query.categories.split(",").filter(c => c) : [];
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;
    const source = req.query.source; // ✅ ADDED: Get the source from the query

    // --- 1. Define the base filter for matching posts ---
    const filter = { isPublished: true };
    if (categories.length > 0) {
      filter.categories = { $in: categories };
    }
    if (source) { // ✅ ADDED: Add the source to the main filter if it exists
      filter.source = source;
    }
    
    // For infinite scroll, modify the filter based on the cursor
    if (cursor) {
      filter.publishedAt = { $lt: cursor };
      // When scrolling, we exclude pinned posts to avoid showing them again
      filter.pinnedIndex = { $eq: null };
    }

    // --- 2. Fetch pinned posts ONLY on the first load (when no cursor is present) ---
    let pinnedPosts = [];
    if (!cursor) {
      const pinFilter = { isPublished: true, pinnedIndex: { $ne: null } };
      if (categories.length > 0) {
        pinFilter.categories = { $in: categories };
      }
      if (source) { // ✅ ADDED: Also apply the source filter to the pinned posts query
        pinFilter.source = source;
      }
      pinnedPosts = await Post.find(pinFilter)
        .sort({ pinnedIndex: 'asc' })
        .populate("relatedStories", "_id title summary imageUrl")
        .lean();
    }
    
    // --- 3. Fetch regular, date-sorted posts ---
    const remainingLimit = limit - pinnedPosts.length;
    let regularPosts = [];
    if (remainingLimit > 0) {
        regularPosts = await Post.find(filter)
            .sort({ publishedAt: -1 })
            .limit(remainingLimit)
            .populate("relatedStories", "_id title summary imageUrl")
            .lean();
    }

    // --- 4. Combine and determine the next cursor ---
    const allPosts = [...pinnedPosts, ...regularPosts];
    
    let nextCursor = null;
    if (allPosts.length > 0 && allPosts.length >= limit) {
        const lastPost = allPosts[allPosts.length - 1];
        nextCursor = lastPost.publishedAt;
    }

    res.json({ status: "success", posts: allPosts, nextCursor });

  } catch (err) {
    console.error("Error in /api/curated-feed:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});


app.get("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid Post ID format." });
    const post = await Post.findById(req.params.id)
      .populate("relatedStories", "_id title")
      .lean();
    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({ status: "success", post });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch post", details: err.message });
  }
});

app.post("/api/post", async (req, res) => {
  try {
    const newPostData = {
      ...req.body,
      sourceType: "manual",
      publishedAt: new Date(),
    };
    const { categories, topCategory } = classifyArticle(
      newPostData.title + " " + (newPostData.summary || "")
    );
    newPostData.categories = categories;
    newPostData.topCategory = topCategory;
    const newPost = new Post(newPostData);
    await newPost.save();
    await sendNotificationForPost(newPost);
    res.status(201).json({ status: "success", post: newPost });
  } catch (err) {
    res.status(500).json({ error: "Failed to create post", details: err.message });
  }
});

app.get("/api/posts/search", async (req, res) => {
  try {
    const searchQuery = req.query.q;
    if (!searchQuery) {
      return res.json([]);
    }
    const posts = await Post.find({
      $or: [
        { title: { $regex: searchQuery, $options: "i" } },
        { summary: { $regex: searchQuery, $options: "i" } },
      ],
    })
      .sort({ publishedAt: -1 })
      .limit(10)
      .select("title summary source publishedAt")
      .lean();
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: "Search failed" });
  }
});

app.put("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid post ID" });
    const updatedPost = await Post.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updatedPost) return res.status(404).json({ error: "Post not found" });
    res.json({ status: "success", post: updatedPost });
  } catch (err) {
    res.status(500).json({ error: "Failed to update post", details: err.message });
  }
});

app.delete("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid post ID" });
    const deleted = await Post.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Post not found" });
    res.json({ status: "success", message: "Post deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post", details: err.message });
  }
});

app.post("/api/register-token", async (req, res) => {
  const { token, categories } = req.body;

  if (!token || typeof token !== "string" || token.length < 10) {
    return res.status(400).json({ error: "Invalid FCM Token provided." });
  }

  try {
    await FcmToken.findOneAndUpdate(
      { token: token },
      { $set: { subscribedCategories: categories || [] } },
      { upsert: true }
    );
    console.log(`📲 Token registered or updated: ${token.slice(0, 20)}...`);
    res.status(200).json({ message: "Token registered successfully." });
  } catch (error) {
    console.error("❌ Failed to register FCM token:", error);
    res.status(500).json({ error: "Server error while registering token." });
  }
});

app.post("/api/formatted-tweet", async (req, res) => {
  try {
    const { tweet_ids } = req.body;
    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res.status(400).json({ error: "tweet_ids must be a non-empty array." });
    }

    const successfulPosts = [];
    const failedIds = [];

    for (const tweetId of tweet_ids) {
      try {
        const response = await fetch(
          `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
          { headers: { "x-api-key": TWITTER_API_IO_KEY } }
        );
        const data = await response.json();

        if (data.status !== "success" || !data.tweets || !data.tweets.length) {
          console.warn(`Could not fetch or find tweet with ID: ${tweetId}`);
          failedIds.push(tweetId);
          continue;
        }

        const tweet = data.tweets[0];
        const geminiResult = await processWithGemini(tweet.text);
        const { categories, topCategory } = classifyArticle(`${geminiResult.title} ${geminiResult.summary}`);

        const postData = {
          title: geminiResult.title,
          summary: geminiResult.summary,
          text: tweet.text,
          url: tweet.url,
          tweetId: tweet.id,
          twitterUrl: tweet.twitterUrl,
          source: "Twitter",
          sourceType: "tweet_api",
          publishedAt: new Date(tweet.createdAt),
          lang: tweet.lang,
          categories: categories,
          topCategory: topCategory,
          imageUrl: tweet.extendedEntities?.media?.[0]?.media_url_https || null,
          media: (tweet.extendedEntities?.media || []).map((m) => ({
            type: m.type,
            url: m.media_url_https,
            variants:
              m.video_info?.variants
                ?.filter((v) => v.content_type === "video/mp4")
                .map((v) => ({
                  bitrate: v.bitrate || 0,
                  url: v.url,
                })) || [],
          })),
        };

        const updatedOrCreatedPost = await Post.findOneAndUpdate(
          { tweetId: tweet.id },
          { $set: postData },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        const isNew = Math.abs(new Date(updatedOrCreatedPost.createdAt) - new Date(updatedOrCreatedPost.updatedAt)) < 2000;
        if (isNew) {
          console.log(`✅ New post from tweet ${tweet.id}. Triggering notification.`);
          await sendNotificationForPost(updatedOrCreatedPost);
        }

        successfulPosts.push(updatedOrCreatedPost);
      } catch (err) {
        console.error(`❌ Failed to process tweet ID ${tweetId}:`, err);
        failedIds.push(tweetId);
      }
    }

    res.json({
      status: "success",
      message: `Processed ${successfulPosts.length} of ${tweet_ids.length} tweets.`,
      successfulPosts: successfulPosts,
      failedIds: failedIds,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.get("/api/classify-all", async (req, res) => {
  try {
    const articles = await Post.find({
      $or: [{ categories: { $exists: false } }, { categories: { $size: 0 } }],
    });
    let updated = 0;
    for (let article of articles) {
      const { categories, topCategory } = classifyArticle(`${article.title || ""} ${article.summary || ""}`);
      if (categories.length > 0) {
        article.categories = categories;
        article.topCategory = topCategory;
        await article.save();
        updated++;
      }
    }
    res.json({
      message: "Classification complete",
      totalChecked: articles.length,
      updated,
    });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

// =================================================================
// 7. START SERVER
// =================================================================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
