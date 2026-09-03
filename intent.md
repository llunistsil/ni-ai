# Намерение: библиотека доступа к данным и окружение Studio

Автор: llunistsil. Статус: черновик — на составление plan.md. Трекер: <ключ>.

Документ детализирован намеренно: простора для проектных решений — ноль. Задача plan.md —
порядок работ, сверка с фактическим состоянием репозитория и раздел «Отклонения». Если
реальность расходится с написанным здесь (имена файлов, флаги генератора, формат конфигов) —
не изобретать замену, а зафиксировать расхождение в «Отклонениях» и остановиться на нём.

## Контекст

Studio автономна: сама ходит в Nitro API. Контракт API не проектируется — он снят с боевого
Nitro Editor (сам является Nitro3-конфигом; снимок от 01.09.2026 приложен к эпику) и
воспроизводится один в один. Окружение приходит только через `mfInitialConfig`.

## Скоуп

Входит: библиотека `libs/data-access` (клиент API + доменные типы + разбор ошибок), схема
`mfInitialConfig` с полем `nitroApiBaseUrl`, сервис окружения в приложении, правило границ
модулей.

Не входит (отдельные задачи, здесь не делать даже частично): адаптер к порту
`ConfigsGateway` и переключение стора на HTTP (порт появляется в задаче 0 эпика панели);
create/update/delete приложений; селекторы; галерея; превью-эндпоинт; поиск; пагинация;
кэширование; retry.

## 1. Библиотека `libs/data-access`

### 1.1 Генерация

`npx nx g @nx/js:library data-access --directory=libs/data-access --tags=type:data-access
--unitTestRunner=jest --bundler=none --strict` — флаги подогнать под установленный генератор
Nx 22; обязательные свойства результата:

- `project.json` с `"tags": ["type:data-access"]`, таргеты только `lint` и `test`;
- Jest с `testEnvironment: 'node'`;
- **без `package.json`** — если генератор создал, удалить: `lerna.json` объявляет
  `packages: ["libs/**/*", ...]`, и пакет с манифестом попадёт в релизный цикл `tmf`.
  Проверка: `npx lerna list` не показывает `data-access`;
- `tsconfig.base.json`: алиас `"@nitro-studio/data-access": ["libs/data-access/src/index.ts"]`.

### 1.2 Файлы

```
libs/data-access/
  README.md                     # 5 строк: клиент Nitro API; без Angular, без состояния
  src/index.ts                  # публичный API — ровно то, что в 1.3, ничего больше
  src/lib/model.ts              # доменные типы
  src/lib/errors.ts             # NitroApiError
  src/lib/endpoints.ts          # константы путей
  src/lib/http.ts               # postJson: fetch + same-origin + разбор ошибок
  src/lib/nitro-configs-api.ts  # фабрика клиента
  src/lib/nitro-configs-api.spec.ts
```

### 1.3 Публичный API — сигнатуры дословно

```ts
// model.ts
export interface ApplicationSummary {
    id: string;
    name: string;
}

export interface ApplicationSelector {
    id: string;
    host: string;
    path: string;
}

export interface Application {
    id: string;
    code: string;
    name: string;
    faviconUrl?: string;
    selectors: ApplicationSelector[];
}

export type VersionStatus = 'Draft' | 'Release';

export interface ConfigurationVersion {
    version: number;
    status: VersionStatus;
    updatedAt: string;
    releasedAt?: string;
}

export interface ConfigurationWithVersion extends ConfigurationVersion {
    configuration: unknown;   // JSON-значение; библиотека его не интерпретирует
}

// errors.ts
export class NitroApiError extends Error {
    readonly status: number;          // 0 — сетевая ошибка или таймаут
    readonly errorMessage?: string;   // из тела при 400/422
    readonly errorDetails?: unknown;  // из тела при 400/422
}

// nitro-configs-api.ts
export interface NitroConfigsApiOptions {
    baseUrl?: string;           // default '' — относительные пути
    fetchFn?: typeof fetch;     // default globalThis.fetch; для тестов
}

export interface NitroConfigsApi {
    getMyApplications(): Promise<ApplicationSummary[]>;

    getApplication(id: string): Promise<Application>;

    getConfigurationVersions(applicationId: string): Promise<ConfigurationVersion[]>;

    getConfiguration(applicationId: string, version?: number): Promise<ConfigurationWithVersion>;

    saveConfiguration(applicationId: string, configuration: unknown): Promise<ConfigurationVersion>;

    releaseConfiguration(applicationId: string): Promise<ConfigurationVersion>;
}

export function createNitroConfigsApi(options?: NitroConfigsApiOptions): NitroConfigsApi;
```

Ни классов, ни Angular, ни RxJS. Только `fetch` и промисы.

### 1.4 Соответствие методов эндпоинтам — дословно

Все запросы: POST, `credentials: 'same-origin'`, `Content-Type: application/json`,
URL = `baseUrl + путь`.

| Метод                      | Путь                                                       | Тело запроса                                     | Из ответа берём |
|----------------------------|------------------------------------------------------------|--------------------------------------------------|-----------------|
| `getMyApplications`        | `/nitro/api/v1/application/get-my-list`                    | `{}`                                             | `body.list`     |
| `getApplication`           | `/nitro/api/v1/application/get-by-id`                      | `{id}`                                           | `body`          |
| `getConfigurationVersions` | `/nitro/api/v1/application/configuration/version/get-list` | `{applicationId}`                                | `body.list`     |
| `getConfiguration`         | `/nitro/api/v1/application/configuration/version/get`      | `{applicationId}` или `{applicationId, version}` | `body`          |
| `saveConfiguration`        | `/nitro/api/v1/application/configuration/save`             | `{applicationId, configuration}`                 | `body`          |
| `releaseConfiguration`     | `/nitro/api/v1/application/configuration/release`          | `{applicationId}`                                | `body`          |

