import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, describeApiError, toApiError } from './api-error';

const http = (status: number) => new HttpErrorResponse({ status });

describe('api error', () => {
  it('maps the status codes the backend uses', () => {
    expect(toApiError(http(0)).kind).toBe('offline');
    expect(toApiError(http(400)).kind).toBe('rejected');
    expect(toApiError(http(401)).kind).toBe('unauthorized');
    expect(toApiError(http(500)).kind).toBe('server');
    expect(toApiError(http(503)).status).toBe(503);
  });

  it('reads a 404 as «registration disabled» only for the registration', () => {
    expect(toApiError(http(404), true).kind).toBe('disabled');
    expect(toApiError(http(404)).kind).toBe('server');
  });

  it('keeps an error that is already typed', () => {
    const typed = new ApiError('not-paired');
    expect(toApiError(typed)).toBe(typed);
  });

  it('treats anything else as a server problem', () => {
    expect(toApiError(new Error('boom')).kind).toBe('server');
    expect(toApiError('boom').kind).toBe('server');
  });

  it('has a plain Italian message for every kind, and none echoes the server', () => {
    for (const kind of ['not-configured', 'not-paired', 'offline', 'unauthorized', 'rejected', 'disabled', 'server'] as const) {
      expect(describeApiError(kind).length).toBeGreaterThan(10);
    }
    expect(describeApiError('unauthorized')).toContain('segreto');
    expect(describeApiError('disabled')).toContain('disattivata');
  });
});
