import { useEffect, useRef } from 'react';
import { shouldTouchSession, touchSession } from './staySignedIn.js';

/** How often to CHECK whether a touch is due. The touch itself is at most hourly. */
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Keep a sliding "until I sign out" session alive while the app is open.
 *
 * The signer renews it on GET /users/me with the shared cookie, at most about
 * hourly. Apps that never reload (an editor left open for days) would otherwise
 * reach the fixed expiry mid-use. This touches at most once per interval, and
 * again when the tab becomes visible if one is due. Harmless for any other
 * session: a fixed-lifetime sign-in simply is not extended.
 */
export function useSessionKeepAlive(signerUrl: string, enabled: boolean): void {
  const lastTouch = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const maybeTouch = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!shouldTouchSession(lastTouch.current, now)) return;
      lastTouch.current = now;
      void touchSession(signerUrl);
    };
    maybeTouch();
    const timer = setInterval(maybeTouch, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', maybeTouch);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', maybeTouch);
    };
  }, [signerUrl, enabled]);
}
