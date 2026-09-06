// Stub browser globals so Navbar renders as logged-out state for crawlers
const noopStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, length: 0, key: () => null };
globalThis.localStorage = noopStorage as Storage;
globalThis.sessionStorage = noopStorage as Storage;

import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import React from 'react';
import LandingPage from './pages/LandingPage';
import Compare from './pages/Compare';
import Industries from './pages/Industries';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import SolutionsD2CBrands from './pages/SolutionsD2CBrands';
import SolutionsAICommerce from './pages/SolutionsAICommerce';
import SolutionsWholesale from './pages/SolutionsWholesale';
import SolutionsRestaurants from './pages/SolutionsRestaurants';
import SolutionsGrocery from './pages/SolutionsGrocery';
import SolutionsManufacturers from './pages/SolutionsManufacturers';
import SolutionsDistributors from './pages/SolutionsDistributors';
import SolutionsMarketplaceEscape from './pages/SolutionsMarketplaceEscape';
import About from './pages/About';
import Careers from './pages/Careers';
import ContactUs from './pages/ContactUs';
import FAQ, { sections as faqSections } from './pages/FAQ';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import ApiStatus from './pages/ApiStatus';
import blogPosts from './data/blogPosts';
import fs from 'fs';
import path from 'path';
import TurndownService from 'turndown';

// Turndown converts rendered HTML into clean markdown for AI crawlers.
// Output preserves headings, lists, code blocks, links, and converts tables
// to GFM pipe tables.
//
// Tables used to be kept as raw HTML on the grounds that LLMs parse both and
// turndown's default table handling is lossy. They do parse both, but the cost
// was measured on the comparison page: 79% of that file sat inside <table>
// blocks and 42% of every byte an LLM read was a repeated Tailwind class
// attribute. Tables are the format these pages most want cited, so handing over
// styling noise instead of data was the wrong trade. The rule below converts the
// simple case and falls back to raw HTML for anything a pipe table cannot
// express, so nothing is ever silently mangled.
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});
// GFM pipe tables. Falls back to the original HTML whenever the table uses
// anything a pipe table has no way to represent, because a silently mangled
// table is worse than a verbose one.
turndown.addRule('gfm-table', {
  filter: 'table',
  replacement: (_content, node) => {
    const el = node as unknown as Element;
    try {
      if (el.querySelector('table') || el.querySelector('[colspan], [rowspan]')) {
        return (el as HTMLElement).outerHTML;
      }
      const rows = Array.from(el.querySelectorAll('tr'));
      if (rows.length < 2) return (el as HTMLElement).outerHTML;

      // Pipes inside a cell would end the cell early, and any newline breaks the
      // row, so both are neutralised rather than left to corrupt the table.
      const cellText = (c: Element) =>
        (c.textContent || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
      const toRow = (cells: Element[]) => `| ${cells.map(cellText).join(' | ')} |`;

      const head = Array.from(rows[0].querySelectorAll('th, td'));
      if (!head.length) return (el as HTMLElement).outerHTML;
      const lines = [toRow(head), `| ${head.map(() => '---').join(' | ')} |`];
      for (const r of rows.slice(1)) {
        const cells = Array.from(r.querySelectorAll('th, td'));
        // A row with a different cell count would shift every column after it.
        if (cells.length === head.length) lines.push(toRow(cells));
        else if (cells.length) return (el as HTMLElement).outerHTML;
      }
      return `\n\n${lines.join('\n')}\n\n`;
    } catch {
      return (el as HTMLElement).outerHTML;
    }
  },
});
// Drop navbar / footer / nav elements from markdown output so LLMs get
// just the page content, not the site chrome.
turndown.remove(['nav', 'footer', 'script', 'style', 'noscript']);
// Wrap <pre> blocks without <code> children in fenced code blocks so LLMs
// can recognize them as literal code (JSON schemas, llms.txt examples, etc.).
turndown.addRule('bare-pre', {
  filter: (node) => node.nodeName === 'PRE' && (!node.firstChild || (node.firstChild as Element).nodeName !== 'CODE'),
  replacement: (content) => `\n\n\`\`\`\n${content.trim()}\n\`\`\`\n\n`,
});

function renderMarkdown(renderedHtml: string, title: string, canonicalUrl: string, description: string): string {
  const mainMatch = renderedHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const bodyHtml = mainMatch ? mainMatch[1] : renderedHtml;
  const md = turndown.turndown(bodyHtml);
  return `# ${title}\n\n> ${description}\n\nCanonical URL: <${canonicalUrl}>\n\n---\n\n${md.trim()}\n`;
}

const distDir = path.resolve(process.cwd(), 'dist');
let template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
const baseUrl = 'https://businesscart.ai';

// Inline critical CSS into the template to eliminate the render-blocking
// stylesheet request. The CSS bundle is small (~8 KiB) and inlining it removes
// one round-trip from LCP for first-time visitors.
const cssLinkMatch = template.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/);
if (cssLinkMatch) {
  const cssPath = cssLinkMatch[1].replace(/^\//, '');
  try {
    const cssContent = fs.readFileSync(path.join(distDir, cssPath), 'utf-8');
    template = template.replace(cssLinkMatch[0], `<style>${cssContent}</style>`);
    console.log(`Inlined critical CSS (${(cssContent.length / 1024).toFixed(1)} KiB)`);
  } catch (err) {
    console.warn('Could not inline CSS:', err);
  }
}

// Add modulepreload hints for shared chunks that every page loads (Navbar,
// Footer, heroicons, logo). The browser starts fetching these in parallel with
// the main bundle instead of waiting for it to parse and trigger the imports.
// Skip any chunk Vite has already injected as a modulepreload to avoid
// duplicates in the output HTML.
const sharedChunks: string[] = [];
const assetsDir = path.join(distDir, 'assets');
try {
  const files = fs.readdirSync(assetsDir);
  for (const f of files) {
    if (/^(Navbar|Footer|heroicons|logo)-[^.]+\.js$/.test(f)) {
      sharedChunks.push(`/assets/${f}`);
    }
  }
} catch (err) {
  console.warn('Could not enumerate asset chunks for preload:', err);
}

const existingPreloads = new Set<string>();
const preloadRegex = /<link rel="modulepreload"[^>]*href="([^"]+)"/g;
let preloadMatch;
while ((preloadMatch = preloadRegex.exec(template)) !== null) {
  existingPreloads.add(preloadMatch[1]);
}

