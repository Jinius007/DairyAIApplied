#!/usr/bin/env python3
"""Daily refresh: ingest new dairy AI/ML/robotics items into index.html DATA."""

from __future__ import annotations

import json
import re
import sys
import textwrap
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from html import unescape

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "index.html"
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}

DAIRY_TERMS = (
    "dairy", "milk", "cattle", "cow", "cows", "holstein", "heifer", "calf", "calves",
    "udder", "mastitis", "rumen", "milking", "livestock", "bovine", "lactation",
)
AI_TERMS = (
    "machine learning", "deep learning", "artificial intelligence", "neural network",
    "computer vision", "reinforcement learning", "robotics", "automation", "digital twin",
    "lstm", "transformer", "graph neural", "random forest", "classification", "prediction",
    "pose estimation", "object detection", "sensor fusion", "large language model",
)

ARXIV_QUERIES = (
    'all:"dairy cattle" AND (all:"machine learning" OR all:"deep learning" OR all:"computer vision")',
    'all:dairy AND (all:"artificial intelligence" OR all:robotics OR all:automation)',
    'all:"precision livestock" AND (all:"machine learning" OR all:"deep learning")',
    'all:milking AND (all:robot OR all:"computer vision" OR all:"digital twin")',
)

CAT_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("health", ("lameness", "mastitis", "disease", "welfare", "pain", "respiratory", "health", "illness", "fever")),
    ("breeding", ("breeding", "genetic", "phenotyp", "teat", "conformation", "ivf", "oocyte", "embryo", "identification")),
    ("nutrition", ("feed", "ration", "tmr", "grazing", "nutrition", "intake", "forage")),
    ("engineering", ("robot", "milking system", "automation", "reinforcement", "manipulator", "ams", "parlour", "parlor")),
    ("quality", ("safety", "spoilage", "contamination", "quality", "residue", "pathogen")),
    ("product", ("cheese", "yogurt", "product development", "flavor", "processing plant")),
    ("sustainability", ("methane", "emission", "carbon", "energy", "sustainability", "environment")),
    ("digital", ("digital twin", "platform", "federated", "agent", "decision support", "data pipeline")),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def read_index() -> str:
    with open(INDEX_PATH, encoding="utf-8") as f:
        return f.read()


