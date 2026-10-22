/* ============================================================
 * build.mjs — 按章节拆分 + 文件指纹 构建脚本（无第三方依赖）
 *
 * 输入（开发态，可直接 file:// 打开）：
 *   index.html, css/style.css, js/app.js, js/data.js
 * 输出（部署态，指纹化、可长缓存）：
 *   dist/index.html
 *   dist/css/style.<hash>.css
 *   dist/js/app.<hash>.js
 *   dist/js/data/meta.<hash>.js        -> window.VOCAB_META = [{id,count,file}]
 *   dist/js/data/ch-01.<hash>.js ...   -> window.VOCAB_CHUNKS[id] = [...]
 *
 * 设计：数据按章节拆成独立分片，首屏只下载 meta（章节索引）+ 当前章，
 * 其余章节在用户切换/复习/恢复进度时按需动态加载，显著降低首屏体积。
 * 所有静态资源以内容哈希命名，配合 nginx 的 immutable 长缓存，更新后
 * 因文件名变化自动失效，无需手动清缓存。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..'); // 仓库根
const outDir = path.join(root, 'dist');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });

rmrf(outDir);
fs.mkdirSync(path.join(outDir, 'css'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'js', 'data'), { recursive: true });

/* ---------- 1. 读取并解析 data.js ---------- */
const dataSrc = fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8');
const fakeWindow = {};
// 在受控作用域内求值，拿到 window.VOCAB_DATA 对象
const DATA = new Function('window', dataSrc + '\n;return window.VOCAB_DATA;')(fakeWindow);
if (!DATA || !DATA.chapters) {
  console.error('✗ js/data.js 未找到 VOCAB_DATA.chapters');
  process.exit(1);
}
const chapterIds = Object.keys(DATA.chapters).map(Number).sort((a, b) => a - b);

/* ---------- 2. 按章节生成分片 ---------- */
const meta = [];
for (const id of chapterIds) {
  const arr = DATA.chapters[id];
  const content = 'window.VOCAB_CHUNKS[' + id + '] = ' + JSON.stringify(arr) + ';\n';
  const h = sha(content);
  const fname = `ch-${String(id).padStart(2, '0')}.${h}.js`;
  fs.writeFileSync(path.join(outDir, 'js', 'data', fname), content);
  meta.push({ id, count: arr.length, file: 'js/data/' + fname });
}

const metaContent = 'window.VOCAB_META = ' + JSON.stringify(meta) + ';\n';
const metaHash = sha(metaContent);
const metaFname = `meta.${metaHash}.js`;
fs.writeFileSync(path.join(outDir, 'js', 'data', metaFname), metaContent);

/* ---------- 3. 指纹化 css / app.js ---------- */
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const cssFname = `style.${sha(css)}.css`;
fs.writeFileSync(path.join(outDir, 'css', cssFname), css);

let app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const appFname = `app.${sha(app)}.js`;
fs.writeFileSync(path.join(outDir, 'js', appFname), app);

/* ---------- 4. 改写 index.html 引用 ---------- */
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/css\/style\.css/g, 'css/' + cssFname);
html = html.replace(/js\/app\.js/g, 'js/' + appFname);
html = html.replace(/js\/data\.js/g, 'js/data/' + metaFname);
fs.writeFileSync(path.join(outDir, 'index.html'), html);

const total = meta.reduce((s, m) => s + m.count, 0);
console.log('✓ 构建完成 -> dist/');
console.log('  章节数 :', meta.length, ' 总词数:', total);
console.log('  meta   :', metaFname);
console.log('  app    :', appFname);
console.log('  css    :', cssFname);
console.log('  分片   :', meta.map((m) => m.file).join('  '));
