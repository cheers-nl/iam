import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL as string;
const CLIENT_ID = import.meta.env.VITE_USER_POOL_CLIENT_ID as string;
const HOSTED_UI_BASE = import.meta.env.VITE_HOSTED_UI_BASE as string;
const CALLBACK_URL = import.meta.env.VITE_CALLBACK_URL as string;

const TOKEN_KEY = 'tvl_tokens';

type Tokens = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
};

type Secret = {
  id: string;
  title: string;
  loginUrl: string | null;
  category: string;
  createdAt: string;
};

type SecretDetail = Secret & {
  usernameHint: string | null;
  notes: string | null;
  password: string;
};

function loadTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens) {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

function clearTokens() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.');
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}

function loginUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: CALLBACK_URL,
  });
  return `${HOSTED_UI_BASE}/oauth2/authorize?${params}`;
}

function logoutUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: CALLBACK_URL.replace('/callback', '/'),
  });
  return `${HOSTED_UI_BASE}/logout?${params}`;
}

async function exchangeCodeForTokens(code: string): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: CALLBACK_URL,
  });
  const resp = await fetch(`${HOSTED_UI_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('not authenticated');
  const headers = new Headers(init.headers);
  headers.set('Authorization', tokens.id_token);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

// ------------- Components -------------

function LoginPage() {
  return (
    <div className="container login-page">
      <h1>Team Vault Lite</h1>
      <p>A team password vault, AWS-native demo.</p>
      <a href={loginUrl()}>
        <button className="primary">Sign in with Cognito</button>
      </a>
    </div>
  );
}

function CallbackPage({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      setError('No code in callback URL');
      return;
    }
    exchangeCodeForTokens(code)
      .then((tokens) => {
        saveTokens(tokens);
        // Clean the URL and switch to the main page.
        window.history.replaceState({}, '', '/');
        onComplete();
      })
      .catch((e) => setError(String(e)));
  }, [onComplete]);

  if (error) {
    return (
      <div className="container">
        <h1>Sign-in failed</h1>
        <p className="error">{error}</p>
        <a href="/">
          <button>Back to home</button>
        </a>
      </div>
    );
  }
  return (
    <div className="container login-page">
      <p>Finishing sign-in...</p>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [loginUrlVal, setLoginUrlVal] = useState('');
  const [usernameHint, setUsernameHint] = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await apiFetch('/secrets', {
        method: 'POST',
        body: JSON.stringify({
          title,
          loginUrl: loginUrlVal || null,
          usernameHint: usernameHint || null,
          password,
          category,
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }
      setTitle('');
      setLoginUrlVal('');
      setUsernameHint('');
      setPassword('');
      setCategory('GENERAL');
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Create secret</h3>
      <input placeholder="Title (e.g., 'Company Stripe')" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <input placeholder="Login URL (optional)" value={loginUrlVal} onChange={(e) => setLoginUrlVal(e.target.value)} />
      <input placeholder="Username hint (optional)" value={usernameHint} onChange={(e) => setUsernameHint(e.target.value)} />
      <input type="password" placeholder="Password (required)" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="GENERAL">General</option>
        <option value="PAYMENT">Payment</option>
        <option value="SOCIAL">Social</option>
        <option value="DEV">Dev</option>
      </select>
      {err && <div className="error">{err}</div>}
      <button className="primary" type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create'}
      </button>
    </form>
  );
}

function SecretRow({ secret }: { secret: Secret }) {
  const [revealing, setRevealing] = useState(false);
  const [detail, setDetail] = useState<SecretDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    if (detail) {
      setDetail(null); // hide again
      return;
    }
    setRevealing(true);
    setErr(null);
    try {
      const resp = await apiFetch(`/secrets/${secret.id}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }
      setDetail(await resp.json());
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="secret-row">
      <div className="meta">
        <div>
          <div className="title">{secret.title}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {secret.category} · {secret.loginUrl ?? 'no URL'} · {new Date(secret.createdAt).toLocaleString()}
          </div>
        </div>
        <button onClick={reveal} disabled={revealing}>
          {detail ? 'Hide' : revealing ? 'Loading...' : 'Reveal'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      {detail && (
        <div className="reveal">
          {detail.usernameHint && <div>Username hint: {detail.usernameHint}</div>}
          <div>Password: <strong>{detail.password}</strong></div>
        </div>
      )}
    </div>
  );
}

function MainPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const tokens = loadTokens();
  const claims = tokens ? decodeJwtPayload(tokens.id_token) : null;

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await apiFetch('/secrets');
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }
      const data = await resp.json();
      setSecrets(data.secrets ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleLogout() {
    clearTokens();
    window.location.href = logoutUrl();
  }

  return (
    <div className="container">
      <header>
        <h1>Team Vault Lite</h1>
        <div>
          <span style={{ marginRight: 12, color: '#666' }}>
            {claims?.email as string}
          </span>
          <button className="danger" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <CreateForm onCreated={refresh} />

      <h3>Your secrets</h3>
      {err && <div className="error">{err}</div>}
      {loading && <div>Loading...</div>}
      {!loading && secrets.length === 0 && (
        <div className="empty">No secrets yet. Create one above.</div>
      )}
      {secrets.map((s) => (
        <SecretRow key={s.id} secret={s} />
      ))}
    </div>
  );
}

export function App() {
  const [version, setVersion] = useState(0); // forces re-render after callback
  const path = window.location.pathname;

  if (path === '/callback') {
    return <CallbackPage onComplete={() => setVersion((v) => v + 1)} />;
  }

  const tokens = loadTokens();
  if (!tokens) return <LoginPage />;
  return <MainPage key={version} />;
}
