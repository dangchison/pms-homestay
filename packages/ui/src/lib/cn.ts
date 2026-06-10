import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gộp class Tailwind chuẩn shadcn — dùng thống nhất toàn FE. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
