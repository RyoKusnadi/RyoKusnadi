#!/usr/bin/env node
// Turns the single trophy.svg strip rendered by github-profile-trophy into
// one animated SVG per trophy (so each can be its own link with a tooltip),
// and regenerates the "GitHub Achievements" README section, including a
// collapsible "How the ranks work" table.
//
// GitHub renders README SVGs as plain <img>s: no JavaScript or hover inside
// the image, but CSS animations do play. So the interactivity comes from
// animation inside each card, plus links, title tooltips and <details> in
// the README.
//
// Usage: node scripts/enhance-trophies.mjs [path/to/trophy.svg]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USERNAME = "RyoKusnadi";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] ?? path.join(ROOT, "trophy.svg"));
const OUT_DIR = path.join(ROOT, "assets", "trophies");
const README_PATH = path.join(ROOT, "README.md");
const START_MARKER = "<!-- TROPHIES:START -->";
const END_MARKER = "<!-- TROPHIES:END -->";
const CARD_WIDTH = 92; // display width in the README (cards are 115x115)

// Lowest to highest. SECRET trophies only have one rank.
const RANK_ORDER = ["C", "B", "A", "AA", "AAA", "S", "SS", "SSS"];
const TOP_RANKS = new Set(["S", "SS", "SSS", "SECRET"]);

// Trophies rendered by github-profile-trophy that we don't show.
const HIDDEN = new Set(["Reviews"]);

// Rank thresholds, copied from ryo-ma/github-profile-trophy src/trophy.ts at
// the commit pinned in .github/workflows/trophy.yml (e3c89df).
const THRESHOLDS = {
  Repositories: { C: ["First Repository", 1], B: ["Middle Repo Creator", 10], A: ["High Repo Creator", 20], AA: ["Hyper Repo Creator", 30], AAA: ["Ultra Repo Creator", 35], S: ["Super Repo Creator", 40], SS: ["Deep Repo Creator", 45], SSS: ["God Repo Creator", 50] },
  Commits: { C: ["First Commit", 1], B: ["Middle Committer", 10], A: ["High Committer", 100], AA: ["Hyper Committer", 200], AAA: ["Ultra Committer", 500], S: ["Super Committer", 1000], SS: ["Deep Committer", 2000], SSS: ["God Committer", 4000] },
  PullRequest: { C: ["First Pull", 1], B: ["Middle Puller", 10], A: ["High Puller", 20], AA: ["Hyper Puller", 50], AAA: ["Ultra Puller", 100], S: ["Super Puller", 200], SS: ["Deep Puller", 500], SSS: ["God Puller", 1000] },
  Experience: { C: ["Newbie", 2], B: ["Junior Dev", 6], A: ["Intermediate Dev", 11], AA: ["Experienced Dev", 18], AAA: ["Expert Dev", 28], S: ["Master Dev", 40], SS: ["Grandmaster", 55], SSS: ["Seasoned Veteran", 70] },
  Stars: { C: ["First Star", 1], B: ["Middle Star", 10], A: ["You are a Star", 30], AA: ["High Star", 50], AAA: ["Super Star", 100], S: ["Stargazer", 200], SS: ["High Stargazer", 700], SSS: ["Super Stargazer", 2000] },
  Followers: { C: ["First Friend", 1], B: ["Many Friends", 10], A: ["Dynamic User", 20], AA: ["Active User", 50], AAA: ["Famous User", 100], S: ["Hyper Celebrity", 200], SS: ["Ultra Celebrity", 400], SSS: ["Super Celebrity", 1000] },
  Issues: { C: ["First Issue", 1], B: ["Middle Issuer", 10], A: ["High Issuer", 20], AA: ["Hyper Issuer", 50], AAA: ["Ultra Issuer", 100], S: ["Super Issuer", 200], SS: ["Deep Issuer", 500], SSS: ["God Issuer", 1000] },
  Reviews: { C: ["New Reviewer", 1], B: ["Intermediate Reviewer", 3], A: ["Active Reviewer", 8], AA: ["Hyper Reviewer", 20], AAA: ["Ultra Reviewer", 30], S: ["Super Reviewer", 45], SS: ["Deep Reviewer", 57], SSS: ["God Reviewer", 70] },
};

