import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** What a rejected `exec` carries over and above an ordinary Error. */
type ExecFailure = Error & { stdout?: string; stderr?: string };

/**
 * Run the `cloud-jobs` Python roster sync straight from the checkout. This is
 * the local-development path for the committee's "Sync now" button; in
 * production the same job runs on Cloud Run (see `runCloudRunJob`).
 *
 * The project root is a parameter rather than a `process.cwd()` call inside
 * this file, and that is load-bearing. Turbopack resolves any path expression
 * it can evaluate at build time into an asset reference and then traces it;
 * tracing `cloud-jobs` walks into the virtualenv, whose `bin/python3` symlink
 * points at the system interpreter outside the project, and the build dies
 * with "Symlink ... points out of the filesystem root". Taking the root as an
 * argument leaves these paths unknowable until the route actually calls this.
 */
export async function runLocalRosterSync(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const cloudJobsDir = path.resolve(projectRoot, "cloud-jobs");
  const venvPython = path.resolve(cloudJobsDir, ".venv", "bin", "python3");
  const pythonBin = fs.existsSync(venvPython) ? venvPython : "python3";

  try {
    const { stdout, stderr } = await execAsync(`"${pythonBin}" -m hiking_sync.roster_sync`, {
      cwd: cloudJobsDir,
      env: {
        ...env,
        // `exec`'s env replaces the environment rather than adding to it, so the
        // shell's own PYTHONPATH is carried over by hand, as it was before.
        PYTHONPATH:
          path.resolve(cloudJobsDir, "src") +
          (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""),
      },
    });
    return stdout || stderr;
  } catch (cause) {
    // Any non-zero exit rejects, and the rejection's own message is only the
    // command line — the job's explanation is on stderr. Passed through as-is
    // the committee would read "Command failed: ".../python3" -m
    // hiking_sync.roster_sync", and the caller's check for "redirected to the
    // login page" (which is what marks the SU session expired) could never
    // match, because that sentence is on a property nothing looked at.
    const failure = cause as ExecFailure;
    const reason = (failure.stderr || failure.stdout || "").trim();
    if (!reason) throw cause;
    throw new Error(reason, { cause });
  }
}
