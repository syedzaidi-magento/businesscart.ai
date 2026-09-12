#!/usr/bin/env python3
"""Local pre-commit validation: regenerate uSetGo storefront against real Atlas data,
validate JSON-LD schema, run Lighthouse against representative pages.

Run BEFORE every commit. Catches:
  - template parse errors (regen returns non-200)
  - JSON-LD validity (parses cleanly, has required fields when applicable)
  - PageSpeed regressions (Lighthouse with hard thresholds)
  - Stale binary (you forgot to rebuild — manifests as no-op regen or stale output)

Requires:
  - Local SAM services running (./manage_services.sh start)
  - account-service binary rebuilt after any template/generator change
  - ADMIN_PASSWORD env var set (real admin login on Atlas)
  - lighthouse + chrome installed (npm i -g lighthouse, system chrome)
"""
import glob
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
from xml.etree import ElementTree as ET
import threading
import time

import requests

# ─── Configuration ──────────────────────────────────────────────────────────
API_URL = os.getenv("API_URL", "http://localhost:3000")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "help@businesscart.ai")
# ADMIN_PASSWORD: from the environment (the pre-push hook passes it explicitly).
# For standalone runs, fall back to the gitignored scripts/.precommit.env so we
# never hardcode a secret in a tracked file.
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".precommit.env")) as _f:
            for _line in _f:
                if _line.strip().startswith("ADMIN_PASSWORD="):
                    ADMIN_PASSWORD = _line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except OSError:
        pass

USETGO_COMPANY_ID = "68d46f98e4dc5dd472e33655"
USETGO_UID = "ui-sid-888"
# Set by step_regenerate so the tenant-isolation check can reuse the admin session.
ADMIN_TOKEN = None
STOREFRONT_DIR = os.path.abspath(f"./storefronts/{USETGO_UID}")
COPY_SCRIPT = os.path.abspath("./copy_d2c_files.sh")

HTTP_PORT = 8765
# Lighthouse thresholds. Local Lighthouse has ~3pt variance vs prod CDN.
# Tighter on A11y (deterministic), looser on Perf (depends on local network).
LH_MIN_PERFORMANCE = 85
LH_MIN_ACCESSIBILITY = 100
LH_MIN_BEST_PRACTICES = 95
LH_MIN_SEO = 100

# Blog pages are designed for perfect Lighthouse scores (zero new JS, no 3rd-party,
# server-rendered, semantic HTML). Perf is 95 to absorb local-Lighthouse variance;
# prod CDN should hit 100.
LH_BLOG_MIN_PERFORMANCE = 95
LH_BLOG_MIN_ACCESSIBILITY = 100
LH_BLOG_MIN_BEST_PRACTICES = 100
LH_BLOG_MIN_SEO = 100

# ANSI colors
GREEN = "\033[0;32m"
RED = "\033[0;31m"
YELLOW = "\033[0;33m"
NC = "\033[0m"

passed = 0
failed = 0
errors = []


def ok(msg):
    global passed
    passed += 1
    print(f"  {GREEN}✓{NC} {msg}")


def fail(msg):
    global failed
    failed += 1
    errors.append(msg)
    print(f"  {RED}✗{NC} {msg}")


def step(msg):
    print(f"\n{YELLOW}▶ {msg}{NC}")


# ─── Step 1: Clean storefront dir ───────────────────────────────────────────
def step_clean():
    step("Step 1/4: Clean local storefront dir")
    if os.path.exists(STOREFRONT_DIR):
        shutil.rmtree(STOREFRONT_DIR)
        ok(f"cleaned {STOREFRONT_DIR}")
    else:
        ok(f"already clean: {STOREFRONT_DIR}")


