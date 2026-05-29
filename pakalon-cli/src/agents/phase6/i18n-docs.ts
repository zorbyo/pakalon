import * as path from 'path';
import * as fs from 'fs/promises';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

export async function generateTranslatedDocs(projectDir: string, languages: string[], sourceFiles: string[]): Promise<string[]> {
  const translated: string[] = [];
  const docsRoot = path.join(projectDir, 'docs');

  for (const language of languages) {
    const languageDir = path.join(docsRoot, language);
    await fs.mkdir(languageDir, { recursive: true });

    for (const sourceFile of sourceFiles) {
      const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.join(projectDir, sourceFile);
      const content = await fs.readFile(sourcePath, 'utf-8');
      const result = await generateText({
        model: openrouter('anthropic/claude-3-5-haiku'),
        prompt: `Translate the following documentation into ${language}. Preserve markdown structure and code blocks:\n\n${content}`,
        maxTokens: 4096,
      });
      const targetPath = path.join(languageDir, path.basename(sourceFile));
      await fs.writeFile(targetPath, result.text, 'utf-8');
      translated.push(targetPath);
    }
  }

  return translated;
}
