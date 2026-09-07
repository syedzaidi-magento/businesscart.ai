import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  BoltIcon,
  CurrencyDollarIcon,
  GlobeAltIcon,
  CpuChipIcon,
  ShoppingBagIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  TagIcon,
  DevicePhoneMobileIcon,
  PhotoIcon,
  CommandLineIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
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
  { icon: CurrencyDollarIcon, title: '$0/month, 6% per order', desc: 'Pay nothing until you sell. No setup costs, no hidden fees.' },
  { icon: GlobeAltIcon, title: 'Branded storefront + custom domain', desc: 'Your colors, logo, and domain. See usetgo.com for a live example.' },
  { icon: BoltIcon, title: 'Sub-1-second page load', desc: 'Static HTML on CloudFront\'s 200+ edge locations. No bloated themes.' },
  { icon: ChartBarIcon, title: 'Auto-generated SEO', desc: 'Sitemap, schema.org, OpenGraph, meta tags. All created automatically when you add products.' },
  { icon: CpuChipIcon, title: 'AI-readable product pages', desc: 'llms.txt + markdown product pages. ChatGPT, Perplexity, and Google AI can read your catalog directly.' },
  { icon: ShoppingBagIcon, title: '5 shopping channels included', desc: 'Auto-synced feeds for Google, Facebook, Bing, Pinterest, and TikTok. No app subscriptions.' },
  { icon: ShieldCheckIcon, title: 'Direct payment to your bank', desc: 'Connect Stripe, Amazon Pay, or Authorize.net. Money goes straight to you. We never touch it.' },
  { icon: ChartBarIcon, title: 'Privacy-safe analytics + ad attribution', desc: 'UTM, geo, and conversion funnel tracking. First-party only. No Google Analytics, no third-party cookies. Native CSV upload to Google Ads and others.' },
  { icon: TagIcon, title: 'Time-based deals', desc: 'Schedule sales with start and end dates. Built in, no app required.' },
  { icon: DevicePhoneMobileIcon, title: 'PWA installable app', desc: 'Customers can install your store as a mobile app from any browser. No App Store fees.' },
  { icon: PhotoIcon, title: 'Image CDN included', desc: 'Product images delivered globally with year-long cache. No third-party CDN needed.' },
  { icon: ChatBubbleLeftRightIcon, title: 'Verified product reviews', desc: 'BusinessCart emails a review request only after delivery and publishes the buyer\'s reply on the product page. No public form, so no fabricated reviews.' },
  { icon: CommandLineIcon, title: 'Full REST API access', desc: 'Every operation has a REST endpoint. Integrate or extend with your existing tooling.' },
];

const betaFeatures = [
  { title: 'Bulk product import via CSV', desc: 'CSV import in active development. Manual upload via web portal works today.' },
  { title: 'Public review submission form', desc: 'Reviews are entered from a verified buyer\'s emailed reply today. A public submission form on the storefront is in development.' },
  { title: 'Android customer mobile app', desc: 'Login, catalog, cart, checkout, and order history shipped. Payment UI in progress.' },
];

const roadmap = [
  { quarter: 'q3' as const, feature: 'Loyalty program', why: 'Reward repeat customers, lift LTV' },
  { quarter: 'q3' as const, feature: 'Subscription / recurring orders', why: 'Predictable revenue from subscribe-and-save' },
  { quarter: 'q3' as const, feature: 'BOGO + coupon engine', why: 'Flash sales, percentage codes, free shipping' },
  { quarter: 'q4' as const, feature: 'Push notifications', why: 'Bring customers back without paying for ads' },
  { quarter: 'q4' as const, feature: 'iOS customer app', why: 'Native iPhone and iPad shopping' },
  { quarter: 'q4' as const, feature: 'Multi-language storefronts', why: 'Sell internationally in your customer\'s language' },
  { quarter: 'q4' as const, feature: 'Multi-currency checkout', why: 'Charge in local currency at checkout' },
];

const faqs = [
  {
    q: 'How is this $0/month? What\'s the catch?',
    a: 'No monthly fee at any volume, every feature included at every volume, no feature locks. Pricing is per order and gets cheaper as you grow: 6% on your first 100 orders each month, 2% on orders 101 to 1,000, and 1% on order 1,001 onwards, every order capped at $5 no matter its size. 30-day money-back guarantee.',
  },
  {
    q: 'Can I migrate from Shopify, Etsy, Magento, or WooCommerce?',
    a: 'Yes. Any platform that offers an API or data export of products, customers, or orders can be migrated. We offer migration support to handle the mapping and import for you.',
  },
  {
    q: 'Will my SEO survive the move?',
    a: 'Yes, and usually improves. Static HTML, auto-generated schema.org, sitemap, and llms.txt typically lift rankings within 60-90 days. Sub-second load is a Core Web Vitals win.',
  },
  {
    q: 'Can I use my own domain?',
    a: 'Yes, included from day one. See usetgo.com for a live example.',
  },
  {
    q: 'What if I need a feature you don\'t have?',
    a: 'We ship every quarter (see "Coming in 2026" above for the roadmap). Send us a request and we will evaluate it for the next release. Enterprise customers can also access the REST API directly to integrate or extend any operation.',
  },
  {
    q: 'Can I leave if I don\'t like it?',
    a: 'Anytime. Products, customers, orders, and images are all exportable as CSV. No contract, no monthly fees. Leaving costs nothing.',
  },
];

