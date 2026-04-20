import { UnsignedEvent, Event } from 'nostr-tools';

/**
 * Signer interface for Nostr event signing
 * Supports both NIP-07 (browser extensions) and NIP-46 (remote signers)
 */
export interface SignerInterface {
  /** Get the public key (hex) */
  getPublicKey(): Promise<string>;
  /** Sign an unsigned event */
  signEvent(event: UnsignedEvent): Promise<Event>;
  /** Encrypt content for a recipient (NIP-04) */
  nip04Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  /** Decrypt content from a sender (NIP-04) */
  nip04Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  /** Encrypt content for a recipient (NIP-44) */
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  /** Decrypt content from a sender (NIP-44) */
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
}

/**
 * Authentication state
 */
export interface AuthState {
  /** Whether the user is connected/authenticated */
  isConnected: boolean;
  /** The user's public key (hex) */
  pubkey: string | null;
  /** The active signer */
  signer: SignerInterface | null;
  /** Authentication method used */
  method: 'nip07' | 'nip46' | null;
  /** Whether authentication is in progress */
  isLoading: boolean;
  /** Any authentication error */
  error: string | null;
}

/**
 * Authentication context value
 */
export interface AuthContextValue {
  /** Current authentication state */
  state: AuthState;
  /** Connect using NIP-07 (browser extension) */
  connectNip07: () => Promise<void>;
  /** Connect using NIP-46 (bunker URL) */
  connectNip46: (bunkerUrl: string) => Promise<void>;
  /** Disconnect and clear auth state */
  disconnect: () => void;
}

/**
 * NIP-07 window.nostr interface
 */
export interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<Event>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}
