#!/usr/bin/env node
// Regenerates the "My Writings" list in README.md from the live Medium RSS
// feed. Medium doesn't expose clap/like counts via RSS or any public API,
// so pinned posts are hand-picked highlights that always lead the list;
// remaining slots fill in with the rest by recency.

import fs from "node:fs";

const FEED_URL = "https://medium.com/feed/@ryo.kusnadi";
const README_PATH = new URL("../README.md", import.meta.url);
const START_MARKER = "<!-- MY-WRITINGS:START -->";
const END_MARKER = "<!-- MY-WRITINGS:END -->";
const MAX_POSTS = 4;

// Curated highlights, shown first regardless of publish date.
const PINNED_POST_URLS = [
  "https://levelup.gitconnected.com/a-simple-guide-to-model-context-protocol-for-software-engineers-b48374176200",
  "https://levelup.gitconnected.com/structured-logging-in-go-1-21-b6713265787",
  "https://levelup.gitconnected.com/how-to-implement-harness-engineering-fe70c558bb7f",
  "https://levelup.gitconnected.com/agentic-ai-security-how-well-do-you-know-about-it-db877cab3312",
];

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`));
  if (!match) return "";
  return decodeEntities((match[1] ?? match[2] ?? "").trim());
}

async function fetchPosts() {
  const res = await fetch(FEED_URL);
  if (!res.ok) {
    throw new Error(`Medium feed fetch failed: ${res.status}`);
  }
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link").replace(/\?source=.*$/, ""),
    pubDate: extractTag(block, "pubDate"),
  }));
}

function pickPosts(posts) {
  const pinned = PINNED_POST_URLS.map((url) => posts.find((post) => post.link.startsWith(url))).filter(
    Boolean,
  );
  const pinnedLinks = new Set(pinned.map((post) => post.link));
  const rest = posts.filter((post) => !pinnedLinks.has(post.link));
  return [...pinned, ...rest].slice(0, MAX_POSTS);
}

function renderList(posts) {
  return posts.map((post) => `- [${post.title}](${post.link})`).join("\n");
}

async function main() {
  const posts = await fetchPosts();
  if (posts.length === 0) {
    console.error("No posts found in Medium feed, leaving README untouched");
    return;
  }

  const selected = pickPosts(posts);
  const list = renderList(selected);

  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("MY-WRITINGS markers not found in README.md");
  }

  const before = readme.slice(0, startIdx + START_MARKER.length);
  const after = readme.slice(endIdx);
  const updated = `${before}\n${list}\n${after}`;

  fs.writeFileSync(README_PATH, updated);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
