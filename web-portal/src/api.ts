import axios from 'axios';
import { Account, Product, Order, Cart, Quote, CompanyLocation, CustomerAddress, CustomerConfiguration, CreateQuoteRequest, BlogPost } from './types';

const API_URL = import.meta.env.VITE_API_URL;

// One-shot handoff from Register to Login when the account was created but the
// follow-up login failed. Lives here because both components already import from
// this module, so it adds no new import edge between them.
export const SIGNUP_NOTICE_KEY = 'bc_signup_notice';

const api = axios.create();

api.interceptors.request.use((config) => {
  console.log('Starting Request', {
    url: config.url,
    method: config.method,
    headers: config.headers,
    data: config.data,
  });

  const token = localStorage.getItem('accessToken');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000;
      if (Date.now() >= expiry) {
        console.log('Token expired, removing from storage and redirecting to login.');
        localStorage.removeItem('accessToken');
        window.location.href = '/login';
        throw new Error('Token expired');
      }
      config.headers.Authorization = `Bearer ${token}`;
    } catch (e) {
      console.error('Error processing token:', e);
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    console.log('Response:', {
      status: response.status,
      url: response.config.url,
      data: response.data,
    });
    return response;
  },
  (error) => {
    console.error('Response Error:', {
      status: error.response?.status,
      url: error.config?.url,
      data: error.response?.data,
      message: error.message,
    });

    if (error.response?.status === 401) {
      console.log('Unauthorized, removing token and redirecting to login.');
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
  code?: string;
  customerCodes?: string[];
  phoneNumber?: string;
}): Promise<{ accessToken: string; account: Account }> => {
  const response = await api.post(`${API_URL}/accounts/register`, data);
  return response.data;
};

export const login = async (data: { email: string; password: string }): Promise<{ accessToken: string; account: Account }> => {
  const response = await api.post(`${API_URL}/accounts/login`, data);
  return response.data;
};

export const logout = async (): Promise<void> => {
  try {
    const token = localStorage.getItem('accessToken');
    if (token) {
      await api.post(`${API_URL}/accounts/logout`, {});
    }
  } catch (_) {
    // Intentionally left empty
  } finally {
    const keep = ['bc_visitor_id', 'bc_attribution'];
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (!keep.includes(key)) localStorage.removeItem(key);
    }
  }
};

export const forgotPassword = async (email: string): Promise<void> => {
  await api.post(`${API_URL}/accounts/forgot-password`, { email });
};

export const resetPassword = async (token: string, password: string): Promise<void> => {
  await api.post(`${API_URL}/accounts/reset-password`, { token, password });
};

export const getAccounts = async (): Promise<Account[]> => {
  const response = await api.get(`${API_URL}/accounts`);
  return response.data || [];
};

