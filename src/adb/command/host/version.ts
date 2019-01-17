import Command from '../../command';
import Protocol from '../../protocol';

export default class HostVersionCommand extends Command {
    async execute() {
        this._send('host:version');
        const parser = this.parser!;
        const reply = await parser.readAscii(4);
        switch (reply) {
            case Protocol.OKAY:
                const value = await parser.readValue();
                return this._parseVersion(value);
            case Protocol.FAIL:
                return parser.readError();
            default:
                return this._parseVersion(reply);
        }
    }

    _parseVersion(version: Buffer | string) {
        return parseInt(version.toString(), 16);
    }
}
