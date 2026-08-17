#!/usr/bin/env node
/** Node fallback for daily refresh when Python is unavailable locally. */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(ROOT, "index.html");

const DAIRY_TERMS = [
  "dairy", "milk", "cattle", "cow", "cows", "holstein", "heifer", "calf", "calves",
  "udder", "mastitis", "rumen", "milking", "livestock", "bovine", "lactation",
];
const AI_TERMS = [
  "machine learning", "deep learning", "artificial intelligence", "neural network",
  "computer vision", "reinforcement learning", "robotics", "automation", "digital twin",
  "lstm", "transformer", "graph neural", "random forest", "classification", "prediction",
  "pose estimation", "object detection", "sensor fusion", "large language model",
];

const ARXIV_QUERIES = [
  'all:"dairy cattle" AND (all:"machine learning" OR all:"deep learning" OR all:"computer vision")',
  'all:dairy AND (all:"artificial intelligence" OR all:robotics OR all:automation)',
  'all:"precision livestock" AND (all:"machine learning" OR all:"deep learning")',
  'all:milking AND (all:robot OR all:"computer vision" OR all:"digital twin")',
];

const CAT_RULES = [
  ["health", ["lameness", "mastitis", "disease", "welfare", "pain", "respiratory", "health", "illness", "fever"]],
  ["breeding", ["breeding", "genetic", "phenotyp", "teat", "conformation", "ivf", "oocyte", "embryo", "identification"]],
  ["nutrition", ["feed", "ration", "tmr", "grazing", "nutrition", "intake", "forage"]],
  ["engineering", ["robot", "milking system", "automation", "reinforcement", "manipulator", "ams", "parlour", "parlor"]],
  ["quality", ["safety", "spoilage", "contamination", "quality", "residue", "pathogen"]],
  ["product", ["cheese", "yogurt", "product development", "flavor", "processing plant"]],
  ["sustainability", ["methane", "emission", "carbon", "energy", "sustainability", "environment"]],
  ["digital", ["digital twin", "platform", "federated", "agent", "decision support", "data pipeline"]],
];

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function hasTerms(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function isRelevant(title, summary) {
  const blob = `${title} ${summary}`.toLowerCase();
  return hasTerms(blob, DAIRY_TERMS) && hasTerms(blob, AI_TERMS);
}

function classify(title, summary) {
  const blob = `${title} ${summary}`.toLowerCase();
  for (const [cat, keys] of CAT_RULES) {
    if (keys.some((k) => blob.includes(k))) return cat;
  }
  return "digital";
}

function summarize(text, maxLen = 280) {
  text = stripHtml(text).replace(/\n/g, " ");
  if (text.length <= maxLen) return text;
  let cut = text.slice(0, maxLen - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > 0) cut = cut.slice(0, sp);
  return cut + "…";
}

function jsEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").replace(/\r/g, " ");
}

function existingUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/url:"([^"]+)"/g)) {
    const u = m[1].replace(/\/$/, "");
    urls.add(u.replace(/\/$/, ""));
    const ax = u.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
    if (ax) {
      urls.add(`https://arxiv.org/abs/${ax[1]}`);
      urls.add(`https://arxiv.org/pdf/${ax[1]}`);
    }
  }
  return urls;
}

function existingIds(html) {
  return new Set([...html.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]));
}

function nextAutoId(ids, prefix = "ax") {
  const nums = [...ids]
    .map((i) => i.match(new RegExp(`^${prefix}(\\d+)$`)))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  let candidate = `${prefix}${n}`;
  while (ids.has(candidate)) {
    n += 1;
    candidate = `${prefix}${n}`;
  }
  return candidate;
}

function parseLastRefresh(html) {
  const m = html.match(/<meta name="last-refresh" content="(\d{4}-\d{2}-\d{2})"/);
  if (!m) return null;
  return new Date(`${m[1]}T00:00:00Z`);
}

function updateLastRefresh(html, day) {
  const meta = `<meta name="last-refresh" content="${day}">`;
  if (html.includes('<meta name="last-refresh"')) {
    return html.replace(/<meta name="last-refresh" content="[^"]*">/, meta);
  }
  return html.replace("<head>", `<head>\n${meta}`);
}

function entryToJs(entry, entryId) {
  const precise = entry.precise !== false;
  const parts = [
    `id:"${entryId}"`,
    `date:"${entry.date}"`,
    `precise:${precise}`,
    `cat:"${entry.cat}"`,
    `country:"${entry.country}"`,
  ];
  if (entry.org) parts.push(`org:"${jsEscape(entry.org)}"`);
  parts.push(
    `title:"${jsEscape(entry.title)}"`,
    `summary:"${jsEscape(entry.summary)}"`,
    `region:"${entry.region}"`,
    `source:"${jsEscape(entry.source)}"`,
    `url:"${entry.url}"`
  );
  return "    {" + parts.join(",") + "},";
}

