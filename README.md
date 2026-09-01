# sowa-kouji-demo

総和様向け工事進捗管理デモです。外部サービスやビルド工程を使わない静的サイトのため、GitHub Pagesでそのまま公開できます。

公開入口は用途別に分離しています。`index.html` は従来のlocalStorageデモ、`staging.html` はCloud Run staging APIとIdentity Platformを利用する共有試用環境です。staging入口は `index.html` の画面定義と同じCSS/JavaScript資産を読み込みますが、保存先・認証modeはmeta設定で明確に分離し、HTTP失敗時にlocalStorageへfallbackしません。

## 構成

- `index.html`: 画面の構造と読み込み口
- `assets/css/styles.css`: レイアウト、部品、スマートフォン表示
- `assets/js/data.js`: 初期データ、選択肢、旧データのマイグレーション
- `assets/js/storage-driver.js`: localStorage固有APIの隔離
- `assets/js/storage.js`: 既存保存キーと状態スナップショットの読み書き
- `assets/js/repositories.js`: 案件・物件・部屋・回答・履歴・工程・ユーザー・担当者・写真のデータ操作
- `assets/js/data-access.js`: local / HTTP providerを選択するデータアクセス窓口
- `assets/js/local-data-provider.js`: 既存の同期localStorage data provider
- `assets/js/http-data-provider.js`: 将来の共有API向け非同期data provider
- `assets/js/application-store.js`: providerの非同期取得を画面用stateへhydrateし、local / HTTPの呼出方法を統一
- `assets/js/api-client.js`: base URL、JSON、timeout、HTTP共通エラー変換
- `assets/js/async-ui.js`: 通信中の二重操作防止、request世代管理、HTTPエラー表示
- `assets/js/data-source-config.js`: 公開feature flagとAPI接続先設定
- `assets/js/bootstrap.js`: local画面起動またはHTTP接続状態表示
- `assets/js/audit.js`: 操作履歴と案件編集時の差分記録
- `assets/js/auth.js`: ロール付きユーザー定義、権限定義、ログイン状態、パスワードのハッシュ化・変更・リセット
- `assets/js/workflow.js`: 次アクション、要対応判定、管理指標、担当者別予定の業務ルール
- `assets/js/routing.js`: 案件リンク・入居者回答リンクの解析、URL生成、直接遷移の権限判定
- `assets/js/resident-access.js`: 入居者回答トークンの生成と公開可否判定
- `assets/js/qr.js`: リポジトリ内のライブラリを使ったQRコード生成
- `assets/js/app.js`: 画面描画、スケジュール、案件・写真・入居者回答の操作

保存キー `sowa-demo-photo-v1` と既存フィールドは従来版と互換です。
読み込み時に新しい不足フィールドとデモ用の不足部屋を非破壊で補完します。

## デモ用認証について

初期パスワードは全ユーザー共通で `password` です。変更後のパスワードはそのまま保存せず、Web Crypto APIで生成したハッシュ値を `sowa-demo-credentials-v1` に保存します。既存環境にパスワード情報がない場合は、初回読み込み時に初期値を非破壊で補完します。

この認証はGitHub Pages上で動く静的デモ用です。ブラウザへ配信されたJavaScriptとlocalStorageだけで動作するため、本番レベルのセキュリティは提供しません。正式運用ではGoogleログイン等の外部認証、サーバー側の認証・ユーザー管理・権限管理へ差し替える前提です。

## 第1弾の業務支援機能

- 要対応アラート：回答待ち、日程未確定、見積・材料・担当・施工後写真の不足、長期間更新なしを案件情報から判定
- 次のアクション：工程と不足情報から自動判定し、案件ごとの任意上書きにも対応
- 管理ダッシュボード：要対応・今週施工・完了を含む指標から案件一覧を直接絞り込み
- 担当者別スケジュール：今日または今後7日の現調・工事を担当者単位で表示

業務判定は保存処理から独立した `workflow.js` にまとめています。将来Google SheetsやサーバーDBへ移行する場合は、`storage.js` のデータアクセス実装を置き換え、画面と業務ルールを維持できる構成を想定しています。Google APIキーや認証情報は含めていません。

## 第2弾の現場運用機能

- worker専用「今日の現場」：自分が現調・施工担当の案件だけを表示し、住所・時間・備考・必要写真を優先表示
- worker権限制御：担当案件の閲覧、写真操作、施工担当案件の完了報告に限定。見積・担当変更・全案件・回答・他ユーザー履歴は非表示
- 工程タイムライン：問い合わせ、現調、見積、受注、材料手配、材料納品、施工、写真、完了の完了日時・担当者を案件ごとに記録
- 写真不足確認：施工済または完了へ進む際、施工後写真がなければ「写真を追加」「このまま進める」「キャンセル」を表示
- 材料管理：材料発注日、納品予定日、納品確認日、仕入先、材料メモと、未発注・納品遅延・納品未確認アラート

