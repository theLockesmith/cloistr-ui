// Types
export type {
  SignerInterface,
  AuthState,
  AuthContextValue,
  Nip07Provider,
} from './types';

// NIP-07 (Browser Extensions)
export {
  Nip07Signer,
  isNip07Available,
  getNip07Provider,
  createNip07Signer,
} from './nip07';

// NIP-46 (Remote Signers)
export {
  BunkerSigner,
  parseBunkerUrl,
  isValidBunkerUrl,
  createBunkerSigner,
} from './nip46';

// React Context and Hooks
export {
  AuthProvider,
  useAuth,
  useAuthState,
  useSigner,
  usePubkey,
  useIsConnected,
} from './context';
