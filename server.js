// =================================================================
// 1. IMPORTS & INITIALIZATIONS
// =================================================================
import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";
import cron from "node-cron";
import cors from "cors";
import { getMessaging } from "firebase-admin/messaging";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import fs from "fs";
import logger from "./logger.js"; // Import the logger
import { create } from "domain";

dotenv.config();

// --- Main Initializations ---
const app = express();
const parser = new Parser();

// --- API Keys & Config ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 4000;
const SELF_URL =
  process.env.SERVER_URL || `https://twitterapi-node.onrender.com`;
const TWITTER_API_IO_KEY = process.env.TWITTER_API_KEY;

// --- Firebase Admin SDK Setup ---
// const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// --- Firebase Admin SDK Setup ---
const serviceAccount = JSON.parse(
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- Source Lists ---
const RSS_SOURCES = [
  // 📰 Major Telugu News Channels
  { url: "https://ntvtelugu.com/feed", name: "NTV Telugu", category: "News" },
  { url: "https://telugushorts.com/feed", name: "telugushorts.com", category: "News" },
  { url: "https://tv9telugu.com/feed", name: "TV9 Telugu", category: "News" },
  { url: "https://10tv.in/latest/feed", name: "10TV Telugu", category: "News" },
  { url: "https://telugustop.com/feed/", name: "TeluguStop", category: "News" },
  {
    url: "https://www.teluguone.com/news/rssDetails.rss",
    name: "TeluguOne",
    category: "News",
  },
  {
    url: "https://telugu.oneindia.com/rss/feeds/telugu-news-fb.xml",
    name: "OneIndia Telugu",
    category: "News",
  },
  {
    url: "https://telugu.gulte.com/feed",
    name: "gulte",
    category: "News",
  },
  {
    url: "https://telugu.hindustantimes.com/rss/andhra-pradesh",
    name: "Hindustan Times Telugu (Andhra Pradesh)",
    category: "Regional News",
  },
  {
    url: "https://telugu.hindustantimes.com/rss/telangana",
    name: "Hindustan Times Telugu (Telangana)",
    category: "Regional News",
  },
  {
    url: "https://telugu.hindustantimes.com/rss/sports",
    name: "Hindustan Times Telugu (Sports)",
    category: "Sports",
  },

  // 🌍 National & English News Feeds
  // {
  //   url: "https://feeds.feedburner.com/ndtvnews-latest",
  //   name: "NDTV News",
  //   category: "National News",
  // },
  // {
  //   url: "https://www.news18.com/commonfeeds/v1/eng/rss/india.xml",
  //   name: "News18 India",
  //   category: "National News",
  // },
  // {
  //   url: "https://www.freepressjournal.in/stories.rss",
  //   name: "Free Press Journal",
  //   category: "National News",
  // },

  // 💰 Business / Economy
  {
    url: "https://telugu.goodreturns.in/rss/",
    name: "GoodReturns Telugu",
    category: "Business",
  },

  // 🏏 Sports & Live Scores
  
  {
    url: "https://telugu.mykhel.com/rss/feeds/mykhel-telugu-fb.xml",
    name: "MyKhel Telugu Sports",
    category: "Sports",
  },
  {
    url: "https://telugu.mykhel.com/rss/feeds/telugu-cricket-fb.xml",
    name: "MyKhel Telugu Cricket",
    category: "Sports",
  },

  // 🎬 Entertainment & Movies
  {
    url: "https://www.cinejosh.com/rss-feed.html",
    name: "CineJosh Telugu",
    category: "Entertainment",
  },
  {
    url: "https://telugu.nativeplanet.com/rss/feeds/nativeplanet-telugu-fb.xml",
    name: "NativePlanet Telugu",
    category: "Entertainment",
  },

  // 💻 Technology
  {
    url: "https://telugu.gizbot.com/rss/feeds/telugu-news-fb.xml",
    name: "Gizbot Telugu Tech",
    category: "Technology",
  },
];

// 🚀 NEW: YouTube RSS Sources
const YOUTUBE_RSS_SOURCES = [
  // { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCmqfX0S3x0I3uwLkPdpX03w", name: "Star Sports", category: "Sports", type: "youtube" },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCmqfX0S3x0I3uwLkPdpX03w",
    name: "Star Sports",
    category: "News",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCPXTXMecYqnRKNdqdVOGSFg",
    name: "Tv9",
    category: "Tel",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCQ_FATLW83q-4xJ2fsi8qAw",
    name: "Sakshi",
    category: "Tel",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCPXTXMecYqnRKNdqdVOGSFg",
    name: "Tv9",
    category: "Tel",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCZFMm1mMw0F81Z37aaEzTUA",
    name: "NDTV",
    category: "video",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?user=spacexchannel",
    name: "SpaceX",
    category: "Technology",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?user=GoogleTechTalks",
    name: "Google Tech Talks",
    category: "Technology",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?user=cricketaustraliatv",
    name: "Cricket Australia",
    category: "Sports",
    type: "youtube",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCSRQXk5yErn4e14vN76upOw",
    name: "Cricbuzz",
    category: "Sports",
    type: "youtube",
  },
];

// ✅ NEW: DICTIONARY FOR AUTOMATIC CATEGORY-WISE TAGGING
const categoryTagMap = {
  Sports: [
    "cricket",
    "ipl",
    "football",
    "t20",
    "virat kohli",
    "rohit sharma",
    "world cup",
  ],
  Entertainment: [
    "tollywood",
    "bollywood",
    "salaar",
    "prabhas",
    "review",
    "allu arjun",
    "mahesh babu",
    "jr ntr",
  ],
  Politics: [
    "election",
    "parliament",
    "narendra modi",
    "revanth reddy",
    "jagan reddy",
    "chandrababu naidu",
  ],
  Technology: [
    "iphone",
    "android",
    "google",
    "samsung",
    "ai",
    "meta",
    "whatsapp",
  ],
};

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// =================================================================
// 2. MONGODB SETUP & MODELS
// =================================================================

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 99 },
});
const Counter = mongoose.model("Counter", CounterSchema);

const ImageSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true, unique: true },
    title: { type: String, required: false },
    sourceCollection: { type: String, default: "manual_upload" },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "saved_image_data" }
);
const ImageModel = mongoose.model("Image", ImageSchema);

const mediaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["photo", "video", "animated_gif"],
    },
    url: String,
    altText: String,

    // ✨ ADDED THIS FIELD
    overlayPosition: {
      type: String,
      enum: ["top", "middle", "bottom"],
      default: "middle", // The text will be in the middle by default
    },
    objectFit: {
      type: String,
      enum: ["cover", "contain", "repeat", "stretch"],
      default: "cover",
    },
    variants: [{ bitrate: Number, url: String }],
    width: Number,
    height: Number,
  },
  { _id: false }
);

const stackedImageSchema = new mongoose.Schema(
  {
    uri: { type: String, required: true },
    flex: { type: Number, required: true },
  },
  { _id: false }
);

// Sub-schema for Related Stories (The fix you requested)
const relatedStorySchema = new mongoose.Schema({
    title: { type: String, required: true },
    summary: String,
    imageUrl: String,
    url: String
}, { _id: false }); // _id: false prevents creating a unique ID for each sub-object

