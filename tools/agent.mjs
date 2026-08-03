#!/usr/bin/env node
/**
 * Агент генерации конфигов Нитро3 поверх LLM Proxy — OpenAI Chat Completions.
 *
 * Запуск:
 *   LLM_PROXY_TOKEN=... node tools/agent.mjs "секундомер со стартом и стопом"
 *
 * Переменные окружения:
 *   LLM_PROXY_URL    — базовый URL прокси (default: https://llm-proxy.t-tech.team)
 *   LLM_PROXY_TOKEN  — API key, уходит как Authorization: Bearer <token>
 *   NITRO_MODEL      — модель с префиксом провайдера (default: openai/gpt-5.4)
 *   NITRO_MAX_TURNS  — максимум ходов цикла (default: 15)
 *   NITRO_MAX_TOKENS — если задан, уходит как max_completion_tokens
 *   NITRO_AGENT_FAKE — 1: прогон без сети на скриптованных ответах (проверка механики)
 *
 * TLS: если корпоративный сертификат не в доверенных у node —
 *   NODE_EXTRA_CA_CERTS=/путь/к/corp-ca.pem (предпочтительно)
 *   или NODE_TLS_REJECT_UNAUTHORIZED=0 (аналог verify=False из доков прокси).
 * Если прокси отвечает 404 на /chat/completions — задай LLM_PROXY_URL с /v1.
 *
 * Гейт: результат — только конфиг, прошедший валидатор (write_config → out/app.yaml).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfigText } from './validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const examplesDir = resolve(root, 'examples');
const canonicalDir = resolve(root, 'canonical');
const outDir = resolve(root, 'out');

const PROXY_URL = process.env.LLM_PROXY_URL ?? 'https://llm-proxy.t-tech.team';
const MODEL = process.env.NITRO_MODEL ?? 'openai/gpt-5.4';
const MAX_TURNS = Number(process.env.NITRO_MAX_TURNS ?? 15);
const FAKE = process.env.NITRO_AGENT_FAKE === '1';

// ---------- Инструменты ----------

function exampleFiles() {
  const list = readdirSync(examplesDir).filter(f => f.endsWith('.yaml')).sort()
    .map(f => resolve(examplesDir, f));
  list.push(resolve(canonicalDir, 'nitro-editor.yaml'));
  return list;
}

function firstCommentLine(text) {
  const line = text.split('\n').find(l => l.startsWith('#'));
  return line ? line.replace(/^#\s*/, '') : '';
}

let written = null;

const toolHandlers = {
  list_examples() {
    return exampleFiles()
      .map(p => `${basename(p)} — ${firstCommentLine(readFileSync(p, 'utf8'))}`)
      .join('\n');
  },
  read_example({ name }) {
    const file = exampleFiles().find(p => basename(p) === name);
    if (!file) return `Ошибка: примера "${name}" нет. Возьми имя из list_examples.`;
    return readFileSync(file, 'utf8');
  },
  validate_config({ yaml }) {
    const { ok, errors } = validateConfigText(yaml ?? '');
    return ok ? 'OK: конфиг валиден (schema + semantic).' : `Ошибки:\n${errors.join('\n')}`;
  },
  write_config({ yaml }) {
    const { ok, errors } = validateConfigText(yaml ?? '');
    if (!ok) return `Отклонено, конфиг невалиден:\n${errors.join('\n')}`;
    mkdirSync(outDir, { recursive: true });
    const target = resolve(outDir, 'app.yaml');
    writeFileSync(target, yaml, 'utf8');
    written = target;
    return `Записано: ${target}`;
  },
};

