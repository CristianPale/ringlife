import { buildFrame, bytesToHex } from '../ble/frame';
import { CHECKSUM, localMidnight } from '../ble/ring-protocol';
import { parseBackgroundRuns } from './background-runs';

const TZ = 60;
const AT = Date.UTC(2026, 10, 17, 9, 0); // 10:00 locali
const f = (op: number, payload: number[]) => bytesToHex(buildFrame(op, payload, CHECKSUM));

/** Una lettura in background sintetica, nel formato del raccoglitore nativo. */
function run(requests: { tag: string; frames: { ch: string; hex: string }[] }[]) {
  return JSON.stringify([{ at: AT, tzOffsetMin: TZ, battery: 18, requests }]);
}

describe('parseBackgroundRuns', () => {
  it('decodes each request with the verified parsers', () => {
    const stress = new Array(52).fill(0);
    stress[16] = 40; // 08:00
    const stressFrames = [f(0x37, [0, 5, 30]), ...[0, 1, 2, 3].map((i) => f(0x37, [i + 1, ...stress.slice(i * 13, i * 13 + 13)]))];
    const temp = new Array(48).fill(0);
    temp[16] = 163;
    const tempMessage = bytesToHex(Uint8Array.from([0xbc, 0x25, 50, 0, 0, 0, 0, 30, ...temp]));
    const readings = parseBackgroundRuns(
      run([
        { tag: 'battery', frames: [{ ch: 'command', hex: f(0x03, [18, 0]) }] },
        { tag: 'steps:0', frames: [f(0x43, [0xf0, 1, 1]), f(0x43, [0x26, 0x11, 0x17, 0x20, 0, 1, 0, 0, 120, 0, 90, 0])].map((hex) => ({ ch: 'command', hex })) },
        { tag: 'stress:0', frames: stressFrames.map((hex) => ({ ch: 'command', hex })) },
        // La temperatura arriva in due pezzi sul canale lungo.
        { tag: 'temp', frames: [{ ch: 'big', hex: tempMessage.slice(0, 40) }, { ch: 'big', hex: tempMessage.slice(40) }] },
      ]),
    );
    expect(readings).toHaveLength(1);
    const { reading, battery, tzOffsetMin } = readings[0];
    expect(battery).toBe(18);
    expect(tzOffsetMin).toBe(TZ);
    const day = localMidnight(AT, TZ);
    const by = (m: string) => reading.samples.filter((s) => s.metric === m);
    expect(by('STEPS')).toEqual([{ metric: 'STEPS', ts: day + 9 * 3_600_000, value: 120 }]);
    expect(by('STRESS')).toEqual([{ metric: 'STRESS', ts: day + 8 * 3_600_000, value: 40 }]);
    expect(by('TEMP')).toEqual([{ metric: 'TEMP', ts: day + 8 * 3_600_000, value: 36.3 }]);
  });

  it('drops values after the reading and survives bad input', () => {
    const later = new Array(52).fill(0);
    later[40] = 50; // 20:00, dopo la lettura delle 10
    const frames = [f(0x37, [0, 5, 30]), ...[0, 1, 2, 3].map((i) => f(0x37, [i + 1, ...later.slice(i * 13, i * 13 + 13)]))];
    const readings = parseBackgroundRuns(run([{ tag: 'stress:0', frames: frames.map((hex) => ({ ch: 'command', hex })) }]));
    expect(readings[0].reading.samples).toEqual([]);
    expect(parseBackgroundRuns('non è json')).toEqual([]);
    expect(parseBackgroundRuns('[{"at":"x"}]')).toEqual([]);
  });
});
