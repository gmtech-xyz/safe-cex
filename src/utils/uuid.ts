import { nanoid } from 'nanoid';

export const uuid = () => {
  return nanoid().replace(/-|_/g, '');
};
