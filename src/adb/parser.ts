import Protocol from './protocol';
import { Duplex, Writable } from 'stream';
import { CancellationError } from './tracker';
import { cancellable } from './cancel';

export default class Parser {
    ended = false;
    constructor(public stream: Duplex) {}

    async end() {
        if (this.ended) {
            return true;
        }

        let endListener: () => void;
        let errorListener: (err: any) => void;

        const tryRead = () => {
            while (this.stream.read()) {
                continue;
            }
        };

        this.stream.on('readable', tryRead);

        try {
            const promise = new Promise<boolean>((resolve, reject) => {
                endListener = () => {
                    this.ended = true;
                    resolve(true);
                };
                errorListener = err => reject(err);

                this.stream.on('error', errorListener);
                this.stream.on('end', endListener);

                this.stream.read(0);
                this.stream.end();
            });
            return await promise;
        } finally {
            this.stream.removeListener('readable', tryRead);
            this.stream.removeListener('error', errorListener!);
            this.stream.removeListener('end', endListener!);
        }
    }

    raw() {
        return this.stream;
    }

    async readAll(signal?: AbortSignal) {
        let endListener: () => void;
        let errorListener: (err: any) => void;
        let tryRead: () => void;
        let all = new Buffer(0);

        try {
            const promise = new Promise<Buffer>((resolve, reject) => {
                endListener = () => {
                    this.ended = true;
                    resolve(all);
                };
                errorListener = err => reject(err);

                tryRead = () => {
                    let chunk;
                    while ((chunk = this.stream.read())) {
                        all = Buffer.concat([all, chunk]);
                    }
                    if (this.ended) {
                        resolve(all);
                    }
                };

                this.stream.on('readable', tryRead);
                this.stream.on('error', errorListener);
                this.stream.on('end', endListener);

                tryRead();
            });
            return await cancellable(promise, signal);
        } finally {
            this.stream.removeListener('readable', tryRead!);
            this.stream.removeListener('error', errorListener!);
            this.stream.removeListener('end', endListener!);
        }
    }

    async readAscii(howMany: number, signal?: AbortSignal) {
        const chunk = await this.readBytes(howMany, signal);
        return chunk.toString('ascii');
    }

    async readBytes(howMany: number, signal?: AbortSignal) {
        let endListener: () => void;
        let errorListener: (err: any) => void;
        let tryRead: () => void;

        try {
            const promise = new Promise<Buffer>((resolve, reject) => {
                tryRead = () => {
                    if (howMany) {
                        let chunk: Buffer = this.stream.read(howMany);
                        if (chunk) {
                            // If the stream ends while still having unread bytes, the read call
                            // will ignore the limit and just return what it's got.
                            howMany -= chunk.length;
                            if (howMany === 0) {
                                return resolve(chunk);
                            }
                        }
                        if (this.ended) {
                            reject(new PrematureEOFError(howMany));
                        }
                    } else {
                        resolve(new Buffer(0));
                    }
                };

                endListener = () => {
                    this.ended = true;
                    reject(new PrematureEOFError(howMany));
                };

                errorListener = err => reject(err);

                this.stream.on('readable', tryRead);
                this.stream.on('error', errorListener);
                this.stream.on('end', endListener);

                tryRead();
            });
            return await cancellable(promise, signal);
        } finally {
            this.stream.removeListener('readable', tryRead!);
            this.stream.removeListener('error', errorListener!);
            this.stream.removeListener('end', endListener!);
        }
    }

    async readByteFlow(
        howMany: number,
        targetStream: Writable,
        signal?: AbortSignal,
    ) {
        let endListener: () => void;
        let errorListener: (err: any) => void;
        let tryRead: () => void;

        try {
            const promise = new Promise<void>((resolve, reject) => {
                tryRead = () => {
                    if (howMany) {
                        // Try to get the exact amount we need first. If unsuccessful, take
                        // whatever is available, which will be less than the needed amount.
                        let chunk;
                        while (
                            (chunk =
                                this.stream.read(howMany) || this.stream.read())
                        ) {
                            howMany -= chunk.length;
                            targetStream.write(chunk);
                            if (howMany === 0) {
                                return resolve();
                            }
                        }
                        if (this.ended) {
                            reject(new PrematureEOFError(howMany));
                        }
                    } else {
                        resolve();
                    }
                };

                endListener = () => {
                    this.ended = true;
                    reject(new PrematureEOFError(howMany));
                };

                errorListener = err => reject(err);

                this.stream.on('readable', tryRead);
                this.stream.on('error', errorListener);
                this.stream.on('end', endListener);

                tryRead();
            });
            await cancellable(promise, signal);
        } finally {
            this.stream.removeListener('readable', tryRead!);
            this.stream.removeListener('error', errorListener!);
            this.stream.removeListener('end', endListener!);
        }
    }

    async readError(signal?: AbortSignal): Promise<never> {
        const value = await this.readValue(signal);
        throw new FailError(value.toString());
    }

    async readValue(signal?: AbortSignal) {
        const value = await cancellable(this.readAscii(4, signal), signal);
        const length = Protocol.decodeLength(value);
        return cancellable(this.readBytes(length, signal), signal);
    }

    async readUntil(code: number, signal?: AbortSignal) {
        let skipped = new Buffer(0);
        const read = async (): Promise<Buffer> => {
            const chunk = await this.readBytes(1, signal);
            if (signal && signal.aborted) {
                throw new CancellationError();
            } else if (chunk[0] === code) {
                return skipped;
            } else {
                skipped = Buffer.concat([skipped, chunk]);
                return read();
            }
        };
        return cancellable(read(), signal);
    }

    async searchLine(
        re: RegExp,
        signal?: AbortSignal,
    ): Promise<RegExpExecArray> {
        const line = await this.readLine(signal);
        const match = re.exec(line.toString());
        if (match) {
            return match;
        } else if (signal && signal.aborted) {
            throw new CancellationError();
        } else {
            return this.searchLine(re, signal);
        }
    }

    async readLine(signal?: AbortSignal) {
        const line = await this.readUntil(0x0a, signal); // '\n'
        if (line[line.length - 1] === 0x0d) {
            // '\r'
            return line.slice(0, -1);
        } else {
            return line;
        }
    }

    async unexpected(data: any, expected: any): Promise<never> {
        throw new UnexpectedDataError(data, expected);
    }
}

export class FailError extends Error {
    constructor(message: string) {
        super(); // TODO check sanity
        Error.call(this);
        this.name = 'FailError';
        this.message = `Failure: '${message}'`;
        Error.captureStackTrace(this, FailError);
    }
}

export class PrematureEOFError extends Error {
    missingBytes: number;
    constructor(howManyMissing: number) {
        super(); // TODO check sanity
        Error.call(this);
        this.name = 'PrematureEOFError';
        this.message = `Premature end of stream, needed ${howManyMissing} more bytes`;
        this.missingBytes = howManyMissing;
        Error.captureStackTrace(this, PrematureEOFError);
    }
}

export class UnexpectedDataError extends Error {
    constructor(public unexpected: any, public expected: any) {
        super(); // TODO check sanity
        Error.call(this);
        this.name = 'UnexpectedDataError';
        this.message = `Unexpected '${unexpected}', was expecting ${expected}`;
        Error.captureStackTrace(this, UnexpectedDataError);
    }
}
