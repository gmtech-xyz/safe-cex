import chunk from 'lodash/chunk';
import { reduce } from 'p-iteration';

export const batchPromises = <T extends any[], K>(
  arr: T,
  promise: (item: T[number]) => Promise<K>,
  batchSize = 10
) => {
  const batches = chunk(arr, batchSize);
  return reduce(
    batches,
    async (acc, batch) => {
      const chunkResults = await Promise.all(batch.map(promise));
      return [...acc, ...chunkResults];
    },
    [] as K[]
  );
};