追加項目は既存案件の読み込み時に空値で補完します。`workflowHistory` は既存の操作履歴とは分離し、新たに完了した工程のみを重複なしで記録します。

## 第3-A弾のUI・導線改善

- トップ集計カード：進行中、本日現調、本日工事、回答待ちから既存プリセットを使って案件一覧へ移動
- 絞り込み表示：適用中の条件と件数を表示し、1操作で解除
- 物件スケジュール：部屋番号・入居者名、現調予定、工事予定のいずれからも案件詳細へ移動
- 担当者表示：予定セルに種別、時刻、担当者を表示し、未設定時は「担当未定」と表示
- 案件詳細：固定日時を入れるクイック設定を廃止し、日程・担当変更を案件編集へ一本化
- 担当未定抽出：現調、工事、両方のプリセットと高優先度アラートを追加

この変更では保存データの項目・localStorageキー・データアクセス層を変更していません。

## 第3-B弾の担当者・予定管理

- 担当者マスタ：ログインユーザーとは分離して、種別、現調可、工事可、ログインユーザー紐付け、有効状態を管理
- 担当候補制御：現調／工事の利用区分と有効状態から候補を生成し、無効化済みの過去担当者は既存案件だけで表示
- 予定時間：現調60分、工事180分を初期値として、開始日時と所要時間から終了時刻を自動表示
- 重複警告：担当者IDを優先して現調・工事を横断判定し、「予定を確認」「このまま登録」「キャンセル」を選択
- worker紐付け：担当者マスタの `loginUserId` を優先し、旧案件の担当者名一致も互換処理として維持

旧案件には担当者IDと所要時間を非破壊で補完します。既存案件で使用中の未登録担当者名も、利用実績に応じた担当区分でマスタへ追加します。担当者は削除せず、無効化によって過去案件・履歴との整合性を維持します。

## 第3-C1弾の物件管理

- 物件マスタ：物件名、住所、管理会社、オーナー、駐車、アクセス、共通備考、有効状態を一元管理
- 非破壊紐付け：旧案件の `property` を保ったまま `propertyId` を補完し、同一物件の案件をIDで集約
- 保守的な名寄せ：前後空白と連続空白だけを整理し、`○` と `〇` などの文字は自動変換しない
- 物件詳細：共通情報と部屋番号別の案件を表示し、既存案件詳細へ移動
- 重複案件警告：新規登録時に同一 `propertyId`・同一部屋の完了前案件を検出し、確認して続行した場合は操作履歴へ記録

住所・管理会社等が旧案件間で異なる場合、物件マスタには最初の非空値だけを仮採用し、案件側の文字列は上書き・削除しません。adminは物件の追加・編集・有効/無効切替、officeは閲覧、workerは管理画面非表示です。

## 第3-C1.5弾の部屋管理

- 部屋マスタ：物件ごとの部屋番号、共通備考、有効状態を管理し、削除せず無効化して過去案件との紐付けを維持
- 非破壊マイグレーション：旧案件の `room` 表示文字列を変更せず、`propertyId + room` から `roomId` を補完
- 保守的な部屋表記の正規化：前後空白、全角数字、数字間の空白、末尾の「号室」だけを比較用に整理し、`101`、`101号室`、`１０１号室`、`101 号室` を同じ部屋として扱う
- 案件登録：物件選択後に有効な部屋を選択し、adminは登録画面から未登録の部屋を追加可能。無効な部屋は既存案件の編集時だけ表示
- 重複・スケジュール：`roomId` を優先し、旧案件は正規化済み部屋番号へフォールバックして重複判定とスケジュール行を集約
- 権限と履歴：adminは追加・編集・有効/無効切替、officeは閲覧、workerは非表示。部屋操作と案件の部屋紐付け変更を操作履歴へ記録

`A-101` や `店舗A` のような英字・記号を含む表記は推測変換しません。部屋マスタに入居者名は保持せず、入居者情報は案件側に残します。

## 第3-C2弾の案件ライフサイクル管理

