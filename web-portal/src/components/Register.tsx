import { useState } from 'react';
import { register } from '../api';
import { useNavigate } from 'react-router-dom';

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
    <div className="container mx-auto p-4 max-w-md">
      <h2 className="text-2xl mb-4">Register</h2>
      {errors.length > 0 && (
        <div className="bg-red-100 text-red-700 p-2 mb-4 rounded">
          {errors.map((error, idx) => (
            <p key={idx}>{error}</p>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Company User"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Email</label>
          <input
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="company@example.com"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Password</label>
          <input
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="securepassword"
            className="w-full p-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Role</label>
          <select
            name="role"
            value={formData.role}
            onChange={handleChange}
            className="w-full p-2 border rounded"
          >
            <option value="company">Company</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Phone Number</label>
          <input
            name="phoneNumber"
            value={formData.phoneNumber}
            onChange={handleChange}
            placeholder="1234567890"
            className="w-full p-2 border rounded"
          />
        </div>
        <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Register
        </button>
      </form>
    </div>
  );
};

export default Register;
