#!/usr/bin/env node
/** Daily refresh: ingest dairy AI/ML from research APIs, industry RSS, and news search. */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(ROOT, "index.html");
const UA = "DairyAIApplied-daily-refresh/2.0";

const DAIRY_TERMS = [
  "dairy", "milk", "cattle", "cow", "cows", "holstein", "heifer", "calf", "calves",
  "udder", "mastitis", "rumen", "milking", "livestock", "bovine", "lactation",
];
const AI_TERMS = [
  "machine learning", "deep learning", "artificial intelligence", "neural network",
  "computer vision", "reinforcement learning", "robotics", "automation", "digital twin",
  "lstm", "transformer", "graph neural", "random forest", "classification", "prediction",
  "pose estimation", "object detection", "sensor fusion", "large language model", " llm",
  "generative ai", "chatbot", "sensor", "algorithm", "model", "deep neural",
];

const ARXIV_QUERIES = [
  'all:"dairy cattle" AND (all:"machine learning" OR all:"deep learning" OR all:"computer vision")',
  'all:dairy AND (all:"artificial intelligence" OR all:robotics OR all:automation)',
  'all:"precision livestock" AND (all:"machine learning" OR all:"deep learning")',
  'all:milking AND (all:robot OR all:"computer vision" OR all:"digital twin")',
];

const CROSSREF_QUERIES = [
  "dairy machine learning",
  "dairy cattle computer vision",
  "precision livestock artificial intelligence",
  "mastitis machine learning",
  "robotic milking automation",
];

const RSS_FEEDS = [
  { source: "Ag Proud", url: "https://www.agproud.com/rss/articles", country: "USA", region: "USA" },
  { source: "Phys.org", url: "https://phys.org/rss-feed/tags/agriculture/", country: "Global", region: "Research" },
  { source: "Phys.org", url: "https://phys.org/rss-feed/", country: "Global", region: "Research" },
  { source: "DairyNews Today", url: "https://dairynews.today/rss/", country: "Global", region: "Global" },
  { source: "The Bullvine", url: "https://www.thebullvine.com/feed/", country: "Global", region: "Global" },
  { source: "The Cow Tech Report", url: "https://cowtechreport.substack.com/feed", country: "USA", region: "USA" },
  { source: "DairyReporter", url: "https://www.dairyreporter.com/Info/DairyReporter-RSS", country: "Global", region: "Global" },
  { source: "Lely", url: "https://www.lely.com/en/about-lely/news/rss", country: "Netherlands", region: "Netherlands / Global", org: "Lely" },
  { source: "Wageningen U&R", url: "https://research.wur.nl/en/publications/?format=rss", country: "Netherlands", region: "Netherlands", org: "Wageningen University & Research" },
];

const GOOGLE_NEWS_QUERIES = [
  { query: "dairy artificial intelligence", country: "Global", region: "Global" },
  { query: "dairy machine learning cattle", country: "Global", region: "Research" },
  { query: "precision livestock farming AI", country: "Global", region: "Global" },
  { query: "robotic milking AI dairy", country: "Global", region: "Global" },
  { query: "dairy digital twin", country: "Global", region: "Global" },
  { query: "dairy herd computer vision", country: "Global", region: "Global" },
  { query: "Penn State dairy AI", country: "USA", region: "USA", org: "Penn State University" },
  { query: "Wageningen dairy machine learning", country: "Netherlands", region: "Netherlands", org: "Wageningen University & Research" },
  { query: "Cornell dairy artificial intelligence", country: "USA", region: "USA", org: "Cornell University" },
  { query: "UW Madison dairy AI", country: "USA", region: "USA", org: "University of Wisconsin–Madison" },
  { query: "site:dairyherd.com artificial intelligence", country: "USA", region: "USA", source: "Dairy Herd" },
  { query: "site:psu.edu dairy AI", country: "USA", region: "USA", org: "Penn State University" },
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

const STRONG_AI_TERMS = [
  "machine learning", "deep learning", "artificial intelligence", "neural network",
  "computer vision", "digital twin", "large language model", "generative ai",
  "chatbot", "deep neural", "transformer", "lstm", "reinforcement learning",
  "pose estimation", "object detection", "sensor fusion", "graph neural",
  "random forest", "classification model", "predictive model", "vision model",
];

function stripHtml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerms(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function isRelevant(title, summary) {
  const blob = `${title} ${summary}`.toLowerCase();
  if (!hasTerms(blob, DAIRY_TERMS)) return false;

  // "AI" often means artificial insemination in dairy press, not ML.
  if (
    blob.includes("artificial insemination") ||
    (blob.includes("embraced this") && blob.includes("genetics") && !hasTerms(blob, STRONG_AI_TERMS)) ||
    (/\bai\b/.test(blob) && blob.includes("genetics") && blob.includes("herd") && !hasTerms(blob, STRONG_AI_TERMS))
  ) {
    return false;
  }

  if (hasTerms(blob, STRONG_AI_TERMS)) return true;

  const contextual =
    (blob.includes("robotic milk") || blob.includes("milking robot") || blob.includes("smart camera") ||
      blob.includes("digital twin") || blob.includes("sensor") && blob.includes("algorithm")) &&
    (blob.includes("dairy") || blob.includes("milking") || blob.includes("herd") || blob.includes("cattle"));
  return contextual;
}

function isValidDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return false;
  const now = new Date();
  if (d > now) return false;
  if (d < new Date("2023-01-01")) return false;
  return true;
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

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function existingUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/url:"([^"]+)"/g)) {
    const u = m[1].replace(/\/$/, "");
    urls.add(u);
    const ax = u.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
    if (ax) {
      urls.add(`https://arxiv.org/abs/${ax[1]}`);
      urls.add(`https://arxiv.org/pdf/${ax[1]}`);
    }
    const doi = u.match(/doi\.org\/(10\.\d+\/[^\s"?#]+)/i);
    if (doi) urls.add(`https://doi.org/${doi[1]}`);
  }
  return urls;
}

function existingIds(html) {
  return new Set([...html.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]));
}

