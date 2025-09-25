import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 5000;

/**
 * Uses ScrapingBee's dedicated Google Search engine to fetch and parse image results.
 * This is the most reliable method.
 * @param {string} query - The search term for the images.
 * @returns {Promise<Array<{imageUrl: string, thumbnailUrl: string, source: string, title: string}>>}
 */
async function searchImages(query) {
  const API_KEY = process.env.SCRAPINGBEE_API_KEY;
  if (!API_KEY) {
    throw new Error('SCRAPINGBEE_API_KEY is not defined in your .env file.');
  }

  try {
    // Make a request to ScrapingBee's API endpoint.
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: API_KEY,
        // ✅ THE FINAL FIX: Use the 'engine' parameter.
        // This is the most direct way to tell ScrapingBee what to do, avoiding conflicts.
        engine: 'google_images',
        q: query, // The search query itself.
      },
      // Increase timeout as image searches can take longer.
      timeout: 20000 
    });

    // Process the clean JSON response directly from the 'image_results' field.
    if (response.data && Array.isArray(response.data.image_results)) {
      // Map the API response to the format your app expects.
      return response.data.image_results.map(img => ({
        imageUrl: img.original || img.image,
        thumbnailUrl: img.thumbnail,
        title: img.title,
        source: img.source,
      }));
    }

    // Return an empty array if the API returns no results.
    return [];

  } catch (error) {
    // Provide a more detailed error message for easier debugging.
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Error fetching from ScrapingBee:', errorDetails);
    throw new Error('Failed to fetch image search results from the third-party API.');
  }
}

// --- API Endpoint (No changes needed here) ---
app.get('/search-images', async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'A "query" parameter is required.' });
  }

  try {
    const images = await searchImages(query);
    res.status(200).json(images);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});

