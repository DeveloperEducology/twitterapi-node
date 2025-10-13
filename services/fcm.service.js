// FILE: services/fcm.service.js

import admin from "firebase-admin";
import FcmToken from "../models/FcmToken.model.js";
import logger from "../utils/logger.js";

export async function sendNotificationForPost(post) {
    // ... (logic from original sendNotificationForPost function)
}

export async function sendSingleNotification(token, payload) {
    // ... (logic from original sendSingleNotification function)
}

export async function sendGlobalNotification(payload) {
    // ... (logic from original sendGlobalNotification function)
}

// ... other FCM-related functions ...