import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema({
  mediaType: String,
  url: String,
  _id: String,
});

const articleSchema = new mongoose.Schema(
  {
    title: String,
    summary: String,
    teluguTitle: String,
    teluguNews: String,
    url: String,
    source: String,
    isCreatedBy: { type: String, default: "twitter_scraper" },
    publishedAt: Date,
    media: [mediaSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Article", articleSchema);