const newPreloads = sharedChunks.filter((url) => !existingPreloads.has(url));
const preloadTags = newPreloads
  .map((url) => `<link rel="modulepreload" href="${url}">`)
  .join('');

if (preloadTags) {
  template = template.replace('</head>', `${preloadTags}</head>`);
  console.log(`Injected ${newPreloads.length} modulepreload hints (${sharedChunks.length - newPreloads.length} already present)`);
}

interface PageEntry {
  route: string;
  component: React.ReactElement;
  output: string;
  title?: string;
  description?: string;
  schema?: string;
}

const blogSchema = (post: typeof blogPosts[0]) => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: post.title,
  description: post.metaDescription,
  datePublished: post.date,
  author: { '@type': 'Organization', name: 'BusinessCart.ai' },
  publisher: { '@type': 'Organization', name: 'BusinessCart.ai', url: baseUrl },
  mainEntityOfPage: `${baseUrl}/blog/${post.slug}`,
});

// FAQPage structured data, generated from the page's own question list.
//
// Every question, flattened across sections: the schema describes the PAGE, and a
// consumer extracting Q&A pairs has no use for our section headings. Answers are
// plain strings already, which is what acceptedAnswer wants.
const faqSchema = () => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  name: 'Frequently Asked Questions',
  url: `${baseUrl}/faq`,
  mainEntity: faqSections.flatMap((section) =>
    section.questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    }))
  ),
});

