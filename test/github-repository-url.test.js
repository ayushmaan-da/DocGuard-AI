import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseGitHubPullRequestUrl,
  parseGitHubRepositoryUrl,
  validateGitHubRef,
} from '../src/utils/github-repository-url.js';
import { HttpError } from '../src/utils/http-error.js';

test('parses a plain GitHub repository URL and optional .git suffix', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/owner-name/project.js/'), {
    owner: 'owner-name',
    repository: 'project.js',
    repositoryUrl: 'https://github.com/owner-name/project.js',
  });
  assert.equal(parseGitHubRepositoryUrl('https://github.com/owner/project.git').repository, 'project');
});

test('parses canonical public GitHub Pull Request URLs', () => {
  assert.deepEqual(parseGitHubPullRequestUrl('https://github.com/owner-name/project.js/pull/42'), {
    owner: 'owner-name',
    repository: 'project.js',
    repositoryUrl: 'https://github.com/owner-name/project.js',
    number: 42,
    pullRequestUrl: 'https://github.com/owner-name/project.js/pull/42',
  });
  assert.equal(
    parseGitHubPullRequestUrl('https://github.com/owner/repository/pull/9/').number,
    9,
  );
});

test('rejects URLs that are not plain public GitHub repository URLs', () => {
  const invalidUrls = [
    '',
    'not a URL',
    'http://github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://evil.example/owner/repo',
    'https://user@github.com/owner/repo',
    'https://github.com:444/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?tab=readme',
    'https://github.com/owner/repo?',
    'https://github.com/owner/repo#',
    ' https://github.com/owner/repo',
    'https://github.com/owner/%2e%2e',
    'https://github.com//repo',
  ];

  for (const repositoryUrl of invalidUrls) {
    assert.throws(
      () => parseGitHubRepositoryUrl(repositoryUrl),
      (error) => error instanceof HttpError && error.code === 'INVALID_REPOSITORY_URL',
      repositoryUrl,
    );
  }
});

test('rejects malformed or unsafe GitHub Pull Request URLs', () => {
  for (const pullRequestUrl of [
    'https://github.com/owner/repo.git/pull/1',
    'https://github.com/owner/repo/pulls/1',
    'https://github.com/owner/repo/pull/1/files',
    'https://github.com/owner/repo/pull/0',
    'https://github.com/owner/repo/pull/not-a-number',
    'https://github.com/owner/repo/pull/1?tab=files',
    'https://github.com/owner/repo/pull/1#diff',
  ]) {
    assert.throws(
      () => parseGitHubPullRequestUrl(pullRequestUrl),
      (error) => error instanceof HttpError && error.code === 'INVALID_PULL_REQUEST_URL',
      pullRequestUrl,
    );
  }
});

test('accepts safe Git refs and rejects unsafe refs', () => {
  assert.equal(validateGitHubRef('feature/add-docs'), 'feature/add-docs');

  for (const ref of ['', '../main', 'main?', 'refs//main', 'main.lock', '/main']) {
    assert.throws(
      () => validateGitHubRef(ref),
      (error) => error instanceof HttpError && error.code === 'INVALID_REPOSITORY_REF',
      ref,
    );
  }
});
