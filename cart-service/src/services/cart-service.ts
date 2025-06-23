import { Cart, ICart } from '../models/cart';
import { CreateCartItemInput, UpdateCartItemInput } from '../validation';
import { Types } from 'mongoose';

export class CartService {
  async createCartItem(data: CreateCartItemInput['entity'], userId: string): Promise<ICart> {
    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }
    if (cart.userId !== userId) {
      throw new Error('Unauthorized: User ID mismatch');
    }

    const existingItem = cart.items.find((item) => item.productId === data.productId);
    if (existingItem) {
      existingItem.quantity += data.quantity;
    } else {
      cart.items.push({ productId: data.productId, quantity: data.quantity });
    }

    await cart.save();
    return cart;
  }

  async getCart(userId: string, userRole: string): Promise<ICart> {
    const cart = await Cart.findOne({ userId });
    if (!cart) {
      throw new Error('Cart not found');
    }
    if (userRole === 'customer' && cart.userId !== userId) {
      throw new Error('Unauthorized access to cart');
    }
    return cart;
  }

  async updateCartItem(itemId: string, data: UpdateCartItemInput['entity'], userId: string): Promise<ICart> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new Error('Invalid item ID');
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      throw new Error('Cart not found');
    }
    if (cart.userId !== userId) {
      throw new Error('Unauthorized access to cart');
    }

    const item = cart.items.find((i) => i._id && i._id.toString() === itemId);
    if (!item) {
      throw new Error('Cart item not found');
    }

    item.quantity = data.quantity;
    await cart.save();
    return cart;
  }

  async deleteCartItem(itemId: string, userId: string): Promise<ICart> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new Error('Invalid item ID');
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      throw new Error('Cart not found');
    }
    if (cart.userId !== userId) {
      throw new Error('Unauthorized access to cart');
    }

    const itemIndex = cart.items.findIndex((i) => i._id && i._id.toString() === itemId);
    if (itemIndex === -1) {
      throw new Error('Cart item not found');
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();
    return cart;
  }
}