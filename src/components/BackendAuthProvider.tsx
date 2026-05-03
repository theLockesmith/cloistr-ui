/**
 * BackendAuthProvider - Authentication for apps with backend JWT tokens
 *
 * Combines Nostr authentication (NIP-07/NIP-46) with JWT token management.
 * Use this for apps that have a backend requiring JWT auth (like cloistr-tasks).
 *
 * Flow:
 * 1. User authenticates with Nostr (via collab-common)
 * 2. Signed challenge sent to backend
 * 3. Backend verifies signature, issues JWT token
 * 4. JWT used for all subsequent API calls
 * 5. Token auto-refreshed before expiry
 *
 * Also integrates with SharedAuthProvider for cross-subdomain SSO cookies.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { nip19, type UnsignedEvent, type Event as NostrEvent } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';
import {
  AuthProvider,
  connectNip07,
  connectNip46,
  isNip07Supported,
  type SignerInterface,
} from '../auth';
import {
  saveSharedSession,
  clearSharedSession,
  getSharedSession,
  isCloistrDomain,
  renewSession,
} from '../lib/session';

// ============================================
// Types
// ============================================

export interface BackendAuthConfig {
  /** API base URL (default: '/api') */
  apiBase?: string;
  /** Challenge endpoint path (default: '/auth/challenge') */
  challengeEndpoint?: string;
  /** Verify endpoint path (default: '/auth/verify') */
  verifyEndpoint?: string;
  /** Token refresh endpoint path (default: '/auth/refresh') */
  refreshEndpoint?: string;
  /** Token info endpoint path (default: '/auth/token-info') */
  tokenInfoEndpoint?: string;
  /** Minutes before expiry to refresh token (default: 2) */
  refreshBeforeExpiryMinutes?: number;
}

export interface BackendUser {
  pubkey: string;
  [key: string]: unknown;
}

export interface BackendAuthState {
  /** Current user info from backend */
  user: BackendUser | null;
  /** Current JWT token */
  token: string | null;
  /** Token expiry timestamp */
  tokenExpiry: string | null;
  /** Whether auth is loading/initializing */
  loading: boolean;
  /** Whether NIP-07 extension is available */
  extensionAvailable: boolean;
  /** Current auth error message */
  authError: string | null;
}

export interface BackendAuthContextValue extends BackendAuthState {
  /** Login with NIP-07 browser extension */
  loginWithExtension: () => Promise<void>;
  /** Login with NIP-46 bunker URL */
  loginWithBunker: (bunkerUrl: string) => Promise<void>;
  /** Logout and clear all auth state */
  logout: () => void;
  /** Check if user is authenticated */
  isAuthenticated: () => boolean;
  /** Get authorization headers for API calls */
  getAuthHeaders: () => Record<string, string>;
  /** Make authenticated API call with auto-refresh */
  apiCall: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  /** Format pubkey as npub (truncated) */
  formatPubkey: (pubkey: string) => string;
}

// ============================================
// Context
// ============================================

const BackendAuthContext = createContext<BackendAuthContextValue | null>(null);

/**
 * Hook to access backend auth context
 */
export function useBackendAuth(): BackendAuthContextValue {
  const context = useContext(BackendAuthContext);
  if (!context) {
    throw new Error('useBackendAuth must be used within BackendAuthProvider');
  }
  return context;
}

// ============================================
// Provider Props
// ============================================

export interface BackendAuthProviderProps {
  children: ReactNode;
  /** Backend auth configuration */
  config?: BackendAuthConfig;
}

// ============================================
// Inner Provider (with access to Nostr auth context)
// ============================================

interface InnerProviderProps {
  children: ReactNode;
  config: Required<BackendAuthConfig>;
}

