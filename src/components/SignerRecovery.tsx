import type { ReactNode } from 'react';
import { classifySignerError, signerFailureMessage } from '../lib/signerRetry.js';

/**
 * The "uh-oh" panel for a signing failure that is NOT a sign-out.
 *
 * WHY THIS EXISTS
 *
 * A missed approval or an unreachable relay used to drop the user back at an
 * authentication screen. That is wrong twice over: the session was still
 * perfectly valid, and asking for credentials teaches people that a network
 * blip means "prove who you are again" — the exact habit a key-based product
 * must not build.
 *
 * So this offers a way FORWARD (retry) and a way BACK, and never a credential
 * prompt. There is deliberately no such affordance anywhere in this component,
 * and a test asserts it — because the obvious "helpful" future edit is to add
 * one for a user who looks stuck.
 *
 * (That test matches on the literal words, so this comment avoids them too.)
 *
 * RETRY IS ALWAYS USER-INITIATED HERE. The prohibition in signerRetry is on
 * retrying a refusal AUTOMATICALLY — a person choosing to try again, having
 * seen what happened, is a different thing. For a declined request the retry is
 * demoted to secondary, because going back is almost always what they want.
 */
export interface SignerRecoveryProps {
  /** The error that came back from the signing attempt. */
  error: unknown;
  /** Try the same operation again. */
  onRetry?: () => void;
  /** Leave, with the session intact. */
  onGoBack?: () => void;
  /** True while a retry is in flight. */
  retrying?: boolean;
  /** Optional extra context rendered under the message. */
  children?: ReactNode;
}

export function SignerRecovery({
  error,
  onRetry,
  onGoBack,
  retrying = false,
  children,
}: SignerRecoveryProps) {
  const kind = classifySignerError(error);
  const { title, detail } = signerFailureMessage(error);

  // A refusal will not change its mind on the next attempt, so "go back" leads.
  const retryIsPrimary = kind !== 'terminal';

  return (
    <div className="cloistr-signer-recovery" role="alert" aria-live="polite">
      <div className="cloistr-signer-recovery-icon" aria-hidden="true">
        {kind === 'terminal' ? '🚫' : '📡'}
      </div>

      <h2 className="cloistr-signer-recovery-title">{title}</h2>
      <p className="cloistr-signer-recovery-detail">{detail}</p>

      {children}

      <div className="cloistr-signer-recovery-actions">
        {onRetry && (
          <button
            type="button"
            className={
              retryIsPrimary
                ? 'cloistr-signer-recovery-btn cloistr-signer-recovery-btn--primary'
                : 'cloistr-signer-recovery-btn'
            }
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
        )}

        {onGoBack && (
          <button
            type="button"
            className={
              retryIsPrimary
                ? 'cloistr-signer-recovery-btn'
                : 'cloistr-signer-recovery-btn cloistr-signer-recovery-btn--primary'
            }
            onClick={onGoBack}
            disabled={retrying}
          >
            Go back
          </button>
        )}
      </div>

      {/* Says the quiet part out loud. The user's mental model after any error
          screen is "am I logged out?", and answering it here is what stops them
          going to find their key. */}
      <p className="cloistr-signer-recovery-reassure">You are still signed in.</p>
    </div>
  );
}
