import express from "express";
import TwitterApiClient from "../twitterapi-client.js";
import Tweet from "../models/Tweet.js";

const router = express.Router();
const client = new TwitterApiClient("your_bearer_token");

// GET tweets by username
router.get("/:username", async (req, res) => {
  try {
    const { username } = req.params;

    // Check if tweets already exist in MongoDB
    let tweets = await Tweet.find({ userName: username }).sort({ published_at: -1 }).limit(10);

    if (tweets.length === 0) {
      // Fetch from Twitter API
      const response = await client.v2.userTimelineByUsername(username, { max_results: 5 });

      if (!response.data?.data) {
        return res.status(404).json({ error: "No tweets found" });
      }

      // Transform tweets
      const newTweets = response.data.data.map(tweet => {
        const id = tweet.id;
        return {
          id,
          userName: username,
          text: tweet.text,
          url: `https://x.com/${username}/status/${id}`,
          images: [], // extend if you want media
          published_at: new Date(tweet.created_at),
        };
      });

      // Save in MongoDB
      await Tweet.insertMany(newTweets, { ordered: false }).catch(() => {});

      tweets = newTweets;
    }

    res.json(tweets);
  } catch (err) {
    console.error("Error fetching tweets:", err.message);
    res.status(500).json({ error: "Failed to fetch tweets" });
  }
});

export default router;
