import { useState, useEffect } from 'react';
import { createProduct, getProducts, updateProduct, deleteProduct, getCompanies } from '../api';
import { Product, Company } from '../types';

const ProductForm = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    companyId: '',
    description: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchProducts();
    fetchCompanies();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await getProducts();
      setProducts(data);
    } catch (err) {
      setErrors(['Failed to fetch products']);
    }
  };

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
    if (!formData.name) errors.push('Product name is required');
    if (!formData.price || parseFloat(formData.price) <= 0) errors.push('Price must be a positive number');
    if (!formData.companyId) errors.push('Company is required');
    if (!formData.description) errors.push('Description is required');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    try {
      const payload = {
        ...formData,
        price: parseFloat(formData.price),
      };
      if (editingId) {
        await updateProduct(editingId, payload);
        setEditingId(null);
      } else {
        await createProduct(payload);
      }
      setFormData({ name: '', price: '', companyId: '', description: '' });
      fetchProducts();
      setErrors([]);
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Failed to save product']);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleEdit = (product: Product) => {
    setFormData({
      name: product.name,
      price: product.price.toString(),
      companyId: product.companyId,
      description: product.description,
    });
    setEditingId(product._id);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProduct(id);
      fetchProducts();
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Failed to delete product']);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl mb-4">Manage Products</h2>
      {errors.length > 0 && (
        <div className="bg-red-100 text-red-700 p-2 mb-4 rounded">
          {errors.map((error, idx) => (
            <p key={idx}>{error}</p>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">Product Name</label>
          <input
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Widget"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Price</label>
          <input
            name="price"
            type="number"
            step="0.01"
            value={formData.price}
            onChange={handleChange}
            placeholder="49.99"
            className="w-full p-2 border rounded"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">Company</label>
          <select
            name="companyId"
            value={formData.companyId}
            onChange={handleChange}
            className="w-full p-2 border rounded"
          >
            <option value="">Select Company</option>
            {companies.map((company) => (
              <option key={company._id} value={company._id}>
                {company.name} ({company.companyCode})
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">Description</label>
          <input
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="A cool widget"
            className="w-full p-2 border rounded"
          />
        </div>
        <button type="submit" className="md:col-span-2 w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          {editingId ? 'Update' : 'Create'} Product
        </button>
      </form>
      <h3 className="text-xl mb-4">Products</h3>
      <ul className="space-y-2">
        {products.map((product) => (
          <li key={product._id} className="border p-4 rounded flex justify-between items-center">
            <div>
              <p className="font-bold">{product.name} (${product.price})</p>
              <p>{product.description}</p>
              <p>Company: {companies.find((c) => c._id === product.companyId)?.name || product.companyId}</p>
            </div>
            <div className="space-x-2">
              <button
                onClick={() => handleEdit(product)}
                className="bg-yellow-500 text-white p-1 rounded hover:bg-yellow-600"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(product._id)}
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

export default ProductForm;
