import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import CompanyForm from './components/CompanyForm';
import ProductForm from './components/ProductForm';
import Sidebar from './components/Sidebar';

const App = () => {
  const isAuthenticated = !!localStorage.getItem('accessToken');

  return (
    <Router>
      <div className="flex">
        {isAuthenticated && <Sidebar />}
        <div className="flex-1 p-4">
          <Routes>
            <Route path="/login" element={isAuthenticated ? <Navigate to="/companies" /> : <Login />} />
            <Route path="/register" element={isAuthenticated ? <Navigate to="/companies" /> : <Register />} />
            <Route
              path="/companies"
              element={isAuthenticated ? <CompanyForm /> : <Navigate to="/login" />}
            />
            <Route
              path="/products"
              element={isAuthenticated ? <ProductForm /> : <Navigate to="/login" />}
            />
            <Route path="/" element={<Navigate to={isAuthenticated ? "/companies" : "/login"} />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
};

export default App;
