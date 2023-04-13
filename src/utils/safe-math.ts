export const afterDecimal = (num: number | string) => {
  if (Number.isInteger(num)) return 0;
  return num?.toString()?.split?.('.')?.[1]?.length || 1;
};

export const adjust = (value: number, step: number | string) => {
  const multiplier = 1 / Number(step);
  const adjusted = Math.round(value * multiplier) / multiplier;
  const decimals = afterDecimal(step);
  return Math.round(adjusted * 10 ** decimals) / 10 ** decimals;
};

export const add = (a: number, b: number) => {
  const aDecimals = afterDecimal(a);
  const bDecimals = afterDecimal(b);
  const decimals = Math.max(aDecimals, bDecimals);
  return Math.round((a + b) * 10 ** decimals) / 10 ** decimals;
};

export const subtract = (a: number, b: number) => {
  const aDecimals = afterDecimal(a);
  const bDecimals = afterDecimal(b);
  const decimals = Math.max(aDecimals, bDecimals);
  return Math.round((a - b) * 10 ** decimals) / 10 ** decimals;
};

export const multiply = (a: number, b: number) => {
  const aDecimals = afterDecimal(a);
  const bDecimals = afterDecimal(b);
  const decimals = Math.max(aDecimals, bDecimals);
  return Math.round(a * b * 10 ** decimals) / 10 ** decimals;
};

export const divide = (a: number, b: number) => {
  const aDecimals = afterDecimal(a);
  const bDecimals = afterDecimal(b);
  const decimals = Math.max(aDecimals, bDecimals);
  return Math.round((a / b) * 10 ** decimals) / 10 ** decimals;
};
