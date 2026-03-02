import { spawn } from "node:child_process";

interface RunCliCommandOptions {
  timeoutMs: number;
  maxBuffer: number;
  env?: Record<string, string | undefined>;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

type CommandError = Error & {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  elapsedMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
};

function tailText(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(-maxChars);
}

export function runCliCommand(
  file: string,
  args: string[],
  options: RunCliCommandOptions
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(file, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (err: CommandError) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      err.stdout = stdout;
      err.stderr = stderr;
      err.elapsedMs = Date.now() - startedAt;
      err.stdoutTail = tailText(stdout);
      err.stderrTail = tailText(stderr);
      reject(err);
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }

      options.onOutput?.(chunk, stream);

      if (stdout.length + stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        fail(new Error(`maxBuffer exceeded: ${options.maxBuffer} bytes`) as CommandError);
      }
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new Error(
          `Command timed out after ${options.timeoutMs}ms (elapsed ${Date.now() - startedAt}ms)`
        ) as CommandError
      );
    }, options.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => appendChunk("stdout", chunk));
    child.stderr?.on("data", (chunk: string) => appendChunk("stderr", chunk));

    child.on("error", (error) => {
      fail(error as CommandError);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(
        signal
          ? `Command terminated by signal ${signal}`
          : `Command failed with exit code ${code ?? "unknown"}`
      ) as CommandError;
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      error.elapsedMs = Date.now() - startedAt;
      error.stdoutTail = tailText(stdout);
      error.stderrTail = tailText(stderr);
      reject(error);
    });

    child.stdin?.end();
  });
}
