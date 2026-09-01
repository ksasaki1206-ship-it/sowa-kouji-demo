# sowa-kouji-api 第4-B2共有永続化基盤

Cloud Run上のHTTPS APIを想定したBackendです。第4-B2では既存API契約を維持したまま、開発用 `memory` と共有永続化用 `postgres` を切り替えられます。Cloud Runへの本番deploy、正式認証、写真binary保存はまだ行いません。

## 構造

`router → authenticateRequest / requireRole → api-service → store contract → memory provider | PostgreSQL provider`

- `src/app.js`: `/api/v1` routing、JSON形式、CORS、共通エラー
- `src/auth.js`: 認証provider境界、開発用mock user、role判定
- `src/services/api-service.js`: 業務認可、worker assignment、transaction単位、audit自動生成
- `src/providers/contracts.js`: Case / Property / Room / Staff / Response / Audit / Photo Store契約
- `src/providers/memory-provider.js`: API契約・unit test用の非永続provider
- `src/providers/postgres-provider.js`: `pg` だけを使う共有永続provider
- `src/db/migrate.js`: version管理されたSQL migration runner
- `db/migrations/`: 適用順序をファイル名で固定したmigration

`memory` は再起動で消え、複数instance間で共有されません。`postgres` は同じPostgreSQLへ接続するBackend間で業務データを共有します。Frontend localStorageとの自動同期・自動importは行いません。

## データモデル

正本はPostgreSQLです。検索・関係・競合制御に使うcore fieldは通常column、既存の可変項目と将来拡張項目は補助 `extra_data JSONB` に保存します。JSONBだけを正本にはしていません。

| table | 主な通常column |
| --- | --- |
| `properties` | id、name、address、management_company、owner_name、active、version |
| `rooms` | id、property_id、room_number、normalized_room_number、active、version |
| `staff` | id、name、login_user_id、can_survey、can_work、active、version |
| `cases` | id、property_id、room_id、status、lifecycle_status、is_archived、各担当ID、現調/施工日時、材料日、見積、resident token、version |
| `responses` | id、case/property/room ID、希望日時、連絡先、受付日時、反映状態 |
| `workflow_history` | case_id、順序、工程、完了日時、実施者 |
| `schedule_history` | case_id、順序、種別、変更前後、理由、変更者 |
| `audit_logs` | id、日時、user/userId、caseId、物件/部屋表示、変更内容 |
| `photo_metadata` | id、case_id、分類、file名、MIME、size、保存provider/key |

`rooms → properties`、`cases → properties/rooms`、`responses/workflow_history/schedule_history/photo_metadata → cases` にFKがあります。空文字またはlegacy担当IDを維持するため、現段階では案件の担当者IDに厳格なFKを付けずserviceで整合確認します。物理削除APIは追加せず、案件はlifecycle/アーカイブ、マスタは `active=false` を維持します。写真APIのDELETEは既存どおりmetadataだけが対象です。

## 更新競合とtransaction

案件・物件・部屋・担当者の更新は、DB上で次の比較更新を行います。

`UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING ...`

0件更新時だけ存在確認し、存在しなければ404、version不一致なら409を返します。案件更新とworkflow/schedule history、audit、resident回答と案件反映、写真metadataとauditは同一PostgreSQL transactionです。途中失敗時はrollbackされます。

## 設定とmigration

Node.js 20以上、PostgreSQL 17相当を基準にします。DB依存は `pg` のみです。

```sh
npm ci
npm test
npm run migrate
npm start
```

既定は従来どおり `DATA_PROVIDER=memory` です。PostgreSQL利用時だけBackend環境へ次を設定します。

```text
DATA_PROVIDER=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=false
DATABASE_POOL_MAX=10
RUN_MIGRATIONS=false
```

`DATABASE_URL` はBackendだけが参照し、Frontendへ渡しません。migrationは `schema_migrations` に適用済みfileを記録します。運用ではdeploy前の専用jobから `npm run migrate` を実行する方針を推奨します。開発時だけ `RUN_MIGRATIONS=true` で起動前適用も可能です。

PostgreSQL integration testは破壊的なtable初期化を含むため、専用test DBに対してだけ明示的に実行します。

```text
TEST_DATABASE_URL=postgresql://...test_database
ALLOW_DATABASE_RESET=true
npm run test:postgres
```

test/development seedはtest内でのみ投入し、production起動時には自動投入しません。

## localStorageからのデータ移行

起動時の `localStorage → Backend` 自動importは禁止しています。デモデータとパイロットデータを混在させないためです。将来importする場合は、adminが明示実行するdry-run付きCLIまたは管理jobとして、ID/FK/重複/versionを検証し、import対象と結果をauditできる別工程にします。

## API・認証・写真

APIの成功・一覧・error形式と `/api/v1` endpointは維持しています。管理APIはBackendでadmin/office/workerを認可し、workerは担当案件だけを扱います。public resident APIはtokenを検証し、物件・部屋表示名と受付状態だけを返します。

現在のmock認証はdevelopment専用です。`NODE_ENV=production` では無効になり、第4-B3で正式認証providerへ差し替えます。password、password hash、session、認証秘密情報はPostgreSQL業務tableへ保存しません。

写真はmetadataだけをPostgreSQLへ保存します。Data URL、画像binary、credentialは保存しません。共有画像本体は第4-Cで専用object storage/Drive providerへ接続します。

## Secret・Cloud SQL・backup方針

- `.env`、database password、API key、service account鍵、private tokenをGitへ置かない
- `.env.example` は項目名とplaceholderだけにする
- Cloud Run service identityとCloud SQL Connector/安全な接続方式を第4-B3で設定する
- Secretが必要な場合はSecret ManagerからBackendへ注入し、Frontendへ渡さない
- productionではCloud SQL automated backupとPITRを有効化する
- 1週間pilot開始直前にlogical exportを取得し、復元手順も確認する

第4-B2ではCloud SQL作成、backup設定、Cloud Run deploy、正式authenticationを実行しません。

## Docker

`node:22-alpine`、production dependenciesのみ、non-rootの `node` user、`PORT`環境変数を前提にします。imageにはmigration SQLを含めますが、コンテナbuild/deploy時にDB credentialを埋め込みません。
