import { describe, expect, it } from "vitest";
import { CommandGenerator } from "../src/command-generator.js";

const request = {
  prompt: "hello",
  cwd: process.cwd(),
  timeoutMs: 5000
};

describe("generic generator command adapter", () => {
  it("passes the effective prompt over stdin and accepts the JSON envelope", async () => {
    const generator = new CommandGenerator(process.execPath, ["-e", "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({result:s.toUpperCase(),source:'test'})))"]);
    await expect(generator.generate(request)).resolves.toEqual({ text: "HELLO", metadata: { source: "test" } });
  });

  it("accepts plain text from a simple wrapper", async () => {
    const generator = new CommandGenerator(process.execPath, ["-e", "process.stdout.write('plain response')"]);
    await expect(generator.generate(request)).resolves.toMatchObject({ text: "plain response" });
  });

  it("preserves a failed command as a generator error", async () => {
    const generator = new CommandGenerator(process.execPath, ["-e", "process.stderr.write('wrapper failed');process.exit(3)"]);
    await expect(generator.generate(request)).rejects.toThrow(/wrapper failed/);
  });
});
