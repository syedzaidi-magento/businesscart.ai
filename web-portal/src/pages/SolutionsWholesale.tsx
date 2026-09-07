import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  CommandLineIcon,
  CubeIcon,
  CurrencyDollarIcon,
  LockClosedIcon,
  MapPinIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TableCellsIcon,
  UserGroupIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

const Badge: React.FC<{ kind: 'live' | 'beta' | 'q2' | 'q3' | 'q4' }> = ({ kind }) => {
  const config = {
    live: { label: 'LIVE', cls: 'bg-green-100 text-green-800 ring-green-200' },
    beta: { label: 'BETA', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
    q2: { label: 'Q2 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
    q3: { label: 'Q3 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
    q4: { label: 'Q4 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
  }[kind];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset ${config.cls}`}>
      {config.label}
    </span>
  );
};

const liveFeatures = [
  { icon: AdjustmentsHorizontalIcon, title: 'Per-customer pricing', desc: 'Each customer gets their negotiated discount applied automatically. No coupons, no manual override at checkout.' },
  { icon: ShieldCheckIcon, title: 'Credit limits enforced at quote time', desc: 'Quote rejected automatically if unpaid balance + new order exceeds the customer\'s credit cap. No more credit overruns.' },
  { icon: ClipboardDocumentListIcon, title: 'Min / max order amount + quantity', desc: 'Enforce minimum order values, case quantities, or pallet sizes per customer. Validated before quote is created.' },
  { icon: CommandLineIcon, title: 'Quick order & bulk entry', desc: 'Buyers who know their SKUs order in seconds: add by SKU with autocomplete, paste a list, upload a CSV, or browse a compact grid. No hunting through the catalog.' },
  { icon: ClipboardDocumentListIcon, title: 'Saved carts (requisition lists)', desc: 'Customers save up to 3 named carts per supplier and reload one to reorder in a click. No re-keying the same weekly order.' },
  { icon: CubeIcon, title: 'Case packs & order increments', desc: 'Sell in cases of 24 or pallets of 40. Set per-product minimums and increments; the cart snaps quantities to the pack size automatically.' },
  { icon: ClipboardDocumentListIcon, title: 'Line sheets (print / PDF)', desc: 'Generate a branded wholesale line sheet, curated by category or product, then print or save to PDF for buyers and reps. Built in, no third-party app.' },
  { icon: CurrencyDollarIcon, title: 'Monthly + yearly spend caps', desc: 'Set spending limits per customer relationship. Useful for staged rollouts, trial accounts, or risk management.' },
  { icon: ClipboardDocumentListIcon, title: 'Full quote negotiation workflow', desc: 'Customer proposes, you counter, they approve, it converts to an order, with comments, history, and full audit trail.' },
  { icon: ShieldCheckIcon, title: 'Buyer-side order approvals', desc: 'Your customer sets their own approval chain: multiple levels, several approvers per level, triggered by order value or quantity. The order cannot be paid until every level signs off.' },
  { icon: ShieldCheckIcon, title: 'Seller-side quote approvals', desc: 'Your rep drafts the quote, your manager signs off before the customer ever sees it. Shopify B2B, Adobe Commerce B2B and BigCommerce B2B Edition have no native equivalent.' },
  { icon: UserGroupIcon, title: 'Staff accounts with seniority', desc: 'Invite colleagues into one organisation instead of sharing a login. Staff cannot see what products cost you or your margins, and only the owner changes payment settings and billing.' },
  { icon: ClipboardDocumentListIcon, title: 'Append-only approval record', desc: 'Every approval, rejection and override is stored permanently with who decided, when, their note, and the order total at that moment. A withdrawn and reinstated quote keeps its earlier sign-offs.' },
  { icon: LockClosedIcon, title: 'Private, code-gated catalog', desc: 'Customers only see your catalog after entering a customer code you share. No public listing, no competitors next to you.' },
  { icon: BanknotesIcon, title: 'Per-customer payment methods', desc: 'Customer A pays via Stripe. Customer B uses purchase orders. Customer C pays cash on pickup. You decide who gets what.' },
  { icon: ServerIcon, title: 'Per-customer delivery options', desc: 'Some customers get pickup only. Some get delivery. Some get shipping. Restrict per relationship. They only see their options.' },
  { icon: UserGroupIcon, title: 'Customer groups with bulk discounts', desc: 'Group customers (Wholesale, Distributor, Tier-1, etc.). Apply uniform discounts across the group without configuring each customer.' },
  { icon: MapPinIcon, title: 'Multiple locations', desc: 'Manage warehouses, pickup points, and distribution centers, each with operating hours and capacity.' },
  { icon: CubeIcon, title: 'Multi-supplier customer accounts', desc: 'Your customers can be associated with multiple suppliers, each with independent configurations, all from one login.' },
  { icon: CommandLineIcon, title: 'Full REST API', desc: 'Every operation has an endpoint. Integrate with your ERP, accounting, or warehouse system.' },
];

const betaFeatures = [
  { title: 'Selling area radius (geofencing)', desc: 'Set a delivery radius per location. Schema works today; checkout enforcement is in active development.' },
  { title: 'Operating-hours enforcement', desc: 'Operating hours stored per location today; automatic order blocking outside hours is in active development.' },
  { title: 'Per-item seller counter-offers', desc: 'Customers can propose item-level price changes today. Sellers can apply whole-quote discounts; per-item counter-offer UI is in development.' },
  { title: 'Bulk product import via CSV', desc: 'CSV export works today; bulk import is in active development. Manual entry available now via web portal.' },
];

const roadmap = [
  { quarter: 'q3' as const, feature: 'Recurring / subscription orders', why: 'Standing orders for repeat customers, major B2B reorder use case' },
  { quarter: 'q3' as const, feature: 'Tiered customer pricing levels', why: 'Customer tiers (Tier 1, Tier 2, Wholesale, Distributor) with auto-applied levels' },
  { quarter: 'q3' as const, feature: 'Native ERP/accounting connectors', why: 'QuickBooks, Xero, NetSuite: prebuilt connectors rather than a per-system setup' },
  { quarter: 'q4' as const, feature: 'Multi-language portals', why: 'Sell wholesale internationally in your customer\'s language' },
  { quarter: 'q4' as const, feature: 'Multi-currency checkout', why: 'Charge customers in their local currency at checkout' },
];

const faqs = [
  {
    q: 'How is this different from Shopify B2B?',
    a: 'Shopify B2B requires Shopify Plus ($2,300+/mo) and offers basic per-customer pricing. We enforce all the things Shopify B2B does not: credit limits at quote time, min/max order amounts, quantity limits, monthly and yearly spend caps. We also include quote negotiation workflows out of the box. And we are $0/month.',
  },
  {
    q: 'How long does setup take?',
    a: 'Days, not months. Sign up, add your products, define your customer groups and per-customer overrides, share customer codes with your buyers. There is no implementation consultant, no migration project, no training program required. NetSuite-class B2B portals typically take 6-18 months to deploy. For the per-customer ordering layer specifically, we ship in days.',
  },
  {
    q: 'Can I migrate my customer pricing and terms from QuickBooks or spreadsheets?',
    a: 'Yes, manual entry today, bulk CSV import in beta and shipping Q2 2026. The data model maps cleanly: each customer gets a discount percentage, payment methods, delivery options, credit limit, and order limits. If you have it in a spreadsheet, you can move it.',
  },
  {
    q: 'What if a sales rep needs to place an order on behalf of a customer?',
    a: 'Each rep gets their own staff account inside your organisation, no shared admin login, and creates quotes on behalf of any of your customers. The customer\'s pricing, payment methods, and limits all apply automatically, and the rep cannot override them. If you require seller-side approval, your manager signs the quote off before the customer sees it. The customer then sees the quote in their portal and can approve or counter.',
  },
  {
    q: 'How does the quote workflow handle counter-offers?',
    a: 'Customer proposes per-item prices in their cart. You see the quote, can apply a whole-quote discount, add comments, and update status. The customer sees your response, can re-propose, and the negotiation continues until both sides approve. Full history and comment thread preserved.',
  },
  {
    q: 'Can I integrate with my ERP, accounting, or warehouse system?',
    a: 'Yes, two paths. (1) Use our REST API directly: every operation is exposed, full read/write, no limits. (2) Tell us the system you run and we connect it for you. You add the credentials in your portal, BusinessCart handles the field mapping and the sync, and it costs nothing extra. Native QuickBooks/Xero/NetSuite connectors are on the Q3 2026 roadmap if you would rather self-serve.',
  },
];

const SolutionsWholesale: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · B2B Wholesale Platform</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Stop Running B2B in{' '}
                <span className="text-teal-400">Spreadsheets.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                BusinessCart is a B2B wholesale platform with per-customer pricing, credit limits, spend caps, and quote negotiation, all enforced automatically at every order. Your customers self-serve through their own private portal. You stop being the bottleneck.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                $0/month · Live in hours, not months · Real B2B enforcement, not just "tags"
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link
                  to="/contact-us"
                  className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800 md:py-4 md:text-lg md:px-10"
                >
                  Request a Demo
                </Link>
                <Link
                  to="/contact-us"
                  className="inline-flex items-center justify-center px-8 py-3 border border-gray-200 text-base font-medium rounded-md text-gray-200 hover:text-white hover:border-white md:py-4 md:text-lg md:px-10"
                >
                  Start Free
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* The Pain */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">B2B Wholesale Is Stuck in 2005</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <TableCellsIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Spreadsheets and email chains</h3>
                </div>
                <p className="text-gray-600">
                  Per-customer pricing in someone's head. Credit limits in QuickBooks notes. Quotes via PDF attachments revised in 8-message email threads. Order errors are routine.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <UserGroupIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Sales reps are the bottleneck</h3>
                </div>
                <p className="text-gray-600">
                  Customers have to call or email a rep to place an order. After 5pm? Weekend? Holiday? Tough luck. You can't scale beyond what your reps can handle on the phone.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CurrencyDollarIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Existing platforms cost a fortune or do too little</h3>
                </div>
                <p className="text-gray-600">
                  Shopify B2B requires Plus at $2,300+/mo and still misses credit enforcement. NetSuite SuiteCommerce typically runs $5,000-15,000/mo (with users + modules) plus $50,000-$250,000 Year 1 implementation, and takes 6-18 months to deploy. Generic ecommerce treats every customer the same.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Side by Side */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center">How We Compare</h2>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg shadow-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-900"></th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Email + Excel</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Shopify B2B (Plus)</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">NetSuite</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Adobe Commerce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Monthly cost', '$0 (and pain)', '$2,300+', '$5,000-15,000+', '$1,800-15,000+', '$0/mo, $5 max per order'],
                    ['Per-customer pricing', 'Manual', 'Yes', 'Yes', 'Yes (custom dev)', 'Yes, enforced'],
                    ['Credit limit enforcement', 'None', 'Limited', 'Yes', 'Yes (custom dev)', 'Yes, at quote time'],
                    ['Min/max order limits', 'None', 'Limited', 'Yes', 'Custom dev', 'Yes, enforced'],
                    ['Monthly/yearly spend caps', 'None', 'No', 'Custom', 'Custom dev', 'Built-in'],
                    ['Quote negotiation workflow', 'Email PDFs', 'Limited', 'Yes', 'Yes', 'Built-in with history'],
                    ['Customer self-serve', 'No', 'Yes', 'Yes', 'Yes', 'Yes'],
                    ['Setup cost', '$0', '$0-$10K (optional agency)', '$50K-$250K', '$50K-$150K', '$0'],
                    ['Setup time', 'Day one (pain)', '2-4 weeks', '6-18 months', '6-12 months', 'Days'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900">{row[0]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[1]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[2]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[3]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[4]}</td>
                      <td className="px-4 py-4 text-sm text-gray-900 font-semibold">{row[5]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* What you get today */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">Real B2B Enforcement, Not Just "Tags"</h2>
              <p className="mt-4 text-gray-600">
                Every feature below is <Badge kind="live" /> today. Not a roadmap promise. Working code that rejects invalid orders before they happen.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {liveFeatures.map((f) => (
                <div key={f.title} className="flex flex-col">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-10 w-10 rounded-md bg-teal-700 text-white flex-shrink-0">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <Badge kind="live" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">{f.title}</h3>
                  <p className="mt-2 text-gray-600">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Operations Layer */}
        <section className="py-16 bg-gradient-to-br from-gray-900 to-gray-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <SparklesIcon className="h-6 w-6 text-teal-400" />
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Operations Layer</p>
              <Badge kind="live" />
            </div>
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
              Your Integrations Run Without an Integration Team
            </h2>
            <p className="mt-6 text-lg text-gray-200">
              Tell BusinessCart which systems you run and we connect them: accounting, ERP, warehouse, CRM. You add the credentials once in your portal, and everything after that happens off your storefront, so a heavy sync never slows a buyer placing an order. Shopify and NetSuite make you assemble this from plugins, connectors and consultants. BusinessCart runs it as one operations layer, built in.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Integrations, connected for you</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  You provide the credentials in your portal and BusinessCart handles the field mapping and the sync. Tell us the system you run and we connect it, rather than making you pick from a list of whatever we happened to build.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Alerts, not dashboards</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  BusinessCart watches its own integrations and order flow. If a sync fails or something looks wrong, you get an alert. Nothing for you to build, nothing for you to monitor.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Systems stay in step</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  When an order is placed, BusinessCart updates your connected systems automatically. No export, no re-keying, no nightly file to remember to send.
                </p>
              </div>
            </div>
            <p className="mt-8 text-sm text-gray-400">
              Every BusinessCart feature is included in every tier, and this costs nothing extra. If a system you connect charges for its own API access, you pay that vendor directly and add your credentials in the portal.{' '}
              <Link to="/contact-us" className="text-teal-400 hover:text-teal-300 font-semibold">
                Tell us what you run →
              </Link>
            </p>
          </div>
        </section>

        {/* In Beta */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">Honest Beta Status</h2>
              <p className="mt-4 text-gray-600">
                Built with known gaps. We tell you upfront so you can plan accordingly.
              </p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {betaFeatures.map((f) => (
                <div key={f.title} className="bg-white rounded-lg p-6 shadow-sm border border-amber-100">
                  <div className="flex items-center gap-3">
                    <Badge kind="beta" />
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-gray-900">{f.title}</h3>
                  <p className="mt-2 text-gray-600">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Coming in 2026 */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">Where We're Going</h2>
              <p className="mt-4 text-gray-600">
                Quarterly shipping. Specific dates so you can plan your B2B roadmap with confidence.
              </p>
            </div>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Feature</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Why it matters for B2B</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {roadmap.map((r) => (
                    <tr key={r.feature}>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900">{r.feature}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{r.why}</td>
                      <td className="px-4 py-4 text-sm"><Badge kind={r.quarter} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* See it live */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">See the Platform in Action</h2>
            <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
              <strong>uSetGo INC</strong>, a live storefront on BusinessCart.ai. Public face shown below; the B2B portal sits behind a customer code with per-customer pricing, credit limits, and quote workflow active.
            </p>
            <div className="mt-8">
              <a
                href="https://www.usetgo.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Visit www.usetgo.com
                <ArrowTopRightOnSquareIcon className="ml-2 h-5 w-5" />
              </a>
              <p className="mt-4 text-sm text-gray-500">For a guided B2B demo with a customer code, <Link to="/contact-us" className="text-teal-700 hover:text-teal-800 font-semibold">request a demo →</Link></p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">From Spreadsheets to Self-Serve in Hours</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Set up your company', desc: 'Add products, define customer groups, configure default payment methods, delivery options, and tax rates.' },
                { step: '2', title: 'Configure each customer', desc: 'Per-customer discount, credit limit, payment methods, delivery options, min/max orders, monthly/yearly caps. Override anything per relationship.' },
                { step: '3', title: 'Share customer codes', desc: 'Each customer gets a private code that unlocks your catalog with their pricing and rules. They self-serve from there.' },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="flex items-center justify-center h-16 w-16 rounded-full bg-teal-700 text-white text-2xl font-bold mx-auto">
                    {s.step}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-2 text-gray-600">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <PricingSection bgClass="bg-gray-50" cardBgClass="bg-white" />

        {/* FAQ */}
        <section className="py-16 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center">Frequently Asked Questions</h2>
            <div className="mt-10 space-y-6">
              {faqs.map((f) => (
                <div key={f.q} className="bg-gray-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900">{f.q}</h3>
                  <p className="mt-3 text-gray-600">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-gray-50">
          <div className="max-w-4xl mx-auto text-center py-16 px-4 sm:py-20 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Modernize Your B2B Ordering. Without the Spreadsheets.</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0/month · Per-customer enforcement that actually works · Live in hours
            </p>
            <div className="mt-8 flex flex-col sm:flex-row sm:justify-center gap-3">
              <Link
                to="/contact-us"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Request a Demo
              </Link>
              <Link
                to="/contact-us"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 hover:text-gray-900 hover:border-gray-400"
              >
                Start Free
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default SolutionsWholesale;
