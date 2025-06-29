import axios from 'axios';
import { User, Company, Product, Order, Cart } from './types';

const USER_API_URL = import.meta.env.VITE_USER_API_URL || 'http://127.0.0.1:3000';
const COMPANY_API_URL = import.meta.env.VITE_COMPANY_API_URL || 'http://127.0.0.1:3001';
const PRODUCT_API_URL = import.meta.env.VITE_PRODUCT_API_URL || 'http://127.0.0.1:3002';
const ORDER_API_URL = import.meta.env.VITE_ORDER_API_URL || 'http://127.0.0.1:3003';
const CART_API_URL = import.meta.env.VITE_CART_API_URL || 'http://127.0.0.1:3004';

const api = axios.create();

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000;
      if (Date.now() >= expiry) {
        localStorage.removeItem('accessToken');
        window.location.href = '/login';
        throw new Error('Token expired');
      }
      config.headers.Authorization = `Bearer ${token}`;
    } catch (e) {
      console.error('Error decoding JWT:', e);
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const register = async (data: {
  name: string;
  email: string;
  password: string;
  role: string;
  phoneNumber: string;
}): Promise<{ accessToken: string; user: User }> => {
  const response = await api.post(`${USER_API_URL}/users/register`, data);
  return response.data;
};

export const login = async (data: { email: string; password: string }): Promise<{ accessToken: string; user: User }> => {
  const response = await api.post(`${USER_API_URL}/users/login`, data);
  return response.data;
};

export const logout = async (): Promise<void> => {
  try {
    const token = localStorage.getItem('accessToken');
    if (token) {
      await api.post(`${USER_API_URL}/users/logout`, {});
    }
  } catch (error) {
    console.error('Logout API error:', error);
  } finally {
    localStorage.removeItem('accessToken');
  }
};

export const getUsers = async (): Promise<User[]> => {
  const response = await api.get(`${USER_API_URL}/users`);
  return response.data;
};

export const updateUser = async (id: string, data: Partial<Omit<User, '_id'>>): Promise<User> => {
  const response = await api.patch(`${USER_API_URL}/users/${id}`, data);
  return response.data.user;
};

export const deleteUser = async (id: string): Promise<void> => {
  await api.delete(`${USER_API_URL}/users/${id}`);
};

export const createCompany = async (data: Omit<Company, '_id'>): Promise<Company> => {
  const response = await api.post(`${COMPANY_API_URL}/companies`, data);
  return response.data;
};

export const getCompanies = async (): Promise<Company[]> => {
  const response = await api.get(`${COMPANY_API_URL}/companies`);
  return response.data;
};

export const updateCompany = async (id: string, data: Omit<Company, '_id'>): Promise<Company> => {
  const response = await api.put(`${COMPANY_API_URL}/companies/${id}`, data);
  return response.data;
};

export const deleteCompany = async (id: string): Promise<void> => {
  await api.delete(`${COMPANY_API_URL}/companies/${id}`);
};

export const updateUserWithCompany = async (companyId: string) => {
  const jwt = localStorage.getItem('accessToken');
  if (!jwt) {
    throw new Error('No JWT found');
  }
  const payload = JSON.parse(atob(jwt.split('.')[1]));
  const userId = payload.user?.id || payload.sub || '';
  if (!userId) {
    throw new Error('User ID not found in JWT');
  }
  const response = await axios.patch(`${USER_API_URL}/users/${userId}`, { company_id: companyId }, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const newJwt = response.data.accessToken;
  if (newJwt) {
    localStorage.setItem('accessToken', newJwt);
  }
  return response.data;
};

export const createProduct = async (data: Omit<Product, '_id'>): Promise<Product> => {
  const response = await api.post(`${PRODUCT_API_URL}/products`, data);
  return response.data;
};

export const getProducts = async (): Promise<Product[]> => {
  const response = await api.get(`${PRODUCT_API_URL}/products`);
  return response.data;
};

export const updateProduct = async (id: string, data: Omit<Product, '_id'>): Promise<Product> => {
  const response = await api.put(`${PRODUCT_API_URL}/products/${id}`, data);
  return response.data;
};

export const deleteProduct = async (id: string): Promise<void> => {
  await api.delete(`${PRODUCT_API_URL}/products/${id}`);
};

export const createOrder = async (data: { entity: Omit<Order, '_id'> }): Promise<Order> => {
  const response = await api.post(`${ORDER_API_URL}/orders`, data);
  return response.data;
};

export const getOrders = async (): Promise<Order[]> => {
  const response = await api.get(`${ORDER_API_URL}/orders`);
  return response.data;
};

export const updateOrder = async (id: string, data: { entity: Omit<Order, '_id'> }): Promise<Order> => {
  const response = await api.put(`${ORDER_API_URL}/orders/${id}`, data);
  return response.data;
};

export const deleteOrder = async (id: string): Promise<void> => {
  await api.delete(`${ORDER_API_URL}/orders/${id}`);
};

export const addItemToCart = async (data: { entity: { productId: string; quantity: number } }): Promise<Cart> => {
  const response = await api.post(`${CART_API_URL}/cart`, data);
  return response.data;
};

export const getCart = async (): Promise<Cart> => {
  const response = await api.get(`${CART_API_URL}/cart`);
  return response.data;
};

export const updateCartItem = async (itemId: string, data: { entity: { quantity: number } }): Promise<Cart> => {
  const response = await api.put(`${CART_API_URL}/cart/${itemId}`, data);
  return response.data;
};

export const removeItemFromCart = async (itemId: string): Promise<Cart> => {
  const response = await api.delete(`${CART_API_URL}/cart/${itemId}`);
  return response.data;
};

export const clearCart = async (): Promise<Cart> => {
  const response = await api.delete(`${CART_API_URL}/cart`);
  return response.data;
};