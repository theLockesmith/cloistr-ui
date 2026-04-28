/**
 * SharedAuthProvider - Cross-subdomain authentication provider
 *
 * Wraps the collab-common AuthProvider and adds cross-domain session sync.
 * Enables single sign-on across all *.cloistr.xyz services.
 */

import { useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
  isNip07Supported,
} from '../auth';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  hasSharedSession,
  isCloistrDomain,
  type SharedSession,
} from '../lib/session';

export interface SharedAuthProviderProps {
  children: ReactNode;
  /**
   * Whether to automatically connect if a shared session exists.
   * Default: true
   */
  autoConnect?: boolean;
  /**
   * Callback when auto-connect completes (success or failure)
   */
  onAutoConnectComplete?: (success: boolean, pubkey?: string) => void;
}

/**
 * Context for shared session state
 */
interface SharedSessionContextValue {
  /** Whether a shared session cookie exists */
  hasSharedSession: boolean;
  /** Get the shared session data */
  getSharedSession: () => SharedSession | null;
  /** Whether running on a cloistr.xyz domain */
  isCloistrDomain: boolean;
}

const SharedSessionContext = createContext<SharedSessionContextValue | null>(null);

/**
 * Hook to access shared session utilities
 */
export function useSharedSession(): SharedSessionContextValue {
  const context = useContext(SharedSessionContext);
  if (!context) {
    throw new Error('useSharedSession must be used within SharedAuthProvider');
  }
  return context;
}

/**
 * Inner component that handles session sync after auth context is available
 */
function SessionSyncManager({
  children,
  autoConnect,
  onAutoConnectComplete,
}: SharedAuthProviderProps) {
  const { authState, connectNip07, connectNip46 } = useNostrAuth();
  const { isAuthenticated } = useAuthHelpers();
  const autoConnectAttempted = useRef(false);
  const prevConnectedRef = useRef(authState.isConnected);

  /**
   * Sync successful auth to shared session cookies
   */
  useEffect(() => {
    // Only sync if we just became connected (transition from false to true)
    if (authState.isConnected && !prevConnectedRef.current && authState.pubkey && authState.method) {
      // Get bunker URL from localStorage if NIP-46
      let bunkerUrl: string | undefined;
      if (authState.method === 'nip46') {
        try {
          bunkerUrl = localStorage.getItem('cloistr:auth:bunkerUrl') || undefined;
        } catch {
          // localStorage not available
        }
      }

      saveSharedSession({
        method: authState.method,
        pubkey: authState.pubkey,
        bunkerUrl,
      });
    }

    prevConnectedRef.current = authState.isConnected;
  }, [authState.isConnected, authState.pubkey, authState.method]);

  /**
   * Clear shared session on disconnect
   */
  useEffect(() => {
    if (!authState.isConnected && prevConnectedRef.current) {
      // User disconnected - clear shared session
      clearSharedSession();
    }
  }, [authState.isConnected]);

  /**
   * Auto-connect from shared session
   */
  const attemptAutoConnect = useCallback(async () => {
    if (autoConnectAttempted.current || isAuthenticated || authState.isConnecting) {
      return;
    }

    const session = getSharedSession();
    if (!session) {
      onAutoConnectComplete?.(false);
      return;
    }

    autoConnectAttempted.current = true;

    try {
      if (session.method === 'nip07' && isNip07Supported()) {
        await connectNip07();
        onAutoConnectComplete?.(true, session.pubkey);
      } else if (session.method === 'nip46' && session.bunkerUrl) {
        await connectNip46({ bunkerUrl: session.bunkerUrl });
        onAutoConnectComplete?.(true, session.pubkey);
      } else {
        // Session exists but can't restore (e.g., NIP-07 extension not installed)
        onAutoConnectComplete?.(false);
      }
    } catch (error) {
      console.warn('Failed to auto-connect from shared session:', error);
      // Don't clear shared session - might work on another page
      onAutoConnectComplete?.(false);
    }
  }, [isAuthenticated, authState.isConnecting, connectNip07, connectNip46, onAutoConnectComplete]);

  /**
   * Attempt auto-connect on mount
   */
  useEffect(() => {
    if (autoConnect !== false) {
      // Small delay to let the page settle
      const timeout = setTimeout(attemptAutoConnect, 100);
      return () => clearTimeout(timeout);
    }
  }, [autoConnect, attemptAutoConnect]);

  /**
   * Context value for shared session utilities
   */
  const sharedSessionValue: SharedSessionContextValue = {
    hasSharedSession: hasSharedSession(),
    getSharedSession,
    isCloistrDomain: isCloistrDomain(),
  };

  return (
    <SharedSessionContext.Provider value={sharedSessionValue}>
      {children}
    </SharedSessionContext.Provider>
  );
}

/**
 * SharedAuthProvider component
 *
 * Drop-in replacement for AuthProvider that adds cross-subdomain session sync.
 * Use this instead of AuthProvider directly to enable single sign-on.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <SharedAuthProvider>
 *       <YourApp />
 *     </SharedAuthProvider>
 *   );
 * }
 * ```
 */
export function SharedAuthProvider({
  children,
  autoConnect = true,
  onAutoConnectComplete,
}: SharedAuthProviderProps) {
  return (
    <AuthProvider autoRestore={true}>
      <SessionSyncManager
        autoConnect={autoConnect}
        onAutoConnectComplete={onAutoConnectComplete}
      >
        {children}
      </SessionSyncManager>
    </AuthProvider>
  );
}
