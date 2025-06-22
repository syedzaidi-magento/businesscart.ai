import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getProducts } from '../api';
import { Toaster, toast } from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useAuth } from '../hooks/useAuth';
import { User, Product } from '../types';

const Home: React.FC = () => {
  const { isAuthenticated, logout, decodeJWT } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState<Partial<User> | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      if (!isAuthenticated) {
        setUser(null);
        return;
      }

      setLoading(true);
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) throw new Error('No access token found');
        const role = decodeJWT(token) as 'admin' | 'company' | 'customer' | null;
        if (!role || !['customer', 'company', 'admin'].includes(role)) {
          localStorage.removeItem('accessToken');
          throw new Error('Invalid user role');
        }
        const payload = JSON.parse(atob(token.split('.')[1]));
        const userId: string = payload.user?.id || payload.sub || '';
        if (!userId) throw new Error('User ID not found in JWT');
        setUser({ _id: userId, role, name: payload.user?.name || '' });
      } catch (err: any) {
        console.error('Failed to decode user:', err);
        toast.error(err.message || 'Failed to load user data');
        logout();
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [isAuthenticated, logout, navigate]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!user || !user.role || user.role !== 'customer') return;

      setLoading(true);
      try {
        const products = await getProducts();
        const productsWithImages = products.slice(0, 3).map((product: Product) => ({
          ...product,
          image: product.image || 'https://via.placeholder.com/300x200',
        }));
        setProducts(productsWithImages);
      } catch (err: any) {
        console.error('Failed to fetch products:', err);
        toast.error(err.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [user]);

  return (
    <div className="min-h-screen bg-gray-100">
      <Toaster position="top-right" />
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading && <div className="animate-spin h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full mx-auto my-12"></div>}

        {/* Guest/Non-authenticated users - Company focused content */}
        {!isAuthenticated && (
          <div className="py-16">
            {/* Hero Section for Companies */}
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-800 mb-4">Welcome to BusinessCart</h2>
              <p className="text-lg text-gray-600 mb-8">Connect with your customers and manage your product catalog effortlessly.</p>
              
              <div className="bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-lg shadow-lg py-12 mb-12">
                <h3 className="text-3xl font-bold tracking-tight mb-4">For Companies</h3>
                <p className="text-lg max-w-2xl mx-auto mb-6">
                  Create your product catalog, manage inventory, and give your customers exclusive access to your products.
                </p>
                <div className="space-x-4">
                  <Link
                    to="/register"
                    className="inline-block bg-white text-teal-600 font-semibold px-6 py-3 rounded-md shadow hover:bg-gray-50 transition"
                  >
                    Register as Company
                  </Link>
                  <Link
                    to="/login"
                    className="inline-block bg-teal-500 text-white px-6 py-3 rounded-md hover:bg-teal-400 transition"
                  >
                    Company Login
                  </Link>
                </div>
              </div>
            </div>

            {/* Features for Companies */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
              <div className="bg-white rounded-lg shadow-lg p-6 text-center">
                <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                  </svg>
                </div>
                <h4 className="text-xl font-semibold text-gray-800 mb-2">Product Management</h4>
                <p className="text-gray-600">Easily add, edit, and organize your product catalog</p>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 text-center">
                <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="text-xl font-semibold text-gray-800 mb-2">Customer Access Control</h4>
                <p className="text-gray-600">Grant specific customers access to your products</p>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 text-center">
                <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2v1a1 1 0 102 0V3a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 2a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                </div>
                <h4 className="text-xl font-semibold text-gray-800 mb-2">Order Management</h4>
                <p className="text-gray-600">Track and manage customer orders efficiently</p>
              </div>
            </div>

            {/* Customer Access Section */}
            <div className="bg-teal-50 rounded-lg p-8 text-center">
              <h3 className="text-2xl font-semibold text-gray-800 mb-4">Are you a Customer?</h3>
              <p className="text-gray-600 mb-6">Access your company's exclusive products with your customer account.</p>
              <Link
                to="/login"
                className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
              >
                Customer Login
              </Link>
            </div>
          </div>
        )}

        {/* Authenticated users content */}
        {isAuthenticated && user && user.role && (
          <div className="py-12">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">
              Welcome, {user.name || user.role.charAt(0).toUpperCase() + user.role.slice(1)}!
            </h2>

            {user.role === 'customer' && (
              <>
                {/* Hero Section */}
                <div className="bg-gradient-to-r from-teal-600 to-teal-800 text-white rounded-lg shadow-lg py-12 mb-12 text-center">
                  <h3 className="text-3xl font-bold tracking-tight">Shop Premium Products</h3>
                  <p className="mt-4 text-lg max-w-2xl mx-auto">Explore our curated selection for your business needs.</p>
                  <button
                    onClick={() => navigate('/products')}
                    className="mt-6 inline-block bg-white text-teal-600 font-semibold px-6 py-3 rounded-md shadow hover:bg-gray-50 transition"
                  >
                    Shop Now
                  </button>
                </div>

                {/* Product Grid */}
                <div>
                  <h3 className="text-2xl font-semibold text-gray-800 mb-6">Featured Products</h3>
                  {products.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                      {products.map((product) => (
                        <div
                          key={product._id}
                          className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition cursor-pointer"
                          onClick={() => navigate(`/products/${product._id}`)}
                        >
                          <img
                            src={product.image || 'https://via.placeholder.com/300x200'}
                            alt={product.name}
                            className="w-full h-48 object-cover"
                          />
                          <div className="p-4">
                            <h4 className="text-xl font-semibold text-gray-800">{product.name}</h4>
                            <p className="text-gray-600 text-sm line-clamp-2">{product.description}</p>
                            <p className="text-teal-600 font-bold mt-2">${product.price.toFixed(2)}</p>
                            <button className="mt-4 w-full bg-teal-600 text-white py-2 rounded-md hover:bg-teal-700 transition">
                              Add to Cart
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-600 mb-6">No products available.</p>
                  )}
                  <Link
                    to="/products"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    View All Products
                  </Link>
                </div>
              </>
            )}

            {user.role === 'company' && (
              <div>
                <p className="text-lg text-gray-600 mb-6">
                  Manage your products and orders for {user.company_id || 'your company'}.
                </p>
                <div className="space-x-4">
                  <Link
                    to="/dashboard"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    Manage Products
                  </Link>
                  <Link
                    to="/orders"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    Manage Orders
                  </Link>
                </div>
              </div>
            )}

            {user.role === 'admin' && (
              <div>
                <p className="text-lg text-gray-600 mb-6">Administer users, products, and orders.</p>
                <div className="space-x-4">
                  <Link
                    to="/admin/users"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    Manage Users
                  </Link>
                  <Link
                    to="/admin/products"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    Manage Products
                  </Link>
                  <Link
                    to="/admin/orders"
                    className="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition"
                  >
                    Manage Orders
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Home;