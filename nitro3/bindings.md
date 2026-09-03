# Биндинги и трансформеры

## Форма

```
bindings:
  - triggers:  {srcId: output | [output, ...]}   # изменение запускает биндинг
    context:   {srcId: output | [output, ...]}   # доступно, не запускает; последнее значение
    condition: <transformer>                      # гейт всего биндинга; truthy/falsy по JS
    actions:   <action> | [<action>, ...]
```

```
action:
  target: <id | имя типа глобального сервиса | COMPONENT>
  action: <имя action из catalog.json>
  condition: <transformer>       # гейт только этого action; falsy — skip, остальные идут
  payload: <transformer>         # ОБЯЗАТЕЛЕН всегда, даже если семантически пуст
```

`payload` для безпараметрных actions (`timer.start`, `sheetDialog.show`):
`{type: NitroPayload, value: null}`. Без payload рантайм падает.

## Семантика — что должен учитывать резолвер

1. Биндинг стартует, только когда **каждый output каждого триггера дал значение хотя бы раз**;
   дальше перезапускается при изменении любого. Биндинг на `{clickButton: click, model: state}`
   не сработает от `state` при старте — `click` ещё не было.
2. Из `triggers` + `context` собирается объект `{srcId: {output: value}}` — он и поступает в
   трансформеры. Имена в выражении = `srcId.output.<путь>`.
3. Actions выполняются строго последовательно; асинхронный action блокирует следующие.
4. Новое срабатывание **отменяет** выполняющуюся последовательность (switchMap).
5. Отсутствует любая задействованная сущность (trigger / context / target) — биндинг **молча не
   выполняется целиком**. Опечатка в `id` не даёт ошибки. Это правило высшего приоритета в
   `diagnose`.
6. Один и тот же источник может быть и триггером, и читаться в том же биндинге — берётся
   последнее значение.

## Трансформеры

**NitroPayload** — константы и прямые подстановки:

```
payload:
  type: NitroPayload
  value:
    myBool: true
    myValue: '{someTrigger.someOutput}'     # строка целиком в {…} — ссылка на данные
    literal: '{{not a ref}}'                # литеральные скобки — {{…}}
```

Несуществующий путь → `undefined`. Studio может статически проверить, что `someTrigger`
есть среди `triggers`/`context`.

**JSONata** — любые вычисления:

```
payload:
  type: JSONata
  expression: '{"text": model.state.firstName & " " & model.state.lastName}'
```

Обе формы — единственные допустимые. `engine:` — старая форма, нормализуется при импорте.

## localBindings

Потоки данных сущности прямо в её конфиге; `id` не нужен. Обязательны для примитивов,
создаваемых шаблонами.

```
localBindings:
  inputs:
    <inputName>:
      triggers: {...}
      value: <transformer>       # возвращает САМО значение; обёртку {inputName: …} делает платформа
  outputs:
    <eventName>:
      actions: <action> | [...]  # данные события — по имени события на верхнем уровне: click.meta
  actions:
    <actionName>:
      triggers: {...}
      payload: <transformer>     # автовызов собственного action по внешним триггерам
```

**Дефект платформы:** `outputs.*` и `actions.*` с `context` и/или `condition` молча не работают
(выражение считается по неполному DTO). Такую логику — в общий биндинг. `inputs.*` с
`context`/`condition` — не проверено, считать ненадёжным.

Выбор: локальный — логика одной сущности, динамическое создание, `id` ради биндинга не нужен;
общий — несколько сущностей, порядок actions по нескольким target, нужен `context`.

## Что `SetExpression` принимает

Ядро компилирует JSONata библиотекой `jsonata` — это ловит синтаксис, не семантику.
Дополнительно:

Подтверждено рантаймом (встречается в примерах и боевом конфиге):
`$merge`, `$append`, `$sift`, `$count`, `$keys`, `$string`, `$boolean`, `$not`, `$map`, `$each`,
`$lookup`, `$join`, `$replace`, `$lowercase`, `$uppercase`, `$substring`, `$floor`; операторы
`&`, `? :`, `?:`, `=`, `!=`, `>`, `<`, `and`, `or`; путь `a.b[0]`; map по массиву `arr.{...}`;
обёртка `[ ]`; функции `function($v) { ... }`.

Предупреждение (`jsonata/suspicious-operator`): `~>` (chain), `|...|` (transform) — молча
падают в рантайме. Всё, чего нет в списке выше, — `unverified`, Studio пропускает, но помечает.

## Идиомы

| Задача | Выражение |
|---|---|
| Частичное обновление модели (`set` — полная замена) | `$merge([m.state, {"field": v}])`, модель в `context` |
| Инверсия булева поля | `$merge([m.state, {"f": $not(m.state.f)}])` |
| Добавить в массив | `{"items": $append(m.state.items, [newItem])}` |
| Список → примитивы | `{"items": [m.state.items.{"type": "componentPresenter", "componentId": "card", "inputs": {"x": $}}]}` |
| Одноэлементный массив | `[expr]` — JSONata схлопывает массив из одного элемента, `[ ]` обязательна |
| Счётчик truthy-полей | `$count($keys($sift(m.state, function($v) { $v })))` |
| Видимость по условию | `{"visible": m.state.count >= 5}` |
| Ветвление по HTTP-статусу | два action с разными `condition`, один биндинг |
| Закрыть dropdown после выбора | `setInputs` `{open: false}` |
| Выбор в меню | `meta` на элементах, триггер `<groupId>: click`, чтение `<groupId>.click.meta` |
| Параметр маршрута `items/:id` | `nav.urlState.pathSegments[1]` — отдельного механизма нет |
| Отсечь лишние сеты | `condition` вида `(m.state.x ?: false) != newValue` |

## Компоненты

Единственный канал через границу — `properties`:

| Направление | Снаружи | Изнутри |
|---|---|---|
| `input` | `componentPresenter.inputs` статически; `setInputs` по `id` презентера | триггер / context `COMPONENT: [prop]` |
| `output` | триггер на `id` презентера: `presenterId: [prop]` | `target: COMPONENT, action: setInputs, payload: {prop: value}` |
| `bidirectional` | оба | оба |

Пропс без значения (снаружи не задан, изнутри не опубликован, `schema.default` нет) — не даёт
значение, зависящие биндинги не стартуют (см. семантику п. 1).

Отдельных actions у компонента нет: публичная команда = input, на который внутри реагирует
биндинг триггером `COMPONENT: [prop]`.