const tools = [
  { type: 'function', function: {
    name: 'list_examples',
    description: 'Индекс эталонных примеров конфигов Нитро3 с кратким описанием каждого.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: {
    name: 'read_example',
    description: 'Полное содержимое эталонного примера по имени файла из list_examples.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'имя файла, например 02-model-counter.yaml' } }, required: ['name'], additionalProperties: false } } },
  { type: 'function', function: {
    name: 'validate_config',
    description: 'Проверяет YAML-конфиг Нитро3: JSON Schema + семантика (ссылки биндингов, дубликаты id). Возвращает ошибки для исправления.',
    parameters: { type: 'object', properties: { yaml: { type: 'string', description: 'полный текст конфига в YAML' } }, required: ['yaml'], additionalProperties: false } } },
  { type: 'function', function: {
    name: 'write_config',
    description: 'Финальный шаг: валидирует и записывает конфиг в out/app.yaml. Принимает только валидный конфиг.',
    parameters: { type: 'object', properties: { yaml: { type: 'string', description: 'полный текст конфига в YAML' } }, required: ['yaml'], additionalProperties: false } } },
];

// ---------- Системный промпт ----------

function systemPrompt() {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  return [
    'Ты — генератор конфигов приложений на платформе Нитро3 (декларативный YAML:',
    'примитивы, модели, сервисы, dataSources, биндинги, JSONata).',
    'Схема — источник истины по структуре; поведенческие правила и индекс примеров ниже (README пакета).',
    'Алгоритм работы:',
    '1) list_examples, затем read_example для 2–4 примеров по механизмам задачи (таймер → 12, списки → 05, dataSource → 04, роутинг → 07); не пиши по памяти;',
    '2) собери полный YAML-конфиг типа component;',
    '3) validate_config, исправляй по ошибкам;',
    '4) заверши строго через write_config (он принимает только валидный конфиг), затем кратко опиши, что построил.',
    'Не выдумывай поля и события, которых нет в схеме и примерах. Все тексты интерфейса — на русском.',
    '',
    '=== README пакета ===',
    readme,
  ].join('\n');
}

// ---------- Транспорт: OpenAI Chat Completions через LLM Proxy ----------

async function callModel(messages) {
  if (FAKE) return fakeModel();
  const body = { model: MODEL, messages, tools };
  if (process.env.NITRO_MAX_TOKENS) body.max_completion_tokens = Number(process.env.NITRO_MAX_TOKENS);
  const res = await fetch(`${PROXY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LLM_PROXY_TOKEN ?? ''}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM Proxy ${res.status}: ${await res.text()}`);
  return res.json();
}

// Скриптованные ответы для проверки механики цикла без сети.
let fakeStep = 0;
function fakeModel() {
  const tiny = 'type: component\nroot:\n  type: panel\n  items:\n    - type: text\n      text: Привет из селфтеста\n';
  const call = (id, name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: {
    role: 'assistant', content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const steps = [
    call('t1', 'list_examples', {}),
    call('t2', 'read_example', { name: '02-model-counter.yaml' }),
    call('t3', 'write_config', { yaml: tiny }),
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Селфтест: минимальный конфиг записан.' } }] },
  ];
  return Promise.resolve(steps[Math.min(fakeStep++, steps.length - 1)]);
}

// ---------- Цикл ----------

async function run(task) {
  const messages = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: `Собери конфиг приложения Нитро3 по описанию:\n${task}` },
  ];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const reply = await callModel(messages);
    const choice = reply.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error(`Неожиданный ответ прокси: ${JSON.stringify(reply).slice(0, 300)}`);

    if (msg.content?.trim()) console.log(`\n[модель] ${msg.content.trim()}`);
    if (choice.finish_reason === 'length') console.log('[warn] ответ обрезан по длине (finish_reason=length)');

    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) break;

    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      let output;
      try { args = JSON.parse(call.function?.arguments || '{}'); }
      catch (e) { output = `Ошибка: arguments не парсятся как JSON (${e.message}).`; }
      console.log(`[tool] ${name}(${(call.function?.arguments || '{}').slice(0, 120)})`);
      if (output === undefined) {
        try { output = toolHandlers[name]?.(args) ?? `Неизвестный инструмент: ${name}`; }
        catch (e) { output = `Ошибка инструмента: ${e.message}`; }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(output) });
    }
  }

  if (written) {
    console.log(`\n✓ Готово: ${written} (валидация пройдена)`);
    return 0;
  }
  console.log('\n✗ Валидный конфиг не записан — см. лог выше.');
  return 1;
}

const task = process.argv.slice(2).join(' ').trim();
if (!task && !FAKE) {
  console.error('Использование: node tools/agent.mjs "описание приложения"');
  process.exit(2);
}
process.exit(await run(task || 'селфтест'));
