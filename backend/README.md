# sowa-kouji-api 第4-B3B-1 Identity Platform接続準備

Cloud Run上のHTTPS APIを想定したBackendです。PostgreSQL共有永続化とB3Aの正式認証境界を維持し、B3B-1ではFirebase Admin SDKによるcustom token発行・ID token検証、公開Web設定、Cloud SQL Unix socket設定、DB共有のlogin試行制限を追加しました。Cloud Runへのdeploy、IAM変更、Secret Manager登録、写真binary保存はまだ行いません。

## 構造

`router → mock auth | Bearer auth → DB auth user / role / staffId → api-service → store contract → memory provider | PostgreSQL provider`

- `src/app.js`: `/api/v1` routing、JSON形式、CORS、共通エラー
- `src/auth.js`: 認証provider境界、開発用mock user、role判定
- `src/auth/auth-service.js`: login、本人password変更、admin用user管理
- `src/auth/identity-provider.js`: custom token発行・ID token検証の差替境界、test用fake、未設定時fail-closed
- `src/auth/firebase-identity-provider.js`: Firebase Admin SDKをADCで利用する正式adapter
- `src/auth/password-service.js`: Node.js標準cryptoのscrypt、user別salt、timing-safe比較
- `src/auth/*-user-store.js`: 認証user専用memory/PostgreSQL Store
- `src/cli/bootstrap-admin.js`: 初回だけ実行する初期admin作成CLI
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
| `auth_users` | 不変id、unique login_id、nullable unique email、表示名、role、staff_id、active、scrypt情報、password変更日時、version |
| `auth_login_attempts` | SHA-256化したlogin subject、失敗回数、集計window、一時lock期限 |

`rooms → properties`、`cases → properties/rooms`、`responses/workflow_history/schedule_history/photo_metadata → cases` にFKがあります。空文字またはlegacy担当IDを維持するため、現段階では案件の担当者IDに厳格なFKを付けずserviceで整合確認します。物理削除APIは追加せず、案件はlifecycle/アーカイブ、マスタは `active=false` を維持します。写真APIのDELETEは既存どおりmetadataだけが対象です。

## 更新競合とtransaction

案件・物件・部屋・担当者の更新は、DB上で次の比較更新を行います。

`UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING ...`

0件更新時だけ存在確認し、存在しなければ404、version不一致なら409を返します。案件更新とworkflow/schedule history、audit、resident回答と案件反映、写真metadataとauditは同一PostgreSQL transactionです。途中失敗時はrollbackされます。

## 設定とmigration

Node.js 20以上（Cloud Run imageはNode.js 22）、PostgreSQL 17相当を基準にします。DB接続は `pg`、正式Identity接続は `firebase-admin` を利用し、大型ORMは導入しません。

```sh
npm ci
npm test
npm run migrate
npm start
```

既定は従来どおり `DATA_PROVIDER=memory` です。local PostgreSQLは従来どおり `DATABASE_URL` を利用できます。

```text
DATA_PROVIDER=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=false
DATABASE_POOL_MAX=10
RUN_MIGRATIONS=false
```

`DATABASE_URL` はBackendだけが参照し、Frontendへ渡しません。migrationは `schema_migrations` に適用済みfileを記録します。運用ではdeploy前の専用jobから `npm run migrate` を実行する方針を推奨します。開発時だけ `RUN_MIGRATIONS=true` で起動前適用も可能です。

Cloud RunからCloud SQLを利用する場合は `DATABASE_URL` の代わりに次を設定します。`DB_HOST` 未指定時は `INSTANCE_CONNECTION_NAME` から `/cloudsql/<INSTANCE_CONNECTION_NAME>` を生成します。DB passwordはSecret ManagerからBackendだけへ注入し、Frontendへ返しません。

```text
INSTANCE_CONNECTION_NAME=PROJECT:REGION:INSTANCE
DB_NAME=sowa
DB_USER=application-user
DB_PASSWORD=<Secret Managerから注入>
DATABASE_SSL=false
```

PostgreSQL integration testは破壊的なtable初期化を含むため、専用test DBに対してだけ明示的に実行します。

```text
TEST_DATABASE_URL=postgresql://...test_database
ALLOW_DATABASE_RESET=true
npm run test:postgres
```

test/development seedはtest内でのみ投入し、production起動時には自動投入しません。

## localStorageからのデータ移行

