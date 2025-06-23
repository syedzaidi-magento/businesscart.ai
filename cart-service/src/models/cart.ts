import mongoose, { Schema, Document } from 'mongoose';

export interface ICartItem {
  productId: string;
  quantity: number;
  _id?: mongoose.Types.ObjectId;
}

export interface ICart extends Document {
  userId: string;
  items: ICartItem[];
}

const CartItemSchema = new Schema({
  productId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
});

const CartSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  items: [CartItemSchema],
});

export const Cart = mongoose.model<ICart>('Cart', CartSchema);