# Правила диагностики

Спецификация для `diagnose` в ядре и для фикстур `*.expected.json` в контракте. Каждое правило:
что проверяет, что говорит пользователю (текст — инструкция по исправлению, не констатация),
чинится ли автоматически, откуда взято.

Формат диагностики: `{rule, severity, path (JSON Pointer), message, fix?}`.

Валидация по `schema/nitro3-schema.json` идёт первой и отдельно; правила ниже — то, чего схема
не выражает, плюс переформулировка её самых частых отказов в понятный текст.

## error — конфиг не будет работать

| id | Условие | Сообщение | Автофикс | Источник |
|---|---|---|---|---|
| `binding/dead-reference` | источник в `triggers`/`context` или `target` не найден в области видимости компонента (примитивы по `id`, модели, dataSources, сервисы по `id` или имени типа, `COMPONENT`, презентеры) | «`{id}` не существует в этом компоненте. Биндинг не выполнится целиком и без ошибок. Исправьте `id` или добавьте сущность.» Если в компоненте есть шаблоны (`itemTemplate` и др.) — понижается до warning с добавкой «возможно, `id` вычисляется шаблоном». | нет | gotchas §4 |
| `action/missing-payload` | у action нет `payload` | «У каждого action обязателен `payload`, даже пустой: рантайм падает без него.» | добавить `{type: NitroPayload, value: null}` | gotchas §2 |
| `timer/interval-min` | `timer.interval < 1000` | «Минимальный `interval` — 1000 мс, меньше сервис бросает исключение в конструкторе.» | нет | gotchas §3 |
| `local-bindings/context-in-outputs` | `localBindings.outputs.*` или `localBindings.actions.*` содержит `context` или `condition` | «`context`/`condition` в локальных outputs и actions молча не работают. Перенесите эту логику в общий биндинг с `triggers: {<id>: <event>}`.» | нет | gotchas §1 |
| `service/global-with-id` | у `alerts`, `browserTab`, `browserEnvironment` задан `id` | «Глобальный сервис не имеет `id`; адресуйте его именем типа: `target: {type}`.» | удалить `id`, переписать target | доки «Сервисы» |
| `service/missing-id` | `navigation`, `timer`, `sheetDialog`, `microfrontend` без `id`, на сервис есть ссылка по имени типа | «Сервис `{type}` не глобальный: задайте `id` и ссылайтесь на него.» Без ссылок — warning. | нет | gotchas «Сервисы» |
| `jsonata/compile` | выражение не компилируется | «JSONata: {ошибка компилятора}. Выражение не выполнится.» | нет | — |
| `component/unknown-component` | `componentPresenter.componentId` не является ключом `components` в текущем или родительском компоненте | «Компонент `{componentId}` не объявлен. Имя компонента — ключ в `components`, не поле `id`.» | нет | gotchas «Компоненты» |
| `component/unknown-property` | `componentPresenter.inputs.{k}` или статический `setInputs` на `COMPONENT`/презентер с ключом `k` вне `properties` (или с неподходящим `direction`) | «У компонента нет свойства `{k}` с направлением `{нужное}`. Объявите его в `properties` или уберите.» JSONata-payload не проверяется. | нет | доки «Component» |
| `component/cross-boundary` | `id` не найден в области видимости, но найден в другом компоненте дерева | «`{id}` принадлежит компоненту `{name}`. Через границу компонента данные ходят только через `properties`: объявите input/output.» | нет | gotchas «Компоненты» |
| `schema/unknown-entity` | `type` не из схемы | «`{type}` недоступен в воркспейсе.» + подсказка: `table`/`drawer`/`skeleton` → panel + cell / sheetDialog; `cardLarge` → container + title/text; `localStorage` → недоступен. | нет | gotchas таблица |
| `dropdown/static-open` | `dropdown.open` задан статически | «`open` — только рантайм-инпут: схема отвергает его статически. Управляйте через `setInputs {open: …}`.» | удалить поле | gotchas таблица |
| `iframe/src` | у iframe поле `src` | «У iframe нет `src`, поле называется `url`.» | переименовать | gotchas «Закрыто правками» |
| `text/appearance`, `panel/appearance` | у `text`/`panel` задан `appearance` | «Поле есть в доках, но отсутствует в схеме и рантайме. Приглушённый текст — `style.color: var(--tui-text-secondary)`.» | нет | gotchas таблица |

