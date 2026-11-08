#!/usr/bin/env node
// Regenerates the "My Writings" section in README.md from the live Medium RSS
// feed: featured posts as cover-image cards, the rest in a collapsible list.
//
// Medium doesn't expose clap/like counts via RSS or any public API, so the
// featured posts are hand-picked (PINNED_POST_URLS), topped up by recency.

import fs from "node:fs";

const PROFILE_URL = "https://medium.com/@ryo.kusnadi";
const FEED_URL = "https://medium.com/feed/@ryo.kusnadi";
const README_PATH = new URL("../README.md", import.meta.url);
const START_MARKER = "<!-- MY-WRITINGS:START -->";
const END_MARKER = "<!-- MY-WRITINGS:END -->";
const FEATURED_COUNT = 1; // only the top article is shown
const WORDS_PER_MINUTE = 265; // what Medium uses for its read-time estimate
const COVER_SIZE = "800:420"; // Medium's CDN crops covers so cards line up

// The one article shown (the most-clapped; Medium has no API for claps).
const PINNED_POST_URLS = [
  "https://levelup.gitconnected.com/a-simple-guide-to-model-context-protocol-for-software-engineers-b48374176200",
];

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`));
  if (!match) return "";
  return decodeEntities((match[1] ?? match[2] ?? "").trim());
}

function extractAll(block, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "g");
  return [...block.matchAll(re)].map((m) => decodeEntities((m[1] ?? m[2] ?? "").trim()));
}

// Rewrites a Medium image URL (cdn-images-1.medium.com/max/1024/<id>) to a
// fixed-size crop, so every card's cover has the same shape.
function coverUrl(src) {
  const id = src?.match(/medium\.com\/(?:max\/\d+\/|v2\/[^/]+\/)?(.+)$/)?.[1];
  return id ? `https://miro.medium.com/v2/resize:fill:${COVER_SIZE}/${id}` : null;
}

async function fetchPosts() {
  const res = await fetch(FEED_URL);
  if (!res.ok) {
    throw new Error(`Medium feed fetch failed: ${res.status}`);
  }
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.map((block) => {
    const content = extractTag(block, "content:encoded");
    const words = decodeEntities(content.replace(/<[^>]+>/g, " ")).split(/\s+/).filter(Boolean).length;
    return {
      title: extractTag(block, "title"),
      link: extractTag(block, "link").replace(/\?source=.*$/, ""),
      date: new Date(extractTag(block, "pubDate")),
      tags: extractAll(block, "category").slice(0, 3),
      minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
      cover: coverUrl(content.match(/<img[^>]+src="([^"]+)"/)?.[1]),
    };
  });
}

function pickFeatured(posts) {
  const pinned = PINNED_POST_URLS.map((url) => posts.find((post) => post.link.startsWith(url))).filter(Boolean);
  const pinnedLinks = new Set(pinned.map((post) => post.link));
  const rest = posts.filter((post) => !pinnedLinks.has(post.link));
  const featured = [...pinned, ...rest].slice(0, FEATURED_COUNT);
  const featuredLinks = new Set(featured.map((post) => post.link));
  return { featured, more: posts.filter((post) => !featuredLinks.has(post.link)) };
}

const fmtDate = (date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const escHtml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function renderCard(post) {
  const title = escHtml(post.title);
  const tags = post.tags.length ? `<br>\n<sub>${post.tags.map((t) => `<code>#${escHtml(t)}</code>`).join(" ")}</sub>` : "";
  const cover = post.cover
    ? `<a href="${post.link}" title="${title}"><img src="${post.cover}" width="100%" alt="${title}" /></a>\n`
    : "";
  return `<td width="50%" valign="top">
${cover}<a href="${post.link}"><b>${title}</b></a><br>
<sub>📅 ${fmtDate(post.date)} · ⏱️ ${post.minutes} min read</sub>${tags}
</td>`;
}

function renderSection({ featured }) {
  const rows = [];
  for (let i = 0; i < featured.length; i += 2) {
    rows.push(`<tr>\n${featured.slice(i, i + 2).map(renderCard).join("\n")}\n</tr>`);
  }

  return `<table>
${rows.join("\n")}
</table>

<p align="center"><a href="${PROFILE_URL}"><b>Read everything on Medium →</b></a></p>`;
}

async function main() {
  const posts = await fetchPosts();
  if (posts.length === 0) {
    console.error("No posts found in Medium feed, leaving README untouched");
    return;
  }

  const section = renderSection(pickFeatured(posts));

  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("MY-WRITINGS markers not found in README.md");
  }

  const before = readme.slice(0, startIdx + START_MARKER.length);
  const after = readme.slice(endIdx);
  fs.writeFileSync(README_PATH, `${before}\n${section}\n${after}`);
  console.log(`Wrote ${posts.length} posts into My Writings.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