// ✅ FINALIZED SCHEMA
const postSchema = new mongoose.Schema(
  {
    postId: { type: Number, unique: true },
    title: { type: String, required: true, index: "text" },
    summary: { type: String, index: "text" },
    text: String,
    url: { type: String, unique: true, sparse: true },
    imageFit: {
      type: String,
      enum: ["cover", "contain", "repeat", "stretch"],
      default: "cover",
    },
    imageUrl: String,
    stackedImages: [stackedImageSchema], // ✅ ADDED: The new field using the sub-schema.
    relatedStories: [relatedStorySchema],
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
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", index: true }], // Correctly references the Tag model
    isPublished: { type: Boolean, default: true, index: true },
    media: [mediaSchema],
    videoUrl: String,
    videoFit: {
      type: String,
      enum: ["COVER", "CONTAIN", "STRETCH"],
      default: "CONTAIN",
    },
    isBreaking: { type: Boolean, default: false },
    isTwitterLink: { type: Boolean, default: false },
    type: { type: String, default: "normal_post" },
    scheduledFor: { type: Date, default: null },
    tweetId: { type: String, unique: true, sparse: true },
    twitterUrl: String,
    pinnedIndex: { type: Number, default: null, index: true },
  },
  { timestamps: true, collection: "posts" }
);

postSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: "postId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      this.postId = counter.seq;
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

postSchema.index({ categories: 1, publishedAt: -1 });
const Post = mongoose.model("Post", postSchema);

// ✅ NEW: Schema for the dedicated Tags collection
const TagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);
const Tag = mongoose.model("Tag", TagSchema);

// 🚀 NEW: Schema for YouTube videos to be stored in a separate collection
// In server.js, find your videoSchema and update it

const videoSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    link: { type: String, required: true },
    author: { type: String, required: true },
    // MODIFIED: Renamed from publishedDate to avoid confusion
    sourcePublishedAt: { type: Date, index: true },
    thumbnailUrl: { type: String },
    description: { type: String },
    source: { type: String, default: "youtube" },
    category: { type: String, index: true },

    // ✅ NEW: Fields for publishing status
    isPublished: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: "videos" }
);

const Video = mongoose.model("Video", videoSchema);

// ✅ MODIFIED: Enhanced schema for guest user profiles
const fcmTokenSchema = new mongoose.Schema(
  {
    // A stable ID generated by the app on first launch
    deviceId: { type: String, required: true, unique: true, index: true },
    // The FCM token, which can be updated
    token: { type: String, required: true, unique: true },
    // To distinguish between guest and registered users in the future
    userType: { type: String, enum: ["guest", "registered"], default: "guest" },
    // Explicit preferences
    subscribedCategories: [{ type: String }],
    // Implicit, learned preferences
    profileVector: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);
const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);

const UserInteractionSchema = new mongoose.Schema(
  {
    // ✅ MODIFIED: Use the stable deviceId for tracking
    deviceId: { type: String, required: true, index: true },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ["read", "like", "share"],
      required: true,
    },
    timeSpentOnPost: { type: Number }, // in seconds, optional
  },
  { timestamps: true }
);
const UserInteraction = mongoose.model(
  "UserInteraction",
  UserInteractionSchema
);

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

// ✅ NEW: Helper to find existing tags or create new ones, returns an array of ObjectIDs
// ✅ REPLACED: This version is safer and handles invalid data without crashing.
async function findOrCreateTags(tagNames = []) {
  if (!tagNames || tagNames.length === 0) return [];
  const tagOperations = tagNames.map((name) => {
    if (typeof name !== "string") return null;
    const tagName = name.trim().toLowerCase();
    if (!tagName) return null;
    return Tag.findOneAndUpdate(
      { name: tagName },
      { $setOnInsert: { name: tagName } },
      { new: true, upsert: true }
    );
  });
  const settledTags = await Promise.all(tagOperations.filter(Boolean));
  return settledTags.map((tag) => tag._id);
}

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

// Replace the old normalizeUrl function with this improved version
function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);

    // 1. Remove 'www.' from the beginning of the hostname
    const hostname = url.hostname.replace(/^www\./, "");

    // 2. Get the pathname and remove any trailing slash (if it's not the root path "/")
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // 3. Reconstruct the URL, standardizing the protocol to https and ignoring query params/hash
    return `https://${hostname}${pathname}`;
  } catch (error) {
    // Fallback for invalid URLs, though less likely with feeds
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

// function extractImageFromItem(item) {
//   if (item.enclosure?.url && item.enclosure.type?.startsWith("image"))
//     return item.enclosure.url;
//   const content = item["content:encoded"] || item.content || "";
//   return cheerio.load(content)("img").first().attr("src") || null;
// }


function extractImageFromItem(item) {
  // 1. Check for 'media:content' (Used by NDTV and many news sites)
  // Some parsers return it as an object, others as an array.
  if (item["media:content"]) {
    const media = item["media:content"];
    // If it's an object with a url
    if (media.url) return media.url;
    // If it's an array (sometimes happens with multiple resolutions), take the first one
    if (Array.isArray(media) && media[0]?.url) return media[0].url;
    // If your parser puts attributes inside a '$' property (common in xml2js)
    if (media.$ && media.$.url) return media.$.url;
  }

  // 2. Check for standard RSS 'enclosure'
  if (item.enclosure && item.enclosure.url) {
    return item.enclosure.url;
  }

  // 3. Fallback: Check for an <img> tag inside the HTML content
  const content = item["content:encoded"] || item.content || "";
  if (content) {
    // Basic regex is faster/lighter than loading cheerio just for one attribute
    const imgMatch = content.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch) return imgMatch[1];
    
    // OR if you prefer Cheerio (slower but safer):
    // return cheerio.load(content)("img").first().attr("src") || null;
  }

  return null;
}

