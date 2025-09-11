const { chromium } = require("playwright");
const { MongoClient } = require("mongodb");

const MONGO_URI = "mongodb://127.0.0.1:27017";
const DB_NAME = "twitterdb";
const COLLECTION = "tweets";

async function openPageWithRetry(page, url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🌐 Attempt ${attempt}: Opening ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(5000);
      console.log("✅ Page loaded");
      return true;
    } catch (err) {
      console.warn(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      console.log("🔁 Retrying...");
    }
  }
}

async function scrapeTweets(username) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();

  // Open Twitter profile
  await openPageWithRetry(page, `https://mobile.twitter.com/${username}`);

  // Scroll to load more tweets
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(3000);
  }

  // Extract tweets from DOM
  const tweets = await page.evaluate(() => {
    const tweetNodes = document.querySelectorAll("article");
    let data = [];
    tweetNodes.forEach((tweet) => {
      const text = tweet.innerText;
      const link = tweet.querySelector("a[href*='/status/']")?.href || null;
      const time = tweet.querySelector("time")?.getAttribute("datetime") || null;
      data.push({
        id: link ? link.split("/status/")[1] : null,
        text,
        link,
        time,
      });
    });
    return data;
  });

  await browser.close();
  return tweets;
}

async function saveToMongo(tweets) {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION);

  if (tweets.length > 0) {
    await collection.insertMany(tweets, { ordered: false }).catch(() => {});
    console.log(`✅ Saved ${tweets.length} tweets to MongoDB`);
  } else {
    console.log("⚠️ No tweets scraped.");
  }

  await client.close();
}

(async () => {
  const username = "bigtvtelugu"; // try ANI, NDTV, etc.
  const tweets = await scrapeTweets(username);
  console.log(`📥 Scraped ${tweets.length} tweets`);
  console.log(tweets.slice(0, 3)); // show first 3 for debug
  await saveToMongo(tweets);
})();
