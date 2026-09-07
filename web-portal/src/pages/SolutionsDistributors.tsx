import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  CommandLineIcon,
  CubeIcon,
  CurrencyDollarIcon,
  EnvelopeIcon,
  LockClosedIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
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
  { icon: AdjustmentsHorizontalIcon, title: 'Per-customer pricing tiers', desc: 'Retailers, wholesalers, end customers, each gets their negotiated rate automatically. Margins protected without manual intervention.' },
  { icon: ShieldCheckIcon, title: 'Credit limit enforcement', desc: 'Reject orders exceeding a customer\'s credit cap before they ship. No more chasing AR after the fact.' },
  { icon: ClipboardDocumentListIcon, title: 'Custom quote workflow', desc: 'Volume orders, special configurations, drop-ship requests. Full negotiation with comments and history.' },
  { icon: ShieldCheckIcon, title: 'Buyer-side order approvals', desc: 'Your retailer sets their own approval chain: multiple levels, several approvers per level, triggered by order value or quantity. The order cannot be paid until every level signs off.' },
  { icon: ShieldCheckIcon, title: 'Seller-side quote approvals', desc: 'Your rep drafts the quote, your manager signs off before the retailer ever sees it. Shopify B2B, Adobe Commerce B2B and BigCommerce B2B Edition have no native equivalent.' },
  { icon: UserGroupIcon, title: 'Staff accounts with seniority', desc: 'Invite colleagues into one organisation instead of sharing a login. Staff cannot see what products cost you or your margins, and only the owner changes payment settings and billing.' },
  { icon: ClipboardDocumentListIcon, title: 'Append-only approval record', desc: 'Every approval, rejection and override is stored permanently with who decided, when, their note, and the order total at that moment. A withdrawn and reinstated quote keeps its earlier sign-offs.' },
  { icon: CommandLineIcon, title: 'Quick order & bulk entry', desc: 'Buyers reorder fast: add by SKU with autocomplete, paste a list, upload a CSV, or browse a dense grid, then add the whole order to the cart at once.' },
  { icon: ClipboardDocumentListIcon, title: 'Saved carts (requisition lists)', desc: 'Retailers save up to 3 named carts per supplier and reload one to place standing orders in a click.' },
  { icon: CubeIcon, title: 'Case packs & order increments', desc: 'Enforce per-product minimums and pack sizes so buyers order in cases and pallets, not loose units.' },
  { icon: ClipboardDocumentListIcon, title: 'Printable line sheets', desc: 'Generate a branded print or PDF line sheet of your catalog, curated by category or product, for reps and buyers. Built in, no app.' },
  { icon: LockClosedIcon, title: 'Login-gated (private) catalog', desc: 'Each customer gets a private code unlocking your catalog with their pricing. Channel pricing stays private.' },
  { icon: ArrowsRightLeftIcon, title: 'Multi-supplier customer accounts', desc: 'When your suppliers also use BusinessCart, your buyers can manage upstream orders from the same account.' },
  { icon: CubeIcon, title: 'High-SKU catalog support', desc: 'Static HTML catalog handles thousands of SKUs without slowing down. Fast browse, instant search.' },
  { icon: BanknotesIcon, title: 'Per-customer payment methods', desc: 'PO for retailers, Stripe for end customers, cash for pickup. Configure per relationship.' },
  { icon: MapPinIcon, title: 'Multiple warehouse locations', desc: 'Manage inventory across distribution centers, regional warehouses, drop-ship points.' },
  { icon: UserGroupIcon, title: 'Customer groups (retail tiers)', desc: 'Group customers (Tier 1 Retail, Tier 2, Wholesale, Direct) with auto-applied tier discounts.' },
  { icon: CommandLineIcon, title: 'Full REST API for inventory sync', desc: 'Push stock levels from your warehouse system. Pull orders into your fulfillment system. Real-time, no batch jobs.' },
  { icon: EnvelopeIcon, title: 'Transactional emails built in', desc: 'Order confirmations, shipping updates, quote responses, all branded and sent automatically.' },
  { icon: CurrencyDollarIcon, title: 'Monthly + yearly spend caps', desc: 'Useful for new account trials, risk management, or limiting promotional pricing exposure.' },
];

