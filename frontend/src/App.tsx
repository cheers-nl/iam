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

type AuditEvent = {
  eventId: string;
  action: 'CREATE' | 'REVEAL' | 'DELETE' | 'INVITE';
  secretId: string;
  secretTitle: string;
  actorEmail: string | null;
  timestamp: string;
};

type Member = {
  username: string;
  email: string;
  status: string;
  role: 'admin' | 'member';
  createdAt: string;
};

type Whoami = {
  sub: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
  hasVaultAccess: boolean;
};

function loadTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveTokens(t: Tokens) { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }
function clearTokens() { sessionStorage.removeItem(TOKEN_KEY); }

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.');
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}

function rolesFromToken(token: string | undefined): { isAdmin: boolean; hasVaultAccess: boolean; groups: string[]; email: string } {
  if (!token) return { isAdmin: false, hasVaultAccess: false, groups: [], email: '' };
  try {
    const claims = decodeJwtPayload(token);
    const raw = claims['cognito:groups'];
    let groups: string[] = [];
    if (Array.isArray(raw)) groups = raw as string[];
    else if (typeof raw === 'string') groups = raw.replace(/^\[|\]$/g, '').split(/[,\s]+/).filter(Boolean);
    return {
      groups,
      isAdmin: groups.includes('vault-admin'),
      hasVaultAccess: groups.includes('vault-admin') || groups.includes('vault-member'),
      email: (claims['email'] as string) ?? '',
    };
  } catch {
    return { isAdmin: false, hasVaultAccess: false, groups: [], email: '' };
  }
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
  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
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
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401) {
    clearTokens();
    window.location.href = '/';
    throw new Error('session expired, redirecting to login');
  }
  return response;
}

// ------------- Components -------------

