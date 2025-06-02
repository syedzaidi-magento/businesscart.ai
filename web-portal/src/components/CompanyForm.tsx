import { useState, useEffect } from 'react';
import { createCompany, getCompanies, updateCompany, deleteCompany } from '../api';
import { Company } from '../types';
import Navbar from './Navbar';

const CompanyForm = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [formData, setFormData] = useState({
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

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const data = await getCompanies();
      setCompanies(data);
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Error fetching companies']);
    }
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
    if (formData.sellingArea.radius <= 0) errors.push('Error: Selling area radius must be positive');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    try {
      if (editingId) {
        await updateCompany(editingId, formData);
        setEditingId(null);
      } else {
        await createCompany(formData);
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
      fetchCompanies();
      setErrors([]);
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Failed to save company']);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name.startsWith('address.coordinates.')) {
      const field = name.split('.')[2];
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
      const field = name.split('.')[2];
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
      const field = name.split('.')[1];
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
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCompany(id);
      fetchCompanies();
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Failed to delete company']);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Manage Companies</h2>
          {errors.length > 0 && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mb-6">
              {errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Company Name</label>
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Test Company"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Company Code</label>
              <input
                name="companyCode"
                value={formData.companyCode}
                onChange={handleChange}
                placeholder="CODE123"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Payment Methods (comma-separated)</label>
              <input
                name="paymentMethods"
                value={formData.paymentMethods.join(', ')}
                onChange={handleChange}
                placeholder="cash, credit_card"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Street</label>
              <input
                name="address.street"
                value={formData.address.street}
                onChange={handleChange}
                placeholder="123 Main St"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">City</label>
              <input
                name="address.city"
                value={formData.address.city}
                onChange={handleChange}
                placeholder="Anytown"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">State</label>
              <input
                name="address.state"
                value={formData.address.state}
                onChange={handleChange}
                placeholder="CA"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Zip Code</label>
              <input
                name="address.zip"
                value={formData.address.zip}
                onChange={handleChange}
                placeholder="12345"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="md:col-span-2 w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              {editingId ? 'Update' : 'Create'} Company
            </button>
          </form>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Companies</h3>
          {companies.length === 0 ? (
            <p className="text-gray-600">No companies found.</p>
          ) : (
            <ul className="space-y-4">
              {companies.map((company) => (
                <li key={company._id} className="border-b pb-4 last:border-b-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-800">{company.name} ({company.companyCode})</p>
                      <p className="text-sm text-gray-600">
                        {company.address.street}, {company.address.city}, {company.address.state} {company.address.zip}
                      </p>
                      <p className="text-sm text-gray-600">Payment Methods: {company.paymentMethods.join(', ')}</p>
                    </div>
                    <div className="space-x-2">
                      <button
                        onClick={() => handleEdit(company)}
                        className="bg-yellow-500 text-white px-3 py-1 rounded-md hover:bg-yellow-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(company._id)}
                        className="bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompanyForm;