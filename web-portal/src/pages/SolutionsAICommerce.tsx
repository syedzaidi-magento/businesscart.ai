import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PricingSection from '../components/PricingSection';
import {
  BoltIcon,
  CpuChipIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  GlobeAltIcon,
  ChartBarIcon,
  MapIcon,
  ShoppingBagIcon,
  CommandLineIcon,
  SparklesIcon,
  ShareIcon,
  ChatBubbleLeftRightIcon,
  ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
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
  { icon: CodeBracketIcon, title: 'Static HTML storefronts', desc: 'No JavaScript rendering. AI crawlers read your products directly from the source.' },
  { icon: DocumentTextIcon, title: 'schema.org JSON-LD on every product', desc: 'Structured product data (price, availability, image, description, organization, offer): the format AI engines extract.' },
  { icon: CpuChipIcon, title: 'llms.txt for AI agents', desc: 'Plain-text store guide AI crawlers use to understand your catalog and navigation.' },
  { icon: DocumentTextIcon, title: 'Markdown product pages', desc: 'Every product available as a .md file, optimized for LLM ingestion and citation.' },
  { icon: ShareIcon, title: 'OpenGraph + meta tags', desc: 'Auto-generated for social sharing and AI summary cards.' },
  { icon: MapIcon, title: 'Auto-generated sitemap.xml + robots.txt', desc: 'Tells crawlers exactly what to index and how to reach it.' },
  { icon: ShoppingBagIcon, title: '5 shopping feeds, included', desc: 'Auto-synced feeds for Google, Facebook, Bing, Pinterest, and TikTok.' },
  { icon: BoltIcon, title: 'Sub-1-second page load', desc: 'Static HTML on CloudFront\'s 200+ edge locations. Core Web Vitals green by default.' },
  { icon: ChartBarIcon, title: 'Privacy-safe analytics', desc: 'UTM, geo, conversion funnel. Track which AI channels send traffic. First-party only, no third-party cookies.' },
  { icon: GlobeAltIcon, title: 'Custom domain', desc: 'Your brand owns the AI-citation surface, not a marketplace, not a subdomain.' },
  { icon: CommandLineIcon, title: 'Full REST API', desc: 'Sync to additional discovery channels as they emerge. Every operation has an endpoint.' },
  { icon: ChatBubbleLeftRightIcon, title: 'Verified product reviews', desc: 'BusinessCart emails a review request only after delivery and publishes the buyer\'s reply on the product page, so AI engines read real ratings. No public form, so no fabricated reviews.' },
  { icon: QuestionMarkCircleIcon, title: 'Product questions answered on the page', desc: 'Answer what buyers actually ask, on the product itself. Answers render as plain HTML with no JavaScript, land in that product\'s .md companion, and carry FAQPage schema, so an AI engine quotes your answer instead of inventing one.' },
  { icon: MagnifyingGlassIcon, title: 'Built for the AI shopping era', desc: 'The first storefront architecture designed from the ground up for AI-native discovery.' },
];

const betaFeatures = [
  { title: 'Bulk product import via CSV', desc: 'CSV export works today; bulk import is in active development. Critical for migrating large catalogs into AI-readable format fast.' },
  { title: 'Public review submission form', desc: 'Reviews are entered from a verified buyer\'s emailed reply today. A public submission form on the storefront is in development.' },
];

const roadmap = [
  { quarter: 'q4' as const, feature: 'Conversational search on storefront', why: 'Natural-language search on your store, powered by your own catalog' },
  { quarter: 'q4' as const, feature: 'Multi-language storefronts', why: 'Sell to international AI queries in their language' },
  { quarter: 'y2027' as const, feature: 'AI agent transaction support', why: 'Direct purchases from ChatGPT, Perplexity, and other agents. Gated on those platforms releasing public commerce APIs (timing outside our control)' },
];

const faqs = [
  {
    q: 'How do I know AI assistants are actually reading my store?',
    a: 'Test it directly. Once your store is live, ask ChatGPT, Perplexity, or Google AI Overviews about a product on your site. Because AI engines can parse your static HTML, schema.org markup, and llms.txt file, your products become eligible for citation, but citation is not deterministic, it depends on query, ranking, and model behavior. We also expose privacy-safe analytics so you can see referral traffic from AI channels as it grows.',
  },
  {
    q: 'What is llms.txt and why does it matter?',
    a: 'llms.txt is an emerging standard, like robots.txt for AI crawlers. It tells AI agents how your site is structured, what products you sell, and how to navigate. Most platforms do not support it. We auto-generate it for every storefront.',
  },
  {
    q: 'Does this work for ChatGPT, Perplexity, and Google AI Overviews?',
    a: 'Yes. All three (and Microsoft Copilot, Claude, and emerging agents) prefer clean static HTML with structured data. Our architecture optimizes for the formats they actually parse, not for the JavaScript-heavy patterns most platforms use.',
  },
  {
    q: 'Will my Shopify SEO transfer if I move?',
    a: 'Yes, and usually improves. Static HTML, auto-generated schema.org, sitemap, and llms.txt typically lift rankings within 60-90 days. Sub-second load is a Core Web Vitals win that compounds with AI-readability.',
  },
  {
    q: 'Can I track AI-driven traffic and sales?',
    a: 'Partially today, fully later. Our analytics track UTM parameters and referrers, so direct AI traffic is visible. Multi-touch attribution for AI shopping is still maturing across the industry. No platform has perfect AI attribution yet, but we expose what is trackable.',
  },
  {
    q: 'What if AI shopping does not take off?',
    a: 'Then you still get a sub-second-loading, SEO-optimized, custom-domain storefront with $0 monthly cost. AI-readability is additive. None of the work goes to waste. But the data: AI shopping is growing 165× faster than organic search. McKinsey projects $900B-$1T in US agentic commerce revenue by 2030. The bet has asymmetric upside.',
  },
];