起動時の `localStorage → Backend` 自動importは禁止しています。デモデータとパイロットデータを混在させないためです。将来importする場合は、adminが明示実行するdry-run付きCLIまたは管理jobとして、ID/FK/重複/versionを検証し、import対象と結果をauditできる別工程にします。

## 正式認証mode

正式認証は `AUTH_MODE=identity` で有効になります。login時だけFrontendが `identifier`（loginIdまたはemail）とpasswordをBackendへ送り、BackendがPostgreSQLの認証userとscrypt hashを検証します。成功後はIdentity Providerのcustom tokenを返し、FrontendがID tokenへ交換します。以後の管理APIは `Authorization: Bearer <ID_TOKEN>` を使います。

BackendはID tokenの `uid` から毎回DB userを再取得し、`active`、`role`、`staffId`を確定します。Frontendから送られたrole・表示名・担当者情報は認可に使用しません。workerは不変の `staffId` と案件の担当IDを比較し、担当外案件を403にします。login userとstaff masterは別entityです。

API契約は次のとおりです。

- `POST /api/v1/auth/login`: public。identifier/password検証とcustom token発行
- `GET /api/v1/auth/me`: Bearer tokenの現在user
- `POST /api/v1/auth/logout`: logoutをauditへ記録
- `POST /api/v1/auth/password`: 本人password変更
- `GET/POST /api/v1/users`: admin用一覧・追加
- `GET/PATCH /api/v1/users/:id`: admin用取得・更新・active切替
- `POST /api/v1/users/:id/password-reset`: admin用password reset

passwordは10文字以上、userごとの24 byte saltを使うscryptで保存します。平文、hash、salt、hash parameterはAPI response・audit・errorへ返しません。login失敗は不存在、誤password、inactiveのいずれも同じ401 messageです。userは物理削除せず `active=false` とし、最後の有効adminは無効化・role変更できません。

`IDENTITY_PROVIDER=fake` はunit/API契約確認専用です。`NODE_ENV=production` ではfake Identity Providerとmock header認証を拒否します。正式環境は `IDENTITY_PROVIDER=firebase`（`identity-platform` はalias）を指定します。未設定は `unconfigured` providerとなり、token発行・検証を必ず失敗させます。

```text
AUTH_MODE=identity
IDENTITY_PROVIDER=firebase
IDENTITY_PROJECT_ID=local-reference-193012
IDENTITY_AUTH_DOMAIN=local-reference-193012.firebaseapp.com
IDENTITY_WEB_API_KEY=<Firebase Authentication専用Web API key>
```

Firebase Admin SDKはCloud RunのApplication Default Credentialsを使います。service account JSONやprivate keyをimage/repositoryへ置きません。custom token発行時、Cloud Run service identityが自分自身またはtoken署名用service accountに対する `iam.serviceAccounts.signBlob` を持つ必要があります。IAM付与はdeploy工程で最小権限を確認して行います。

`GET /api/v1/auth/config` はFirebase Web SDKに必要な `apiKey`、`authDomain`、`projectId`だけを返します。password、DB credential、Admin SDK credential、service account情報は返しません。Firebase Web API keyは公開client設定でありserver secretではありませんが、Firebase Authentication用途専用とし、他のGoogle API用keyやDB secretと共用しません。実値はrepositoryやtest logへ書きません。

Frontendは公式Firebase Web modular SDKをCDNから遅延読込し、custom tokenをID tokenへ交換します。SDK呼出しは `assets/js/firebase-identity-adapter.js` に隔離し、APIごとに `getIdToken()` を呼ぶためSDKの自動refreshへ追従します。logoutはBackend auditを試みた後にFirebase `signOut` を必ず実行します。local modeはSDKも公開config endpointも利用せず、既存デモ認証を維持します。

## Login試行制限

login失敗はPostgreSQLの `auth_login_attempts` に保存します。存在するuserは不変user ID、存在しないidentifierは正規化値を元にしたsubjectをBackendでSHA-256化して保存し、raw loginId/emailやpasswordはtableへ残しません。既定は「15分以内に5回失敗で15分lock」です。複数Cloud Run instanceが同じDB上で原子的なupsertを行います。

lock中、不存在、誤password、inactiveはいずれも同じ401 messageです。lock期限後の正常loginで記録を削除します。本人password変更・admin resetでも対象userのlockを解除します。閾値は `LOGIN_MAX_FAILURES`、`LOGIN_FAILURE_WINDOW_MINUTES`、`LOGIN_LOCK_MINUTES` で変更できます。

