/** Local cancellation race as well as signal propagation: an uncooperative
 * transport must not keep a cancelled tool waiting. Always dispose listeners. */
export function cancellation(signal: AbortSignal | undefined, controller: AbortController) {
  let stop!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => { controller.abort(); reject(new Error('Operation cancelled')); };
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
  return { cancelled, dispose: () => signal?.removeEventListener('abort', stop) };
}
