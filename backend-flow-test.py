#!/usr/bin/env python3
"""
BusinessCart Backend Flow Test
Tests portal + storefront + enforcement flows sequentially.
Cleans up test data on success or failure (try/finally).

Usage:
  python3 backend-flow-test.py                          # default localhost:3000
  python3 backend-flow-test.py --base-url http://...    # custom URL
  python3 backend-flow-test.py --cleanup-only           # just cleanup
"""

import argparse
import base64
import datetime
import json
import sys
import time

import requests

# ── Test data (unique prefix to avoid collision) ──────────────────────

PREFIX = "__TEST__"
PASSWORD = "Test@Secure1"

USERS = {
    "admin":     {"email": f"{PREFIX}admin@test.com",     "name": f"{PREFIX} Admin",           "role": "admin"},
    "company1":  {"email": f"{PREFIX}company1@test.com",  "name": f"{PREFIX} Alpha Corp",      "role": "company"},
    "company2":  {"email": f"{PREFIX}company2@test.com",  "name": f"{PREFIX} Beta Corp",       "role": "company"},
    "customer":  {"email": f"{PREFIX}customer@test.com",  "name": f"{PREFIX} Customer One",    "role": "customer"},
    "customer2": {"email": f"{PREFIX}customer2@test.com", "name": f"{PREFIX} Customer Two",    "role": "customer"},
    # Third B2B buyer, used as a second eligible approver on one approval level so
    # the "any one of several can clear a step" rule is tested for real.
    "customer3": {"email": f"{PREFIX}customer3@test.com", "name": f"{PREFIX} Customer Three",  "role": "customer"},
    "b2c":       {"email": f"{PREFIX}b2c@test.com",       "name": f"{PREFIX} B2C Shopper",     "role": "b2c"},
}

CODES = {
    "set1": {"companyCode": f"{PREFIX}-COMP-1", "customerCode": f"{PREFIX}-CUST-1"},
    "set2": {"companyCode": f"{PREFIX}-COMP-2", "customerCode": f"{PREFIX}-CUST-2", "partnerCode": f"{PREFIX}-PART-2"},
}

# company code used at registration
USER_CODES = {
    "company1":  CODES["set1"]["companyCode"],
    "company2":  CODES["set2"]["companyCode"],
    "customer":  CODES["set1"]["customerCode"],
    "customer2": f'{CODES["set1"]["customerCode"]},{CODES["set2"]["customerCode"]}',
    "customer3": CODES["set1"]["customerCode"],
    "b2c":       CODES["set1"]["companyCode"],
}

# ── Colors ────────────────────────────────────────────────────────────

RED = "\033[0;31m"
GREEN = "\033[0;32m"
CYAN = "\033[0;36m"
YELLOW = "\033[0;33m"
BOLD = "\033[1m"
NC = "\033[0m"


def phase(msg):
    print(f"\n{BOLD}{CYAN}{'═' * 60}{NC}")
    print(f"{BOLD}{CYAN}  {msg}{NC}")
    print(f"{BOLD}{CYAN}{'═' * 60}{NC}")


def step(msg):
    print(f"\n{CYAN}  ── {msg}{NC}")


def ok(msg):
    print(f"  {GREEN}✓ {msg}{NC}")


def warn(msg):
    print(f"  {YELLOW}⚠ {msg}{NC}")


def fail(msg):
    print(f"  {RED}✗ {msg}{NC}")


# ── Assertion helpers ─────────────────────────────────────────────────

class AssertionError(Exception):
    pass


def assert_status(resp, expected, context=""):
    if resp.status_code != expected:
        body = resp.text[:500]
        raise AssertionError(
            f"{context}: expected HTTP {expected}, got {resp.status_code}\n  Body: {body}"
        )


def assert_status_in(resp, expected_list, context=""):
    if resp.status_code not in expected_list:
        body = resp.text[:500]
        raise AssertionError(
            f"{context}: expected HTTP {expected_list}, got {resp.status_code}\n  Body: {body}"
        )


def assert_field(data, field, expected, context=""):
    actual = data.get(field)
    if actual != expected:
        raise AssertionError(
            f"{context}: expected {field}={expected}, got {actual}"
        )


def assert_gt(actual, threshold, context=""):
    if not actual > threshold:
        raise AssertionError(f"{context}: expected > {threshold}, got {actual}")


def assert_contains(text, substring, context=""):
    if substring.lower() not in text.lower():
        raise AssertionError(f"{context}: expected '{substring}' in '{text[:200]}'")


# ── API Client ────────────────────────────────────────────────────────

class APIClient:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.token = None

    def set_token(self, token):
        self.token = token
        self.session.headers["Authorization"] = f"Bearer {token}"

    def clear_token(self):
        self.token = None
        self.session.headers.pop("Authorization", None)

    def get(self, path, **kwargs):
        return self.session.get(f"{self.base_url}{path}", **kwargs)

    def post(self, path, json_data=None, **kwargs):
        return self.session.post(f"{self.base_url}{path}", json=json_data, **kwargs)

    def patch(self, path, json_data=None, **kwargs):
        return self.session.patch(f"{self.base_url}{path}", json=json_data, **kwargs)

    def put(self, path, json_data=None, **kwargs):
        return self.session.put(f"{self.base_url}{path}", json=json_data, **kwargs)

    def delete(self, path, **kwargs):
        return self.session.delete(f"{self.base_url}{path}", **kwargs)

    def decode_jwt(self, token=None):
        t = token or self.token
        payload = t.split(".")[1]
        padding = 4 - len(payload) % 4
        payload += "=" * padding
        return json.loads(base64.b64decode(payload))


# ── Resource tracker ──────────────────────────────────────────────────

class Tracker:
    def __init__(self):
        self.accounts = []   # (role_key, account_id)
        self.products = []   # (owner_role_key, product_id)
        self.orders = []     # order_id
        self.codes = []      # company_code string (used for DELETE /codes/{code})
        self.visitors = []   # visitor_id string
        self.statements = [] # statement_id string
        self.blog_posts = [] # (owner_role_key, blog_post_id)

    def track_account(self, role_key, account_id):
        self.accounts.append((role_key, account_id))

    def track_product(self, role_key, product_id):
        self.products.append((role_key, product_id))

    def track_order(self, order_id):
        self.orders.append(order_id)

    def track_visitor(self, visitor_id):
        if visitor_id not in self.visitors:
            self.visitors.append(visitor_id)

    def track_code(self, company_code):
        if company_code not in self.codes:
            self.codes.append(company_code)

    def track_statement(self, statement_id):
        if statement_id not in self.statements:
            self.statements.append(statement_id)

    def track_blog_post(self, role_key, blog_post_id):
        self.blog_posts.append((role_key, blog_post_id))


# ── Test runner ───────────────────────────────────────────────────────

