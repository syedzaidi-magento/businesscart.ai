import React, { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import axios from 'axios';
import Navbar from './Navbar';
import { useAuth } from '../hooks/useAuth';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

interface User {
  id: string;
  name?: string;
  role: 'customer' | 'company' | 'admin';
  company_id?: string;
}

const CACHE_KEY = 'products_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const Dashboard: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      if (!isAuthenticated) {
        setUser(null);
        return;
      }

      setIsLoading(true);
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) throw new Error('No access token found');
        const response = await axios.get(`${import.meta.env.VITE_USER_API}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(response.data.user);
      } catch (err: any) {
        console.error('Failed to fetch user:', err);
        toast.error(err.response?.data?.message || 'Failed to load user data');
        logout();
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, [isAuthenticated, logout]);

  useEffect(() => {
    const loadProducts = async () => {
      if (!user || !['company', 'admin'].includes(user.role)) return;

      setIsLoading(true);
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            setProductCount(data.length);
            return;
          }
        }
        const token = localStorage.getItem('accessToken');
        if (!token) throw new Error('No access token found');
        const response = await axios.get(`${import.meta.env.VITE_PRODUCT_API}/products`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = response.data.products;
        setProductCount(data.length);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Error fetching products');
      } finally {
        setIsLoading(false);
      }
    };

    loadProducts();
  }, [user]);

  return (
    <div className="flex-1 flex flex-col">
      <Toaster position="top-right" />
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            {user ? `${user.role.charAt(0).toUpperCase() + user.role.slice(1)} Dashboard` : 'Dashboard'}
          </h2>
          <p className="text-gray-600">
            {user?.role === 'customer'
              ? 'View your orders and explore products.'
              : 'Manage your products and companies from the sidebar navigation.'}
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
      </main>
    </div>
  );
};

export default Dashboard;