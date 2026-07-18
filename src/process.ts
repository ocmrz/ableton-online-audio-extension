import { spawn } from "node:child_process";
import * as path from "node:path";

const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin"];

function augmentedPath(): string {
  const parts = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const p of EXTRA_PATHS) if (!parts.includes(p)) parts.push(p);
  return parts.join(path.delimiter);
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runProcess(
  bin: string,
  args: string[],
  signal?: AbortSignal,
  onStdoutLine?: (line: string) => void,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }

    const child = spawn(bin, args, {
      env: { ...process.env, PATH: augmentedPath() },
    });

    let stdout = "";
    let stderr = "";
    let outBuf = "";
    let settled = false;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, 800).unref?.();
      // Don't wait forever for close — cancel must unblock the progress dialog.
      setTimeout(() => {
        finish({ stdout, stderr, code: null });
      }, 1000).unref?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!onStdoutLine) return;
      outBuf += text;
      let nl: number;
      while ((nl = outBuf.indexOf("\n")) >= 0) {
        onStdoutLine(outBuf.slice(0, nl));
        outBuf = outBuf.slice(nl + 1);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // yt-dlp progress often lands on stderr
      if (!onStdoutLine) return;
      for (const line of text.split("\n")) {
        if (line.trim()) onStdoutLine(line);
      }
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (outBuf && onStdoutLine) onStdoutLine(outBuf);
      finish({ stdout, stderr, code });
    });
  });
}