function nextAutoId(ids, prefix = "nf") {
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
  const dayBeforeLast = new Date(last);
  dayBeforeLast.setUTCDate(dayBeforeLast.getUTCDate() - 1);
  return since < dayBeforeLast ? since : dayBeforeLast;
}

function pushEntry(items, entry) {
  if (entry) items.push(entry);
}

function makeEntry({ date, title, summary, url, source, country, region, org, precise }) {
  if (!isValidDate(date)) return null;
  return {
    date,
    precise: precise ?? true,
    title: stripHtml(title),
    summary: summarize(summary || title),
    url,
    source,
    cat: classify(title, summary || title),
    country,
    region,
    org,
  };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function getXmlTag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

function getAtomLink(block) {
  const href = block.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1];
  if (href) return href;
  return getXmlTag(block, "id") || getXmlTag(block, "link");
}

function parseFeedXml(xml) {
  const items = [];
  for (const block of xml.match(/<item[\s\S]*?<\/item>/gi) ?? []) {
    items.push({
      title: getXmlTag(block, "title"),
      link: getXmlTag(block, "link") || block.match(/<link[^>]*>([^<]+)/i)?.[1]?.trim(),
      summary: getXmlTag(block, "description") || getXmlTag(block, "content:encoded") || getXmlTag(block, "summary"),
      date: getXmlTag(block, "pubDate") || getXmlTag(block, "dc:date") || getXmlTag(block, "published"),
    });
  }
  for (const block of xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? []) {
    items.push({
      title: getXmlTag(block, "title"),
      link: getAtomLink(block),
      summary: getXmlTag(block, "summary") || getXmlTag(block, "content"),
      date: getXmlTag(block, "published") || getXmlTag(block, "updated"),
    });
  }
  return items.filter((i) => i.title && i.link);
}

async function fetchRssFeed(feed, since) {
  const xml = await fetchText(feed.url);
  const items = [];
  for (const raw of parseFeedXml(xml)) {
    const pubDt = parseDate(raw.date);
    if (!pubDt || pubDt < since || pubDt > new Date()) continue;
    if (!isRelevant(raw.title, raw.summary)) continue;
    pushEntry(
      items,
      makeEntry({
        date: pubDt.toISOString().slice(0, 10),
        title: raw.title,
        summary: raw.summary,
        url: raw.link,
        source: feed.source,
        country: feed.country,
        region: feed.region,
        org: feed.org,
      })
    );
  }
  return items;
}

