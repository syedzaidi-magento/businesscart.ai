import React from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const TermsOfService: React.FC = () => {
  const sections = [
    { id: 'acceptance-of-terms', title: 'Acceptance of Terms' },
    { id: 'the-platform', title: 'The Platform' },
    { id: 'account-types', title: 'Account Types' },
    { id: 'company-responsibilities', title: 'Company Responsibilities' },
    { id: 'customer-responsibilities', title: 'Customer Responsibilities' },
    { id: 'pricing-and-fees', title: 'Pricing and Fees' },
    { id: 'payments', title: 'Payments' },
    { id: 'storefronts', title: 'Storefronts' },
    { id: 'data-and-ownership', title: 'Data and Ownership' },
    { id: 'prohibited-use', title: 'Prohibited Use' },
    { id: 'termination', title: 'Termination' },
    { id: 'limitation-of-liability', title: 'Limitation of Liability' },
    { id: 'changes-to-terms', title: 'Changes to Terms' },
    { id: 'contact', title: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow">
        <div className="bg-gray-800 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">Terms of Service</h1>
            <p className="mt-4 text-gray-200">Last updated: March 2026</p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white shadow-lg rounded-lg p-4 sm:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Sections</h2>
                <ul className="space-y-2">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="text-gray-600 hover:text-teal-800">{section.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="lg:col-span-3 space-y-12">
              <section id="acceptance-of-terms">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">1. Acceptance of Terms</h2>
                <p className="text-gray-600">
                  By creating an account on or using the BusinessCart.ai platform, you agree to be bound by these Terms of Service. These terms apply to all users of the platform, including companies (sellers), customers (buyers), and visitors to D2C storefronts. If you do not agree to these terms, do not use the platform.
                </p>
              </section>

              <section id="the-platform">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">2. The Platform</h2>
                <p className="text-gray-600 mb-4">
                  BusinessCart.ai is an e-commerce platform that allows businesses to create their own branded online store, manage a product catalog, configure per-customer B2B pricing, accept payments through their own payment provider, and process orders, all without monthly subscription fees.
                </p>
                <p className="text-gray-600">
                  The platform includes a web portal, mobile app, API, and auto-generated D2C storefronts. The service is provided on an "as is" and "as available" basis. We work to maintain high availability but cannot guarantee uninterrupted access at all times.
                </p>
              </section>

              <section id="account-types">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">3. Account Types</h2>
                <p className="text-gray-600 mb-4">The platform supports the following account types:</p>
                <ul className="list-disc list-inside space-y-2 text-gray-600">
                  <li><b>Company accounts:</b> Created with a business code provided by BusinessCart.ai. Companies manage their products, customers, locations, payment gateways, and orders.</li>
                  <li><b>Customer accounts:</b> Created with a customer code provided by a company. Customers can associate with one or more companies, browse private catalogs, and place orders.</li>
                  <li><b>Storefront visitors:</b> Anyone can visit a company's public D2C storefront and make a purchase without creating a portal account.</li>
                </ul>
                <p className="text-gray-600 mt-4">
                  You are responsible for maintaining the security of your account credentials. You are liable for all activity that occurs under your account.
                </p>
              </section>

              <section id="company-responsibilities">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">4. Company Responsibilities</h2>
                <p className="text-gray-600 mb-4">Companies using BusinessCart.ai agree to:</p>
                <ul className="list-disc list-inside space-y-2 text-gray-600">
                  <li>Provide accurate business information during onboarding.</li>
                  <li>Maintain accurate product descriptions, pricing, and inventory in their catalog.</li>
                  <li>Fulfill orders placed through the portal and D2C storefronts in a timely manner.</li>
                  <li>Provide customer support to their own buyers for order-related issues (shipping, returns, product questions).</li>
                  <li>Configure and maintain their own payment provider (Stripe, Amazon Pay, Authorize.net, or offline methods).</li>
                  <li>Comply with all applicable local, state, and federal laws regarding the sale of their products.</li>
                </ul>
                <p className="text-gray-600 mt-4">
                  BusinessCart.ai provides the technology platform. Companies are responsible for their products, their customers, and their fulfillment.
                </p>
              </section>

              <section id="customer-responsibilities">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">5. Customer Responsibilities</h2>
                <p className="text-gray-600 mb-4">Customers using BusinessCart.ai agree to:</p>
                <ul className="list-disc list-inside space-y-2 text-gray-600">
                  <li>Provide accurate personal and delivery information when placing orders.</li>
                  <li>Pay for products ordered through the platform.</li>
                  <li>Use the platform for lawful purchasing activity only.</li>
                </ul>
              </section>

              <section id="pricing-and-fees">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">6. Pricing and Fees</h2>
                <p className="text-gray-600 mb-4">BusinessCart.ai charges no monthly fee at any volume. Every feature is included at every volume and there are no feature locks. Pricing is per order, and the rate applied to an order depends on that order's position within the calendar month. A 30-day money-back guarantee applies to the per-order fees charged in your first 30 days.</p>
                <ul className="list-disc list-inside space-y-2 text-gray-600">
                  <li><b>Starter band:</b> your first 100 paid orders each calendar month are charged 6% per order, capped at $5. This band applies to the first 100 orders of every month regardless of your total monthly volume.</li>
                  <li><b>Growth band:</b> orders 101 to 1,000 in the same month are charged 2% per order, capped at $5. Orders already placed are never re-priced.</li>
                  <li><b>Enterprise band:</b> order 1,001 onwards in the same month is charged 1% per order, capped at $5. Includes dedicated success manager and SLA.</li>
                </ul>
                <p className="text-gray-600 mt-4">
                  Bands are applied within each UTC calendar month, counted by paid orders. Because bands are marginal, a lower rate takes effect on the very next order once the threshold is crossed, within the same month, and orders already placed are never re-priced. Connecting third-party systems you run is included on every tier at no additional platform fee. Any fees charged by those third-party providers for their own API access are your responsibility. Pricing is subject to change. We will notify existing customers before any changes take effect. All fees are in US Dollars. The 30-day money-back guarantee applies to the per-order fees charged during your first 30 days.
                </p>
              </section>

              <section id="payments">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">7. Payments</h2>
                <p className="text-gray-600 mb-4">
                  BusinessCart.ai does not process payments on behalf of companies or customers. Companies connect their own payment provider (Stripe, Amazon Pay, Authorize.net) and receive payments directly from their customers.
                </p>
                <p className="text-gray-600">
                  BusinessCart.ai is not responsible for payment disputes, chargebacks, refunds, or issues between companies and their payment providers. Companies are responsible for their own payment processing agreements and compliance.
                </p>
              </section>

              <section id="storefronts">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">8. Storefronts</h2>
                <p className="text-gray-600 mb-4">
                  BusinessCart.ai automatically generates a public D2C storefront for each company based on their product catalog and branding. Storefronts are hosted on our infrastructure and served through a global content delivery network.
                </p>
                <p className="text-gray-600 mb-4">
                  Storefronts are publicly accessible by design. Product information, company branding, and pricing displayed on storefronts are visible to anyone, including search engines and AI assistants.
                </p>
                <p className="text-gray-600">
                  Companies may use a custom domain for their storefront. BusinessCart.ai provides subdomain hosting (yourcompany.businesscart.ai) at no additional cost.
                </p>
              </section>

              <section id="data-and-ownership">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">9. Data and Ownership</h2>
                <p className="text-gray-600 mb-4">
                  Companies retain ownership of their data, including products, customer information, order history, and business configuration. BusinessCart.ai uses this data solely to provide and improve the platform.
                </p>
                <p className="text-gray-600 mb-4">
                  <b>Your-data-is-yours guarantee:</b> At any time, including after you stop using the platform, you may export your data through the following means:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 mb-4">
                  <li><b>Customer list:</b> One-click CSV download from the admin dashboard (<code className="text-sm">/accounts/export</code>).</li>
                  <li><b>Products, orders, quotes, and configuration:</b> Accessible via our REST API. Every operation has an endpoint; a technical user or consultant can extract every record programmatically.</li>
                  <li><b>Product images:</b> Stored on our CDN; URLs are embedded in the product records returned by the API. You may download all images directly from those URLs.</li>
                  <li><b>Shopping feeds:</b> Auto-generated CSV, XML, and TSV files for Google, Meta, Bing, Pinterest, and TikTok, available to download at any time.</li>
                </ul>
                <p className="text-gray-600 mb-4">
                  BusinessCart.ai will not hold your data hostage. There are no cancellation fees, no export fees, and no time limits on data access while your account remains active. If you choose to close your account, we will make a reasonable effort to provide a final data package in standard formats.
                </p>
                <p className="text-gray-600">
                  BusinessCart.ai does not sell company or customer data to third parties. See our <a href="/privacy-policy" className="text-teal-700 hover:underline">Privacy Policy</a> for full details on data handling.
                </p>
              </section>

              <section id="prohibited-use">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">10. Prohibited Use</h2>
                <p className="text-gray-600 mb-4">You may not use the platform to:</p>
                <ul className="list-disc list-inside space-y-2 text-gray-600">
                  <li>Sell illegal products or services.</li>
                  <li>Engage in fraud, deception, or misrepresentation.</li>
                  <li>Violate any applicable law or regulation.</li>
                  <li>Interfere with the operation of the platform or other users' accounts.</li>
                  <li>Attempt to access data or accounts that do not belong to you.</li>
                  <li>Use the platform for unsolicited communications or spam.</li>
                </ul>
              </section>

              <section id="termination">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">11. Termination</h2>
                <p className="text-gray-600 mb-4">
                  You may close your account at any time by contacting us. Companies can request deletion of their data upon account closure.
                </p>
                <p className="text-gray-600">
                  We may suspend or terminate your account if you violate these terms, engage in prohibited activity, or if your use of the platform creates a risk to other users or to our infrastructure. We will attempt to notify you before taking action, except in cases requiring immediate response.
                </p>
              </section>

              <section id="limitation-of-liability">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">12. Limitation of Liability</h2>
                <p className="text-gray-600 mb-4">
                  BusinessCart.ai provides a technology platform. We are not a party to transactions between companies and their customers. We are not responsible for the quality, safety, or legality of products sold through the platform, or for the accuracy of product listings.
                </p>
                <p className="text-gray-600">
                  To the maximum extent permitted by law, BusinessCart.ai and its team shall not be liable for any indirect, incidental, special, consequential, or punitive damages (including loss of profits, data, or business opportunity) arising from your use of the platform.
                </p>
              </section>

              <section id="changes-to-terms">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">13. Changes to Terms</h2>
                <p className="text-gray-600">
                  We may update these terms from time to time. If we make significant changes, we will notify you by email or through the platform. Continued use of the platform after changes take effect constitutes acceptance of the updated terms.
                </p>
              </section>

              <section id="contact">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">14. Contact</h2>
                <p className="text-gray-600">
                  Questions about these terms? Contact us at: <a href="mailto:help@businesscart.ai" className="text-teal-700 hover:underline">help@businesscart.ai</a>
                </p>
                <p className="text-gray-600 mt-2">
                  BusinessCart, Inc., United States
                </p>
              </section>
            </div>
          </div>
        </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TermsOfService;
