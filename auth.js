import { projectUrl, publishableKey } from './config.js';
import { ApiError } from './api.js';

const storageKey = 'a2r-queue-admin:' + projectUrl;
// Clear sessions saved by older releases. Keep this release's tokens in memory.
try { sessionStorage.removeItem(storageKey); } catch {}
let session;
let pendingRefresh;
let sessionVersion = 0;
function save(data) {
  session = data ? {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  } : undefined;
}
async function auth(path, body, token) {
  const headers = { apikey: publishableKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(projectUrl + '/auth/v1/' + path, {
    method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.msg || data.message || 'Could not sign in.');
  return data;
}
export async function signIn(email, password) {
  ++sessionVersion;
  try {
    save(await auth('token?grant_type=password', { email, password }));
  } catch (error) {
    if (error.status === 400 || error.status === 401) throw new ApiError(401, 'The email or password is incorrect.');
    throw error;
  }
}
export async function accessToken() {
  if (!session) throw new ApiError(401, 'Sign in to continue.');
  if (session.expires_at * 1000 > Date.now() + 30000) return session.access_token;
  const version = sessionVersion;
  pendingRefresh ??= auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((data) => {
      if (version !== sessionVersion) throw new ApiError(401, 'Sign in to continue.');
      save(data);
      return data.access_token;
    })
    .catch((error) => {
      if (version === sessionVersion && error.status >= 400 && error.status < 500) save(null);
      throw error;
    }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}
export async function signOut() {
  const currentToken = session?.access_token;
  ++sessionVersion;
  save(null);
  if (currentToken) await auth('logout?scope=local', undefined, currentToken);
}