function insertEntries(html, entries) {
  if (!entries.length) return [html, 0];
  const ids = existingIds(html);
  const urls = existingUrls(html);
  const lines = [];
  let added = 0;
  for (const entry of entries) {
    const url = entry.url.replace(/\/$/, "");
    if (urls.has(url)) continue;
    const entryId = nextAutoId(ids);
    ids.add(entryId);
    urls.add(url);
    lines.push(entryToJs(entry, entryId));
    added += 1;
  }
  if (!lines.length) return [html, 0];
  html = html.replace(/(\})\s*\n  \];/, "$1,\n  ];");
  const block = lines.join("\n") + "\n";
  if (!html.includes("\n  ];")) throw new Error("Could not locate DATA array end");
  html = html.replace("\n  ];", "\n" + block + "  ];");
  return [html, added];
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "DairyAIApplied-daily-refresh/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseArxivAtom(xml) {
  const entries = [];
  for (const block of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const idUrl = block.match(/<id>([^<]+)<\/id>/)?.[1] ?? "";
    const ax = idUrl.match(/arxiv\.org\/abs\/([^/]+)/);
    if (!ax) continue;
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!published) continue;
    const title = stripHtml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const summary = stripHtml(block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "");
    entries.push({ arxivId: ax[1], published, title, summary });
  }
  return entries;
}

async function fetchArxiv(since) {
  const items = [];
  const seen = new Set();
  for (const query of ARXIV_QUERIES) {
    const params = new URLSearchParams({
      search_query: query,
      start: "0",
      max_results: "12",
      sortBy: "submittedDate",
      sortOrder: "descending",
    });
    const url = `https://export.arxiv.org/api/query?${params}`;
    let xml;
    try {
      xml = await fetchText(url);
    } catch (e) {
      console.log(`arXiv query failed: ${e.message}`);
      continue;
    }
    for (const entry of parseArxivAtom(xml)) {
      if (seen.has(entry.arxivId)) continue;
      seen.add(entry.arxivId);
      const pubDt = new Date(entry.published);
      if (pubDt < since) continue;
      if (!isRelevant(entry.title, entry.summary)) continue;
      items.push({
        date: pubDt.toISOString().slice(0, 10),
        title: entry.title,
        summary: summarize(entry.summary),
        url: `https://arxiv.org/abs/${entry.arxivId}`,
        source: "arXiv",
        cat: classify(entry.title, entry.summary),
        country: "Global",
        region: "Research",
      });
    }
  }
  return items;
}

async function fetchCrossref(since) {
  const sinceStr = since.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    query: "dairy machine learning",
    filter: `from-pub-date:${sinceStr},type:journal-article`,
    rows: "20",
    sort: "published",
    order: "desc",
  });
  const url = `https://api.crossref.org/works?${params}`;
  const items = [];
  try {
    const data = JSON.parse(await fetchText(url));
    for (const work of data?.message?.items ?? []) {
      const title = stripHtml(work.title?.[0] ?? "");
      const abstract = stripHtml(work.abstract ?? "");
      if (!isRelevant(title, abstract)) continue;
      const doi = work.DOI;
      if (!doi) continue;
      const pubParts = work.published?.["date-parts"]?.[0];
      if (!pubParts?.[0]) continue;
      const pubDate = new Date(Date.UTC(pubParts[0], (pubParts[1] ?? 1) - 1, pubParts[2] ?? 1));
      if (pubDate < since) continue;
      items.push({
        date: pubDate.toISOString().slice(0, 10),
        precise: pubParts.length >= 3,
        title,
        summary: summarize(abstract || title),
        url: `https://doi.org/${doi}`,
        source: work["container-title"]?.[0] || "Crossref",
        cat: classify(title, abstract || title),
        country: "Global",
        region: "Research",
      });
    }
  } catch (e) {
    console.log(`Crossref query failed: ${e.message}`);
  }
  return items;
}

function computeSince(last) {
  const now = new Date();
  if (!last) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 14);
    return d;
  }
  const daysSince = Math.floor((now - last) / 86400000);
  const lookbackDays = Math.max(7, daysSince + 1);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  since.setUTCHours(0, 0, 0, 0);
  const dayAfterLast = new Date(last);
  dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() - 1);
  return since < dayAfterLast ? since : dayAfterLast;
}

async function main() {
  let html = readFileSync(INDEX_PATH, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const last = parseLastRefresh(html);
  const since = computeSince(last);

  console.log(`Refreshing since ${since.toISOString().slice(0, 10)} …`);
  const candidates = [...(await fetchArxiv(since)), ...(await fetchCrossref(since))];
  const deduped = [];
  const seenUrls = new Set();
  for (const item of candidates.sort((a, b) => b.date.localeCompare(a.date))) {
    const u = item.url.replace(/\/$/, "");
    if (seenUrls.has(u)) continue;
    seenUrls.add(u);
    deduped.push(item);
  }

  const [newHtml, added] = insertEntries(html, deduped);
  html = updateLastRefresh(newHtml, today);
  writeFileSync(INDEX_PATH, html, "utf8");
  console.log(`Done. Added ${added} new entr${added === 1 ? "y" : "ies"}. Last refresh: ${today}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
