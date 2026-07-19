import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(`Command failed (exit ${exitCode}): ${command} ${args.join(" ")}\n${stderr}`);
    this.name = "CommandError";
  }
}

/**
 * Runs a command with an explicit argument array — never a shell string —
 * so instance/unit names can never be interpreted as shell syntax no
 * matter what characters end up in them.
 */
export function runCommand(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new CommandError(command, args, code, stderr));
        return;
      }
      resolve(stdout);
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
