export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
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
  description: string;
}