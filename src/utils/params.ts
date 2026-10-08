/** Cast a route param or query value to string safely */
export const p = (val: string | string[] | undefined): string => {
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
};

/** Cast a query value to string or undefined */
export const q = (val: unknown): string | undefined => {
  if (!val) return undefined;
  if (Array.isArray(val)) return String((val as string[])[0]);
  return String(val);
};

/** Cast a query value to string with default */
export const qs = (val: unknown, defaultVal = ''): string => {
  if (!val) return defaultVal;
  if (Array.isArray(val)) return String((val as string[])[0] || defaultVal);
  return String(val) || defaultVal;
};
