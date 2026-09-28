// Sign in with Strava. Strava tokens never reach the browser: the API exchanges the code and
// keeps them, and we get an HttpOnly session cookie.

import { api, ApiError } from './client';

export interface Account {
  athlete: { id: number; firstname: string; lastname: string; ftp?: number; weightKg?: number };
  canUpload: boolean;
  settings?: unknown;
}

const STATE_KEY = 'bbe.oauthState';
const CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '282789';
const SCOPES = 'read,activity:write,profile:read_all';

/** Leave for Strava's consent page. */
export function startStravaSignIn() {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // Without sessionStorage the state check below fails closed.
  }
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${location.origin}/`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPES,
    state,
  }).toString();
  location.assign(url.toString());
}

/**
 * If this page load is Strava's redirect back, finish sign-in and clean the URL.
 * Returns undefined when this isn't a callback.
 */
export async function completeStravaSignIn(): Promise<{ account?: Account; error?: string } | undefined> {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return undefined;
  history.replaceState(null, '', location.pathname); // don't leave the code in history

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // fall through: state can't match
  }
  if (q.get('error')) return { error: q.get('error') === 'access_denied' ? 'Strava access was declined.' : 'Strava sign-in failed.' };
  if (!expected || q.get('state') !== expected) return { error: 'Sign-in expired or was tampered with. Try again.' };

  try {
    const account = await api<Account>('POST', '/auth/strava', { code: q.get('code'), scope: q.get('scope') ?? '' });
    return { account };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Strava sign-in failed.' };
  }
}

/** The signed-in account, or undefined. Network/API failures also mean "signed out" for now. */
export async function loadAccount(): Promise<Account | undefined> {
  try {
    return await api<Account>('GET', '/me');
  } catch {
    return undefined;
  }
}

export const signOut = () => api('POST', '/auth/logout');
export const saveRemoteSettings = (settings: unknown) => api('PUT', '/me/settings', settings);
export const deleteAccount = () => api('DELETE', '/me');
