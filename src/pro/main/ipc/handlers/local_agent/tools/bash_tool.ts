import { spawn, execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  getSessionCwd,
  setSessionCwd,
  makeCwdTempFile,
} from "./shell_session";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 20_000;

const bashSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout_ms: z
    .number()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(
      `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
    ),
});

// ── Shell detection (cached) ────────────────────────────────────────────────

let _win32ShellPath: string | null | undefined;

/** Find bash on Windows (Git Bash, MSYS2, WSL). Returns null if not found. */
function findWindowsBash(): string | null {
  if (_win32ShellPath !== undefined) return _win32ShellPath;
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\msys64\\usr\\bin\\bash.exe",
    "bash.exe", // on PATH
  ];
  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --version`, { stdio: "ignore" });
      _win32ShellPath = candidate;
      return candidate;
    } catch {
      // not found, try next
    }
  }
  _win32ShellPath = null;
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return (
    output.slice(0, half) +
    `\n...[truncated: showing first and last ${half} of ${output.length} chars]...\n` +
    output.slice(-half)
  );
}

/**
 * Convert a Windows path to a POSIX path for use inside bash (e.g. Git Bash).
 * D:\foo\bar → /d/foo/bar
 */
function winToPosixPath(winPath: string): string {
  const drive = winPath.charAt(0).toLowerCase();
  return "/" + drive + winPath.slice(2).replace(/\\/g, "/");
}

// ── Shell script builders ───────────────────────────────────────────────────

/**
 * Build a bash command string that:
 * 1. Changes to the CWD
 * 2. Merges stderr into stdout (2>&1 — like Claude Code's single-fd approach)
 * 3. Runs the user command in a subshell
 * 4. Captures the new CWD and exit code
 */
function buildBashScript(
  cwd: string,
  command: string,
  cwdFile: string,
  isWindowsBash: boolean,
): string {
  const workDir = isWindowsBash ? winToPosixPath(cwd) : cwd;
  const outFile = isWindowsBash ? winToPosixPath(cwdFile) : cwdFile;
  return [
    `cd ${JSON.stringify(workDir)} 2>/dev/null || true`,
    // Merge stderr into stdout — avoids PowerShell stderr wrapping on Windows
    // and interleaves all output naturally (same approach as Claude Code)
    `{ ${command}; } 2>&1`,
    `_dyad_exit=$?`,
    `pwd -P > ${JSON.stringify(outFile)} 2>/dev/null || echo "${workDir}" > ${JSON.stringify(outFile)}`,
    `exit $_dyad_exit`,
  ].join("\n");
}

/**
 * Fallback for Windows when bash is unavailable. Uses cmd.exe /c which
 * produces plain-text stderr (unlike PowerShell which wraps it in CLIXML).
 */
function buildCmdScript(
  cwd: string,
  command: string,
  cwdFile: string,
): string {
  // cmd.exe /d /c: cd /d changes drive+dir, stderr merged via 2>&1,
  // echo %cd% updates CWD file.
  const cwdLine = `cd /d "${cwd}" 2>nul`;
  const cwdCapture = `echo %cd%> "${cwdFile}"`;
  return `${cwdLine} & (${command}) 2>&1 & (${cwdCapture})`;
}

// ── Spawn ───────────────────────────────────────────────────────────────────

