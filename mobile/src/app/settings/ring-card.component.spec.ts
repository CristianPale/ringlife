import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RingDeviceService } from '../ring/ring-device.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { RingCardComponent } from './ring-card.component';

describe('RingCardComponent', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [RingCardComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const devices = TestBed.inject(RingDeviceService);
    await devices.recordSeen({ name: 'COLMI Ring 2', firmware: '3.00.03', hardware: null, address: null }, Date.now());
    const fixture = TestBed.createComponent(RingCardComponent);
    fixture.componentRef.setInput('native', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { root, devices, settle };
  }

  it('disconnects the ring from RingLife and offers to reconnect it', async () => {
    const { root, devices, settle } = await render();
    expect(root.querySelector('.name')?.textContent).toBe('COLMI Ring 2');
    expect(root.textContent).toContain('3.00.03');
    root.querySelector<HTMLButtonElement>('.action')!.click();
    await settle();
    expect(devices.linked()).toBe(false);
    expect(root.querySelector('.status')?.textContent).toBe('Scollegato da RingLife');
    expect(root.querySelector('.action')?.textContent?.trim()).toBe('Riconnetti');
  });

  it('relinks and reads the ring with Riconnetti', async () => {
    const { root, devices, settle } = await render();
    await devices.unlink();
    await settle();
    const sync = vi.spyOn(TestBed.inject(RingSyncService), 'sync').mockResolvedValue();
    root.querySelector<HTMLButtonElement>('.action')!.click();
    await settle();
    expect(devices.linked()).toBe(true);
    expect(sync).toHaveBeenCalled();
  });

  it('forgets the ring with «Usa un altro anello»', async () => {
    const { root, devices, settle } = await render();
    await devices.unlink();
    await settle();
    root.querySelector<HTMLButtonElement>('.forget')!.click();
    await settle();
    expect(devices.device()).toBeNull();
    expect(root.querySelector('.action')?.textContent?.trim()).toBe('Collega dispositivo');
  });
});
