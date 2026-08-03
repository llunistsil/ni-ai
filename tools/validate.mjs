#!/usr/bin/env node
/**
 * Валидатор конфигов Нитро3.
 *
 * Уровень 1 — структурный: ajv по schema/configSchema.json.
 * Уровень 2 — семантический:
 *   - ссылки в глобальных bindings (triggers / context / actions[].target)
 *     и в localBindings (triggers / context / actions target) разрешаются
 *     в области видимости компонента: id примитивов в root-дереве,
 *     ключи models, ключи dataSources, id (или type) сервисов, "COMPONENT";
 *   - дубликаты id примитивов внутри области видимости одного компонента.
 *
 * Использование: node tools/validate.mjs <файл.yaml> [ещё файлы...]
 * Код выхода 0 — все файлы валидны.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../schema/configSchema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateSchema = ajv.compile(schema);

// ---------- Уровень 1: структурный ----------

/** Из шумных oneOf-ошибок оставляем самые глубокие — они почти всегда и есть причина. */
function pickDeepestErrors(errors, limit = 12) {
  const maxDepth = Math.max(...errors.map(e => e.instancePath.split('/').length));
  const deepest = errors.filter(e => e.instancePath.split('/').length >= maxDepth - 1);
  const seen = new Set();
  const out = [];
  for (const e of deepest) {
    const key = `${e.instancePath}|${e.message}|${JSON.stringify(e.params)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Уровень 2: семантический ----------

const CHILD_KEYS = ['content', 'trigger', 'moreContent'];
const CHILD_LIST_KEYS = ['items', 'groups'];

/** Обход дерева примитивов ВНУТРИ одной области видимости.
 *  Во вложенные определения `type: component` не спускаемся — у них своя область. */
function walkPrimitives(node, visit) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  visit(node);
  if (node.type === 'component') return; // инлайновый компонент — отдельная область
  for (const key of CHILD_KEYS) walkPrimitives(node[key], visit);
  for (const key of CHILD_LIST_KEYS) {
    for (const child of node[key] ?? []) walkPrimitives(child, visit);
  }
  if (node.areas) for (const child of Object.values(node.areas)) walkPrimitives(child, visit);
  if (node.defaultRoute) walkPrimitives(node.defaultRoute.content, visit);
  for (const route of node.routes ?? []) walkPrimitives(route.content, visit);
  for (const tab of node.tabs ?? []) {
    walkPrimitives(tab.title, visit);
    walkPrimitives(tab.content, visit);
  }
}

function checkSources(sources, scope, where, issues) {
  for (const ref of Object.keys(sources ?? {})) {
    if (!scope.has(ref)) issues.push(`${where}: неизвестный источник "${ref}"`);
  }
}

function checkActionTargets(actions, scope, where, issues) {
  const list = Array.isArray(actions) ? actions : [actions];
  list.forEach((action, j) => {
    if (action?.target && !scope.has(action.target)) {
      issues.push(`${where}[${j}]: неизвестный target "${action.target}"`);
    }
  });
}

/** Область видимости компонента и семантические проверки внутри неё. */
function checkComponent(component, path, issues) {
  // Проход 1: собрать область видимости.
  const scope = new Set(['COMPONENT']);
  const duplicates = new Set();
  walkPrimitives(component.root, node => {
    if (typeof node.id === 'string') {
      if (scope.has(node.id)) duplicates.add(node.id);
      scope.add(node.id);
    }
  });
  for (const key of Object.keys(component.models ?? {})) scope.add(key);
  for (const key of Object.keys(component.dataSources ?? {})) scope.add(key);
  for (const service of component.services ?? []) scope.add(service.id ?? service.type);

  for (const id of duplicates) {
    issues.push(`${path}: дубликат id примитива "${id}" в одной области видимости`);
  }

  // Проход 2: проверить ссылки — глобальные биндинги и localBindings примитивов.
  (component.bindings ?? []).forEach((binding, i) => {
    checkSources(binding.triggers, scope, `${path}.bindings[${i}].triggers`, issues);
    checkSources(binding.context, scope, `${path}.bindings[${i}].context`, issues);
    checkActionTargets(binding.actions ?? [], scope, `${path}.bindings[${i}].actions`, issues);
  });

  walkPrimitives(component.root, node => {
    const local = node.localBindings;
    if (!local) return;
    const label = `${path}.<${node.type}${node.id ? '#' + node.id : ''}>.localBindings`;
    for (const [name, b] of Object.entries(local.inputs ?? {})) {
      checkSources(b.triggers, scope, `${label}.inputs.${name}.triggers`, issues);
      checkSources(b.context, scope, `${label}.inputs.${name}.context`, issues);
    }
    for (const [name, b] of Object.entries(local.outputs ?? {})) {
      // Неявный триггер — сам примитив (selfId), проверять нечего.
      checkSources(b.context, scope, `${label}.outputs.${name}.context`, issues);
      checkActionTargets(b.actions ?? [], scope, `${label}.outputs.${name}.actions`, issues);
    }
    for (const [name, b] of Object.entries(local.actions ?? {})) {
      checkSources(b.triggers, scope, `${label}.actions.${name}.triggers`, issues);
      checkSources(b.context, scope, `${label}.actions.${name}.context`, issues);
    }
  });

  for (const [name, child] of Object.entries(component.components ?? {})) {
    checkComponent(child, `${path}.components.${name}`, issues);
  }
}

function semanticCheck(config) {
  const issues = [];
  if (config?.type === 'component') checkComponent(config, '$', issues);
  return issues;
}

// ---------- API для переиспользования (agent.mjs) ----------

export function validateConfigText(yamlText) {
  let config;
  try {
    config = yaml.load(yamlText);
  } catch (e) {
    return { ok: false, errors: [`YAML: ${e.message}`] };
  }
  const structureOk = validateSchema(config);
  const errors = [];
  if (!structureOk) {
    for (const e of pickDeepestErrors(validateSchema.errors)) {
      errors.push(`[schema] ${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
    }
  }
  for (const issue of semanticCheck(config)) errors.push(`[semantic] ${issue}`);
  return { ok: errors.length === 0, errors };
}

// ---------- CLI ----------

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Использование: node tools/validate.mjs <файл.yaml> [...]');
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    const { ok, errors } = validateConfigText(readFileSync(file, 'utf8'));
    if (ok) {
      console.log(`✓ ${file}`);
    } else {
      failed++;
      console.log(`✗ ${file}`);
      for (const e of errors) console.log(`    ${e}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}
