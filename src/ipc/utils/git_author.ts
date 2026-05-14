import { exec } from "dugite";

export async function getGitAuthor() {
  const [nameResult, emailResult] = await Promise.all([
    exec(["config", "--global", "user.name"], process.cwd()),
    exec(["config", "--global", "user.email"], process.cwd()),
  ]);
  return {
    name: nameResult.stdout.trim() || "Unknown",
    email: emailResult.stdout.trim() || "unknown@unknown.com",
  };
}
