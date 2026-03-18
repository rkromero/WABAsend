/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fondos base
        base: {
          DEFAULT: '#0A0A0F',
          surface: '#13131A',
          elevated: '#1C1C27',
          border: 'rgba(255,255,255,0.06)',
        },
        // Acento principal — verde WhatsApp/eléctrico
        accent: {
          DEFAULT: '#25D366',
          muted: '#1a9e4a',
          subtle: 'rgba(37,211,102,0.12)',
          glow: 'rgba(37,211,102,0.25)',
        },
        // Semánticos para estados de mensaje
        status: {
          sent: '#6B7280',      // gris
          delivered: '#F59E0B', // amarillo
          read: '#25D366',      // verde
          failed: '#EF4444',    // rojo
          pending: '#4B5563',   // gris oscuro
          scheduled: '#3B82F6', // azul
          running: '#F59E0B',   // amarillo
          completed: '#25D366', // verde
        },
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        accent: '0 0 20px rgba(37,211,102,0.15)',
        'accent-lg': '0 0 40px rgba(37,211,102,0.2)',
      },
      backdropBlur: {
        glass: '12px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
        'progress-fill': 'progressFill 0.8s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        progressFill: {
          '0%': { width: '0%' },
          '100%': { width: 'var(--progress-width)' },
        },
      },
    },
  },
  plugins: [],
};
