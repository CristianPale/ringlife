import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api/api-error';
import { MigraineReportData } from '../api/api.model';
import { RingLifeApi } from '../api/ringlife-api';
import { FileShare } from './file-share';
import { MigraineReportService } from './migraine-report.service';

const DATA: MigraineReportData = { from: '2026-08-07', to: '2026-11-04', days: 90, summary: null, episodes: [], recurrences: [] };

class FakeFileShare extends FileShare {
  calls: string[] = [];
  failShare: Error | null = null;
  async save(name: string, base64: string): Promise<string> {
    this.calls.push(`save:${name}:${base64}`);
    return `file:///cache/${name}`;
  }
  async share(uri: string, title: string): Promise<void> {
    this.calls.push(`share:${uri}:${title}`);
    if (this.failShare) {
      throw this.failShare;
    }
  }
  async remove(uri: string): Promise<void> {
    this.calls.push(`remove:${uri}`);
  }
  async cleanup(prefix: string): Promise<void> {
    this.calls.push(`cleanup:${prefix}`);
  }
}

describe('MigraineReportService', () => {
  function setup(api: Partial<RingLifeApi> = {}) {
    const files = new FakeFileShare();
    TestBed.configureTestingModule({
      providers: [
        { provide: RingLifeApi, useValue: { getMigraineReportData: async () => DATA, getMigraineReportPdf: async () => 'JVBERi0=', ...api } },
        { provide: FileShare, useValue: files },
      ],
    });
    return { service: TestBed.inject(MigraineReportService), files };
  }

  it('loads the preview of the period', async () => {
    const getMigraineReportData = vi.fn(async () => DATA);
    const { service } = setup({ getMigraineReportData });
    const loading = service.load(30);
    expect(service.loading()).toBe(true);
    await loading;
    expect(getMigraineReportData).toHaveBeenCalledWith(30);
    expect(service.preview()).toEqual(DATA);
    expect(service.loading()).toBe(false);
  });

  it('keeps the previous preview and names the error when the server does not answer', async () => {
    let fail = false;
    const { service } = setup({
      getMigraineReportData: async () => {
        if (fail) {
          throw new ApiError('offline');
        }
        return DATA;
      },
    });
    await service.load(90);
    fail = true;
    await service.load(30);
    expect(service.preview()).toEqual(DATA);
    expect(service.error()?.kind).toBe('offline');
  });

  it('saves the PDF in a temporary file, shares it and deletes it', async () => {
    const { service, files } = setup();
    expect(await service.share(90, new Date('2026-11-04T10:00:00Z'))).toBe(true);
    expect(files.calls).toEqual([
      'save:report-cefalee-2026-11-04.pdf:JVBERi0=',
      'share:file:///cache/report-cefalee-2026-11-04.pdf:report-cefalee-2026-11-04.pdf',
      'remove:file:///cache/report-cefalee-2026-11-04.pdf',
    ]);
    expect(service.sharing()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('deletes the temporary file even when sharing fails', async () => {
    const { service, files } = setup();
    files.failShare = new Error('boom');
    expect(await service.share(90, new Date('2026-11-04T10:00:00Z'))).toBe(false);
    expect(files.calls.at(-1)).toBe('remove:file:///cache/report-cefalee-2026-11-04.pdf');
    expect(service.error()).not.toBeNull();
    expect(service.sharing()).toBe(false);
  });

  it('writes nothing when the PDF cannot be downloaded', async () => {
    const { service, files } = setup({
      getMigraineReportPdf: async () => {
        throw new ApiError('unauthorized');
      },
    });
    expect(await service.share(90)).toBe(false);
    expect(files.calls).toEqual([]);
    expect(service.error()?.kind).toBe('unauthorized');
  });

  it('cleans up the reports left by an interrupted sharing', async () => {
    const { service, files } = setup();
    await service.cleanup();
    expect(files.calls).toEqual(['cleanup:report-cefalee-']);
  });

  it('forgets the preview and the error', async () => {
    const { service } = setup();
    await service.load(90);
    service.clear();
    expect(service.preview()).toBeNull();
    expect(service.error()).toBeNull();
  });
});
