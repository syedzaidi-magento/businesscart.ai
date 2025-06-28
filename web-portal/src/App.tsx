import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Login from './components/Login';
import Register from './components/Register';
import UserForm from './components/UserForm';
import CompanyForm from './components/CompanyForm';
import ProductForm from './components/ProductForm';
import OrderForm from './components/OrderForm';
import Dashboard from './components/Dashboard';
import Sidebar from './components/Sidebar';
import { useAuth } from './hooks/useAuth';
import Catalog from './pages/Catalog';

const App = () => {
  const { isAuthenticated, decodeJWT } = useAuth();

  const getRedirectPath = () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return '/login';
    const role = decodeJWT(token);
    if (!['customer', 'admin', 'company'].includes(role)) {
      localStorage.removeItem('accessToken');
      return '/login';
    }
    return role === 'customer' ? '/home' : '/dashboard';
  };

  const protectedRoutes = [
    '/dashboard',
    '/companies',
    '/products',
    '/orders',
    '/users',
    '/admin',
    '/admin/users',
    '/admin/products',
    '/admin/orders',
  ];

  return (
    <Router>
      <div className="min-h-screen bg-gray-100 flex">
        {isAuthenticated && (
          <Routes>
            {protectedRoutes.map((path) => (
              <Route key={path} path={path} element={<Sidebar />} />
            ))}
          </Routes>
        )}
        <div className="flex-1">
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/login" element={isAuthenticated ? <Navigate to={getRedirectPath()} replace /> : <Login />} />
            <Route path="/register" element={isAuthenticated ? <Navigate to={getRedirectPath()} replace /> : <Register />} />
            <Route
              path="/dashboard"
              element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/companies"
              element={isAuthenticated ? <CompanyForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/products"
              element={isAuthenticated ? <ProductForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/catalog"
              element={isAuthenticated ? <Catalog /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/orders"
              element={isAuthenticated ? <OrderForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/users"
              element={isAuthenticated ? <UserForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/admin"
              element={isAuthenticated ? <div>Admin Panel</div> : <Navigate to="/login" replace />}
            />
            <Route
              path="/admin/users"
              element={isAuthenticated ? <UserForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/admin/products"
              element={isAuthenticated ? <ProductForm /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/admin/orders"
              element={isAuthenticated ? <OrderForm /> : <Navigate to="/login" replace />}
            />
            <Route path="/" element={<Home />} />
            <Route path="*" element={<div className="p-4 text-center text-gray-600">404 Not Found</div>} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

export default App;