import React, { useState, useEffect } from 'react';
import { getCompanies, createCompany, updateCompany, deleteCompany, updateUserWithCompany } from '../api';
import { Company } from '../types';
import Navbar from './Navbar';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { PencilIcon, TrashIcon, PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import toast, { Toaster } from 'react-hot-toast';

const CACHE_KEY = 'companies_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

const CompanyForm = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const companiesPerPage = 10;
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false);
  const [companyToDelete, setCompanyToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<Company, '_id'>>({
    name: '',
    companyCode: '',
    paymentMethods: ['cash'],
    address: {
      street: '',
      city: '',
      state: '',
      zip: '',
      coordinates: { lat: 0, lng: 0 },
    },
    sellingArea: {
      radius: 0,
      center: { lat: 0, lng: 0 },
    },
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const loadCompanies = async () => {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setCompanies(data);
          setFilteredCompanies(data);
          return;
        }
      }
      await fetchCompanies();
    };
    loadCompanies();
  }, []);

  useEffect(() => {
    const filtered = companies.filter(
      (company) =>
        company.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        company.companyCode.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredCompanies(filtered);
    setCurrentPage(1);
  }, [searchQuery, companies]);

  const fetchCompanies = async () => {
    setIsLoading(true);
    try {
      const data = await getCompanies();
      setCompanies(data);
      setFilteredCompanies(data);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error fetching companies');
    } finally {
      setIsLoading(false);
    }
  };

  const invalidateCache = () => {
    localStorage.removeItem(CACHE_KEY);
  };

  const validateForm = () => {
    const errors: string[] = [];
    if (!formData.name) errors.push('Company name is required');
    if (!formData.companyCode) errors.push('Company code is required');
    if (formData.paymentMethods.length === 0) errors.push('At least one payment method required');
    if (!formData.address.street) errors.push('Street is required');
    if (!formData.address.city) errors.push('City is required');
    if (!formData.address.state) errors.push('State is required');
    if (!formData.address.zip) errors.push('Zip code is required');
    if (formData.sellingArea.radius <= 0) errors.push('Selling area radius must be positive');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    setIsLoading(true);
    try {
      if (editingId) {
        await updateCompany(editingId, formData);
        toast.success('Company updated successfully');
      } else {
        const response = await createCompany(formData);
        toast.success('Company created successfully');
        try {
          await updateUserWithCompany(response._id);
          toast.success('User associated with company successfully');
        } catch (updateError: any) {
          console.error('Failed to associate user with company:', updateError);
          toast.error(updateError.response?.data?.message || 'Failed to associate user with company');
        }
      }
      setFormData({
        name: '',
        companyCode: '',
        paymentMethods: ['cash'],
        address: {
          street: '',
          city: '',
          state: '',
          zip: '',
          coordinates: { lat: 0, lng: 0 },
        },
        sellingArea: {
          radius: 0,
          center: { lat: 0, lng: 0 },
        },
      });
      setEditingId(null);
      setIsModalOpen(false);
      invalidateCache();
      await fetchCompanies();
      setErrors([]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save company');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name.startsWith('address.coordinates.')) {
      const field = name.split('.')[2] as 'lat' | 'lng';
      setFormData({
        ...formData,
        address: {
          ...formData.address,
          coordinates: {
            ...formData.address.coordinates,
            [field]: parseFloat(value) || 0,
          },
        },
      });
    } else if (name.startsWith('sellingArea.center.')) {
      const field = name.split('.')[2] as 'lat' | 'lng';
      setFormData({
        ...formData,
        sellingArea: {
          ...formData.sellingArea,
          center: {
            ...formData.sellingArea.center,
            [field]: parseFloat(value) || 0,
          },
        },
      });
    } else if (name.startsWith('address.')) {
      const field = name.split('.')[1] as keyof Omit<Company['address'], 'coordinates'>;
      setFormData({
        ...formData,
        address: { ...formData.address, [field]: value },
      });
    } else if (name === 'sellingArea.radius') {
      setFormData({
        ...formData,
        sellingArea: { ...formData.sellingArea, radius: parseFloat(value) || 0 },
      });
    } else if (name === 'paymentMethods') {
      setFormData({
        ...formData,
        paymentMethods: value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v),
      });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleEdit = (company: Company) => {
    setFormData({
      name: company.name,
      companyCode: company.companyCode,
      paymentMethods: company.paymentMethods,
      address: company.address,
      sellingArea: company.sellingArea,
    });
    setEditingId(company._id);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!companyToDelete) return;
    setIsLoading(true);
    try {
      await deleteCompany(companyToDelete);
      toast.success('Company deleted successfully');
      invalidateCache();
      await fetchCompanies();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete company');
    } finally {
      setIsDeleteConfirmOpen(false);
      setCompanyToDelete(null);
      setIsLoading(false);
    }
  };

  const openDeleteConfirm = (id: string) => {
    setCompanyToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const openModal = () => {
    setFormData({
      name: '',
      companyCode: '',
      paymentMethods: ['cash'],
      address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        coordinates: { lat: 0, lng: 0 },
      },
      sellingArea: {
        radius: 0,
        center: { lat: 0, lng: 0 },
      },
    });
    setEditingId(null);
    setErrors([]);
    setIsModalOpen(true);
  };

  // Pagination
  const indexOfLastCompany = currentPage * companiesPerPage;
  const indexOfFirstCompany = indexOfLastCompany - companiesPerPage;
  const currentCompanies = filteredCompanies.slice(indexOfFirstCompany, indexOfLastCompany);
  const totalPages = Math.ceil(filteredCompanies.length / companiesPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Toaster position="top-right" />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">Companies</h2>
          <button
            onClick={openModal}
            className="bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 transition-colors flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Add Company</span>
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search companies by name or code..."
              className="w-full p-2 pl-10 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
            />
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          </div>
        </div>

        {/* Company Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {isLoading ? (
            <div className="p-6 flex justify-center">
              <div className="animate-spin h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full"></div>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="p-6 text-center text-gray-600">No companies found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Methods</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {currentCompanies.map((company) => (
                    <tr key={company._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{company._id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{company.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{company.companyCode}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {company.address.street}, {company.address.city}, {company.address.state} {company.address.zip}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{company.paymentMethods.join(', ')}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(company)}
                          className="text-yellow-600 hover:text-yellow-800 mr-4"
                          aria-label={`Edit ${company.name}`}
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openDeleteConfirm(company._id)}
                          className="text-red-600 hover:text-red-800"
                          aria-label={`Delete ${company.name}`}
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
                className={`px-3 py-1 border border-gray-300 rounded-md text-sm font-medium ${currentPage === i + 1 ? 'bg-teal-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
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

        {/* Company Form Modal */}
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
                  <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                      {editingId ? 'Edit Company' : 'Add Company'}
                    </Dialog.Title>
                    {errors.length > 0 && (
                      <div className="mt-4 bg-red-50 text-red-600 p-3 rounded-md">
                        {errors.map((error, idx) => (
                          <p key={idx}>{error}</p>
                        ))}
                      </div>
                    )}
                    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Company Name</label>
                          <input
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="Test Company"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Company Code</label>
                          <input
                            name="companyCode"
                            value={formData.companyCode}
                            onChange={handleChange}
                            placeholder="CODE123"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700">Payment Methods (comma-separated)</label>
                          <input
                            name="paymentMethods"
                            value={formData.paymentMethods.join(', ')}
                            onChange={handleChange}
                            placeholder="cash, credit_card"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Street</label>
                          <input
                            name="address.street"
                            value={formData.address.street}
                            onChange={handleChange}
                            placeholder="123 Main St"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">City</label>
                          <input
                            name="address.city"
                            value={formData.address.city}
                            onChange={handleChange}
                            placeholder="Anytown"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">State</label>
                          <input
                            name="address.state"
                            value={formData.address.state}
                            onChange={handleChange}
                            placeholder="CA"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Zip Code</label>
                          <input
                            name="address.zip"
                            value={formData.address.zip}
                            onChange={handleChange}
                            placeholder="12345"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Address Latitude</label>
                          <input
                            name="address.coordinates.lat"
                            type="number"
                            step="any"
                            value={formData.address.coordinates.lat}
                            onChange={handleChange}
                            placeholder="37.7749"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Address Longitude</label>
                          <input
                            name="address.coordinates.lng"
                            type="number"
                            step="any"
                            value={formData.address.coordinates.lng}
                            onChange={handleChange}
                            placeholder="-122.4194"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Selling Area Radius (km)</label>
                          <input
                            name="sellingArea.radius"
                            type="number"
                            step="any"
                            value={formData.sellingArea.radius}
                            onChange={handleChange}
                            placeholder="10"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Selling Area Center Latitude</label>
                          <input
                            name="sellingArea.center.lat"
                            type="number"
                            step="any"
                            value={formData.sellingArea.center.lat}
                            onChange={handleChange}
                            placeholder="37.7749"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Selling Area Center Longitude</label>
                          <input
                            name="sellingArea.center.lng"
                            type="number"
                            step="any"
                            value={formData.sellingArea.center.lng}
                            onChange={handleChange}
                            placeholder="-122.4194"
                            className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
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
                          className="px-4 py-2 bg-teal-600 text-white rounded-md text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
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
                      Delete Company
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this company? This action cannot be undone.
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

export default CompanyForm;