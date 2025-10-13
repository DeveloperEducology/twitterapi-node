// FILE: models/Post.model.js

import mongoose from "mongoose";
import Counter from "./Counter.model.js";

const mediaSchema = new mongoose.Schema({
    type: { type: String, enum: ["photo", "video", "animated_gif"] },
    url: String,
    variants: [{ bitrate: Number, url: String }],
    width: Number,
    height: Number,
}, { _id: false });

const postSchema = new mongoose.Schema({
    postId: { type: Number, unique: true },
    title: { type: String, required: true, index: "text" },
    summary: { type: String, index: "text" },
    text: String,
    url: { type: String, unique: true, sparse: true },
    imageUrl: String,
    relatedStories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    source: String,
    sourceType: { type: String, enum: ["rss", "manual", "tweet_api"], required: true, default: "manual" },
    publishedAt: { type: Date, default: Date.now, index: true },
    lang: String,
    categories: [{ type: String, index: true }],
    topCategory: { type: String, index: true },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", index: true }],
    isPublished: { type: Boolean, default: true, index: true },
    media: [mediaSchema],
    videoUrl: String,
    isBreaking: { type: Boolean, default: false },
    type: { type: String, default: "normal_post" },
    scheduledFor: { type: Date, default: null },
    tweetId: { type: String, unique: true, sparse: true },
    twitterUrl: String,
    pinnedIndex: { type: Number, default: null, index: true },
}, { timestamps: true, collection: "posts" });

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
export default Post;

// --- You would create similar files for other models ---
// e.g., Video.model.js, Tag.model.js, FcmToken.model.js, etc.