function classifyArticle(text) {
  const keywords = {
    Sports: [
      "cricket",
      "football",
      "tennis",
      "ipl",
      "sports",
      "hockey",
      "badminton",
      "kabaddi",
      "olympics",
      "t20",
      "odi",
      "world cup",
      "match",
      "tournament",
      "league",
      "goal",
      "క్రికెట్",
      "ఫుట్‌బాల్",
      "టెన్నిస్",
      "హాకీ",
      "బ్యాడ్మింటన్",
      "కబడ్డీ",
      "ఐపీఎల్",
      "వరల్డ్ కప్",
      "మ్యాచ్",
    ],
    Entertainment: [
      "movie",
      "cinema",
      "film",
      "actor",
      "actress",
      "celebrity",
      "director",
      "music",
      "song",
      "trailer",
      "teaser",
      "box office",
      "Tollywood",
      "Bollywood",
      "Hollywood",
      "web series",
      "OTT",
      "సినిమా",
      "చిత్రం",
      "నటుడు",
      "నటి",
      "హీరో",
      "హీరోయిన్",
      "దర్శకుడు",
      "సంగీతం",
      "పాట",
      "ట్రైలర్",
    ],
    Politics: [
      "election",
      "vote",
      "minister",
      "government",
      "mla",
      "mp",
      "parliament",
      "assembly",
      "narendra modi",
      "modi",
      "revanth reddy",
      "kcr",
      "ktr",
      "jagan reddy",
      "chandrababu naidu",
      "pawan kalyan",
      "ఎన్నికలు",
      "ఓటు",
      "మంత్రి",
      "ప్రభుత్వం",
      "పార్టీ",
    ],
    National: [
      "india",
      "bharat",
      "delhi",
      "mumbai",
      "supreme court",
      "army",
      "navy",
      "isro",
      "భారతదేశం",
      "జాతీయ",
    ],
    International: [
      "world",
      "global",
      "usa",
      "america",
      "china",
      "pakistan",
      "russia",
      "un",
      "war",
      "ప్రపంచం",
      "అంతర్జాతీయ",
    ],
    Telangana: [
      "telangana",
      "hyderabad",
      "warangal",
      "revanth reddy",
      "kcr",
      "ktr",
      "తెలంగాణ",
      "హైదరాబాద్",
    ],
    AndhraPradesh: [
      "andhra pradesh",
      "amaravati",
      "vizag",
      "vijayawada",
      "jagan reddy",
      "chandrababu naidu",
      "pawan kalyan",
      "ఆంధ్రప్రదేశ్",
      "అమరావతి",
      "విశాఖపట్నం",
    ],
    Crime: [
      "crime",
      "murder",
      "theft",
      "robbery",
      "rape",
      "scam",
      "police",
      "court",
      "cbi",
      "violence",
      "నేరం",
      "హత్య",
      "దొంగతనం",
      "మోసం",
    ],
    Technology: [
      "technology",
      "tech",
      "gadget",
      "mobile",
      "smartphone",
      "iphone",
      "android",
      "ai",
      "google",
      "apple",
      "microsoft",
      "meta",
      "facebook",
      "twitter",
      "x",
      "whatsapp",
      "instagram",
      "app",
      "సాంకేతికత",
      "టెక్నాలజీ",
      "మొబైల్",
      "స్మార్ట్‌ఫోన్",
    ],
    Lifestyle: [
      "lifestyle",
      "fashion",
      "health",
      "fitness",
      "diet",
      "yoga",
      "travel",
      "food",
      "recipe",
      "beauty",
      "జీవనశైలి",
      "ఫ్యాషన్",
      "ఆరోగ్యం",
      "ఆహారం",
    ],
    Spiritual: [
      "spiritual",
      "religion",
      "god",
      "temple",
      "church",
      "mosque",
      "puja",
      "festival",
      "diwali",
      "ramzan",
      "christmas",
      "ayodhya",
      "tirupati",
      "yadadri",
      "ఆధ్యాత్మిక",
      "దేవుడు",
      "దేవాలయం",
    ],
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

// ✅ NEW HELPER FUNCTION TO AUTO-APPLY TAGS
async function applyCategoryTags(post) {
  const populatedPost = post.populated("tags")
    ? post
    : await post.populate("tags");
  const existingTagNames = populatedPost.tags?.map((t) => t.name) || [];
  const tagsToApply = new Set(existingTagNames);
  const relevantTags = categoryTagMap[post.topCategory];
  if (relevantTags) {
    const content = `${post.title} ${post.summary}`.toLowerCase();
    relevantTags.forEach((tag) => {
      if (content.includes(tag.toLowerCase())) tagsToApply.add(tag);
    });
  }
  const finalTagNames = Array.from(tagsToApply);
  if (
    finalTagNames.length > existingTagNames.length ||
    !finalTagNames.every((t) => existingTagNames.includes(t))
  ) {
    post.tags = await findOrCreateTags(finalTagNames);
    logger.info(
      `🏷️  Applied tags to post #${post.postId}: ${finalTagNames.join(", ")}`
    );
  }
}

async function updateRelatedStories(post) {
  const populatedPost = await Post.findById(post._id).populate("tags");
  if (
    !populatedPost ||
    !populatedPost.tags ||
    populatedPost.tags.length === 0
  ) {
    if (post.relatedStories && post.relatedStories.length > 0) {
      await Post.updateOne({ _id: post._id }, { $set: { relatedStories: [] } });
    }
    return;
  }
  const linkingTags = populatedPost.tags.filter(
    (tag) => tag && tag.name && tag.name.startsWith("link:")
  );
  if (linkingTags.length > 0) {
    const linkingTagIds = linkingTags.map((t) => t._id);
    const postsInAllGroups = await Post.find({ tags: { $in: linkingTagIds } })
      .populate("tags")
      .select("_id tags");
    for (const currentPost of postsInAllGroups) {
      const currentPostLinkTagIds = currentPost.tags
        .filter((t) => t && t.name && t.name.startsWith("link:"))
        .map((t) => t._id.toString());
      const relatedIds = postsInAllGroups
        .filter(
          (otherPost) =>
            !otherPost._id.equals(currentPost._id) &&
            otherPost.tags.some(
              (tag) => tag && currentPostLinkTagIds.includes(tag._id.toString())
            )
        )
        .map((p) => p._id);
      await Post.updateOne(
        { _id: currentPost._id },
        { $set: { relatedStories: relatedIds } }
      );
    }
    logger.info(
      `🔗 Processed manual linking for ${linkingTags
        .map((t) => t.name)
        .join(", ")}, affecting ${postsInAllGroups.length} posts.`
    );
  } else {
    const regularTagIds = populatedPost.tags.filter(Boolean).map((t) => t._id);
    if (regularTagIds.length === 0) return;
    const related = await Post.find({
      tags: { $in: regularTagIds },
      _id: { $ne: populatedPost._id },
    })
      .sort({ publishedAt: -1 })
      .limit(3)
      .select("_id")
      .lean();
    const relatedIds = related.map((p) => p._id);
    await Post.updateOne(
      { _id: populatedPost._id },
      { $set: { relatedStories: relatedIds } }
    );
    if (relatedIds.length > 0) {
      logger.info(
        `🔗 Linked ${related.length} stories to post #${populatedPost.postId} using auto-tags.`
      );
    }
  }
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
    console.log(
      `✅ Notification sent to ${
        response.successCount
      } devices for post: "${post.title.slice(0, 30)}..."`
    );
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          [
            "messaging/registration-token-not-registered",
            "messaging/invalid-registration-token",
          ].includes(resp.error.code)
        ) {
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
  try {
    const existingPost = await Post.findOne({ url: postData.url });
    if (existingPost) {
      return false;
    }
    const newPost = new Post(postData);
    const savedPost = await newPost.save();
    console.log(
      `✅ Saved new post #${savedPost.postId}: "${savedPost.title.slice(
        0,
        30
      )}..." from ${savedPost.source}`
    );

    // ✅ MODIFIED: Run new logic after saving
    await sendNotificationForPost(savedPost);
    await applyCategoryTags(savedPost);
    // await updateRelatedStories(savedPost);

    return true;
  } catch (error) {
    if (error.code !== 11000) {
      console.error(
        `Error saving post "${postData.title.slice(0, 30)}...":`,
        error.message
      );
    }
    return false;
  }
}

// ✅ NEW PERSONALIZATION HELPERS
/**
 * Calculates a numerical vector representing a user's interests based on their
 * recent interactions, applying weights and time decay.
 * @param {string} token The user's FCM token.
 */
async function generateUserProfileVector(token) {
  const eventWeights = { read: 1, like: 3, share: 5 };
  const lookbackDays = 30;
  const decayRate = 0.05;

  const interactions = await UserInteraction.find({
    fcmToken: token,
    createdAt: {
      $gte: new Date(new Date().setDate(new Date().getDate() - lookbackDays)),
    },
  }).populate("postId", "categories");

  if (interactions.length === 0) {
    await FcmToken.updateOne({ token: token }, { $set: { profileVector: {} } });
    return;
  }

  const vector = {};
  const now = new Date();
  for (const interaction of interactions) {
    if (!interaction.postId || !interaction.postId.categories) continue;
    const daysOld =
      (now - new Date(interaction.createdAt)) / (1000 * 3600 * 24);
    const timeDecayFactor = Math.exp(-decayRate * daysOld);
    const interactionScore =
      (eventWeights[interaction.eventType] || 1) * timeDecayFactor;
    for (const category of interaction.postId.categories) {
      vector[category] = (vector[category] || 0) + interactionScore;
    }
  }

  const totalScore = Object.values(vector).reduce(
    (sum, value) => sum + value,
    0
  );
  if (totalScore > 0) {
    for (const category in vector) {
      vector[category] = vector[category] / totalScore;
    }
  }

  await FcmToken.updateOne(
    { token: token },
    { $set: { profileVector: vector } }
  );
}

async function updateAllUserProfileVectors() {
  logger.info("🔄 Starting batch update of all user profile vectors...");
  const tokens = await FcmToken.find({}).distinct("token");

  let successCount = 0;
  for (const token of tokens) {
    try {
      await generateUserProfileVector(token);
      successCount++;
    } catch (err) {
      logger.error(
        `❌ Failed to generate vector for token ${token.slice(0, 15)}...:`,
        err
      );
    }
  }
  logger.info(
    `✅ Vector update complete. Processed ${successCount} of ${tokens.length} users.`
  );
}

// =================================================================
// 5. CRON JOBS
// =================================================================
cron.schedule("*/5 * * * *", async () => {
  try {
    await axios.get(SELF_URL);
  } catch (err) {
    /* Silently fail on self-ping */
  }
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
          summary: cleanHtmlContent(
            item.contentSnippet || item.description || ""
          ),
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
      console.error(
        `❌ Failed to fetch RSS feed from ${sourceName}: ${error.message}`
      );
    }
  }
  console.log(
    `✅ Cron: RSS fetching complete. Added ${newPostsCount} new posts.`
  );
});

