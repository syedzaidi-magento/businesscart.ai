import { NavLink } from 'react-router-dom';
import { UserIcon, HomeIcon, BuildingOffice2Icon, ShoppingBagIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';

const Sidebar = () => {
  const links = [
    { name: 'Dashboard', path: '/dashboard', icon: HomeIcon },
    { name: 'Users', path: '/users', icon: UserIcon },
    { name: 'Companies', path: '/companies', icon: BuildingOffice2Icon },
    { name: 'Products', path: '/products', icon: ShoppingBagIcon },
    { name: 'Orders', path: '/orders', icon: ClipboardDocumentListIcon },
  ];

  return (
    <div className="w-64 bg-gray-800 shadow-lg h-screen sticky top-0">
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-200">BusinessCart</h1>
      </div>
      <nav className="mt-4">
        {links.map((link) => (
          <NavLink
            key={link.name}
            to={link.path}
            className={({ isActive }) =>
              `flex items-center px-6 py-3 text-gray-200 hover:bg-gray-700 transition-colors ${
                isActive ? 'bg-gray-900 text-white border-l-4 border-teal-500' : ''
              }`
            }
          >
            <link.icon className="h-5 w-5 mr-3" />
            <span>{link.name}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

export default Sidebar;