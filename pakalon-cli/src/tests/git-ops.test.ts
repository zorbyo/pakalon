/**
 * Test Suite for Git Operations Tools
 * Enterprise-grade testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import { gitTools } from '../tools/git-ops.js';

const TEST_DIR = path.join(process.cwd(), '.test-tmp-git');

describe('Git Operations Tools', () => {
  beforeEach(async () => {
    // Create test directory and initialize git
    await fs.mkdir(TEST_DIR, { recursive: true });
    const git = simpleGit(TEST_DIR);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('git_status', () => {
    it('should return clean status for empty repo', async () => {
      const result = await gitTools.git_status.execute({ cwd: TEST_DIR });

      expect(result.success).toBe(true);
      expect(result.message).toContain('clean');
    });

    it('should detect unstaged changes', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Test content');

      const result = await gitTools.git_status.execute({ cwd: TEST_DIR });

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThan(0);
    });
  });

  describe('git_add', () => {
    it('should stage files', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Test content');

      const result = await gitTools.git_add.execute({
        cwd: TEST_DIR,
        files: ['test.txt'],
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('1 file(s) staged');
    });

    it('should stage all files with "."', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'file1.txt'), 'Content 1');
      await fs.writeFile(path.join(TEST_DIR, 'file2.txt'), 'Content 2');

      const result = await gitTools.git_add.execute({
        cwd: TEST_DIR,
        files: ['.'],
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('staged');
    });
  });

  describe('git_commit', () => {
    it('should commit staged changes', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Test content');

      const git = simpleGit(TEST_DIR);
      await git.add('.');

      const result = await gitTools.git_commit.execute({
        cwd: TEST_DIR,
        message: 'Test commit',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Test commit');
      expect(result.message).toContain('Pakalon');
    });

    it('should fail if nothing staged', async () => {
      const result = await gitTools.git_commit.execute({
        cwd: TEST_DIR,
        message: 'Empty commit',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('git_diff', () => {
    it('should show diff for unstaged changes', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Initial content');

      const git = simpleGit(TEST_DIR);
      await git.add('.');
      await git.commit('Initial commit');

      await fs.writeFile(testFile, 'Modified content');

      const result = await gitTools.git_diff.execute({ cwd: TEST_DIR });

      expect(result.success).toBe(true);
      expect(result.diff).toContain('Modified content');
    });
  });

  describe('git_log', () => {
    it('should show commit history', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Test content');

      const git = simpleGit(TEST_DIR);
      await git.add('.');
      await git.commit('First commit');

      const result = await gitTools.git_log.execute({
        cwd: TEST_DIR,
        maxCount: 10,
      });

      expect(result.success).toBe(true);
      expect(result.commits).toBeDefined();
      expect(result.commits!.length).toBe(1);
      expect(result.commits![0].message).toBe('First commit\n');
    });
  });
});
