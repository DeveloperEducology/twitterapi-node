// server.js
const express = require('express');
const admin = require('firebase-admin');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.post('/send-notification', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).send({ error: 'FCM token is required.' });
  }

  // --- Construct the "Data-Only" Message ---
  // NOTICE: There is NO "notification" object here.
  const message = {
    data: {
      // All visible content is now inside the data payload
      title: 'Jr.NTR దేవర-2పై బిగ్ అప్డేట్',
      body: 'సినిమాపై తాజా సమాచారం కోసం ఇక్కడ నొక్కండి.',
      imageUrl: 'https://images.hindustantimes.com/tech/img/2023/08/21/1600x900/NTR_Jr_1692629759627_1692629759814.jpg',
      
      // The URL for deep-linking remains the same
      url: 'post/devara-2-update-456',
    },
    token: "f_0lP9HTQeOek5zE4-7Kc9:APA91bGVV4Vcls-mLtLpWO6gTo7MrQH2pROEaOQBfTTzDtq3uclENL622zUEjeglEf7QLJm37NvhHWvCEj3fJcyonpyM7FrqBqdb93S2ghmeLJk3jwT02Yw",
    // --- Add Android specific options for high priority ---
    android: {
      priority: 'high',
    },
    // --- Add APNs (Apple) specific options for high priority ---
    apns: {
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
      headers: {
        'apns-priority': '10', // Can be 5 (normal) or 10 (high)
      },
    },
  };

  admin.messaging().send(message)
    .then(response => {
      console.log('Successfully sent data-only message:', response);
      res.status(200).send({ success: true, messageId: response });
    })
    .catch(error => {
      console.error('Error sending data-only message:', error);
      res.status(500).send({ error: 'Failed to send notification.', details: error.message });
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

