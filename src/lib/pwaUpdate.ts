export const FRESH_LOAD_WINDOW_MS = 15_000
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

const busyHolders = new Set<symbol>()

export function holdBusy(): () => void {
  const token = Symbol('busy')
  busyHolders.add(token)
  return () => {
    busyHolders.delete(token)
  }
}

export async function whileBusy<T>(fn: () => Promise<T>): Promise<T> {
  const release = holdBusy()
  try {
    return await fn()
  } finally {
    release()
  }
}

export function busyWhileRunning<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => whileBusy(() => fn(...args))
}

export function hasBusyHolders(): boolean {
  return busyHolders.size > 0
}

export interface InputScanRoot {
  querySelectorAll(selectors: string): ArrayLike<unknown>
}

const TEXT_LIKE = 'textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=number], input[type=password]'

export function hasUnsavedInput(root: InputScanRoot): boolean {
  const fields = root.querySelectorAll(TEXT_LIKE)
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as { value?: string; defaultValue?: string }
    if ((f.value ?? '') !== (f.defaultValue ?? '')) return true
  }
  return root.querySelectorAll('[contenteditable=""], [contenteditable="true"]').length > 0
}

export interface PwaDeps {
  serviceWorker: Pick<ServiceWorkerContainer, 'controller' | 'register' | 'addEventListener'>
  now: () => number
  reload: () => void
  isOnline: () => boolean
  isBusy: () => boolean
  onVisible: (fn: () => void) => void
  every: (ms: number, fn: () => void) => void
}

export async function registerServiceWorker(
  onUpdateReady: () => void,
  deps: PwaDeps,
): Promise<void> {
  const loadedAt = deps.now()
  let skipNext = deps.serviceWorker.controller === null

  deps.serviceWorker.addEventListener('controllerchange', () => {
    if (skipNext) {
      skipNext = false
      return
    }
    if (deps.now() - loadedAt < FRESH_LOAD_WINDOW_MS && !deps.isBusy()) {
      deps.reload()
    } else {
      onUpdateReady()
    }
  })

  const reg = await deps.serviceWorker.register('/sw.js', { scope: '/' })
  const check = () => {
    if (deps.isOnline()) reg.update().catch(() => {})
  }
  deps.onVisible(check)
  deps.every(UPDATE_CHECK_INTERVAL_MS, check)
}

export function browserPwaDeps(): PwaDeps | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return {
    serviceWorker: navigator.serviceWorker,
    now: () => Date.now(),
    reload: () => window.location.reload(),
    isOnline: () => navigator.onLine,
    isBusy: () => hasBusyHolders() || hasUnsavedInput(document),
    onVisible: (fn) =>
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fn()
      }),
    every: (ms, fn) => {
      setInterval(fn, ms)
    },
  }
}
