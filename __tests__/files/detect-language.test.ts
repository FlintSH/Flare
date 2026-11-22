import { describe, expect, it } from 'vitest'

import { detectLanguage, suggestPasteName } from '@/lib/files/detect-language'
import { DEFAULT_PASTE_NAME } from '@/lib/files/paste-name'

/** Joins fixture lines, so each reads as the file it stands for. */
const lines = (...rows: string[]) => rows.join('\n')

const FIXTURES = {
  html: lines(
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>Flare status</title>',
    '    <link rel="stylesheet" href="/styles.css" />',
    '  </head>',
    '  <body>',
    '    <main class="page">',
    '      <h1>All systems normal</h1>',
    '      <p>Uploads, previews and links are working.</p>',
    '      <ul>',
    '        <li>Storage: healthy</li>',
    '        <li>Queue: idle</li>',
    '      </ul>',
    '    </main>',
    '  </body>',
    '</html>'
  ),
  htmlFragment: lines(
    '<div class="card">',
    '  <h2>Upload complete</h2>',
    '  <p>Your file is ready to share.</p>',
    '  <a href="/f/abc123" class="button">Open</a>',
    '</div>'
  ),
  xml: lines(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>dev.example</groupId>',
    '  <artifactId>uploader</artifactId>',
    '  <version>1.2.0</version>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>org.junit.jupiter</groupId>',
    '      <artifactId>junit-jupiter</artifactId>',
    '      <scope>test</scope>',
    '    </dependency>',
    '  </dependencies>',
    '</project>'
  ),
  svg: lines(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
    '  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" />',
    '  <path d="M8 12l3 3 5-6" stroke="currentColor" />',
    '</svg>'
  ),
  css: lines(
    ':root {',
    '  --accent: #f97316;',
    '}',
    '',
    'body {',
    '  margin: 0;',
    '  font-family: system-ui, sans-serif;',
    '  background-color: #0b0b0c;',
    '  color: #f4f4f5;',
    '}',
    '',
    '.button:hover {',
    '  background: var(--accent);',
    '  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);',
    '  transition: background 120ms ease;',
    '}',
    '',
    '@media (max-width: 640px) {',
    '  .button {',
    '    width: 100%;',
    '  }',
    '}'
  ),
  scss: lines(
    '@use "sass:math";',
    '',
    '$accent: #f97316;',
    '$radius: 0.5rem;',
    '',
    '@mixin focus-ring($color) {',
    '  outline: 2px solid $color;',
    '  outline-offset: 2px;',
    '}',
    '',
    '.card {',
    '  border-radius: $radius;',
    '  padding: math.div($radius, 2);',
    '',
    '  &:focus-visible {',
    '    @include focus-ring($accent);',
    '  }',
    '',
    '  .title {',
    '    font-weight: 600;',
    '  }',
    '}'
  ),
  less: lines(
    '@accent: #f97316;',
    '@radius: 6px;',
    '',
    '.rounded(@r: @radius) {',
    '  border-radius: @r;',
    '}',
    '',
    '.card {',
    '  .rounded();',
    '  color: @accent;',
    '  padding: 12px;',
    '',
    '  &:hover {',
    '    color: darken(@accent, 10%);',
    '  }',
    '}'
  ),
  sass: lines(
    '$accent: #f97316',
    '$radius: 6px',
    '',
    '=rounded($r)',
    '  border-radius: $r',
    '',
    '.card',
    '  +rounded($radius)',
    '  color: $accent',
    '  padding: 12px',
    '',
    '  &:hover',
    '    color: darken($accent, 10%)'
  ),
  javascript: lines(
    "const express = require('express')",
    "const { readFile } = require('node:fs/promises')",
    '',
    'const app = express()',
    'const port = process.env.PORT || 3000',
    '',
    "app.get('/health', async (req, res) => {",
    "  const status = await readFile('./status.json', 'utf8')",
    '  res.json(JSON.parse(status))',
    '})',
    '',
    'function shutdown(signal) {',
    '  console.log(`Received ${signal}, closing`)',
    '  process.exit(0)',
    '}',
    '',
    "process.on('SIGTERM', shutdown)",
    'app.listen(port, () => {',
    '  console.log(`Listening on ${port}`)',
    '})'
  ),
  jsx: lines(
    "import { useState } from 'react'",
    '',
    'export function Counter({ label }) {',
    '  const [count, setCount] = useState(0)',
    '',
    '  return (',
    '    <div className="counter">',
    '      <span>{label}</span>',
    '      <button onClick={() => setCount(count + 1)}>',
    '        Clicked {count} times',
    '      </button>',
    '    </div>',
    '  )',
    '}'
  ),
  typescript: lines(
    "import type { Request, Response } from 'express'",
    "import { prisma } from './db'",
    '',
    'export interface Paste {',
    '  id: string',
    '  name: string',
    '  size: number',
    '  expiresAt?: Date',
    '}',
    '',
    "type Visibility = 'public' | 'private'",
    '',
    'export async function listPastes(',
    '  userId: string,',
    '  visibility: Visibility',
    '): Promise<Paste[]> {',
    '  const rows = await prisma.paste.findMany({ where: { userId, visibility } })',
    '  return rows.map((row) => ({ ...row, size: Number(row.size) }))',
    '}',
    '',
    'export function handler(req: Request, res: Response): void {',
    '  res.json({ ok: true } as const)',
    '}'
  ),
  tsx: lines(
    "import { useMemo } from 'react'",
    '',
    "import { Button } from '@/components/ui/button'",
    '',
    'interface FileRowProps {',
    '  name: string',
    '  size: number',
    '  onOpen: (name: string) => void',
    '}',
    '',
    'export function FileRow({ name, size, onOpen }: FileRowProps) {',
    '  const label = useMemo(() => `${(size / 1024).toFixed(1)} KB`, [size])',
    '  return (',
    '    <li className="flex items-center gap-2">',
    '      <span className="truncate">{name}</span>',
    '      <span className="text-muted-foreground">{label}</span>',
    '      <Button variant="ghost" onClick={() => onOpen(name)}>',
    '        Open',
    '      </Button>',
    '    </li>',
    '  )',
    '}'
  ),
  json: lines(
    '{',
    '  "name": "flare",',
    '  "version": "3.1.0",',
    '  "private": true,',
    '  "scripts": {',
    '    "dev": "next dev",',
    '    "build": "next build",',
    '    "test": "vitest run"',
    '  },',
    '  "dependencies": {',
    '    "next": "^16.0.0",',
    '    "react": "^19.0.0"',
    '  }',
    '}'
  ),
  python: lines(
    'import json',
    'import sys',
    'from pathlib import Path',
    '',
    '',
    'class Report:',
    '    def __init__(self, path):',
    '        self.path = Path(path)',
    '        self.rows = []',
    '',
    '    def load(self):',
    '        with self.path.open() as handle:',
    '            for line in handle:',
    '                if not line.strip():',
    '                    continue',
    '                self.rows.append(json.loads(line))',
    '        return self',
    '',
    '',
    'def main(argv):',
    '    report = Report(argv[1]).load()',
    '    print(f"{len(report.rows)} rows")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main(sys.argv)'
  ),
  markdown: lines(
    '# Release notes',
    '',
    'Flare 3.1 brings faster uploads and a cleaner paste page.',
    '',
    '## What changed',
    '',
    '- Pastes detect their language as you type',
    '- Share pages load **twice as fast**',
    '- See the [upgrade guide](https://example.com/upgrade) for details',
    '',
    '```sh',
    'docker compose pull && docker compose up -d',
    '```',
    '',
    '> Back up your database before upgrading.'
  ),
  yaml: lines(
    'version: "3.9"',
    '',
    'services:',
    '  flare:',
    '    image: ghcr.io/example/flare:latest',
    '    restart: unless-stopped',
    '    ports:',
    '      - "3000:3000"',
    '    environment:',
    '      - DATABASE_URL=postgresql://flare:flare@db:5432/flare',
    '      - NEXTAUTH_URL=http://localhost:3000',
    '    depends_on:',
    '      - db',
    '  db:',
    '    image: postgres:16',
    '    volumes:',
    '      - db-data:/var/lib/postgresql/data',
    '',
    'volumes:',
    '  db-data:'
  ),
  java: lines(
    'package dev.example.uploads;',
    '',
    'import java.util.ArrayList;',
    'import java.util.List;',
    '',
    'public class UploadQueue {',
    '    private final List<String> pending = new ArrayList<>();',
    '',
    '    public void add(String name) {',
    '        pending.add(name);',
    '    }',
    '',
    '    @Override',
    '    public String toString() {',
    '        return "UploadQueue(" + pending.size() + ")";',
    '    }',
    '',
    '    public static void main(String[] args) {',
    '        UploadQueue queue = new UploadQueue();',
    '        queue.add("photo.png");',
    '        System.out.println(queue);',
    '    }',
    '}'
  ),
  sql: lines(
    '-- Adds invite links',
    'CREATE TABLE IF NOT EXISTS invites (',
    '  id SERIAL PRIMARY KEY,',
    '  code VARCHAR(32) NOT NULL UNIQUE,',
    '  created_by INTEGER REFERENCES users(id),',
    '  expires_at TIMESTAMPTZ',
    ');',
    '',
    'CREATE INDEX invites_created_by_idx ON invites (created_by);',
    '',
    "INSERT INTO invites (code, created_by) VALUES ('welcome', 1);",
    '',
    'SELECT code, expires_at',
    'FROM invites',
    'WHERE expires_at > now()',
    'ORDER BY expires_at;'
  ),
  wasm: lines(
    '(module',
    '  (func $add (param $a i32) (param $b i32) (result i32)',
    '    local.get $a',
    '    local.get $b',
    '    i32.add)',
    '  (export "add" (func $add)))'
  ),
  c: lines(
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    '',
    '#define MAX_NAME 64',
    '',
    'typedef struct {',
    '    char name[MAX_NAME];',
    '    size_t size;',
    '} upload_t;',
    '',
    'int main(int argc, char **argv) {',
    '    upload_t *upload = malloc(sizeof(upload_t));',
    '    if (argc < 2) {',
    '        fprintf(stderr, "usage: %s NAME\\n", argv[0]);',
    '        return 1;',
    '    }',
    '    strncpy(upload->name, argv[1], MAX_NAME - 1);',
    '    printf("Uploading %s\\n", upload->name);',
    '    free(upload);',
    '    return 0;',
    '}'
  ),
  cpp: lines(
    '#include <iostream>',
    '#include <string>',
    '#include <vector>',
    '',
    'namespace flare {',
    '',
    'template <typename T>',
    'T total(const std::vector<T>& values) {',
    '    T sum{};',
    '    for (const auto& value : values) sum += value;',
    '    return sum;',
    '}',
    '',
    '}  // namespace flare',
    '',
    'int main() {',
    '    std::vector<int> sizes{1, 2, 3};',
    '    std::cout << flare::total(sizes) << std::endl;',
    '    return 0;',
    '}'
  ),
  rust: lines(
    'use std::collections::HashMap;',
    'use std::fs;',
    '',
    '#[derive(Debug, Clone)]',
    'pub struct Upload {',
    '    name: String,',
    '    size: u64,',
    '}',
    '',
    'impl Upload {',
    '    pub fn new(name: &str, size: u64) -> Self {',
    '        Self { name: name.to_string(), size }',
    '    }',
    '}',
    '',
    'fn main() -> Result<(), Box<dyn std::error::Error>> {',
    '    let mut sizes: HashMap<String, u64> = HashMap::new();',
    '    let text = fs::read_to_string("uploads.txt")?;',
    '    for line in text.lines() {',
    '        let upload = Upload::new(line, line.len() as u64);',
    '        sizes.insert(upload.name.clone(), upload.size);',
    '    }',
    '    println!("{:?}", sizes);',
    '    Ok(())',
    '}'
  ),
  php: lines(
    '<?php',
    '',
    'namespace App\\Http\\Controllers;',
    '',
    'use Illuminate\\Http\\Request;',
    '',
    'class UploadController extends Controller',
    '{',
    '    public function store(Request $request)',
    '    {',
    "        $file = $request->file('upload');",
    "        $path = $file->store('uploads');",
    "        return response()->json(['path' => $path]);",
    '    }',
    '}'
  ),
  go: lines(
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"net/http"',
    '\t"os"',
    ')',
    '',
    'type Server struct {',
    '\tPort string',
    '}',
    '',
    'func (s *Server) Start() error {',
    '\thttp.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {',
    '\t\tfmt.Fprintln(w, "ok")',
    '\t})',
    '\treturn http.ListenAndServe(":"+s.Port, nil)',
    '}',
    '',
    'func main() {',
    '\tserver := &Server{Port: os.Getenv("PORT")}',
    '\tif err := server.Start(); err != nil {',
    '\t\tfmt.Println(err)',
    '\t\tos.Exit(1)',
    '\t}',
    '}'
  ),
  shell: lines(
    'set -euo pipefail',
    '',
    'INSTALL_DIR="${INSTALL_DIR:-/opt/flare}"',
    '',
    'echo "Installing Flare into $INSTALL_DIR"',
    'sudo apt-get update',
    'sudo apt-get install -y curl git',
    '',
    'if [ ! -d "$INSTALL_DIR" ]; then',
    '  sudo mkdir -p "$INSTALL_DIR"',
    'fi',
    '',
    'cd "$INSTALL_DIR"',
    'curl -fsSL https://example.com/flare.tar.gz | tar -xz',
    'export PATH="$INSTALL_DIR/bin:$PATH"',
    'echo "Done"'
  ),
  terminal: lines(
    '$ npm install',
    'added 412 packages in 9s',
    '$ npm run build',
    '> flare@3.1.0 build',
    '> next build'
  ),
  diff: lines(
    'diff --git a/lib/files/paste-name.ts b/lib/files/paste-name.ts',
    'index 3b18e51..a9c2f04 100644',
    '--- a/lib/files/paste-name.ts',
    '+++ b/lib/files/paste-name.ts',
    '@@ -1,6 +1,7 @@',
    ' /**',
    "- * A paste's filename.",
    "+ * A paste's filename and the language it is highlighted as.",
    ' */',
    ' import {',
    '+  type Language,',
    '   extensionOf,',
    "@@ -12,3 +13,4 @@ export const DEFAULT_PASTE_NAME = 'paste.txt'",
    ' export function pasteName(typed: string) {',
    '   return typed.trim() || DEFAULT_PASTE_NAME',
    ' }',
    '+'
  ),
  toml: lines(
    '[package]',
    'name = "flare-cli"',
    'version = "0.4.2"',
    'edition = "2021"',
    'description = "Upload files to a Flare server"',
    '',
    '[dependencies]',
    'clap = { version = "4", features = ["derive"] }',
    'reqwest = { version = "0.12", default-features = false }',
    'tokio = { version = "1", features = ["full"] }',
    '',
    '[[bin]]',
    'name = "flare"',
    'path = "src/main.rs"'
  ),
  ini: lines(
    '; Flare worker settings',
    '[server]',
    'host=0.0.0.0',
    'port=8080',
    'log_level=info',
    '',
    '[storage]',
    'driver=s3',
    'bucket=flare-uploads',
    'region=eu-west-1'
  ),
  env: lines(
    '# Database',
    'DATABASE_URL=postgresql://flare:secret@localhost:5432/flare',
    'NEXTAUTH_URL=http://localhost:3000',
    'NEXTAUTH_SECRET="replace-me"',
    '',
    '# Storage',
    'STORAGE_PROVIDER=local',
    'UPLOAD_MAX_SIZE=104857600'
  ),
} as const

