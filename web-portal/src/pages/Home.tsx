import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

interface User {
  id: string;
  role: 'customer' | 'company' | 'admin';
  company_id?: string;
}

const Home: React.FC = () => {
  const isAuthenticated = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      const token = localStorage.getItem('accessToken');
      if (token) {
        axios
          .get(`${import.meta.env.VITE_USER_SERVICE}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then((res) => setUser(res.data.user))
          .catch((err) => console.error('Failed to fetch user:', err));
      }
    } else {
      setUser(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (user?.role === 'customer') {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      axios
        .get(`${import.meta.env.VITE_PRODUCT_SERVICE}/products`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => setProducts(res.data.products.slice(0, 3)))
        .catch((err) => console.error('Failed to fetch products:', err))
        .finally(() => setLoading(false));
    }
  }, [user]);

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (token) {
        await axios.post(
          `${import.meta.env.VITE_USER_SERVICE}/users/logout`,
          { refreshToken: 'dummy' },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      localStorage.removeItem('accessToken');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <main className="container mx-auto p-6">
        {!isAuthenticated && (
          <div className="text-center py-16">
            <h2 className="text-4xl font-bold text-gray-800 mb-4">Welcome to BusinessCart</h2>
            <p className="text-lg text-gray-600 mb-6">Discover products for your needs.</p>
            <div className="space-x-4">
              <Link
                to="/register"
                className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
              >
                Get Started
              </Link>
              <Link
                to="/login"
                className="inline-block bg-gray-200 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-300"
              >
                Login
              </Link>
            </div>
          </div>
        )}
        {isAuthenticated && user?.role === 'customer' && (
          <div className="py-16">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Welcome, Customer!</h2>
            <p className="text-lg text-gray-600 mb-6">Explore our products.</p>
            {loading ? (
              <p>Loading products...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {products.map((product) => (
                  <div key={product.id} className="bg-white p-4 rounded-lg shadow">
                    <h3 className="text-xl font-semibold">{product.name}</h3>
                    <p className="text-gray-600">{product.description}</p>
                    <p className="text-blue-600 font-bold">${product.price}</p>
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/products"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
            >
              View All Products
            </Link>
          </div>
        )}
        {isAuthenticated && user?.role === 'company' && (
          <div className="py-16">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Welcome, {user.company_id || 'Company'}!</h2>
            <p className="text-lg text-gray-600 mb-6">Manage your products.</p>
            <Link
              to="/dashboard"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
            >
              Manage Products
            </Link>
          </div>
        )}
        {isAuthenticated && user?.role === 'admin' && (
          <div className="py-16">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Admin Dashboard</h2>
            <p className="text-lg text-gray-600 mb-6">Manage users and products.</p>
            <div className="space-x-4">
              <Link
                to="/admin/users"
                className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
              >
                Manage Users
              </Link>
              <Link
                to="/admin/products"
                className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
              >
                Manage Products
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Home;