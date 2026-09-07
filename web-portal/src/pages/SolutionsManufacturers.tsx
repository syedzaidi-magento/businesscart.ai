import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  CommandLineIcon,
  CubeIcon,
  CurrencyDollarIcon,
  EnvelopeIcon,
  LockClosedIcon,
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
  { icon: AdjustmentsHorizontalIcon, title: 'Per-distributor pricing', desc: 'Each distributor gets their negotiated discount applied to every order automatically. No price lists in PDFs.' },
  { icon: ClipboardDocumentListIcon, title: 'Per-distributor MOQ enforcement', desc: 'Set minimum order quantities per distributor relationship. Small accounts get a different floor than national distributors.' },
  { icon: ClockIcon, title: 'Per-distributor lead times', desc: 'Configure lead time per distributor. Distributors see realistic delivery dates at order time, not after the fact.' },
  { icon: ShieldCheckIcon, title: 'Credit limit enforcement', desc: 'Reject orders that would exceed a distributor\'s credit cap. No more chasing AR after a problem order.' },
  { icon: CurrencyDollarIcon, title: 'Monthly + yearly spend caps', desc: 'Useful for staged rollouts, new distributor trial periods, or risk management on emerging accounts.' },
  { icon: ClipboardDocumentListIcon, title: 'Custom quote workflow', desc: 'Distributor requests custom volume, packaging, or specs. You quote, counter, finalize. Full negotiation history preserved.' },
  { icon: ShieldCheckIcon, title: 'Buyer-side order approvals', desc: 'Your distributor sets their own approval chain: multiple levels, several approvers per level, triggered by order value or quantity. The order cannot be paid until every level signs off.' },
  { icon: ShieldCheckIcon, title: 'Seller-side quote approvals', desc: 'Your rep drafts the quote, your manager signs off before the distributor ever sees it. Shopify B2B, Adobe Commerce B2B and BigCommerce B2B Edition have no native equivalent.' },
  { icon: UserGroupIcon, title: 'Staff accounts with seniority', desc: 'Invite colleagues into one organisation instead of sharing a login. Staff cannot see what products cost you or your margins, and only the owner changes payment settings and billing.' },
  { icon: ClipboardDocumentListIcon, title: 'Append-only approval record', desc: 'Every approval, rejection and override is stored permanently with who decided, when, their note, and the order total at that moment. A withdrawn and reinstated quote keeps its earlier sign-offs.' },
  { icon: CommandLineIcon, title: 'Quick order & bulk entry', desc: 'Distributors reorder fast: add by SKU with autocomplete, paste a list, upload a CSV, or browse a dense grid, then add the whole order at once.' },
  { icon: ClipboardDocumentListIcon, title: 'Saved carts (requisition lists)', desc: 'Distributors save up to 3 named carts per manufacturer and reload one to place standing orders in a click.' },
  { icon: CubeIcon, title: 'Case packs & order increments', desc: 'Set per-product minimums and pack sizes so distributors order in cases and pallets, matching your production runs.' },
  { icon: ClipboardDocumentListIcon, title: 'Printable line sheets', desc: 'Generate a branded print or PDF line sheet of your catalog, curated by category or product, for distributor buyers and reps. Built in, no app.' },
  { icon: LockClosedIcon, title: 'Private, code-gated catalog', desc: 'Each distributor gets a code that unlocks your catalog. Channel conflict eliminated. No public price list to undercut your channel.' },
  { icon: BanknotesIcon, title: 'Per-distributor payment terms', desc: 'Distributor A pays via PO. Distributor B uses Stripe. Distributor C pays Net 30 (Q3 2026 native, today via PO + offline).' },
  { icon: UserGroupIcon, title: 'Distributor tiers via customer groups', desc: 'Group distributors (Authorized, Preferred, National, Regional) with auto-applied tier discounts.' },
  { icon: CubeIcon, title: 'Multi-buyer accounts', desc: 'A distributor invites their purchasing team and branch buyers into one organisation, each with their own login rather than a shared password, all sharing the same negotiated configuration.' },
  { icon: CommandLineIcon, title: 'Full REST API for ERP sync', desc: 'Every operation has an endpoint. Push orders into your ERP, pull stock from production system, in real time.' },
  { icon: EnvelopeIcon, title: 'Transactional emails built in', desc: 'Order confirmations, quote requests, status updates, all branded and sent automatically via SES.' },
];