const NOT_CODE = {
  prose: lines(
    'Thanks for the quick turnaround on the upload fixes last week. The team',
    'tried the new build on Friday and everything we threw at it went through,',
    'including the large video files that used to time out halfway. If you get',
    'a chance, could you look at whether the share page should remember the',
    'last theme a visitor picked? A few people asked about it in the meeting.'
  ),
  log: lines(
    '2026-11-20T10:15:02.114Z INFO  server listening on :3000',
    '2026-11-20T10:15:07.390Z INFO  upload started id=f9a2 size=10485760',
    '2026-11-20T10:15:09.021Z WARN  slow storage write took=1630ms',
    '2026-11-20T10:15:09.533Z ERROR upload failed id=f9a2 err="connection reset"',
    '2026-11-20T10:15:10.001Z INFO  retrying upload id=f9a2 attempt=2',
    '2026-11-20T10:15:12.448Z INFO  upload finished id=f9a2'
  ),
  pythonTraceback: lines(
    'Traceback (most recent call last):',
    '  File "/app/report.py", line 26, in <module>',
    '    main(sys.argv)',
    '  File "/app/report.py", line 21, in main',
    '    report = Report(argv[1]).load()',
    '  File "/app/report.py", line 15, in load',
    '    self.rows.append(json.loads(line))',
    'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)'
  ),
  jsStackTrace: lines(
    "TypeError: Cannot read properties of undefined (reading 'size')",
    '    at FileRow (webpack-internal:///./components/file-row.tsx:42:31)',
    '    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:16305:18)',
    '    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:20074:13)',
    '    at beginWork (node_modules/react-dom/cjs/react-dom.development.js:21587:16)'
  ),
  url: 'https://flare.example.com/f/abc123?download=1',
  word: 'hello',
  email: 'someone@example.com',
  csv: lines(
    'name,size,uploaded_at,owner',
    'photo.png,204800,2026-11-01,alex',
    'notes.md,1024,2026-11-02,sam',
    'video.mp4,10485760,2026-11-03,alex',
    'report.pdf,52344,2026-11-04,jo'
  ),
  shortNote: 'remember the milk',
  chat: lines(
    'hey, are you around?',
    'I pushed the fix: it was the env var.',
    'let me know if it works'
  ),
  emailBody: lines(
    'Hi Sam,',
    '',
    'The invoice is attached. Let me know if anything looks off.',
    '',
    'Thanks,',
    'Alex'
  ),
  commitMessage: lines(
    'Fix upload retries',
    '',
    'The worker gave up after one failure. It now retries three times',
    'with backoff, and logs each attempt.'
  ),
  proseWithKeywords: lines(
    'If you want to import data, run the script and then select the rows.',
    'For each file in the folder, check the size before you delete from disk.',
    'Then export the report and send it over.'
  ),
  notes: lines(
    'Note: the build is slow today.',
    'Todo: fix the cache.',
    'Owner: Sam',
    'Status: blocked'
  ),
  accessLog: lines(
    '127.0.0.1 - - [20/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 612',
    '127.0.0.1 - - [20/Nov/2026:10:00:01 +0000] "GET /f/a HTTP/1.1" 404 0'
  ),
  npmError: lines(
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE unable to resolve dependency tree',
    'npm ERR!',
    'npm ERR! While resolving: flare@3.1.0'
  ),
  javaStackTrace: lines(
    'Exception in thread "main" java.lang.NullPointerException',
    '\tat com.example.App.main(App.java:10)',
    '\tat java.base/java.lang.Thread.run(Thread.java:833)'
  ),
  hexDump: lines(
    '00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR',
    '00000010: 0000 0010 0000 0010 0806 0000 001f f3ff  ................'
  ),
  // Flare has no grammar for these, so they stay plain.
  ruby: lines(
    'class Greeter',
    '  def initialize(name)',
    '    @name = name',
    '  end',
    '',
    '  def greet',
    '    puts "Hello #{@name}"',
    '  end',
    'end'
  ),
  dockerfile: lines(
    'FROM node:22-alpine',
    'WORKDIR /app',
    'COPY package.json .',
    'RUN npm ci',
    'COPY . .',
    'CMD ["node", "server.js"]'
  ),
} as const

