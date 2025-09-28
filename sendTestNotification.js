// sendTestNotification.js
const { Expo } = require("expo-server-sdk");

// Create a new Expo SDK client
const expo = new Expo();

// 👈 Replace with your device's Expo push token
const testPushToken = "ExponentPushToken[9A-v4QGi8Dkx84lgjrStJl]";

async function sendTest() {
  // Check token validity
  if (!Expo.isExpoPushToken(testPushToken)) {
    throw new Error(`Invalid Expo push token: ${testPushToken}`);
  }

  const messages = [
    {
      to: testPushToken,
      sound: "default",
      priority: "high",
      title: "BREAKING: HYD",
      body: "🌧 భారీ వర్షం హెచ్చరిక — జాగ్రత్త!",
      data: { url: "/article/123", imageUrl: "https://yourcdn.com/news.jpg" },
      android: {
        channelId: "news", // 👈 must match RN channel
        color: "#FF6600", // orange strip like Way2News
        icon: "@drawable/notification_icon", // optional app small icon
        imageUrl: "https://yourcdn.com/news.jpg", // large image preview
      },
    },
  ];

  // Split into chunks (Expo requires this for many tokens)
  const chunks = expo.chunkPushNotifications(messages);

  for (let chunk of chunks) {
    try {
      let receipts = await expo.sendPushNotificationsAsync(chunk);
      console.log("Receipts:", receipts);
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }
}

sendTest();
