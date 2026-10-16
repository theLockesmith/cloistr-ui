import { createContext, useContext, type ReactNode } from 'react';

export interface NotificationState {
  unreadCount: number;
}

const NotificationContext = createContext<NotificationState | null>(null);

export function useNotifications(): NotificationState | null {
  return useContext(NotificationContext);
}

export interface NotificationProviderProps {
  value: NotificationState;
  children: ReactNode;
}

export function NotificationProvider({ value, children }: NotificationProviderProps) {
  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