// Where clicking each trophy takes you.
const search = (q, type) =>
  `https://github.com/search?q=${encodeURIComponent(q)}&type=${type}`;
const LINKS = {
  MultiLanguage: `https://github.com/${USERNAME}?tab=repositories`,
  Repositories: `https://github.com/${USERNAME}?tab=repositories`,
  Commits: search(`author:${USERNAME}`, "commits"),
  PullRequest: search(`author:${USERNAME} is:pr`, "pullrequests"),
  Experience: `https://github.com/${USERNAME}`,
  Stars: `https://github.com/${USERNAME}?tab=repositories&sort=stargazers`,
  Followers: `https://github.com/${USERNAME}?tab=followers`,
  Issues: search(`author:${USERNAME} is:issue`, "issues"),
  Reviews: search(`reviewed-by:${USERNAME} is:pr`, "pullrequests"),
};

const fmt = (n) => n.toLocaleString("en-US");
const escAttr = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function parseCards(svg) {
  const cardRe = /<svg\n {10}x="\d+"[\s\S]*?\n {8}>\n([\s\S]*?)\n {8}<\/svg>/g;
  const cards = [];
  for (const [, body] of svg.matchAll(cardRe)) {
    const titleIdx = body.indexOf('<text x="50%" y="18"');
    const frameEnd = body.indexOf("/>") + 2;
    if (titleIdx === -1 || frameEnd < 2) throw new Error("Unexpected trophy card markup");

    const frame = body.slice(0, frameEnd);
    const icon = body.slice(frameEnd, titleIdx);
    const rest = body.slice(titleIdx);

    const text = (size) => rest.match(new RegExp(`font-size="${size}"[^>]*>([^<]*)<`))?.[1]?.trim() ?? "";
    const title = text("13");
    const message = text("10.5");
    // The icon draws e.g. SSS as three separate "S" letters, so read the rank
    // from the rank title ("God Repo Creator" -> SSS) instead.
    const rank = icon.includes("url(#SECRET)")
      ? "SECRET"
      : Object.entries(THRESHOLDS[title] ?? {}).find(([, [name]]) => name === message)?.[0] ?? "?";
    const barWidth = Number(rest.match(/to \{\s*width: ([\d.]+)px/)?.[1] ?? 0);

    cards.push({
      title,
      rank,
      message,
      points: text("10").replace(/pt$/, ""),
      progress: Math.max(0, Math.min(1, barWidth / 80)),
      frame,
      icon,
      rest,
    });
  }
  if (!cards.length) throw new Error(`No trophy cards found in ${SRC}`);
  return cards;
}

function nextRank(card) {
  const table = THRESHOLDS[card.title];
  if (!table || card.rank === "SECRET") return null;
  const idx = RANK_ORDER.indexOf(card.rank); // -1 for "?" (unranked) -> C
  const next = RANK_ORDER[idx + 1];
  if (!next) return null;
  const [name, score] = table[next];
  return { rank: next, name, score };
}

function renderCard(card, i) {
  const d = (i * 0.12).toFixed(2);
  const n = (x) => (Number(d) + x).toFixed(2);
  const shine = TOP_RANKS.has(card.rank);
  // Start the progress bar fill once the card has popped in.
  const rest = card.rest.replace(
    /animation: (\w+) 1s forwards ease-in-out;/,
    `animation: $1 1.2s ${n(0.45)}s forwards ease-in-out;`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="115" height="115" viewBox="0 0 115 115" fill="none">
  <style>
    .card { opacity: 0; transform-origin: 57.5px 57.5px; animation: pop 0.7s cubic-bezier(0.2, 0.8, 0.2, 1.15) ${d}s forwards; }
    .icon { transform-origin: 57.5px 50px; animation: float 3.2s ease-in-out ${n(0.8)}s infinite; }
    .shine { animation: sweep 4.5s ease-in-out ${n(1.2)}s infinite; transform: translateX(-90px); }
    @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.92); } to { opacity: 1; transform: none; } }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes sweep { 0% { transform: translateX(-90px); } 35%, 100% { transform: translateX(190px); } }
    @media (prefers-reduced-motion: reduce) {
      .card, .icon, .shine { animation: none; opacity: 1; transform: none; }
    }
  </style>
  <defs>
    <clipPath id="card-clip"><rect x="0.5" y="0.5" rx="4.5" width="114" height="114" /></clipPath>
    <linearGradient id="shine-gradient" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0" />
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.22" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <g class="card">
${card.frame}
    <g class="icon">${card.icon}</g>
