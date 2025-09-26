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
  "https://telugu.hindustantimes.com/rss/sports",
  // { url: "https://www.ntnews.com/rss", name: "Namasthe Telangana" },
  // {
  //   url: "https://www.thehindu.com/news/national/feeder/default.rss",
  //   name: "The Hindu",
  // },
  { url: "https://feeds.feedburner.com/ndtvnews-latest", name: "NDTV News" },
];

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// =================================================================
// 2. MONGODB SETUP & MODELS
// =================================================================

// Define a simple sub-schema for media to be used within the Post schema
const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["photo", "video", "animated_gif"] },
    url: String, // For photos
    variants: [
      {
        bitrate: Number,
        url: String,
      },
    ], // For videos
    width: Number,
    height: Number,
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    // Core Content
    title: { type: String, required: true, index: "text" },
    summary: { type: String, index: "text" },
    text: String,
    url: { type: String, unique: true, sparse: true }, // sparse allows multiple docs to have null
    imageUrl: String,
    media: [mediaSchema],
    videoUrl: String,

    // ✅ 1. ADD THIS FIELD TO STORE RELATED STORIES
    // This creates an array of references to other documents within the 'Post' collection.
    relatedStories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],

    // Metadata
    source: String,
    sourceType: {
      type: String,
      enum: ["rss", "tweet_api", "manual", "youtube"],
      required: true,
      default: "manual"
    },
    publishedAt: { type: Date, default: Date.now, index: true },
    lang: String,
    isBreaking: { type: Boolean, default: false }, // ✅ ADD THIS LINE

    // Classification & Flags
    categories: [{ type: String, index: true }],
    topCategory: { type: String, index: true },
    isPublished: { type: Boolean, default: true, index: true },
    type: { type: String, default: "normal_post" },
    scheduledFor: { type: Date, default: null }, // ✅ ADD THIS LINE
    // Source-Specific Data
    tweetId: { type: String, unique: true, sparse: true },
    twitterUrl: String,
  },
  { timestamps: true, collection: "posts" }
);

// To improve performance of related stories lookup
postSchema.index({ categories: 1, publishedAt: -1 });

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

