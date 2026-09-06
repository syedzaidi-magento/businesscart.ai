import React from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

interface PricingSectionProps {
  bgClass?: string;
  cardBgClass?: string;
}

const includedFeatures = [
  'Branded storefront on your custom domain (sub-second loads, AI-readable)',
  'Private B2B portal: gate access with customer codes',
  'Per-customer pricing, credit limits, spend caps & quote negotiation',
  'Customer groups & custom catalogs for B2B segments',
  'All payment options: Stripe, Amazon Pay, Authorize.net, PO, offline',
  'Shopping-channel feeds: Google, Meta, Bing, Pinterest, TikTok and more',
  'AI discovery built-in: schema.org, llms.txt, markdown product pages',
  'Multiple pickup and warehouse locations',
  'Time-based deals and automated email notifications',
  'Real-time dashboard with built-in analytics and visitor tracking: revenue, orders, low-stock, CSV export, no Google Analytics or third-party tags needed',
  'Full REST API for custom integrations, apps, and ERP sync',
  'End-to-end support: technical, migration, integration, and onboarding',
];

const PricingSection: React.FC<PricingSectionProps> = ({
  bgClass = 'bg-white',
  cardBgClass = 'bg-gray-50',
}) => {
  return (
<section className={`py-16 ${bgClass}`}>
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="text-center max-w-3xl mx-auto">
      <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
        Pricing That Scales With You. Every Feature, Every Tier.
      </h2>
      <p className="mt-6 inline-block bg-teal-50 border-l-4 border-teal-700 text-gray-800 text-base sm:text-lg px-6 py-4 rounded-r-md text-left font-medium">
        Your tier auto-applies based on monthly order volume.{" "}
        <strong className="text-teal-800">
          No manual upgrades, no feature locks, and tier changes only at month
          boundaries so you always see them coming.
        </strong>{" "}
        Your customers pay you directly through your own payment accounts.
        BusinessCart invoices you separately at month end. We never hold or
        deduct from your revenue.
      </p>
    </div>
 
    {/* What's included for everyone */}
    <div className="mt-10 max-w-5xl mx-auto bg-teal-50 border border-teal-200 rounded-lg p-6 sm:p-8">
      <h3 className="text-lg font-semibold text-teal-900 text-center">
        Included in every tier (Starter through Enterprise)
      </h3>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm text-gray-700">
        {includedFeatures.map((feat) => (
          <div key={feat} className="flex items-start">
            <CheckIcon className="h-5 w-5 text-teal-700 mt-0.5 flex-shrink-0" />
            <span className="ml-2">{feat}</span>
          </div>
        ))}
      </div>
    </div>
 
    {/* Tier cards */}
    <div className="mt-10 grid gap-6 md:grid-cols-3">
 
      {/* STARTER */}
      <div className={`${cardBgClass} rounded-lg shadow-lg p-8 text-center flex flex-col`}>
        <h3 className="text-2xl font-bold text-gray-900">Starter</h3>
        <p className="mt-2 text-xs font-semibold text-teal-700 uppercase tracking-wider">
          Up to 100 orders / month
        </p>
        <p className="mt-5 text-4xl font-extrabold text-teal-700">
          $0<span className="text-lg font-medium text-gray-500"> / mo</span>
        </p>
        <div className="mt-4 inline-flex items-center justify-center gap-2 bg-teal-50 border border-teal-200 rounded-md px-3 py-2">
          <span className="text-base font-semibold text-teal-800">
            Max $5 per order
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          $5 max per order, no matter the size · 6% only on orders under $83
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Invoiced monthly, never deducted from your sales
        </p>
        <p className="mt-auto pt-6 text-xs text-gray-500 flex items-start justify-center gap-1">
          <span className="text-teal-700 font-medium">→</span>
          Only your first 100 orders each month are priced here. Order 101
          onwards is cheaper, and nothing already placed is re-priced
        </p>
      </div>
 
      {/* GROWTH */}
      <div
        className={`${cardBgClass} rounded-lg shadow-lg p-8 text-center flex flex-col ring-2 ring-teal-700 relative`}
      >
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block bg-teal-700 text-white text-xs font-semibold px-3 py-1 rounded-full">
          30-day money-back
        </span>
        <h3 className="text-2xl font-bold text-gray-900">Growth</h3>
        <p className="mt-2 text-xs font-semibold text-teal-700 uppercase tracking-wider">
          101 to 1,000 orders / month
        </p>
        <p className="mt-5 text-4xl font-extrabold text-teal-700">
          $0<span className="text-lg font-medium text-gray-500"> / mo</span>
        </p>
        <span className="text-base font-semibold text-teal-800">Max $5 per order</span>
        <p className="mt-2 text-xs text-gray-500">
          2% per order on orders 101 to 1,000 · still never more than $5
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Invoiced monthly, never deducted from your sales
        </p>
        <div className="mt-auto pt-6 space-y-2 text-left">
          {[
            "Dedicated success manager",
            "SLA-backed uptime",
            "White-glove onboarding",
            "30-day money-back guarantee",
          ].map((item) => (
            <p key={item} className="text-xs text-gray-600 flex items-center gap-1.5">
              <CheckIcon className="h-3.5 w-3.5 text-teal-700 flex-shrink-0" />
              {item}
            </p>
          ))}
          <p className="text-xs text-gray-500 pt-2 flex items-start gap-1">
            <span className="text-teal-700 font-medium">→</span>
            Only orders 101 to 1,000 are priced here. Order 1,001 onwards is
            cheaper again
          </p>
        </div>
      </div>
 
      {/* ENTERPRISE */}
      <div className={`${cardBgClass} rounded-lg shadow-lg p-8 text-center flex flex-col`}>
        <h3 className="text-2xl font-bold text-gray-900">Enterprise</h3>
        <p className="mt-2 text-xs font-semibold text-teal-700 uppercase tracking-wider">
          1,001+ orders / month
        </p>
        <p className="mt-5 text-4xl font-extrabold text-teal-700">
          $0<span className="text-lg font-medium text-gray-500"> / mo</span>
        </p>
        <span className="text-base font-semibold text-teal-800">Max $5 per order</span>
        <p className="mt-2 text-xs text-gray-500">
          1% per order on order 1,001 onwards · still never more than $5
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Invoiced monthly, never deducted from your sales
        </p>
        <div className="mt-auto pt-6 space-y-2 text-left">
          {[
            "Dedicated success manager",
            "SLA-backed uptime",
            "White-glove onboarding",
            "30-day money-back guarantee",
          ].map((item) => (
            <p key={item} className="text-xs text-gray-600 flex items-center gap-1.5">
              <CheckIcon className="h-3.5 w-3.5 text-teal-700 flex-shrink-0" />
              {item}
            </p>
          ))}
          <p className="text-xs text-gray-500 pt-2 flex items-start gap-1">
            <span className="text-teal-700 font-medium">→</span>
            Moves here when you cross 1,000 orders/mo. Always at month
            boundaries, never mid-month
          </p>
        </div>
      </div>
 
    </div>
 
    {/* High-AOV note */}
    <p className="mt-8 text-center text-sm text-gray-600 max-w-3xl mx-auto">
      <strong className="text-gray-800">
        A $10,000 wholesale order costs $5 in platform fees.
      </strong>{" "}
      The cap is designed for B2B: high-value orders, low platform cost.
    </p>
 
    {/* Footer note */}
    <p className="mt-4 text-center text-sm text-gray-600 max-w-3xl mx-auto">
      Connecting the other systems you run is included on every tier at no extra cost.
      · 30-day money-back · No monthly fee at any volume · No setup costs · No
      long-term contracts ·{" "}
      <strong className="text-gray-800">
        No fee on purchase orders or offline payments. Ever.
      </strong>
    </p>
 
    {/* CTA */}
    <div className="mt-8 text-center">
      <Link
        to="/contact-us"
        className="inline-flex items-center justify-center px-8 py-4 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
      >
        Start Free
        <ArrowRightIcon className="ml-2 h-5 w-5" />
      </Link>
    </div>
 
  </div>
</section>
  );
};

export default PricingSection;
