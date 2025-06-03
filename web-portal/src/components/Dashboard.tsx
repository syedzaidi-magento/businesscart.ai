import { useEffect, useState } from 'react';
import Navbar from './Navbar';
import toast, { Toaster } from 'react-hot-toast';
import { getProducts } from '../api';
import { Product } from '../types';

const CACHE_KEY = 'products_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const Dashboard = () => {
  const [productCount, setProductCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadProducts = async () => {
      setIsLoading(true);
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            setProductCount(data.length);
            setIsLoading(false);
            return;
          }
        }
        const data = await getProducts();
        setProductCount(data.length);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Error fetching products');
      } finally {
        setIsLoading(false);
      }
    };
    loadProducts();
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <Toaster position="top-right" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Dashboard</h2>
          <p className="text-gray-600">
            Manage your products and companies from the sidebar navigation.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-2">Products Overview</h3>
            {isLoading ? (
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
            ) : (
              <p className="text-gray-600">
                You have {productCount ?? '0'} product{productCount !== 1 ? 's' : ''}. View them in the Products section.
              </p>
            )}
          </div>
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-2">Companies Overview</h3>
            {isLoading ? (
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
            ) : (
              <p className="text-gray-600">Company count coming soon. View them in the Companies section.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;