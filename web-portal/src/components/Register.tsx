import { useState } from 'react';
import { register } from '../api';
import { useNavigate } from 'react-router-dom';
import Navbar from './Navbar';

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'company',
    phoneNumber: '',
  });
  const [errors, setErrors] = useState<string[]>([]);

  const validateForm = () => {
    const errors: string[] = [];
    if (!formData.name) errors.push('Name is required');
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.push('Valid email is required');
    if (!formData.password || formData.password.length < 8) errors.push('Password must be at least 8 characters');
    if (!formData.role) errors.push('Role is required');
    if (!formData.phoneNumber || !/^\d{10}$/.test(formData.phoneNumber)) errors.push('Valid 10-digit phone number is required');
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validateForm();
    setErrors(newErrors);
    if (newErrors.length > 0) return;

    try {
      const { accessToken } = await register(formData);
      localStorage.setItem('accessToken', accessToken);
      setErrors([]);
      navigate('/dashboard');
    } catch (err: any) {
      setErrors([err.response?.data?.message || 'Registration failed']);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navbar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 text-center">Create Your Account</h2>
          {errors.length > 0 && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mb-6">
              {errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Company User"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="company@example.com"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="securepassword"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Role</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="company">Company</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="1234567890"
                className="mt-1 w-full p-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-teal-600 text-white p-2 rounded-md hover:bg-teal-700 transition-colors"
            >
              Register
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <a href="/login" className="text-teal-600 hover:underline">
              Log in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;