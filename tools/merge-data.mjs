#!/usr/bin/env node
/**
 * merge-data.mjs — 词汇数据合并脚本
 *
 * 将旧版「真经刷词神器」的 22 个 data-x.js（每章一个全局 vocabulary 数组）
 * 合并为 Web 版单一数据文件 js/data.js（window.VOCAB_DATA）。
 *
 * 用法：
 *   node tools/merge-data.mjs [源数据目录] [输出文件]
 *
 * 示例：
 *   node tools/merge-data.mjs "../我的Theo词汇真经学习工具" "js/data.js"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(process.argv[2] || join(__dirname, '..', '..', '我的Theo词汇真经学习工具'));
const OUT_FILE = resolve(process.argv[3] || join(__dirname, '..', 'js', 'data.js'));

const CHAPTER_COUNT = 22;
const FIELDS = ['id', 'word', 'phonetic', 'pos', 'meaningCN', 'tag', 'root', 'exampleEN', 'exampleCN', 'extra'];

/** 在隔离作用域中执行旧版数据文件，取出 vocabulary 数组 */
function loadVocabulary(filePath) {
  const code = readFileSync(filePath, 'utf8');
  const factory = new Function(`${code}\nreturn typeof vocabulary !== 'undefined' ? vocabulary : [];`);
  const list = factory();
  if (!Array.isArray(list)) throw new Error(`${filePath}: vocabulary 不是数组`);
  return list;
}

/** 规范化单词对象，补齐缺失字段 */
function normalizeWord(raw, chapter, index) {
  const id = Number(raw.id ?? index + 1);
  const w = { chapter, key: `${chapter}:${id}`, id };
  for (const f of FIELDS) {
    if (f === 'id') continue;
    const v = raw[f];
    w[f] = typeof v === 'string' ? v.trim() : (v == null ? '' : String(v));
  }
  if (!w.word) throw new Error(`第${chapter}章第${index + 1}个单词缺少 word 字段`);
  return w;
}

const chapters = {};
let totalWords = 0;
const report = [];

for (let ch = 1; ch <= CHAPTER_COUNT; ch++) {
  const file = join(SRC_DIR, `data-${ch}.js`);
  if (!existsSync(file)) {
    console.warn(`⚠️  缺少 ${file}，第${ch}章将为空`);
    chapters[ch] = [];
    continue;
  }
  const list = loadVocabulary(file);
  chapters[ch] = list.map((raw, i) => normalizeWord(raw, ch, i));
  totalWords += chapters[ch].length;
  report.push(`第${ch}章: ${chapters[ch].length} 词`);
}

const payload = {
  meta: {
    name: 'Theo哥哥 真经词汇',
    source: 'Theo哥哥词汇真经学习工具（B站 @Theo哥哥教雅思）',
    chapters: CHAPTER_COUNT,
    totalWords,
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  chapters,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
const out = `/* 本文件由 tools/merge-data.mjs 自动生成，请勿手改。
 * 数据来源：${payload.meta.source}
 * 生成日期：${payload.meta.generatedAt}｜共 ${CHAPTER_COUNT} 章 / ${totalWords} 词
 */
window.VOCAB_DATA = ${JSON.stringify(payload)};
`;
writeFileSync(OUT_FILE, out, 'utf8');

console.log(report.join('\n'));
console.log(`✅ 共 ${totalWords} 词 → ${OUT_FILE}（${(out.length / 1024).toFixed(0)} KB）`);
