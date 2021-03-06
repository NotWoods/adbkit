/* eslint-disable
    no-case-declarations,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
import { spawn } from 'child_process';
import debugFunc from 'debug';
const debug = debugFunc('adb:command:framebuffer');

import Command from '../../command';
import { Duplex, Readable } from 'stream';
import RgbTransform from '../../framebuffer/rgbtransform';

export type Format = 'bgr' | 'rgb' | 'bgra' | 'rgba' | 'raw' | 'png';
interface Meta {
    version: number;
    bpp: number;
    size: number;
    width: number;
    height: number;
    red_offset: number;
    red_length: number;
    blue_offset: number;
    blue_length: number;
    green_offset: number;
    green_length: number;
    alpha_offset: number;
    alpha_length: number;
    format: Format;
}
export interface MetaStream extends Duplex {
    meta: Meta;
}

export default class FrameBufferCommand extends Command {
    async execute(format: Format) {
        this._send('framebuffer:');
        return this._readReply(async parser => {
            const header = await parser.readBytes(52);
            const meta = this._parseHeader(header);
            switch (format) {
                case 'raw':
                    let stream = parser.raw() as MetaStream;
                    stream.meta = meta;
                    return stream;
                default:
                    stream = this._convert(meta, format) as MetaStream;
                    stream.meta = meta;
                    return stream;
            }
        });
    }

    private _convert(meta: Meta, format: Format, raw?: Readable) {
        debug(`Converting raw framebuffer stream into ${format.toUpperCase()}`);
        switch (meta.format) {
            case 'rgb':
            case 'rgba':
                break;
            // Known to be supported by GraphicsMagick
            default:
                debug(
                    `Silently transforming '${
                        meta.format
                    }' into 'rgb' for \`gm\``,
                );
                const transform = new RgbTransform(meta);
                meta.format = 'rgb';
                raw = this.parser!.raw().pipe(transform);
        }
        const proc = spawn('gm', [
            'convert',
            '-size',
            `${meta.width}x${meta.height}`,
            `${meta.format}:-`,
            `${format}:-`,
        ]);
        raw!.pipe(proc.stdin);
        return proc.stdout;
    }

    private _parseHeader(header: Buffer) {
        const meta: Partial<Meta> = {};
        let offset = 0;
        meta.version = header.readUInt32LE(offset);
        if (meta.version === 16) {
            throw new Error('Old-style raw images are not supported');
        }
        offset += 4;
        meta.bpp = header.readUInt32LE(offset);
        offset += 4;
        meta.size = header.readUInt32LE(offset);
        offset += 4;
        meta.width = header.readUInt32LE(offset);
        offset += 4;
        meta.height = header.readUInt32LE(offset);
        offset += 4;
        meta.red_offset = header.readUInt32LE(offset);
        offset += 4;
        meta.red_length = header.readUInt32LE(offset);
        offset += 4;
        meta.blue_offset = header.readUInt32LE(offset);
        offset += 4;
        meta.blue_length = header.readUInt32LE(offset);
        offset += 4;
        meta.green_offset = header.readUInt32LE(offset);
        offset += 4;
        meta.green_length = header.readUInt32LE(offset);
        offset += 4;
        meta.alpha_offset = header.readUInt32LE(offset);
        offset += 4;
        meta.alpha_length = header.readUInt32LE(offset);
        meta.format = meta.blue_offset === 0 ? 'bgr' : 'rgb';
        if (meta.bpp === 32 || meta.alpha_length) {
            meta.format += 'a';
        }
        return meta as Meta;
    }
}
