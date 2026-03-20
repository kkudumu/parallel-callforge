import { spawn } from "node:child_process";

interface RunCliCommandOptions {
  // Maximum idle time without any stdout/stderr activity before killing the command.
  timeoutMs: number;
  // Absolute upper bound regardless of output activity.
  hardTimeoutMs?: number;
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
    const idleTimeoutMs = options.timeoutMs;
    const hardTimeoutMs =
      options.hardTimeoutMs ??
      Math.max(idleTimeoutMs * 10, 30 * 60 * 1000);
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
      clearTimeout(idleTimeout);
      clearTimeout(hardTimeout);
      err.stdout = stdout;
      err.stderr = stderr;
      err.elapsedMs = Date.now() - startedAt;
      err.stdoutTail = tailText(stdout);
      err.stderrTail = tailText(stderr);
      reject(err);
    };

    const resetIdleTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        child.kill("SIGTERM");
        fail(
          new Error(
            `Command idle-timed out after ${idleTimeoutMs}ms without output (elapsed ${Date.now() - startedAt}ms)`
          ) as CommandError
        );
      }, idleTimeoutMs);
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }

      options.onOutput?.(chunk, stream);
      resetIdleTimeout();

      if (stdout.length + stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        fail(new Error(`maxBuffer exceeded: ${options.maxBuffer} bytes`) as CommandError);
      }
    };

    let idleTimeout = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new Error(
          `Command idle-timed out after ${idleTimeoutMs}ms without output (elapsed ${Date.now() - startedAt}ms)`
        ) as CommandError
      );
    }, idleTimeoutMs);

    const hardTimeout = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new Error(
          `Command hard-timed out after ${hardTimeoutMs}ms (elapsed ${Date.now() - startedAt}ms)`
        ) as CommandError
      );
    }, hardTimeoutMs);

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
      clearTimeout(idleTimeout);
      clearTimeout(hardTimeout);

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
