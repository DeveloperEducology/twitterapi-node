// FILE: config/index.js

import dotenv from "dotenv";
dotenv.config();

const config = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  MONGO_URI: process.env.MONGO_URI,
  PORT: process.env.PORT || 4000,
  SELF_URL: process.env.SERVER_URL || `https://twitterapi-node.onrender.com`,
  TWITTER_API_IO_KEY: process.env.TWITTER_API_KEY,
};

export default config;