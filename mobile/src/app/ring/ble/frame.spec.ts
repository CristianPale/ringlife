import { FRAME_LENGTH, buildFrame, bytesToHex, checksum, checksumFit, hexToBytes, parseFrame } from './frame';

describe('ring frames', () => {
  it('builds 16 bytes: command, data padded with zeros, checksum last', () => {
    const frame = buildFrame(0x03, [1, 2], 'mod256');
    expect(frame).toHaveLength(FRAME_LENGTH);
    expect(Array.from(frame.slice(0, 4))).toEqual([3, 1, 2, 0]);
    expect(frame[15]).toBe(6);
  });

  it('the two candidate formulas agree below 255 and differ from there', () => {
    const small = new Uint8Array(15).fill(1);
    expect(checksum(small, 'mod255')).toBe(checksum(small, 'mod256'));
    const body = new Uint8Array(15);
    body[0] = 255;
    expect(checksum(body, 'mod255')).toBe(0);
    expect(checksum(body, 'mod256')).toBe(255);
    body[1] = 1; // somma 256
    expect(checksum(body, 'mod255')).toBe(1);
    expect(checksum(body, 'mod256')).toBe(0);
  });

  it('accepts a frame only with the formula that built it', () => {
    const frame = buildFrame(0xff, [1], 'mod256'); // somma 256: le due formule divergono
    expect(parseFrame(frame, 'mod256')).toEqual({ opcode: 0xff, payload: frame.slice(1, 15) });
    expect(parseFrame(frame, 'mod255')).toBeNull();
  });

  it('refuses a wrong length or a damaged frame', () => {
    expect(parseFrame(new Uint8Array(15), 'mod256')).toBeNull();
    const frame = buildFrame(5, [9], 'mod256');
    frame[3] ^= 1;
    expect(parseFrame(frame, 'mod256')).toBeNull();
  });

  it('refuses data that does not fit', () => {
    expect(() => buildFrame(1, new Array(15).fill(0), 'mod256')).toThrow(RangeError);
    expect(() => buildFrame(256, [], 'mod256')).toThrow(RangeError);
    expect(() => buildFrame(1, [256], 'mod256')).toThrow(RangeError);
  });

  it('counts which formula fits a set of frames', () => {
    const frames = [buildFrame(1, [1], 'mod256'), buildFrame(2, [2], 'mod256'), buildFrame(0xff, [1], 'mod256')];
    expect(checksumFit(frames)).toEqual({ mod255: 2, mod256: 3 });
  });

  it('converts to and from hex, with or without separators', () => {
    const frame = buildFrame(0x43, [0x0a, 0xbc], 'mod256');
    expect(hexToBytes(bytesToHex(frame))).toEqual(frame);
    expect(hexToBytes('43 0a:bc')).toEqual(new Uint8Array([0x43, 0x0a, 0xbc]));
    expect(() => hexToBytes('4')).toThrow(RangeError);
    expect(() => hexToBytes('zz')).toThrow(RangeError);
  });
});
