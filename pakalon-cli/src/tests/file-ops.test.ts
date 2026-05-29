/**
 * Test Suite for File Operations Tools
 * Enterprise-grade testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileTools } from '../tools/file-ops.js';

const TEST_DIR = path.join(process.cwd(), '.test-tmp');

describe('File Operations Tools', () => {
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('create_file', () => {
    it('should create a new file with content', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      const content = 'Hello, World!';

      const result = await fileTools.create_file.execute({
        path: filePath,
        content,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe(filePath);

      const fileContent = await fs.readFile(filePath, 'utf-8');
      expect(fileContent).toBe(content);
    });

    it('should fail if file already exists', async () => {
      const filePath = path.join(TEST_DIR, 'existing.txt');
      await fs.writeFile(filePath, 'Existing content');

      const result = await fileTools.create_file.execute({
        path: filePath,
        content: 'New content',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('already exists');
    });

    it('should fail if path is not absolute', async () => {
      const result = await fileTools.create_file.execute({
        path: 'relative/path.txt',
        content: 'Content',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('absolute path');
    });
  });

  describe('read_file', () => {
    it('should read file content', async () => {
      const filePath = path.join(TEST_DIR, 'read-test.txt');
      const content = 'Test content\nLine 2\nLine 3';
      await fs.writeFile(filePath, content);

      const result = await fileTools.read_file.execute({ path: filePath });

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.lines).toBe(3);
    });

    it('should fail if file does not exist', async () => {
      const filePath = path.join(TEST_DIR, 'nonexistent.txt');

      const result = await fileTools.read_file.execute({ path: filePath });

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not exist');
    });
  });

  describe('edit_file', () => {
    it('should replace old text with new text', async () => {
      const filePath = path.join(TEST_DIR, 'edit-test.txt');
      const originalContent = 'Hello World\nFoo Bar\nBaz Qux';
      await fs.writeFile(filePath, originalContent);

      const result = await fileTools.edit_file.execute({
        path: filePath,
        oldText: 'Foo Bar',
        newText: 'Replaced Text',
      });

      expect(result.success).toBe(true);

      const newContent = await fs.readFile(filePath, 'utf-8');
      expect(newContent).toBe('Hello World\nReplaced Text\nBaz Qux');
    });

    it('should fail if old text not found', async () => {
      const filePath = path.join(TEST_DIR, 'edit-test2.txt');
      await fs.writeFile(filePath, 'Original content');

      const result = await fileTools.edit_file.execute({
        path: filePath,
        oldText: 'Nonexistent text',
        newText: 'New text',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('delete_file', () => {
    it('should delete a file', async () => {
      const filePath = path.join(TEST_DIR, 'delete-test.txt');
      await fs.writeFile(filePath, 'To be deleted');

      const result = await fileTools.delete_file.execute({ path: filePath });

      expect(result.success).toBe(true);

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should fail if file does not exist', async () => {
      const filePath = path.join(TEST_DIR, 'nonexistent.txt');

      const result = await fileTools.delete_file.execute({ path: filePath });

      expect(result.success).toBe(false);
    });
  });

  describe('create_directory', () => {
    it('should create a new directory', async () => {
      const dirPath = path.join(TEST_DIR, 'new-dir');

      const result = await fileTools.create_directory.execute({ path: dirPath });

      expect(result.success).toBe(true);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(TEST_DIR, 'nested', 'deep', 'dir');

      const result = await fileTools.create_directory.execute({ path: dirPath });

      expect(result.success).toBe(true);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('list_directory', () => {
    it('should list directory contents', async () => {
      const dirPath = path.join(TEST_DIR, 'list-test');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'file1.txt'), 'Content 1');
      await fs.writeFile(path.join(dirPath, 'file2.md'), 'Content 2');
      await fs.mkdir(path.join(dirPath, 'subdir'));

      const result = await fileTools.list_directory.execute({ path: dirPath });

      expect(result.success).toBe(true);
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBe(3);
      expect(result.fileCount).toBe(2);
      expect(result.dirCount).toBe(1);
    });

    it('should fail if directory does not exist', async () => {
      const dirPath = path.join(TEST_DIR, 'nonexistent-dir');

      const result = await fileTools.list_directory.execute({ path: dirPath });

      expect(result.success).toBe(false);
    });
  });
});
