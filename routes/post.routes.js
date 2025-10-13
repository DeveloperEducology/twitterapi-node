// FILE: routes/post.routes.js

import { Router } from "express";
import * as postController from "../controllers/post.controller.js";

const router = Router();

router.get("/", postController.getPosts);
router.post("/", postController.createNewPost);
router.get("/search", postController.searchPosts);
router.get("/curated-feed", postController.getCuratedFeed);
router.get("/sources", postController.getPostSources);

router.get("/:id", postController.getPostById);
router.put("/:id", postController.updatePostById);
router.delete("/:id", postController.deletePostById);

export default router;