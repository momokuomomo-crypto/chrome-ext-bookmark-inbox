# ブックマーク受信箱

フォルダ選択なしでページを一旦保存し、未処理件数をバッジ表示する
Chrome拡張機能（Manifest V3）。

[ai-council v2](https://github.com/momokuomomo-crypto/ai-council_v2)の
会合で検討・承認された
[稟議書](https://github.com/momokuomomo-crypto/ai-council-output/blob/master/chrome-extension-ideas/稟議書_Chrome拡張機能アイデア.md)
をもとに、
[ai-build-council](https://github.com/momokuomomo-crypto/ai-build-council)
のワークフローで設計・実装した。

## 主な機能

- ポップアップの「現在のページを保存」ボタン、または右クリックメニュー
  （ページ／リンク）で、分類せずに一旦保存する「受信箱」
- 未処理件数をツールバーバッジに表示
- 「処理済み」は削除せず状態変更のみで管理し、後から見返せる
- 保存件数500件・`chrome.storage`使用量4MiBの安全上限を設け、超過時は
  拒否する

## セットアップ

```bash
npm install
npm run build
```

`chrome://extensions` でデベロッパーモードを有効にし、
「パッケージ化されていない拡張機能を読み込む」で`dist/`を選択する。

## 開発

```bash
npm run dev         # 開発用ビルド（watch）
npm run typecheck
npm run lint
npm run test         # 単体・統合テスト（Vitest, sinon-chrome）
npm run build        # 本番ビルド
```

## ディレクトリ構成

```
src/
  background.ts       # Service Worker（保存・状態管理・contextMenus）
  popup/               # ツールバーpopup UI
  shared/
    inbox.ts           # 受信箱の状態遷移ロジック
    storage.ts          # chrome.storage永続化・容量上限チェック
    types.ts            # 型定義
tests/
  unit/                 # 純粋関数の単体テスト（Vitest）
  integration/           # background.tsの統合テスト（sinon-chrome）
```

## 開発の経緯

[ai-build-council](https://github.com/momokuomomo-crypto/ai-build-council)
のゲート付きワークフロー（独立設計→設計査読→実装→テスト→固定diffの
独立実装レビュー→修正→記録）で設計・実装した。

設計査読の段階で、「popupを開くだけで自動保存する」という当初案が
「開くだけでは処理済みにしない」という要件自体と自己矛盾していることが
判明した（処理済みのページを一覧確認のために開いただけで、黙って未処理へ
差し戻ってしまう）。popup初期化時の自動保存を廃止し、明示的な保存ボタン・
右クリックメニューでのみ保存する設計に変更した。

その後の実装レビューでは、URL正規化後の文字数切り詰めが異なる長いURLを
同一視してしまう不具合、書き込み前の容量チェックが書き込み後の超過を
見逃す不具合、未知のスキーマバージョンのデータを黙って上書きしてしまう
不具合などが見つかり、いずれも修正した。
