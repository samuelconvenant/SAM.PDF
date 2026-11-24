type Reply<Result> = { result: Result } | { error: string };

export function runDocumentJob<Input, Result>(
  createWorker: () => Worker, input: Input, signal: AbortSignal, timeout: number, transfer: Transferable[] = [],
): Promise<Result> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = createWorker();
    function dispose() {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    }
    function fail(error: unknown) { dispose(); reject(error); }
    function cancel() { fail(signal.reason); }
    const timer = setTimeout(() => fail(new Error("Processing timed out. Try a smaller or simpler document.")), timeout);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Reply<Result>>) => {
      dispose();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error("The document engine could not start in this browser. Reload the page and try again."));
    };
    worker.onmessageerror = () => fail(new Error("The browser could not read the document result."));
    try { worker.postMessage(input, transfer); } catch (error) { fail(error); }
  });
}
