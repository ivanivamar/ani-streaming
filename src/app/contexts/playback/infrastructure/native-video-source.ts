import { Injectable } from '@angular/core';
import { nativeDriveUrl } from '@shared/infrastructure';
import { nativeSrc, VideoSourcePort, type DriveVideo } from '../domain';

/**
 * Android app: the video plays in the native player (`nativeSrc` tells the watch page so), and
 * small Drive files (thumbnails) load from `/__drive/<id>`, which MainActivity's WebView client
 * answers from the downloaded copy or from Drive with the native token. No service worker.
 */
@Injectable()
export class NativeVideoSource extends VideoSourcePort {
  init(): Promise<boolean> {
    return Promise.resolve(true);
  }

  streamUrl(video: DriveVideo): Promise<string | null> {
    return Promise.resolve(nativeSrc(video));
  }

  imageUrl(driveFileId: string, mimeType = 'image/webp'): string | null {
    return nativeDriveUrl(driveFileId, mimeType);
  }
}
