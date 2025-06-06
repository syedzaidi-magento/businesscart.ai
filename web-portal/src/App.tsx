import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import CompanyForm from './components/CompanyForm';
import ProductForm from './components/ProductForm';
import OrderForm from './components/OrderForm';
import Dashboard from './components/Dashboard';
import Sidebar from './components/Sidebar';
import { useAuth } from './hooks/useAuth';

const App = () => {
  const isAuthenticated = useAuth();

  return (
    <Router>
      <div className="min-h-screen bg-gray-100 flex">
        {isAuthenticated && <Sidebar />}
        <div className="flex-1">
          <Routes>
            <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Register />} />
            <Route
              path="/dashboard"
              element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />}
            />
            <Route
              path="/companies"
              element={isAuthenticated ? <CompanyForm /> : <Navigate to="/login" />}
            />
            <Route
              path="/products"
              element={isAuthenticated ? <ProductForm /> : <Navigate to="/login" />}
            />
            <Route
              path="/orders"
              element={isAuthenticated ? <OrderForm /> : <Navigate to="/login" />}
            />
            <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
            <Route path="*" element={<div className="p-4 text-center text-gray-600">404 Not Found</div>} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

export default App;
