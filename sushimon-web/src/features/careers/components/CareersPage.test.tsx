import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { CareersPage } from './CareersPage';

beforeAll(() => {
  // jsdom no implementa estas APIs del navegador.
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
});

// El campo de archivo acepta solo PDF; la prueba adjunta también otros tipos para validar el mensaje.
afterEach(() => vi.unstubAllGlobals());

const setup = () => userEvent.setup({ applyAccept: false });
const pdf = () => new File(['%PDF-1.4'], 'CV-Ana.pdf', { type: 'application/pdf' });

describe('Trabaja con nosotros', () => {
  it('muestra las vacantes y "Postularme" preselecciona el puesto', async () => {
    const user = setup();
    await renderStore(<CareersPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/MONcheros/);
    expect(screen.getAllByRole('button', { name: /Postularme/ })).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Postularme: Repartidor' }));
    expect(screen.getByLabelText('Puesto de interés *')).toHaveValue('repartidor');
  });

  it('rotula la subida de CV como simulada', async () => {
    await renderStore(<CareersPage />);
    expect(screen.getByText(/Simulación: por ahora el archivo no se sube/)).toBeVisible();
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
  });

  it('formulario vacío: resumen de errores, mensajes asociados y foco en el primer campo', async () => {
    const user = setup();
    await renderStore(<CareersPage />);
    await user.click(screen.getByRole('button', { name: 'Enviar postulación' }));

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText('Revisá los campos marcados')).toBeVisible();
    expect(within(summary).getAllByRole('link')).toHaveLength(7);

    const name = screen.getByLabelText('Nombre completo *');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Escribí tu nombre completo.');
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.getByLabelText('Acepto', { exact: false })).toHaveAccessibleDescription(
      'Necesitamos tu consentimiento para continuar.',
    );
    // El error desaparece al corregir el campo.
    await user.type(name, 'Ana López');
    expect(name).toHaveAttribute('aria-invalid', 'false');
  });

  it('el enlace del resumen lleva el foco al campo', async () => {
    const user = setup();
    await renderStore(<CareersPage />);
    await user.click(screen.getByRole('button', { name: 'Enviar postulación' }));
    const summary = await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('Nombre completo *')).toHaveFocus());
    await user.click(within(summary).getByRole('link', { name: 'Ingresá un correo válido.' }));
    expect(screen.getByLabelText('Correo electrónico *')).toHaveFocus();
  });

  it('un frame tardío no le quita el foco al campo que el usuario ya eligió (regresión CI)', async () => {
    // Frames controlados a mano: simula un runner lento donde el frame que enfoca el primer
    // campo inválido llega DESPUÉS de que el usuario ya pulsó un enlace del resumen.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const user = setup();
    await renderStore(<CareersPage />);
    await user.click(screen.getByRole('button', { name: 'Enviar postulación' }));
    const summary = await screen.findByRole('alert');
    await user.click(within(summary).getByRole('link', { name: 'Ingresá un correo válido.' }));
    expect(screen.getByLabelText('Correo electrónico *')).toHaveFocus();
    frames.splice(0).forEach((cb) => cb(0)); // llega el frame pendiente del envío
    expect(screen.getByLabelText('Correo electrónico *')).toHaveFocus();
  });

  it('rechaza un CV que no es PDF y uno mayor a 5 MB', async () => {
    const user = setup();
    await renderStore(<CareersPage />);
    const input = screen.getByLabelText(/Tocá para adjuntar tu CV/);
    await user.upload(input, new File(['x'], 'cv.docx', { type: 'application/msword' }));
    expect(await screen.findByText('El CV debe ser un archivo PDF.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const big = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await screen.findByText('El PDF supera los 5 MB.')).toBeVisible();
  });

  it('postulación válida: se envía solo nombre y tamaño del CV y se muestra la confirmación', async () => {
    const user = setup();
    await renderStore(<CareersPage />);
    await user.type(screen.getByLabelText('Nombre completo *'), 'Ana López');
    await user.type(screen.getByLabelText('Correo electrónico *'), 'ana.lopez@ejemplo.com');
    await user.type(screen.getByLabelText('Teléfono *'), '5555-6789');
    await user.selectOptions(screen.getByLabelText('Puesto de interés *'), 'mesero');
    await user.selectOptions(screen.getByLabelText('Experiencia *'), 'y1to3');
    await user.upload(screen.getByLabelText(/Tocá para adjuntar tu CV/), pdf());
    expect(await screen.findByText('CV-Ana.pdf')).toBeVisible();
    await user.click(screen.getByLabelText('Acepto', { exact: false }));
    await user.click(screen.getByRole('button', { name: 'Enviar postulación' }));

    expect(await screen.findByText('¡Recibimos tu postulación!')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enviar postulación' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  });
});
