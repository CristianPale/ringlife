import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Salvare un file temporaneo e passarlo al pannello di condivisione del sistema. Dietro un'interfaccia per i test:
 * di predefinito è quella vera, che nei test si sostituisce.
 */
@Injectable({ providedIn: 'root', useFactory: () => new CapacitorFileShare() })
export abstract class FileShare {
  /** Scrive il file (base64) in una cartella temporanea e ne dà l'indirizzo. */
  abstract save(name: string, base64: string): Promise<string>;
  /** Apre il pannello di condivisione. Se l'utente lo chiude senza condividere non è un errore. */
  abstract share(uri: string, title: string): Promise<void>;
  abstract remove(uri: string): Promise<void>;
  /** Cancella i report rimasti da una condivisione interrotta. */
  abstract cleanup(prefix: string): Promise<void>;
}

export class CapacitorFileShare extends FileShare {
  async save(name: string, base64: string): Promise<string> {
    const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    return uri;
  }

  async share(uri: string, title: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      // Browser (sviluppo): niente pannello di sistema, si scarica il file.
      const link = document.createElement('a');
      link.href = uri;
      link.download = title;
      link.click();
      return;
    }
    try {
      await Share.share({ title, files: [uri] });
    } catch (error) {
      // Chiudere il pannello senza scegliere lancia su alcune piattaforme: l'utente ha solo cambiato idea.
      if (!/cancel|dismiss/i.test(String((error as { message?: string })?.message ?? error))) {
        throw error;
      }
    }
  }

  async remove(uri: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: uri });
    } catch {
      // Già cancellato.
    }
  }

  async cleanup(prefix: string): Promise<void> {
    try {
      const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache });
      for (const file of files.filter((f) => f.name.startsWith(prefix))) {
        await Filesystem.deleteFile({ path: file.name, directory: Directory.Cache });
      }
    } catch {
      // Cartella illeggibile: non è un problema, i file stanno in una cache che il sistema svuota.
    }
  }
}
