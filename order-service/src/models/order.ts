import { Schema, model, Document } from 'mongoose';

interface BillingAddress {
  address_type: string;
  city: string;
  country_id: string;
  firstname: string;
  lastname: string;
  postcode: string;
  telephone: string;
  street: string[];
  company?: string;
  customer_address_id?: number;
  customer_id?: number;
  email?: string;
  fax?: string;
  middlename?: string;
  prefix?: string;
  region?: string;
  region_code?: string;
  region_id?: number;
  suffix?: string;
  vat_id?: string;
  vat_is_valid?: number;
  vat_request_date?: string;
  vat_request_id?: string;
  vat_request_success?: number;
}

interface Payment {
  account_status: string;
  additional_information: string[];
  cc_last4: string;
  method: string;
  amount_ordered?: number;
  base_amount_ordered?: number;
  amount_paid?: number;
  base_amount_paid?: number;
}

interface OrderItem {
  sku: string;
  name: string;
  qty_ordered: number;
  price: number;
  row_total: number;
  product_id?: number;
  product_type?: string;
  qty_invoiced?: number;
  qty_shipped?: number;
  qty_refunded?: number;
}

interface StatusHistory {
  comment: string;
  is_customer_notified: number;
  is_visible_on_front: number;
  parent_id: number;
  created_at?: string;
  status?: string;
}

export interface IOrder extends Document {
  base_grand_total: number;
  grand_total: number;
  customer_email: string;
  customer_id?: string;
  billing_address: BillingAddress;
  payment: Payment;
  items: OrderItem[];
  status_histories?: StatusHistory[];
  company_id: string;
  user_id: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    base_grand_total: { type: Number, required: true },
    grand_total: { type: Number, required: true },
    customer_email: { type: String, required: true },
    customer_id: { type: String },
    billing_address: {
      address_type: { type: String, required: true },
      city: { type: String, required: true },
      country_id: { type: String, required: true },
      firstname: { type: String, required: true },
      lastname: { type: String, required: true },
      postcode: { type: String, required: true },
      telephone: { type: String, required: true },
      street: [{ type: String, required: true }],
      company: { type: String },
      customer_address_id: { type: Number },
      customer_id: { type: Number },
      email: { type: String },
      fax: { type: String },
      middlename: { type: String },
      prefix: { type: String },
      region: { type: String },
      region_code: { type: String },
      region_id: { type: Number },
      suffix: { type: String },
      vat_id: { type: String },
      vat_is_valid: { type: Number },
      vat_request_date: { type: String },
      vat_request_id: { type: String },
      vat_request_success: { type: Number },
    },
    payment: {
      account_status: { type: String, required: true },
      additional_information: [{ type: String, required: true }],
      cc_last4: { type: String, required: true },
      method: { type: String, required: true },
      amount_ordered: { type: Number },
      base_amount_ordered: { type: Number },
      amount_paid: { type: Number },
      base_amount_paid: { type: Number },
    },
    items: [
      {
        sku: { type: String, required: true },
        name: { type: String, required: true },
        qty_ordered: { type: Number, required: true },
        price: { type: Number, required: true },
        row_total: { type: Number, required: true },
        product_id: { type: Number },
        product_type: { type: String },
        qty_invoiced: { type: Number },
        qty_shipped: { type: Number },
        qty_refunded: { type: Number },
      },
    ],
    status_histories: [
      {
        comment: { type: String, required: true },
        is_customer_notified: { type: Number, required: true },
        is_visible_on_front: { type: Number, required: true },
        parent_id: { type: Number, required: true },
        created_at: { type: String },
        status: { type: String },
      },
    ],
    company_id: { type: String, required: true },
    user_id: { type: String, required: true },
  },
  { timestamps: true }
);

export const Order = model<IOrder>('Order', OrderSchema);