const betaFeatures = [
  { title: 'Per-item seller counter-offers', desc: 'Distributors propose item-level prices today. Per-item seller counter-offer UI is in active development. Whole-quote discounts work today.' },
  { title: 'Bulk product import via CSV', desc: 'CSV export works today. Bulk import is in active development. Manual entry available now via web portal.' },
];

const roadmap = [
  { quarter: 'q3' as const, feature: 'Native net-30 / net-60 / net-90 terms', why: 'Standard B2B credit terms with auto-aging and reminders' },
  { quarter: 'q3' as const, feature: 'Recurring distributor orders', why: 'Standing orders for predictable repeat volume' },
  { quarter: 'q3' as const, feature: 'Native ERP connectors (NetSuite, SAP, QB)', why: 'Prebuilt connectors rather than a per-system setup' },
  { quarter: 'q4' as const, feature: 'Distributor territory management', why: 'Assign territories with overlap rules and lead routing' },
  { quarter: 'q4' as const, feature: 'Multi-language portals', why: 'Sell to international distributor networks in their language' },
];

const faqs = [
  {
    q: 'How does this fit alongside our ERP and production system?',
    a: 'Two paths. (1) Use the REST API directly: every operation is exposed for direct ERP sync. (2) Tell us the system you run and we connect it for you. You add the credentials in your portal and BusinessCart handles the mapping and the sync, decoupled from order entry so heavy syncs never slow your portal, at no extra cost. Native NetSuite/SAP/QuickBooks connectors ship Q3 2026.',
  },
  {
    q: 'Can each distributor see their own pricing, MOQ, and lead times?',
    a: 'Yes, and only their own. Per-distributor configuration is enforced at quote time: pricing, MOQ, payment methods, delivery options, credit limits, and lead times all apply automatically. Distributor A never sees Distributor B\'s terms.',
  },
  {
    q: 'How do we handle channel conflict? Our distributors do not want public pricing.',
    a: 'Your catalog is code-gated by default. There is no public price list. Each distributor enters a code to unlock the catalog with their pricing. The most common form of channel conflict (public price exposure that lets one distributor undercut another) is eliminated by default. (Other forms of channel conflict like gray market or parallel imports require ongoing channel management beyond what any platform alone can solve.)',
  },
  {
    q: 'Can our sales reps place orders on behalf of distributors?',
    a: 'Yes. Each rep gets their own staff account inside your organisation, not a shared admin login, and creates quotes on behalf of any distributor. The distributor\'s pricing, MOQ, payment methods, and lead times all apply automatically, and reps cannot override them. Your manager can be required to approve the quote before the distributor sees it.',
  },
  {
    q: 'How long does setup take?',
    a: 'Days, not months. Add your products, configure customer groups (distributor tiers), set per-distributor overrides, share customer codes. There is no implementation consultant, no training program. SAP-class B2B portals typically take 12-18 months to deploy. For distributor self-serve ordering specifically, we ship in days. (We do not replicate SAP\'s broader ERP scope; we cover the distributor ordering layer.)',
  },
  {
    q: 'What happens when our distributors need to escalate or renegotiate?',
    a: 'Built-in quote workflow with comments. Distributor proposes new terms in the quote thread, you respond with comments and updates, full history preserved. No more email chains with attached PDFs that get lost.',
  },
];

