# Модель конфига

То, что нужно ядру Studio, чтобы держать конфиг в памяти, индексировать ссылки и безопасно
его менять. Поля сущностей — в `schema/`, их рантайм-контракт — в `catalog.json`.

## Корень

Конфиг — это `component`:

```
type: component
id: COMPONENT          # опционально; единственное допустимое значение — литерал
root: <primitive>      # обязателен
properties: {}         # публичный контракт: name → {direction, schema}
models: {}             # name → {schema, localBindings?}
services: []           # массив; адресуются по id или по имени типа (глобальные)
dataSources: {}        # name → {type: http, ...}
components: {}         # name → <component>; дочерние
bindings: []
```

Один файл = один компонент. Дочерние компоненты — вложенные объекты того же вида в `components`.

## Сущности и их идентичность

| Сущность | Как адресуется в биндингах | Где объявлена |
|---|---|---|
| примитив | `id` (строка) | в дереве `root`, поле `id` |
| модель | имя — ключ в `models` | `models` |
| dataSource | имя — ключ в `dataSources` | `dataSources` |
| сервис глобальный (`alerts`, `browserTab`, `browserEnvironment`) | **имя типа**; `id` задавать нельзя | `services` |
| сервис обычный (`navigation`, `timer`, `sheetDialog`, `microfrontend`) | `id`; без него не адресуется | `services` |
| компонент | имя — ключ в `components`; `componentPresenter.componentId` ссылается на этот ключ | `components` |
| сам компонент изнутри | литерал `COMPONENT` | — |
| презентер | `id` презентера; триггер на него читает output-пропсы, `setInputs` ставит input-пропсы | в дереве |

Примитиву `id` нужен только если на него ссылается общий биндинг. Примитивы с
`localBindings` получают сгенерированный `@local-id` — Studio его не хранит и не показывает.

`id` компонента — не его имя. Имя компонента — ключ в `components`; `id: COMPONENT` — константа.

## Граф ссылок

Что ядро должно индексировать (для `RenameId`, dead-reference, автодополнения):

```
binding.triggers.<src>          → примитив | модель | dataSource | сервис | COMPONENT | презентер
binding.context.<src>           → те же
binding.actions[].target        → те же
localBindings.*.triggers/context → те же (внутри той же области видимости)
componentPresenter.componentId  → ключ components
componentPresenter.inputs.<k>   → properties[k] с direction input | bidirectional
target: COMPONENT + setInputs.<k> → properties[k] с direction output | bidirectional
triggers: COMPONENT: [<k>]      → properties[k] с direction input | bidirectional
tabs.activateTab.payload.tabId  → tabs[].id
```

Не разрешимо статически — ядро не проверяет, только предупреждает:

- `id`, вычисленные в шаблоне (`"id": code & "Badge"` в `itemTemplate`): литеральные
  `target` на них резолвятся по конвенции, `RenameId` каскад не делает;
- динамические outputs микрофронтенда (`<eventName>`) и его actions — известны только рантайму;
- output-пропсы дочернего компонента через презентер — проверяются по `properties` дочернего.

## Области видимости

- Биндинги видят **только сущности своего компонента**: его `root`, `models`, `services`,
  `dataSources`, презентеры в его дереве.
- Модель уровня приложения видна биндингам дочерних компонентов; модель дочернего — только ему.
- Через границу компонента — **только `properties`**. Ссылка на внутренности чужого компонента —
  ошибка конфигурации (`component/cross-boundary`).
- Сервис живёт вместе с компонентом: создаётся до дерева, уничтожается с ним. Сервис в корне —
  на всё приложение.

## Рантайм vs статика

Не всякое поле можно менять в рантайме, и не всякое рантайм-значение допустимо статически:

| Случай | Пример | Как хранить |
|---|---|---|
| поле только статическое | `microfrontend.url`, `microfrontend.initialConfig`, `router.routes` | обычное поле |
| поле статическое и рантайм | `text.text`, `panel.items`, `iframe.url` (строка) | поле + допустимый target `setInputs` |
| только рантайм, схема отвергает статически | `dropdown.open`, `iframe.url` объектом `{host,path,queryParams,hash}` | только через `setInputs`; в форме инспектора не показывать |

Полный список по сущностям — `catalog.json`, поля `static` / `runtime` / `runtimeOnly`.

## Шаблоны

`panel.itemTemplate`, `tabs.tabTemplate`, `menu.groupTemplate`, `menuGroup.itemTemplate`.
При заданном шаблоне `items` / `tabs` / `groups` — обычные данные, а не примитивы; трансформер
получает элемент (поля напрямую, весь элемент — `$`, корень входа — `$$`) и возвращает конфиг
примитива. Поведение сгенерированных элементов — только через `localBindings` внутри шаблона.

Для ядра: содержимое шаблона — строка JSONata, внутри которой лежит JSON конфига примитива.
Studio редактирует её как выражение (`SetExpression`), а не как дерево; `id` внутри шаблона
считаются вычисляемыми.

## Что Studio не редактирует, но обязана сохранить

- `serverSide`-инструкции (`extract`, `protect`, `evaluate`) — выполняются Nitro API до доставки
  конфига на клиент; в схеме и клиентском рантайме их нет.
- `comment` на биндингах и actions — единственный способ задокументировать логику, который
  переживает JSON (YAML-комментарии теряются при конвертации).
- Любой ключ, не описанный в схеме, — как есть.

Правка через JSON Patch: пути внутрь неизвестных ключей запрещены.

## Нормализация при импорте

Старые формы, которые Studio приводит к канонической и больше не показывает:

| Было | Стало |
|---|---|
| `engine: JSONAta` / `engine: JsonPath` | `type: JSONata` (JsonPath — не поддерживается, ошибка импорта) |
| `iframe.src` | `iframe.url` |
| `value` вместо `payload` в localBindings (webviewbus) | `payload` |

Канонический вывод `toJson`: два пробела, порядок ключей из исходника, новые ключи — в порядке
схемы; round-trip фикстур байт-в-байт.