# ─── Step 2: Login + regenerate via local API ───────────────────────────────
def step_regenerate():
    step("Step 2/4: Trigger regen via local SAM API")

    if not ADMIN_PASSWORD:
        fail("ADMIN_PASSWORD env var not set — cannot log in as admin")
        return

    # Login
    try:
        r = requests.post(
            f"{API_URL}/accounts/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=15,
        )
        if r.status_code != 200:
            fail(f"admin login failed: {r.status_code} {r.text[:200]}")
            return
        token = r.json().get("token") or r.json().get("accessToken")
        if not token:
            fail(f"login response missing token: {r.json()}")
            return
        global ADMIN_TOKEN
        ADMIN_TOKEN = token
        ok("admin login")
    except Exception as e:
        fail(f"admin login error: {e}")
        return

    # Regenerate uSetGo
    try:
        r = requests.post(
            f"{API_URL}/accounts/{USETGO_COMPANY_ID}/regenerate",
            headers={"Authorization": f"Bearer {token}"},
            timeout=120,
        )
        if r.status_code not in (200, 201, 202, 204):
            fail(f"regenerate failed: {r.status_code} {r.text[:200]}")
            return
        ok(f"regen API returned {r.status_code}")
    except Exception as e:
        fail(f"regen request error: {e}")
        return

    # Copy from Lambda container to host filesystem
    try:
        r = subprocess.run(
            [COPY_SCRIPT, USETGO_UID],
            check=False, capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            fail(f"copy_d2c_files.sh failed: {r.stderr[:300]}")
            return
        if not os.path.isdir(f"{STOREFRONT_DIR}/products"):
            fail(f"copy succeeded but {STOREFRONT_DIR}/products is missing")
            return
        ok(f"files copied to {STOREFRONT_DIR}")
    except Exception as e:
        fail(f"copy script error: {e}")
        return


# ─── Step 2.5: Tenant isolation ─────────────────────────────────────────────
def step_tenant_isolation():
    """Every generated page must belong to the company being regenerated.

    The regen above runs as ADMIN, which is exactly how one tenant's catalog once
    got published onto another tenant's public storefront: catalog-service derives
    tenancy from the JWT, and an admin token resolves to every seller. The schema
    step cannot catch that, because a foreign product's page still has perfectly
    valid JSON-LD; it would just report a larger PDP count and pass.

    Pages are named {slug}-{last6ofID}.html by the generator, so the filename
    suffix maps a page back to the product that produced it.
    """
    step("Step 2.5/4: Tenant isolation (no foreign products or posts on this storefront)")

    if not ADMIN_TOKEN:
        fail("tenant isolation: no admin token available")
        return

    hdrs = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

    def owned_suffixes(endpoint, label, required=True):
        try:
            r = requests.get(f"{API_URL}{endpoint}", headers=hdrs, timeout=30)
        except Exception as e:
            fail(f"tenant isolation: {label} fetch error: {e}")
            return None
        if r.status_code != 200:
            fail(f"tenant isolation: {label} fetch returned {r.status_code}")
            return None
        rows = r.json() or []
        # Admin sees every seller; that breadth is the point — it is what the
        # storefront must NOT contain.
        mine = {str(x["_id"])[-6:] for x in rows
                if x.get("sellerID") == USETGO_COMPANY_ID and x.get("_id")}
        if not mine:
            # Having none of an OPTIONAL collection is a legitimate state, not a
            # defect: a company with no blog posts simply has no blog pages to
            # attribute. The caller already tolerates the None return, but fail()
            # had still incremented the failure count, so the whole run went red
            # and the pre-push gate refused the push. Products stay required, since
            # a storefront generated with no products really is broken.
            if required:
                fail(f"tenant isolation: admin catalog returned no {label} for this company")
            else:
                ok(f"tenant isolation: no {label} for this company; nothing to attribute")
            return None
        return mine, len(rows)

    def check(pattern, mine, label, skip=()):
        # index.html and other listing pages are generated, not product/post pages,
        # so they carry no ID suffix to attribute (same exclusion as step_schema).
        pages = sorted(p for p in glob.glob(pattern)
                       if os.path.basename(p) not in skip)
        foreign = []
        for p in pages:
            suffix = os.path.basename(p)[:-len(".html")].rsplit("-", 1)[-1]
            if suffix not in mine:
                foreign.append(os.path.basename(p))
        if foreign:
            fail(f"CROSS-TENANT LEAK: {len(foreign)} {label} page(s) not owned by this "
                 f"company: {foreign[:5]}{' …' if len(foreign) > 5 else ''}")
            return False
        return len(pages)

    res = owned_suffixes("/products", "products")
    if not res:
        return
    mine_products, total_products = res

    res = owned_suffixes("/blog", "blog posts", required=False)
    mine_posts, total_posts = res if res else (set(), 0)

    n_pdp = check(f"{STOREFRONT_DIR}/products/*.html", mine_products, "product",
                  skip=("index.html",))
    n_blog = (check(f"{STOREFRONT_DIR}/blog/*.html", mine_posts, "blog",
                    skip=("index.html",)) if mine_posts else 0)

    if n_pdp is not False and n_blog is not False:
        ok(f"tenant isolation: {n_pdp} PDP(s) + {n_blog} blog page(s) all owned by this "
           f"company (admin sees {total_products} products / {total_posts} posts across all sellers)")


# ─── Step 3: JSON-LD schema validation ──────────────────────────────────────
def step_schema():
    step("Step 3/4: Schema validation (JSON-LD on every PDP + blog post)")

    pdps = sorted(glob.glob(f"{STOREFRONT_DIR}/products/*.html"))
    if not pdps:
        fail(f"no PDPs found in {STOREFRONT_DIR}/products — regen probably failed silently")
        return

    json_ld_re = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.DOTALL)

    parse_failures = 0
    missing_field_failures = 0
    rating_mismatch_failures = 0
    audience_failures = 0

    for pdp in pdps:
        with open(pdp, encoding="utf-8") as fp:
            html = fp.read()
        blocks = json_ld_re.findall(html)
        if not blocks:
            fail(f"{os.path.basename(pdp)}: no JSON-LD blocks found")
            parse_failures += 1
            continue

        for i, block in enumerate(blocks):
            try:
                d = json.loads(block)
            except json.JSONDecodeError as e:
                fail(f"{os.path.basename(pdp)} block {i+1}: invalid JSON — {e}")
                parse_failures += 1
                continue

            t = d.get("@type")
            if t == "Product":
                for required in ("name", "offers", "brand"):
                    if not d.get(required):
                        fail(f"{os.path.basename(pdp)}: Product missing '{required}'")
                        missing_field_failures += 1

                agg = d.get("aggregateRating")
                reviews = d.get("review", [])
                if agg:
                    for required in ("ratingValue", "reviewCount"):
                        if not agg.get(required):
                            fail(f"{os.path.basename(pdp)}: aggregateRating missing '{required}'")
                            missing_field_failures += 1
                    if not isinstance(reviews, list) or len(reviews) == 0:
                        fail(f"{os.path.basename(pdp)}: aggregateRating present but no review[] array")
                        rating_mismatch_failures += 1
                elif reviews:
                    fail(f"{os.path.basename(pdp)}: review[] present but no aggregateRating")
                    rating_mismatch_failures += 1

            # FAQPage (Roadmap #52). Shape verified against schema.org/Question:
            # mainEntity[] of Question, each with a name and an acceptedAnswer whose
            # @type is Answer and which carries text. A Question with no answer is
            # invalid schema and renders an empty disclosure, so the handler drops
            # those; this asserts none survived to the page.
            elif t == "FAQPage":
                entities = d.get("mainEntity")
                if not isinstance(entities, list) or not entities:
                    fail(f"{os.path.basename(pdp)}: FAQPage present but mainEntity[] is empty")
                    missing_field_failures += 1
                    continue
                for q in entities:
                    if q.get("@type") != "Question" or not q.get("name"):
                        fail(f"{os.path.basename(pdp)}: FAQPage mainEntity entry is not a named Question")
                        missing_field_failures += 1
                        continue
                    ans = q.get("acceptedAnswer") or {}
                    if ans.get("@type") != "Answer" or not ans.get("text"):
                        fail(f"{os.path.basename(pdp)}: FAQ question {q.get('name')!r} has no usable acceptedAnswer")
                        missing_field_failures += 1

        # The companion is the half that actually feeds AI crawlers, and it is
        # generated from its own product.md template rather than converted from this
        # HTML. A PDP carrying FAQ schema whose .md has no Q&A section means the two
        # templates have drifted, which is the /faq defect (9b03072) repeating here.
        # Checked in BOTH directions. The obvious drift is "HTML has it, .md does
        # not", but the reverse matters more: if the HTML block is deleted or its
        # [[if]] guard breaks while product.md still emits the section, the PDP a
        # human actually looks at loses its answers and only the AI-facing file
        # keeps them. A one-directional check would pass that silently.
        # --- Audience invariants (Roadmap #36) ---
        #
        # A wholesale-only product stays crawlable on purpose: that visibility IS
        # the acquisition front door. What it must never do is publish a consumer
        # price, because there is no consumer buy path behind it. A priced offer
        # with no cart earns a shopping rich result that lands a shopper on a page
        # they cannot purchase from, and for a paid feed it spends real money doing
        # it. The signal is the offer's eligibleCustomerType, which only the
        # wholesale branch of product.html emits.
        for i, block in enumerate(blocks):
            try:
                d = json.loads(block)
            except json.JSONDecodeError:
                continue  # already reported above
            if d.get("@type") != "Product":
                continue
            offers = d.get("offers") or {}
            is_wholesale = "goodrelations" in str(offers.get("eligibleCustomerType", "")).lower()
            base = os.path.basename(pdp)

            if is_wholesale:
                if "price" in offers:
                    fail(f"{base}: wholesale-only product published a consumer price ({offers['price']})")
                    audience_failures += 1
                if "priceCurrency" in offers:
                    fail(f"{base}: wholesale-only product published priceCurrency on the offer")
                    audience_failures += 1
                # The page must still give a business buyer somewhere to go, or it
                # is a dead end: no price, no cart, no route to an account.
                # The CTA must stay on the merchant's own domain (white-label), so
                # it is a relative link to the contact page anchor, never a link
                # into the platform portal.
                if "contact.html#trade" not in html:
                    fail(f"{base}: wholesale-only product has no trade-access link")
                    audience_failures += 1
                if "request-b2b-code" in html or "businesscart.ai/request" in html:
                    fail(f"{base}: trade CTA points into the platform portal, breaking white-label")
                    audience_failures += 1
                if "Add to Cart" in html:
                    fail(f"{base}: wholesale-only product still renders Add to Cart")
                    audience_failures += 1
                # The .md companion is what AI crawlers read. If it still carries a
                # price the two surfaces disagree, which is the /faq split again.
                comp = os.path.splitext(pdp)[0] + ".md"
                if os.path.exists(comp):
                    with open(comp, encoding="utf-8") as fp:
                        md = fp.read()
                    if "Wholesale only" not in md:
                        fail(f"{os.path.basename(comp)}: wholesale product's companion does not declare it wholesale only")
                        audience_failures += 1
            else:
                # A retail product losing its price is the opposite regression, and
                # just as silent: the page still renders and still looks fine.
                if not offers.get("price"):
                    fail(f"{base}: retail product has no price in its offer")
                    audience_failures += 1

        companion = os.path.splitext(pdp)[0] + ".md"
        html_has_faq = "FAQPage" in html
        md_has_faq = False
        if os.path.exists(companion):
            with open(companion, encoding="utf-8") as fp:
                md_has_faq = "## Questions & Answers" in fp.read()
        elif html_has_faq:
            fail(f"{os.path.basename(pdp)}: has FAQ schema but no .md companion")
            missing_field_failures += 1
            continue

        if html_has_faq and not md_has_faq:
            fail(f"{os.path.basename(companion)}: PDP has FAQ schema but the companion omits the Q&A section")
            missing_field_failures += 1
        elif md_has_faq and not html_has_faq:
            fail(f"{os.path.basename(pdp)}: companion has a Q&A section but the PDP emits no FAQ schema")
            missing_field_failures += 1

    if parse_failures == 0 and missing_field_failures == 0 and rating_mismatch_failures == 0 and audience_failures == 0:
        ok(f"all {len(pdps)} PDPs: JSON-LD parses + schema fields present + rating/review consistency + FAQ schema/companion parity + audience price/buy-path invariants")

    # --- Blog posts: optional editorial content ---
    # Glob only top-level /blog/*.html, excluding category/ subdir.
    blog_posts = sorted(
        p for p in glob.glob(f"{STOREFRONT_DIR}/blog/*.html")
        if os.path.basename(os.path.dirname(p)) == "blog"
        and os.path.basename(p) not in ("index.html",)
    )
    if not blog_posts:
        # Blog is optional; skip silently if no posts.
        return

    blog_parse_failures = 0
    blog_missing_failures = 0
    blog_forbidden_failures = 0
    blog_external_failures = 0

    for post in blog_posts:
        with open(post, encoding="utf-8") as fp:
            html = fp.read()
        name = os.path.basename(post)

        # 1. JSON-LD must include Article + BreadcrumbList; must NOT include FAQPage or ItemList.
        blocks = json_ld_re.findall(html)
        if not blocks:
            fail(f"blog/{name}: no JSON-LD blocks found")
            blog_parse_failures += 1
            continue

        types_seen = set()
        for i, block in enumerate(blocks):
            try:
                d = json.loads(block)
            except json.JSONDecodeError as e:
                fail(f"blog/{name} block {i+1}: invalid JSON — {e}")
                blog_parse_failures += 1
                continue
            t = d.get("@type")
            types_seen.add(t)
            if t == "Article":
                for required in ("headline", "datePublished", "author", "publisher",
                                 "articleSection", "mainEntityOfPage"):
                    if not d.get(required):
                        fail(f"blog/{name}: Article missing '{required}'")
                        blog_missing_failures += 1

        if "Article" not in types_seen:
            fail(f"blog/{name}: missing Article schema")
            blog_missing_failures += 1
        if "BreadcrumbList" not in types_seen:
            fail(f"blog/{name}: missing BreadcrumbList schema")
            blog_missing_failures += 1
        # Editorial positioning: forbid commercial schemas.
        for forbidden in ("FAQPage", "ItemList", "Product"):
            if forbidden in types_seen:
                fail(f"blog/{name}: forbidden '{forbidden}' schema (editorial positioning)")
                blog_forbidden_failures += 1

        # 2. No external HTTP requests (no 3rd-party scripts/stylesheets).
        # Strip data: and same-domain (relative or //) refs; flag http(s)://* references.
        for tag in ("script", "link", "iframe"):
            for m in re.finditer(rf'<{tag}[^>]+(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']', html, re.IGNORECASE):
                url = m.group(1)
                # Allow company CDN domains (storefront images) — these are the company's own assets.
                # Block anything that looks like a tracker/CDN domain.
                if "googletagmanager" in url or "google-analytics" in url or "facebook.com" in url or "doubleclick" in url:
                    fail(f"blog/{name}: external tracker script {url}")
                    blog_external_failures += 1

    if (blog_parse_failures == 0 and blog_missing_failures == 0
            and blog_forbidden_failures == 0 and blog_external_failures == 0):
        ok(f"all {len(blog_posts)} blog posts: Article + BreadcrumbList present, no FAQ/ItemList/Product, no external trackers")

    # --- Google Product Reviews feed (optional — skip silently if no feed file) ---
    # Verifies: file exists, XML is well-formed, schema v2.4 invariants present,
    # review_count matches sum of catalog Rating.Count across all reviewed PDPs.
    feeds_dir = f"{STOREFRONT_DIR}/feeds"
    gr_files = sorted(glob.glob(f"{feeds_dir}/gr-*.xml"))
    if gr_files:
        feed_path = gr_files[0]
        try:
            tree = ET.parse(feed_path)
            root = tree.getroot()
        except ET.ParseError as e:
            fail(f"google_reviews feed XML parse error: {e}")
            return

        if root.tag != "feed":
            fail(f"google_reviews feed: root element must be <feed>, got <{root.tag}>")
            return
        version_el = root.find("version")
        if version_el is None or (version_el.text or "").strip() != "2.4":
            fail(f"google_reviews feed: must contain <version>2.4</version>")
            return
        publisher_el = root.find("publisher")
        if publisher_el is None or publisher_el.find("name") is None:
            fail(f"google_reviews feed: missing <publisher><name>")
            return

        reviews_in_feed = root.findall("./reviews/review")
        feed_count = len(reviews_in_feed)

        # Count reviews referenced in catalog (sum aggregateRating.reviewCount across PDPs).
        #
        # Wholesale-only products are skipped, and the skip is the point: their
        # PDPs still carry real reviews, but the product is absent from the
        # shopping feeds, so submitting its reviews would reference an item
        # Merchant Center does not have. The invariant this check protects is
        # "every product that BELONGS in the feed has all its reviews there",
        # not "the feed mirrors every page on the site".
        catalog_count = 0
        skipped_wholesale = 0
        for pdp in pdps:
            with open(pdp, encoding="utf-8") as fp:
                html = fp.read()
            for block in json_ld_re.findall(html):
                try:
                    d = json.loads(block)
                except json.JSONDecodeError:
                    continue
                if d.get("@type") == "Product":
                    offers = d.get("offers") or {}
                    if "goodrelations" in str(offers.get("eligibleCustomerType", "")).lower():
                        agg = d.get("aggregateRating") or {}
                        try:
                            skipped_wholesale += int(agg.get("reviewCount") or 0)
                        except (ValueError, TypeError):
                            pass
                        continue
                    agg = d.get("aggregateRating") or {}
                    try:
                        catalog_count += int(agg.get("reviewCount") or 0)
                    except (ValueError, TypeError):
                        pass

        if feed_count != catalog_count:
            fail(f"google_reviews feed: review count mismatch, feed has {feed_count}, "
                 f"consumer-facing PDPs aggregate to {catalog_count} "
                 f"({skipped_wholesale} review(s) correctly excluded with wholesale-only products)")
            return

        # Per-review schema invariants (spot check first 5 reviews to catch structural issues).
        for i, r in enumerate(reviews_in_feed[:5]):
            for required in ("review_id", "reviewer", "review_timestamp",
                             "content", "review_url", "ratings", "products"):
                if r.find(required) is None:
                    fail(f"google_reviews feed: review[{i+1}] missing <{required}>")
                    return
            overall = r.find("./ratings/overall")
            if overall is None or overall.get("min") != "1" or overall.get("max") != "5":
                fail(f"google_reviews feed: review[{i+1}] ratings/overall must have min='1' max='5'")
                return
            review_url = r.find("review_url")
            if review_url is None or review_url.get("type") != "singleton":
                fail(f"google_reviews feed: review[{i+1}] review_url must have type='singleton'")
                return

        ok(f"google_reviews feed: schema v2.4 valid, {feed_count} reviews, matches catalog count, required fields present")


