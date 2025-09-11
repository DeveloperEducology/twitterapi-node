import mongoose from "mongoose";

const tweetSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  text: String,
  url: String,
  images: [String],
  published_at: Date,
}, { timestamps: true });

export default mongoose.model("Tweet", tweetSchema);
