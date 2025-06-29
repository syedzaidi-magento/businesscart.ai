import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Product } from '../types';
import { addItemToCart } from '../api';

interface AddToCartButtonProps {
  product: Product;
}

const AddToCartButton: React.FC<AddToCartButtonProps> = ({ product }) => {
  const [loading, setLoading] = useState(false);

  const handleAddToCart = async () => {
    setLoading(true);
    try {
      await addItemToCart({ entity: { productId: product._id, quantity: 1 } });
      toast.success(`${product.name} added to cart!`);
      localStorage.removeItem('cart_cache'); // Invalidate cart cache
      window.dispatchEvent(new Event('cartUpdated')); // Dispatch custom event
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to add item to cart');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="mt-4 w-full bg-teal-600 text-white py-2 rounded-md hover:bg-teal-700 transition"
      onClick={(e) => {
        e.stopPropagation(); // Prevent product card's onClick from firing
        handleAddToCart();
      }}
      disabled={loading}
    >
      {loading ? 'Adding...' : 'Add to Cart'}
    </button>
  );
};

export default AddToCartButton;