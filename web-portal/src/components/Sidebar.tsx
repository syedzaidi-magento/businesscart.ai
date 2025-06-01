import { Link } from 'react-router-dom';

const Sidebar = () => {
  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    window.location.href = '/login';
  };

  return (
    <div className="w-64 bg-gray-800 text-white h-screen p-6">
      <h2 className="text-2xl mb-6">BusinessCart</h2>
      <nav className="space-y-4">
        <Link to="/companies" className="block px-4 py-2 rounded hover:bg-gray-700">
          Companies
        </Link>
        <Link to="/products" className="block px-4 py-2 rounded hover:bg-gray-700">
          Products
        </Link>
        <button onClick={handleLogout} className="w-full text-left px-4 py-2 rounded hover:bg-gray-700">
          Logout
        </button>
      </nav>
    </div>
  );
};

export default Sidebar;