- 日程変更履歴：現調・工事の変更前後日時、所要時間、理由、変更者、変更日時を案件ごとに保持
- 延期・再調整：延期時は現在日時を未定へ戻し、直前の予定は履歴に保存。再設定時も変更理由とともに履歴化
- 案件取消：理由カテゴリと詳細を記録し、案件・回答・写真・操作履歴を削除せず過去案件へ移動
- アーカイブ：完了または取消案件を通常画面から除外し、過去案件として保持
- 過去案件検索：完了・取消・アーカイブを物件、部屋、担当者等で検索・絞り込み
- 権限：admin / officeは取消・アーカイブが可能。取消・アーカイブの解除はadminだけに限定

完了・取消・アーカイブ案件は、今日の予定、物件／担当者スケジュール、要対応、予定重複、worker画面の対象外です。既存案件には読み込み時に `lifecycleStatus: active`、空の `scheduleHistory`、未アーカイブ状態を非破壊で補完します。物理削除は行いません。

## 第3-D1弾の共有リンク・入居者用QR

- 案件直接リンク：`?case=CASE_ID` で案件詳細を開き、未ログイン時はログイン後に自動遷移
- 権限制御：admin / officeは進行中・完了・取消・アーカイブを直接表示でき、workerは自分の担当案件だけを表示
- 案件リンク操作：admin / officeの案件詳細からURLをコピー
- 入居者回答リンク：`?resident=TOKEN` でログイン画面を通らず、紐づく物件・部屋を固定表示した希望日時フォームを開く
- 公開状態管理：admin / officeは回答受付の停止・再開、adminは確認後のQR再発行が可能
- 回答紐付け：新しい回答には `caseId`、`propertyId`、`roomId` を保存し、旧回答にも判定可能な範囲で非破壊補完
- 操作履歴：受付停止・再開・QR再発行は記録するが、公開トークンの値は履歴へ保存しない

公開トークンは24バイトの乱数から生成する推測困難な識別子ですが、GitHub PagesとlocalStorageだけで動くデモ用の仕組みであり、本番の認証・認可を代替しません。実行時にQR生成の外部APIやCDNへ接続せず、QRコードはブラウザ内で生成します。

この静的デモの保存先はブラウザごとのlocalStorageです。同じ端末・ブラウザでは案件URL、回答、履歴を確認できますが、別端末で送信した回答が管理側端末へ同期されることはありません。初期デモ案件の公開トークンは端末間で同じデモ値を使い、追加案件や再発行後のトークンとデータはその端末内だけで有効です。複数端末での正式運用には、認証・権限検証を行うバックエンドと共有データストアが必要です。

QR生成には [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) を使用し、`assets/vendor/qrcode-generator/qrcode.mjs` とMITライセンス原文 `assets/vendor/qrcode-generator/LICENSE` を同梱しています。

## 第4-A弾の共有バックエンド基盤

Frontendのデータ境界を次の構造へ拡張しました。

`画面 / workflow → data-access → local provider または HTTP provider`

`index.html` の公開meta設定 `sowa-data-source` は既定で `local` です。現在のGitHub Pagesは従来どおりlocalStorageだけで動き、backendが停止していても影響を受けません。HTTP失敗時にlocalへ自動保存するfallbackは行わず、データの正を混在させません。

HTTP providerはPromiseベースです。第4-AではAPI client、provider契約、接続・共通エラー表示までを実装し、既存の同期業務画面はlocalモードだけで起動します。全画面の非同期化と共有API運用は、第4-B以降で段階的に行います。

`backend/` にはCloud Runを想定したNode.js API骨格を追加しました。

`router → mock authentication / role → service → store contract → memory provider`

- `/api/v1` でversion固定
- admin / office / workerをbackendでも検証
- workerの担当案件判定をserviceへ分離
- public resident endpointはtoken検証後の最小情報だけ返却
- 更新時の `version` 不一致を `409 CONFLICT` へ変換
- CORS許可originは `ALLOWED_ORIGINS` の完全一致
- Case / Property / Room / Staff / Response / Audit / Photo Store契約を定義
- 写真はmetadataのみ。画像本体は保存しない

第4-Aのmemory providerはAPI契約確認専用で、再起動時に消え、複数端末・複数インスタンス間の永続共有はできません。Frontend localStorageとの自動同期も行いません。API詳細、Docker、mock auth、Secret方針は `backend/README.md` と `backend/openapi.yaml` を参照してください。

Google Sheets / Drive SDK、APIキー、サービスアカウント鍵、Google認証、Cloud Run deployは今回追加していません。本番ではCloud Run service identityへ最小権限を付与し、必要な秘密情報だけをSecret Managerで管理します。秘密情報をGitHub Pagesへ渡しません。

## 第4-B1弾のFrontend非同期化

