import { UnsignedEvent, Event } from 'nostr-tools';
import type { SignerInterface } from './types';

/**
 * NIP-46 Remote Signer (Bunker) client
 * Connects to a remote signer via Nostr relay
 */
export class BunkerSigner implements SignerInterface {
  private relayUrl: string;
  private remotePubkey: string;
  private connected: boolean = false;

  constructor(bunkerUrl: string) {
    const parsed = this.parseBunkerUrl(bunkerUrl);
    this.remotePubkey = parsed.remotePubkey;
    this.relayUrl = parsed.relayUrl;
  }

  private parseBunkerUrl(url: string): { remotePubkey: string; relayUrl: string; secret: string } {
    // Format: bunker://<remote-pubkey>?relay=<relay-url>&secret=<secret>
    const match = url.match(/^bunker:\/\/([a-f0-9]{64})\?(.+)$/);
    if (!match) {
      throw new Error('Invalid bunker URL format');
    }

    const remotePubkey = match[1];
    const params = new URLSearchParams(match[2]);
    const relayUrl = params.get('relay');
    const secret = params.get('secret') || '';

    if (!relayUrl) {
      throw new Error('Bunker URL missing relay parameter');
    }

    return { remotePubkey, relayUrl, secret };
  }

  async connect(): Promise<void> {
    // In a full implementation, this would:
    // 1. Generate ephemeral keypair
    // 2. Connect to relay
    // 3. Send connect request to bunker
    // 4. Wait for ACK
    // For now, we'll mark as connected and defer full implementation
    this.connected = true;
    console.log(`[BunkerSigner] Connected to ${this.relayUrl}`);
  }

  async getPublicKey(): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }
    // In full implementation, send 'get_public_key' to bunker
    // For now, return the remote pubkey
    return this.remotePubkey;
  }

  async signEvent(_event: UnsignedEvent): Promise<Event> {
    if (!this.connected) {
      await this.connect();
    }
    // In full implementation:
    // 1. Send 'sign_event' request to bunker
    // 2. Wait for signed event response
    // 3. Return signed event
    throw new Error('BunkerSigner.signEvent not fully implemented - use signer.cloistr.xyz');
  }

  async nip04Encrypt(_pubkey: string, _plaintext: string): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }
    throw new Error('BunkerSigner.nip04Encrypt not fully implemented');
  }

  async nip04Decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }
    throw new Error('BunkerSigner.nip04Decrypt not fully implemented');
  }

  async nip44Encrypt(_pubkey: string, _plaintext: string): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }
    throw new Error('BunkerSigner.nip44Encrypt not fully implemented');
  }

  async nip44Decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }
    throw new Error('BunkerSigner.nip44Decrypt not fully implemented');
  }

  disconnect(): void {
    this.connected = false;
  }
}

/**
 * Parse and validate a bunker URL
 */
export function parseBunkerUrl(url: string): { remotePubkey: string; relayUrl: string; secret: string } | null {
  try {
    const match = url.match(/^bunker:\/\/([a-f0-9]{64})\?(.+)$/);
    if (!match) return null;

    const remotePubkey = match[1];
    const params = new URLSearchParams(match[2]);
    const relayUrl = params.get('relay');
    const secret = params.get('secret') || '';

    if (!relayUrl) return null;

    return { remotePubkey, relayUrl, secret };
  } catch {
    return null;
  }
}

/**
 * Check if a string is a valid bunker URL
 */
export function isValidBunkerUrl(url: string): boolean {
  return parseBunkerUrl(url) !== null;
}

/**
 * Create a bunker signer from a bunker URL
 */
export function createBunkerSigner(bunkerUrl: string): BunkerSigner {
  return new BunkerSigner(bunkerUrl);
}
