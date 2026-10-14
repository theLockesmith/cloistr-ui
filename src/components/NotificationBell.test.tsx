import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationBell } from './NotificationBell.js';
import { NotificationProvider } from './NotificationProvider.js';

describe('NotificationBell', () => {
  it('renders nothing when no provider is mounted', () => {
    expect(renderToStaticMarkup(h(NotificationBell))).toBe('');
  });

  it('renders the bell and badge under a provider', () => {
    const html = renderToStaticMarkup(
      h(NotificationProvider, { value: { unreadCount: 3 }, children: h(NotificationBell) }),
    );
    expect(html).toContain('3 unread notifications');
  });
});