export const exportCustomers = async (): Promise<void> => {
  const response = await api.get(`${API_URL}/accounts/export`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'customers.csv';
  a.click();
  window.URL.revokeObjectURL(url);
};

// Download a CSV of orders for a date range. Format selects the column shape:
//   - 'generic': full ledger (accounting reconciliation, monthly reports, tax)
//   - 'google':  Google Ads offline click-conversions upload (gclid orders)
//   - 'bing':    Microsoft Advertising bulk offline conversions (msclkid orders)
// Mirrors the customer export pattern at /accounts/export.
export const exportOrders = async (
  from: string,        // ISO-8601 (RFC3339)
  to: string,          // ISO-8601 (RFC3339)
  format: 'generic' | 'google' | 'bing' = 'generic',
  conversionName?: string,
  sellerId?: string,   // admin only; ignored for company role
): Promise<void> => {
  const params = new URLSearchParams({ from, to, format });
  if (conversionName && format !== 'generic') params.set('conversionName', conversionName);
  if (sellerId) params.set('sellerId', sellerId);
  const response = await api.get(`${API_URL}/checkout/orders/export?${params}`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  const prefix = format === 'generic' ? 'orders' : format === 'google' ? 'orders-google-ads' : 'orders-microsoft-ads';
  a.download = `${prefix}-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
};

export const getAccount = async (id: string): Promise<Account> => {
  const response = await api.get(`${API_URL}/accounts/${id}`);
  return response.data;
};

export const updateAccount = async (id: string, data: Partial<Omit<Account, '_id'>>): Promise<Account> => {
  const response = await api.patch(`${API_URL}/accounts/${id}`, data);
  return response.data;
};

export const regenerateStorefront = async (accountId: string): Promise<void> => {
  await api.post(`${API_URL}/accounts/${accountId}/regenerate`);
};

export const deleteAccount = async (id: string): Promise<void> => {
  await api.delete(`${API_URL}/accounts/${id}`);
};

export const createCodes = async (data: { companyCode: string; customerCode: string; partnerCode?: string }): Promise<void> => {
  await api.post(`${API_URL}/codes`, data);
};

export const getCode = async (code: string): Promise<any> => {
  const response = await api.get(`${API_URL}/codes/${code}`);
  return response.data;
};

export const getCodes = async (): Promise<any[]> => {
  const response = await api.get(`${API_URL}/codes`);
  return response.data;
};

export const getUploadUrl = async (contentType: string, fileExtension: string, slug?: string): Promise<{
  uploadUrl: string;
  imageUrl: string;
}> => {
  const response = await api.post(`${API_URL}/products/upload-url`, { contentType, fileExtension, slug });
  return response.data;
};

// Company logo. Same presign endpoint, but the backend stores it at the fixed
// key <companyId>/assets/logo so a re-upload replaces the previous file instead
// of leaving one object per upload. companyId is only honoured for admins; a
// company account always writes under its own prefix.
export const getLogoUploadUrl = async (contentType: string, companyId?: string): Promise<{
  uploadUrl: string;
  imageUrl: string;
}> => {
  const response = await api.post(`${API_URL}/products/upload-url`, { contentType, kind: 'logo', companyId });
  return response.data;
};

export const uploadFileToS3 = async (uploadUrl: string, file: File): Promise<void> => {
  await axios.put(uploadUrl, file, {
    headers: { 'Content-Type': file.type },
  });
};

export const createProduct = async (data: Omit<Product, '_id'>): Promise<Product> => {
  const response = await api.post(`${API_URL}/products`, data);
  return response.data;
};

export const getProducts = async (): Promise<Product[]> => {
  const response = await api.get(`${API_URL}/products`);
  console.log('Products fetched:', response.data);
  return response.data || [];
};

export const updateProduct = async (id: string, data: Partial<Product>): Promise<Product> => {
  const response = await api.put(`${API_URL}/products/${id}`, data);
  return response.data;
};

export const deleteProduct = async (id: string): Promise<void> => {
  await api.delete(`${API_URL}/products/${id}`);
};

export const createBlogPost = async (data: Omit<BlogPost, '_id' | 'createdAt' | 'updatedAt'>): Promise<BlogPost> => {
  const response = await api.post(`${API_URL}/blog`, data);
  return response.data;
};

export const getBlogPosts = async (): Promise<BlogPost[]> => {
  const response = await api.get(`${API_URL}/blog`);
  return response.data;
};

export const getBlogPost = async (id: string): Promise<BlogPost> => {
  const response = await api.get(`${API_URL}/blog/${id}`);
  return response.data;
};

export const updateBlogPost = async (id: string, data: Partial<BlogPost>): Promise<BlogPost> => {
  const response = await api.put(`${API_URL}/blog/${id}`, data);
  return response.data;
};

export const deleteBlogPost = async (id: string): Promise<void> => {
  await api.delete(`${API_URL}/blog/${id}`);
};

export const deleteOrder = async (id: string): Promise<void> => {
  await api.delete(`${API_URL}/checkout/orders/${id}`);
};

export const deleteCode = async (code: string): Promise<void> => {
  await api.delete(`${API_URL}/codes/${code}`);
};

export const createOrder = async (data: {
  quoteId: string;
  paymentMethod: string;
  deliveryMethod: string;
  pickupLocationId?: string;
  deliveryAddressId?: string;
  returnUrl?: string;
}): Promise<Order | { redirectUrl: string; paymentSessionId: string }> => {
  const response = await api.post(`${API_URL}/checkout/orders`, data);
  return response.data;
};

// --- Payment Gateway Config ---

export interface GatewayConfigResponse {
  id: string;
  sellerId: string;
  gateway: string;
  displayName: string;
  sandbox: boolean;
  credentialKeys: string[];
  sandboxCredentialKeys: string[];
  credentialLast4?: Record<string, string>;
  sandboxCredentialLast4?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const getGatewayConfigs = async (sellerId: string): Promise<GatewayConfigResponse[]> => {
  const response = await api.get(`${API_URL}/checkout/gateways/${sellerId}`);
  return response.data;
};

export const saveGatewayConfig = async (sellerId: string, data: {
  gateway: string;
  displayName: string;
  credentials?: Record<string, string>;
  sandboxCredentials?: Record<string, string>;
  sandbox: boolean;
}): Promise<void> => {
  await api.put(`${API_URL}/checkout/gateways/${sellerId}`, data);
};

export const deleteGatewayConfig = async (sellerId: string, gateway: string): Promise<void> => {
  await api.delete(`${API_URL}/checkout/gateways/${sellerId}/${gateway}`);
};

export const getOrders = async (sellerId?: string): Promise<Order[]> => {
  const url = sellerId ? `${API_URL}/checkout/orders?sellerId=${sellerId}` : `${API_URL}/checkout/orders`;
  console.log('Fetching orders from:', url);
  const response = await api.get(url);
  // Guard against a null/absent body so callers never .reduce/.map on null
  // (a null orders response previously crashed the dashboard).
  return response.data || [];
};

export const updateOrder = async (
  id: string,
  data: {
    status?: string;
    trackingCarrier?: string;
    trackingNumber?: string;
    stripeRefundID?: string;
    refundAmount?: number;
    refundReason?: string;
    refundItemAdjustments?: { productID: string; quantity: number; lineAmount: number }[];
  }
): Promise<Order> => {
  const response = await api.put(`${API_URL}/checkout/orders/${id}`, data);
  return response.data;
};

// Sends a post-purchase review-request email to the customer and marks
// reviewRequestedAt on the order. Admin/company role only.
export const requestOrderReview = async (orderId: string): Promise<Order> => {
  const response = await api.post(`${API_URL}/checkout/orders/${orderId}/request-review`, {});
  return response.data;
};

// ─── Billing statements ─────────────────────────────────────────────
// Mirrors checkout-service Statement struct + send-statement endpoint.

export interface Statement {
  sellerId: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  totalGrandTotal: number;
  // Refunds issued in the period. Absent when zero (omitempty on the Go side).
  // totalGrandTotal stays GROSS; transaction fees are charged on gross minus this.
  totalRefunded?: number;
  tier: 'Starter' | 'Growth' | 'Enterprise';
  monthlyFee: number;
  perOrderRate: number;
  perOrderCap?: number;
  transactionFees: number;
  totalDue: number;
}

export const getStatement = async (sellerId: string, from: string, to: string): Promise<Statement> => {
  const response = await api.get(`${API_URL}/checkout/orders/statement?sellerId=${encodeURIComponent(sellerId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return response.data;
};

export interface SendStatementPayload {
  sellerId: string;
  from: string;
  to: string;
  recipientEmail: string;
  companyName: string;
  periodLabel: string;
  paymentInstructions?: string;
  dryRun: boolean;
  // Opt in to billing a period that already has a statement. The backend refuses
  // a duplicate with 409 unless this is set, so a stale page cannot double-bill
  // a company by showing no warning. Set only after the caller has actually
  // shown the operator the existing statement.
  allowDuplicate?: boolean;
}

export interface SendStatementResponse {
  dryRun: boolean;
  sent?: boolean;
  recipient: string;
  subject?: string;
  htmlBody?: string;
  textBody?: string;
  statement: Statement;
  snapshot?: PersistedStatement;
}

export const sendStatement = async (payload: SendStatementPayload): Promise<SendStatementResponse> => {
  const response = await api.post(`${API_URL}/checkout/orders/statement/send`, payload);
  return response.data;
};

// PersistedStatement is a snapshot stored at admin Send time. Includes audit
// fields the live-computed Statement doesn't have.
export interface PersistedStatement extends Statement {
  id: string;
  periodLabel?: string;
  recipientEmail: string;
  companyName?: string;
  paymentInstructions?: string;
  sentAt: string;
  sentByAdminId?: string;
  paidAt?: string;
  paymentReference?: string;
}

export const getStatements = async (sellerId: string): Promise<PersistedStatement[]> => {
  const response = await api.get(`${API_URL}/checkout/statements?sellerId=${encodeURIComponent(sellerId)}`);
  return response.data;
};

// Admin retraction — deletes a statement that was sent in error.
export const deleteStatement = async (id: string): Promise<void> => {
  await api.delete(`${API_URL}/checkout/statements/${encodeURIComponent(id)}`);
};

// Admin payment settlement. Writes the paidAt / paymentReference fields the
// model reserved from the start. paid:false clears both.
export const setStatementPaid = async (
  id: string,
  paid: boolean,
  paymentReference?: string
): Promise<PersistedStatement> => {
  const response = await api.put(`${API_URL}/checkout/statements/${encodeURIComponent(id)}`, {
    paid,
    paymentReference: paymentReference || '',
  });
  return response.data;
};

export const addItemToCart = async (data: { entity: { productId: string; quantity: number; sellerId: string; partnerId?: string; name: string; price: number, discountedPrice?: number, image?: string, dealPrice?: number } }, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart`;
  if (accountId) {
    url += `?accountId=${accountId}`;
  }
  const response = await api.post(url, data);
  return response.data;
};

export const getCart = async (sellerId: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart?sellerId=${sellerId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }
  const response = await api.get(url);
  return response.data;
};

export const updateCartItem = async (itemId: string, data: { entity: { quantity: number; price?: number; discountedPrice?: number } }, sellerId: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart/${itemId}?sellerId=${sellerId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }
  const response = await api.put(url, data);
  return response.data;
};

export const removeItemFromCart = async (itemId: string, sellerId: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart/${itemId}?sellerId=${sellerId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }
  const response = await api.delete(url);
  return response.data;
};

export const clearCart = async (sellerId: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart?sellerId=${sellerId}`;
  if (accountId) {
    url += `&accountId=${accountId}`;
  }
  const response = await api.delete(url);
  return response.data;
};

// Saved Cart (Requisition List) actions — reuse POST /checkout/cart (no new route).
export const saveCartList = async (sellerId: string, name: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart`;
  if (accountId) url += `?accountId=${accountId}`;
  const response = await api.post(url, { savedListAction: 'save', savedListName: name, sellerId });
  return response.data;
};

export const deleteCartList = async (sellerId: string, name: string, accountId?: string): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart`;
  if (accountId) url += `?accountId=${accountId}`;
  const response = await api.post(url, { savedListAction: 'delete', savedListName: name, sellerId });
  return response.data;
};

export const loadCartList = async (
  sellerId: string,
  items: { productId: string; quantity: number; sellerId: string; name: string; price: number; discountedPrice?: number; image?: string }[],
  accountId?: string,
): Promise<Cart> => {
  let url = `${API_URL}/checkout/cart`;
  if (accountId) url += `?accountId=${accountId}`;
  const response = await api.post(url, { savedListAction: 'load', sellerId, items });
  return response.data;
};

export const getAssociatedCompanyIds = async (): Promise<string[]> => {
  const jwt = localStorage.getItem('accessToken');
  if (!jwt) {
    throw new Error('No JWT found');
  }
  const payload = JSON.parse(atob(jwt.split('.')[1]));
  // This needs to be updated based on how customer/company association is stored in the JWT
  // For now, returning an empty array.
  return payload.user?.associate_company_ids || [];
};

export const createQuote = async (data: CreateQuoteRequest): Promise<Quote> => {
  const response = await api.post(`${API_URL}/checkout/quotes`, data);
  return response.data;
};

export const getUserClaims = async (): Promise<any> => {
  const jwt = localStorage.getItem('accessToken');
  if (!jwt) {
    throw new Error('No JWT found');
  }
  return JSON.parse(atob(jwt.split('.')[1]));
};

export const getCustomerConfigurations = async (): Promise<CustomerConfiguration[]> => {
  const claims = await getUserClaims();
  return claims.user?.customerConfig || [];
};

export const getQuote = async (quoteId: string): Promise<Quote> => {
  const response = await api.get(`${API_URL}/checkout/quotes/${quoteId}`);
  return response.data;
};

export const getMyQuotes = async (sellerId?: string): Promise<Quote[]> => {
  const url = sellerId ? `${API_URL}/checkout/quotes?sellerId=${sellerId}` : `${API_URL}/checkout/quotes`;
  const response = await api.get(url);
  return response.data;
};
export const patchQuote = async (quoteId: string, operation: string, value: any): Promise<Quote> => {
  const response = await api.patch(`${API_URL}/checkout/quotes/${quoteId}`, { operation, value });
  return response.data;
};

export const getCompanyLocations = async (companyId: string): Promise<CompanyLocation[]> => {
  const response = await api.get(`${API_URL}/accounts/locations/${companyId}`);
  return response.data;
};

export const upsertCompanyLocation = async (companyId: string, location: Partial<CompanyLocation>): Promise<CompanyLocation> => {
  const response = await api.post(`${API_URL}/accounts/locations/${companyId}`, location);
  return response.data;
};

export const deleteCompanyLocation = async (companyId: string, locationId: string): Promise<void> => {
  await api.delete(`${API_URL}/accounts/locations/${companyId}/${locationId}`);
};

// Customer Address specific functions
export const getCustomerAddresses = async (customerId: string): Promise<CustomerAddress[]> => {
  const response = await api.get(`${API_URL}/accounts/locations/${customerId}`);
  return response.data;
};

export const upsertCustomerAddress = async (customerId: string, address: Partial<CustomerAddress>): Promise<CustomerAddress> => {
  const response = await api.post(`${API_URL}/accounts/locations/${customerId}`, address);
  return response.data;
};

export const deleteCustomerAddress = async (customerId: string, addressId: string): Promise<void> => {
  await api.delete(`${API_URL}/accounts/locations/${customerId}/${addressId}`);
};

export const updateCustomerConfiguration = async (
  customerId: string,
  config: Partial<CustomerConfiguration> & { groupID?: string }
): Promise<void> => {
  await api.patch(`${API_URL}/customers/${customerId}/configuration`, config);
};

export const associateCompany = async (customerCode: string): Promise<void> => {
  const claims = await getUserClaims();
  const customerId = claims.user.id;
  await api.patch(`${API_URL}/customers/${customerId}/associate`, { customerCode });
};

export const getVisitorStats = async (sellerId?: string, since?: string): Promise<any> => {
  const params = new URLSearchParams();
  if (sellerId) params.set('sellerId', sellerId);
  if (since) params.set('since', since);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await api.get(`${API_URL}/visitors/stats${query}`);
  return response.data;
};

export const getVisitors = async (params?: Record<string, string>): Promise<any> => {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  const response = await api.get(`${API_URL}/visitors${query}`);
  return response.data;
};

export const updateD2CConfig = async (accountId: string, config: any): Promise<void> => {
  await api.patch(`${API_URL}/accounts/${accountId}`, {
    company: {
      d2c: config
    }
  });
};