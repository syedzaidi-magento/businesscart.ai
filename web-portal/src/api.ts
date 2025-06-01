import axios from 'axios';
import { User, Company, Product } from './types';

const USER_API_URL = import.meta.env.VITE_USER_API_URL || 'http://127.0.0.1:3000';
const COMPANY_API_URL = import.meta.env.VITE_COMPANY_API_URL || 'http://127.0.0.1:3001';
const PRODUCT_API_URL = import.meta.env.VITE_PRODUCT_API_URL || 'http://127.0.0.1:3002';

const api = axios.create();

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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