describe('detectLanguage', () => {
  it.each([
    ['html', FIXTURES.html],
    ['html', FIXTURES.htmlFragment],
    ['xml', FIXTURES.xml],
    ['xml', FIXTURES.svg],
    ['css', FIXTURES.css],
    ['scss', FIXTURES.scss],
    ['less', FIXTURES.less],
    ['sass', FIXTURES.sass],
    ['javascript', FIXTURES.javascript],
    ['jsx', FIXTURES.jsx],
    ['typescript', FIXTURES.typescript],
    ['tsx', FIXTURES.tsx],
    ['json', FIXTURES.json],
    ['python', FIXTURES.python],
    ['markdown', FIXTURES.markdown],
    ['yaml', FIXTURES.yaml],
    ['java', FIXTURES.java],
    ['sql', FIXTURES.sql],
    ['wasm', FIXTURES.wasm],
    ['c', FIXTURES.c],
    ['cpp', FIXTURES.cpp],
    ['rust', FIXTURES.rust],
    ['php', FIXTURES.php],
    ['go', FIXTURES.go],
    ['shell', FIXTURES.shell],
    ['shell', FIXTURES.terminal],
    ['diff', FIXTURES.diff],
    ['toml', FIXTURES.toml],
    ['ini', FIXTURES.ini],
    ['ini', FIXTURES.env],
  ] as const)('reads %s', (language, text) => {
    expect(detectLanguage(text)).toBe(language)
  })

  it.each(Object.entries(NOT_CODE))('leaves %s as plain text', (_, text) => {
    expect(detectLanguage(text)).toBe('text')
  })

  it('leaves empty and blank text as plain text', () => {
    expect(detectLanguage('')).toBe('text')
    expect(detectLanguage('  \n\t\n')).toBe('text')
  })

  it('names the language a shebang runs, even in a short script', () => {
    expect(detectLanguage('#!/bin/bash\nls')).toBe('shell')
    expect(detectLanguage('#!/usr/bin/env bash\necho hi')).toBe('shell')
    expect(detectLanguage('#!/bin/sh')).toBe('shell')
    expect(detectLanguage('#!/usr/bin/env python3\nprint(1)')).toBe('python')
    expect(detectLanguage('#!/usr/bin/env node\nmain()')).toBe('javascript')
    expect(detectLanguage('#!/usr/bin/env -S deno run -A\nx()')).toBe(
      'javascript'
    )
    expect(detectLanguage('#!/usr/bin/php\n<?php echo 1;')).toBe('php')
    // A language Flare has no grammar for stays plain.
    expect(detectLanguage('#!/usr/bin/env ruby\nputs "hi"')).toBe('text')
  })

  it('reads a bash install script with a shebang', () => {
    expect(detectLanguage(`#!/usr/bin/env bash\n${FIXTURES.shell}`)).toBe(
      'shell'
    )
  })

  it('reads short JSON, PHP and HTML documents', () => {
    expect(detectLanguage('{"a":1}')).toBe('json')
    expect(detectLanguage('[1, 2]')).toBe('json')
    expect(detectLanguage('<?php echo 1;')).toBe('php')
    expect(detectLanguage('<!DOCTYPE html>')).toBe('html')
  })

  it('reads a single strong line of SQL', () => {
    expect(detectLanguage('SELECT * FROM uploads WHERE size > 1000;')).toBe(
      'sql'
    )
  })

  it('reads PHP mixed into HTML', () => {
    expect(
      detectLanguage(
        lines(
          '<ul>',
          '  <?php foreach ($files as $file): ?>',
          '    <li><?= htmlspecialchars($file) ?></li>',
          '  <?php endforeach; ?>',
          '</ul>'
        )
      )
    ).toBe('php')
  })

  it('reads JSON with comments by its shape', () => {
    expect(
      detectLanguage(
        lines(
          '{',
          '  // Compiler settings',
          '  "compilerOptions": {',
          '    "strict": true,',
          '    "target": "ES2022",',
          '    "module": "esnext",',
          '    "jsx": "preserve",',
          '  },',
          '}'
        )
      )
    ).toBe('json')
  })

  it('reads Markdown that is mostly prose', () => {
    expect(
      detectLanguage(
        lines(
          '# Meeting notes',
          '',
          'We agreed to ship the paste page changes in the next release and to',
          'write the upgrade notes before the end of the week, with screenshots.',
          '',
          '## Follow-ups',
          '',
          'Sam will check whether the share page should remember the theme.'
        )
      )
    ).toBe('markdown')
  })

  it("doesn't read prose mentioning keywords as code", () => {
    for (const text of [
      'Select a file from the list, then press Upload.\nIt shows up in a few seconds.',
      'Import the photos from your camera first.\nThen delete from the card.',
      'Create table of contents for the guide.\nAdd a short intro too.',
    ])
      expect(detectLanguage(text), text).toBe('text')
  })

  it('reads code inside a Markdown code block as Markdown', () => {
    expect(
      detectLanguage(
        lines(
          'Run this to reproduce:',
          '',
          '```python',
          'import json',
          'def load(path):',
          '    with open(path) as handle:',
          '        return json.load(handle)',
          '```'
        )
      )
    ).toBe('markdown')
  })

  it('reads only the start of long text, quickly', () => {
    const mixed = [
      FIXTURES.python,
      NOT_CODE.log,
      FIXTURES.css,
      NOT_CODE.prose,
      FIXTURES.tsx,
    ].join('\n\n')
    const big = mixed.repeat(Math.ceil(8_192 / mixed.length)).slice(0, 8_192)
    detectLanguage(big)
    const start = performance.now()
    for (let run = 0; run < 10; run++) detectLanguage(big)
    expect((performance.now() - start) / 10).toBeLessThan(20)
  })

  it('stays fast on text built to make patterns backtrack', () => {
    const hostile = [
      'select ' + ','.repeat(5_000),
      'a'.repeat(8_000) + '!',
      ' '.repeat(4_000) + 'x' + ' '.repeat(4_000),
      ('def f(' + ')'.repeat(400) + '\n').repeat(40),
      ('<a ' + '='.repeat(300) + '\n').repeat(40),
      ('x = "' + '"'.repeat(390) + '\n').repeat(40),
      ('[' + ' '.repeat(390) + '\n').repeat(40),
    ]
    for (const text of hostile) {
      const start = performance.now()
      detectLanguage(text)
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(50)
    }
  })

  it.each([
    [
      'typescript',
      'function add(a: number, b: number): number {\n  return a + b\n}',
    ],
    [
      'javascript',
      'class Queue {\n  constructor() {\n    this.items = []\n  }\n}\nmodule.exports = Queue',
    ],
    [
      'shell',
      'docker run -d -p 3000:3000 -v flare:/data ghcr.io/example/flare:latest',
    ],
    ['shell', 'curl -fsSL https://get.example.com | sh'],
    ['sql', 'select id, name from users where id = 1;'],
    ['css', '.a { color: red; }\n.b { margin: 0 auto; }'],
    [
      'go',
      'type User struct {\n\tID    int    `json:"id"`\n\tEmail string `json:"email"`\n}',
    ],
    [
      'ini',
      '[core]\n\tfilemode = true\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:x/y.git',
    ],
    [
      'ini',
      'app.name=Flare\napp.port=8080\nspring.datasource.url=jdbc:postgresql://localhost/flare',
    ],
    [
      'wasm',
      '(func $f (param i32) (result i32)\n  local.get 0\n  i32.const 1\n  i32.add)',
    ],
    [
      'python',
      'import requests\n\nresp = requests.get("https://example.com/api")\nfor item in resp.json():\n    print(item["name"])',
    ],
    ['markdown', '- milk\n- eggs\n- bread\n- butter'],
    ['markdown', '| Name | Size |\n| --- | --- |\n| a.png | 2 KB |'],
    [
      'shell',
      'export DATABASE_URL=postgres://localhost/flare\nexport PORT=3000',
    ],
  ] as const)('reads a short %s snippet', (language, text) => {
    expect(detectLanguage(text)).toBe(language)
  })

  it('reads a comment-heavy script as its language, not Markdown', () => {
    expect(
      detectLanguage(
        lines(
          '# Backup script',
          '# Runs nightly from cron.',
          '',
          '# Dump the database',
          'pg_dump flare > /backups/flare.sql',
          '',
          '# Compress it',
          'gzip -f /backups/flare.sql',
          '',
          '# Upload',
          'aws s3 cp /backups/flare.sql.gz s3://backups/'
        )
      )
    ).toBe('shell')
  })

  it('reads only the start of a huge single line', () => {
    const huge = `const data = "${'x'.repeat(10_000_000)}"`
    const start = performance.now()
    detectLanguage(huge)
    expect(performance.now() - start).toBeLessThan(100)
  })

  it('parses a large JSON document only up to a limit', () => {
    const rows = Array.from({ length: 40_000 }, (_, index) => ({
      id: index,
      name: `file-${index}.png`,
    }))
    const big = JSON.stringify(rows)
    expect(big.length).toBeGreaterThan(1_000_000)
    expect(detectLanguage(big)).toBe('json')
  })
})