## 初期admin bootstrap

production起動時に固定password userを自動作成しません。migration適用後、adminが存在しない環境でだけone-time CLIを実行します。passwordはコマンド引数やrepositoryへ書かず、stdinまたはSecret Manager等からmountした一時fileで渡します。

```sh
cd backend
export DATABASE_URL='postgresql://...'
export BOOTSTRAP_ADMIN_LOGIN_ID='initial-admin'
export BOOTSTRAP_ADMIN_DISPLAY_NAME='初期管理者'
export BOOTSTRAP_ADMIN_EMAIL='admin@example.jp' # 任意
printf '%s' "$ONE_TIME_PASSWORD" | npm run bootstrap:admin
```

Cloud Run job等では `BOOTSTRAP_ADMIN_PASSWORD_FILE` にSecretのmount pathを指定できます。CLIは有効adminが1人でも存在すれば停止します。実行後はSecret値を破棄・rotationし、作成結果のuser IDだけを標準出力します。

## local demo・development mock・Frontend

GitHub Pagesの既定 `local` modeと `sowa-demo-*` localStorage keyは変更していません。local modeは従来のユーザー選択 + demo passwordを継続します。HTTP正式認証modeだけログイン欄をidentifier + passwordに切り替えます。

開発時の `AUTH_MODE=mock` と `x-mock-user-id` は既存APIテスト用に維持しますが、`NODE_ENV=production` では必ず無効です。正式modeのFrontendにはIdentity Platform SDKを直接散在させず、`signInWithCustomToken / getIdToken / signOut` 境界を使います。公開GitHub Pagesは引き続きlocal modeが既定であり、本番Backend URLへの切替はdeploy工程まで行いません。

HTTP通信失敗時にlocalStorageへ自動fallbackしません。正式modeのsession/tokenもdemo用認証localStorageへ保存せず、Firebase Auth SDKのbrowser local persistenceへ委譲します。

## API・写真

APIの成功・一覧・error形式と `/api/v1` endpointは維持しています。管理APIはBackendでadmin/office/workerを認可し、workerは担当案件だけを扱います。public resident APIはtokenを検証し、物件・部屋表示名と受付状態だけを返します。

現在のmock認証はdevelopment専用です。password、password hash、session、認証秘密情報は案件等の業務tableやSheets同期対象へ保存しません。

写真はmetadataだけをPostgreSQLへ保存します。Data URL、画像binary、credentialは保存しません。共有画像本体は第4-Cで専用object storage/Drive providerへ接続します。

## B3B-2で必要なGoogle Cloud設定

- Cloud Run service identityへCloud SQL Clientとcustom token署名に必要な最小権限を付与する
- `iam.serviceAccounts.signBlob` が必要な署名対象service accountを明確にし、過剰なService Account Token Creator付与を避ける
- Cloud RunへCloud SQL instanceをattachし、socket・DB名・user・Secret Manager参照を設定する
- Identity Platformのauthorized domainとGitHub Pages originを確認する
- production CORSを `https://ksasaki1206-ship-it.github.io` の完全一致だけにする
- migrationを専用jobで適用し、one-time bootstrapを実施する
- stagingでcustom token発行、Web SDK交換、Bearer検証、role/staffId再取得を実接続確認する

Google Cloud resource作成、IAM変更、credential生成、Secret Manager登録、deploy、実token発行はB3B-1では行っていません。

## Secret・Cloud SQL・backup方針

- `.env`、database password、API key、service account鍵、private tokenをGitへ置かない
- `.env.example` は項目名とplaceholderだけにする
- Cloud Run service identityとCloud SQL Connector/安全な接続方式を第4-B3で設定する
- Secretが必要な場合はSecret ManagerからBackendへ注入し、Frontendへ渡さない
- productionではCloud SQL automated backupとPITRを有効化する
- 1週間pilot開始直前にlogical exportを取得し、復元手順も確認する

B3B-1ではCloud SQL/Identity resource作成、backup設定、Cloud Run deploy、実Identity接続を実行しません。

## Docker

`node:22-alpine`、production dependenciesのみ、non-rootの `node` user、`PORT`環境変数を前提にします。imageにはmigration SQLを含めますが、コンテナbuild/deploy時にDB credentialを埋め込みません。
