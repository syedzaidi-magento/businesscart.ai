import React, { useState, useEffect, Fragment, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellIcon, ShoppingCartIcon, ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline';
import { Toaster, toast } from 'react-hot-toast';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { useAuth } from '../hooks/useAuth';
import { getCart } from '../api'; // Import getCart

const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();
  const [userInitials, setUserInitials] = useState('');
  const [companyName, setCompanyName] = useState('BusinessCart');
  const [notificationCount] = useState(3); // Placeholder
  const [cartItemCount, setCartItemCount] = useState(0); // Initialize cartItemCount to 0
  const [userRole, setUserRole] = useState<'customer' | 'company' | 'admin' | null>(null);

  const fetchCartCount = useCallback(async () => {
    const cached = localStorage.getItem('cart_cache');
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
      if (Date.now() - timestamp < CACHE_DURATION) {
        setCartItemCount(data.items.length);
        return;
      }
    }
    try {
      const cart = await getCart();
      setCartItemCount(cart.items.length);
      localStorage.setItem('cart_cache', JSON.stringify({ data: cart, timestamp: Date.now() }));
    } catch (error) {
      console.error('Failed to fetch cart count:', error);
      setCartItemCount(0);
      localStorage.removeItem('cart_cache'); // Invalidate cache on error
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setUserInitials('');
      setCompanyName('BusinessCart');
      setUserRole(null);
      setCartItemCount(0); // Clear cart count on logout
      return;
    }

    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const name = payload.user?.name || payload.user?.email || '';
        const initials = name
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        setUserInitials(initials);
        setCompanyName(payload.user?.company_id ? `Company ${payload.user.company_id}` : 'BusinessCart');
        setUserRole(payload.user?.role || null);
        fetchCartCount(); // Fetch cart count when authenticated
      } catch (e) {
        console.error('Invalid token', e);
        toast.error('Failed to load user data');
        logout();
      }
    }
  }, [isAuthenticated, logout]);

  useEffect(() => {
    window.addEventListener('cartUpdated', fetchCartCount);

    return () => {
      window.removeEventListener('cartUpdated', fetchCartCount);
    };
  }, [fetchCartCount]);

  return (
    <Disclosure as="nav" className="bg-white shadow">
      {() => (
        <>
          <Toaster position="top-right" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <span className="text-lg font-medium text-gray-800">{companyName}</span>
              </div>
              <div className="flex items-center space-x-4">
                {userRole === 'customer' && (
                  <>
                    <div className="relative">
                      <BellIcon className="h-6 w-6 text-gray-600 cursor-pointer" />
                      {notificationCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-600 text-white text- rounded-full h-4 w-4 flex items-center justify-center">
                          {notificationCount}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Link to="/cart">
                        <ShoppingCartIcon className="h-6 w-6 text-gray-600 cursor-pointer" />
                        {cartItemCount > 0 && (
                          <span className="absolute -top-1 -right-1 bg-teal-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                            {cartItemCount}
                          </span>
                        )}
                      </Link>
                    </div>
                  </>
                )}
                {isAuthenticated && (
                  <Menu as="div" className="relative">
                    <Menu.Button className="flex items-center space-x-2">
                      <div className="h-8 w-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
                        {userInitials || 'U'}
                      </div>
                    </Menu.Button>
                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-100"
                      enterFrom="transform opacity-0 scale-95"
                      enterTo="transform opacity-100 scale-100"
                      leave="transition ease-in duration-75"
                      leaveFrom="transform opacity-100 scale-100"
                      leaveTo="transform opacity-0 scale-95"
                    >
                      <Menu.Items className="absolute right-0 mt-2 w-48 origin-top-right bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 focus:outline-none">
                        {userRole === 'company' && (
                          <Menu.Item>
                            {({ active }) => (
                              <button
                                onClick={() => navigate('/dashboard')}
                                className={`${active ? 'bg-gray-100' : ''} flex items-center w-full px-4 py-2 text-sm text-gray-700`}
                              >
                                Dashboard
                              </button>
                            )}
                          </Menu.Item>
                        )}
                        {userRole === 'customer' && (
                          <Menu.Item>
                            {({ active }) => (
                              <Link
                                to="/catalog"
                                className={`${active ? 'bg-gray-100' : ''} flex items-center w-full px-4 py-2 text-sm text-gray-700`}
                              >
                                Product Catalog
                              </Link>
                            )}
                          </Menu.Item>
                        )}
                        {userRole === 'admin' && (
                          <Menu.Item>
                            {({ active }) => (
                              <button
                                onClick={() => navigate('/admin')}
                                className={`${active ? 'bg-gray-100' : ''} flex items-center w-full px-4 py-2 text-sm text-gray-700`}
                              >
                                Admin Panel
                              </button>
                            )}
                          </Menu.Item>
                        )}
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={logout}
                              className={`${active ? 'bg-gray-100' : ''} flex items-center w-full px-4 py-2 text-sm text-gray-700`}
                            >
                              <ArrowRightStartOnRectangleIcon className="h-5 w-5 mr-2" />
                              Sign out
                            </button>
                          )}
                        </Menu.Item>
                      </Menu.Items>
                    </Transition>
                  </Menu>
                )}
                {!isAuthenticated && (
                  <>
                    <button
                      onClick={() => navigate('/login')}
                      className="text-gray-600 hover:text-gray-800 px-3 py-2 text-sm font-medium"
                    >
                      Login
                    </button>
                    <button
                      onClick={() => navigate('/register')}
                      className="bg-teal-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-teal-700"
                    >
                      Sign Up
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Disclosure>
  );
};

export default Navbar;