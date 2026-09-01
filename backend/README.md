# sowa-kouji-api 第4-A骨格

Cloud Run上のHTTPS APIへ移行するための契約確認用バックエンドです。Cloud RunではコンテナのHTTPポートをプラットフォームがHTTPS公開する前提です。

> 第4-Aの `memory` providerは開発・API契約確認専用です。プロセス再起動でデータが消え、複数インスタンス間でも共有されません。永続的な共有保存は第4-B以降で実装します。

## 構造

`app/router → authenticateRequest / requireRole → api-service → store contract → memory provider`

- `src/app.js`: `/api/v1` routing、JSON形式、CORS、共通エラー
- `src/auth.js`: 認証provider境界、開発用mock user、role判定
- `src/services/api-service.js`: 業務認可、worker assignment check、audit自動生成、公開情報の最小化
- `src/providers/contracts.js`: Case / Property / Room / Staff / Response / Audit / Photo Store契約
- `src/providers/memory-provider.js`: 第4-A専用の非永続mock provider
- `src/server.js`: 環境設定と依存の組み立て

Google Sheets / Drive固有コードは含みません。第4-B/Cではstore契約を保ったままproviderを差し替えます。

## ローカル確認

Node.js 20以上を使用します。外部依存はありません。

```sh
npm test
npm start
```

管理APIのmock認証では開発時だけ `x-mock-user-id` を指定します。

- `nishiyama`: admin
- `office`: office
- `worker-a`: worker

`NODE_ENV=production` ではmock authを無効にします。本番認証providerが未実装の第4-Aコンテナは、production設定で管理APIへログインできません。これは誤ってmock認証を本番利用しないための制限です。

## API・権限

契約の詳細は `openapi.yaml` を参照してください。

- admin: 全案件、マスタ参照・更新
- office: 案件管理、マスタ参照
- worker: 担当者マスタの `loginUserId` で紐づく担当案件だけ
- public resident: 管理認証を要求せずtokenを検証し、物件表示名・部屋表示名・受付状態だけ返す

通常ユーザーがauditを任意作成するPOST endpointはありません。案件・回答・写真metadataの変更時にserviceが自動生成します。パスワード、パスワードハッシュ、セッションは業務storeに保存しません。

更新APIは現在の `version` を受け取り、保存済みversionと異なる場合は `409 CONFLICT` を返します。第4-BではSheets上のversion列等を使った原子的な比較更新が必要です。

写真APIはmetadataだけを扱います。画像本体のupload、署名URL、Google Drive保存は第4-Cの対象です。

## CORS

`ALLOWED_ORIGINS` はカンマ区切りの完全一致です。Originなしのサーバー間・開発確認は許可し、Origin付きブラウザ通信は許可一覧だけに応答します。本番で `*` は使用しません。

## Cloud Run・秘密情報の方針

- サービスアカウント鍵JSON、OAuth client secret、APIキーをGitHubへ置かない
- Cloud Runのservice identityを優先し、Sheets / Driveへ必要最小限のIAM権限だけを付与する
- 鍵以外の秘密情報が必要な場合はSecret Managerを利用する
- 秘密情報をGitHub PagesやAPIレスポンスへ渡さない
- 今回はサービスアカウント作成、Secret Manager登録、Cloud Run deployを行わない

## Docker

`node:22-alpine`、production dependenciesのみ、non-rootの `node` ユーザー、Cloud Runの `PORT` 環境変数を前提にしています。第4-Aではimage build確認だけが対象で、deployは行いません。
