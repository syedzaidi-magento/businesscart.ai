import { Schema, model, Document } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  description?: string;
  price: number;
  companyId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true },
    description: { type: String, trim: true },
    price: { type: Number, required: [true, 'Price is required'], min: [0, 'Price must be non-negative'] },
    companyId: { type: String, required: [true, 'Company ID is required'] },
    userId: { type: String, required: [true, 'User ID is required'] },
  },
  { timestamps: true }
);

export const Product = model<IProduct>('Product', ProductSchema);