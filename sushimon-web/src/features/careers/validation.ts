import type { JobApplicationRequest } from '@/lib/data-access/models';
import { isValidEmail, isValidPhone } from '../account/validation';

/** Vacantes abiertas (contenido de demostración; el listado real vendrá de la API: pendiente). */
export const POSITION_IDS = ['cocinero-sushi', 'mesero', 'auxiliar-cocina', 'repartidor'] as const;
export type PositionId = (typeof POSITION_IDS)[number];

export const EXPERIENCE_OPTIONS = [
  'none',
  'lt1',
  'y1to3',
  'gt3',
] as const satisfies readonly JobApplicationRequest['experience'][];

/** Tamaño máximo del CV (PDF). */
export const MAX_CV_BYTES = 5 * 1024 * 1024;

export interface ApplicationValues {
  name: string;
  email: string;
  phone: string;
  /** Id de vacante o "other". */
  position: string;
  experience: string;
  message: string;
  consent: boolean;
}

export const EMPTY_APPLICATION: ApplicationValues = {
  name: '',
  email: '',
  phone: '',
  position: '',
  experience: '',
  message: '',
  consent: false,
};

export type ApplicationField =
  'name' | 'email' | 'phone' | 'position' | 'experience' | 'cv' | 'consent';

/** Orden visual de los campos (para enfocar el primer error y listar el resumen). */
export const APPLICATION_FIELD_ORDER: readonly ApplicationField[] = [
  'name',
  'email',
  'phone',
  'position',
  'experience',
  'cv',
  'consent',
];

/** Claves de `careers.errors.*` por campo. */
export type ApplicationErrors = Partial<
  Record<
    ApplicationField,
    'name' | 'email' | 'phone' | 'position' | 'experience' | 'cv' | 'cvType' | 'cvSize' | 'consent'
  >
>;

export interface CvInfo {
  name: string;
  size: number;
  type: string;
}

/** Valida el archivo del CV (PDF, hasta 5 MB). Devuelve la clave de error o null. */
export function checkCv(file: CvInfo | null): 'cv' | 'cvType' | 'cvSize' | null {
  if (!file) return 'cv';
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return 'cvType';
  if (file.size > MAX_CV_BYTES) return 'cvSize';
  return null;
}

export function validateApplication(
  values: ApplicationValues,
  cv: CvInfo | null,
): ApplicationErrors {
  const errors: ApplicationErrors = {};
  if (values.name.trim().length < 3) errors.name = 'name';
  if (!isValidEmail(values.email)) errors.email = 'email';
  if (!isValidPhone(values.phone)) errors.phone = 'phone';
  if (!values.position) errors.position = 'position';
  if (!values.experience) errors.experience = 'experience';
  const cvError = checkCv(cv);
  if (cvError) errors.cv = cvError;
  if (!values.consent) errors.consent = 'consent';
  return errors;
}

/** Arma la solicitud del contrato. El CV real se subirá con almacenamiento firmado (pendiente). */
export function toApplicationRequest(values: ApplicationValues, cv: CvInfo): JobApplicationRequest {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    position: values.position,
    experience: values.experience as JobApplicationRequest['experience'],
    message: values.message.trim(),
    consent: values.consent,
    cvFileName: cv.name,
    cvSizeBytes: cv.size,
  };
}
