/**
 * Sesión del usuario (token + datos) en localStorage.
 * Agrega el header Authorization a axios (api.js) y a fetch hacia /api.
 */

const TOKEN_KEY = 'waba_token';
const USER_KEY = 'waba_user';

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getToken() {
  return safeGet(TOKEN_KEY);
}

export function getStoredUser() {
  try { return JSON.parse(safeGet(USER_KEY) || 'null'); } catch { return null; }
}

export function saveSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* modo privado: la sesión dura lo que la pestaña */ }
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* noop */ }
  window.location.replace('/');
}

/** Se llama cuando el backend responde 401 con una sesión guardada. */
export function handleUnauthorized() {
  if (getToken()) logout();
}

/**
 * Parchea window.fetch para que las llamadas a /api lleven el token
 * (algunas páginas usan fetch directo en lugar del cliente axios).
 */
export function installFetchAuth() {
  if (window.__wabaFetchPatched) return;
  window.__wabaFetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const token = getToken();
    if (token && url.includes('/api/')) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    const res = await original(input, init);
    if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/login')) {
      handleUnauthorized();
    }
    return res;
  };
}
