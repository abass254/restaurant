import { apiFetch } from './client';
import { apiRoutes } from './routes';
import { clearSessionToken, setSessionToken } from './session';
import type { RiderLoginCode, RiderMe, RiderMeAuth } from './types';

export async function requestLoginCode(body: {
  phone?: string;
  email?: string;
}): Promise<RiderLoginCode> {
  const phone = (body.phone || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  if (!phone && !email) {
    throw new Error('Enter a phone number or email to continue.');
  }
  const res = await apiFetch<{ data: RiderLoginCode }>(apiRoutes.riderAuthRequestCode(), {
    method: 'POST',
    body: JSON.stringify(phone ? { phone } : { email }),
    skipAuth: true,
  });
  return res.data;
}

export async function verifyLoginCode(body: {
  phone?: string;
  email?: string;
  code: string;
}): Promise<RiderMe> {
  const res = await apiFetch<{ data: RiderMeAuth }>(apiRoutes.riderAuthVerifyCode(), {
    method: 'POST',
    body: JSON.stringify(body),
    skipAuth: true,
  });
  const { session_token, csrf_token: _csrf, ...me } = res.data;
  if (!session_token) {
    throw new Error('Server did not return a session token.');
  }
  await setSessionToken(session_token);
  return me;
}

export async function logoutRider(): Promise<void> {
  try {
    await apiFetch(apiRoutes.riderAuthLogout(), {
      method: 'POST',
      body: '{}',
    });
  } catch {
    // Always clear local session
  } finally {
    await clearSessionToken();
  }
}