async function fetchGoogleNews(config, since) {
  const params = new URLSearchParams({
    q: config.query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  const xml = await fetchText(`https://news.google.com/rss/search?${params}`);
  const items = [];
  for (const raw of parseFeedXml(xml)) {
    const pubDt = parseDate(raw.date);
    if (!pubDt || pubDt < since || pubDt > new Date()) continue;
    if (!isRelevant(raw.title, raw.summary)) continue;
    pushEntry(
      items,
      makeEntry({
        date: pubDt.toISOString().slice(0, 10),
        title: raw.title,
        summary: raw.summary || raw.title,
        url: raw.link,
        source: config.source || "Google News",
        country: config.country,
        region: config.region,
        org: config.org,
      })
    );
  }
  return items;
}

function parseArxivAtom(xml) {
  const entries = [];
  for (const block of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const idUrl = block.match(/<id>([^<]+)<\/id>/)?.[1] ?? "";
    const ax = idUrl.match(/arxiv\.org\/abs\/([^/]+)/);
    if (!ax) continue;
    entries.push({
      arxivId: ax[1],
      published: block.match(/<published>([^<]+)<\/published>/)?.[1],
      title: stripHtml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
      summary: stripHtml(block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ""),
    });
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
    try {
      const xml = await fetchText(`https://export.arxiv.org/api/query?${params}`);
      for (const entry of parseArxivAtom(xml)) {
        if (seen.has(entry.arxivId)) continue;
        seen.add(entry.arxivId);
        const pubDt = parseDate(entry.published);
        if (!pubDt || pubDt < since || pubDt > new Date()) continue;
        if (!isRelevant(entry.title, entry.summary)) continue;
        pushEntry(
          items,
          makeEntry({
            date: pubDt.toISOString().slice(0, 10),
            title: entry.title,
            summary: entry.summary,
            url: `https://arxiv.org/abs/${entry.arxivId}`,
            source: "arXiv",
            country: "Global",
            region: "Research",
          })
        );
      }
    } catch (e) {
      console.log(`  arXiv (${query.slice(0, 40)}…): ${e.message}`);
    }
  }
  return items;
}

async function fetchCrossref(since) {
  const sinceStr = since.toISOString().slice(0, 10);
  const items = [];
  const seen = new Set();
  for (let i = 0; i < CROSSREF_QUERIES.length; i += 1) {
    const query = CROSSREF_QUERIES[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    const params = new URLSearchParams({
      query,
      filter: `from-pub-date:${sinceStr},type:journal-article`,
      rows: "15",
      sort: "published",
      order: "desc",
    });
    try {
      const data = JSON.parse(await fetchText(`https://api.crossref.org/works?${params}`));
      for (const work of data?.message?.items ?? []) {
        const title = stripHtml(work.title?.[0] ?? "");
        const abstract = stripHtml(work.abstract ?? "");
        if (!isRelevant(title, abstract)) continue;
        const doi = work.DOI;
        if (!doi) continue;
        const link = `https://doi.org/${doi}`;
        if (seen.has(link)) continue;
        const pubParts = work.published?.["date-parts"]?.[0];
        if (!pubParts?.[0]) continue;
        const pubDate = new Date(Date.UTC(pubParts[0], (pubParts[1] ?? 1) - 1, pubParts[2] ?? 1));
        if (pubDate < since || pubDate > new Date()) continue;
        seen.add(link);
        pushEntry(
          items,
          makeEntry({
            date: pubDate.toISOString().slice(0, 10),
            precise: pubParts.length >= 3,
            title,
            summary: abstract || title,
            url: link,
            source: work["container-title"]?.[0] || "Crossref",
            country: "Global",
            region: "Research",
          })
        );
      }
    } catch (e) {
      console.log(`  Crossref (${query}): ${e.message}`);
    }
  }
  return items;
}

async function fetchPubMed(since) {
  const days = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000));
  const term = encodeURIComponent(
    "(dairy[Title/Abstract] OR cattle[Title/Abstract] OR milk[Title/Abstract] OR bovine[Title/Abstract]) AND (machine learning[Title/Abstract] OR artificial intelligence[Title/Abstract] OR deep learning[Title/Abstract] OR computer vision[Title/Abstract])"
  );
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${term}&retmax=25&sort=date&retmode=json&reldate=${days}`;
  const search = JSON.parse(await fetchText(searchUrl));
  const ids = search?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
  const summary = JSON.parse(await fetchText(summaryUrl));
  const items = [];
  for (const id of ids) {
    const doc = summary?.result?.[id];
    if (!doc) continue;
    const title = stripHtml(doc.title ?? "");
    const pubDate = parseDate(doc.pubdate ?? doc.epubdate);
    if (!pubDate || pubDate < since) continue;
    if (!isRelevant(title, doc.sorttitle ?? title)) continue;
    pushEntry(
      items,
      makeEntry({
        date: pubDate.toISOString().slice(0, 10),
        title,
        summary: title,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: doc.fulljournalname || doc.source || "PubMed",
        country: "Global",
        region: "Research",
      })
    );
  }
  return items;
}

async function collectFrom(name, fn) {
  try {
    const items = await fn();
    console.log(`  ${name}: ${items.length} candidate(s)`);
    return items;
  } catch (e) {
    console.log(`  ${name}: failed — ${e.message}`);
    return [];
  }
}

async function main() {
  let html = readFileSync(INDEX_PATH, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const last = parseLastRefresh(html);
  const since = computeSince(last);

  console.log(`Refreshing since ${since.toISOString().slice(0, 10)} …`);
  console.log("Sources:");

  const tasks = [
    ["arXiv", () => fetchArxiv(since)],
    ["Crossref", () => fetchCrossref(since)],
    ["PubMed", () => fetchPubMed(since)],
    ...RSS_FEEDS.map((feed) => [feed.source, () => fetchRssFeed(feed, since)]),
    ...GOOGLE_NEWS_QUERIES.map((q) => [`News: ${q.query}`, () => fetchGoogleNews(q, since)]),
  ];

  const batches = await Promise.all(tasks.map(([name, fn]) => collectFrom(name, fn)));
  const candidates = batches.flat();

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