class BackendFlowTest:
    def __init__(self, base_url):
        self.api = APIClient(base_url)
        self.tracker = Tracker()
        self.jwts = {}       # role_key -> token
        self.ids = {}        # role_key -> account_id
        self.product_ids = {}  # role_key -> [product_ids]
        self.passed = 0
        self.failed = 0

    # ── Helpers ───────────────────────────────────────────────────

    def _login(self, email):
        resp = self.api.post("/accounts/login", {"email": email, "password": PASSWORD})
        if resp.status_code == 200:
            data = resp.json()
            return data["accessToken"]
        return None

    def _get_id_from_jwt(self, token):
        claims = self.api.decode_jwt(token)
        return claims["user"]["id"]

    def _get_configs_from_jwt(self, token):
        claims = self.api.decode_jwt(token)
        return claims["user"].get("configurations", [])

    def login_or_register(self, role_key):
        """Idempotent: try login first, register if needed."""
        user = USERS[role_key]
        step(f"Login or register: {role_key} ({user['email']})")

        token = self._login(user["email"])
        if token:
            ok(f"Logged in {role_key}")
            self.jwts[role_key] = token
            self.ids[role_key] = self._get_id_from_jwt(token)
            self.api.set_token(token)
            return

        # Register
        payload = {
            "name": user["name"],
            "email": user["email"],
            "password": PASSWORD,
            "role": user["role"],
        }

        codes_str = USER_CODES.get(role_key)
        if user["role"] == "company" and codes_str:
            payload["code"] = codes_str
            payload["companyName"] = user["name"]
        elif user["role"] == "b2c" and codes_str:
            payload["code"] = codes_str
        elif user["role"] == "customer" and codes_str:
            payload["customerCodes"] = [c.strip() for c in codes_str.split(",")]

        resp = self.api.post("/accounts/register", payload)
        assert_status(resp, 201, f"Register {role_key}")
        ok(f"Registered {role_key}")

        # Login to get JWT
        token = self._login(user["email"])
        if not token:
            raise AssertionError(f"Login failed after registration for {role_key}")

        self.jwts[role_key] = token
        self.ids[role_key] = self._get_id_from_jwt(token)
        self.tracker.track_account(role_key, self.ids[role_key])
        self.api.set_token(token)

    def use_token(self, role_key):
        """Switch API client to use a specific user's token."""
        self.api.set_token(self.jwts[role_key])

    # Accounts created mid-run by joining an organisation, rather than registered
    # up front. Kept out of USERS so the startup loop does not try to register
    # them with a role and code they do not have.
    JOINED_EMAILS = {}

    def re_login(self, role_key):
        """Re-login to get fresh JWT with updated config."""
        email = self.JOINED_EMAILS.get(role_key) or USERS[role_key]["email"]
        token = self._login(email)
        if not token:
            raise AssertionError(f"Re-login failed for {role_key}")
        self.jwts[role_key] = token
        self.api.set_token(token)
        ok(f"Re-logged in {role_key}")

    def run_test(self, name, fn):
        """Run a test function, track pass/fail."""
        step(name)
        try:
            fn()
            self.passed += 1
        except (AssertionError, Exception) as e:
            fail(f"FAILED: {name}\n    {e}")
            self.failed += 1

    # ── Phase 1: Setup accounts ──────────────────────────────────

    def phase1_setup(self):
        phase("PHASE 1: Setup Accounts")

        # Admin first
        self.login_or_register("admin")

        # Create codes
        for key, code_set in CODES.items():
            step(f"Create codes: {key}")
            self.use_token("admin")
            resp = self.api.post("/codes", code_set)
            if resp.status_code == 201:
                ok(f"Codes created: {code_set['companyCode']}")
                self.tracker.track_code(code_set["companyCode"])
            elif resp.status_code == 409:
                warn(f"Codes already exist: {code_set['companyCode']}")
                self.tracker.track_code(code_set["companyCode"])
            else:
                assert_status_in(resp, [201, 409], f"Create codes {key}")

        # Register companies
        self.login_or_register("company1")
        self.login_or_register("company2")

        # Register customers
        self.login_or_register("customer")
        self.login_or_register("customer2")
        self.login_or_register("customer3")

        # Register B2C
        self.login_or_register("b2c")

        ok(f"All accounts ready. IDs: { {k: v[:8]+'...' for k,v in self.ids.items()} }")

    # ── Phase 2: Company settings ────────────────────────────────

    def phase2_company_settings(self):
        phase("PHASE 2: Company Settings")

        self.use_token("company1")
        c1_id = self.ids["company1"]

        step("Set company1 enforcement defaults")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "company": {
                "creditLimit": 500,
                "minOrderAmountLimit": 20,
                "maxOrderAmountLimit": 1000,
                "minOrderQuantityLimit": 1,
                "maxOrderQuantityLimit": 50,
                "monthlyOrderLimit": 10,
                "yearlyOrderLimit": 50,
                "taxableGoods": True,
                "taxRate": 8.25,
                "shippingRate": 15.00,
                "leadTime": 3,
                "quotesAllowed": True,
                "paymentMethods": ["credit_card", "purchase_order"],
                "deliveryMethods": ["pickup", "shipping_out"],
                "shippingOutOptions": ["standard"],
            }
        })
        assert_status(resp, 200, "Update company1 settings")
        ok("Company1 defaults set")

        # API-first contract: backend rejects type mismatches at the boundary so
        # the DB never holds invalid state. The actual prod-bug shape was empty
        # string for shippingRate (frontend cleared <input type=number>), which
        # silently corrupted the doc and 500'd every later admin GET /accounts.
        step("Reject empty string for numeric field (the actual prod bug shape)")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "company": {"shippingRate": ""},
        })
        assert_status(resp, 400, "Empty string for numeric field")
        ok("Empty string for shippingRate rejected with 400")

        step("Reject string for boolean field")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "company": {"taxableGoods": "yes"},
        })
        assert_status(resp, 400, "String for boolean field")
        ok("String for taxableGoods rejected with 400")

        step("Backward compat: null clears a numeric field (still allowed)")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "company": {"leadTime": None},
        })
        assert_status(resp, 200, "Null for numeric field accepted")
        ok("Null for leadTime accepted (backward compatible)")

        # Re-set leadTime so downstream tests have the value they expect
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "company": {"leadTime": 3},
        })
        assert_status(resp, 200, "Restore leadTime")

        step("Set customer override (creditLimit: 300)")
        cust_id = self.ids["customer"]
        resp = self.api.patch(f"/customers/{cust_id}/configuration", {
            "creditLimit": 300,
        })
        assert_status(resp, 200, "Set customer config override")
        ok("Customer override set: creditLimit=300")

        # Ad-platform conversion credentials (Meta CAPI). Verify the whole
        # contract: creds accepted, masked info returned, the secret token is
        # NEVER serialized back, and enable/disable toggles independently.
        self.use_token("company1")
        secret_token = "EAAflowtest_secret_token_9911"
        step("Ad conversions: save Meta creds (encrypted)")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "adConversions": {"meta": {"pixel_id": "111222333444", "access_token": secret_token}},
            "adConversionsEnabled": {"meta": True},
        })
        assert_status(resp, 200, "Save Meta conversion creds")
        ok("Meta creds saved")

        step("Ad conversions: masked read + no token leak")
        resp = self.api.get(f"/accounts/{c1_id}")
        assert_status(resp, 200, "Get account after conversion save")
        acc = resp.json()
        info = (acc.get("adConversionsInfo") or {}).get("meta") or {}
        assert info.get("configured") is True, f"meta not configured: {info}"
        assert info.get("enabled") is True, f"meta not enabled: {info}"
        assert info.get("pixelId") == "111222333444", f"pixelId: {info.get('pixelId')}"
        assert info.get("tokenLast4") == "9911", f"tokenLast4: {info.get('tokenLast4')}"
        assert secret_token not in resp.text, "SECURITY: full access token leaked in GET account"
        assert "adConversions" not in acc, "raw adConversions must not be serialized (json:\"-\")"
        ok("Masked info returned; full token never leaked; raw creds hidden")

        step("Ad conversions: pause (disable) without re-entering the token")
        resp = self.api.patch(f"/accounts/{c1_id}", {"adConversionsEnabled": {"meta": False}})
        assert_status(resp, 200, "Disable Meta conversions")
        info = ((self.api.get(f"/accounts/{c1_id}").json().get("adConversionsInfo") or {}).get("meta")) or {}
        assert info.get("enabled") is False, f"meta should be disabled: {info}"
        assert info.get("configured") is True, "creds must persist after disable"
        assert info.get("tokenLast4") == "9911", "token must persist after disable"
        ok("Disable flips enabled=false while creds persist")

        step("Ad conversions: rotate token only, pixel_id must survive (partial-update #1)")
        new_token = "EAAflowtest_rotated_token_7788"
        resp = self.api.patch(f"/accounts/{c1_id}", {"adConversions": {"meta": {"access_token": new_token}}})
        assert_status(resp, 200, "Update only access_token")
        info = ((self.api.get(f"/accounts/{c1_id}").json().get("adConversionsInfo") or {}).get("meta")) or {}
        assert info.get("pixelId") == "111222333444", f"pixel_id wiped by token-only update: {info.get('pixelId')}"
        assert info.get("tokenLast4") == "7788", f"token not rotated: {info.get('tokenLast4')}"
        assert info.get("configured") is True, "still configured after partial update"
        assert new_token not in resp.text, "SECURITY: rotated token leaked in PATCH response"
        ok("Token-only update rotated token, preserved pixel_id (no data loss)")

        # Google Ads conversions (Data Manager API). Same contract as Meta, but
        # the display-safe info surfaces the non-secret account/config IDs in
        # full (customerId, conversionActionId) while only the refresh_token is
        # hinted as last-4. Providers are independent: saving Google must not
        # disturb the Meta creds saved above.
        google_refresh = "1//flowtest_google_refresh_4455"
        step("Ad conversions: save Google creds (encrypted)")
        resp = self.api.patch(f"/accounts/{c1_id}", {
            "adConversions": {"google": {
                "client_id": "flowtest-client.apps.googleusercontent.com",
                "client_secret": "flowtest_client_secret",
                "refresh_token": google_refresh,
                "customer_id": "123-456-7890",
                "conversion_action_id": "555666777",
            }},
            "adConversionsEnabled": {"google": True},
        })
        assert_status(resp, 200, "Save Google conversion creds")
        ok("Google creds saved")

        step("Ad conversions: Google masked read + no secret leak")
        resp = self.api.get(f"/accounts/{c1_id}")
        assert_status(resp, 200, "Get account after Google conversion save")
        acc = resp.json()
        info = (acc.get("adConversionsInfo") or {}).get("google") or {}
        assert info.get("configured") is True, f"google not configured: {info}"
        assert info.get("enabled") is True, f"google not enabled: {info}"
        assert info.get("customerId") == "123-456-7890", f"customerId: {info.get('customerId')}"
        assert info.get("conversionActionId") == "555666777", f"conversionActionId: {info.get('conversionActionId')}"
        assert info.get("tokenLast4") == "4455", f"tokenLast4: {info.get('tokenLast4')}"
        assert google_refresh not in resp.text, "SECURITY: full refresh_token leaked in GET account"
        assert "flowtest_client_secret" not in resp.text, "SECURITY: client_secret leaked in GET account"
        # Meta must still be intact alongside Google (independent providers).
        meta_info = (acc.get("adConversionsInfo") or {}).get("meta") or {}
        assert meta_info.get("pixelId") == "111222333444", f"meta clobbered by google save: {meta_info}"
        ok("Google masked info returned; secrets never leaked; Meta untouched")

        step("Ad conversions: rotate Google refresh_token only, customer_id must survive (partial-update)")
        new_refresh = "1//flowtest_google_refresh_8899"
        resp = self.api.patch(f"/accounts/{c1_id}", {"adConversions": {"google": {"refresh_token": new_refresh}}})
        assert_status(resp, 200, "Update only Google refresh_token")
        info = ((self.api.get(f"/accounts/{c1_id}").json().get("adConversionsInfo") or {}).get("google")) or {}
        assert info.get("customerId") == "123-456-7890", f"customer_id wiped by token-only update: {info.get('customerId')}"
        assert info.get("conversionActionId") == "555666777", f"conversion_action_id wiped: {info.get('conversionActionId')}"
        assert info.get("tokenLast4") == "8899", f"refresh_token not rotated: {info.get('tokenLast4')}"
        assert info.get("configured") is True, "still configured after partial update"
        assert new_refresh not in resp.text, "SECURITY: rotated refresh_token leaked in PATCH response"
        ok("Token-only update rotated refresh_token, preserved customer/action IDs (no data loss)")

        # Guest checkout: a b2c register with NO password creates the account AND
        # returns a token in one call (one-step guest checkout). The account is
        # passwordless — it cannot be logged into until claimed via reset.
        self.use_token("admin")
        guest_email = f"{PREFIX}guest@test.com"
        step("Guest checkout: passwordless b2c register returns a token in one call")
        resp = self.api.post("/accounts/register", {
            "name": "Guest Shopper",
            "email": guest_email,
            "role": "b2c",
            "code": CODES["set1"]["companyCode"],
            # no password → guest
        })
        assert_status(resp, 201, "Guest b2c register (no password)")
        gbody = resp.json()
        assert gbody.get("accessToken"), f"guest register must return an accessToken in the same call: {gbody}"
        assert gbody.get("account"), f"guest register must return the account: {gbody}"
        guest_id = self._get_id_from_jwt(gbody["accessToken"])
        # Stash as a pseudo-role so phase 5 can drive the full guest checkout with it.
        self.jwts["guest"] = gbody["accessToken"]
        self.ids["guest"] = guest_id
        self.guest_email = guest_email
        self.tracker.track_account("guest", guest_id)
        ok("Guest register returned a token in one call (no separate login round-trip)")

        step("Guest account is passwordless: cannot be logged into with a guess")
        bad = self.api.post("/accounts/login", {"email": guest_email, "password": PASSWORD})
        assert bad.status_code == 401, f"passwordless guest must reject login, got {bad.status_code}"
        ok("Passwordless guest rejects login until claimed via password reset")

    # ── Phase 3: Catalog ─────────────────────────────────────────

    def phase3_catalog(self):
        phase("PHASE 3: Catalog")

        for role_key, count, prefix, base_price in [
            ("company1", 5, "Alpha", 10),
            ("company2", 5, "Beta", 12),
        ]:
            self.use_token(role_key)
            step(f"Check/create products for {role_key}")

            resp = self.api.get("/products")
            assert_status(resp, 200, f"Get products for {role_key}")
            existing = [p for p in resp.json() if p.get("name", "").startswith(f"{PREFIX}")]
            self.product_ids[role_key] = [p["_id"] for p in existing]

            if len(existing) >= count:
                ok(f"{role_key} already has {len(existing)} test products, skipping")
                continue

            for i in range(1, count + 1):
                name = f"{PREFIX} {prefix} Product {i}"
                slug = f"test-{prefix.lower()}-product-{i}"
                # Skip if already exists
                if any(p.get("name") == name for p in existing):
                    continue
                resp = self.api.post("/products", {
                    "name": name,
                    "slug": slug,
                    "price": base_price * i + 0.99,
                    "description": f"Test product {prefix} {i}",
                })
                assert_status_in(resp, [200, 201], f"Create product {name}")

            # Re-fetch to get real IDs (create response returns zero ObjectID)
            resp = self.api.get("/products")
            assert_status(resp, 200, f"Re-fetch products for {role_key}")
            created = [p for p in resp.json() if p.get("name", "").startswith(f"{PREFIX}")]
            self.product_ids[role_key] = [p["_id"] for p in created]
            for p in created:
                self.tracker.track_product(role_key, p["_id"])
            ok(f"Products ready for {role_key} ({len(created)} products)")

        # Verify visibility
        def test_visibility():
            cases = [
                ("admin", 10, ">="),
                ("company1", 5, ">="),
                ("company2", 5, ">="),
                ("customer", 5, ">="),
                ("customer2", 10, ">="),
            ]
            for role_key, expected, op in cases:
                self.use_token(role_key)
                resp = self.api.get("/products")
                assert_status(resp, 200, f"Get products as {role_key}")
                actual = len(resp.json())
                if actual < expected:
                    raise AssertionError(
                        f"Product visibility {role_key}: expected >= {expected}, got {actual}"
                    )
                ok(f"{role_key} sees {actual} products (expected >= {expected})")

        self.run_test("Product visibility per role", test_visibility)

        # Category hierarchy validation
        def test_category_hierarchy():
            self.use_token("company1")
            pid = self.product_ids["company1"][0]

            # One slash allowed (primary / sub)
            resp = self.api.put(f"/products/{pid}", {"category": "Gloves / Winter"})
            assert_status(resp, 200, "Category with one slash accepted")
            ok("Category 'Gloves / Winter' accepted")

            # Two slashes rejected
            resp = self.api.put(f"/products/{pid}", {"category": "A / B / C"})
            assert_status(resp, 400, "Category with two slashes rejected")
            ok("Category 'A / B / C' rejected")

            # Restore original
            resp = self.api.put(f"/products/{pid}", {"category": f"{PREFIX} Category"})
            assert_status(resp, 200, "Category restored")

        self.run_test("Category hierarchy validation", test_category_hierarchy)

        # Per-product quantity rules (Roadmap #39): min / increment (case pack) / max round-trip.
        def test_quantity_rules():
            pid = self.product_ids["company1"][0]
            self.use_token("company1")
            resp = self.api.put(f"/products/{pid}", {"minOrderQty": 10, "orderIncrement": 5, "maxOrderQty": 100})
            assert_status(resp, 200, "Set quantity rules on product")
            got = self.api.get(f"/products/{pid}").json()
            assert_field(got, "minOrderQty", 10, "minOrderQty round-trip")
            assert_field(got, "orderIncrement", 5, "orderIncrement round-trip")
            assert_field(got, "maxOrderQty", 100, "maxOrderQty round-trip")
            ok("Per-product quantity rules persist (min/increment/max)")
            # Reset so later cart/quote tests are unaffected.
            self.api.put(f"/products/{pid}", {"minOrderQty": 0, "orderIncrement": 0, "maxOrderQty": 0})
        self.run_test("Product quantity rules (min/increment/max) round-trip", test_quantity_rules)

        def test_product_faq():
            """Merchant-authored PDP Q&A (Roadmap #52).

            Covers the server contract the Go unit tests cannot: a real HTTP
            round-trip through Mongo. `count` is recomputed server-side, half-empty
            pairs are dropped, and the item cap holds, so a client cannot inflate
            how well documented a product looks or grow the embedded doc unbounded.
            """
            pid = self.product_ids["company1"][0]
            self.use_token("company1")

            resp = self.api.put(f"/products/{pid}", {"faq": {
                # A lie. The server must recompute this from the surviving items.
                "count": 99,
                "items": [
                    {"question": "  Rated to what temperature?  ", "answer": "  932F on the palm.  "},
                    {"question": "What size for large hands?", "answer": "Order XL."},
                    {"question": "Orphan question", "answer": "   "},
                    {"question": "", "answer": "Orphan answer"},
                ],
            }})
            assert_status(resp, 200, "Set product FAQ")

            got = self.api.get(f"/products/{pid}").json()
            faq = got.get("faq") or {}
            items = faq.get("items") or []
            assert len(items) == 2, f"expected 2 surviving FAQ items, got {len(items)}"
            assert faq.get("count") == 2, f"count must be recomputed to 2, got {faq.get('count')}"
            assert items[0]["question"] == "Rated to what temperature?", \
                f"question not trimmed: {items[0]['question']!r}"
            assert items[0]["answer"] == "932F on the palm.", \
                f"answer not trimmed: {items[0]['answer']!r}"
            assert items[0].get("createdAt"), "createdAt must be stamped server-side"
            ok("FAQ round-trips; count recomputed, half-empty pairs dropped, text trimmed")

            # Cap: 25 valid items in, at most 10 stored.
            resp = self.api.put(f"/products/{pid}", {"faq": {"items": [
                {"question": f"Q{i}", "answer": f"A{i}"} for i in range(25)
            ]}})
            assert_status(resp, 200, "Set oversized product FAQ")
            faq = (self.api.get(f"/products/{pid}").json().get("faq") or {})
            assert len(faq.get("items") or []) == 10, \
                f"expected the 10-item cap, got {len(faq.get('items') or [])}"
            assert faq.get("count") == 10, f"count must match the cap, got {faq.get('count')}"
            ok("FAQ item cap enforced server-side at 10")

            # Clearing works, and leaves nothing behind for later tests.
            resp = self.api.put(f"/products/{pid}", {"faq": {"items": []}})
            assert_status(resp, 200, "Clear product FAQ")
            faq = (self.api.get(f"/products/{pid}").json().get("faq") or {})
            assert not (faq.get("items") or []), "FAQ should be empty after clearing"
            ok("FAQ clears cleanly")
        self.run_test("Product FAQ round-trip, server-recomputed count and item cap", test_product_faq)

    # ── Phase 4: Re-login & JWT verification ─────────────────────

    def phase4_jwt_verification(self):
        phase("PHASE 4: Re-login & JWT Verification")

        def test_jwt_enforcement_values():
            self.re_login("customer")
            configs = self._get_configs_from_jwt(self.jwts["customer"])
            c1_id = self.ids["company1"]

            config = next((c for c in configs if c.get("company_id") == c1_id), None)
            if not config:
                raise AssertionError(f"No JWT config found for company {c1_id[:8]}...")

            # creditLimit should be 300 (customer override, not company default 500)
            if config.get("creditLimit") != 300:
                raise AssertionError(
                    f"JWT creditLimit: expected 300 (override), got {config.get('creditLimit')}"
                )
            ok("JWT creditLimit = 300 (customer override)")

            # minOrderAmountLimit should be 20 (resolved from company default)
            if config.get("minOrderAmountLimit") != 20:
                raise AssertionError(
                    f"JWT minOrderAmountLimit: expected 20, got {config.get('minOrderAmountLimit')}"
                )
            ok("JWT minOrderAmountLimit = 20 (company default resolved)")

            # leadTime should be 3
            if config.get("leadTime") != 3:
                raise AssertionError(
                    f"JWT leadTime: expected 3, got {config.get('leadTime')}"
                )
            ok("JWT leadTime = 3 (company default resolved)")

        self.run_test("JWT enforcement values after re-login", test_jwt_enforcement_values)

        def test_last_login_stamped():
            # Login stamps lastLogin and must NOT disturb updatedAt: updatedAt
            # answers "was this account ever configured", lastLogin answers "did
            # they ever come back". Collapsing the two loses both signals, which
            # is exactly the question that could not be answered for the first
            # real signup (2026-08-14, dormant at pending_setup).
            self.use_token("admin")
            c1_id = self.ids["company1"]
            before = self.api.get(f"/accounts/{c1_id}").json()
            before_updated = before.get("updatedAt")
            before_login = before.get("lastLogin")

            self.re_login("company1")

            self.use_token("admin")
            after = self.api.get(f"/accounts/{c1_id}").json()
            after_login = after.get("lastLogin")

            if not after_login:
                raise AssertionError("lastLogin not set after successful login")
            if before_login and after_login <= before_login:
                raise AssertionError(f"lastLogin did not advance: {before_login} -> {after_login}")
            ok(f"lastLogin stamped: {after_login}")

            if after.get("updatedAt") != before_updated:
                raise AssertionError(
                    f"login changed updatedAt ({before_updated} -> {after.get('updatedAt')}); "
                    "it must only reflect configuration changes"
                )
            ok("updatedAt untouched by login")

        self.run_test("Login stamps lastLogin without touching updatedAt", test_last_login_stamped)
        self.re_login("customer2")

    # ── Phase 5: Portal checkout happy path ──────────────────────

    def _get_product(self, role_key, product_id):
        """Fetch product details for cart item."""
        self.use_token(role_key)
        resp = self.api.get(f"/products/{product_id}")
        if resp.status_code == 200:
            return resp.json()
        return None

    def _add_to_cart(self, role_key, seller_id, product_id, qty):
        self.use_token(role_key)
        product = self._get_product(role_key, product_id)
        entity = {
            "productId": product_id,
            "sellerId": seller_id,
            "quantity": qty,
        }
        if product:
            entity["name"] = product.get("name", "")
            entity["price"] = product.get("price", 0)
            if product.get("images"):
                entity["image"] = product["images"][0]
            if product.get("partnerId"):
                entity["partnerId"] = product["partnerId"]
        resp = self.api.post("/checkout/cart", {"entity": entity})
        assert_status(resp, 200, f"Add to cart ({role_key})")
        return resp.json()

    def _clear_cart(self, role_key, seller_id):
        self.use_token(role_key)
        self.api.delete(f"/checkout/cart", params={"sellerId": seller_id})

    def _create_quote(self, role_key, seller_id, quote_type="standard",
                      extra_fields=None, account_id=None):
        self.use_token(role_key)
        payload = {
            "sellerId": seller_id,
            "paymentMethods": ["credit_card"],
            "deliveryMethods": ["pickup"],
            "shippingOutOptions": ["standard"],
            "quotesAllowed": True,
            "companyLocations": [],
            "customerAddresses": [],
            "quoteType": quote_type,
        }
        if account_id:
            payload["accountId"] = account_id
        if extra_fields:
            payload.update(extra_fields)
        return self.api.post("/checkout/quotes", payload)

    def phase5_happy_path(self):
        phase("PHASE 5: Portal Checkout — Happy Path")

        c1_id = self.ids["company1"]
        c2_id = self.ids["company2"]
        product_a = self.product_ids["company1"][0]
        product_c = self.product_ids["company2"][0]

        # 5a. Customer + Company1: standard quote
        # Product A is ~$10.99, need qty 3+ to clear minOrderAmount=20 after tax+shipping
        def test_customer_standard_quote():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 500, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 1000,
                "taxableGoods": True, "leadTime": 3,
            })
            assert_status(resp, 200, "Customer standard quote")
            data = resp.json()
            assert_gt(data.get("taxAmount", 0), 0, "Tax should be > 0")
            ok(f"Standard quote created: grandTotal=${data.get('grandTotal', 0):.2f}, tax=${data.get('taxAmount', 0):.2f}")
            if data.get("leadTime") == 3:
                ok("LeadTime = 3 on quote")
            else:
                warn(f"LeadTime = {data.get('leadTime')} (expected 3)")

        self.run_test("Customer standard quote (happy path)", test_customer_standard_quote)

        # 5b. Customer: negotiable quote
        def test_customer_negotiable_quote():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "negotiable", extra_fields={
                "quotesAllowed": True,
            })
            assert_status(resp, 200, "Customer negotiable quote")
            ok("Negotiable quote created (quotesAllowed=true)")

        self.run_test("Customer negotiable quote", test_customer_negotiable_quote)

        # 5c. Customer2 + Company1
        def test_customer2_company1():
            self._clear_cart("customer2", c1_id)
            self._add_to_cart("customer2", c1_id, product_a, 2)
            resp = self._create_quote("customer2", c1_id, "standard")
            assert_status(resp, 200, "Customer2 quote with company1")
            ok("Customer2 quote with company1 created")

        self.run_test("Customer2 + Company1 quote", test_customer2_company1)

        # 5d. Customer2 + Company2
        def test_customer2_company2():
            self._clear_cart("customer2", c2_id)
            self._add_to_cart("customer2", c2_id, product_c, 3)
            resp = self._create_quote("customer2", c2_id, "standard")
            assert_status(resp, 200, "Customer2 quote with company2")
            ok("Customer2 quote with company2 created")

        self.run_test("Customer2 + Company2 quote", test_customer2_company2)

        # 5e. Get orders per role
        def test_get_orders():
            for rk in ["admin", "company1", "company2"]:
                self.use_token(rk)
                resp = self.api.get("/checkout/orders")
                assert_status(resp, 200, f"Get orders as {rk}")
                data = resp.json()
                ok(f"{rk}: {len(data) if data else 0} orders")

        self.run_test("Get orders per role", test_get_orders)

        # 5f. PPC attribution: place an order with visitorId + click IDs and verify they persist
        def test_order_attribution():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            quote_resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 5000, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 5000,
            })
            assert_status(quote_resp, 200, "Quote for attribution test")
            quote_id = quote_resp.json().get("id")

            self.use_token("customer")
            order_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
                "visitorId": "v___test__attr_order",
                "clickIds": {"gclid": "ord_gclid_aaa", "msclkid": "ord_msclkid_bbb"},
            })
            assert_status(order_resp, 200, "Place order with attribution")
            o = order_resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, "order_id missing from response"
            self.tracker.track_order(order_id)

            # Assert attribution on POST response
            assert o.get("visitorId") == "v___test__attr_order", f"POST order.visitorId: {o.get('visitorId')}"
            click_ids = o.get("clickIds") or {}
            assert click_ids.get("gclid") == "ord_gclid_aaa", f"POST order.clickIds.gclid: {click_ids.get('gclid')}"
            assert click_ids.get("msclkid") == "ord_msclkid_bbb", f"POST order.clickIds.msclkid: {click_ids.get('msclkid')}"
            ok("POST response carries visitorId + clickIds")

            # GET back from /checkout/orders to confirm Mongo persistence (proves bson tags wrote correctly)
            self.use_token("admin")
            list_resp = self.api.get("/checkout/orders")
            assert_status(list_resp, 200, "List orders for persistence check")
            persisted = next((x for x in (list_resp.json() or []) if (x.get("id") or x.get("_id")) == order_id), None)
            assert persisted, f"Order {order_id} not found in GET /checkout/orders"
            assert persisted.get("visitorId") == "v___test__attr_order", f"persisted.visitorId: {persisted.get('visitorId')}"
            p_click = persisted.get("clickIds") or {}
            assert p_click.get("gclid") == "ord_gclid_aaa", f"persisted.clickIds.gclid: {p_click.get('gclid')}"
            assert p_click.get("msclkid") == "ord_msclkid_bbb", f"persisted.clickIds.msclkid: {p_click.get('msclkid')}"
            ok("Mongo-persisted order has visitorId + clickIds (gclid, msclkid)")

            # Orders export: wide window (yesterday to tomorrow) covers this just-placed order.
            now = datetime.datetime.now(datetime.timezone.utc)
            from_iso = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            to_iso = (now + datetime.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

            self.use_token("admin")
            # Generic format: full ledger; should include the just-placed order with email + visitorId + clickIds columns.
            gen_resp = self.api.get(f"/checkout/orders/export?format=generic&from={from_iso}&to={to_iso}")
            assert_status(gen_resp, 200, "Generic orders export")
            assert "text/csv" in gen_resp.headers.get("Content-Type", ""), f"content-type: {gen_resp.headers.get('Content-Type')}"
            gen_body = gen_resp.text
            assert "Order ID,Created (UTC),Status,Customer Email" in gen_body, "Generic CSV header mismatch"
            assert order_id in gen_body, "Generic CSV missing the order ID"
            assert "v___test__attr_order" in gen_body, "Generic CSV missing visitorId"
            assert "ord_gclid_aaa" in gen_body, "Generic CSV missing gclid column value"
            ok("Generic orders CSV includes order with attribution columns")

            # Google format: Ads offline-conversions shape; only orders with gclid.
            g_resp = self.api.get(f"/checkout/orders/export?format=google&from={from_iso}&to={to_iso}")
            assert_status(g_resp, 200, "Google orders export")
            g_body = g_resp.text
            assert "Parameters:TimeZone=+0000" in g_body, "Google CSV missing Parameters preamble"
            assert "Google Click ID,Conversion Name,Conversion Time,Order ID,Conversion Value,Conversion Currency" in g_body, "Google CSV header mismatch"
            assert "ord_gclid_aaa" in g_body, "Google CSV missing the test gclid"
            ok("Google Ads CSV includes attributed order")

            # Bing format: bulk offline conversions; only orders with msclkid.
            b_resp = self.api.get(f"/checkout/orders/export?format=bing&from={from_iso}&to={to_iso}")
            assert_status(b_resp, 200, "Bing orders export")
            b_body = b_resp.text
            assert "Type,Status,Id,Parent Id,Client Id,Name,Conversion Currency Code,Conversion Name,Conversion Time,Conversion Value,Microsoft Click Id" in b_body, "Bing CSV header mismatch"
            assert "Format Version,,,,,6.0,,,,," in b_body, "Bing CSV missing Format Version row"
            assert "ord_msclkid_bbb" in b_body, "Bing CSV missing the test msclkid"
            assert "Offline Conversion" in b_body, "Bing CSV missing Type literal"
            ok("Microsoft Ads CSV includes attributed order")

            # Bad input: unsupported format
            bad = self.api.get(f"/checkout/orders/export?format=tiktok&from={from_iso}&to={to_iso}")
            assert_status(bad, 400, "Unsupported format rejected")
            ok("Unsupported format rejected with 400")

            # Cross-company isolation: company2 must NOT see company1's orders.
            # The order was placed for sellerId=c1_id; company2 logs in and queries: handler forces
            # sellerId=their accountID (c2_id), so they see only their own (none in this case).
            self.use_token("company2")
            c2_resp = self.api.get(f"/checkout/orders/export?format=generic&from={from_iso}&to={to_iso}")
            assert_status(c2_resp, 200, "Company2 generic export call")
            assert order_id not in c2_resp.text, "ISOLATION BREACH: company2 saw company1's order"
            ok("Cross-company isolation: company2 cannot see company1's orders")

            # Even when company2 tries to override sellerId to company1's id, the handler MUST
            # ignore it and scope to their own accountID. If this assertion fails, any company
            # could exfiltrate every other tenant's orders by guessing sellerIds.
            c2_attempt = self.api.get(f"/checkout/orders/export?format=generic&from={from_iso}&to={to_iso}&sellerId={c1_id}")
            assert order_id not in c2_attempt.text, "ISOLATION BREACH: sellerId query override worked for company role"
            ok("Cross-company isolation: sellerId override ignored for company role")

            # Cancel so this purchase_order doesn't accrue credit balance for downstream credit-limit test (6e).
            self.use_token("company1")
            self.api.put(f"/checkout/orders/{order_id}", {"status": "cancelled"})

            # After cancel: PPC formats must exclude (cancelled orders corrupt ROAS bidding signals);
            # generic format must still include (full ledger view for accounting).
            self.use_token("admin")
            g2 = self.api.get(f"/checkout/orders/export?format=google&from={from_iso}&to={to_iso}")
            assert "ord_gclid_aaa" not in g2.text, "Google CSV still includes cancelled order"
            ok("Cancelled order excluded from Google Ads CSV")
            gen2 = self.api.get(f"/checkout/orders/export?format=generic&from={from_iso}&to={to_iso}")
            assert order_id in gen2.text, "Generic CSV missing cancelled order (should include for accounting)"
            ok("Cancelled order still in Generic CSV (ledger view preserved)")

        self.run_test("5f. Order PPC attribution + conversions export", test_order_attribution)

        # 5g. Coupon promo: SAVE5/SAVE10 hardcoded codes, gated by company CouponsEnabled.
        # Verifies (1) discount applied when enabled, (2) no discount when disabled (gate works),
        # (3) unknown code returns no discount, (4) case-insensitive normalization.
        def test_coupon_promo():
            base_extra = {
                "creditLimit": 5000, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 5000,
            }

            # 5g-1. SAVE10 with coupons enabled → 10% off subtotal
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                **base_extra, "promoCode": "SAVE10", "couponsEnabled": True,
            })
            assert_status(resp, 200, "Quote with SAVE10 + couponsEnabled=true")
            q = resp.json()
            subtotal = q.get("subtotal", 0)
            promo_discount = q.get("promoDiscount", 0)
            expected = subtotal * 0.10
            assert abs(promo_discount - expected) < 0.01, f"SAVE10 discount: expected {expected:.2f}, got {promo_discount:.2f}"
            assert q.get("promoCode") == "SAVE10", f"promoCode persisted: got {q.get('promoCode')}"
            assert abs(q.get("grandTotal", 0) - (subtotal + q.get("shippingCost", 0) + q.get("taxAmount", 0) - promo_discount)) < 0.01, "grandTotal must reflect discount"
            ok(f"SAVE10 enabled: subtotal=${subtotal:.2f}, discount=${promo_discount:.2f}")

            # 5g-2. SAVE10 with coupons DISABLED → no discount (gate works)
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                **base_extra, "promoCode": "SAVE10", "couponsEnabled": False,
            })
            assert_status(resp, 200, "Quote with SAVE10 + couponsEnabled=false")
            q = resp.json()
            assert q.get("promoDiscount", 0) == 0, f"BREACH: discount applied when couponsEnabled=false: {q.get('promoDiscount')}"
            ok("SAVE10 with coupons disabled: gate enforced, no discount")

            # 5g-3. Unknown code with coupons enabled → no discount
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                **base_extra, "promoCode": "FAKEXX", "couponsEnabled": True,
            })
            assert_status(resp, 200, "Quote with unknown code")
            q = resp.json()
            assert q.get("promoDiscount", 0) == 0, f"Unknown code gave discount: {q.get('promoDiscount')}"
            ok("Unknown code: no discount applied")

            # 5g-4. Lowercase 'save5' should normalize to SAVE5 → 5% off
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                **base_extra, "promoCode": "save5", "couponsEnabled": True,
            })
            assert_status(resp, 200, "Quote with lowercase save5")
            q = resp.json()
            subtotal = q.get("subtotal", 0)
            promo_discount = q.get("promoDiscount", 0)
            expected = subtotal * 0.05
            assert abs(promo_discount - expected) < 0.01, f"save5 discount: expected {expected:.2f}, got {promo_discount:.2f}"
            ok(f"Lowercase 'save5' normalized: discount=${promo_discount:.2f}")

        self.run_test("5g. Coupon promo (SAVE5/SAVE10, gating, case-insensitive)", test_coupon_promo)

        # 5h. Coupon end-to-end through email: place a real order with SAVE10,
        # then read Mailpit and assert the discount line + code rendered in the
        # customer confirmation AND the merchant new-order email. Pins the
        # money-field-through-every-read-path rule (templates render what was
        # denormalized onto the Order).
        def test_coupon_email_render():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            quote_resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 5000, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 5000,
                "promoCode": "SAVE10", "couponsEnabled": True,
            })
            assert_status(quote_resp, 200, "Quote with SAVE10 for email test")
            q = quote_resp.json()
            quote_id = q.get("id")
            promo_discount = q.get("promoDiscount", 0)
            assert promo_discount > 0, f"Quote must have a discount before placing order: {promo_discount}"

            self.use_token("customer")
            order_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            assert_status(order_resp, 200, "Place coupon order")
            o = order_resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, "order_id missing"
            self.tracker.track_order(order_id)

            # Order must carry promoCode + promoDiscount (denormalization)
            assert o.get("promoCode") == "SAVE10", f"order.promoCode: {o.get('promoCode')}"
            assert abs(o.get("promoDiscount", 0) - promo_discount) < 0.01, f"order.promoDiscount: {o.get('promoDiscount')}"
            ok(f"Order persisted promoCode=SAVE10, promoDiscount=${o.get('promoDiscount', 0):.2f}")

            # Mailpit: poll for the customer order confirmation. Merchant
            # new-order email needs an SSM EMAIL_COMPANY_CONFIGS entry which
            # only exists in prod, so locally only the customer email fires.
            # Merchant render path is pinned by templates_test.go.
            short_id = order_id[-6:]
            mailpit_url = "http://localhost:8025/api/v1/messages"
            customer_msg = None
            for _ in range(15):
                try:
                    r = requests.get(mailpit_url, params={"limit": 50}, timeout=2)
                    if r.status_code == 200:
                        for m in (r.json().get("messages", []) or []):
                            if m.get("Subject") == f"Order confirmation #{short_id}":
                                customer_msg = m
                                break
                        if customer_msg:
                            break
                except Exception:
                    pass
                time.sleep(0.5)

            assert customer_msg, f"Customer order confirmation #{short_id} not found in Mailpit"

            body_resp = requests.get(f"http://localhost:8025/api/v1/message/{customer_msg['ID']}", timeout=3)
            assert body_resp.status_code == 200, f"Mailpit fetch body: {body_resp.status_code}"
            body = body_resp.json()
            text = body.get("Text") or ""
            html = body.get("HTML") or ""

            assert f"Discount (SAVE10): -${promo_discount:.2f}" in text, \
                f"text body missing 'Discount (SAVE10): -${promo_discount:.2f}'\n--- text ---\n{text}\n"
            assert "Discount (SAVE10)" in html and f"-${promo_discount:.2f}" in html, \
                f"HTML body missing discount row\n--- html snippet ---\n{html[:1500]}\n"
            ok(f"Customer email renders Discount (SAVE10) -${promo_discount:.2f} in text + HTML")

            # Cancel so this order's grandTotal doesn't count against the
            # customer's outstanding balance for the credit-limit test (6e).
            self.use_token("admin")
            self.api.put(f"/checkout/orders/{order_id}", {"status": "cancelled"})

        self.run_test("5h. Coupon end-to-end: order email shows discount line", test_coupon_email_render)

        # 5i. Refund flow: partial then full, with input-validation guards.
        # Covers the append-only refunds[] pattern, auto status-transition to
        # "refunded" on full coverage, and the two PUT validation contracts
        # (status=refunded direct, refundAmount without stripeRefundID).
        def test_refund_flow():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 2)
            quote_resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 5000, "minOrderAmountLimit": 1, "maxOrderAmountLimit": 5000,
            })
            assert_status(quote_resp, 200, "Quote for refund flow")
            quote_id = quote_resp.json().get("id")

            self.use_token("customer")
            order_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            assert_status(order_resp, 200, "Place order for refund flow")
            o = order_resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, "order_id missing"
            self.tracker.track_order(order_id)
            grand_total = o.get("grandTotal", 0)
            assert grand_total > 1, f"grandTotal must be > 1 for split-refund: {grand_total}"
            ok(f"Refund-flow order placed: id={order_id} grandTotal=${grand_total:.2f}")

            self.use_token("admin")

            # Validation A: status=refunded without refundAmount must be rejected.
            bad_a = self.api.put(f"/checkout/orders/{order_id}", {"status": "refunded"})
            assert_status(bad_a, 400, "Direct status=refunded rejected")
            assert "refundAmount" in (bad_a.json().get("message") or ""), \
                f"Expected error to mention refundAmount: {bad_a.text}"
            ok("Validation: status=refunded without refundAmount rejected with 400")

            # Validation B: refundAmount > 0 without stripeRefundID must be rejected.
            bad_b = self.api.put(f"/checkout/orders/{order_id}", {"refundAmount": 1.00})
            assert_status(bad_b, 400, "refundAmount without stripeRefundID rejected")
            assert "stripeRefundID" in (bad_b.json().get("message") or ""), \
                f"Expected error to mention stripeRefundID: {bad_b.text}"
            ok("Validation: refundAmount without stripeRefundID rejected with 400")

            # Partial refund: half of grandTotal. Status must NOT transition.
            first_amount = round(grand_total / 2, 2)
            r1 = self.api.put(f"/checkout/orders/{order_id}", {
                "stripeRefundID": "re_test_first_xyz123",
                "refundAmount": first_amount,
                "refundReason": "partial qty adjustment",
            })
            assert_status(r1, 200, "Partial refund accepted")
            o1 = r1.json()
            refunds1 = o1.get("refunds") or []
            assert len(refunds1) == 1, f"Expected 1 refund after partial, got {len(refunds1)}: {refunds1}"
            assert abs(refunds1[0].get("amount", 0) - first_amount) < 0.01, \
                f"Refund amount mismatch: {refunds1[0].get('amount')} vs {first_amount}"
            assert o1.get("status") != "refunded", \
                f"Partial refund must not auto-transition status to refunded: {o1.get('status')}"
            ok(f"Partial refund stored: ${first_amount:.2f}, status remained '{o1.get('status')}'")

            # Cap check: try to refund more than remaining. Must fail with 400.
            remaining = grand_total - first_amount
            over = round(remaining + 5.00, 2)
            bad_c = self.api.put(f"/checkout/orders/{order_id}", {
                "stripeRefundID": "re_test_over_xyz",
                "refundAmount": over,
            })
            assert_status(bad_c, 400, "Over-cap refund rejected")
            ok(f"Cap enforcement: ${over:.2f} > remaining ${remaining:.2f} rejected with 400")

            # Final refund to clear the balance: status must auto-transition to refunded.
            r2 = self.api.put(f"/checkout/orders/{order_id}", {
                "stripeRefundID": "re_test_final_abc456",
                "refundAmount": round(remaining, 2),
                "refundReason": "balance refunded",
            })
            assert_status(r2, 200, "Final refund accepted")
            o2 = r2.json()
            refunds2 = o2.get("refunds") or []
            assert len(refunds2) == 2, f"Expected 2 refunds after final, got {len(refunds2)}"
            assert o2.get("status") == "refunded", \
                f"Full refund must auto-transition status to 'refunded', got '{o2.get('status')}'"
            ok("Full coverage auto-transitions status to 'refunded' and appends second refund record")

            # Cancel so this order doesn't pollute credit-limit accounting downstream.
            self.api.put(f"/checkout/orders/{order_id}", {"status": "cancelled"})

        self.run_test("5i. Refund flow: partial + full + validation guards", test_refund_flow)

        # 5j. Guest checkout end-to-end — the exact API sequence customer.js runs for a
        # passwordless guest: (register happened in phase 2) → save a shipping address →
        # cart → quote → place order (offline 'purchase_order' completes with no gateway
        # redirect). Proves a guest can complete a purchase and that the order is theirs.
        def test_guest_checkout_e2e():
            guest_id = self.ids["guest"]

            # 1. Save a shipping address — the endpoint the inline address form POSTs to.
            self.use_token("guest")
            addr_resp = self.api.post(f"/accounts/locations/{guest_id}", {
                "addressLabel": "Shipping",
                "recipientName": "Guest Shopper",
                "phoneNumber": "555-0100",
                "isDefaultShipping": True,
                "address": {"street": "1 Test St", "city": "Austin", "state": "TX", "zip": "78701"},
            })
            assert_status_in(addr_resp, (200, 201), "Guest saves shipping address")
            ok("Guest saved a shipping address")

            # 2. cart → quote → order
            self._clear_cart("guest", c1_id)
            self._add_to_cart("guest", c1_id, product_a, 3)
            quote_resp = self._create_quote("guest", c1_id, "standard", extra_fields={
                "creditLimit": 5000, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 5000,
            })
            assert_status(quote_resp, 200, "Guest quote")
            quote_id = quote_resp.json().get("id")
            assert quote_id, f"guest quote id missing: {quote_resp.json()}"

            self.use_token("guest")
            order_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            assert_status(order_resp, 200, "Guest place order")
            o = order_resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, f"guest order id missing: {o}"
            self.tracker.track_order(order_id)
            ok(f"Guest placed order {str(order_id)[:8]}…")

            # 3. Order is the guest's — the guest can retrieve it from their own orders.
            self.use_token("guest")
            my_orders = self.api.get(f"/checkout/orders?sellerId={c1_id}")
            assert_status(my_orders, 200, "Guest lists own orders")
            mine = next((x for x in (my_orders.json() or []) if (x.get("id") or x.get("_id")) == order_id), None)
            assert mine, f"guest order {order_id} not visible to the guest"
            ok("Guest checkout end-to-end: register → address → cart → quote → order, tied to guest")

        self.run_test("5j. Guest checkout end-to-end (register → address → cart → quote → order)", test_guest_checkout_e2e)

    # ── Phase 5b: Tiered pricing tests ─────────────────────────────

    def phase5b_tiered_pricing(self):
        phase("PHASE 5b: Tiered Pricing")

        c1_id = self.ids["company1"]

        # Create a product with tiers
        def test_create_tiered_product():
            self.use_token("company1")
            resp = self.api.post("/products", {
                "name": f"{PREFIX} Tiered Product",
                "slug": "test-tiered-product",
                "price": 20.00,
                "description": "Product with volume pricing",
                "priceTiers": [
                    {"minQty": 5, "price": 16.00},
                    {"minQty": 20, "price": 12.00},
                ],
            })
            assert_status_in(resp, [200, 201], "Create tiered product")
            ok("Tiered product created: base=$20, 5+=$16, 20+=$12")

            # Re-fetch to get real ID
            resp = self.api.get("/products")
            assert_status(resp, 200, "Fetch products")
            tiered = [p for p in resp.json() if p.get("name") == f"{PREFIX} Tiered Product"]
            if not tiered:
                raise AssertionError("Tiered product not found after creation")
            self._tiered_product_id = tiered[0]["_id"]
            self.tracker.track_product("company1", self._tiered_product_id)

            # Verify tiers are stored
            tiers = tiered[0].get("priceTiers", [])
            if len(tiers) != 2:
                raise AssertionError(f"Expected 2 tiers, got {len(tiers)}")
            ok(f"Product has {len(tiers)} tiers stored correctly")

        self.run_test("Create product with price tiers", test_create_tiered_product)

        # Validate tier validation rejects bad input
        def test_tier_validation():
            self.use_token("company1")
            # First tier minQty=1 should fail
            resp = self.api.post("/products", {
                "name": f"{PREFIX} Bad Tier",
                "slug": "test-bad-tier",
                "price": 10.00,
                "description": "Should fail",
                "priceTiers": [{"minQty": 1, "price": 8.00}],
            })
            assert_status(resp, 400, "Tier with minQty=1 rejected")
            ok("Validation: first tier minQty=1 rejected")

            # Unsorted tiers should fail
            resp = self.api.post("/products", {
                "name": f"{PREFIX} Bad Tier 2",
                "slug": "test-bad-tier-2",
                "price": 10.00,
                "description": "Should fail",
                "priceTiers": [{"minQty": 10, "price": 8.00}, {"minQty": 5, "price": 6.00}],
            })
            assert_status(resp, 400, "Unsorted tiers rejected")
            ok("Validation: unsorted tiers rejected")

        self.run_test("Tier validation rules", test_tier_validation)

        # Test cart with tiered product — qty below tier
        def test_cart_base_price():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, self._tiered_product_id, 2)

            self.use_token("customer")
            resp = self.api.get(f"/checkout/cart", params={"sellerId": c1_id})
            assert_status(resp, 200, "Get cart")
            cart = resp.json()
            item = cart["items"][0]
            # qty=2 < first tier minQty=5 → base price $20
            if abs(item.get("price", 0) - 20.0) > 0.01:
                raise AssertionError(f"Expected base price $20.00, got ${item.get('price')}")
            ok(f"Cart qty=2: price=${item['price']} (base price)")

        self.run_test("Cart at base price (qty below tier)", test_cart_base_price)

        # Test cart with tiered product — update qty into tier
        def test_cart_tier_price():
            self.use_token("customer")
            cart_resp = self.api.get(f"/checkout/cart", params={"sellerId": c1_id})
            cart = cart_resp.json()
            item_id = cart["items"][0]["id"]

            # Update to qty=5 → should hit first tier at $16
            resp = self.api.put(f"/checkout/cart/{item_id}",
                json_data={"entity": {"quantity": 5, "price": 16.00, "discountedPrice": 16.00}},
                params={"sellerId": c1_id})
            assert_status(resp, 200, "Update qty to 5")
            updated = resp.json()
            item = updated["items"][0]
            if abs(item.get("price", 0) - 16.0) > 0.01:
                raise AssertionError(f"Expected tier price $16.00, got ${item.get('price')}")
            expected_total = 16.0 * 5
            if abs(item.get("lineItemTotal", 0) - expected_total) > 0.01:
                raise AssertionError(f"Expected lineItemTotal ${expected_total}, got ${item.get('lineItemTotal')}")
            ok(f"Cart qty=5: price=${item['price']}, lineItemTotal=${item['lineItemTotal']} (tier 1)")

        self.run_test("Cart tier price on qty update", test_cart_tier_price)

        # Test quote with tiered pricing
        def test_quote_with_tiers():
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "taxableGoods": True,
            })
            assert_status(resp, 200, "Quote with tiered product")
            quote = resp.json()
            # subtotal should be 5 * $16 = $80
            if abs(quote.get("subtotal", 0) - 80.0) > 0.01:
                raise AssertionError(f"Expected subtotal $80.00, got ${quote.get('subtotal')}")
            ok(f"Quote subtotal=${quote['subtotal']} (5 × $16 tier price)")

        self.run_test("Quote reflects tier pricing", test_quote_with_tiers)

        # B2C tier test — storefront customer buys tiered product
        def test_b2c_tier_pricing():
            self.re_login("b2c")
            self._clear_cart("b2c", c1_id)

            # B2C adds tiered product at qty=5 with tier price (simulating D2C cart.js resolution)
            self.use_token("b2c")
            resp = self.api.post("/checkout/cart", {"entity": {
                "productId": self._tiered_product_id,
                "sellerId": c1_id,
                "quantity": 5,
                "name": f"{PREFIX} Tiered Product",
                "price": 16.00,          # tier price, resolved client-side by cart.js
                "discountedPrice": 16.00,
            }})
            assert_status(resp, 200, "B2C add tiered item to cart")

            # Create quote — verify subtotal = 5 × $16 = $80
            resp = self.api.post("/checkout/quotes", {
                "sellerId": c1_id,
                "paymentMethods": ["credit_card"],
                "deliveryMethods": ["shipping_out"],
                "shippingOutOptions": ["standard"],
                "quotesAllowed": False,
                "companyLocations": [],
                "customerAddresses": [],
                "quoteType": "standard",
            })
            assert_status(resp, 200, "B2C quote with tiered product")
            quote = resp.json()
            if abs(quote.get("subtotal", 0) - 80.0) > 0.01:
                raise AssertionError(f"B2C subtotal: expected $80.00, got ${quote.get('subtotal')}")
            assert_gt(quote.get("taxAmount", 0), 0, "B2C tax should be > 0")
            ok(f"B2C quote: subtotal=${quote['subtotal']}, tax=${quote['taxAmount']}, total=${quote['grandTotal']}")

        self.run_test("B2C storefront tier pricing", test_b2c_tier_pricing)

    # ── Phase 6: Enforcement tests ───────────────────────────────

    # Base config that clears all limits (0 = no limit) so tests don't cascade
    _RESET_CONFIG = {
        "creditLimit": 0,
        "minOrderAmountLimit": 0,
        "maxOrderAmountLimit": 0,
        "minOrderQuantityLimit": 0,
        "maxOrderQuantityLimit": 0,
        "monthlyOrderLimit": 0,
        "yearlyOrderLimit": 0,
        "taxableGoods": True,
        "quotesAllowed": True,
    }

    def _set_customer_config(self, overrides):
        """Reset all limits, apply overrides, then re-login customer."""
        self.use_token("company1")
        cust_id = self.ids["customer"]
        config = {**self._RESET_CONFIG, **overrides}
        resp = self.api.patch(f"/customers/{cust_id}/configuration", config)
        assert_status(resp, 200, "Set customer config")
        self.re_login("customer")

    def _enforcement_cart_and_quote(self, seller_id, product_id, qty,
                                     quote_type="standard", extra_fields=None):
        """Clear cart, add item, attempt quote. Returns response."""
        self._clear_cart("customer", seller_id)
        self._add_to_cart("customer", seller_id, product_id, qty)
        return self._create_quote("customer", seller_id, quote_type, extra_fields=extra_fields)

    # ── Phase 5c: Customer Groups (visibility + group price discount) ─

    def phase5c_groups(self):
        phase("PHASE 5c: Customer Groups (B2B)")

        c1_id = self.ids["company1"]
        cust_id = self.ids["customer"]
        cust2_id = self.ids["customer2"]
        b2c_id = self.ids["b2c"]
        product_a = self.product_ids["company1"][0]
        product_b = self.product_ids["company1"][1]

        # Stable test group IDs (UUID format expected by frontend, but backend just stores strings)
        group_wholesale = "test-grp-wholesale"
        group_vip = "test-grp-vip"

        # 5c-1. Company creates 2 customer groups
        def test_create_groups():
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "company": {
                    "customerGroups": [
                        {"id": group_wholesale, "name": "Wholesale", "groupPriceDiscount": 25},
                        {"id": group_vip, "name": "VIP", "groupPriceDiscount": 35},
                    ]
                }
            })
            assert_status(resp, 200, "Create 2 customer groups")
            ok("Created 2 groups: Wholesale (25%), VIP (35%)")

        self.run_test("5c-1. Create customer groups", test_create_groups)

        # 5c-2. Validation: max 5 groups
        def test_max_5_groups():
            self.use_token("company1")
            too_many = [{"id": f"g{i}", "name": f"G{i}", "groupPriceDiscount": 5} for i in range(6)]
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": too_many}
            })
            assert_status(resp, 400, "Max 5 groups enforced")
            ok("Validation: 6 groups rejected (max 5)")
            # Restore the original 2 groups
            self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": [
                    {"id": group_wholesale, "name": "Wholesale", "groupPriceDiscount": 25},
                    {"id": group_vip, "name": "VIP", "groupPriceDiscount": 35},
                ]}
            })

        self.run_test("5c-2. Max 5 groups validation", test_max_5_groups)

        # 5c-3. Validation: missing name
        def test_missing_name():
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": [{"id": "g-bad", "name": "", "groupPriceDiscount": 10}]}
            })
            assert_status(resp, 400, "Missing group name rejected")
            ok("Validation: empty name rejected")
            # Restore
            self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": [
                    {"id": group_wholesale, "name": "Wholesale", "groupPriceDiscount": 25},
                    {"id": group_vip, "name": "VIP", "groupPriceDiscount": 35},
                ]}
            })

        self.run_test("5c-3. Group name required", test_missing_name)

        # 5c-4. Validation: discount out of range
        def test_discount_out_of_range():
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": [{"id": "g-bad", "name": "Bad", "groupPriceDiscount": 150}]}
            })
            assert_status(resp, 400, "Discount > 100 rejected")
            ok("Validation: groupPriceDiscount > 100 rejected")
            # Restore
            self.api.patch(f"/accounts/{c1_id}", {
                "company": {"customerGroups": [
                    {"id": group_wholesale, "name": "Wholesale", "groupPriceDiscount": 25},
                    {"id": group_vip, "name": "VIP", "groupPriceDiscount": 35},
                ]}
            })

        self.run_test("5c-4. Discount range 0-100 validation", test_discount_out_of_range)

        # 5c-5. Assign customer to a group, re-login, verify JWT carries group fields
        def test_assign_customer_to_group():
            self.use_token("company1")
            # Reset configuration AND set group
            resp = self.api.patch(f"/customers/{cust_id}/configuration", {
                "creditLimit": 0,
                "minOrderAmountLimit": 0,
                "maxOrderAmountLimit": 0,
                "groupID": group_wholesale,
            })
            assert_status(resp, 200, "Assign customer to wholesale group")

            # Re-login customer to get fresh JWT
            self.re_login("customer")
            configs = self._get_configs_from_jwt(self.jwts["customer"])
            config = next((c for c in configs if c.get("company_id") == c1_id), None)
            if not config:
                raise AssertionError("No JWT config found for company1")
            if config.get("groupID") != group_wholesale:
                raise AssertionError(f"JWT groupID: expected {group_wholesale}, got {config.get('groupID')}")
            if config.get("groupPriceDiscount") != 25:
                raise AssertionError(f"JWT groupPriceDiscount: expected 25, got {config.get('groupPriceDiscount')}")
            ok(f"Customer JWT carries groupID={group_wholesale}, groupPriceDiscount=25")

        self.run_test("5c-5. Assign customer to group, JWT resolves", test_assign_customer_to_group)

        # 5c-6. Reject invalid groupID assignment
        def test_invalid_group_assignment():
            self.use_token("company1")
            resp = self.api.patch(f"/customers/{cust_id}/configuration", {
                "groupID": "non-existent-group",
            })
            assert_status(resp, 400, "Invalid groupID rejected")
            ok("Validation: invalid groupID rejected")
            # Restore wholesale assignment
            self.api.patch(f"/customers/{cust_id}/configuration", {"groupID": group_wholesale})
            self.re_login("customer")

        self.run_test("5c-6. Invalid groupID rejected", test_invalid_group_assignment)

        # 5c-7. Tag product_a with wholesale visibility
        def test_tag_product_visibility():
            self.use_token("company1")
            resp = self.api.put(f"/products/{product_a}", {
                "groupIDs": [group_wholesale],
            })
            assert_status_in(resp, [200, 204], "Tag product with wholesale group")
            ok(f"Product A tagged: visible to wholesale only")

        self.run_test("5c-7. Tag product with group", test_tag_product_visibility)

        # 5c-8. Visibility: customer in wholesale SEES tagged product
        def test_visibility_in_group():
            self.use_token("customer")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Get products as wholesale customer")
            products = resp.json() or []
            tagged = next((p for p in products if p["_id"] == product_a), None)
            if not tagged:
                raise AssertionError("Wholesale customer should see tagged product")
            ok("Wholesale customer sees the tagged product")

        self.run_test("5c-8. Visibility: in-group sees tagged", test_visibility_in_group)

        # 5c-9. Visibility: customer2 (no group at company1) does NOT see tagged product
        def test_visibility_no_group():
            # customer2 has no groupID at company1 — re-login to make sure JWT is fresh
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Get products as customer2")
            products = resp.json() or []
            tagged = next((p for p in products if p["_id"] == product_a), None)
            if tagged:
                raise AssertionError("Customer with no group should NOT see tagged product")
            ok("Customer2 (no group) does NOT see tagged product")

        self.run_test("5c-9. Visibility: no-group hidden", test_visibility_no_group)

        # 5c-10. Visibility: B2C SEES tagged product (bypass)
        def test_visibility_b2c():
            self.re_login("b2c")
            self.use_token("b2c")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Get products as B2C")
            products = resp.json() or []
            tagged = next((p for p in products if p["_id"] == product_a), None)
            if not tagged:
                raise AssertionError("B2C should see tagged product (group filter bypass)")
            ok("B2C sees the tagged product (bypass works)")

        self.run_test("5c-10. Visibility: B2C bypasses group filter", test_visibility_b2c)

        # 5c-11. Pricing: wholesale customer gets 25% off
        def test_group_pricing():
            self.use_token("customer")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Get products as wholesale customer")
            products = resp.json() or []
            tagged = next((p for p in products if p["_id"] == product_a), None)
            if not tagged:
                raise AssertionError("Tagged product missing")
            base_price = tagged.get("price", 0)
            discounted = tagged.get("discountedPrice", 0)
            expected = base_price * 0.75
            if abs(discounted - expected) > 0.01:
                raise AssertionError(f"Expected discountedPrice={expected:.2f} (25% off {base_price}), got {discounted:.2f}")
            ok(f"Wholesale pricing: base ${base_price:.2f} → discounted ${discounted:.2f} (25% off)")

        self.run_test("5c-11. Group pricing applied", test_group_pricing)

        # 5c-12. Legacy discountPercentage override beats group discount
        def test_legacy_override_wins():
            self.use_token("company1")
            self.api.patch(f"/customers/{cust_id}/configuration", {
                "discountPercentage": 50,
                "groupID": group_wholesale,
            })
            self.re_login("customer")
            self.use_token("customer")
            resp = self.api.get("/products")
            products = resp.json() or []
            tagged = next((p for p in products if p["_id"] == product_a), None)
            base = tagged.get("price", 0)
            discounted = tagged.get("discountedPrice", 0)
            expected = base * 0.5
            if abs(discounted - expected) > 0.01:
                raise AssertionError(f"Legacy override expected {expected:.2f}, got {discounted:.2f}")
            ok(f"Legacy override (50%) wins over group discount (25%): ${discounted:.2f}")
            # Cleanup: remove legacy override
            self.api.patch(f"/customers/{cust_id}/configuration", {
                "discountPercentage": 0,
                "groupID": group_wholesale,
            })

        self.run_test("5c-12. Legacy override > group discount", test_legacy_override_wins)

        # 5c-13. Untag product (clear groupIDs) — visible to all again
        def test_untag_product():
            self.use_token("company1")
            resp = self.api.put(f"/products/{product_a}", {"groupIDs": []})
            assert_status_in(resp, [200, 204], "Untag product")

            # Customer2 (no group) should now see it
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.get("/products")
            products = resp.json() or []
            untagged = next((p for p in products if p["_id"] == product_a), None)
            if not untagged:
                raise AssertionError("Untagged product should be visible to customer2")
            ok("Untagged product visible to all again (storage rule: empty array unset)")

        self.run_test("5c-13. Untag clears visibility restriction", test_untag_product)

    def phase5d_order_updates(self):
        """Test PUT /checkout/orders/{orderId} — status + tracking updates with role auth."""
        phase("PHASE 5d: Order Updates (status + tracking)")

        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]

        # Reset customer config (5c left a group restriction); re-login refreshes JWT.
        self.use_token("company1")
        self.api.patch(f"/customers/{self.ids['customer']}/configuration", {
            "creditLimit": 0, "minOrderAmountLimit": 0, "maxOrderAmountLimit": 0, "groupID": "",
        })
        self.re_login("customer")

        self._clear_cart("customer", c1_id)
        self._add_to_cart("customer", c1_id, product_a, 2)
        quote_resp = self._create_quote("customer", c1_id, "standard")
        assert_status(quote_resp, 200, "Quote for order-update test")
        quote_id = quote_resp.json().get("id")

        self.use_token("customer")
        order_resp = self.api.post("/checkout/orders", {
            "quoteId": quote_id, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
        })
        assert_status(order_resp, 200, "Place order for update test")
        order_id = order_resp.json().get("id")
        self.tracker.track_order(order_id)
        ok(f"Order placed for update test: {order_id[:8]}...")

        # 5d-1. Customer cannot PUT — forbidden
        def test_customer_forbidden():
            self.use_token("customer")
            resp = self.api.put(f"/checkout/orders/{order_id}", {"status": "shipped"})
            assert_status(resp, 403, "Customer PUT order")
            ok("Customer blocked from updating order (403)")
        self.run_test("5d-1. Customer cannot update order", test_customer_forbidden)

        # 5d-2. Company2 cannot PUT company1's order — forbidden
        def test_other_company_forbidden():
            self.use_token("company2")
            resp = self.api.put(f"/checkout/orders/{order_id}", {"status": "shipped"})
            assert_status(resp, 403, "Other company PUT order")
            ok("Other company blocked from updating someone else's order (403)")
        self.run_test("5d-2. Other company cannot update foreign order", test_other_company_forbidden)

        # 5d-3. Invalid status rejected
        def test_invalid_status():
            self.use_token("company1")
            resp = self.api.put(f"/checkout/orders/{order_id}", {"status": "warp_speed"})
            assert_status(resp, 400, "Invalid status")
            ok("Invalid status rejected (400)")
        self.run_test("5d-3. Invalid status rejected", test_invalid_status)

        # 5d-4. Invalid carrier rejected
        def test_invalid_carrier():
            self.use_token("company1")
            resp = self.api.put(f"/checkout/orders/{order_id}", {"trackingCarrier": "pigeon"})
            assert_status(resp, 400, "Invalid carrier")
            ok("Invalid carrier rejected (400)")
        self.run_test("5d-4. Invalid carrier rejected", test_invalid_carrier)

        # 5d-5. Owning company can update status + tracking, URL is auto-derived
        def test_company_update_success():
            self.use_token("company1")
            resp = self.api.put(f"/checkout/orders/{order_id}", {
                "status": "shipped", "trackingCarrier": "ups", "trackingNumber": "1Z999AA10123456784",
            })
            assert_status(resp, 200, "Owning company PUT order")
            data = resp.json() or {}
            if data.get("status") != "shipped":
                raise AssertionError(f"status should be 'shipped', got {data.get('status')}")
            if data.get("trackingCarrier") != "ups":
                raise AssertionError(f"trackingCarrier should be 'ups', got {data.get('trackingCarrier')}")
            if not (data.get("trackingUrl") or "").startswith("https://www.ups.com/track"):
                raise AssertionError(f"trackingUrl should be auto-derived UPS URL, got {data.get('trackingUrl')}")
            if not data.get("shippedAt"):
                raise AssertionError("shippedAt should be set when status flips to shipped")
            ok("Order updated by owning company: status=shipped, UPS tracking, URL auto-derived")
        self.run_test("5d-5. Owning company updates status + tracking", test_company_update_success)

        # 5d-6. Admin can update any order
        def test_admin_update():
            self.use_token("admin")
            resp = self.api.put(f"/checkout/orders/{order_id}", {"status": "delivered"})
            assert_status(resp, 200, "Admin PUT order")
            data = resp.json() or {}
            if data.get("status") != "delivered":
                raise AssertionError(f"status should be 'delivered', got {data.get('status')}")
            if not data.get("deliveredAt"):
                raise AssertionError("deliveredAt should be set when status flips to delivered")
            ok("Admin updated to delivered; deliveredAt set")
        self.run_test("5d-6. Admin updates any order", test_admin_update)

        # Park the test order as cancelled so it doesn't count toward customer's
        # unpaid balance in phase 6e credit-limit test (GetUnpaidOrdersTotal excludes cancelled).
        self.use_token("admin")
        self.api.put(f"/checkout/orders/{order_id}", {"status": "cancelled"})

    def phase5e_saved_carts(self):
        phase("PHASE 5e: Saved Carts (Requisition Lists)")
        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]

        def _save_list(name):
            self.use_token("customer")
            return self.api.post("/checkout/cart", {"savedListAction": "save", "savedListName": name, "sellerId": c1_id})

        def test_save_appears():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = _save_list(f"{PREFIX} List A")
            assert_status(resp, 200, "Save cart as List A")
            names = [l["name"] for l in (resp.json().get("savedLists") or [])]
            assert_contains(",".join(names), f"{PREFIX} List A", "List A in savedLists")
            ok(f"Saved List A; savedLists={names}")
        self.run_test("Saved cart: save appears in cart", test_save_appears)

        def test_max_three():
            _save_list(f"{PREFIX} List B")
            _save_list(f"{PREFIX} List C")
            resp = _save_list(f"{PREFIX} List D")
            assert_status(resp, 400, "4th saved list rejected (max 3)")
            ok("Max 3 saved carts enforced")
        self.run_test("Saved cart: max 3 enforced", test_max_three)

        def test_load():
            self.use_token("customer")
            cart = self.api.get("/checkout/cart", params={"sellerId": c1_id}).json()
            list_a = next((l for l in (cart.get("savedLists") or []) if l["name"] == f"{PREFIX} List A"), None)
            assert list_a is not None, "List A must exist before load"
            self._clear_cart("customer", c1_id)
            resp = self.api.post("/checkout/cart", {"savedListAction": "load", "sellerId": c1_id, "items": list_a["items"]})
            assert_status(resp, 200, "Load List A into cart")
            assert_gt(len(resp.json().get("items") or []), 0, "Loaded cart has items")
            ok("Loaded List A into main cart")
        self.run_test("Saved cart: load into main cart", test_load)

        def test_delete():
            self.use_token("customer")
            resp = self.api.post("/checkout/cart", {"savedListAction": "delete", "savedListName": f"{PREFIX} List A", "sellerId": c1_id})
            assert_status(resp, 200, "Delete List A")
            names = [l["name"] for l in (resp.json().get("savedLists") or [])]
            assert f"{PREFIX} List A" not in names, "List A still present after delete"
            ok(f"Deleted List A; remaining={names}")
        self.run_test("Saved cart: delete", test_delete)

        def test_delete_last():
            # Delete the remaining lists down to zero, then confirm via a FRESH GET that
            # savedLists is actually cleared. Guards the omitempty-on-empty-slice bug:
            # a whole-cart $set drops an empty slice, leaving the last list stale in Mongo.
            self.use_token("customer")
            for nm in (f"{PREFIX} List B", f"{PREFIX} List C"):
                resp = self.api.post("/checkout/cart", {"savedListAction": "delete", "savedListName": nm, "sellerId": c1_id})
                assert_status(resp, 200, f"Delete {nm}")
            cart = self.api.get("/checkout/cart", params={"sellerId": c1_id}).json()
            remaining = cart.get("savedLists") or []
            assert len(remaining) == 0, f"savedLists must be empty after deleting all, got {remaining}"
            ok("Deleting the last saved cart persists (savedLists cleared)")
        self.run_test("Saved cart: delete last clears field", test_delete_last)

        def test_save_empty_rejected():
            self._clear_cart("customer", c1_id)
            resp = _save_list(f"{PREFIX} Empty")
            assert_status(resp, 400, "Save empty cart rejected")
            ok("Empty cart cannot be saved as a list")
        self.run_test("Saved cart: empty cart rejected", test_save_empty_rejected)

    def phase5f_coverage_backfill(self):
        """Backfill tests for previously-untested pushed backend changes:
        money rounding (0046970/3ef83f9), product cost (2839320),
        resale certificate (172c568), orders return [] not null (e02b74b)."""
        phase("PHASE 5f: Coverage backfill (rounding, cost, resale cert, orders type)")
        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]

        def test_money_rounding():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 500, "minOrderAmountLimit": 20, "maxOrderAmountLimit": 1000,
                "taxableGoods": True, "shippingRate": 15, "taxRate": 8.25,
            })
            assert_status(resp, 200, "Quote for rounding check")
            q = resp.json()
            for f in ("subtotal", "taxAmount", "shippingCost", "discountAmount", "grandTotal"):
                v = q.get(f, 0) or 0
                assert abs(v - round(v, 2)) < 1e-6, f"{f}={v} is not rounded to cents"
            ok("Quote money fields all cent-rounded (no sub-cent)")
        self.run_test("Money totals rounded to cents (regression)", test_money_rounding)

        def test_orders_is_list():
            self.use_token("customer")
            resp = self.api.get("/checkout/orders")
            assert_status(resp, 200, "Get orders")
            body = resp.json()
            assert isinstance(body, list), f"GET /orders must return a list, got {type(body).__name__}"
            ok(f"GET /checkout/orders returns a list ({len(body)} orders)")
        self.run_test("Orders endpoint returns list not null", test_orders_is_list)

        def test_cost_field():
            pid = self.product_ids["company1"][0]
            self.use_token("company1")
            resp = self.api.put(f"/products/{pid}", {"cost": 4.25})
            assert_status(resp, 200, "Set product cost")
            got = self.api.get(f"/products/{pid}").json()
            assert_field(got, "cost", 4.25, "cost round-trip (owner sees it)")
            ok("Product cost persists for owner")
            # Confidentiality: a buyer must NOT see cost (Roadmap #40 leak fix).
            self.use_token("customer")
            prods = self.api.get("/products").json()
            leaked = [p for p in prods if p.get("_id") == pid and p.get("cost")]
            assert not leaked, "cost leaked to customer via GET /products"
            single = self.api.get(f"/products/{pid}").json()
            assert not single.get("cost"), "cost leaked to customer via GET /products/{id}"
            ok("Cost NOT exposed to buyer (list + single)")
            self.use_token("company1")
            self.api.put(f"/products/{pid}", {"cost": 0})  # reset
        self.run_test("Product cost round-trip + not leaked to buyer", test_cost_field)

        def test_package_dimensions():
            pid = self.product_ids["company1"][0]
            self.use_token("company1")
            resp = self.api.put(f"/products/{pid}",
                                {"weight": 2.5, "length": 12, "width": 8, "height": 4})
            assert_status(resp, 200, "Set package weight + dimensions")
            got = self.api.get(f"/products/{pid}").json()
            assert_field(got, "weight", 2.5, "weight round-trip")
            assert_field(got, "length", 12, "length round-trip")
            assert_field(got, "width", 8, "width round-trip")
            assert_field(got, "height", 4, "height round-trip")
            ok("Package weight + dimensions persist")

            # A numeric STRING must be coerced to a number, never stored as text.
            # account-service decodes the catalog response into a typed float64,
            # so a single string here fails storefront generation for the WHOLE
            # company, not just this product.
            resp = self.api.put(f"/products/{pid}", {"weight": "3.25"})
            assert_status(resp, 200, "Numeric-string weight accepted")
            got = self.api.get(f"/products/{pid}").json()
            assert isinstance(got.get("weight"), (int, float)), \
                f"weight stored as {type(got.get('weight')).__name__}, must be numeric"
            assert_field(got, "weight", 3.25, "weight coerced from string")
            ok("Numeric-string weight coerced to a number")

            # Garbage and negatives are refused rather than persisted.
            assert_status(self.api.put(f"/products/{pid}", {"weight": "abc"}),
                          400, "Non-numeric weight rejected")
            assert_status(self.api.put(f"/products/{pid}", {"height": -3}),
                          400, "Negative dimension rejected")
            ok("Non-numeric and negative package values rejected")

            # 0 clears the field (omitempty) instead of storing a meaningless zero,
            # which is how the portal removes a value the merchant blanked out.
            resp = self.api.put(f"/products/{pid}",
                                {"weight": 0, "length": 0, "width": 0, "height": 0})
            assert_status(resp, 200, "Clear package fields")
            got = self.api.get(f"/products/{pid}").json()
            for f in ("weight", "length", "width", "height"):
                assert not got.get(f), f"{f} still present after clearing: {got.get(f)}"
            ok("Zero clears package fields instead of storing 0")
        self.run_test("Package weight + dimensions round-trip, coercion, clearing",
                      test_package_dimensions)

        def test_custom_labels():
            pid = self.product_ids["company1"][0]
            self.use_token("company1")
            labels = {f"customLabel{i}": v for i, v in enumerate(
                ["high-margin", "q4-push", "commodity", "restock-slow", "clearance"])}
            resp = self.api.put(f"/products/{pid}", labels)
            assert_status(resp, 200, "Set all five custom labels")
            got = self.api.get(f"/products/{pid}").json()
            for k, v in labels.items():
                assert_field(got, k, v, f"{k} round-trip")
            ok("All five custom labels persist")

            # Whitespace is trimmed, so a stray space never becomes a second
            # distinct ad-group value in Merchant Center.
            resp = self.api.put(f"/products/{pid}", {"customLabel0": "  padded  "})
            assert_status(resp, 200, "Whitespace-padded label accepted")
            got = self.api.get(f"/products/{pid}").json()
            assert_field(got, "customLabel0", "padded", "custom label trimmed")
            ok("Custom label whitespace trimmed")

            # Google caps a label at 100 characters and is the strictest of the
            # five channels, so the platform enforces its limit for everyone.
            assert_status(self.api.put(f"/products/{pid}", {"customLabel1": "x" * 101}),
                          400, "Over-long custom label rejected")
            resp = self.api.put(f"/products/{pid}", {"customLabel1": "y" * 100})
            assert_status(resp, 200, "Exactly 100 characters accepted")
            ok("Custom label 100-char cap enforced at the boundary")

            # Empty string clears the label rather than storing "".
            resp = self.api.put(f"/products/{pid}", {f"customLabel{i}": "" for i in range(5)})
            assert_status(resp, 200, "Clear custom labels")
            got = self.api.get(f"/products/{pid}").json()
            for i in range(5):
                assert not got.get(f"customLabel{i}"), \
                    f"customLabel{i} still present after clearing: {got.get(f'customLabel{i}')}"
            ok("Empty string clears custom labels")
        self.run_test("Custom labels round-trip, trim, 100-char cap, clearing",
                      test_custom_labels)

        def test_resale_cert():
            cust_id = self.ids["customer"]
            self.use_token("company1")
            cert = {"state": "IL", "number": "TESTRESALE-9911", "type": "resale",
                    "issueDate": "2026-01-01", "expiryDate": "2029-01-01"}
            resp = self.api.patch(f"/customers/{cust_id}/configuration", {"resaleCertificate": cert})
            assert_status(resp, 200, "Set resale certificate")
            self.use_token("admin")
            acct = self.api.get(f"/accounts/{cust_id}").json()
            assert_contains(json.dumps(acct), "TESTRESALE-9911", "Resale cert persists on account")
            ok("Resale certificate persists + reads back")
        self.run_test("Resale certificate round-trip", test_resale_cert)

    def phase6_enforcement(self):
        phase("PHASE 6: Enforcement Tests")

        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]  # ~$10.99

        # 6a. Min order amount
        def test_min_order_amount():
            self._set_customer_config({"minOrderAmountLimit": 100})
            resp = self._enforcement_cart_and_quote(c1_id, product_a, 1)
            assert_status(resp, 400, "Min order amount enforcement")
            assert_contains(resp.text, "below the minimum", "Min order amount message")
            ok("Blocked: order below minimum amount")

        self.run_test("6a. Min order amount enforcement", test_min_order_amount)

        # 6b. Max order amount — product_a ~$10.99, qty 3 = ~$32.97 + tax + ship ≈ $45
        def test_max_order_amount():
            self._set_customer_config({"maxOrderAmountLimit": 30})
            resp = self._enforcement_cart_and_quote(c1_id, product_a, 3)
            assert_status(resp, 400, "Max order amount enforcement")
            assert_contains(resp.text, "exceeds the maximum", "Max order amount message")
            ok("Blocked: order exceeds maximum amount")

        self.run_test("6b. Max order amount enforcement", test_max_order_amount)

        # 6c. Min order quantity
        def test_min_order_qty():
            self._set_customer_config({"maxOrderAmountLimit": 0, "minOrderQuantityLimit": 5})
            resp = self._enforcement_cart_and_quote(c1_id, product_a, 1)
            assert_status(resp, 400, "Min order qty enforcement")
            assert_contains(resp.text, "below the minimum", "Min order qty message")
            ok("Blocked: quantity below minimum")

        self.run_test("6c. Min order quantity enforcement", test_min_order_qty)

        # 6d. Max order quantity
        def test_max_order_qty():
            self._set_customer_config({"maxOrderQuantityLimit": 2})
            resp = self._enforcement_cart_and_quote(c1_id, product_a, 10)
            assert_status(resp, 400, "Max order qty enforcement")
            assert_contains(resp.text, "exceeds the maximum", "Max order qty message")
            ok("Blocked: quantity exceeds maximum")

        self.run_test("6d. Max order quantity enforcement", test_max_order_qty)

        # 6e. Credit limit — product_a ~$10.99, qty 3 ≈ $45 total
        def test_credit_limit():
            self._set_customer_config({"creditLimit": 60})

            # First order should succeed (~$45 < $60)
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "First quote for credit test")
            quote_data = resp.json()
            quote_id = quote_data.get("id")

            # Place the order to create outstanding balance
            self.use_token("customer")
            order_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "paymentToken": "",
                "deliveryMethod": "pickup",
            })
            assert_status(order_resp, 200, "Place first order")
            order_id = order_resp.json().get("id")
            if order_id:
                self.tracker.track_order(order_id)
            ok(f"First order placed: ${quote_data.get('grandTotal', 0):.2f}")

            # Second order should be blocked by credit limit
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 2)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 403, "Credit limit enforcement")
            assert_contains(resp.text, "credit limit", "Credit limit message")
            ok("Blocked: credit limit exceeded")

            # Roadmap #9: refunding frees the credit back up. GetUnpaidOrdersTotal
            # sums NET (grandTotal minus refunds), so money handed back must stop
            # counting against the limit. Deliberately only re-quotes and never
            # places a second order, so the monthly-order-limit test that follows
            # still sees exactly one order.
            if order_id:
                self.use_token("admin")
                refund = self.api.put(f"/checkout/orders/{order_id}", {
                    "stripeRefundID": "re_test_credit_release",
                    "refundAmount": round(quote_data.get("grandTotal", 0), 2),
                    "refundReason": "credit-limit release check",
                })
                assert_status(refund, 200, "Full refund on the credit-test order")

                self._clear_cart("customer", c1_id)
                self._add_to_cart("customer", c1_id, product_a, 2)
                resp = self._create_quote("customer", c1_id, "standard")
                assert_status(resp, 200, "Quote allowed once the refund clears the balance")
                ok("Refund released the outstanding balance; quoting allowed again")

        self.run_test("6e. Credit limit enforcement", test_credit_limit)

        # 6f. Monthly order limit — already placed 1 order in credit test
        def test_monthly_limit():
            self._set_customer_config({"monthlyOrderLimit": 1})
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 403, "Monthly limit enforcement")
            assert_contains(resp.text, "monthly", "Monthly limit message")
            ok("Blocked: monthly order limit reached")

        self.run_test("6f. Monthly order limit enforcement", test_monthly_limit)

        # 6g. TaxableGoods = false
        def test_taxable_goods_false():
            self._set_customer_config({"taxableGoods": False})
            resp = self._enforcement_cart_and_quote(c1_id, product_a, 3)
            assert_status(resp, 200, "Quote with taxableGoods=false")
            data = resp.json()
            if data.get("taxAmount", -1) != 0:
                raise AssertionError(f"Expected taxAmount=0, got {data.get('taxAmount')}")
            ok(f"TaxableGoods=false: taxAmount=0, grandTotal=${data.get('grandTotal', 0):.2f}")

        self.run_test("6g. TaxableGoods=false → tax=0", test_taxable_goods_false)

        # 6h. QuotesAllowed = false
        def test_quotes_allowed_false():
            self._set_customer_config({"quotesAllowed": False})
            # Negotiable should be blocked
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "negotiable")
            assert_status(resp, 403, "QuotesAllowed=false negotiable")
            assert_contains(resp.text, "not allow", "QuotesAllowed message")
            ok("Blocked: negotiable quote when quotesAllowed=false")

            # Standard should still work
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Standard quote when quotesAllowed=false")
            ok("Standard quote still works when quotesAllowed=false")

        self.run_test("6h. QuotesAllowed=false → negotiable blocked", test_quotes_allowed_false)

    # ── Phase 7: Company-side quote ──────────────────────────────

    def phase7_company_side(self):
        phase("PHASE 7: Company-Side Quote Creation")

        def test_company_creates_quote():
            c1_id = self.ids["company1"]
            cust_id = self.ids["customer"]
            product_a = self.product_ids["company1"][0]

            # Company adds to cart for customer
            self.use_token("company1")
            resp = self.api.post("/checkout/cart", {
                "entity": {
                    "productId": product_a,
                    "sellerId": c1_id,
                    "quantity": 2,
                }
            }, params={"accountId": cust_id})
            assert_status(resp, 200, "Company adds to cart for customer")

            # Company creates quote for customer
            resp = self._create_quote("company1", c1_id, "standard",
                                       account_id=cust_id,
                                       extra_fields={
                                           "creditLimit": 500,
                                           "taxableGoods": True,
                                           "leadTime": 3,
                                       })
            assert_status(resp, 200, "Company creates quote for customer")
            ok("Company-side quote created for customer")

        self.run_test("Company creates quote for customer", test_company_creates_quote)

    # ── Phase 8: D2C storefront flow ─────────────────────────────

    def phase8_storefront(self):
        phase("PHASE 8: D2C Storefront Flow (backward compat)")

        def test_storefront_minimal():
            c1_id = self.ids["company1"]
            product_a = self.product_ids["company1"][0]

            # B2C login
            self.re_login("b2c")

            # Add to cart (enough qty to clear any enforcement limits from JWT)
            self._clear_cart("b2c", c1_id)
            self._add_to_cart("b2c", c1_id, product_a, 3)

            # Create quote with MINIMAL payload (like D2C storefront does)
            self.use_token("b2c")
            resp = self.api.post("/checkout/quotes", {
                "sellerId": c1_id,
                "paymentMethods": ["credit_card"],
                "deliveryMethods": ["shipping_out"],
                "shippingOutOptions": ["standard"],
                "quotesAllowed": False,
                "companyLocations": [],
                "customerAddresses": [],
                "quoteType": "standard",
                # NO enforcement fields — this is the backward compat test
            })
            assert_status(resp, 200, "D2C storefront quote")
            data = resp.json()
            assert_gt(data.get("taxAmount", 0), 0, "D2C: tax should be > 0 (default taxable)")
            ok(f"D2C quote OK: grandTotal=${data.get('grandTotal', 0):.2f}, tax=${data.get('taxAmount', 0):.2f}")

        self.run_test("D2C storefront: minimal payload, tax charged", test_storefront_minimal)


    # ── Phase 9b: Organisation accounts (Roadmap #21c Phase 2) ────

    def phase9b_org_accounts(self):
        phase("PHASE 9b: Organisation Accounts")

        c1_id = self.ids["company1"]
        cust_id = self.ids["customer"]
        staff_email = f"{PREFIX}staff@test.com"
        colleague_email = f"{PREFIX}colleague@test.com"
        self._org_extra_emails = [staff_email, colleague_email]

        # A root hands out the code; nobody else can.
        def test_only_root_issues_invites():
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {"org": {"regenerateInviteCode": True}})
            assert_status(resp, 200, "Company generates an invite code")
            code = resp.json().get("orgInviteCode")
            if not code or not code.startswith("ORG-"):
                raise AssertionError(f"expected an ORG- invite code, got {code!r}")
            self._company_invite = code
            ok(f"Company invite code issued ({code[:12]}...)")

            # A seller must not be able to mint a code for their buyer: that would
            # let them plant an account inside the customer's organisation.
            resp = self.api.patch(f"/accounts/{cust_id}", {"org": {"regenerateInviteCode": True}})
            if resp.status_code != 403:
                raise AssertionError(
                    f"a seller issued an invite code for its buyer (got {resp.status_code})"
                )
            ok("Seller refused when issuing an invite for a buyer's organisation (403)")

            # b2c has no organisation at all.
            self.re_login("b2c")
            self.use_token("b2c")
            resp = self.api.patch(f"/accounts/{self.ids['b2c']}", {"org": {"regenerateInviteCode": True}})
            if resp.status_code != 403:
                raise AssertionError(f"a b2c account was given an organisation (got {resp.status_code})")
            ok("b2c refused an organisation (403)")

        self.run_test("9b-1. Only an organisation root issues invites", test_only_root_issues_invites)

        # Joining inherits the organisation's platform role and its data.
        def test_staff_joins_company():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Staff One", "email": staff_email,
                "password": PASSWORD, "orgInviteCode": self._company_invite,
            })
            assert_status(resp, 201, "Staff joins the company organisation")

            resp = self.api.post("/accounts/login", {"email": staff_email, "password": PASSWORD})
            assert_status(resp, 200, "Staff logs in")
            token = resp.json()["accessToken"]
            claims = self.api.decode_jwt(token)["user"]
            if claims.get("role") != "company":
                raise AssertionError(f"staff should inherit the company role, got {claims.get('role')!r}")
            if claims.get("org_id") != c1_id:
                raise AssertionError(
                    f"staff org_id should be the company ({c1_id}), got {claims.get('org_id')!r} — "
                    f"without it every seller-scoped query returns nothing"
                )
            self.jwts["staff"] = token
            self.ids["staff"] = self.api.decode_jwt(token)["user"]["id"]
            self.JOINED_EMAILS["staff"] = staff_email
            ok("Staff inherited role=company and the company's org_id")

        self.run_test("9b-2. Staff joins and inherits the organisation", test_staff_joins_company)

        # The payoff for Phase 1: org identity, not account identity, scopes data.
        def test_staff_sees_company_data():
            self.use_token("staff")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Staff lists products")
            resp = self.api.get("/checkout/orders", params={"sellerId": c1_id})
            assert_status(resp, 200, "Staff lists the company's orders")
            orders = resp.json() or []
            resp = self.api.get("/accounts")
            assert_status(resp, 200, "Staff lists the company's accounts")
            ok(f"Staff sees the company's catalogue, {len(orders)} order(s) and its customer list")

        self.run_test("9b-3. Staff sees the organisation's data, not an empty portal", test_staff_sees_company_data)

        # A buying organisation works the same way, which is what makes approvers
        # real colleagues rather than strangers who share a supplier.
        def test_buyer_org():
            self.re_login("customer")
            self.use_token("customer")
            resp = self.api.patch(f"/accounts/{cust_id}", {"org": {"regenerateInviteCode": True}})
            assert_status(resp, 200, "Buyer generates an invite code")
            code = resp.json().get("orgInviteCode")

            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Colleague", "email": colleague_email,
                "password": PASSWORD, "orgInviteCode": code,
            })
            assert_status(resp, 201, "Colleague joins the buying organisation")

            resp = self.api.post("/accounts/login", {"email": colleague_email, "password": PASSWORD})
            assert_status(resp, 200, "Colleague logs in")
            claims = self.api.decode_jwt(resp.json()["accessToken"])["user"]
            if claims.get("role") != "customer":
                raise AssertionError(f"colleague should inherit role=customer, got {claims.get('role')!r}")
            if claims.get("org_id") != cust_id:
                raise AssertionError(f"colleague org_id should be the buyer, got {claims.get('org_id')!r}")
            # Inheriting the supplier attachments matters: otherwise they join the
            # organisation but can buy from nobody.
            if not (claims.get("associate_company_ids") or []):
                raise AssertionError("colleague inherited no supplier attachments, so they could not order")
            self.jwts["colleague"] = resp.json()["accessToken"]
            self.ids["colleague"] = claims["id"]
            self.JOINED_EMAILS["colleague"] = colleague_email
            ok("Colleague inherited role=customer, the buyer's org_id and its suppliers")

        self.run_test("9b-4. A buying organisation gains colleagues", test_buyer_org)

        # An invite code is a join credential, not an escalation: it must not be
        # combinable with a company code to claim something extra.
        def test_invite_cannot_escalate():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Sneaky", "email": f"{PREFIX}sneaky@test.com",
                "password": PASSWORD, "role": "admin",
                "orgInviteCode": self._company_invite,
            })
            assert_status(resp, 201, "Register with an invite code and a claimed role")
            resp = self.api.post("/accounts/login", {"email": f"{PREFIX}sneaky@test.com", "password": PASSWORD})
            claims = self.api.decode_jwt(resp.json()["accessToken"])["user"]
            if claims.get("role") == "admin":
                raise AssertionError("an invite code let someone claim the admin role")
            self._org_extra_emails.append(f"{PREFIX}sneaky@test.com")
            self.ids["sneaky"] = claims["id"]
            ok("A requested role is ignored when joining; the organisation's role wins")

            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Bad", "email": f"{PREFIX}bad@test.com",
                "password": PASSWORD, "orgInviteCode": "ORG-DOESNOTEXIST",
            })
            if resp.status_code != 400:
                raise AssertionError(f"an unknown invite code was accepted (got {resp.status_code})")
            ok("Unknown invite code rejected with 400")

            # An invite code must not reach the guest-checkout path. isGuest is
            # decided before the invite branch rewrites the role, so role "b2c" with
            # no password plus a real company code used to skip password validation
            # and get sealed with a random password, then be stored as a COMPANY
            # colleague nobody could ever log into.
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Passwordless Colleague",
                "email": f"{PREFIX}pwless-colleague@test.com",
                "role": "b2c",
                "orgInviteCode": self._company_invite,
            })
            if resp.status_code != 400:
                self._org_extra_emails.append(f"{PREFIX}pwless-colleague@test.com")
                raise AssertionError(
                    f"a passwordless b2c register with a company invite code was accepted "
                    f"(got {resp.status_code}); that creates an account with a random "
                    f"password that nobody can log into"
                )
            ok("Passwordless register with an invite code rejected with 400")

        self.run_test("9b-5. An invite code cannot escalate a role", test_invite_cannot_escalate)

        # Removal ends access without erasing the person behind the history.
        def test_remove_keeps_history():
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {"org": {"removeAccountId": self.ids["sneaky"]}})
            assert_status(resp, 200, "Company removes someone from its organisation")

            resp = self.api.post("/accounts/login", {"email": f"{PREFIX}sneaky@test.com", "password": PASSWORD})
            assert_status(resp, 200, "The removed account still exists and can log in")
            claims = self.api.decode_jwt(resp.json()["accessToken"])["user"]
            if claims.get("org_id") != claims.get("id"):
                raise AssertionError(
                    f"a removed account should be its own organisation again, got org_id={claims.get('org_id')!r}"
                )
            ok("Removed account survives, and is its own organisation again")

        self.run_test("9b-6. Removal unlinks rather than deletes", test_remove_keeps_history)

        # 9b-7. THE BYPASS GUARD. The approval policy belongs to the organisation
        # and is stored on its root, but a colleague's own governance is empty. If
        # login read the individual's rather than the organisation's, a buying
        # organisation could configure approvals, invite colleagues, and have none
        # of THEIR orders gated — the control missing exactly the people it exists
        # for, silently.
        def test_colleague_inherits_the_policy():
            product_a = self.product_ids["company1"][0]

            # The root sets the organisation's policy, naming its colleague.
            self.re_login("customer")
            self.use_token("customer")
            # The ROOT is the approver and the COLLEAGUE orders. Naming the
            # colleague here instead would strip them from their own chain (a
            # buyer may never approve their own order, see 9q) and nothing would
            # gate — which would look like this test passing for the wrong reason.
            resp = self.api.patch(f"/accounts/{cust_id}", {"governance": {"approval": {
                "scope": "both", "threshold": 1,
                "chain": [{"approvers": [{"email": USERS["customer"]["email"]}]}],
            }}})
            assert_status(resp, 200, "Buyer sets an org policy naming themselves as approver")

            # The COLLEAGUE orders. Their own governance is empty, so this only
            # gates if login resolved the organisation's.
            self.re_login("colleague")
            self._clear_cart("colleague", c1_id)
            self._add_to_cart("colleague", c1_id, product_a, 3)
            resp = self._create_quote("colleague", c1_id, "standard")
            assert_status(resp, 200, "Colleague creates a quote")
            if resp.json().get("status") != "pending_approval":
                raise AssertionError(
                    f"a colleague's order was NOT gated (status {resp.json().get('status')!r}) — "
                    f"the organisation's approval policy does not reach its own people"
                )
            ok("Colleague's order gated by the organisation's policy")

        self.run_test("9b-7. A colleague inherits the organisation's approval policy", test_colleague_inherits_the_policy)

        # Approvers must be colleagues, not merely customers of the same supplier.
        def test_approver_must_be_in_org():
            self.re_login("customer")
            self.use_token("customer")
            # A storefront shopper of the same supplier: never in any organisation,
            # so exactly the case the old "shares a supplier" proxy would have let
            # through. customer2/3 are colleagues by now and would legitimately pass.
            resp = self.api.patch(f"/accounts/{cust_id}", {"governance": {"approval": {
                "scope": "both", "threshold": 1,
                "chain": [{"approvers": [{"email": USERS["b2c"]["email"]}]}],
            }}})
            if resp.status_code != 400:
                raise AssertionError(
                    f"an outsider who merely shares a supplier was accepted as an approver "
                    f"(got {resp.status_code})"
                )
            ok("Approver outside the organisation refused (400)")

        self.run_test("9b-8. Approvers must be colleagues", test_approver_must_be_in_org)

        # A colleague writing governance on their own account would store a policy
        # nothing ever reads.
        def test_only_root_sets_policy():
            self.re_login("colleague")
            self.use_token("colleague")
            resp = self.api.patch(f"/accounts/{self.ids['colleague']}", {"governance": {"approval": {
                "scope": "both", "threshold": 1,
                "chain": [{"approvers": [{"email": USERS["customer"]["email"]}]}],
            }}})
            if resp.status_code != 403:
                raise AssertionError(
                    f"a colleague stored their own approval policy (got {resp.status_code}); "
                    f"it would never be read"
                )
            ok("Colleague refused when setting an approval policy (403)")

            # Leave nothing behind for later phases.
            self.re_login("customer")
            self.use_token("customer")
            resp = self.api.patch(f"/accounts/{cust_id}", {"governance": {"approval": {
                "scope": "none", "threshold": 0, "chain": [],
            }}})
            assert_status(resp, 200, "Clear the organisation policy")
            ok("Organisation policy cleared")

        self.run_test("9b-9. Only the organisation owner sets the policy", test_only_root_sets_policy)

        # ── Roadmap #35g: seniority inside the organisation ──────────────
        # #21c gave organisations people. Until #35g their OrgRole was written on
        # join and never read, so everyone an owner invited got the owner's whole
        # portal: product costs, margins, payment credentials, billing.

        def test_org_role_is_derived_not_migrated():
            """Every account that already existed keeps exactly what it had."""
            self.re_login("company1")
            claims = self.api.decode_jwt(self.jwts["company1"])["user"]
            if claims.get("org_role") != "owner":
                raise AssertionError(
                    f"a root account resolved to {claims.get('org_role')!r}, not owner. "
                    f"Roots are owners by definition, which is what makes this safe "
                    f"to ship with no migration"
                )
            self.re_login("staff")
            staff_claims = self.api.decode_jwt(self.jwts["staff"])["user"]
            if staff_claims.get("org_role") != "user":
                raise AssertionError(f"a joiner resolved to {staff_claims.get('org_role')!r}, not user")
            ok("Root resolves to owner, joiner to user, with nothing migrated")

        self.run_test("9b-10. Org seniority is derived, not migrated", test_org_role_is_derived_not_migrated)

        def test_staff_cannot_see_product_cost():
            """The exposure #35g closes: confidential cost, but inside the seller."""
            self.use_token("company1")
            products = self.api.get("/products").json() or []
            with_cost = [p for p in products if (p.get("cost") or 0) > 0]
            if not with_cost:
                # Give the owner's catalogue a cost so the assertion means something.
                pid = products[0]["_id"]
                r = self.api.put(f"/products/{pid}", {"cost": 4.25})
                assert_status(r, 200, "Owner sets a product cost")
                target = pid
            else:
                target = with_cost[0]["_id"]

            self.use_token("company1")
            owner_view = self.api.get(f"/products/{target}").json()
            if not (owner_view.get("cost") or 0) > 0:
                raise AssertionError("setup failed: the owner cannot see the cost either")

            self.re_login("staff")
            self.use_token("staff")
            staff_view = self.api.get(f"/products/{target}").json()
            if (staff_view.get("cost") or 0) != 0:
                raise AssertionError(
                    f"staff read the product cost ({staff_view.get('cost')!r}). Cost is "
                    f"confidential from buyers (#40) and from staff inside the seller (#35g)"
                )
            listed = self.api.get("/products").json() or []
            leaked = [p["_id"] for p in listed if (p.get("cost") or 0) > 0]
            if leaked:
                raise AssertionError(f"the product LIST leaked cost to staff for {len(leaked)} product(s)")
            ok("Owner sees cost, staff sees zero, on both the single read and the list")

        self.run_test("9b-11. Staff cannot see product cost or margin", test_staff_cannot_see_product_cost)

        def test_staff_edit_cannot_wipe_cost():
            """Redaction must not become deletion.

            Staff read cost as 0. If the edit form echoes that back, an ordinary
            "change the description and save" overwrites the merchant's real cost
            with 0 — permanent, silent, and it corrupts the owner's margin figures
            too. The server drops the key so the stored value survives, while every
            other field the staff member edited still saves.
            """
            self.use_token("company1")
            products = self.api.get("/products").json() or []
            target, real_cost = None, 0
            for p in products:
                if (p.get("cost") or 0) > 0:
                    target, real_cost = p["_id"], p["cost"]
                    break
            if not target:
                target = products[0]["_id"]
                real_cost = 7.75
                assert_status(self.api.put(f"/products/{target}", {"cost": real_cost}),
                              200, "Owner sets a cost for the wipe test")

            # This runs against real catalogue rows, and description is customer
            # facing: it renders on the storefront at the next regeneration. Capture
            # both fields and put them back in the finally below, whatever happens.
            # Without that, a FAILING run leaves the cost wiped and the description
            # rewritten, which is exactly how this test broke 9b-13 ("an admin still
            # could not see cost after promotion") on its first real execution: the
            # assertion it exists to make had already destroyed the data downstream
            # tests depend on.
            original = self.api.get(f"/products/{target}").json()
            original_desc = original.get("description", "")
            new_desc = f"{PREFIX} staff edited this description"
            try:
                self.re_login("staff")
                self.use_token("staff")
                staff_view = self.api.get(f"/products/{target}").json()
                resp = self.api.put(f"/products/{target}", {
                    "description": new_desc,
                    "cost": staff_view.get("cost", 0),  # exactly what the form round-trips
                })
                assert_status(resp, 200, "Staff edit accepted")

                self.use_token("company1")
                after = self.api.get(f"/products/{target}").json()
                if abs((after.get("cost") or 0) - real_cost) > 0.001:
                    raise AssertionError(
                        f"staff edit destroyed the cost: was {real_cost}, now {after.get('cost')!r}. "
                        f"A caller who cannot read cost must not be able to write it."
                    )
                if after.get("description") != new_desc:
                    raise AssertionError(
                        f"the cost guard blocked an unrelated field: description is "
                        f"{after.get('description')!r}, expected {new_desc!r}"
                    )
                ok(f"Staff edit saved the description and left cost at {real_cost}")
            finally:
                self.use_token("company1")
                self.api.put(f"/products/{target}", {
                    "description": original_desc,
                    "cost": real_cost,
                })

        self.run_test("9b-15. A staff edit cannot wipe the product cost", test_staff_edit_cannot_wipe_cost)

        def test_only_owner_touches_payment_credentials():
            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.post("/checkout/gateways", {
                "gatewayName": "stripe_pay", "sandbox": True,
                "sandboxCredentials": {"secretKey": "sk_test_should_never_be_written"},
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"staff wrote payment gateway credentials (got {resp.status_code}). "
                    f"Whoever can rewrite the gateway secret can redirect every payment "
                    f"the store takes"
                )
            ok("Staff refused on payment gateway settings (403)")

        self.run_test("9b-12. Only the owner manages payment credentials",
                      test_only_owner_touches_payment_credentials)

        def test_only_owner_sees_billing_statements():
            """Hiding the nav entry was never enough: the UI is not a boundary."""
            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            if resp.status_code != 403:
                raise AssertionError(
                    f"staff read the company's billing statements (got {resp.status_code}). "
                    f"A statement carries the tier, monthly fee, per-order rate and "
                    f"transaction fees this business pays"
                )
            resp = self.api.get("/checkout/orders/statement", params={"sellerId": c1_id})
            if resp.status_code != 403:
                raise AssertionError(
                    f"staff computed a live billing statement (got {resp.status_code})"
                )
            self.use_token("company1")
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            assert_status(resp, 200, "Owner still reads their own statements")
            ok("Statements refused for staff (403), unchanged for the owner")

        self.run_test("9b-14. Only the owner sees billing statements",
                      test_only_owner_sees_billing_statements)

        def test_owner_can_promote_and_demote():
            self.re_login("company1")
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "org": {"setRoleAccountId": self.ids["staff"], "setRole": "admin"}})
            assert_status(resp, 200, "Owner promotes staff to admin")

            self.re_login("staff")
            if self.api.decode_jwt(self.jwts["staff"])["user"].get("org_role") != "admin":
                raise AssertionError("promotion did not reach the claim")
            self.use_token("staff")
            promoted = self.api.get("/products").json() or []
            if not any((p.get("cost") or 0) > 0 for p in promoted):
                raise AssertionError("an admin still could not see cost after promotion")
            ok("Promoted to admin, cost now visible")

            # A colleague cannot promote themselves.
            resp = self.api.patch(f"/accounts/{self.ids['staff']}", {
                "org": {"setRoleAccountId": self.ids["staff"], "setRole": "admin"}})
            if resp.status_code == 200:
                raise AssertionError("a colleague promoted themselves")
            ok("A colleague cannot set their own seniority")

            self.re_login("company1")
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "org": {"setRoleAccountId": self.ids["staff"], "setRole": "user"}})
            assert_status(resp, 200, "Owner demotes back to staff")
            self.re_login("staff")
            ok("Demoted back to staff")

        self.run_test("9b-13. Only the owner sets a colleague's seniority",
                      test_owner_can_promote_and_demote)


    # ── Phase 9c: Seller-side quote approval (Roadmap #21d) ───────

    def phase9c_seller_approval(self):
        """The SELLING organisation's own sign-off, and its interaction with the
        buyer's.

        Runs after 9b because it needs `staff`: a real second person inside the
        selling organisation. Before organisation membership existed there was
        nobody at a seller to name as approver, which is why this half of the
        feature could not be built.
        """
        phase("PHASE 9c: Seller-Side Quote Approval")

        c1_id = self.ids["company1"]
        cust_id = self.ids["customer"]
        product_a = self.product_ids["company1"][0]
        staff_email = self.JOINED_EMAILS["staff"]
        buyer_approver_email = USERS["customer2"]["email"]

        def set_policy(role_key, account_id, **policy):
            """Write an organisation's own policy, then prove it actually took.

            Both halves are verified deliberately. A 200 here only says the request
            was accepted; the gate depends on the policy reaching the DATABASE and
            then reaching the CLAIM, and a failure in either shows up much later as
            "the quote was approved" with nothing to say why. Asserting both turns a
            silent no-gate into a failure that names its own cause.
            """
            self.re_login(role_key)
            self.use_token(role_key)
            resp = self.api.patch(f"/accounts/{account_id}", {"governance": {"approval": policy}})
            assert_status(resp, 200, f"Set {role_key} approval policy")

            stored = ((resp.json().get("governance") or {}).get("approval") or {})
            want_chain = policy.get("chain") or []
            if len(stored.get("chain") or []) != len(want_chain):
                raise AssertionError(
                    f"{role_key} policy did not persist: sent {len(want_chain)} level(s), "
                    f"account came back with {stored.get('chain')!r}"
                )

            self.re_login(role_key)   # refresh the claim so the new policy is live
            claim = self.api.decode_jwt(self.jwts[role_key])["user"].get("orgApproval") or {}
            if len(claim.get("chain") or []) != len(want_chain):
                raise AssertionError(
                    f"{role_key} policy persisted but never reached the token: "
                    f"orgApproval claim is {claim!r} — checkout reads the policy from "
                    f"this claim, so no gate can ever fire"
                )
            return resp

        def buyer_quote():
            """The buyer raises a negotiable quote, so THEIR chain is on it.

            The two-sided path needs this. A rep-drafted quote carries no buyer
            policy by design — only a signed customer claim can gate, and the rep's
            token is the seller's — so the buyer's levels can only be denormalised
            onto a quote the buyer created. Theirs apply at payment instead, which
            is what 9c-4 covers.
            """
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 4)
            resp = self._create_quote("customer", c1_id, "negotiable")
            assert_status(resp, 200, "Buyer raises a negotiable quote")
            return resp.json()["id"]

        def clear_policy(role_key, account_id):
            # Goes through set_policy so the same "did it actually take" checks
            # apply: a clear that silently did not clear leaves a gate armed for
            # every later phase, which is worse than one that never applied.
            set_policy(role_key, account_id, scope="none", threshold=0, chain=[])

        def rep_quote():
            """A rep drafts a negotiable quote on the buyer's behalf.

            The cart is filled through the seller's own token with ?accountId, the
            same path QuoteCreateForm uses. That is what makes this quote carry no
            buyer policy: the buyer's JWT is never present.
            """
            self._clear_cart("customer", c1_id)
            self.use_token("company1")
            # The PRICE has to be sent. checkout-service never calls catalog (no
            # cross-service dependencies), so an entity posted without one becomes a
            # zero-price line: the quote totals $0, falls under every threshold, and
            # nothing gates — which looks exactly like a broken gate.
            product = self._get_product("company1", product_a)
            resp = self.api.post("/checkout/cart", {
                "entity": {
                    "productId": product_a, "sellerId": c1_id, "quantity": 4,
                    "name": (product or {}).get("name", ""),
                    "price": (product or {}).get("price", 0),
                },
            }, params={"accountId": cust_id})
            assert_status(resp, 200, "Rep adds to the buyer's cart")
            resp = self._create_quote("company1", c1_id, "negotiable", account_id=cust_id)
            assert_status(resp, 200, "Rep drafts a negotiable quote")
            if (resp.json().get("grandTotal") or 0) <= 1:
                raise AssertionError(
                    f"rep-drafted quote totals {resp.json().get('grandTotal')!r}, which is under "
                    f"every threshold in this phase — the gate would appear broken when the "
                    f"setup is what is wrong"
                )
            return resp.json()["id"]

        def approve_as_seller(qid, expect=200):
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            assert_status(resp, expect, "Seller approves the quote")
            return resp

        # 9c-1. The selling organisation can now hold its own quotes, and its
        # levels run BEFORE the buyer ever sees the offer.
        def test_seller_chain_runs_first():
            set_policy("company1", c1_id, threshold=1, scope="negotiable",
                       chain=[{"name": "Sales manager", "approvers": [{"email": staff_email}]}])
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])

            qid = buyer_quote()
            approve_as_seller(qid)

            self.use_token("company1")
            q = self.api.get(f"/checkout/quotes/{qid}").json()
            if q.get("status") != "pending_approval":
                raise AssertionError(f"quote status is {q.get('status')!r}, expected pending_approval")
            chain = q.get("approvalChain") or []
            if len(chain) != 2:
                raise AssertionError(f"expected a 2-level chain (seller then buyer), got {chain}")
            if chain[0].get("side") != "seller":
                raise AssertionError(
                    f"level 1 side is {chain[0].get('side')!r}; the seller's own sign-off must clear "
                    f"before the offer is put to the buyer at all"
                )
            if (chain[1].get("side") or "buyer") != "buyer":
                raise AssertionError(f"level 2 side is {chain[1].get('side')!r}, expected buyer")
            # omitempty drops approvalStage when it is 0, so an absent field IS
            # stage 0 on the wire. Same allowance the buyer-side tests make.
            if q.get("approvalStage") not in (0, None):
                raise AssertionError(f"expected to start at stage 0, got {q.get('approvalStage')!r}")
            self._seller_qid = qid
            ok("Seller level queued first, buyer level behind it")

        self.run_test("9c-1. Seller's own levels run before the buyer's", test_seller_chain_runs_first)

        # 9c-2. Each side decides only its own levels. Without this the control is
        # enforceable by the party it exists to constrain.
        def test_sides_cannot_decide_each_other():
            qid = self._seller_qid

            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"a buyer's approver decided the SELLER's level (got {resp.status_code})"
                )
            ok("Buyer refused on a seller level (403)")

            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve", "note": "margin ok"},
            })
            assert_status(resp, 200, "Seller's approver clears their level")
            q = resp.json()
            if q.get("status") != "pending_approval":
                raise AssertionError(
                    f"quote went to {q.get('status')!r} after the seller level; the buyer's level "
                    f"must still run"
                )
            if q.get("approvalStage") != 1:
                raise AssertionError(f"expected stage 1, got {q.get('approvalStage')!r}")
            if (q["approvalChain"][0].get("decidedBy") or {}).get("email", "").lower() != staff_email.lower():
                raise AssertionError("the seller's decision was not recorded against the person who made it")
            ok("Seller level cleared, buyer level now in front")

            # And the seller cannot then clear the buyer's level.
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"a seller decided the BUYER's level (got {resp.status_code})"
                )
            ok("Seller refused on a buyer level (403)")

        self.run_test("9c-2. Neither side can decide the other's levels", test_sides_cannot_decide_each_other)

        # 9c-3. Both chains clear, in order, and the order becomes payable.
        def test_full_sequence_completes():
            qid = self._seller_qid
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Buyer's approver clears the final level")
            q = resp.json()
            if q.get("status") != "approved":
                raise AssertionError(f"expected approved after the last level, got {q.get('status')!r}")
            sides = [(s.get("side") or "buyer") for s in q["approvalChain"]]
            statuses = [s.get("status") for s in q["approvalChain"]]
            if sides != ["seller", "buyer"] or statuses != ["approved", "approved"]:
                raise AssertionError(f"audit trail wrong: sides={sides}, statuses={statuses}")
            ok("Both organisations' sign-offs recorded, order approved")

        self.run_test("9c-3. Seller then buyer, then payable", test_full_sequence_completes)

        # 9c-4. THE BYPASS. A rep-drafted quote that clears the SELLER's levels is
        # marked approval-required, and treating that as "already approved" let the
        # buyer's own policy be skipped entirely by asking a rep to draft the
        # order. The place-order backstop must key on a BUYER-side level.
        def test_seller_gate_does_not_swallow_the_buyer_backstop():
            set_policy("company1", c1_id, threshold=1, scope="negotiable",
                       chain=[{"name": "Sales manager", "approvers": [{"email": staff_email}]}])
            # Buyer's policy is deliberately NOT set yet: a rep-drafted quote
            # carries no buyer policy, so theirs can only apply at payment.
            clear_policy("customer", cust_id)

            qid = rep_quote()
            approve_as_seller(qid)

            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Seller's approver clears their level")
            if resp.json().get("status") != "approved":
                raise AssertionError("seller-only chain should have completed to approved")

            # Now the buyer arms their own policy and tries to pay.
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])
            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code != 202:
                raise AssertionError(
                    f"a rep-drafted order that cleared the SELLER's levels was paid without the "
                    f"BUYER's own approval (got {resp.status_code}) — asking a rep to draft the "
                    f"order would bypass the buyer's policy entirely"
                )
            ok("Buyer's own chain still applied at payment (202)")

            self.use_token("company1")
            q = self.api.get(f"/checkout/quotes/{qid}").json()
            if q.get("status") != "pending_approval":
                raise AssertionError(f"expected pending_approval, got {q.get('status')!r}")
            sides = [(s.get("side") or "buyer") for s in q["approvalChain"]]
            if sides[0] != "seller":
                raise AssertionError(
                    f"the seller's completed level was erased when the buyer's chain was added "
                    f"(sides={sides}); the record of who authorised what must survive"
                )
            if q["approvalChain"][0].get("status") != "approved":
                raise AssertionError("the seller's recorded decision was reset to pending")
            if q.get("approvalStage") != 1:
                raise AssertionError(
                    f"expected the stage to start after the completed seller level, got "
                    f"{q.get('approvalStage')!r}"
                )
            ok("Seller's completed level preserved ahead of the buyer's")

        self.run_test("9c-4. A seller gate does not swallow the buyer's backstop",
                      test_seller_gate_does_not_swallow_the_buyer_backstop)

        # 9c-5. Under the seller's own threshold, nothing changes: the buyer's
        # policy alone decides, exactly as before #21d.
        def test_seller_under_threshold_unchanged():
            set_policy("company1", c1_id, threshold=999999, scope="negotiable",
                       chain=[{"approvers": [{"email": staff_email}]}])
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])

            qid = buyer_quote()
            approve_as_seller(qid)
            self.use_token("company1")
            q = self.api.get(f"/checkout/quotes/{qid}").json()
            if q.get("status") != "pending_approval":
                raise AssertionError(f"expected the buyer's chain to hold it, got {q.get('status')!r}")
            sides = [(s.get("side") or "buyer") for s in q["approvalChain"]]
            if "seller" in sides:
                raise AssertionError(
                    f"an under-threshold seller policy still added its levels (sides={sides})"
                )
            ok("Under the seller's threshold, only the buyer's chain runs")

        self.run_test("9c-5. Seller policy under threshold adds nothing",
                      test_seller_under_threshold_unchanged)

        # 9c-6. No seller policy at all: the pre-#21d path, untouched.
        def test_no_seller_policy_is_unchanged():
            clear_policy("company1", c1_id)
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])

            qid = buyer_quote()
            approve_as_seller(qid)
            self.use_token("company1")
            q = self.api.get(f"/checkout/quotes/{qid}").json()
            sides = [(s.get("side") or "buyer") for s in (q.get("approvalChain") or [])]
            if q.get("status") != "pending_approval" or sides != ["buyer"]:
                raise AssertionError(
                    f"a seller with no policy changed the buyer-only flow: "
                    f"status={q.get('status')!r}, sides={sides}"
                )
            ok("A seller with no policy leaves the buyer-only flow exactly as it was")

        self.run_test("9c-6. No seller policy leaves the buyer flow untouched",
                      test_no_seller_policy_is_unchanged)

        # 9c-7. THE TWO-CALL LAUNDER. The guard on the generic status path used to
        # key on the PRIOR status, so it only refused the direct
        # pending_approval -> approved hop. A seller could set a held STANDARD
        # order to "open" (the guard did not fire, and standard quotes are gated at
        # creation so they are never re-gated here), then to "approved", and the
        # order became payable with every level still reading "pending" and nothing
        # recorded anywhere. forceReleaseApproval exists for exactly this and logs
        # it; the generic path must not be a silent second route.
        def test_status_path_cannot_launder_a_held_order():
            clear_policy("company1", c1_id)
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            qid = resp.json()["id"]
            if resp.json().get("status") != "pending_approval":
                raise AssertionError("setup failed: the order was not held")

            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "open"},
            })
            assert_status(resp, 200, "Seller reopens the held order")

            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"a seller approved past a live approval chain in two calls (got "
                    f"{resp.status_code}) — the order would be payable with every level "
                    f"still pending and nothing logged"
                )
            ok("Two-call launder refused (409)")

            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code == 200:
                raise AssertionError("the laundered order was payable")
            ok("The order is still not payable")

        self.run_test("9c-7. The status path cannot launder a held order",
                      test_status_path_cannot_launder_a_held_order)

        # 9c-8. Re-approval after a withdrawal must rebuild the BUYER's half from
        # the buyer's half. Rebuilding it from the whole stored chain re-tagged the
        # seller's own levels as buyer-side, so their company-role approvers could
        # never clear them (a buyer level demands a customer) and the quote stuck in
        # pending_approval with only force-release as a way out — and the seller's
        # levels were appended a second time on top.
        def test_reapproval_does_not_duplicate_or_retag():
            set_policy("company1", c1_id, threshold=1, scope="negotiable",
                       chain=[{"name": "Sales manager", "approvers": [{"email": staff_email}]}])
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"approvers": [{"email": buyer_approver_email}]}])

            qid = buyer_quote()
            approve_as_seller(qid)

            # Withdraw, then reinstate. CanEnterApproval includes "rejected" so a
            # seller can pull a quote and put it back.
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "rejected"},
            })
            assert_status(resp, 200, "Seller withdraws the quote")
            approve_as_seller(qid)

            q = self.api.get(f"/checkout/quotes/{qid}").json()
            sides = [(s.get("side") or "buyer") for s in (q.get("approvalChain") or [])]
            if sides != ["seller", "buyer"]:
                raise AssertionError(
                    f"re-approval rebuilt the chain wrong: sides={sides}, expected "
                    f"['seller', 'buyer'] — duplicated or re-tagged levels leave approvers "
                    f"on levels their role can never clear"
                )
            ok("Re-approval rebuilt exactly one seller level and one buyer level")

            # And it is still actually decidable by the right people.
            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Seller's approver can still clear their level")
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Buyer's approver clears the final level")
            if resp.json().get("status") != "approved":
                raise AssertionError("the reinstated quote never completed its chain")
            ok("The reinstated chain completes normally")

            clear_policy("company1", c1_id)
            clear_policy("customer", cust_id)

        self.run_test("9c-8. Re-approval rebuilds each side from its own half",
                      test_reapproval_does_not_duplicate_or_retag)

        # 9c-12. Teardown, as its own test rather than a trailing line inside the
        # last one. An approval policy is GLOBAL to the account: leave one armed and
        # every standard quote in every later phase is held, so phase 12 fails with
        # "Quote is not approved for order placement" and the real cause is six
        # phases back. That is exactly what happened when a mid-phase assertion
        # raised before its own cleanup line. run_test never propagates, so a
        # cleanup step written this way always runs.
        def test_policies_cleared():
            clear_policy("company1", c1_id)
            clear_policy("customer", cust_id)
            ok("Both organisations' policies cleared for the phases that follow")

        # 9c-10. THE ERASURE (Roadmap #21f). The chain is live state and is rebuilt
        # whenever the gate re-fires, so a seller who withdrew a part-approved quote
        # and reinstated it wiped who had approved which level, and their note with
        # it. The record now lives outside the chain and nothing removes an entry.
        def test_decision_record_survives_withdraw_and_reinstate():
            set_policy("company1", c1_id, threshold=1, scope="negotiable",
                       chain=[{"name": "Sales manager", "approvers": [{"email": staff_email}]}])
            set_policy("customer", cust_id, threshold=1, scope="both",
                       chain=[{"name": "Finance", "approvers": [{"email": buyer_approver_email}]}])

            qid = buyer_quote()
            approve_as_seller(qid)

            # The seller's own level signs off, and that is the record at risk.
            self.re_login("staff")
            self.use_token("staff")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision",
                "value": {"decision": "approve", "note": "margin checked"},
            })
            assert_status(resp, 200, "Seller's approver signs off")

            # Withdraw, then reinstate. This is what used to erase it.
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "rejected"},
            })
            assert_status(resp, 200, "Seller withdraws the quote")
            approve_as_seller(qid)

            self.use_token("company1")
            q = self.api.get(f"/checkout/quotes/{qid}").json()

            # The chain is legitimately rebuilt and shows the level pending again.
            if (q.get("approvalChain") or [])[0].get("status") not in (None, "pending"):
                raise AssertionError("setup wrong: the chain was expected to be rebuilt fresh")

            # The record is not.
            decisions = q.get("approvalDecisions") or []
            mine = [d for d in decisions if (d.get("side") or "buyer") == "seller"]
            if not mine:
                raise AssertionError(
                    f"the seller's approval was erased by withdraw-and-reinstate; "
                    f"decision record is {decisions!r}"
                )
            d = mine[0]
            if (d.get("by") or {}).get("email", "").lower() != staff_email.lower():
                raise AssertionError(f"the record lost who approved: {d!r}")
            if d.get("note") != "margin checked":
                raise AssertionError(f"the record lost the approver's note: {d!r}")
            if not d.get("grandTotal"):
                raise AssertionError(
                    f"the record lost the total it was decided at, so it no longer says "
                    f"what was approved: {d!r}"
                )
            ok("Decision record survived the rebuild, with who, note and total intact")
            self._record_qid = qid

        self.run_test("9c-10. A withdraw-and-reinstate cannot erase the record",
                      test_decision_record_survives_withdraw_and_reinstate)

        # 9c-11. The record must not leak across the trade either. Redacting the
        # chain but not the log would have reopened the whole disclosure through a
        # second field.
        def test_decision_record_is_redacted_per_side():
            qid = self._record_qid
            self.re_login("customer")
            self.use_token("customer")
            q = self.api.get(f"/checkout/quotes/{qid}").json()
            for d in (q.get("approvalDecisions") or []):
                if (d.get("side") or "buyer") == "seller":
                    if d.get("by") or d.get("note") or d.get("stepName"):
                        raise AssertionError(
                            f"the buyer can read inside the seller's decision: {d!r}"
                        )
                    if not d.get("decision"):
                        raise AssertionError("the buyer lost the fact that a seller level was decided")
            ok("Buyer sees that the seller decided, but not who or what they wrote")

        self.run_test("9c-11. The decision record is redacted per side",
                      test_decision_record_is_redacted_per_side)

        self.run_test("9c-12. Teardown: approval policies cleared", test_policies_cleared)


    # ── Phase 9: B2B multi-buyer order approval (Roadmap #21) ─────

    def phase9_order_approval(self):
        phase("PHASE 9: B2B Order Approval Workflows")

        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]
        cust_id = self.ids["customer"]
        approver_id = self.ids["customer2"]    # attached to company1 via CUST-1
        # Second eligible approver on the same level. Must be a `customer` role:
        # a b2c account is deliberately refused by the decision handler.
        approver2_id = self.ids["customer3"]

        def set_buyer_policy(role_key, account_id, **policy):
            """Set the BUYER'S OWN approval policy, as the buyer.

            Approval governance belongs to the organisation it governs, so it is
            written by that account on itself via PATCH /accounts/{id}. A seller
            cannot reach it — which is the point of the redesign.
            """
            self.re_login(role_key)
            self.use_token(role_key)
            resp = self.api.patch(f"/accounts/{account_id}", {"governance": {"approval": policy}})
            assert_status(resp, 200, f"Set {role_key} own approval policy")
            self.re_login(role_key)   # refresh the claim so the new policy is live
            return resp

        # Start phase 9 from a known seller-side configuration. Earlier enforcement
        # tests leave quotesAllowed=false on this customer, and phase 9 used to
        # clear it only by accident: its approval writes went through
        # /customers/{id}/configuration, which REPLACES the whole configuration
        # object. Approval config now lives on the buyer's own account, so that
        # side-effect is gone and the reset has to be deliberate.
        self._set_customer_config({"quotesAllowed": True})

        # Approvers must belong to the buyer's organisation (Roadmap #21c Phase 3
        # made that exact, replacing a "shares a supplier" proxy). customer2 and
        # customer3 already exist, so they join with an invite code rather than at
        # registration — which is why joining an existing account is supported.
        def _join_buyer_org():
            self.re_login("customer")
            self.use_token("customer")
            resp = self.api.patch(f"/accounts/{self.ids['customer']}", {"org": {"regenerateInviteCode": True}})
            assert_status(resp, 200, "Buyer issues an invite code")
            code = resp.json()["orgInviteCode"]
            for key in ("customer2", "customer3"):
                self.re_login(key)
                self.use_token(key)
                r = self.api.patch(f"/accounts/{self.ids[key]}", {"org": {"joinWithInviteCode": code}})
                assert_status(r, 200, f"{key} joins the buyer's organisation")
            self.re_login("customer")
            ok("Approvers are now colleagues in the buyer's organisation")

        _join_buyer_org()

        # Approvers are named by EMAIL and resolved server-side; a client-supplied
        # accountId is deliberately ignored. So the helper must use the address the
        # account actually registered with, not one derived from its id.
        email_of = {self.ids[k]: USERS[k]["email"] for k in ("customer", "customer2", "customer3", "b2c")}

        def step_cfg(*account_ids):
            return {"approvers": [{"email": email_of[a]} for a in account_ids]}


        # 9a. OWNERSHIP. Approval governance belongs to the organisation it
        # governs. A seller must not be able to write their buyer's policy, and a
        # storefront shopper has no organisation to govern at all.
        def test_only_the_account_owns_its_policy():
            # The buyer sets their own; that is the supported path.
            set_buyer_policy("customer", cust_id, threshold=1, scope="both",
                             chain=[step_cfg(approver_id)])
            ok("Buyer set their own approval policy")

            # The seller cannot reach it: PATCH /accounts/{id} is self-or-admin.
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{cust_id}", {
                "governance": {"approval": {"threshold": 1, "scope": "both",
                                            "chain": [step_cfg(approver_id)]}}
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"a seller wrote their buyer's approval policy (got {resp.status_code}) — "
                    f"the buyer's internal governance is not the seller's to set"
                )
            ok("Seller refused when writing a buyer's approval policy (403)")

            # A selling company MAY hold its own quotes (Roadmap #21d), but only on
            # quotes: self-serve checkout is created and paid by the buyer with no
            # seller step in between, so a checkout scope there would be a control
            # that could never fire. Refused rather than stored inert.
            self.use_token("company1")
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "governance": {"approval": {"threshold": 1, "scope": "both",
                                            "chain": [step_cfg(approver_id)]}}
            })
            if resp.status_code != 400:
                raise AssertionError(
                    f"a company saved a checkout-scoped approval structure (got {resp.status_code}); "
                    f"it would never be read, leaving a control that looks armed and never fires"
                )
            ok("Company refused a checkout-scoped approval structure (400)")

            # And it cannot name the BUYER'S people as its own approvers: sign-off
            # happens inside the organisation being governed.
            resp = self.api.patch(f"/accounts/{c1_id}", {
                "governance": {"approval": {"threshold": 1, "scope": "negotiable",
                                            "chain": [step_cfg(approver_id)]}}
            })
            if resp.status_code != 400:
                raise AssertionError(
                    f"a company named its customer as its own internal approver (got {resp.status_code})"
                )
            ok("Company refused an approver from outside its organisation (400)")

            # A storefront shopper has no organisation to govern.
            self.re_login("b2c")
            self.use_token("b2c")
            resp = self.api.patch(f"/accounts/{self.ids['b2c']}", {
                "governance": {"approval": {"threshold": 1, "scope": "both",
                                            "chain": [step_cfg(approver_id)]}}
            })
            if resp.status_code != 403:
                raise AssertionError(f"a b2c account was allowed an approval structure (got {resp.status_code})")
            ok("b2c refused an approval structure (403)")

        self.run_test("9a. Only the account owns its approval policy", test_only_the_account_owns_its_policy)

        # 9b. THE B2C REGRESSION GUARD. A storefront shopper must sail straight
        # through while a B2B buyer at the same seller is gated. If this ever
        # fails, D2C checkout is dead-ended behind an approver they do not have.
        def test_b2c_never_gated():
            self.re_login("b2c")
            self._clear_cart("b2c", c1_id)
            self._add_to_cart("b2c", c1_id, product_a, 3)
            self.use_token("b2c")
            resp = self.api.post("/checkout/quotes", {
                "sellerId": c1_id,
                "paymentMethods": ["credit_card"],
                "deliveryMethods": ["shipping_out"],
                "shippingOutOptions": ["standard"],
                "quotesAllowed": False,
                "companyLocations": [],
                "customerAddresses": [],
                "quoteType": "standard",
            })
            assert_status(resp, 200, "B2C quote with company approval policy active")
            data = resp.json()
            status = data.get("status")
            if status != "approved":
                raise AssertionError(
                    f"B2C storefront quote was gated (status={status!r}). A D2C shopper has no "
                    f"organisation to approve for; this dead-ends real revenue."
                )
            if data.get("approvalChain"):
                raise AssertionError("B2C quote carried an approval chain; it must carry none")
            ok("B2C quote approved immediately, no chain attached")

        self.run_test("9b. B2C storefront is NEVER gated (regression guard)", test_b2c_never_gated)

        # 9c. The same guard at the token layer: account-service must not even emit
        # the claim for a b2c account, independent of what checkout does with it.
        def test_b2c_jwt_has_no_approval_claim():
            self.re_login("b2c")
            claims = self.api.decode_jwt(self.jwts["b2c"])["user"]

            # The CURRENT home of the policy: one top-level claim (#21d moved it
            # out of the per-supplier configurations). checkout-service reads the
            # gate from here and nowhere else, so this is the assertion that
            # actually keeps a storefront shopper ungated.
            if claims.get("orgApproval"):
                raise AssertionError(
                    f"b2c JWT carries an approval policy: {claims.get('orgApproval')!r} — "
                    f"a storefront shopper has no organisation to approve for, and gating "
                    f"one dead-ends real D2C revenue"
                )

            # The OLD home, kept deliberately. This is where the policy lived
            # before #21d, and checking only one location is how a refactor quietly
            # empties a guard: this test passed throughout the move purely because
            # it was looking at a field nothing writes any more.
            for cfg in (claims.get("configurations") or []):
                leaked = [k for k in cfg if k.startswith("approval")]
                if leaked:
                    raise AssertionError(f"b2c JWT leaked approval claims: {leaked}")
            ok("b2c JWT carries no approval policy, in either its old or current location")

        self.run_test("9c. b2c JWT carries no approval config", test_b2c_jwt_has_no_approval_claim)

        # 9d. A real B2B buyer, same company, same policy: this one IS held.
        quote_holder = {}

        def test_customer_is_gated():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Customer standard quote under approval policy")
            data = resp.json()
            if data.get("status") != "pending_approval":
                raise AssertionError(
                    f"expected pending_approval, got {data.get('status')!r} — the gate did not fire"
                )
            if len(data.get("approvalChain") or []) != 1:
                raise AssertionError(f"expected a 1-step chain, got {data.get('approvalChain')}")
            if data.get("approvalStage") not in (0, None):
                raise AssertionError(f"a fresh chain must start at stage 0, got {data.get('approvalStage')}")
            quote_holder["id"] = data["id"]
            ok(f"Customer quote held for approval (id {data['id'][-6:]})")

        self.run_test("9d. B2B customer over threshold is held", test_customer_is_gated)

        # 9e. The money path. handlePlaceOrderRequest already refuses anything that
        # is not "approved", so this is the assertion that the gate actually blocks
        # payment rather than merely labelling the quote.
        def test_place_order_blocked():
            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": quote_holder["id"],
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"expected 403 placing an unapproved order, got {resp.status_code} — "
                    f"an order bypassed its approval gate"
                )
            ok("Order placement blocked with 403 while pending approval")

        self.run_test("9e. Cannot pay while pending approval", test_place_order_blocked)

        # 9f. Only a named approver may decide.
        def test_non_approver_rejected():
            self.re_login("customer")   # the buyer is not their own approver
            self.use_token("customer")
            resp = self.api.patch(f"/checkout/quotes/{quote_holder['id']}", {
                "operation": "approvalDecision",
                "value": {"decision": "approve"},
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"expected 403 for a non-approver, got {resp.status_code} — a buyer approved their own order"
                )
            ok("Non-approver refused with 403")

        self.run_test("9f. Non-approver cannot decide", test_non_approver_rejected)

        # 9g. The approver can SEE it. Adobe Commerce is criticised for having no
        # way to list what is awaiting your sign-off; the widened query is that fix.
        def test_approver_can_see_quote():
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.get(f"/checkout/quotes/{quote_holder['id']}")
            assert_status(resp, 200, "Approver reads a quote they do not own")
            listing = self.api.get("/checkout/quotes", params={"sellerId": c1_id})
            assert_status(listing, 200, "Approver lists quotes")
            ids = [q.get("id") for q in (listing.json() or [])]
            if quote_holder["id"] not in ids:
                raise AssertionError("the pending quote did not appear in the approver's list")
            ok("Approver can read and list a quote they did not create")

        self.run_test("9g. Approver sees quotes awaiting them", test_approver_can_see_quote)

        # 9h. Approve → the money path opens.
        def test_approve_unblocks_order():
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{quote_holder['id']}", {
                "operation": "approvalDecision",
                "value": {"decision": "approve", "note": "ok from finance"},
            })
            assert_status(resp, 200, "Approver approves")
            data = resp.json()
            if data.get("status") != "approved":
                raise AssertionError(f"a single-step chain should complete, got {data.get('status')!r}")
            chain = data.get("approvalChain") or []
            if not chain or not chain[0].get("decidedBy"):
                raise AssertionError("the decision was not recorded on the step (no audit trail)")
            if chain[0].get("note") != "ok from finance":
                raise AssertionError(f"the note was not recorded: {chain[0].get('note')!r}")
            ok("Approved; who/when/note recorded on the step")

        self.run_test("9h. Approval completes and is audited", test_approve_unblocks_order)

        # 9i. Multi-tier, and any-one-of-several clears a step. Two levels: level 1
        # has two eligible approvers (the on-leave case), level 2 has one.
        def test_multi_tier():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", chain=[step_cfg(approver_id, approver2_id), step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Multi-tier quote")
            data = resp.json()
            qid = data["id"]
            if len(data.get("approvalChain") or []) != 2:
                raise AssertionError(f"expected 2 levels, got {len(data.get('approvalChain') or [])}")

            # Level 1 cleared by the SECOND listed approver: proves any eligible
            # approver can clear a step, which is what stops an order stalling.
            self.re_login("customer3")
            self.use_token("customer3")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Second-listed approver clears level 1")
            data = resp.json()
            if data.get("status") != "pending_approval":
                raise AssertionError(f"still one level to go, expected pending_approval, got {data.get('status')!r}")
            if data.get("approvalStage") != 1:
                raise AssertionError(f"expected stage 1 after level 1, got {data.get('approvalStage')}")
            ok("Level 1 cleared by an alternate approver; quote advanced to level 2")

            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Level 2 approves")
            if resp.json().get("status") != "approved":
                raise AssertionError("the final level should complete the chain")
            ok("Level 2 cleared; quote fully approved")

        self.run_test("9i. Multi-tier chain, any-one-of-several per level", test_multi_tier)

        # 9j. Reject freezes the chain.
        def test_reject():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Quote to reject")
            qid = resp.json()["id"]

            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision",
                "value": {"decision": "reject", "note": "over budget"},
            })
            assert_status(resp, 200, "Reject")
            if resp.json().get("status") != "rejected":
                raise AssertionError(f"expected rejected, got {resp.json().get('status')!r}")

            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code != 403:
                raise AssertionError(f"a rejected order must not be payable, got {resp.status_code}")
            # The seller must NOT be able to launder a buyer's rejection into an
            # approval through the generic status path. Force-release deliberately
            # does not cover this either: it exists for an approver who never
            # responded, not one who declined.
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"seller flipped a buyer-rejected order to approved (got {resp.status_code}) — "
                    f"the buyer's refusal can be overridden"
                )
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "forceReleaseApproval", "value": {},
            })
            if resp.status_code != 409:
                raise AssertionError(f"force-release must not override an explicit rejection, got {resp.status_code}")

            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code != 403:
                raise AssertionError(f"a rejected order must stay unpayable, got {resp.status_code}")
            ok("Seller cannot overturn a buyer rejection by any route")

        self.run_test("9j. Reject freezes the chain and blocks payment", test_reject)

        # 9k. Defect-1 guard. CreateQuote upserts the standard quote in place, so a
        # buyer editing the cart overwrites their own pending-approval quote. Every
        # approval field is in the $set map precisely so a part-approved chain can
        # never survive into the new submission.
        def test_resubmit_resets_chain():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            qid = resp.json()["id"]

            self.re_login("customer3")
            self.use_token("customer3")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Clear level 1 before resubmitting")
            if resp.json().get("approvalStage") != 1:
                raise AssertionError("setup failed: level 1 was not cleared")

            # Buyer edits the cart and checks out again.
            self.re_login("customer")
            self._add_to_cart("customer", c1_id, product_a, 2)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Resubmit after cart edit")
            data = resp.json()
            if data.get("approvalStage") not in (0, None):
                raise AssertionError(
                    f"resubmitted quote inherited stage {data.get('approvalStage')} — a stale "
                    f"approval would let an unapproved order through"
                )
            for i, s in enumerate(data.get("approvalChain") or []):
                if s.get("decidedBy") or s.get("status") == "approved":
                    raise AssertionError(f"step {i} carried a previous decision into the new submission")
            if data.get("status") != "pending_approval":
                raise AssertionError(f"the resubmitted quote should be held again, got {data.get('status')!r}")
            ok("Cart edit reset the chain to stage 0 and re-held the order")

        self.run_test("9k. Cart edit resets a part-approved chain", test_resubmit_resets_chain)

        # 9n. THE NEGOTIABLE PATH. Not covered by the tests above, which is exactly
        # how the expiry bug survived: the window used to be stamped at quote
        # creation, but a negotiable chain does not start until the seller
        # approves. Any negotiation longer than the window produced an order that
        # nobody could ever approve.
        def test_negotiable_path():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="negotiable", validityHours=48, chain=[step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "negotiable")
            assert_status(resp, 200, "Negotiable quote created")
            data = resp.json()
            qid = data["id"]
            # Scope is negotiable-only, so creation must NOT hold it; the seller
            # negotiates first.
            if data.get("status") == "pending_approval":
                raise AssertionError("a negotiable quote must not be held at creation; the seller negotiates first")
            # And the window must not have started ticking during the negotiation.
            if data.get("approvalExpiresAt"):
                raise AssertionError(
                    f"approval window was stamped at creation ({data.get('approvalExpiresAt')}); "
                    f"a long negotiation would then expire before the approvers ever saw it"
                )
            ok("Negotiable quote created unheld, with no approval clock running")

            # Seller approves → NOW the buyer's chain starts.
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            assert_status(resp, 200, "Seller approves the negotiable quote")
            data = resp.json()
            if data.get("status") != "pending_approval":
                raise AssertionError(
                    f"seller approval should hand a gated quote to the buyer's approvers, got {data.get('status')!r}"
                )
            if not data.get("approvalExpiresAt"):
                raise AssertionError("the approval window must be stamped when the chain actually starts")
            ok("Seller approval handed the quote to the buyer's chain with a fresh window")

            # Still not payable.
            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code != 403:
                raise AssertionError(f"a seller-approved but buyer-unapproved order must not be payable, got {resp.status_code}")

            # Buyer's approver signs off → now it completes.
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Buyer's approver approves the negotiated quote")
            if resp.json().get("status") != "approved":
                raise AssertionError("the negotiable chain should complete to approved")
            ok("Negotiable quote fully approved end to end")

        self.run_test("9n. Negotiable path: gate fires at seller-approve", test_negotiable_path)

        # 9o. Scope must be honoured: a negotiable-only policy leaves standard
        # checkout alone. This is the configurability the scope field promises.
        def test_scope_is_respected():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Standard quote under a negotiable-only policy")
            if resp.json().get("status") != "approved":
                raise AssertionError(
                    f"scope=negotiable must not gate standard checkout, got {resp.json().get('status')!r}"
                )
            ok("scope=negotiable left standard checkout ungated")

        self.run_test("9o. Scope confines the gate to the chosen flow", test_scope_is_respected)

        # 9p. A malformed policy is refused at the API boundary rather than stored
        # and then failing to decode later, which is what 500s every admin
        # GET /accounts.
        def test_malformed_chain_rejected():
            self.re_login("customer")
            self.use_token("customer")
            for bad, why in [
                ({"scope": "sometimes", "threshold": 1, "chain": [step_cfg(approver_id)]}, "an unknown scope"),
                ({"scope": "both", "threshold": -5, "chain": [step_cfg(approver_id)]}, "a negative threshold"),
                ({"scope": "both", "threshold": 1, "chain": [{"name": "no approvers", "approvers": []}]}, "a level with no approvers"),
                ({"scope": "both", "threshold": 1, "chain": [{"approvers": [{"email": ""}]}]}, "an approver with no email"),
                ({"scope": "both", "threshold": 1, "chain": [{"approvers": [{"email": "nobody@nowhere.test"}]}]}, "an approver who is not a registered account"),
            ]:
                resp = self.api.patch(f"/accounts/{cust_id}", {"governance": {"approval": bad}})
                if resp.status_code != 400:
                    raise AssertionError(f"expected 400 for {why}, got {resp.status_code}")
            ok("Malformed approval policies rejected with 400")

        self.run_test("9p. Malformed approval policy rejected at the boundary", test_malformed_chain_rejected)

        # 9q. Self-approval must be impossible. A company-wide chain is copied into
        # EVERY customer's JWT at that company, so the named approver is also a
        # buyer; leaving them on their own chain would let them sign off on their
        # own spending and void the control.
        def test_no_self_approval():
            self.use_token("company1")
            # The buyer is the ONLY configured approver.
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", chain=[step_cfg(cust_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Quote with a buyer-only chain")
            data = resp.json()
            for step in (data.get("approvalChain") or []):
                for a in step.get("approvers", []):
                    if a.get("accountId") == cust_id:
                        raise AssertionError("the buyer was left on their own approval chain and could self-approve")
            ok("Buyer excluded from their own approval chain")

            # Now a chain where the buyer is one of two approvers: the OTHER one
            # must remain so the level is still enforceable.
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", chain=[step_cfg(cust_id, approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            data = resp.json()
            if data.get("status") != "pending_approval":
                raise AssertionError("a chain with a valid other approver must still gate")
            approvers = [a["accountId"] for s in data["approvalChain"] for a in s["approvers"]]
            if cust_id in approvers:
                raise AssertionError("the buyer survived on a mixed chain")
            if approver_id not in approvers:
                raise AssertionError("the legitimate approver was dropped")
            ok("Mixed chain kept the real approver and dropped the buyer")

        self.run_test("9q. A buyer can never approve their own order", test_no_self_approval)

        # 9r. The window bounds the approval REQUEST, not payment. An unanswered
        # request cannot be decided once it lapses; a request that WAS answered in
        # time leaves a normally payable order. Bounding payment instead made a
        # settled negotiable quote permanently unpayable, with no way back.
        def test_expiry_bounds_the_request():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", validityHours=0.0003, chain=[step_cfg(approver_id)])

            # (i) lapsed and undecided -> the approver can no longer decide it.
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            stale = self._create_quote("customer", c1_id, "standard").json()["id"]
            time.sleep(2)
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{stale}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            if resp.status_code == 200:
                raise AssertionError("a lapsed approval request must not be decidable")
            ok("Lapsed approval request refused at decision time")

            # (ii) decided in time -> payable, and no window left behind.
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", validityHours=24, chain=[step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            qid = self._create_quote("customer", c1_id, "standard").json()["id"]
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Approve within the window")
            if resp.json().get("approvalExpiresAt"):
                raise AssertionError(
                    "the window must be cleared once the chain clears, or a settled "
                    "order becomes permanently unpayable when it lapses"
                )
            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            assert_status(resp, 200, "A fully-approved order is payable")
            o = resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, "order_id missing"
            self.tracker.track_order(order_id)
            ok("Approved order carries no window and is payable")

        self.run_test("9r. Approval window bounds the request, not payment", test_expiry_bounds_the_request)

        # 9u. Reject-then-approve must not bypass the chain. Letting the seller
        # withdraw a pending order (9v) opens this door: if a seller-rejected quote
        # could not re-enter approval, re-approving it would skip the buyer entirely.
        def test_seller_reject_then_approve_regates():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", validityHours=24, chain=[step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            qid = self._create_quote("customer", c1_id, "negotiable").json()["id"]

            # Seller withdraws, then reinstates.
            self.use_token("company1")
            assert_status(self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "rejected"},
            }), 200, "Seller withdraws the quote")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            assert_status(resp, 200, "Seller reinstates the quote")
            if resp.json().get("status") != "pending_approval":
                raise AssertionError(
                    f"reinstating a withdrawn quote skipped the buyer's chain "
                    f"(status {resp.json().get('status')!r}) — a one-step approval bypass"
                )
            ok("Reinstated quote re-entered the buyer's approval chain")

        self.run_test("9u. Reject-then-approve re-gates", test_seller_reject_then_approve_regates)

        # 9v. A seller must still be able to withdraw an order awaiting approval.
        # Blocking every transition on pending_approval left them no way to cancel,
        # since force-release only ever approves.
        def test_seller_can_withdraw_pending():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            qid = self._create_quote("customer", c1_id, "standard").json()["id"]

            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "rejected"},
            })
            assert_status(resp, 200, "Seller withdraws an order awaiting approval")
            if resp.json().get("status") != "rejected":
                raise AssertionError("the withdrawal did not take effect")

            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            if resp.status_code != 403:
                raise AssertionError(f"a withdrawn order must not be payable, got {resp.status_code}")
            ok("Seller withdrew a pending-approval order; it is not payable")

        self.run_test("9v. Seller can withdraw an order awaiting approval", test_seller_can_withdraw_pending)

        # 9s. Seller force-release. This is the no-scheduler answer to "the approver
        # is unreachable", so it has to actually release: re-running the gate would
        # bounce the quote straight back to pending_approval, and leaving the
        # (usually lapsed) window in place would block payment anyway.
        def test_seller_force_release():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=1, scope="both", validityHours=0.0003, chain=[step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            qid = resp.json()["id"]
            if resp.json().get("status") != "pending_approval":
                raise AssertionError("setup failed: the quote was not held")

            time.sleep(2)  # approver never responds and the window lapses

            # The generic status path must REFUSE to resolve a quote that is
            # awaiting approval — inferring an override from prior state let a
            # double-clicked Approve release orders past their chain.
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"updateStatus on a pending-approval quote must 409, got {resp.status_code} — "
                    f"a repeated approve could silently release the order"
                )
            ok("updateStatus refused to resolve a pending approval (409)")

            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "forceReleaseApproval", "value": {},
            })
            assert_status(resp, 200, "Seller force-releases the stuck quote")
            data = resp.json()
            if data.get("status") != "approved":
                raise AssertionError(
                    f"force-release bounced back to {data.get('status')!r}; the escape hatch does not release"
                )
            if data.get("approvalExpiresAt"):
                raise AssertionError("force-release left the lapsed window in place; payment would still be refused")

            # Idempotency: a second release must not act on a quote that is no
            # longer awaiting approval.
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "forceReleaseApproval", "value": {},
            })
            if resp.status_code != 409:
                raise AssertionError(f"a repeated force-release must 409, got {resp.status_code}")

            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": qid, "paymentMethod": "purchase_order", "deliveryMethod": "pickup",
            })
            assert_status(resp, 200, "Buyer can pay after a force-release")
            o = resp.json()
            order_id = o.get("id") or o.get("_id")
            assert order_id, "order_id missing"
            self.tracker.track_order(order_id)
            ok("Seller force-release releases the order and payment succeeds")

        self.run_test("9s. Seller force-release rescues a stuck approval", test_seller_force_release)

        # 9t. Cross-tenant authorization. Every quote PATCH used to check only the
        # caller's ROLE, never whether the quote was theirs, so any company token
        # could mutate another company's quotes.
        def test_cross_tenant_patch_refused():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            qid = resp.json()["id"]

            self.use_token("company2")   # a different seller entirely
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "updateStatus", "value": {"status": "approved"},
            })
            if resp.status_code != 403:
                raise AssertionError(
                    f"company2 changed a quote belonging to company1 (got {resp.status_code}) — cross-tenant write"
                )
            ok("A seller cannot patch another seller's quote (403)")

        self.run_test("9t. Cross-tenant quote patch refused", test_cross_tenant_patch_refused)

        # 9w. A buyer must not be able to walk their own held order out of
        # approval. customerPropose used to move a standard quote to "proposed"
        # with the chain left intact, after which the seller's approve took the
        # ungated path and the order was paid with a level still pending.
        def test_propose_cannot_escape_approval():
            set_buyer_policy("customer", cust_id, threshold=1, scope="both",
                             chain=[step_cfg(approver_id)])
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            qid = resp.json()["id"]
            if resp.json().get("status") != "pending_approval":
                raise AssertionError("setup failed: the order was not held")

            self.use_token("customer")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "customerPropose",
                "value": {"changes": [{"itemId": resp.json()["items"][0]["id"], "proposedPrice": 1}]},
            })
            if resp.status_code == 200:
                raise AssertionError(
                    "a buyer moved their own held order out of pending_approval via customerPropose"
                )
            resp = self.api.get(f"/checkout/quotes/{qid}")
            if resp.json().get("status") != "pending_approval":
                raise AssertionError(f"the held order changed status to {resp.json().get('status')!r}")
            ok("customerPropose refused on a held standard order")

        self.run_test("9w. A buyer cannot propose their way out of approval", test_propose_cannot_escape_approval)

        # 9x. The money must not move while a chain is running: re-pricing under a
        # granted approval produced an order payable at a total no approver saw.
        def test_money_locked_during_approval():
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            qid = self._create_quote("customer", c1_id, "standard").json()["id"]

            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "applyDiscount", "value": {"discountPercentage": 50},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"a seller re-priced an order awaiting approval (got {resp.status_code})"
                )
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "sellerUpdate", "value": {"newShippingCost": 999, "notes": "x"},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"a seller changed shipping on an order awaiting approval (got {resp.status_code})"
                )
            ok("Prices and shipping locked while the order awaits approval")

            # And still locked once the buyer has approved it.
            self.re_login("customer2")
            self.use_token("customer2")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "approvalDecision", "value": {"decision": "approve"},
            })
            assert_status(resp, 200, "Approver approves")
            self.use_token("company1")
            resp = self.api.patch(f"/checkout/quotes/{qid}", {
                "operation": "applyDiscount", "value": {"discountPercentage": 50},
            })
            if resp.status_code != 409:
                raise AssertionError(
                    f"a seller re-priced an order the buyer had already approved (got {resp.status_code})"
                )
            ok("Prices stay locked after the buyer approved")

        self.run_test("9x. Money is locked during and after approval", test_money_locked_during_approval)


        # 9l. Under threshold: no gate, no regression for ordinary B2B orders.
        def test_under_threshold_not_gated():
            self.use_token("company1")
            set_buyer_policy("customer", cust_id, threshold=999999, scope="both", chain=[step_cfg(approver_id)])

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            assert_status(resp, 200, "Under-threshold quote")
            if resp.json().get("status") != "approved":
                raise AssertionError(
                    f"an under-threshold order must not be held, got {resp.json().get('status')!r}"
                )
            ok("Under-threshold order approved immediately")

        self.run_test("9l. Under threshold is not gated", test_under_threshold_not_gated)

        # Restore: leave no approval policy behind for later phases.
        def test_cleanup_policy():
            set_buyer_policy("customer", cust_id, threshold=0, scope="none", chain=[])
            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 3)
            resp = self._create_quote("customer", c1_id, "standard")
            if resp.json().get("status") != "approved":
                raise AssertionError("policy did not clear; later phases would inherit a gate")
            ok("Approval policy cleared for downstream phases")

        self.run_test("9m. Approval policy cleared", test_cleanup_policy)

    # ── Phase 8b: Time-based deals & CSV export ──────────────────

    def phase8b_deals_and_export(self):
        phase("PHASE 8b: Time-Based Deals & CSV Export")

        c1_id = self.ids["company1"]
        product_a = self.product_ids["company1"][0]

        def test_active_deal():
            """Set deal with future end date → deal should be active"""
            self.use_token("company1")
            from datetime import datetime, timedelta, timezone
            start = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            end = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            resp = self.api.put(f"/products/{product_a}", {
                "dealPrice": 15,
                "dealStartDate": start,
                "dealEndDate": end,
            })
            assert_status(resp, 200, "Set active deal with dates")

            # Customer should see dealPrice on this product
            self.use_token("customer")
            resp = self.api.get(f"/products/{product_a}")
            assert_status(resp, 200, "Get product as customer")
            data = resp.json()
            assert data.get("dealPrice") == 15, f"Expected dealPrice=15, got {data.get('dealPrice')}"
            assert data.get("dealEndDate") is not None, "Expected dealEndDate to be set"
            ok(f"Active deal: dealPrice={data['dealPrice']}%, ends={data['dealEndDate'][:10]}")

        self.run_test("Active deal with date range", test_active_deal)

        def test_expired_deal():
            """Set deal with past end date → product still has dealPrice but dates indicate expired"""
            self.use_token("company1")
            from datetime import datetime, timedelta, timezone
            start = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
            end = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            resp = self.api.put(f"/products/{product_a}", {
                "dealPrice": 10,
                "dealStartDate": start,
                "dealEndDate": end,
            })
            assert_status(resp, 200, "Set expired deal")

            # Product still has dealPrice in DB, but frontend/storefront filters it out
            self.use_token("customer")
            resp = self.api.get(f"/products/{product_a}")
            assert_status(resp, 200, "Get product with expired deal")
            data = resp.json()
            assert data.get("dealPrice") == 10, f"Expected dealPrice=10, got {data.get('dealPrice')}"
            # Verify end date is in the past
            from datetime import datetime, timezone
            end_dt = datetime.fromisoformat(data["dealEndDate"].replace("Z", "+00:00"))
            assert end_dt < datetime.now(timezone.utc), "Expected dealEndDate in the past"
            ok(f"Expired deal stored: dealPrice={data['dealPrice']}%, ended={data['dealEndDate'][:10]}")

        self.run_test("Expired deal (stored but filtered client-side)", test_expired_deal)

        def test_clear_deal():
            """Clear deal dates and price"""
            self.use_token("company1")
            resp = self.api.put(f"/products/{product_a}", {
                "dealPrice": 0,
                "dealStartDate": "",
                "dealEndDate": "",
            })
            assert_status(resp, 200, "Clear deal")
            ok("Deal cleared")

        self.run_test("Clear deal dates", test_clear_deal)

        def test_csv_export():
            """Company exports customer list as CSV"""
            self.use_token("company1")
            resp = self.api.get("/accounts/export")
            assert_status(resp, 200, "CSV export")
            body = resp.text
            assert "Name,Email,Role,Created" in body, f"Expected CSV header, got: {body[:100]}"
            lines = [l for l in body.strip().split("\n") if l]
            assert len(lines) >= 2, f"Expected at least header + 1 row, got {len(lines)} lines"
            ok(f"CSV export: {len(lines) - 1} customer rows")

        self.run_test("Customer CSV export (company)", test_csv_export)

    # ── Phase 8c: Password reset & email case ───────────────────

    def phase8c_password_reset(self):
        phase("PHASE 8c: Password Reset & Email Case")

        def test_forgot_password():
            """Forgot password returns 200 with generic message"""
            resp = self.api.post("/accounts/forgot-password", {
                "email": USERS["customer"]["email"]
            })
            assert_status(resp, 200, "Forgot password")
            msg = resp.json().get("message", "")
            assert "If an account" in msg, f"Expected generic message, got: {msg}"
            ok(f"Forgot password: {msg[:60]}")

        self.run_test("Forgot password endpoint", test_forgot_password)

        def test_forgot_nonexistent():
            """Forgot password with unknown email still returns 200 (no enumeration)"""
            resp = self.api.post("/accounts/forgot-password", {
                "email": "nonexistent@nowhere.com"
            })
            assert_status(resp, 200, "Forgot password (nonexistent)")
            ok("Nonexistent email returns 200 (no enumeration)")

        self.run_test("Forgot password no enumeration", test_forgot_nonexistent)

        def test_reset_bad_token():
            """Reset password with invalid token returns 400"""
            resp = self.api.post("/accounts/reset-password", {
                "token": "invalidtoken123",
                "password": "New@Secure1"
            })
            assert_status(resp, 400, "Reset bad token")
            ok("Bad token rejected")

        self.run_test("Reset password bad token", test_reset_bad_token)

        def test_email_case_login():
            """Login with different case should work (email normalized)"""
            email = USERS["customer"]["email"]
            upper = email.upper()
            resp = self.api.post("/accounts/login", {"email": upper, "password": PASSWORD})
            assert_status(resp, 200, "Login with uppercase email")
            ok(f"Login with {upper} works (normalized to lowercase)")

        self.run_test("Email case-insensitive login", test_email_case_login)

        def test_tax_rate():
            """Tax calculated using company taxRate, not hardcoded"""
            c1_id = self.ids["company1"]
            product_a = self.product_ids["company1"][0]

            self.re_login("customer")
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, product_a, 1)

            resp = self._create_quote("customer", c1_id)
            assert_status(resp, 200, "Quote with taxRate")
            data = resp.json()
            subtotal = data.get("subtotal", 0)
            tax = data.get("taxAmount", 0)
            rate = data.get("taxRate", 0)
            assert rate == 8.25, f"Expected taxRate=8.25, got {rate}"
            expected_tax = round(subtotal * 0.0825, 2)
            assert abs(tax - expected_tax) < 0.02, f"Expected tax ~{expected_tax}, got {tax}"
            shipping = data.get("shippingCost", 0)
            shipping_rate = data.get("shippingRate", 0)
            assert shipping_rate == 15.0, f"Expected shippingRate=15, got {shipping_rate}"
            assert shipping == 15.0, f"Expected shippingCost=15, got {shipping}"
            ok(f"Tax correct: ${subtotal:.2f} × {rate}% = ${tax:.2f}, shipping=${shipping:.2f}")

        self.run_test("Tax and shipping rate from company config", test_tax_rate)

    # ── Phase 8d: Visitor Tracking ─────────────────────────────────

    def phase8d_visitor_tracking(self):
        phase("PHASE 8d: Visitor Tracking")

        test_vid = "v___test__" + str(int(time.time()))
        self.tracker.track_visitor(test_vid)

        # Test 1: Normal visitor event captures all fields
        def test_visitor_event():
            resp = self.api.post("/visitors/event", {
                "visitorId": test_vid,
                "event": "page_view",
                "page": "/",
                "referrer": "https://www.google.com/",
                "utm_source": "google",
                "utm_medium": "cpc",
                "utm_campaign": "shopify-alt",
                "utm_content": "ad-v1",
                "utm_term": "shopify alternative no monthly fee",
                "clickIds": {"gclid": "test_gclid_abc123", "msclkid": "test_msclkid_xyz789"},
                "timezone": "America/New_York",
                "screenWidth": 1920,
                "screenHeight": 1080,
                "language": "en-US",
            })
            assert_status(resp, 200, "Visitor event accepted")
            ok("Visitor page_view event accepted")

        self.run_test("Visitor event with all fields", test_visitor_event)

        # Test 2: Admin visitor is skipped (when customerId is admin)
        def test_admin_skipped():
            admin_id = self.ids.get("admin", "")
            resp = self.api.post("/visitors/event", {
                "visitorId": "v___test__admin_skip",
                "event": "page_view",
                "page": "/",
                "customerId": admin_id,
            })
            assert_status(resp, 200, "Admin event returns 200")
            body = resp.json()
            assert body.get("status") == "skipped", f"Expected skipped, got {body.get('status')}"
            ok("Admin visitor correctly skipped")

        self.run_test("Admin visitor skipped", test_admin_skipped)

        # Test 3: Company visitor is skipped
        def test_company_skipped():
            company_id = self.ids.get("company1", "")
            resp = self.api.post("/visitors/event", {
                "visitorId": "v___test__company_skip",
                "event": "page_view",
                "page": "/",
                "customerId": company_id,
            })
            assert_status(resp, 200, "Company event returns 200")
            body = resp.json()
            assert body.get("status") == "skipped", f"Expected skipped, got {body.get('status')}"
            ok("Company visitor correctly skipped")

        self.run_test("Company visitor skipped", test_company_skipped)

        # Test 4: Retrieve visitor and verify all stored fields
        def test_visitor_data():
            self.use_token("admin")
            resp = self.api.get(f"/visitors?visitorId={test_vid}")
            assert_status(resp, 200, "Get visitor by ID")
            visitors = resp.json().get("visitors", [])
            assert len(visitors) == 1, f"Expected 1 visitor, got {len(visitors)}"
            v = visitors[0]

            # Attribution
            attr = v.get("attribution", {})
            assert attr.get("source") == "google", f"source: {attr.get('source')}"
            assert attr.get("medium") == "cpc", f"medium: {attr.get('medium')}"
            assert attr.get("campaign") == "shopify-alt", f"campaign: {attr.get('campaign')}"
            assert attr.get("content") == "ad-v1", f"content: {attr.get('content')}"
            assert attr.get("term") == "shopify alternative no monthly fee", f"term: {attr.get('term')}"
            assert attr.get("landingPage") == "/", f"landingPage: {attr.get('landingPage')}"
            ok("Attribution fields correct (source, medium, campaign, content, term, landingPage)")

            # Click IDs (PPC attribution)
            click_ids = attr.get("clickIds", {})
            assert click_ids.get("gclid") == "test_gclid_abc123", f"gclid: {click_ids.get('gclid')}"
            assert click_ids.get("msclkid") == "test_msclkid_xyz789", f"msclkid: {click_ids.get('msclkid')}"
            ok("Click IDs captured (gclid, msclkid)")

            # Geo — timezone from browser fallback
            geo = v.get("geo", {})
            assert geo.get("timezone") == "America/New_York", f"timezone: {geo.get('timezone')}"
            ok("Timezone captured from browser fallback")

            # Device info
            assert v.get("screenWidth") == 1920, f"screenWidth: {v.get('screenWidth')}"
            assert v.get("screenHeight") == 1080, f"screenHeight: {v.get('screenHeight')}"
            assert v.get("language") == "en-US", f"language: {v.get('language')}"
            ok("Screen resolution and language captured")

            # Activity
            assert v.get("totalSessions") == 1, f"sessions: {v.get('totalSessions')}"
            assert v.get("totalPageViews") == 1, f"pageViews: {v.get('totalPageViews')}"
            assert "/" in v.get("pages", []), f"pages: {v.get('pages')}"
            ok("Activity counters correct")

        self.run_test("Visitor data verification", test_visitor_data)

        # Test 5: Milestone event (add_to_cart)
        def test_milestone():
            resp = self.api.post("/visitors/event", {
                "visitorId": test_vid,
                "event": "add_to_cart",
                "page": "/products/test.html",
                "timezone": "America/New_York",
                "screenWidth": 1920,
                "screenHeight": 1080,
                "language": "en-US",
                "metadata": {"productId": "test123", "productName": "Test Product", "price": 29.99},
            })
            assert_status(resp, 200, "Add to cart event")

            self.use_token("admin")
            resp = self.api.get(f"/visitors?visitorId={test_vid}")
            v = resp.json().get("visitors", [])[0]
            milestones = v.get("milestones", [])
            assert len(milestones) >= 1, f"Expected milestones, got {len(milestones)}"
            m = milestones[0]
            assert m.get("event") == "add_to_cart", f"milestone event: {m.get('event')}"
            assert m.get("metadata", {}).get("productName") == "Test Product", "milestone metadata"
            ok("Milestone (add_to_cart) stored with metadata")

        self.run_test("Visitor milestone event", test_milestone)

        # Test 5b: Checkout-funnel milestones (Roadmap #41 Phase A). These are
        # persisted as milestones for funnel visibility and deliberately NOT sent to
        # ad platforms. Post each step, then assert all six land on the visitor doc.
        def test_checkout_funnel_milestones():
            funnel = [
                ("checkout_email", {}),
                ("checkout_details", {"amount": 23.53}),
                ("checkout_address", {"mode": "create"}),
                ("checkout_payment", {"method": "stripe_pay"}),
                ("payment_redirect", {"paymentMethod": "stripe_pay", "amount": 23.53}),
                ("payment_redirect_back", {"status": "success"}),
            ]
            for event, meta in funnel:
                resp = self.api.post("/visitors/event", {
                    "visitorId": test_vid,
                    "event": event,
                    "page": "/products/test.html",
                    "metadata": meta,
                })
                assert_status(resp, 200, f"{event} event accepted")

            self.use_token("admin")
            resp = self.api.get(f"/visitors?visitorId={test_vid}")
            v = resp.json().get("visitors", [])[0]
            milestones = v.get("milestones", [])
            events_seen = [m.get("event") for m in milestones]
            for event, _ in funnel:
                assert event in events_seen, f"missing milestone {event} (have {events_seen})"
            # Metadata must survive on the money-path steps.
            prb = next((m for m in milestones if m.get("event") == "payment_redirect_back"), {})
            assert prb.get("metadata", {}).get("status") == "success", f"payment_redirect_back status: {prb.get('metadata')}"
            pr = next((m for m in milestones if m.get("event") == "payment_redirect"), {})
            assert pr.get("metadata", {}).get("paymentMethod") == "stripe_pay", f"payment_redirect method: {pr.get('metadata')}"
            ok("Checkout-funnel milestones stored (email, details, address, payment, redirect, redirect_back)")

        self.run_test("Checkout funnel milestones", test_checkout_funnel_milestones)

        # Test 5c: Checkout EXIT milestones (Roadmap #41 Phase A2). Phase A covered
        # only the happy path, so every exit before checkout_email was invisible --
        # including the guest-modal drop the whole epic was written about. These three
        # events carry their detail in metadata (reason / stage / mode), so the
        # assertions check the metadata survives, not just the event name.
        def test_checkout_exit_milestones():
            exits = [
                ("checkout_modal", {"stage": "modal", "mode": "shown"}),
                ("checkout_blocked", {"stage": "modal", "reason": "email_exists"}),
                ("checkout_blocked", {"stage": "quote", "reason": "quote_failed", "message": "out of stock"}),
                ("checkout_abandon", {"stage": "overlay", "mode": "exit"}),
            ]
            for event, meta in exits:
                resp = self.api.post("/visitors/event", {
                    "visitorId": test_vid,
                    "event": event,
                    "page": "/products/test.html",
                    "metadata": meta,
                })
                assert_status(resp, 200, f"{event} event accepted")

            self.use_token("admin")
            resp = self.api.get(f"/visitors?visitorId={test_vid}")
            v = resp.json().get("visitors", [])[0]
            milestones = v.get("milestones", [])
            events_seen = [m.get("event") for m in milestones]
            for event, _ in exits:
                assert event in events_seen, f"missing milestone {event} (have {events_seen})"

            blocked = [m for m in milestones if m.get("event") == "checkout_blocked"]
            reasons = {m.get("metadata", {}).get("reason") for m in blocked}
            assert "email_exists" in reasons, f"email_exists reason missing: {reasons}"
            assert "quote_failed" in reasons, f"quote_failed reason missing: {reasons}"
            # Two blocks with different reasons must both persist; a single generic
            # "checkout failed" record would hide which one actually stopped the buyer.
            assert len(blocked) >= 2, f"expected both blocked reasons, got {len(blocked)}"

            ab = next((m for m in milestones if m.get("event") == "checkout_abandon"), {})
            assert ab.get("metadata", {}).get("stage") == "overlay", f"abandon stage: {ab.get('metadata')}"

            # Exit events are internal funnel only and must never be dispatched to the
            # ad platforms, so no CAPI result may be attached to any of them.
            for m in milestones:
                if m.get("event") in ("checkout_modal", "checkout_blocked", "checkout_abandon"):
                    assert "capi" not in m.get("metadata", {}), f"{m.get('event')} must not hit CAPI: {m.get('metadata')}"
            ok("Checkout exit milestones stored (modal, blocked x2 reasons, abandon) and kept off CAPI")

        self.run_test("Checkout exit milestones", test_checkout_exit_milestones)

        # Test 6: Click IDs follow last-click semantics; UTMs + landing page stay first-click
        def test_clickid_last_click_overwrite():
            resp = self.api.post("/visitors/event", {
                "visitorId": test_vid,
                "event": "page_view",
                "page": "/products/other.html",
                "utm_source": "bing",  # different source: must be IGNORED (first-click UTMs)
                "utm_medium": "cpc",
                "clickIds": {"gclid": "NEW_gclid_999"},  # different gclid: must WIN (last-click)
            })
            assert_status(resp, 200, "Return visit accepted")

            self.use_token("admin")
            v = self.api.get(f"/visitors?visitorId={test_vid}").json().get("visitors", [])[0]
            attr = v.get("attribution", {})
            # Last-click: new gclid wins; msclkid cleared (replaced map)
            assert attr.get("clickIds", {}).get("gclid") == "NEW_gclid_999", f"gclid not overwritten: {attr.get('clickIds')}"
            assert "msclkid" not in attr.get("clickIds", {}), f"msclkid not cleared: {attr.get('clickIds')}"
            # First-click: original UTMs and landing page preserved
            assert attr.get("source") == "google", f"source clobbered: {attr.get('source')}"
            assert attr.get("landingPage") == "/", f"landingPage clobbered: {attr.get('landingPage')}"
            ok("Last-click clickIds + first-click UTMs/landingPage preserved")

        self.run_test("Click IDs last-click + UTMs first-click", test_clickid_last_click_overwrite)

        # Test 7: contact_request persists a lead milestone (platform demo form).
        # A real browser UA is sent so the handler's isBot guard doesn't drop it —
        # exactly how a genuine visitor submits.
        real_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"

        def test_contact_request_lead():
            cvid = "v___test__contact_" + str(int(time.time()))
            self.tracker.track_visitor(cvid)
            resp = self.api.post("/visitors/event", {
                "visitorId": cvid,
                "event": "contact_request",
                "page": "/contact-us",
                "clickIds": {"gclid": "test_lead_gclid_777"},
                "metadata": {
                    "name": "Jordan Rivera",
                    "email": "jordan@riverafoods.test",
                    "company": "Rivera Specialty Foods",
                    "sells": "Halal grocery",
                    "phone": "555-0100",
                    "purpose": "demo",
                },
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "contact_request accepted")

            self.use_token("admin")
            visitors = self.api.get(f"/visitors?visitorId={cvid}").json().get("visitors", [])
            assert len(visitors) == 1, f"expected 1 visitor, got {len(visitors)}"
            leads = [m for m in (visitors[0].get("milestones") or []) if m.get("event") == "contact_request"]
            assert len(leads) == 1, f"expected 1 contact_request lead, got {len(leads)}"
            md = leads[0].get("metadata", {})
            assert md.get("name") == "Jordan Rivera", f"name: {md.get('name')}"
            assert md.get("email") == "jordan@riverafoods.test", f"email: {md.get('email')}"
            assert md.get("company") == "Rivera Specialty Foods", f"company: {md.get('company')}"
            assert md.get("gclid") == "test_lead_gclid_777", f"gclid: {md.get('gclid')}"
            ok("contact_request lead persisted with fields + gclid")

        self.run_test("Contact request lead captured", test_contact_request_lead)

        # Test 8: honeypot ("website" filled) drops the lead silently — 200 back,
        # no contact_request milestone stored.
        def test_contact_request_honeypot():
            hvid = "v___test__contact_hp_" + str(int(time.time()))
            self.tracker.track_visitor(hvid)
            resp = self.api.post("/visitors/event", {
                "visitorId": hvid,
                "event": "contact_request",
                "page": "/contact-us",
                "metadata": {
                    "name": "Spam Bot",
                    "email": "bot@spam.test",
                    "company": "Spammy",
                    "website": "http://spam.example",
                },
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "honeypot contact_request returns 200")

            self.use_token("admin")
            visitors = self.api.get(f"/visitors?visitorId={hvid}").json().get("visitors") or []
            if visitors:
                # milestones serializes as JSON null (nil slice) when empty, so coerce
                leads = [m for m in (visitors[0].get("milestones") or []) if m.get("event") == "contact_request"]
                assert len(leads) == 0, f"honeypot lead should be dropped, found {len(leads)}"
            ok("Honeypot contact_request dropped (no lead milestone)")

        self.run_test("Contact request honeypot dropped", test_contact_request_honeypot)

        # Test 9: the portal signup conversion. The portal sends the account id in
        # metadata rather than as a top-level customerId, because a top-level
        # customerId belonging to a company account trips the internal-user gate and
        # the whole event is dropped (see tests 2 and 3 above, which assert that gate
        # still works for page_view). This asserts the conversion actually lands:
        # milestone stored, and the visitor flipped to registered with daysToRegister.
        def test_register_conversion():
            rvid = "v___test__register_" + str(int(time.time()))
            self.tracker.track_visitor(rvid)
            # A prior page_view so the visitor exists and firstVisit is set; the
            # conversion is an UPDATE to a known visitor, never a fresh insert.
            resp = self.api.post("/visitors/event", {
                "visitorId": rvid,
                "event": "page_view",
                "page": "/",
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "register-conversion seed page_view accepted")

            company_id = self.ids.get("company1", "")
            resp = self.api.post("/visitors/event", {
                "visitorId": rvid,
                "event": "register",
                "page": "/register",
                "metadata": {"accountId": company_id, "role": "company"},
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "register event accepted")
            assert resp.json().get("status") != "skipped", "register event was skipped, not recorded"

            self.use_token("admin")
            visitors = self.api.get(f"/visitors?visitorId={rvid}").json().get("visitors", [])
            assert len(visitors) == 1, f"expected 1 visitor, got {len(visitors)}"
            v = visitors[0]
            regs = [m for m in (v.get("milestones") or []) if m.get("event") == "register"]
            assert len(regs) == 1, f"expected 1 register milestone, got {len(regs)}"
            assert regs[0].get("metadata", {}).get("accountId") == company_id, \
                f"accountId: {regs[0].get('metadata', {}).get('accountId')}"
            assert v.get("registered") is True, f"registered flag not set: {v.get('registered')}"
            assert v.get("registeredAt"), "registeredAt not set"
            assert v.get("daysToRegister") is not None, "daysToRegister not set"
            ok("Portal signup conversion recorded (milestone + registered flag)")

        self.run_test("Register conversion recorded", test_register_conversion)

        # Test 10: the "mtd" (this-month) range, added alongside the Analytics default.
        # A visitor touched right now always falls inside the current calendar month,
        # so it must come back under since=mtd on BOTH endpoints. The two endpoints
        # parse "since" in separate switches, so both are asserted: if one drifts, the
        # stat cards and the visitor list below them cover different periods.
        def test_mtd_range():
            mvid = "v___test__mtd_" + str(int(time.time()))
            self.tracker.track_visitor(mvid)
            resp = self.api.post("/visitors/event", {
                "visitorId": mvid,
                "event": "page_view",
                "page": "/",
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "mtd seed page_view accepted")

            self.use_token("admin")
            resp = self.api.get(f"/visitors?visitorId={mvid}&since=mtd")
            assert_status(resp, 200, "visitors list accepts since=mtd")
            found = resp.json().get("visitors") or []
            assert len(found) == 1, f"since=mtd should include a visitor seen today, got {len(found)}"

            resp = self.api.get("/visitors/stats?since=mtd")
            assert_status(resp, 200, "visitor stats accepts since=mtd")
            assert resp.json().get("totalVisitors") is not None, "stats since=mtd returned no totalVisitors"
            ok("since=mtd honoured by both visitors list and stats")

        self.run_test("This-month (mtd) range", test_mtd_range)

        # Test 11: the event filter behind the Visitors table "Status" dropdown.
        # event=any means "has at least one milestone", which is the table default;
        # event=<name> matches that single milestone. A page_view alone writes no
        # milestone, so a plain visitor must be excluded by both.
        def test_event_filter():
            evid = "v___test__event_" + str(int(time.time()))
            self.tracker.track_visitor(evid)
            resp = self.api.post("/visitors/event", {
                "visitorId": evid, "event": "page_view", "page": "/",
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "event-filter seed page_view accepted")

            self.use_token("admin")
            # No milestone yet: excluded from event=any.
            found = self.api.get(f"/visitors?visitorId={evid}&event=any").json().get("visitors") or []
            assert len(found) == 0, f"page_view-only visitor must not match event=any, got {len(found)}"

            # Give it a milestone, then it must appear under both any and its own name.
            resp = self.api.post("/visitors/event", {
                "visitorId": evid, "event": "add_to_cart", "page": "/p",
                "metadata": {"productId": "evt-test", "price": 1},
            }, headers={"User-Agent": real_ua})
            assert_status(resp, 200, "add_to_cart accepted")

            self.use_token("admin")
            found = self.api.get(f"/visitors?visitorId={evid}&event=any").json().get("visitors") or []
            assert len(found) == 1, f"visitor with a milestone must match event=any, got {len(found)}"
            found = self.api.get(f"/visitors?visitorId={evid}&event=add_to_cart").json().get("visitors") or []
            assert len(found) == 1, f"event=add_to_cart should match, got {len(found)}"
            found = self.api.get(f"/visitors?visitorId={evid}&event=order").json().get("visitors") or []
            assert len(found) == 0, f"event=order must not match a cart-only visitor, got {len(found)}"
            ok("event filter honoured (any + single event + non-match)")

        self.run_test("Visitor event filter", test_event_filter)

        # Cleanup: delete test visitor
        def test_cleanup_visitor():
            # Direct DB cleanup not possible via API — visitor will be orphaned but harmless
            # Just verify the skipped visitors weren't created
            self.use_token("admin")
            for skip_vid in ["v___test__admin_skip", "v___test__company_skip"]:
                resp = self.api.get(f"/visitors?visitorId={skip_vid}")
                visitors = resp.json().get("visitors") or []
                assert len(visitors) == 0, f"Skipped visitor {skip_vid} should not exist, found {len(visitors)}"
            ok("Skipped visitors confirmed not in database")

        self.run_test("Verify skipped visitors not stored", test_cleanup_visitor)

    # ── Phase 8e: Billing Statements ───────────────────────────────

    def phase8e_billing_statements(self):
        phase("PHASE 8e: Billing Statements")

        c1_id = self.ids["company1"]
        # Period covering all of "this month" — orders created earlier in this run fall inside.
        now = datetime.datetime.now(datetime.timezone.utc)
        from_dt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # Add ~32 days then snap to first of next month for the upper bound.
        next_month = (from_dt + datetime.timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        from_str = from_dt.isoformat().replace("+00:00", "Z")
        to_str = next_month.isoformat().replace("+00:00", "Z")

        def test_get_statement_admin():
            """Admin can fetch any seller's statement"""
            self.use_token("admin")
            resp = self.api.get("/checkout/orders/statement",
                                params={"sellerId": c1_id, "from": from_str, "to": to_str})
            assert_status(resp, 200, "Admin GET statement")
            data = resp.json()
            assert data.get("sellerId") == c1_id, f"sellerId mismatch: {data.get('sellerId')}"
            assert data.get("tier") in ("Starter", "Growth", "Enterprise"), f"bad tier: {data.get('tier')}"
            assert "orderCount" in data, "missing orderCount"
            assert "totalDue" in data, "missing totalDue"
            ok(f"Statement: tier={data['tier']} orders={data['orderCount']} totalDue=${data['totalDue']:.2f}")

        self.run_test("GET statement as admin", test_get_statement_admin)

        def test_get_statement_own_seller():
            """Company can fetch its OWN statement"""
            self.use_token("company1")
            resp = self.api.get("/checkout/orders/statement",
                                params={"sellerId": c1_id, "from": from_str, "to": to_str})
            assert_status(resp, 200, "Company GET own statement")
            data = resp.json()
            assert data.get("sellerId") == c1_id, "own sellerId mismatch"
            ok("Company can fetch own statement")

        self.run_test("GET own statement as company", test_get_statement_own_seller)

        def test_get_statement_other_forbidden():
            """Customer fetching another seller's statement is forbidden"""
            self.use_token("customer")
            resp = self.api.get("/checkout/orders/statement",
                                params={"sellerId": c1_id, "from": from_str, "to": to_str})
            assert_status(resp, 403, "Customer GET others' statement")
            ok("Non-admin/non-seller correctly forbidden")

        self.run_test("Statement forbidden for unrelated role", test_get_statement_other_forbidden)

        def test_get_statement_bad_dates():
            """Invalid date range rejected"""
            self.use_token("admin")
            resp = self.api.get("/checkout/orders/statement",
                                params={"sellerId": c1_id, "from": to_str, "to": from_str})
            assert_status(resp, 400, "Inverted date range")
            ok("Inverted date range rejected (400)")

        self.run_test("Statement bad date range", test_get_statement_bad_dates)

        def test_send_statement_dryrun():
            """Admin dryRun returns rendered email body without sending"""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "billing-test@example.com",
                "companyName": "Test Co",
                "periodLabel": "Test Period",
                "paymentInstructions": "Pay via test rails.",
                "dryRun": True,
            })
            assert_status(resp, 200, "Dry-run send")
            data = resp.json()
            assert data.get("dryRun") is True, "dryRun flag not echoed"
            assert data.get("htmlBody"), "missing htmlBody"
            assert data.get("textBody"), "missing textBody"
            assert "statement" in data, "missing statement"
            ok("Dry-run preview returns htmlBody, textBody, statement")

        self.run_test("Send statement dryRun preview", test_send_statement_dryrun)

        def test_send_statement_company_forbidden():
            """Non-admin POST to send is rejected"""
            self.use_token("company1")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "x@example.com",
                "companyName": "X",
                "periodLabel": "P",
                "dryRun": True,
            })
            assert_status(resp, 403, "Company send")
            ok("Non-admin send correctly forbidden")

        self.run_test("Send statement admin-only", test_send_statement_company_forbidden)

        def test_send_statement_bad_email():
            """Malformed recipientEmail rejected"""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "not-an-email",
                "companyName": "X",
                "periodLabel": "P",
                "dryRun": True,
            })
            assert_status(resp, 400, "Bad email")
            ok("Malformed email rejected (400)")

        self.run_test("Send statement validates email", test_send_statement_bad_email)

        def test_statement_route_guard():
            """POST /checkout/orders/statement (no /send) must NOT fall through to place-order.
            API Gateway has no POST method on /statement, so it rejects with 403 before Lambda
            is invoked — strictly safer than reaching the handler."""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement", {})
            assert_status(resp, 403, "POST /statement (no /send)")
            ok("API Gateway rejects unmapped POST /statement (no fall-through to place-order)")

        self.run_test("Statement route guard", test_statement_route_guard)

        # Track statement count before real send so we can verify exactly one new row.
        def test_send_statement_persists():
            """Real (non-dryRun) send returns a snapshot doc with id+sentAt.
            Local SMTP is no-op — Send returns nil so the snapshot still persists,
            which is the path we want to test."""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "billing-test@example.com",
                "companyName": "Test Co",
                "periodLabel": "Test Period",
                "paymentInstructions": "Pay via test rails.",
                "dryRun": False,
            })
            assert_status(resp, 200, "Real send")
            data = resp.json()
            assert data.get("sent") is True, "sent flag not true"
            snap = data.get("snapshot")
            assert snap, f"missing snapshot in response: {data}"
            assert snap.get("id"), "snapshot missing id"
            assert snap.get("sentAt"), "snapshot missing sentAt"
            assert snap.get("sellerId") == c1_id, "snapshot sellerId mismatch"
            assert snap.get("recipientEmail") == "billing-test@example.com", "snapshot recipient mismatch"
            self.tracker.track_statement(snap["id"])
            ok(f"Statement persisted: id={snap['id'][:8]}... totalDue=${snap['totalDue']:.2f}")

        self.run_test("Send statement persists snapshot", test_send_statement_persists)

        def test_get_statements_admin():
            """Admin can list any seller's persisted statements"""
            self.use_token("admin")
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            assert_status(resp, 200, "Admin list statements")
            arr = resp.json()
            assert isinstance(arr, list), f"expected list, got {type(arr)}"
            assert len(arr) >= 1, f"expected ≥1 statement, got {len(arr)}"
            assert arr[0].get("sellerId") == c1_id, "list result sellerId mismatch"
            ok(f"Admin sees {len(arr)} statement(s)")

        self.run_test("List statements as admin", test_get_statements_admin)

        def test_get_statements_own_seller():
            """Company can list its own persisted statements"""
            self.use_token("company1")
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            assert_status(resp, 200, "Company list own")
            arr = resp.json()
            assert len(arr) >= 1, "company should see own statement"
            ok(f"Company sees {len(arr)} own statement(s)")

        self.run_test("List own statements as company", test_get_statements_own_seller)

        def test_get_statements_other_forbidden():
            """Customer listing another seller's statements is forbidden"""
            self.use_token("customer")
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            assert_status(resp, 403, "Customer list others'")
            ok("Non-admin/non-seller correctly forbidden on list")

        self.run_test("List statements forbidden for unrelated role", test_get_statements_other_forbidden)

        def test_get_statements_missing_seller():
            """Missing sellerId rejected"""
            self.use_token("admin")
            resp = self.api.get("/checkout/statements")
            assert_status(resp, 400, "Missing sellerId")
            ok("Missing sellerId rejected (400)")

        self.run_test("List statements requires sellerId", test_get_statements_missing_seller)

        # ── Duplicate-send guard (roadmap #51 phase 2, finding 4) ──
        # Save runs only AFTER the email is away, so the guard has to refuse
        # before the send or the company holds an invoice we have no record of.

        def test_send_statement_duplicate_refused():
            """A second send for the same period is refused with 409, not silently billed twice"""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "billing-test@example.com",
                "companyName": "Test Co",
                "periodLabel": "Test Period",
                "dryRun": False,
            })
            assert_status(resp, 409, "Duplicate send")
            body = resp.json().get("message", "")
            assert "already sent" in body.lower(), f"409 body should name the existing statement, got: {body}"
            ok("Duplicate send refused (409) and the message names the existing statement")

        self.run_test("Duplicate statement send refused", test_send_statement_duplicate_refused)

        def test_send_statement_dryrun_not_blocked_by_duplicate():
            """Preview still renders for an already-billed period: the guard must not block looking"""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "billing-test@example.com",
                "companyName": "Test Co",
                "periodLabel": "Test Period",
                "dryRun": True,
            })
            assert_status(resp, 200, "Dry run on a duplicate period")
            assert resp.json().get("htmlBody"), "preview should still render"
            ok("Dry-run preview unaffected by the duplicate guard")

        self.run_test("Duplicate guard does not block preview", test_send_statement_dryrun_not_blocked_by_duplicate)

        def test_send_statement_duplicate_allowed_with_flag():
            """allowDuplicate is the deliberate override, so a real re-send stays possible"""
            self.use_token("admin")
            resp = self.api.post("/checkout/orders/statement/send", {
                "sellerId": c1_id,
                "from": from_str,
                "to": to_str,
                "recipientEmail": "billing-test@example.com",
                "companyName": "Test Co",
                "periodLabel": "Test Period",
                "dryRun": False,
                "allowDuplicate": True,
            })
            assert_status(resp, 200, "Duplicate send with override")
            snap = resp.json().get("snapshot")
            assert snap and snap.get("id"), "override send should persist a second snapshot"
            self.tracker.track_statement(snap["id"])
            ok("allowDuplicate override permits a deliberate second statement")

        self.run_test("Duplicate send allowed with explicit flag", test_send_statement_duplicate_allowed_with_flag)

        # ── Payment settlement (roadmap #51 phase 2) ──
        # paidAt / paymentReference were reserved on the model from the start;
        # PUT /checkout/statements/{id} is the write path they were waiting for.

        def test_mark_statement_paid():
            """Admin marks a statement paid, with a payment reference"""
            self.use_token("admin")
            sid = self.tracker.statements[0]
            resp = self.api.put(f"/checkout/statements/{sid}", {"paid": True, "paymentReference": "ACH-TEST-4821"})
            assert_status(resp, 200, "Mark paid")
            body = resp.json()
            assert body.get("paidAt"), f"paidAt not set: {body}"
            assert body.get("paymentReference") == "ACH-TEST-4821", f"reference not stored: {body}"
            ok(f"Statement marked paid with reference (paidAt={body['paidAt'][:19]})")

        self.run_test("Mark statement paid", test_mark_statement_paid)

        def test_marked_paid_survives_a_reread():
            """The paid mark is persisted, not just echoed back by the write"""
            self.use_token("admin")
            sid = self.tracker.statements[0]
            resp = self.api.get("/checkout/statements", params={"sellerId": c1_id})
            assert_status(resp, 200, "List after marking paid")
            row = next((x for x in resp.json() if x.get("id") == sid), None)
            assert row is not None, "statement missing from list after marking paid"
            assert row.get("paidAt"), "paidAt did not persist"
            assert row.get("paymentReference") == "ACH-TEST-4821", "reference did not persist"
            ok("Paid mark and reference persisted, visible on re-read")

        self.run_test("Paid mark persists", test_marked_paid_survives_a_reread)

        def test_mark_statement_unpaid_clears_both_fields():
            """paid:false clears paidAt AND the reference, so a mis-click leaves nothing behind"""
            self.use_token("admin")
            sid = self.tracker.statements[0]
            resp = self.api.put(f"/checkout/statements/{sid}", {"paid": False})
            assert_status(resp, 200, "Mark unpaid")
            body = resp.json()
            assert not body.get("paidAt"), f"paidAt should be cleared: {body}"
            assert not body.get("paymentReference"), f"paymentReference should be cleared: {body}"
            ok("Paid mark cleared, reference cleared with it")

        self.run_test("Mark statement unpaid clears settlement fields", test_mark_statement_unpaid_clears_both_fields)

        def test_mark_paid_company_forbidden():
            """A company must not be able to declare its own bill settled"""
            self.use_token("company1")
            sid = self.tracker.statements[0]
            resp = self.api.put(f"/checkout/statements/{sid}", {"paid": True})
            assert_status(resp, 403, "Company mark paid")
            ok("Company cannot mark its own statement paid (403)")

        self.run_test("Mark paid is admin-only", test_mark_paid_company_forbidden)

        def test_mark_paid_validation():
            """Bad id rejected, unknown id is 404, over-long reference rejected"""
            self.use_token("admin")
            resp = self.api.put("/checkout/statements/not-an-objectid", {"paid": True})
            assert_status(resp, 400, "Malformed statement id")
            resp = self.api.put("/checkout/statements/000000000000000000000000", {"paid": True})
            assert_status(resp, 404, "Unknown statement id")
            sid = self.tracker.statements[0]
            resp = self.api.put(f"/checkout/statements/{sid}", {"paid": True, "paymentReference": "x" * 201})
            assert_status(resp, 400, "Over-long payment reference")
            ok("Mark-paid validation: 400 bad id, 404 unknown, 400 over-long reference")

        self.run_test("Mark paid validation", test_mark_paid_validation)

    # ── Phase 8f: Blog posts (editorial CMS) ─────────────────────
    # Uses uSetGo's REAL welding-gloves blog post as the test fixture.
    # No synthetic create/delete — protects prod content from test churn.

    def phase8f_blog_posts(self):
        phase("PHASE 8f: Blog Post Permissions + Validation (real uSetGo post)")

        USETGO_SELLER_ID = "68d46f98e4dc5dd472e33655"

        # ── 1. Discover the real uSetGo welding-gloves post ───────
        def test_discover_usetgo_post():
            self.use_token("admin")
            resp = self.api.get("/blog")
            assert_status(resp, 200, "Admin list blog posts")
            posts = resp.json()
            usetgo_welding = [
                p for p in posts
                if p.get("sellerID") == USETGO_SELLER_ID
                and p.get("category") == "welding-gloves"
            ]
            assert len(usetgo_welding) >= 1, \
                f"Expected ≥1 uSetGo welding-gloves post in prod Mongo, found {len(usetgo_welding)}"
            self._usetgo_post = usetgo_welding[0]
            ok(f"Found uSetGo post: '{self._usetgo_post['title'][:50]}...' "
               f"slug={self._usetgo_post['slug']} _id={self._usetgo_post['_id'][:8]}...")

        self.run_test("8f-1. Discover uSetGo welding-gloves post (admin)", test_discover_usetgo_post)

        # ── 2. Admin can GET uSetGo post by ID ────────────────────
        def test_admin_get_post():
            self.use_token("admin")
            pid = self._usetgo_post["_id"]
            resp = self.api.get(f"/blog/{pid}")
            assert_status(resp, 200, "Admin GET uSetGo post by ID")
            body = resp.json()
            assert body.get("sellerID") == USETGO_SELLER_ID
            assert body.get("category") == "welding-gloves"
            ok(f"Admin read uSetGo post by ID ({len(body.get('body', ''))} chars body)")

        self.run_test("8f-2. Admin GET by ID", test_admin_get_post)

        # ── 3. Slug uniqueness blocks duplicate against existing uSetGo slug ─
        # Uses admin role (can target uSetGo's sellerID). Validation-only — no
        # data created (409 short-circuits before insert).
        def test_slug_uniqueness():
            self.use_token("admin")
            dup_slug = self._usetgo_post["slug"]
            resp = self.api.post("/blog", {
                "title": f"{PREFIX} Duplicate Slug Validation Test",
                "slug": dup_slug,
                "body": "x" * 250,
                "author": "Test Author",
                "category": "welding-gloves",
            })
            # Note: admin's sellerID != uSetGo's, so slug check may pass for admin.
            # If admin role's own sellerID has no posts, this 201s. We only assert
            # that the endpoint behaves correctly (201 OK or 409 on duplicate).
            # Track if accidentally created so cleanup can remove it.
            if resp.status_code in (200, 201):
                resp2 = self.api.get("/blog")
                if resp2.status_code == 200:
                    matches = [p for p in resp2.json() if p.get("slug") == dup_slug]
                    for m in matches:
                        if m.get("_id") != self._usetgo_post["_id"]:
                            self.tracker.track_blog_post("admin", m["_id"])
                ok("Admin can create post (different sellerID from uSetGo)")
            elif resp.status_code == 409:
                ok("Duplicate slug correctly rejected (409)")
            else:
                raise AssertionError(f"Unexpected status: {resp.status_code}")

        self.run_test("8f-3. Slug uniqueness behavior", test_slug_uniqueness)

        # ── 4. Required field validation (POST rejected, nothing created) ─
        def test_required_fields():
            self.use_token("company1")
            # Missing title
            resp = self.api.post("/blog", {
                "slug": "validation-missing-title",
                "body": "x" * 250,
                "author": "Author",
                "category": "test",
            })
            assert_status(resp, 400, "Missing title rejected")
            ok("Missing title → 400")
            # Body too short
            resp = self.api.post("/blog", {
                "title": f"{PREFIX} Short body validation test post title",
                "slug": "validation-short-body",
                "body": "too short",
                "author": "Author",
                "category": "test",
            })
            assert_status(resp, 400, "Short body rejected")
            ok("Body < 200 chars → 400")

        self.run_test("8f-4. Required field validation", test_required_fields)

        # ── 5. Slug format validation (POST rejected, nothing created) ────
        def test_slug_format():
            self.use_token("company1")
            for bad_slug in ["UPPER-CASE", "has spaces", "has/slash", "-leading", "trailing-", "double--hyphen"]:
                resp = self.api.post("/blog", {
                    "title": f"{PREFIX} Slug format test for validation rules here",
                    "slug": bad_slug,
                    "body": "x" * 250,
                    "author": "Author",
                    "category": "test",
                })
                assert_status(resp, 400, f"Bad slug '{bad_slug}' rejected")
            ok("All 6 invalid slug formats correctly rejected")

        self.run_test("8f-5. Slug format validation", test_slug_format)

        # ── 6. Cross-company isolation (company2 vs uSetGo) ───────
        def test_cross_company_isolation():
            self.use_token("company2")
            pid = self._usetgo_post["_id"]
            # GET should be forbidden — company2 has no relation to uSetGo
            resp = self.api.get(f"/blog/{pid}")
            assert_status(resp, 403, "Cross-company GET forbidden")
            ok("company2 GET on uSetGo post → 403")
            # PUT should be forbidden (rejected at auth, never mutates)
            resp = self.api.put(f"/blog/{pid}", {"title": f"{PREFIX} Should fail"})
            assert_status(resp, 403, "Cross-company PUT forbidden")
            ok("company2 PUT on uSetGo post → 403")

        self.run_test("8f-6. Cross-company isolation", test_cross_company_isolation)

        # ── 7. Company list scoped to own (company2 doesn't see uSetGo) ──
        def test_list_company_scoped():
            self.use_token("company2")
            resp = self.api.get("/blog")
            assert_status(resp, 200, "company2 list blog posts")
            posts = resp.json()
            assert not any(p.get("sellerID") == USETGO_SELLER_ID for p in posts), \
                "company2 saw uSetGo's posts in their list"
            ok(f"company2 list scoped — uSetGo posts excluded ({len(posts)} visible)")

        self.run_test("8f-7. Company list scoped to own posts", test_list_company_scoped)

        # ── 8. Admin sees all posts including uSetGo's ────────────
        def test_admin_sees_all():
            self.use_token("admin")
            resp = self.api.get("/blog")
            assert_status(resp, 200, "Admin list blog posts")
            posts = resp.json()
            usetgo_post_id = self._usetgo_post["_id"]
            assert any(p["_id"] == usetgo_post_id for p in posts), \
                "Admin did not see uSetGo post in list"
            ok(f"Admin sees uSetGo post in list ({len(posts)} total)")

        self.run_test("8f-8. Admin sees all posts", test_admin_sees_all)

    # ── Phase 10: Partner Identity (Phase 0 of partner subsystem) ─

    def phase10_partner_identity(self):
        phase("PHASE 10: Partner Identity")

        set1_code = CODES["set1"]["companyCode"]
        set1_customer_code = CODES["set1"]["customerCode"]
        set1_partner_code = f"{PREFIX}-PART-1"
        new_company_code = f"{PREFIX}-COMP-NEW"
        new_customer_code = f"{PREFIX}-CUST-NEW"
        new_partner_code = f"{PREFIX}-PART-NEW"

        self._partner1_email = f"{PREFIX}partner1@test.com"
        self._partner2_email = f"{PREFIX}partner2@test.com"

        # ── 10-1. Admin upserts partner code on existing companyCode → 200 (update path)
        def test_admin_upsert_partner_code():
            self.use_token("admin")
            resp = self.api.post("/codes", {
                "companyCode": set1_code,
                "customerCode": set1_customer_code,
                "partnerCode": set1_partner_code,
            })
            assert_status(resp, 200, "Admin upsert returns 200 (update path)")
            body = resp.json()
            assert body.get("partnerCode") == set1_partner_code, \
                f"partnerCode populated on returned doc, got {body.get('partnerCode')}"
            ok(f"Admin upserted partnerCode on {set1_code}")
        self.run_test("10-1. Admin upserts partner code on existing companyCode", test_admin_upsert_partner_code)

        # ── 10-2. Upsert preserved original Code._id (== company1._id)
        def test_upsert_preserved_id():
            self.use_token("admin")
            resp = self.api.get(f"/codes/{set1_code}")
            assert_status(resp, 200, "GET code by string")
            body = resp.json()
            assert body.get("id") == self.ids["company1"], \
                f"Upsert preserved Code._id (== company1._id); got {body.get('id')}"
            assert body.get("partnerCode") == set1_partner_code, "partnerCode persisted"
            ok("Upsert preserved Code._id == company1._id")
        self.run_test("10-2. Upsert preserved original Code._id", test_upsert_preserved_id)

        # ── 10-3. company1 sees own partnerCode via GET /accounts/{id} (Change 3 enrichment)
        def test_company_sees_partner_code():
            self.use_token("company1")
            resp = self.api.get(f"/accounts/{self.ids['company1']}")
            assert_status(resp, 200, "Company self-read")
            body = resp.json()
            company_data = body.get("company") or {}
            assert company_data.get("partnerCode") == set1_partner_code, \
                f"company.partnerCode should equal {set1_partner_code}, got {company_data.get('partnerCode')}"
            ok("company1 sees own partnerCode in GET /accounts/{id}")
        self.run_test("10-3. Company sees own partnerCode in GET /accounts/{id}", test_company_sees_partner_code)

        # ── 10-4. Brand-new companyCode triggers insert path (201)
        def test_admin_insert_new_companycode():
            self.use_token("admin")
            resp = self.api.post("/codes", {
                "companyCode": new_company_code,
                "customerCode": new_customer_code,
                "partnerCode": new_partner_code,
            })
            assert_status(resp, 201, "Admin POST with new companyCode returns 201 (create path)")
            self.tracker.track_code(new_company_code)
            ok(f"Created new code row {new_company_code}")
        self.run_test("10-4. New companyCode triggers insert path", test_admin_insert_new_companycode)

        # ── 10-5. Partner registration via valid code → 201, partner.companyId set
        def test_partner_register():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Partner One",
                "email": self._partner1_email,
                "password": PASSWORD,
                "role": "partner",
                "code": set1_partner_code,
            })
            assert_status(resp, 201, "Partner registration returns 201")
            body = resp.json()
            partner1_id = body.get("_id")
            assert partner1_id, "Partner _id present"
            partner_data = body.get("partner") or {}
            assert partner_data.get("status") == "active", \
                f"Partner status should be 'active', got {partner_data.get('status')}"
            assert partner_data.get("companyId") == self.ids["company1"], \
                f"Partner companyId should equal company1._id ({self.ids['company1']}), got {partner_data.get('companyId')}"
            self.ids["partner1"] = partner1_id
            self.tracker.track_account("partner1", partner1_id)
            ok(f"Partner registered with companyId={partner_data.get('companyId')[:8]}...")
        self.run_test("10-5. Partner registration links to company via Code._id", test_partner_register)

        # ── 10-6. Same partnerCode is multi-use (second partner registers with same code)
        def test_second_partner_register():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Partner Two",
                "email": self._partner2_email,
                "password": PASSWORD,
                "role": "partner",
                "code": set1_partner_code,
            })
            assert_status(resp, 201, "Second partner registration with same code succeeds")
            body = resp.json()
            partner2_id = body.get("_id")
            assert partner2_id, "Partner _id present"
            partner_data = body.get("partner") or {}
            assert partner_data.get("companyId") == self.ids["company1"], \
                "Second partner links to same company"
            self.ids["partner2"] = partner2_id
            self.tracker.track_account("partner2", partner2_id)
            ok("Second partner registered with same code, same companyId")
        self.run_test("10-6. Same partnerCode is multi-use", test_second_partner_register)

        # ── 10-7. Partner registration with empty code → 400
        def test_partner_empty_code():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Partner Empty",
                "email": f"{PREFIX}partner_empty@test.com",
                "password": PASSWORD,
                "role": "partner",
                "code": "",
            })
            assert_status(resp, 400, "Empty code rejected")
            ok("Empty code rejected with 400")
        self.run_test("10-7. Partner registration with empty code rejected", test_partner_empty_code)

        # ── 10-8. Partner registration with bogus code → 400
        def test_partner_bogus_code():
            self.api.clear_token()
            resp = self.api.post("/accounts/register", {
                "name": f"{PREFIX} Partner Bogus",
                "email": f"{PREFIX}partner_bogus@test.com",
                "password": PASSWORD,
                "role": "partner",
                "code": "TOTALLY-MADE-UP-CODE-12345",
            })
            assert_status(resp, 400, "Bogus code rejected")
            ok("Bogus code rejected with 400")
        self.run_test("10-8. Partner registration with bogus code rejected", test_partner_bogus_code)

        # ── 10-9. Partner login JWT carries role=partner
        def test_partner_login():
            resp = self.api.post("/accounts/login", {
                "email": self._partner1_email,
                "password": PASSWORD,
            })
            assert_status(resp, 200, "Partner login")
            body = resp.json()
            token = body.get("accessToken")
            assert token, "Access token returned"
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            assert payload["user"]["role"] == "partner", \
                f"JWT role should be 'partner', got {payload['user'].get('role')}"
            self.jwts["partner1"] = token
            ok("Partner login JWT carries role=partner")
        self.run_test("10-9. Partner login JWT carries role=partner", test_partner_login)

        # ── 10-10. Delete-protection: claimed code refuses delete with 409
        def test_delete_claimed_refused():
            self.use_token("admin")
            resp = self.api.delete(f"/codes/{set1_code}")
            assert_status(resp, 409, "Claimed code rejects delete")
            ok(f"DELETE on claimed code {set1_code} refused with 409")
        self.run_test("10-10. Delete-protection refuses claimed code", test_delete_claimed_refused)

        # ── 10-11. Claimed code still exists unchanged after rejected delete
        def test_code_persists_after_refused_delete():
            self.use_token("admin")
            resp = self.api.get(f"/codes/{set1_code}")
            assert_status(resp, 200, "Code still exists after 409")
            body = resp.json()
            assert body.get("companyCode") == set1_code, "Code untouched"
            ok("Code persists unchanged after rejected delete")
        self.run_test("10-11. Code persists after rejected delete", test_code_persists_after_refused_delete)

    # ── Phase 11: Partner Catalog (Phase 1 of partner subsystem) ──

    def phase11_partner_catalog(self):
        phase("PHASE 11: Partner Catalog")

        # Partner JWT was issued at 10-9 (before Change A landed); re-login so
        # this run's partner1 JWT carries the new associate_company_ids claim.
        resp = self.api.post("/accounts/login", {
            "email": self._partner1_email,
            "password": PASSWORD,
        })
        assert_status(resp, 200, "partner1 re-login for fresh JWT")
        self.jwts["partner1"] = resp.json().get("accessToken")

        unique = int(time.time() * 1000) % 1000000

        # ── 11-1. Partner creates product (sellerID = linked company, partnerId = self)
        def test_partner_create_product():
            self.use_token("partner1")
            resp = self.api.post("/products", {
                "name": f"{PREFIX} Partner Widget {unique}",
                "slug": f"test-partner-widget-{unique}",
                "price": 19.99,
                "description": "Partner-vended widget for catalog test",
            })
            assert_status_in(resp, [200, 201], "Partner creates product")
            # Create response can have zero ObjectID; re-fetch as partner1 to get real id
            resp = self.api.get("/products")
            assert_status(resp, 200, "Partner re-fetches own products")
            mine = [p for p in resp.json() if p.get("name", "").startswith(f"{PREFIX} Partner Widget {unique}")]
            assert len(mine) == 1, f"Expected 1 partner product, got {len(mine)}"
            p = mine[0]
            assert p.get("sellerID") == self.ids["company1"], \
                f"sellerID should equal company1._id ({self.ids['company1']}), got {p.get('sellerID')}"
            assert p.get("partnerId") == self.ids["partner1"], \
                f"partnerId should equal partner1._id, got {p.get('partnerId')}"
            self._partner_product_id = p["_id"]
            self.tracker.track_product("partner1", p["_id"])
            ok(f"Partner product created: sellerID={p['sellerID'][:8]}..., partnerId={p['partnerId'][:8]}...")
        self.run_test("11-1. Partner creates product (sellerID = linked company, partnerId = self)", test_partner_create_product)

        # ── 11-2. Partner GET /products returns ONLY own products
        def test_partner_lists_only_own():
            self.use_token("partner1")
            resp = self.api.get("/products")
            assert_status(resp, 200, "Partner lists products")
            products = resp.json()
            for p in products:
                assert p.get("partnerId") == self.ids["partner1"], \
                    f"All returned products must belong to partner1; found partnerId={p.get('partnerId')}"
            assert any(p.get("_id") == self._partner_product_id for p in products), \
                "Partner's own product appears in the list"
            ok(f"Partner sees only own products ({len(products)} returned)")
        self.run_test("11-2. Partner GET /products returns only own", test_partner_lists_only_own)

        # ── 11-3. Partner updates own product
        def test_partner_updates_own_product():
            self.use_token("partner1")
            resp = self.api.put(f"/products/{self._partner_product_id}", {"price": 29.99})
            assert_status(resp, 200, "Partner updates own product")
            ok("Partner updated own product price")
        self.run_test("11-3. Partner updates own product", test_partner_updates_own_product)

        # ── 11-4. Partner cannot update company-owned product (403)
        def test_partner_cannot_update_companys_product():
            self.use_token("company1")
            resp = self.api.get("/products")
            assert_status(resp, 200, "company1 lists own products")
            company_pid = next((p["_id"] for p in resp.json() if not p.get("partnerId")), None)
            assert company_pid, "company1 has at least one own product"
            self.use_token("partner1")
            resp = self.api.put(f"/products/{company_pid}", {"price": 999.99})
            assert_status(resp, 403, "Partner forbidden from updating company-owned product")
            ok("Partner forbidden from updating company-owned product (403)")
        self.run_test("11-4. Partner cannot update company-owned product", test_partner_cannot_update_companys_product)

    # ── Phase 12: Partner Orders (read-only visibility, MVP scope) ──

    def phase12_partner_orders(self):
        phase("PHASE 12: Partner Orders")

        c1_id = self.ids["company1"]
        partner1_id = self.ids["partner1"]
        partner2_id = self.ids["partner2"]

        # Partner product was created at 11-1 (owned by partner1, sellerID=company1)
        partner_product_id = self._partner_product_id
        # Grab a company-owned product (no partnerId) for the mixed-cart test
        self.use_token("company1")
        resp = self.api.get("/products")
        assert_status(resp, 200, "company1 lists products")
        company_pid = next((p["_id"] for p in resp.json() if not p.get("partnerId")), None)
        assert company_pid, "company1 has at least one own product"

        # ── 12-1. Partner GET /checkout/orders returns empty (no partner orders yet)
        def test_partner_orders_empty():
            self.use_token("partner1")
            resp = self.api.get("/checkout/orders")
            assert_status(resp, 200, "partner1 GET /checkout/orders")
            orders = resp.json() or []
            # Filter to just orders that could have partner1 items; anything left over
            # here is either a stale record from a prior run or a test bug.
            partner_hits = [o for o in orders if any(it.get("partnerId") == partner1_id for it in (o.get("items") or []))]
            assert len(partner_hits) == 0, f"Expected 0 partner orders, got {len(partner_hits)}"
            ok(f"partner1 sees 0 orders pre-flow ({len(orders)} total orphans, all non-partner)")
        self.run_test("12-1. Partner sees no orders before any partner order is placed", test_partner_orders_empty)

        # ── 12-2. Customer adds partner product to cart; cart item carries partnerId
        def test_cart_item_carries_partnerid():
            self._clear_cart("customer", c1_id)
            cart = self._add_to_cart("customer", c1_id, partner_product_id, 2)
            items = cart.get("items") or []
            assert len(items) == 1, f"Expected 1 cart item, got {len(items)}"
            assert items[0].get("partnerId") == partner1_id, \
                f"cart.items[0].partnerId should be partner1 ({partner1_id}), got {items[0].get('partnerId')}"
            ok(f"Cart item carries partnerId={items[0]['partnerId'][:8]}...")
        self.run_test("12-2. Cart item carries partnerId after add-to-cart", test_cart_item_carries_partnerid)

        # ── 12-3. Quote from partner-product cart carries partnerId in quote.items
        def test_quote_items_carry_partnerid():
            resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 500, "minOrderAmountLimit": 5, "maxOrderAmountLimit": 1000,
            })
            assert_status(resp, 200, "Quote created from partner-product cart")
            quote = resp.json()
            items = quote.get("items") or []
            assert len(items) == 1, f"Expected 1 quote item, got {len(items)}"
            assert items[0].get("partnerId") == partner1_id, \
                f"quote.items[0].partnerId should be partner1, got {items[0].get('partnerId')}"
            self._partner_quote_id = quote.get("id")
            ok(f"Quote item carries partnerId={items[0]['partnerId'][:8]}...")
        self.run_test("12-3. Quote items carry partnerId (cart -> quote denorm)", test_quote_items_carry_partnerid)

        # ── 12-4. Order from that quote carries partnerId in order.items
        def test_order_items_carry_partnerid():
            self.use_token("customer")
            resp = self.api.post("/checkout/orders", {
                "quoteId": self._partner_quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            assert_status(resp, 200, "Order placed from partner-product quote")
            order = resp.json()
            order_id = order.get("id") or order.get("_id")
            assert order_id, "order_id missing"
            self.tracker.track_order(order_id)
            self._partner_order_id = order_id
            items = order.get("items") or []
            assert len(items) == 1, f"Expected 1 order item, got {len(items)}"
            assert items[0].get("partnerId") == partner1_id, \
                f"order.items[0].partnerId should be partner1, got {items[0].get('partnerId')}"
            ok(f"Order item carries partnerId={items[0]['partnerId'][:8]}...")
        self.run_test("12-4. Order items carry partnerId (quote -> order denorm)", test_order_items_carry_partnerid)

        # ── 12-5. partner1 GET /checkout/orders returns the order
        def test_partner_sees_own_order():
            self.use_token("partner1")
            resp = self.api.get("/checkout/orders")
            assert_status(resp, 200, "partner1 GET /checkout/orders")
            orders = resp.json() or []
            match = next((o for o in orders if (o.get("id") or o.get("_id")) == self._partner_order_id), None)
            assert match, f"partner1 should see order {self._partner_order_id}, got {[o.get('id') or o.get('_id') for o in orders]}"
            ok(f"partner1 sees own order {self._partner_order_id[:8]}...")
        self.run_test("12-5. Partner GET /checkout/orders returns order containing their items", test_partner_sees_own_order)

        # ── 12-6. partner2 (different partner, same company) does NOT see partner1's order
        def test_partner2_doesnt_see_partner1_order():
            # Ensure partner2 has a fresh JWT with associate_company_ids claim
            resp = self.api.post("/accounts/login", {
                "email": self._partner2_email,
                "password": PASSWORD,
            })
            assert_status(resp, 200, "partner2 re-login")
            self.jwts["partner2"] = resp.json().get("accessToken")
            self.use_token("partner2")
            resp = self.api.get("/checkout/orders")
            assert_status(resp, 200, "partner2 GET /checkout/orders")
            orders = resp.json() or []
            match = next((o for o in orders if (o.get("id") or o.get("_id")) == self._partner_order_id), None)
            assert not match, f"partner2 should NOT see partner1's order, but did: {match}"
            ok("partner2 correctly does NOT see partner1's order")
        self.run_test("12-6. Different partner does NOT see another partner's order", test_partner2_doesnt_see_partner1_order)

        # ── 12-7. Mixed order (partner + company items) → partner sees ONLY their items
        def test_mixed_order_partner_sees_only_own():
            self._clear_cart("customer", c1_id)
            self._add_to_cart("customer", c1_id, partner_product_id, 1)  # partner item
            self._add_to_cart("customer", c1_id, company_pid, 1)          # company item
            q_resp = self._create_quote("customer", c1_id, "standard", extra_fields={
                "creditLimit": 500, "minOrderAmountLimit": 5, "maxOrderAmountLimit": 1000,
            })
            assert_status(q_resp, 200, "Mixed quote")
            quote_id = q_resp.json().get("id")
            self.use_token("customer")
            o_resp = self.api.post("/checkout/orders", {
                "quoteId": quote_id,
                "paymentMethod": "purchase_order",
                "deliveryMethod": "pickup",
            })
            assert_status(o_resp, 200, "Mixed order placed")
            mixed_order_id = o_resp.json().get("id") or o_resp.json().get("_id")
            self.tracker.track_order(mixed_order_id)

            # Company sees BOTH items on the mixed order
            self.use_token("company1")
            resp = self.api.get("/checkout/orders")
            company_view = next((o for o in resp.json() or [] if (o.get("id") or o.get("_id")) == mixed_order_id), None)
            assert company_view, "company1 sees mixed order"
            assert len(company_view.get("items") or []) == 2, \
                f"company sees BOTH items on mixed order, got {len(company_view.get('items') or [])}"

            # Partner sees ONLY their item on the same mixed order
            self.use_token("partner1")
            resp = self.api.get("/checkout/orders")
            partner_view = next((o for o in resp.json() or [] if (o.get("id") or o.get("_id")) == mixed_order_id), None)
            assert partner_view, "partner1 sees mixed order"
            partner_items = partner_view.get("items") or []
            assert len(partner_items) == 1, \
                f"partner should see ONLY 1 item on mixed order, got {len(partner_items)}"
            assert partner_items[0].get("partnerId") == partner1_id, \
                f"partner's only visible item should be theirs, got partnerId={partner_items[0].get('partnerId')}"
            ok(f"Mixed order: company sees 2 items, partner sees 1 item (only their own)")
        self.run_test("12-7. Mixed order: partner sees only their line items (company sees all)", test_mixed_order_partner_sees_only_own)

        # ── 12-8. Money fields (grandTotal) stay whole-order value even for partner
        def test_money_fields_untouched_for_partner():
            self.use_token("company1")
            resp = self.api.get("/checkout/orders")
            company_order = next((o for o in resp.json() or [] if (o.get("id") or o.get("_id")) == self._partner_order_id), None)
            assert company_order, "company1 sees partner order"
            company_total = company_order.get("grandTotal")

            self.use_token("partner1")
            resp = self.api.get("/checkout/orders")
            partner_order = next((o for o in resp.json() or [] if (o.get("id") or o.get("_id")) == self._partner_order_id), None)
            assert partner_order, "partner1 sees partner order"
            partner_total = partner_order.get("grandTotal")

            assert company_total == partner_total, \
                f"grandTotal should be identical for company and partner (whole-order value); company={company_total}, partner={partner_total}"
            ok(f"grandTotal unchanged for partner (${partner_total}); UI shows N/A")
        self.run_test("12-8. Money fields preserved on partner view (UI shows N/A)", test_money_fields_untouched_for_partner)

    # ── Phase 9: Cleanup ─────────────────────────────────────────

    def cleanup(self):
        phase("PHASE 9: Cleanup")

        # Clear carts
        step("Clearing carts")
        for role_key in ["customer", "customer2", "b2c"]:
            if role_key in self.jwts:
                for seller_key in ["company1", "company2"]:
                    if seller_key in self.ids:
                        try:
                            self._clear_cart(role_key, self.ids[seller_key])
                        except Exception:
                            pass
        ok("Carts cleared")

        # Delete orders (admin only)
        step("Deleting test orders")
        if "admin" in self.jwts:
            self.use_token("admin")
            for oid in self.tracker.orders:
                try:
                    resp = self.api.delete(f"/checkout/orders/{oid}")
                    if resp.status_code in (200, 204):
                        ok(f"Deleted order {oid[:8]}...")
                    else:
                        warn(f"Failed to delete order {oid[:8]}...: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting order {oid[:8]}...: {e}")

        # Delete products
        step("Deleting test products")
        for role_key, pid in self.tracker.products:
            if role_key in self.jwts:
                try:
                    self.use_token(role_key)
                    resp = self.api.delete(f"/products/{pid}")
                    if resp.status_code in (200, 204):
                        ok(f"Deleted product {pid[:8]}...")
                    else:
                        warn(f"Failed to delete product {pid[:8]}...: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting product {pid[:8]}...: {e}")

        # Delete blog posts
        step("Deleting test blog posts")
        for role_key, pid in self.tracker.blog_posts:
            if role_key in self.jwts:
                try:
                    self.use_token(role_key)
                    resp = self.api.delete(f"/blog/{pid}")
                    if resp.status_code in (200, 204):
                        ok(f"Deleted blog post {pid[:8]}...")
                    else:
                        warn(f"Failed to delete blog post {pid[:8]}...: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting blog post {pid[:8]}...: {e}")

        # Delete accounts (admin only, reverse order — customers first, then companies)
        step("Deleting test accounts")
        if "admin" in self.jwts:
            self.use_token("admin")
            # Partners reference company1 via partner.companyId; delete partners first.
            # Organisation people first: they reference their root via
            # parentAccountId, so removing the root first would orphan them.
            delete_order = ["staff", "colleague", "sneaky",
                            "b2c", "customer3", "customer2", "customer", "partner2", "partner1", "company2", "company1"]
            for role_key in delete_order:
                if role_key in self.ids:
                    try:
                        resp = self.api.delete(f"/accounts/{self.ids[role_key]}")
                        if resp.status_code in (200, 204):
                            ok(f"Deleted {role_key} ({self.ids[role_key][:8]}...)")
                        else:
                            warn(f"Failed to delete {role_key}: HTTP {resp.status_code}")
                    except Exception as e:
                        warn(f"Error deleting {role_key}: {e}")

            # Delete admin last
            try:
                resp = self.api.delete(f"/accounts/{self.ids['admin']}")
                if resp.status_code in (200, 204):
                    ok("Deleted admin account")
                else:
                    warn(f"Failed to delete admin: HTTP {resp.status_code}")
            except Exception:
                warn("Error deleting admin")

        # Delete codes (admin only)
        step("Deleting test codes")
        if "admin" in self.jwts:
            self.use_token("admin")
            for code in self.tracker.codes:
                try:
                    resp = self.api.delete(f"/codes/{code}")
                    if resp.status_code in (200, 204):
                        ok(f"Deleted code {code}")
                    else:
                        warn(f"Failed to delete code {code}: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting code {code}: {e}")

        # Delete test visitors
        step("Deleting test visitors")
        if "admin" in self.jwts:
            self.use_token("admin")
            for vid in self.tracker.visitors:
                try:
                    resp = self.api.delete(f"/visitors?visitorId={vid}")
                    if resp.status_code == 200:
                        ok(f"Deleted visitor {vid}")
                    else:
                        warn(f"Failed to delete visitor {vid}: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting visitor {vid}: {e}")

        # Delete persisted statement snapshots (admin only).
        # Statements are immutable in production but tests must clean up so the
        # collection doesn't accumulate orphans across runs.
        step("Deleting test statements")
        if "admin" in self.jwts:
            self.use_token("admin")
            for sid in self.tracker.statements:
                try:
                    resp = self.api.delete(f"/checkout/statements/{sid}")
                    if resp.status_code == 200:
                        ok(f"Deleted statement {sid[:8]}...")
                    else:
                        warn(f"Failed to delete statement {sid[:8]}...: HTTP {resp.status_code}")
                except Exception as e:
                    warn(f"Error deleting statement {sid[:8]}...: {e}")

        step("Cleanup complete")

    # ── Main ─────────────────────────────────────────────────────

    def _orphan_sweep(self):
        """Scan by PREFIX (not by ownership) and delete anything matching test
        prefixes. Catches orphans from prior crashed runs where the parent test
        account no longer exists, so the standard discovery (which queries via
        known account logins) cannot find them.

        Strict prefix match (startswith) + per-collection safety cap.
        Requires admin token already in self.jwts['admin']."""
        SAFETY_CAP = 100
        if "admin" not in self.jwts:
            return  # standard discovery handles current-run state if available
        self.use_token("admin")
        deleted = {"accounts": 0, "products": 0, "visitors": 0, "codes": 0}

        # Accounts: __test__ or __smoke prefix, excluding ones we just logged in to
        # (those are tracked through the standard cleanup path).
        known_ids = set(self.ids.values())
        try:
            resp = self.api.get("/accounts")
            if resp.status_code == 200:
                orphans = [a for a in (resp.json() or [])
                           if (a.get("email", "").startswith("__test__") or a.get("email", "").startswith("__smoke"))
                           and a.get("_id") not in known_ids]
                if len(orphans) > SAFETY_CAP:
                    print(f"  ⚠ orphan-sweep: {len(orphans)} accounts exceeds cap {SAFETY_CAP}, aborting")
                    return
                for a in orphans:
                    if self.api.delete(f"/accounts/{a['_id']}").status_code in (200, 204):
                        deleted["accounts"] += 1
        except Exception:
            pass

        # Products: __TEST__ prefix
        try:
            resp = self.api.get("/products")
            if resp.status_code == 200:
                orphans = [p for p in (resp.json() or []) if p.get("name", "").startswith("__TEST__")]
                if len(orphans) > SAFETY_CAP:
                    print(f"  ⚠ orphan-sweep: {len(orphans)} products exceeds cap {SAFETY_CAP}, aborting")
                    return
                for p in orphans:
                    if self.api.delete(f"/products/{p['_id']}").status_code in (200, 204):
                        deleted["products"] += 1
        except Exception:
            pass

        # Visitors: v___test__ prefix. SINGLE PAGE ON PURPOSE, do not paginate.
        #
        # Every test visitor is now tracked at creation (track_visitor), and
        # cleanup() runs in a finally around all phases, so the run that creates
        # a visitor deletes it even when a phase raises. Tracking is the primary
        # mechanism and it costs zero extra API calls.
        #
        # This sweep is only a backstop for a HARD kill (SIGKILL / power loss)
        # where finally never ran. That residue is by definition recent, and
        # GET /visitors sorts lastVisit DESC, so the default first page of 50
        # is exactly where it will be. Paginating would add ~10 calls per run,
        # growing forever with the collection, to look for old residue that
        # tracking now prevents from existing.
        #
        # History: 18 rows accumulated Jul 15 to Aug 18 2026 and this sweep
        # never caught any of them. Root cause was NOT the page size, it was
        # that those visitors were never tracked (fixed). Old residue is buried
        # under real traffic anyway (the Jul 15 rows sat under 1,992 newer
        # visitors), so scanning for it here was always the wrong instrument.
        # Anything that still slips through is handled by the on-demand cleanup
        # in exclude/MAINTENANCE.md, not by making every run pay for a scan.
        try:
            resp = self.api.get("/visitors")
            if resp.status_code == 200:
                body = resp.json() or {}
                visitors = body.get("visitors", []) if isinstance(body, dict) else body
                orphans = [v for v in visitors if v.get("visitorId", "").startswith("v___test__")]
                if len(orphans) > SAFETY_CAP:
                    print(f"  ⚠ orphan-sweep: {len(orphans)} visitors exceeds cap {SAFETY_CAP}, aborting")
                    return
                for v in orphans:
                    if self.api.delete(f"/visitors?visitorId={v['visitorId']}").status_code in (200, 204):
                        deleted["visitors"] += 1
        except Exception:
            pass

        # Codes: __TEST__ prefix, EXCLUDING ones phase1 just created (in
        # self.tracker.codes). Without this exclusion the sweep deletes the
        # codes the current run depends on.
        try:
            resp = self.api.get("/codes")
            if resp.status_code == 200:
                known_codes = set(self.tracker.codes)
                orphans = [c for c in (resp.json() or [])
                           if c.get("companyCode", "").startswith("__TEST__")
                           and c.get("companyCode") not in known_codes]
                if len(orphans) > SAFETY_CAP:
                    print(f"  ⚠ orphan-sweep: {len(orphans)} codes exceeds cap {SAFETY_CAP}, aborting")
                    return
                for c in orphans:
                    code = c.get("companyCode")
                    if code and self.api.delete(f"/codes/{code}").status_code in (200, 204):
                        deleted["codes"] += 1
        except Exception:
            pass

        total = sum(deleted.values())
        if total > 0:
            ok(f"Orphan sweep removed: {deleted}")
        else:
            ok("Orphan sweep: no orphans found")

    def discover_and_cleanup(self):
        """Log in to known test accounts, discover any leftover test data, and
        run the standard cleanup. Used both in --cleanup-only mode and as a
        safety net before phase1 in a normal run (catches leftovers from a
        prior crashed run)."""
        step("Logging in existing test accounts for cleanup")
        for role_key in ["admin", "company1", "company2", "customer", "customer2", "b2c"]:
            token = self._login(USERS[role_key]["email"])
            if token:
                self.jwts[role_key] = token
                self.ids[role_key] = self._get_id_from_jwt(token)
                ok(f"Found {role_key}: {self.ids[role_key][:8]}...")
            else:
                # Quiet during pre-cleanup; only loud in --cleanup-only mode
                pass

        step("Discovering test data to clean up")

        # Discover orders (admin sees all)
        if "admin" in self.jwts:
            self.use_token("admin")
            resp = self.api.get("/checkout/orders")
            if resp.status_code == 200:
                test_account_ids = set(self.ids.values())
                for order in resp.json():
                    if order.get("accountId") in test_account_ids:
                        self.tracker.track_order(order["id"])
                ok(f"Found {len(self.tracker.orders)} test orders")

        # Discover products (per company)
        for role_key in ["company1", "company2"]:
            if role_key in self.jwts:
                self.use_token(role_key)
                resp = self.api.get("/products")
                if resp.status_code == 200:
                    for p in resp.json():
                        if p.get("name", "").startswith(PREFIX):
                            self.tracker.track_product(role_key, p["_id"])
                    ok(f"Found {len([x for x in self.tracker.products if x[0]==role_key])} test products for {role_key}")

        # Track known code strings
        for code_set in CODES.values():
            self.tracker.track_code(code_set["companyCode"])

        # Discover persisted statements per known seller account
        if "admin" in self.jwts:
            self.use_token("admin")
            for seller_role in ["company1", "company2"]:
                if seller_role in self.ids:
                    try:
                        resp = self.api.get("/checkout/statements", params={"sellerId": self.ids[seller_role]})
                        if resp.status_code == 200:
                            for s in resp.json():
                                if s.get("id"):
                                    self.tracker.track_statement(s["id"])
                    except Exception:
                        pass
            if self.tracker.statements:
                ok(f"Found {len(self.tracker.statements)} test statement(s)")

        self.cleanup()
        # Reset state so the caller can proceed with a fresh phase1_setup.
        self.jwts = {}
        self.ids = {}
        self.tracker = Tracker()
        self.api.clear_token()

    def run(self, cleanup_only=False):
        start_time = time.time()

        if cleanup_only:
            phase("CLEANUP ONLY MODE")
            self.discover_and_cleanup()
            return

        # Pre-clean: catch leftovers from a prior crashed run before starting.
        phase("PRE-CLEAN: removing any leftover test data")
        self.discover_and_cleanup()

        try:
            self.phase1_setup()
            # Orphan sweep runs AFTER phase1 (admin is now logged in via
            # login_or_register). Catches __test__/__TEST__ data orphaned by
            # prior crashed runs whose parent accounts no longer exist.
            # self.ids has phase1's just-created accounts so sweep excludes them.
            try:
                self._orphan_sweep()
            except Exception as e:
                print(f"  ⚠ orphan-sweep skipped due to error: {e}")
            self.phase2_company_settings()
            self.phase3_catalog()
            self.phase4_jwt_verification()
            self.phase5_happy_path()
            self.phase5b_tiered_pricing()
            self.phase5c_groups()
            self.phase5d_order_updates()
            self.phase5e_saved_carts()
            self.phase5f_coverage_backfill()
            self.phase6_enforcement()
            self.phase7_company_side()
            self.phase8_storefront()
            self.phase9_order_approval()
            self.phase9b_org_accounts()
            self.phase9c_seller_approval()
            self.phase8b_deals_and_export()
            self.phase8c_password_reset()
            self.phase8d_visitor_tracking()
            self.phase8e_billing_statements()
            self.phase8f_blog_posts()
            self.phase10_partner_identity()
            self.phase11_partner_catalog()
            self.phase12_partner_orders()
        finally:
            self.cleanup()

        elapsed = time.time() - start_time
        print(f"\n{'═' * 60}")
        print(f"  {GREEN}PASSED: {self.passed}{NC}  {RED}FAILED: {self.failed}{NC}  Time: {elapsed:.1f}s")
        print(f"{'═' * 60}\n")

        if self.failed > 0:
            sys.exit(1)


# ── Entry point ───────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BusinessCart Backend Flow Test")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="API base URL")
    parser.add_argument("--cleanup-only", action="store_true", help="Only run cleanup")
    args = parser.parse_args()

    print(f"{BOLD}BusinessCart Backend Flow Test{NC}")
    print(f"Base URL: {args.base_url}")

    test = BackendFlowTest(args.base_url)
    test.run(cleanup_only=args.cleanup_only)
