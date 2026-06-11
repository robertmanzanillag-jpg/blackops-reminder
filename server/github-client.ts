// GitHub integration using Replit Connectors
import { Octokit } from '@octokit/rest';

let connectionSettings: any;

async function getAccessToken() {
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
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: 100
  });
  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    html_url: repo.html_url,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
    language: repo.language
  }));
}

// Get repository contents (files/folders)
export async function getRepoContents(owner: string, repo: string, path: string = '') {
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
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
