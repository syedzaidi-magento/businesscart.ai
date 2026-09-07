import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const Compare: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />
      <main>

        {/* Hero */}
        <div className="bg-gray-800 py-16 sm:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">BusinessCart.ai vs. The Competition</h1>
            <p className="mt-4 text-lg text-gray-200 max-w-2xl mx-auto">
              A fair and factual comparison to help you make an informed decision.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

          {/* Comparison Table */}
          <div className="overflow-x-auto bg-white shadow-lg rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Feature</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BusinessCart.ai</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shopify / Shopify Plus</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">WooCommerce (Self-Hosted)</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Marketplaces (Etsy, DoorDash, Amazon)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Monthly Fee</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">$0, at every volume. No monthly fee, ever. Every feature in every tier</td>
                  <td className="px-6 py-4 text-sm text-gray-500">$39-399/mo (Plus: $2,300+/mo); features locked to plan</td>
                  <td className="px-6 py-4 text-sm text-gray-500">$30-100/mo (hosting + plugins)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">$0 (but 15-30% per order)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Per-Order Fee</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">6% on your first 100 orders each month, 2% on 101-1,000, 1% beyond. Never more than $5 per order, at any volume. A $10,000 order = $5 in fees.</td>
                  <td className="px-6 py-4 text-sm text-gray-500">2.9% + 30c (payment processing only)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">2.9% + 30c (payment processing only)</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">15-30% commission</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Payment Gateway Freedom</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Yes, bring your own gateway, no extra fee</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Extra 2% fee if not using Shopify Payments</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes, but you configure it</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Storefront Speed</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Under 1 second</td>
                  <td className="px-6 py-4 text-sm text-gray-500">2-4 seconds (JavaScript-rendered)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">3-5 seconds (PHP, depends on hosting)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Varies (you do not control it)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">SEO</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Auto-generated (sitemap, schema, OG tags)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Basic (needs paid apps for full SEO)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin-dependent (Yoast, etc.)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace ranks, not your brand</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">AI / LLM Discoverable</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Yes, products readable by AI assistants</td>
                  <td className="px-6 py-4 text-sm text-gray-500">No (JavaScript-rendered)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">No (PHP-rendered, plugin-dependent)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">No (walled garden)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Product Q&amp;A on the Page</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built in. You write the answers; they render without JavaScript and land in the markdown file AI engines read</td>
                  <td className="px-6 py-4 text-sm text-gray-500">App required</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin required</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Amazon Q&amp;A is answered by shoppers and stays on Amazon</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">B2B + D2C on One Platform</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Yes, wholesale and direct-to-consumer from one account</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Separate Shopify Plus required for B2B ($2,300+/mo)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Via plugins (often clunky)</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Customer Data</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">You own it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">You own it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">You own it</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Marketplace owns it</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Customer-Specific (Contract) Pricing</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus only ($2,300+/mo)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Via plugins (often clunky)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Per-Customer Tax & Shipping</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, override per customer</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus or app needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles it</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Tax-Exempt Buyers & Resale Certs</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: 0% + cert tracking + audit warning</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native exempt; certs via Avalara/app</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin + separate cert tool</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles tax</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Spending & Credit Limits</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, per-customer caps</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus or custom development</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Minimum Order Rules (MOQ / MOV)</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, per-customer enforcement</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace-controlled</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Multi-Company Customers</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, one buyer, multiple suppliers</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Quote Negotiation (RFQ)</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Staff &amp; Buyer Roles</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Owner, admin and staff, on your side and your customer&rsquo;s, in every tier. Staff cannot see product costs or margins; only the owner changes payment settings and billing</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Staff permissions, with the number of staff accounts capped by plan</td>
                  <td className="px-6 py-4 text-sm text-gray-500">WordPress user roles; finer control via plugin, you maintain it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not applicable</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Buyer-Side Order Approvals</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: multiple levels, several approvers per level, thresholds on order value or quantity</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not native; app or custom development</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin, you maintain it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not applicable</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Seller-Side Quote Approvals</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: your rep drafts, your manager signs off before the customer sees it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not applicable</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Approval Audit Record</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in and append-only: every approval, rejection and override records who decided, when, their note, and the order total at that moment. Withdrawing and reinstating a quote never erases earlier sign-offs</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not native; whatever an approvals app chooses to log</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin, you maintain it</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not applicable</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Multiple Payment Gateways</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Amazon Pay, Stripe, Authorize.net, offline</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes, but extra fee for non-Shopify gateways</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes, via plugins</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles it</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Flexible Delivery Methods</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, pickup, shipping, local delivery</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shipping only (apps needed for pickup)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin-dependent</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles it</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Multi-Location Support</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, warehouses, pickup points, storefronts</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus or apps</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin-dependent</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">White-Label Storefront</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Yes, your brand, no platform branding</td>
                  <td className="px-6 py-4 text-sm text-gray-500">"Powered by Shopify" unless you pay more</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Deal / Promotion Support</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Built-in</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Via plugins</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace-controlled</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Volume Pricing / Quantity Breaks</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, bulk pricing per product</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app ($10-50/mo)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Line Sheets / Printable Wholesale Catalog</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, print/PDF, curate by category or product</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app ($10-40/mo)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Quick Order / SKU Pad / Order Pad (bulk entry)</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: SKU autocomplete, paste, CSV upload, browse grid</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native lists (2026) or apps</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Requisition Lists / Saved Carts</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, save and reload named carts</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native or apps</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Case Packs & Order Increments</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, per-product min / case pack / increment</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native (Plus B2B) or apps</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Shopping Channel Feeds</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: Google, Facebook, Bing, Pinterest, TikTok. Carries custom_label_0 to custom_label_4 for ad segmentation, plus package weight on all five and package dimensions wherever the channel supports them</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app ($10-100/mo)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires plugin ($0-200/yr)</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Locked in, no feed export</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">PPC Offline Conversion Upload (Google / Microsoft Ads)</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in CSV. No app. No Zapier.</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app or Zapier</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin or Zapier needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not applicable</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Customer-Company Association</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, code-based access control</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Multi-Supplier / Drop-Ship Partners</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in (drop-ship + consignment, catalog-level)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">App required, up to $79/mo</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin required, up to $999/yr</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace owns customers and brand</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Full Multi-Vendor Marketplace (vendor storefronts + payouts)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Roadmap</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus + enterprise app ($2,300+/mo baseline)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Premium plugin, up to $999/yr</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes (but you rent shelf space, not build a brand)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Maintenance</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Fully managed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Fully managed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">You manage hosting, security, updates</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Fully managed (but you have no control)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Custom Domain</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Included free</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Included</td>
                  <td className="px-6 py-4 text-sm text-gray-500">You configure it yourself</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">PWA (Install as App)</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, install from browser, $0</td>
                  <td className="px-6 py-4 text-sm text-gray-500">No native PWA, app needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Their own app only</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Built-in Analytics</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Real-time dashboard: revenue, orders, visitor tracking, CSV export</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Built-in reports + GA4 or paid app for full analytics</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed (Site Kit, MonsterInsights)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Limited marketplace dashboard</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Customer Groups & Custom Catalogs</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in, different catalog per customer segment</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus only (Companies + Catalogs)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">B2B Invoicing, Statements & Net Terms</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: monthly statements, snapshot persistence, admin retraction</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Shopify Plus + app</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">One-Click Reorder</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Requires app</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Yes (within marketplace)</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Refund Tracking</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in: append-only, race-safe, customer + admin views</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Built-in (Refunds + Returns)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Built-in, plugin-enhanced</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles per their rules</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Transactional Emails</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Branded SES included, no third-party app needed</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Built-in basic + Klaviyo ($20-$200+/mo) for marketing</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed (WP Mail SMTP, Mailchimp)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace handles</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Built-in Blog</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Native blog with SEO + AI-readable markdown</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Native (WordPress)</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">Not available</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">Review & Rating System</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Built-in. Email request sent only after delivery, admin-entered from verified buyer reply. No public forms, no fake reviews.</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Judge.me / Yotpo apps ($15-$199/mo), customer-submitted via public form</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Plugin needed, customer-submitted</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Marketplace-owned, you cannot moderate</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">REST API</td>
                  <td className="px-6 py-4 text-sm font-bold text-teal-700">Full REST API: catalog, orders, customers, integrations</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Admin + Storefront API, rate-limited on lower plans</td>
                  <td className="px-6 py-4 text-sm text-gray-500">REST API (you maintain)</td>
                  <td className="px-6 py-4 text-sm text-gray-500">Limited, marketplace-controlled</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* B2B Approval Workflows.
              Its own section rather than two more rows, because the platforms that
              actually compete on approvals (Adobe, Oro, Sana, Logicblock,
              BigCommerce) are not the platforms in the table above, and mixing
              enterprise B2B suites into a table that includes Etsy serves neither
              reader. Laid out with platforms as ROWS: seven columns would fight
              mobile, three do not. */}
          <div className="mt-16">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4 text-center">
              Which B2B Platforms Actually Have Order Approvals?
            </h2>
            <p className="max-w-3xl mx-auto text-center text-gray-600 mb-8">
              <strong>Short answer:</strong> most have half of it. Buyer-side approval, where a
              purchasing organisation signs off on its own spending, is fairly common. Seller-side
              approval, where your rep drafts a quote and your own manager signs off before the
              customer ever sees it, is rare. Of the platforms below, BusinessCart.ai and
              OroCommerce are the only two with both.
            </p>

            <div className="overflow-x-auto bg-white shadow-lg rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Buyer-Side Approvals</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Seller-Side Approvals</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr className="bg-teal-50">
                    <td className="px-6 py-4 text-sm font-bold text-teal-700">BusinessCart.ai</td>
                    <td className="px-6 py-4 text-sm font-bold text-teal-700">Multiple levels, several approvers per level so nothing stalls when someone is away, thresholds on order value or quantity, and a validity window so a stale price cannot be paid weeks later</td>
                    <td className="px-6 py-4 text-sm font-bold text-teal-700">Yes. Your rep drafts, your manager signs off before the customer sees the quote</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">Shopify Plus B2B</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Not native. App or custom development</td>
                    <td className="px-6 py-4 text-sm text-gray-500">No</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">Adobe Commerce B2B</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Approval rules, on the paid edition only</td>
                    <td className="px-6 py-4 text-sm text-gray-500">No</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">BigCommerce B2B Edition</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Tied to buyer roles: three predefined (junior, senior, admin) plus custom roles with configurable permissions</td>
                    <td className="px-6 py-4 text-sm text-gray-500">No</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">OroCommerce</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Yes</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Yes, the only other platform here with it</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">Sana Commerce</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Handled in your ERP, not the commerce platform. The order is held in SAP Business One or Dynamics NAV and approved there, so you need the ERP to get it</td>
                    <td className="px-6 py-4 text-sm text-gray-500">No</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">Logicblock</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Approval chains are advertised, mechanics are not published</td>
                    <td className="px-6 py-4 text-sm text-gray-500">Not published</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Sources, checked August 2026:{' '}
              <a className="underline" target="_blank" rel="noopener noreferrer nofollow" href="https://experienceleague.adobe.com/en/docs/commerce-admin/b2b/purchase-orders/account-dashboard-approval-rules">Adobe Commerce approval rules</a>,{' '}
              <a className="underline" target="_blank" rel="noopener noreferrer nofollow" href="https://www.bigcommerce.com/blog/now-available-custom-buyer-roles-in-b2b-edition/">BigCommerce buyer roles</a>,{' '}
              <a className="underline" target="_blank" rel="noopener noreferrer nofollow" href="https://support.sana-commerce.com/Content/ERP-User-Guide/SAPB1/Sales-Orders/Approve-Sales-Order-SAPB1.htm">Sana order approval</a>,{' '}
              <a className="underline" target="_blank" rel="noopener noreferrer nofollow" href="https://www.logicblock.com/b2b-purchasing/">Logicblock B2B purchasing</a>.
            </p>

            <div className="grid md:grid-cols-2 gap-8 mt-10">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-lg text-gray-900 mb-2">Who sets the rules?</h3>
                <p className="text-gray-600">
                  In BusinessCart.ai each organisation configures its own. You set who signs off
                  inside your company, and your customer sets who signs off inside theirs. Neither
                  side can edit the other, and neither side sees the other&rsquo;s approver names or
                  the notes they write on a decision. A supplier has no business running its
                  customer&rsquo;s internal purchasing process, and your customers have no business
                  seeing how you review your own margins.
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-lg text-gray-900 mb-2">Can the record be changed later?</h3>
                <p className="text-gray-600">
                  No. Every decision in BusinessCart.ai records who made it, when, the note they
                  left and the order total at that moment, and entries are never edited or removed.
                  If a quote is withdrawn and reinstated, the earlier sign-offs stay on the record.
                  Overrides are recorded too, naming the person who released the order and every
                  approval level they skipped.
                </p>
              </div>
            </div>
          </div>

          {/* Who Is This For */}
          <div className="mt-16">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-8 text-center">Who Is BusinessCart.ai For?</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-2">B2B Wholesalers</h3>
                <p className="text-sm text-gray-600">Per-customer pricing, quote negotiation, company codes, and flexible payment terms, built for how wholesale actually works.</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-2">D2C Brands</h3>
                <p className="text-sm text-gray-600">Launch your own branded storefront with sub-second speed, full SEO, and AI discoverability. No monthly fee until you sell.</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-2">Restaurants & Food Service</h3>
                <p className="text-sm text-gray-600">Pickup, delivery, and shipping options. Multiple locations. Offline payment methods. Built for food businesses leaving marketplaces.</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-gray-900 mb-2">Service & Specialty Businesses</h3>
                <p className="text-sm text-gray-600">Custom quotes, partner programs, and flexible catalogs. Works for any business that sells products or services online.</p>
              </div>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div className="mt-16">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-8 text-center">Detailed Breakdown</h2>
            <div className="space-y-12">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 mb-4">BusinessCart.ai vs. Shopify / Shopify Plus</h3>
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose BusinessCart.ai if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>You do not want to pay monthly fees before making your first sale.</li>
                      <li>You need B2B features: per-customer pricing, quotes, payment and delivery configuration.</li>
                      <li>You want the fastest possible storefront (sub-1-second loads vs 2-4 seconds).</li>
                      <li>You want your products discoverable by AI assistants and voice search.</li>
                      <li>You want to use your own payment gateway without paying extra platform fees.</li>
                      <li>You need volume pricing, spending caps, credit limits, or order limits, built in, not a $50/mo app.</li>
                      <li>You have buyers who work with multiple suppliers and need one login across all of them.</li>
                      <li>You want a PWA, customers install your store as an app from the browser, no app store fees.</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose Shopify if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>You are a high-volume B2C business doing $50K+/month and want the largest app ecosystem.</li>
                      <li>You need hundreds of third-party integrations (shipping, marketing, analytics).</li>
                      <li>Your B2B needs are simple or non-existent.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-gray-800 mb-4">BusinessCart.ai vs. WooCommerce (Self-Hosted)</h3>
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose BusinessCart.ai if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>You want the control of owning your store without managing servers, security, and updates.</li>
                      <li>You need B2B features built in, not bolted on through plugins.</li>
                      <li>You want a lower total cost when you factor in hosting, maintenance, and developer time.</li>
                      <li>You want multiple payment gateways and delivery methods without plugin headaches.</li>
                      <li>You want volume pricing, spending caps, and order limits without installing and maintaining plugins.</li>
                      <li>You want a PWA so customers can install your store as an app, no plugin or app store needed.</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose WooCommerce if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>You have the technical skills to manage your own hosting and security.</li>
                      <li>You need full control over every line of code.</li>
                      <li>You require very specific customizations that no hosted platform can offer.</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-gray-800 mb-4">BusinessCart.ai vs. Marketplaces (Etsy, DoorDash, Amazon, Uber Eats)</h3>
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose BusinessCart.ai if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>You want to stop paying 15-30% commission on every order.</li>
                      <li>You want to own your customer data and build direct relationships.</li>
                      <li>You want your own branded experience that you control.</li>
                      <li>You need pickup, shipping, and local delivery, not just marketplace delivery.</li>
                      <li>You want built-in B2B controls: per-customer pricing, tax overrides, credit limits, and order enforcement.</li>
                      <li>You want a PWA so customers install your store as an app, no app store listing required.</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <h4 className="font-semibold text-lg text-gray-900 mb-2">Choose a Marketplace if:</h4>
                    <ul className="list-disc list-inside space-y-2 text-gray-600">
                      <li>Your primary goal is customer discovery and you are willing to pay a high premium for it.</li>
                      <li>You do not have the time to manage any online presence.</li>
                      <li>You are focused exclusively on local delivery in a specific area.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to Try It?</h2>
            <p className="text-gray-600 mb-6">No monthly fees. No credit card. See it for yourself.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/contact-us"
                className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Get Started Free
              </Link>
              <Link
                to="/contact-us"
                className="inline-flex items-center justify-center px-8 py-3 border-2 border-teal-700 text-base font-medium rounded-md text-teal-700 hover:bg-teal-700 hover:text-white transition"
              >
                Request a Demo
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Compare;
