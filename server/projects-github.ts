import { execFile } from "node:child_process";

const API = "https://api.github.com";
const MAX_REPOS = 100;

export interface GithubRepo { name: string; fullName: string; defaultBranch: string; pushedAt: string }

function run(cmd: string, args: string[], input: string | null, timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
    child.stdin?.end(input ?? "");
  });
}

/** A token from the GitHub CLI, when it is installed and signed in. */
async function ghCliToken(): Promise<string | null> {
  return (await run("gh", ["auth", "token"], null, 10_000))?.trim() || null;
}

/**
 * The github.com login Git already keeps (Git Credential Manager, osxkeychain, a store file).
 * With no stored login, Git Credential Manager opens its own sign-in window (it skips that when
 * GIT_TERMINAL_PROMPT=0, so the variable is left alone); the person has two minutes to finish.
 */
export function gitCredentialToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["credential", "fill"],
      // No windowsHide: on Windows it would also hide Git Credential Manager's sign-in window.
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const line = stdout.split("\n").find((l) => l.startsWith("password="));
        resolve(line ? line.slice("password=".length).trim() || null : null);
      },
    );
    child.stdin?.end("protocol=https\nhost=github.com\n\n");
  });
}

let tokenPromise: Promise<string | null> | null = null;
/** A missing token is asked for again on the next scan, so signing in later takes effect without a restart. */
function token(): Promise<string | null> {
  tokenPromise ??= (async () => (await ghCliToken()) ?? (await gitCredentialToken()))();
  return tokenPromise.then((value) => {
    if (!value) tokenPromise = null;
    return value;
  });
}

export async function githubSignedIn(): Promise<boolean> {
  return Boolean(await token());
}

async function gh<T>(path: string, auth: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "openmausbot-projects",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error("GitHub unreachable: check the internet connection"); });
  if (res.status === 401 && auth) {
    tokenPromise = null;
    return gh<T>(path, null);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    if (res.status === 404) throw new Error(auth ? "GitHub: not found, or this GitHub login cannot see it" : "GitHub: not found, or private: sign in to GitHub with Git on this computer");
    if (res.status === 403 || res.status === 429) throw new Error(`GitHub: ${body.message ?? "rate limited, try again later"}`);
    throw new Error(`GitHub ${res.status}: ${body.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface ApiRepo { name: string; full_name: string; default_branch: string; pushed_at: string; owner: { login: string } }
const toRepo = (r: ApiRepo): GithubRepo => ({ name: r.name, fullName: r.full_name, defaultBranch: r.default_branch, pushedAt: r.pushed_at });

/** `owner` lists the account's repositories (private ones too when the stored login is that account); `owner/repo` is one. */
export async function listGithubRepos(target: string): Promise<GithubRepo[]> {
  const auth = await token();
  const [owner, repo] = target.split("/");
  if (repo) return [toRepo(await gh<ApiRepo>(`/repos/${owner}/${repo}`, auth))];

  let me: string | null = null;
  if (auth) me = await gh<{ login: string }>("/user", auth).then((u) => u.login, () => null);
  const repos: GithubRepo[] = [];
  for (let page = 1; repos.length < MAX_REPOS && page <= Math.ceil(MAX_REPOS / 100); page++) {
    const path = me && me.toLowerCase() === owner.toLowerCase()
      ? `/user/repos?affiliation=owner&sort=pushed&per_page=100&page=${page}`
      : `/users/${owner}/repos?type=owner&sort=pushed&per_page=100&page=${page}`;
    const batch = await gh<ApiRepo[]>(path, auth);
    repos.push(...batch.map(toRepo));
    if (batch.length < 100) break;
  }
  if (!repos.length) {
    throw new Error(me
      ? `No repository visible for ${owner}. Git on this computer is signed in to GitHub as ${me}; sign in as ${owner} to see its private repositories`
      : `No public repository for ${owner}. Private repositories need a GitHub sign-in with Git on this computer`);
  }
  return repos.slice(0, MAX_REPOS);
}

const trees = new Map<string, { pushedAt: string; lines: string[] }>();

/** Lines "d name/…" / "f name/…" for one repository, the shape `projectsFromLines` reads. Cached until the next push. */
export async function githubRepoLines(repo: GithubRepo): Promise<string[]> {
  const cached = trees.get(repo.fullName);
  if (cached && cached.pushedAt === repo.pushedAt) return cached.lines;
  const auth = await token();
  const tree = await gh<{ tree: { path: string; type: string }[] }>(
    `/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`, auth,
  ).catch((error: Error) => {
    if (/Git Repository is empty/i.test(error.message)) return { tree: [] };
    throw error;
  });
  const lines = [`d ${repo.name}`, ...tree.tree
    .filter((e) => e.type === "tree" || e.type === "blob")
    .map((e) => `${e.type === "tree" ? "d" : "f"} ${repo.name}/${e.path}`)];
  trees.set(repo.fullName, { pushedAt: repo.pushedAt, lines });
  return lines;
}

export async function scanGithubLines(target: string): Promise<string[]> {
  const repos = await listGithubRepos(target);
  const lines: string[] = [];
  const queue = [...repos];
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      lines.push(...await githubRepoLines(repo).catch(() => [`d ${repo!.name}`]));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return lines;
}
