import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useAuth } from '../hooks/useAuth';
import { Cart as CartType } from '../types';
import { getCart, updateCartItem, removeItemFromCart, clearCart } from '../api';

const CACHE_KEY = 'cart_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

const Cart: React.FC = () => {
  const { isAuthenticated, decodeJWT } = useAuth();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartType | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const invalidateCache = () => {
    localStorage.removeItem(CACHE_KEY);
  };

  const fetchCart = useCallback(async () => {
    setLoading(true);
    try {
      const fetchedCart = await getCart();
      setCart(fetchedCart);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data: fetchedCart, timestamp: Date.now() }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load cart');
      setCart(null); // Ensure cart is null on error
      invalidateCache(); // Invalidate cache on error
    } finally {
      setLoading(false);
    }
  }, []);

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
      toast.error('Access denied. Only customers can view their cart.');
      navigate('/home'); // Redirect non-customers
      return;
    }
    setUserRole(role);

    const loadCart = async () => {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setCart(data);
          setLoading(false);
          return;
        }
      }
      await fetchCart();
    };

    loadCart();

    window.addEventListener('cartUpdated', fetchCart);

    return () => {
      window.removeEventListener('cartUpdated', fetchCart);
    };
  }, [isAuthenticated, navigate, decodeJWT, fetchCart]);

  const handleUpdateQuantity = async (itemId: string, quantity: number) => {
    setLoading(true);
    try {
      const updatedCart = await updateCartItem(itemId, { entity: { quantity } });
      setCart(updatedCart);
      toast.success('Item quantity updated!');
      invalidateCache(); // Invalidate cache after successful update
      window.dispatchEvent(new Event('cartUpdated')); // Dispatch custom event
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update item quantity');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    setLoading(true);
    try {
      const updatedCart = await removeItemFromCart(itemId);
      setCart(updatedCart);
      toast.success('Item removed from cart!');
      invalidateCache(); // Invalidate cache after successful removal
      window.dispatchEvent(new Event('cartUpdated')); // Dispatch custom event
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to remove item');
    } finally {
      setLoading(false);
    }
  };

  const handleClearCart = async () => {
    setLoading(true);
    try {
      const clearedCart = await clearCart();
      setCart(clearedCart);
      toast.success('Cart cleared!');
      invalidateCache(); // Invalidate cache after successful clear
      window.dispatchEvent(new Event('cartUpdated')); // Dispatch custom event
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to clear cart');
    } finally {
      setLoading(false);
    }
  };

  if (!userRole || loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Toaster position="top-right" />
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Your Shopping Cart</h1>

        {!cart || cart.items.length === 0 ? (
          <p className="text-gray-600">Your cart is empty.</p>
        ) : (
          <div className="bg-white shadow-lg rounded-lg p-6">
            <div className="divide-y divide-gray-200">
              {cart.items.map((item) => (
                <div key={item.productId} className="flex items-center justify-between py-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-800">Product ID: {item.productId}</h2>
                      <p className="text-gray-600">Quantity: {item.quantity}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => {
                        if (item._id) {
                          handleUpdateQuantity(item._id, parseInt(e.target.value));
                        }
                      }}
                        className="w-20 p-2 border border-gray-300 rounded-md"
                      />
                      {item._id && (
                        <button
                          onClick={() => {
                            if (item._id) {
                              handleRemoveItem(item._id);
                            }
                          }}
                          className="text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end space-x-4">
              <button
                onClick={handleClearCart}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
              >
                Clear Cart
              </button>
              <button
                className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition"
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Cart;