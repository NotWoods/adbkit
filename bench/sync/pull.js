import { spawn } from 'child_process';
import Adb from '../..';

const deviceId = process.env.DEVICE_ID;

export const compare = {
    'pull /dev/graphics/fb0 using ADB CLI'(done) {
        const proc = spawn('adb', [
            '-s',
            deviceId,
            'pull',
            '/dev/graphics/fb0',
            '/dev/null',
        ]);
        return proc.stdout.on('end', done);
    },
    async 'pull /dev/graphics/fb0 using client.pull()'(done) {
        const client = Adb.createClient();
        const stream = await client.pull(deviceId, '/dev/graphics/fb0');
        stream.resume();
        return stream.on('end', done);
    },
};

export const compareCount = 3;

require('bench').runMain();
