export interface Service {
  id: string;
  name: string;
  url: string;
  icon?: string;
  active?: boolean;
}

export const defaultServices: Service[] = [
  { id: 'home', name: 'Home', url: 'https://cloistr.xyz' },
  { id: 'identity', name: 'Identity', url: 'https://me.cloistr.xyz' },
  { id: 'signer', name: 'Signer', url: 'https://signer.cloistr.xyz' },
  { id: 'space', name: 'Space', url: 'https://space.cloistr.xyz' },
  { id: 'pages', name: 'Pages', url: 'https://pages.cloistr.xyz' },
  { id: 'files', name: 'Files', url: 'https://stash.cloistr.xyz' },
  { id: 'email', name: 'Email', url: 'https://mail.cloistr.xyz' },
  { id: 'tasks', name: 'Tasks', url: 'https://tasks.cloistr.xyz' },
  { id: 'vault', name: 'Vault', url: 'https://vault.cloistr.xyz' },
  { id: 'discover', name: 'Discover', url: 'https://discover.cloistr.xyz' },
];
