import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1C1C27',
            color: '#E5E7EB',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#25D366', secondary: '#0A0A0F' },
          },
          error: {
            iconTheme: { primary: '#EF4444', secondary: '#0A0A0F' },
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