function spawnShell(
  command: string,
  cwd: string,
  cwdFile: string,
  timeout: number,
  onOutput: (chunk: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    let timedOut = false;

    if (process.platform === "win32") {
      const bashPath = findWindowsBash();
      if (bashPath) {
        const script = buildBashScript(cwd, command, cwdFile, true);
        child = spawn(bashPath, ["-c", script], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        // Merge stderr into our single output callback (bash stderr is plain text)
        child.stderr?.on("data", (chunk: Buffer) =>
          onOutput(chunk.toString("utf8")),
        );
      } else {
        // No bash found — use cmd.exe as fallback (plain-text stderr)
        const script = buildCmdScript(cwd, command, cwdFile);
        child = spawn("cmd.exe", ["/d", "/c", script], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        child.stderr?.on("data", (chunk: Buffer) =>
          onOutput(chunk.toString("utf8")),
        );
      }
    } else {
      const script = buildBashScript(cwd, command, cwdFile, false);
      child = spawn("bash", ["-c", script], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      // stderr merged via 2>&1 in the command, but capture any shell-level stderr too
      child.stderr?.on("data", (chunk: Buffer) =>
        onOutput(chunk.toString("utf8")),
      );
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeout);

    child.stdout?.on("data", (chunk: Buffer) =>
      onOutput(chunk.toString("utf8")),
    );

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(timedOut ? 124 : (code ?? 1));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      onOutput(`[error] ${err.message}\n`);
      resolve(1);
    });
  });
}

export const bashTool: ToolDefinition<z.infer<typeof bashSchema>> = {
  name: "bash",
  description: `Execute a shell command. Working directory persists between calls within the same chat session.

- CWD persists: \`cd src && ls\` then a later call sees \`src/\` as cwd
- Streams output in real time as the command runs
- stderr is merged into stdout (same approach as Claude Code)
- Default timeout: ${DEFAULT_TIMEOUT_MS / 1000}s (configurable up to ${MAX_TIMEOUT_MS / 1000}s)
- Output truncated at ${MAX_OUTPUT_CHARS.toLocaleString()} chars if too large
- Prefer purpose-built tools (read_file, grep, glob, add_dependency) when available`,
  inputSchema: bashSchema,
  defaultConsent: "ask",
  modifiesState: true,

  getConsentPreview: (args) => args.command,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    if (!args.command) return undefined;
    const preview = args.command.slice(0, 80);
    return `<dyad-status title="bash: ${escapeXmlAttr(preview)}" state="pending"></dyad-status>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const timeout = Math.min(
      args.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    const titlePreview = escapeXmlAttr(args.command.slice(0, 60));

    const cwd = getSessionCwd(ctx.chatId, ctx.appPath);
    const cwdFile = makeCwdTempFile(crypto.randomUUID());

    let outputBuf = "";

    function updateStream() {
      const display = truncateOutput(outputBuf);
      ctx.onXmlStream(
        `<dyad-status title="bash: ${titlePreview}" state="in-progress">\n${escapeXmlContent(display || "(running…")}\n</dyad-status>`,
      );
    }

    updateStream();

    const exitCode = await spawnShell(
      args.command,
      cwd,
      cwdFile,
      timeout,
      (chunk) => {
        outputBuf += chunk;
        updateStream();
      },
    );

    // Read new cwd from temp file
    try {
      const rawCwd = readFileSync(cwdFile, "utf8").trim();
      if (rawCwd) {
        // On Windows bash, convert POSIX path back to Windows path
        const newCwd =
          process.platform === "win32" && /^\/[a-z](\/|$)/i.test(rawCwd)
            ? rawCwd[1].toUpperCase() + ":" + rawCwd.slice(2).replace(/\//g, "\\")
            : rawCwd;
        setSessionCwd(ctx.chatId, newCwd);
      }
    } catch {
      // keep previous cwd
    }
    try {
      unlinkSync(cwdFile);
    } catch {
      // ignore
    }

    const trimmed = outputBuf.trimEnd();
    const display = trimmed ? truncateOutput(trimmed) : "(no output)";
    const resultText =
      exitCode !== 0 ? `${display}\n[Exit code: ${exitCode}]` : display;

    const state = exitCode === 0 ? "finished" : "aborted";
    ctx.onXmlComplete(
      `<dyad-status title="bash: ${titlePreview}" state="${state}">\n${escapeXmlContent(resultText)}\n</dyad-status>`,
    );

    return resultText;
  },
};
