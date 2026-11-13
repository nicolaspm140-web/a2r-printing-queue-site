import { projectUrl, publishableKey } from './config.js';
import { ApiError } from './api.js';

const storageKey = 'a2r-queue-admin:' + projectUrl;
let session;
try { session = JSON.parse(sessionStorage.getItem(storageKey)); } catch { session = null; }
let pendingRefresh;
function save(data) {
  session = data;
  if (data) sessionStorage.setItem(storageKey, JSON.stringify(data));
  else sessionStorage.removeItem(storageKey);
}
async function auth(path, body, token) {
  const headers = { apikey: publishableKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(projectUrl + '/auth/v1/' + path, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.msg || data.message || 'Could not sign in.');
  return data;
}
export async function signIn(email, password) {
  save(await auth('token?grant_type=password', { email, password }));
}
export async function accessToken() {
  if (!session) throw new ApiError(401, 'Sign in to continue.');
  if (session.expires_at * 1000 > Date.now() + 30000) return session.access_token;
  pendingRefresh ??= auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((data) => { save(data); return data.access_token; })
    .catch((error) => {
      if (error.status >= 400 && error.status < 500) save(null);
      throw error;
    }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}
export async function signOut() {
  try { await auth('logout?scope=local', undefined, await accessToken()); } finally { save(null); }
}
export function hasSession() { return Boolean(session); }

