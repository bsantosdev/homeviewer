import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { HttpTestingController } from '@angular/common/http/testing';
import {
  BackgroundsService,
  IMAGE_SHRINKER,
  MAX_IMAGE_SIDE,
  backgroundUrl,
  loadImage,
  shrinkImage,
} from './backgrounds';
import { fakeImageLoading, provideTestBackend } from '../testing/test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backgroundUrl', () => {
  it('points at the server’s copy', () => {
    expect(backgroundUrl('abc.jpg')).toBe('/api/backgrounds/abc.jpg');
  });
});

describe('loadImage', () => {
  it('resolves once the image has loaded', async () => {
    fakeImageLoading();
    const image = await loadImage('/a.jpg');
    expect(image).toBeInstanceOf(HTMLImageElement);
  });

  it('rejects an image the browser can’t read', async () => {
    fakeImageLoading({ fails: () => true });
    await expect(loadImage('/a.heic')).rejects.toThrow('errors.imageUnreadable');
  });
});

describe('shrinkImage', () => {
  const file = new Blob(['photo'], { type: 'image/heic' });
  let drawImage: MockInstance<CanvasRenderingContext2D['drawImage']>;
  let toBlob: MockInstance<HTMLCanvasElement['toBlob']>;
  let revoke: MockInstance<(url: string) => void>;

  beforeEach(() => {
    // jsdom has no object URLs and no canvas drawing.
    revoke = vi.fn<(url: string) => void>();
    Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: revoke });
    drawImage = vi.fn<CanvasRenderingContext2D['drawImage']>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback: BlobCallback) => {
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
      });
  });

  it('scales the longest side down and encodes a JPEG', async () => {
    fakeImageLoading({ width: 4032, height: 3024 });

    const result = await shrinkImage(file);

    expect(result.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_IMAGE_SIDE, 1536);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });

  it('never scales a small image up', async () => {
    fakeImageLoading({ width: 800, height: 1200 });
    await shrinkImage(file);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 1200);
  });

  it('fails without a canvas to draw on', async () => {
    fakeImageLoading();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(shrinkImage(file)).rejects.toThrow('errors.imageResize');
    expect(revoke).toHaveBeenCalled();
  });

  it('fails when the canvas can’t encode', async () => {
    fakeImageLoading();
    toBlob.mockImplementation((callback: BlobCallback) => {
      callback(null);
    });
    await expect(shrinkImage(file)).rejects.toThrow('errors.imageResize');
  });
});

describe('BackgroundsService', () => {
  let http: HttpTestingController;
  const shrunk = new Blob(['small'], { type: 'image/jpeg' });
  const shrink = vi.fn<(file: Blob) => Promise<Blob>>();

  beforeEach(() => {
    shrink.mockResolvedValue(shrunk);
    TestBed.configureTestingModule({
      providers: [...provideTestBackend(), { provide: IMAGE_SHRINKER, useValue: shrink }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('uploads the shrunk image and returns its stored name', async () => {
    const original = new Blob(['big'], { type: 'image/png' });

    const uploading = TestBed.inject(BackgroundsService).upload(original);
    await Promise.resolve();
    const req = http.expectOne({ method: 'POST', url: '/api/backgrounds' });
    req.flush({ name: 'abc.jpg' });

    expect(await uploading).toBe('abc.jpg');
    expect(shrink).toHaveBeenCalledWith(original);
    expect(req.request.body).toBe(shrunk);
    expect(req.request.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('sends a typeless image as plain bytes', async () => {
    shrink.mockResolvedValue(new Blob(['?']));

    const uploading = TestBed.inject(BackgroundsService).upload(new Blob(['?']));
    await Promise.resolve();
    const req = http.expectOne('/api/backgrounds');
    req.flush({ name: 'abc.jpg' });
    await uploading;

    expect(req.request.headers.get('Content-Type')).toBe('application/octet-stream');
  });
});
