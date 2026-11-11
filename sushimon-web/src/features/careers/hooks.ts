'use client';

import { useMutation } from '@tanstack/react-query';
import type { JobApplicationRequest } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { submitJobApplication } from '@/services/store';

/** Envía la postulación (el CV real se subirá con almacenamiento firmado: pendiente). */
export function useSubmitJobApplication() {
  const client = useDataClient();
  return useMutation({
    mutationFn: (input: JobApplicationRequest) => submitJobApplication(client, input),
  });
}
