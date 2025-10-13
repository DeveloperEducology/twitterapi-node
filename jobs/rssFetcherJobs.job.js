// FILE: jobs/rssFetcher.job.js

import cron from "node-cron";
import Parser from "rss-parser";
import { RSS_SOURCES } from "../utils/constants.js";
import { normalizeUrl, cleanHtmlContent, extractImageFromItem, containsTelugu } from "../utils/helpers.js";
import { createPost } from "../services/post.service.js";
import logger from "../utils/logger.js";

const parser = new Parser();

const fetchAllNewsSources = async () => {
  logger.info("⏰ Cron: Starting RSS feed processing...");
  let newPostsCount = 0;

  for (const source of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items) {
        if (!item.link || !item.title) continue;

        const postData = {
          title: item.title,
          summary: cleanHtmlContent(item.contentSnippet || item.description || ""),
          text: cleanHtmlContent(item.content || ""),
          url: normalizeUrl(item.link),
          source: source.name,
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          imageUrl: extractImageFromItem(item),
          lang: containsTelugu(item.title) ? "te" : "en",
        };
        
        const savedPost = await createPost(postData, 'rss');
        if (savedPost) newPostsCount++;
      }
    } catch (error) {
      logger.error(`❌ Failed to fetch RSS feed from ${source.name}: ${error.message}`);
    }
  }
  logger.info(`✅ Cron: RSS fetching complete. Added ${newPostsCount} new posts.`);
};

// Schedule to run every 30 minutes
cron.schedule("*/30 * * * *", fetchAllNewsSources);

// Also export for manual triggering if needed
export default fetchAllNewsSources;