Лишние поля ответов игнорируются молча. Маппингов и переименований нет.

### 1.5 Ошибки — дословно

- HTTP 2xx → разобрать JSON, вернуть.
- HTTP 400 или 422 → прочитать тело как JSON, бросить
  `NitroApiError{status, errorMessage: body.errorMessage, errorDetails: body.errorDetails}`;
  тело не JSON — те же поля `undefined`.
- Прочие статусы → `NitroApiError{status}` без чтения тела.
- Сетевая ошибка / отказ fetch → `NitroApiError{status: 0}`.

### 1.6 Тесты (MSW, `setupServer` из `msw/node`)

На каждый из шести методов ровно три кейса, имена тестов —
`<метод>: success | api error | network error`:

- success: хендлер возвращает наблюдаемое тело; проверяются URL (с учётом `baseUrl` из
  опций — отдельный кейс на префикс у одного метода достаточно), тело запроса и результат;
- api error: 400 с `{errorMessage: 'x', errorDetails: {...}}` → поля `NitroApiError`;
- network error: `HttpResponse.error()` → `status: 0`.

Итого 18 + 1 тест на `baseUrl`. Ничего сверх.

## 2. Окружение через `mfInitialConfig`

### 2.1 Схема

`apps/nitro-studio/metadata/mf-initial-config.metadata.ts` — заменить пустой объект на:

```ts
export const mfInitialConfigMetadata = {
    type: 'object',
    properties: {
        nitroApiBaseUrl: {type: 'string'},
    },
    additionalProperties: false,
} as const;
```

Поле необязательное. После правки — `npm run metadata:build`; `metadata-type.ts` руками не
трогать. Если песочница поддерживает knobs для initialConfig (проверить по `@twork-mf/sandbox`
в `node_modules`) — добавить значение по умолчанию `''`; не поддерживает — зафиксировать в
«Отклонениях» и ничего не изобретать.

### 2.2 Сервис окружения

`apps/nitro-studio/src/studio/env/studio-environment.service.ts`:

```ts

@Injectable({providedIn: 'root'})
export class StudioEnvironmentService {
    private readonly baseUrl = signal('');
    readonly nitroApiBaseUrl = this.baseUrl.asReadonly();

    applyInitialConfig(config: MfInitialConfigMetadata | undefined): void {
        this.baseUrl.set(config?.nitroApiBaseUrl ?? '');
    }
}
```

`ExposedComponent` (`src/exposed/mf-studio/`): в конструкторе
`effect(() => this.env.applyInitialConfig(this.mfInitialConfig()))`. Больше нигде
`mfInitialConfig` не читается; потребители окружения ходят в сервис. Никакой другой код
`exposed/` не меняется.

## 3. Границы модулей

Корневой `.eslintrc.json`, правило `@nx/enforce-module-boundaries` (формат eslintrc):
в `depConstraints` добавить

```json
{
  "sourceTag": "type:app",
  "onlyDependOnLibsWithTags": [
    "type:data-access"
  ]
},
{"sourceTag": "type:data-access", "onlyDependOnLibsWithTags": []}
```

Если сейчас стоит правило-заглушка `"sourceTag": "*"` — удалить его в этом же MR. Теги
других будущих либ здесь не перечислять — их добавят их MR.

`libs/data-access/.eslintrc.json` — поверх наследуемого:

```json
"no-restricted-imports": ["error", {
"patterns": [
{
"group": ["@angular/*", "rxjs", "rxjs/*"],
"message": "data-access — без Angular и RxJS: fetch и промисы. Angular-обвязка живёт в приложении."
}
]
}
]
```

## 4. Порядок работ (для plan.md — уточнить, не менять состав)

1. Генерация либы, чистка `package.json`, алиас, границы, `npx lerna list` чист →
   `npm run verify` зелёный.
2. `model.ts`, `errors.ts`, `endpoints.ts`, `http.ts` + тесты ошибок → verify.
3. `nitro-configs-api.ts` + полная матрица MSW-тестов → verify.
4. Метаданные + сервис окружения + effect в exposed → `npm run metadata:build`, verify.
5. Смоук границ одноразовой веткой: импорт `@angular/core` в либе падает с сообщением из
   правила; сообщение — в MR.

## 5. Готово, когда

Verify зелёный на чистом клоне; 19 тестов либы проходят; `lerna list` без `data-access`;
`metadata-type.ts` перегенерирован; смоук границ приложен; в plan.md заполнен раздел
«Отклонения» (пустой — тоже заполнен: «нет»).

## Открытые вопросы — не блокируют эту работу

1. Конкурентные правки: `save` не несёт `version`. Вопрос владельцу API; до ответа
   `saveConfiguration` реализуется как наблюдается.
2. Формат ошибок вне 400/422.
3. Обязательные корпоративные HTTP-интерцепторы: если существуют — это единственное, что
   может пересмотреть `fetch`; выяснить до задачи «переключение Studio на HTTP», не здесь.