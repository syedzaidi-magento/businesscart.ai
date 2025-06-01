import { useState, useEffect } from 'react';
import { createCompany, getCompanies, updateCompany, deleteCompany } from '../api';
import { Company } from '../types';

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
    } catch (err) {
      setErrors(['Failed to fetch companies']);
    }
  };

  const validateForm = () => {
    const errors: string[] = [];
    if (!formData.name) errors.push('Company name is required');
    if (!formData.companyCode) errors.push('Company code is required');
    if (formData.paymentMethods.length === 0) errors.push('At least one payment method is required');
    if (!formData.address.street) errors.push('Street is required');
    if (!formData.address.city) errors.push('City is required');
    if (!formData.address.state) errors.push('State is required');
    if (!formData.address.zip) errors.push('Zip code is required');
    if (formData.sellingArea.radius <= 0) errors.push('Selling area radius must be positive');
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
    <div className="container mx-auto p-4">
      <h2 className="text-2xl mb-4">Manage Companies</h2>
      {errors.length > 0 && (
        <div className="bg-red-100 text-red-700 p-2 mb-4 rounded">
          {errors.map((error, idx) => (
            <p key={idx}>{error}</p>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">Company Name</label>
          <input
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Test Company"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Company Code</label>
          <input
            name="companyCode"
            value={formData.companyCode}
            onChange={handleChange}
            placeholder="CODE123"
            className="w-full p-2 border rounded"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">Payment Methods (comma-separated)</label>
          <input
            name="paymentMethods"
            value={formData.paymentMethods.join(', ')}
            onChange={handleChange}
            placeholder="cash, credit_card"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Street</label>
          <input
            name="address.street"
            value={formData.address.street}
            onChange={handleChange}
            placeholder="123 Main St"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">City</label>
          <input
            name="address.city"
            value={formData.address.city}
            onChange={handleChange}
            placeholder="Anytown"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">State</label>
          <input
            name="address.state"
            value={formData.address.state}
            onChange={handleChange}
            placeholder="CA"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Zip Code</label>
          <input
            name="address.zip"
            value={formData.address.zip}
            onChange={handleChange}
            placeholder="12345"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Address Latitude</label>
          <input
            name="address.coordinates.lat"
            type="number"
            step="any"
            value={formData.address.coordinates.lat}
            onChange={handleChange}
            placeholder="37.7749"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Address Longitude</label>
          <input
            name="address.coordinates.lng"
            type="number"
            step="any"
            value={formData.address.coordinates.lng}
            onChange={handleChange}
            placeholder="-122.4194"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Selling Area Radius (km)</label>
          <input
            name="sellingArea.radius"
            type="number"
            step="any"
            value={formData.sellingArea.radius}
            onChange={handleChange}
            placeholder="10"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Selling Area Center Latitude</label>
          <input
            name="sellingArea.center.lat"
            type="number"
            step="any"
            value={formData.sellingArea.center.lat}
            onChange={handleChange}
            placeholder="37.7749"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Selling Area Center Longitude</label>
          <input
            name="sellingArea.center.lng"
            type="number"
            step="any"
            value={formData.sellingArea.center.lng}
            onChange={handleChange}
            placeholder="-122.4194"
            className="w-full p-2 border rounded"
          />
        </div>
        <button type="submit" className="md:col-span-2 w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          {editingId ? 'Update' : 'Create'} Company
        </button>
      </form>
      <h3 className="text-xl mb-4">Companies</h3>
      <ul className="space-y-2">
        {companies.map((company) => (
          <li key={company._id} className="border p-4 rounded flex justify-between items-center">
            <div>
              <p className="font-bold">{company.name} ({company.companyCode})</p>
              <p>
                {company.address.street}, {company.address.city}, {company.address.state} {company.address.zip}
              </p>
              <p>Payment Methods: {company.paymentMethods.join(', ')}</p>
            </div>
            <div className="space-x-2">
              <button
                onClick={() => handleEdit(company)}
                className="bg-yellow-500 text-white p-1 rounded hover:bg-yellow-600"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(company._id)}
                className="bg-red-500 text-white p-1 rounded hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CompanyForm;
