/**
 * Cliente Axios configurado para el backend WABA Sender.
 * Todas las llamadas a la API pasan por aquí.
 */
import axios from 'axios';
import { getToken, handleUnauthorized } from './auth.js';

const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'; // En desarrollo, el proxy de Vite redirige al backend local

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor de request: agrega el token de sesión
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Interceptor de respuesta: normaliza errores
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      handleUnauthorized();
    }
    const message =
      error.response?.data?.error ||
      error.message ||
      'Error de conexión con el servidor';
    return Promise.reject(new Error(message));
  }
);

export default api;
