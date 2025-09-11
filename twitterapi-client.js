// twitterapi-client.js
import axios from "axios";

export default class TwitterApiClient {
  constructor(apiKey, minDelay = 10000) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.twitterapi.io";
    this.minDelay = minDelay;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { "x-api-key": this.apiKey },
    });

    this.lastCall = 0;
  }

  async _throttle() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minDelay) {
      const waitTime = this.minDelay - elapsed;
      await new Promise((res) => setTimeout(res, waitTime));
    }
    this.lastCall = Date.now();
  }

  // ✅ method we need
  async getUserLastTweets(userName, count = 5, cursor = null) {
    await this._throttle();
    const res = await this.client.get("/twitter/user/last_tweets", {
      params: { userName, count, cursor },
    });
    return res.data;
  }
}
