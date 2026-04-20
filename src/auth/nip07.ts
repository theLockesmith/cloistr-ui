import { UnsignedEvent, Event } from 'nostr-tools';
import type { SignerInterface, Nip07Provider } from './types';

/**
 * NIP-07 browser extension signer
 * Wraps window.nostr for use with our SignerInterface
 */
export class Nip07Signer implements SignerInterface {
  private provider: Nip07Provider;

  constructor(provider: Nip07Provider) {
    this.provider = provider;
  }

  async getPublicKey(): Promise<string> {
    return this.provider.getPublicKey();
  }

  async signEvent(event: UnsignedEvent): Promise<Event> {
    return this.provider.signEvent(event);
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.provider.nip04?.encrypt) {
      throw new Error('NIP-04 encryption not supported by this extension');
    }
    return this.provider.nip04.encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip04?.decrypt) {
      throw new Error('NIP-04 decryption not supported by this extension');
    }
    return this.provider.nip04.decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.provider.nip44?.encrypt) {
      throw new Error('NIP-44 encryption not supported by this extension');
    }
    return this.provider.nip44.encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip44?.decrypt) {
      throw new Error('NIP-44 decryption not supported by this extension');
    }
    return this.provider.nip44.decrypt(pubkey, ciphertext);
  }
}

/**
 * Check if NIP-07 extension is available
 */
export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && !!window.nostr;
}

/**
 * Get NIP-07 provider from window.nostr
 */
export function getNip07Provider(): Nip07Provider | null {
  if (typeof window === 'undefined') return null;
  return window.nostr ?? null;
}

/**
 * Create a NIP-07 signer from window.nostr
 */
export function createNip07Signer(): Nip07Signer | null {
  const provider = getNip07Provider();
  if (!provider) return null;
  return new Nip07Signer(provider);
}
