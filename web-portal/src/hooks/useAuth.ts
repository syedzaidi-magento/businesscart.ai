import { useState, useEffect, useCallback } from 'react';
import { logout as apiLogout } from '../api'; // Renamed to avoid conflict

export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('accessToken'));

  const decodeJWT = useCallback((token: string) => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.user?.role ?? null;
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(async () => { // Wrapped in useCallback
    await apiLogout(); // Call the actual API logout
    setIsAuthenticated(false);
  }, []); // No dependencies needed as apiLogout and setIsAuthenticated are stable

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