const SolutionsManufacturers: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · Manufacturers</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Distributor Ordering{' '}
                <span className="text-teal-400">Without the Email Chains.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                Per-distributor pricing, MOQ, lead times, credit limits, all enforced automatically at every order. Your distributors self-serve through their own private portal. Your sales reps stop being the bottleneck.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                $0/month · Live in days, not months · Channel conflict structurally impossible · Real B2B enforcement
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
              <h2 className="text-3xl font-extrabold text-gray-900">Manufacturer-to-Distributor Ordering Is Stuck in the 90s</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <EnvelopeIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Orders via email + PDF + phone calls</h3>
                </div>
                <p className="text-gray-600">
                  Distributors email a PO. Your team types it into ERP. Errors compound. By the time it ships, 3 people have touched it and 1 line item is wrong. Daily reality at most manufacturers.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <TableCellsIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Pricing in spreadsheets per distributor</h3>
                </div>
                <p className="text-gray-600">
                  Tier pricing, volume breaks, promotional rates, all tracked across files, sales rep notes, and sometimes just memory. Distributors call to "verify" prices because they don't trust the price list.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CurrencyDollarIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Existing platforms cost $100K+ and take a year</h3>
                </div>
                <p className="text-gray-600">
                  SAP Commerce, Oracle, NetSuite SuiteCommerce: months of consultants, $100K-$500K all-in, and you still need a developer to maintain it. Not viable for mid-market manufacturers.
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
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Email + PDF</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">SAP / Oracle Commerce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Adobe Commerce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Cost', '$0 (and pain)', '$100K-$500K all-in', '$22K-$125K+/yr (license + dev)', '$0/mo, $5 max per order'],
                    ['Setup time', 'Day one (errors)', '6-18 months', '6-12 months', 'Days'],
                    ['Per-distributor pricing', 'Manual', 'Yes (custom dev)', 'Yes (custom dev)', 'Yes, built-in'],
                    ['Per-distributor MOQ + lead times', 'Manual', 'Custom dev', 'Custom dev', 'Built-in'],
                    ['Credit limit enforcement', 'None', 'Yes (custom rules)', 'Yes (custom dev)', 'Built-in at quote time'],
                    ['Quote negotiation workflow', 'Email PDFs', 'Yes', 'Yes', 'Built-in with history'],
                    ['Channel conflict prevention (private)', 'N/A', 'Custom config', 'Custom config', 'Code-gated by default'],
                    ['ERP integration', 'Manual entry', 'Native (consultant)', 'Native (consultant)', 'API + we connect it for you'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900">{row[0]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[1]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[2]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[3]}</td>
                      <td className="px-4 py-4 text-sm text-gray-900 font-semibold">{row[4]}</td>
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
              <h2 className="text-3xl font-extrabold text-gray-900">Real Distributor Enforcement, Not Just "Tags"</h2>
              <p className="mt-4 text-gray-600">All features below are <Badge kind="live" /> today. Working code that rejects invalid orders before they happen.</p>
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
              ERP Integration Without the Consultants
            </h2>
            <p className="mt-6 text-lg text-gray-200">
              Tell BusinessCart which production system you run, SAP, NetSuite, Oracle, JD Edwards or another, and we connect it. You add the credentials once in your portal. Heavy syncs run off your distributor portal, so orders flow in real time while the ERP catches up asynchronously. Scope depends on your ERP's API surface: BusinessCart covers the data plumbing, you own the business logic.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Integrations, connected for you</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  You provide the credentials in your portal and BusinessCart handles the field mapping and the sync, whether that is ERP, MES, WMS or accounting. Tell us the system you run and we connect it.
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
                  Order confirmations, lead-time updates, allocation notifications, all handled by AI so reps focus on relationships.
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
              <p className="mt-4 text-gray-600">Built with known gaps. We tell you upfront so you can plan accordingly.</p>
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
              <p className="mt-4 text-gray-600">Specific dates so you can plan your manufacturing-channel roadmap with confidence.</p>
            </div>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Feature</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Why it matters</th>
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
              <strong>uSetGo INC</strong>, a live storefront on BusinessCart.ai. Public face shown below; the distributor portal sits behind a customer code with per-distributor pricing, MOQ, and quote workflow active.
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
              <p className="mt-4 text-sm text-gray-500">For a guided distributor portal demo, <Link to="/contact-us" className="text-teal-700 hover:text-teal-800 font-semibold">request a demo →</Link></p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">From PDFs to Self-Serve in Days</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Add your product line', desc: 'Upload products, define distributor tiers (Authorized, Preferred, National), set default MOQ and lead times.' },
                { step: '2', title: 'Configure each distributor', desc: 'Per-distributor pricing, MOQ, payment methods, credit limit, lead time. Override anything per relationship.' },
                { step: '3', title: 'Distribute customer codes', desc: 'Each distributor gets a private code unlocking their version of your catalog. They self-serve from there.' },
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
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Modernize Distributor Ordering. Without the Six-Month Project.</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0/month · Per-distributor enforcement that actually works · Live in days
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

export default SolutionsManufacturers;