const betaFeatures = [
  { title: 'Per-item seller counter-offers', desc: 'Customers propose item-level prices today. Per-item seller counter-offer UI is in active development.' },
  { title: 'Bulk product import via CSV', desc: 'CSV export works today. Bulk import is in active development. Critical for distributors with large catalogs.' },
];

const roadmap = [
  { quarter: 'q3' as const, feature: 'Drop-shipping coordination', why: 'Route orders from distributor portal directly to manufacturer fulfillment' },
  { quarter: 'q3' as const, feature: 'Recurring customer orders', why: 'Standing orders for retailers with predictable replenishment cycles' },
  { quarter: 'q3' as const, feature: 'Native ERP/WMS connectors', why: 'NetSuite, SAP, QuickBooks: prebuilt connectors rather than a per-system setup' },
  { quarter: 'q3' as const, feature: 'Net-30 / net-60 / net-90 terms', why: 'Standard B2B credit terms with auto-aging' },
  { quarter: 'q4' as const, feature: 'Multi-currency checkout', why: 'Distribute internationally without currency friction' },
];

const faqs = [
  {
    q: 'I distribute for multiple manufacturers. Can I sell across all their products on one storefront?',
    a: 'Yes. You aggregate products from all your suppliers into your own catalog, set your own pricing per customer, and your customers see one unified ordering experience. Your suppliers do not need to use BusinessCart for this to work. You upload products like any catalog.',
  },
  {
    q: 'What if my suppliers also use BusinessCart? Can I order from them through the same platform?',
    a: 'Yes. Multi-supplier customer accounts mean you log in once and switch between your supplier portals. Each supplier sets your terms, you self-serve. No more managing 12 supplier portals with 12 logins.',
  },
  {
    q: 'How does this handle drop-shipping?',
    a: 'Partial coverage today: partners get their own portal login and see the orders containing their SKUs in a read-only view (drop-ship or consignment model). Your company still owns the customer relationship and the storefront. Full automated routing (per-partner fulfilment tracking, split shipping, and payouts) is on the roadmap. The REST API is available today if you want to build custom routing now.',
  },
  {
    q: 'How is this different from selling on Amazon Business?',
    a: 'Amazon Business takes commissions, owns the customer relationship, and pressures your margins. BusinessCart is your private portal: your customers, your pricing, your data, $0/month. You can sell on both. Many distributors use Amazon Business for discovery and BusinessCart for repeat-customer self-serve.',
  },
  {
    q: 'Can my retailers self-serve, or does it require a sales rep?',
    a: 'Retailers self-serve through their private portal with their negotiated pricing, payment terms, and credit limits all enforced automatically. Reps stop being order-takers and become relationship managers, focused on growth, not data entry.',
  },
  {
    q: 'Can I integrate with my warehouse management system?',
    a: 'Yes, two paths. (1) REST API: every operation has an endpoint, full read/write. (2) Tell us which WMS you run and we connect it for you, with no code and no extra cost. Native NetSuite/SAP/QuickBooks/major-WMS connectors ship Q3 2026.',
  },
];

