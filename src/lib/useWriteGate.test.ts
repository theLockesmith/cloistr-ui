import { describe, it, expect } from 'vitest';

/**
 * Tests for the write-gate state machine.
 *
 * The state transitions are pure and testable without React. The hook is a
 * thin wrapper that drives the machine from authState.activePubkey changes.
 */
import {
  createWriteGateState,
  writeGateTransition,
  type WriteGateStatus,
} from './useWriteGate.js';

describe('createWriteGateState', () => {
  it('starts idle with no pubkey loaded', () => {
    const state = createWriteGateState();
    expect(state.status).toBe('idle');
    expect(state.loadedPubkey).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe('writeGateTransition', () => {
  it('idle → loading when a pubkey arrives', () => {
    const state = createWriteGateState();
    const next = writeGateTransition(state, { type: 'pubkey-changed', pubkey: 'abc' });
    expect(next.status).toBe('loading');
    expect(next.loadedPubkey).toBeNull();
  });

  it('loading → loaded on success for the same pubkey', () => {
    const state: WriteGateStatus = { status: 'loading', loadedPubkey: null, loadingPubkey: 'abc', error: null };
    const next = writeGateTransition(state, { type: 'load-succeeded', pubkey: 'abc' });
    expect(next.status).toBe('loaded');
    expect(next.loadedPubkey).toBe('abc');
  });

  it('loading → failed on error', () => {
    const state: WriteGateStatus = { status: 'loading', loadedPubkey: null, loadingPubkey: 'abc', error: null };
    const err = new Error('network');
    const next = writeGateTransition(state, { type: 'load-failed', pubkey: 'abc', error: err });
    expect(next.status).toBe('failed');
    expect(next.error).toBe(err);
    expect(next.loadedPubkey).toBeNull();
  });

  it('loaded → loading on pubkey change (resets loaded)', () => {
    const state: WriteGateStatus = { status: 'loaded', loadedPubkey: 'abc', loadingPubkey: null, error: null };
    const next = writeGateTransition(state, { type: 'pubkey-changed', pubkey: 'def' });
    expect(next.status).toBe('loading');
    expect(next.loadedPubkey).toBeNull();
    expect(next.loadingPubkey).toBe('def');
  });

  it('ignores stale load-succeeded for a different pubkey', () => {
    const state: WriteGateStatus = { status: 'loading', loadedPubkey: null, loadingPubkey: 'def', error: null };
    const next = writeGateTransition(state, { type: 'load-succeeded', pubkey: 'abc' });
    expect(next.status).toBe('loading');
    expect(next.loadedPubkey).toBeNull();
  });

  it('ignores stale load-failed for a different pubkey', () => {
    const state: WriteGateStatus = { status: 'loading', loadedPubkey: null, loadingPubkey: 'def', error: null };
    const next = writeGateTransition(state, { type: 'load-failed', pubkey: 'abc', error: new Error('x') });
    expect(next.status).toBe('loading');
    expect(next.error).toBeNull();
  });

  it('loading → idle when pubkey goes null (sign-out)', () => {
    const state: WriteGateStatus = { status: 'loading', loadedPubkey: null, loadingPubkey: 'abc', error: null };
    const next = writeGateTransition(state, { type: 'pubkey-changed', pubkey: null });
    expect(next.status).toBe('idle');
    expect(next.loadedPubkey).toBeNull();
  });

  it('loaded → idle when pubkey goes null (sign-out)', () => {
    const state: WriteGateStatus = { status: 'loaded', loadedPubkey: 'abc', loadingPubkey: null, error: null };
    const next = writeGateTransition(state, { type: 'pubkey-changed', pubkey: null });
    expect(next.status).toBe('idle');
    expect(next.loadedPubkey).toBeNull();
  });

  it('does not re-trigger loading when pubkey is the same as loadedPubkey', () => {
    const state: WriteGateStatus = { status: 'loaded', loadedPubkey: 'abc', loadingPubkey: null, error: null };
    const next = writeGateTransition(state, { type: 'pubkey-changed', pubkey: 'abc' });
    expect(next.status).toBe('loaded');
    expect(next.loadedPubkey).toBe('abc');
  });

  it('blocks writes: loaded is false until load-succeeded', () => {
    let state = createWriteGateState();
    expect(state.status === 'loaded').toBe(false);

    state = writeGateTransition(state, { type: 'pubkey-changed', pubkey: 'abc' });
    expect(state.status === 'loaded').toBe(false);

    state = writeGateTransition(state, { type: 'load-succeeded', pubkey: 'abc' });
    expect(state.status === 'loaded').toBe(true);
  });
});
