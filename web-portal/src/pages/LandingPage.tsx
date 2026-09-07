import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  BoltIcon,
  CheckIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
  ShoppingBagIcon,
  CubeIcon,
  GlobeAltIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

const solutions = 
[
  { title: 'Wholesale & B2B', href: '/solutions/wholesale', icon: UserGroupIcon, audience: 'wholesalers running orders on email or spreadsheets', summary: 'Per-customer pricing, credit limits, spend caps, and quote negotiation, enforced automatically. Your buyers order without calling a rep.' },
  { title: 'Manufacturers & Distributors', href: '/solutions/manufacturers', icon: CubeIcon, audience: 'manufacturers selling to distributor networks', summary: 'Private distributor portals with per-distributor MOQ, lead times, and channel conflict prevention built in. No more PDF price lists.' },
  { title: 'D2C & Marketplace Exit', href: '/solutions/d2c-brands', icon: ShoppingBagIcon, audience: 'Brands ready to sell direct', summary: 'Your own branded storefront with sub-second pages and 5 shopping channels. Own your customer relationships and keep what you earn.' },
  { title: 'AI-Era Commerce', href: '/solutions/ai-commerce', icon: CpuChipIcon, audience: 'SEO-savvy merchants betting on AI discovery', summary: 'Static HTML, schema.org, llms.txt, markdown product pages, get cited by ChatGPT, Perplexity, Google AI.' },
 ];

const pillars = [
  {
    icon: GlobeAltIcon,
    title: 'Public Storefronts (D2C)',
    desc: 'Auto-generated branded site on your custom domain. Sub-second load, AI-readable, 5 shopping channels included. For selling to anyone who finds you.',
  },
  {
    icon: LockClosedIcon,
    title: 'Private Portals (B2B)',
    desc: 'Login-gated (private) catalog with per-customer pricing, credit limits, spend caps, and quote workflow, all enforced automatically. For selling to wholesale or repeat customers.',
  },
  {
    icon: SparklesIcon,
    title: 'One Operations Layer (Included)',
    desc: 'Replaces the 10-app integration, observability, and automation stack. You add credentials for the systems you run, BusinessCart handles the mapping and the sync, and alerts you if one breaks. Runs decoupled from your storefront, and costs nothing extra.',
  },
];

const whyUs = [
  { icon: CurrencyDollarIcon, title: 'Pricing Scales With You', desc: 'Every feature in every tier. No feature locks. Pay per order only. Your costs grow only when your orders do.' },
  { icon: BoltIcon, title: 'Sub-1-Second Pages', desc: 'Static HTML on a global CDN. Faster than any Shopify theme, by default. No apps, no plugins, no work.' },
  { icon: UserGroupIcon, title: 'Per-Customer B2B Power', desc: 'Per-customer pricing, credit limits, spend caps, tiered pricing, and quote negotiation, enforced automatically at every order. Group catalogs, one-click reorder, multiple warehouse locations, and time-based checkout windows included. No apps. No workarounds. Available on every tier.' },
  { icon: ShieldCheckIcon, title: 'You keep 100% of every transaction', desc: 'Connect your own Stripe, Amazon Pay, or Authorize.net. Your customers pay you directly. BusinessCart never touches the money. We send you one invoice at month end for your platform fee. No payment processing markup. No gateway surcharge. No surprise deductions.' },
];