const pages: PageEntry[] = [
  {
    route: '/',
    component: <LandingPage />,
    output: 'index.html',
    title: 'BusinessCart.ai — Your Online Store. Your B2B Portal. $0 to Start.',
    description: 'One platform for D2C brands, wholesalers, restaurants, grocers, and manufacturers. Sub-second pages, AI-readable. Free to start ($0/mo Starter + 6% capped at $5/order). Premium tiers for full B2B and AI integration.',
  },
  {
    route: '/compare',
    component: <Compare />,
    output: 'compare/index.html',
    title: 'BusinessCart.ai vs. The Competition',
    description: 'Compare BusinessCart.ai with Shopify, WooCommerce, and marketplaces. See pricing, features, and performance side by side.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'BusinessCart.ai vs. The Competition', url: `${baseUrl}/compare` }),
  },
  {
    route: '/industries',
    component: <Industries />,
    output: 'industries/index.html',
    title: 'Solutions for Every Business Type — BusinessCart.ai',
    description: 'D2C brands, AI commerce, wholesale, restaurants, grocery, manufacturers, distributors, marketplace escape — pick the solution page that fits your business.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Solutions', url: `${baseUrl}/industries` }),
  },
  {
    route: '/solutions/d2c-brands',
    component: <SolutionsD2CBrands />,
    output: 'solutions/d2c-brands/index.html',
    title: 'Online Store for D2C Brands — $0 to Start | BusinessCart.ai',
    description: 'Sell direct with a branded online store. Sub-second pages, AI-readable products, 5 shopping channels. Free Starter tier, no plugin sprawl, no marketplace commissions.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'D2C Brands Solution', url: `${baseUrl}/solutions/d2c-brands` }),
  },
  {
    route: '/solutions/ai-commerce',
    component: <SolutionsAICommerce />,
    output: 'solutions/ai-commerce/index.html',
    title: 'AI-Era Commerce — Get Cited by ChatGPT, Perplexity, Google AI | BusinessCart.ai',
    description: 'Static HTML, schema.org, llms.txt, and markdown product pages — your storefront becomes the source AI assistants quote when shoppers ask what to buy.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'AI-Era Commerce Solution', url: `${baseUrl}/solutions/ai-commerce` }),
  },
  {
    route: '/solutions/wholesale',
    component: <SolutionsWholesale />,
    output: 'solutions/wholesale/index.html',
    title: 'Wholesale & B2B Ordering Platform — $0 to Start | BusinessCart.ai',
    description: 'Per-customer pricing, credit limits, spend caps, and quote negotiation — enforced automatically. Stop running B2B in spreadsheets.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Wholesale & B2B Solution', url: `${baseUrl}/solutions/wholesale` }),
  },
  {
    route: '/solutions/restaurants',
    component: <SolutionsRestaurants />,
    output: 'solutions/restaurants/index.html',
    title: 'Direct Ordering for Catering, Meal-Prep & Bakeries | BusinessCart.ai',
    description: 'Code-gated regulars portal, pickup and scheduled delivery, free Starter tier, no DoorDash 30% commission. Built for food businesses DoorDash serves poorly.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Restaurants & Food Solution', url: `${baseUrl}/solutions/restaurants` }),
  },
  {
    route: '/solutions/grocery',
    component: <SolutionsGrocery />,
    output: 'solutions/grocery/index.html',
    title: 'Online Ordering for Independent Grocers — Without Instacart\'s Cut | BusinessCart.ai',
    description: 'Specialty, ethnic, organic, butcher, bakery, pet supply — your regulars order direct, you keep 94% of every sale (vs 70-85% on Instacart) and 100% of the customer relationship.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Grocery & Specialty Food Solution', url: `${baseUrl}/solutions/grocery` }),
  },
  {
    route: '/solutions/manufacturers',
    component: <SolutionsManufacturers />,
    output: 'solutions/manufacturers/index.html',
    title: 'Distributor Ordering Portal for Manufacturers | BusinessCart.ai',
    description: 'Per-distributor pricing, MOQ, lead times, and credit limits enforced automatically. Channel pricing stays private. Free Starter, premium B2B tiers, live in days.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Manufacturers Solution', url: `${baseUrl}/solutions/manufacturers` }),
  },
  {
    route: '/solutions/distributors',
    component: <SolutionsDistributors />,
    output: 'solutions/distributors/index.html',
    title: 'B2B Distribution Platform — Stop Running Orders Through Email | BusinessCart.ai',
    description: 'Per-customer tier pricing, multi-warehouse inventory, multi-supplier buyer accounts. A buying experience that beats Amazon Business.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Distributors Solution', url: `${baseUrl}/solutions/distributors` }),
  },
  {
    route: '/solutions/marketplace-escape',
    component: <SolutionsMarketplaceEscape />,
    output: 'solutions/marketplace-escape/index.html',
    title: 'Stop Paying 30% to Marketplaces — Own Your Customers | BusinessCart.ai',
    description: 'Etsy, Amazon, eBay, DoorDash, Instacart, Faire — all take 6-30% of every order. Build your direct store on a free Starter tier and keep 94% of every sale.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Marketplace Escape Solution', url: `${baseUrl}/solutions/marketplace-escape` }),
  },
  {
    route: '/about',
    component: <About />,
    output: 'about/index.html',
    title: 'About BusinessCart.ai — Your Commerce, Your Rules',
    description: 'BusinessCart.ai helps businesses sell directly with branded storefronts, private B2B portals, and a free Starter tier. US-based, remote-first team.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About BusinessCart.ai', url: `${baseUrl}/about` }),
  },
  {
    route: '/careers',
    component: <Careers />,
    output: 'careers/index.html',
    title: 'Careers at BusinessCart.ai — Remote-First, US-Based',
    description: 'Join a remote-first US-based team building the commerce platform that lets businesses own their store. Engineers, designers, and operators welcome.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Careers at BusinessCart.ai', url: `${baseUrl}/careers` }),
  },
  {
    route: '/contact-us',
    component: <ContactUs />,
    output: 'contact-us/index.html',
    title: 'Contact BusinessCart.ai — US-Based Support, All US Time Zones',
    description: 'Contact BusinessCart.ai — US-based remote-first team across all US time zones. No overseas call centers; talk directly to the platform team.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'ContactPage', name: 'Contact BusinessCart.ai', url: `${baseUrl}/contact-us` }),
  },
  {
    route: '/faq',
    component: <FAQ />,
    output: 'faq/index.html',
    title: 'Frequently Asked Questions — BusinessCart.ai',
    description: 'Answers on BusinessCart.ai pricing, B2B config, payment gateways, integrations, storefronts, and migration from Shopify, WooCommerce, marketplaces.',
    schema: faqSchema(),
  },
  {
    route: '/privacy-policy',
    component: <PrivacyPolicy />,
    output: 'privacy-policy/index.html',
    title: 'Privacy Policy — BusinessCart.ai',
    description: 'How BusinessCart.ai collects, uses, shares, and protects information from companies, customers, and storefront visitors. Updated March 2026.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Privacy Policy', url: `${baseUrl}/privacy-policy` }),
  },
  {
    route: '/terms-of-service',
    component: <TermsOfService />,
    output: 'terms-of-service/index.html',
    title: 'Terms of Service — BusinessCart.ai',
    description: 'Terms governing BusinessCart.ai platform use. Pricing, payments, accounts, data ownership, termination policies. Updated March 2026.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Terms of Service', url: `${baseUrl}/terms-of-service` }),
  },
  {
    route: '/system-status',
    component: <ApiStatus />,
    output: 'system-status/index.html',
    title: 'System Status — BusinessCart.ai',
    description: 'Current operational status of BusinessCart.ai: storefronts, catalog, checkout, payments, accounts, B2B configuration, and order management.',
    schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'System Status', url: `${baseUrl}/system-status` }),
  },
  {
    route: '/blog',
    component: <Blog />,
    output: 'blog/index.html',
    title: 'Blog — BusinessCart.ai',
    description: 'Insights on e-commerce, AI, and growing your business online.',
    schema: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'BusinessCart.ai Blog',
      description: 'Insights on e-commerce, AI, and growing your business online.',
      url: `${baseUrl}/blog`,
      publisher: { '@type': 'Organization', name: 'BusinessCart.ai', url: baseUrl },
    }),
  },
  ...blogPosts.map((post) => ({
    route: `/blog/${post.slug}`,
    component: <BlogPost slug={post.slug} />,
    output: `blog/${post.slug}/index.html`,
    title: `${post.title} — BusinessCart.ai`,
    description: post.metaDescription,
    schema: blogSchema(post),
  })),
];

