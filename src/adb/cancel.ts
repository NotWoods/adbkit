export class CancellationError extends Error {
    constructor() {
        super(); // TODO check sanity
        Error.call(this);
        this.name = 'CancellationError';
        Error.captureStackTrace(this, CancellationError);
    }
}

export async function awaitAbort(signal: AbortSignal) {
    if (signal.aborted) throw new CancellationError();
    return new Promise<never>((_, reject) => {
        signal.onabort = () => {
            reject(new CancellationError());
            signal.onabort = null;
        };
    });
}

export function cancellable<T>(
    promise: PromiseLike<T> | T,
    signal?: AbortSignal,
) {
    if (signal) {
        return Promise.race([promise, awaitAbort(signal)]);
    } else {
        return Promise.resolve(promise);
    }
}
