import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  BanknotesIcon,
  BoltIcon,
  CakeIcon,
  ClipboardDocumentListIcon,
  CurrencyDollarIcon,
  DevicePhoneMobileIcon,
  GlobeAltIcon,
  LockClosedIcon,
  MapPinIcon,
  PhotoIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagIcon,
  UserGroupIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

const Badge: React.FC<{ kind: 'live' | 'beta' | 'q2' | 'q3' | 'q4' | 'y2027' }> = ({ kind }) => {
  const config = {
    live: { label: 'LIVE', cls: 'bg-green-100 text-green-800 ring-green-200' },
    beta: { label: 'BETA', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
    q2: { label: 'Q2 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
    q3: { label: 'Q3 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
    q4: { label: 'Q4 2026', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
    y2027: { label: '2027+', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
  }[kind];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset ${config.cls}`}>
      {config.label}
    </span>
  );
};

const liveFeatures = [
  { icon: CurrencyDollarIcon, title: '$0/month, 6% per order', desc: 'No subscription. No setup fees. Pay only when an order comes in.' },
  { icon: LockClosedIcon, title: 'Code-gated regulars portal', desc: 'Your menu lives behind a private code you share with regulars and corporate accounts. No competitors next to you.' },
  { icon: BanknotesIcon, title: 'Cash on pickup + cash on delivery', desc: 'Accept Stripe, Amazon Pay, Authorize.net, or cash. You decide which method per customer.' },
  { icon: MapPinIcon, title: 'Multiple locations', desc: 'Manage multiple kitchens, food trucks, or pickup points, each with hours, capacity, and contact details.' },
  { icon: ClipboardDocumentListIcon, title: 'Catering quote workflow', desc: 'Customer requests a catering order. You quote, comment, counter. They approve. Full negotiation history preserved.' },
  { icon: UserGroupIcon, title: 'Per-customer pricing', desc: 'Corporate accounts get their negotiated discount automatically. Repeat customers pay their preferred rate. No promo codes needed.' },
  { icon: BoltIcon, title: 'Sub-1-second menu pages', desc: 'Static HTML on a global CDN. Your menu loads instantly on any device, any connection.' },
  { icon: TagIcon, title: 'Time-based deals', desc: 'Schedule daily specials, happy hour pricing, or weekend promotions with start and end dates. Built in.' },
  { icon: DevicePhoneMobileIcon, title: 'PWA installable customer app', desc: 'Customers install your menu as a mobile app from any browser. No App Store fees.' },
  { icon: ShieldCheckIcon, title: 'You own customer data', desc: 'Every customer\'s email, phone, and order history is yours, not sold to a delivery app, not used to upsell competitors.' },
  { icon: GlobeAltIcon, title: 'Custom domain', desc: 'Your menu lives on yourrestaurant.com, not a DoorDash subpage.' },
  { icon: PhotoIcon, title: 'Image CDN included', desc: 'High-quality menu photos delivered globally with year-long cache. No third-party CDN bill.' },
];

const betaFeatures = [
  { title: 'Delivery zone (radius geofencing)', desc: 'Set a delivery radius per location today. Automatic order rejection outside the zone is in active development.' },
  { title: 'Operating-hours enforcement', desc: 'Operating hours stored per location today. Automatic blocking of orders placed outside hours is in active development.' },
];

const roadmap = [
  { quarter: 'q3' as const, feature: 'Tipping flow', why: 'Add tips at checkout, distribute to staff' },
  { quarter: 'q3' as const, feature: 'Real-time order status', why: 'Customers see "received → preparing → ready" updates' },
  { quarter: 'q3' as const, feature: 'Recurring catering orders', why: 'Standing weekly orders for offices, schools, regular events' },
  { quarter: 'q4' as const, feature: 'Menu modifiers (no onions, allergens)', why: 'Custom item configuration at checkout' },
  { quarter: 'q4' as const, feature: 'Time-based menus (breakfast vs lunch)', why: 'Show the right menu items at the right time of day' },
  { quarter: 'q4' as const, feature: 'POS integration (Toast first, others to follow)', why: 'Sync orders to your existing POS. Toast prioritized as the largest restaurant POS' },
  { quarter: 'y2027' as const, feature: 'Driver dispatch + tracking', why: 'Major undertaking, likely via integration with established dispatch service rather than building from scratch' },
];

const faqs = [
  {
    q: 'Is this a DoorDash alternative?',
    a: 'No, and that is a feature. DoorDash is built for impulse delivery from full-service restaurants with kitchens and drivers. We are built for the food businesses DoorDash serves poorly: catering, meal-prep, bakeries, food trucks, corporate lunch, and businesses with regulars. Different model, different math, different customer.',
  },
  {
    q: 'Who is this best for?',
    a: 'Catering services, meal-prep companies, bakeries, food trucks, coffee shops with regulars, private chefs, specialty food shops, corporate lunch programs, and any food business where customers know you and want to order pickup or scheduled delivery without paying a 30% middleman tax.',
  },
  {
    q: 'How do customers find my menu?',
    a: 'You share your custom domain (yourshop.com) or your customer code with regulars, corporate accounts, and email lists. Your menu is private (code-gated), so it stays focused on the customers you want, not random delivery-app shoppers.',
  },
  {
    q: 'Can I take cash on pickup or cash on delivery?',
    a: 'Yes. Cash payment methods are built in alongside Stripe, Amazon Pay, and Authorize.net. You configure which methods are available per customer or per location.',
  },
  {
    q: 'Do you do delivery?',
    a: 'Pickup, scheduled delivery, and shipping: yes, all today. Real-time driver dispatch and live tracking is on the Q4 2026 roadmap. If you need same-day driver dispatch today (like DoorDash), we are not the right fit yet.',
  },
  {
    q: 'What about POS integration (Toast, Square, Clover)?',
    a: 'Native POS connectors are on the Q3 2026 roadmap. Today, tell us which POS you run and we connect it for you at no extra cost. The REST API is also available for direct integration.',
  },
];

const SolutionsRestaurants: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · Restaurants &amp; Food</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Direct Ordering for Food Businesses{' '}
                <span className="text-teal-400">DoorDash Ignores.</span>
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                Catering, meal-prep, bakeries, food trucks, and corporate lunch. Code-gated regulars portal, pickup and scheduled delivery, $0 monthly fee, no 30% commission.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                Built for the slice DoorDash serves poorly · You own your customers · Cash, card, or PO accepted
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
              <h2 className="text-3xl font-extrabold text-gray-900">Your Best Customers Shouldn't Pay 30% to Order From You</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CurrencyDollarIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Delivery apps take 15-30% per order</h3>
                </div>
                <p className="text-gray-600">
                  On a $40 order, that's $6-12 going to DoorDash or UberEats. On 200 orders/month, you lose $1,200-$2,400. It's a tax on your existing customers, the ones who already know you.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <UserGroupIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">You don't own your customer relationship</h3>
                </div>
                <p className="text-gray-600">
                  DoorDash keeps the customer email, phone, and order history. They use it to upsell your competitors. You can't email a regular about a daily special. DoorDash will, on behalf of your competition.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-3">
                  <CakeIcon className="h-6 w-6 text-teal-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Generic platforms don't fit your business</h3>
                </div>
                <p className="text-gray-600">
                  DoorDash is built for impulse pizza orders. If you do catering, meal-prep, scheduled delivery, regulars-only ordering, or corporate accounts, the major delivery apps actively work against you.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Side by Side */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center">How We Compare</h2>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg shadow-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-900"></th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">DoorDash / UberEats</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-gray-500">ChowNow / Sauce</th>
                    <th className="text-left px-4 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Cost', '15-30% per order', '$49-499/mo', 'No monthly fee, 6%/2%/1% per order, $5 cap'],
                    ['You own customer data', 'No', 'Sometimes', 'Yes, fully'],
                    ['Code-gated regulars-only menu', 'No', 'Limited (paid tiers)', 'Yes, built-in'],
                    ['Catering quote workflow', 'No', 'Limited', 'Built-in'],
                    ['Cash on pickup / delivery', 'No', 'Limited', 'Yes'],
                    ['Per-customer corporate pricing', 'No', 'No', 'Yes'],
                    ['Custom domain', 'No', 'Sometimes', 'Yes'],
                    ['AI-readable menu (LLM discovery)', 'No', 'No', 'Yes'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900">{row[0]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[1]}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row[2]}</td>
                      <td className="px-4 py-4 text-sm text-gray-900 font-semibold">{row[3]}</td>
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
              <h2 className="text-3xl font-extrabold text-gray-900">Everything You Need to Take Direct Orders. $0 Here.</h2>
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
              Your POS and Accounting, Connected
            </h2>
            <p className="mt-6 text-lg text-gray-200">
              Tell BusinessCart which POS, accounting or kitchen-display system you run and we connect it. You add the credentials once in your portal, and the heavy work runs decoupled from your menu pages, so your storefront stays fast while the back office keeps itself in step.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Integrations, connected for you</h3>
                <p className="mt-2 text-gray-300 text-sm">
                  You provide the credentials in your portal and BusinessCart handles the field mapping and the sync, whether that is your POS, inventory or accounting. Tell us the system you run and we connect it.
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
                Specific dates so you know exactly what to plan around.
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

        {/* See it live */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">See a Live Storefront</h2>
            <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
              <strong>uSetGo INC</strong>, a live storefront built on BusinessCart.ai. Custom domain, sub-second menu pages, full catalog.
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
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900">Live in Under an Hour</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Add your menu', desc: 'Upload menu items with photos, prices, and categories. Set your hours and locations.' },
                { step: '2', title: 'Configure ordering', desc: 'Pick payment methods (cash, card, PO), delivery options (pickup, dropoff), and per-customer rules for corporate accounts.' },
                { step: '3', title: 'Share your code or domain', desc: 'Send your customer code to regulars and corporate clients. Or share your custom domain publicly. Orders start flowing.' },
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
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Stop Paying the Delivery-App Tax.</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0/month · 6% per order · You own your customers · Cash, card, or PO accepted
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

export default SolutionsRestaurants;
