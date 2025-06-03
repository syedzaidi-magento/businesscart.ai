import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, ShoppingCartIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import toast, { Toaster } from 'react-hot-toast';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { Fragment } from 'react';

const Navbar = () => {
  const navigate = useNavigate();
  const [userInitials, setUserInitials] = useState('');
  const [companyName, setCompanyName] = useState('Your Company');
  const [notificationCount] = useState(3); // Placeholder
  const [cartCount] = useState(2); // Placeholder

  useEffect(() => {
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
        setCompanyName(payload.user?.companyName || 'Your Company');
      } catch (e) {
        console.error('Invalid token');
        toast.error('Failed to load user data');
      }
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('products_cache');
    toast.success('Logged out successfully');
    navigate('/login', { replace: true });
  };

  return (
    <Disclosure as="nav" className="bg-white shadow">
      {({ open }) => (
        <>
          <Toaster position="top-right" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <span className="text-lg font-medium text-gray-800">{companyName}</span>
              </div>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <BellIcon className="h-6 w-6 text-gray-600 cursor-pointer" />
                  {notificationCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {notificationCount}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <ShoppingCartIcon className="h-6 w-6 text-gray-600 cursor-pointer" />
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {cartCount}
                    </span>
                  )}
                </div>
                <Menu as="div" className="relative">
                  <Menu.Button className="flex items-center space-x-2">
                    <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
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
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleLogout}
                            className={`${active ? 'bg-gray-100' : ''} flex items-center w-full px-4 py-2 text-sm text-gray-700`}
                          >
                            <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
                            Sign out
                          </button>
                        )}
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>
          </div>
        </>
      )}
    </Disclosure>
  );
};

export default Navbar;
