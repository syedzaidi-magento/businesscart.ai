export interface User {
  _id: string;
  name: string;
  email: string;
  password?: string;
  role: 'admin' | 'company' | 'customer';
  company_id?: string;
  associate_company_ids?: string[];
  phoneNumber: string;
}

export interface Company {
  _id: string;
  name: string;
  companyCode: string;
  paymentMethods: string[];
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    coordinates: { lat: number; lng: number };
  };
  sellingArea: {
    radius: number;
    center: { lat: number; lng: number };
  };
}

export interface Product {
  _id: string;
  name: string;
  price: number;
  companyId: string;
  userId: string;
  description: string;
  image?: string;
}

export interface Order {
  _id: string;
  base_grand_total: number;
  grand_total: number;
  customer_email: string;
  billing_address: {
    address_type: string;
    city: string;
    country_id: string;
    firstname: string;
    lastname: string;
    postcode: string;
    telephone: string;
    street: string[];
  };
  payment: {
    account_status: string;
    additional_information: string[];
    cc_last4: string;
    method: string;
  };
  items: {
    sku: string;
    name: string;
    qty_ordered: number;
    price: number;
    row_total: number;
    product_id: string;
  }[];
  company_id: string;
  user_id: string;
}

export interface Cart {
  _id: string;
  userId: string;
  items: {
    productId: string;
    quantity: number;
    _id?: string;
  }[];
}