# ─── Step 3.4: Wholesale surfaces (Roadmap #36) ──────────────────────────────
def step_wholesale():
    """Storefront-wide wholesale checks.

    step_schema covers per-product invariants. These are the surfaces no single
    PDP can see: the contact page that receives the enquiry, the llms.txt an AI
    crawler reads first, and the shopping feeds a wholesale product must stay out
    of. Each is a place where the audience split can half-ship: a product can
    correctly hide its price while the feed still advertises it, or the CTA can
    point at a contact page that never grew a form.
    """
    step("Step 3.4/4: Wholesale surfaces (contact form, llms.txt, feed exclusion)")

    # Two different sets, and conflating them is the trap.
    #
    #   wholesale-only  → carries the GoodRelations eligibleCustomerType in its
    #                     JSON-LD. These must be absent from consumer feeds.
    #   trade-capable   → wholesale-only PLUS "both". A "both" product keeps its
    #                     ordinary consumer offer and emits no GoodRelations
    #                     marker, but it DOES carry a trade CTA, so it justifies
    #                     the contact-page section on its own.
    #
    # Detecting only the first set and concluding "no wholesale here" would fail
    # a storefront whose products are all "both", which is the likeliest real
    # configuration for a bakery selling retail and to restaurants.
    pdps = sorted(glob.glob(f"{STOREFRONT_DIR}/products/*.html"))
    wholesale_slugs = []
    trade_capable = 0
    for pdp in pdps:
        with open(pdp, encoding="utf-8") as fp:
            html = fp.read()
        if "contact.html#trade" in html:
            trade_capable += 1
        if "goodrelations" in html.lower():
            # Match on the filename stem, which is slug + the product id suffix and
            # is what every feed emits as its item id. Matching on the DISPLAY NAME
            # would be brittle: a retail "Adult Welding Gloves XL" legitimately in a
            # feed contains the wholesale "Adult Welding Gloves" as a substring, and
            # would fail this check for no reason.
            wholesale_slugs.append(os.path.splitext(os.path.basename(pdp))[0])

    # A storefront with nothing trade-capable must not sprout a trade section.
    # Silence here is the correct result, not a skipped check.
    contact_path = f"{STOREFRONT_DIR}/contact.html"
    contact = ""
    if os.path.exists(contact_path):
        with open(contact_path, encoding="utf-8") as fp:
            contact = fp.read()

    if trade_capable == 0:
        if 'id="trade"' in contact:
            fail("contact.html renders a trade section but no product is marked wholesale or both")
        else:
            ok("no trade-capable products; contact page correctly has no trade section")
        return

    failures = 0

    # The CTA on every wholesale PDP points at this anchor. If the section is not
    # here the link is a dead scroll and the enquiry path is broken end to end.
    if 'id="trade"' not in contact:
        fail("trade-capable products exist but contact.html has no #trade section for their CTA to reach")
        failures += 1
    if "D2C_TRADE_SUBMIT" not in contact:
        fail("contact.html trade section has no submit handler")
        failures += 1
    # The honeypot is the only spam defence on a public form.
    if 'name="website"' not in contact:
        fail("contact.html trade form has no honeypot field")
        failures += 1

    # llms.txt is what an AI crawler reads to answer "does this company sell
    # wholesale". The per-product .md files say it too, but the index is what
    # gets read first.
    llms_path = f"{STOREFRONT_DIR}/llms.txt"
    if os.path.exists(llms_path):
        with open(llms_path, encoding="utf-8") as fp:
            llms = fp.read()
        if "Wholesale:" not in llms:
            fail("llms.txt does not declare wholesale availability")
            failures += 1
        if "contact.html#trade" not in llms:
            fail("llms.txt does not tell an AI crawler where to request a trade account")
            failures += 1

    # Shopping feeds are consumer ad surfaces. A wholesale product in one buys
    # clicks to a page with no price and no cart: real money, guaranteed bounce.
    feeds = sorted(glob.glob(f"{STOREFRONT_DIR}/feeds/*"))
    for feed in feeds:
        with open(feed, encoding="utf-8") as fp:
            body = fp.read()
        for slug in wholesale_slugs:
            if slug and slug in body:
                fail(f"{os.path.basename(feed)} advertises wholesale-only product {slug!r}")
                failures += 1

    if failures == 0:
        ok(f"{trade_capable} trade-capable product(s) ({len(wholesale_slugs)} wholesale-only): "
           f"contact form present, llms.txt declares it, "
           f"wholesale-only absent from all {len(feeds)} feed(s)")


