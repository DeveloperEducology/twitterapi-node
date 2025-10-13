// FILE: routes/index.js

import { Router } from "express";
import postRoutes from "./post.routes.js";
import videoRoutes from "./video.routes.js";
import adminRoutes from "./admin.routes.js";
import imageRoutes from "./image.routes.js";
import tagRoutes from "./tag.routes.js";
import userRoutes from "./user.routes.js";

const router = Router();

router.use("/posts", postRoutes);
router.use("/videos", videoRoutes);
router.use("/admin", adminRoutes);
router.use("/images", imageRoutes);
router.use("/tags", tagRoutes);
router.use("/", userRoutes); // User routes like /register-token

export default router;