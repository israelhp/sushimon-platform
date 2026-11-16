'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ImageProcessor } from '@/lib/media-optimize';
import type { MediaUploader } from '@/services/media-uploader';

/**
 * F14 — Herramientas de subida inyectables. Por defecto: `ImageProcessor` del navegador (canvas) y `MediaUploader` según el
 * cliente de datos (mock → almacén simulado; http → PUT directo con XMLHttpRequest). Las pruebas inyectan dobles (jsdom no tiene
 * canvas ni red).
 */
export interface MediaTools {
  processor?: ImageProcessor;
  uploader?: MediaUploader;
}

const MediaToolsContext = createContext<MediaTools>({});

export function MediaToolsProvider({
  value,
  children,
}: {
  value: MediaTools;
  children: ReactNode;
}) {
  return <MediaToolsContext.Provider value={value}>{children}</MediaToolsContext.Provider>;
}

export const useMediaTools = (): MediaTools => useContext(MediaToolsContext);
