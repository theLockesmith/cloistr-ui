/**
 * SettingsModal - Unified settings modal for Cloistr
 *
 * Provides user preferences accessible from any Cloistr app via the header.
 * Lazy-loaded to minimize bundle impact on pages where it's not used.
 */

import { useState, useCallback } from 'react';
import { Modal } from './Modal';
import {
  getSessionTTL,
  setSessionTTL,
  SESSION_TTL_OPTIONS,
  SESSION_TTL_LABELS,
  type SessionTTL,
} from '../lib/session';

export interface SettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
}

/**
 * Settings modal with session and preference controls
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [sessionTTL, setSessionTTLState] = useState<SessionTTL>(getSessionTTL);
  const [saved, setSaved] = useState(false);

  const handleTTLChange = useCallback((ttl: SessionTTL) => {
    setSessionTTLState(ttl);
    setSessionTTL(ttl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      size="sm"
    >
      <div className="cloistr-settings">
        <section className="cloistr-settings-section">
          <h3 className="cloistr-settings-section-title">Session</h3>
          <p className="cloistr-settings-description">
            How long to stay signed in across Cloistr services.
          </p>

          <div className="cloistr-settings-options">
            {(Object.keys(SESSION_TTL_OPTIONS) as SessionTTL[]).map((ttl) => (
              <label key={ttl} className="cloistr-settings-option">
                <input
                  type="radio"
                  name="session-ttl"
                  value={ttl}
                  checked={sessionTTL === ttl}
                  onChange={() => handleTTLChange(ttl)}
                />
                <span className="cloistr-settings-option-label">
                  {SESSION_TTL_LABELS[ttl]}
                </span>
              </label>
            ))}
          </div>

          {saved && (
            <p className="cloistr-settings-saved">Settings saved</p>
          )}
        </section>

        {/* Future settings sections can be added here */}
        {/* <section className="cloistr-settings-section">
          <h3>Notifications</h3>
          ...
        </section> */}
      </div>
    </Modal>
  );
}

export default SettingsModal;
