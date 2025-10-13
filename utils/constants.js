// FILE: utils/constants.js

export const RSS_SOURCES = [
  // 📰 Major Telugu News Channels
  { url: "https://ntvtelugu.com/feed", name: "NTV Telugu", category: "News" },
  { url: "https://tv9telugu.com/feed", name: "TV9 Telugu", category: "News" },
  { url: "https://10tv.in/latest/feed", name: "10TV Telugu", category: "News" },
  { url: "https://telugustop.com/feed/", name: "TeluguStop", category: "News" },
  { url: "https://www.teluguone.com/news/rssDetails.rss", name: "TeluguOne", category: "News" },
  // ... (add all other RSS sources here)
];

export const YOUTUBE_RSS_SOURCES = [
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCmqfX0S3x0I3uwLkPdpX03w", name: "Star Sports", category: "News", type: "youtube" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCPXTXMecYqnRKNdqdVOGSFg", name: "Tv9", category: "Tel", type: "youtube" },
  // ... (add all other YouTube sources here)
];

export const CATEGORY_TAG_MAP = {
  Sports: ["cricket", "ipl", "football", "t20", "virat kohli", "rohit sharma", "world cup"],
  Entertainment: ["tollywood", "bollywood", "salaar", "prabhas", "review", "allu arjun", "mahesh babu", "jr ntr"],
  Politics: ["election", "parliament", "narendra modi", "revanth reddy", "jagan reddy", "chandrababu naidu"],
  Technology: ["iphone", "android", "google", "samsung", "ai", "meta", "whatsapp"],
};

export const ARTICLE_CLASSIFICATION_KEYWORDS = {
  Sports: ["cricket", "football", "tennis", "ipl", "sports", "hockey", "badminton", "kabaddi", "olympics", "t20", "odi", "world cup", "match", "tournament", "league", "goal", "క్రికెట్", "ఫుట్‌బాల్", "టెన్నిస్", "హాకీ", "బ్యాడ్మింటన్", "కబడ్డీ", "ఐపీఎల్", "వరల్డ్ కప్", "మ్యాచ్"],
  Entertainment: ["movie", "cinema", "film", "actor", "actress", "celebrity", "director", "music", "song", "trailer", "teaser", "box office", "Tollywood", "Bollywood", "Hollywood", "web series", "OTT", "సినిమా", "చిత్రం", "నటుడు", "నటి", "హీరో", "హీరోయిన్", "దర్శకుడు", "సంగీతం", "పాట", "ట్రైలర్"],
  // ... (add all other classification keywords here)
};