// 🚀 NEW: Add this cron job for fetching YouTube videos automatically
cron.schedule("0 */4 * * *", async () => {
  console.log("⏰ Cron: Starting scheduled YouTube feed processing...");
  await fetchAllYouTubeSources();
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
            imageFit: "cover",
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

async function sendSingleNotification(token, payload) {
  const { title, body, data } = payload;
  const message = {
    notification: { title, body },
    data: data || {},
    token: token,
  };
  try {
    const response = await getMessaging().send(message);
    console.log(
      `✅ Successfully sent message to token ${token.slice(0, 20)}...:`,
      response
    );
    return { success: true, response };
  } catch (error) {
    console.error(
      `❌ Error sending message to token ${token.slice(0, 20)}...:`,
      error.message
    );
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
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
    data: { title, body, ...data },
    token: token,
  }));
  try {
    const response = await getMessaging().sendEach(messages);
    console.log(
      `✅ Global notification batch processed. Success: ${response.successCount}, Failure: ${response.failureCount}`
    );
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const failedToken = tokens[idx];
          failedTokens.push(failedToken);
          const errorCode = resp.error?.code;
          if (
            errorCode === "messaging/registration-token-not-registered" ||
            errorCode === "messaging/invalid-registration-token"
          ) {
            console.log(
              `Marking invalid token for removal: ${failedToken.slice(
                0,
                20
              )}...`
            );
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

// =================================================================
// 6. API ENDPOINTS
// =================================================================
cron.schedule("0 */6 * * *", updateAllUserProfileVectors);

// --- TESTING & ADMIN ENDPOINTS ---
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
      res.json({
        message: "Test notification sent successfully.",
        details: result.response,
      });
    } else {
      res.status(500).json({
        message: "Failed to send test notification.",
        details: result.error.message,
      });
    }
  } catch (error) {
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
});

app.post("/api/admin/send-test-news", async (req, res) => {
  try {
    const title = req.body.title || "GLOBAL TEST: Breaking News 📰";
    const body =
      req.body.body ||
      "This is a sample news summary sent to all users for testing purposes.";
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
    res.status(500).json({
      error:
        "An unexpected server error occurred while sending global notification.",
    });
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

app.get("/api/tags", async (req, res) => {
  try {
    const tags = await Tag.find({}).sort({ name: 1 }).lean();
    res.json({ status: "success", tags });
  } catch (err) {
    console.error("Error fetching tags:", err);
    res.status(500).json({ status: "error", message: "Failed to fetch tags." });
  }
});

// --- IMAGE & DATA MIGRATION ENDPOINTS ---
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
    res.status(500).json({
      status: "error",
      message: "Failed to fetch image gallery data.",
    });
  }
});

app.get("/api/migrate-image-urls", async (req, res) => {
  try {
    const postsWithUrls = await Post.find(
      { imageUrl: { $ne: null, $ne: "" } },
      { imageUrl: 1, title: 1, _id: 0 }
    ).lean();
    if (postsWithUrls.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "posts కలెక్షన్లో ఇమేజ్ URL ఉన్న డాక్యుమెంట్లు ఏవీ లేవు.",
      });
    }
    const imagesToStore = postsWithUrls.map((post) => ({
      imageUrl: post.imageUrl,
      title: post.title || "Source Post Image",
      sourceCollection: "posts",
    }));
    let successfulInserts = 0;
    const result = await ImageModel.insertMany(imagesToStore, {
      ordered: false,
    }).catch((error) => {
      if (error.code === 11000) {
        successfulInserts = error.result?.nInserted || 0;
        console.warn(
          `⚠️ Warning: ${
            imagesToStore.length - successfulInserts
          } duplicate image URLs skipped.`
        );
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
    console.error("💥 Error in /api/migrate-image-urls:", err);
    res.status(500).json({
      status: "error",
      message: "డేటా ఫెచ్ మరియు నిల్వ చేయడంలో ఎర్రర్.",
      details: err.message,
    });
  }
});

app.get("/api/store-image-url", async (req, res) => {
  const { imageUrl, title } = req.query;
  if (!imageUrl) {
    return res
      .status(400)
      .send(
        `<h2>Image URL Store Test</h2><p><strong>Error:</strong> imageUrl parameter is required.</p><p>Example: <code>/api/store-image-url?imageUrl=https://example.com/test.jpg&title=MyTestImage</code></p>`
      );
  }
  try {
    const newImage = new ImageModel({
      imageUrl,
      title: title || "Browser Upload",
      sourceCollection: "browser_test",
    });
    const savedImage = await newImage.save();
    res
      .status(201)
      .send(
        `<h2>Image URL Store Test - Success</h2><p><strong>Successfully stored image:</strong></p><pre>${JSON.stringify(
          savedImage,
          null,
          2
        )}</pre><img src="${imageUrl}" alt="Stored Image" style="max-width: 300px; height: auto;">`
      );
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .send(
          `<h2>Image URL Store Test - Failure</h2><p><strong>Error:</strong> This image URL already exists in the collection (duplicate key).</p><p>URL: ${imageUrl}</p>`
        );
    }
    console.error("Error saving image URL:", error);
    res
      .status(500)
      .send(
        `<h2>Image URL Store Test - Failure</h2><p>Server Error: ${error.message}</p>`
      );
  }
});

// --- CORE API ENDPOINTS ---
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
    res
      .status(500)
      .json({ error: "Failed to fetch sources", details: err.message });
  }
});