const SolutionsDistributors: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · Distributors</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Distributors:{' '}
                <span className="text-teal-400">Stop Running Orders Through Email and PDFs.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                Per-customer pricing tiers, credit enforcement, multi-warehouse inventory, and quote workflows, all in one platform. Your retailers self-serve. Your reps focus on growth, not order entry.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                $0/month · High-SKU catalog support · Margin protection at quote time · Multi-supplier ready
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
              <h2 className="text-3xl font-extrabold text-gray-900">Distribution Margins Are Compressing. Manual Ordering Is Not Helping.</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <EnvelopeIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Order entry tax on every transaction</h3>
                </div>
                <p className="text-gray-600">
                  Retailer emails an order. Your team types it into your system. Errors. Missed line items. Wrong pricing. On thin distributor margins, every error compounds.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CurrencyDollarIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Amazon Business is squeezing you</h3>
                </div>
                <p className="text-gray-600">
                  Customers can buy direct from manufacturers on Amazon Business. Your differentiation has to be service, speed, and a buying experience that beats a generic marketplace.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <ArrowsRightLeftIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">12 supplier portals, 12 logins</h3>
                </div>
                <p className="text-gray-600">
                  Every manufacturer has their own portal. Your buyers context-switch between systems all day. There is no unified buying experience for the distributor itself.
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
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Email + ERP only</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Shopify B2B (Plus)</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">NetSuite SuiteCommerce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">Adobe Commerce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Cost', '$0 (and pain)', '$2,000+/mo', '$2,000-10,000+/mo', '$1,800-10,000+/mo', '$0/mo, $5 max per order'],
                    ['Per-customer tier pricing', 'Manual', 'Yes', 'Yes', 'Yes (custom dev)', 'Yes, enforced'],
                    ['Credit limit enforcement', 'None', 'Limited', 'Yes', 'Yes (custom dev)', 'Yes, at quote time'],
                    ['Multi-warehouse inventory', 'Yes (ERP)', 'Limited', 'Yes', 'Yes', 'Multiple locations'],
                    ['High-SKU catalog (1000+ items)', 'Yes', 'Slow', 'Yes', 'Yes', 'Static HTML, fast'],
                    ['Multi-supplier buyer accounts', 'No (12 logins)', 'No', 'Custom', 'Custom', 'Built-in'],
                    ['Quote workflow', 'Email PDFs', 'Limited', 'Yes', 'Yes', 'Built-in with history'],
                    ['Setup time', 'Day one', '2-4 weeks', '6-18 months', '6-12 months', 'Days'],
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
              <h2 className="text-3xl font-extrabold text-gray-900">A Buying Experience That Beats Amazon Business</h2>
              <p className="mt-4 text-gray-600">All features below are <Badge kind="live" /> today.</p>
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
              Every System You Run, Connected
            </h2>
            <p className="mt-6 text-lg text-gray-200">
              ERP, WMS, accounting, supplier portals: tell BusinessCart which ones you run and we connect them, with no code to write and no consultants to hire. Heavy syncs run decoupled from your customer-facing portal, so distributor browsing stays fast while back-office data flows continuously.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Integrations, connected for you</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  You provide the credentials in your portal and BusinessCart handles the field mapping and the sync, whether that is ERP, WMS, accounting or a supplier portal. Tell us the system you run and we connect it.
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
              <p className="mt-4 text-gray-600">Specific dates so you can plan around distribution-specific feature launches.</p>
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
              <strong>uSetGo INC</strong>, a live storefront on BusinessCart.ai. Public face shown below; the customer portal sits behind a code with per-customer pricing, credit limits, and quote workflow active.
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
              <p className="mt-4 text-sm text-gray-500">For a guided distributor demo, <Link to="/contact-us" className="text-teal-700 hover:text-teal-800 font-semibold">request a demo →</Link></p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">From Email Orders to Self-Serve in Days</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Upload your catalog', desc: 'Add products from all your supplier lines. Set warehouse locations and stock visibility per customer.' },
                { step: '2', title: 'Configure customer tiers', desc: 'Define retail tiers (Tier 1, Tier 2, Wholesale, Direct). Set per-customer overrides for key accounts.' },
                { step: '3', title: 'Distribute customer codes', desc: 'Each customer gets a private code with their pricing and rules. They self-serve from there.' },
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
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Modernize Distribution. Without the Six-Figure Software.</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0/month · Customer self-serve · Margin protection · Multi-supplier ready
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

export default SolutionsDistributors;
