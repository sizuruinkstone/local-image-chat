import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  #filePath;
  #initialValue;
  #writeQueue = Promise.resolve();

  constructor(filePath, initialValue) {
    this.#filePath = filePath;
    this.#initialValue = structuredClone(initialValue);
  }

  async read() {
    await this.#writeQueue;
    return this.#readUnsafe();
  }

  async update(mutator) {
    const operation = this.#writeQueue.then(async () => {
      const current = await this.#readUnsafe();
      const next = await mutator(structuredClone(current));
      const value = next === undefined ? current : next;
      await this.#writeUnsafe(value);
      return structuredClone(value);
    });
    this.#writeQueue = operation.catch(() => {});
    return operation;
  }

  async #readUnsafe() {
    try {
      const text = await fs.readFile(this.#filePath, "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.#writeUnsafe(this.#initialValue);
      return structuredClone(this.#initialValue);
    }
  }

  async #writeUnsafe(value) {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.#filePath);
  }
}
