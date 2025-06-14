import { useState, useEffect } from 'react';
import { createOrder, getOrders, updateOrder, deleteOrder } from '../api';
import { Order } from '../types';
import Navbar from './Navbar';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { PencilIcon, TrashIcon, PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import toast, { Toaster } from 'react-hot-toast';

const CACHE_KEY = 'orders_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

const OrderForm = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 10;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');

  const [formData, setFormData] = useState({
    base_grand_total: 0,
    grand_total: 0,
    customer_email: '',
    billing_address: {
      address_type: 'billing',
      city: '',
      country_id: '',
      firstname: '',
      lastname: '',
      postcode: '',
      telephone: '',
      street: [''],
    },
    payment: {
      account_status: 'active',
      additional_information: [''],
      cc_last4: '',
      method: 'credit_card',
    },
    items: [{
      sku: '',
      name: '',
      qty_ordered: 1,
      price: 0,
      row_total: 0,
      product_id: '',
    }],
    company_id: '',
    user_id: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Decode JWT to get userId and companyId
    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const id = payload.user?.id || payload.sub || '';
        const company = payload.user?.company_id || '';
        setUserId(id);
        setCompanyId(company);
        setFormData((prev) => ({
          ...prev,
          user_id: id,
          company_id: company,
        }));
      } catch (e) {
        console.error('Failed to decode token:', e);
        toast.error('Unable to fetch user data. Please enter User ID and Company ID manually.');
      }
    } else {
      toast.error('Please log in to access orders.');
    }

    const loadOrders = async () => {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setOrders(data);
          setFilteredOrders(data);
          return;
        }
      }
      await fetchOrders();
    };
    loadOrders();
  }, []);

  useEffect(() => {
    const filtered = orders.filter((order) =>
      order.customer_email.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredOrders(filtered);
    setCurrentPage(1);
  }, [searchQuery, orders]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const data = await getOrders();
      setOrders(data);
      setFilteredOrders(data);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error fetching orders');
    } finally {
      setIsLoading(false);
    }
  };

  const invalidateCache = () => {
    localStorage.removeItem(CACHE_KEY);
  };

  const validateForm = () => {
    const errors: string[] = [];
    if (formData.base_grand_total <= 0) errors.push('Base grand total must be positive');
    if (formData.grand_total <= 0) errors.push('Grand total must be positive');
    if (!formData.customer_email) errors.push('Customer email is required');
    if (!formData.billing_address.city) errors.push('Billing city is required');
    if (!formData.billing_address.country_id) errors.push('Billing country ID is required');
    if (!formData.billing_address.firstname) errors.push('Billing first name is required');
    if (!formData.billing_address.lastname) errors.push('Billing last name is required');
    if (!formData.billing_address.postcode) errors.push('Billing postcode is required');
    if (!formData.billing_address.telephone) errors.push('Billing telephone is required');
    if (!formData.billing_address.street[0]) errors.push('Billing street is required');
    if (!formData.payment.cc_last4) errors.push('Credit card last 4 digits are required');
    if (!formData.items[0].sku) errors.push('Item SKU is required');
    if (!formData.items[0].name) errors.push('Item name is required');
    if (formData.items[0].qty_ordered <= 0) errors.push('Item quantity must be positive');
    if (formData.items[0].price <= 0) errors.push('Item price must be positive');
    if (formData.items[0].row_total <= 0) errors.push('Item row total must be positive');
    if (!formData.company_id) errors.push('Company ID is required');
    if (!formData.user_id) errors.push('User ID is required');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    setIsLoading(true);
    try {
      const payload = { entity: formData };
      if (editingId) {
        await updateOrder(editingId, payload);
        toast.success('Order updated successfully');
      } else {
        await createOrder(payload);
        toast.success('Order created successfully');
      }
      setFormData({
        base_grand_total: 0,
        grand_total: 0,
        customer_email: '',
        billing_address: {
          address_type: 'billing',
          city: '',
          country_id: '',
          firstname: '',
          lastname: '',
          postcode: '',
          telephone: '',
          street: [''],
        },
        payment: {
          account_status: 'active',
          additional_information: [''],
          cc_last4: '',
          method: 'credit_card',
        },
        items: [{
          sku: '',
          name: '',
          qty_ordered: 1,
          price: 0,
          row_total: 0,
          product_id: '',
        }],
        company_id: companyId,
        user_id: userId,
      });
      setEditingId(null);
      setIsModalOpen(false);
      invalidateCache();
      await fetchOrders();
      setErrors([]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save order');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    section?: 'billing_address' | 'payment' | 'items',
    index?: number,
    field?: string
  ) => {
    const { name, value } = e.target;
    if (section === 'items' && index !== undefined && field) {
      setFormData((prev) => {
        const updatedItems = [...prev.items];
        updatedItems[index] = { ...updatedItems[index], [field]: field === 'qty_ordered' || field === 'price' || field === 'row_total' ? parseFloat(value) || 0 : value };
        return { ...prev, items: updatedItems };
      });
    } else if (section === 'billing_address' && field) {
      setFormData((prev) => ({
        ...prev,
        billing_address: { ...prev.billing_address, [field]: value },
      }));
    } else if (section === 'payment' && field) {
      setFormData((prev) => ({
        ...prev,
        payment: { ...prev.payment, [field]: value },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: name === 'base_grand_total' || name === 'grand_total' ? parseFloat(value) || 0 : value,
      }));
    }
  };

  const handleArrayChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    section: 'billing_address' | 'payment',
    index: number,
    arrayField: 'street' | 'additional_information'
  ) => {
    const value = e.target.value;
    setFormData((prev) => {
      if (section === 'billing_address' && arrayField === 'street') {
        const updatedSection = { ...prev.billing_address };
        updatedSection.street = [...updatedSection.street];
        updatedSection.street[index] = value;
        return { ...prev, billing_address: updatedSection };
      } else if (section === 'payment' && arrayField === 'additional_information') {
        const updatedSection = { ...prev.payment };
        updatedSection.additional_information = [...updatedSection.additional_information];
        updatedSection.additional_information[index] = value;
        return { ...prev, payment: updatedSection };
      }
      return prev;
    });
  };

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { sku: '', name: '', qty_ordered: 1, price: 0, row_total: 0, product_id: '' }],
    }));
  };

  const addStreet = () => {
    setFormData((prev) => ({
      ...prev,
      billing_address: { ...prev.billing_address, street: [...prev.billing_address.street, ''] },
    }));
  };

  const handleEdit = (order: Order) => {
    setFormData({
      base_grand_total: order.base_grand_total,
      grand_total: order.grand_total,
      customer_email: order.customer_email,
      billing_address: { ...order.billing_address, street: [...order.billing_address.street] },
      payment: { ...order.payment, additional_information: [...order.payment.additional_information] },
      items: order.items.map((item) => ({ ...item })),
      company_id: order.company_id,
      user_id: order.user_id,
    });
    setEditingId(order._id);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!orderToDelete) return;
    setIsLoading(true);
    try {
      await deleteOrder(orderToDelete);
      toast.success('Order deleted successfully');
      invalidateCache();
      await fetchOrders();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete order');
    } finally {
      setIsDeleteConfirmOpen(false);
      setOrderToDelete(null);
      setIsLoading(false);
    }
  };

  const openDeleteConfirm = (id: string) => {
    setOrderToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const openModal = () => {
    setFormData({
      base_grand_total: 0,
      grand_total: 0,
      customer_email: '',
      billing_address: {
        address_type: 'billing',
        city: '',
        country_id: '',
        firstname: '',
        lastname: '',
        postcode: '',
        telephone: '',
        street: [''],
      },
      payment: {
        account_status: 'active',
        additional_information: [''],
        cc_last4: '',
        method: 'credit_card',
      },
      items: [{
        sku: '',
        name: '',
        qty_ordered: 1,
        price: 0,
        row_total: 0,
        product_id: '',
      }],
      company_id: companyId,
      user_id: userId,
    });
    setEditingId(null);
    setErrors([]);
    setIsModalOpen(true);
  };

  // Pagination
  const indexOfLastOrder = currentPage * ordersPerPage;
  const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
  const currentOrders = filteredOrders.slice(indexOfFirstOrder, indexOfLastOrder);
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Toaster position="top-right" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">Orders</h2>
          <button
            onClick={openModal}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Add Order</span>
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orders by customer email..."
              className="w-full p-2 pl-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          </div>
        </div>

        {/* Order Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {isLoading ? (
            <div className="p-6 flex justify-center">
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-6 text-center text-gray-600">No orders found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grand Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company ID</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {currentOrders.map((order) => (
                    <tr key={order._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{order._id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{order.customer_email}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${order.grand_total.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{order.company_id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(order)}
                          className="text-yellow-600 hover:text-yellow-800 mr-4"
                          aria-label={`Edit order ${order._id}`}
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openDeleteConfirm(order._id)}
                          className="text-red-600 hover:text-red-800"
                          aria-label={`Delete order ${order._id}`}
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex justify-end space-x-2">
            <button
              onClick={() => paginate(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i + 1}
                onClick={() => paginate(i + 1)}
                className={`px-3 py-1 border border-gray-300 rounded-md text-sm font-medium ${
                  currentPage === i + 1 ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => paginate(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}

        {/* Order Form Modal */}
        <Transition appear show={isModalOpen} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setIsModalOpen(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black bg-opacity-25" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4 text-center">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                      {editingId ? 'Edit Order' : 'Add Order'}
                    </Dialog.Title>
                    {errors.length > 0 && (
                      <div className="mt-4 bg-red-50 text-red-600 p-3 rounded-md">
                        {errors.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Base Grand Total</label>
                          <input
                            name="base_grand_total"
                            type="number"
                            step="0.01"
                            value={formData.base_grand_total}
                            onChange={(e) => handleChange(e)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Grand Total</label>
                          <input
                            name="grand_total"
                            type="number"
                            step="0.01"
                            value={formData.grand_total}
                            onChange={(e) => handleChange(e)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-gray-700">Customer Email</label>
                          <input
                            name="customer_email"
                            type="email"
                            value={formData.customer_email}
                            onChange={(e) => handleChange(e)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {/* Billing Address */}
                      <div>
                        <h4 className="text-md font-medium text-gray-800 mb-2">Billing Address</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">City</label>
                            <input
                              value={formData.billing_address.city}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'city')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Country ID</label>
                            <input
                              value={formData.billing_address.country_id}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'country_id')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">First Name</label>
                            <input
                              value={formData.billing_address.firstname}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'firstname')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Last Name</label>
                            <input
                              value={formData.billing_address.lastname}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'lastname')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Postcode</label>
                            <input
                              value={formData.billing_address.postcode}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'postcode')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Telephone</label>
                            <input
                              value={formData.billing_address.telephone}
                              onChange={(e) => handleChange(e, 'billing_address', undefined, 'telephone')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Street</label>
                            {formData.billing_address.street.map((street, index) => (
                              <input
                                key={index}
                                value={street}
                                onChange={(e) => handleArrayChange(e, 'billing_address', index, 'street')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 mb-2"
                              />
                            ))}
                            <button
                              type="button"
                              onClick={addStreet}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              + Add Street
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Payment */}
                      <div>
                        <h4 className="text-md font-medium text-gray-800 mb-2">Payment</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">CC Last 4</label>
                            <input
                              value={formData.payment.cc_last4}
                              onChange={(e) => handleChange(e, 'payment', undefined, 'cc_last4')}
                              className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Items */}
                      <div>
                        <h4 className="text-md font-medium text-gray-800 mb-2">Items</h4>
                        {formData.items.map((item, index) => (
                          <div key={index} className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700">SKU</label>
                              <input
                                value={item.sku}
                                onChange={(e) => handleChange(e, 'items', index, 'sku')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Name</label>
                              <input
                                value={item.name}
                                onChange={(e) => handleChange(e, 'items', index, 'name')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Quantity</label>
                              <input
                                type="number"
                                value={item.qty_ordered}
                                onChange={(e) => handleChange(e, 'items', index, 'qty_ordered')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Price</label>
                              <input
                                type="number"
                                step="0.01"
                                value={item.price}
                                onChange={(e) => handleChange(e, 'items', index, 'price')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Row Total</label>
                              <input
                                type="number"
                                step="0.01"
                                value={item.row_total}
                                onChange={(e) => handleChange(e, 'items', index, 'row_total')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">Product ID</label>
                              <input
                                value={item.product_id}
                                onChange={(e) => handleChange(e, 'items', index, 'product_id')}
                                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addItem}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          + Add Item
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Company ID</label>
                          <input
                            name="company_id"
                            value={formData.company_id}
                            onChange={(e) => handleChange(e)}
                            placeholder="Enter valid company ID"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">User ID</label>
                          <input
                            name="user_id"
                            value={formData.user_id}
                            onChange={(e) => handleChange(e)}
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div className="mt-6 flex justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => setIsModalOpen(false)}
                          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isLoading ? 'Saving...' : editingId ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </form>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

        {/* Delete Confirmation Modal */}
        <Transition appear show={isDeleteConfirmOpen} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setIsDeleteConfirmOpen(false)}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black bg-opacity-25" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4 text-center">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                      Delete Order
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this order? This action cannot be undone.
                      </p>
                    </div>
                    <div className="mt-6 flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setIsDeleteConfirmOpen(false)}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isLoading}
                        className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        {isLoading ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </div>
    </div>
  );
};

export default OrderForm;