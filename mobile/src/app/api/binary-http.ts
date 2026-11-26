import { Injectable } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';

export interface BinaryResponse {
  status: number;
  /** Il corpo in base64, vuoto se non c'è. */
  base64: string;
}

/**
 * Una GET che restituisce dati binari (il PDF del report) in base64. Non passa da `HttpClient`: il fetch di
 * CapacitorHttp darebbe i byte come testo e rovinerebbe il file, mentre `responseType: 'blob'` li dà in base64.
 * Dietro un'interfaccia perché `CapacitorHttp` non si può sostituire nei test. Lancia se non risponde nessuno.
 */
@Injectable({ providedIn: 'root', useFactory: () => new CapacitorBinaryHttp() })
export abstract class BinaryHttp {
  abstract get(url: string, headers: Record<string, string>, connectTimeoutMs: number): Promise<BinaryResponse>;
}

export class CapacitorBinaryHttp extends BinaryHttp {
  async get(url: string, headers: Record<string, string>, connectTimeoutMs: number): Promise<BinaryResponse> {
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers,
      responseType: 'blob',
      connectTimeout: connectTimeoutMs,
      readTimeout: 60_000,
    });
    return { status: response.status, base64: typeof response.data === 'string' ? response.data : '' };
  }
}