const faqs = [
  {
    q: 'What is BusinessCart?',
    a: 'BusinessCart is a B2B and D2C commerce platform that lets wholesalers, manufacturers, and distributors run a private ordering portal with per-customer pricing, credit limits, spend caps, and quote negotiation, all enforced automatically. It starts at $0/month with a max $5 per order platform fee, invoiced monthly. Your customers pay you directly through your own payment accounts. BusinessCart never holds or deducts from your revenue.',
  },
  {
    q: 'What is BusinessCart an alternative to?',
    a: 'BusinessCart is an alternative to Shopify Plus ($2,300/month), Magento/Adobe Commerce (developer-heavy, $20,000+ implementation), BigCommerce B2B Edition ($1,000-3,000/month), OroCommerce (enterprise-only), and WooCommerce with B2B plugins (complex, fragile, maintenance-heavy). It includes native B2B features (per-customer pricing, credit limits, quote workflows, group catalogs, and time-based checkout windows) without the enterprise price tag or developer dependency. It also replaces email and spreadsheet-based ordering for SMB wholesalers and manufacturers who need a self-serve buyer portal at $0/month.',
  },
  {
    q: 'What does this actually cost me?',
    a: 'No monthly fee at any volume, and every feature is included at every volume; no manual upgrades, no feature locks. Pricing is per order and gets cheaper as you grow: 6% on your first 100 orders each month, 2% on orders 101 to 1,000, 1% on order 1,001 onwards. Every order is capped at $5 no matter its size, and we invoice you monthly rather than deducting from your sales. The operations layer that connects your other systems is included on every tier at no extra cost. 30-day money-back on Growth and Enterprise.',
  },
  {
    q: 'How is this different from Shopify?',
    a: 'Shopify is $39+/month before your first sale, plus $300-500/month in essential apps (Klaviyo, ReCharge, Judge.me, etc.), and its themes render with JavaScript, invisible to AI assistants. BusinessCart is $0/month, ships AI-readable static HTML, includes 5 shopping channels and a B2B portal built in. The whole app stack collapses into one platform. Shopify also charges a gateway surcharge if you use your own payment processor. BusinessCart never charges on payments. Your revenue lands in your account, and we send you a separate monthly invoice for platform use only.',
  },
  {
    q: 'Do I need a developer?',
    a: 'No. Sign up, add your products, share your URL or customer codes. Static HTML, SEO meta tags, schema.org, sitemap, robots.txt, and shopping feeds are all auto-generated when you save a product.',
  },
  {
    q: 'Can I migrate from Shopify, Etsy, or my existing tools?',
    a: 'Customer and product migration is straightforward. Export from your existing platform, import via our web portal or REST API. Most marketplaces don\'t share customer emails. Set up a launch page to start capturing them directly from day one.',
  },
  {
    q: 'Can I leave if I don\'t like it?',
    a: 'Anytime. Products, customers, orders, and images are all exportable as CSV. No contract, no monthly fees. Leaving costs nothing.',
  },
];

