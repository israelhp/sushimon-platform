import { describe, expect, it } from 'vitest';
import {
  EMPTY_APPLICATION,
  MAX_CV_BYTES,
  checkCv,
  toApplicationRequest,
  validateApplication,
  type ApplicationValues,
} from './validation';

const valid: ApplicationValues = {
  name: 'Ana López',
  email: 'ana.lopez@ejemplo.com',
  phone: '5555-6789',
  position: 'mesero',
  experience: 'y1to3',
  message: '',
  consent: true,
};
const pdf = { name: 'CV.pdf', size: 1200, type: 'application/pdf' };

describe('checkCv', () => {
  it('exige un PDF de hasta 5 MB', () => {
    expect(checkCv(null)).toBe('cv');
    expect(checkCv({ name: 'cv.docx', size: 10, type: 'application/msword' })).toBe('cvType');
    expect(checkCv({ ...pdf, size: MAX_CV_BYTES + 1 })).toBe('cvSize');
    expect(checkCv(pdf)).toBeNull();
    // Extensión .pdf aunque el navegador no informe el tipo.
    expect(checkCv({ name: 'cv.PDF', size: 10, type: '' })).toBeNull();
  });
});

describe('validateApplication', () => {
  it('formulario vacío: un error por campo obligatorio', () => {
    expect(Object.keys(validateApplication(EMPTY_APPLICATION, null)).sort()).toEqual([
      'consent',
      'cv',
      'email',
      'experience',
      'name',
      'phone',
      'position',
    ]);
  });

  it('datos válidos: sin errores', () => {
    expect(validateApplication(valid, pdf)).toEqual({});
  });

  it('teléfono y correo inválidos', () => {
    expect(validateApplication({ ...valid, phone: '123', email: 'x@y' }, pdf)).toEqual({
      phone: 'phone',
      email: 'email',
    });
  });
});

describe('toApplicationRequest', () => {
  it('solo envía nombre y tamaño del CV (la subida real está pendiente)', () => {
    const request = toApplicationRequest({ ...valid, name: '  Ana López ' }, pdf);
    expect(request).toMatchObject({
      name: 'Ana López',
      cvFileName: 'CV.pdf',
      cvSizeBytes: 1200,
      consent: true,
    });
    expect(Object.keys(request)).not.toContain('cv');
  });
});
