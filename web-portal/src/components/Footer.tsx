import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-800 text-white">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">

        {/* Brand + Links */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">

          {/* Brand */}
          <div className="md:col-span-2">
            <p className="text-lg font-bold text-white">BusinessCart.ai</p>
            <p className="mt-2 text-sm text-gray-300">
              Your own branded online store with no monthly fee, ever. Pay 6% per order, capped at $5 at any volume. Built-in B2B, sub-1-second loads, and AI-ready storefronts.
            </p>
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-300">
                <a href="mailto:help@businesscart.ai" className="hover:text-white">help@businesscart.ai</a>
              </p>
              <p className="text-sm text-gray-300">
                <a href="tel:+16575010200" className="hover:text-white">+1 (657) 501-0200</a>
              </p>
            </div>
          </div>

          {/* Solutions */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 tracking-wider uppercase">Solutions</h3>
            <ul className="mt-4 space-y-3">
              <li><Link to="/solutions/d2c-brands" className="text-sm text-gray-200 hover:text-white">D2C Brands</Link></li>
              <li><Link to="/solutions/ai-commerce" className="text-sm text-gray-200 hover:text-white">AI-Era Commerce</Link></li>
              <li><Link to="/solutions/wholesale" className="text-sm text-gray-200 hover:text-white">Wholesale &amp; B2B</Link></li>
              <li><Link to="/solutions/restaurants" className="text-sm text-gray-200 hover:text-white">Restaurants &amp; Food</Link></li>
              <li><Link to="/solutions/grocery" className="text-sm text-gray-200 hover:text-white">Grocery &amp; Specialty</Link></li>
              <li><Link to="/solutions/manufacturers" className="text-sm text-gray-200 hover:text-white">Manufacturers</Link></li>
              <li><Link to="/solutions/distributors" className="text-sm text-gray-200 hover:text-white">Distributors</Link></li>
              <li><Link to="/solutions/marketplace-escape" className="text-sm text-gray-200 hover:text-white">Marketplace Escape</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 tracking-wider uppercase">Resources</h3>
            <ul className="mt-4 space-y-3">
              <li><Link to="/industries" className="text-sm text-gray-200 hover:text-white">All Solutions</Link></li>
              <li><Link to="/blog" className="text-sm text-gray-200 hover:text-white">Blog</Link></li>
              <li><Link to="/compare" className="text-sm text-gray-200 hover:text-white">Compare</Link></li>
              <li><Link to="/faq" className="text-sm text-gray-200 hover:text-white">FAQ</Link></li>
            </ul>
          </div>

          {/* Company + Legal */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 tracking-wider uppercase">Company</h3>
            <ul className="mt-4 space-y-3">
              <li><Link to="/about" className="text-sm text-gray-200 hover:text-white">About</Link></li>
              <li><Link to="/careers" className="text-sm text-gray-200 hover:text-white">Careers</Link></li>
              <li><Link to="/contact-us" className="text-sm text-gray-200 hover:text-white">Contact Us</Link></li>
              <li><Link to="/system-status" className="text-sm text-gray-200 hover:text-white">System Status</Link></li>
            </ul>
            <h3 className="mt-6 text-sm font-semibold text-gray-300 tracking-wider uppercase">Legal</h3>
            <ul className="mt-4 space-y-3">
              <li><Link to="/privacy-policy" className="text-sm text-gray-200 hover:text-white">Privacy Policy</Link></li>
              <li><Link to="/terms-of-service" className="text-sm text-gray-200 hover:text-white">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        {/* Trust signal — your-data-is-yours guarantee */}
        <div className="mt-10 border-t border-gray-700 pt-6 pb-2">
          <p className="text-sm text-teal-300 text-center sm:text-left">
            <span className="font-semibold">Your data is yours.</span> Customers and orders exportable as CSV, products accessible via REST API and shopping feeds. No lock-in. No cancellation fees. Leaving costs nothing.
          </p>
        </div>

        {/* Bottom Bar */}
        <div className="mt-2 border-t border-gray-700 pt-8 flex flex-col sm:flex-row items-center justify-between">
          <p className="text-sm text-gray-300">&copy; 2026 BusinessCart, Inc. All rights reserved. United States.</p>
          <div className="flex space-x-6 mt-4 sm:mt-0">
            <a href="https://www.facebook.com/people/BusinessCart/61581018762021" target="_blank" rel="noopener noreferrer" title="Facebook" className="text-gray-300 hover:text-white">
              <span className="sr-only">Facebook</span>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
              </svg>
            </a>
            <a href="https://x.com/BusinessCart_ai" target="_blank" rel="noopener noreferrer" title="X (Twitter)" className="text-gray-300 hover:text-white">
              <span className="sr-only">X</span>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.258 10.152L23.176 0h-2.11l-7.744 8.813L7.13 0H0l9.308 13.324L0 24h2.11l8.178-9.307L16.87 24h7.13L14.258 10.152zM11.5 13.51L3.66 2.4h3.2l7.85 11.18-3.21 4.58h-3.2l8.2-11.7z" />
              </svg>
            </a>
            <a href="https://www.linkedin.com/company/businesscart-ai" target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-gray-300 hover:text-white">
              <span className="sr-only">LinkedIn</span>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.784-1.75-1.75s.784-1.75 1.75-1.75 1.75.784 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd" />
              </svg>
            </a>
            <a href="https://www.instagram.com/businesscart.ai" target="_blank" rel="noopener noreferrer" title="Instagram" className="text-gray-300 hover:text-white">
              <span className="sr-only">Instagram</span>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" />
              </svg>
            </a>
            <a href="https://wa.me/16575010200" target="_blank" rel="noopener noreferrer" title="WhatsApp" className="text-gray-300 hover:text-white">
              <span className="sr-only">WhatsApp</span>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
