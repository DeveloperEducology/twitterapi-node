// FILE: utils/helpers.js

import * as cheerio from "cheerio";

export function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `https://${hostname}${pathname}`;
  } catch (error) {
    return urlString;
  }
}

export function containsTelugu(text) {
  if (!text) return false;
  return /[\u0C00-\u0C7F]/.test(text);
}

export function cleanHtmlContent(html) {
  if (!html) return "";
  return cheerio.load(html).text().replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, " ").trim();
}

export function extractImageFromItem(item) {
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image"))
    return item.enclosure.url;
  const content = item["content:encoded"] || item.content || "";
  return cheerio.load(content)("img").first().attr("src") || null;
}