// FILE: services/post.service.js
import Post from '../models/Post.model.js';
import Tag from '../models/Tag.model.js';
import { CATEGORY_TAG_MAP, ARTICLE_CLASSIFICATION_KEYWORDS } from '../utils/constants.js';
import logger from '../utils/logger.js';
import { sendNotificationForPost } from './fcm.service.js';

export function classifyArticle(text) {
    // ... logic from original classifyArticle function
}

export async function findOrCreateTags(tagNames = []) {
    // ... logic from original findOrCreateTags function
}

export async function applyCategoryTags(post) {
    // ... logic from original applyCategoryTags function
}

export async function updateRelatedStories(post) {
    // ... logic from original updateRelatedStories function
}

export async function createPost(postData, sourceType = 'manual') {
    const { categories, topCategory } = classifyArticle(
        postData.title + " " + (postData.summary || "")
    );

    const newPostData = {
        ...postData,
        sourceType,
        categories,
        topCategory,
        publishedAt: postData.publishedAt || new Date(),
    };
    
    // Ensure imageUrl is set from media if not present
    newPostData.imageUrl = newPostData.imageUrl || newPostData.media?.[0]?.url || null;

    try {
        if (newPostData.url) {
             const existingPost = await Post.findOne({ url: newPostData.url });
             if (existingPost) return null; // Post already exists
        }

        const newPost = new Post(newPostData);
        const savedPost = await newPost.save();
        logger.info(`✅ Saved new post #${savedPost.postId}: "${savedPost.title.slice(0, 30)}..." from ${savedPost.source}`);

        // Post-save hooks
        await sendNotificationForPost(savedPost);
        await applyCategoryTags(savedPost);
        await updateRelatedStories(savedPost);

        return savedPost;
    } catch (error) {
        if (error.code !== 11000) { // Ignore duplicate key errors
            logger.error(`Error saving post "${newPostData.title.slice(0, 30)}...":`, error.message);
        }
        return null;
    }
}