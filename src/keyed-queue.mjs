export class KeyedQueue {
  constructor() {
    this.pending = new Map();
  }

  async run(key, task) {
    if (typeof task !== "function") throw new Error("KeyedQueue requires a task.");
    const previous = this.pending.get(key) || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(task);
    this.pending.set(key, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }
}
