// FILE: controllers/post.controller.js

import mongoose from "mongoose";
import Post from "../models/Post.model.js";
import { createPost, findOrCreateTags, applyCategoryTags, updateRelatedStories } from "../services/post.service.js";
import logger from "../utils/logger.js";

export const getPosts = async (req, res) => {
    // ... (logic from original app.get('/api/posts'))
};

export const createNewPost = async (req, res) => {
    try {
        const post = await createPost(req.body, 'manual');
        if (!post) {
            return res.status(409).json({ status: "error", message: "Post may already exist or failed to save." });
        }
        res.status(201).json({ status: "success", post });
    } catch (err) {
        logger.error("Failed to create post:", err);
        res.status(500).json({ error: "Failed to create post", details: err.message });
    }
};

export const updatePostById = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id))
            return res.status(400).json({ error: "Invalid post ID" });

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: "Post not found" });

        // Handle tags separately
        if (req.body.tags) {
            req.body.tags = await findOrCreateTags(req.body.tags);
        }
        
        Object.assign(post, req.body);
        
        // Re-apply auto-tags and update related stories after any change
        await applyCategoryTags(post);
        const savedPost = await post.save();
        await updateRelatedStories(savedPost);

        const finalPost = await Post.findById(req.params.id)
            .populate("relatedStories", "_id title")
            .populate("tags")
            .lean();
            
        res.json({ status: "success", post: finalPost });
    } catch (err) {
        logger.error("❌ Error updating post:", err);
        res.status(500).json({ error: "Failed to update post", details: err.message });
    }
};

// ... and so on for every other route handler ...