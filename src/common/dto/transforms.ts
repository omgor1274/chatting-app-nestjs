import { Transform } from 'class-transformer';

export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const NormalizeEmail = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export const ParseBoolean = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();

      if (normalized === 'true' || normalized === '1') {
        return true;
      }

      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }

    return value;
  });
