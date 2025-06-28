import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProducts } from '../api';
import { Toaster, toast } from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useAuth } from '../hooks/useAuth';
import { Product } from '../types';

const CACHE_KEY = 'products_catalog_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

const Catalog: React.FC = () => {
  const { isAuthenticated, decodeJWT, logout } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const fetchedProducts = await getProducts();
      setProducts(fetchedProducts);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data: fetchedProducts, timestamp: Date.now() }));
    } catch (err: any) {
      console.error('Failed to fetch products:', err);
      toast.error(err.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading]); // setProducts and setLoading are stable setters

  const loadProducts = useCallback(async () => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        setProducts(data);
        setLoading(false);
        return;
      }
    }
    await fetchProducts();
  }, [fetchProducts, setProducts, setLoading]); // fetchProducts, setProducts, setLoading are stable

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) {
      navigate('/login');
      return;
    }

    const role = decodeJWT(token);
    if (role !== 'customer') {
      toast.error('Access denied. Only customers can view the catalog.');
      navigate('/home'); // Redirect non-customers
      return;
    }
    setUserRole(role);

    loadProducts();
  }, [isAuthenticated, navigate, decodeJWT, logout, loadProducts]);

  if (!userRole) {
    return null; // Or a loading spinner/message while role is being determined
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Toaster position="top-right" />
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Product Catalog</h1>

        {loading ? (
          <div className="animate-spin h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full mx-auto my-12"></div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
                  <h2 className="text-xl font-semibold text-gray-800">{product.name}</h2>
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
          <p className="text-gray-600">No products available in the catalog.</p>
        )}
      </main>
    </div>
  );
};

export default Catalog;