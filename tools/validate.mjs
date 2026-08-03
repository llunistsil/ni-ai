#!/usr/bin/env node
/**
 * Валидатор конфигов Нитро3.
 *
 * Уровень 1 — структурный: пер-узловая валидация по ветке типа
 * (несуществующий тип называется по имени со списком допустимых; никакого
 * oneOf-шума), ajv по полной схеме — как страховка на непокрытые места.
 * Уровень 2 — семантический: ссылки и дубликаты id; реестры событий и экшенов;
 * поток данных выражений (JSONata парсится, функции существуют, источники
 * объявлены в triggers/context, NitroPayload-интерполяция "{root....}").
 * Предупреждения (не валят): .length вместо $count, известные баги канона.
 *
 * Использование: node tools/validate.mjs <файл.yaml> [...]  (0 — все валидны)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import jsonata from 'jsonata';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, '../schema/configSchema.json'), 'utf8'));

const ajvFull = new Ajv2020({ strict: false, allErrors: true });
const validateFull = ajvFull.compile(schema);

// ---------- Пер-узловые валидаторы по веткам типов ----------
// Дети-примитивы, вложенные компоненты и трансформеры застаблены:
// их проверяет собственный визит обхода — поэтому ошибки узла точечные.
const ajvNode = new Ajv2020({ strict: false, allErrors: true });
const stubDefs = structuredClone(schema.definitions);
stubDefs.primitive = { type: 'object' };
stubDefs.component = { type: 'object' };
stubDefs.payloadTransformer = { type: 'object' };
stubDefs.service = { type: 'object' };

const primitiveDefNames = (schema.definitions.primitive.oneOf ?? [])
  .map(v => v?.$ref?.split('/').pop())
  .filter(Boolean);
const primitiveValidators = new Map();
for (const name of primitiveDefNames) {
  if (name === 'component') continue;
  const def = schema.definitions[name];
  const c = def?.properties?.type?.const;
  if (c) primitiveValidators.set(c, ajvNode.compile({ definitions: stubDefs, ...structuredClone(def) }));
}
const ALLOWED_PRIMITIVES = [...primitiveValidators.keys(), 'component'].sort().join(', ');

const serviceValidators = new Map();
for (const variant of schema.definitions.service.oneOf ?? []) {
  const c = variant?.properties?.type?.const;
  if (c) serviceValidators.set(c, ajvNode.compile(structuredClone(variant)));
}
serviceValidators.set('microfrontend', primitiveValidators.get('microfrontend'));
const ALLOWED_SERVICES = [...serviceValidators.keys()].sort().join(', ');

const componentDef = structuredClone(schema.definitions.component);
componentDef.properties.root = { type: 'object' };
componentDef.properties.components = { type: 'object' };
componentDef.properties.services = { type: 'array' };
const componentValidator = ajvNode.compile({ definitions: stubDefs, ...componentDef });

function pushNodeErrors(validator, node, path, issues) {
  if (validator(node)) return;
  const seen = new Set();
  for (const e of validator.errors ?? []) {
    const line = `[schema] ${path}${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`;
    if (!seen.has(line)) { seen.add(line); issues.push(line); }
  }
}

// Известные латентные баги канона: даунгрейд до warning. Снять после фикса в проде.
const KNOWN_CANON_ISSUES = [
  { root: 'saveConfigDS', whereIncludes: 'prevAppVersionModel' },
];

// Реестры подтверждённых событий и экшенов (источник: канон + доки + стенд).
const EVENTS = {
  button: ['click'],
  textfield: ['text'],
  menuGroup: ['click'],
  microfrontend: ['mfOutput'],
  model: ['state'],
  dataSource: ['success', 'failure', 'inProgress'],
  timer: ['tick', 'isStarted'],
  navigation: ['urlState'],
};
const ACTIONS = {
  model: ['set'],
  dataSource: ['send'],
  timer: ['start', 'stop'],
  alerts: ['show'],
  navigation: ['navigate'],
  primitive: ['setInputs'],
};

const JSONATA_BUILTINS = new Set(['abs','append','assert','average','base64decode','base64encode','boolean','ceil','contains','count','decodeUrl','decodeUrlComponent','distinct','each','encodeUrl','encodeUrlComponent','error','eval','exists','filter','floor','formatBase','formatInteger','formatNumber','fromMillis','join','keys','length','lookup','lowercase','map','match','max','merge','millis','min','not','now','number','pad','parseInteger','power','random','reduce','replace','reverse','round','shuffle','sift','single','sort','split','spread','sqrt','string','substring','substringAfter','substringBefore','sum','toMillis','trim','type','uppercase','zip']);
const FN_HINTS = {
  if: 'в JSONata нет $if — условие пишется тернарником: cond ? a : b',
  ifelse: 'в JSONata нет $ifelse — условие пишется тернарником: cond ? a : b',
  remove: 'в JSONata нет $remove — исключай элементы фильтром: [arr[$ != значение]]',
  concat: 'конкатенация строк в JSONata — оператор &',
};

// ---------- Обход дерева с путями ----------

function walkPrimitives(node, path, visit) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  visit(node, path);
  if (node.type === 'component') return; // отдельная область — обработает checkComponent
  for (const key of ['content', 'trigger', 'moreContent']) walkPrimitives(node[key], `${path}.${key}`, visit);
  (node.items ?? []).forEach((c, i) => walkPrimitives(c, `${path}.items[${i}]`, visit));
  (node.groups ?? []).forEach((c, i) => walkPrimitives(c, `${path}.groups[${i}]`, visit));
  for (const [k, c] of Object.entries(node.areas ?? {})) walkPrimitives(c, `${path}.areas.${k}`, visit);
  if (node.defaultRoute) walkPrimitives(node.defaultRoute.content, `${path}.defaultRoute.content`, visit);
  (node.routes ?? []).forEach((r, i) => walkPrimitives(r?.content, `${path}.routes[${i}].content`, visit));
  (node.tabs ?? []).forEach((t, i) => {
    walkPrimitives(t?.title, `${path}.tabs[${i}].title`, visit);
    walkPrimitives(t?.content, `${path}.tabs[${i}].content`, visit);
  });
}

// ---------- Выражения ----------

function walkAst(node, cb) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkAst(n, cb); return; }
  cb(node);
  for (const v of Object.values(node)) walkAst(v, cb);
}

function analyzeJsonata(expression, where, issues, warnings) {
  let ast;
  try { ast = jsonata(expression).ast(); }
  catch (e) {
    issues.push(`${where}: JSONata не парсится — ${e.message ?? e.code ?? String(e)}`);
    return new Set();
  }
  const roots = new Set();
  const defined = new Set();
  let lengthWarned = false;
  walkAst(ast, n => {
    if (n?.type === 'bind' && n.lhs?.type === 'variable') defined.add(n.lhs.value);
    if (n?.type === 'lambda') for (const a of n.arguments ?? []) if (a?.type === 'variable') defined.add(a.value);
  });
  walkAst(ast, n => {
    if (n?.type === 'path' && Array.isArray(n.steps) && n.steps.length) {
      const s0 = n.steps[0];
      if (s0.type === 'name') roots.add(s0.value);
      else if (s0.type === 'variable' && s0.value === '$' && n.steps[1]?.type === 'name') roots.add(n.steps[1].value);
      if (!lengthWarned && n.steps.some(s => s?.type === 'name' && s.value === 'length')) {
        lengthWarned = true;
        warnings.push(`[lint] ${where}: путь ".length" — в JSONata длина массива это $count(x)`);
      }
    }
    if ((n?.type === 'function' || n?.type === 'partial') && n.procedure?.type === 'variable') {
      const name = n.procedure.value;
      if (name && !JSONATA_BUILTINS.has(name) && !defined.has(name)) {
        const hint = FN_HINTS[name] ? ` (${FN_HINTS[name]})` : '';
        issues.push(`${where}: неизвестная функция JSONata "$${name}"${hint}`);
      }
    }
  });
  return roots;
}

function nitroPayloadRoots(value, roots = new Set()) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\./g)) roots.add(m[1]);
  } else if (Array.isArray(value)) for (const v of value) nitroPayloadRoots(v, roots);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) nitroPayloadRoots(v, roots);
  return roots;
}

function checkTransformerData(tr, allowed, scope, where, issues, warnings) {
  if (!tr || typeof tr !== 'object') return;
  if (tr.type !== 'JSONata' && tr.type !== 'NitroPayload') {
    issues.push(`${where}: неизвестный тип трансформера "${tr.type}"; допустимые: NitroPayload, JSONata`);
    return;
  }
  let roots = new Set();
  if (tr.type === 'JSONata' && typeof tr.expression === 'string') roots = analyzeJsonata(tr.expression, where, issues, warnings);
  else if (tr.type === 'NitroPayload') roots = nitroPayloadRoots(tr.value);
  for (const root of roots) {
    if (allowed.has(root)) continue;
    if (!scope.has(root)) continue;
    const msg = `${where}: источник "${root}" используется в выражении, но не объявлен в triggers/context`;
    if (KNOWN_CANON_ISSUES.some(k => k.root === root && where.includes(k.whereIncludes))) warnings.push(`[known] ${msg}`);
    else issues.push(msg);
  }
}

// ---------- Семантика компонента ----------

function eventsFor(entry) {
  if (!entry) return null;
  if (entry.kind === 'model') return EVENTS.model;
  if (entry.kind === 'dataSource') return EVENTS.dataSource;
  if (entry.kind === 'service') return EVENTS[entry.type] ?? null;
  if (entry.kind === 'primitive') return EVENTS[entry.type] ?? null;
  if (entry.kind === 'self') return entry.events;
  return null;
}

function actionsFor(entry) {
  if (!entry) return null;
  if (entry.kind === 'model') return ACTIONS.model;
  if (entry.kind === 'dataSource') return ACTIONS.dataSource;
  if (entry.kind === 'service') return ACTIONS[entry.type] ?? null;
  if (entry.kind === 'primitive') return ACTIONS.primitive;
  return null;
}

function checkSources(sources, scope, where, issues) {
  for (const [ref, events] of Object.entries(sources ?? {})) {
    const entry = scope.get(ref);
    if (!entry) { issues.push(`${where}: неизвестный источник "${ref}"`); continue; }
    const known = eventsFor(entry);
    if (!known) continue;
    for (const ev of Array.isArray(events) ? events : [events]) {
      if (!known.includes(ev)) {
        issues.push(`${where}: события "${ev}" нет у ${entry.label} "${ref}"; известные: ${known.join(', ') || '—'}`);
      }
    }
  }
}

function actionList(actions) { return Array.isArray(actions) ? actions : [actions]; }

function checkActions(actions, allowed, scope, where, issues, warnings) {
  actionList(actions ?? []).forEach((action, j) => {
    const aPath = `${where}[${j}:${action?.target ?? '?'}]`;
    const entry = action?.target ? scope.get(action.target) : null;
    if (action?.target && !entry) issues.push(`${aPath}: неизвестный target "${action.target}"`);
    if (entry && action?.action) {
      const known = actionsFor(entry);
      if (known && !known.includes(action.action)) {
        issues.push(`${aPath}: экшена "${action.action}" нет у ${entry.label} "${action.target}"; известные: ${known.join(', ')}`);
      }
    }
    checkTransformerData(action?.condition, allowed, scope, `${aPath}.condition`, issues, warnings);
    checkTransformerData(action?.payload, allowed, scope, `${aPath}.payload`, issues, warnings);
  });
}

function checkComponent(component, path, issues, warnings) {
  // Структурная проверка самого узла-компонента (root/components/services — отдельно).
  pushNodeErrors(componentValidator, component, path, issues);

  const scope = new Map();
  scope.set('COMPONENT', { kind: 'self', label: 'компонента', events: Object.keys(component.properties ?? {}) });
  const duplicates = new Set();

  // Один обход: структурная валидация каждого примитива + сбор области видимости.
  walkPrimitives(component.root, `${path}.root`, (node, p) => {
    const t = node.type;
    if (!t) issues.push(`[schema] ${p}: у примитива нет type; допустимые типы: ${ALLOWED_PRIMITIVES}`);
    else if (t === 'component') { checkComponent(node, p, issues, warnings); return; }
    else if (!primitiveValidators.has(t)) issues.push(`[schema] ${p}: неизвестный тип примитива "${t}"; допустимые: ${ALLOWED_PRIMITIVES}`);
    else pushNodeErrors(primitiveValidators.get(t), node, p, issues);
    if (typeof node.id === 'string') {
      if (scope.has(node.id)) duplicates.add(node.id);
      scope.set(node.id, { kind: 'primitive', type: node.type, label: node.type ?? 'примитива' });
    }
  });

  for (const key of Object.keys(component.models ?? {})) scope.set(key, { kind: 'model', label: 'модели' });
  for (const key of Object.keys(component.dataSources ?? {})) scope.set(key, { kind: 'dataSource', label: 'dataSource' });
  (component.services ?? []).forEach((s, i) => {
    const sPath = `${path}.services[${i}]`;
    if (!s?.type) { issues.push(`[schema] ${sPath}: у сервиса нет type; допустимые: ${ALLOWED_SERVICES}`); return; }
    const v = serviceValidators.get(s.type);
    if (!v) { issues.push(`[schema] ${sPath}: неизвестный тип сервиса "${s.type}"; допустимые: ${ALLOWED_SERVICES}`); return; }
    pushNodeErrors(v, s, sPath, issues);
    scope.set(s.id ?? s.type, { kind: 'service', type: s.type, label: `сервиса ${s.type}` });
  });
  for (const id of duplicates) issues.push(`${path}: дубликат id примитива "${id}" в одной области видимости`);

  (component.bindings ?? []).forEach((binding, i) => {
    const bPath = `${path}.bindings[${i}]`;
    checkSources(binding.triggers, scope, `${bPath}.triggers`, issues);
    checkSources(binding.context, scope, `${bPath}.context`, issues);
    const allowed = new Set([...Object.keys(binding.triggers ?? {}), ...Object.keys(binding.context ?? {})]);
    checkTransformerData(binding.condition, allowed, scope, `${bPath}.condition`, issues, warnings);
    checkActions(binding.actions, allowed, scope, `${bPath}.actions`, issues, warnings);
  });

  walkPrimitives(component.root, `${path}.root`, (node, p) => {
    const local = node.localBindings;
    if (!local) return;
    const label = `${p}<${node.type}${node.id ? '#' + node.id : ''}>.localBindings`;
    for (const [name, b] of Object.entries(local.inputs ?? {})) {
      const w = `${label}.inputs.${name}`;
      checkSources(b.triggers, scope, `${w}.triggers`, issues);
      checkSources(b.context, scope, `${w}.context`, issues);
      const allowed = new Set([...Object.keys(b.triggers ?? {}), ...Object.keys(b.context ?? {})]);
      checkTransformerData(b.condition, allowed, scope, `${w}.condition`, issues, warnings);
      checkTransformerData(b.value, allowed, scope, `${w}.value`, issues, warnings);
    }
    for (const [name, b] of Object.entries(local.outputs ?? {})) {
      const w = `${label}.outputs.${name}`;
      checkSources(b.context, scope, `${w}.context`, issues);
      const allowed = new Set(Object.keys(b.context ?? {}));
      checkTransformerData(b.condition, allowed, scope, `${w}.condition`, issues, warnings);
      checkActions(b.actions, allowed, scope, `${w}.actions`, issues, warnings);
    }
    for (const [name, b] of Object.entries(local.actions ?? {})) {
      const w = `${label}.actions.${name}`;
      checkSources(b.triggers, scope, `${w}.triggers`, issues);
      checkSources(b.context, scope, `${w}.context`, issues);
      const allowed = new Set([...Object.keys(b.triggers ?? {}), ...Object.keys(b.context ?? {})]);
      checkTransformerData(b.condition, allowed, scope, `${w}.condition`, issues, warnings);
      checkTransformerData(b.payload, allowed, scope, `${w}.payload`, issues, warnings);
    }
  });

  for (const [name, child] of Object.entries(component.components ?? {})) {
    checkComponent(child, `${path}.components.${name}`, issues, warnings);
  }
}

// ---------- API ----------

function pickDeepestErrors(errors, limit = 12) {
  const maxDepth = Math.max(...errors.map(e => e.instancePath.split('/').length));
  const deepest = errors.filter(e => e.instancePath.split('/').length >= maxDepth - 1);
  const seen = new Set(); const out = [];
  for (const e of deepest) {
    const key = `${e.instancePath}|${e.message}|${JSON.stringify(e.params)}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export function validateConfigText(yamlText) {
  let config;
  try { config = yaml.load(yamlText); }
  catch (e) { return { ok: false, errors: [`YAML: ${e.message}`], warnings: [] }; }

  const errors = [];
  const warnings = [];
  const semantic = [];

  if (config && typeof config === 'object' && config.type === 'component') {
    checkComponent(config, '$', semantic, warnings);
  } else if (config && typeof config === 'object') {
    walkPrimitives(config, '$', (node, p) => {
      const t = node.type;
      if (!t) semantic.push(`[schema] ${p}: у примитива нет type; допустимые типы: ${ALLOWED_PRIMITIVES}`);
      else if (t === 'component') checkComponent(node, p, semantic, warnings);
      else if (!primitiveValidators.has(t)) semantic.push(`[schema] ${p}: неизвестный тип примитива "${t}"; допустимые: ${ALLOWED_PRIMITIVES}`);
      else pushNodeErrors(primitiveValidators.get(t), node, p, semantic);
    });
  } else {
    return { ok: false, errors: ['конфиг пуст или не является объектом'], warnings: [] };
  }

  for (const s of semantic) errors.push(s.startsWith('[') ? s : `[semantic] ${s}`);

  // Страховка: полная схема на случай непокрытых обходом мест.
  const fullOk = validateFull(config);
  if (!fullOk && errors.length === 0) {
    for (const e of pickDeepestErrors(validateFull.errors)) {
      errors.push(`[schema] ${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------- CLI ----------

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const files = process.argv.slice(2);
  if (files.length === 0) { console.error('Использование: node tools/validate.mjs <файл.yaml> [...]'); process.exit(2); }
  let failed = 0;
  for (const file of files) {
    const { ok, errors, warnings } = validateConfigText(readFileSync(file, 'utf8'));
    console.log(`${ok ? '✓' : '✗'} ${file}`);
    for (const w of warnings) console.log(`    ${w}`);
    if (!ok) { failed++; for (const e of errors) console.log(`    ${e}`); }
  }
  process.exit(failed === 0 ? 0 : 1);
}