def write_index(content: str) -> None:
    with open(INDEX_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def existing_urls(html: str) -> set[str]:
    urls = set(re.findall(r'url:"([^"]+)"', html))
    normalized = set()
    for u in urls:
        normalized.add(u.rstrip("/"))
        m = re.search(r"arxiv\.org/abs/(\d+\.\d+)", u)
        if m:
            normalized.add(f"https://arxiv.org/abs/{m.group(1)}")
            normalized.add(f"https://arxiv.org/pdf/{m.group(1)}")
    return normalized


def existing_ids(html: str) -> set[str]:
    return set(re.findall(r'id:"([^"]+)"', html))


def next_auto_id(ids: set[str], prefix: str = "ax") -> str:
    nums = []
    for i in ids:
        m = re.match(rf"{re.escape(prefix)}(\d+)$", i)
        if m:
            nums.append(int(m.group(1)))
    n = max(nums, default=0) + 1
    candidate = f"{prefix}{n}"
    while candidate in ids:
        n += 1
        candidate = f"{prefix}{n}"
    return candidate


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def has_terms(text: str, terms: tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(t in lower for t in terms)


def is_relevant(title: str, summary: str) -> bool:
    blob = f"{title} {summary}".lower()
    return has_terms(blob, DAIRY_TERMS) and has_terms(blob, AI_TERMS)


def classify(title: str, summary: str) -> str:
    blob = f"{title} {summary}".lower()
    for cat, keys in CAT_RULES:
        if any(k in blob for k in keys):
            return cat
    return "digital"


def summarize(text: str, max_len: int = 280) -> str:
    text = strip_html(text)
    text = text.replace("\n", " ")
    if len(text) <= max_len:
        return text
    cut = text[: max_len - 1]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut + "…"


def js_escape(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", " ")
        .replace("\r", " ")
    )


def fetch_url(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "DairyAIApplied-daily-refresh/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_arxiv(since: datetime, max_per_query: int = 12) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for query in ARXIV_QUERIES:
        params = urllib.parse.urlencode(
            {
                "search_query": query,
                "start": 0,
                "max_results": max_per_query,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }
        )
        url = f"http://export.arxiv.org/api/query?{params}"
        try:
            raw = fetch_url(url)
        except Exception as exc:
            log(f"arXiv query failed: {exc}")
            continue
        root = ET.fromstring(raw)
        for entry in root.findall("a:entry", ATOM_NS):
            id_url = (entry.findtext("a:id", default="", namespaces=ATOM_NS) or "").strip()
            m = re.search(r"arxiv\.org/abs/([^/]+)", id_url)
            if not m:
                continue
            arxiv_id = m.group(1)
            if arxiv_id in seen:
                continue
            seen.add(arxiv_id)
            published = entry.findtext("a:published", default="", namespaces=ATOM_NS)
            if not published:
                continue
            pub_dt = datetime.fromisoformat(published.replace("Z", "+00:00"))
            if pub_dt < since:
                continue
            title = strip_html(entry.findtext("a:title", default="", namespaces=ATOM_NS))
            summary = strip_html(entry.findtext("a:summary", default="", namespaces=ATOM_NS))
            if not is_relevant(title, summary):
                continue
            link = f"https://arxiv.org/abs/{arxiv_id}"
            org = None
            for author in entry.findall("a:author", ATOM_NS):
                aff = author.find("a:affiliation", ATOM_NS)
                if aff is not None and aff.text:
                    org = strip_html(aff.text)
                    break
            items.append(
                {
                    "date": pub_dt.date().isoformat(),
                    "title": title,
                    "summary": summarize(summary),
                    "url": link,
                    "source": "arXiv",
                    "cat": classify(title, summary),
                    "country": "Global",
                    "region": "Research",
                    "org": org,
                }
            )
    return items


def fetch_crossref(since: datetime, rows: int = 20) -> list[dict]:
    since_str = since.date().isoformat()
    query = "dairy machine learning"
    params = urllib.parse.urlencode(
        {
            "query": query,
            "filter": f"from-pub-date:{since_str},type:journal-article",
            "rows": rows,
            "sort": "published",
            "order": "desc",
        }
    )
    url = f"https://api.crossref.org/works?{params}"
    items: list[dict] = []
    try:
        raw = fetch_url(url)
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        log(f"Crossref query failed: {exc}")
        return items
    for work in data.get("message", {}).get("items", []):
        title_list = work.get("title") or []
        if not title_list:
            continue
        title = strip_html(title_list[0])
        abstract = strip_html(work.get("abstract") or "")
        if not is_relevant(title, abstract):
            continue
        doi = work.get("DOI")
        if not doi:
            continue
        link = f"https://doi.org/{doi}"
        pub_parts = work.get("published", {}).get("date-parts", [[None]])[0]
        if not pub_parts or not pub_parts[0]:
            continue
        try:
            if len(pub_parts) >= 3:
                pub_date = datetime(pub_parts[0], pub_parts[1], pub_parts[2], tzinfo=timezone.utc)
            elif len(pub_parts) == 2:
                pub_date = datetime(pub_parts[0], pub_parts[1], 1, tzinfo=timezone.utc)
            else:
                pub_date = datetime(pub_parts[0], 1, 1, tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        if pub_date < since:
            continue
        container = (work.get("container-title") or [""])[0]
        precise = len(pub_parts) >= 3
        items.append(
            {
                "date": pub_date.date().isoformat(),
                "precise": precise,
                "title": title,
                "summary": summarize(abstract or title),
                "url": link,
                "source": container or "Crossref",
                "cat": classify(title, abstract or title),
                "country": "Global",
                "region": "Research",
                "org": None,
            }
        )
    return items


def entry_to_js(entry: dict, entry_id: str) -> str:
    precise = entry.get("precise", True)
    parts = [
        f'id:"{entry_id}"',
        f'date:"{entry["date"]}"',
        f"precise:{str(precise).lower()}",
        f'cat:"{entry["cat"]}"',
        f'country:"{entry["country"]}"',
        f'title:"{js_escape(entry["title"])}"',
        f'summary:"{js_escape(entry["summary"])}"',
        f'region:"{entry["region"]}"',
        f'source:"{js_escape(entry["source"])}"',
        f'url:"{entry["url"]}"',
    ]
    if entry.get("org"):
        parts.insert(5, f'org:"{js_escape(entry["org"])}"')
    return "    {" + ",".join(parts) + "},"


def update_last_refresh(html: str, day: str) -> str:
    meta = f'<meta name="last-refresh" content="{day}">'
    if re.search(r'<meta name="last-refresh"', html):
        return re.sub(r'<meta name="last-refresh" content="[^"]*">', meta, html, count=1)
    return html.replace("<head>", f"<head>\n{meta}", 1)


def insert_entries(html: str, entries: list[dict]) -> tuple[str, int]:
    if not entries:
        return html, 0
    ids = existing_ids(html)
    urls = existing_urls(html)
    lines: list[str] = []
    added = 0
    for entry in entries:
        url = entry["url"].rstrip("/")
        if url in urls:
            continue
        entry_id = next_auto_id(ids)
        ids.add(entry_id)
        urls.add(url)
        lines.append(entry_to_js(entry, entry_id))
        added += 1
    if not lines:
        return html, 0
    block = "\n".join(lines) + "\n"
    # Ensure the previous last entry has a trailing comma before insertion.
    html = re.sub(r"(\})\s*\n  \];", r"\1,\n  ];", html, count=1)
    marker = "\n  ];"
    if marker not in html:
        raise RuntimeError("Could not locate DATA array end in index.html")
    html = html.replace(marker, "\n" + block + "  ];", 1)
    return html, added


def parse_last_refresh(html: str) -> datetime | None:
    m = re.search(r'<meta name="last-refresh" content="(\d{4}-\d{2}-\d{2})"', html)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def main() -> int:
    html = read_index()
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    last = parse_last_refresh(html)
    if last:
        days_since = (now.date() - last.date()).days
        lookback_days = max(7, days_since + 1)
        since = now - timedelta(days=lookback_days)
        since = since.replace(hour=0, minute=0, second=0, microsecond=0)
        day_before_last = last - timedelta(days=1)
        if since > day_before_last:
            since = day_before_last
    else:
        since = now - timedelta(days=14)

    log(f"Refreshing since {since.date().isoformat()} …")
    candidates = fetch_arxiv(since) + fetch_crossref(since)
    # Newest first, dedupe by URL
    deduped: list[dict] = []
    seen_urls: set[str] = set()
    for item in sorted(candidates, key=lambda x: x["date"], reverse=True):
        u = item["url"].rstrip("/")
        if u in seen_urls:
            continue
        seen_urls.add(u)
        deduped.append(item)

    html, added = insert_entries(html, deduped)
    html = update_last_refresh(html, today)
    write_index(html)
    log(f"Done. Added {added} new entr{'y' if added == 1 else 'ies'}. Last refresh: {today}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
