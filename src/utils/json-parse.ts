export const jsonParse = <T extends Record<string, any>>(
  str: string
): T | null => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};
