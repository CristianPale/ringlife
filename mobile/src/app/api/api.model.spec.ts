import { MAX_SAMPLES_PER_REQUEST, chunk, tzOffsetMin } from './api.model';

describe('api model', () => {
  it('splits a list into groups of at most the given size, in order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(chunk([1], 5)).toEqual([[1]]);
  });

  it('gives no group for an empty list', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('rejects a group size below one', () => {
    expect(() => chunk([1, 2], 0)).toThrow(RangeError);
  });

  it('matches the backend limit', () => {
    expect(MAX_SAMPLES_PER_REQUEST).toBe(5000);
  });

  it('reports the phone offset with the sign the backend expects', () => {
    // getTimezoneOffset è -60 a Roma in inverno: l'ora locale è UTC+1, quindi l'offset da inviare è +60.
    const date = { getTimezoneOffset: () => -60 } as Date;
    expect(tzOffsetMin(date)).toBe(60);
    expect(tzOffsetMin({ getTimezoneOffset: () => 300 } as Date)).toBe(-300);
    expect(tzOffsetMin({ getTimezoneOffset: () => 0 } as Date) === 0).toBe(true);
  });
});
