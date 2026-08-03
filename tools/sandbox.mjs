#!/usr/bin/env node
/**
 * Песочница проверки конфигов: открывает приложение в Chromium с моками сети
 * на уровне БРАУЗЕРА (Playwright route) и собирает ошибки. Фронт и бэк не трогаем.
 *
 * Смоук (headless, код выхода 0/1):
 *   node tools/sandbox.mjs http://localhost:4200 --mocks eval/mocks/04-client.json
 * Ручная приёмка (открытый браузер с теми же моками):
 *   node tools/sandbox.mjs http://localhost:4200 --mocks eval/mocks/04-client.json --headed
 *
 * Требуется один раз: npm i && npx playwright install chromium
 *
 * Формат mocks-файла — ЕДИНЫЙ КОНТРАКТ песочницы по фазам (этот скрипт сейчас;
 * config-стаб в контейнере — Ф1; секция mocks конфига Нитро — Ф2):
 * [
 *   {
 *     "url": "** /demo/api/client/get"   // glob Playwright (без пробела),
 *     "method": "POST",                   // опционально, по умолчанию любой
 *     "status": 200,                      // ответ по умолчанию
 *     "body": { ... },
 *     "delayMs": 800,                     // опционально
 *     "byMatch": [                        // опционально: ветвление по телу запроса
 *       { "when": { "id": "err400" }, "status": 400, "body": { "errorMessage": "..." } }
 *     ]
 *   }
 * ]
 * where: ключи `when` — точечные пути по JSON тела запроса, сравнение на равенство.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));
const headed = args.includes('--headed');
const mocksArg = args[args.indexOf('--mocks') + 1];
const mocksFile = args.includes('--mocks') ? mocksArg : null;
const timeoutMs = Number(args[args.indexOf('--timeout') + 1] || 10000);

if (!url) {
  console.error('Использование: node tools/sandbox.mjs <url> [--mocks file.json] [--headed] [--timeout мс]');
  process.exit(2);
}

const dotGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function pickResponse(rule, request) {
  let requestBody = {};
  try { requestBody = JSON.parse(request.postData() ?? '{}'); } catch { /* не JSON — ок */ }
  for (const variant of rule.byMatch ?? []) {
    const hit = Object.entries(variant.when ?? {}).every(([p, v]) => dotGet(requestBody, p) === v);
    if (hit) return { status: variant.status ?? rule.status ?? 200, body: variant.body ?? rule.body ?? {} };
  }
  return { status: rule.status ?? 200, body: rule.body ?? {} };
}

const issues = [];
const note = (kind, text) => {
  issues.push(`[${kind}] ${text}`);
  console.log(`  [${kind}] ${text}`);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage();

// Моки: точка подмены — браузер.
const rules = mocksFile ? JSON.parse(readFileSync(mocksFile, 'utf8')) : [];
for (const rule of rules) {
  await page.route(rule.url, async route => {
    const request = route.request();
    if (rule.method && request.method() !== rule.method) return route.fallback();
    if (rule.delayMs) await new Promise(r => setTimeout(r, rule.delayMs));
    const { status, body } = pickResponse(rule, request);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Сбор ошибок.
page.on('console', msg => { if (msg.type() === 'error') note('console', msg.text()); });
page.on('pageerror', err => note('pageerror', String(err)));
page.on('requestfailed', req => note('requestfailed', `${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on('response', res => { if (res.status() >= 400) note('http', `${res.status()} ${res.url()}`); });

console.log(`Открываю ${url}${mocksFile ? ` с моками ${mocksFile}` : ''}...`);
try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
} catch (e) {
  note('goto', String(e));
}

if (headed) {
  console.log('Браузер открыт с моками — кликай приёмку. Завершение: Ctrl+C.');
  await new Promise(() => {});
}

await page.waitForTimeout(timeoutMs);
mkdirSync(resolve('out'), { recursive: true });
await page.screenshot({ path: resolve('out', 'smoke.png'), fullPage: true });
await browser.close();

if (issues.length === 0) {
  console.log(`✓ Смоук чист (${timeoutMs} мс), скриншот: out/smoke.png`);
  process.exit(0);
}
console.log(`✗ Смоук: ${issues.length} проблем(ы), скриншот: out/smoke.png`);
process.exit(1);