## warning — работает, но, скорее всего, не так, как задумано

| id | Условие | Сообщение | Автофикс | Источник |
|---|---|---|---|---|
| `model/set-partial` | `set` на модель с `NitroPayload`-объектом, в котором нет части полей верхнего уровня из `schema.properties` | «`set` — полная замена состояния: поля {…} обнулятся. Для частичного обновления — `$merge([{model}.state, {...}])` с моделью в `context`.» | нет | gotchas «Семантика состояния» |
| `template/computed-id` | внутри выражения шаблона встречается `"id":` с вычисляемым значением | «`id` вычисляется шаблоном; литеральные `target` на него резолвятся только по конвенции, переименование не каскадируется.» | нет | пример 14 |
| `serverside/protect-referenced` | у сущности есть `serverSide` с `instruction: protect`, и на её `id` ссылается биндинг | «Если `protect` вырежет элемент, все биндинги на `{id}` умрут молча для этого пользователя. Скрывайте в рантайме: `visible` от флага, вычисленного `evaluate`.» | нет | gotchas §4 + serverSide |
| `binding/multi-trigger-startup` | ≥ 2 источников в `triggers`, среди них событие (click, success, tick) и состояние (state, urlState, deviceType) | «Биндинг ждёт все триггеры: от `{state}` при старте не сработает, пока не случится `{event}`. Если нужна реакция на состояние — состояние в `context`, событие в `triggers`, или наоборот.» | нет | gotchas §5 |
| `grid/deprecated` | используется `grid` | «`grid` устарел; новый layout — `panel` с `display: grid` в `style`. В легаси допустим.» | нет | доки «grid» |
| `jsonata/suspicious-operator` | в выражении `~>` или `\|...\|` | «Оператор молча падает в рантайме Nitro3. Используйте `$merge`/`$map`/`$each`/`$sift`/`$lookup`.» | нет | боевой опыт |
| `jsonata/unverified-function` | функция вне подтверждённого списка (`bindings.md`) | «`{fn}` не проверена на рантайме Nitro3. Проверьте на стенде.» | нет | — |
| `payload/unknown-ref` | в `NitroPayload` строка `{a.b}`, где `a` не среди `triggers`/`context` | «`{a}` не входит в triggers/context биндинга: подстановка даст `undefined`.» | нет | доки «Transformers» |
| `local-bindings/unverified-input-context` | `localBindings.inputs.*` с `context`/`condition` | «Не проверено на рантайме; при ошибке — вынести в общий биндинг.» | нет | gotchas §1 |
| `link/activate-without-navigate` | action `activate` на link без `mode: navigate` | «`activate` работает только при `mode: navigate`.» | нет | доки «link» |
| `tabs/unknown-tab-id` | `activateTab` со статическим `tabId` вне `tabs[].id` | «Вкладки `{tabId}` нет; без `fallbackTabIndex` action ничего не сделает.» | нет | доки «tabs» |

## info — нормализация при импорте и подсказки

| id | Условие | Действие |
|---|---|---|
| `import/transformer-engine` | `engine: JSONAta` | переписать в `type: JSONata`; `engine: JsonPath` → error, не поддерживается |
| `import/local-binding-value` | `value` вместо `payload` в `localBindings.outputs/actions` | переписать в `payload` |
| `import/unknown-key` | ключ вне схемы (`serverSide`, `comment`, прочее) | сохранить как есть, показать в инспекторе как «нередактируемое», запретить JSON Patch внутрь |
| `id/unused` | у примитива есть `id`, на который никто не ссылается | подсказка «id не используется» — только по запросу, не в потоке диагностики |

## Как правило попадает в этот файл

Правило рождается из воспроизведённого на стенде поведения или из фикстуры, на которой
упал реальный конфиг. Порядок: фикстура `<name>.json` + ожидаемая диагностика в
`<name>.expected.json` → реализация в `diagnose` → строка здесь. Без фикстуры правило не
принимается: текст без воспроизводимого случая — это дока, а не правило.