function LoginPage() {
  return (
    <div className="container login-page">
      <h1>Team Vault</h1>
      <p>Self-hosted team password vault on your own AWS infrastructure.</p>
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
        <a href="/"><button>Back to home</button></a>
      </div>
    );
  }
  return <div className="container login-page"><p>Finishing sign-in…</p></div>;
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
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      setTitle(''); setLoginUrlVal(''); setUsernameHint(''); setPassword(''); setCategory('GENERAL');
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <h3>Create secret</h3>
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
        {submitting ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

function SecretRow({ secret, isAdmin, onDeleted }: {
  secret: Secret;
  isAdmin: boolean;
  onDeleted: () => void;
}) {
  const [revealing, setRevealing] = useState(false);
  const [detail, setDetail] = useState<SecretDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reveal() {
    if (detail) { setDetail(null); return; }
    setRevealing(true);
    setErr(null);
    try {
      const resp = await apiFetch(`/secrets/${secret.id}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      setDetail(await resp.json());
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setRevealing(false);
    }
  }

  async function del() {
    if (!confirm(`Delete "${secret.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    setErr(null);
    try {
      const resp = await apiFetch(`/secrets/${secret.id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      onDeleted();
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="secret-row">
      <div className="meta">
        <div>
          <div className="title">{secret.title}</div>
          <div className="secondary">
            {secret.category} · {secret.loginUrl ?? 'no URL'} · {new Date(secret.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="row-actions">
          <button onClick={reveal} disabled={revealing || deleting}>
            {detail ? 'Hide' : revealing ? 'Loading…' : 'Reveal'}
          </button>
          {isAdmin && (
            <button className="danger" onClick={del} disabled={deleting || revealing}>
              {deleting ? '…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {detail && (
        <div className="reveal">
          {detail.usernameHint && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: '#6b7280' }}>Username hint: </span>
              {detail.usernameHint}
            </div>
          )}
          <div>
            <span style={{ color: '#6b7280' }}>Password: </span>
            <strong>{detail.password}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function SecretsView({ isAdmin, secrets, loading, err, onCreated, onDeleted }: {
  isAdmin: boolean;
  secrets: Secret[];
  loading: boolean;
  err: string | null;
  onCreated: () => void;
  onDeleted: () => void;
}) {
  return (
    <>
      {isAdmin && <CreateForm onCreated={onCreated} />}
      {!isAdmin && (
        <div className="info-banner">
          You're signed in as a member — you can view and reveal secrets, but creating or deleting is admin-only.
        </div>
      )}
      <h3 className="section-heading">Team secrets</h3>
      {err && <div className="error">{err}</div>}
      {loading && <div className="loading">Loading…</div>}
      {!loading && secrets.length === 0 && (
        <div className="empty">No secrets yet{isAdmin ? ' — create one above' : ' — an admin needs to add some'}.</div>
      )}
      {secrets.map((s) => (
        <SecretRow key={s.id} secret={s} isAdmin={isAdmin} onDeleted={onDeleted} />
      ))}
    </>
  );
}

function ActivityView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await apiFetch('/audit');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      setEvents(data.events ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function badgeClass(action: AuditEvent['action']): string {
    if (action === 'CREATE') return 'badge-create';
    if (action === 'REVEAL') return 'badge-reveal';
    if (action === 'INVITE') return 'badge-invite';
    return 'badge-delete';
  }

  return (
    <>
      <div className="activity-header">
        <h3 className="section-heading">Activity log</h3>
        <button onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {!loading && events.length === 0 && (
        <div className="empty">No activity yet.</div>
      )}
      {events.map((e) => (
        <div className="audit-row" key={e.eventId}>
          <span className={`badge ${badgeClass(e.action)}`}>{e.action}</span>
          <div className="audit-body">
            <div className="audit-title">{e.secretTitle}</div>
            <div className="secondary">
              by {e.actorEmail ?? 'unknown'} · {new Date(e.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function MembersView() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await apiFetch('/members');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      setMembers(data.members ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteMsg(null);
    try {
      const resp = await apiFetch('/members', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      setInviteMsg(`Invited ${inviteEmail} as ${inviteRole}. Cognito has emailed them a sign-in link.`);
      setInviteEmail('');
      setInviteRole('member');
      refresh();
    } catch (e: any) {
      setInviteMsg(`Error: ${e.message ?? String(e)}`);
    } finally {
      setInviting(false);
    }
  }

  return (
    <>
      <form className="create-form" onSubmit={invite}>
        <h3>Invite member</h3>
        <input
          type="email"
          placeholder="teammate@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          required
        />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}>
          <option value="member">Member — list + reveal</option>
          <option value="admin">Admin — full CRUD + invite</option>
        </select>
        {inviteMsg && <div className={inviteMsg.startsWith('Error') ? 'error' : 'info-banner'}>{inviteMsg}</div>}
        <button className="primary" type="submit" disabled={inviting}>
          {inviting ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      <h3 className="section-heading">Team members</h3>
      {err && <div className="error">{err}</div>}
      {loading && <div className="loading">Loading…</div>}
      {members.map((m) => (
        <div className="audit-row" key={m.username}>
          <span className={`badge ${m.role === 'admin' ? 'badge-create' : 'badge-reveal'}`}>
            {m.role.toUpperCase()}
          </span>
          <div className="audit-body">
            <div className="audit-title">{m.email}</div>
            <div className="secondary">
              {m.status} · joined {new Date(m.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function NoAccessPage({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <div className="container login-page">
      <h1>Pending vault access</h1>
      <p>
        You are signed in as <strong>{email}</strong>, but your account has not yet been assigned to a vault role.
        Ask an administrator to invite you again, or to add you to <code>vault-admin</code> or <code>vault-member</code>.
        Until then, no vault data is visible to you.
      </p>
      <p style={{ marginTop: 24 }}>
        <button className="danger" onClick={onLogout}>Sign out</button>
      </p>
    </div>
  );
}

function MainPage() {
  const [view, setView] = useState<'secrets' | 'activity' | 'members'>('secrets');
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [whoami, setWhoami] = useState<Whoami | null>(null);

  const tokens = loadTokens();
  const roles = rolesFromToken(tokens?.id_token);
  const isAdmin = roles.isAdmin;
  const hasVaultAccess = roles.hasVaultAccess;

  useEffect(() => {
    apiFetch('/me')
      .then((r) => r.json())
      .then((w) => setWhoami(w))
      .catch(() => {});
  }, []);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await apiFetch('/secrets');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      setSecrets(data.secrets ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function handleLogout() {
    clearTokens();
    window.location.href = logoutUrl();
  }

  if (!hasVaultAccess) {
    return <NoAccessPage email={roles.email} onLogout={handleLogout} />;
  }

  return (
    <div className="container">
      <header>
        <h1>Team Vault</h1>
        <div className="user-info">
          <span className={`badge ${isAdmin ? 'badge-create' : 'badge-reveal'}`}>
            {isAdmin ? 'ADMIN' : 'MEMBER'}
          </span>
          <span className="user-email">{whoami?.email ?? roles.email}</span>
          <button className="danger" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={view === 'secrets' ? 'tab active' : 'tab'}
          onClick={() => setView('secrets')}
        >
          Secrets
        </button>
        {isAdmin && (
          <button
            className={view === 'activity' ? 'tab active' : 'tab'}
            onClick={() => setView('activity')}
          >
            Activity
          </button>
        )}
        {isAdmin && (
          <button
            className={view === 'members' ? 'tab active' : 'tab'}
            onClick={() => setView('members')}
          >
            Members
          </button>
        )}
      </nav>

      {view === 'secrets' && (
        <SecretsView
          isAdmin={isAdmin}
          secrets={secrets}
          loading={loading}
          err={err}
          onCreated={refresh}
          onDeleted={refresh}
        />
      )}
      {view === 'activity' && isAdmin && <ActivityView />}
      {view === 'members' && isAdmin && <MembersView />}
    </div>
  );
}

export function App() {
  const [version, setVersion] = useState(0);
  const path = window.location.pathname;
  if (path === '/callback') {
    return <CallbackPage onComplete={() => setVersion((v) => v + 1)} />;
  }
  const tokens = loadTokens();
  if (!tokens) return <LoginPage />;
  return <MainPage key={version} />;
}
