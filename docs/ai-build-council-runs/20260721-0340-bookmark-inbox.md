# ai-build-council 実行記録：ブックマーク受信箱

- run-id: `20260721-0340-bookmark-inbox`
- 対象リポジトリ: https://github.com/momokuomomo-crypto/chrome-ext-bookmark-inbox
- commit: `b69fdc3`（初期実装、master push済み）
- 稟議書出典: [ai-council-output 稟議書_Chrome拡張機能アイデア.md](https://github.com/momokuomomo-crypto/ai-council-output/blob/master/chrome-extension-ideas/稟議書_Chrome拡張機能アイデア.md) A-3

## 概要

分類せず一旦保存する「受信箱」Chrome拡張機能（Manifest V3）。ツールバー
popup内の「現在のページを保存」ボタン、または右クリックメニュー
（ページ／リンク）で保存する。未処理件数をバッジ表示。「処理済み」は
削除せず状態変更のみで管理する。保存件数500件・storage使用量4MiBの
安全上限。activeTabのみで完結し`tabs`権限は使わない。

## 実施ステージ

Stage0（Intake）→ Stage1（Codex CLI独立設計）→ Stage2（Claude査読・凍結、
差し戻し1回・blocker修正）→ Stage3（議長Fable本体による実装）→
Stage4（Test Gate A：45テスト・typecheck・lint・build 全通過）→
Stage5（固定diffの独立実装レビュー：Codex CLI＋Claude Agentサブエージェント）
→ Stage6（指摘対応・Test Gate B：52テスト・typecheck・lint・build 全通過）
→ Stage7（commit・push）。

## Stage2で発見・修正した主な指摘

- **[blocker]** 「popupを開くだけで保存される」設計が、「開くだけでは
  処理済みにしない」という要件自身と自己矛盾していた。処理済みだった
  ページを一覧確認のためにpopupを開いただけで、黙って未処理へ差し戻る
  という致命的に紛らわしい挙動になっていた。
  → **popup初期化時の自動保存を廃止し、popup内の明示的な「現在のページを
  保存」ボタンでのみ保存する設計に変更**。差別化ポイントの
  「フォルダ選択なしの1クリック保存」はボタン・右クリックメニューで
  引き続き実現。
- **[major]** リンク保存時のタイトル取得手段が未定義（アンカーテキストを
  取得する手段がない）。→ ホスト名にフォールバックすると確定。
- **[minor]** 500件描画時のイベントリスナー管理方針が未定義。
  → 一覧コンテナへのイベント委譲方式を採用。

## Stage5で発見・修正した主な指摘

- **[major]** URLを正規化した後に4096文字で切り詰めていたため、異なる
  長いURLが誤って同一視され得た。→ 切り詰めず拒否するよう変更。
- **[major]** 4MiB容量チェックが書き込み前の使用量のみで判定され、
  保存後に上限を超えられた。→ 実際に書き込む状態全体のサイズを見積もり、
  書き込み後の超過を検出するよう変更。
- **[major]** 未知のschemaVersionを空状態として返し、次の書き込みで
  元データを黙って上書きしていた。→ 認識できないデータには例外を投げ、
  書き込み系操作を失敗させるよう変更。
- **[major]** 保存成功後のバッジ更新失敗が「保存失敗」として返っていた。
  → バッジ更新を独立して捕捉するよう修正。
- **[major]** 拡張機能アップデート時、contextMenus.createが重複ID
  エラーを起こし得た（Claude Agentが独立に発見）。→ removeAll()を
  挟んでから登録するよう修正。

詳細な指摘一覧・対応内容は
[.ai-build-council/runs/20260721-0340-bookmark-inbox/decisions/](../../.ai-build-council/runs/20260721-0340-bookmark-inbox/decisions/)
（ローカルのみ、.gitignore対象のためリポジトリには含まれない）を参照。

## 未解決・今後の検討事項

- 500件配列の中間・末尾ID操作、URL正規化の網羅的境界値テストは
  時間配分を優先し今回は追加していない（実装自体は単純なfindIndex/filter
  ベースで誤りが構造的に起こりにくいと判断）。
- Chrome Web Store公開に向けたストア掲載文言・プライバシーポリシー・
  スクリーンショット等は未着手。