for (const page of pages) {
  const html = renderToString(
    <StaticRouter location={page.route}>
      {page.component}
    </StaticRouter>
  );

  let rendered = template.replace(
    '<div id="root"></div>',
    `<div id="root">${html}</div>`
  );

  // Generate markdown output path: /path/to/page.md (sibling of index.html).
  // For root (/ → index.html), emit as /index.md.
  const mdOutput = page.output === 'index.html'
    ? 'index.md'
    : page.output.replace(/\/index\.html$/, '.md');
  const mdUrl = `${baseUrl}/${mdOutput}`;

  if (page.title) {
    rendered = rendered.replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`);

    let headInsert =
      `<meta name="description" content="${page.description}" />\n` +
      `<meta property="og:title" content="${page.title}" />\n` +
      `<meta property="og:description" content="${page.description}" />\n` +
      `<meta property="og:type" content="article" />\n` +
      `<meta property="og:url" content="${baseUrl}${page.route}" />\n` +
      `<link rel="canonical" href="${baseUrl}${page.route}" />\n` +
      `<link rel="alternate" type="text/markdown" href="${mdUrl}" />\n`;

    // Replace Product schema with Article schema for blog posts
    if (page.schema) {
      rendered = rendered.replace(
        /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        `<script type="application/ld+json">${page.schema}</script>`
      );
    }

    rendered = rendered.replace('</head>', headInsert + '</head>');
  }

  const outputPath = path.join(distDir, page.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
  console.log(`Pre-rendered ${page.route} → dist/${page.output}`);

  // Emit markdown companion for AI crawlers. Extracts the <main> content,
  // strips navbar/footer/scripts, converts to markdown. No runtime cost to
  // human visitors — .md is only fetched when a crawler requests it directly
  // or follows the <link rel="alternate"> hint.
  try {
    const mdContent = renderMarkdown(
      rendered,
      page.title || '',
      `${baseUrl}${page.route}`,
      page.description || '',
    );
    const mdOutputPath = path.join(distDir, mdOutput);
    fs.mkdirSync(path.dirname(mdOutputPath), { recursive: true });
    fs.writeFileSync(mdOutputPath, mdContent);
  } catch (err) {
    console.warn(`Failed to generate markdown for ${page.route}:`, err);
  }
}

// ----------------------------------------------------------------------------
// Post-render validation — fails the build if any page is missing its markdown
// companion file or the <link rel="alternate" type="text/markdown"> tag in HTML.
// This turns `npm run build` into the pre-commit gate for LLM-friendliness:
// if someone refactors the pipeline in a way that breaks markdown generation,
// the build fails loudly instead of shipping silently degraded output.
// ----------------------------------------------------------------------------
let validationErrors = 0;
for (const page of pages) {
  const htmlPath = path.join(distDir, page.output);
  const mdOutput = page.output === 'index.html'
    ? 'index.md'
    : page.output.replace(/\/index\.html$/, '.md');
  const mdPath = path.join(distDir, mdOutput);

  if (!fs.existsSync(mdPath)) {
    console.error(`❌ Missing markdown companion for ${page.route} — expected ${mdPath}`);
    validationErrors++;
    continue;
  }

  const mdSize = fs.statSync(mdPath).size;
  if (mdSize < 200) {
    console.error(`❌ Markdown suspiciously small for ${page.route} (${mdSize} bytes) — ${mdPath}`);
    validationErrors++;
  }

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const expectedAlt = `href="${baseUrl}/${mdOutput}"`;
  if (!html.includes('rel="alternate" type="text/markdown"')) {
    console.error(`❌ Missing <link rel="alternate" type="text/markdown"> in ${page.route}`);
    validationErrors++;
  } else if (!html.includes(expectedAlt)) {
    console.error(`❌ <link rel="alternate"> href mismatch for ${page.route} — expected to contain ${expectedAlt}`);
    validationErrors++;
  }
}

if (validationErrors > 0) {
  console.error(`\n❌ Build validation FAILED: ${validationErrors} error(s). Refusing to complete build.`);
  process.exit(1);
}
console.log(`✓ Validated ${pages.length} pages: every HTML has a markdown companion + alternate link`);

// Generate sitemap.xml
const sitemapEntries = pages.map((page) => {
  const priority = page.route === '/'
    ? '1.0'
    : page.route.startsWith('/solutions/')
      ? '0.9'
      : page.route === '/blog'
        ? '0.8'
        : '0.7';
  return `  <url>\n    <loc>${baseUrl}${page.route}</loc>\n    <priority>${priority}</priority>\n  </url>`;
});

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>`;

fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);
console.log('Generated sitemap.xml');

// Generate robots.txt
const robots = `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml

# AI/LLM context: ${baseUrl}/llms.txt
`;

fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);
console.log('Generated robots.txt');

