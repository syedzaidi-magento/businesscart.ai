import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import CompanyForm from './components/CompanyForm';
import ProductForm from './components/ProductForm';
import Dashboard from './components/Dashboard';
import Sidebar from './components/Sidebar';

const App = () => {
  const isAuthenticated = !!localStorage.getItem('accessToken');

  return (
    <Router>
      <div className="flex min-h-screen bg-gray-100">
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
            <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
            <Route path="*" element={<div className="p-4 text-center text-gray-600">404 Not Found</div>} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

export default App;