// ✅ MODIFIED to handle the 'pinned' query parameter from the new frontend
app.get("/api/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.category) filter.categories = req.query.category;

    // This is the new logic to handle pinned/un-pinned filtering
    if (req.query.pinned === "true") {
      filter.pinnedIndex = { $ne: null };
    } else if (req.query.pinned === "false") {
      filter.pinnedIndex = { $eq: null };
    }

    // Pinned posts should always be sorted by their index, not by date
    const sortOrder =
      req.query.pinned === "true" ? { pinnedIndex: 1 } : { publishedAt: -1 };

    const posts = await Post.find(filter)
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean();

    const totalPosts = await Post.countDocuments(filter);
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({ status: "success", posts, page, totalPages, totalPosts });
  } catch (err) {
    console.error("Error in /api/posts:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});



// Main combined feed endpoint
app.get("/api/curated-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const categories = req.query.categories
      ? req.query.categories.split(",").filter((c) => c)
      : [];
    
    // Accept multiple sources as a comma-separated string
    const sources = req.query.sources
      ? req.query.sources.split(",").filter((s) => s)
      : [];
    
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

    // ✅ UPDATE: Added 'lang: "te"' to ensure only Telugu posts are fetched
    const baseFilter = { 
      isPublished: true,
      lang: "te" 
    };

    if (categories.length > 0) {
      baseFilter.categories = { $in: categories };
    }
    
    // Use the $in operator for the sources array
    if (sources.length > 0) {
      baseFilter.source = { $in: sources };
    }

    let pinnedPosts = [];
    // Only fetch pinned posts if we are on the first page (no cursor)
    if (!cursor) {
      const pinFilter = { ...baseFilter, pinnedIndex: { $ne: null } };
      pinnedPosts = await Post.find(pinFilter)
        .sort({ pinnedIndex: "asc" })
        .populate("relatedStories", "_id title summary imageUrl url media") // Populate related stories if needed
        .lean();
    }

    // Regular posts filter (exclude pinned ones)
    const regularPostsFilter = { ...baseFilter, pinnedIndex: { $eq: null } };
    
    if (cursor) {
      regularPostsFilter.publishedAt = { $lt: cursor };
    }

    const remainingLimit = limit - pinnedPosts.length;
    let regularPosts = [];

    if (remainingLimit > 0) {
      regularPosts = await Post.find(regularPostsFilter)
        .sort({ publishedAt: -1 })
        .limit(remainingLimit)
        .populate("relatedStories", "_id title summary imageUrl") // Populate related stories
        .lean();
    }

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




// app.get("/api/curated-feed", async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 20;
//     const categories = req.query.categories
//       ? req.query.categories.split(",").filter((c) => c)
//       : [];
//     // UPDATED: Accept multiple sources as a comma-separated string
//     const sources = req.query.sources
//       ? req.query.sources.split(",").filter((s) => s)
//       : [];
//     const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

//     const baseFilter = { isPublished: true };
//     if (categories.length > 0) {
//       baseFilter.categories = { $in: categories };
//     }
//     // UPDATED: Use the $in operator for the sources array
//     if (sources.length > 0) {
//       baseFilter.source = { $in: sources };
//     }

//     let pinnedPosts = [];
//     if (!cursor) {
//       const pinFilter = { ...baseFilter, pinnedIndex: { $ne: null } };
//       pinnedPosts = await Post.find(pinFilter)
//         .sort({ pinnedIndex: "asc" })
//         .populate("relatedStories", "_id title summary imageUrl url media")
//         .lean();
//     }

//     const regularPostsFilter = { ...baseFilter, pinnedIndex: { $eq: null } };
//     if (cursor) {
//       regularPostsFilter.publishedAt = { $lt: cursor };
//     }

//     const remainingLimit = limit - pinnedPosts.length;
//     let regularPosts = [];
//     if (remainingLimit > 0) {
//       regularPosts = await Post.find(regularPostsFilter)
//         .sort({ publishedAt: -1 })
//         .limit(remainingLimit)
//         .populate("relatedStories", "_id title summary imageUrl")
//         .lean();
//     }

//     const allPosts = [...pinnedPosts, ...regularPosts];
//     let nextCursor = null;
//     if (allPosts.length > 0 && allPosts.length >= limit) {
//       const lastPost = allPosts[allPosts.length - 1];
//       nextCursor = lastPost.publishedAt;
//     }

//     res.json({ status: "success", posts: allPosts, nextCursor });
//   } catch (err) {
//     console.error("Error in /api/curated-feed:", err);
//     res.status(500).json({ status: "error", message: err.message });
//   }
// });

// Pinned posts only endpoint
app.get("/api/curated-feed/pinned", async (req, res) => {
  try {
    const categories = req.query.categories
      ? req.query.categories.split(",").filter((c) => c)
      : [];
    // UPDATED: Accept multiple sources
    const sources = req.query.sources
      ? req.query.sources.split(",").filter((s) => s)
      : [];

    const filter = { isPublished: true, pinnedIndex: { $ne: null } };
    if (categories.length > 0) {
      filter.categories = { $in: categories };
    }
    // UPDATED: Use the $in operator for the sources array
    if (sources.length > 0) {
      filter.source = { $in: sources };
    }

    const pinnedPosts = await Post.find(filter)
      .sort({ pinnedIndex: "asc" })
      .populate("relatedStories", "_id title summary imageUrl url media")
      .lean();

    res.json({ status: "success", posts: pinnedPosts });
  } catch (err) {
    console.error("Error in /api/curated-feed/pinned:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Regular (non-pinned) posts only endpoint
app.get("/api/curated-feed/regular", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const categories = req.query.categories
      ? req.query.categories.split(",").filter((c) => c)
      : [];
    // UPDATED: Accept multiple sources
    const sources = req.query.sources
      ? req.query.sources.split(",").filter((s) => s)
      : [];
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null;

    const filter = { isPublished: true, pinnedIndex: { $eq: null } };
    if (categories.length > 0) {
      filter.categories = { $in: categories };
    }
    // UPDATED: Use the $in operator for the sources array
    if (sources.length > 0) {
      filter.source = { $in: sources };
    }
    if (cursor) {
      filter.publishedAt = { $lt: cursor };
    }

    const regularPosts = await Post.find(filter)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .populate("relatedStories", "_id title summary imageUrl")
      .lean();

    let nextCursor = null;
    if (regularPosts.length === limit) {
      nextCursor = regularPosts[regularPosts.length - 1].publishedAt;
    }

    res.json({ status: "success", posts: regularPosts, nextCursor });
  } catch (err) {
    console.error("Error in /api/curated-feed/regular:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});
// ✅ NEW: Guest User Creation & Token Registration Endpoint
app.post("/api/register-token", async (req, res) => {
  const { token, deviceId, categories } = req.body;

  console.log("req.body", req.body);

  if (!token || !deviceId) {
    return res
      .status(400)
      .json({ error: "FCM token and deviceId are required." });
  }

  try {
    let user = await FcmToken.findOne({ deviceId: deviceId });
    let wasCreated = false;

    if (user) {
      // Existing user, update their token and preferences
      user.token = token;
      if (categories) {
        user.subscribedCategories = categories;
      }
      await user.save();
      logger.info(`🔄 Guest user updated for deviceId: ${deviceId}`);
    } else {
      // This is a new device, create a new guest user profile
      user = await FcmToken.create({
        deviceId: deviceId,
        token: token,
        subscribedCategories: categories || [],
        userType: "guest",
      });
      wasCreated = true;
      logger.info(`✅ New guest user created for deviceId: ${deviceId}`);
    }
    console.log("user", user);
    res.status(wasCreated ? 201 : 200).json({
      message: wasCreated
        ? "New guest user created successfully."
        : "Guest user profile updated.",
      user: {
        deviceId: user.deviceId,
        userType: user.userType,
        subscribedCategories: user.subscribedCategories,
      },
    });
  } catch (error) {
    // Handle cases where the FCM token might already be in use by another deviceId (should be rare)
    if (error.code === 11000 && error.keyPattern && error.keyPattern.token) {
      return res.status(409).json({
        error: "This FCM token is already registered with another device.",
      });
    }
    logger.error("❌ Failed to register device:", error);
    res.status(500).json({ error: "Server error while registering device." });
  }
});

// ✅ NEW: Interaction tracking endpoint
app.post("/api/interactions", async (req, res) => {
  try {
    const { deviceId, postId, eventType, timeSpent } = req.body;
    if (!deviceId || !postId || !eventType) {
      return res
        .status(400)
        .json({ error: "deviceId, postId, and eventType are required." });
    }
    const postExists = await Post.findById(postId);
    if (!postExists) {
      return res.status(404).json({ error: "Post not found." });
    }
    const newInteraction = new UserInteraction({
      deviceId: deviceId,
      postId: postId,
      eventType: eventType,
      timeSpentOnPost: timeSpent,
    });
    await newInteraction.save();
    res.status(201).json({ status: "success", message: "Interaction logged." });
  } catch (err) {
    logger.error("❌ Error logging interaction:", err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to log interaction." });
  }
});

// ✅ NEW: Personalized "For You" feed endpoint
app.get("/api/feed/for-you", async (req, res) => {
  try {
    const { deviceId } = req.query;
    const limit = parseInt(req.query.limit) || 20;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required." });
    }

    const user = await FcmToken.findOne({ deviceId: deviceId }).lean();
    if (!user) {
      return res
        .status(404)
        .json({ error: "User profile not found for this device." });
    }

    const userVector = user.profileVector;
    // Cold Start: If the user has no vector, fall back to the generic curated feed
    if (!userVector || Object.keys(userVector).length === 0) {
      const fallbackPosts = await Post.find({
        isPublished: true,
        pinnedIndex: { $eq: null },
      })
        .sort({ publishedAt: -1 })
        .limit(limit)
        .populate("relatedStories", "_id title summary imageUrl")
        .lean();
      return res.json({
        status: "success",
        posts: fallbackPosts,
        personalization: "fallback",
      });
    }

    // Fetch recent posts to rank
    const candidatePosts = await Post.find({
      isPublished: true,
      publishedAt: {
        $gte: new Date(new Date().setDate(new Date().getDate() - 3)),
      },
    })
      .limit(300)
      .lean();

    const scoredPosts = candidatePosts.map((post) => {
      let personalizationScore = 0;
      if (post.categories) {
        post.categories.forEach((category) => {
          if (userVector[category]) {
            personalizationScore += userVector[category];
          }
        });
      }

      const hoursOld =
        (new Date() - new Date(post.publishedAt)) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 1 - hoursOld / 72);

      const relevanceScore = 0.7 * personalizationScore + 0.3 * recencyScore;

      return { ...post, relevanceScore };
    });

    const personalizedPosts = scoredPosts.sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    res.json({
      status: "success",
      posts: personalizedPosts.slice(0, limit),
      personalization: "active",
    });
  } catch (err) {
    logger.error("❌ Error generating personalized feed:", err);
    res.status(500).json({
      status: "error",
      message: "Could not generate personalized feed.",
    });
  }
});

app.get("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid Post ID format." });
    const post = await Post.findById(req.params.id)
      .populate("relatedStories", "_id title summary imageUrl")
      .lean();
    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({ status: "success", post });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch post", details: err.message });
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

    // ✅ MODIFIED: Run new logic after saving
    await sendNotificationForPost(newPost);
    await applyCategoryTags(newPost);
    // await updateRelatedStories(newPost);

    res.status(201).json({ status: "success", post: newPost });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to create post", details: err.message });
  }
});

app.get("/api/posts/search", async (req, res) => {
  try {
    const { q } = req.query; // Get the search query from the URL

    if (!q || q.trim() === "") {
      return res.json({ status: "success", posts: [] });
    }

    // Create a case-insensitive regular expression for searching
    const searchQuery = new RegExp(q, "i");

    // Find posts where the query matches in the title, summary, or tags array
    const posts = await Post.find({
      $or: [
        { title: searchQuery },
        { summary: searchQuery },
        { tags: searchQuery },
      ],
    })
      .limit(10) // Limit the number of results to keep it fast
      .select("title _id") // Only send back the fields we need
      .sort({ createdAt: -1 }); // Show newest results first

    res.json({ status: "success", posts });
  } catch (error) {
    console.error("Search error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Server error during search." });
  }
});

// ✅ REPLACED: This new update logic is more robust and consistent.
app.put("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid post ID" });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    req.body.tags = await findOrCreateTags(req.body.tags);
    Object.assign(post, req.body);

    await applyCategoryTags(post);
    const savedPost = await post.save();
    // await updateRelatedStories(savedPost);

    const finalPost = await Post.findById(req.params.id)
      .populate("relatedStories", "_id title")
      .populate("tags")
      .lean();
    res.json({ status: "success", post: finalPost });
  } catch (err) {
    logger.error("❌ Error updating post:", err);
    res
      .status(500)
      .json({ error: "Failed to update post", details: err.message });
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
    res
      .status(500)
      .json({ error: "Failed to delete post", details: err.message });
  }
});