const LandingPage: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero — split: text left, live store proof right */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: hero text */}
              <div>
                <h1 className="text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                  Your wholesale orders are still running on email.{' '}
                  <span className="text-teal-400">There's a better way.</span>
                </h1>
                <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                  BusinessCart is a B2B wholesale ordering portal that starts at $0/month with a $5 max platform fee per order, no matter the size. Per-customer pricing, credit limits, and quote negotiation, enforced automatically at every order. Your buyers self-serve. You stop being the bottleneck. A branded D2C storefront is included on every plan.
                </p>
                <p className="mt-4 text-sm text-gray-300">
                  $0/month · $5 max per order, no matter the size · A $10,000 wholesale order costs $5 in fees · We invoice you, never touch your revenue
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <Link
                    to="/contact-us"
                    className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800 md:py-4 md:text-lg md:px-10"
                  >
                    Start Free
                  </Link>
                  <a
                    href="#solutions"
                    className="inline-flex items-center justify-center px-8 py-3 border border-gray-200 text-base font-medium rounded-md text-gray-200 hover:text-white hover:border-white md:py-4 md:text-lg md:px-10"
                  >
                    Find Your Solution
                    <ArrowRightIcon className="ml-2 h-5 w-5" />
                  </a>
                </div>
              </div>

              {/* Right: live store proof card */}
              <div>
                <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
                  {/* Browser bar mock */}
                  <div className="bg-gray-100 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="h-3 w-3 rounded-full bg-red-400" />
                      <div className="h-3 w-3 rounded-full bg-yellow-400" />
                      <div className="h-3 w-3 rounded-full bg-green-400" />
                    </div>
                    <div className="ml-3 flex-1 bg-white rounded px-3 py-1 text-xs text-gray-600 font-mono truncate">
                      🔒 www.usetgo.com
                    </div>
                  </div>
                  {/* Proof body */}
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        LIVE NOW
                      </span>
                      <span className="text-xs text-gray-500">Built on BusinessCart.ai</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">uSetGo INC</p>
                    <p className="mt-1 text-sm text-gray-600">A live D2C storefront powered by BusinessCart.ai: custom domain, full catalog, sub-second pages.</p>

                    <ul className="mt-5 space-y-2.5">
                      {[
                        'Sub-1-second page load',
                        'AI-readable (llms.txt + schema.org)',
                        'Custom domain included',
                        'Auto-generated SEO + sitemap',
                      ].map((item) => (
                        <li key={item} className="flex items-start text-sm text-gray-700">
                          <CheckIcon className="h-4 w-4 text-teal-700 mt-0.5 flex-shrink-0" />
                          <span className="ml-2">{item}</span>
                        </li>
                      ))}
                    </ul>

                    <a
                      href="https://www.usetgo.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
                    >
                      Visit www.usetgo.com
                      <ArrowTopRightOnSquareIcon className="ml-2 h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Solutions Grid — segmentation moment */}
        <section id="solutions" className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Find Your Solution</h2>
              <p className="mt-4 text-lg text-gray-600">
                Who is BusinessCart for?
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {solutions.map((s) => (
                <Link
                  key={s.title}
                  to={s.href}
                  className="bg-gray-50 rounded-lg p-6 hover:bg-white hover:shadow-md transition-all border border-gray-200 group flex flex-col"
                >
                  <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mb-4">
                    <s.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-teal-700 flex items-center">
                    {s.title}
                    <ArrowRightIcon className="ml-1.5 h-4 w-4 text-teal-700 transition-transform group-hover:translate-x-1" />
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 flex-grow">{s.summary}</p>
                  <p className="mt-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">For: {s.audience}</p>
                </Link>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-gray-600">
              Also built for restaurants, grocers, and specialty retailers. → See all solutions
            </p>
          </div>
        </section>

        {/* What Is This — 3-pillar architecture */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">How BusinessCart Works</h2>
              <p className="mt-4 text-lg text-gray-600">
                One platform, three distinct capabilities. Use any combination, or all three.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {pillars.map((p) => (
                <div key={p.title} className="bg-white rounded-lg p-8 shadow-sm">
                  <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mb-4">
                    <p.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{p.title}</h3>
                  <p className="mt-3 text-gray-600">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Us — 6 universal benefits */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Why businesses switch to BusinessCart</h2>
              <p className="mt-4 text-lg text-gray-600">
                Four things that hold true regardless of what you sell or who you sell to.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              {whyUs.map((w) => (
                <div key={w.title} className="flex flex-col">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center justify-center h-10 w-10 rounded-md bg-teal-700 text-white flex-shrink-0">
                      <w.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">{w.title}</h3>
                  </div>
                  <p className="mt-2 text-gray-600">{w.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works — 4 steps */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Up and running in days, not months</h2>
              <p className="mt-4 text-lg text-gray-600">
                From migration audit to your first order, we handle the heavy lifting.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {[
                { step: '1', title: 'Free migration audit', desc: 'We review your current setup together: your product list, customer terms, pricing structure, and any edge cases. You learn exactly what moves over and how, before committing to anything.' },
                { step: '2', title: 'Map your customers and pricing', desc: 'Share your spreadsheet, QuickBooks export, or Shopify data with us. We map every customer\'s discount, credit limit, payment method, and order rules one-to-one. You review and approve.' },
                { step: '3', title: 'Share customer codes', desc: 'Each buyer gets a private code that unlocks your catalog with their exact pricing already applied. No training required on their end.' },
                { step: '4', title: 'Run both in parallel until you\'re confident', desc: 'Keep your old system running while your buyers place their first orders on BusinessCart. Switch fully when you\'re ready. No forced cutover, no downtime.' }
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="flex items-center justify-center h-16 w-16 rounded-full bg-teal-700 text-white text-2xl font-bold mx-auto">
                    {s.step}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing - Auto-Scaling, Every Feature in Every Tier (shared component) */}
        <PricingSection bgClass="bg-white" cardBgClass="bg-gray-50" />

        {/* FAQ */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center sm:text-4xl">Frequently Asked Questions</h2>
            <div className="mt-10 space-y-6">
              {faqs.map((f) => (
                <div key={f.q} className="bg-white rounded-lg p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">{f.q}</h3>
                  <p className="mt-3 text-gray-600">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-white">
          <div className="max-w-4xl mx-auto text-center py-16 px-4 sm:py-20 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Ready to get your buyers off email?</h2>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-teal-100 text-teal-800">Your buyers self-serve</span>
              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-teal-100 text-teal-800">Your orders enforce themselves</span>
              <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-teal-100 text-teal-800">You focus on the business</span>
            </div>
            <p className="mt-6 text-lg text-gray-600">
              $0 to start · Max $5 per order · No surprise fees · No app stack · No marketplace commissions
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

export default LandingPage;