describe('suggestPasteName', () => {
  it('names a Markdown document after its first main heading', () => {
    expect(suggestPasteName(FIXTURES.markdown, 'markdown')).toBe(
      'release-notes.md'
    )
    expect(
      suggestPasteName(
        '### Small\n\n## Café & Bar: 2026 plans! ##\n\n# Later',
        'markdown'
      )
    ).toBe('cafe-bar-2026-plans.md')
    expect(suggestPasteName('# Résumé tips', 'markdown')).toBe('resume-tips.md')
  })

  it('skips headings inside code blocks', () => {
    expect(
      suggestPasteName('```sh\n# not a title\n```\n\n# Real title', 'markdown')
    ).toBe('real-title.md')
  })

  it('names an HTML document after its title', () => {
    expect(suggestPasteName(FIXTURES.html, 'html')).toBe('flare-status.html')
    expect(
      suggestPasteName('<title>Tom &amp; Jerry</title><p>x</p>', 'html')
    ).toBe('tom-jerry.html')
  })

  it('keeps a slug to 48 characters without a trailing hyphen', () => {
    const name = suggestPasteName(`# ${'word '.repeat(30)}`, 'markdown')
    expect(name.length).toBeLessThanOrEqual(48 + '.md'.length)
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)
  })

  it('falls back to paste with the language’s extension', () => {
    expect(suggestPasteName('just text', 'text')).toBe(DEFAULT_PASTE_NAME)
    expect(suggestPasteName('print(1)', 'python')).toBe('paste.py')
    expect(suggestPasteName('echo hi', 'shell')).toBe('paste.sh')
    expect(suggestPasteName('a = 1', 'toml')).toBe('paste.toml')
    expect(suggestPasteName('a=1', 'ini')).toBe('paste.ini')
    expect(suggestPasteName('+x', 'diff')).toBe('paste.diff')
    expect(suggestPasteName('No heading here', 'markdown')).toBe('paste.md')
    expect(suggestPasteName('# ¿¡!?', 'markdown')).toBe('paste.md')
    expect(suggestPasteName('<title> </title>', 'html')).toBe('paste.html')
    // Only Markdown and HTML titles name a paste.
    expect(suggestPasteName('# Heading', 'python')).toBe('paste.py')
  })
})
