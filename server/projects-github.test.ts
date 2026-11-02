import { afterEach, describe, expect, it } from "vitest";

import { githubLogin, githubRepo, githubRepoLines, githubSignIn, githubTarball, listGithubRepos, scanGithubLines, setGithubTransport } from "./projects-github.ts";

type Reply = { status?: number; body: unknown };
type Call = { path: string; auth: string | null };

function fakeGithub(answer: (path: string, auth: string | null, nth: number) => Reply, credential: string | null = null) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const header = (init?.headers as Record<string, string> | undefined)?.authorization;
    const auth = header ? header.replace(/^Bearer /, "") : null;
    calls.push({ path, auth });
    const { status = 200, body } = answer(path, auth, calls.filter((c) => c.path === path).length);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  setGithubTransport({ fetch, credential: async () => credential });
  return calls;
}

const apiRepo = (owner: string, name: string, pushedAt = "2026-01-01T00:00:00Z") =>
  ({ name, full_name: `${owner}/${name}`, default_branch: "main", pushed_at: pushedAt, owner: { login: owner } });

const notFound: Reply = { status: 404, body: { message: "Not Found" } };

afterEach(() => setGithubTransport(null));

describe("projects GitHub source", () => {
  it("owner/repo gives one project built from the recursive tree", async () => {
    const calls = fakeGithub((path) => {
      if (path === "/repos/o/r") return { body: apiRepo("o", "r") };
      if (path === "/repos/o/r/git/trees/main?recursive=1") {
        return { body: { tree: [{ path: "src", type: "tree" }, { path: "src/a.ts", type: "blob" }, { path: "sub", type: "commit" }] } };
      }
      return notFound;
    });
    expect(await scanGithubLines("o/r")).toEqual(["d r", "d r/src", "f r/src/a.ts"]);
    expect(calls.every((c) => c.auth === null)).toBe(true);
  });

  it("an account the login owns lists /user/repos (private included)", async () => {
    const calls = fakeGithub((path) => {
      if (path === "/user") return { body: { login: "o" } };
      if (path.startsWith("/user/repos?affiliation=owner")) return { body: [apiRepo("o", "public"), apiRepo("o", "secret")] };
      return notFound;
    }, "tok");
    const repos = await listGithubRepos("O");
    expect(repos.map((r) => r.fullName)).toEqual(["o/public", "o/secret"]);
    expect(repos[0]).toEqual({ name: "public", fullName: "o/public", defaultBranch: "main", pushedAt: "2026-01-01T00:00:00Z" });
    const listing = calls.find((c) => c.path.startsWith("/user/repos"));
    expect(listing?.path).toContain("/user/repos?affiliation=owner");
    expect(listing?.auth).toBe("tok");
  });

  it("another account lists /users/<owner>/repos", async () => {
    const calls = fakeGithub((path) => {
      if (path === "/user") return { body: { login: "me" } };
      if (path.startsWith("/users/other/repos?type=owner")) return { body: [apiRepo("other", "lib")] };
      return notFound;
    }, "tok");
    expect((await listGithubRepos("other")).map((r) => r.fullName)).toEqual(["other/lib"]);
    expect(calls.some((c) => c.path.startsWith("/user/repos"))).toBe(false);
  });

  it("an account with no visible repository says which login is used", async () => {
    fakeGithub((path) => {
      if (path === "/user") return { body: { login: "Monkey4lt" } };
      if (path.startsWith("/users/lonelyRaph/repos")) return { body: [] };
      return notFound;
    }, "tok");
    await expect(listGithubRepos("lonelyRaph")).rejects.toThrow("signed in to GitHub as Monkey4lt");
  });

  it("an account with no public repository and no login asks for a sign-in", async () => {
    fakeGithub((path) => (path.startsWith("/users/nobody/repos") ? { body: [] } : notFound));
    await expect(listGithubRepos("nobody")).rejects.toThrow("Private repositories need a GitHub sign-in");
  });

  it("a rejected token falls back to anonymous once", async () => {
    const calls = fakeGithub((path, auth) => {
      if (path === "/user") return { body: { login: "me" } };
      if (path === "/repos/o/r") return auth ? { status: 401, body: { message: "Bad credentials" } } : { body: apiRepo("o", "r") };
      return notFound;
    }, "tok");
    expect((await listGithubRepos("o/r")).map((r) => r.fullName)).toEqual(["o/r"]);
    expect(calls.filter((c) => c.path === "/repos/o/r")).toEqual([{ path: "/repos/o/r", auth: "tok" }, { path: "/repos/o/r", auth: null }]);
  });

  it("a 401 without a token is not retried", async () => {
    const calls = fakeGithub(() => ({ status: 401, body: { message: "Requires authentication" } }));
    await expect(listGithubRepos("o/r")).rejects.toThrow("GitHub 401: Requires authentication");
    expect(calls).toHaveLength(1);
  });

  it("an empty repository gives an empty project, not an error", async () => {
    fakeGithub((path) => (path.includes("/git/trees/")
      ? { status: 409, body: { message: "Git Repository is empty." } }
      : notFound));
    const repo = { name: "empty", fullName: "o/empty", defaultBranch: "main", pushedAt: "2026-01-01T00:00:00Z" };
    expect(await githubRepoLines(repo)).toEqual(["d empty"]);
  });

  it("a tree is fetched again only after a new push", async () => {
    const calls = fakeGithub((path) => (path.includes("/git/trees/") ? { body: { tree: [{ path: "a.ts", type: "blob" }] } } : notFound));
    const repo = { name: "r", fullName: "o/r", defaultBranch: "main", pushedAt: "2026-01-01T00:00:00Z" };
    const trees = () => calls.filter((c) => c.path.includes("/git/trees/")).length;
    expect(await githubRepoLines(repo)).toEqual(["d r", "f r/a.ts"]);
    await githubRepoLines(repo);
    expect(trees()).toBe(1);
    await githubRepoLines({ ...repo, pushedAt: "2026-02-01T00:00:00Z" });
    expect(trees()).toBe(2);
  });

  it("an injected transport can supply the gh CLI token and the forget step", async () => {
    const forgot: boolean[] = [];
    const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ login: auth === "Bearer cli" ? "fromCli" : "fromGit" }), { status: auth ? 200 : 401 });
    }) as typeof globalThis.fetch;
    setGithubTransport({ fetch, credential: async () => null, cliToken: async () => "cli", forgetCredential: async () => { forgot.push(true); } });
    expect(await githubLogin()).toBe("fromCli");
    expect(await githubSignIn(true)).toBeNull();
    expect(forgot).toEqual([true]);
  });

  it("without those, an injected transport never reaches the real CLIs", async () => {
    setGithubTransport({ fetch: (async () => new Response("{}", { status: 500 })) as typeof globalThis.fetch, credential: async () => null });
    expect(await githubLogin()).toBeNull();
    expect(await githubSignIn(true)).toBeNull();
  });

  it("encodes every path segment it sends to the API", async () => {
    const calls = fakeGithub((path) => (path.startsWith("/repos/") && !path.includes("/git/") && !path.includes("/tarball/")
      ? { body: apiRepo("o", "r") }
      : { body: { tree: [] } }));
    await githubRepo("o/a b");
    await githubRepoLines({ name: "r", fullName: "o/x?y", defaultBranch: "feat/x", pushedAt: "1" });
    await githubTarball("o/x#y", "feat/x").catch(() => null);
    await listGithubRepos("o/a%b");
    expect(calls.map((c) => c.path)).toEqual([
      "/repos/o/a%20b",
      "/repos/o/x%3Fy/git/trees/feat%2Fx?recursive=1",
      "/repos/o/x%23y/tarball/feat%2Fx",
      "/repos/o/a%25b",
    ]);
  });
});
