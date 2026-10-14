// Dependency-free source hygiene gate. Keep deterministic and fast.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);
const errors = [];

async function inspect(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      await inspect(file);
    } else if (entry.isFile() && extensions.has(extname(file))) {
      const text = await readFile(file, 'utf8');
      if (!text.endsWith('\n')) errors.push(`${file}: missing final newline`);
      if (text.includes('\r')) errors.push(`${file}: CRLF line endings`);
      text.split('\n').forEach((line, i) => {
        if (/[\t ]+$/.test(line)) errors.push(`${file}:${i + 1}: trailing whitespace`);
        if (line.includes('\t')) errors.push(`${file}:${i + 1}: tab indentation`);
      });
    }
  }
}

await Promise.all(roots.map(inspect));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Source hygiene checks passed.');
}
