export const toBase64 = (str: string) => {
  if (typeof window !== 'undefined') {
    return window.btoa(str);
  }

  return Buffer.from(str).toString('base64');
};
