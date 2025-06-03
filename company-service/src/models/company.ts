import { Schema, model, Document } from 'mongoose';

interface Coordinates {
  lat: number;
  lng: number;
}

interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  coordinates?: Coordinates;
}

interface SellingArea {
  radius: number;
  center: Coordinates;
}

export interface ICompany extends Document {
  name: string;
  description?: string;
  companyCode: string;
  userId: string;
  address?: Address;
  sellingArea?: SellingArea;
  paymentMethods: ('cash' | 'credit_card')[];
  customers: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true },
    description: { type: String, trim: true },
    companyCode: { type: String, required: [true, 'Company code is required'], unique: true, trim: true },
    userId: { type: String, required: [true, 'User ID is required'] },
    address: {
      type: {
        street: { type: String, required: [true, 'Street is required'] },
        city: { type: String, required: [true, 'City is required'] },
        state: { type: String, required: [true, 'State is required'] },
        zip: { type: String, required: [true, 'Zip is required'] },
        coordinates: {
          type: {
            lat: { type: Number, required: [true, 'Latitude is required'] },
            lng: { type: Number, required: [true, 'Longitude is required'] },
          },
          required: false,
        },
      },
      required: false,
    },
    sellingArea: {
      radius: { type: Number, min: [0, 'Radius must be non-negative'] },
      center: {
        lat: { type: Number, required: [true, 'Center latitude is required'] },
        lng: { type: Number, required: [true, 'Center longitude is required'] },
      },
    },
    paymentMethods: {
      type: [{ type: String, enum: ['cash', 'credit_card'] }],
      required: [true, 'At least one payment method is required'],
      default: ['cash'],
    },
    customers: [{ type: String }],
  },
  { timestamps: true }
);

export const Company = model<ICompany>('Company', CompanySchema);