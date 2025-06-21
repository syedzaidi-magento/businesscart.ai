import { useState, useEffect } from 'react';
import { logout } from '../api';

export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('accessToken'));

  const decodeJWT = (token: string) => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.user?.role || null;
    } catch (err) {
      return null;
    }
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const hasToken = !!localStorage.getItem('accessToken');
      if (hasToken !== isAuthenticated) {
        setIsAuthenticated(hasToken);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(handleStorageChange, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  return { isAuthenticated, logout, decodeJWT };
};