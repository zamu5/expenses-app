/**
 * A tiny publish/subscribe channel. Every write in the repositories calls notifyDataChanged(),
 * and useDbQuery() re-runs its query when it hears it. This is how a new expense shows up
 * on every screen at once, without a global store holding a second copy of the data.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeToDataChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChanged(): void {
  listeners.forEach((listener) => listener());
}
