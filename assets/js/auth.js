const AUTH_KEY = 'sowa-demo-auth-v1';

export function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return session && typeof session.user === 'string' ? session : null;
  } catch {
    return null;
  }
}

export function login(user) {
  const session = { user, loggedInAt: new Date().toISOString() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}
