import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TextError } from './i18n';

/** Phone photos are 12 MP or more, which the wall iPad's memory can't hold for long. */
export const MAX_IMAGE_SIDE = 2048;
const JPEG_QUALITY = 0.85;

/** Where the server serves a stored background. */
export function backgroundUrl(name: string): string {
  return `/api/backgrounds/${name}`;
}

/** Resolves once the image has downloaded and decoded, so it can be shown whole. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new TextError({ key: 'errors.imageUnreadable' }));
    };
    image.src = url;
  });
}

/** Re-encodes an image as a JPEG at most {@link MAX_IMAGE_SIDE} pixels on its longest side. */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new TextError({ key: 'errors.imageResize' });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new TextError({ key: 'errors.imageResize' }));
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shrinks a picked file before upload; replaceable in tests, since jsdom can't decode images. */
export const IMAGE_SHRINKER = new InjectionToken<(file: Blob) => Promise<Blob>>('IMAGE_SHRINKER', {
  providedIn: 'root',
  factory: () => shrinkImage,
});

@Injectable({ providedIn: 'root' })
export class BackgroundsService {
  private readonly http = inject(HttpClient);
  private readonly shrink = inject(IMAGE_SHRINKER);

  /**
   * Shrinks and uploads an image, and returns its stored name. The server only keeps it if the next saved
   * settings list it.
   */
  async upload(file: Blob): Promise<string> {
    const image = await this.shrink(file);
    const { name } = await firstValueFrom(
      this.http.post<{ name: string }>('/api/backgrounds', image, {
        headers: { 'Content-Type': image.type || 'application/octet-stream' },
      }),
    );
    return name;
  }
}
