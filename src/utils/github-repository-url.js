import { HttpError } from './http-error.js';

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const INVALID_REF_CHARACTERS = /[\u0000-\u0020\u007f~^:?*[\]\\]/;

export function parseGitHubRepositoryUrl(repositoryUrl) {
  if (
    typeof repositoryUrl !== 'string'
    || repositoryUrl.length === 0
    || repositoryUrl !== repositoryUrl.trim()
    || repositoryUrl.includes('?')
    || repositoryUrl.includes('#')
  ) {
    throw new HttpError(400, 'INVALID_REPOSITORY_URL', 'repositoryUrl must be a GitHub repository URL.');
  }

  let url;
  try {
    url = new URL(repositoryUrl);
  } catch {
    throw new HttpError(400, 'INVALID_REPOSITORY_URL', 'repositoryUrl must be a valid HTTPS URL.');
  }

  if (
    url.protocol !== 'https:'
    || url.hostname !== 'github.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new HttpError(400, 'INVALID_REPOSITORY_URL', 'Only plain HTTPS URLs on github.com are supported.');
  }

  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const segments = path.slice(1).split('/');
  if (
    segments.length !== 2
    || segments.some((segment) => segment.includes('%'))
    || !OWNER_PATTERN.test(segments[0])
  ) {
    throw new HttpError(400, 'INVALID_REPOSITORY_URL', 'URL must point directly to a GitHub owner and repository.');
  }

  const repository = segments[1].replace(/\.git$/i, '');
  if (!REPOSITORY_PATTERN.test(repository) || repository === '.' || repository === '..') {
    throw new HttpError(400, 'INVALID_REPOSITORY_URL', 'URL contains an invalid GitHub repository name.');
  }

  return {
    owner: segments[0],
    repository,
    repositoryUrl: `https://github.com/${segments[0]}/${repository}`,
  };
}

export function parseGitHubPullRequestUrl(pullRequestUrl) {
  if (
    typeof pullRequestUrl !== 'string'
    || pullRequestUrl.length === 0
    || pullRequestUrl !== pullRequestUrl.trim()
    || pullRequestUrl.includes('?')
    || pullRequestUrl.includes('#')
    || pullRequestUrl.includes('\\')
  ) {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'pullRequestUrl must be a GitHub Pull Request URL.');
  }

  let url;
  try {
    url = new URL(pullRequestUrl);
  } catch {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'pullRequestUrl must be a valid HTTPS URL.');
  }

  if (
    url.protocol !== 'https:'
    || url.hostname !== 'github.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'Only plain HTTPS Pull Request URLs on github.com are supported.');
  }

  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const segments = path.slice(1).split('/');
  if (
    segments.length !== 4
    || segments.some((segment) => segment.includes('%'))
    || segments[2] !== 'pull'
    || !/^[1-9]\d*$/.test(segments[3])
  ) {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'URL must point directly to a GitHub Pull Request.');
  }

  let repository;
  try {
    repository = parseGitHubRepositoryUrl(`https://github.com/${segments[0]}/${segments[1]}`);
  } catch {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'URL contains an invalid GitHub owner or repository.');
  }
  if (repository.repository !== segments[1]) {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'URL must contain a canonical GitHub repository name.');
  }
  const number = Number(segments[3]);
  if (!Number.isSafeInteger(number)) {
    throw new HttpError(400, 'INVALID_PULL_REQUEST_URL', 'Pull Request number is outside the supported range.');
  }

  return {
    ...repository,
    number,
    pullRequestUrl: `https://github.com/${repository.owner}/${repository.repository}/pull/${number}`,
  };
}

export function validateGitHubRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 255) {
    throw new HttpError(400, 'INVALID_REPOSITORY_REF', 'ref must be a non-empty Git reference of at most 255 characters.');
  }

  const segments = ref.split('/');
  const unsafe = ref.startsWith('/')
    || ref.endsWith('/')
    || ref.endsWith('.')
    || ref.includes('..')
    || ref.includes('@{')
    || INVALID_REF_CHARACTERS.test(ref)
    || segments.some((segment) => segment.length === 0 || segment.startsWith('.') || segment.endsWith('.lock'));

  if (unsafe) {
    throw new HttpError(400, 'INVALID_REPOSITORY_REF', 'ref contains characters or segments that are not valid in a Git reference.');
  }

  return ref;
}
