'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export type PhotoAspect = '4:3' | '1:1' | '16:9';

const ASPECT_CLASS: Record<PhotoAspect, string> = {
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
};

export interface PhotoFrameProps {
  src?: string | null;
  /** Meaningful alt text (dish name) — required per docs/DESIGN_PRINCIPLES.md §7. */
  alt: string;
  aspect?: PhotoAspect;
  className?: string;
  /**
   * Inline base64 data URI of a tiny (~24px) blurred derivative (docs/ARCHITECTURE.md
   * §3a, imageService.blurDataUrlFor) — shown scaled+blurred beneath the full photo
   * until it loads, instead of a flat pulsing placeholder (docs/DESIGN_PRINCIPLES.md §8
   * "blur-up placeholder").
   */
  blurDataUrl?: string | null;
}

/**
 * Photo-first building block (docs/DESIGN_PRINCIPLES.md §1/§8): rounded, object-cover,
 * blur-up placeholder while loading. Falls back to a fallback emoji when no photo is
 * available yet (scan pending / generation failed) — emoji are fallback-only, never the
 * hero of a primary screen.
 */
export function PhotoFrame({ src, alt, aspect = '4:3', className, blurDataUrl }: PhotoFrameProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // The SSR'd <img src> starts loading before React hydrates and attaches onLoad — for
  // instant sources (data URIs, warm browser cache) the load event fires before that
  // listener exists, so `loaded` would otherwise get stuck false forever. Catch that
  // case explicitly once mounted.
  useEffect(() => {
    setLoaded(false);
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <div className={cn('relative overflow-hidden bg-primary-soft', ASPECT_CLASS[aspect], className)}>
      {src ? (
        <>
          {blurDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- tiny inline base64 data URI, not a next/image-optimizable remote asset.
            <img
              src={blurDataUrl}
              alt=""
              aria-hidden="true"
              className={cn(
                'absolute inset-0 h-full w-full scale-110 object-cover blur-lg transition-opacity duration-300',
                loaded ? 'opacity-0' : 'opacity-100'
              )}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- photo sources (StorageAdapter
              route handler, later external URLs) aren't known/configurable as next/image
              remotePatterns yet; revisit once WP-04/WP-07 land the image pipeline. */}
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={cn(
              'relative h-full w-full object-cover transition-opacity duration-300',
              loaded ? 'opacity-100' : 'opacity-0'
            )}
          />
          {!loaded && !blurDataUrl && <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-primary-soft" />}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl" role="img" aria-label={alt}>
          🍽️
        </div>
      )}
    </div>
  );
}
