import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { ShieldCheckIcon, BoltIcon, CurrencyDollarIcon, HeartIcon, GlobeAltIcon, UserGroupIcon } from '@heroicons/react/24/outline';

const About: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow">

        {/* Hero */}
        <div className="bg-gray-800 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">Your Commerce, Your Rules.</h1>
            <p className="mt-4 text-lg text-gray-200 max-w-2xl mx-auto">
              We help businesses sell directly to their customers, with their own branded store, their own payment processing, and a free tier to get started.
            </p>
          </div>
        </div>

        {/* Our Story */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Why We Built BusinessCart.ai</h2>
          <div className="space-y-4 text-gray-600 text-lg leading-relaxed">
            <p>
              Too many businesses are stuck choosing between marketplace reach and owning their commerce. Manufacturers pay 15-30% commissions to platforms that keep their customer data. Distributors manage per-customer pricing in spreadsheets. Local brands lose their identity inside generic storefronts.
            </p>
            <p>
              BusinessCart.ai was built to solve that. We give every business its own branded storefront and private commerce portal, with per-customer B2B configuration, direct payment collection, and automatic SEO. No marketplace commissions. No monthly subscriptions. Businesses across restaurants, retail, grocery, and wholesale already use the platform to sell on their own terms.
            </p>
          </div>
        </div>

        {/* How We're Different */}
        <div className="bg-white py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">How We Work With You</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <CurrencyDollarIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">Pricing That Scales With You</h3>
                <p className="mt-2 text-gray-500">Every feature in every tier. No feature locks. No monthly fee at any volume, and every order is capped at $5 no matter its size. The per-order rate falls as your monthly order volume grows. 30-day money-back on paid tiers.</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <UserGroupIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">US-Based Team and Support</h3>
                <p className="mt-2 text-gray-500">When you reach out, you talk to the same people who build the platform. We do not outsource support overseas.</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <ShieldCheckIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">You Own Everything</h3>
                <p className="mt-2 text-gray-500">Your customers, your data, your revenue. Payments go directly to your account. We never touch your money.</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <BoltIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">Live in Minutes, Not Months</h3>
                <p className="mt-2 text-gray-500">Your store is generated automatically from your products. Add your catalog, connect a payment method, and you are live.</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <GlobeAltIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">Built for How People Shop Now</h3>
                <p className="mt-2 text-gray-500">Your products are discoverable by Google, AI assistants, and voice search, not just customers who already know your name.</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-md bg-teal-700 text-white mx-auto">
                  <HeartIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">A Partner, Not a Vendor</h3>
                <p className="mt-2 text-gray-500">We are a US-based, remote-first company. We grow when you grow. That is the only business model that keeps us honest.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Our Commitment */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Our Commitment</h2>
          <div className="space-y-4 text-gray-600 text-lg leading-relaxed">
            <p>
              The platform scales with your business (from your first order to thousands a day) without configuration changes, downtime, or surprise fees. We handle the infrastructure, the security, and the updates. You focus on your customers.
            </p>
            <p>
              Every feature we build is designed to save you time and reduce your costs. Your storefront gets automatic SEO. Your checkout connects to your payment provider in minutes. Your B2B customers get personalized pricing without spreadsheets. We do the heavy lifting so you do not have to.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gray-800 py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl font-bold text-white">Ready to Own Your Commerce?</h2>
            <p className="mt-4 text-gray-200">Free to start. No setup costs. Premium tiers when you need to scale.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/contact-us"
                className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-teal-700 hover:bg-teal-800"
              >
                Get Started Free
              </Link>
              <Link
                to="/contact-us"
                className="inline-flex items-center justify-center px-8 py-3 border border-gray-200 text-base font-medium rounded-md text-gray-200 hover:text-white hover:border-white"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </div>

      </main>
      <Footer />
    </div>
  );
};

export default About;