${rest}${shine ? `
    <g clip-path="url(#card-clip)">
      <g transform="rotate(20 57.5 57.5)">
        <rect class="shine" x="-20" y="-40" width="36" height="200" fill="url(#shine-gradient)" />
      </g>
    </g>` : ""}
  </g>
</svg>
`;
}

function tooltip(card) {
  const rank = card.rank === "?" ? "Unranked" : card.rank === "SECRET" ? "Secret trophy" : `${card.rank} rank`;
  const next = nextRank(card);
  const nextText = next ? `next: ${next.rank} at ${fmt(next.score)}pt` : card.rank === "SECRET" ? "unlocked" : "max rank";
  return `${card.title}: ${rank}, ${card.message}, ${card.points}pt (${nextText})`;
}

function progressBar(card) {
  if (card.rank === "SECRET") return "Unlocked";
  const next = nextRank(card);
  if (!next) return "Max rank";
  const pct = Math.round(card.progress * 100);
  const filled = Math.round(card.progress * 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${pct}%`;
}

function renderSection(cards, files) {
  const images = cards
    .map((card, i) => {
      const href = LINKS[card.title] ?? `https://github.com/${USERNAME}`;
      const tip = escAttr(tooltip(card));
      return `  <a href="${href}" target="_blank" title="${tip}"><img src="./assets/trophies/${files[i]}" width="${CARD_WIDTH}" alt="${tip}" /></a>`;
    })
    .join("\n");

  const rows = cards.map((card) => {
    const next = nextRank(card);
    const rank = card.rank === "?" ? "–" : card.rank === "SECRET" ? "Secret" : `**${card.rank}**`;
    const nextText = next
      ? `${next.rank} · ${next.name} at ${fmt(next.score)}pt`
      : card.rank === "SECRET"
        ? "Hidden achievement unlocked"
        : "Already at the top";
    const href = LINKS[card.title] ?? `https://github.com/${USERNAME}`;
    return `| [${card.title}](${href}) | ${rank} | ${card.message} | ${card.points} | ${progressBar(card)} | ${nextText} |`;
  });

  return `<p align="center">
${images}
</p>

<details>
<summary><b>How the ranks work</b></summary>

| Trophy | Rank | Title | Points | Progress to next rank | Next rank |
|---|---|---|---|---|---|
${rows.join("\n")}

<sub>Ranks go C → B → A → AA → AAA → S → SS → SSS. Click a trophy to see what it counts, hover for details. Refreshed daily by <a href="https://github.com/ryo-ma/github-profile-trophy">github-profile-trophy</a>.</sub>

</details>`;
}

function main() {
  const cards = parseCards(fs.readFileSync(SRC, "utf8")).filter((card) => !HIDDEN.has(card.title));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = cards.map((card, i) => {
    const file = `${card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`;
    fs.writeFileSync(path.join(OUT_DIR, file), renderCard(card, i));
    return file;
  });

  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) throw new Error("Trophy markers not found in README.md");
  const updated =
    readme.slice(0, startIdx + START_MARKER.length) + "\n" + renderSection(cards, files) + "\n" + readme.slice(endIdx);
  fs.writeFileSync(README_PATH, updated);

  console.log(`Wrote ${cards.length} trophy cards: ${cards.map((c) => `${c.title}=${c.rank}`).join(", ")}`);
}

main();
