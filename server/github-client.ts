// GitHub integration using Replit Connectors
import { Octokit } from '@octokit/rest';
import { hasRealValue } from "./ceo-doctor-cli";

let connectionSettings: any;

const MAX_GITHUB_FILE_WRITE_BYTES = 1024 * 1024;
const MAX_GITHUB_ISSUE_BODY_BYTES = 64 * 1024;
const BLOCKED_GITHUB_PATH_SEGMENTS = new Set([
  '.git',
  '.ssh',
  'credentials',
  'secrets',
  'node_modules',
]);
const BLOCKED_GITHUB_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  'id_rsa',
  'id_ed25519',
]);

export function getConfiguredGitHubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return [env.GITHUB_TOKEN, env.GH_TOKEN]
    .filter(hasRealValue)
    .map((token) => token.trim())
    .find((token) => /^(ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+$/.test(token)) || null;
}

function githubInputError(message: string): Error & { status?: number; statusCode?: number } {
  const error = new Error(message) as Error & { status?: number; statusCode?: number };
  error.status = 400;
  error.statusCode = 400;
  return error;
}

export function validateGitHubRepoNamePart(value: string, label: string): string | null {
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === '.' || value === '..') {
    return `${label} invalido`;
  }
  return null;
}

export function validateGitHubFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return 'Path requerido';
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return 'Path absoluto no permitido';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return 'Path traversal no permitido';
  if (segments.some((segment) => BLOCKED_GITHUB_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return 'Path bloqueado por politica de seguridad';
  }
  const fileName = segments[segments.length - 1]?.toLowerCase();
  if (BLOCKED_GITHUB_FILE_NAMES.has(fileName)) return 'Archivo sensible no permitido';
  return null;
}

export function validateGitHubCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < 8) return 'Commit message demasiado corto';
  if (trimmed.length > 200) return 'Commit message demasiado largo';
  if (/[\r\n]/.test(trimmed)) return 'Commit message multilinea no permitido';
  return null;
}

export function validateGitHubIssueTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length < 8) return 'Issue title demasiado corto';
  if (trimmed.length > 200) return 'Issue title demasiado largo';
  if (/[\r\n]/.test(trimmed)) return 'Issue title multilinea no permitido';
  return null;
}

export function validateGitHubIssueBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < 20) return 'Issue body demasiado corto';
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_GITHUB_ISSUE_BODY_BYTES) return 'Issue body demasiado grande';
  return null;
}

export function validateGitHubIssueNumber(value: number, label = 'Issue/PR number'): string | null {
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) return `${label} invalido`;
  return null;
}

export function validateGitHubFileWriteInput(input: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
}): string | null {
  return validateGitHubRepoNamePart(input.owner, 'Owner')
    || validateGitHubRepoNamePart(input.repo, 'Repo')
    || validateGitHubFilePath(input.path)
    || validateGitHubCommitMessage(input.message)
    || (Buffer.byteLength(input.content, 'utf8') > MAX_GITHUB_FILE_WRITE_BYTES ? 'Archivo demasiado grande para escritura remota desde el asistente' : null);
}

async function getAccessToken() {
  const configuredToken = getConfiguredGitHubToken();
  if (configuredToken) {
    return configuredToken;
  }

  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('GitHub no conectado - token no disponible');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub no conectado');
  }
  return accessToken;
}

// Get fresh GitHub client (never cache - tokens expire)
export async function getGitHubClient(): Promise<Octokit> {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// List user's repositories
export async function listRepositories() {
  const octokit = await getGitHubClient();
  const data = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    sort: 'updated',
    per_page: 100,
  });
  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    archived: repo.archived,
    disabled: repo.disabled,
    fork: repo.fork,
    html_url: repo.html_url,
    homepage: repo.homepage,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    open_issues_count: repo.open_issues_count,
    language: repo.language
  }));
}

export async function getRepositoryOverview(owner: string, repo: string) {
  const octokit = await getGitHubClient();
  const [{ data }, issues, prs] = await Promise.all([
    octokit.repos.get({ owner, repo }),
    octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue is:open`,
      per_page: 1,
    }).catch(() => ({ data: { total_count: null } })),
    octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open`,
      per_page: 1,
    }).catch(() => ({ data: { total_count: null } })),
  ]);

  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    description: data.description,
    private: data.private,
    archived: data.archived,
    disabled: data.disabled,
    html_url: data.html_url,
    homepage: data.homepage,
    default_branch: data.default_branch,
    language: data.language,
    pushed_at: data.pushed_at,
    updated_at: data.updated_at,
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    open_issues_count: data.open_issues_count,
    open_issues: issues.data.total_count,
    open_prs: prs.data.total_count,
  };
}