const SolutionsAICommerce: React.FC = () => {
  return (
    <div className="bg-gray-50">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative bg-gray-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-wider uppercase text-teal-400">Solutions · AI-Era Commerce</p>
              <h1 className="mt-4 text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                Get Cited by{' '}
                <span className="text-teal-400">ChatGPT, Perplexity,</span>{' '}
                and Google AI.
              </h1>
              <p className="mt-6 text-lg text-gray-200 sm:text-xl">
                Your product catalog written in the format AI assistants actually read. Static HTML, schema.org structured data, llms.txt, and markdown product pages, so when shoppers ask an AI "what should I buy?", your brand is the answer.
              </p>
              <p className="mt-4 text-sm text-gray-300">
                AI shopping is growing 165× faster than organic search · Brands cited in AI Overviews get 35% more clicks
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
                  See an AI-Readable Store
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
              <h2 className="text-3xl font-extrabold text-gray-900">AI Shopping Is Here. Your Store Probably Isn't Ready.</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Shopify hides your products from AI. We make them readable.</h3>
                <p className="mt-3 text-gray-600">
                  Shopify themes render product pages with JavaScript. AI crawlers (ChatGPT, Perplexity, Claude, Google AI) prefer static HTML. Your products may be visually beautiful and still be invisible to the channels driving the next decade of shopping.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">AI shopping grows 165× faster than organic search</h3>
                <p className="mt-3 text-gray-600">
                  McKinsey projects $900B-$1T in US agentic commerce revenue by 2030. Today it's roughly 1% of traffic, but compounding fast. Brands cited in AI Overviews get 35% more clicks. Sites not optimized for AI lose share every quarter.
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900">Plugins don't fix the underlying problem</h3>
                <p className="mt-3 text-gray-600">
                  Schema markup apps ($15-50/mo). Speed optimization apps ($30/mo). LLM SEO consultants ($1000+/mo). None solve the underlying issue: your platform's architecture wasn't built for AI shoppers in the first place.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Side by Side */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center">What AI Crawlers Actually See</h2>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg shadow-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900"></th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-500">Shopify (typical theme)</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-teal-700">BusinessCart.ai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    ['Pre-rendered static HTML', 'No (JavaScript-heavy themes)', 'Yes, every page'],
                    ['llms.txt (AI agent guide)', 'Not supported', 'Auto-generated'],
                    ['Markdown product pages (.md)', 'Not supported', 'Auto-generated for every product'],
                    ['Page load (Core Web Vitals)', '2-4 seconds typical', '<1 second'],
                    ['Rich product schema.org JSON-LD', 'Basic theme defaults', 'Full schema (price, availability, image, offer, organization)'],
                    ['Shopping feeds (Google/FB/Bing/Pinterest/TikTok)', '$20+/mo per app', '$0, all 5 built-in'],
                    ['Custom domain', 'Included', 'Included'],
                    ['Cost', '$39+/mo before first sale', '$0/mo, $5 max per order'],
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
              <h2 className="text-3xl font-extrabold text-gray-900">The First Storefront Built for the AI Shopping Era</h2>
              <p className="mt-4 text-gray-600">All features below are <Badge kind="live" /> today on every BusinessCart.ai storefront.</p>
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
            <div className="mt-10 grid gap-6 md:grid-cols-1 max-w-2xl mx-auto">
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
                Specific dates so you know exactly what to plan around. AI-relevant items only. See other Solutions pages for the full roadmap.
              </p>
            </div>
            <div className="mt-10 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Feature</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Why it matters for AI commerce</th>
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
            <h2 className="text-3xl font-extrabold text-gray-900">See an AI-Readable Store in Action</h2>
            <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
              <strong>uSetGo INC</strong>, a live storefront built on BusinessCart.ai. View the page source: clean static HTML, schema.org markup, OpenGraph tags. Visit <code className="bg-gray-200 px-1 rounded">www.usetgo.com/llms.txt</code> to see what AI agents see when they visit.
            </p>
            <div className="mt-6 inline-flex items-center bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700">
              <ChatBubbleLeftRightIcon className="h-5 w-5 text-teal-700 mr-2" />
              <span>Try asking ChatGPT or Perplexity about products from <strong>usetgo.com</strong> to see what AI assistants find.</span>
            </div>
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
              <h2 className="text-3xl font-extrabold text-gray-900">AI-Ready in Under 30 Minutes</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                { step: '1', title: 'Sign up free', desc: 'No credit card. Set your brand colors and upload your logo.' },
                { step: '2', title: 'Add your products', desc: 'Auto-generates static HTML, schema.org markup, llms.txt, markdown product pages, sitemap, and 5 shopping feeds.' },
                { step: '3', title: 'Share your URL', desc: 'AI crawlers index automatically. Your products become available to ChatGPT, Perplexity, and Google AI.' },
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
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Be the Brand AI Assistants Recommend.</h2>
            <p className="mt-4 text-lg text-gray-600">
              $0 to start · 6% per order · AI-readable from day one · No plugins, no consultants
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

export default SolutionsAICommerce;
