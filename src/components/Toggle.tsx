/**
 * Toggle / Switch — accessible on/off control for Cloistr apps.
 *
 * WHY THIS EXISTS
 *
 * vault and signer used raw <input type="checkbox"> where the UX expected a
 * sliding toggle. A checkbox reads correctly for binary settings but looks
 * wrong next to the rest of the Cloistr UI, which has a clear "switch" idiom
 * across marketing and the design library. This component gives every app the
 * same pill-and-thumb control without each one re-implementing it.
 *
 * ACCESSIBILITY
 *
 * The hidden <input type="checkbox"> carries role="switch" and aria-checked,
 * making it fully keyboard-navigable and screen-reader-friendly. The visible
 * track and thumb are aria-hidden presentational elements. Focus-visible styling
 * is handled in components.css so keyboard users see a clear ring.
 *
 * CONTROLLED ONLY
 *
 * This is a controlled component. Pass checked + onChange. An uncontrolled
 * variant adds complexity without a demonstrated need; add it when an app
 * requires it.
 */

import { useId, type ChangeEvent } from 'react';

export interface ToggleProps {
  /** Current on/off state. */
  checked: boolean;
  /** Called with the new state when the user interacts. */
  onChange: (checked: boolean) => void;
  /** Visible text label rendered to the right of the switch. */
  label?: string;
  /** Programmatic id; auto-generated if omitted. */
  id?: string;
  /** Disables interaction and dims the control. */
  disabled?: boolean;
  /** Additional class name on the outer label element. */
  className?: string;
}

/**
 * Build the CSS class string for the outer toggle label. Exported so tests can
 * assert the mapping without rendering.
 */
export function toggleClasses(disabled: boolean, extra?: string): string {
  const parts = ['cloistr-toggle'];
  if (disabled) parts.push('cloistr-toggle--disabled');
  if (extra) parts.push(extra);
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * @cloistr/ui Toggle component.
 *
 * @example
 * ```tsx
 * const [dark, setDark] = useState(false);
 *
 * // Label alongside
 * <Toggle checked={dark} onChange={setDark} label="Dark mode" />
 *
 * // No label (add aria-label via wrapping element or use the id + <label> pattern)
 * <Toggle checked={notifications} onChange={setNotifications} />
 *
 * // Disabled
 * <Toggle checked={false} onChange={() => {}} disabled label="Auto-save (not available)" />
 * ```
 */
export function Toggle({
  checked,
  onChange,
  label,
  id: propId,
  disabled = false,
  className = '',
}: ToggleProps) {
  const generatedId = useId();
  const id = propId ?? generatedId;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!disabled) onChange(e.currentTarget.checked);
  };

  return (
    <label
      className={toggleClasses(disabled, className)}
      htmlFor={id}
    >
      <input
        type="checkbox"
        id={id}
        className="cloistr-toggle-input"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
      />
      <span className="cloistr-toggle-track" aria-hidden="true">
        <span className="cloistr-toggle-thumb" />
      </span>
      {label && (
        <span className="cloistr-toggle-label">{label}</span>
      )}
    </label>
  );
}
