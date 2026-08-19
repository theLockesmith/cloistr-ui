import { describe, it, expect } from 'vitest';
import { isDebugRequested, formatArg } from './debugConsole.js';

// OFF unless explicitly asked for. Shipping a debug console that can be reached
// by accident is a privacy problem, not just noise.
describe('isDebugRequested', () => {
  it.each(['?debug=1', '?debug=true', '?foo=bar&debug=1'])('enables on %s', (qs) => {
    expect(isDebugRequested(qs)).toBe(true);
  });

  it.each(['', '?debug=0', '?debug=false', '?debug', '?other=1', '?debugging=1'])(
    'stays off for %s',
    (qs) => {
      expect(isDebugRequested(qs)).toBe(false);
    },
  );
});

describe('formatArg', () => {
  it('passes strings through — the common case is a log line', () => {
    expect(formatArg('[NIP-46] Connected to wss://relay.cloistr.xyz')).toBe(
      '[NIP-46] Connected to wss://relay.cloistr.xyz',
    );
  });

  it('renders an Error as name: message, not {}', () => {
    // JSON.stringify(new Error('x')) is '{}' — which would hide the one thing
    // worth reading.
    expect(formatArg(new Error('boom'))).toBe('Error: boom');
  });

  it('serialises plain objects', () => {
    expect(formatArg({ a: 1 })).toBe('{"a":1}');
  });

  it('survives circular structures', () => {
    // DOM nodes and WebSocket objects are circular and get logged constantly. A
    // debug console that throws while formatting is worse than none.
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => formatArg(a)).not.toThrow();
  });

  it('always returns a string, even for undefined', () => {
    // JSON.stringify(undefined) is undefined, not a string. Returning it would
    // break the declared type at runtime and leave a hole in the log.
    expect(formatArg(null)).toBe('null');
    expect(formatArg(undefined)).toBe('undefined');
    expect(typeof formatArg(undefined)).toBe('string');
    expect(typeof formatArg(() => {})).toBe('string');
  });
});