# ─── Step 3.5: Tracking wiring (ad-conversion funnel signals) ────────────────
def step_tracking():
    step("Step 3.5/4: Tracking wiring (ViewContent / InitiateCheckout funnel signals)")

    # Shared trackers live at the storefront root; PDPs load ../tracker.js.
    tracker_path = f"{STOREFRONT_DIR}/tracker.js"
    customer_path = f"{STOREFRONT_DIR}/customer.js"
    for label, p in (("tracker.js", tracker_path), ("customer.js", customer_path)):
        if not os.path.exists(p):
            fail(f"tracking: {label} missing from regenerated storefront (stale binary or copy failure?)")
            return

    with open(tracker_path, encoding="utf-8") as fp:
        tracker = fp.read()
    with open(customer_path, encoding="utf-8") as fp:
        customer = fp.read()

    wiring_ok = True
    for needle, desc in (
        ("trackViewContent", "tracker.js exposes trackViewContent"),
        ("trackInitiateCheckout", "tracker.js exposes trackInitiateCheckout"),
        ("'view_content'", "tracker.js fires view_content"),
        ("'initiate_checkout'", "tracker.js fires initiate_checkout"),
        # gclid is Google Ads' mandatory match key: no gclid on the event → the
        # server-side Google dispatcher skips ('google: no gclid'). A regen that
        # drops this capture silently breaks Google conversions, so assert it.
        ("'gclid'", "tracker.js captures gclid (required for Google Ads conversions)"),
        ("clickIds", "tracker.js forwards clickIds on the event payload"),
    ):
        if needle not in tracker:
            fail(f"tracking: {desc} — '{needle}' not found in tracker.js")
            wiring_ok = False
    if "trackInitiateCheckout" not in customer:
        fail("tracking: customer.js does not call trackInitiateCheckout")
        wiring_ok = False

    # Every PDP must expose the product context ViewContent reads on load.
    pdps = sorted(glob.glob(f"{STOREFRONT_DIR}/products/*.html"))
    if not pdps:
        fail("tracking: no PDPs found to check window.D2C_PRODUCT")
        return
    missing_ctx = []
    for p in pdps:
        with open(p, encoding="utf-8") as fp:
            if "window.D2C_PRODUCT" not in fp.read():
                missing_ctx.append(os.path.basename(p))
    if missing_ctx:
        fail(f"tracking: {len(missing_ctx)} PDP(s) missing window.D2C_PRODUCT "
             f"(ViewContent has no product id): {missing_ctx[:3]}")
        wiring_ok = False

    if wiring_ok:
        ok(f"tracking wiring present: ViewContent+InitiateCheckout senders, events fired, "
           f"gclid+clickIds captured (Google Ads), {len(pdps)} PDPs expose D2C_PRODUCT")


