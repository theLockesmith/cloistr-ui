/**
 * Ask the signer to approve a nostrconnect session only once this page is
 * LISTENING for the signer's reply.
 *
 * The signer answers an approval by publishing a NIP-46 ack (kind 24133). That
 * kind is ephemeral: the relay passes it to whoever is subscribed at that
 * instant and stores nothing. If the approval request goes out before our
 * subscription is live, the ack can reach the relay first, be delivered to
 * nobody, and the page waits for a reply that already came and went. It then
 * times out, and it does so by luck: a signer that answers quickly (a key it
 * already holds warm) loses the race more often than one that answers slowly.
 * Measured 2026-09-27: the operator's password sign-ins on cloistr.xyz timed
 * out this way while the same flow for a cold test key succeeded.
 *
 * keySwitcher already waited for this; the three LoginModal approval calls did
 * not. On an @cloistr/auth without `subscribed` this is a no-op.
 */
export async function approveAfterListening<T>(
  session: unknown,
  approve: () => Promise<T>,
): Promise<T> {
  const subscribed = (session as { subscribed?: Promise<void> } | null | undefined)?.subscribed;
  if (subscribed) await subscribed;
  return approve();
}
