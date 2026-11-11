import { clsx, type ClassValue } from 'clsx';

/** Une clases condicionales (clsx). Sin tailwind-merge: el orden de las clases lo decide quien llama. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