主要画面は起動時に選択providerから案件・マスタ・回答・履歴・工程・予定・写真metadataを非同期取得し、取得完了後に従来の業務ルールと描画を利用します。local providerの戻り値にも `await` できる同じ呼出形を使うため、GitHub Pagesの既定localモードとHTTPモードで画面側の保存順序が分岐しません。

- 作成・更新・取消・アーカイブ・マスタ操作・回答・写真metadata・完了報告は、保存成功後にだけ通知、再描画、画面遷移を実行
- 主要送信ボタンを通信中disabledにして二重登録を防止
- `409 CONFLICT` 時は編集画面を閉じ、同じHTTP providerから最新情報を再取得。自動上書きは行わない
- `401 / 403 / 409 / 500 / timeout / network error` を共通メッセージへ変換
- HTTPモードの通信失敗時はlocalStorageへfallbackせず、データソースを混在させない
- 公開resident画面は管理用stateを必要とせず、token付きpublic APIだけを利用

GitHub Pagesのmeta設定は引き続き `local` です。ローカル開発時だけ、例えば `?dataSource=http&apiBaseUrl=http://127.0.0.1:8080&apiAuth=mock` でmemory Backendとの契約確認ができます。localhost以外ではqueryによるデータソース上書きを無視します。memory Backendは再起動で消えるため、実運用の共有保存には使用できません。

## 第4-B2弾のPostgreSQL共有永続化基盤

BackendのStore契約を維持したまま、`DATA_PROVIDER=memory` または `DATA_PROVIDER=postgres` を選択できるようにしました。PostgreSQLを正本とし、案件・物件・部屋・担当者・入居者回答・工程/予定履歴・操作履歴・写真metadataを再起動後も保持します。

- SQL migrationをrepositoryでversion管理
- 案件/物件/部屋/担当者はDBの比較更新でversion競合を409へ変換
- 案件変更と工程/予定履歴/audit、resident回答と案件反映、写真metadataとauditをtransaction化
- memory providerはAPI契約・unit test用として維持
- 既定のGitHub Pagesは引き続きlocal modeで、localStorageデータをBackendへ自動importしない
- password hash、session、認証秘密情報、写真binaryは業務DBへ保存しない

設定、schema、migration、integration test、backup方針は `backend/README.md` を参照してください。Cloud Run/Cloud SQL作成、正式認証、写真binary共有は後工程です。

## 第4-B4A弾の写真ファイル共有基盤

local入口は従来のData URL＋localStorage写真を維持します。stagingのHTTP正式modeだけ、圧縮済みJPEGをBackendへ送り、注入可能な写真binary storeを経由してprivate Google Cloud Storageへ保存できる構造です。PostgreSQLには既存 `photo_metadata` のprovider/key/実byte sizeだけを保存し、写真本体・signed URLは保存しません。

- object keyはBackendがrandom IDで生成し、元filenameをpathへ使わない
- 一覧取得時だけ短時間のV4 read signed URLを返す
- workerはstaffIdで担当案件だけ閲覧・追加・削除可能
- public resident APIには写真情報を追加しない
- 削除中の外部Storage障害はmetadataを非表示pending状態にして再試行可能にする
- 通常JSONの1MB上限は維持し、写真POSTだけ圧縮後4MBに必要なbody上限を使う

bucket作成、IAM付与、Cloud Run環境変数設定、再deployは次工程で行います。

## 第4-B3A弾の正式認証基盤

GitHub Pagesの既定local modeと従来のデモ認証を維持しつつ、HTTP modeへ正式認証の境界を追加しました。

- BackendでloginIdまたはnullable email + passwordを検証
- 認証userを案件等と分離したPostgreSQL tableへ保存
- Node.js標準cryptoのscrypt、user別salt、timing-safe比較を使用
- Identity Providerのcustom token発行・ID token検証を差替可能なinterfaceへ隔離
- Bearer tokenのuidからDB userを再取得し、DB側role/staffIdで認可
- admin向けuser追加・更新・無効化・password reset API
- production起動時の固定admin自動生成を避けるone-time bootstrap CLI
- development mockは維持するがproductionでは無効

HTTP失敗時にlocalStorageへ自動fallbackしません。詳細なAPI、環境変数、初期admin手順、Google Cloud側の残作業は `backend/README.md` と `backend/openapi.yaml` を参照してください。

## 第4-B3B-1弾のIdentity Platform接続準備