function BackendAuthInner({ children, config }: InnerProviderProps) {

  // State
  const [user, setUser] = useState<BackendUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ==========================================
  // Utilities
  // ==========================================

  const formatPubkey = useCallback((pubkey: string): string => {
    try {
      const npub = nip19.npubEncode(pubkey);
      return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
    } catch {
      return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
    }
  }, []);

  const clearAuth = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('user_pubkey');
    setUser(null);
    setToken(null);
    setTokenExpiry(null);
    setAuthError(null);
    clearSharedSession();
  }, []);

  // ==========================================
  // Token Management
  // ==========================================

  const scheduleTokenRefresh = useCallback((expiryTime: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const now = new Date();
    const expiry = new Date(expiryTime);
    const timeUntilExpiry = expiry.getTime() - now.getTime();

    // Refresh before expiry
    const refreshIn = Math.min(
      timeUntilExpiry - config.refreshBeforeExpiryMinutes * 60 * 1000,
      timeUntilExpiry / 2
    );

    if (refreshIn > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshToken();
      }, refreshIn);
    }
  }, [config.refreshBeforeExpiryMinutes]);

  const refreshToken = useCallback(async () => {
    try {
      const currentToken = localStorage.getItem('access_token');
      if (!currentToken) {
        clearAuth();
        return;
      }

      const response = await fetch(`${config.apiBase}${config.refreshEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (!response.ok) {
        clearAuth();
        return;
      }

      const data = await response.json();

      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('token_expiry', data.expires_at);

      setToken(data.access_token);
      setTokenExpiry(data.expires_at);
      scheduleTokenRefresh(data.expires_at);

      // Auto-renew SSO cookies on token refresh
      renewSession();
    } catch {
      clearAuth();
    }
  }, [config.apiBase, config.refreshEndpoint, clearAuth, scheduleTokenRefresh]);

  const validateToken = useCallback(async (): Promise<boolean> => {
    const storedToken = localStorage.getItem('access_token');
    const storedExpiry = localStorage.getItem('token_expiry');

    if (!storedToken || !storedExpiry) {
      clearAuth();
      return false;
    }

    // Check if token is expired
    const now = new Date();
    const expiry = new Date(storedExpiry);
    if (now >= expiry) {
      clearAuth();
      return false;
    }

    try {
      const response = await fetch(`${config.apiBase}${config.tokenInfoEndpoint}`, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });

      if (!response.ok) {
        clearAuth();
        return false;
      }

      const data = await response.json();

      setUser(data.user);
      setToken(storedToken);
      setTokenExpiry(storedExpiry);
      scheduleTokenRefresh(storedExpiry);
      return true;
    } catch {
      clearAuth();
      return false;
    }
  }, [config.apiBase, config.tokenInfoEndpoint, clearAuth, scheduleTokenRefresh]);

  // ==========================================
  // Authentication
  // ==========================================

  const performBackendAuth = useCallback(
    async (signer: SignerInterface) => {
      const pubkey = await signer.getPublicKey();

      // Get challenge from backend
      const challengeResponse = await fetch(`${config.apiBase}${config.challengeEndpoint}`);
      if (!challengeResponse.ok) {
        throw new Error('Failed to get challenge from server');
      }
      const { challenge, nonce } = await challengeResponse.json();

      // Create auth event (NIP-98 style)
      const unsignedEvent: UnsignedEvent = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['challenge', challenge],
          ['nonce', nonce],
        ],
        content: JSON.stringify({ challenge, nonce }),
        pubkey,
      };

      // Sign event
      const signedEvent: NostrEvent = await signer.signEvent(unsignedEvent);

      // Verify signature locally
      if (!verifyEvent(signedEvent)) {
        throw new Error('Invalid signature');
      }

      // Send to backend for verification
      const verifyResponse = await fetch(`${config.apiBase}${config.verifyEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedEvent }),
      });

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json().catch(() => ({}));
        throw new Error(error.error || 'Authentication failed');
      }

      const authResult = await verifyResponse.json();

      // Store auth data
      localStorage.setItem('access_token', authResult.access_token);
      localStorage.setItem('token_expiry', authResult.expires_at);
      localStorage.setItem('user_pubkey', authResult.user.pubkey);

      setUser(authResult.user);
      setToken(authResult.access_token);
      setTokenExpiry(authResult.expires_at);
      scheduleTokenRefresh(authResult.expires_at);

      // Save to shared session for SSO
      saveSharedSession({
        method: 'nip07',
        pubkey: authResult.user.pubkey,
      });
    },
    [config.apiBase, config.challengeEndpoint, config.verifyEndpoint, scheduleTokenRefresh]
  );

  const loginWithExtension = useCallback(async () => {
    setLoading(true);
    setAuthError(null);

    try {
      const signer = await connectNip07();
      await performBackendAuth(signer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      setAuthError(message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [performBackendAuth]);

  const loginWithBunker = useCallback(
    async (bunkerUrl: string) => {
      setLoading(true);
      setAuthError(null);

      try {
        const signer = await connectNip46({ bunkerUrl });
        await performBackendAuth(signer);

        // Save bunker URL to shared session
        saveSharedSession({
          method: 'nip46',
          pubkey: user?.pubkey || '',
          bunkerUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Bunker login failed';
        setAuthError(message);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [performBackendAuth, user?.pubkey]
  );

  const logout = useCallback(() => {
    clearAuth();
  }, [clearAuth]);

  const isAuthenticated = useCallback(() => {
    return !!token && !!user;
  }, [token, user]);

  // ==========================================
  // API Call Helper
  // ==========================================

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const apiCall = useCallback(
    async <T = unknown>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
        ...getAuthHeaders(),
      };

      let response = await fetch(`${config.apiBase}${url}`, {
        ...options,
        headers,
      });

      // Handle 401/403 - try refresh and retry
      if (response.status === 401 || response.status === 403) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.action === 'login_required') {
          clearAuth();
          throw new Error('Session expired. Please log in again.');
        }

        // Try refresh
        await refreshToken();

        // Retry with new token
        const newHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
          ...getAuthHeaders(),
        };

        response = await fetch(`${config.apiBase}${url}`, {
          ...options,
          headers: newHeaders,
        });

        if (!response.ok) {
          clearAuth();
          throw new Error('Session expired. Please log in again.');
        }
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.message || 'Request failed');
      }

      return response.json();
    },
    [config.apiBase, getAuthHeaders, clearAuth, refreshToken]
  );

  // ==========================================
  // Initialization
  // ==========================================

  useEffect(() => {
    const initAuth = async () => {
      setLoading(true);

      // Check for NIP-07 extension
      setExtensionAvailable(isNip07Supported());

      // Try to validate existing token
      const hasValidToken = await validateToken();

      // If no valid token but shared session exists, try auto-login
      if (!hasValidToken && isCloistrDomain()) {
        const session = getSharedSession();
        if (session?.method === 'nip07' && isNip07Supported()) {
          try {
            const signer = await connectNip07();
            await performBackendAuth(signer);
          } catch {
            // Auto-login failed, user needs to login manually
          }
        }
      }

      setLoading(false);
    };

    initAuth();
  }, [validateToken, performBackendAuth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // ==========================================
  // Context Value
  // ==========================================

  const value = useMemo<BackendAuthContextValue>(
    () => ({
      user,
      token,
      tokenExpiry,
      loading,
      extensionAvailable,
      authError,
      loginWithExtension,
      loginWithBunker,
      logout,
      isAuthenticated,
      getAuthHeaders,
      apiCall,
      formatPubkey,
    }),
    [
      user,
      token,
      tokenExpiry,
      loading,
      extensionAvailable,
      authError,
      loginWithExtension,
      loginWithBunker,
      logout,
      isAuthenticated,
      getAuthHeaders,
      apiCall,
      formatPubkey,
    ]
  );

  return <BackendAuthContext.Provider value={value}>{children}</BackendAuthContext.Provider>;
}

// ============================================
// Main Provider
// ============================================

const DEFAULT_CONFIG: Required<BackendAuthConfig> = {
  apiBase: '/api',
  challengeEndpoint: '/auth/challenge',
  verifyEndpoint: '/auth/verify',
  refreshEndpoint: '/auth/refresh',
  tokenInfoEndpoint: '/auth/token-info',
  refreshBeforeExpiryMinutes: 2,
};

/**
 * BackendAuthProvider - Authentication for apps with backend JWT tokens
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <BackendAuthProvider config={{ apiBase: '/api' }}>
 *       <YourApp />
 *     </BackendAuthProvider>
 *   );
 * }
 *
 * function YourComponent() {
 *   const { user, loginWithExtension, apiCall, isAuthenticated } = useBackendAuth();
 *
 *   const fetchData = async () => {
 *     const data = await apiCall('/tasks');
 *     console.log(data);
 *   };
 *
 *   if (!isAuthenticated()) {
 *     return <button onClick={loginWithExtension}>Login</button>;
 *   }
 *
 *   return <div>Welcome, {user?.pubkey}</div>;
 * }
 * ```
 */
export function BackendAuthProvider({ children, config }: BackendAuthProviderProps) {
  const mergedConfig: Required<BackendAuthConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  return (
    <AuthProvider autoRestore={false}>
      <BackendAuthInner config={mergedConfig}>{children}</BackendAuthInner>
    </AuthProvider>
  );
}