// Generate llms.txt
const blogPostEntries = blogPosts.map((post) =>
  `- [${post.title}](${baseUrl}/blog/${post.slug})\n  ${post.metaDescription}`
).join('\n');

const llmsTxt = `# BusinessCart.ai

> Your Commerce, Your Rules.

BusinessCart.ai is a US-based e-commerce platform that gives businesses their own branded online store, private commerce portal, and B2B tools. **Every feature is included in every tier**, no feature locks. There is no monthly fee at any volume. Pricing is per order and gets cheaper as you grow: 6% on your first 100 orders each month, 2% on orders 101 to 1,000, and 1% on order 1,001 onwards, every order capped at $5 no matter its size. Each order is priced by its own position in the month, so growing never re-prices orders already placed. The platform serves businesses of any size, from local restaurants to national distributors.

## Company Information

- **Website:** ${baseUrl}
- **Email:** help@businesscart.ai
- **Phone:** +1 (657) 501-0200
- **Location:** United States (remote-first company)
- **Support:** US-based team, responds within one business day

---

## Pillar 1: Private Commerce (Portal)

The portal-based commerce system where companies create a private, code-gated shopping experience. Customers access the web portal or mobile app, enter a company code, and get their own branded catalog with cart, checkout, and order tracking.

### User Roles

- **admin** — Platform administrator. Creates company codes, manages the platform.
- **company** — Seller. Manages products, customers, orders, locations, payment gateways.
- **customer** — Buyer. Browses catalogs, places orders, manages addresses. Can associate with multiple companies.
- **b2c** — D2C storefront customer. Can checkout on a public storefront without portal registration.

### Company Registration & Access

- BusinessCart.ai provides a business code to the company after verification.
- Company registers with the code and gets a dashboard to manage everything.
- Company generates customer codes and distributes them to their buyers.
- Customer registers with a customer code and associates with that company.
- A single customer can associate with multiple companies and switch between them.
- Catalog is private — only associated customers can see a company's products.

### Product Catalog

- Companies manage their own product catalog.
- Each product has: name, description, price, category, images, stock quantity, deal pricing, and custom attributes.
- Product images served through a global CDN for fast loading.
- Company-level catalog isolation — each company has their own products.

### Cart & Checkout

- Standard shopping cart: add, update, remove items.
- Two-step checkout: cart → quote generation → payment → order confirmation.
- Supports both standard orders (direct checkout) and quote-based orders (negotiation flow).
- Taxes calculated automatically.
- Promotions and discounts applied at checkout.

### Payment Gateways

Companies connect their own payment processor. BusinessCart.ai never touches the money.

- **Stripe** — Redirect to Stripe Checkout hosted page.
- **Amazon Pay** — Button-based integration. Server signs payload, frontend renders Amazon Pay button.
- **Authorize.net** — Redirect to Accept Hosted payment page.
- **Offline methods** (no credentials needed):
  - Pickup & Pay — Customer pays at pickup location.
  - Deliver & Pay — Customer pays on delivery.
  - Purchase Order — B2B invoicing.

Payment gateway credentials are stored encrypted (AES-256-GCM). Payment sessions are tracked with automatic expiry.

### Locations

Companies can manage multiple physical locations:

- Warehouses, storefronts, pickup points.
- Each location has: name, address, operating hours, capacity.
- Customers select pickup or delivery location during checkout.
- Supports pickup, dropoff (company delivers), and shipping.

### Order Management

- Orders tracked from placement through fulfillment.
- Company dashboard shows pending orders and order history.
- Customer dashboard shows their order history across all associated companies.
- Order confirmation with full details sent after purchase.

### Web Portal & Mobile App

- Web portal at businesscart.ai for desktop and mobile browsers.
- Mobile app for iOS and Android.
- Both share the same API backend.
- Customers browse, order, and track deliveries from either interface.

---

## Pillar 2: B2B Commerce

The per-customer configuration layer that sits on top of Private Commerce. Every customer relationship can have unique rules enforced automatically at checkout.

### Per-Customer Configuration

Each company can set unique rules per customer:

- **Pricing** — Discount percentage applied automatically to every order.
- **Payment methods** — Which payment options the customer sees. Different customers can have different methods.
- **Delivery options** — Restrict per customer: shipping, pickup, dropoff. Each customer sees only their allowed options.
- **Order limits** — Minimum and maximum order amounts, quantity limits per product.
- **Spending caps** — Monthly and yearly spending limits per customer.
- **Credit limits** — Credit limit per customer relationship.

If a customer has no custom configuration for a setting, the company's default configuration applies automatically.

### Quote Negotiation (RFQ)

Full negotiation workflow for B2B orders:

1. Customer adds items to cart and submits for a quote.
2. System generates a quote with taxes, shipping, and promotions applied.
3. Company can counter-offer: adjust prices, add comments, apply discounts.
4. Customer can accept, reject, or counter.
5. On approval, the quote converts to an order.
6. Complete negotiation history is preserved on each quote.

### Multi-Company Customers

- A single buyer account can be associated with multiple suppliers.
- Each supplier relationship has independent configuration (pricing, payment methods, delivery options).
- Customer switches between companies from one login.
- Order history maintained per company relationship.

### API-First Platform

- Every operation available via REST API.
- The portal is one interface — companies can build their own, integrate with existing systems, or use the provided portal.

### Customer Groups & Custom Catalogs

- **Customer Groups** — Define B2B customer segments with uniform price discounts. Assign products to groups for visibility control — customers see only ungrouped products and products tagged with their group.
- **Custom Catalogs** — Assign specific products and categories to each customer group. Company-level catalog isolation built-in.

### Planned B2B Features

- **Multi-Language & Currency** (coming soon) — Support for multiple languages and currencies.

---

## Pillar 3: D2C Storefronts

Every company gets an auto-generated public storefront — a standalone website with their branding that anyone can visit and buy from without portal registration.

### How Storefronts Work

- Auto-generated when a company updates their profile, products, or branding.
- Pure static HTML — no JavaScript framework, no client-side rendering needed.
- Loads in under 1 second on any device.
- Served from a global CDN with 99.99% uptime.
- Custom domain support included at no extra cost (e.g., www.yourstore.com).
- Preview subdomain provided automatically (e.g., yourcompany.businesscart.ai).

### AI & LLM Readiness

- Product catalogs are in plain HTML — AI assistants can read them directly without executing JavaScript.
- Every product page has a corresponding markdown (.md) file for AI consumption.
- Every storefront includes an llms.txt file with structured store information and full product catalog.
- Every storefront includes a products.md file with the complete catalog in markdown format.
- Schema.org product markup is auto-generated for every product.

### SEO (Auto-Generated)

Every storefront automatically includes:

- sitemap.xml with all pages and priorities
- Meta tags (title, description) on every page
- OpenGraph tags for social sharing
- Schema.org markup for structured data
- Proper heading hierarchy and semantic HTML
- robots.txt with sitemap and llms.txt references

### Storefront Checkout

- Built-in shopping cart and checkout flow on the storefront itself.
- Customers can browse products and complete purchases without portal registration.
- Payment processed through the company's configured gateway.
- Order confirmation overlay with full details after purchase.

### What Each Storefront Includes

- Homepage with company branding, hero section, and featured products
- All products page with full catalog grid
- Category pages filtered by product category
- Individual product pages with images, pricing, description, attributes, and add-to-cart
- Markdown versions of all pages for AI assistants
- llms.txt with complete store and product information
- sitemap.xml, robots.txt
- Shopping cart (persists in browser)
- Customer login, registration, and order history
- Mobile-responsive design

### Multi-Channel Shopping Feeds

Companies can enable auto-generated product feeds for shopping channels. Feeds regenerate automatically when products are updated.

- **Google Shopping** — XML (RSS 2.0 with Google namespace)
- **Facebook / Instagram** — CSV (Meta Commerce Manager format)
- **Bing / Microsoft** — TSV (Microsoft Merchant Center format)
- **Pinterest** — CSV (Pinterest Catalog format)
- **TikTok Shop** — CSV (TikTok product catalog format)

Each feed uses unguessable URLs unique to the company. No apps, plugins, or extra cost — built into the platform.

---

## Pillar 4: AI-Powered Operations (Premium, Coming Soon)

Planned premium features for the Enterprise tier.

- **Integrations, connected for you** - You add the credentials for the systems you run and BusinessCart handles the field mapping and the sync.
- **Alerts, not dashboards** - BusinessCart watches its own integrations and order flow and alerts you if a sync fails. Nothing for you to build or monitor.
- **Systems stay in step** - When an order is placed, BusinessCart updates your connected systems automatically. No export, no re-keying.

---

## How the Pillars Connect

- **Pillar 1 (Private Commerce)** is the foundation — company registration, products, cart, checkout, payments.
- **Pillar 2 (B2B)** adds the per-customer configuration layer — pricing, payment methods, delivery, quotes.
- **Pillar 3 (D2C Storefronts)** is triggered by Pillar 1 — product and profile updates regenerate the storefront.
- **Pillar 4 (AI)** will integrate across all pillars — observability, integration, automated communication.

---

## Pricing

Three tiers — **every feature included in every tier**. Tier auto-applies based on your monthly order volume. No manual upgrades, no feature locks, no surprise bills. Your platform fee grows only when your business does.

- **Starter band**: your first 100 orders each month. **6% per order, capped at $5.**
- **Growth band**: orders 101 to 1,000 in the same month. **2% per order, capped at $5.** Orders already placed are never re-priced. 30-day money-back guarantee.
- **Enterprise band**: order 1,001 onwards in the same month. **1% per order, capped at $5.** Includes dedicated success manager + SLA. 30-day money-back guarantee.

All tiers include: branded storefront on custom domain, private B2B portal, per-customer pricing/credit/spend caps, quote negotiation, customer groups, custom catalogs, all payment options (Stripe, Amazon Pay, Authorize.net, PO, offline), shopping-channel feeds, AI discovery (schema.org, llms.txt, markdown), multiple pickup/warehouse locations, time-based deals, email notifications, built-in analytics and visitor tracking (no Google Analytics or third-party tags), full REST API, and end-to-end support (technical, migration, integration, onboarding).

Connecting the other systems you run is included on every tier at no extra cost. High-AOV B2B customers stay on Starter longer: the $5/order cap protects wholesale customers with few but large orders.

Math examples (Starter cap protects from runaway fees on large orders): $30 order = $1.80 to BusinessCart; $1,000 wholesale order = $5 to BusinessCart (cap), not $60.

---

## How to Get Started

1. Contact us at help@businesscart.ai with your company name and business email.
2. We verify your business and provide a business code.
3. Register your account with the business code.
4. Add your products — names, descriptions, prices, images, categories.
5. Connect your payment provider (Stripe, Amazon Pay, or Authorize.net).
6. Your storefront goes live automatically.

---

## Target Audiences

- **B2B:** Manufacturers, distributors, wholesalers who need per-customer pricing, payment terms, delivery configuration, and quote negotiation.
- **D2C:** Brands, restaurants, retail stores, grocery stores, and local businesses who want their own storefront without marketplace commissions.
- **Both:** Businesses that sell to other businesses AND directly to consumers from one platform.

---

## All Pages on This Website

### Main Pages
- **Homepage:** ${baseUrl}
- **Compare (vs Shopify, WooCommerce, Etsy, DoorDash, Amazon):** ${baseUrl}/compare
- **All Solutions (directory):** ${baseUrl}/industries
- **About Us:** ${baseUrl}/about
- **Contact Us:** ${baseUrl}/contact-us
- **FAQ:** ${baseUrl}/faq
- **System Status:** ${baseUrl}/system-status
- **Careers:** ${baseUrl}/careers
- **Privacy Policy:** ${baseUrl}/privacy-policy
- **Terms of Service:** ${baseUrl}/terms-of-service

### Solution Pages (Industry-Specific Landing Pages)
- **D2C Brands:** ${baseUrl}/solutions/d2c-brands — Branded online store with sub-second pages, AI-readable products, 5 shopping channels. For side hustlers, Etsy/Amazon escapees, Shopify defectors.
- **AI-Era Commerce:** ${baseUrl}/solutions/ai-commerce — Static HTML, schema.org, llms.txt, markdown product pages. For SEO-savvy merchants betting on AI discovery.
- **Wholesale & B2B:** ${baseUrl}/solutions/wholesale — Per-customer pricing, credit limits, spend caps, quote negotiation. For SMB wholesalers running orders via email.
- **Restaurants & Food:** ${baseUrl}/solutions/restaurants — Code-gated regulars portal, no DoorDash 30%. For catering, meal-prep, bakeries, food trucks, corporate lunch.
- **Grocery & Specialty Food:** ${baseUrl}/solutions/grocery — Online ordering for independent grocers without Instacart's cut. For specialty, ethnic, organic, butcher, bakery, pet supply.
- **Manufacturers:** ${baseUrl}/solutions/manufacturers — Distributor ordering portal. Per-distributor pricing, MOQ, lead times, credit limits enforced automatically.
- **Distributors:** ${baseUrl}/solutions/distributors — Per-customer tier pricing, multi-warehouse, multi-supplier buyer accounts. Beats Amazon Business buying experience.
- **Marketplace Escape:** ${baseUrl}/solutions/marketplace-escape — Stop paying 15-30% to Etsy, Amazon, eBay, DoorDash, Instacart, Faire. Build direct, keep 94%.

### Blog (${blogPosts.length} posts)
${blogPostEntries}

### Machine-Readable Resources
- **Sitemap:** ${baseUrl}/sitemap.xml
- **Robots:** ${baseUrl}/robots.txt
- **This File:** ${baseUrl}/llms.txt
`;

fs.writeFileSync(path.join(distDir, 'llms.txt'), llmsTxt);
console.log('Generated llms.txt');