app.post("/api/formatted-tweet", async (req, res) => {
  try {
    const { tweet_ids } = req.body;
    if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
      return res
        .status(400)
        .json({ error: "tweet_ids must be a non-empty array." });
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
        const existingPost = await Post.findOne({ tweetId: tweet.id });
        if (existingPost) {
          console.log(
            `↪️ Tweet ${tweet.id} already exists as post #${existingPost.postId}. Skipping.`
          );
          successfulPosts.push(existingPost);
          continue;
        }
        const geminiResult = await processWithGemini(tweet.text);
        console.log("geminiResult", geminiResult);
        const { categories, topCategory } = classifyArticle(
          `${geminiResult.title} ${geminiResult.summary}`
        );
        let selectedVideoUrl = null;
        const videoMedia = tweet.extendedEntities?.media?.find(
          (m) => m.type === "video" || m.type === "animated_gif"
        );
        if (videoMedia?.video_info?.variants) {
          const sortedVariants = videoMedia.video_info.variants
            .filter((v) => v.content_type === "video/mp4" && v.bitrate)
            .sort((a, b) => b.bitrate - a.bitrate);
          if (sortedVariants.length > 0) {
            const chosenVariant =
              sortedVariants.length > 1 ? sortedVariants[1] : sortedVariants[0];
            selectedVideoUrl = chosenVariant.url;
          }
        }
        const postData = {
          title: geminiResult.title,
          summary: geminiResult.summary,
          text: tweet.text,
          url: tweet.url,
          tweetId: tweet.id,
          twitterUrl: tweet.twitterUrl,
          source: "Twitter",
          sourceType: "tweet_api",
          publishedAt: new Date(),
          lang: tweet.lang,
          categories: categories,
          topCategory: topCategory,
          imageUrl: tweet.extendedEntities?.media?.[0]?.media_url_https || null,
          imageFit: "cover",
          videoUrl: selectedVideoUrl,

          media: (tweet.extendedEntities?.media || []).map((m) => ({
            type: m.type,
            url: m.media_url_https,
            altText: m.ext_alt_text || null,
            width: m.sizes?.large?.w || m.sizes?.medium?.w || 0,
            height: m.sizes?.large?.h || m.sizes?.medium?.h || 0,

            // ✨ ADDED: Explicitly set the overlayPosition to match the schema's default
            overlayPosition: "middle",

            variants:
              m.video_info?.variants
                ?.filter((v) => v.content_type === "video/mp4")
                .map((v) => ({ bitrate: v.bitrate || 0, url: v.url })) || [],
          })),
        };
        const newPost = new Post(postData);
        const savedPost = await newPost.save();
        console.log(
          `✅ New post #${savedPost.postId} from tweet ${tweet.id}. Triggering notification.`
        );

        await sendNotificationForPost(savedPost);
        await applyCategoryTags(savedPost);
        // await updateRelatedStories(savedPost);

        successfulPosts.push(savedPost);
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
      const { categories, topCategory } = classifyArticle(
        `${article.title || ""} ${article.summary || ""}`
      );
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

/**
 * GET /api/posts/by-source
 * Groups the most recent posts by their source.
 * @query {number} limit - The number of posts to return for each source. Defaults to 25.
 */
app.get("/api/posts/by-source", async (req, res) => {
  try {
    // 1. Parse the limit from query params, with a default and a maximum
    const limitPerSource = parseInt(req.query.limit, 10) || 25;
    if (limitPerSource > 100) {
      return res
        .status(400)
        .json({ status: "error", message: "Limit cannot exceed 100." });
    }

    console.log("limitPerSource", limitPerSource);

    // 2. Use MongoDB's Aggregation Pipeline for efficient grouping and sorting
    const aggregationResult = await Post.aggregate([
      // Stage 1: Sort all posts by creation date, newest first
      { $sort: { createdAt: -1 } },

      // Stage 2: Group posts by the 'source' field
      {
        $group: {
          _id: "$source", // The field to group by
          posts: { $push: "$$ROOT" }, // Push the entire post document into a 'posts' array
        },
      },

      // Stage 3: Project the fields to reshape the output
      {
        $project: {
          _id: 0, // Exclude the default _id field
          source: "$_id", // Rename _id (which is the source name) to 'source'
          // Take a slice of the posts array to apply the limit
          posts: { $slice: ["$posts", limitPerSource] },
        },
      },
    ]);

    // 3. Transform the aggregation result array into the desired key-value object format
    // From: [{ source: "SourceA", posts: [...] }, { source: "SourceB", posts: [...] }]
    // To:   { "SourceA": [...], "SourceB": [...] }
    const postsBySource = aggregationResult.reduce((acc, group) => {
      acc[group.source] = group.posts;
      return acc;
    }, {});

    // 4. Send the successful response
    res.status(200).json({
      status: "success",
      postsBySource: postsBySource,
    });
  } catch (error) {
    console.error("Error fetching posts by source:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

// 🚀 NEW ENDPOINT: Get a list of all unique source names
app.get("/api/sources", async (req, res) => {
  try {
    // Use 'distinct' to efficiently get an array of unique source values
    const sources = await Post.distinct("source");
    res.status(200).json({ status: "success", sources });
  } catch (error) {
    console.error("Error fetching sources:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

// 🚀 NEW ENDPOINT: Get paginated posts for a specific source
app.get("/api/posts/source/:sourceName", async (req, res) => {
  try {
    const { sourceName } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 15;
    const skip = (page - 1) * limit;

    // To check if there are more posts, we fetch one extra document than the limit
    const posts = await Post.find({ source: decodeURIComponent(sourceName) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1); // Fetch one extra

    // Determine if there are more posts to load
    const hasMore = posts.length > limit;

    // If we fetched an extra post, remove it from the response array
    if (hasMore) {
      posts.pop();
    }

    res.status(200).json({
      status: "success",
      posts: posts,
      hasMore: hasMore, // Send this boolean to the frontend
    });
  } catch (error) {
    console.error("Error fetching posts for source:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

// 🚀 NEW YOUTUBE VIDEO ENDPOINTS 🚀

/**
 * Saves a single video to the database, checking for duplicates.
 * @param {object} videoData - The video data to save.
 * @returns {boolean} - True if saved, false otherwise.
 */
async function saveVideo(videoData) {
  try {
    const existingVideo = await Video.findOne({ videoId: videoData.videoId });
    if (existingVideo) {
      return false; // Already exists
    }
    const newVideo = new Video(videoData);
    await newVideo.save();
    logger.info(
      `✅ Saved new video: "${videoData.title.slice(0, 40)}..." from ${
        videoData.author
      }`
    );
    return true;
  } catch (error) {
    if (error.code !== 11000) {
      // Ignore duplicate key errors, but log others
      logger.error(
        `Error saving video "${videoData.title.slice(0, 40)}...":`,
        error.message
      );
    }
    return false;
  }
}

/**
 * Fetches and processes all YouTube RSS feeds.
 */
/**
 * Fetches and processes all YouTube RSS feeds.
 */
async function fetchAllYouTubeSources() {
  logger.info("⏰ Starting YouTube RSS feed processing...");
  let newVideosCount = 0;

  const youtubeParser = new Parser({
    customFields: {
      item: [
        ["media:group", "mediaGroup"],
        ["yt:videoId", "videoId"],
      ],
    },
  });

  for (const source of YOUTUBE_RSS_SOURCES) {
    try {
      const feed = await youtubeParser.parseURL(source.url);

      for (const item of feed.items) {
        if (!item.videoId || !item.title) continue;

        const saved = await saveVideo({
          videoId: item.videoId,
          title: item.title,
          link: item.link,
          author: item.author,
          // MODIFIED: Use the new field name
          sourcePublishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          thumbnailUrl: item.mediaGroup?.["media:thumbnail"]?.[0]?.$?.url,
          description: item.mediaGroup?.["media:description"]?.[0],
          source: "youtube",
          category: source.category,
          // ✅ FIXED: Set default unpublished status
          isPublished: false,
        });

        if (saved) newVideosCount++;
      }
    } catch (error) {
      logger.error(
        `❌ Failed to fetch YouTube RSS feed from ${source.name}: ${error.message}`
      );
    }
  }
  logger.info(
    `✅ YouTube RSS fetching complete. Added ${newVideosCount} new videos.`
  );
  return newVideosCount;
}
/**
 * GET /api/fetch-youtube-videos
 * Manually triggers the process to fetch videos from all YouTube RSS feeds.
 */
app.get("/api/fetch-youtube-videos", async (req, res) => {
  try {
    const count = await fetchAllYouTubeSources();
    res.status(200).json({
      status: "success",
      message: "Manual YouTube videos fetch process initiated.",
      newVideosAdded: count,
    });
  } catch (error) {
    logger.error("Error in /api/fetch-youtube-videos:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

/**
 * 🚀 NEW: POST /api/fetch-single-youtube-channel
 * Fetches videos from a single YouTube RSS feed by channel ID or username.
 * Expects a body like: { "id": "your_channel_id", "type": "channel" }
 * or { "id": "your_username", "type": "user" }
 */
app.post("/api/fetch-single-youtube-channel", async (req, res) => {
  const { id, type = "user", category = "General" } = req.body; // Default type to 'user' for backward compatibility

  if (!id) {
    return res
      .status(400)
      .json({ status: "error", message: "Channel/User ID is required." });
  }

  // Construct the correct RSS feed URL based on the type
  const url =
    type === "channel"
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
      : `https://www.youtube.com/feeds/videos.xml?user=${id}`;

  logger.info(`Attempting to fetch single YouTube source: ${url}`);

  let newVideosCount = 0;
  const youtubeParser = new Parser({
    customFields: {
      item: [
        ["media:group", "mediaGroup"],
        ["yt:videoId", "videoId"],
      ],
    },
  });

  try {
    const feed = await youtubeParser.parseURL(url);

    for (const item of feed.items) {
      if (!item.videoId || !item.title) continue;

      const saved = await saveVideo({
        videoId: item.videoId,
        title: item.title,
        link: item.link,
        author: item.author,
        sourcePublishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        thumbnailUrl: item.mediaGroup?.["media:thumbnail"]?.[0]?.$?.url,
        description: item.mediaGroup?.["media:description"]?.[0],
        source: "youtube",
        category: category, // Assign a category, defaults to 'General'
        isPublished: false,
      });

      if (saved) newVideosCount++;
    }

    res.status(200).json({
      status: "success",
      message: `Fetch complete. Found and saved ${newVideosCount} new videos from '${feed.title}'.`,
      newVideosAdded: newVideosCount,
    });
  } catch (error) {
    logger.error(
      `❌ Failed to fetch single YouTube RSS feed from ${url}: ${error.message}`
    );
    res.status(500).json({
      status: "error",
      message:
        "Failed to fetch the RSS feed. Please check the ID and type and ensure the channel has a valid feed.",
    });
  }
});

/**
 * GET /api/videos (For Public Users)
 * Retrieves ONLY PUBLISHED videos, sorted by publish date.
 */
app.get("/api/videos", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    // ✅ MODIFIED: Filter now includes isPublished: true
    const filter = { isPublished: true };
    if (req.query.category) {
      filter.category = req.query.category;
    }

    const videos = await Video.find(filter)
      // ✅ MODIFIED: Sort by the actual publish date
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalVideos = await Video.countDocuments(filter);
    const totalPages = Math.ceil(totalVideos / limit);

    res.json({ status: "success", videos, page, totalPages, totalVideos });
  } catch (err) {
    logger.error("Error in /api/videos:", err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch videos." });
  }
});

/**
 * 🚀 NEW: GET /api/admin/videos (For Your Dashboard)
 * Retrieves all videos (published and unpublished) with filtering.
 */
/**
 * 🚀 NEW: GET /api/videos/sources
 * Retrieves a unique list of all video authors (sources).
 */
app.get("/api/videos/sources", async (req, res) => {
  try {
    // Use 'distinct' to efficiently get an array of unique author values
    const sources = await Video.distinct("author");
    res.json({ status: "success", sources: sources.filter((s) => s).sort() }); // Filter out any null/empty sources and sort them
  } catch (err) {
    logger.error("Error fetching video sources:", err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch video sources" });
  }
});

/**
 * 🚀 NEW: GET /api/youtube-sources
 * Provides the predefined list of YouTube RSS sources from the server configuration.
 */
app.get("/api/youtube-sources", (req, res) => {
  // YOUTUBE_RSS_SOURCES is the constant array defined at the top of your server.js
  if (YOUTUBE_RSS_SOURCES) {
    res.json({ status: "success", sources: YOUTUBE_RSS_SOURCES });
  } else {
    res
      .status(404)
      .json({ status: "error", message: "Source list not found on server." });
  }
});

/**
 * 🚀 UPDATED: GET /api/admin/videos (For Your Dashboard)
 * Now includes filtering by source (author). The sorting is already latest first.
 */
app.get("/api/admin/videos", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.category) {
      filter.category = req.query.category;
    }
    if (req.query.isPublished === "true") {
      filter.isPublished = true;
    } else if (req.query.isPublished === "false") {
      filter.isPublished = false;
    }
    // ✅ NEW: Handle source filtering
    if (req.query.source) {
      filter.author = req.query.source;
    }

    const videos = await Video.find(filter)
      .sort({ createdAt: -1 }) // Sorts by creation date, latest first
      .skip(skip)
      .limit(limit)
      .lean(); // .lean() is important for performance

    const totalVideos = await Video.countDocuments(filter);
    const totalPages = Math.ceil(totalVideos / limit);

    res.json({ status: "success", videos, page, totalPages, totalVideos });
  } catch (err) {
    logger.error("Error in /api/admin/videos:", err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch admin videos." });
  }
});
/**
 * PUT /api/video/:id (Enhanced Edit Endpoint)
 * Now automatically sets the publishedAt date when a video is published.
 */
app.put("/api/video/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid video ID format" });
    }

    const payload = { ...req.body };

    // ✅ PRO FEATURE: Automatically set publish date when isPublished becomes true
    if (payload.isPublished === true) {
      const video = await Video.findById(req.params.id);
      // Only set the date if it's being published for the first time
      if (video && !video.isPublished) {
        payload.publishedAt = new Date();
      }
    }

    const updatedVideo = await Video.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });

    if (!updatedVideo) {
      return res
        .status(404)
        .json({ status: "error", message: "Video not found" });
    }

    res.json({ status: "success", video: updatedVideo });
  } catch (err) {
    logger.error("Error updating video:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to update video",
      details: err.message,
    });
  }
});

/**
 * 🚀 NEW: POST /api/videos/bulk-action (For Your Dashboard)
 * Performs bulk actions (publish, unpublish, delete) on multiple videos.
 */
app.post("/api/videos/bulk-action", async (req, res) => {
  const { action, videoIds } = req.body;

  if (!action || !Array.isArray(videoIds) || videoIds.length === 0) {
    return res.status(400).json({
      status: "error",
      message: "Invalid action or videoIds provided.",
    });
  }

  try {
    let result;
    switch (action) {
      case "publish":
        result = await Video.updateMany(
          { _id: { $in: videoIds } },
          { $set: { isPublished: true, publishedAt: new Date() } }
        );
        break;
      case "unpublish":
        result = await Video.updateMany(
          { _id: { $in: videoIds } },
          { $set: { isPublished: false } }
        );
        break;
      case "delete":
        result = await Video.deleteMany({ _id: { $in: videoIds } });
        break;
      default:
        return res
          .status(400)
          .json({ status: "error", message: "Unknown action." });
    }

    res.json({
      status: "success",
      message: `Action '${action}' completed.`,
      details: result,
    });
  } catch (err) {
    logger.error(`Bulk action '${action}' failed:`, err);
    res.status(500).json({
      status: "error",
      message: `Failed to perform bulk action: ${action}`,
    });
  }
});
// 🚀 NEW: EDIT (PUT) endpoint for updating a single video
app.put("/api/video/:id", async (req, res) => {
  try {
    // Validate the MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid video ID format" });
    }

    const updatedVideo = await Video.findByIdAndUpdate(
      req.params.id,
      req.body, // The update data from the request body
      { new: true, runValidators: true } // Options: return the new version, run schema validation
    );

    if (!updatedVideo) {
      return res
        .status(404)
        .json({ status: "error", message: "Video not found" });
    }

    // Send the updated video object back in the response
    res.json({ status: "success", video: updatedVideo });
  } catch (err) {
    logger.error("Error updating video:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to update video",
      details: err.message,
    });
  }
});

// 🚀 NEW: DELETE endpoint for removing a single video
app.delete("/api/video/:id", async (req, res) => {
  try {
    // Validate the MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid video ID format" });
    }

    const deletedVideo = await Video.findByIdAndDelete(req.params.id);

    if (!deletedVideo) {
      return res
        .status(404)
        .json({ status: "error", message: "Video not found" });
    }

    res.json({ status: "success", message: "Video deleted successfully" });
  } catch (err) {
    logger.error("Error deleting video:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to delete video",
      details: err.message,
    });
  }
});

// =================================================================
// 7. START SERVER
// =================================================================
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
