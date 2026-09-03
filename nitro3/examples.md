# Примеры

19 эталонных конфигов, все валидны против schema v2. Три роли в Studio:

1. **фикстуры round-trip** — конвертируются в JSON при сборке `libs/nitro3-contract`; `toJson(load(x)) === x` байт-в-байт;
2. **референс для агента** — при генерации конфига агент берёт ближайший по механизму пример, а не сочиняет;
3. **тест-кейсы редактора** — каждый механизм из таблицы должен открываться, редактироваться и сохраняться без потерь.

Комментарий в шапке каждого файла — источник истины о рантайме: он писался по результатам
стенда и имеет приоритет над доками.

| # | Файл | Что показывает | Механизмы |
|---|---|---|---|
| 01 | `01-layout-basics` | раскладка без логики | panel (flex/grid через style), container, text, icon, badge, avatar, image; переменные Taiga `var(--tui-*)` |
| 02 | `02-model-counter` | модель как состояние | models (schema + default), triggers/context/actions, `set` = полная замена, setInputs, JSONata и NitroPayload, visible через setInputs |
| 03 | `03-form-textfields` | форма и условия | событие `text`, производное значение, condition уровня биндинга, disabled-логика, несколько источников в context, alerts |
| 04 | `04-datasource-http` | жизненный цикл HTTP | dataSources http, `send` с payload, `success`/`failure`/`inProgress`, loader.show, ветвление по статусу через condition на action |
| 05 | `05-dynamic-list` | список из состояния | JSONata-map в componentPresenter'ы, дочерний компонент с input-пропом, триггер `COMPONENT`, `$append`, обёртка `[ ]` |
| 06 | `06-component-props` | переиспользуемый компонент | properties input, статические `presenter.inputs`, `setInputs` по id презентера, триггер `COMPONENT` внутри |
| 07 | `07-router-navigation` | маршрутизация | router (defaultRoute + routes), link `mode: navigate`, navigation (`navigate` с commands, `urlState`), browserTab |
| 08 | `08-dropdown-menu` | выпадающее меню | dropdown (trigger + content), menu/menuGroup, meta + `<groupId>.click.meta`, закрытие `setInputs {open: false}` |
| 09 | `09-tabs` | вкладки | tabs, activeTabIndex, meta на вкладке, title как произвольный примитив |
| 10 | `10-microfrontend` | МФ как примитив | microfrontend (url + initialConfig), `setInputs {mfInput}`, триггер `mfOutput` |
| 11 | `11-local-bindings` | локальные биндинги | `localBindings.inputs` (value — само значение), `localBindings.outputs`, `@local-id`; инкремент оставлен глобальным из-за дефекта §1 |
| 12 | `12-timer` | сервис timer | mode manual, interval ≥ 1000, start/stop с `value: null`, `tick.timePassed`, `isStarted`, `localBindings.inputs` на события сервиса |
| 13 | `13-toggle-buttons` | переключатели кнопками | булевы поля модели + appearance как производная, `$merge` + `$not`, `$sift` + `$count` |
| 14 | `14-item-template` | UI из данных | `panel.itemTemplate`, `localBindings.outputs` в шаблоне, вычисляемый id + литеральный target, обёртка `[ ]`, обновление `badge.content` |
| 15 | `15-component-output` | канал дочерний → родитель | properties output, публикация `target: COMPONENT` + setInputs, триггер на id презентера, чтение input через context |
| 16 | `16-sheet-dialog` | нижняя шторка | sheetDialog с id, show/hide с обязательным payload, `isOpen` как триггер, dataSource `mode: onLoad` |
| 17 | `17-router-advanced` | продвинутая маршрутизация | динамический сегмент через `urlState.pathSegments`, вложенный router, `link.isActive`, `isActiveMatchOptions: {paths: subset}` |
| 18 | `18-iframe` | iframe и две формы url | url строкой статически, url объектом `{host, path, queryParams}` через setInputs, meta на кнопках, `allow` |
| 19 | `19-adaptive` | адаптивная раскладка | browserEnvironment.deviceType, layoutModel как единая точка правды с condition против лишних сетов, переключение style целиком |

## Что примерами не покрыто

Нужны фикстуры, но их пока нет — кандидаты на первые добавления в контракт:

- негативные кейсы под каждое правило из `rules.md` (`dead-reference`, `missing-payload`, `set-partial`, `cross-boundary`, …) — по одному минимальному конфигу на правило с `*.expected.json`;
- `localBindings.actions` (автовызов собственного action) — в примерах отсутствует намеренно, поведение не проверено на стенде;
- `tabs.tabTemplate`, `menu.groupTemplate`, `menuGroup.itemTemplate` — есть только `panel.itemTemplate`;
- `bidirectional` пропс компонента;
- микрофронтенд как сервис (без UI);
- `serverSide`-инструкции — как pass-through: конфиг с `extract`/`protect`/`evaluate` должен пережить round-trip без изменений.
