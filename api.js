import { projectUrl, publishableKey } from './config.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export async function call(path, { method = 'GET', json, body, accessToken, tracking } = {}) {
  const headers = { apikey: publishableKey };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (body) {
    headers['Content-Type'] = 'application/octet-stream';
  }
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  if (tracking) headers['X-Tracking-Code'] = tracking;
  let response;
  try {
    response = await fetch(projectUrl + '/functions/v1/print-queue/' + path, {
      method, body, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'The connection was interrupted. Try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || 'The queue is temporarily unavailable. Try again.');
  return data;
}