app.get("/api/classify-all", async (req, res) => {
  try {
    // Fetch only unclassified articles
    const articles = await Post.find({
      $or: [{ categories: { $exists: false } }, { categories: { $size: 0 } }],
    });

    let updated = 0;

    for (let article of articles) {
      try {
        const { categories, topCategory } = classifyArticle(
          `${article.title || ""} ${article.summary || ""} ${
            article.text || ""
          }`
        );

        if (categories.length > 0) {
          article.categories = categories;
          article.topCategory = topCategory;
          await article.save();
          updated++;
          console.log(
            `✅ Classified: "${article.title}" → [${categories.join(
              ", "
            )}] (Top: ${topCategory})`
          );
        } else {
          console.log(`⚠️ No match for: "${article.title}"`);
        }
      } catch (err) {
        console.error(`❌ Error classifying: "${article.title}"`, err);
      }
    }

    res.json({
      message: "Classification complete",
      totalChecked: articles.length,
      updated,
    });
  } catch (err) {
    console.error("🔥 Error in classify-all:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});
// Classification function
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
      "stadium",
      "match",
      "tournament",
      "league",
      "goal",
      "bat",
      "ball",
      "wicket",
      "umpire",
      "captain",
      "క్రికెట్",
      "ఫుట్‌బాల్",
      "టెన్నిస్",
      "హాకీ",
      "బ్యాడ్మింటన్",
      "కబడ్డీ",
      "ఐపీఎల్",
      "వరల్డ్ కప్",
      "మ్యాచ్",
      "ఆట",
      "జట్టు",
      "ప్లేయర్",
      "ప్రేక్షకులు",
    ],

    Entertainment: [
      "movie",
      "cinema",
      "film",
      "actor",
      "actress",
      "hero",
      "heroine",
      "star",
      "celebrity",
      "director",
      "producer",
      "music",
      "song",
      "album",
      "trailer",
      "teaser",
      "box office",
      "Tollywood",
      "Bollywood",
      "Hollywood",
      "web series",
      "OTT",
      "award",
      "shooting",
      "release",
      "blockbuster",
      "flop",
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
      "హిట్",
      "ఫ్లాప్",
      "టాలీవుడ్",
      "బాలీవుడ్",
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
      "prime minister modi",
      "నరేంద్ర మోదీ",
      "amit shah",
      "rahul gandhi",
      "sonia gandhi",
      "priyanka gandhi",
      "arvind kejriwal",
      "mamata banerjee",
      "nitish kumar",
      "droupadi murmu",
      "president murmu",
      "ద్రౌపది ముర్ము",
      "justice chandrachud",
      "chief justice",
      "revanth reddy",
      "kcr",
      "ktr",
      "asaduddin owaisi",
      "jagan reddy",
      "chandrababu naidu",
      "pawan kalyan",
      "nara lokesh",
      "ys rajasekhara reddy",
      "nt rama rao",
      "atal bihari vajpayee",
      "indira gandhi",
      "rajiv gandhi",
      "manmohan singh",
      "nehru",
      "abdul kalam",
      "ఎన్నికలు",
      "ఓటు",
      "మంత్రి",
      "ప్రభుత్వం",
      "పార్టీ",
      "ఎమ్మెల్యే",
      "ఎంపీ",
    ],

    National: [
      "india",
      "bharat",
      "delhi",
      "mumbai",
      "chennai",
      "kolkata",
      "bangalore",
      "supreme court",
      "high court",
      "constitution",
      "army",
      "navy",
      "air force",
      "economy",
      "inflation",
      "reserve bank",
      "isro",
      "science",
      "technology",
      "farmers",
      "youth",
      "culture",
      "festival",
      "strike",
      "protest",
      "భారతదేశం",
      "జాతీయ",
      "స్వాతంత్ర్యం",
      "గణతంత్ర",
      "సైన్యం",
      "సుప్రీం కోర్ట్",
    ],

    International: [
      "world",
      "global",
      "international",
      "foreign",
      "usa",
      "america",
      "china",
      "pakistan",
      "russia",
      "uk",
      "france",
      "germany",
      "italy",
      "japan",
      "korea",
      "australia",
      "canada",
      "un",
      "united nations",
      "war",
      "peace",
      "summit",
      "diplomacy",
      "terrorism",
      "ప్రపంచం",
      "అంతర్జాతీయ",
      "అమెరికా",
      "చైనా",
      "పాకిస్తాన్",
      "రష్యా",
      "జర్మనీ",
      "జపాన్",
    ],

    Telangana: [
      "telangana",
      "hyderabad",
      "warangal",
      "karimnagar",
      "nizamabad",
      "revanth reddy",
      "kcr",
      "ktr",
      "asaduddin owaisi",
      "prof jayashankar",
      "తెలంగాణ",
      "హైదరాబాద్",
      "చార్మినార్",
      "ఒస్మానియా",
      "వారంగల్",
      "నిజామాబాద్",
    ],

    AndhraPradesh: [
      "andhra pradesh",
      "amaravati",
      "vizag",
      "visakhapatnam",
      "vijayawada",
      "tirupati",
      "jagan reddy",
      "chandrababu naidu",
      "nara lokesh",
      "pawan kalyan",
      "ys rajasekhara reddy",
      "nt rama rao",
      "ఆంధ్రప్రదేశ్",
      "అమరావతి",
      "విశాఖపట్నం",
      "విజయవాడ",
      "తిరుపతి",
      "జగన్",
      "చంద్రబాబు",
    ],

    Crime: [
      "crime",
      "murder",
      "theft",
      "robbery",
      "rape",
      "scam",
      "fraud",
      "corruption",
      "kidnap",
      "police",
      "court",
      "cbi",
      "charge sheet",
      "trial",
      "verdict",
      "violence",
      "riot",
      "hatya",
      "dharunam",
      "ghoram",
      "chi chi",
      "atrocity",
      "molestation",
      "assault",
      "నేరం",
      "హత్య",
      "దొంగతనం",
      "దోపిడీ",
      "బలాత్కారం",
      "మోసం",
      "అపహరణ",
      "దారుణం",
      "ఘోరం",
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
      "software",
      "hardware",
      "app",
      "laptop",
      "pc",
      "internet",
      "wifi",
      "5g",
      "cloud",
      "robot",
      "startup",
      "blockchain",
      "crypto",
      "సాంకేతికత",
      "టెక్నాలజీ",
      "గాడ్జెట్",
      "మొబైల్",
      "స్మార్ట్‌ఫోన్",
      "కంప్యూటర్",
      "అప్లికేషన్",
      "ఇంటర్నెట్",
      "క్లౌడ్",
    ],

    Education: [
      "education",
      "school",
      "college",
      "university",
      "exam",
      "results",
      "marks",
      "rank",
      "jee",
      "neet",
      "ssc",
      "cbse",
      "icse",
      "ts board",
      "ap board",
      "inter",
      "degree",
      "students",
      "teachers",
      "scholarship",
      "online classes",
      "విద్య",
      "పాఠశాల",
      "కళాశాల",
      "విశ్వవిద్యాలయం",
      "పరీక్ష",
      "ఫలితాలు",
      "మార్కులు",
      "విద్యార్థులు",
      "ఉపాధ్యాయులు",
    ],

    Jobs: [
      "jobs",
      "employment",
      "unemployment",
      "vacancy",
      "government job",
      "private job",
      "recruitment",
      "interview",
      "hiring",
      "placement",
      "salary",
      "internship",
      "career",
      "job fair",
      "psc",
      "upsc",
      "tspsc",
      "appsc",
      "railway jobs",
      "bank jobs",
      "ఉద్యోగాలు",
      "ఉద్యోగం",
      "నియామకం",
      "ప్రభుత్వ ఉద్యోగం",
      "ప్రైవేట్ ఉద్యోగం",
      "జీతం",
      "ఇంటర్వ్యూ",
      "కెరీర్",
    ],

    Viral: [
      "viral",
      "trending",
      "trend",
      "meme",
      "funny",
      "comedy",
      "challenge",
      "dance",
      "song",
      "video",
      "youtube",
      "instagram reel",
      "tiktok",
      "shorts",
      "share",
      "whatsapp forward",
      "breaking",
      "వైరల్",
      "ట్రెండింగ్",
      "వీడియో",
      "మీమ్",
      "ఫన్నీ",
      "నవ్వు",
      "డ్యాన్స్",
      "సాంగ్",
    ],

    Lifestyle: [
      "lifestyle",
      "fashion",
      "style",
      "health",
      "fitness",
      "diet",
      "yoga",
      "gym",
      "travel",
      "food",
      "recipe",
      "restaurant",
      "shopping",
      "beauty",
      "makeup",
      "hair",
      "skin",
      "festival",
      "wedding",
      "party",
      "relationship",
      "love",
      "marriage",
      "parenting",
      "జీవనశైలి",
      "ఫ్యాషన్",
      "ఆరోగ్యం",
      "ఆహారం",
      "ప్రయాణం",
      "బ్యూటీ",
      "వివాహం",
      "పెళ్లి",
      "ప్రేమ",
      "అందం",
      "ముఖసౌందర్యం",
      "జుట్టు",
    ],

    Spiritual: [
      "spiritual",
      "religion",
      "god",
      "goddess",
      "temple",
      "church",
      "mosque",
      "puja",
      "prayer",
      "festival",
      "diwali",
      "holi",
      "dasara",
      "ugadi",
      "vinayaka chavithi",
      "ramzan",
      "eid",
      "bakrid",
      "christmas",
      "good friday",
      "sankranti",
      "pongal",
      "navaratri",
      "shivaratri",
      "janmashtami",
      "ayodhya",
      "tirupati",
      "tirumala",
      "kanaka durga",
      "srisailam",
      "yadadri",
      "meenakshi temple",
      "allah",
      "jesus",
      "bible",
      "quran",
      "bhagavad gita",
      "ఆధ్యాత్మిక",
      "మతం",
      "దేవుడు",
      "దేవాలయం",
      "చర్చ్",
      "మసీదు",
      "పూజ",
      "ప్రార్థన",
      "దీపావళి",
      "హోళీ",
      "దసరా",
      "ఉగాది",
      "వినాయక చవితి",
      "రమజాన్",
      "ఈద్",
      "బక్రీద్",
      "క్రిస్మస్",
      "సంక్రాంతి",
      "పొంగల్",
      "నవరాత్రి",
      "శివరాత్రి",
      "జన్మాష్టమి",
      "తిరుపతి",
      "యాదాద్రి",
      "దుర్గమ్మ గుడి",
      "శ్రీశైలం",
      "అయోధ్య",
      "భగవద్గీత",
      "ఖురాన్",
      "బైబిల్",
      "నవపంచమ రాజయోగం",
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

async function sendTargetedNotification({ title, body, category, data }) {
  try {
    const savedTokens = await ExpoPushToken.find({
      subscribedCategories: category,
    });
    const pushTokens = savedTokens.map((t) => t.token);
    if (pushTokens.length === 0) return;

    let messages = [];
    for (let pushToken of pushTokens) {
      if (Expo.isExpoPushToken(pushToken)) {
        messages.push({
          to: pushToken,
          sound: "default",
          title: `[${category}] ${title}`,
          body: body,
          data: data || {},
        });
      }
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error(
      `Error sending notification for category '${category}':`,
      error
    );
  }
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

// ✅ ===============================================================
// ✅ START: NEW & CORRECTED ENDPOINTS FOR ADMIN DASHBOARD
// ✅ ===============================================================

// ✅ ADD THIS NEW ENDPOINT to your server.js to fetch all unique sources
app.get("/api/sources", async (req, res) => {
  try {
    // Use .distinct() to get a unique array of all 'source' fields
    const sources = await Post.distinct("source");
    // Filter out any null or empty string sources before sending
    res.json({ status: "success", sources: sources.filter((s) => s) });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch sources", details: err.message });
  }
});

// ✅ REPLACE your existing /api/posts endpoint with this updated version
app.get("/api/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // --- Build the filter object from query parameters ---
    const filter = {};
    if (req.query.source) {
      filter.source = req.query.source;
    }
    if (req.query.category) {
      // This query finds documents where the 'categories' array contains the specified category
      filter.categories = req.query.category;
    }

    // Use the filter object in both the .find() and .countDocuments() calls
    const posts = await Post.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalPosts = await Post.countDocuments(filter);
    const totalPages = Math.ceil(totalPosts / limit);

    res.json({
      status: "success",
      posts,
      page,
      totalPages,
      totalPosts,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});
// GET A SINGLE POST BY ID (Unchanged, but good to have here)
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

// CREATE A NEW POST (FOR ADMIN DASHBOARD)
// ✅ ADD THIS ENDPOINT TO CREATE A NEW POST
app.post("/api/post", async (req, res) => {
  console.log(req.body);
  try {
    // Create a new Post document using the data from the request body
    const newPost = new Post(req.body);

    // Save the new document to the database
    await newPost.save();

    // Send a success response with the newly created post
    res.status(201).json({ status: "success", post: newPost });
  } catch (err) {
    // If an error occurs (e.g., validation fails, database error)
    console.error("❌ Error Creating Post:", err.message);
    res
      .status(500)
      .json({ error: "Failed to create post", details: err.message });
  }
});

// UPDATE A POST BY ID (Corrected for Dashboard)
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

// DELETE A POST BY ID (Corrected for Dashboard)
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

// ✅ ===============================================================
// ✅ END: NEW & CORRECTED ENDPOINTS FOR ADMIN DASHBOARD
// ✅ ===============================================================

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
    // --- Step 1: Log the incoming request query from the URL ---
    console.log("-----------------------------------------");
    console.log("Incoming req.query:", req.query);

    const limit = parseInt(req.query.limit) || 20;
    const categories = req.query.categories
      ? req.query.categories.split(",").map((c) => c.trim())
      : [];
    const cursor = req.query.cursor ? new Date(req.query.cursor) : new Date();
    const source = req.query.source;
    console.log(source, categories, cursor);

    // Check if the provided cursor is a valid date
    if (isNaN(cursor.getTime())) {
      console.error("Invalid cursor date provided:", req.query.cursor);
      return res.status(400).json({
        status: "error",
        message: "Invalid cursor format. Please use a valid ISO date string.",
      });
    }

    // --- Step 2: Build the query object ---
    const query = { isPublished: true, publishedAt: { $lt: cursor } };

    if (categories.length > 0) {
      query.categories = { $in: categories };
    }

    if (source) {
      // Use a case-insensitive regex for better matching
      query.source = { $regex: `^${source}$`, $options: "i" };
    }

    // --- Step 3: NEW - Check for matches before applying the date filter ---
    const preDateQuery = { ...query };
    delete preDateQuery.publishedAt; // Temporarily remove date to see if other filters match

    const matchingDocsCount = await Post.countDocuments(preDateQuery);
    console.log(
      `Pre-check: Found ${matchingDocsCount} documents matching source/category before applying the date filter.`
    );

    // --- Step 4: Log the final query that will be sent to MongoDB ---
    console.log("Final MongoDB Query:", JSON.stringify(query, null, 2));

    // ✅ MODIFICATION: Added .populate() to fetch related story details
    const posts = await Post.find(query)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .populate("relatedStories", "_id title summary imageUrl") // Populate with essential fields
      .lean();

    // --- Step 5: Log the result ---
    console.log(
      `Final Result: Found ${posts.length} posts after applying all filters.`
    );
    console.log("-----------------------------------------");

    let nextCursor = null;
    if (posts.length === limit) {
      nextCursor = posts[posts.length - 1].publishedAt;
    }

    res.json({ status: "success", posts, nextCursor });
  } catch (err) {
    console.error("💥 Error in /api/curated-feed:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Find this endpoint in your server.js
app.get("/api/post/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid Post ID format." });
    }
    // ✅ CHANGE THIS LINE
    const post = await Post.findById(req.params.id)
      .populate("relatedStories", "_id title") // Populate with _id and title
      .lean();

    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({ status: "success", post });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch post", details: err.message });
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

// Searches for posts by title and summary
app.get("/api/posts/search", async (req, res) => {
  try {
    const searchQuery = req.query.q;
    console.log(searchQuery);
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
