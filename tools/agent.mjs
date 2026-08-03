#!/usr/bin/env node
/**
 * Агент генерации конфигов Нитро3 поверх LLM Proxy (формат Anthropic /v1/messages).
 *
 * Запуск:
 *   LLM_PROXY_TOKEN=... node tools/agent.mjs "стартовый экран со списком заявок и поиском"
 *
 * Переменные окружения:
 *   LLM_PROXY_URL    — базовый URL прокси (default: https://llm-proxy.t-tech.team)
 *   LLM_PROXY_TOKEN  — токен, попадает в заголовок authorization как есть
 *   NITRO_MODEL      — модель (default: claude-sonnet-4-5-20250929)
 *   NITRO_MAX_TURNS  — максимум ходов цикла (default: 15)
 *   NITRO_AGENT_FAKE — 1: прогон без сети на скриптованных ответах (селфтест механики)
 *
 * Инструменты (имена и аргументы плоские — по требованиям LLM Proxy к tool calling):
 *   list_examples {}            — индекс эталонных примеров
 *   read_example {name}         — содержимое примера или канона
 *   validate_config {yaml}      — двухуровневая валидация текста конфига
 *   write_config {yaml}         — валидация + запись out/app.yaml (только валидный)
 *
 * Гейт: результатом считается только конфиг, прошедший валидатор (write_config).
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
const MODEL = process.env.NITRO_MODEL ?? 'claude-sonnet-4-5-20250929';
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
  { name: 'list_examples', description: 'Индекс эталонных примеров конфигов Нитро3 с кратким описанием каждого.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_example', description: 'Полное содержимое эталонного примера по имени файла из list_examples.',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'имя файла, например 02-model-counter.yaml' } }, required: ['name'], additionalProperties: false } },
  { name: 'validate_config', description: 'Проверяет YAML-конфиг Нитро3: JSON Schema + семантика (ссылки биндингов, дубликаты id). Возвращает ошибки для исправления.',
    input_schema: { type: 'object', properties: { yaml: { type: 'string', description: 'полный текст конфига в YAML' } }, required: ['yaml'], additionalProperties: false } },
  { name: 'write_config', description: 'Финальный шаг: валидирует и записывает конфиг в out/app.yaml. Принимает только валидный конфиг.',
    input_schema: { type: 'object', properties: { yaml: { type: 'string', description: 'полный текст конфига в YAML' } }, required: ['yaml'], additionalProperties: false } },
];

// ---------- Системный промпт ----------

function systemPrompt() {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  return [
    'Ты — генератор конфигов приложений на платформе Нитро3 (декларативный YAML:',
    'примитивы, модели, сервисы, dataSources, биндинги, JSONata).',
    'Схема — источник истины по структуре; поведенческие правила и индекс примеров ниже (README пакета).',
    'Алгоритм работы:',
    '1) list_examples, затем read_example для 2–4 примеров, релевантных задаче (не пиши по памяти);',
    '2) собери полный YAML-конфиг типа component;',
    '3) validate_config, исправляй по ошибкам;',
    '4) заверши строго через write_config (он принимает только валидный конфиг), затем кратко опиши, что построил.',
    'Не выдумывай поля и события, которых нет в схеме и примерах. Все тексты интерфейса — на русском.',
    '',
    '=== README пакета ===',
    readme,
  ].join('\n');
}

// ---------- Транспорт ----------

async function callModel(messages) {
  if (FAKE) return fakeModel(messages);
  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': process.env.LLM_PROXY_TOKEN ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Number(process.env.NITRO_MAX_TOKENS ?? 8192),
      system: systemPrompt(),
      tools,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`LLM Proxy ${res.status}: ${await res.text()}`);
  return res.json();
}

// Скриптованные ответы для селфтеста механики цикла (без сети).
let fakeStep = 0;
function fakeModel() {
  const tiny = [
    'type: component',
    'root:',
    '  type: panel',
    '  items:',
    '    - type: text',
    '      text: Привет из селфтеста',
  ].join('\n') + '\n';
  const steps = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_examples', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'read_example', input: { name: '02-model-counter.yaml' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'write_config', input: { yaml: tiny } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Селфтест: минимальный конфиг записан.' }] },
  ];
  return Promise.resolve(steps[Math.min(fakeStep++, steps.length - 1)]);
}

// ---------- Цикл ----------

let written = null;

async function run(task) {
  const messages = [{ role: 'user', content: `Собери конфиг приложения Нитро3 по описанию:\n${task}` }];
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const reply = await callModel(messages);
    const content = reply.content ?? [];
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) console.log(`\n[модель] ${block.text.trim()}`);
    }
    if (reply.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content });
    const results = [];
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      console.log(`[tool] ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);
      let output;
      try {
        output = toolHandlers[block.name]?.(block.input) ?? `Неизвестный инструмент: ${block.name}`;
      } catch (e) {
        output = `Ошибка инструмента: ${e.message}`;
      }
      results.push({ type: 'tool_result', tool_use_id: block.id, content: String(output) });
    }
    messages.push({ role: 'user', content: results });
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
