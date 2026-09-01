# sowa-kouji-demo

総和様向け工事進捗管理デモです。外部サービスやビルド工程を使わない静的サイトのため、GitHub Pagesでそのまま公開できます。

## 構成

- `index.html`: 画面の構造と読み込み口
- `assets/css/styles.css`: レイアウト、部品、スマートフォン表示
- `assets/js/data.js`: 初期データ、選択肢、旧データのマイグレーション
- `assets/js/storage.js`: localStorageの読み書き
- `assets/js/audit.js`: 操作履歴と案件編集時の差分記録
- `assets/js/auth.js`: ロール付きユーザー定義、権限定義、デモ用ログイン状態の保存と解除
- `assets/js/app.js`: 画面描画、スケジュール、案件・写真・入居者回答の操作

保存キー `sowa-demo-photo-v1` と既存フィールドは従来版と互換です。
読み込み時に新しい不足フィールドとデモ用の不足部屋を非破壊で補完します。
