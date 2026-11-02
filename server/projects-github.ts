import { execFile } from "node:child_process";

const API = "https://api.github.com";
const MAX_REPOS = 100;

export interface GithubRepo { name: string; fullName: string; defaultBranch: string; pushedAt: string }

function run(cmd: string, args: string[], input: string, options: { timeout: number; env?: NodeJS.ProcessEnv; hide?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: options.timeout, env: options.env, windowsHide: options.hide ?? true }, (error, stdout) => resolve(error ? null : stdout));
    child.stdin?.end(input);
  });
}

const GITHUB_HOST = "protocol=https\nhost=github.com\n\n";

/**
 * The github.com login Git keeps (Git Credential Manager, osxkeychain, a store file).
 * Quiet reads set GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never so a scan never opens a window;
 * a sign-in leaves both alone so Git Credential Manager shows its own window, and does not pass
 * windowsHide, which on Windows would hide that window too.
 */
async function gitCredential(interactive: boolean): Promise<string | null> {
  const env = interactive ? process.env : { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  const out = await run("git", ["credential", "fill"], GITHUB_HOST, { timeout: interactive ? 180_000 : 15_000, env, hide: !interactive });
  const line = out?.split("\n").find((l) => l.startsWith("password="));
  return line?.slice("password=".length).trim() || null;
}

async function forgetGitCredential(): Promise<void> {
  await run("git", ["credential", "reject"], GITHUB_HOST, { timeout: 15_000 });
}

async function ghCliToken(): Promise<string | null> {
  return (await run("gh", ["auth", "token"], "", { timeout: 10_000 }))?.trim() || null;
}

let session: { token: string; login: string } | null = null;

async function loginFor(candidate: string | null): Promise<{ token: string; login: string } | null> {
  if (!candidate) return null;
  const user = await gh<{ login: string }>("/user", candidate, false).catch(() => null);
  return user ? { token: candidate, login: user.login } : null;
}

/** The stored login, read without opening any window; null when this computer is not signed in. */
async function token(): Promise<string | null> {
  session ??= (await loginFor(await gitCredential(false))) ?? (await loginFor(await ghCliToken()));
  return session?.token ?? null;
}

export async function githubLogin(): Promise<string | null> {
  await token();
  return session?.login ?? null;
}

/** Opens Git Credential Manager's sign-in window; `switchAccount` forgets the stored login first. */
export async function githubSignIn(switchAccount: boolean): Promise<string | null> {
  if (switchAccount) await forgetGitCredential();
  session = await loginFor(await gitCredential(true));
  if (!session && !switchAccount) session = await loginFor(await ghCliToken());
  return session?.login ?? null;
}

async function gh<T>(path: string, auth: string | null, retryAnonymous = true): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "openmausbot-projects",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error("GitHub unreachable: check the internet connection"); });
  if (res.status === 401 && auth && retryAnonymous) {
    session = null;
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
