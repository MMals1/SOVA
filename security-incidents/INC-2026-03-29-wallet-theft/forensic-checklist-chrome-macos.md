# Forensic Checklist: Chrome Profile (macOS)

Incident ID: INC-2026-03-29-wallet-theft
Scope: Проверка скомпрометированной машины с фокусом на профиль Google Chrome
OS: macOS

## 0. Правило №1 перед началом

- [ ] Не удалять профиль Chrome до снятия копии.
- [ ] Не переустанавливать браузер до фиксации артефактов.
- [ ] Работать с копией профиля, оригинал оставить неизменным.

## 1. Сбор базовых артефактов

### 1.1 Зафиксировать системное время и версию Chrome

- [ ] Сохранить вывод:

```bash
date -u
sw_vers
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version
```

### 1.2 Скопировать весь профиль Chrome

Базовая директория профиля:

- `~/Library/Application Support/Google/Chrome/`

- [ ] Сделать архив профиля:

```bash
cd ~/Library/Application\ Support/Google
zip -r chrome-profile-forensics.zip Chrome
```

Или форензик-копия без архива:

```bash
cp -a ~/Library/Application\ Support/Google/Chrome ~/Desktop/Chrome_forensics_copy
```

## 2. Что смотреть в профиле Chrome

### 2.1 Основные профили

Проверить каталоги:

- `~/Library/Application Support/Google/Chrome/Default`
- `~/Library/Application Support/Google/Chrome/Profile 1` (и далее Profile 2, 3...)

- [ ] Определить, в каком профиле использовался SOVA.

### 2.2 Установленные расширения

Ключевые файлы:

- `~/Library/Application Support/Google/Chrome/Default/Preferences`
- `~/Library/Application Support/Google/Chrome/Default/Secure Preferences`
- `~/Library/Application Support/Google/Chrome/Default/Extensions/`

- [ ] Выгрузить список расширений, версий и времени установки.
- [ ] Выявить неизвестные/недавно обновленные расширения.
- [ ] Проверить наличие расширений с доступом к `tabs`, `webRequest`, `clipboard`, `cookies`, `storage`.

Пример поиска подозрительных разрешений:

```bash
rg -n 'webRequest|debugger|clipboard|cookies|nativeMessaging|management' \
  ~/Library/Application\ Support/Google/Chrome/Default/Extensions
```

### 2.3 Хранилища расширений (самое важное)

Проверить:

- `~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/`
- `~/Library/Application Support/Google/Chrome/Default/Sync Extension Settings/`
- `~/Library/Application Support/Google/Chrome/Default/IndexedDB/`
- `~/Library/Application Support/Google/Chrome/Default/Local Storage/leveldb/`
- `~/Library/Application Support/Google/Chrome/Default/Session Storage/`

- [ ] Найти ID SOVA-расширения и связанные с ним LevelDB-записи.
- [ ] Проверить, нет ли открытых секретов: `mnemonic`, `privateKey`, `seed`, `passphrase`, `keystore`.

Пример быстрого поиска строк по profile storage:

```bash
rg -a -n 'mnemonic|privateKey|seed|passphrase|keystore|wallet|eth|0x[a-fA-F0-9]{40}' \
  ~/Library/Application\ Support/Google/Chrome/Default/{Local\ Extension\ Settings,Local\ Storage/leveldb,IndexedDB,Session\ Storage} 2>/dev/null
```

### 2.4 Service Worker и кэш расширений

Проверить:

- `~/Library/Application Support/Google/Chrome/Default/Service Worker/`
- `~/Library/Application Support/Google/Chrome/Default/Code Cache/`
- `~/Library/Application Support/Google/Chrome/Default/GPUCache/`

- [ ] Зафиксировать, какие worker-скрипты запускались и когда.
- [ ] Проверить, нет ли признаков подмены JS расширений.

## 3. История действий пользователя и возможной фишинговой активности

### 3.1 История браузера и посещенные домены

Файл:

- `~/Library/Application Support/Google/Chrome/Default/History`

- [ ] Проверить посещения перед временем кражи.
- [ ] Выделить подозрительные dApp/фишинг-домены.

Пример грубой выборки URL (sqlite):

```bash
sqlite3 ~/Library/Application\ Support/Google/Chrome/Default/History \
"select datetime(last_visit_time/1000000-11644473600,'unixepoch'),url,title from urls order by last_visit_time desc limit 200;"
```

### 3.2 Загрузки

- [ ] Проверить последние загрузки исполняемых/архивных файлов.
- [ ] Отметить установки ПО/скриптов в день инцидента.

## 4. Признаки утечки seed/password через браузер

- [ ] Проверить менеджеры буфера обмена и их историю.
- [ ] Проверить заметки/веб-формы, где мог вводиться seed.
- [ ] Проверить автозаполнение форм Chrome (если использовалось).

## 5. Привязка ко времени инцидента

On-chain время кражи:

- `2026-03-29T14:52:35.000Z`

- [ ] Построить окно расследования: минимум ±2 часа от этого времени.
- [ ] Сверить:
  - историю посещений
  - запуск/обновление расширений
  - ввод seed/password
  - подозрительные загрузки

## 6. Что считать сильными индикаторами компрометации

- [ ] Неизвестное расширение с широкими разрешениями.
- [ ] Недавнее автообновление расширения перед инцидентом.
- [ ] Найденные строки seed/privateKey в local profile storage.
- [ ] Посещение фишинг-домена непосредственно до транзакции.
- [ ] Наличие инфостилера/скрипта-лоадера среди скачанных файлов.

## 7. Минимальный пакет доказательств для отчета

- [ ] Архив профиля Chrome.
- [ ] Список расширений с версиями и правами.
- [ ] Выгрузка подозрительных URL за период инцидента.
- [ ] Выгрузка находок по ключевым строкам (`mnemonic`, `privateKey`, `seed`, `keystore`).
- [ ] Таймлайн событий с UTC-временем.

## 8. После форензики (не раньше)

- [ ] Полная ротация всех секретов и паролей.
- [ ] Новый чистый browser profile только для крипто-операций.
- [ ] Аппаратный кошелек для real funds.
- [ ] Запрет неизвестных расширений и регулярный аудит extension list.