# ─── Step 4: Lighthouse against served storefront ───────────────────────────
def _start_local_server():
    """Serve storefront dir on HTTP_PORT in a background thread."""
    os.chdir(STOREFRONT_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *a, **k: None  # quiet
    httpd = socketserver.TCPServer(("", HTTP_PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def _run_lighthouse(url):
    """Run Lighthouse mobile against URL, return scores dict."""
    out = f"/tmp/lh-{int(time.time()*1000)}.json"
    r = subprocess.run(
        [
            "lighthouse", url,
            "--output=json", f"--output-path={out}",
            "--form-factor=mobile", "--throttling-method=simulate",
            "--only-categories=performance,accessibility,best-practices,seo",
            "--chrome-flags=--headless --no-sandbox --disable-gpu",
            "--quiet",
        ],
        capture_output=True, text=True, timeout=180,
    )
    if r.returncode != 0:
        raise Exception(f"lighthouse exit {r.returncode}: {r.stderr[:200]}")
    with open(out) as fp:
        lh = json.load(fp)
    return {
        k: round(lh["categories"].get(k, {}).get("score", 0) * 100)
        for k in ("performance", "accessibility", "best-practices", "seo")
    }


def step_lighthouse():
    step("Step 4/4: Lighthouse (mobile: PDP+reviews, PDP-no-reviews, listing, blog post, blog index)")

    if not os.path.exists(STOREFRONT_DIR):
        fail("storefront dir missing — skipping Lighthouse")
        return

    # Find one PDP with reviews and one without (gives us coverage of both code paths).
    # Skip PDPs that render the .no-img placeholder — missing product image is a
    # merchant catalog state, not a platform regression, and the placeholder fails
    # Lighthouse color-contrast in a way the platform shouldn't be gated on.
    pdps = sorted(glob.glob(f"{STOREFRONT_DIR}/products/*.html"))
    pdp_with_reviews = None
    pdp_without_reviews = None
    for p in pdps:
        with open(p, encoding="utf-8") as fp:
            html = fp.read()
        if 'class="no-img"' in html:
            continue
        if "aggregateRating" in html and pdp_with_reviews is None:
            pdp_with_reviews = p
        elif "aggregateRating" not in html and pdp_without_reviews is None:
            pdp_without_reviews = p
        if pdp_with_reviews and pdp_without_reviews:
            break

    targets = []
    if pdp_with_reviews:
        targets.append(("PDP with reviews", os.path.basename(pdp_with_reviews)))
    if pdp_without_reviews:
        targets.append(("PDP without reviews", os.path.basename(pdp_without_reviews)))
    targets.append(("Listing", "../products.html"))

    # Blog post + index (optional — skip if no blog content yet).
    blog_posts = sorted(
        p for p in glob.glob(f"{STOREFRONT_DIR}/blog/*.html")
        if os.path.basename(p) not in ("index.html",)
        and os.path.basename(os.path.dirname(p)) == "blog"
    )
    blog_index_exists = os.path.exists(f"{STOREFRONT_DIR}/blog/index.html")
    blog_targets = []
    if blog_posts:
        blog_targets.append(("Blog post", os.path.basename(blog_posts[0]), "blog"))
    if blog_index_exists:
        blog_targets.append(("Blog index", "index.html", "blog"))

    httpd = _start_local_server()
    try:
        # Storefront targets (existing thresholds).
        for label, rel in targets:
            url = f"http://localhost:{HTTP_PORT}/products/{rel}"
            if rel.startswith("../"):
                url = f"http://localhost:{HTTP_PORT}/{rel[3:]}"
            try:
                scores = _run_lighthouse(url)
            except Exception as e:
                fail(f"{label}: Lighthouse failed — {e}")
                continue

            score_str = f"P{scores['performance']} A{scores['accessibility']} BP{scores['best-practices']} S{scores['seo']}"
            regressions = []
            if scores["accessibility"] < LH_MIN_ACCESSIBILITY:
                regressions.append(f"A11y {scores['accessibility']} < {LH_MIN_ACCESSIBILITY}")
            if scores["performance"] < LH_MIN_PERFORMANCE:
                regressions.append(f"Perf {scores['performance']} < {LH_MIN_PERFORMANCE}")
            if scores["best-practices"] < LH_MIN_BEST_PRACTICES:
                regressions.append(f"BP {scores['best-practices']} < {LH_MIN_BEST_PRACTICES}")
            if scores["seo"] < LH_MIN_SEO:
                regressions.append(f"SEO {scores['seo']} < {LH_MIN_SEO}")

            if regressions:
                fail(f"{label} ({score_str}): {', '.join(regressions)}")
            else:
                ok(f"{label} ({score_str})")

        # Blog targets (stricter thresholds — designed for 100/100/100/100).
        for label, filename, subdir in blog_targets:
            url = f"http://localhost:{HTTP_PORT}/{subdir}/{filename}"
            try:
                scores = _run_lighthouse(url)
            except Exception as e:
                fail(f"{label}: Lighthouse failed — {e}")
                continue

            score_str = f"P{scores['performance']} A{scores['accessibility']} BP{scores['best-practices']} S{scores['seo']}"
            regressions = []
            if scores["accessibility"] < LH_BLOG_MIN_ACCESSIBILITY:
                regressions.append(f"A11y {scores['accessibility']} < {LH_BLOG_MIN_ACCESSIBILITY}")
            if scores["performance"] < LH_BLOG_MIN_PERFORMANCE:
                regressions.append(f"Perf {scores['performance']} < {LH_BLOG_MIN_PERFORMANCE}")
            if scores["best-practices"] < LH_BLOG_MIN_BEST_PRACTICES:
                regressions.append(f"BP {scores['best-practices']} < {LH_BLOG_MIN_BEST_PRACTICES}")
            if scores["seo"] < LH_BLOG_MIN_SEO:
                regressions.append(f"SEO {scores['seo']} < {LH_BLOG_MIN_SEO}")

            if regressions:
                fail(f"{label} ({score_str}): {', '.join(regressions)}")
            else:
                ok(f"{label} ({score_str})")
    finally:
        httpd.shutdown()


# ─── Main ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"{YELLOW}═══════════════════════════════════════════════════════════════{NC}")
    print(f"{YELLOW}  uSetGo Storefront Pre-Commit Validation{NC}")
    print(f"{YELLOW}═══════════════════════════════════════════════════════════════{NC}")

    start = time.time()
    step_clean()
    step_regenerate()
    if failed == 0:
        step_tenant_isolation()
        step_schema()
        step_wholesale()
        step_tracking()
        step_lighthouse()
    elapsed = time.time() - start

    print()
    print(f"{YELLOW}═══════════════════════════════════════════════════════════════{NC}")
    color = GREEN if failed == 0 else RED
    print(f"  {color}PASSED: {passed}  FAILED: {failed}{NC}  Time: {elapsed:.1f}s")
    print(f"{YELLOW}═══════════════════════════════════════════════════════════════{NC}")
    if failed > 0:
        print(f"\n{RED}Failures:{NC}")
        for e in errors:
            print(f"  {RED}•{NC} {e}")
        sys.exit(1)
    sys.exit(0)
