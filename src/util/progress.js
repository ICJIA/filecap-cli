export class Progress {
  #enabled;
  #count = 0;
  #lastEmit = 0;

  constructor({ enabled = false, stream = process.stderr } = {}) {
    this.#enabled = enabled;
    this.stream = stream;
  }

  tick(label) {
    if (!this.#enabled) return;
    this.#count++;
    const now = Date.now();
    if (now - this.#lastEmit < 100 && label === undefined) return;
    this.#lastEmit = now;
    const text = label ? `[${this.#count}] ${label}` : `[${this.#count}]`;
    this.stream.write(`${text}\n`);
  }

  end(summary) {
    if (!this.#enabled) return;
    this.stream.write(`done — ${this.#count} files processed${summary ? `, ${summary}` : ""}\n`);
  }
}
