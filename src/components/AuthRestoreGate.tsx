import { Spinner } from './Spinner.js';

/**
 * AuthRestoreGate
 *
 * The single "Signing you in securely" view shown while a silent SSO restore
 * is in flight. Rendered by BOTH SharedAuthProvider and BackendAuthProvider so
 * the affordance is identical everywhere by construction.
 *
 * WHY THIS EXISTS
 *
 * The gate used to live inline in SharedAuthProvider only. BackendAuthProvider
 * — which backs the apps that additionally exchange the shared identity for a
 * server-side session token (mail) — rendered `children` straight through with
 * no gate at all. Each of those apps then invented its own placeholder:
 * cloistr-email rendered a bare "Loading...".
 *
 * The visible result, reported 2026-08-17 on mail.cloistr.xyz: the silent SSO
 * ran on page load, failed, and the user saw neither the fleet's
 * "Signing you in securely" message nor any explanation — mail simply looked
 * like a different product with a different sign-in from the rest of the suite.
 *
 * Keep this component the ONLY place that markup lives. A copy in an app is a
 * copy that will drift.
 */
export interface AuthRestoreGateProps {
  /**
   * Optional message shown when the silent restore FAILED rather than being in
   * flight. Without this a failed restore is indistinguishable from a slow one:
   * the app just lands on its login route with no explanation, which is exactly
   * the "fails silently" complaint this addresses.
   */
  error?: string | null;
}

export function AuthRestoreGate({ error }: AuthRestoreGateProps) {
  return (
    <div
      aria-busy={!error}
      role="status"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        background: 'var(--cloistr-bg)',
      }}
    >
      {!error && <Spinner size="xl" label="Signing you in securely" />}
      <p
        style={{
          color: 'var(--cloistr-text)',
          fontSize: '0.95rem',
          margin: 0,
        }}
      >
        {error ? 'Could not sign you in automatically' : 'Signing you in securely…'}
      </p>
      {/* The reassuring line is the SPECIFIC one, not the adjective.
          "Securely" on its own is filler — every product says it, so it
          carries little signal for the people who need reassurance most.
          What actually settles someone during a wait is a concrete,
          checkable statement, and this one happens to be Cloistr's real
          differentiator at exactly this moment: NIP-46 means the private
          key stays in the signer and only a signature crosses the wire.
          Keep this claim literally true — if a flow is ever added where the
          key does leave the signer, this line must not be shown for it. */}
      <p
        style={{
          color: 'var(--cloistr-text-muted)',
          fontSize: '0.8125rem',
          margin: 0,
          maxWidth: '22rem',
          textAlign: 'center',
        }}
      >
        {error ?? 'Your private key stays in your signer — it is never sent to Cloistr.'}
      </p>
    </div>
  );
}
