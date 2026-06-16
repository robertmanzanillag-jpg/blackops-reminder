type TelegramUpdateLike = {
  update_id?: unknown;
};

export type TelegramUpdateDeduper = {
  shouldProcess(update: TelegramUpdateLike): boolean;
  size(): number;
};

export function createTelegramUpdateDeduper(maxEntries = 500): TelegramUpdateDeduper {
  const seen = new Set<number>();
  const order: number[] = [];

  function remember(updateId: number): void {
    seen.add(updateId);
    order.push(updateId);

    while (order.length > maxEntries) {
      const oldest = order.shift();
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  return {
    shouldProcess(update: TelegramUpdateLike): boolean {
      if (typeof update.update_id !== "number" || !Number.isFinite(update.update_id)) {
        return true;
      }

      if (seen.has(update.update_id)) return false;
      remember(update.update_id);
      return true;
    },
    size(): number {
      return seen.size;
    },
  };
}