// Get repository contents (files/folders)
export async function getRepoContents(owner: string, repo: string, path: string = '') {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = path ? validateGitHubFilePath(path) : null;
  if (ownerError || repoError || pathError) throw githubInputError(ownerError || repoError || pathError || 'GitHub input invalido');

  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path
    });
    
    if (Array.isArray(data)) {
      return data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha
      }));
    } else {
      // Single file
      return {
        name: data.name,
        path: data.path,
        type: data.type,
        size: data.size,
        sha: data.sha,
        content: 'content' in data ? Buffer.from(data.content, 'base64').toString('utf-8') : null
      };
    }
  } catch (error: any) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

// Get file content
export async function getFileContent(owner: string, repo: string, path: string) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = validateGitHubFilePath(path);
  if (ownerError || repoError || pathError) throw githubInputError(ownerError || repoError || pathError || 'GitHub input invalido');

  const octokit = await getGitHubClient();
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path
  });
  
  if (Array.isArray(data)) {
    throw new Error('La ruta es un directorio, no un archivo');
  }
  
  if (!('content' in data)) {
    throw new Error('No se pudo obtener el contenido del archivo');
  }
  
  return {
    name: data.name,
    path: data.path,
    sha: data.sha,
    content: Buffer.from(data.content, 'base64').toString('utf-8')
  };
}

// Create or update file in repository
export async function updateFile(
  owner: string, 
  repo: string, 
  path: string, 
  content: string, 
  message: string,
  sha?: string
) {
  const validationError = validateGitHubFileWriteInput({ owner, repo, path, content, message });
  if (validationError) throw githubInputError(validationError);

  const octokit = await getGitHubClient();
  
  // If no SHA provided, try to get it (for updates)
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFileContent(owner, repo, path);
      fileSha = existing.sha;
    } catch (e) {
      // File doesn't exist, will create new
    }
  }
  
  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString('base64'),
    sha: fileSha
  });
  
  return {
    success: true,
    commit: data.commit.sha,
    file: {
      path: data.content?.path,
      sha: data.content?.sha
    }
  };
}

// Delete file from repository
export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = validateGitHubFilePath(path);
  const messageError = validateGitHubCommitMessage(message);
  if (ownerError || repoError || pathError || messageError) {
    throw githubInputError(ownerError || repoError || pathError || messageError || 'GitHub input invalido');
  }

  const octokit = await getGitHubClient();
  
  const { data } = await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha
  });
  
  return {
    success: true,
    commit: data.commit.sha
  };
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const titleError = validateGitHubIssueTitle(title);
  const bodyError = validateGitHubIssueBody(body);
  if (ownerError || repoError || titleError || bodyError) {
    throw githubInputError(ownerError || repoError || titleError || bodyError || 'GitHub issue input invalido');
  }

  const octokit = await getGitHubClient();
  const { data } = await octokit.issues.create({
    owner,
    repo,
    title: title.trim(),
    body: body.trim(),
  });

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    html_url: data.html_url,
    state: data.state,
  };
}

export async function createIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const numberError = validateGitHubIssueNumber(issueNumber);
  const bodyError = validateGitHubIssueBody(body);
  if (ownerError || repoError || numberError || bodyError) {
    throw githubInputError(ownerError || repoError || numberError || bodyError || 'GitHub comment input invalido');
  }

  const octokit = await getGitHubClient();
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: body.trim(),
  });

  return {
    id: data.id,
    html_url: data.html_url,
    body: data.body,
  };
}

// Get authenticated user info
export async function getAuthenticatedUser() {
  const octokit = await getGitHubClient();
  const { data } = await octokit.users.getAuthenticated();
  return {
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
    html_url: data.html_url
  };
}

// Check if GitHub is connected
export async function isGitHubConnected(): Promise<boolean> {
  try {
    const client = await getGitHubClient();
    await client.users.getAuthenticated();
    return true;
  } catch {
    return false;
  }
}