const SolutionsD2CBrands: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · D2C Brands</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Sell Direct. Own Everything.{' '}
                <span className="text-teal-400">Pay $0 to Start.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                A branded online store with sub-second pages, AI-readable products, and 5 built-in shopping channels. No monthly fees, plugin sprawl, or marketplace commissions.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                No monthly fees · No setup costs · No credit card to start · 6% per order, that's it
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link
                  to="/contact-us"
                  className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800 md:py-4 md:text-lg md:px-10"
                >
                  Start Free
                </Link>
                <a
                  href="https://www.usetgo.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-8 py-3 border border-gray-200 text-base font-medium rounded-md text-gray-200 hover:text-white hover:border-white md:py-4 md:text-lg md:px-10"
                >
                  See a Live Store
                  <ArrowTopRightOnSquareIcon className="ml-2 h-5 w-5" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* The Pain */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">Selling Online Costs More Than It Should</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Marketplaces take 15-30%</h3>
                <p className="mt-3 text-gray-600">
                  Etsy: 6.5% + listing fees. Amazon: 8-15%. eBay: 13.25%. DoorDash: up to 30%. Every order means losing a chunk to a platform that owns your customer relationship.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Shopify + apps = $300-500/month</h3>
                <p className="mt-3 text-gray-600">
                  $39/mo Shopify Basic before your first sale. Add Klaviyo ($35), Judge.me ($15), ReCharge ($99), Loox ($10), Gorgias ($50), a paid theme ($180+), and you're at $400/month before any traffic.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Slow stores are invisible to AI</h3>
                <p className="mt-3 text-gray-600">
                  Average Shopify store loads in 2-4 seconds. Worse: Shopify themes render with JavaScript, unreadable to ChatGPT, Perplexity, and Google AI Overviews. AI shopping is growing 165× faster than organic search.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Side by Side */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center">Side by Side</h2>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg shadow-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900"></th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-500">Shopify Basic + Apps</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Monthly fee', '$39+', '$0'],
                    ['Essential apps', '$100-500/mo (typical stack)', '$0, included'],
                    ['Page load', '2-4 seconds', '<1 second'],
                    ['AI/LLM-readable', 'No (JavaScript-rendered)', 'Yes (static HTML + llms.txt)'],
                    ['Shopping feeds (5 channels)', '$20+/mo per app', '$0, built-in'],
                    ['Schema.org SEO', 'Basic, requires apps', 'Auto-generated'],
                    ['Custom domain', 'Included', 'Included'],
                    ['Direct payment to your bank', 'Yes', 'Yes'],
                  ].map(([feat, shopify, bc]) => (
                    <tr key={feat}>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{feat}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{shopify}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-semibold">{bc}</td>
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
              <h2 className="text-3xl font-extrabold text-gray-900">Everything You'd Pay $400/Month For. $0 Here.</h2>
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
              One Operations Layer, No App Stack
            </h2>
            <p className="mt-6 text-lg text-gray-200">
              Other platforms force you to subscribe to dozens of apps for integrations, automation, and analytics. Tell BusinessCart which systems you run and we connect them. You add the credentials once in your portal, the mapping and the sync are handled for you, and it all runs decoupled from your commerce stack so heavy lifting never slows your storefront.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Integrations, connected for you</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  You provide the credentials in your portal and BusinessCart handles the field mapping and the sync. Tell us the system you run and we connect it.
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
                Built and working today, with known gaps. We tell you upfront so you can plan accordingly.
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
                Quarterly shipping cadence. Specific dates so you know exactly what to plan around.
              </p>
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

        {/* See it live — real customer storefront with screenshots */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">See a Real Store, Built on BusinessCart.ai</h2>
              <p className="mt-4 text-gray-600">
                <strong>uSetGo INC</strong>, a live D2C brand running on BusinessCart.ai with a custom domain, full catalog, sub-second load times, and AI-readable product pages.
              </p>
            </div>

            {/* 3-screenshot grid — all below-fold, lazy-loaded WebP, no LCP impact */}
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <a href="https://www.usetgo.com" target="_blank" rel="noopener noreferrer" className="block group">
                <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200 group-hover:shadow-xl transition-shadow">
                  <img
                    src="/screenshots/d2c/home.webp"
                    alt="uSetGo storefront homepage: Grip Life with Style hero, branded teal palette"
                    width="1200"
                    height="750"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    className="w-full h-auto"
                  />
                </div>
                <p className="mt-3 text-sm text-gray-600 text-center"><strong className="text-gray-900">Branded storefront</strong> · Custom domain, hero, navigation</p>
              </a>

              <a href="https://www.usetgo.com/products.html" target="_blank" rel="noopener noreferrer" className="block group">
                <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200 group-hover:shadow-xl transition-shadow">
                  <img
                    src="/screenshots/d2c/catalog.webp"
                    alt="uSetGo catalog: 28 products, category filters, sale badges"
                    width="1200"
                    height="750"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    className="w-full h-auto"
                  />
                </div>
                <p className="mt-3 text-sm text-gray-600 text-center"><strong className="text-gray-900">Full catalog</strong> · Categories, deals, product grid</p>
              </a>

              <a href="https://www.usetgo.com/products/silicon-baking-gloves-e13b09.html" target="_blank" rel="noopener noreferrer" className="block group">
                <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200 group-hover:shadow-xl transition-shadow">
                  <img
                    src="/screenshots/d2c/product.webp"
                    alt="uSetGo product detail: Silicon Baking Gloves with pricing, deal discount, attributes"
                    width="1200"
                    height="667"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    className="w-full h-auto"
                  />
                </div>
                <p className="mt-3 text-sm text-gray-600 text-center"><strong className="text-gray-900">Product page</strong> · Pricing, attributes, AI-readable HTML</p>
              </a>
            </div>

            <div className="mt-10 text-center">
              <a
                href="https://www.usetgo.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Visit www.usetgo.com
                <ArrowTopRightOnSquareIcon className="ml-2 h-5 w-5" />
              </a>
            </div>
          </div>
        </section>

        {/* Inside the Admin — real dashboard view, real data, no plugin sprawl */}
        <section className="py-16 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900">Inside the Admin Dashboard</h2>
              <p className="mt-4 text-gray-600">
                Real seller view, real data: products, orders, customers, revenue, low-stock, and your auto-applied pricing tier all in one place. No app store. No Klaviyo + ReCharge + Loox + Gorgias stack to wire together.
              </p>
            </div>

            {/* Admin screenshot, full-width — click to open full-size in new tab. Below-fold, lazy-loaded WebP, no LCP impact. */}
            <div className="mt-10">
              <a
                href="/screenshots/d2c/admin-top.webp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open pricing tier dashboard screenshot in new tab"
                className="block bg-gray-50 rounded-lg shadow-lg overflow-hidden border border-gray-200 hover:shadow-xl transition-shadow cursor-zoom-in"
              >
                <img
                  src="/screenshots/d2c/admin-top.webp"
                  alt="BusinessCart admin dashboard: Welcome header, pricing tier card showing Starter with progress to Growth and estimated $2.35 bill, four stat cards, revenue chart and low stock alerts"
                  width="1855"
                  height="950"
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  className="w-full h-auto"
                />
              </a>
              <p className="mt-3 text-sm text-gray-600 text-center">
                <strong className="text-gray-900">Everything in one view.</strong> Auto-applied pricing tier, revenue, orders, products, customers, low-stock alerts, analytics. No app store, no third-party tags, no extra dashboard logins. Click to zoom.
              </p>
              <p className="mt-2 text-sm text-center">
                <a
                  href="/screenshots/d2c/admin-bottom-full.webp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-700 hover:text-teal-800 underline font-medium"
                >
                  → Also see the analytics view (revenue chart, low-stock alerts, recent orders)
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">Live in Under 30 Minutes</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Sign up free', desc: 'No credit card. Set your brand colors and upload your logo.' },
                { step: '2', title: 'Add your products', desc: 'Upload images, set prices, write descriptions. Manual entry today, bulk CSV import in Q2 2026.' },
                { step: '3', title: 'Share your URL', desc: 'Your storefront is live on a custom domain with SEO and shopping feeds auto-generated.' },
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
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Ready to Own Your Store?</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0 to start · 6% per order · No surprise fees · No app stack · No marketplace commissions
            </p>
            <div className="mt-8 flex flex-col sm:flex-row sm:justify-center gap-3">
              <Link
                to="/contact-us"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Start Free
              </Link>
              <Link
                to="/contact-us"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 hover:text-gray-900 hover:border-gray-400"
              >
                Talk to Founder
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default SolutionsD2CBrands;