- BackendへFirebase Admin SDK adapterを追加し、Cloud RunではApplication Default Credentialsを利用
- `GET /api/v1/auth/config` からFirebase Web用の公開設定だけを返し、実API keyは環境変数から注入
- Frontendは公式Firebase Web SDKをadapter内で遅延読込し、custom token交換、ID token refresh、signOutへ対応
- PostgreSQLのhash化subjectを使い、複数instanceで共有できるlogin失敗windowと一時lockを追加
- `DATABASE_URL` を維持しながらCloud SQL `/cloudsql/<INSTANCE_CONNECTION_NAME>` socket設定へ対応
- production fake認証拒否、DB userのactive/role/staffId再取得、完全一致CORSを維持

GitHub Pagesは引き続きlocal modeが既定です。Cloud Run deploy、IAM変更、Secret Manager実登録、GitHub Pagesのproduction Backend切替は行っていません。Firebase Web API keyは公開client設定ですが、Authentication専用としrepositoryへ実値を置きません。

## データアクセス層

現在のデータフローは次のとおりです。

`画面 / 業務ルール → data-access.js → repositories.js → storage.js → storage-driver.js → localStorage`

保存キー `sowa-demo-photo-v1`、`sowa-demo-auth-v1`、`sowa-demo-credentials-v1` は変更していません。旧形式の案件は読み込み時に `photoMetadata` を追加し、従来の `photos` 内のData URLもそのまま保持します。

各リポジトリの責務は以下です。

| データ | list / get | create | update |
| --- | --- | --- | --- |
| 案件 | 全件・ID・物件/部屋で取得 | 新規案件を追加 | 案件フィールドを更新 |
| 物件 | 全件・ID・正規化名で取得 | 物件を追加 | 共通情報・有効状態を更新 |
| 部屋 | 全件・ID・物件・正規化部屋番号で取得 | 物件へ部屋を追加 | 表示番号・共通備考・有効状態を更新 |
| 入居者回答 | 全件・ID・案件に紐づく回答を取得 | 回答を追加 | 反映状態などを更新 |
| 操作履歴 | 新しい順の履歴・IDで取得 | 履歴を先頭へ追加し最大500件に制限 | 履歴項目を更新 |
| 工程履歴 | 案件内の工程・工程キーで取得 | 未登録工程を追加 | 完了日時・実施者を更新 |
| ユーザー情報 | `auth.js` のユーザー定義を一覧・ID/名前で取得 | 現デモではコード定義のため無効 | 現デモではコード定義のため無効 |
| 担当者 | 全件・ID・表示名・ログインユーザーIDで取得 | 担当者を追加 | 表示名・種別・利用区分・紐付け・有効状態を更新 |
| 写真メタデータ | 案件・分類・写真IDで取得 | Data URLとメタデータを同時追加 | 保存先ID等のメタデータを更新 |
| 案件ライフサイクル | 案件の日程変更履歴を取得 | 日程履歴を追加 | 日程変更・延期・取消・復元・アーカイブ状態を更新 |

写真メタデータには、写真ID、ファイル名、MIMEタイプ、サイズ、登録日時、保存方式、将来の保存先キーを保持します。写真削除は従来機能維持のため `remove` としてData URLとメタデータを同時に削除します。

自動確認は `tests/data-access.test.mjs` で、旧形式マイグレーションと各リポジトリ、既存キーへの保存を検証できます。サイトの実行にNode.jsやビルド工程は不要です。

## Google Sheets / Google Drive連携の想定

将来は `data-access.js` と同じ操作契約を持つリモート実装へ差し替え、次のデータフローにします。

`GitHub Pages → Googleログイン等 → HTTPSバックエンドAPI → Google Sheets（案件・回答・履歴・ユーザー参照） / Google Drive（写真本体）`

推奨候補は、Cloud RunまたはCloud Functions上のAPI、Google Identity PlatformまたはFirebase Authentication、Google Sheets API、Google Drive APIの構成です。Cloud Runではダウンロードしたサービスアカウント鍵を置かず、専用のサービスIDへ最小権限を付与します。その他の秘密情報が必要な場合だけSecret Managerを利用します。バックエンドで利用者の認証・role・案件単位の権限を検証し、Sheets更新の競合制御とDriveファイルIDの管理も行います。Driveは共有ドライブまたは組織管理の保存先を使い、サービスアカウント削除時の所有ファイル消失を避ける設計が必要です。小規模な検証にはApps Script Webアプリも候補ですが、認証、CORS、同時更新、監査、運用監視の制約があるため、本番運用ではCloud Run等のAPIを優先します。

GitHub PagesへGoogle APIキー、OAuthクライアントシークレット、サービスアカウントJSON、Drive/Sheetsを直接更新できる資格情報は配置しません。フロントエンドが保持するのは、正式認証導入後の短時間アクセストークン等、公開クライアントとして扱える情報に限定します。
